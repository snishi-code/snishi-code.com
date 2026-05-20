"use strict";

import { appState } from "../store.js";
import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { patientMatchesSharedFilter } from "./tags.js";
import { scanQR, isScannerSupported } from "./qr-scan.js";

// ============================
// QR flow factory
//
// 共有画面・メモ画面の双方が「QRボタン → QRカード表示（カメラ付き）→
// スキャン → 受信メモカードが内容入りで自動展開」という同じ二段フローを使う。
// 違いは対象フィールド (p.shared / p.memo) と DOM ID のプレフィックスだけ
// なので、createQrFlow で共通化してインスタンスを2つ生成する。
//
// 対象患者はタグフィルター（共有/メモ画面共通の patientMatchesSharedFilter）
// と「対象フィールドが空でない」の AND で決まる。
// ============================

const MAX_BYTES = 800;

// 共有QR・メモQR・JSON 保存のファイル名で使う共通タイムスタンプ。
//   ${title}_YYYY_MMDD_HHMM
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

function createQrFlow(cfg) {
  let pages = [];
  let pageIndex = 0;

  function buildPages() {
    const items = [];
    for (let i = 0; i < appState.patients.length; i++) {
      const p = appState.patients[i];
      if (!cfg.matchesFilter(p)) continue;
      const text = String(p?.[cfg.fieldName] ?? "").trim();
      if (!text) continue;
      const label = (p.name && p.name.trim()) ? p.name.trim() : String(i + 1);
      items.push({ label, text });
    }
    if (items.length === 0) return [];

    const header = buildTimestampHeader();
    const chunks = [];
    let currentItems = [];
    let currentBytes = 0;
    for (const item of items) {
      const entry = `【${item.label}】\n${item.text}\n\n`;
      const entryBytes = utf8ByteLength(entry);
      if (currentItems.length > 0 && currentBytes + entryBytes > MAX_BYTES) {
        chunks.push(currentItems);
        currentItems = [];
        currentBytes = 0;
      }
      currentItems.push(item);
      currentBytes += entryBytes;
    }
    if (currentItems.length > 0) chunks.push(currentItems);

    const total = chunks.length;
    return chunks.map((chunkItems, idx) => {
      const pageNum = idx + 1;
      const sep = "――";
      let text = total > 1 ? `${sep}（${pageNum}/${total}）` : sep;
      text += "\n\n";
      if (pageNum === 1) text += header + "\n";
      for (const item of chunkItems) {
        text += `【${item.label}】\n${item.text}\n\n`;
      }
      text += sep;
      return text;
    });
  }

  function drawQrCanvas(text, ecl) {
    const canvas = document.getElementById(cfg.canvasId);
    if (!canvas) return;
    try {
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
      const ctx = canvas.getContext("2d");
      canvas.width = 600; canvas.height = 200;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 600, 200);
      ctx.fillStyle = "#b91c1c"; ctx.font = "14px sans-serif";
      ctx.fillText("QR生成に失敗しました", 16, 32);
    }
  }

  function renderQrPage() {
    const ecl = qrcodegen.QrCode.Ecc.LOW;
    const meta = document.getElementById(cfg.pageMetaId);
    const prevBtn = document.getElementById(cfg.prevBtnId);
    const nextBtn = document.getElementById(cfg.nextBtnId);
    const preview = document.getElementById(cfg.previewId);
    const canvas = document.getElementById(cfg.canvasId);

    if (!pages || pages.length === 0) {
      if (meta) meta.textContent = "";
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      if (preview) preview.textContent = "（対象の患者がいません）";
      if (canvas) {
        const ctx = canvas.getContext("2d");
        canvas.width = 1; canvas.height = 1;
        canvas.style.width = "0";
      }
      return;
    }

    const i = Math.max(0, Math.min(pageIndex, pages.length - 1));
    pageIndex = i;
    const total = pages.length;
    const text = pages[i];
    const bytes = utf8ByteLength(text);
    if (meta) meta.textContent = `(${i + 1}/${total}) ${bytes} bytes`;
    if (prevBtn) prevBtn.disabled = (i === 0);
    if (nextBtn) nextBtn.disabled = (i === total - 1);
    if (preview) preview.textContent = text;
    drawQrCanvas(text, ecl);
  }

  function regenerateAndRender() {
    pages = buildPages();
    pageIndex = 0;
    renderQrPage();
  }

  function open() {
    const wrap = document.getElementById(cfg.wrapId);
    if (!wrap) return;
    wrap.classList.add("active");
    regenerateAndRender();
  }

  function close() {
    const wrap = document.getElementById(cfg.wrapId);
    if (!wrap) return;
    wrap.classList.remove("active");
  }

  function isActive() {
    const wrap = document.getElementById(cfg.wrapId);
    return !!(wrap && wrap.classList.contains("active"));
  }

  function refresh() {
    if (!isActive()) return;
    regenerateAndRender();
  }

  // 受信メモカードを開いてスキャン結果を入れる。cfg.replaceOnDeliver が真なら
  // 上書き（メモ画面：直前のスキャン結果のみを表示）、偽なら追記（共有画面：
  // カード内カメラで複数枚を読み続けられる）。
  function deliverScannedText(text) {
    const pasteCard = document.getElementById(cfg.pasteCardId);
    const area = document.getElementById(cfg.pasteAreaId);
    if (pasteCard) pasteCard.classList.add("active");
    if (!area) return;
    if (cfg.replaceOnDeliver) {
      area.value = text;
    } else {
      const cur = area.value || "";
      const sep = cur && !cur.endsWith("\n") ? "\n" : "";
      area.value = cur + sep + text;
    }
    area.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => area.focus(), 50);
  }

  function init() {
    const showBtn = document.getElementById(cfg.showBtnId);
    if (showBtn) {
      showBtn.addEventListener("click", () => {
        if (isActive()) close();
        else open();
      });
    }

    const prevBtn = document.getElementById(cfg.prevBtnId);
    const nextBtn = document.getElementById(cfg.nextBtnId);
    if (prevBtn) prevBtn.addEventListener("click", () => {
      if (pageIndex > 0) { pageIndex--; renderQrPage(); }
    });
    if (nextBtn) nextBtn.addEventListener("click", () => {
      if (pageIndex < pages.length - 1) { pageIndex++; renderQrPage(); }
    });

    // QR カード内のカメラショートカット。スキャン成功で QR を閉じて
    // 受信メモカードを内容入りで開く。
    const scanBtn = document.getElementById(cfg.scanBtnId);
    if (scanBtn) {
      if (!isScannerSupported()) {
        scanBtn.disabled = true;
        scanBtn.title = "このブラウザはカメラ非対応";
      }
      scanBtn.addEventListener("click", async () => {
        const text = await scanQR();
        if (text == null) return;
        close();
        deliverScannedText(text);
      });
    }
  }

  return { init, isActive, refresh };
}

