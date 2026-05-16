"use strict";

import { appState, selectedNo, markUpdated, scheduleSave } from "../store.js";
import { bindLongPressAndDrag, onPatientDrop, openActionMenu } from "../features/drag.js";
import { syncDetailMemoDisplay } from "../features/navigation.js";
import { isTagsEnabled, makePatientTagPicker, makeSharedTagFilterPicker, patientMatchesSharedFilter } from "../features/tags.js";
import { isRoomEnabled, makeRoomInput, formatPatientLabel } from "../features/room.js";
import { isNonAdminTerminal } from "../features/admin.js";
import { recordOp } from "../features/roster.js";
import { statusClass } from "./home.js";

let _editMode = false;

export function setMemoEditMode(val) { _editMode = !!val; }
export function getMemoEditMode() { return _editMode; }

function renderMemoTagFilter(rerender) {
  const slot = document.getElementById("memoTagFilterSlot");
  if (!slot) return;
  slot.textContent = "";
  if (!isTagsEnabled()) {
    slot.style.display = "none";
    return;
  }
  slot.style.display = "";
  slot.appendChild(makeSharedTagFilterPicker(rerender));
}

function renderMemoSortBtn() {
  const btn = document.getElementById("memoRoomSortBtn");
  if (!btn) return;
  btn.style.display = (isRoomEnabled() && !isNonAdminTerminal()) ? "" : "none";
}

export function renderMemoScreen(renderHomeFn, opts, navigateToPatientFn) {
  const rerender = () => renderMemoScreen(renderHomeFn, opts, navigateToPatientFn);
  renderMemoTagFilter(rerender);
  renderMemoSortBtn();
  const memoListHost = document.getElementById("memoListHost");
  if (!memoListHost) return;
  const len = appState.patients.length;
  const limit = opts && typeof opts.limit === "number" ? Math.max(0, Math.min(len, opts.limit)) : len;
  memoListHost.textContent = "";
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
        const next = String(numInp.value ?? "");
        const cur = appState.patients[i - 1];
        if (cur.name !== next) {
          cur.name = next;
          if (cur.pid) recordOp({ type: "update", pid: cur.pid, field: "name", value: next });
        }
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
      numBtn.className = "memoNoBtn secondary " + statusClass(p.status);
      const displayName = formatPatientLabel(p, String(i));
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
