"use strict";

import { appState, settings, saveSettings, saveNow } from "../store.js";
import { utf8ByteLength } from "../payload.js";
import { encryptText, decryptText } from "./crypto.js";
import {
  ensureRoster, currentRosterView, rebuildRoster, applyRosterView,
  canApplyChain, commitsToApply, appendCommits, flushCommit,
  getCommitsWithinWindow,
} from "./roster.js";
import { ROSTER_DIFF_WINDOW_DAYS } from "../constants.js";

const MAX_BYTES_PER_PAGE = 700;
const PAGE_HEAD_RE = /==ROSTER\s+(FULL|DIFF)\s+(\d+)\/(\d+)\s+(\S+)==/g;

// ============================
// Mode helpers
// ============================

export function isAdminEnabled() { return !!settings.adminEnabled; }
export function isAdminTerminal() { return !!settings.adminTerminal; }
export function isAdminImportOnly() { return !!settings.adminImportOnly; }
export function isNonAdminTerminal() {
  return isAdminEnabled() && !isAdminTerminal() && !isAdminImportOnly();
}

export function canEditPatientFields() {
  if (!isAdminEnabled()) return true;
  if (isAdminTerminal() || isAdminImportOnly()) return true;
  return false;
}
export function canFillEmptyName() { return true; }
export function canEditORule(rule) {
  if (!isAdminEnabled() || isAdminTerminal() || isAdminImportOnly()) return true;
  return !rule?.fromAdmin;
}
export function canDeleteORule(rule) { return canEditORule(rule); }

// ============================
// Payload schema
//
// Plaintext (before encryption) for FULL:
//   {"kind":"full","rosterId":"...","ts":...,"baseTs":...,"base":{...view...},"commits":[...]}
//
// Plaintext for DIFF:
//   {"kind":"diff","rosterId":"...","fromTs":...,"toTs":...,"commits":[...]}
//
// Encrypted (base64) is then split across pages with header:
//   ==ROSTER FULL p/n <rosterId>==
//   <payload chunk>
//   ==ROSTER FULL p/n <rosterId>==
//   <next chunk>
// ============================

function chunkString(s, maxBytes) {
  // Split by approximate byte size; tolerate that re-joined chunks restore the original
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

// ============================
// Build pages (admin terminal side)
// ============================

export async function buildFullPages(passphrase) {
  ensureRoster();
  // Ensure pending edits are committed
  flushCommit();
  const view = rebuildRoster();
  const body = {
    kind: "full",
    rosterId: appState.rosterId,
    ts: Date.now(),
    baseTs: appState.baseSnapshot?.ts || 0,
    base: view,
    commits: [], // full = snapshot only; commits start fresh on receiver from this view
  };
  const plaintext = JSON.stringify(body);
  const enc = await encryptText(plaintext, passphrase, appState.rosterId);
  return { pages: makePages("FULL", enc, appState.rosterId), bytes: utf8ByteLength(enc) };
}

export async function buildDiffPages(passphrase, windowDays = ROSTER_DIFF_WINDOW_DAYS) {
  ensureRoster();
  flushCommit();
  const commits = getCommitsWithinWindow(windowDays);
  const body = {
    kind: "diff",
    rosterId: appState.rosterId,
    fromTs: commits.length ? commits[0].ts : Date.now(),
    toTs: Date.now(),
    commits,
  };
  const plaintext = JSON.stringify(body);
  const enc = await encryptText(plaintext, passphrase, appState.rosterId);
  return { pages: makePages("DIFF", enc, appState.rosterId), bytes: utf8ByteLength(enc), count: commits.length };
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
  if (!markers.length) return { ok: false, error: "名簿QRが見つかりません" };

  const groups = new Map(); // rosterId -> { kind, total, pages: Map<page, body> }
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
  // Take the first roster group (single roster per session expected)
  const [rosterId, g] = groups.entries().next().value;
  const missing = [];
  for (let p = 1; p <= g.total; p++) if (!g.pages.has(p)) missing.push(p);
  if (missing.length) return { ok: false, error: `ページが不足: ${missing.join(", ")} / ${g.total}` };
  let combined = "";
  for (let p = 1; p <= g.total; p++) combined += g.pages.get(p);
  return { ok: true, kind: g.kind, rosterId, encrypted: combined };
}

export async function decodeRosterPayload(parsed, passphrase) {
  let plaintext;
  try {
    plaintext = await decryptText(parsed.encrypted, passphrase, parsed.rosterId);
  } catch (e) {
    return { ok: false, error: e.message || "復号失敗" };
  }
  let body;
  try { body = JSON.parse(plaintext); }
  catch (_) { return { ok: false, error: "ペイロード解析失敗" }; }
  return { ok: true, body };
}

// ============================
// Apply (receiver side)
// ============================

export function applyFullPayload(body) {
  ensureRoster();
  appState.rosterId = body.rosterId;
  appState.baseSnapshot = {
    ts: body.baseTs || body.ts || Date.now(),
    patients: body.base.patients.map(p => ({ ...p, tags: (p.tags || []).slice() })),
    tags: (body.base.tags || []).slice(),
  };
  appState.commits = [];
  appState.head = null;
  applyRosterView(body.base);
  saveNow();
}

export function applyDiffPayload(body) {
  ensureRoster();
  if (body.rosterId !== appState.rosterId) {
    return { ok: false, error: "別の名簿のQRです（ID不一致）。フルダンプから取込んでください。" };
  }
  const fresh = commitsToApply(body.commits || []);
  if (!fresh.length) return { ok: true, applied: 0, message: "既に最新です" };
  const chain = canApplyChain(fresh);
  if (!chain.ok) {
    return { ok: false, error: `欠落しているコミットがあります（${ROSTER_DIFF_WINDOW_DAYS}日以上の更新差。フルダンプで再取込してください）` };
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
