"use strict";

import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { settings, rosterState } from "../store.js";
import {
  isAdminEnabled, isAdminTerminal,
  buildCopyPages, buildDiffPages,
  parseRosterPages, decodeRosterPayload, applyFullPayload, applyDiffPayload,
} from "./admin.js";
import { flushCommit } from "./roster.js";
import { t } from "../i18n.js";

let _pages = [];
let _pageIndex = 0;
let _mode = "qr-diff"; // "qr-full" | "qr-diff" | "paste"
let _onApplied = null;
let _qrSource = ""; // "full" or "diff" - which is currently rendered

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
    if (preview) preview.textContent = t("admin.preview.placeholder");
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    const canvas = document.getElementById("adminQrCanvas");
    if (canvas) { canvas.width = 1; canvas.height = 1; canvas.style.width = "0"; }
    return;
  }
  const i = Math.max(0, Math.min(_pageIndex, _pages.length - 1));
  _pageIndex = i;
  const text = _pages[i];
  const bytes = utf8ByteLength(text);
  const label = _qrSource === "full" ? "FULL" : "DIFF";
  if (meta) meta.textContent = `[${label}] (${i + 1}/${_pages.length}) ${bytes} bytes`;
  if (prevBtn) prevBtn.disabled = (i === 0);
  if (nextBtn) nextBtn.disabled = (i === _pages.length - 1);
  if (preview) preview.textContent = text;
  drawCanvas(text);
}

async function regenerate() {
  const status = document.getElementById("adminQrStatus");
  if (status) status.textContent = "";
  try {
    if (_mode === "qr-full") {
      const phrase = settings.rosterPassphrase || "";
      if (!phrase) {
        _pages = [];
        if (status) status.textContent = t("admin.status.passphraseRequired");
        renderPage();
        return;
      }
      flushCommit();
      const r = await buildCopyPages(phrase);
      _pages = r.pages;
      _qrSource = "full";
    } else if (_mode === "qr-diff") {
      flushCommit();
      const r = await buildDiffPages();
      _pages = r.pages;
      _qrSource = "diff";
      if (status) status.textContent = t("admin.status.diff.window", { count: r.count });
    }
    _pageIndex = 0;
    renderPage();
  } catch (e) {
    if (status) status.textContent = t("admin.status.error", { message: e.message || e });
  }
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
  const fullBtn = document.getElementById("adminModeFullBtn");
  const diffBtn = document.getElementById("adminModeDiffBtn");
  const pasteBtn = document.getElementById("adminModePasteBtn");
  const showQr = _mode === "qr-full" || _mode === "qr-diff";
  if (qrBody) qrBody.style.display = showQr ? "" : "none";
  if (pasteBody) pasteBody.style.display = showQr ? "none" : "";
  if (fullBtn) fullBtn.classList.toggle("selected", _mode === "qr-full");
  if (diffBtn) diffBtn.classList.toggle("selected", _mode === "qr-diff");
  if (pasteBtn) pasteBtn.classList.toggle("selected", _mode === "paste");
  if (showQr) regenerate();
}

function pickDefaultMode() {
  // 管理端末: 配布/出力 (差分 QR) がデフォルト
  // 被管理端末: 取込 (paste) がデフォルト
  return isAdminTerminal() ? "qr-diff" : "paste";
}

export function toggleAdminPanel() {
  if (isPanelActive()) { closeAdminPanel(); return; }
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

async function handleImport() {
  const area = document.getElementById("adminImportArea");
  const status = document.getElementById("adminImportStatus");
  const text = area ? area.value : "";
  const parsed = parseRosterPages(text);
  if (!parsed.ok) { if (status) status.textContent = t("admin.status.error", { message: parsed.error }); return; }

  let secret;
  if (parsed.kind === "DIFF") {
    // Diffs are encrypted with the local roster's authentication code (rosterId)
    secret = rosterState?.rosterId || "";
    if (!secret) {
      if (status) status.textContent = t("admin.status.localMissing");
      return;
    }
  } else {
    // COPY (FULL) needs the 合言葉
    const phrase = prompt(t("admin.passphrase.prompt.import"));
    if (!phrase) { if (status) status.textContent = t("admin.status.canceled"); return; }
    secret = phrase;
  }

  const decoded = await decodeRosterPayload(parsed, secret);
  if (!decoded.ok) { if (status) status.textContent = t("admin.status.error", { message: decoded.error }); return; }
  const body = decoded.body;

  if (body.kind === "full") {
    const msg = t("admin.confirm.copyImport", {
      patients: body.base?.patients?.length || 0,
      tags: body.base?.tags?.length || 0,
    });
    if (!confirm(msg)) return;
    applyFullPayload(body);
    // Inherit the sender's 合言葉 so this receiver can also produce copies later if needed
    if (!settings.rosterPassphrase) {
      settings.rosterPassphrase = secret;
    }
    if (status) status.textContent = t("admin.status.copyDone");
    closeAdminPanel();
    if (_onApplied) _onApplied();
  } else if (body.kind === "diff") {
    const result = applyDiffPayload(body);
    if (!result.ok) { if (status) status.textContent = t("admin.status.error", { message: result.error }); return; }
    if (status) status.textContent = t("admin.status.diffDone", { applied: result.applied });
    closeAdminPanel();
    if (_onApplied) _onApplied();
  } else {
    if (status) status.textContent = t("admin.status.unknownKind", { kind: body.kind });
  }
}

export function initAdminUI() {
  refreshAdminAvailability();

  const btn = document.getElementById("sharedAdminBtn");
  if (btn) btn.addEventListener("click", toggleAdminPanel);

  const fullBtn = document.getElementById("adminModeFullBtn");
  const diffBtn = document.getElementById("adminModeDiffBtn");
  const pasteBtn = document.getElementById("adminModePasteBtn");
  if (fullBtn) fullBtn.addEventListener("click", () => { _mode = "qr-full"; applyModeUI(); });
  if (diffBtn) diffBtn.addEventListener("click", () => { _mode = "qr-diff"; applyModeUI(); });
  if (pasteBtn) pasteBtn.addEventListener("click", () => { _mode = "paste"; applyModeUI(); });

  const prev = document.getElementById("adminQrPrevBtn");
  const next = document.getElementById("adminQrNextBtn");
  if (prev) prev.addEventListener("click", () => { if (_pageIndex > 0) { _pageIndex--; renderPage(); } });
  if (next) next.addEventListener("click", () => { if (_pageIndex < _pages.length - 1) { _pageIndex++; renderPage(); } });

  const applyBtn = document.getElementById("adminImportApplyBtn");
  const clearBtn = document.getElementById("adminImportClearBtn");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    const area = document.getElementById("adminImportArea");
    const status = document.getElementById("adminImportStatus");
    if (area) area.value = "";
    if (status) status.textContent = "";
  });
  if (applyBtn) applyBtn.addEventListener("click", handleImport);
}
