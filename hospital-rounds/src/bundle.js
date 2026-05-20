"use strict";

// ============================
// Bundle format
//
// The Bundle is the canonical serialization shape for the app: it's used by
// JSON file exports, the localStorage snapshot, and (after encryption) the
// admin QR payload. The bundle is content-addressed by section so the same
// parser handles a full backup or a single-section transfer (memo-only,
// roster-only, etc.) — the UI only emits "full" today, but the structure is
// already in place for partial transfers.
//
// {
//   "format":     "hospital-rounds-bundle",
//   "schema":     1,
//   "appVersion": "1.0.0",
//   "exportedAt": "2026-05-20T09:24:00.000Z",
//   "owner":      { "deviceId": "...", "label": "" },
//   "rosterId":   "...",
//   "sections": {
//     "meta":     { "title": "..." },
//     "settings": { ... },
//     "patients": [ ...full clinical records... ],
//     "roster":   { patients: [{pid,name,room,tags}], tags: [...] },
//     "memo":     [ {pid, memo} ],
//     "shared":   [ {pid, shared} ],
//     "history":  { baseSnapshot, commits, head }
//   }
// }
// ============================

export const BUNDLE_FORMAT = "hospital-rounds-bundle";
export const BUNDLE_SCHEMA = 1;
export const BUNDLE_APP_VERSION = "1.0.0";

export const SECTION = Object.freeze({
  META: "meta",
  SETTINGS: "settings",
  PATIENTS: "patients",
  ROSTER: "roster",
  MEMO: "memo",
  SHARED: "shared",
  HISTORY: "history",
});

// Default sections written by the "save everything" preset (file export +
// localStorage snapshot). Derived sections (roster/memo/shared) are excluded
// because they are projections of patients — including them would just
// duplicate data.
export const FULL_BACKUP_SECTIONS = Object.freeze([
  SECTION.META, SECTION.SETTINGS, SECTION.PATIENTS, SECTION.HISTORY,
]);

function nowIso() {
  try { return new Date().toISOString(); } catch (_) { return ""; }
}

function projectRosterView(patients, tags) {
  return {
    patients: (patients || []).map(p => ({
      pid: String(p.pid || ""),
      name: String(p.name || ""),
      room: String(p.room || ""),
      tags: Array.isArray(p.tags) ? p.tags.slice() : [],
    })),
    tags: Array.isArray(tags) ? tags.slice() : [],
  };
}

// ============================
// Project: in-memory state -> bundle
// ============================

export function projectBundle({
  appState,
  rosterState,
  settings,
  sections = FULL_BACKUP_SECTIONS,
  owner,
  exportedAt,
}) {
  const want = new Set(sections);
  const out = {
    format: BUNDLE_FORMAT,
    schema: BUNDLE_SCHEMA,
    appVersion: BUNDLE_APP_VERSION,
    exportedAt: exportedAt != null ? exportedAt : nowIso(),
    owner: owner || { deviceId: settings?.deviceId || "", label: "" },
    rosterId: rosterState?.rosterId || "",
    sections: {},
  };

  if (want.has(SECTION.META)) {
    out.sections.meta = { title: String(appState?.title || "回診管理") };
  }
  if (want.has(SECTION.SETTINGS) && settings) {
    out.sections.settings = settings;
  }
  if (want.has(SECTION.PATIENTS) && appState?.patients) {
    out.sections.patients = appState.patients;
  }
  if (want.has(SECTION.ROSTER) && appState?.patients) {
    out.sections.roster = projectRosterView(appState.patients, settings?.tags);
  }
  if (want.has(SECTION.MEMO) && appState?.patients) {
    out.sections.memo = appState.patients
      .filter(p => p && p.pid && p.memo)
      .map(p => ({ pid: p.pid, memo: p.memo }));
  }
  if (want.has(SECTION.SHARED) && appState?.patients) {
    out.sections.shared = appState.patients
      .filter(p => p && p.pid && p.shared)
      .map(p => ({ pid: p.pid, shared: p.shared }));
  }
  if (want.has(SECTION.HISTORY) && rosterState && (
    rosterState.baseSnapshot
    || (Array.isArray(rosterState.commits) && rosterState.commits.length)
    || rosterState.head
  )) {
    out.sections.history = {
      baseSnapshot: rosterState.baseSnapshot || null,
      commits: Array.isArray(rosterState.commits) ? rosterState.commits : [],
      head: rosterState.head || null,
    };
  }
  return out;
}

