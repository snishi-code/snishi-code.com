"use strict";

// 説明書ビュー上部のインタラクティブデモバー。
//
// 設計方針:
//   - state は本モジュール内の `_state` (メモリのみ) で管理。localStorage は
//     一切触らないので実患者データ・実 settings から完全に分離されている。
//   - 説明書ビューを抜けた時点で `resetDocsDemo()` を呼びデフォルトに戻す
//     (main.js の MutationObserver で検知)。
//   - 説明書ページ間の遷移 (srcdoc 差し替え) では state を維持。
//   - 患者数は DEMO_PATIENT_COUNT で集中管理 (将来 N 変更時はここだけ)。

import { STATUS } from "../constants.js";
import { nextStatusInCycle } from "../views/detail.js";
import { statusClass } from "../views/home.js";
import { formatPatientLabel } from "./room.js";
import { createEditToggle } from "./edit-toggle.js";
import { bindLongPressAndDrag } from "./drag.js";

const DEMO_PATIENT_COUNT = 3;
const STATUS_PREFIX = "__status:";
const STATUS_TAGS = [
  { key: STATUS.YELLOW, label: "黄", cls: "status-yellow" },
  { key: STATUS.GREEN, label: "緑", cls: "status-green" },
  { key: STATUS.GRAY, label: "灰", cls: "status-gray" },
  { key: STATUS.BLUE, label: "青", cls: "status-blue" },
];

function defaultDemoState() {
  return {
    patients: [
      { status: STATUS.NONE, name: "テスト1", room: "101", tags: ["A"] },
      { status: STATUS.NONE, name: "テスト2", room: "102", tags: ["B"] },
      { status: STATUS.NONE, name: "テスト3", room: "203", tags: ["A"] },
    ].slice(0, DEMO_PATIENT_COUNT),
    tags: ["A", "B"],
    editMode: false,
    tagFilter: [],         // 選択中の filter 値 (ユーザータグ or "__status:yellow" 等)
    tagFilterMode: "and",  // "and" | "or"
    sortByRoom: false,
  };
}

let _state = null;
let _openPopup = null;     // 同時に開ける popup は 1 つ
let _editToggle = null;    // createEditToggle のハンドル

export function resetDocsDemo() {
  if (_editToggle) _editToggle.exit();
  _state = defaultDemoState();
  closeOpenPopup();
  closeActiveMenuOverlay();
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

function matchesFilter(p, state) {
  if (state.tagFilter.length === 0) return true;
  const preds = state.tagFilter.map(t => {
    if (t.startsWith(STATUS_PREFIX)) {
      const s = t.slice(STATUS_PREFIX.length);
      return (q) => q.status === s;
    }
    return (q) => (q.tags || []).includes(t);
  });
  return state.tagFilterMode === "or"
    ? preds.some(fn => fn(p))
    : preds.every(fn => fn(p));
}

function visiblePatients(state) {
  let list = state.patients.filter(p => matchesFilter(p, state));
  if (state.sortByRoom) list = list.slice().sort(roomCompare);
  return list;
}

// ============================================================
// タグピッカー
//   - withModeToggle: AND/OR + クリア × を上段に
//   - withStatusTags: ステータス仮想タグを含める
//   - withAddTag:    「+ 新規タグ」入力欄を popup 下段に
// ============================================================
function makeDemoTagPicker({
  getSelected, setSelected, getTags, label,
  withModeToggle = false,
  withStatusTags = false,
  withAddTag = false,
  state = null, // mode toggle / add tag が触る state
}) {
  const wrap = document.createElement("span");
  wrap.style.position = "relative";
  wrap.style.display = "inline-flex";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "iconBtn";
  trigger.title = label;
  trigger.setAttribute("aria-label", label);
  const refreshTriggerColor = () => {
    const hasAny = getSelected().length > 0;
    trigger.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${hasAny ? '#2563eb' : 'currentColor'}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
  };
  refreshTriggerColor();

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (_openPopup && _openPopup.parentElement === wrap) { closeOpenPopup(); return; }
    closeOpenPopup();
    const popup = buildPopup({
      getSelected, setSelected, getTags,
      withModeToggle, withStatusTags, withAddTag,
      state,
      onChange: () => { refreshTriggerColor(); renderDocsDemo(); },
    });
    wrap.appendChild(popup);
    _openPopup = popup;
  });

  wrap.appendChild(trigger);
  return wrap;
}

