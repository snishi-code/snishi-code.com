"use strict";

// 説明書ビュー上部のインタラクティブデモバー。
//
// 設計方針:
//   - state は本モジュール内の `_state` (メモリのみ) で管理。
//     localStorage は触らないので実患者データ・実 settings に一切影響しない。
//   - 説明書を抜けた時点で `resetDocsDemo()` を呼び、デフォルトに戻す。
//   - 説明書ページ間の遷移 (showView は変えず srcdoc 差し替え) では維持。
//   - 患者数は DEMO_PATIENT_COUNT で集中管理 (将来 N 変更時はここだけ)。

import { STATUS } from "../constants.js";
import { bindTapOrLongPress, nextStatusInCycle, statusOnLongPress } from "../views/detail.js";
import { statusClass } from "../views/home.js";
import { formatPatientLabel } from "./room.js";

const DEMO_PATIENT_COUNT = 3;

// test/fixtures/bundle.json と同形の placeholder データ。
function defaultDemoState() {
  return {
    patients: [
      { status: STATUS.NONE, name: "テスト1", room: "101", tags: ["A"] },
      { status: STATUS.NONE, name: "テスト2", room: "102", tags: ["B"] },
      { status: STATUS.NONE, name: "テスト3", room: "203", tags: ["A"] },
    ].slice(0, DEMO_PATIENT_COUNT),
    tags: ["A", "B"],
    editMode: false,
    tagFilter: [],       // 選択中のタグ (AND マッチ)
    sortByRoom: false,
  };
}

let _state = null;
let _openPopup = null; // 同時に開けるピッカーは 1 つ

export function resetDocsDemo() {
  _state = defaultDemoState();
  closeOpenPopup();
}

function ensureState() {
  if (!_state) _state = defaultDemoState();
  return _state;
}

function closeOpenPopup() {
  if (_openPopup) {
    _openPopup.remove();
    _openPopup = null;
  }
}

function roomCompare(a, b) {
  const ar = String(a.room ?? "").trim();
  const br = String(b.room ?? "").trim();
  if (ar && br) {
    const ai = parseInt(ar, 10);
    const bi = parseInt(br, 10);
    if (!isNaN(ai) && !isNaN(bi)) return ai - bi;
    return ar.localeCompare(br);
  }
  if (ar) return -1;
  if (br) return 1;
  return 0;
}

function visiblePatients(state) {
  let list = state.patients;
  if (state.tagFilter.length > 0) {
    list = list.filter(p => state.tagFilter.every(t => (p.tags || []).includes(t)));
  }
  if (state.sortByRoom) {
    list = list.slice().sort(roomCompare);
  }
  return list;
}

// ============================================================
// タグピッカー (popup 形式)
//   - trigger: クリックでトグル
//   - popup: チップで多選択 (selected = filter に含む)
//   - 同時に開く popup は 1 つ (_openPopup を閉じる)
// ============================================================
function makeDemoTagPicker({ getSelected, setSelected, tags, label }) {
  const wrap = document.createElement("span");
  wrap.style.position = "relative";
  wrap.style.display = "inline-flex";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "iconBtn";
  trigger.title = label;
  trigger.setAttribute("aria-label", label);
  const selected = getSelected();
  const hasAny = selected.length > 0;
  trigger.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${hasAny ? '#2563eb' : 'currentColor'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_openPopup && _openPopup.parentElement === wrap) {
      closeOpenPopup();
      return;
    }
    closeOpenPopup();
    const popup = document.createElement("div");
    popup.className = "docsDemoTagPopup";
    for (const t of tags) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (getSelected().includes(t) ? " selected" : "");
      chip.textContent = t;
      chip.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const cur = getSelected().slice();
        const idx = cur.indexOf(t);
        if (idx >= 0) cur.splice(idx, 1); else cur.push(t);
        setSelected(cur);
        renderDocsDemo();
      });
      popup.appendChild(chip);
    }
    wrap.appendChild(popup);
    _openPopup = popup;
  });

  wrap.appendChild(trigger);
  return wrap;
}

