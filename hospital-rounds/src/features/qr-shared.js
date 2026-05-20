"use strict";

import { appState } from "../store.js";
import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { patientMatchesSharedFilter } from "./tags.js";
import { scanQR, isScannerSupported } from "./qr-scan.js";

// ============================
// Shared QR state
//
// The patients included in the QR are derived directly from the shared list's
// tag filter (single source of truth): every patient that matches the filter
// AND has non-empty shared text is included. There is no per-patient override
// — adjusting the filter is the way to add or remove patients.
// ============================

let sharedQrPages = [];
let sharedQrPageIndex = 0;

const MAX_BYTES = 800;

// 共有QR・受信メモなどで使う共通タイムスタンプ。
// 形式は JSON 保存のファイル名・共有QRのヘッダーと同じ:
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

function buildPages() {
  const items = [];
  for (let i = 0; i < appState.patients.length; i++) {
    const p = appState.patients[i];
    if (!patientMatchesSharedFilter(p)) continue;
    const text = String(p.shared ?? "").trim();
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

function drawSharedQrCanvas(text, ecl) {
  const canvas = document.getElementById("sharedQrCanvas");
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
    console.error("Shared QR generation failed", err);
    const ctx = canvas.getContext("2d");
    canvas.width = 600; canvas.height = 200;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 600, 200);
    ctx.fillStyle = "#b91c1c"; ctx.font = "14px sans-serif";
    ctx.fillText("QR生成に失敗しました", 16, 32);
  }
}

function renderQrPage() {
  const ecl = qrcodegen.QrCode.Ecc.LOW;
  const meta = document.getElementById("sharedQrPageMeta");
  const prevBtn = document.getElementById("sharedQrPrevBtn");
  const nextBtn = document.getElementById("sharedQrNextBtn");
  const preview = document.getElementById("sharedQrTextPreview");
  const canvas = document.getElementById("sharedQrCanvas");

  if (!sharedQrPages || sharedQrPages.length === 0) {
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

  const i = Math.max(0, Math.min(sharedQrPageIndex, sharedQrPages.length - 1));
  sharedQrPageIndex = i;
  const total = sharedQrPages.length;
  const text = sharedQrPages[i];
  const bytes = utf8ByteLength(text);
  if (meta) meta.textContent = `(${i + 1}/${total}) ${bytes} bytes`;
  if (prevBtn) prevBtn.disabled = (i === 0);
  if (nextBtn) nextBtn.disabled = (i === total - 1);
  if (preview) preview.textContent = text;
  drawSharedQrCanvas(text, ecl);
}

function regenerateAndRender() {
  sharedQrPages = buildPages();
  sharedQrPageIndex = 0;
  renderQrPage();
}

function openSharedQr() {
  const wrap = document.getElementById("sharedQrWrap");
  if (!wrap) return;
  wrap.classList.add("active");
  regenerateAndRender();
}

function closeSharedQr() {
  const wrap = document.getElementById("sharedQrWrap");
  if (!wrap) return;
  wrap.classList.remove("active");
}

export function isSharedQrActive() {
  const wrap = document.getElementById("sharedQrWrap");
  return !!(wrap && wrap.classList.contains("active"));
}

export function refreshSharedQrIfActive() {
  if (!isSharedQrActive()) return;
  regenerateAndRender();
}

// ============================
// Init
// ============================

// Open the paste card and append the scanned text to its textarea, then fire
// the input event so any subscribers see the new value. Used by both the
// QR-card scan shortcut and the paste-card camera button.
function deliverScannedText(text) {
  const pasteCard = document.getElementById("sharedPasteCard");
  const area = document.getElementById("sharedPasteArea");
  if (pasteCard) pasteCard.classList.add("active");
  if (!area) return;
  const cur = area.value || "";
  const sep = cur && !cur.endsWith("\n") ? "\n" : "";
  area.value = cur + sep + text;
  area.dispatchEvent(new Event("input", { bubbles: true }));
  setTimeout(() => area.focus(), 50);
}

export function initSharedQr() {
  const sharedShowQrBtn = document.getElementById("sharedShowQrBtn");
  if (sharedShowQrBtn) {
    sharedShowQrBtn.addEventListener("click", () => {
      if (isSharedQrActive()) {
        closeSharedQr();
      } else {
        openSharedQr();
      }
    });
  }

  const sharedQrPrevBtn = document.getElementById("sharedQrPrevBtn");
  const sharedQrNextBtn = document.getElementById("sharedQrNextBtn");
  if (sharedQrPrevBtn) sharedQrPrevBtn.addEventListener("click", () => {
    if (sharedQrPageIndex > 0) { sharedQrPageIndex--; renderQrPage(); }
  });
  if (sharedQrNextBtn) sharedQrNextBtn.addEventListener("click", () => {
    if (sharedQrPageIndex < sharedQrPages.length - 1) { sharedQrPageIndex++; renderQrPage(); }
  });

  // Camera shortcut sitting on the QR display card. Tapping it launches the
  // scanner; on a successful read we close the QR view and pop open the
  // 受信メモ card with the scanned text inserted.
  const sharedQrScanBtn = document.getElementById("sharedQrScanBtn");
  if (sharedQrScanBtn) {
    if (!isScannerSupported()) {
      sharedQrScanBtn.disabled = true;
      sharedQrScanBtn.title = "このブラウザはカメラ非対応";
    }
    sharedQrScanBtn.addEventListener("click", async () => {
      const text = await scanQR();
      if (text == null) return;
      closeSharedQr();
      deliverScannedText(text);
    });
  }
}
