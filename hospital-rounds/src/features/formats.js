"use strict";

// ============================
// フォーマット (Formats) - 患者画面側のロジック
//
// データモデル (settings.formats[]):
//   { id, name, panel:"O"|"A"|"P", type:"numeric"|"text", joiner, pinned, items }
//
// items:
//   numeric: { label, unit }
//   text:    { label, normal }
//
// このモジュールは:
//   1) 患者画面の各パネル (O/A/P) ヘッダに [+] [pin1...] [≡] ボタン群を組み立てる
//   2) フォーマット選択ピッカー (≡) を開く
//   3) フォーマット入力モーダル (numeric/text) を開く
//   4) 反映時に対象 textarea の末尾に追記
// ============================

import { appState, settings, selectedNo, saveSettings, scheduleSave, markUpdated } from "../store.js";
import { FORMAT_PANELS, FORMAT_TYPES } from "../constants.js";

const PANEL_TEXTAREA_ID = { S: "sText", O: "oFreeText", A: "aText", P: "pText" };
const PANEL_FIELD_KEY   = { S: "s",     O: "oFree",    A: "a",     P: "p"    };

function newFmtId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return "fmt_" + crypto.randomUUID();
  return "fmt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function formatsForPanel(panel) {
  if (!Array.isArray(settings.formats)) return [];
  return settings.formats.filter(f => f.panel === panel);
}

export function pinnedFormatsForPanel(panel) {
  return formatsForPanel(panel).filter(f => f.pinned);
}

// ============================
// 患者画面: 各パネル右肩のボタン strip 描画
// ============================
let _onTextChanged = null;
export function setOnTextChanged(fn) { _onTextChanged = fn; }

export function renderFormatStrip(panel, hostEl) {
  if (!hostEl) return;
  hostEl.textContent = "";
  hostEl.className = "formatStrip";

  const pinned = pinnedFormatsForPanel(panel);

  // [+] 新規作成
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "formatStripBtn formatStripAdd";
  addBtn.title = "新規フォーマット作成";
  addBtn.setAttribute("aria-label", "新規フォーマット作成");
  addBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  addBtn.addEventListener("click", () => openFormatEditModal(null, panel, () => {
    if (_onTextChanged) _onTextChanged();
  }));
  hostEl.appendChild(addBtn);

  // ピン留め (1-tap で入力モーダル直開)
  for (const f of pinned) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "formatStripBtn formatStripPinned";
    b.textContent = f.name;
    b.title = `${f.name} を入力`;
    b.addEventListener("click", () => openFormatInputModal(f, panel));
    hostEl.appendChild(b);
  }

  // [≡] 全フォーマット選択
  const allBtn = document.createElement("button");
  allBtn.type = "button";
  allBtn.className = "formatStripBtn formatStripAll";
  allBtn.title = "フォーマット選択";
  allBtn.setAttribute("aria-label", "フォーマット選択");
  allBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;
  allBtn.addEventListener("click", () => openFormatPickerModal(panel));
  hostEl.appendChild(allBtn);
}

// ============================
// フォーマット選択モーダル ([≡] から)
// ============================
function openFormatPickerModal(panel) {
  const overlay = document.getElementById("formatPickerOverlay");
  const list = document.getElementById("formatPickerList");
  if (!overlay || !list) return;
  list.textContent = "";

  const fmts = formatsForPanel(panel);
  if (fmts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "formatPickerEmpty";
    empty.textContent = "登録されたフォーマットがありません。[+] から作成してください。";
    list.appendChild(empty);
  } else {
    for (const f of fmts) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "formatPickerRow";
      row.innerHTML = `<span class="formatPickerName">${escapeHtml(f.name)}</span>` +
        `<span class="formatPickerType">${f.type === "numeric" ? "数値" : "文字"}</span>`;
      row.addEventListener("click", () => {
        overlay.classList.remove("active");
        openFormatInputModal(f, panel);
      });
      list.appendChild(row);
    }
  }

  overlay.classList.add("active");
}

// ============================
// フォーマット入力モーダル
// ============================
let _currentInput = null; // { format, panel, rowEls }

function openFormatInputModal(format, panel) {
  const overlay = document.getElementById("formatInputOverlay");
  const title = document.getElementById("formatInputTitle");
  const body = document.getElementById("formatInputBody");
  if (!overlay || !title || !body) return;

  title.textContent = format.name;
  body.textContent = "";
  _currentInput = { format, panel, rowEls: [] };

  for (const item of format.items) {
    if (format.type === "numeric") {
      _currentInput.rowEls.push(buildNumericRow(body, item));
    } else {
      _currentInput.rowEls.push(buildTextRow(body, item));
    }
  }

  overlay.classList.add("active");
  // 最初の入力欄にフォーカス
  setTimeout(() => {
    const first = body.querySelector("input, textarea");
    if (first) first.focus();
  }, 50);
}

