"use strict";

import "./style.css";

import { STATUS } from "./constants.js";
import { STORAGE_KEYS, listBundles, getActiveWorkspaceId, renameBundle } from "./storage.js";
import {
  appState, settings, selectedNo,
  setAppState, setRosterState, setSelectedNo,
  saveNow, scheduleSave, saveSettings,
  normalizeLoaded,
  setMarkUpdatedHandler, requestStoragePersistence,
  initStore, flushSavePending, setOnWorkspaceChanged,
  updateDeviceTitle,
} from "./store.js";

import { renderHome, updateCountChip, setHomeEditMode } from "./views/home.js";
import { renderDetail, renderQrIfNeeded, initDetailEvents, initStatusButtons, initQrNavButtons } from "./views/detail.js";
import { renderMemoScreen, setMemoEditMode, getMemoEditMode } from "./views/memo.js";
import { renderSharedScreen, setSharedEditMode, getSharedEditMode } from "./views/shared-list.js";
import { renderOverviewScreen } from "./views/overview.js";
import { renderSettings, initSettingsView } from "./views/settings-view.js";

import { showView, syncDetailMemoDisplay, lastMemoNo, lastSharedNo } from "./features/navigation.js";
import { DOCS_BUNDLE } from "./docs-bundle.js";
import { setDataChangeHandler, initActionMenu } from "./features/drag.js";
import { initFormats, setOnTextChanged as setOnFormatTextChanged, setFormatStoreAdapter } from "./features/formats.js";
import { initMovePatient } from "./features/move-patient.js";
import { initQrFormat, closeQrFormatOverlay, setOnFormatApplied, setFormatStoreAdapter as setQrFormatStoreAdapter } from "./features/qr-format.js";
import { getAllTags as _getAllTagsForQr } from "./features/tags.js";
import { initFormatGroups } from "./features/format-groups.js";
import { t, applyI18n } from "./i18n.js";
import { initImportExport } from "./features/import-export.js";
import { initSharedQr, refreshSharedQrIfActive, initMemoQr, refreshMemoQrIfActive } from "./features/qr-shared.js";
import { initHomeQr, refreshHomeQrIfActive } from "./features/qr-home.js";
import { initSettingsQr, refreshSettingsQrIfActive, setOnSettingsApplied } from "./features/qr-settings.js";
import { createPrintFlow } from "./features/print.js";
import { createEditToggle } from "./features/edit-toggle.js";
import { sortPatientsByRoom, invalidateSortSnapshot } from "./features/room.js";
import { initAdminUI, refreshAdminAvailability, setAdminAppliedHandler } from "./features/admin-ui.js";
import { scanQR, isScannerSupported } from "./features/qr-scan.js";
import { isAdminTerminal, isNonAdminTerminal, isAdminEnabled, findIncompleteAdminPatients, clearIncompleteAdminPatients } from "./features/admin.js";
import { flushCommit, compactHistory } from "./features/roster.js";
import { initDocsDemo, renderDocsDemo, resetDocsDemo } from "./docs/docs-demo.js";
import { initNoAutofill } from "./features/no-autofill.js";
import { maybeShowPwaInitDialog } from "./features/pwa-init.js";
import { maybeShowDisclaimer } from "./features/splash-disclaimer.js";

// ============================
// PWA 初回起動チェック
// ============================
// 初回 PWA 起動 (= Safari でテスト入力したデータが PWA 側に共有されている状態)
// に限り、ユーザに「テスト用データを削除して開始するか」を確認する。
// 「削除して開始」を選ぶと内部で reload するため戻ってこない。
await maybeShowPwaInitDialog();

// ============================
// Async hydration (IndexedDB)
// ============================
// store.js は module-init 時に state を読み込まなくなったので、ここで明示的に
// 待つ。以降のすべての top-level コード (renderHome / appTitleInput.value =
// appState.title 等) は hydration 完了後に実行される。
// ES modules の top-level await により main.js モジュール全体が suspend し、
// vite/ブラウザの ESM ローダがその完了を待ってくれる。
await initStore();

