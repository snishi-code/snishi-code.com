"use strict";

import { appState, selectedNo, markUpdated, scheduleSave } from "../store.js";
import { bindLongPressAndDrag, onPatientDrop, openActionMenu } from "../features/drag.js";
import { isTagsEnabled, makePatientTagPicker, makeSharedTagFilterPicker, patientMatchesSharedFilter } from "../features/tags.js";
import { isRoomEnabled, makeRoomInput, formatPatientLabel } from "../features/room.js";
import { isSharedQrActive, isPatientSelected, toggleSharedQrPatient } from "../features/qr-shared.js";
import { statusClass } from "./home.js";

let _editMode = false;

export function setSharedEditMode(val) { _editMode = !!val; }
export function getSharedEditMode() { return _editMode; }

function renderSharedTagFilter(rerender) {
  const slot = document.getElementById("sharedTagFilterSlot");
  if (!slot) return;
  slot.textContent = "";
  if (!isTagsEnabled()) {
    slot.style.display = "none";
    return;
  }
  slot.style.display = "";
  slot.appendChild(makeSharedTagFilterPicker(rerender));
}

function renderSharedSortBtn() {
  const btn = document.getElementById("sharedRoomSortBtn");
  if (!btn) return;
  btn.style.display = isRoomEnabled() ? "" : "none";
}

export function renderSharedScreen(renderHomeFn, opts, navigateToPatientFn) {
  const rerender = () => renderSharedScreen(renderHomeFn, opts, navigateToPatientFn);
  renderSharedTagFilter(rerender);
  renderSharedSortBtn();
  const sharedListHost = document.getElementById("sharedListHost");
  if (!sharedListHost) return;
  const len = appState.patients.length;
  const limit = opts && typeof opts.limit === "number" ? Math.max(0, Math.min(len, opts.limit)) : len;
  sharedListHost.textContent = "";
  const frag = document.createDocumentFragment();
  const tagsEnabled = isTagsEnabled();
  const roomEnabled = isRoomEnabled();
  for (let i = 1; i <= limit; i++) {
    const p = appState.patients[i - 1];
    if (tagsEnabled && !patientMatchesSharedFilter(p)) continue;
    const row = document.createElement("div");
    row.className = "memoRow";

    if (_editMode) {
      const nameWrap = document.createElement("div");
      nameWrap.className = "nameDoctorRow";
      if (roomEnabled) {
        nameWrap.appendChild(makeRoomInput(i - 1, () => {
          if (renderHomeFn) renderHomeFn();
        }));
      }
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
      if (isTagsEnabled()) {
        nameWrap.appendChild(makePatientTagPicker(i - 1));
      }
      row.appendChild(nameWrap);
    } else {
      const numBtn = document.createElement("button");
      numBtn.type = "button";
      const qrActive = isSharedQrActive();
      numBtn.className = "memoNoBtn secondary " + statusClass(p.status);
      if (qrActive && !isPatientSelected(i)) numBtn.classList.add("unselected");
      const displayName = formatPatientLabel(p, String(i));
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
