"use strict";

import { appState, settings, markUpdated, scheduleSave, saveNow } from "../store.js";

export function isRoomEnabled() {
  return !!settings.roomEnabled;
}

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
    if (!appState.patients[patientIndex]) return;
    appState.patients[patientIndex].room = cleaned;
    markUpdated(patientIndex + 1);
    scheduleSave();
    if (onChange) onChange();
  });
  return inp;
}

export function formatPatientLabel(p, fallback) {
  const name = (p && p.name) ? p.name : (fallback || "");
  const room = String(p?.room ?? "").trim();
  return room ? `${room} ${name}` : name;
}

// Sort patients by room number ascending; empty rooms go last
export function sortPatientsByRoom() {
  appState.patients.sort((a, b) => {
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
  });
  saveNow();
}