// ============================
// Parse: raw -> bundle
// Accepts the new bundle format and the legacy { appState, settings } /
// bare-appState shapes that earlier versions emitted.
// ============================

export function parseBundle(raw) {
  if (!raw || typeof raw !== "object") {
    throw new Error("invalid bundle: not an object");
  }
  if (raw.format === BUNDLE_FORMAT && raw.sections && typeof raw.sections === "object") {
    return normalizeBundle(raw);
  }
  // Legacy { appState, settings }
  if (raw.appState && typeof raw.appState === "object") {
    return legacyToBundle(raw.appState, (raw.settings && typeof raw.settings === "object") ? raw.settings : null);
  }
  // Bare appState (earliest versions)
  if (Array.isArray(raw.patients) || raw.v === 2 || raw.v === 3) {
    return legacyToBundle(raw, null);
  }
  throw new Error("unknown file format");
}

function normalizeBundle(b) {
  return {
    format: BUNDLE_FORMAT,
    schema: typeof b.schema === "number" ? b.schema : BUNDLE_SCHEMA,
    appVersion: typeof b.appVersion === "string" ? b.appVersion : "",
    exportedAt: typeof b.exportedAt === "string" ? b.exportedAt : "",
    owner: (b.owner && typeof b.owner === "object")
      ? { deviceId: String(b.owner.deviceId || ""), label: String(b.owner.label || "") }
      : { deviceId: "", label: "" },
    rosterId: typeof b.rosterId === "string" ? b.rosterId : "",
    sections: { ...b.sections },
  };
}

function legacyToBundle(legacyAppState, legacySettings) {
  const sections = {};
  if (legacyAppState.title) sections.meta = { title: String(legacyAppState.title) };
  if (legacySettings && typeof legacySettings === "object") sections.settings = legacySettings;
  if (Array.isArray(legacyAppState.patients)) sections.patients = legacyAppState.patients;
  const hasHistory = legacyAppState.baseSnapshot
    || (Array.isArray(legacyAppState.commits) && legacyAppState.commits.length)
    || legacyAppState.head;
  if (hasHistory) {
    sections.history = {
      baseSnapshot: legacyAppState.baseSnapshot || null,
      commits: Array.isArray(legacyAppState.commits) ? legacyAppState.commits : [],
      head: typeof legacyAppState.head === "string" ? legacyAppState.head : null,
    };
  }
  return {
    format: BUNDLE_FORMAT,
    schema: BUNDLE_SCHEMA,
    appVersion: "",
    exportedAt: "",
    owner: { deviceId: String(legacySettings?.deviceId || ""), label: "" },
    rosterId: String(legacyAppState.rosterId || ""),
    sections,
  };
}

// ============================
// Section accessors
// ============================

export function getSection(bundle, key) {
  return bundle && bundle.sections ? bundle.sections[key] : undefined;
}

export function hasSection(bundle, key) {
  return !!(bundle && bundle.sections && Object.prototype.hasOwnProperty.call(bundle.sections, key));
}

// Forward-looking helper: future partial-import flows will use this to merge
// a bundle's section into a patients array by pid. Today only export uses
// projectBundle, so this is unused, but defining it now keeps the contract
// stable.
export function mergeMemoSection(patients, memoSection) {
  if (!Array.isArray(memoSection)) return 0;
  let n = 0;
  for (const entry of memoSection) {
    if (!entry || typeof entry.pid !== "string") continue;
    const p = patients.find(x => x && x.pid === entry.pid);
    if (!p) continue;
    p.memo = String(entry.memo || "");
    n++;
  }
  return n;
}

export function mergeSharedSection(patients, sharedSection) {
  if (!Array.isArray(sharedSection)) return 0;
  let n = 0;
  for (const entry of sharedSection) {
    if (!entry || typeof entry.pid !== "string") continue;
    const p = patients.find(x => x && x.pid === entry.pid);
    if (!p) continue;
    p.shared = String(entry.shared || "");
    n++;
  }
  return n;
}
