"use strict";

import { settings, appState, saveSettings, ensurePatientsHaveAllOKeys } from "../store.js";
import { DEFAULT_O_RULES, DEFAULT_TAGS, clone, STATUS } from "../constants.js";
import { canEditORule, canDeleteORule, isAdminEnabled, isAdminTerminal, isNonAdminTerminal } from "../features/admin.js";
import { recordOp } from "../features/roster.js";
import { addNewTag, renameTagAt, deleteTagAt, moveTag, setLinkedYellowTag, isTagStatusLinkEnabled } from "../features/tags.js";
import { bindLongPressAndDrag } from "../features/drag.js";

const STATUS_SWATCHES = { statusYellow: "#fbbf24", statusGreen: "#34d399", statusGray: "#6b7280", statusBlue: "#2563eb" };

const MEMO_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
const SHARED_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`;
const TRASH_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

const CLEAR_KEY_ORDER = ["memo", "s", "o", "a", "p", "shared", "statusYellow", "statusGreen", "statusGray", "statusBlue"];

const CLEAR_ITEM_TITLE = {
  memo: "メモ", s: "S", o: "O", a: "A", p: "P", shared: "共有",
  statusYellow: "ステータス：黄（保留）",
  statusGreen: "ステータス：緑（済）",
  statusGray: "ステータス：灰（完了）",
  statusBlue: "ステータス：青（追記）",
};

function nextCustomRuleKey() {
  const used = new Set(settings.oRules.map(r => r.key));
  for (let i = 1; i < 9999; i++) {
    const k = "custom" + i;
    if (!used.has(k)) return k;
  }
  return "custom" + Math.floor(Math.random() * 1e9);
}

function buildClearTargetLabelContent(key) {
  if (STATUS_SWATCHES[key]) {
    const dot = document.createElement("span");
    dot.style.cssText = `display:inline-block;width:16px;height:16px;border-radius:3px;background:${STATUS_SWATCHES[key]};flex-shrink:0;`;
    return dot;
  }
  if (key === "memo" || key === "shared") {
    const span = document.createElement("span");
    span.style.cssText = "display:inline-flex;align-items:center;color:var(--text);";
    span.innerHTML = key === "memo" ? MEMO_SVG : SHARED_SVG;
    return span;
  }
  return document.createTextNode(CLEAR_ITEM_TITLE[key]);
}

function renderClearTargets() {
  const body = document.getElementById("clearTargetsBody");
  if (!body) return;
  body.textContent = "";
  body.className = "cardBody clearTargets";
  for (const key of CLEAR_KEY_ORDER) {
    const item = document.createElement("div");
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
    lbl.title = CLEAR_ITEM_TITLE[key];
    lbl.setAttribute("aria-label", CLEAR_ITEM_TITLE[key]);
    lbl.appendChild(buildClearTargetLabelContent(key));
    item.appendChild(cb);
    item.appendChild(lbl);
    body.appendChild(item);
  }
}

function renderToggleIcon(iconEl, on) {
  if (!iconEl) return;
  if (on) {
    iconEl.innerHTML = `<rect x="2" y="7" width="20" height="10" rx="5" fill="${getComputedStyle(document.documentElement).getPropertyValue('--status-green-bg') || '#34d399'}" stroke="currentColor"/><circle cx="16" cy="12" r="3" fill="#ffffff" stroke="currentColor"/>`;
  } else {
    iconEl.innerHTML = `<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="8" cy="12" r="3" fill="currentColor"/>`;
  }
}

function renderAdminExtras() {
  const wrap = document.getElementById("rosterPassphraseWrap");
  // Show passphrase field only when this device is an admin terminal
  if (wrap) wrap.style.display = (settings.adminEnabled && settings.adminTerminal) ? "" : "none";
  const passInp = document.getElementById("rosterPassphraseInput");
  if (passInp) passInp.value = String(settings.rosterPassphrase || "");
  const idLabel = document.getElementById("rosterIdLabel");
  if (idLabel) idLabel.textContent = appState.rosterId ? appState.rosterId.slice(0, 18) : "—";
}

function renderAdminToggles() {
  const card = document.getElementById("adminCard");
  const body = document.getElementById("adminBody");
  const adminIcon = document.getElementById("adminToggleIcon");
  const termIcon = document.getElementById("adminTerminalToggleIcon");
  const importIcon = document.getElementById("adminImportOnlyToggleIcon");
  if (!card) return;
  const on = !!settings.adminEnabled;
  card.classList.toggle("disabled", !on);
  renderToggleIcon(adminIcon, on);
  renderToggleIcon(termIcon, !!settings.adminTerminal);
  renderToggleIcon(importIcon, !!settings.adminImportOnly);
  if (body) body.style.display = on ? "" : "none";
}

function renderRoomToggleIcon() {
  const card = document.getElementById("roomCard");
  const icon = document.getElementById("roomToggleIcon");
  if (!card || !icon) return;
  const on = !!settings.roomEnabled;
  card.classList.toggle("disabled", !on);
  if (on) {
    icon.innerHTML = `<rect x="2" y="7" width="20" height="10" rx="5" fill="${getComputedStyle(document.documentElement).getPropertyValue('--status-green-bg') || '#34d399'}" stroke="currentColor"/><circle cx="16" cy="12" r="3" fill="#ffffff" stroke="currentColor"/>`;
  } else {
    icon.innerHTML = `<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="8" cy="12" r="3" fill="currentColor"/>`;
  }
}

function renderTagStatusLinkToggleIcon() {
  const icon = document.getElementById("tagStatusLinkToggleIcon");
  if (!icon) return;
  renderToggleIcon(icon, !!settings.tagStatusLinkEnabled);
}

function renderTagsToggleIcon() {
  const card = document.getElementById("tagsCard");
  const icon = document.getElementById("tagsToggleIcon");
  if (!card || !icon) return;
  const on = !!settings.tagsEnabled;
  card.classList.toggle("disabled", !on);
  if (on) {
    icon.innerHTML = `<rect x="2" y="7" width="20" height="10" rx="5" fill="${getComputedStyle(document.documentElement).getPropertyValue('--status-green-bg') || '#34d399'}" stroke="currentColor"/><circle cx="16" cy="12" r="3" fill="#ffffff" stroke="currentColor"/>`;
  } else {
    icon.innerHTML = `<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="8" cy="12" r="3" fill="currentColor"/>`;
  }
}

// ============================
// Tag list (chip-based UI with tap-to-edit, long-press to delete/drag)
// ============================

let _draftTagIndex = -1; // index of empty draft tag being added

function makeTagChip(idx) {
  const name = settings.tags[idx] || "";
  const wrap = document.createElement("div");
  wrap.className = "tagSettingChip";
  if (settings.tagStatusLinkEnabled && settings.tagLinkedToYellow === name) {
    wrap.classList.add("linked-yellow");
  }
  const labelBtn = document.createElement("button");
  labelBtn.type = "button";
  labelBtn.className = "tagSettingChipLabel";
  labelBtn.textContent = name || "（未入力）";
  wrap.appendChild(labelBtn);

  bindLongPressAndDrag(
    labelBtn,
    () => idx,
    (fromIdx, toIdx) => { moveTag(fromIdx, toIdx); renderTagsList(); if (_renderPatientUIFn) _renderPatientUIFn(); },
    () => {
      if (confirm(`タグ「${name}」を削除します。よろしいですか？\n（このタグが付いている患者のタグも一緒に外れます）`)) {
        deleteTagAt(idx);
        renderTagsList();
        if (_renderPatientUIFn) _renderPatientUIFn();
      }
    },
    () => openInlineTagEditor(wrap, idx)
  );

  if (settings.tagStatusLinkEnabled) {
    const linkBtn = document.createElement("button");
    linkBtn.type = "button";
    linkBtn.className = "tagSettingChipLink";
    const isLinked = settings.tagLinkedToYellow === name;
    linkBtn.title = isLinked ? "黄ステータス連携 ON" : "黄ステータスに連携";
    linkBtn.innerHTML = isLinked
      ? `<span class="linkDot linkOn" style="background:#fbbf24;border-color:#b45309;"></span>`
      : `<span class="linkDot"></span>`;
    linkBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (settings.tagLinkedToYellow === name) {
        setLinkedYellowTag("");
      } else {
        setLinkedYellowTag(name);
      }
      renderTagsList();
      if (_renderPatientUIFn) _renderPatientUIFn();
    });
    wrap.appendChild(linkBtn);
  }
  return wrap;
}

function openInlineTagEditor(chipWrap, idx) {
  chipWrap.textContent = "";
  chipWrap.classList.add("editing");
  const inp = document.createElement("input");
  inp.type = "text";
  inp.className = "tagSettingInput";
  inp.value = settings.tags[idx] || "";
  inp.placeholder = "タグ名";
  let done = false;
  const finalize = (commit) => {
    if (done) return;
    done = true;
    const next = String(inp.value || "").trim();
    if (commit && next) {
      const old = settings.tags[idx] || "";
      if (!old) {
        // New tag: rename empty entry to new name
        if (settings.tags.includes(next)) {
          alert("同じ名前のタグが既にあります");
          settings.tags.splice(idx, 1);
        } else {
          settings.tags[idx] = next;
          saveSettings();
          recordOp({ type: "tag.add", name: next });
        }
      } else if (next !== old) {
        if (!renameTagAt(idx, next)) {
          alert("同じ名前のタグが既にあります");
        }
      }
    } else if (!settings.tags[idx]) {
      // Empty entry left blank → remove
      settings.tags.splice(idx, 1);
      saveSettings();
    }
    _draftTagIndex = -1;
    renderTagsList();
    if (_renderPatientUIFn) _renderPatientUIFn();
  };
  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finalize(true); }
    else if (e.key === "Escape") { e.preventDefault(); finalize(false); }
  });
  inp.addEventListener("blur", () => finalize(true));
  chipWrap.appendChild(inp);
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}

function renderTagsList() {
  const host = document.getElementById("tagsList");
  if (!host) return;
  host.textContent = "";

  if (!Array.isArray(settings.tags)) settings.tags = [];

  const wrap = document.createElement("div");
  wrap.className = "tagSettingList";

  for (let idx = 0; idx < settings.tags.length; idx++) {
    const chip = makeTagChip(idx);
    wrap.appendChild(chip);
    if (idx === _draftTagIndex) openInlineTagEditor(chip, idx);
  }

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "tagSettingAdd";
  addBtn.title = "追加";
  addBtn.setAttribute("aria-label", "追加");
  addBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  addBtn.addEventListener("click", () => {
    if (!Array.isArray(settings.tags)) settings.tags = [];
    settings.tags.push("");
    _draftTagIndex = settings.tags.length - 1;
    renderTagsList();
  });
  wrap.appendChild(addBtn);

  host.appendChild(wrap);
}

export function renderSettings() {
  const setSDefault = document.getElementById("setSDefault");
  const setADefault = document.getElementById("setADefault");
  const setPDefault = document.getElementById("setPDefault");
  const setORules = document.getElementById("setORules");

  if (setSDefault) setSDefault.value = String(settings?.defaults?.s ?? "");
  if (setADefault) setADefault.value = String(settings?.defaults?.a ?? "");
  if (setPDefault) setPDefault.value = String(settings?.defaults?.p ?? "");

  renderClearTargets();
  renderAdminToggles();
  renderAdminExtras();
  renderRoomToggleIcon();
  renderTagsToggleIcon();
  renderTagStatusLinkToggleIcon();
  renderTagsList();

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

    const canEdit = canEditORule(r);
    if (!canEdit) {
      inLabel.disabled = true;
      inNormal.disabled = true;
    }

    const del = document.createElement("button");
    del.type = "button";
    del.className = "iconBtn";
    del.title = "削除";
    del.setAttribute("aria-label", "削除");
    del.innerHTML = TRASH_SVG;
    if (!canDeleteORule(r)) {
      del.disabled = true;
      del.style.opacity = "0.4";
      del.title = "管理端末配布項目は削除できません";
    }
    del.addEventListener("click", () => {
      if (!canDeleteORule(r)) return;
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
let _renderPatientUIFn = null;

export function initSettingsView(renderDetailFn, renderQrFn, renderPatientUIFn) {
  _renderDetailFn = renderDetailFn;
  _renderQrFn = renderQrFn;
  _renderPatientUIFn = renderPatientUIFn;

  const setSDefault = document.getElementById("setSDefault");
  const setADefault = document.getElementById("setADefault");
  const setPDefault = document.getElementById("setPDefault");
  const addORuleBtn = document.getElementById("addORuleBtn");
  const resetORulesBtn = document.getElementById("resetORulesBtn");
  const addTagBtn = document.getElementById("addTagBtn");
  const resetTagsBtn = document.getElementById("resetTagsBtn");
  const tagsEnableBtn = document.getElementById("tagsEnableBtn");

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

  const roomEnableBtn = document.getElementById("roomEnableBtn");
  if (roomEnableBtn) roomEnableBtn.addEventListener("click", () => {
    if (isNonAdminTerminal()) { alert("管理機能ONの非管理端末では変更できません"); return; }
    if (isAdminTerminal() && settings.roomEnabled) { alert("管理端末では部屋番号機能は必須です"); return; }
    settings.roomEnabled = !settings.roomEnabled;
    saveSettings();
    renderRoomToggleIcon();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });

  const adminEnableBtn = document.getElementById("adminEnableBtn");
  if (adminEnableBtn) adminEnableBtn.addEventListener("click", () => {
    if (settings.adminEnabled) {
      if (!confirm("管理機能をオフにします。よろしいですか？")) return;
      if (isNonAdminTerminal()) {
        if (!confirm("この端末は非管理端末です。管理端末の保持者に確認してから無効化してください。\n本当にオフにしますか？")) return;
      }
      settings.adminEnabled = false;
      settings.adminTerminal = false;
      settings.adminImportOnly = false;
    } else {
      settings.adminEnabled = true;
    }
    saveSettings();
    renderAdminToggles();
    renderAdminExtras();
    renderTagsToggleIcon();
    renderRoomToggleIcon();
    renderTagsList();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });

  const adminTerminalBtn = document.getElementById("adminTerminalBtn");
  if (adminTerminalBtn) adminTerminalBtn.addEventListener("click", () => {
    if (!settings.adminEnabled) { alert("管理機能をONにしてください"); return; }
    if (settings.adminTerminal) {
      if (!confirm("この端末を管理端末から外します。よろしいですか？")) return;
      settings.adminTerminal = false;
    } else {
      if (!confirm("この端末を管理端末にします。管理端末は同じ病棟・チーム内で1台のみにしてください。\nよろしいですか？")) return;
      settings.adminTerminal = true;
      settings.adminImportOnly = false; // mutual exclusivity
      settings.roomEnabled = true;
      settings.tagsEnabled = true;
      if (!settings.rosterPassphrase) {
        const phrase = prompt("名簿コピーに使う「合言葉」を設定してください。\n日本語・英語など自由。受信側にも口頭などで共有してください。");
        if (phrase && phrase.trim()) settings.rosterPassphrase = phrase.trim();
      }
    }
    saveSettings();
    renderAdminToggles();
    renderAdminExtras();
    renderRoomToggleIcon();
    renderTagsToggleIcon();
    renderTagsList();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });

  const rosterPassphraseInput = document.getElementById("rosterPassphraseInput");
  if (rosterPassphraseInput) rosterPassphraseInput.addEventListener("input", () => {
    settings.rosterPassphrase = String(rosterPassphraseInput.value ?? "");
    saveSettings();
  });

  const adminImportOnlyBtn = document.getElementById("adminImportOnlyBtn");
  if (adminImportOnlyBtn) adminImportOnlyBtn.addEventListener("click", () => {
    if (!settings.adminEnabled) { alert("管理機能をONにしてください"); return; }
    if (settings.adminImportOnly) {
      settings.adminImportOnly = false;
    } else {
      settings.adminImportOnly = true;
      settings.adminTerminal = false; // mutual exclusivity
      settings.roomEnabled = true;
      settings.tagsEnabled = true;
    }
    saveSettings();
    renderAdminToggles();
    renderRoomToggleIcon();
    renderTagsToggleIcon();
    renderTagsList();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });

  if (tagsEnableBtn) tagsEnableBtn.addEventListener("click", () => {
    settings.tagsEnabled = !settings.tagsEnabled;
    saveSettings();
    renderTagsToggleIcon();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });

  if (addTagBtn) addTagBtn.addEventListener("click", () => {
    if (!Array.isArray(settings.tags)) settings.tags = [];
    settings.tags.push("");
    saveSettings();
    renderTagsList();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });

  const tagStatusLinkEnableBtn = document.getElementById("tagStatusLinkEnableBtn");
  if (tagStatusLinkEnableBtn) tagStatusLinkEnableBtn.addEventListener("click", () => {
    if (!settings.tagsEnabled) { alert("先にタグ機能をONにしてください"); return; }
    if (settings.tagStatusLinkEnabled) {
      if (!confirm("黄ステータス連携をオフにします。連携中のタグは解除され、対象患者のステータスは元に戻ります。よろしいですか？")) return;
      // Unlink: restore status on patients with the linked tag
      const linked = settings.tagLinkedToYellow;
      if (linked) {
        for (const p of appState.patients) {
          if (Array.isArray(p.tags) && p.tags.includes(linked)) {
            if (p.status === STATUS.YELLOW && p.prevStatus) {
              p.status = p.prevStatus;
              p.prevStatus = null;
            }
          }
        }
      }
      settings.tagStatusLinkEnabled = false;
      settings.tagLinkedToYellow = "";
    } else {
      if (!confirm("⚠ 黄ステータス連携を有効にします。\n\n選択したタグが付いた患者は自動で黄ステータスになり、ステータス変更ができなくなります。タグを外すと元に戻りません（黄のまま）。\n\nよろしいですか？")) return;
      settings.tagStatusLinkEnabled = true;
    }
    saveSettings();
    renderTagStatusLinkToggleIcon();
    renderTagsList();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });

  if (resetTagsBtn) resetTagsBtn.addEventListener("click", () => {
    const ok = confirm("タグ一覧を初期状態に戻します。よろしいですか？");
    if (!ok) return;
    settings.tags = clone(DEFAULT_TAGS);
    saveSettings();
    renderTagsList();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });
}
