"use strict";

import { appState } from "../store.js";
import { STATUS } from "../constants.js";
import { bindLongPressAndDrag, onPatientDrop, openActionMenu } from "../features/drag.js";
import { isTagsEnabled, makeSharedTagFilterPicker, patientMatchesSharedFilter } from "../features/tags.js";
import { isRoomEnabled, formatPatientLabel } from "../features/room.js";
import { isNonAdminTerminal } from "../features/admin.js";

export function statusClass(status) {
  if (status === STATUS.YELLOW) return "status-yellow";
  if (status === STATUS.GREEN) return "status-green";
  if (status === STATUS.GRAY) return "status-gray";
  if (status === STATUS.BLUE) return "status-blue";
  return "";
}

function countGreen() {
  let c = 0;
  for (const p of appState.patients) if (p.status === STATUS.GREEN) c++;
  return c;
}

export function updateCountChip() {
  const countChip = document.getElementById("countChip");
  if (!countChip) return;
  countChip.textContent = "緑: " + countGreen() + " / " + appState.patients.length;
}

function renderHomeTagFilter(onChange) {
  const slot = document.getElementById("homeTagFilterSlot");
  if (!slot) return;
  slot.textContent = "";
  if (!isTagsEnabled()) {
    slot.style.display = "none";
    return;
  }
  slot.style.display = "";
  const picker = makeSharedTagFilterPicker(onChange);
  slot.appendChild(picker);
}

function renderHomeSortBtn() {
  const btn = document.getElementById("homeRoomSortBtn");
  if (!btn) return;
  btn.style.display = (isRoomEnabled() && !isNonAdminTerminal()) ? "" : "none";
}

export function renderHome(onPatientClick) {
  renderHomeTagFilter(() => renderHome(onPatientClick));
  renderHomeSortBtn();
  const homeGrid = document.getElementById("homeGrid");
  if (!homeGrid) return;
  homeGrid.textContent = "";
  const frag = document.createDocumentFragment();
  const tagsEnabled = isTagsEnabled();
  for (let i = 1; i <= appState.patients.length; i++) {
    const p = appState.patients[i - 1];
    if (tagsEnabled && !patientMatchesSharedFilter(p)) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "patientBtn " + statusClass(p.status);
    const displayName = formatPatientLabel(p, String(i));
    btn.textContent = displayName;
    btn.setAttribute("aria-label", displayName);
    if (onPatientClick) {
      btn.addEventListener("click", () => onPatientClick(i));
    }
    bindLongPressAndDrag(btn, () => appState.patients.indexOf(p), onPatientDrop, openActionMenu);
    frag.appendChild(btn);
  }
  homeGrid.appendChild(frag);
  updateCountChip();
}
