"use strict";

import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { isAdminEnabled, isAdminTerminal, isAdminImportOnly, buildAdminPages, parseAdminText, applyAdminImport } from "./admin.js";

let _pages = [];
let _pageIndex = 0;
let _onApplied = null;
let _mode = "qr"; // "qr" | "paste"

export function setAdminAppliedHandler(fn) { _onApplied = fn; }

function drawCanvas(text) {
  const canvas = document.getElementById("adminQrCanvas");
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
    console.error("Admin QR draw failed", err);
  }
}

function renderPage() {
  const meta = document.getElementById("adminQrPageMeta");
  const preview = document.getElementById("adminQrTextPreview");
  const prevBtn = document.getElementById("adminQrPrevBtn");
  const nextBtn = document.getElementById("adminQrNextBtn");
  if (!_pages.length) {
    if (meta) meta.textContent = "";
    if (preview) preview.textContent = "（名簿データなし）";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }
  const i = Math.max(0, Math.min(_pageIndex, _pages.length - 1));
  _pageIndex = i;
  const text = _pages[i];
  const bytes = utf8ByteLength(text);
  if (meta) meta.textContent = `(${i + 1}/${_pages.length}) ${bytes} bytes`;
  if (prevBtn) prevBtn.disabled = (i === 0);
  if (nextBtn) nextBtn.disabled = (i === _pages.length - 1);
  if (preview) preview.textContent = text;
  drawCanvas(text);
}

function regenerate() {
  const memo = !!document.getElementById("adminIncludeMemo")?.checked;
  const shared = !!document.getElementById("adminIncludeShared")?.checked;
  _pages = buildAdminPages(memo, shared);
  _pageIndex = 0;
  renderPage();
}

function isPanelActive() {
  const wrap = document.getElementById("adminPanelWrap");
  return !!(wrap && wrap.classList.contains("active"));
}

export function isAdminPanelActive() { return isPanelActive(); }

export function closeAdminPanel() {
  const wrap = document.getElementById("adminPanelWrap");
  if (wrap) wrap.classList.remove("active");
}

function applyModeUI() {
  const qrBody = document.getElementById("adminPanelQrBody");
  const pasteBody = document.getElementById("adminPanelPasteBody");
  const qrBtn = document.getElementById("adminModeQrBtn");
  const pasteBtn = document.getElementById("adminModePasteBtn");
  const showQr = _mode === "qr";
  if (qrBody) qrBody.style.display = showQr ? "" : "none";
  if (pasteBody) pasteBody.style.display = showQr ? "none" : "";
  if (qrBtn) qrBtn.classList.toggle("selected", showQr);
  if (pasteBtn) pasteBtn.classList.toggle("selected", !showQr);
  if (showQr) regenerate();
}

function pickDefaultMode() {
  if (isAdminTerminal()) return "qr";
  return "paste";
}

export function toggleAdminPanel() {
  if (isPanelActive()) {
    closeAdminPanel();
    return;
  }
  if (!isAdminEnabled()) return;
  _mode = pickDefaultMode();
  const wrap = document.getElementById("adminPanelWrap");
  if (wrap) wrap.classList.add("active");
  applyModeUI();
  const status = document.getElementById("adminImportStatus");
  if (status) status.textContent = "";
}

export function refreshAdminAvailability() {
  const btn = document.getElementById("sharedAdminBtn");
  if (btn) btn.style.display = isAdminEnabled() ? "" : "none";
  if (!isAdminEnabled()) closeAdminPanel();
}

export function initAdminUI() {
  refreshAdminAvailability();

  const btn = document.getElementById("sharedAdminBtn");
  if (btn) btn.addEventListener("click", toggleAdminPanel);

  const qrModeBtn = document.getElementById("adminModeQrBtn");
  const pasteModeBtn = document.getElementById("adminModePasteBtn");
  if (qrModeBtn) qrModeBtn.addEventListener("click", () => { _mode = "qr"; applyModeUI(); });
  if (pasteModeBtn) pasteModeBtn.addEventListener("click", () => { _mode = "paste"; applyModeUI(); });

  const prev = document.getElementById("adminQrPrevBtn");
  const next = document.getElementById("adminQrNextBtn");
  if (prev) prev.addEventListener("click", () => { if (_pageIndex > 0) { _pageIndex--; renderPage(); } });
  if (next) next.addEventListener("click", () => { if (_pageIndex < _pages.length - 1) { _pageIndex++; renderPage(); } });

  const incMemo = document.getElementById("adminIncludeMemo");
  const incShared = document.getElementById("adminIncludeShared");
  if (incMemo) incMemo.addEventListener("change", regenerate);
  if (incShared) incShared.addEventListener("change", regenerate);

  const applyBtn = document.getElementById("adminImportApplyBtn");
  const clearBtn = document.getElementById("adminImportClearBtn");
  const area = document.getElementById("adminImportArea");
  const status = document.getElementById("adminImportStatus");

  if (clearBtn) clearBtn.addEventListener("click", () => {
    if (area) area.value = "";
    if (status) status.textContent = "";
  });

  if (applyBtn) applyBtn.addEventListener("click", () => {
    const text = area ? area.value : "";
    const parsed = parseAdminText(text);
    if (!parsed.ok) {
      if (status) status.textContent = "エラー: " + parsed.error;
      return;
    }
    const data = parsed.data;
    const msg = `取込内容を反映します:\n- タグ: ${data.tags.length} 件\n- O項目: ${data.oRules.length} 件\n- 患者: ${data.patients.length} 件\n\nよろしいですか？`;
    if (!confirm(msg)) return;
    applyAdminImport(data);
    if (area) area.value = "";
    if (status) status.textContent = "取込完了。";
    closeAdminPanel();
    if (_onApplied) _onApplied();
  });
}
