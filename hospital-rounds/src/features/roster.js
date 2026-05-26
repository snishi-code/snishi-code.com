"use strict";

// Roster commit log (Git-like, linear). Tracks structural changes only:
// patient name/room/tags + add/delete/move + setting.tags list.
// Does NOT track clinical data (SOAP, memo, shared, vitals, status).
//
// The roster state (rosterId / baseSnapshot / commits / head) lives in its
// own module-level binding (store.js: rosterState). It is created lazily —
// devices that never enable the admin/sync features keep it null and never
// emit roster fields in their exports.

import {
  appState, settings, rosterState, setRosterState,
  saveSettings, scheduleSave, makeDefaultPatient,
} from "../store.js";
import { ROSTER_DIFF_WINDOW_DAYS } from "../constants.js";

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function getDeviceId() {
  if (!settings.deviceId) {
    settings.deviceId = newId();
    saveSettings();
  }
  return settings.deviceId;
}

// "Roster view" = the parts of state that are synced via commits.
export function currentRosterView() {
  return {
    patients: appState.patients.map(p => ({
      pid: p.pid,
      name: String(p.name || ""),
      room: String(p.room || ""),
      tags: Array.isArray(p.tags) ? p.tags.slice() : [],
    })),
    tags: Array.isArray(settings.tags) ? settings.tags.slice() : [],
  };
}

// Initialize rosterState if absent. Called by the few entry points that
// genuinely need a roster (admin payload building, diff replay, op recording
// while admin is enabled).
export function ensureRosterState() {
  let changed = false;
  for (const p of appState.patients) {
    if (!p.pid) { p.pid = newId(); changed = true; }
  }
  if (!rosterState) {
    const snap = currentRosterView();
    snap.ts = Date.now();
    setRosterState({
      rosterId: newId(),
      baseSnapshot: snap,
      commits: [],
      head: null,
    });
    changed = true;
  } else {
    if (!rosterState.rosterId) { rosterState.rosterId = newId(); changed = true; }
    if (!rosterState.baseSnapshot) {
      const snap = currentRosterView();
      snap.ts = Date.now();
      rosterState.baseSnapshot = snap;
      changed = true;
    }
    if (!Array.isArray(rosterState.commits)) {
      rosterState.commits = [];
      changed = true;
    }
  }
  return changed;
}

// Backward-compatible alias used by older call sites.
export const ensureRoster = ensureRosterState;

// ============================
// Op recording (batched into commits)
// ============================

let _pendingOps = [];
let _flushTimer = null;
const FLUSH_MS = 1500;

export function recordOp(op) {
  if (!op || !op.type) return;
  // The commit log is part of the admin/sync overlay. With admin disabled the
  // bundle stays free of roster fields — single-device users never accrue
  // this metadata.
  if (!settings.adminEnabled) return;
  _pendingOps.push(op);
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = setTimeout(flushCommit, FLUSH_MS);
}

function isSameTargetOp(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === "update") return a.pid === b.pid && a.field === b.field;
  return false;
}

function squashOps(ops) {
  // Collapse consecutive update ops on the same (pid, field) — keep last value
  const out = [];
  for (const op of ops) {
    if (out.length && isSameTargetOp(out[out.length - 1], op)) {
      out[out.length - 1] = op;
    } else {
      out.push(op);
    }
  }
  return out;
}

export function flushCommit() {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (!_pendingOps.length) return null;
  const ops = squashOps(_pendingOps);
  _pendingOps = [];
  if (!ops.length) return null;
  ensureRosterState();
  const commit = {
    id: newId(),
    parent: rosterState.head || null,
    ts: Date.now(),
    deviceId: getDeviceId(),
    ops,
  };
  rosterState.commits.push(commit);
  rosterState.head = commit.id;
  scheduleSave();
  return commit;
}

// ============================
// Apply ops to a roster view (pure)
// ============================

export function applyOpsToView(view, ops) {
  const v = {
    patients: view.patients.map(p => ({ ...p, tags: p.tags.slice() })),
    tags: view.tags.slice(),
  };
  for (const op of ops || []) {
    switch (op.type) {
      case "add": {
        const at = (typeof op.at === "number" && op.at >= 0 && op.at <= v.patients.length) ? op.at : v.patients.length;
        v.patients.splice(at, 0, {
          pid: op.patient?.pid || newId(),
          name: String(op.patient?.name || ""),
          room: String(op.patient?.room || ""),
          tags: Array.isArray(op.patient?.tags) ? op.patient.tags.slice() : [],
        });
        break;
      }
      case "delete": {
        const i = v.patients.findIndex(p => p.pid === op.pid);
        if (i >= 0) v.patients.splice(i, 1);
        break;
      }
      case "move": {
        const i = v.patients.findIndex(p => p.pid === op.pid);
        if (i < 0) break;
        const [p] = v.patients.splice(i, 1);
        const to = Math.max(0, Math.min(v.patients.length, op.to));
        v.patients.splice(to, 0, p);
        break;
      }
      case "update": {
        const i = v.patients.findIndex(p => p.pid === op.pid);
        if (i < 0) break;
        const p = v.patients[i];
        if (op.field === "name") p.name = String(op.value || "");
        else if (op.field === "room") p.room = String(op.value || "");
        else if (op.field === "tags") p.tags = Array.isArray(op.value) ? op.value.slice() : [];
        break;
      }
      case "tag.add": {
        if (op.name && !v.tags.includes(op.name)) v.tags.push(op.name);
        break;
      }
      case "tag.remove": {
        v.tags = v.tags.filter(t => t !== op.name);
        break;
      }
      case "tag.rename": {
        const i = v.tags.indexOf(op.from);
        if (i >= 0) v.tags[i] = op.to;
        for (const p of v.patients) {
          p.tags = p.tags.map(t => t === op.from ? op.to : t);
        }
        break;
      }
    }
  }
  return v;
}

