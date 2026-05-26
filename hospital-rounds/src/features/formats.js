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
import { makeTagPicker } from "./tags.js";
import { t } from "../i18n.js";

// strip 右端のハンバーガー (パネルごとの「全フォーマット一覧 = お気に入りトグル popup」を開く)
const FORMAT_PICKER_HAMBURGER_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;

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

// 新規フォーマット作成ウィジェット (タグの makeAddTagWidget と同じ「+」ボタンスタイル)。
// タグ側はインライン入力でラベル確定だが、フォーマットは項目構造があるのでモーダルを開く。
function makeAddFormatWidget(panel, onAdded) {
  const wrap = document.createElement("span");
  wrap.className = "tagAddWidget";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "tagSettingAdd";
  btn.title = t("format.new");
  btn.setAttribute("aria-label", t("format.new.aria"));
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    startNewFormat(() => {
      if (onAdded) onAdded();
    }, panel);
  });
  wrap.appendChild(btn);
  return wrap;
}

// パネルごとに 1 つ作る format picker (タグピッカーと同じ UI = makeTagPicker を再利用)。
// 「checkbox=お気に入り (pinned 全患者共通) / 名前タップ=入力モーダル直開」と役割分離。
// アイコンはハンバーガー (一覧を開く意味)。strip 右端の単一エントリポイントを兼ねる。
function makeFormatPicker(panel, onChange) {
  return makeTagPicker({
    getSelected: () => formatsForPanel(panel).filter(f => f.pinned).map(f => f.id),
    setSelected: (ids) => {
      const set = new Set(ids);
      for (const f of formatsForPanel(panel)) f.pinned = set.has(f.id);
      saveSettings();
    },
    entries: () => formatsForPanel(panel).map(f => ({ value: f.id, label: f.name })),
    onChange,
    iconOnly: true,
    iconHtml: FORMAT_PICKER_HAMBURGER_SVG,
    addWidget: (onAdded) => makeAddFormatWidget(panel, onAdded),
    onItemClick: (entry) => {
      const f = formatsForPanel(panel).find(x => x.id === entry.value);
      if (f) openFormatInputModal(f, panel);
    },
  });
}

export function renderFormatStrip(panel, hostEl) {
  if (!hostEl) return;
  hostEl.textContent = "";
  hostEl.className = "formatStrip";

  // 1) お気に入り (pinned) チップ。横スクロール領域。タップで入力モーダル直開
  const chips = document.createElement("div");
  chips.className = "formatStripChips";
  for (const f of pinnedFormatsForPanel(panel)) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "formatStripBtn formatStripPinned";
    chip.textContent = f.name;
    chip.title = t("format.chip.input.title", { name: f.name });
    chip.addEventListener("click", () => openFormatInputModal(f, panel));
    chips.appendChild(chip);
  }
  hostEl.appendChild(chips);

  // 2) ハンバーガーピッカー (右端固定)。
  //    popup でチェック = お気に入りトグル / + で新規作成 (タグ picker と同 UI)
  const picker = makeFormatPicker(panel, () => {
    renderFormatStrip(panel, hostEl);
  });
  hostEl.appendChild(picker);
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
  // 数値型は CSS grid で縦揃え (label / value / unit / memo の 4 列)。
  // text 型は従来の flex のまま (1 行 = label + textarea + 規定文ボタン)。
  body.className = "formatInputBody " + (format.type === "numeric" ? "numeric" : "text");
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
  // display: contents で 4 子要素を body の grid に直接展開し、行間で縦揃え
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

  // unit セルは常に出す (item.unit が無くても grid 列を揃える)
  const unit = document.createElement("span");
  unit.className = "formatInputUnit";
  unit.textContent = item.unit || "";
  row.appendChild(unit);

  const memo = document.createElement("input");
  memo.type = "text";
  memo.className = "formatInputMemo";
  memo.placeholder = t("format.placeholder.memo");
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
  normalBtn.textContent = t("common.normal");
  normalBtn.title = item.normal ? t("format.normal.tooltip.has", { value: item.normal }) : t("format.normal.tooltip.empty");
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
      // label が空ならコロンを付けず値だけ出す (規定文「著変なし」など)
      const label = String(row.item.label || "").trim();
      parts.push(label ? `${label}：${value}` : value);
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
    titleEl.textContent = t(_currentEdit.isNew ? "format.editTitle.new" : "format.editTitle.edit", { panel: _currentEdit.target.panel });
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
  const target = _currentEdit.target;
  nameInp.value = target.name;
  if (typeSel) typeSel.value = target.type;
  if (joinerInp) joinerInp.value = target.joiner;
  if (pinnedChk) pinnedChk.checked = !!target.pinned;
  if (defaultChk) {
    defaultChk.checked = !!target.isDefault;
    // numeric では isDefault を無効化 (normal 値を持たないため fallback として描画不可)
    defaultChk.disabled = (target.type !== "text");
    defaultChk.parentElement.style.opacity = (target.type === "text") ? "1" : "0.5";
  }
  if (itemsHost) renderFormatEditItems(itemsHost);
}

