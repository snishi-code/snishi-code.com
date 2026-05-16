"use strict";

import { appState, settings } from "../store.js";
import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { isDoctorEnabled, getDoctors } from "./doctor.js";
import { statusClass } from "../views/home.js";

// ============================
// Shared QR state
// ============================

let sharedQrPages = [];
let sharedQrPageIndex = 0;
let sharedQrSelected = new Set();
let sharedQrDoctorFilter = "";

const MAX_BYTES = 800;

function buildHeader() {
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
    if (!sharedQrSelected.has(i + 1)) continue;
    const p = appState.patients[i];
    const text = String(p.shared ?? "").trim();
    if (!text) continue;
    const label = (p.name && p.name.trim()) ? p.name.trim() : String(i + 1);
    items.push({ label, text });
  }
  if (items.length === 0) return [];

  const header = buildHeader();
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
    if (preview) preview.textContent = "（選択されている患者がいません）";
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

function renderPatientGrid() {
  const host = document.getElementById("sharedQrPatientGrid");
  if (!host) return;
  host.textContent = "";
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= appState.patients.length; i++) {
    const p = appState.patients[i - 1];
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "patientBtn " + statusClass(p.status);
    if (!sharedQrSelected.has(i)) btn.classList.add("unselected");
    const displayName = p?.name ? p.name : String(i);
    btn.textContent = displayName;
    btn.setAttribute("aria-label", displayName);
    btn.addEventListener("click", () => {
      if (sharedQrSelected.has(i)) sharedQrSelected.delete(i);
      else sharedQrSelected.add(i);
      regenerateAndRender();
      renderPatientGrid();
    });
    frag.appendChild(btn);
  }
  host.appendChild(frag);
}

function selectDefault() {
  sharedQrSelected = new Set();
  for (let i = 0; i < appState.patients.length; i++) {
    const p = appState.patients[i];
    if (p.shared && p.shared.trim()) sharedQrSelected.add(i + 1);
  }
}

function applyDoctorFilter(doctor) {
  sharedQrDoctorFilter = doctor || "";
  if (!sharedQrDoctorFilter) {
    selectDefault();
    return;
  }
  sharedQrSelected = new Set();
  for (let i = 0; i < appState.patients.length; i++) {
    const p = appState.patients[i];
    if (p.doctor === sharedQrDoctorFilter) sharedQrSelected.add(i + 1);
  }
}

function regenerateAndRender() {
  sharedQrPages = buildPages();
  sharedQrPageIndex = 0;
  renderQrPage();
}

function populateDoctorOptions() {
  const filterWrap = document.getElementById("sharedQrDoctorFilter");
  const sel = document.getElementById("sharedQrDoctorSelect");
  if (!filterWrap || !sel) return;
  const enabled = isDoctorEnabled();
  filterWrap.style.display = enabled ? "" : "none";
  if (!enabled) return;
  sel.textContent = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "—（全員）";
  sel.appendChild(blank);
  for (const d of getDoctors()) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    sel.appendChild(opt);
  }
  sel.value = sharedQrDoctorFilter || "";
}

function openSharedQr() {
  const wrap = document.getElementById("sharedQrWrap");
  if (!wrap) return;
  selectDefault();
  sharedQrDoctorFilter = "";
  populateDoctorOptions();
  wrap.classList.add("active");
  renderPatientGrid();
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
  populateDoctorOptions();
  renderPatientGrid();
  regenerateAndRender();
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

export function renderDocsQr() {
  renderDocsQrCanvas();
}

export function initDocsQr() {}

// ============================
// Init
// ============================

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

  const sel = document.getElementById("sharedQrDoctorSelect");
  if (sel) sel.addEventListener("change", () => {
    applyDoctorFilter(sel.value);
    renderPatientGrid();
    regenerateAndRender();
  });
}