function buildNumericRow(host, item) {
  const row = document.createElement("div");
  row.className = "formatInputRow numeric";

  const label = document.createElement("div");
  label.className = "formatInputLabel";
  label.textContent = item.label;
  row.appendChild(label);

  const val = document.createElement("input");
  val.type = "text";
  val.inputMode = "decimal";
  val.className = "formatInputValue";
  row.appendChild(val);

  if (item.unit) {
    const unit = document.createElement("span");
    unit.className = "formatInputUnit";
    unit.textContent = item.unit;
    row.appendChild(unit);
  }

  const memo = document.createElement("input");
  memo.type = "text";
  memo.className = "formatInputMemo";
  memo.placeholder = "備考";
  row.appendChild(memo);

  host.appendChild(row);
  return { item, val, memo };
}

function buildTextRow(host, item) {
  const row = document.createElement("div");
  row.className = "formatInputRow text";

  const label = document.createElement("div");
  label.className = "formatInputLabel";
  label.textContent = item.label;
  row.appendChild(label);

  const val = document.createElement("textarea");
  val.className = "formatInputValue formatInputText";
  val.rows = 1;
  row.appendChild(val);

  const normalBtn = document.createElement("button");
  normalBtn.type = "button";
  normalBtn.className = "formatInputNormalBtn";
  normalBtn.textContent = "正常";
  normalBtn.title = item.normal ? `正常文 を入力: ${item.normal}` : "正常文が設定されていません";
  if (!item.normal) normalBtn.disabled = true;
  normalBtn.addEventListener("click", () => {
    val.value = item.normal || "";
    val.focus();
  });
  row.appendChild(normalBtn);

  host.appendChild(row);
  return { item, val };
}

export function closeFormatInputModal() {
  const overlay = document.getElementById("formatInputOverlay");
  if (overlay) overlay.classList.remove("active");
  _currentInput = null;
}

function applyFormatInput() {
  if (!_currentInput) { closeFormatInputModal(); return; }
  const { format, panel, rowEls } = _currentInput;
  const parts = [];
  for (const row of rowEls) {
    if (format.type === "numeric") {
      const value = String(row.val.value || "").trim();
      const memo  = String(row.memo.value || "").trim();
      if (!value && !memo) continue;
      const unit = row.item.unit || "";
      let s = `${row.item.label}`;
      if (value) s += ` ${value}${unit}`;
      else if (unit) s += ` (${unit})`;
      if (memo) s += ` (${memo})`;
      parts.push(s);
    } else {
      const value = String(row.val.value || "").trim();
      if (!value) continue;
      parts.push(`${row.item.label}：${value}`);
    }
  }
  const out = parts.join(format.joiner || ", ");
  appendToPanel(panel, out);
  closeFormatInputModal();
}

function appendToPanel(panel, text) {
  if (!text) return;
  const p = appState.patients[selectedNo - 1];
  if (!p) return;
  const taId = PANEL_TEXTAREA_ID[panel];
  const field = PANEL_FIELD_KEY[panel];
  const ta = document.getElementById(taId);
  const current = (panel === "O") ? String(p.oFree ?? "")
                                  : String(p[field]?.text ?? "");
  const sep = current && !current.endsWith("\n") ? "\n" : "";
  const next = current + sep + text;
  if (panel === "O") p.oFree = next;
  else {
    if (!p[field] || typeof p[field] !== "object") p[field] = { text: "" };
    p[field].text = next;
  }
  if (ta) ta.value = next;
  markUpdated(selectedNo);
  scheduleSave();
  if (_onTextChanged) _onTextChanged();
}

// ============================
// フォーマット編集モーダル (新規/編集)
// ============================
let _currentEdit = null; // { isNew, target, panel, onSaved }