function buildPopup({ getSelected, setSelected, getTags, withModeToggle, withStatusTags, withAddTag, state, onChange }) {
  const popup = document.createElement("div");
  popup.className = "docsDemoTagPopup";
  popup.addEventListener("click", (e) => e.stopPropagation());

  const rerender = () => {
    popup.textContent = "";
    fillPopup();
  };

  function fillPopup() {
    // AND/OR + clear ×
    if (withModeToggle && state) {
      const modeRow = document.createElement("div");
      modeRow.className = "modeRow";
      const mkMode = (mode, label) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "modeBtn" + (state.tagFilterMode === mode ? " selected" : "");
        b.textContent = label;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          state.tagFilterMode = mode;
          onChange();
          rerender();
        });
        return b;
      };
      modeRow.appendChild(mkMode("and", "AND"));
      modeRow.appendChild(mkMode("or", "OR"));
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "modeBtn clear";
      clear.textContent = "×";
      clear.title = "選択をすべて解除";
      clear.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected([]);
        onChange();
        rerender();
      });
      modeRow.appendChild(clear);
      popup.appendChild(modeRow);
    }

    // ステータス仮想タグ
    if (withStatusTags) {
      for (const s of STATUS_TAGS) {
        popup.appendChild(makeChip({
          value: STATUS_PREFIX + s.key,
          label: s.label,
          extraCls: s.cls,
          getSelected, setSelected,
          onChange: () => { onChange(); rerender(); },
        }));
      }
    }

    // ユーザータグ
    const userTags = getTags();
    for (const t of userTags) {
      popup.appendChild(makeChip({
        value: t, label: t,
        getSelected, setSelected,
        onChange: () => { onChange(); rerender(); },
      }));
    }

    // 「+ 新規タグ」入力
    if (withAddTag && state) {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "addTagInput";
      inp.placeholder = "+ 新規タグ";
      const commit = () => {
        const v = inp.value.trim();
        if (!v) return;
        if (!state.tags.includes(v)) state.tags.push(v);
        inp.value = "";
        onChange();
        rerender();
      };
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); inp.value = ""; inp.blur(); }
      });
      inp.addEventListener("blur", commit);
      popup.appendChild(inp);
    }
  }

  fillPopup();
  return popup;
}

function makeChip({ value, label, extraCls, getSelected, setSelected, onChange }) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip" + (extraCls ? " " + extraCls : "") + (getSelected().includes(value) ? " selected" : "");
  chip.textContent = label;
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    const cur = getSelected().slice();
    const idx = cur.indexOf(value);
    if (idx >= 0) cur.splice(idx, 1); else cur.push(value);
    setSelected(cur);
    onChange();
  });
  return chip;
}

// 外側クリックで popup を閉じる
document.addEventListener("click", () => closeOpenPopup());

// ============================================================
// 描画
// ============================================================
function renderViewBtn(p, state) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "patientBtn " + statusClass(p.status);
  const label = formatPatientLabel(p, "—");
  btn.textContent = label;
  btn.setAttribute("aria-label", label);
  bindLongPressAndDrag(
    btn,
    () => state.patients.indexOf(p),
    (fromIdx, toIdx) => onDemoPatientDrop(fromIdx, toIdx, state),
    (idx) => openDemoActionMenu(idx, state),
    () => {
      // 短タップ: ステータスサイクル (本番ホームの「タップ＝詳細遷移」はデモ
      // では飛ばないので、代わりにサイクルを割り当てている)。
      const next = nextStatusInCycle(p.status);
      p.status = next;
      btn.className = "patientBtn " + statusClass(next);
    },
    "#docsDemoGrid .patientBtn"
  );
  return btn;
}

function onDemoPatientDrop(fromIdx, toIdx, state) {
  if (fromIdx === toIdx) return;
  const item = state.patients.splice(fromIdx, 1)[0];
  state.patients.splice(toIdx, 0, item);
  renderDocsDemo();
}

function makeNewDemoPatient() {
  return { status: STATUS.NONE, name: "", room: "", tags: [] };
}

// ============================================================
// アクションメニュー (長押し → 追加 / 削除 / キャンセル)
// 3 件上限を超える追加は専用 popup で拒否。
// ============================================================
let _activeMenuOverlay = null;
function closeActiveMenuOverlay() {
  if (_activeMenuOverlay) {
    _activeMenuOverlay.remove();
    _activeMenuOverlay = null;
  }
}