// アクティブワークスペースの roster commits のうち 30 日より古いものを
// baseSnapshot に折りたたむ (個人情報の長期保持を避けるため)。
// 起動直後に 1 回呼ぶだけで idempotent。
try { compactHistory(); } catch (e) { console.warn("compactHistory failed:", e); }

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

// 編集モード関連のボタン表示制御は createEditToggle が `.editActive` を
// 当ててくれるので、ここでは「非管理端末では非表示」だけハンドル。
function updateMemoEditBtnVisibility() {
  const btn = document.getElementById("memoEditBtn");
  if (btn) btn.style.display = isNonAdminTerminal() ? "none" : "";
}
function updateSharedEditBtnVisibility() {
  const btn = document.getElementById("sharedEditBtn");
  if (btn) btn.style.display = isNonAdminTerminal() ? "none" : "";
}

function navigateToPatient(i) {
  // 共通の編集トグルが showView で自動 exit するので、ここでは個別 reset 不要
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
  // 名簿が変わったらホームQRも追随
  refreshHomeQrIfActive();
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
  refreshMemoQrIfActive();
  refreshHomeQrIfActive();
  refreshSettingsQrIfActive();
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
  const ok = confirm(t("adminTerminal.incompletePatients.confirm", { sample }));
  if (!ok) return false;
  clearIncompleteAdminPatients();
  return true;
}

function navToMemo() {
  if (!validateAdminTerminal()) return;
  doRenderMemo();
  showView("memo");
}
function navToShared() {
  if (!validateAdminTerminal()) return;
  doRenderShared();
  showView("shared");
}
function navToHome() {
  if (!validateAdminTerminal()) return;
  saveSettings();
  doRenderHome();
  showView("home");
}

const headerMemoBtn = document.getElementById("headerMemoBtn");
const headerSharedBtn = document.getElementById("headerSharedBtn");
const headerSettingsBtn = document.getElementById("headerSettingsBtn");

function navToSettings() {
  renderSettings();
  showView("settings");
}

if (headerMemoBtn) headerMemoBtn.addEventListener("click", navToMemo);
if (headerSharedBtn) headerSharedBtn.addEventListener("click", navToShared);
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
  // 上部のインタラクティブデモバーを描画。state は別ページ間で維持される
  // (説明書を抜けると MutationObserver 経由で resetDocsDemo() が走る)。
  renderDocsDemo();
}

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

// ホーム・メモ・共有の編集トグルは共通ヘルパで定義。鉛筆 → 編集モード /
// 外側クリック or ビュー遷移で表示モードに戻る。
// ホーム編集モードでは患者ボタンがタップ＝ステータスサイクル / 長押し＝白に。
updateMemoEditBtnVisibility();
updateSharedEditBtnVisibility();
createEditToggle({
  triggerBtn: document.getElementById("homeEditBtn"),
  container: document.getElementById("homeView"),
  onEnter: () => { setHomeEditMode(true); doRenderHome(); },
  onExit: () => { setHomeEditMode(false); doRenderHome(); },
});
createEditToggle({
  triggerBtn: document.getElementById("memoEditBtn"),
  container: document.getElementById("memoView"),
  onEnter: () => { setMemoEditMode(true); doRenderMemo(); },
  onExit: () => { setMemoEditMode(false); doRenderMemo(); },
});
createEditToggle({
  triggerBtn: document.getElementById("sharedEditBtn"),
  container: document.getElementById("sharedView"),
  onEnter: () => { setSharedEditMode(true); doRenderShared(); },
  onExit: () => { setSharedEditMode(false); doRenderShared(); },
});

// ============================
// Print buttons
// ============================

const overviewBtn = document.getElementById("overviewBtn");
if (overviewBtn) overviewBtn.addEventListener("click", () => {
  renderOverviewScreen();
  showView("overview");
});