function openFormatEditModal(target, panel, onSaved) {
  const overlay = document.getElementById("formatEditOverlay");
  if (!overlay) return;
  _currentEdit = {
    isNew: !target,
    target: target ? { ...target, items: target.items.map(it => ({ ...it })) } : {
      id: newFmtId(),
      name: "",
      panel: panel || "O",
      type: "text",
      joiner: "\n",
      pinned: true,
      isDefault: false,
      items: [],
    },
    onSaved,
  };
  // パネル表記をモーダルタイトル横に表示 (固定: ユーザーは変更不可)
  const titleEl = document.querySelector("#formatEditOverlay .popupTitle");
  if (titleEl) {
    titleEl.textContent = `${_currentEdit.target.panel} 欄のフォーマット ${_currentEdit.isNew ? "新規作成" : "編集"}`;
  }
  renderFormatEditForm();
  overlay.classList.add("active");
  const nameInp = document.getElementById("formatEditName");
  if (nameInp) setTimeout(() => nameInp.focus(), 50);
}

function renderFormatEditForm() {
  const nameInp = document.getElementById("formatEditName");
  const typeSel = document.getElementById("formatEditType");
  const joinerInp = document.getElementById("formatEditJoiner");
  const pinnedChk = document.getElementById("formatEditPinned");
  const defaultChk = document.getElementById("formatEditIsDefault");
  const itemsHost = document.getElementById("formatEditItems");
  if (!_currentEdit || !nameInp) return;
  const t = _currentEdit.target;
  nameInp.value = t.name;
  if (typeSel) typeSel.value = t.type;
  if (joinerInp) joinerInp.value = t.joiner;
  if (pinnedChk) pinnedChk.checked = !!t.pinned;
  if (defaultChk) {
    defaultChk.checked = !!t.isDefault;
    // numeric では isDefault を無効化 (normal 値を持たないため fallback として描画不可)
    defaultChk.disabled = (t.type !== "text");
    defaultChk.parentElement.style.opacity = (t.type === "text") ? "1" : "0.5";
  }
  if (itemsHost) renderFormatEditItems(itemsHost);
}

