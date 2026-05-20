"use strict";

import { appState, settings } from "../store.js";
import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { patientMatchesSharedFilter } from "./tags.js";
import { scanQRStream, isScannerSupported } from "./qr-scan.js";
import { finishDataChange } from "./drag.js";
import {
  encodePages, decodePage, newBatchId,
  escapeField, unescapeField, splitEscapedPipe,
} from "./qr-protocol.js";

// ============================
// メモQR / 共有QR V2
//
// 旧 V1 は「タイムスタンプヘッダー + 【label】\n本文」の人間可読書式だったが、
// V2 ではホームQR と同じ多ページバッチプロトコル `RND_<KIND> #<batchId> N/M\n`
// を使う。各エントリは `room|name|tagIdxs|content` の pipe 区切り（content も
// 同じ escape ルール）。空のフィールドは末尾 pipe を省略可能、空 content の
// 患者はそもそも含めない。
//
// 受信側挙動:
//   - 対象フィールド（memo/shared）が全患者で空 → マッチング反映モード
//     name + room + tags が完全一致する患者にだけ content を書き込む
//   - そうでない → 受信メモ欄に pretty-print して dump（既存パターン）
//
// メモ画面・共有画面それぞれが「QR表示カード（送信 + カメラ）+ 受信メモカード」
// を持つ点は V1 と同じ。違いは送受信プロトコルだけ。
// ============================

const MAX_BYTES = 800;

