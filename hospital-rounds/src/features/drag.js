"use strict";

import { appState, settings, makeDefaultPatient, scheduleSave, ensurePatientsHaveAllOKeys } from "../store.js";
import { isNonAdminTerminal } from "./admin.js";

// Callback registered by main.js to re-render the current view after data changes
let _onDataChange = null;
export function setDataChangeHandler(fn) { _onDataChange = fn; }

export function finishDataChange() {
  ensurePatientsHaveAllOKeys();
  scheduleSave();
  if (_onDataChange) _onDataChange();
}

// ============================
// Drag and Drop & Long Press
// ============================

export function bindLongPressAndDrag(el, getIndexFn, onDrop, onMenu, onTap) {
  let startX = 0, startY = 0;
  let mode = 0;
  let localTimer = null;
  let longPressAt = 0; // ロングプレス検出時刻（低性能端末の誤touchend判定を除外するため）

  const onMove = (e) => {
    if (mode === 0) return;
    const pt = e.touches ? e.touches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (mode === 1) {
      if (dist > 8) {
        clearTimeout(localTimer);
        mode = 0;
        unbindDoc();
      }
    } else if (mode === 2 || mode === 3) {
      e.preventDefault();
      if (mode === 2 && dist > 8) {
        mode = 3;
        startCustomDrag(el, getIndexFn(), pt.clientX, pt.clientY);
      }
      if (mode === 3) {
        moveCustomDrag(pt.clientX, pt.clientY);
      }
    }
  };

  const onUp = (e) => {
    if (localTimer) clearTimeout(localTimer);
    el.style.transform = "";
    el.style.opacity = "";
    if (mode === 2) {
      // ロングプレス検出直後200ms以内のtouchendは低性能端末の誤検出として無視する
      if (Date.now() - longPressAt < 200) {
        mode = 0;
        unbindDoc();
        return;
      }
      if (e.cancelable) e.preventDefault();
      onMenu(getIndexFn());
    } else if (mode === 3) {
      if (e.cancelable) e.preventDefault();
      endCustomDrag(onDrop);
    } else if (mode === 1 && onTap) {
      if (e.cancelable) e.preventDefault();
      onTap();
    }
    mode = 0;
    unbindDoc();
  };

  const bindDoc = () => {
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
    document.addEventListener("touchcancel", onUp);
    document.addEventListener("mousemove", onMove, { passive: false });
    document.addEventListener("mouseup", onUp);
  };

  const unbindDoc = () => {
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onUp);
    document.removeEventListener("touchcancel", onUp);
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  const down = (e) => {
    if (e.touches && e.touches.length > 1) return;
    if (e.type === "mousedown" && e.button !== 0) return;
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    mode = 1;

    if (localTimer) clearTimeout(localTimer);
    localTimer = setTimeout(() => {
      if (mode === 1) {
        mode = 2;
        longPressAt = Date.now();
        if (navigator.vibrate) navigator.vibrate(50);
        el.style.transform = "scale(0.96)";
        el.style.opacity = "0.8";
      }
    }, 400);
    bindDoc();
  };

  el.addEventListener("touchstart", down, { passive: true });
  el.addEventListener("mousedown", down);
}

let dragGhost = null;
let dragSourceIdx = -1;
let dragOverIdx = -1;
let dragElements = [];

function startCustomDrag(sourceEl, sourceIdx, clientX, clientY) {
  dragSourceIdx = sourceIdx;
  dragOverIdx = sourceIdx;
  dragElements = [];
  const viewId = document.querySelector(".view.active")?.id;
  let query = "";
  if (viewId === "homeView") query = ".patientBtn";
  else if (viewId === "memoView") query = "#memoView .memoRow";
  else if (viewId === "sharedView") query = "#sharedView .memoRow";

  if (query) {
    document.querySelectorAll(query).forEach((el, i) => {
      dragElements.push({ el, idx: i, rect: el.getBoundingClientRect() });
    });
  }

  const rect = sourceEl.getBoundingClientRect();
  dragGhost = sourceEl.cloneNode(true);
  dragGhost.style.position = "fixed";
  dragGhost.style.left = rect.left + "px";
  dragGhost.style.top = rect.top + "px";
  dragGhost.style.width = rect.width + "px";
  dragGhost.style.height = rect.height + "px";
  dragGhost.style.margin = "0";
  dragGhost.style.zIndex = "9999";
  dragGhost.style.pointerEvents = "none";
  dragGhost.style.opacity = "0.8";
  dragGhost.style.boxShadow = "0 20px 40px rgba(0,0,0,0.2)";
  dragGhost.style.transform = "scale(1.05)";
  dragGhost.style.transition = "transform 0.1s";
  document.body.appendChild(dragGhost);

  sourceEl.classList.add("dragGhost");
}

