"use strict";

import { appState, markUpdated, scheduleSave } from "../store.js";
import { STATUS } from "../constants.js";
import { bindLongPressAndDrag, onPatientDrop, openActionMenu } from "../features/drag.js";
import { makeSharedTagFilterPicker, patientMatchesSharedFilter } from "../features/tags.js";
import { formatPatientLabel, isRoomSortActive } from "../features/room.js";
import { isNonAdminTerminal } from "../features/admin.js";
import { bindTapOrLongPress, nextStatusInCycle } from "./detail.js";

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
  countChip.textContent = "緑: " + countGreen() + " / " + appState.patients.length;
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
  btn.style.display = isNonAdminTerminal() ? "none" : "";
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
      // 編集モード: タップ＝ステータスサイクル / 長押し＝白へリセット（詳細画面の名前ボタンと同仕様）
      const setStatus = (next) => {
        const idx = appState.patients.indexOf(p);
        if (idx < 0) return;
        p.status = next;
        markUpdated(idx + 1);
        btn.className = "patientBtn " + statusClass(next);
        scheduleSave();
        updateCountChip();
      };
      bindTapOrLongPress(
        btn,
        () => setStatus(nextStatusInCycle(p.status)),
        () => setStatus(STATUS.NONE)
      );
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
