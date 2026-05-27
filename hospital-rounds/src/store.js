"use strict";

import {
  DEFAULT_PATIENT_COUNT, STATUS,
  DEFAULT_FORMATS, FORMAT_PANELS,
  FORMAT_ITEM_KINDS, DEFAULT_ITEM_KIND,
  DEFAULT_LABEL_SEP_TEXT, DEFAULT_LABEL_SEP_OTHER,
  DEFAULT_CLEAR_TARGETS, DEFAULT_TAGS,
  DEFAULT_ADMIN_ENABLED, DEFAULT_ADMIN_TERMINAL,
  DEFAULT_ROSTER_PASSPHRASE, DEFAULT_TAG_GROUPING_ENABLED,
  clone,
} from "./constants.js";
import { projectBundle, parseBundle, getSection, SECTION } from "./bundle.js";
import {
  loadBundle as storageLoad,
  saveBundle as storageSave,
  createWorkspaceRecord,
  setActiveWorkspaceId,
  getDeviceAppTitle, setDeviceAppTitle,
} from "./storage.js";

// ============================
// Settings defaults & normalization
// ============================

function newFormatId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return "fmt_" + crypto.randomUUID();
  return "fmt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function makeDefaultFormats() {
  return DEFAULT_FORMATS.map(f => ({
    id: newFormatId(),
    name: f.name,
    panel: f.panel,
    joiner: f.joiner,
    labelSep: typeof f.labelSep === "string" ? f.labelSep : DEFAULT_LABEL_SEP_OTHER,
    tags: Array.isArray(f.tags) ? f.tags.slice() : [],
    pinned: !!f.pinned,
    isDefault: !!f.isDefault,
    items: f.items.map(it => ({ ...it })),
  }));
}

export function defaultSettings() {
  return {
    v: 1,
    formats: makeDefaultFormats(),
    // フォーマットの「束」。患者ごとに 1 つ active group を設定すると、
    // 各パネルの pin チップがそのグループに属するフォーマットだけに切り替わる
    // (= お気に入りを切り替える感覚)。例: 「発熱対応」グループに 血液 / エコー /
    // CT / Xp を束ねておけば、発熱患者を開いた時に一気にそれらをワンタップで開ける。
    formatGroups: [],
    clearTargets: clone(DEFAULT_CLEAR_TARGETS),
    tags: clone(DEFAULT_TAGS),
    adminEnabled: DEFAULT_ADMIN_ENABLED,
    adminTerminal: DEFAULT_ADMIN_TERMINAL,
    rosterPassphrase: DEFAULT_ROSTER_PASSPHRASE,
    deviceId: "",
    tagGroupingEnabled: DEFAULT_TAG_GROUPING_ENABLED,
    tagGroups: [],
    tagGroupAssign: {},
  };
}

// item は kind ごとに必要なフィールドだけ持つ:
//   text     : { label, kind:"text",     normal }
//   number   : { label, kind:"number",   unit   }
//   fraction : { label, kind:"fraction", unit   }
//   date     : { label, kind:"date",     normal }   // normal = memo prefill
function normalizeFormatItem(item) {
  if (!item || typeof item !== "object") return null;
  const label = String(item.label ?? "").trim();
  const kind = (typeof item.kind === "string" && FORMAT_ITEM_KINDS.includes(item.kind))
    ? item.kind : DEFAULT_ITEM_KIND;
  // text item は label が空でも正常文だけのケース (規定文「著変なし」など) を許容
  if (!label && kind !== "text") return null;
  const out = { label, kind };
  if (kind === "number" || kind === "fraction") {
    out.unit = String(item.unit ?? "");
  } else {
    // text / date は normal を持つ
    out.normal = String(item.normal ?? "");
  }
  return out;
}

function inferLabelSepFromItems(items) {
  if (!items || !items.length) return DEFAULT_LABEL_SEP_OTHER;
  const allText = items.every(it => it && it.kind === "text");
  return allText ? DEFAULT_LABEL_SEP_TEXT : DEFAULT_LABEL_SEP_OTHER;
}

