"use strict";

import { settings, appState, saveSettings, scheduleSave, markUpdated } from "../store.js";
import { STATUS, STATUS_TAG_PREFIX, TAG_FILTER_MODE_AND, TAG_FILTER_MODE_OR, DEFAULT_TAG_FILTER_MODE, GROUP_MODE_SINGLE, GROUP_MODE_MULTI, STATUS_GROUP_ID } from "../constants.js";
import { recordOp } from "./roster.js";

function newGroupId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return "g_" + crypto.randomUUID().slice(0, 8);
  return "g_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const TAG_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;

const AND_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/><path d="M9 6.6 a6 6 0 0 1 0 10.8 a6 6 0 0 1 0 -10.8 z" fill="currentColor" stroke="none" transform="translate(3 0)"/></svg>`;
const OR_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.85" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>`;

// Status virtual tags exposed in filter pickers (palette kept in sync with style.css)
const STATUS_TAG_DEFS = [
  { value: STATUS_TAG_PREFIX + STATUS.NONE,   label: "白", color: "#ffffff", borderColor: "#9ca3af" },
  { value: STATUS_TAG_PREFIX + STATUS.YELLOW, label: "黄", color: "#f59e0b", borderColor: "#b45309" },
  { value: STATUS_TAG_PREFIX + STATUS.GREEN,  label: "緑", color: "#14b8a6", borderColor: "#0f766e" },
  { value: STATUS_TAG_PREFIX + STATUS.GRAY,   label: "灰", color: "#6b7280" },
  { value: STATUS_TAG_PREFIX + STATUS.BLUE,   label: "青", color: "#bfdbfe", borderColor: "#2563eb" },
];

export function isStatusTag(value) {
  return typeof value === "string" && value.startsWith(STATUS_TAG_PREFIX);
}

export function getStatusFromTag(value) {
  return isStatusTag(value) ? value.slice(STATUS_TAG_PREFIX.length) : "";
}

// ============================
// Public API
// ============================

// User-defined tags only (no virtual status tags)
export function getAllTags() {
  return Array.isArray(settings.tags)
    ? settings.tags.filter(d => typeof d === "string" && d.trim()).map(d => d.trim())
    : [];
}

// For filter pickers: user tags + virtual status tags
export function getAllFilterEntries() {
  const userTags = getAllTags().map(t => ({ value: t, label: t }));
  return [...userTags, ...STATUS_TAG_DEFS];
}

export function getStatusTagDefs() { return STATUS_TAG_DEFS.slice(); }

// ============================
// Tag grouping
// ============================

export function isTagGroupingEnabled() { return !!settings.tagGroupingEnabled; }

// Virtual group always present for status colors
const STATUS_GROUP = { id: STATUS_GROUP_ID, name: "色", mode: GROUP_MODE_SINGLE, virtual: true };

export function getAllGroups() {
  const userGroups = Array.isArray(settings.tagGroups) ? settings.tagGroups.slice() : [];
  return [STATUS_GROUP, ...userGroups];
}

export function getUserGroups() {
  return Array.isArray(settings.tagGroups) ? settings.tagGroups.slice() : [];
}

export function getGroupById(groupId) {
  if (groupId === STATUS_GROUP_ID) return STATUS_GROUP;
  return getUserGroups().find(g => g.id === groupId) || null;
}

export function getGroupForTag(tagName) {
  if (isStatusTag(tagName)) return STATUS_GROUP_ID;
  if (!settings.tagGroupAssign) return "";
  return settings.tagGroupAssign[tagName] || "";
}

export function getTagsInGroup(groupId) {
  if (groupId === STATUS_GROUP_ID) {
    return STATUS_TAG_DEFS.map(d => d.value);
  }
  if (!settings.tagGroupAssign) return [];
  return getAllTags().filter(t => settings.tagGroupAssign[t] === groupId);
}

export function getUnassignedTags() {
  if (!settings.tagGroupAssign) return getAllTags();
  return getAllTags().filter(t => !settings.tagGroupAssign[t]);
}

export function addGroup(name) {
  const nm = String(name || "").trim();
  if (!nm) return null;
  if (!Array.isArray(settings.tagGroups)) settings.tagGroups = [];
  if (settings.tagGroups.some(g => g.name === nm)) return null;
  const g = { id: newGroupId(), name: nm, mode: GROUP_MODE_MULTI };
  settings.tagGroups.push(g);
  saveSettings();
  return g;
}

