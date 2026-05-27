"use strict";

// ============================
// フォーマットグループ
//
// データモデル:
//   settings.formatGroups = [
//     { id: "grp_xxx", name: "発熱対応", formatIds: ["fmt_a", "fmt_b", ...] }
//   ]
//   patient.activeFormatGroupId = "" | "grp_xxx"
//
// 挙動:
//   - 患者画面のヘッダーの「束」アイコン → グループピッカーが開く
//   - 通常 / 各グループ から単選択。選んだものが patient.activeFormatGroupId に保存
//   - active なグループがあると、各パネルの strip の pin チップが「グループ内の
//     フォーマット (panel フィルタ済) 」だけに置き換わる (お気に入りの動的切替)
//   - グループ間で formats は重複可。同じフォーマットを複数グループに入れて OK
//   - 各グループ間で順序が保たれる (formatIds の並び順がそのまま strip の順序)
//   - 設定画面に「グループ」セクションを設け、新規追加・編集・削除を行う
// ============================

import { settings, appState, selectedNo, saveSettings, markUpdated, scheduleSave } from "../store.js";
import { FORMAT_PANELS } from "../constants.js";
import { t } from "../i18n.js";

function newGroupId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return "grp_" + crypto.randomUUID().slice(0, 8);
  return "grp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function getAllFormatGroups() {
  return Array.isArray(settings.formatGroups) ? settings.formatGroups.slice() : [];
}

export function getFormatGroupById(id) {
  if (!id) return null;
  return getAllFormatGroups().find(g => g.id === id) || null;
}

// 現在開いている患者の active group に応じて、ヘッダー上のトグルボタンの
// 表示 (グループ名 or 「通常」) と active styling を更新する。
// 詳細画面の renderDetail から呼ばれる。
export function refreshFormatGroupToggle() {
  const btn = document.getElementById("detailFormatGroupBtn");
  const lbl = document.getElementById("detailFormatGroupLabel");
  if (!btn || !lbl) return;
  const p = appState.patients[selectedNo - 1];
  const activeId = String(p?.activeFormatGroupId || "");
  if (activeId) {
    const g = getFormatGroupById(activeId);
    if (g) {
      lbl.textContent = g.name;
      btn.classList.add("active");
      btn.title = t("formatGroup.toggle.active.title", { name: g.name });
      return;
    }
    // active group が削除されていた場合は通常モードへフォールバック
    btn.classList.remove("active");
  } else {
    btn.classList.remove("active");
  }
  lbl.textContent = t("formatGroup.option.none.label");
  btn.title = t("formatGroup.toggle.title");
}

// ============================
// 患者画面: ピッカー (この患者の active group を選ぶ)
// ============================
let _onPickedCb = null;

export function openFormatGroupPicker(onPicked) {
  _onPickedCb = onPicked || null;
  const overlay = document.getElementById("formatGroupPickerOverlay");
  if (!overlay) return;
  renderPickerList();
  overlay.classList.add("active");
}

function closePicker() {
  const overlay = document.getElementById("formatGroupPickerOverlay");
  if (overlay) overlay.classList.remove("active");
  _onPickedCb = null;
}

function renderPickerList() {
  const host = document.getElementById("formatGroupPickerList");
  if (!host) return;
  host.textContent = "";
  const p = appState.patients[selectedNo - 1];
  const current = String(p?.activeFormatGroupId || "");
  const groups = getAllFormatGroups();

  // 通常 (= グループ無し) エントリ
  host.appendChild(buildPickerRow({
    id: "",
    name: t("formatGroup.option.none"),
    selected: !current,
    sub: t("formatGroup.option.none.sub"),
  }));

  if (!groups.length) {
    const empty = document.createElement("div");
    empty.className = "formatGroupPickerEmpty";
    empty.textContent = t("formatGroup.picker.empty");
    host.appendChild(empty);
    return;
  }

  for (const g of groups) {
    host.appendChild(buildPickerRow({
      id: g.id,
      name: g.name,
      selected: g.id === current,
      sub: t("formatGroup.option.formats", { n: (g.formatIds || []).length }),
    }));
  }
}

function buildPickerRow({ id, name, selected, sub }) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "formatGroupPickerRow" + (selected ? " selected" : "");
  const lbl = document.createElement("div");
  lbl.className = "formatGroupPickerName";
  lbl.textContent = name;
  row.appendChild(lbl);
  if (sub) {
    const s = document.createElement("div");
    s.className = "formatGroupPickerSub";
    s.textContent = sub;
    row.appendChild(s);
  }
  row.addEventListener("click", () => {
    const p = appState.patients[selectedNo - 1];
    if (p) {
      p.activeFormatGroupId = String(id || "");
      markUpdated(selectedNo);
      scheduleSave();
    }
    const cb = _onPickedCb;
    closePicker();
    if (cb) cb();
  });
  return row;
}

// ============================
// 設定画面: グループ CRUD UI
// ============================
let _currentEdit = null; // { isNew, target, onSaved }

export function startNewFormatGroup(onSaved) {
  _currentEdit = {
    isNew: true,
    target: { id: newGroupId(), name: "", formatIds: [] },
    onSaved,
  };
  openEditModal();
}

export function startEditFormatGroup(group, onSaved) {
  _currentEdit = {
    isNew: false,
    target: {
      id: group.id,
      name: String(group.name || ""),
      formatIds: Array.isArray(group.formatIds) ? group.formatIds.slice() : [],
    },
    onSaved,
  };
  openEditModal();
}

