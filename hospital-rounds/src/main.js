"use strict";

import "./style.css";

import { STATUS } from "./constants.js";
import { STORAGE_KEYS } from "./storage.js";
import {
  appState, settings, selectedNo,
  setAppState, setRosterState, setSelectedNo,
  saveNow, scheduleSave, saveSettings,
  normalizeLoaded, ensurePatientsHaveAllOKeys, makeEmptyOByRules,
  setMarkUpdatedHandler, requestStoragePersistence,
} from "./store.js";

import { renderHome, updateCountChip } from "./views/home.js";
import { renderDetail, renderQrIfNeeded, initDetailEvents, initStatusButtons, initQrNavButtons } from "./views/detail.js";
import { renderMemoScreen, setMemoEditMode, getMemoEditMode } from "./views/memo.js";
import { renderSharedScreen, setSharedEditMode, getSharedEditMode } from "./views/shared-list.js";
import { renderOverviewScreen } from "./views/overview.js";
import { renderSettings, initSettingsView } from "./views/settings-view.js";

import { showView, syncDetailMemoDisplay, lastMemoNo, lastSharedNo } from "./features/navigation.js";
import { DOCS_BUNDLE } from "./docs-bundle.js";
import { setDataChangeHandler, initActionMenu } from "./features/drag.js";
import { initImportExport } from "./features/import-export.js";
import { initSharedQr, refreshSharedQrIfActive, buildTimestampHeader } from "./features/qr-shared.js";
import { sortPatientsByRoom, invalidateSortSnapshot } from "./features/room.js";
import { initAdminUI, refreshAdminAvailability, setAdminAppliedHandler } from "./features/admin-ui.js";
import { scanQR, isScannerSupported } from "./features/qr-scan.js";
import { isAdminTerminal, isNonAdminTerminal, isAdminEnabled, findIncompleteAdminPatients, clearIncompleteAdminPatients } from "./features/admin.js";
import { flushCommit } from "./features/roster.js";

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
  if (isNonAdminTerminal()) { btn.style.display = "none"; return; }
  btn.style.display = "";
  const active = getMemoEditMode();
  btn.innerHTML = active ? CHECK_SVG : PENCIL_SVG;
  btn.classList.toggle("editActive", active);
  btn.title = btn.setAttribute("aria-label", active ? "完了" : "編集");
  btn.title = active ? "完了" : "編集";
}