function normalizeFormat(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = String(raw.name ?? "").trim();
  if (!name) return null;
  const panel = FORMAT_PANELS.includes(raw.panel) ? raw.panel : "O";
  const id = (typeof raw.id === "string" && raw.id) ? raw.id : newFormatId();
  const items = Array.isArray(raw.items)
    ? raw.items.map(normalizeFormatItem).filter(Boolean)
    : [];
  const joiner = typeof raw.joiner === "string" ? raw.joiner : ", ";
  // labelSep: 明示指定優先、なければ items から推定
  const labelSep = typeof raw.labelSep === "string" ? raw.labelSep : inferLabelSepFromItems(items);
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter(t => typeof t === "string" && t.trim()).map(t => String(t))
    : [];
  return { id, name, panel, joiner, labelSep, tags, pinned: !!raw.pinned, isDefault: !!raw.isDefault, items };
}

function normalizeSettings(raw) {
  const out = defaultSettings();
  if (!raw || typeof raw !== "object") return out;
  // 未知フィールド温存 (forward compatibility): 旧バージョンが新版で追加された
  // フィールドを読んだ時に消失しないように、out に無いキーは raw からそのまま持ち越す。
  // 既知フィールドは下で validation + デフォルト補完されて上書きされる。
  for (const k of Object.keys(raw)) {
    if (!(k in out)) out[k] = raw[k];
  }
  // formats: 新規登録された設定。空または欠落ならデフォルトを採用。
  if (Array.isArray(raw.formats)) {
    const cleaned = raw.formats.map(normalizeFormat).filter(Boolean);
    if (cleaned.length) out.formats = cleaned;
  }
  if (raw.clearTargets && typeof raw.clearTargets === "object") {
    const ct = raw.clearTargets;
    out.clearTargets = {
      memo:   typeof ct.memo   === "boolean" ? ct.memo   : DEFAULT_CLEAR_TARGETS.memo,
      s:      typeof ct.s      === "boolean" ? ct.s      : DEFAULT_CLEAR_TARGETS.s,
      o:      typeof ct.o      === "boolean" ? ct.o      : DEFAULT_CLEAR_TARGETS.o,
      a:      typeof ct.a      === "boolean" ? ct.a      : DEFAULT_CLEAR_TARGETS.a,
      p:      typeof ct.p      === "boolean" ? ct.p      : DEFAULT_CLEAR_TARGETS.p,
      shared: typeof ct.shared === "boolean" ? ct.shared : DEFAULT_CLEAR_TARGETS.shared,
      statusYellow: typeof ct.statusYellow === "boolean" ? ct.statusYellow : DEFAULT_CLEAR_TARGETS.statusYellow,
      statusGreen:  typeof ct.statusGreen  === "boolean" ? ct.statusGreen  : DEFAULT_CLEAR_TARGETS.statusGreen,
      statusGray:   typeof ct.statusGray   === "boolean" ? ct.statusGray   : DEFAULT_CLEAR_TARGETS.statusGray,
      statusBlue:   typeof ct.statusBlue   === "boolean" ? ct.statusBlue   : DEFAULT_CLEAR_TARGETS.statusBlue,
    };
  }
  if (Array.isArray(raw.tags)) {
    out.tags = raw.tags.filter(d => typeof d === "string").map(d => String(d));
  }
  if (typeof raw.adminEnabled === "boolean") out.adminEnabled = raw.adminEnabled;
  if (typeof raw.adminTerminal === "boolean") out.adminTerminal = raw.adminTerminal;
  if (typeof raw.rosterPassphrase === "string") out.rosterPassphrase = raw.rosterPassphrase;
  if (typeof raw.deviceId === "string") out.deviceId = raw.deviceId;
  if (typeof raw.tagGroupingEnabled === "boolean") out.tagGroupingEnabled = raw.tagGroupingEnabled;
  if (Array.isArray(raw.tagGroups)) {
    out.tagGroups = raw.tagGroups
      .filter(g => g && typeof g === "object" && typeof g.id === "string")
      .map(g => ({
        id: String(g.id),
        name: String(g.name || ""),
        mode: g.mode === "single" ? "single" : "multi",
      }));
  }
  if (Array.isArray(raw.formatGroups)) {
    out.formatGroups = raw.formatGroups
      .filter(g => g && typeof g === "object" && typeof g.id === "string")
      .map(g => ({
        id: String(g.id),
        name: String(g.name || ""),
        formatIds: Array.isArray(g.formatIds)
          ? g.formatIds.filter(x => typeof x === "string").map(String)
          : [],
      }));
  }
  if (raw.tagGroupAssign && typeof raw.tagGroupAssign === "object") {
    out.tagGroupAssign = {};
    for (const [k, v] of Object.entries(raw.tagGroupAssign)) {
      if (typeof k === "string" && typeof v === "string") out.tagGroupAssign[k] = v;
    }
  }
  return out;
}

