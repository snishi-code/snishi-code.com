"use strict";

import { appState, rosterState, setRosterState, settings, saveSettings, saveNow } from "../store.js";
import { utf8ByteLength } from "../payload.js";
import { encryptText, decryptText } from "./crypto.js";
import {
  ensureRosterState, currentRosterView, rebuildRoster, applyRosterView,
  canApplyChain, commitsToApply, appendCommits, flushCommit,
  getCommitsWithinWindow,
} from "./roster.js";
import { t } from "../i18n.js";
import { ROSTER_DIFF_WINDOW_DAYS } from "../constants.js";
import {
  BUNDLE_FORMAT, BUNDLE_SCHEMA, BUNDLE_APP_VERSION,
  SECTION, parseBundle, getSection, hasSection,
} from "../bundle.js";

const MAX_BYTES_PER_PAGE = 700;
const PAGE_HEAD_RE = /==ROSTER\s+(FULL|DIFF)\s+(\d+)\/(\d+)\s+(\S+)==/g;

// ============================
// Mode helpers
// ============================

export function isAdminEnabled() { return !!settings.adminEnabled; }
export function isAdminTerminal() { return !!settings.adminTerminal; }
// 「被管理端末」= 管理機能 ON だが当端末は管理側ではない（受信側）。脱出不可。
export function isNonAdminTerminal() {
  return isAdminEnabled() && !isAdminTerminal();
}

export function canEditPatientFields() {
  if (!isAdminEnabled()) return true;
  return isAdminTerminal();
}
export function canFillEmptyName() { return true; }
export function canEditORule(rule) {
  if (!isAdminEnabled() || isAdminTerminal()) return true;
  return !rule?.fromAdmin;
}
export function canDeleteORule(rule) { return canEditORule(rule); }

// ============================
// Payload schema
//
// The QR payload is a Bundle (subset). Two transfer kinds reuse the same
// envelope structure:
//
//   COPY (formerly "FULL"): sections.roster + sections.history.baseSnapshot.
//     Encrypted with the user-chosen 合言葉. Embeds rosterId at the top so
//     receivers can authenticate subsequent diffs without a passphrase.
//   DIFF:                     sections.history.commits.
//     Encrypted with rosterId itself — only terminals that already hold the
//     same roster can decrypt these without a prompt.
//
// The encrypted base64 is then split across pages with a header:
//   ==ROSTER FULL p/n <rosterId>==
//   <payload chunk>
//   ==ROSTER FULL p/n <rosterId>==
//   <next chunk>
//
// Older versions emitted a flat {kind:"full"|"diff", rosterId, base, commits}
// envelope. The parser below accepts both.
// ============================

function chunkString(s, maxBytes) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    let end = i + Math.floor(maxBytes); // 1 byte per char for base64
    if (end > s.length) end = s.length;
    out.push(s.slice(i, end));
    i = end;
  }
  return out;
}

function makePages(kind, encryptedBody, rosterId) {
  const chunks = chunkString(encryptedBody, MAX_BYTES_PER_PAGE);
  const total = chunks.length || 1;
  const safe = (chunks.length ? chunks : [""]);
  return safe.map((c, i) => `==ROSTER ${kind} ${i + 1}/${total} ${rosterId}==\n${c}`);
}

function nowIso() {
  try { return new Date().toISOString(); } catch (_) { return ""; }
}

function rosterCopyBundle(view, baseTs) {
  return {
    format: BUNDLE_FORMAT,
    schema: BUNDLE_SCHEMA,
    appVersion: BUNDLE_APP_VERSION,
    exportedAt: nowIso(),
    owner: { deviceId: settings.deviceId || "", label: "" },
    rosterId: rosterState?.rosterId || "",
    sections: {
      roster: {
        patients: view.patients.map(p => ({ ...p, tags: (p.tags || []).slice() })),
        tags: (view.tags || []).slice(),
      },
      history: {
        baseSnapshot: { ts: baseTs, ...view },
        commits: [],
        head: null,
      },
    },
  };
}

function rosterDiffBundle(commits) {
  return {
    format: BUNDLE_FORMAT,
    schema: BUNDLE_SCHEMA,
    appVersion: BUNDLE_APP_VERSION,
    exportedAt: nowIso(),
    owner: { deviceId: settings.deviceId || "", label: "" },
    rosterId: rosterState?.rosterId || "",
    sections: {
      history: {
        baseSnapshot: null,
        commits,
        head: commits.length ? commits[commits.length - 1].id : null,
      },
    },
  };
}

// ============================
// Build pages (originator / admin terminal side)
// ============================

export async function buildCopyPages(secret) {
  ensureRosterState();
  flushCommit();
  const view = rebuildRoster();
  const bundle = rosterCopyBundle(view, Date.now());
  const plaintext = JSON.stringify(bundle);
  const enc = await encryptText(plaintext, secret, "ROSTER-COPY");
  return { pages: makePages("FULL", enc, rosterState.rosterId), bytes: utf8ByteLength(enc) };
}
// Back-compat alias
export const buildFullPages = buildCopyPages;

export async function buildDiffPages(_unused, windowDays = ROSTER_DIFF_WINDOW_DAYS) {
  ensureRosterState();
  flushCommit();
  const commits = getCommitsWithinWindow(windowDays);
  const bundle = rosterDiffBundle(commits);
  const plaintext = JSON.stringify(bundle);
  // Use rosterId as the symmetric key for diff QRs—same roster terminals can decrypt automatically.
  const enc = await encryptText(plaintext, rosterState.rosterId, "ROSTER-DIFF");
  return { pages: makePages("DIFF", enc, rosterState.rosterId), bytes: utf8ByteLength(enc), count: commits.length };
}

// ============================
// Parse pasted text (receiver side)
// ============================

