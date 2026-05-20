"use strict";

import { appState, settings, makeDefaultPatient, saveSettings } from "../store.js";
import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { scanQRStream, isScannerSupported } from "./qr-scan.js";
import { finishDataChange } from "./drag.js";
import { recordOp } from "./roster.js";
import {
  encodePages, decodePage, newBatchId,
  escapeField, unescapeField, splitEscapedPipe,
} from "./qr-protocol.js";

// ============================
// ホーム QR（名簿: 部屋番号 + 名前 + タグ）
//
// 送信側: 名簿を1本のペイロード文字列に圧縮（JSON-per-line + 連続空RLE）
// し、MAX_BYTES でチャンクして各ページに `RND_HM #<batchId> N/M\n` ヘッダーを付与。
//
// 受信側: 各スキャンでヘッダーを解析。同じ batchId のページを揃えるまでバッファ
// し、N/N 揃った瞬間に auto-apply。同ページ重複は無視、順不同 OK。
// 別 batchId が来たら confirm して破棄。
//
// auto-apply の挙動:
//   - 名簿が空（全患者で room/name/tags すべて空）→ reflect モード
//     スロット 1..N を取込内容で上書き。N が現在の長さより大きければ拡張
//   - 名簿が空でない → append モード
//     取込内容のうち空でない患者だけを末尾に新規スロットとして追加
//     （RLE の `_N` 空患者は捨てる）
// ============================

const KIND = "HM";

// ============================
// 名簿ペイロードのエンコード/デコード
//
// 各患者 1 行 `部屋|名前|タグidx,...`（位置依存、後ろの空は省略可）。
// 連続空患者は `_N` で RLE 圧縮。
// pipe `|` / `\` / 改行 は qr-protocol の共通エスケープで安全化。
// ============================

// 各タグは 1 行 `T:<escaped name>` で送信側が出す。患者行のタグ index は
// この T 行リストへの 1-based 参照になる（受信側で名前に再解決）。
function encodeRoster() {
  const lines = [];
  for (const t of (settings.tags || [])) {
    lines.push("T:" + escapeField(t));
  }

  const tagIdxByName = new Map();
  (settings.tags || []).forEach((t, i) => tagIdxByName.set(t, i + 1));

  let emptyRun = 0;
  const flushRun = () => {
    if (emptyRun > 0) { lines.push("_" + emptyRun); emptyRun = 0; }
  };
  for (const p of appState.patients) {
    const room = String(p?.room || "").trim();
    const name = String(p?.name || "").trim();
    const tagIdxs = (p?.tags || [])
      .map(t => tagIdxByName.get(t))
      .filter(v => typeof v === "number");
    if (!room && !name && tagIdxs.length === 0) { emptyRun++; continue; }
    flushRun();
    const parts = [escapeField(room), escapeField(name), tagIdxs.join(",")];
    while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    lines.push(parts.join("|"));
  }
  // 末尾の連続空は反映時に無意味なので捨てる
  return lines.join("\n");
}

function decodeRoster(payload) {
  const tagNames = [];
  const patients = [];
  for (const raw of String(payload || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("T:")) {
      tagNames.push(unescapeField(line.slice(2)));
      continue;
    }
    if (line.startsWith("_")) {
      const n = parseInt(line.slice(1), 10) || 0;
      for (let i = 0; i < n; i++) patients.push({ room: "", name: "", tagIdxs: [] });
      continue;
    }
    const parts = splitEscapedPipe(line);
    const room = unescapeField(parts[0] || "");
    const name = unescapeField(parts[1] || "");
    const tagsRaw = parts[2] || "";
    const tagIdxs = tagsRaw
      ? tagsRaw.split(",").map(s => parseInt(s.trim(), 10)).filter(v => Number.isFinite(v))
      : [];
    patients.push({ room, name, tagIdxs });
  }
  return { tagNames, patients };
}

// ============================
// QR rendering (送信側)
// ============================

let qrPages = [];
let qrPageIndex = 0;

function drawQrToCanvas(text) {
  const canvas = document.getElementById("homeQrCanvas");
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
    console.error("Home QR generation failed", err);
  }
}