// ============================
// Patient helpers
// ============================

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function makeDefaultPatient() {
  return {
    pid: newId(),
    status: STATUS.NONE,
    name: "",
    room: "",
    tags: [],
    s: "",
    memo: "",
    shared: "",
    oFree: "",
    a: { text: "" },
    p: { text: "" },
    updatedAt: 0,
    // 他ワークスペースへ移動した時に立つマーカー。元データ (name / room) は触らず、
    // 表示・ソート時のみ装飾する。
    //   transferredAt: 移動した時刻 (ms epoch)。0 = 未移動。
    //   transferredTo: 移動先ワークスペースの label (表示用)。
    transferredAt: 0,
    transferredTo: "",
    // この患者で active なフォーマットグループ ID。null = 通常 (= 全 pin チップ
    // が見える)。設定されている場合、各パネルの strip はそのグループに属する
    // フォーマットだけを表示する (= 患者固有の「お気に入り切替」)。
    activeFormatGroupId: "",
  };
}

// 「空患者」= 開いた直後の未使用スロット相当: ステータスが NONE (白) で、かつ name/room/
// tags/SOAP/memo/shared/oFree がすべて初期値（pid と updatedAt は無視）。
// YELLOW/GREEN/BLUE/GRAY はユーザーが明示的にステータスを付けた状態なので、たとえ他の
// フィールドが空でも「触れたボタン」と見なし削除対象外（特に GRAY は「診察・カルテ記載
// 終了」の重要マーカーなので消してはならない）。
export function isPatientEmpty(p) {
  if (!p) return false;
  if (p.status !== STATUS.NONE) return false;
  if (p.name) return false;
  if (p.room) return false;
  if (Array.isArray(p.tags) && p.tags.length > 0) return false;
  if (p.s) return false;
  if (p.memo) return false;
  if (p.shared) return false;
  if (p.oFree) return false;
  if (p.a && p.a.text) return false;
  if (p.p && p.p.text) return false;
  // 「移動済」マーカーが立っているスロットは履歴として残してあるので空ではない
  if (p.transferredAt) return false;
  return true;
}

const VALID_STATUSES = [STATUS.NONE, STATUS.YELLOW, STATUS.GREEN, STATUS.GRAY, STATUS.BLUE];

function normalizePatientArray(arr) {
  const len = (arr && arr.length) ? arr.length : DEFAULT_PATIENT_COUNT;
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    const r = arr ? arr[i] : null;
    const d = makeDefaultPatient();
    // 未知フィールド温存 (forward compatibility): 旧バージョンが新版で追加された
    // フィールドを読み戻し → 再保存する経路で、未知フィールドが消失しないようにする。
    // r をまず spread し、その後 known フィールドを validation 付きで上書きする。
    // (未知フィールドの妥当性は保証しないので、誤フィールドや混入データもそのまま
    //  保持されることに留意。パイロット前は許容範囲)
    const base = (r && typeof r === "object") ? { ...r } : {};
    out[i] = {
      ...base,
      pid: (r && typeof r.pid === "string" && r.pid) ? r.pid : d.pid,
      status: (r && typeof r.status === "string" && VALID_STATUSES.includes(r.status)) ? r.status : d.status,
      name: (r && typeof r.name === "string") ? r.name : d.name,
      room: (r && typeof r.room === "string") ? r.room : d.room,
      tags: (r && Array.isArray(r.tags))
        ? r.tags.filter(t => typeof t === "string" && t.trim()).map(t => String(t))
        : [],
      s: (r && typeof r.s === "string") ? r.s : d.s,
      memo: (r && typeof r.memo === "string") ? r.memo : d.memo,
      shared: (r && typeof r.shared === "string") ? r.shared : d.shared,
      oFree: (r && typeof r.oFree === "string") ? r.oFree : d.oFree,
      a: { text: (r && r.a && typeof r.a.text === "string") ? r.a.text : d.a.text },
      p: { text: (r && r.p && typeof r.p.text === "string") ? r.p.text : d.p.text },
      updatedAt: (r && typeof r.updatedAt === "number") ? r.updatedAt : 0,
      transferredAt: (r && typeof r.transferredAt === "number") ? r.transferredAt : 0,
      transferredTo: (r && typeof r.transferredTo === "string") ? r.transferredTo : "",
      activeFormatGroupId: (r && typeof r.activeFormatGroupId === "string") ? r.activeFormatGroupId : "",
    };
  }
  return out;
}

