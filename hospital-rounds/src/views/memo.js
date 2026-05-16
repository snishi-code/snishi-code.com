"use strict";

import { appState, selectedNo, markUpdated, scheduleSave } from "../store.js";
import { bindLongPressAndDrag, onPatientDrop, openActionMenu } from "../features/drag.js";
import { syncDetailMemoDisplay } from "../features/navigation.js";

let _editMode = false;

export function setMemoEditMode(val) { _editMode = !!val; }
export function getMemoEditMode() { return _editMode; }

export function renderMemoScreen(renderHomeFn, opts, navigateToPatientFn) {
  const memoListHost = document.getElementById("memoListHost");
  if (!memoListHost) return;
  const len = appState.patients.length;
  const limit = opts && typeof opts.limit === "number" ? Math.max(0, Math.min(len, opts.limit)) : len;
  memoListHost.textContent = "";
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= limit; i++) {
    const p = appState.patients[i - 1];
    const row = document.createElement("div");
    row.className = "memoRow";

    if (_editMode) {
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
      row.appendChild(numInp);
    } else {
      const numBtn = document.createElement("button");
      numBtn.type = "button";
      numBtn.className = "memoNoBtn secondary";
      const displayName = p?.name ? p.name : String(i);
      numBtn.textContent = displayName;
      numBtn.title = displayName;
      bindLongPressAndDrag(
        numBtn,
        () => appState.patients.indexOf(p),
        onPatientDrop,
        openActionMenu,
        navigateToPatientFn ? () => navigateToPatientFn(i) : null
      );
      row.appendChild(numBtn);
    }

    const inp = document.createElement("input");
    inp.type = "text";
    inp.autocomplete = "off";
    inp.maxLength = 200;
    inp.value = String(appState.patients[i - 1]?.memo ?? "");
    inp.addEventListener("input", () => {
      appState.patients[i - 1].memo = String(inp.value ?? "");
      markUpdated(appState.patients.indexOf(p) + 1);
      scheduleSave();
      if (selectedNo === appState.patients.indexOf(p) + 1) syncDetailMemoDisplay();
    });
    row.appendChild(inp);
    frag.appendChild(row);
  }
  memoListHost.appendChild(frag);
}
