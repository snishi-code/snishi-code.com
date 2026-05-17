"use strict";

import { settings, appState, saveSettings, scheduleSave, markUpdated } from "../store.js";
import { STATUS, STATUS_TAG_PREFIX, TAG_FILTER_MODE_AND, TAG_FILTER_MODE_OR, DEFAULT_TAG_FILTER_MODE } from "../constants.js";
import { recordOp } from "./roster.js";

const TAG_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;

const AND_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/><path d="M9 6.6 a6 6 0 0 1 0 10.8 a6 6 0 0 1 0 -10.8 z" fill="currentColor" stroke="none" transform="translate(3 0)"/></svg>`;
const OR_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.85" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/></svg>`;

// Status virtual tags exposed in filter pickers
const STATUS_TAG_DEFS = [
  { value: STATUS_TAG_PREFIX + STATUS.NONE,   label: "白", color: "#ffffff", borderColor: "#9ca3af" },
  { value: STATUS_TAG_PREFIX + STATUS.YELLOW, label: "黄", color: "#fbbf24" },
  { value: STATUS_TAG_PREFIX + STATUS.GREEN,  label: "緑", color: "#34d399" },
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

export function isTagsEnabled() { return !!settings.tagsEnabled; }
export function isTagStatusLinkEnabled() { return !!settings.tagStatusLinkEnabled; }

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
  // Sync to link target if applicable
  if (settings.tagLinkedToYellow === oldName) settings.tagLinkedToYellow = next;
  saveSettings();
  scheduleSave();
  recordOp({ type: "tag.rename", from: oldName, to: next });
  return true;
}

export function deleteTagAt(idx) {
  if (!Array.isArray(settings.tags) || idx < 0 || idx >= settings.tags.length) return;
  const name = settings.tags[idx];
  settings.tags.splice(idx, 1);
  // Remove tag from all patients; if linked, also restore status where appropriate
  const wasLinked = settings.tagLinkedToYellow === name;
  for (const p of appState.patients) {
    if (Array.isArray(p.tags) && p.tags.includes(name)) {
      p.tags = p.tags.filter(t => t !== name);
      if (wasLinked && p.status === STATUS.YELLOW && p.prevStatus) {
        p.status = p.prevStatus;
        p.prevStatus = null;
      }
    }
  }
  if (wasLinked) settings.tagLinkedToYellow = "";
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

// ============================
// Tag → Yellow status link
// ============================

export function setLinkedYellowTag(name) {
  // Setting a new link: unlink the old first (restore those patients)
  const old = settings.tagLinkedToYellow;
  if (old && old !== name) {
    for (const p of appState.patients) {
      if (Array.isArray(p.tags) && p.tags.includes(old)) {
        if (p.status === STATUS.YELLOW && p.prevStatus) {
          p.status = p.prevStatus;
          p.prevStatus = null;
        }
      }
    }
  }
  settings.tagLinkedToYellow = String(name || "");
  // Activate the new link: set patients having the new tag to yellow (save prevStatus)
  const linked = settings.tagLinkedToYellow;
  if (linked) {
    for (const p of appState.patients) {
      if (Array.isArray(p.tags) && p.tags.includes(linked) && p.status !== STATUS.YELLOW) {
        p.prevStatus = p.status;
        p.status = STATUS.YELLOW;
      }
    }
  }
  saveSettings();
  scheduleSave();
}

// Is the given patient currently locked to YELLOW by an active link?
export function isPatientStatusLockedByLink(p) {
  if (!isTagStatusLinkEnabled()) return false;
  const linked = settings.tagLinkedToYellow;
  if (!linked) return false;
  return Array.isArray(p?.tags) && p.tags.includes(linked);
}

// When a patient's tags are changing, apply link-induced status effects.
// Returns the (possibly mutated) tags + adjusts patient.status / prevStatus in place.
export function applyTagLinkOnPatientChange(patientIndex, newTags) {
  const p = appState.patients[patientIndex];
  if (!p) return newTags;
  if (!isTagStatusLinkEnabled()) return newTags;
  const linked = settings.tagLinkedToYellow;
  if (!linked) return newTags;
  const oldTags = Array.isArray(p.tags) ? p.tags : [];
  const hadLinked = oldTags.includes(linked);
  const hasLinked = newTags.includes(linked);
  if (!hadLinked && hasLinked) {
    // tag added → save prev status, force yellow
    if (p.status !== STATUS.YELLOW) p.prevStatus = p.status;
    p.status = STATUS.YELLOW;
  } else if (hadLinked && !hasLinked) {
    // tag removed: status stays yellow per spec; clear prevStatus
    p.prevStatus = null;
  }
  return newTags;
}

function setPatientTags(patientIndex, tags) {
  const p = appState.patients[patientIndex];
  if (!p) return;
  let next = tags.slice();
  next = applyTagLinkOnPatientChange(patientIndex, next);
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
function closeOpenPopup() {
  if (_openPopup) {
    _openPopup.style.display = "none";
    _openPopup = null;
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

// opts: { getSelected, setSelected, entries: [{value,label,color?}], onChange, fillWidth, withModeToggle }
export function makeTagPicker(opts) {
  const {
    getSelected,
    setSelected,
    entries,
    onChange,
    fillWidth = false,
    withModeToggle = false,
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
    trigger.innerHTML = buildChipsHtml(selected, entriesToIndex(list));
  }

  function refreshPopup() {
    popup.textContent = "";
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
          if (onChange) onChange();
        });
        return b;
      };
      modeRow.appendChild(mkBtn(TAG_FILTER_MODE_AND, AND_SVG, "AND（すべて満たす）"));
      modeRow.appendChild(mkBtn(TAG_FILTER_MODE_OR, OR_SVG, "OR（いずれか満たす）"));
      popup.appendChild(modeRow);
    }
    const list = (typeof entries === "function" ? entries() : entries) || [];
    if (!list.length) {
      const empty = document.createElement("div");
      empty.className = "tagPickerEmpty";
      empty.textContent = "（タグ未登録）";
      popup.appendChild(empty);
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
        if (onChange) onChange();
      });
      lbl.appendChild(cb);
      if (e.color) {
        const sw = document.createElement("span");
        sw.style.cssText = `display:inline-block;width:14px;height:14px;border-radius:3px;background:${e.color};border:1px solid ${e.borderColor || "rgba(0,0,0,.2)"};flex-shrink:0;`;
        lbl.appendChild(sw);
      }
      const txt = document.createElement("span");
      txt.textContent = e.label;
      lbl.appendChild(txt);
      popup.appendChild(lbl);
    }
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
  });
}

// Shared filter picker: user tags + status virtual tags + AND/OR toggle
export function makeSharedTagFilterPicker(onChange) {
  return makeTagPicker({
    getSelected: getSharedTagFilter,
    setSelected: setSharedTagFilter,
    entries: getAllFilterEntries,
    onChange,
    withModeToggle: true,
  });
}