// ============================
// Instances
// ============================

const sharedFlow = createQrFlow({
  fieldName: "shared",
  matchesFilter: patientMatchesSharedFilter,
  wrapId: "sharedQrWrap",
  canvasId: "sharedQrCanvas",
  pageMetaId: "sharedQrPageMeta",
  prevBtnId: "sharedQrPrevBtn",
  nextBtnId: "sharedQrNextBtn",
  previewId: "sharedQrTextPreview",
  showBtnId: "sharedShowQrBtn",
  scanBtnId: "sharedQrScanBtn",
  pasteCardId: "sharedPasteCard",
  pasteAreaId: "sharedPasteArea",
  replaceOnDeliver: false,
});

const memoFlow = createQrFlow({
  fieldName: "memo",
  matchesFilter: patientMatchesSharedFilter,
  wrapId: "memoQrWrap",
  canvasId: "memoQrCanvas",
  pageMetaId: "memoQrPageMeta",
  prevBtnId: "memoQrPrevBtn",
  nextBtnId: "memoQrNextBtn",
  previewId: "memoQrTextPreview",
  showBtnId: "memoShowQrBtn",
  scanBtnId: "memoQrScanBtn",
  pasteCardId: "memoPasteCard",
  pasteAreaId: "memoPasteArea",
  // メモ画面の受信欄はカード内カメラを持たないので、複数枚スキャンの累積は
  // 想定しない。直前のスキャン結果だけを見せる方が UX として明快。
  replaceOnDeliver: true,
});

export const initSharedQr = () => sharedFlow.init();
export const isSharedQrActive = () => sharedFlow.isActive();
export const refreshSharedQrIfActive = () => sharedFlow.refresh();

export const initMemoQr = () => memoFlow.init();
export const isMemoQrActive = () => memoFlow.isActive();
export const refreshMemoQrIfActive = () => memoFlow.refresh();