function updateSharedEditBtn() {
  const btn = document.getElementById("sharedEditBtn");
  if (!btn) return;
  if (isNonAdminTerminal()) { btn.style.display = "none"; return; }
  btn.style.display = "";
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

function refreshPatientUI() {
  refreshAdminAvailability();
  const viewId = document.querySelector(".view.active")?.id;
  if (viewId === "memoView") doRenderMemo();
  else if (viewId === "sharedView") doRenderShared();
  else if (viewId === "detailView") doRenderDetail();
  else if (viewId === "homeView") doRenderHome();
  refreshSharedQrIfActive();
}

initSettingsView(doRenderDetail, renderQrIfNeeded, refreshPatientUI);

// ============================
// Detail event bindings
// ============================

initDetailEvents(doRenderHome);
initStatusButtons(doRenderHome);
initQrNavButtons();

// ============================
// Navigation button handlers
// ============================

history.replaceState({ view: "home" }, "", "");

window.addEventListener("popstate", (e) => {
  const v = (e.state && e.state.view) || "home";
  showView(v, false);
  // Re-render so changes from another view (e.g. status flip on detail) are reflected
  if (v === "home") doRenderHome();
  else if (v === "memo") doRenderMemo();
  else if (v === "shared") doRenderShared();
  else if (v === "detail") doRenderDetail();
});

function validateAdminTerminal() {
  if (!isAdminTerminal()) return true;
  const missing = findIncompleteAdminPatients();
  if (!missing.length) return true;
  const sample = missing.slice(0, 8).join(", ") + (missing.length > 8 ? ", ..." : "");
  const ok = confirm(
    `次の位置の患者は部屋番号またはタグが未入力です: ${sample}\n` +
    `\n[OK]を押して進むと、これらの患者の名前・部屋番号・タグはクリアされます（SOAP・メモ・共有は残ります）。\n` +
    `[キャンセル]で編集に戻れます。`
  );
  if (!ok) return false;
  clearIncompleteAdminPatients();
  return true;
}

function navToMemo() {
  if (!validateAdminTerminal()) return;
  setSharedEditMode(false);
  updateSharedEditBtn();
  doRenderMemo();
  showView("memo");
}
function navToShared() {
  if (!validateAdminTerminal()) return;
  setMemoEditMode(false);
  updateMemoEditBtn();
  doRenderShared();
  showView("shared");
}
function navToHome() {
  if (!validateAdminTerminal()) return;
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
// Docs are bundled into the app (DOCS_BUNDLE) so the help view works offline
// without any network or service-worker cache hits. Image URLs inside the
// bundle use a `__BASE__/` placeholder so the same bundle works under any
// deployment base (prod: /hospital-rounds/, test サブドメイン: /). The actual
// path is derived from the current page URL — `import.meta.env.BASE_URL` is
// not used because vite-plugin-singlefile rewrites it to `./` regardless of
// the configured base.
const DOCS_BASE = new URL("./", document.baseURI).pathname;
function openDocsPage(pageName) {
  const iframe = document.getElementById("docsIframe");
  if (!iframe) return;
  const key = pageName.endsWith(".html") ? pageName : pageName + ".html";
  const html = (DOCS_BUNDLE[key] || DOCS_BUNDLE["index.html"] || "")
    .replaceAll("__BASE__/", DOCS_BASE);
  iframe.srcdoc = html;
  showView("docs");
}

if (headerHelpBtn) headerHelpBtn.addEventListener("click", () => openDocsPage("index"));

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".helpLinkBtn");
  if (!btn) return;
  const page = btn.dataset.helpPage;
  if (!page) return;
  openDocsPage(page);
});

// Intra-docs navigation requested from the iframe (prev/next/breadcrumb links)
window.addEventListener("message", (e) => {
  if (!e.data || e.data.type !== "docs-nav") return;
  if (typeof e.data.page !== "string") return;
  openDocsPage(e.data.page);
});

const memoEditBtn = document.getElementById("memoEditBtn");
if (memoEditBtn) memoEditBtn.addEventListener("click", () => {
  const nextActive = !getMemoEditMode();
  // Exiting edit mode on admin terminal: validate
  if (!nextActive && !validateAdminTerminal()) return;
  setMemoEditMode(nextActive);
  updateMemoEditBtn();
  doRenderMemo();
});