// 印刷フローはターゲットごとに createPrintFlow のインスタンスを作る。
// prepare で印刷向けに整え（メモ/共有は最後の入力位置で打ち切り、その他は
// 単に再描画）、restore で通常表示に戻す。新しい印刷対象を足したいときは
// このリストに 1 つ instance を増やすだけ。
const memoPrintFlow = createPrintFlow({
  viewName: "memo",
  prepare: () => doRenderMemo({ limit: lastMemoNo() || appState.patients.length }),
  restore: () => doRenderMemo(),
});
const sharedPrintFlow = createPrintFlow({
  viewName: "shared",
  prepare: () => doRenderShared({ limit: lastSharedNo() || appState.patients.length }),
  restore: () => doRenderShared(),
});
const overviewPrintFlow = createPrintFlow({
  viewName: "overview",
  prepare: () => renderOverviewScreen(),
});
const settingsPrintFlow = createPrintFlow({
  viewName: "settings",
});

document.getElementById("memoPrintBtn")?.addEventListener("click", memoPrintFlow.print);
document.getElementById("sharedPrintBtn")?.addEventListener("click", sharedPrintFlow.print);
document.getElementById("overviewPrintBtn")?.addEventListener("click", overviewPrintFlow.print);
document.getElementById("settingsPrintBtn")?.addEventListener("click", settingsPrintFlow.print);

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
  // DB モーダルから active ws の rename が走ったらヘッダーの ws 名表示も更新
  refreshHeaderWsLabel: refreshAppWsLabel,
});

// ============================
// PHI 保護: ブラウザ autofill による origin またぎの漏洩防止
// ============================

initNoAutofill();

// ============================
// Action menu (long-press)
// ============================

initActionMenu();

// formats.js / qr-format.js は移植性のため store を直接触らず adapter 経由で書き込む。
// ここで store の実体に紐付ける ("hospital-rounds 内で動かす時の adapter")
setFormatStoreAdapter({
  saveFormat: (target, { isNew }) => {
    if (!Array.isArray(settings.formats)) settings.formats = [];
    if (isNew) {
      settings.formats.push(target);
    } else {
      const idx = settings.formats.findIndex(f => f.id === target.id);
      if (idx >= 0) settings.formats[idx] = target;
      else settings.formats.push(target);
    }
    saveSettings();
  },
  deleteFormat: (id) => {
    if (!Array.isArray(settings.formats)) return;
    const idx = settings.formats.findIndex(f => f.id === id);
    if (idx < 0) return;
    settings.formats.splice(idx, 1);
    saveSettings();
  },
});

setQrFormatStoreAdapter({
  getExistingFormats: () => Array.isArray(settings.formats) ? settings.formats : [],
  getKnownTags: () => _getAllTagsForQr(),
  addFormat: (newFmt) => {
    if (!Array.isArray(settings.formats)) settings.formats = [];
    settings.formats.push(newFmt);
    saveSettings();
  },
});

initFormats();
setOnFormatTextChanged(() => {
  doRenderDetail();
  if (typeof renderQrIfNeeded === "function") renderQrIfNeeded();
});

initMovePatient({
  renderHome: doRenderHome,
  renderDetail: doRenderDetail,
});

initQrFormat();
setOnFormatApplied(() => {
  // 受信したフォーマットを settings.formats[] に追加した直後。設定画面が
  // 開いていればフォーマット一覧と patient strip を再描画する
  renderSettings();
  doRenderDetail();
});

// フォーマットグループ機能
initFormatGroups({
  renderDetail: doRenderDetail,
});
// QR フォーマット overlay の close ボタン + overlay 外クリックで閉じる配線
document.getElementById("qrFormatCloseBtn")?.addEventListener("click", closeQrFormatOverlay);
document.getElementById("qrFormatOverlay")?.addEventListener("click", (e) => {
  if (e.target.id === "qrFormatOverlay") closeQrFormatOverlay();
});

// ============================
// Shared QR (show + read with bug fix)
// ============================

initSharedQr();
initMemoQr();
initHomeQr();
initSettingsQr();
// 設定QR受信後はビュー全体を再描画して反映を即時に見せる
setOnSettingsApplied(() => refreshPatientUI());
initAdminUI();
setAdminAppliedHandler(() => {
  doRenderHome();
  doRenderDetail();
  const v = document.querySelector(".view.active")?.id;
  if (v === "memoView") doRenderMemo();
  else if (v === "sharedView") doRenderShared();
});