function renderFormatEditItems(host) {
  host.textContent = "";
  const t = _currentEdit.target;
  for (let i = 0; i < t.items.length; i++) {
    const item = t.items[i];
    const row = document.createElement("div");
    row.className = "formatEditItemRow";

    const label = document.createElement("input");
    label.type = "text";
    label.className = "formatEditItemLabel";
    label.placeholder = "ラベル";
    label.value = item.label || "";
    label.addEventListener("input", () => { item.label = String(label.value || ""); });
    row.appendChild(label);

    if (t.type === "numeric") {
      const unit = document.createElement("input");
      unit.type = "text";
      unit.className = "formatEditItemUnit";
      unit.placeholder = "単位";
      unit.value = item.unit || "";
      unit.addEventListener("input", () => { item.unit = String(unit.value || ""); });
      row.appendChild(unit);
    } else {
      const normal = document.createElement("input");
      normal.type = "text";
      normal.className = "formatEditItemNormal";
      normal.placeholder = "正常文";
      normal.value = item.normal || "";
      normal.addEventListener("input", () => { item.normal = String(normal.value || ""); });
      row.appendChild(normal);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "formatEditItemDel";
    del.title = "この項目を削除";
    del.setAttribute("aria-label", "この項目を削除");
    del.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    del.addEventListener("click", () => {
      t.items.splice(i, 1);
      renderFormatEditItems(host);
    });
    row.appendChild(del);

    host.appendChild(row);
  }
}

function saveFormatEdit() {
  if (!_currentEdit) { closeFormatEditModal(); return; }
  const nameInp = document.getElementById("formatEditName");
  const typeSel = document.getElementById("formatEditType");
  const joinerInp = document.getElementById("formatEditJoiner");
  const pinnedChk = document.getElementById("formatEditPinned");
  const defaultChk = document.getElementById("formatEditIsDefault");

  const t = _currentEdit.target;
  const name = String(nameInp?.value || "").trim();
  if (!name) {
    alert("フォーマット名を入力してください。");
    return;
  }
  // 同名チェック (タグの挙動と同じ: 既存と同名なら reject)
  const all = Array.isArray(settings.formats) ? settings.formats : [];
  const dup = all.find(f => f.id !== t.id && f.name === name);
  if (dup) {
    alert("既に同名のフォーマットがあります。別の名前にしてください。");
    return;
  }

  t.name = name;
  // panel はモーダル外で固定。typeSel と pinned/isDefault のみ反映
  t.type = FORMAT_TYPES.includes(typeSel?.value) ? typeSel.value : t.type;
  t.joiner = String(joinerInp?.value ?? (t.type === "text" ? "\n" : ", "));
  t.pinned = !!pinnedChk?.checked;
  t.isDefault = (t.type === "text") ? !!defaultChk?.checked : false;
  // 空ラベル項目を除外
  t.items = t.items.filter(it => String(it.label || "").trim());

  // 同一パネル内に isDefault は 1 つだけ。他はクリア
  if (t.isDefault) {
    for (const f of all) {
      if (f.id !== t.id && f.panel === t.panel) f.isDefault = false;
    }
  }

  if (_currentEdit.isNew) {
    if (!Array.isArray(settings.formats)) settings.formats = [];
    settings.formats.push(t);
  } else {
    const idx = all.findIndex(f => f.id === t.id);
    if (idx >= 0) settings.formats[idx] = t;
    else settings.formats.push(t);
  }
  saveSettings();
  const cb = _currentEdit.onSaved;
  const savedTarget = t;
  const savedPanel = t.panel;
  closeFormatEditModal();
  if (cb) cb(savedTarget);
  // 新規作成時はそのまま入力モーダルへ
  if (savedTarget && _justCreated) {
    _justCreated = false;
    openFormatInputModal(savedTarget, savedPanel);
  }
}

let _justCreated = false;

export function closeFormatEditModal() {
  const overlay = document.getElementById("formatEditOverlay");
  if (overlay) overlay.classList.remove("active");
  _currentEdit = null;
}

function addFormatItem() {
  if (!_currentEdit) return;
  const t = _currentEdit.target;
  if (t.type === "numeric") t.items.push({ label: "", unit: "" });
  else t.items.push({ label: "", normal: "" });
  const itemsHost = document.getElementById("formatEditItems");
  if (itemsHost) renderFormatEditItems(itemsHost);
}

// ============================
// 設定画面側の CRUD ヘルパ (settings-view.js から呼ばれる)
// ============================
// panel が省略された場合は O。設定画面から呼ぶ場合は必ず panel を指定する
export function startNewFormat(onSaved, panel) {
  _justCreated = true;
  openFormatEditModal(null, panel || "O", onSaved);
}

export function startEditFormat(format, onSaved) {
  _justCreated = false;
  openFormatEditModal(format, format.panel, onSaved);
}

export function deleteFormatById(id) {
  if (!Array.isArray(settings.formats)) return;
  const idx = settings.formats.findIndex(f => f.id === id);
  if (idx < 0) return;
  settings.formats.splice(idx, 1);
  saveSettings();
}

// ============================
// 共通配線 (DOM ready 後 main.js から initFormats を呼ぶ)
// ============================
export function initFormats() {
  const inputApply = document.getElementById("formatInputApplyBtn");
  const inputCancel = document.getElementById("formatInputCancelBtn");
  const inputOverlay = document.getElementById("formatInputOverlay");
  if (inputApply) inputApply.addEventListener("click", applyFormatInput);
  if (inputCancel) inputCancel.addEventListener("click", closeFormatInputModal);
  if (inputOverlay) inputOverlay.addEventListener("click", (e) => {
    if (e.target === inputOverlay) closeFormatInputModal();
  });

  const editSave = document.getElementById("formatEditSaveBtn");
  const editCancel = document.getElementById("formatEditCancelBtn");
  const editAddItem = document.getElementById("formatEditAddItemBtn");
  const editOverlay = document.getElementById("formatEditOverlay");
  const typeSel = document.getElementById("formatEditType");
  if (editSave) editSave.addEventListener("click", saveFormatEdit);
  if (editCancel) editCancel.addEventListener("click", closeFormatEditModal);
  if (editAddItem) editAddItem.addEventListener("click", addFormatItem);
  if (editOverlay) editOverlay.addEventListener("click", (e) => {
    if (e.target === editOverlay) closeFormatEditModal();
  });
  if (typeSel) typeSel.addEventListener("change", () => {
    if (!_currentEdit) return;
    _currentEdit.target.type = typeSel.value;
    // 既存 item を型に合わせて寄せる
    _currentEdit.target.items = _currentEdit.target.items.map(it => (
      _currentEdit.target.type === "numeric"
        ? { label: it.label || "", unit: it.unit || "" }
        : { label: it.label || "", normal: it.normal || "" }
    ));
    // 規定文チェックは numeric では使えない
    if (_currentEdit.target.type !== "text") _currentEdit.target.isDefault = false;
    renderFormatEditForm();
  });

  const pickerOverlay = document.getElementById("formatPickerOverlay");
  const pickerClose = document.getElementById("formatPickerCloseBtn");
  if (pickerOverlay) pickerOverlay.addEventListener("click", (e) => {
    if (e.target === pickerOverlay) pickerOverlay.classList.remove("active");
  });
  if (pickerClose) pickerClose.addEventListener("click", () => {
    if (pickerOverlay) pickerOverlay.classList.remove("active");
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