export function parseRosterPages(text) {
  const src = String(text || "");
  PAGE_HEAD_RE.lastIndex = 0;
  const markers = [];
  let m;
  while ((m = PAGE_HEAD_RE.exec(src)) !== null) {
    markers.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: m[1],
      page: parseInt(m[2], 10),
      total: parseInt(m[3], 10),
      rosterId: m[4],
    });
  }
  if (!markers.length) return { ok: false, error: t("admin.error.notFound") };

  const groups = new Map();
  for (let i = 0; i < markers.length; i++) {
    const mk = markers[i];
    const start = mk.end;
    const end = i + 1 < markers.length ? markers[i + 1].start : src.length;
    const body = src.slice(start, end).trim();
    if (!groups.has(mk.rosterId)) groups.set(mk.rosterId, { kind: mk.kind, total: mk.total, pages: new Map() });
    const g = groups.get(mk.rosterId);
    g.kind = mk.kind;
    g.total = Math.max(g.total, mk.total);
    g.pages.set(mk.page, body);
  }
  const [rosterId, g] = groups.entries().next().value;
  const missing = [];
  for (let p = 1; p <= g.total; p++) if (!g.pages.has(p)) missing.push(p);
  if (missing.length) return { ok: false, error: t("admin.error.missingPages", { missing: missing.join(", "), total: g.total }) };
  let combined = "";
  for (let p = 1; p <= g.total; p++) combined += g.pages.get(p);
  return { ok: true, kind: g.kind, rosterId, encrypted: combined };
}

// For COPY (kind=FULL): caller provides the 合言葉.
// For DIFF: caller provides the local rosterId.
export async function decodeRosterPayload(parsed, secret) {
  let plaintext;
  const salt = parsed.kind === "DIFF" ? "ROSTER-DIFF" : "ROSTER-COPY";
  try {
    plaintext = await decryptText(parsed.encrypted, secret, salt);
  } catch (e) {
    return { ok: false, error: e.message || t("admin.error.decryptFailed") };
  }
  let body;
  try { body = JSON.parse(plaintext); }
  catch (_) { return { ok: false, error: t("admin.error.parseFailed") }; }
  return { ok: true, body: normalizeRosterPayload(body, parsed.kind) };
}

// Convert either a bundle payload or the legacy flat envelope to a unified
// shape: { kind: "full"|"diff", rosterId, base?, commits?, baseTs? }
function normalizeRosterPayload(body, pageKind) {
  if (body && body.format === BUNDLE_FORMAT) {
    if (hasSection(body, SECTION.ROSTER)) {
      const roster = getSection(body, SECTION.ROSTER);
      const history = getSection(body, SECTION.HISTORY) || {};
      return {
        kind: "full",
        rosterId: body.rosterId,
        base: { patients: roster.patients || [], tags: roster.tags || [] },
        baseTs: history.baseSnapshot?.ts || 0,
        commits: [],
      };
    }
    const history = getSection(body, SECTION.HISTORY) || {};
    return {
      kind: "diff",
      rosterId: body.rosterId,
      commits: Array.isArray(history.commits) ? history.commits : [],
    };
  }
  // Legacy flat envelope (kind: "full" | "diff").
  return body;
}

// ============================
// Apply (receiver side)
// ============================

export function applyFullPayload(body) {
  setRosterState({
    rosterId: body.rosterId,
    baseSnapshot: {
      ts: body.baseTs || Date.now(),
      patients: body.base.patients.map(p => ({ ...p, tags: (p.tags || []).slice() })),
      tags: (body.base.tags || []).slice(),
    },
    commits: [],
    head: null,
  });
  applyRosterView(body.base);
  // 管理端末から名簿コピーを受け取ったら、自端末を被管理端末に固定する
  // （adminTerminal は false のまま、adminEnabled は true）。脱出不可。
  // 既に管理端末の場合は降格しない。
  if (!settings.adminTerminal) {
    settings.adminEnabled = true;
    saveSettings();
  }
  saveNow();
}

export function applyDiffPayload(body) {
  ensureRosterState();
  if (body.rosterId !== rosterState.rosterId) {
    return { ok: false, error: t("admin.error.idMismatch") };
  }
  const fresh = commitsToApply(body.commits || []);
  if (!fresh.length) return { ok: true, applied: 0, message: t("admin.status.alreadyLatest") };
  const chain = canApplyChain(fresh);
  if (!chain.ok) {
    return { ok: false, error: t("admin.error.missingCommits", { days: ROSTER_DIFF_WINDOW_DAYS }) };
  }
  appendCommits(fresh);
  const view = rebuildRoster();
  applyRosterView(view);
  saveNow();
  return { ok: true, applied: fresh.length };
}

// ============================
// Validation (admin terminal)
// ============================

export function findIncompleteAdminPatients() {
  if (!isAdminTerminal()) return [];
  const list = [];
  for (let i = 0; i < appState.patients.length; i++) {
    const p = appState.patients[i];
    const name = String(p.name || "").trim();
    if (!name) continue;
    const room = String(p.room || "").trim();
    const hasTags = Array.isArray(p.tags) && p.tags.length > 0;
    if (!room || !hasTags) list.push(i + 1);
  }
  return list;
}

export function clearIncompleteAdminPatients() {
  if (!isAdminTerminal()) return;
  for (let i = 0; i < appState.patients.length; i++) {
    const p = appState.patients[i];
    const name = String(p.name || "").trim();
    if (!name) continue;
    const room = String(p.room || "").trim();
    const hasTags = Array.isArray(p.tags) && p.tags.length > 0;
    if (!room || !hasTags) {
      p.name = "";
      p.room = "";
      p.tags = [];
    }
  }
  saveNow();
}