export function deleteFormatGroupById(id) {
  if (!Array.isArray(settings.formatGroups)) return;
  settings.formatGroups = settings.formatGroups.filter(g => g.id !== id);
  // 各患者の activeFormatGroupId からも掃除
  for (const p of appState.patients) {
    if (p.activeFormatGroupId === id) p.activeFormatGroupId = "";
  }
  saveSettings();
}

function openEditModal() {
  const overlay = document.getElementById("formatGroupEditOverlay");
  if (!overlay || !_currentEdit) return;
  const title = document.getElementById("formatGroupEditTitle");
  if (title) {
    title.textContent = t(_currentEdit.isNew ? "formatGroup.edit.title.new" : "formatGroup.edit.title.edit");
  }
  const nameInp = document.getElementById("formatGroupEditName");
  if (nameInp) nameInp.value = _currentEdit.target.name;
  renderFormatsCheckList();
  overlay.classList.add("active");
  if (nameInp) setTimeout(() => nameInp.focus(), 50);
}

function closeEditModal() {
  const overlay = document.getElementById("formatGroupEditOverlay");
  if (overlay) overlay.classList.remove("active");
  _currentEdit = null;
}

function renderFormatsCheckList() {
  const host = document.getElementById("formatGroupEditFormats");
  if (!host || !_currentEdit) return;
  host.textContent = "";
  const all = Array.isArray(settings.formats) ? settings.formats : [];
  const selected = new Set(_currentEdit.target.formatIds);
  // panel ごとにグルーピングして見せる (S/O/A/P)
  for (const panel of FORMAT_PANELS) {
    const inPanel = all.filter(f => f.panel === panel);
    if (!inPanel.length) continue;
    const sec = document.createElement("div");
    sec.className = "formatGroupEditSection";
    const head = document.createElement("div");
    head.className = "formatGroupEditSectionHead";
    head.textContent = t("panel." + panel) + " 欄";
    sec.appendChild(head);
    for (const f of inPanel) {
      const row = document.createElement("label");
      row.className = "formatGroupEditOpt";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(f.id);
      cb.addEventListener("change", () => {
        if (cb.checked) {
          if (!_currentEdit.target.formatIds.includes(f.id)) _currentEdit.target.formatIds.push(f.id);
        } else {
          _currentEdit.target.formatIds = _currentEdit.target.formatIds.filter(x => x !== f.id);
        }
      });
      const lbl = document.createElement("span");
      lbl.textContent = f.name;
      row.appendChild(cb);
      row.appendChild(lbl);
      sec.appendChild(row);
    }
    host.appendChild(sec);
  }
  if (!host.children.length) {
    const empty = document.createElement("div");
    empty.className = "formatGroupPickerEmpty";
    empty.textContent = t("formatGroup.edit.noFormats");
    host.appendChild(empty);
  }
}

function saveEdit() {
  if (!_currentEdit) { closeEditModal(); return; }
  const nameInp = document.getElementById("formatGroupEditName");
  const name = String(nameInp?.value || "").trim();
  if (!name) {
    alert(t("formatGroup.name.required"));
    return;
  }
  const target = _currentEdit.target;
  target.name = name;
  // 同名チェック
  const all = Array.isArray(settings.formatGroups) ? settings.formatGroups : [];
  const dup = all.find(g => g.id !== target.id && g.name === name);
  if (dup) {
    alert(t("formatGroup.name.duplicate"));
    return;
  }
  if (_currentEdit.isNew) {
    if (!Array.isArray(settings.formatGroups)) settings.formatGroups = [];
    settings.formatGroups.push(target);
  } else {
    const idx = all.findIndex(g => g.id === target.id);
    if (idx >= 0) settings.formatGroups[idx] = target;
    else settings.formatGroups.push(target);
  }
  saveSettings();
  const cb = _currentEdit.onSaved;
  closeEditModal();
  if (cb) cb(target);
}

// ============================
// 配線 (DOM ready 後 main.js から)
// ============================
export function initFormatGroups(callbacks) {
  const pickerOverlay = document.getElementById("formatGroupPickerOverlay");
  const pickerClose = document.getElementById("formatGroupPickerCloseBtn");
  if (pickerClose) pickerClose.addEventListener("click", closePicker);
  if (pickerOverlay) pickerOverlay.addEventListener("click", (e) => {
    if (e.target === pickerOverlay) closePicker();
  });

  const editOverlay = document.getElementById("formatGroupEditOverlay");
  const editCancel = document.getElementById("formatGroupEditCancelBtn");
  const editSave = document.getElementById("formatGroupEditSaveBtn");
  if (editCancel) editCancel.addEventListener("click", closeEditModal);
  if (editSave) editSave.addEventListener("click", saveEdit);
  if (editOverlay) editOverlay.addEventListener("click", (e) => {
    if (e.target === editOverlay) closeEditModal();
  });

  // 患者画面ヘッダーの「束」ボタン → ピッカーを開く
  const triggerBtn = document.getElementById("detailFormatGroupBtn");
  if (triggerBtn) {
    triggerBtn.addEventListener("click", () => {
      openFormatGroupPicker(() => {
        if (callbacks?.renderDetail) callbacks.renderDetail();
      });
    });
  }
}