export function renameGroup(groupId, newName) {
  const nm = String(newName || "").trim();
  if (!nm) return false;
  const g = getUserGroups().find(x => x.id === groupId);
  if (!g) return false;
  if (settings.tagGroups.some(x => x.id !== groupId && x.name === nm)) return false;
  g.name = nm;
  saveSettings();
  return true;
}

export function setGroupMode(groupId, mode) {
  const g = getUserGroups().find(x => x.id === groupId);
  if (!g) return;
  g.mode = (mode === GROUP_MODE_SINGLE) ? GROUP_MODE_SINGLE : GROUP_MODE_MULTI;
  saveSettings();
}

export function deleteGroup(groupId) {
  if (!Array.isArray(settings.tagGroups)) return;
  settings.tagGroups = settings.tagGroups.filter(g => g.id !== groupId);
  // Unassign tags that were in this group
  if (settings.tagGroupAssign) {
    for (const [t, gid] of Object.entries(settings.tagGroupAssign)) {
      if (gid === groupId) delete settings.tagGroupAssign[t];
    }
  }
  saveSettings();
}

export function setTagGroup(tagName, groupId) {
  if (!settings.tagGroupAssign) settings.tagGroupAssign = {};
  if (groupId) settings.tagGroupAssign[tagName] = groupId;
  else delete settings.tagGroupAssign[tagName];
  saveSettings();
}

export function getPatientTags(patientIndex) {
  const p = appState.patients[patientIndex];
  if (!p) return [];
  return Array.isArray(p.tags) ? p.tags.slice() : [];
}

// Add/remove a tag at the settings level (idempotent, no duplicates).
// Returns true if added, false if duplicate or invalid.
export function addNewTag(name) {
  const t = String(name || "").trim();
  if (!t) return false;
  if (!Array.isArray(settings.tags)) settings.tags = [];
  if (settings.tags.includes(t)) return false;
  settings.tags.push(t);
  saveSettings();
  recordOp({ type: "tag.add", name: t });
  return true;
}

export function renameTagAt(idx, newName) {
  if (!Array.isArray(settings.tags) || idx < 0 || idx >= settings.tags.length) return false;
  const oldName = settings.tags[idx];
  const next = String(newName || "").trim();
  if (!next) return false;
  if (oldName === next) return true;
  if (settings.tags.includes(next)) return false; // duplicate
  settings.tags[idx] = next;
  // Sync to all patients
  for (const p of appState.patients) {
    if (Array.isArray(p.tags)) {
      p.tags = p.tags.map(t => t === oldName ? next : t);
    }
  }
  saveSettings();
  scheduleSave();
  recordOp({ type: "tag.rename", from: oldName, to: next });
  return true;
}

export function deleteTagAt(idx) {
  if (!Array.isArray(settings.tags) || idx < 0 || idx >= settings.tags.length) return;
  const name = settings.tags[idx];
  settings.tags.splice(idx, 1);
  // Remove tag from all patients
  for (const p of appState.patients) {
    if (Array.isArray(p.tags) && p.tags.includes(name)) {
      p.tags = p.tags.filter(t => t !== name);
    }
  }
  saveSettings();
  scheduleSave();
  recordOp({ type: "tag.remove", name });
}

export function moveTag(fromIdx, toIdx) {
  if (!Array.isArray(settings.tags)) return;
  if (fromIdx === toIdx) return;
  if (fromIdx < 0 || fromIdx >= settings.tags.length) return;
  if (toIdx < 0 || toIdx >= settings.tags.length) return;
  const [t] = settings.tags.splice(fromIdx, 1);
  settings.tags.splice(toIdx, 0, t);
  saveSettings();
  // Tag order change doesn't need its own op type; recipients use admin sync if needed.
}

export function setPatientTags(patientIndex, tags) {
  const p = appState.patients[patientIndex];
  if (!p) return;
  const next = tags.slice();
  p.tags = next;
  if (p.pid) recordOp({ type: "update", pid: p.pid, field: "tags", value: next });
  markUpdated(patientIndex + 1);
  scheduleSave();
}

// ============================
// Shared tag filter (cross-screen)
// ============================

let _sharedTagFilter = []; // entries from getAllFilterEntries() values (incl. status tags)
let _sharedFilterMode = DEFAULT_TAG_FILTER_MODE;

export function getSharedTagFilter() { return _sharedTagFilter.slice(); }
export function setSharedTagFilter(tags) { _sharedTagFilter = tags.slice(); }
export function getSharedFilterMode() { return _sharedFilterMode; }
export function setSharedFilterMode(mode) {
  _sharedFilterMode = (mode === TAG_FILTER_MODE_OR) ? TAG_FILTER_MODE_OR : TAG_FILTER_MODE_AND;
}

