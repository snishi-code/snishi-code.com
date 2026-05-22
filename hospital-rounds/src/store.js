"use strict";

import {
  DEFAULT_PATIENT_COUNT, STATUS,
  DEFAULT_O_RULES, DEFAULT_CLEAR_TARGETS, DEFAULT_TAGS,
  DEFAULT_ADMIN_ENABLED, DEFAULT_ADMIN_TERMINAL,
  DEFAULT_ROSTER_PASSPHRASE, DEFAULT_TAG_GROUPING_ENABLED,
  clone,
} from "./constants.js";
import { projectBundle, getSection, SECTION } from "./bundle.js";
import { loadBundle as storageLoad, saveBundle as storageSave } from "./storage.js";

// ============================
// Settings defaults & normalization
// ============================

export function defaultSettings() {
  return {
    v: 1,
    defaults: {
      s: "",
      a: "著変なし",
      p: "現行加療継続",
    },
    oRules: clone(DEFAULT_O_RULES),
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

function normalizeSettings(raw) {
  const out = defaultSettings();
  if (!raw || typeof raw !== "object") return out;
  if (raw.defaults && typeof raw.defaults === "object") {
    out.defaults.s = (typeof raw.defaults.s === "string") ? raw.defaults.s : out.defaults.s;
    if (raw.defaults.s === "変わりありません" || raw.defaults.s === "（変わりありません）") {
      out.defaults.s = "";
    }
    out.defaults.a = (typeof raw.defaults.a === "string") ? raw.defaults.a : out.defaults.a;
    out.defaults.p = (typeof raw.defaults.p === "string") ? raw.defaults.p : out.defaults.p;
  }
  if (Array.isArray(raw.oRules)) {
    const cleaned = [];
    for (const r of raw.oRules) {
      if (!r || typeof r !== "object") continue;
      const key = String(r.key ?? "").trim();
      const label = String(r.label ?? "").trim();
      if (!key || !label) continue;
      if (key === "vital") continue;
      cleaned.push({
        key,
        label,
        normalText: String(r.normalText ?? ""),
        fromAdmin: !!r.fromAdmin,
      });
    }
    if (cleaned.length) out.oRules = cleaned;
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

export function oRuleMap() {
  const m = Object.create(null);
  for (const r of settings.oRules) m[r.key] = r;
  return m;
}

export function makeEmptyOByRules() {
  const o = Object.create(null);
  for (const r of settings.oRules) {
    o[r.key] = { normal: false, note: "" };
  }
  return o;
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
    vitals: { spo2: "", spo2_memo: "", rr: "", bp_sys: "", bp_dia: "", pr: "", bt: "" },
    o: makeEmptyOByRules(),
    oFree: "",
    a: { text: "" },
    p: { text: "" },
    updatedAt: 0,
  };
}

// 「空患者」= 開いた直後の未使用スロット相当: ステータスが NONE (白) で、かつ name/room/
// tags/SOAP/memo/shared/vitals/o/oFree がすべて初期値（pid と updatedAt は無視）。
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
  const v = p.vitals || {};
  if (v.spo2 || v.spo2_memo || v.rr || v.bp_sys || v.bp_dia || v.pr || v.bt) return false;
  if (p.o && typeof p.o === "object") {
    for (const k of Object.keys(p.o)) {
      const item = p.o[k];
      if (!item) continue;
      if (item.normal) return false;
      if (item.note) return false;
    }
  }
  return true;
}

function coerceOItem(x) {
  if (!x || typeof x !== "object") return { normal: false, note: "" };
  return { normal: !!x.normal, note: String(x.note ?? "") };
}

function migrateLegacyO(r) {
  const out = makeEmptyOByRules();
  if (!r || !r.o || typeof r.o !== "object") return out;

  for (const key of Object.keys(out)) {
    if (r.o && typeof r.o[key] === "object" && r.o[key]) out[key] = coerceOItem(r.o[key]);
  }

  if (typeof r.o.lung === "object" && r.o.lung) out["lung"] = coerceOItem(r.o.lung);
  if (typeof r.o.bowel === "object" && r.o.bowel) out["bowel"] = coerceOItem(r.o.bowel);

  const abd1 = (typeof r.o.abd1 === "object" && r.o.abd1) ? coerceOItem(r.o.abd1) : null;
  const abd2 = (typeof r.o.abd2 === "object" && r.o.abd2) ? coerceOItem(r.o.abd2) : null;
  const abdomen = out["abdomen"] ? coerceOItem(out["abdomen"]) : { normal: false, note: "" };
  const abdNotes = [];
  if (abd1 && abd1.note.trim()) abdNotes.push(abd1.note.trim());
  if (abd2 && abd2.note.trim()) abdNotes.push(abd2.note.trim());
  if (!abdomen.note.trim() && abdNotes.length) {
    abdomen.note = abdNotes.join(" / ");
    abdomen.normal = false;
  } else if (!abdomen.note.trim()) {
    const anyNormal = (abd1 && abd1.normal) || (abd2 && abd2.normal);
    abdomen.normal = abdomen.normal || !!anyNormal;
  }
  out["abdomen"] = abdomen;

  if (out["edema"] && typeof r.o.edema === "object" && r.o.edema) out["edema"] = coerceOItem(r.o.edema);

  return out;
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
      vitals: {
        spo2: (r && r.vitals && typeof r.vitals.spo2 === "string") ? r.vitals.spo2 : d.vitals.spo2,
        spo2_memo: (r && r.vitals && typeof r.vitals.spo2_memo === "string") ? r.vitals.spo2_memo : d.vitals.spo2_memo,
        rr: (r && r.vitals && typeof r.vitals.rr === "string") ? r.vitals.rr : d.vitals.rr,
        bp_sys: (r && r.vitals && typeof r.vitals.bp_sys === "string") ? r.vitals.bp_sys : d.vitals.bp_sys,
        bp_dia: (r && r.vitals && typeof r.vitals.bp_dia === "string") ? r.vitals.bp_dia : d.vitals.bp_dia,
        pr: (r && r.vitals && typeof r.vitals.pr === "string") ? r.vitals.pr : d.vitals.pr,
        bt: (r && r.vitals && typeof r.vitals.bt === "string") ? r.vitals.bt : d.vitals.bt,
      },
      o: migrateLegacyO(r),
      oFree: (r && typeof r.oFree === "string") ? r.oFree : d.oFree,
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

export function ensurePatientsHaveAllOKeys() {
  const keys = settings.oRules.map(r => r.key);
  for (const p of appState.patients) {
    if (!p.o || typeof p.o !== "object") p.o = Object.create(null);
    for (const k of keys) {
      if (!p.o[k]) p.o[k] = { normal: false, note: "" };
    }
  }
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

  settings = normalizeSettings(sSettings || {});
  appState = {
    v: 3,
    title: (sMeta && typeof sMeta.title === "string") ? sMeta.title : "回診",
    patients: normalizePatientArray(Array.isArray(sPatients) ? sPatients : null),
  };
  rosterState = normalizeRosterMeta({
    rosterId: bundle.rosterId,
    baseSnapshot: sHistory ? sHistory.baseSnapshot : null,
    commits: sHistory ? sHistory.commits : [],
    head: sHistory ? sHistory.head : null,
  });
}

// Module-init load: hydrate from storage before any other module reads state.
applyBundleToLive(storageLoad());

let saveTimer = null;

export function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 180);
}

export function saveNow() {
  saveTimer = null;
  try {
    storageSave(projectBundle({ appState, rosterState, settings }));
  } catch (e) {
    console.error("save failed:", e);
  }
}

// Settings is part of the same bundle now, so saving settings rewrites the
// whole snapshot. The function name is kept so existing call sites don't have
// to change.
export function saveSettings() {
  saveNow();
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
