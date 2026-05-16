"use strict";

import { settings, saveSettings, ensurePatientsHaveAllOKeys } from "../store.js";
import { DEFAULT_O_RULES, clone } from "../constants.js";

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
    del.className = "secondary";
    del.textContent = "削除";
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
