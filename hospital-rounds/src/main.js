"use strict";

import "./style.css";

import { STORAGE_KEY, STATUS } from "./constants.js";
import {
  appState, settings, selectedNo,
  setAppState, setSelectedNo,
  load, saveNow, scheduleSave, saveSettings,
  normalizeLoaded, ensurePatientsHaveAllOKeys, makeEmptyOByRules,
} from "./store.js";

import { renderHome, updateCountChip } from "./views/home.js";
import { renderDetail, renderQrIfNeeded, initDetailEvents, initStatusButtons, initQrNavButtons } from "./views/detail.js";
import { renderMemoScreen, setMemoEditMode, getMemoEditMode } from "./views/memo.js";
import { renderSharedScreen, setSharedEditMode, getSharedEditMode } from "./views/shared-list.js";
import { renderOverviewScreen } from "./views/overview.js";
import { renderSettings, initSettingsView } from "./views/settings-view.js";

import { showView, syncDetailMemoDisplay, lastMemoNo, lastSharedNo } from "./features/navigation.js";
import { setDataChangeHandler, initActionMenu } from "./features/drag.js";
import { initImportExport } from "./features/import-export.js";
import { initSharedQr, initDocsQr, renderDocsQr } from "./features/qr-shared.js";

// ============================
// Wrappers that capture current context
// ============================

function doRenderHome() {
  renderHome((i) => {
    setSelectedNo(i);
    doRenderDetail();
    showView("detail");
  });
}

function doRenderDetail() {
  renderDetail(syncDetailMemoDisplay);
}

const PENCIL_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
const CHECK_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

function updateMemoEditBtn() {
  const btn = document.getElementById("memoEditBtn");
  if (!btn) return;
  const active = getMemoEditMode();
  btn.innerHTML = active ? CHECK_SVG : PENCIL_SVG;
  btn.classList.toggle("editActive", active);
  btn.title = btn.setAttribute("aria-label", active ? "完了" : "編集");
  btn.title = active ? "完了" : "編集";
}

function updateSharedEditBtn() {
  const btn = document.getElementById("sharedEditBtn");
  if (!btn) return;
  const active = getSharedEditMode();
  btn.innerHTML = active ? CHECK_SVG : PENCIL_SVG;
  btn.classList.toggle("editActive", active);
  btn.setAttribute("aria-label", active ? "完了" : "編集");
  btn.title = active ? "完了" : "編集";
}

function navigateToPatient(i) {
  setMemoEditMode(false);
  setSharedEditMode(false);
  updateMemoEditBtn();
  updateSharedEditBtn();
  setSelectedNo(i);
  doRenderDetail();
  showView("detail");
}

function doRenderMemo(opts) {
  renderMemoScreen(doRenderHome, opts, navigateToPatient);
}

function doRenderShared(opts) {
  renderSharedScreen(doRenderHome, opts, navigateToPatient);
}

// ============================
// finishDataChange handler
// ============================

setDataChangeHandler(() => {
  const viewId = document.querySelector(".view.active")?.id;
  if (viewId === "homeView") doRenderHome();
  else if (viewId === "memoView") doRenderMemo();
  else if (viewId === "sharedView") doRenderShared();
  updateCountChip();
});

// ============================
// Settings wiring
// ============================

initSettingsView(doRenderDetail, renderQrIfNeeded);

// ============================
// Detail event bindings
// ============================

initDetailEvents(doRenderHome, syncDetailMemoDisplay);
initStatusButtons(doRenderHome);
initQrNavButtons();

// ============================
// Navigation button handlers
// ============================

history.replaceState({ view: "home" }, "", "");

window.addEventListener("popstate", (e) => {
  if (e.state && e.state.view) showView(e.state.view, false);
  else showView("home", false);
});

function navToMemo() {
  setSharedEditMode(false);
  updateSharedEditBtn();
  doRenderMemo();
  showView("memo");
}
function navToShared() {
  setMemoEditMode(false);
  updateMemoEditBtn();
  doRenderShared();
  showView("shared");
}
function navToHome() {
  setMemoEditMode(false);
  setSharedEditMode(false);
  updateMemoEditBtn();
  updateSharedEditBtn();
  saveSettings();
  ensurePatientsHaveAllOKeys();
  doRenderHome();
  showView("home");
}

const headerMemoBtn = document.getElementById("headerMemoBtn");
const headerSharedBtn = document.getElementById("headerSharedBtn");
const headerHomeBtn = document.getElementById("headerHomeBtn");
const headerSettingsBtn = document.getElementById("headerSettingsBtn");
const headerHelpBtn = document.getElementById("headerHelpBtn");

function navToSettings() {
  setMemoEditMode(false);
  setSharedEditMode(false);
  updateMemoEditBtn();
  updateSharedEditBtn();
  renderSettings();
  showView("settings");
}

if (headerMemoBtn) headerMemoBtn.addEventListener("click", navToMemo);
if (headerSharedBtn) headerSharedBtn.addEventListener("click", navToShared);
if (headerHomeBtn) headerHomeBtn.addEventListener("click", navToHome);
if (headerSettingsBtn) headerSettingsBtn.addEventListener("click", navToSettings);
if (headerHelpBtn) headerHelpBtn.addEventListener("click", () => {
  showView("docsQr");
  renderDocsQr();
});

const docsQrCloseBtn = document.getElementById("docsQrCloseBtn");
if (docsQrCloseBtn) docsQrCloseBtn.addEventListener("click", navToHome);