const sharedEditBtn = document.getElementById("sharedEditBtn");
if (sharedEditBtn) sharedEditBtn.addEventListener("click", () => {
  const nextActive = !getSharedEditMode();
  if (!nextActive && !validateAdminTerminal()) return;
  setSharedEditMode(nextActive);
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
initAdminUI();
setAdminAppliedHandler(() => {
  doRenderHome();
  doRenderDetail();
  const v = document.querySelector(".view.active")?.id;
  if (v === "memoView") doRenderMemo();
  else if (v === "sharedView") doRenderShared();
});


function doSortByRoom() {
  if (!confirm("部屋番号順に並び替えますか？")) return;
  const cur = appState.patients[selectedNo - 1];
  sortPatientsByRoom();
  if (cur) {
    const idx = appState.patients.indexOf(cur);
    if (idx >= 0) setSelectedNo(idx + 1);
  }
  doRenderHome();
  doRenderDetail();
  const viewId = document.querySelector(".view.active")?.id;
  if (viewId === "memoView") doRenderMemo();
  else if (viewId === "sharedView") doRenderShared();
}

const homeRoomSortBtn = document.getElementById("homeRoomSortBtn");
const memoRoomSortBtn = document.getElementById("memoRoomSortBtn");
const sharedRoomSortBtn = document.getElementById("sharedRoomSortBtn");
if (homeRoomSortBtn) homeRoomSortBtn.addEventListener("click", doSortByRoom);
if (memoRoomSortBtn) memoRoomSortBtn.addEventListener("click", doSortByRoom);
if (sharedRoomSortBtn) sharedRoomSortBtn.addEventListener("click", doSortByRoom);

// ============================
// Shared / Memo paste card close buttons
// ============================

function wireCloseButton(btnId, cardId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener("click", () => {
    const card = document.getElementById(cardId);
    if (card) card.classList.remove("active");
  });
}
wireCloseButton("sharedPasteCloseBtn", "sharedPasteCard");
wireCloseButton("memoPasteCloseBtn", "memoPasteCard");

// カメラ QR スキャナ。読み取り結果を該当 textarea に追記してから input イベントを起こす
// （既存の貼付ハンドラはこれで普通に発火する）。
function appendScannedToTextarea(area, text, opts = {}) {
  if (!area || !text) return;
  const cur = area.value || "";
  const sep = cur && !cur.endsWith("\n") ? "\n" : "";
  const entry = opts.withTimestamp ? buildTimestampHeader() + "\n" + text : text;
  area.value = cur + sep + entry;
  area.dispatchEvent(new Event("input", { bubbles: true }));
}

function wireScanButton(btnId, areaId, opts = {}) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (!isScannerSupported()) {
    btn.disabled = true;
    btn.title = "このブラウザはカメラ非対応";
  }
  btn.addEventListener("click", async () => {
    const text = await scanQR();
    if (text == null) return;
    const area = document.getElementById(areaId);
    appendScannedToTextarea(area, text, { withTimestamp: opts.withTimestamp });
    if (opts.openCardId) {
      const card = document.getElementById(opts.openCardId);
      if (card) card.classList.add("active");
    }
  });
}

// Paste-card camera handles continuation scans (text accumulates in the area).
wireScanButton("sharedPasteScanBtn", "sharedPasteArea");
wireScanButton("adminImportScanBtn", "adminImportArea");
// Memo view: in-card camera reads QR and appends with a timestamp prefix.
wireScanButton("memoPasteScanBtn", "memoPasteArea", { withTimestamp: true });

// Memo view: toolbar QR button toggles the 受信メモ card open/closed
// (mirrors 共有画面の sharedShowQrBtn → sharedQrWrap toggle).
const memoShowPasteBtn = document.getElementById("memoShowPasteBtn");
if (memoShowPasteBtn) {
  memoShowPasteBtn.addEventListener("click", () => {
    const card = document.getElementById("memoPasteCard");
    if (!card) return;
    card.classList.toggle("active");
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
    // Roster commits reference the previous pids; drop the sync metadata so a
    // future admin enable starts from a clean baseline.
    setRosterState(null);
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

// store.js hydrates appState / rosterState / settings from storage at module
// init, so no explicit load step is needed here.

// Drop the room-sort snapshot whenever any patient is edited
setMarkUpdatedHandler(() => invalidateSortSnapshot());

// Flush any pending op-batch when leaving the app or backgrounding
window.addEventListener("beforeunload", () => { try { flushCommit(); } catch (_) {} });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { try { flushCommit(); } catch (_) {} } });

const appTitleInput = document.getElementById("appTitleInput");
if (appTitleInput) {
  appTitleInput.value = appState.title;
  updateAppTitle(appState.title);
  appTitleInput.addEventListener("input", (e) => {
    updateAppTitle(e.target.value);
    scheduleSave();
  });
}

const storageKeyLabel = document.getElementById("storageKeyLabel");
if (storageKeyLabel) storageKeyLabel.textContent = STORAGE_KEYS.bundle;

requestStoragePersistence();

doRenderHome();
setSelectedNo(1);
doRenderDetail();
showView("home");