// import-export.js から呼ばれる。bundle 形式 / 配列 / { patients: [...] } の
// いずれかを appState 形に正規化する薄いラッパ。
export function normalizeLoaded(raw) {
  const arr = raw && raw.patients && Array.isArray(raw.patients) ? raw.patients : (Array.isArray(raw) ? raw : null);
  return {
    v: 3,
    title: (raw && typeof raw.title === "string") ? raw.title : "回診",
    patients: normalizePatientArray(arr),
  };
}

// ============================
// Roster meta normalization
// ============================

function isMeaningfulRosterMeta(rm) {
  if (!rm) return false;
  if (rm.rosterId) return true;
  if (rm.baseSnapshot) return true;
  if (Array.isArray(rm.commits) && rm.commits.length) return true;
  if (rm.head) return true;
  return false;
}

export function normalizeRosterMeta(raw) {
  if (!raw || typeof raw !== "object") return null;
  const out = {
    rosterId: typeof raw.rosterId === "string" ? raw.rosterId : "",
    baseSnapshot: (raw.baseSnapshot && typeof raw.baseSnapshot === "object") ? raw.baseSnapshot : null,
    commits: Array.isArray(raw.commits) ? raw.commits : [],
    head: typeof raw.head === "string" ? raw.head : null,
  };
  return isMeaningfulRosterMeta(out) ? out : null;
}

// ============================
// Live bindings
// (ES module live bindings — setters allow reassignment)
// ============================

export let settings = defaultSettings();
export let appState = { v: 3, title: "回診", patients: normalizePatientArray(null) };
export let rosterState = null;          // populated lazily when roster features are used
export let selectedNo = 1;

export function setAppState(s) { appState = s; }
export function setRosterState(r) { rosterState = r; }
export function setSettings(s) { settings = s; }
export function setSelectedNo(n) { selectedNo = n; }

// ============================
// Persistence
// ============================

function applyBundleToLive(bundle) {
  if (!bundle) return;
  const sSettings = getSection(bundle, SECTION.SETTINGS);
  const sPatients = getSection(bundle, SECTION.PATIENTS);
  const sHistory = getSection(bundle, SECTION.HISTORY);

  // title は端末固定 (localStorage)。bundle.sections.meta.title は出力時の
  // 体裁のためだけに保持される (workspace 切替で title を上書きしない)。
  const deviceTitle = getDeviceAppTitle();

  settings = normalizeSettings(sSettings || {});
  appState = {
    v: 3,
    // device title が未設定 (= 初回起動) なら i18n 循環回避のためベタ書きで "回診"
    title: deviceTitle || "回診",
    patients: normalizePatientArray(Array.isArray(sPatients) ? sPatients : null),
  };
  rosterState = normalizeRosterMeta({
    rosterId: bundle.rosterId,
    baseSnapshot: sHistory ? sHistory.baseSnapshot : null,
    commits: sHistory ? sHistory.commits : [],
    head: sHistory ? sHistory.head : null,
  });
}

// device-wide title を書き換え & live state へ反映。caller は UI を再描画する責務。
export function updateDeviceTitle(title) {
  const t = String(title || "");
  appState.title = t || "回診";
  setDeviceAppTitle(t);
}

// Async hydration. main.js must `await initStore()` before rendering anything
// that reads state. Subsequent calls are idempotent (the promise is memoized).
//
// Tests can pass `{ bundle: rawFixture }` to inject state directly without
// touching the storage backend. `parseBundle` runs on raw input so both bundle
// format and legacy {appState, settings} shapes are accepted.
let _initPromise = null;

export function initStore(opts) {
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    let bundle = null;
    if (opts && opts.bundle) {
      try { bundle = parseBundle(opts.bundle); }
      catch (e) { console.warn("initStore: seed parse failed:", e); }
    } else {
      try { bundle = await storageLoad(); }
      catch (e) { console.warn("initStore: storage load failed:", e); }
    }
    applyBundleToLive(bundle);
  })();
  return _initPromise;
}