const memoEditBtn = document.getElementById("memoEditBtn");
if (memoEditBtn) memoEditBtn.addEventListener("click", () => {
  setMemoEditMode(!getMemoEditMode());
  updateMemoEditBtn();
  doRenderMemo();
});

const sharedEditBtn = document.getElementById("sharedEditBtn");
if (sharedEditBtn) sharedEditBtn.addEventListener("click", () => {
  setSharedEditMode(!getSharedEditMode());
  updateSharedEditBtn();
  doRenderShared();
});

// ============================
// Print buttons
// ============================

const memoPrintBtn = document.getElementById("memoPrintBtn");
const sharedPrintBtn = document.getElementById("sharedPrintBtn");
const overviewBtn = document.getElementById("overviewBtn");
const overviewPrintBtn = document.getElementById("overviewPrintBtn");

if (overviewBtn) overviewBtn.addEventListener("click", () => {
  renderOverviewScreen();
  showView("overview");
});

if (memoPrintBtn) memoPrintBtn.addEventListener("click", () => {
  const limit = lastMemoNo();
  doRenderMemo({ limit: limit || appState.patients.length });
  requestAnimationFrame(() => window.print());
});

if (sharedPrintBtn) sharedPrintBtn.addEventListener("click", () => {
  const limit = lastSharedNo();
  doRenderShared({ limit: limit || appState.patients.length });
  requestAnimationFrame(() => window.print());
});

window.addEventListener("afterprint", () => {
  const memoView = document.getElementById("memoView");
  const sharedView = document.getElementById("sharedView");
  if (memoView && memoView.classList.contains("active")) doRenderMemo();
  if (sharedView && sharedView.classList.contains("active")) doRenderShared();
});

if (overviewPrintBtn) overviewPrintBtn.addEventListener("click", () => {
  renderOverviewScreen();
  requestAnimationFrame(() => window.print());
});

// ============================
// Import / Export
// ============================

initImportExport({
  renderHome: doRenderHome,
  renderDetail: doRenderDetail,
  renderSettings,
  renderOverviewScreen,
  renderMemoScreen: doRenderMemo,
  renderSharedScreen: doRenderShared,
  showView,
});

// ============================
// Action menu (long-press)
// ============================

initActionMenu();

// ============================
// Shared QR (show + read with bug fix)
// ============================

initSharedQr();
initDocsQr();

// ============================
// Shared paste area toggle
// ============================

const sharedPasteToggle = document.getElementById("sharedPasteToggle");
if (sharedPasteToggle) {
  sharedPasteToggle.addEventListener("click", () => {
    const body = document.getElementById("sharedPasteBody");
    const chevron = document.getElementById("sharedPasteChevronBtn");
    if (!body) return;
    const isOpen = body.style.display !== "none";
    body.style.display = isOpen ? "none" : "";
    if (chevron) chevron.style.transform = isOpen ? "" : "rotate(180deg)";
  });
}

// ============================
// Reset
// ============================

const resetBtn = document.getElementById("resetBtn");
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    const ok = confirm("全患者の入力を消去します。よろしいですか？");
    if (!ok) return;
    setAppState(normalizeLoaded(null));
    saveNow();
    doRenderHome();
    doRenderDetail();
    showView("home");
  });
}

const clearAllBtn = document.getElementById("clearAllBtn");
if (clearAllBtn) {
  clearAllBtn.addEventListener("click", () => {
    const ok = confirm("全患者の対象項目をクリアします。よろしいですか？");
    if (!ok) return;
    const ct = settings.clearTargets;
    const now = Date.now();
    for (const p of appState.patients) {
      if (ct.memo) p.memo = "";
      if (ct.s) p.s = "";
      if (ct.o) {
        p.o = makeEmptyOByRules();
        p.oFree = "";
        p.vitals = { spo2: "", spo2_memo: "", rr: "", bp_sys: "", bp_dia: "", pr: "", bt: "" };
      }
      if (ct.a) p.a = { text: "" };
      if (ct.p) p.p = { text: "" };
      if (ct.shared) p.shared = "";
      if (p.status === STATUS.YELLOW && ct.statusYellow) p.status = STATUS.NONE;
      else if (p.status === STATUS.GREEN && ct.statusGreen) p.status = STATUS.NONE;
      else if (p.status === STATUS.GRAY && ct.statusGray) p.status = STATUS.NONE;
      else if (p.status === STATUS.BLUE && ct.statusBlue) p.status = STATUS.NONE;
      p.updatedAt = now;
    }
    saveNow();
    doRenderHome();
    doRenderDetail();
  });
}

// ============================
// App title
// ============================

function updateAppTitle(val) {
  appState.title = val || "回診管理";
  document.title = appState.title;
  const printHead = document.querySelector(".overviewPrintHead");
  if (printHead) printHead.textContent = appState.title + " — 総覧";
}

// ============================
// Boot
// ============================

setAppState(load());

const appTitleInput = document.getElementById("appTitleInput");
if (appTitleInput) {
  appTitleInput.value = appState.title;
  updateAppTitle(appState.title);
  appTitleInput.addEventListener("input", (e) => {
    updateAppTitle(e.target.value);
    scheduleSave();
  });
}

const saveChip = document.getElementById("saveChip");
if (saveChip) saveChip.textContent = localStorage.getItem(STORAGE_KEY) ? "保存: 復元済" : "保存: -";

const storageKeyLabel = document.getElementById("storageKeyLabel");
if (storageKeyLabel) storageKeyLabel.textContent = STORAGE_KEY;

doRenderHome();
setSelectedNo(1);
doRenderDetail();
showView("home");
