"use strict";

import {
  DEFAULT_PATIENT_COUNT, STATUS,
  DEFAULT_FORMATS, LEGACY_O_RULES, FORMAT_PANELS, FORMAT_TYPES,
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

// 新モデル: item は kind ごとに必要なフィールドだけ持つ。
//   text     : { label, kind:"text",     normal }
//   number   : { label, kind:"number",   unit   }
//   fraction : { label, kind:"fraction", unit   }
//   date     : { label, kind:"date",     normal }   // normal = memo prefill
// 旧モデルでは format 全体が type:"text"|"numeric" を持ち、item には kind が無かった。
// fallbackKind は旧 format.type からの移行用ヒント。
function normalizeFormatItem(item, fallbackKind) {
  if (!item || typeof item !== "object") return null;
  const label = String(item.label ?? "").trim();
  // text item は label が空でも正常文だけのケース (規定文「著変なし」など) を許容
  const kindRaw = (typeof item.kind === "string" && FORMAT_ITEM_KINDS.includes(item.kind))
    ? item.kind
    : (fallbackKind || DEFAULT_ITEM_KIND);
  if (!label && kindRaw !== "text") return null;
  const out = { label, kind: kindRaw };
  if (kindRaw === "number" || kindRaw === "fraction") {
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
  // 旧 format.type → 全 item の fallback kind に変換
  const legacyType = FORMAT_TYPES.includes(raw.type) ? raw.type : null;
  const fallbackKind = legacyType === "numeric" ? "number"
                     : legacyType === "text"    ? "text"
                     : DEFAULT_ITEM_KIND;
  const id = (typeof raw.id === "string" && raw.id) ? raw.id : newFormatId();
  const items = Array.isArray(raw.items)
    ? raw.items.map(it => normalizeFormatItem(it, fallbackKind)).filter(Boolean)
    : [];
  // joiner 既定値: 旧 type==="text" は "\n"、それ以外は ", "
  const joiner = typeof raw.joiner === "string" ? raw.joiner : (legacyType === "text" ? "\n" : ", ");
  // labelSep: 明示指定優先、なければ items から推定
  const labelSep = typeof raw.labelSep === "string" ? raw.labelSep : inferLabelSepFromItems(items);
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter(t => typeof t === "string" && t.trim()).map(t => String(t))
    : [];
  const pinned = !!raw.pinned;
  const isDefault = !!raw.isDefault;
  return { id, name, panel, joiner, labelSep, tags, pinned, isDefault, items };
}

function normalizeSettings(raw) {
  const out = defaultSettings();
  if (!raw || typeof raw !== "object") return out;
  // 旧 oRules はマイグレーション時のみ参照する。新 settings には書き戻さない。
  // formats: 新規登録された設定。空または欠落ならデフォルトを採用。
  if (Array.isArray(raw.formats)) {
    const cleaned = raw.formats.map(normalizeFormat).filter(Boolean);
    if (cleaned.length) out.formats = cleaned;
  }

  // 旧 settings.defaults.{s,a,p} を text 型 isDefault フォーマットへ 1 回マイグレーション
  // 旧キー: defaults.s = "" / defaults.a = "著変なし" / defaults.p = "現行加療継続" 等
  if (raw.defaults && typeof raw.defaults === "object") {
    const panelOf = { s: "S", a: "A", p: "P" };
    for (const k of ["s", "a", "p"]) {
      const txt = String(raw.defaults[k] ?? "").trim();
      if (!txt) continue;
      if (txt === "変わりありません" || txt === "（変わりありません）") continue; // 旧旧
      const panel = panelOf[k];
      const alreadyHasDefault = out.formats.some(f => f.panel === panel && f.isDefault);
      if (alreadyHasDefault) continue;
      out.formats.push({
        id: newFormatId(),
        name: "規定文",
        panel,
        joiner: "\n",
        labelSep: DEFAULT_LABEL_SEP_TEXT,
        tags: [],
        pinned: false,
        isDefault: true,
        items: [{ label: "", kind: "text", normal: txt }],
      });
    }
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
  } else if (Array.isArray(raw.doctors)) {
    out.tags = raw.doctors.filter(d => typeof d === "string").map(d => String(d));
  }
  if (typeof raw.adminEnabled === "boolean") out.adminEnabled = raw.adminEnabled;
  if (typeof raw.adminTerminal === "boolean") out.adminTerminal = raw.adminTerminal;
  // 旧 adminImportOnly フラグは v2.4 で廃止。読み捨て (true なら adminTerminal を有効化して
  // 編集可能な状態を維持し、ユーザー体験の後退を防ぐ。)
  if (raw.adminImportOnly === true) out.adminTerminal = true;
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
  return true;
}

// ============================
// 旧データ (v1: patient.o[key]={normal,note} + patient.vitals) → oFree テキスト化
//
// 旧 O 構造体 / バイタル構造体は v2 以降撤去。読込時に 1 回だけ寄せて oFree 末尾に
// 結合する。oRulesFromBundle が渡されればそのラベル/正常文を優先、無ければ
// LEGACY_O_RULES (既定) を使う。
// ============================
function migrateLegacyOandVitalsToText(r, oRulesFromBundle) {
  const out = [];

  // 1) Vitals → "BP 128/76mmHg, P 72, SpO2 95% (条件), RR 18, T 36.8℃" のような 1 行
  if (r && r.vitals && typeof r.vitals === "object") {
    const v = r.vitals;
    const vParts = [];
    if (v.spo2 || v.spo2_memo) {
      let s = v.spo2 ? `SpO2 ${v.spo2}%` : `SpO2 ${v.spo2_memo}`;
      if (v.spo2 && v.spo2_memo) s += ` (${v.spo2_memo})`;
      vParts.push(s);
    }
    if (v.rr) vParts.push(`RR ${v.rr}`);
    if (v.bp_sys || v.bp_dia) vParts.push(`BP ${v.bp_sys || ""}/${v.bp_dia || ""}mmHg`);
    if (v.pr) vParts.push(`P ${v.pr}`);
    if (v.bt) vParts.push(`BT ${v.bt}℃`);
    if (vParts.length) out.push(vParts.join(", "));
  }

  // 2) Structured o → ラベルごとに 1 行
  if (r && r.o && typeof r.o === "object") {
    const rules = (Array.isArray(oRulesFromBundle) && oRulesFromBundle.length)
      ? oRulesFromBundle
      : LEGACY_O_RULES;
    // バックワード互換: abd1/abd2 を旧データから一行にまとめる
    const seen = new Set();
    for (const rule of rules) {
      const key = rule.key;
      seen.add(key);
      const item = r.o[key];
      if (!item || typeof item !== "object") continue;
      const note = String(item.note ?? "").trim();
      if (note) out.push(`${rule.label}：${note}`);
      else if (item.normal) out.push(`${rule.label}：${rule.normalText || ""}`);
    }
    // abd1/abd2 (旧キー) を腹部にまとめて出す
    const abd1 = r.o.abd1, abd2 = r.o.abd2;
    const extras = [];
    if (abd1 && abd1.note && String(abd1.note).trim()) extras.push(String(abd1.note).trim());
    if (abd2 && abd2.note && String(abd2.note).trim()) extras.push(String(abd2.note).trim());
    if (extras.length) out.push(`腹部：${extras.join(" / ")}`);
  }

  return out.join("\n");
}

function migrateLegacyPatientToOFree(r, oRulesFromBundle) {
  const migrated = migrateLegacyOandVitalsToText(r, oRulesFromBundle);
  const existing = (r && typeof r.oFree === "string") ? r.oFree : "";
  if (!migrated.trim()) return existing;
  if (!existing.trim()) return migrated;
  return migrated + "\n" + existing;
}

// パッチ: 旧バンドル読込時に settings.oRules も読み出して migration に渡せるよう保持
let _migrationORulesContext = null;
function rememberMigrationContext(rawSettings) {
  _migrationORulesContext = (rawSettings && Array.isArray(rawSettings.oRules))
    ? rawSettings.oRules.filter(r => r && typeof r === "object" && r.key && r.label).map(r => ({
        key: String(r.key),
        label: String(r.label),
        normalText: String(r.normalText ?? ""),
      }))
    : null;
}

function normalizePatientArray(arr) {
  const len = (arr && arr.length) ? arr.length : DEFAULT_PATIENT_COUNT;
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    const r = arr ? arr[i] : null;
    const d = makeDefaultPatient();
    out[i] = {
      pid: (r && typeof r.pid === "string" && r.pid) ? r.pid : d.pid,
      status: (r && typeof r.status === "string" && [STATUS.NONE, STATUS.YELLOW, STATUS.GREEN, STATUS.GRAY].includes(r.status)) ? r.status : d.status,
      name: (r && typeof r.name === "string") ? r.name : d.name,
      room: (r && typeof r.room === "string") ? r.room : (r && typeof r.room === "number" ? String(r.room) : d.room),
      tags: (r && Array.isArray(r.tags))
        ? r.tags.filter(t => typeof t === "string" && t.trim()).map(t => String(t))
        : (r && typeof r.doctor === "string" && r.doctor.trim()) ? [r.doctor.trim()] : [],
      s: (r && typeof r.s === "string") ? r.s : d.s,
      memo: (r && typeof r.memo === "string") ? r.memo : d.memo,
      shared: (r && typeof r.shared === "string") ? r.shared : d.shared,
      // 旧 patient.vitals / patient.o を 1 回だけ oFree に流し込む
      oFree: migrateLegacyPatientToOFree(r, _migrationORulesContext),
      a: { text: (r && r.a && typeof r.a.text === "string") ? r.a.text : d.a.text },
      p: { text: (r && r.p && typeof r.p.text === "string") ? r.p.text : d.p.text },
      updatedAt: (r && typeof r.updatedAt === "number") ? r.updatedAt : 0,
    };
  }
  return out;
}

// Kept for backward compatibility with import-export.js. Trims roster fields:
// caller is responsible for handling history/rosterId via normalizeRosterMeta.
export function normalizeLoaded(raw) {
  const arr = raw && raw.patients && Array.isArray(raw.patients) ? raw.patients : (Array.isArray(raw) ? raw : null);
  return {
    v: 3,
    title: (raw && typeof raw.title === "string") ? raw.title : "回診",
    patients: normalizePatientArray(arr),
  };
}

// 後方互換のためのスタブ。旧 O 構造体を撤去したため何もしない。
// 呼び出し側 (drag.js 等) は引き続き呼ぶがコストはほぼゼロ。
export function ensurePatientsHaveAllOKeys() { /* no-op since v2 */ }

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
//
// settings must be declared first: normalizePatientArray → makeDefaultPatient
// → makeEmptyOByRules reads settings.oRules, and these run during appState
// initialization. Reordering would hit the Temporal Dead Zone.
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
  const sMeta = getSection(bundle, SECTION.META);
  const sHistory = getSection(bundle, SECTION.HISTORY);

  // 患者マイグレーション前に旧 oRules を退避 (label/normalText の正引きに使う)
  rememberMigrationContext(sSettings || {});

  settings = normalizeSettings(sSettings || {});
  appState = {
    v: 3,
    title: (sMeta && typeof sMeta.title === "string") ? sMeta.title : "回診",
    patients: normalizePatientArray(Array.isArray(sPatients) ? sPatients : null),
  };
  _migrationORulesContext = null;
  rosterState = normalizeRosterMeta({
    rosterId: bundle.rosterId,
    baseSnapshot: sHistory ? sHistory.baseSnapshot : null,
    commits: sHistory ? sHistory.commits : [],
    head: sHistory ? sHistory.head : null,
  });
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
