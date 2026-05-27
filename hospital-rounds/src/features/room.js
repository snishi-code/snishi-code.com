"use strict";

import { appState, settings, markUpdated, scheduleSave, saveNow } from "../store.js";
import { recordOp } from "./roster.js";
import { t } from "../i18n.js";

export function getPatientRoom(patientIndex) {
  const p = appState.patients[patientIndex];
  return String(p?.room ?? "");
}

function sanitizeRoomInput(s) {
  return String(s ?? "").replace(/[^0-9]/g, "");
}

export function makeRoomInput(patientIndex, onChange) {
  const inp = document.createElement("input");
  inp.type = "text";
  inp.inputMode = "numeric";
  inp.pattern = "[0-9]*";
  inp.className = "roomInput";
  inp.maxLength = 6;
  inp.value = getPatientRoom(patientIndex);
  inp.addEventListener("input", () => {
    const cleaned = sanitizeRoomInput(inp.value);
    if (cleaned !== inp.value) inp.value = cleaned;
    const p = appState.patients[patientIndex];
    if (!p) return;
    if (p.room !== cleaned) {
      p.room = cleaned;
      if (p.pid) recordOp({ type: "update", pid: p.pid, field: "room", value: cleaned });
    }
    markUpdated(patientIndex + 1);
    scheduleSave();
    if (onChange) onChange();
  });
  return inp;
}

export function formatPatientLabel(p, fallback) {
  const name = (p && p.name) ? p.name : (fallback || "");
  const room = String(p?.room ?? "").trim();
  const base = room ? `${room} ${name}` : name;
  // 移動済マーカーが立っていれば prefix で視覚的に区別。元 name は触らない (表示のみ)
  if (p && p.transferredAt) return `${t("move.namePrefix")} ${base}`;
  return base;
}

function patientRoomCompare(a, b) {
  // 移動済 (transferredAt > 0) は常に末尾グループに押し出す。
  // 同じ「移動済」同士は通常の比較に落とす (移動が古い順 / room 順)。
  const at = !!(a && a.transferredAt);
  const bt = !!(b && b.transferredAt);
  if (at !== bt) return at ? 1 : -1;
  const ar = String(a.room ?? "").trim();
  const br = String(b.room ?? "").trim();
  if (ar && br) {
    const ai = parseInt(ar, 10);
    const bi = parseInt(br, 10);
    if (!isNaN(ai) && !isNaN(bi)) return ai - bi;
    return ar.localeCompare(br);
  }
  if (ar) return -1;
  if (br) return 1;
  return 0;
}

// True if a transient pre-sort snapshot exists (sort button is "active/colored")
export function isRoomSortActive() {
  return Array.isArray(appState._sortSnapshot) && appState._sortSnapshot.length > 0;
}

// Drop the snapshot (called when any data mutation invalidates the prior order)
export function invalidateSortSnapshot() {
  if (appState._sortSnapshot) {
    appState._sortSnapshot = null;
  }
}

// Toggle: 1st tap = sort and remember order. 2nd tap (no edits between) = restore.
export function toggleSortByRoom() {
  // Restore
  if (isRoomSortActive()) {
    const pids = appState._sortSnapshot;
    const byPid = new Map(appState.patients.map(p => [p.pid, p]));
    const restored = [];
    for (const pid of pids) {
      const p = byPid.get(pid);
      if (p) { restored.push(p); byPid.delete(pid); }
    }
    // Anything not in the snapshot (added since) goes at the end
    for (const p of byPid.values()) restored.push(p);
    const before = appState.patients.slice();
    appState.patients = restored;
    appState._sortSnapshot = null;
    for (let i = 0; i < appState.patients.length; i++) {
      const p = appState.patients[i];
      if (before[i] !== p && p.pid) recordOp({ type: "move", pid: p.pid, to: i });
    }
    saveNow();
    return;
  }
  // Apply sort
  appState._sortSnapshot = appState.patients.map(p => p.pid);
  const before = appState.patients.slice();
  appState.patients.sort(patientRoomCompare);
  for (let i = 0; i < appState.patients.length; i++) {
    const p = appState.patients[i];
    if (before[i] !== p && p.pid) recordOp({ type: "move", pid: p.pid, to: i });
  }
  saveNow();
}

// Back-compat alias used by main.js
export const sortPatientsByRoom = toggleSortByRoom;