// ============================
// Build / apply against local state
// ============================

// Rebuild canonical roster from baseSnapshot + commits
export function rebuildRoster() {
  ensureRosterState();
  let view = {
    patients: (rosterState.baseSnapshot?.patients || []).map(p => ({ ...p, tags: (p.tags || []).slice() })),
    tags: (rosterState.baseSnapshot?.tags || []).slice(),
  };
  for (const c of rosterState.commits) view = applyOpsToView(view, c.ops);
  return view;
}

// Apply a foreign roster view to local appState (preserves clinical data by pid)
export function applyRosterView(view) {
  const byPid = new Map();
  for (const p of appState.patients) byPid.set(p.pid, p);
  const result = view.patients.map(rp => {
    const local = byPid.get(rp.pid);
    if (local) {
      // Update roster fields, keep clinical data
      local.name = rp.name;
      local.room = rp.room;
      local.tags = rp.tags.slice();
      return local;
    }
    // New patient: blank clinical
    const np = makeDefaultPatient();
    np.pid = rp.pid;
    np.name = rp.name;
    np.room = rp.room;
    np.tags = rp.tags.slice();
    return np;
  });
  appState.patients = result;
  settings.tags = view.tags.slice();
  saveSettings();
  scheduleSave();
}

// ============================
// Commit selection (for diff QR)
// ============================

export function getCommitsWithinWindow(days = ROSTER_DIFF_WINDOW_DAYS) {
  if (!rosterState) return [];
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return rosterState.commits.filter(c => c.ts >= since);
}

// Given a list of foreign commits, return those not yet in local log
export function commitsToApply(foreignCommits) {
  const localIds = new Set((rosterState?.commits || []).map(c => c.id));
  return foreignCommits.filter(c => !localIds.has(c.id));
}

// Verify a sequence of commits chains to a known parent (or null) and is linear
export function canApplyChain(foreignCommits) {
  if (!foreignCommits.length) return { ok: true };
  const localIds = new Set((rosterState?.commits || []).map(c => c.id));
  const newIds = new Set(foreignCommits.map(c => c.id));
  for (const c of foreignCommits) {
    if (c.parent == null) continue; // base
    if (!localIds.has(c.parent) && !newIds.has(c.parent)) {
      return { ok: false, missing: c.parent };
    }
  }
  return { ok: true };
}

export function appendCommits(commits) {
  // Append in parent-order; assumes canApplyChain succeeded
  ensureRosterState();
  const localIds = new Set(rosterState.commits.map(c => c.id));
  for (const c of commits) {
    if (localIds.has(c.id)) continue;
    rosterState.commits.push(c);
    rosterState.head = c.id;
    localIds.add(c.id);
  }
  scheduleSave();
}

// ============================
// 30 日ローリング baseSnapshot (= roster の Git 風コンパクション)
//
// `commits[]` のうち `cutoff` より古いものを baseSnapshot に畳み込み、
// commits[] から落とす。`maxAgeDays` 日より古いデータは原則として
// 「再生できない」状態にすることで個人情報の長期保持を避ける。
//
// 通常はアプリ起動直後に一度呼ぶだけで足りる:
//   - 起動した日に古い commit があれば前進
//   - 1 日に何度起動しても idempotent (cutoff より古いものが既に無ければ何もしない)
// ============================
export function compactHistory(maxAgeDays = ROSTER_DIFF_WINDOW_DAYS) {
  if (!rosterState) return false;
  const commits = rosterState.commits;
  if (!Array.isArray(commits) || commits.length === 0) return false;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const oldCommits = commits.filter(c => typeof c.ts === "number" && c.ts < cutoff);
  if (oldCommits.length === 0) return false;
  // baseSnapshot に古い ops を順に適用
  let view = {
    patients: (rosterState.baseSnapshot?.patients || []).map(p => ({ ...p, tags: (p.tags || []).slice() })),
    tags: (rosterState.baseSnapshot?.tags || []).slice(),
  };
  for (const c of oldCommits) view = applyOpsToView(view, c.ops);
  rosterState.baseSnapshot = {
    patients: view.patients,
    tags: view.tags,
    ts: oldCommits[oldCommits.length - 1].ts,
  };
  rosterState.commits = commits.filter(c => !(typeof c.ts === "number" && c.ts < cutoff));
  // 折りたたんだ結果を次回の save で永続化させる
  scheduleSave();
  return true;
}
