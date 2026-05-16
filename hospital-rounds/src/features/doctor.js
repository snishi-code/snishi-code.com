"use strict";

import { settings, appState, markUpdated, scheduleSave } from "../store.js";

export function isDoctorEnabled() {
  return !!settings.doctorEnabled;
}

export function getDoctors() {
  return Array.isArray(settings.doctors)
    ? settings.doctors.filter(d => typeof d === "string" && d.trim()).map(d => d.trim())
    : [];
}

export function makeDoctorSelect(patientIndex, onChange) {
  const sel = document.createElement("select");
  sel.className = "doctorSelect";
  const cur = String(appState.patients[patientIndex]?.doctor ?? "");
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "—";
  sel.appendChild(blank);
  const doctors = getDoctors();
  let found = false;
  for (const d of doctors) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    if (d === cur) { opt.selected = true; found = true; }
    sel.appendChild(opt);
  }
  if (!found && cur) {
    const opt = document.createElement("option");
    opt.value = cur;
    opt.textContent = cur;
    opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    appState.patients[patientIndex].doctor = String(sel.value ?? "");
    markUpdated(patientIndex + 1);
    scheduleSave();
    if (onChange) onChange();
  });
  return sel;
}
