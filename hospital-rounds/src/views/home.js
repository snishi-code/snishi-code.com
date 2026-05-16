"use strict";

import { appState } from "../store.js";
import { STATUS } from "../constants.js";
import { bindLongPressAndDrag, onPatientDrop, openActionMenu } from "../features/drag.js";
import { isTagsEnabled, getAllTags, makeTagPicker } from "../features/tags.js";

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

let homeTagFilter = [];

function patientHasAllTags(p, tags) {
  if (!tags.length) return true;
  const pt = Array.isArray(p.tags) ? p.tags : [];
  return tags.every(t => pt.includes(t));
}

function renderHomeTagFilter(onChange) {
  const slot = document.getElementById("homeTagFilterSlot");
  if (!slot) return;
  slot.textContent = "";
  if (!isTagsEnabled()) {
    slot.style.display = "none";
    homeTagFilter = [];
    return;
  }
  slot.style.display = "";
  const picker = makeTagPicker({
    getSelected: () => homeTagFilter.slice(),
    setSelected: (tags) => { homeTagFilter = tags.slice(); },
    allTags: getAllTags,
    onChange: () => { if (onChange) onChange(); },
  });
  slot.appendChild(picker);
}

export function renderHome(onPatientClick) {
  renderHomeTagFilter(() => renderHome(onPatientClick));
  const homeGrid = document.getElementById("homeGrid");
  if (!homeGrid) return;
  homeGrid.textContent = "";
  const frag = document.createDocumentFragment();
  const tagsEnabled = isTagsEnabled();
  for (let i = 1; i <= appState.patients.length; i++) {
    const p = appState.patients[i - 1];
    if (tagsEnabled && homeTagFilter.length && !patientHasAllTags(p, homeTagFilter)) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "patientBtn " + statusClass(p.status);
    const displayName = p?.name ? p.name : String(i);
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