// ============================
// 共通タイムスタンプ
//   ${title}_YYYY_MMDD_HHMM
// JSON保存のファイル名・detail.js の受信タイムスタンプで再利用
// ============================
export function buildTimestampHeader() {
  const d = new Date();
  const titleSafe = (appState.title || "回診").replace(/[\\/:*?"<>|]/g, "_");
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${titleSafe}_${yyyy}_${mm}${dd}_${hh}${min}`;
}

// ============================
// Per-flow factory
// ============================

function createV2Flow(cfg) {
  // 送信側ステート
  let qrPages = [];
  let qrPageIndex = 0;

  // 受信側ステート（バッチ単位のページバッファ）
  let recvBatchId = null;
  let recvTotal = 0;
  const recvPages = new Map();
  function resetRecv() {
    recvBatchId = null;
    recvTotal = 0;
    recvPages.clear();
  }

  // ----- Encode / decode -----
  function encodePayload() {
    const tagIdxByName = new Map();
    (settings.tags || []).forEach((t, i) => tagIdxByName.set(t, i + 1));

    const lines = [];
    for (let i = 0; i < appState.patients.length; i++) {
      const p = appState.patients[i];
      if (!cfg.matchesFilter(p)) continue;
      const content = String(p?.[cfg.fieldName] ?? "").trim();
      if (!content) continue;
      const room = String(p?.room || "").trim();
      const name = String(p?.name || "").trim();
      const tagIdxs = (p?.tags || [])
        .map(t => tagIdxByName.get(t))
        .filter(v => typeof v === "number");
      const parts = [
        escapeField(room),
        escapeField(name),
        tagIdxs.join(","),
        escapeField(content),
      ];
      lines.push(parts.join("|"));
    }
    return lines.join("\n");
  }

  function decodePayload(payload) {
    const out = [];
    for (const raw of String(payload || "").split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const parts = splitEscapedPipe(line);
      const room = unescapeField(parts[0] || "");
      const name = unescapeField(parts[1] || "");
      const tagsRaw = parts[2] || "";
      const tagIdxs = tagsRaw
        ? tagsRaw.split(",").map(s => parseInt(s.trim(), 10)).filter(v => Number.isFinite(v))
        : [];
      const content = unescapeField(parts[3] || "");
      if (!content) continue;
      out.push({ room, name, tagIdxs, content });
    }
    return out;
  }

  // ----- QR canvas drawing -----
  function drawQrToCanvas(text) {
    const canvas = document.getElementById(cfg.ids.canvasId);
    if (!canvas) return;
    try {
      const ecl = qrcodegen.QrCode.Ecc.LOW;
      const qr = qrcodegen.QrCode.encodeText(text, ecl);
      const border = 4;
      const modules = qr.size + border * 2;
      const parentW = (canvas.parentElement && canvas.parentElement.clientWidth) ? canvas.parentElement.clientWidth : 800;
      const cssW = Math.max(240, Math.min(parentW, 980));
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const scale = Math.max(2, Math.floor((cssW * dpr) / modules));
      const sizePx = modules * scale;
      canvas.width = sizePx;
      canvas.height = sizePx;
      canvas.style.width = "100%";
      canvas.style.height = "auto";
      canvas.style.maxWidth = cssW + "px";
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sizePx, sizePx);
      ctx.fillStyle = "#000000";
      for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
          if (qr.getModule(x, y)) {
            ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
          }
        }
      }
    } catch (err) {
      console.error(`${cfg.fieldName} QR generation failed`, err);
    }
  }

  function renderQrPage() {
    const meta = document.getElementById(cfg.ids.pageMetaId);
    const prevBtn = document.getElementById(cfg.ids.prevBtnId);
    const nextBtn = document.getElementById(cfg.ids.nextBtnId);
    const canvas = document.getElementById(cfg.ids.canvasId);

    if (!qrPages || qrPages.length === 0) {
      if (meta) meta.textContent = "（対象の患者がいません）";
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      if (canvas) {
        canvas.width = 1; canvas.height = 1;
        canvas.style.width = "0";
      }
      return;
    }

    const i = Math.max(0, Math.min(qrPageIndex, qrPages.length - 1));
    qrPageIndex = i;
    const total = qrPages.length;
    const text = qrPages[i];
    const bytes = utf8ByteLength(text);
    if (meta) meta.textContent = `(${i + 1}/${total}) ${bytes} bytes`;
    if (prevBtn) prevBtn.disabled = (i === 0);
    if (nextBtn) nextBtn.disabled = (i === total - 1);
    drawQrToCanvas(text);
  }

  function regenerateAndRender() {
    qrPages = encodePages({ kind: cfg.kind, payload: encodePayload(), batchId: newBatchId(), maxBytes: MAX_BYTES });
    qrPageIndex = 0;
    renderQrPage();
  }

  function open() {
    const wrap = document.getElementById(cfg.ids.wrapId);
    if (!wrap) return;
    wrap.classList.add("active");
    regenerateAndRender();
  }
  function close() {
    const wrap = document.getElementById(cfg.ids.wrapId);
    if (!wrap) return;
    wrap.classList.remove("active");
  }
  function isActive() {
    const wrap = document.getElementById(cfg.ids.wrapId);
    return !!(wrap && wrap.classList.contains("active"));
  }
  function refresh() {
    if (!isActive()) return;
    regenerateAndRender();
  }

  // ----- 受信側 -----

  function isTargetEmptyForAll() {
    return appState.patients.every(p => !String(p?.[cfg.fieldName] || "").trim());
  }

  function arraysEqualAsSet(a, b) {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
  }

  function applyEntries(entries) {
    if (entries.length === 0) {
      alert("取込対象のエントリがありません。");
      return;
    }
    const resolveTag = (idx) => settings.tags?.[idx - 1] || null;

    if (isTargetEmptyForAll()) {
      // マッチング反映モード
      let applied = 0;
      const noMatch = [];
      const multi = [];
      for (const e of entries) {
        const senderTagNames = e.tagIdxs.map(resolveTag).filter(Boolean);
        const candidates = [];
        for (const p of appState.patients) {
          const pName = String(p?.name || "").trim();
          const pRoom = String(p?.room || "").trim();
          if (pName !== e.name || pRoom !== e.room) continue;
          if (!arraysEqualAsSet(p?.tags || [], senderTagNames)) continue;
          candidates.push(p);
        }
        if (candidates.length === 1) {
          candidates[0][cfg.fieldName] = e.content;
          applied++;
        } else if (candidates.length === 0) {
          noMatch.push(e);
        } else {
          multi.push(e);
        }
      }
      finishDataChange();
      close();

      const msgs = [`${applied} 件を反映しました。`];
      if (noMatch.length) msgs.push(`未マッチ（受信側に該当患者なし）: ${noMatch.length} 件`);
      if (multi.length) msgs.push(`複数マッチで保留: ${multi.length} 件`);
      // 未マッチ / 複数マッチがあれば受信メモにも残して可視化
      if (noMatch.length || multi.length) {
        const leftover = [...noMatch, ...multi].map(formatEntry).join("\n\n");
        dumpToPasteCard("【未反映分】\n" + leftover);
      }
      alert(msgs.join("\n"));
    } else {
      // 受信メモ欄に pretty-print して dump
      const pretty = entries.map(formatEntry).join("\n\n");
      dumpToPasteCard(pretty);
      close();
    }
  }

  function formatEntry(e) {
    const resolveTag = (idx) => settings.tags?.[idx - 1] || `#${idx}`;
    const tagsText = e.tagIdxs.length ? ` [${e.tagIdxs.map(resolveTag).join(", ")}]` : "";
    const header = `【${e.name || "?"} (${e.room || "?"})】${tagsText}`;
    return `${header}\n${e.content}`;
  }

  function dumpToPasteCard(text) {
    const pasteCard = document.getElementById(cfg.ids.pasteCardId);
    const area = document.getElementById(cfg.ids.pasteAreaId);
    if (pasteCard) pasteCard.classList.add("active");
    if (!area) return;
    const cur = area.value || "";
    const sep = cur && !cur.endsWith("\n") ? "\n" : "";
    area.value = cur + sep + text;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function startScan() {
    const session = scanQRStream({
      onScan: (text, ctrl) => {
        const decoded = decodePage(text);
        if (!decoded) {
          ctrl.setStatus("QR 形式が認識できません");
          return;
        }
        if (decoded.kind !== cfg.kind) {
          ctrl.setStatus(`これは ${cfg.kindLabel} ではありません（kind=${decoded.kind}）`);
          return;
        }
        if (recvBatchId && recvBatchId !== decoded.batchId) {
          resetRecv();
          ctrl.setStatus("新しいバッチを検出。受信バッファをリセットしました");
        }
        if (!recvBatchId) {
          recvBatchId = decoded.batchId;
          recvTotal = decoded.totalPages;
        }
        if (recvPages.has(decoded.pageNum)) {
          ctrl.setStatus(`重複: ${recvPages.size}/${recvTotal} 受信済`);
          return;
        }
        recvPages.set(decoded.pageNum, decoded.content);
        try { navigator.vibrate?.(80); } catch (_) {}
        if (recvPages.size === recvTotal) {
          const full = [];
          for (let i = 1; i <= recvTotal; i++) full.push(recvPages.get(i));
          const payload = full.join("");
          resetRecv();
          ctrl.setStatus(`全 ${recvTotal} ページ受信完了`);
          setTimeout(() => applyEntries(decodePayload(payload)), 100);
          return { stop: true };
        }
        ctrl.setStatus(`${recvPages.size}/${recvTotal} 受信`);
      },
    });
    if (!session) alert("スキャナを開けませんでした。");
  }

  function init() {
    const showBtn = document.getElementById(cfg.ids.showBtnId);
    if (showBtn) {
      showBtn.addEventListener("click", () => {
        if (isActive()) close();
        else open();
      });
    }
    const prevBtn = document.getElementById(cfg.ids.prevBtnId);
    const nextBtn = document.getElementById(cfg.ids.nextBtnId);
    if (prevBtn) prevBtn.addEventListener("click", () => {
      if (qrPageIndex > 0) { qrPageIndex--; renderQrPage(); }
    });
    if (nextBtn) nextBtn.addEventListener("click", () => {
      if (qrPageIndex < qrPages.length - 1) { qrPageIndex++; renderQrPage(); }
    });
    const scanBtn = document.getElementById(cfg.ids.scanBtnId);
    if (scanBtn) {
      if (!isScannerSupported()) {
        scanBtn.disabled = true;
        scanBtn.title = "このブラウザはカメラ非対応";
      }
      scanBtn.addEventListener("click", startScan);
    }
  }

  return { init, isActive, refresh };
}

// ============================
// Instances
// ============================

const sharedFlow = createV2Flow({
  fieldName: "shared",
  matchesFilter: patientMatchesSharedFilter,
  kind: "SH",
  kindLabel: "共有QR",
  ids: {
    wrapId: "sharedQrWrap",
    canvasId: "sharedQrCanvas",
    pageMetaId: "sharedQrPageMeta",
    prevBtnId: "sharedQrPrevBtn",
    nextBtnId: "sharedQrNextBtn",
    showBtnId: "sharedShowQrBtn",
    scanBtnId: "sharedQrScanBtn",
    pasteCardId: "sharedPasteCard",
    pasteAreaId: "sharedPasteArea",
  },
});

const memoFlow = createV2Flow({
  fieldName: "memo",
  matchesFilter: patientMatchesSharedFilter,
  kind: "MM",
  kindLabel: "メモQR",
  ids: {
    wrapId: "memoQrWrap",
    canvasId: "memoQrCanvas",
    pageMetaId: "memoQrPageMeta",
    prevBtnId: "memoQrPrevBtn",
    nextBtnId: "memoQrNextBtn",
    showBtnId: "memoShowQrBtn",
    scanBtnId: "memoQrScanBtn",
    pasteCardId: "memoPasteCard",
    pasteAreaId: "memoPasteArea",
  },
});

export const initSharedQr = () => sharedFlow.init();
export const isSharedQrActive = () => sharedFlow.isActive();
export const refreshSharedQrIfActive = () => sharedFlow.refresh();

export const initMemoQr = () => memoFlow.init();
export const isMemoQrActive = () => memoFlow.isActive();
export const refreshMemoQrIfActive = () => memoFlow.refresh();