function patientFilterValues(p) {
  const out = Array.isArray(p.tags) ? p.tags.slice() : [];
  out.push(STATUS_TAG_PREFIX + (p.status || STATUS.NONE));
  return out;
}

export function patientMatchesSharedFilter(p) {
  if (!_sharedTagFilter.length) return true;
  const have = new Set(patientFilterValues(p));
  if (_sharedFilterMode === TAG_FILTER_MODE_OR) {
    return _sharedTagFilter.some(t => have.has(t));
  }
  return _sharedTagFilter.every(t => have.has(t));
}

// ============================
// Generic multi-select dropdown
// ============================

let _openPopup = null;
// When the user toggles a tag inside the popup we defer the screen re-render
// until the popup actually closes—otherwise the parent screen recreates the
// picker and the popup snaps shut on every tap.
let _pendingOnChange = null;
function closeOpenPopup() {
  if (_openPopup) {
    _openPopup.style.display = "none";
    _openPopup = null;
  }
  if (_pendingOnChange) {
    const fn = _pendingOnChange;
    _pendingOnChange = null;
    try { fn(); } catch (e) { console.error(e); }
  }
}
document.addEventListener("click", (e) => {
  if (!_openPopup) return;
  const wrap = _openPopup.closest(".tagPicker");
  if (wrap && !wrap.contains(e.target)) closeOpenPopup();
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[c]);
}

function buildChipsHtml(selected, entriesIndex) {
  if (!selected || !selected.length) {
    return `<span class="tagPickerIcon">${TAG_SVG}</span>`;
  }
  const safe = selected.map(v => {
    const e = entriesIndex.get(v) || { label: v };
    if (e.color) {
      return `<span class="tagChip" style="background:${e.color};border-color:${e.borderColor || e.color};color:${e.color === '#ffffff' ? '#111' : '#fff'};">${escapeHtml(e.label)}</span>`;
    }
    return `<span class="tagChip">${escapeHtml(e.label)}</span>`;
  }).join("");
  return `<span class="tagPickerIcon">${TAG_SVG}</span>${safe}`;
}

function entriesToIndex(entries) {
  const m = new Map();
  for (const e of entries) m.set(e.value, e);
  return m;
}

// ============================
// Grouped picker (when tagGroupingEnabled)
// ============================

function buildGroupSection(group, entries, getSelected, setSelected, onChange, refreshTrigger, refreshPopup) {
  const sec = document.createElement("div");
  sec.className = "tagPickerSection";
  if (group.name) {
    const h = document.createElement("div");
    h.className = "tagPickerSectionHead";
    h.innerHTML = `<span>${escapeHtml(group.name)}</span><span class="tagPickerSectionMode">${
      group.mode === GROUP_MODE_SINGLE ? "・単選択" : ""
    }</span>`;
    sec.appendChild(h);
  }
  const current = new Set(getSelected());
  for (const e of entries) {
    const row = document.createElement("label");
    row.className = "tagPickerOpt";
    // Always use checkbox visuals; single-select semantics are enforced in JS
    // (clicking another in the same group clears the previous; clicking the
    // same one again deselects it — true toggle).
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = current.has(e.value);
    cb.addEventListener("change", () => {
      const next = new Set(getSelected());
      if (group.mode === GROUP_MODE_SINGLE) {
        for (const x of entries) next.delete(x.value);
        if (cb.checked) next.add(e.value);
      } else {
        if (cb.checked) next.add(e.value);
        else next.delete(e.value);
      }
      setSelected(Array.from(next));
      refreshTrigger();
      if (group.mode === GROUP_MODE_SINGLE && refreshPopup) refreshPopup();
      if (onChange) _pendingOnChange = onChange;
    });
    row.appendChild(cb);
    if (e.color) {
      const sw = document.createElement("span");
      sw.style.cssText = `display:inline-block;width:18px;height:18px;border-radius:4px;background:${e.color};border:1px solid ${e.borderColor || "rgba(0,0,0,.2)"};flex-shrink:0;`;
      sw.title = e.label;
      row.appendChild(sw);
    } else {
      const txt = document.createElement("span");
      txt.textContent = e.label;
      row.appendChild(txt);
    }
    sec.appendChild(row);
  }
  return sec;
}

