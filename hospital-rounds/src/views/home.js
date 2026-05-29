"use strict";

import { appState } from "../store.js";
import { STATUS } from "../constants.js";
import { bindLongPressAndDrag, onPatientDrop, openActionMenu } from "../features/drag.js";
import { makeSharedTagFilterPicker, patientMatchesSharedFilter } from "../features/tags.js";
import { formatPatientLabel, isRoomSortActive } from "../features/room.js";
import { openStatusPicker } from "./detail.js";
import { t } from "../i18n.js";

let _editMode = false;

export function setHomeEditMode(val) { _editMode = !!val; }
export function getHomeEditMode() { return _editMode; }

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
  countChip.textContent = t("home.countChip", { n: countGreen(), total: appState.patients.length });
}

function renderHomeTagFilter(onChange) {
  const slot = document.getElementById("homeTagFilterSlot");
  if (!slot) return;
  slot.textContent = "";
  const picker = makeSharedTagFilterPicker(onChange);
  slot.appendChild(picker);
}

function renderHomeSortBtn() {
  const btn = document.getElementById("homeRoomSortBtn");
  if (!btn) return;
  btn.style.display = "";
  btn.classList.toggle("editActive", isRoomSortActive());
}

export function renderHome(onPatientClick) {
  renderHomeTagFilter(() => renderHome(onPatientClick));
  renderHomeSortBtn();
  const homeGrid = document.getElementById("homeGrid");
  if (!homeGrid) return;
  homeGrid.textContent = "";
  const frag = document.createDocumentFragment();
  for (let i = 1; i <= appState.patients.length; i++) {
    const p = appState.patients[i - 1];
    if (!patientMatchesSharedFilter(p)) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "patientBtn " + statusClass(p.status);
    const displayName = formatPatientLabel(p, String(i));
    btn.textContent = displayName;
    btn.setAttribute("aria-label", displayName);
    if (_editMode) {
      // 編集モード: タップでステータス選択ポップアップ (患者画面と同仕様に統一)
      btn.addEventListener("click", () => {
        const idx = appState.patients.indexOf(p);
        if (idx < 0) return;
        openStatusPicker(idx, (s) => {
          btn.className = "patientBtn " + statusClass(s);
          updateCountChip();
        });
      });
    } else {
      if (onPatientClick) {
        btn.addEventListener("click", () => onPatientClick(i));
      }
      bindLongPressAndDrag(btn, () => appState.patients.indexOf(p), onPatientDrop, openActionMenu);
    }
    frag.appendChild(btn);
  }
  homeGrid.appendChild(frag);
  updateCountChip();
}