function openDemoActionMenu(idx, state) {
  closeActiveMenuOverlay();
  const overlay = document.createElement("div");
  overlay.className = "popupMenuOverlay active";
  const title = formatPatientLabel(state.patients[idx], String(idx + 1));
  overlay.innerHTML = `
    <div class="popupMenu">
      <div class="popupTitle">${title} の操作</div>
      <button class="secondary" data-action="add">1人追加（下へ）</button>
      <button class="danger" data-action="delete">削除</button>
      <div style="height:12px;"></div>
      <button class="secondary" data-action="cancel">キャンセル</button>
    </div>
  `;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) { closeActiveMenuOverlay(); return; }
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    if (action === "add") {
      if (state.patients.length >= DEMO_PATIENT_COUNT) {
        closeActiveMenuOverlay();
        openDemoMaxPopup();
        return;
      }
      state.patients.splice(idx + 1, 0, makeNewDemoPatient());
    } else if (action === "delete") {
      state.patients.splice(idx, 1);
    }
    closeActiveMenuOverlay();
    renderDocsDemo();
  });
  document.body.appendChild(overlay);
  _activeMenuOverlay = overlay;
}

function openDemoMaxPopup() {
  closeActiveMenuOverlay();
  const overlay = document.createElement("div");
  overlay.className = "popupMenuOverlay active";
  overlay.innerHTML = `
    <div class="popupMenu">
      <div class="popupTitle">これ以上追加できません</div>
      <div style="font-size:13px;color:#555;line-height:1.5;margin-bottom:12px;">デモは ${DEMO_PATIENT_COUNT} 件までです。<br>先に削除してから追加してください。</div>
      <button class="secondary" data-action="close">OK</button>
    </div>
  `;
  overlay.addEventListener("click", () => closeActiveMenuOverlay());
  document.body.appendChild(overlay);
  _activeMenuOverlay = overlay;
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

  row.appendChild(makeDemoTagPicker({
    getSelected: () => p.tags || [],
    setSelected: (next) => { p.tags = next; },
    getTags: () => state.tags,
    label: "患者のタグ",
    withAddTag: true,
    state,
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
    getTags: () => state.tags,
    label: "タグで絞り込み",
    withModeToggle: true,
    withStatusTags: true,
    withAddTag: true,
    state,
  }));
}

function updateToolbarHighlight(state) {
  const sortBtn = document.getElementById("docsDemoSortBtn");
  if (sortBtn) sortBtn.classList.toggle("editActive", !!state.sortByRoom);
}

export function renderDocsDemo() {
  const grid = document.getElementById("docsDemoGrid");
  if (!grid) return;
  const state = ensureState();
  updateToolbarHighlight(state);
  renderTagFilterSlot(state);

  grid.textContent = "";
  grid.style.gridTemplateColumns = state.editMode ? "minmax(0, 1fr)" : "";

  const list = visiblePatients(state);
  for (const p of list) {
    grid.appendChild(state.editMode ? renderEditRow(p, state) : renderViewBtn(p, state));
  }
}

// ============================================================
// 初期化
// ============================================================
export function initDocsDemo() {
  const bar = document.getElementById("docsDemoBar");
  const reloadBtn = document.getElementById("docsDemoReloadBtn");
  const editBtn = document.getElementById("docsDemoEditBtn");
  const sortBtn = document.getElementById("docsDemoSortBtn");

  if (reloadBtn) reloadBtn.addEventListener("click", () => {
    resetDocsDemo();
    renderDocsDemo();
  });

  if (sortBtn) sortBtn.addEventListener("click", () => {
    const state = ensureState();
    state.sortByRoom = !state.sortByRoom;
    closeOpenPopup();
    renderDocsDemo();
  });

  // 編集は createEditToggle で管理。外側 (デモバー以外) クリックで自動 exit。
  _editToggle = createEditToggle({
    triggerBtn: editBtn,
    container: bar,
    onEnter: () => {
      const state = ensureState();
      state.editMode = true;
      closeOpenPopup();
      renderDocsDemo();
    },
    onExit: () => {
      const state = ensureState();
      state.editMode = false;
      closeOpenPopup();
      renderDocsDemo();
    },
  });
}