function renderFormatEditItems(host) {
  host.textContent = "";
  const target = _currentEdit.target;
  for (let i = 0; i < target.items.length; i++) {
    const item = target.items[i];
    const row = document.createElement("div");
    row.className = "formatEditItemRow";

    const label = document.createElement("input");
    label.type = "text";
    label.className = "formatEditItemLabel";
    label.placeholder = t("format.placeholder.label");
    label.value = item.label || "";
    label.addEventListener("input", () => { item.label = String(label.value || ""); });
    row.appendChild(label);

    if (target.type === "numeric") {
      const unit = document.createElement("input");
      unit.type = "text";
      unit.className = "formatEditItemUnit";
      unit.placeholder = t("format.placeholder.unit");
      unit.value = item.unit || "";
      unit.addEventListener("input", () => { item.unit = String(unit.value || ""); });
      row.appendChild(unit);
    } else {
      const normal = document.createElement("input");
      normal.type = "text";
      normal.className = "formatEditItemNormal";
      normal.placeholder = t("format.placeholder.normal");
      normal.value = item.normal || "";
      normal.addEventListener("input", () => { item.normal = String(normal.value || ""); });
      row.appendChild(normal);
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "formatEditItemDel";
    del.title = t("format.deleteItem.title");
    del.setAttribute("aria-label", t("format.deleteItem.aria"));
    del.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    del.addEventListener("click", () => {
      target.items.splice(i, 1);
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

  const target = _currentEdit.target;
  const name = String(nameInp?.value || "").trim();
  if (!name) {
    alert(t("format.name.required"));
    return;
  }
  // 同名チェック (タグの挙動と同じ: 既存と同名なら reject)
  const all = Array.isArray(settings.formats) ? settings.formats : [];
  const dup = all.find(f => f.id !== target.id && f.name === name);
  if (dup) {
    alert(t("format.name.duplicate"));
    return;
  }

  target.name = name;
  // panel はモーダル外で固定。typeSel と pinned/isDefault のみ反映
  target.type = FORMAT_TYPES.includes(typeSel?.value) ? typeSel.value : target.type;
  target.joiner = String(joinerInp?.value ?? (target.type === "text" ? "\n" : ", "));
  target.pinned = !!pinnedChk?.checked;
  target.isDefault = (target.type === "text") ? !!defaultChk?.checked : false;
  // 項目の除外ルール:
  //   text 型:    label / normal どちらか入力があれば保持 (規定文「著変なし」など
  //               ラベルなし正常文のみのケースを許容)
  //   numeric 型: label がなければ意味を成さないので除外
  target.items = target.items.filter(it => {
    const label = String(it.label || "").trim();
    if (target.type === "numeric") return !!label;
    const normal = String(it.normal || "").trim();
    return !!label || !!normal;
  });

  // 同一パネル内に isDefault は 1 つだけ。他はクリア
  if (target.isDefault) {
    for (const f of all) {
      if (f.id !== target.id && f.panel === target.panel) f.isDefault = false;
    }
  }

  if (_currentEdit.isNew) {
    if (!Array.isArray(settings.formats)) settings.formats = [];
    settings.formats.push(target);
  } else {
    const idx = all.findIndex(f => f.id === target.id);
    if (idx >= 0) settings.formats[idx] = target;
    else settings.formats.push(target);
  }
  saveSettings();
  const cb = _currentEdit.onSaved;
  const savedTarget = target;
  closeFormatEditModal();
  if (cb) cb(savedTarget);
  // 保存後は単に閉じるのみ。入力モーダルへの自動遷移は廃止
  // (タップ=お気に入りトグルの設計と整合させ、設定画面からの作成時に
  //  「さっきまで開いていた患者」へ誤反映されるバグを防ぐ)
}

export function closeFormatEditModal() {
  const overlay = document.getElementById("formatEditOverlay");
  if (overlay) overlay.classList.remove("active");
  _currentEdit = null;
}

function addFormatItem() {
  if (!_currentEdit) return;
  const target = _currentEdit.target;
  if (target.type === "numeric") target.items.push({ label: "", unit: "" });
  else target.items.push({ label: "", normal: "" });
  const itemsHost = document.getElementById("formatEditItems");
  if (itemsHost) renderFormatEditItems(itemsHost);
}

// ============================
// 設定画面側の CRUD ヘルパ (settings-view.js から呼ばれる)
// ============================
// panel が省略された場合は O。設定画面から呼ぶ場合は必ず panel を指定する
export function startNewFormat(onSaved, panel) {
  openFormatEditModal(null, panel || "O", onSaved);
}

export function startEditFormat(format, onSaved) {
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
}
