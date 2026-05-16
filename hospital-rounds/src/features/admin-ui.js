"use strict";

import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { isAdminEnabled, isAdminTerminal, isNonAdminTerminal, buildAdminPages, parseAdminText, applyAdminImport } from "./admin.js";

let _pages = [];
let _pageIndex = 0;
let _onApplied = null;

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

function isQrCardActive() {
  const wrap = document.getElementById("adminQrWrap");
  return !!(wrap && wrap.classList.contains("active"));
}

function isImportCardActive() {
  const wrap = document.getElementById("adminImportWrap");
  return !!(wrap && wrap.classList.contains("active"));
}

export function isAdminPanelActive() {
  return isQrCardActive() || isImportCardActive();
}

export function closeAdminPanel() {
  const qr = document.getElementById("adminQrWrap");
  const imp = document.getElementById("adminImportWrap");
  if (qr) qr.classList.remove("active");
  if (imp) imp.classList.remove("active");
}

function openForAdminTerminal() {
  const qr = document.getElementById("adminQrWrap");
  if (!qr) return;
  qr.classList.add("active");
  regenerate();
}

function openForNonAdmin() {
  const imp = document.getElementById("adminImportWrap");
  if (!imp) return;
  imp.classList.add("active");
  const status = document.getElementById("adminImportStatus");
  if (status) status.textContent = "";
}

export function toggleAdminPanel() {
  if (isAdminPanelActive()) {
    closeAdminPanel();
    return;
  }
  if (!isAdminEnabled()) return;
  if (isAdminTerminal()) openForAdminTerminal();
  else openForNonAdmin();
}

export function refreshAdminAvailability() {
  // Show/hide the shared-screen admin icon based on adminEnabled
  const btn = document.getElementById("sharedAdminBtn");
  if (btn) btn.style.display = isAdminEnabled() ? "" : "none";
  if (!isAdminEnabled()) closeAdminPanel();
}

export function initAdminUI() {
  refreshAdminAvailability();

  const btn = document.getElementById("sharedAdminBtn");
  if (btn) btn.addEventListener("click", toggleAdminPanel);

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