function renderQrPage() {
  const meta = document.getElementById("homeQrPageMeta");
  const prevBtn = document.getElementById("homeQrPrevBtn");
  const nextBtn = document.getElementById("homeQrNextBtn");
  const canvas = document.getElementById("homeQrCanvas");

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
  qrPages = encodePages({ kind: KIND, payload: encodeRoster(), batchId: newBatchId() });
  qrPageIndex = 0;
  renderQrPage();
}

function openHomeQr() {
  const wrap = document.getElementById("homeQrWrap");
  if (!wrap) return;
  wrap.classList.add("active");
  regenerateAndRender();
}
function closeHomeQr() {
  const wrap = document.getElementById("homeQrWrap");
  if (!wrap) return;
  wrap.classList.remove("active");
}
export function isHomeQrActive() {
  const wrap = document.getElementById("homeQrWrap");
  return !!(wrap && wrap.classList.contains("active"));
}
export function refreshHomeQrIfActive() {
  if (!isHomeQrActive()) return;
  regenerateAndRender();
}

// ============================
// 受信バッファ + auto-apply
// ============================

let recvBatchId = null;
let recvTotal = 0;
const recvPages = new Map();

function resetRecv() {
  recvBatchId = null;
  recvTotal = 0;
  recvPages.clear();
  updateRecvStatus("");
}

function updateRecvStatus(text) {
  const el = document.getElementById("homeQrRecvStatus");
  if (el) el.textContent = text;
}

// 受信側に同名タグがある場合、衝突を避けるためサフィックス付きで一意化
// （A → A1 → A2 …）。元の名前と衝突しないだけでなく、当バッチで既に
// 採用済みの名前とも被らないようにする。
function uniqueTagName(name, existing) {
  if (!existing.includes(name)) return name;
  for (let i = 1; i < 10000; i++) {
    const cand = name + i;
    if (!existing.includes(cand)) return cand;
  }
  return name + Date.now().toString(36);
}

function applyRosterPayload(payload) {
  const { tagNames: senderTagNames, patients: roster } = decodeRoster(payload);
  if (roster.length === 0) {
    alert("取込内容が空でした。");
    return;
  }

  const isEmpty = appState.patients.every(p =>
    !String(p?.room || "").trim() &&
    !String(p?.name || "").trim() &&
    (!p?.tags || p.tags.length === 0)
  );

  if (isEmpty) {
    // reflect モード: 受信側はデフォルト状態。設定タグも丸ごと送信側のものに差し替え
    settings.tags = senderTagNames.slice();
    saveSettings();
    const resolveTag = (idx) => settings.tags[idx - 1] || null;

    while (appState.patients.length < roster.length) {
      const p = makeDefaultPatient();
      appState.patients.push(p);
    }
    for (let i = 0; i < roster.length; i++) {
      const p = appState.patients[i];
      const r = roster[i];
      p.room = r.room;
      p.name = r.name;
      p.tags = r.tagIdxs.map(resolveTag).filter(Boolean);
      if (p.pid) {
        recordOp({ type: "update", pid: p.pid, field: "room", value: p.room });
        recordOp({ type: "update", pid: p.pid, field: "name", value: p.name });
        recordOp({ type: "update", pid: p.pid, field: "tags", value: p.tags.slice() });
      }
    }
    finishDataChange();
    closeHomeQr();
    const msg = senderTagNames.length
      ? `${roster.length} 件の名簿と ${senderTagNames.length} 件のタグを反映しました。`
      : `${roster.length} 件の名簿を反映しました。`;
    alert(msg);
  } else {
    // append モード: 既存名簿には触れず、送信側タグを衝突回避しつつ追加。
    // patient の tag index は受信側の renamed 名にマップして当てる。
    const existing = (settings.tags || []).slice();
    const senderIdxToReceiverName = []; // 1-based; [0] unused
    senderIdxToReceiverName[0] = null;
    let tagsAdded = 0;
    let tagsRenamed = 0;
    for (let i = 0; i < senderTagNames.length; i++) {
      const name = senderTagNames[i];
      if (existing.includes(name)) {
        // 同名既存 → そのまま使う（追加もリネームも不要）
        senderIdxToReceiverName[i + 1] = name;
      } else {
        const unique = uniqueTagName(name, existing);
        existing.push(unique);
        settings.tags.push(unique);
        senderIdxToReceiverName[i + 1] = unique;
        tagsAdded++;
        if (unique !== name) tagsRenamed++;
      }
    }
    if (tagsAdded > 0) saveSettings();
    const resolveTag = (idx) => senderIdxToReceiverName[idx] || null;

    const added = [];
    for (const r of roster) {
      if (!r.room && !r.name && r.tagIdxs.length === 0) continue;
      const p = makeDefaultPatient();
      p.room = r.room;
      p.name = r.name;
      p.tags = r.tagIdxs.map(resolveTag).filter(Boolean);
      const atIdx = appState.patients.length;
      appState.patients.push(p);
      added.push(p);
      recordOp({ type: "add", at: atIdx, patient: { pid: p.pid, name: p.name, room: p.room, tags: p.tags.slice() } });
    }
    finishDataChange();
    closeHomeQr();
    const msgs = [`${added.length} 件を末尾に追加しました。`];
    if (tagsAdded) {
      msgs.push(tagsRenamed
        ? `新規タグ ${tagsAdded} 件を追加（うち ${tagsRenamed} 件は同名衝突のため A1/A2 形式に改名）`
        : `新規タグ ${tagsAdded} 件を追加しました。`);
    }
    alert(msgs.join("\n"));
  }
}