// opts: { getSelected, setSelected, entries: [{value,label,color?}], onChange, fillWidth, withModeToggle, includeStatus, forPatient }
// ============================
// 「+ 新規タグ」ウィジェット（設定画面・各タグピッカー popup 共通）
//
// 既定: 小さい「+」ボタン (.tagSettingAdd と同じ見た目)
// タップ: その場が入力欄つきチップ (.tagSettingChip.editing) に差し替わる
// 入力後の挙動:
//   - Enter または別の場所をタップ (blur) で commit
//   - 空 commit や Escape はキャンセル扱いで「+」表示に戻る
//   - 既存タグと同名なら alert で通知し、入力チップを閉じる
// commit 成功時は onAdded(name) を呼ぶ（呼び元で popup や一覧を再描画）。
// ============================
export function makeAddTagWidget({ onAdded } = {}) {
  const wrap = document.createElement("span");
  let activeInput = null; // 多重 commit/再描画ガード

  function showButton() {
    activeInput = null;
    wrap.className = "tagAddWidget";
    wrap.textContent = "";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tagSettingAdd";
    btn.title = "新規タグ";
    btn.setAttribute("aria-label", "新規タグ");
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      showInput();
    });
    wrap.appendChild(btn);
  }

  function showInput() {
    wrap.className = "tagAddWidget tagSettingChip editing";
    wrap.textContent = "";
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "tagSettingInput";
    inp.placeholder = "タグ名";
    activeInput = inp;
    let done = false;
    function finalize(commit) {
      if (done) return;
      done = true;
      const name = String(inp.value || "").trim();
      if (commit && name) {
        if (addNewTag(name)) {
          showButton();
          if (onAdded) onAdded(name);
          return;
        }
        alert("そのタグは既に存在します。");
      }
      showButton();
    }
    inp.addEventListener("blur", () => finalize(true));
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); finalize(true); }
      else if (e.key === "Escape") { e.preventDefault(); finalize(false); }
    });
    // 親 popup の document click ハンドラに拾われて popup ごと閉じないように
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.addEventListener("mousedown", (e) => e.stopPropagation());
    wrap.appendChild(inp);
    setTimeout(() => inp.focus(), 0);
  }

  showButton();
  return wrap;
}

