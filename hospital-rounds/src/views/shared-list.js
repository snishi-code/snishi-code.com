"use strict";

import { appState, selectedNo, markUpdated, scheduleSave } from "../store.js";
import { bindLongPressAndDrag, onPatientDrop, openActionMenu } from "../features/drag.js";
import { isDoctorEnabled, makeDoctorSelect } from "../features/doctor.js";
import { isSharedQrActive, isPatientSelected, toggleSharedQrPatient } from "../features/qr-shared.js";
import { statusClass } from "./home.js";

let _editMode = false;

export function setSharedEditMode(val) { _editMode = !!val; }
export function getSharedEditMode() { return _editMode; }

export function renderSharedScreen(renderHomeFn, opts, navigateToPatientFn) {
  const sharedListHost = document.getElementById("sharedListHost");
  if (!sharedListHost) return;
  const len = appState.patients.length;
  const limit = opts && typeof opts.limit === "number" ? Math.max(0, Math.min(len, opts.limit)) : len;
  sharedListHost.textContent = "";
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= limit; i++) {
    const p = appState.patients[i - 1];
    const row = document.createElement("div");
    row.className = "memoRow";

    if (_editMode) {
      const nameWrap = document.createElement("div");
      nameWrap.className = "nameDoctorRow";
      const numInp = document.createElement("input");
      numInp.type = "text";
      numInp.className = "memoNoInp";
      numInp.placeholder = String(i);
      numInp.value = String(appState.patients[i - 1]?.name ?? "");
      bindLongPressAndDrag(numInp, () => appState.patients.indexOf(p), onPatientDrop, openActionMenu);
      numInp.addEventListener("input", () => {
        appState.patients[i - 1].name = String(numInp.value ?? "");
        markUpdated(appState.patients.indexOf(p) + 1);
        scheduleSave();
        if (renderHomeFn) renderHomeFn();
      });
      nameWrap.appendChild(numInp);
      if (isDoctorEnabled()) {
        nameWrap.appendChild(makeDoctorSelect(i - 1));
      }
      row.appendChild(nameWrap);
    } else {
      const numBtn = document.createElement("button");
      numBtn.type = "button";
      const qrActive = isSharedQrActive();
      numBtn.className = "memoNoBtn secondary " + statusClass(p.status);
      if (qrActive && !isPatientSelected(i)) numBtn.classList.add("unselected");
      const displayName = p?.name ? p.name : String(i);
      numBtn.textContent = displayName;
      numBtn.title = displayName;
      if (qrActive) {
        numBtn.addEventListener("click", () => toggleSharedQrPatient(i));
      } else {
        bindLongPressAndDrag(
          numBtn,
          () => appState.patients.indexOf(p),
          onPatientDrop,
          openActionMenu,
          navigateToPatientFn ? () => navigateToPatientFn(i) : null
        );
      }
      row.appendChild(numBtn);
    }

    const inp = document.createElement("textarea");
    inp.value = String(appState.patients[i - 1]?.shared ?? "");
    inp.addEventListener("input", () => {
      appState.patients[i - 1].shared = String(inp.value ?? "");
      markUpdated(appState.patients.indexOf(p) + 1);
      scheduleSave();
      if (selectedNo === appState.patients.indexOf(p) + 1) {
        const detailSharedText = document.getElementById("detailSharedText");
        if (detailSharedText) detailSharedText.value = appState.patients[i - 1].shared;
      }
    });
    row.appendChild(inp);
    frag.appendChild(row);
  }
  sharedListHost.appendChild(frag);
}
