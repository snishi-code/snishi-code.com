"use strict";

import { settings, saveSettings, ensurePatientsHaveAllOKeys } from "../store.js";
import { DEFAULT_O_RULES, clone } from "../constants.js";

const CLEAR_LABELS = { memo: "メモ", s: "S", o: "O（バイタル含む）", a: "A", p: "P", shared: "共有", statusYellow: "ステータス：黄（保留）", statusGreen: "ステータス：緑（済）", statusGray: "ステータス：灰（完了）", statusBlue: "ステータス：青（追記）" };
const STATUS_SWATCHES = { statusYellow: "#fbbf24", statusGreen: "#34d399", statusGray: "#6b7280", statusBlue: "#2563eb" };

function nextCustomRuleKey() {
  const used = new Set(settings.oRules.map(r => r.key));
  for (let i = 1; i < 9999; i++) {
    const k = "custom" + i;
    if (!used.has(k)) return k;
  }
  return "custom" + Math.floor(Math.random() * 1e9);
}

export function renderSettings() {
  const setSDefault = document.getElementById("setSDefault");
  const setADefault = document.getElementById("setADefault");
  const setPDefault = document.getElementById("setPDefault");
  const setORules = document.getElementById("setORules");

  if (setSDefault) setSDefault.value = String(settings?.defaults?.s ?? "");
  if (setADefault) setADefault.value = String(settings?.defaults?.a ?? "");
  if (setPDefault) setPDefault.value = String(settings?.defaults?.p ?? "");

  const clearTargetsBody = document.getElementById("clearTargetsBody");
  if (clearTargetsBody) {
    clearTargetsBody.textContent = "";
    for (const key of Object.keys(CLEAR_LABELS)) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;padding:6px 0;";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = "clearTarget_" + key;
      cb.checked = !!settings.clearTargets?.[key];
      cb.addEventListener("change", () => {
        settings.clearTargets[key] = cb.checked;
        saveSettings();
      });
      const lbl = document.createElement("label");
      lbl.htmlFor = "clearTarget_" + key;
      lbl.style.cursor = "pointer";
      lbl.style.display = "flex";
      lbl.style.alignItems = "center";
      lbl.style.gap = "6px";
      if (STATUS_SWATCHES[key]) {
        const dot = document.createElement("span");
        dot.style.cssText = `display:inline-block;width:16px;height:16px;border-radius:3px;background:${STATUS_SWATCHES[key]};flex-shrink:0;`;
        dot.title = CLEAR_LABELS[key];
        lbl.appendChild(dot);
      } else {
        lbl.appendChild(document.createTextNode(CLEAR_LABELS[key]));
      }
      row.appendChild(cb);
      row.appendChild(lbl);
      clearTargetsBody.appendChild(row);
    }
  }

  if (!setORules) return;
  setORules.textContent = "";
  for (let idx = 0; idx < settings.oRules.length; idx++) {
    const r = settings.oRules[idx];
    const wrap = document.createElement("div");
    wrap.style.borderTop = idx === 0 ? "0" : "1px solid var(--line)";
    wrap.style.paddingTop = idx === 0 ? "0" : "12px";
    wrap.style.marginTop = idx === 0 ? "0" : "12px";

    const grid = document.createElement("div");
    grid.className = "formGrid two";

    const col1 = document.createElement("div");
    const l1 = document.createElement("label");
    l1.textContent = "項目";
    const inLabel = document.createElement("input");
    inLabel.type = "text";
    inLabel.className = "settingsInp";
    inLabel.value = String(r.label ?? "");
    inLabel.addEventListener("input", () => {
      settings.oRules[idx].label = String(inLabel.value ?? "");
      saveSettings();
      if (_renderDetailFn) _renderDetailFn();
      if (_renderQrFn) _renderQrFn();
    });
    col1.appendChild(l1);
    col1.appendChild(inLabel);

    const col2 = document.createElement("div");
    const l2 = document.createElement("label");
    l2.textContent = "正常";
    const inNormal = document.createElement("input");
    inNormal.type = "text";
    inNormal.className = "settingsInp";
    inNormal.value = String(r.normalText ?? "");
    inNormal.addEventListener("input", () => {
      settings.oRules[idx].normalText = String(inNormal.value ?? "");
      saveSettings();
      if (_renderDetailFn) _renderDetailFn();
      if (_renderQrFn) _renderQrFn();
    });
    col2.appendChild(l2);
    col2.appendChild(inNormal);

    grid.appendChild(col1);
    grid.appendChild(col2);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";
    actions.style.marginTop = "10px";
    actions.style.flexWrap = "wrap";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "iconBtn";
    del.title = "削除";
    del.setAttribute("aria-label", "削除");
    del.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    del.addEventListener("click", () => {
      const ok = confirm("このO項目を削除します（患者データ側の既存値は残ります）。よろしいですか？");
      if (!ok) return;
      settings.oRules.splice(idx, 1);
      if (settings.oRules.length === 0) settings.oRules = clone(DEFAULT_O_RULES);
      saveSettings();
      ensurePatientsHaveAllOKeys();
      renderSettings();
      if (_renderDetailFn) _renderDetailFn();
      if (_renderQrFn) _renderQrFn();
    });
    actions.appendChild(del);

    wrap.appendChild(grid);
    wrap.appendChild(actions);
    setORules.appendChild(wrap);
  }
}

// Callbacks wired by main.js to avoid circular deps
let _renderDetailFn = null;
let _renderQrFn = null;

export function initSettingsView(renderDetailFn, renderQrFn) {
  _renderDetailFn = renderDetailFn;
  _renderQrFn = renderQrFn;

  const setSDefault = document.getElementById("setSDefault");
  const setADefault = document.getElementById("setADefault");
  const setPDefault = document.getElementById("setPDefault");
  const addORuleBtn = document.getElementById("addORuleBtn");
  const resetORulesBtn = document.getElementById("resetORulesBtn");

  if (setSDefault) setSDefault.addEventListener("input", () => {
    settings.defaults.s = String(setSDefault.value ?? "");
    saveSettings();
    if (_renderQrFn) _renderQrFn();
  });

  if (setADefault) setADefault.addEventListener("input", () => {
    settings.defaults.a = String(setADefault.value ?? "");
    saveSettings();
    if (_renderQrFn) _renderQrFn();
  });

  if (setPDefault) setPDefault.addEventListener("input", () => {
    settings.defaults.p = String(setPDefault.value ?? "");
    saveSettings();
    if (_renderQrFn) _renderQrFn();
  });

  if (addORuleBtn) addORuleBtn.addEventListener("click", () => {
    settings.oRules.push({
      key: nextCustomRuleKey(),
      label: "項目",
      normalText: "",
      placeholder: "",
    });
    saveSettings();
    ensurePatientsHaveAllOKeys();
    renderSettings();
    if (_renderDetailFn) _renderDetailFn();
  });

  if (resetORulesBtn) resetORulesBtn.addEventListener("click", () => {
    const ok = confirm("O項目を初期状態に戻します。よろしいですか？");
    if (!ok) return;
    settings.oRules = clone(DEFAULT_O_RULES);
    saveSettings();
    ensurePatientsHaveAllOKeys();
    renderSettings();
    if (_renderDetailFn) _renderDetailFn();
    if (_renderQrFn) _renderQrFn();
  });
}
