"use strict";

import { appState } from "../store.js";
import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { showView } from "./navigation.js";

// ============================
// Shared QR display
// ============================

let sharedQrPages = [];
let sharedQrPageIndex = 0;

function renderSharedQrPage(ecl) {
  const canvas = document.getElementById("sharedQrCanvas");
  const meta = document.getElementById("sharedQrPageMeta");
  const prevBtn = document.getElementById("sharedQrPrevBtn");
  const nextBtn = document.getElementById("sharedQrNextBtn");

  if (!sharedQrPages || sharedQrPages.length === 0) return;
  const i = sharedQrPageIndex;
  const total = sharedQrPages.length;
  if (meta) meta.textContent = `ページ ${i + 1} / ${total}`;
  if (prevBtn) prevBtn.disabled = (i === 0);
  if (nextBtn) nextBtn.disabled = (i === total - 1);

  const text = sharedQrPages[i];
  try {
    const qr = qrcodegen.QrCode.encodeText(text, ecl);
    const border = 4;
    const totalModules = qr.size + border * 2;
    const scale = Math.max(6, Math.ceil(300 / totalModules));
    const size = totalModules * scale;
    if (canvas) {
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#000000";
      for (let y = 0; y < qr.size; y++) {
        for (let x = 0; x < qr.size; x++) {
          if (qr.getModule(x, y)) {
            ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
          }
        }
      }
    }
  } catch (err) {
    console.error("Shared QR generation failed", err);
  }
}

// ============================
// Docs QR (説明書リンク)
// ============================

function renderDocsQrCanvas() {
  const canvas = document.getElementById("docsQrCanvas");
  if (!canvas) return;
  const ecl = qrcodegen.QrCode.Ecc.LOW;
  const url = "https://snishi-code.com/docs/hospital-rounds/";
  try {
    const qr = qrcodegen.QrCode.encodeText(url, ecl);
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
    console.error("Docs QR generation failed", err);
  }
}

export function showDocsQr() {
  const wrap = document.getElementById("docsQrWrap");
  if (!wrap) return;
  wrap.classList.add("active");
  renderDocsQrCanvas();
}

export function initDocsQr() {
  const btn = document.getElementById("settingsHelpBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const wrap = document.getElementById("docsQrWrap");
    if (!wrap) return;
    const active = wrap.classList.toggle("active");
    if (active) renderDocsQrCanvas();
  });
}

export function initSharedQr() {
  const ecl = qrcodegen.QrCode.Ecc.LOW;

  const sharedShowQrBtn = document.getElementById("sharedShowQrBtn");
  if (sharedShowQrBtn) {
    sharedShowQrBtn.addEventListener("click", () => {
      const d = new Date();
      const titleSafe = (appState.title || "回診管理").replace(/[\\/:*?"<>|]/g, "_");
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      const header = `${titleSafe}_${yyyy}_${mm}${dd}_${hh}${min}`;

      const MAX_BYTES = 800;
      const items = [];
      for (let i = 0; i < appState.patients.length; i++) {
        const p = appState.patients[i];
        if (!p.shared || !p.shared.trim()) continue;
        const label = (p.name && p.name.trim()) ? p.name.trim() : String(i + 1);
        items.push({ label, text: p.shared.trim() });
      }

      if (items.length === 0) {
        alert("共有データがありません。");
        return;
      }

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
      sharedQrPages = chunks.map((chunkItems, idx) => {
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

      sharedQrPageIndex = 0;
      showView("sharedQr");
      renderSharedQrPage(ecl);
    });
  }

  const sharedQrPrevBtn = document.getElementById("sharedQrPrevBtn");
  const sharedQrNextBtn = document.getElementById("sharedQrNextBtn");
  const sharedQrCloseBtn = document.getElementById("sharedQrCloseBtn");

  if (sharedQrPrevBtn) sharedQrPrevBtn.addEventListener("click", () => {
    if (sharedQrPageIndex > 0) { sharedQrPageIndex--; renderSharedQrPage(ecl); }
  });
  if (sharedQrNextBtn) sharedQrNextBtn.addEventListener("click", () => {
    if (sharedQrPageIndex < sharedQrPages.length - 1) { sharedQrPageIndex++; renderSharedQrPage(ecl); }
  });
  if (sharedQrCloseBtn) sharedQrCloseBtn.addEventListener("click", () => {
    showView("shared");
  });
}