export function makeTagPicker(opts) {
  const {
    getSelected,
    setSelected,
    entries,
    onChange,
    fillWidth = false,
    withModeToggle = false,
    grouped = false,           // group sections when true (forces grouping mode)
    forPatient = false,        // patient picker: hide status group entirely
    iconOnly = false,          // trigger に選択チップを出さず、アイコンだけ表示する
  } = opts;

  const wrap = document.createElement("div");
  wrap.className = "tagPicker";
  if (fillWidth) wrap.classList.add("tagPickerFill");

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "tagPickerTrigger";

  const popup = document.createElement("div");
  popup.className = "tagPickerPopup";
  popup.style.display = "none";

  function refreshTrigger() {
    const selected = getSelected();
    const list = (typeof entries === "function" ? entries() : entries) || [];
    // iconOnly か grouping ON のときはアイコンのみ表示
    if (iconOnly || (grouped && isTagGroupingEnabled())) {
      const hasAny = selected.length > 0;
      trigger.innerHTML = `<span class="tagPickerIcon" style="color:${hasAny ? '#2563eb' : 'var(--muted)'};">${TAG_SVG}</span>`;
      trigger.classList.toggle("hasSelected", hasAny);
    } else {
      trigger.innerHTML = buildChipsHtml(selected, entriesToIndex(list));
    }
  }

  function refreshPopup() {
    popup.textContent = "";
    // Mode toggle row (always shown when withModeToggle is true, regardless of grouping)
    if (withModeToggle) {
      const modeRow = document.createElement("div");
      modeRow.className = "tagPickerModeRow";
      const mkBtn = (mode, svg, title) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tagPickerModeBtn" + (getSharedFilterMode() === mode ? " selected" : "");
        b.innerHTML = svg;
        b.title = title;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          setSharedFilterMode(mode);
          refreshPopup();
          refreshTrigger();
          if (onChange) _pendingOnChange = onChange;
        });
        return b;
      };
      modeRow.appendChild(mkBtn(TAG_FILTER_MODE_AND, AND_SVG, "AND（すべて満たす）"));
      modeRow.appendChild(mkBtn(TAG_FILTER_MODE_OR, OR_SVG, "OR（いずれか満たす）"));
      // Clear button (×) on the right of the mode toggles
      const clr = document.createElement("button");
      clr.type = "button";
      clr.className = "tagPickerClearBtn";
      clr.title = "選択をすべて解除";
      clr.setAttribute("aria-label", "選択をすべて解除");
      clr.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      clr.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!getSelected().length) return;
        if (!confirm("選択中のタグをすべて解除します。よろしいですか？")) return;
        setSelected([]);
        refreshPopup();
        refreshTrigger();
        if (onChange) _pendingOnChange = onChange;
      });
      modeRow.appendChild(clr);
      popup.appendChild(modeRow);
    }

    // Grouped rendering
    if (grouped && isTagGroupingEnabled()) {
      const userGroups = getUserGroups();
      const sectionsHost = document.createElement("div");

      // Status group (filter only)
      if (!forPatient) {
        const statusEntries = STATUS_TAG_DEFS.map(d => ({
          value: d.value, label: d.label, color: d.color, borderColor: d.borderColor,
        }));
        sectionsHost.appendChild(buildGroupSection(STATUS_GROUP, statusEntries, getSelected, setSelected, onChange, refreshTrigger, refreshPopup));
      }
      // User groups
      for (const g of userGroups) {
        const members = getTagsInGroup(g.id);
        if (!members.length) continue;
        const groupEntries = members.map(t => ({ value: t, label: t }));
        sectionsHost.appendChild(buildGroupSection(g, groupEntries, getSelected, setSelected, onChange, refreshTrigger, refreshPopup));
      }
      // Unassigned tags
      const unassigned = getUnassignedTags();
      if (unassigned.length) {
        const unGroup = { id: "__unassigned", name: "未分類", mode: GROUP_MODE_MULTI };
        const unEntries = unassigned.map(t => ({ value: t, label: t }));
        sectionsHost.appendChild(buildGroupSection(unGroup, unEntries, getSelected, setSelected, onChange, refreshTrigger, refreshPopup));
      }
      popup.appendChild(sectionsHost);
      popup.appendChild(makeAddTagWidget({ onAdded: () => { refreshPopup(); refreshTrigger(); } }));
      return;
    }

    const list = (typeof entries === "function" ? entries() : entries) || [];
    if (!list.length) {
      // 既存タグが無い場合も「タグ未登録」のような空状態文言は出さず、
      // 設定画面と同じく「+」だけ並べる
      popup.appendChild(makeAddTagWidget({ onAdded: () => { refreshPopup(); refreshTrigger(); } }));
      return;
    }
    const current = new Set(getSelected());
    for (const e of list) {
      const lbl = document.createElement("label");
      lbl.className = "tagPickerOpt";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = current.has(e.value);
      cb.addEventListener("change", () => {
        const next = new Set(getSelected());
        if (cb.checked) next.add(e.value);
        else next.delete(e.value);
        setSelected(Array.from(next));
        refreshTrigger();
        if (onChange) _pendingOnChange = onChange;
      });
      lbl.appendChild(cb);
      if (e.color) {
        // Status color: show only the color swatch (no text label, per spec)
        const sw = document.createElement("span");
        sw.style.cssText = `display:inline-block;width:18px;height:18px;border-radius:4px;background:${e.color};border:1px solid ${e.borderColor || "rgba(0,0,0,.2)"};flex-shrink:0;`;
        sw.title = e.label;
        sw.setAttribute("aria-label", e.label);
        lbl.appendChild(sw);
      } else {
        const txt = document.createElement("span");
        txt.textContent = e.label;
        lbl.appendChild(txt);
      }
      popup.appendChild(lbl);
    }
    popup.appendChild(makeAddTagWidget({ onAdded: () => { refreshPopup(); refreshTrigger(); } }));
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const showing = popup.style.display !== "none";
    closeOpenPopup();
    if (!showing) {
      refreshPopup();
      popup.style.display = "";
      _openPopup = popup;
    }
  });

  refreshTrigger();
  wrap.appendChild(trigger);
  wrap.appendChild(popup);
  return wrap;
}

// Patient tag picker: user-defined tags only (no status virtual tags)
export function makePatientTagPicker(patientIndex, onChange) {
  return makeTagPicker({
    getSelected: () => getPatientTags(patientIndex),
    setSelected: (tags) => setPatientTags(patientIndex, tags),
    entries: () => getAllTags().map(t => ({ value: t, label: t })),
    onChange,
    grouped: true,
    forPatient: true,
    // 患者ピッカーは選択タグを外側 (inlineTagsRow) に出すので、トリガーは
    // アイコンのみ。チップが二重に出ないようにする。
    iconOnly: true,
  });
}

// Shared filter picker: user tags + status virtual tags + AND/OR toggle (when not grouped)
export function makeSharedTagFilterPicker(onChange) {
  return makeTagPicker({
    getSelected: getSharedTagFilter,
    setSelected: setSharedTagFilter,
    entries: getAllFilterEntries,
    onChange,
    withModeToggle: true,
    grouped: true,
    forPatient: false,
  });
}