function startScan() {
  const session = scanQRStream({
    onScan: (text, ctrl) => {
      const decoded = decodePage(text);
      if (!decoded) {
        ctrl.setStatus("QR 形式が認識できません");
        return;
      }
      if (decoded.kind !== KIND) {
        ctrl.setStatus(`ホームQRではありません（kind=${decoded.kind}）`);
        return;
      }
      // 別バッチ ID 検出 → 静かにリセット（カメラ起動中の confirm は割込みになるので避ける）
      if (recvBatchId && recvBatchId !== decoded.batchId) {
        resetRecv();
        ctrl.setStatus("新しいバッチを検出。受信バッファをリセットしました");
      }
      if (!recvBatchId) {
        recvBatchId = decoded.batchId;
        recvTotal = decoded.totalPages;
      }
      // 重複ページ
      if (recvPages.has(decoded.pageNum)) {
        ctrl.setStatus(`重複: ${recvPages.size}/${recvTotal} 受信済`);
        return;
      }
      // 新規ページ
      recvPages.set(decoded.pageNum, decoded.content);
      try { navigator.vibrate?.(80); } catch (_) {}
      if (recvPages.size === recvTotal) {
        const full = [];
        for (let i = 1; i <= recvTotal; i++) full.push(recvPages.get(i));
        const payload = full.join("");
        resetRecv();
        ctrl.setStatus(`全 ${recvTotal} ページ受信完了`);
        // スキャナを閉じた後に apply（alert が前面に出るように間を置く）
        setTimeout(() => applyRosterPayload(payload), 100);
        return { stop: true };
      }
      ctrl.setStatus(`${recvPages.size}/${recvTotal} 受信`);
    },
    onCancel: () => {
      // ユーザがキャンセル → 途中バッファがあればホーム側に進捗を残す
      if (recvBatchId && recvPages.size > 0) {
        updateRecvStatus(`${recvPages.size}/${recvTotal} 受信中（続きを読み取ってください）`);
      } else {
        updateRecvStatus("");
      }
    },
  });
  if (!session) {
    alert("スキャナを開けませんでした。");
    return;
  }
}

// ============================
// Init
// ============================

export function initHomeQr() {
  const showBtn = document.getElementById("homeShowQrBtn");
  if (showBtn) showBtn.addEventListener("click", () => {
    if (isHomeQrActive()) closeHomeQr();
    else openHomeQr();
  });

  const prevBtn = document.getElementById("homeQrPrevBtn");
  const nextBtn = document.getElementById("homeQrNextBtn");
  if (prevBtn) prevBtn.addEventListener("click", () => {
    if (qrPageIndex > 0) { qrPageIndex--; renderQrPage(); }
  });
  if (nextBtn) nextBtn.addEventListener("click", () => {
    if (qrPageIndex < qrPages.length - 1) { qrPageIndex++; renderQrPage(); }
  });

  const scanBtn = document.getElementById("homeQrScanBtn");
  if (scanBtn) {
    if (!isScannerSupported()) {
      scanBtn.disabled = true;
      scanBtn.title = "このブラウザはカメラ非対応";
    }
    scanBtn.addEventListener("click", startScan);
  }
}