function doSortByRoom() {
  if (!confirm(t("main.sortByRoom.confirm"))) return;
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
// Paste card close buttons
// ============================

// 共有画面：×でそのまま閉じる（受信内容を続きでスキャンするケースに備え確認なし）
const sharedPasteCloseBtn = document.getElementById("sharedPasteCloseBtn");
if (sharedPasteCloseBtn) {
  sharedPasteCloseBtn.addEventListener("click", () => {
    const card = document.getElementById("sharedPasteCard");
    if (card) card.classList.remove("active");
  });
}

// メモ画面：受信メモはスキャン直後のスクラッチ表示で、閉じると内容も破棄する。
// 誤タップでスキャン結果を失わないよう確認を入れる。
const memoPasteCloseBtn = document.getElementById("memoPasteCloseBtn");
if (memoPasteCloseBtn) {
  memoPasteCloseBtn.addEventListener("click", () => {
    const area = document.getElementById("memoPasteArea");
    const hasContent = !!(area && String(area.value || "").trim());
    if (hasContent && !confirm(t("main.recvMemo.close.confirm"))) return;
    const card = document.getElementById("memoPasteCard");
    if (card) card.classList.remove("active");
    if (area) area.value = "";
  });
}

// カメラ QR スキャナ。読み取り結果を該当 textarea に追記してから input イベントを起こす
// （既存の貼付ハンドラはこれで普通に発火する）。
function wireScanButton(btnId, areaId) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (!isScannerSupported()) {
    btn.disabled = true;
    btn.title = t("qr.scanner.unsupported");
  }
  btn.addEventListener("click", async () => {
    const text = await scanQR();
    if (text == null) return;
    const area = document.getElementById(areaId);
    if (!area) return;
    const cur = area.value || "";
    const sep = cur && !cur.endsWith("\n") ? "\n" : "";
    area.value = cur + sep + text;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

// Paste-card camera handles continuation scans (text accumulates in the area).
wireScanButton("sharedPasteScanBtn", "sharedPasteArea");
wireScanButton("adminImportScanBtn", "adminImportArea");

// ============================
// Reset
// ============================

const resetBtn = document.getElementById("resetBtn");
if (resetBtn) {
  resetBtn.addEventListener("click", () => {
    closeHeaderMenu();
    const ok = confirm(t("main.clearAllInput.confirm"));
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
    closeHeaderMenu();
    const ok = confirm(t("clear.confirm"));
    if (!ok) return;
    const ct = settings.clearTargets;
    const now = Date.now();
    for (const p of appState.patients) {
      if (ct.memo) p.memo = "";
      if (ct.s) p.s = "";
      if (ct.o) {
        p.oFree = "";
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
  // 端末固定 title。localStorage 経由で永続化、live state にも反映。
  updateDeviceTitle(val || t("app.title"));
  document.title = appState.title;
  const printHead = document.querySelector(".overviewPrintHead");
  if (printHead) printHead.textContent = appState.title + " — 総覧";
}

// 現在アクティブなワークスペースの label を非同期に取得 → ヘッダー入力欄へ反映
async function refreshAppWsLabel() {
  const inp = document.getElementById("appWsLabelInput");
  if (!inp) return;
  try {
    const activeId = getActiveWorkspaceId();
    const all = await listBundles();
    const me = all.find(r => r.id === activeId);
    inp.value = me ? (me.label || t("io.ws.untitled")) : "";
  } catch (e) {
    console.warn("refreshAppWsLabel failed:", e);
  }
}

// ============================
// Boot
// ============================

// store.js hydrates appState / rosterState / settings from storage at module
// init, so no explicit load step is needed here.

// Drop the room-sort snapshot whenever any patient is edited
setMarkUpdatedHandler(() => invalidateSortSnapshot());

// Flush any pending op-batch + debounce 中の save を、離脱・バックグラウンド化時に
// 即時フラッシュ。IDB は async だが microtask 単位で transaction が開始されれば
// page hide 中も完了することが多い。
window.addEventListener("beforeunload", () => {
  try { flushCommit(); } catch (_) {}
  try { flushSavePending(); } catch (_) {}
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    try { flushCommit(); } catch (_) {}
    try { flushSavePending(); } catch (_) {}
  }
});

// Workspace 切替時に画面全体を再描画する。store 側で live state は既に
// 入れ替わっているので、ここでは render を走らせるだけ。
setOnWorkspaceChanged(() => {
  // 患者 index を前 ws から引きずらないように、再描画前に必ずリセット (詳細画面に
  // 出ていた場合、旧 ws の slot 51 を新 ws で開こうとして空患者が描画されるバグ対策)
  setSelectedNo(1);
  refreshPatientUI();
  // タイトル (端末固定なので変化しない) の表示同期 + ws label を更新
  const appTitleInput = document.getElementById("appTitleInput");
  if (appTitleInput) appTitleInput.value = appState.title;
  document.title = appState.title;
  refreshAppWsLabel();
});

// タイトル / ワークスペース名 入力欄: 共通の編集トグルで管理。
//   - 普段は readonly。タイトル input をタップ → ホーム遷移
//   - 鉛筆タップで両方とも編集可、外側クリック・Enter で確定
//   - タイトルは端末固定 (updateAppTitle 経由で localStorage に保存)
//   - ws name は renameBundle で IDB の label を更新 (現アクティブ ws の label)
const appTitleInput = document.getElementById("appTitleInput");
const appWsLabelInput = document.getElementById("appWsLabelInput");
const headerEditTitleBtn = document.getElementById("headerEditTitleBtn");
const appTitleRow = document.querySelector(".appTitleRow");
let titleToggle = null;

// field-sizing 未対応ブラウザ向けの size 属性同期。
function syncInputSize(inp) {
  if (!inp) return;
  const len = (inp.value || "").length || 1;
  inp.size = Math.max(2, Math.min(20, len));
}

if (appTitleInput) {
  appTitleInput.value = appState.title;
  updateAppTitle(appState.title);
  syncInputSize(appTitleInput);
  appTitleInput.addEventListener("input", (e) => {
    updateAppTitle(e.target.value);
    syncInputSize(appTitleInput);
    // title は localStorage に保存済 (updateDeviceTitle 内)。
    // bundle 側の meta.title も整合させるため debounce save も発火しておく
    scheduleSave();
  });
  appTitleInput.addEventListener("click", () => {
    if (!titleToggle?.isEditing()) navToHome();
  });
  appTitleInput.addEventListener("keydown", (e) => {
    if (titleToggle?.isEditing() && e.key === "Enter") {
      e.preventDefault();
      titleToggle.exit();
    }
  });
}

if (appWsLabelInput) {
  // 初期値は async fetch で埋まる
  refreshAppWsLabel();
  appWsLabelInput.placeholder = t("header.ws.placeholder");
  appWsLabelInput.addEventListener("input", () => syncInputSize(appWsLabelInput));
  // 編集確定時 (blur or Enter) に renameBundle を呼ぶ。input 中はまだ保存しない
  // (タイプ途中の中間状態が IDB に頻繁に書かれるのを避ける)
  const commitWsLabel = async () => {
    const newLabel = String(appWsLabelInput.value || "").trim();
    const activeId = getActiveWorkspaceId();
    if (!newLabel) {
      // 空入力は無視して直前の値に戻す
      refreshAppWsLabel();
      return;
    }
    try {
      await renameBundle(activeId, newLabel);
    } catch (e) {
      console.error("ws rename failed:", e);
      refreshAppWsLabel();
    }
  };
  appWsLabelInput.addEventListener("blur", commitWsLabel);
  appWsLabelInput.addEventListener("keydown", (e) => {
    if (titleToggle?.isEditing() && e.key === "Enter") {
      e.preventDefault();
      titleToggle.exit();
    }
  });
}

titleToggle = createEditToggle({
  triggerBtn: headerEditTitleBtn,
  container: appTitleRow,
  onEnter: () => {
    if (appTitleInput) {
      appTitleInput.readOnly = false;
      appTitleInput.focus();
      appTitleInput.select();
    }
    if (appWsLabelInput) appWsLabelInput.readOnly = false;
  },
  onExit: () => {
    if (appTitleInput) {
      appTitleInput.readOnly = true;
      appTitleInput.blur();
    }
    if (appWsLabelInput) {
      appWsLabelInput.readOnly = true;
      appWsLabelInput.blur();
    }
  },
});

// ハンバーガーメニュー（設定・印刷・データ管理 (DB)）。ヘッダー右の ☰ で開閉し、
// 各アイコンをタップしたらメニューを閉じてから実行する。データ管理は
// import-export.js が settingsDbBtn を見ているので、ここではメニュー close だけ追加。
const headerMenuBtn = document.getElementById("headerMenuBtn");
const headerMenuOverlay = document.getElementById("headerMenuOverlay");
function closeHeaderMenu() {
  if (headerMenuOverlay) headerMenuOverlay.classList.remove("active");
}
function openHeaderMenu() {
  if (headerMenuOverlay) headerMenuOverlay.classList.add("active");
}
if (headerMenuBtn) headerMenuBtn.addEventListener("click", () => {
  if (headerMenuOverlay?.classList.contains("active")) closeHeaderMenu();
  else openHeaderMenu();
});
if (headerMenuOverlay) headerMenuOverlay.addEventListener("click", (e) => {
  if (e.target === headerMenuOverlay) closeHeaderMenu();
});

document.getElementById("menuPrintBtn")?.addEventListener("click", () => {
  closeHeaderMenu();
  overviewPrintFlow.print();
});
// DB アイコンは settingsDbBtn の ID のままハンバーガー内に置いてあり、
// import-export.js が click を拾って chooser を開く。ここではメニュー close だけ追加。
document.getElementById("settingsDbBtn")?.addEventListener("click", closeHeaderMenu);

const storageKeyLabel = document.getElementById("storageKeyLabel");
if (storageKeyLabel) storageKeyLabel.textContent = `${STORAGE_KEYS.db}.${STORAGE_KEYS.store}`;

requestStoragePersistence();

// ============================
// Web 版警告バナー: PWA (standalone) でない時のみ表示
// ============================
// iOS Safari は navigator.standalone、それ以外は matchMedia('(display-mode: standalone)') で判定
{
  const banner = document.getElementById("webWarningBanner");
  const isStandalone =
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
    || window.navigator.standalone === true;
  if (banner) banner.style.display = isStandalone ? "none" : "";
}

// 説明書ビューのインタラクティブデモバーを初期化 (リロード btn 紐づけ)。
// state は docs-demo.js 内のメモリのみ。実患者・実 settings に影響なし。
initDocsDemo();

// 説明書 (data-view="docs") を抜けた瞬間にデモ state をリセット。
// MutationObserver で疎結合に検知 (showView や navToXxx を改造せずに済む)。
{
  let _prevView = document.documentElement.dataset.view;
  const obs = new MutationObserver(() => {
    const cur = document.documentElement.dataset.view;
    if (_prevView === "docs" && cur !== "docs") resetDocsDemo();
    _prevView = cur;
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-view"] });
}

// ヘッダー高さを CSS 変数化。.detailTop の sticky 用 top オフセットに使う。
// モバイルでは内容が wrap して 68px+ になることがあるので実測が必須。
{
  const header = document.querySelector("header");
  if (header) {
    const updateHeaderH = () => {
      const h = header.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--headerH", h + "px");
    };
    updateHeaderH();
    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(updateHeaderH).observe(header);
    } else {
      window.addEventListener("resize", updateHeaderH);
    }
  }
}

// HTML 内の data-i18n / data-i18n-title / data-i18n-aria / data-i18n-placeholder を
// すべて t() で埋める。動的に作る DOM は各 renderer で t() を直接使う。
applyI18n();
doRenderHome();
setSelectedNo(1);
doRenderDetail();
showView("home");

// 月 1 回程度、「これは個人メモであり正式な医療記録ではない」旨のスプラッシュを表示。
// home が描画されてから出すので、ユーザは閉じた瞬間にホーム画面に戻れる。
// データ削除の可能性がある pwa-init とは違い await の必要はないが、await しても安全。
maybeShowDisclaimer();
