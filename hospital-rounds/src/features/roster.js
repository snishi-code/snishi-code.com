"use strict";

// Roster commit log (Git-like, linear). Tracks structural changes only:
// patient name/room/tags + add/delete/move + setting.tags list.
// Does NOT track clinical data (SOAP, memo, shared, vitals, status).

import { appState, settings, saveSettings, scheduleSave, makeDefaultPatient } from "../store.js";
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

export function ensureRoster() {
  let changed = false;
  for (const p of appState.patients) {
    if (!p.pid) { p.pid = newId(); changed = true; }
  }
  if (!appState.rosterId) {
    appState.rosterId = newId();
    changed = true;
  }
  if (!appState.baseSnapshot) {
    appState.baseSnapshot = currentRosterView();
    appState.baseSnapshot.ts = Date.now();
    changed = true;
  }
  if (!Array.isArray(appState.commits)) {
    appState.commits = [];
    changed = true;
  }
  return changed;
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

// ============================
// Op recording (batched into commits)
// ============================

let _pendingOps = [];
let _flushTimer = null;
const FLUSH_MS = 1500;

export function recordOp(op) {
  if (!op || !op.type) return;
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
  ensureRoster();
  const commit = {
    id: newId(),
    parent: appState.head || null,
    ts: Date.now(),
    deviceId: getDeviceId(),
    ops,
  };
  appState.commits.push(commit);
  appState.head = commit.id;
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
  ensureRoster();
  let view = {
    patients: (appState.baseSnapshot?.patients || []).map(p => ({ ...p, tags: (p.tags || []).slice() })),
    tags: (appState.baseSnapshot?.tags || []).slice(),
  };
  for (const c of appState.commits) view = applyOpsToView(view, c.ops);
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
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return appState.commits.filter(c => c.ts >= since);
}

// Given a list of foreign commits, return those not yet in local log
export function commitsToApply(foreignCommits) {
  const localIds = new Set(appState.commits.map(c => c.id));
  return foreignCommits.filter(c => !localIds.has(c.id));
}

// Verify a sequence of commits chains to a known parent (or null) and is linear
export function canApplyChain(foreignCommits) {
  if (!foreignCommits.length) return { ok: true };
  const localIds = new Set(appState.commits.map(c => c.id));
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
  const localIds = new Set(appState.commits.map(c => c.id));
  for (const c of commits) {
    if (localIds.has(c.id)) continue;
    appState.commits.push(c);
    appState.head = c.id;
    localIds.add(c.id);
  }
  scheduleSave();
}