// document クリックで popup を閉じる (デモバー内に閉じ込める)
document.addEventListener("click", (e) => {
  if (!_openPopup) return;
  if (_openPopup.contains(e.target)) return;
  closeOpenPopup();
});

// ============================================================
// 描画
// ============================================================
function renderViewBtn(p) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "patientBtn " + statusClass(p.status);
  const label = formatPatientLabel(p, "—");
  btn.textContent = label;
  btn.setAttribute("aria-label", label);
  const applyStatus = (next) => {
    p.status = next;
    btn.className = "patientBtn " + statusClass(next);
  };
  bindTapOrLongPress(
    btn,
    () => applyStatus(nextStatusInCycle(p.status)),
    () => applyStatus(statusOnLongPress(p.status))
  );
  return btn;
}

function renderEditRow(p, state) {
  const row = document.createElement("div");
  row.className = "docsDemoEditRow";

  const roomInp = document.createElement("input");
  roomInp.type = "text";
  roomInp.className = "roomInput";
  roomInp.value = String(p.room || "");
  roomInp.placeholder = "部屋";
  roomInp.addEventListener("input", () => { p.room = roomInp.value; });
  row.appendChild(roomInp);

  const nameInp = document.createElement("input");
  nameInp.type = "text";
  nameInp.className = "nameInput";
  nameInp.value = String(p.name || "");
  nameInp.placeholder = "名前";
  nameInp.addEventListener("input", () => { p.name = nameInp.value; });
  row.appendChild(nameInp);

  // この患者のタグを直接編集する picker
  row.appendChild(makeDemoTagPicker({
    getSelected: () => p.tags || [],
    setSelected: (next) => { p.tags = next; },
    tags: state.tags,
    label: "患者のタグ",
  }));

  return row;
}

function renderTagFilterSlot(state) {
  const slot = document.getElementById("docsDemoTagFilterSlot");
  if (!slot) return;
  slot.textContent = "";
  slot.appendChild(makeDemoTagPicker({
    getSelected: () => state.tagFilter,
    setSelected: (next) => { state.tagFilter = next; },
    tags: state.tags,
    label: "タグで絞り込み",
  }));
}

function updateToolbarHighlight(state) {
  const editBtn = document.getElementById("docsDemoEditBtn");
  const sortBtn = document.getElementById("docsDemoSortBtn");
  if (editBtn) editBtn.classList.toggle("editActive", !!state.editMode);
  if (sortBtn) sortBtn.classList.toggle("editActive", !!state.sortByRoom);
}

export function renderDocsDemo() {
  const grid = document.getElementById("docsDemoGrid");
  if (!grid) return;
  const state = ensureState();
  updateToolbarHighlight(state);
  renderTagFilterSlot(state);

  grid.textContent = "";
  // 編集モードでは grid を 1 列にして 1 行 1 患者 (入力欄が並ぶため)
  grid.style.gridTemplateColumns = state.editMode ? "minmax(0, 1fr)" : "";

  const list = visiblePatients(state);
  for (const p of list) {
    grid.appendChild(state.editMode ? renderEditRow(p, state) : renderViewBtn(p));
  }
}

// ============================================================
// 初期化
// ============================================================
export function initDocsDemo() {
  const reloadBtn = document.getElementById("docsDemoReloadBtn");
  if (reloadBtn) reloadBtn.addEventListener("click", () => {
    resetDocsDemo();
    renderDocsDemo();
  });

  const editBtn = document.getElementById("docsDemoEditBtn");
  if (editBtn) editBtn.addEventListener("click", () => {
    const state = ensureState();
    state.editMode = !state.editMode;
    closeOpenPopup();
    renderDocsDemo();
  });

  const sortBtn = document.getElementById("docsDemoSortBtn");
  if (sortBtn) sortBtn.addEventListener("click", () => {
    const state = ensureState();
    state.sortByRoom = !state.sortByRoom;
    closeOpenPopup();
    renderDocsDemo();
  });
}
