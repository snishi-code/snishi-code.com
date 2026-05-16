"use strict";

import { STORAGE_KEY, SETTINGS_KEY, DEFAULT_PATIENT_COUNT, STATUS, DEFAULT_O_RULES, DEFAULT_CLEAR_TARGETS, DEFAULT_TAGS, DEFAULT_TAGS_ENABLED, DEFAULT_ROOM_ENABLED, clone } from "./constants.js";

// ============================
// Settings
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
    tagsEnabled: DEFAULT_TAGS_ENABLED,
    tags: clone(DEFAULT_TAGS),
    roomEnabled: DEFAULT_ROOM_ENABLED,
  };
}

export function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    if (!s) return defaultSettings();
    const raw = JSON.parse(s);
    const out = defaultSettings();
    if (raw && raw.defaults && typeof raw.defaults === "object") {
      out.defaults.s = (typeof raw.defaults.s === "string") ? raw.defaults.s : out.defaults.s;
      if (raw.defaults.s === "変わりありません" || raw.defaults.s === "（変わりありません）") {
        out.defaults.s = "";
      }
      out.defaults.a = (typeof raw.defaults.a === "string") ? raw.defaults.a : out.defaults.a;
      out.defaults.p = (typeof raw.defaults.p === "string") ? raw.defaults.p : out.defaults.p;
    }
    if (raw && Array.isArray(raw.oRules)) {
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
          placeholder: String(r.placeholder ?? ""),
        });
      }
      if (cleaned.length) out.oRules = cleaned;
    }
    if (raw && raw.clearTargets && typeof raw.clearTargets === "object") {
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
    if (raw && typeof raw.tagsEnabled === "boolean") out.tagsEnabled = raw.tagsEnabled;
    else if (raw && typeof raw.doctorEnabled === "boolean") out.tagsEnabled = raw.doctorEnabled;
    if (raw && Array.isArray(raw.tags)) {
      out.tags = raw.tags.filter(d => typeof d === "string").map(d => String(d));
    } else if (raw && Array.isArray(raw.doctors)) {
      out.tags = raw.doctors.filter(d => typeof d === "string").map(d => String(d));
    }
    if (raw && typeof raw.roomEnabled === "boolean") out.roomEnabled = raw.roomEnabled;
    return out;
  } catch (e) {
    console.warn("settings load failed:", e);
    return defaultSettings();
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn("settings save failed:", e);
  }
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
// Mutable shared state
// (ES module live bindings — setters allow reassignment)
// ============================

export let appState = { v: 2, patients: [] };
export let settings = loadSettings();
export let selectedNo = 1;

export function setAppState(s) { appState = s; }
export function setSettings(s) { settings = s; }
export function setSelectedNo(n) { selectedNo = n; }

let saveTimer = null;
let lastSavedAt = 0;

// ============================
// Patient data helpers
// ============================

export function makeDefaultPatient() {
  return {
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

export function normalizeLoaded(raw) {
  const out = { v: 2, title: "回診", patients: [] };
  if (raw && typeof raw.title === "string") out.title = raw.title;
  const arr = raw && raw.patients && Array.isArray(raw.patients) ? raw.patients : (Array.isArray(raw) ? raw : null);
  const len = arr ? arr.length : DEFAULT_PATIENT_COUNT;
  out.patients = new Array(len);
  for (let i = 0; i < len; i++) {
    const r = arr ? arr[i] : null;
    const d = makeDefaultPatient();
    out.patients[i] = {
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
// Persistence
// ============================

export function load() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return normalizeLoaded(null);
    return normalizeLoaded(JSON.parse(s));
  } catch (e) {
    console.warn("load failed:", e);
    return normalizeLoaded(null);
  }
}

export function scheduleSave() {
  const saveChip = document.getElementById("saveChip");
  if (saveChip) saveChip.textContent = "保存: 入力中…";
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 180);
}

export function saveNow() {
  saveTimer = null;
  const saveChip = document.getElementById("saveChip");
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    lastSavedAt = Date.now();
    if (saveChip) saveChip.textContent = "保存: 済 (" + new Date(lastSavedAt).toLocaleTimeString() + ")";
  } catch (e) {
    console.error("save failed:", e);
    if (saveChip) saveChip.textContent = "保存: 失敗";
  }
}

export function markUpdated(no) {
  const p = appState.patients[no - 1];
  if (!p) return;
  p.updatedAt = Date.now();
}