function moveCustomDrag(clientX, clientY) {
  if (!dragGhost) return;
  dragGhost.style.left = (clientX - dragGhost.offsetWidth / 2) + "px";
  dragGhost.style.top = (clientY - dragGhost.offsetHeight / 2) + "px";

  let bestIdx = dragSourceIdx;
  let minDist = Infinity;
  for (const item of dragElements) {
    const cx = item.rect.left + item.rect.width / 2;
    const cy = item.rect.top + item.rect.height / 2;
    const dist = Math.sqrt((cx - clientX) ** 2 + (cy - clientY) ** 2);
    if (dist < minDist && dist < 100) {
      minDist = dist;
      bestIdx = item.idx;
    }
  }

  if (dragOverIdx !== bestIdx) {
    dragElements.forEach(item => item.el.classList.remove("dragOver"));
    if (dragElements[bestIdx]) {
      dragElements[bestIdx].el.classList.add("dragOver");
    }
    dragOverIdx = bestIdx;
  }
}

function endCustomDrag(onDrop) {
  dragElements.forEach(item => {
    item.el.classList.remove("dragGhost");
    item.el.classList.remove("dragOver");
  });
  if (dragGhost) {
    dragGhost.remove();
    dragGhost = null;
  }
  if (dragSourceIdx !== -1 && dragOverIdx !== -1 && dragSourceIdx !== dragOverIdx) {
    onDrop(dragSourceIdx, dragOverIdx);
  }
  dragSourceIdx = -1;
  dragOverIdx = -1;
  dragElements = [];
}

export function onPatientDrop(fromIdx, toIdx) {
  const item = appState.patients.splice(fromIdx, 1)[0];
  appState.patients.splice(toIdx, 0, item);
  finishDataChange();
}

// ============================
// Action menu (long-press patient operations)
// ============================

let targetActionIdx = -1;

export function openActionMenu(idx) {
  // Non-admin terminal: hide add/delete operations
  if (isNonAdminTerminal()) return;
  targetActionIdx = idx;
  const p = appState.patients[idx];
  const name = p.name ? p.name : String(idx + 1);
  const title = document.getElementById("actionMenuTitle");
  if (title) title.textContent = `${name} の操作`;
  const overlay = document.getElementById("actionMenuOverlay");
  if (overlay) overlay.classList.add("active");
}

export function closeActionMenu() {
  targetActionIdx = -1;
  const overlay = document.getElementById("actionMenuOverlay");
  if (overlay) overlay.classList.remove("active");
}

export function insertPatients(atIdx, count) {
  const newItems = [];
  for (let i = 0; i < count; i++) {
    newItems.push(makeDefaultPatient());
  }
  appState.patients.splice(atIdx, 0, ...newItems);
  finishDataChange();
}

export function initActionMenu() {
  const cancelBtn = document.getElementById("actionCancelBtn");
  const add1Btn = document.getElementById("actionAdd1Btn");
  const add5Btn = document.getElementById("actionAdd5Btn");
  const deleteBtn = document.getElementById("actionDeleteBtn");

  if (cancelBtn) cancelBtn.addEventListener("click", closeActionMenu);

  if (add1Btn) add1Btn.addEventListener("click", () => {
    if (targetActionIdx < 0) return;
    insertPatients(targetActionIdx + 1, 1);
    closeActionMenu();
  });

  if (add5Btn) add5Btn.addEventListener("click", () => {
    if (targetActionIdx < 0) return;
    insertPatients(targetActionIdx + 1, 5);
    closeActionMenu();
  });

  if (deleteBtn) deleteBtn.addEventListener("click", () => {
    if (targetActionIdx < 0) return;
    if (!confirm("この患者データを削除します。よろしいですか？")) return;
    appState.patients.splice(targetActionIdx, 1);
    if (appState.patients.length === 0) {
      appState.patients.push(makeDefaultPatient());
    }
    finishDataChange();
    closeActionMenu();
  });
}