// テスト用: 次の initStore() を再実行できるよう内部状態をリセットする。
// 通常コードからは呼ばない。
export function _resetInitForTests() {
  _initPromise = null;
}

let saveTimer = null;

export function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveNow(); }, 180);
}

// async になったが「fire and forget」呼び出しが多いので返り値を await する
// 義務はない。内部 try/catch で失敗は console に出すだけ。
export async function saveNow() {
  saveTimer = null;
  try {
    await storageSave(projectBundle({ appState, rosterState, settings }));
  } catch (e) {
    console.error("save failed:", e);
  }
}

// beforeunload / visibilitychange="hidden" で呼ぶ用。debounce 中のセーブを
// 即時実行に切り替える。IDB トランザクションは microtask レベルで開始すれば
// page hide 中も完了することが多い (Chrome / Safari)。
export function flushSavePending() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
    // 戻り値は捨てる。unload 経路で await できないため fire and forget
    saveNow();
  }
}

// ============================
// Workspace 切替・作成
// ============================
//
// switchWorkspace(targetId):
//   1) 現在のアクティブを debounce 中のものも含めて確実に保存
//   2) アクティブポインタを切替
//   3) 新しいワークスペースを IDB から読み込み live state に適用
//   4) re-render は caller の責務 (= main.js が wire したコールバック経由)
//
// 切替自体は async で 100ms 程度。ユーザ視点では「タップしたらぱっと中身が
// 入れ替わる」体験になる。
export async function switchWorkspace(targetId) {
  if (!targetId) throw new Error("switchWorkspace: targetId required");
  // 1) 現アクティブを必ず保存
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    await storageSave(projectBundle({ appState, rosterState, settings }));
  } catch (e) {
    console.error("save before switch failed:", e);
  }
  // 2) ポインタ切替
  setActiveWorkspaceId(targetId);
  // 3) ロード + 適用
  let bundle = null;
  try { bundle = await storageLoad(targetId); }
  catch (e) { console.warn("load after switch failed:", e); }
  applyBundleToLive(bundle);
  // 切替で notify
  if (_onWorkspaceChanged) {
    try { _onWorkspaceChanged(targetId); } catch (_) {}
  }
}

// 空の新規ワークスペースを作成し、そのワークスペースに切替える。
// label はユーザが画面で入力した名前。
export async function createWorkspace(label) {
  // 1) 現アクティブを保存
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    await storageSave(projectBundle({ appState, rosterState, settings }));
  } catch (e) {
    console.error("save before create failed:", e);
  }
  // 2) 空の bundle を構築 (default 50 患者 + 既定 settings)
  const emptyAppState = { v: 3, title: "回診", patients: normalizePatientArray(null) };
  const emptyBundle = projectBundle({
    appState: emptyAppState,
    rosterState: null,
    settings: defaultSettings(),
  });
  // 3) IDB に新規エントリを作成
  const newId = await createWorkspaceRecord(label, emptyBundle);
  // 4) アクティブを切替えて live state に適用
  setActiveWorkspaceId(newId);
  applyBundleToLive(parseBundle(emptyBundle));
  if (_onWorkspaceChanged) {
    try { _onWorkspaceChanged(newId); } catch (_) {}
  }
  return newId;
}

let _onWorkspaceChanged = null;
export function setOnWorkspaceChanged(fn) { _onWorkspaceChanged = fn; }

// Settings is part of the same bundle now, so saving settings rewrites the
// whole snapshot. The function name is kept so existing call sites don't have
// to change.
export async function saveSettings() {
  return saveNow();
}

// Legacy compat: returns the clinical-only appState. Roster meta and settings
// have already been loaded into their own live bindings during module init.
export function load() {
  return appState;
}

// iOS Safari 等の eviction を抑制（PWA インストール時に true を返すことが多い）。
// 失敗しても挙動には影響しないので best-effort で呼ぶだけ。
export function requestStoragePersistence() {
  if (navigator.storage && typeof navigator.storage.persist === "function") {
    navigator.storage.persist().catch(() => {});
  }
}

let _onMarkUpdated = null;
export function setMarkUpdatedHandler(fn) { _onMarkUpdated = fn; }

export function markUpdated(no) {
  const p = appState.patients[no - 1];
  if (!p) return;
  p.updatedAt = Date.now();
  if (_onMarkUpdated) _onMarkUpdated(no);
}
