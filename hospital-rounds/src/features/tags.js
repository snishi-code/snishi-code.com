"use strict";

import { settings, appState, markUpdated, scheduleSave } from "../store.js";

const TAG_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;

export function isTagsEnabled() {
  return !!settings.tagsEnabled;
}

export function getAllTags() {
  return Array.isArray(settings.tags)
    ? settings.tags.filter(d => typeof d === "string" && d.trim()).map(d => d.trim())
    : [];
}

export function getPatientTags(patientIndex) {
  const p = appState.patients[patientIndex];
  if (!p) return [];
  return Array.isArray(p.tags) ? p.tags.slice() : [];
}

function setPatientTags(patientIndex, tags) {
  if (!appState.patients[patientIndex]) return;
  appState.patients[patientIndex].tags = tags.slice();
  markUpdated(patientIndex + 1);
  scheduleSave();
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

function buildTagSummary(selected) {
  if (!selected || !selected.length) {
    return `<span class="tagPickerIcon">${TAG_SVG}</span>`;
  }
  const safe = selected.map(t => `<span class="tagChip">${escapeHtml(t)}</span>`).join("");
  return `<span class="tagPickerIcon">${TAG_SVG}</span>${safe}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" })[c]);
}

export function makeTagPicker(opts) {
  const {
    getSelected,
    setSelected,
    allTags,
    onChange,
    placeholder = "—",
    fillWidth = false,
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
    trigger.innerHTML = buildTagSummary(selected);
  }

  function refreshPopup() {
    popup.textContent = "";
    const tags = (typeof allTags === "function" ? allTags() : allTags) || [];
    if (!tags.length) {
      const empty = document.createElement("div");
      empty.className = "tagPickerEmpty";
      empty.textContent = "（タグ未登録）";
      popup.appendChild(empty);
      return;
    }
    const current = new Set(getSelected());
    for (const tag of tags) {
      const lbl = document.createElement("label");
      lbl.className = "tagPickerOpt";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = current.has(tag);
      cb.addEventListener("change", () => {
        const next = new Set(getSelected());
        if (cb.checked) next.add(tag);
        else next.delete(tag);
        setSelected(Array.from(next));
        refreshTrigger();
        if (onChange) onChange();
      });
      lbl.appendChild(cb);
      const txt = document.createElement("span");
      txt.textContent = tag;
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

// ============================
// Patient tag picker (binds to patient.tags)
// ============================

export function makePatientTagPicker(patientIndex, onChange) {
  return makeTagPicker({
    getSelected: () => getPatientTags(patientIndex),
    setSelected: (tags) => setPatientTags(patientIndex, tags),
    allTags: getAllTags,
    onChange,
  });
}
