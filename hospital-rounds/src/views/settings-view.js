"use strict";

import { settings, appState, rosterState, saveSettings } from "../store.js";
import { DEFAULT_TAGS, clone } from "../constants.js";
import { isAdminEnabled, isAdminTerminal, isNonAdminTerminal } from "../features/admin.js";
import { recordOp } from "../features/roster.js";
import { renameTagAt, deleteTagAt, moveTag, isTagGroupingEnabled, getUserGroups, getTagsInGroup, getUnassignedTags, addGroup, renameGroup, setGroupMode, deleteGroup, setTagGroup, getAllTags, getGroupForTag, makeAddTagWidget } from "../features/tags.js";
import { GROUP_MODE_SINGLE, GROUP_MODE_MULTI } from "../constants.js";
import { bindLongPressAndDrag } from "../features/drag.js";
import { startNewFormat, startEditFormat, deleteFormatById } from "../features/formats.js";
import { renderPassphraseStrength, PASSPHRASE_MIN_LEN } from "../features/passphrase-strength.js";
import { t } from "../i18n.js";

const STATUS_SWATCHES = { statusYellow: "#f59e0b", statusGreen: "#14b8a6", statusGray: "#6b7280", statusBlue: "#2563eb" };

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

const PANELS_IN_ORDER = ["S", "O", "A", "P"];

function renderFormatListForPanel(panel) {
  const host = document.getElementById("setFormats_" + panel);
  if (!host) return;
  host.textContent = "";
  const all = Array.isArray(settings.formats) ? settings.formats : [];
  const list = all.filter(f => f.panel === panel);
  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.style.padding = "8px 4px";
    empty.style.color = "#6b7280";
    empty.style.fontSize = "13px";
    empty.textContent = "未登録。右上の + から追加してください。";
    host.appendChild(empty);
    return;
  }
  for (const f of list) {
    const row = document.createElement("div");
    row.className = "formatListRow";
    // 行背景色で状態を示す (チップで重ねずシンプルに):
    //   pinned (お気に入り) = 緑
    //   isDefault (規定文)  = 青
    //   両方 = 左ストライプを上半分=青/下半分=緑に分割 + 薄い混色背景
    if (f.pinned) row.classList.add("pinned");
    if (f.isDefault) row.classList.add("isDefault");

    const name = document.createElement("span");
    name.className = "formatListName";
    name.textContent = f.name;
    row.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "formatListMeta";
    // 項目の kind を要約: ユニークな kind を i18n ラベルで列挙 (1 種なら 1 つ、混在なら複数)
    const kindsInFmt = Array.from(new Set((f.items || []).map(it => it.kind || "text")));
    meta.textContent = kindsInFmt.length
      ? kindsInFmt.map(k => t("format.itemKind." + k)).join(" / ")
      : "";
    row.appendChild(meta);

    const actions = document.createElement("span");
    actions.className = "formatListActions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "iconBtn";
    editBtn.title = "編集";
    editBtn.setAttribute("aria-label", "編集");
    editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    editBtn.addEventListener("click", () => {
      startEditFormat(f, () => {
        renderFormatList();
        if (_renderDetailFn) _renderDetailFn();
      });
    });
    actions.appendChild(editBtn);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "iconBtn";
    del.title = "削除";
    del.setAttribute("aria-label", "削除");
    del.innerHTML = TRASH_SVG;
    del.addEventListener("click", () => {
      if (!confirm(t("format.delete.confirm", { name: f.name }))) return;
      deleteFormatById(f.id);
      renderFormatList();
      if (_renderDetailFn) _renderDetailFn();
    });
    actions.appendChild(del);

    row.appendChild(actions);
    host.appendChild(row);
  }
}

function renderFormatList() {
  for (const panel of PANELS_IN_ORDER) renderFormatListForPanel(panel);
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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "clearTargetBtn" + (settings.clearTargets?.[key] ? " selected" : "");
    btn.title = CLEAR_ITEM_TITLE[key];
    btn.setAttribute("aria-label", CLEAR_ITEM_TITLE[key]);
    btn.appendChild(buildClearTargetLabelContent(key));
    const x = document.createElement("span");
    x.className = "clearTargetX";
    x.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    btn.appendChild(x);
    btn.addEventListener("click", () => {
      const next = !settings.clearTargets[key];
      settings.clearTargets[key] = next;
      btn.classList.toggle("selected", next);
      saveSettings();
    });
    body.appendChild(btn);
  }
}

function renderToggleIcon(iconEl, on) {
  if (!iconEl) return;
  if (on) {
    iconEl.innerHTML = `<rect x="2" y="7" width="20" height="10" rx="5" fill="${getComputedStyle(document.documentElement).getPropertyValue('--status-green-bg') || '#14b8a6'}" stroke="currentColor"/><circle cx="16" cy="12" r="3" fill="#ffffff" stroke="currentColor"/>`;
  } else {
    iconEl.innerHTML = `<rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="8" cy="12" r="3" fill="currentColor"/>`;
  }
}

function renderAdminExtras() {
  const wrap = document.getElementById("rosterPassphraseWrap");
  // 合言葉入力欄は管理端末のときだけ表示
  if (wrap) wrap.style.display = (settings.adminEnabled && settings.adminTerminal) ? "" : "none";
  const passInp = document.getElementById("rosterPassphraseInput");
  if (passInp) passInp.value = String(settings.rosterPassphrase || "");
  const meter = document.getElementById("passphraseStrengthMeter");
  if (meter) renderPassphraseStrength(meter, settings.rosterPassphrase || "");
  const idLabel = document.getElementById("rosterIdLabel");
  if (idLabel) idLabel.textContent = rosterState?.rosterId ? rosterState.rosterId.slice(0, 18) : "—";
}

function renderAdminToggles() {
  const card = document.getElementById("adminCard");
  const body = document.getElementById("adminBody");
  const adminIcon = document.getElementById("adminToggleIcon");
  if (!card) return;
  const on = !!settings.adminEnabled;
  card.classList.toggle("disabled", !on);
  renderToggleIcon(adminIcon, on);
  if (body) body.style.display = on ? "" : "none";
}

function renderTagGroupingToggleIcon() {
  const icon = document.getElementById("tagGroupingToggleIcon");
  if (!icon) return;
  renderToggleIcon(icon, !!settings.tagGroupingEnabled);
  const host = document.getElementById("tagGroupsHost");
  if (host) host.style.display = settings.tagGroupingEnabled ? "" : "none";
}

const SINGLE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>`;
const MULTI_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor"/><rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>`;

function renderTagGroups() {
  const host = document.getElementById("tagGroupsHost");
  if (!host) return;
  host.textContent = "";
  if (!settings.tagGroupingEnabled) return;

  // Each user group as a "container"
  for (const g of getUserGroups()) {
    const card = document.createElement("div");
    card.className = "tagGroupCard";

    // Header row: name + mode toggle + delete
    const head = document.createElement("div");
    head.className = "tagGroupHead";
    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = "tagGroupName";
    nameBtn.textContent = g.name || "（未入力）";
    nameBtn.title = "タップで名前を変更";
    nameBtn.addEventListener("click", () => {
      const nv = prompt(t("settings.tagGroup.rename.prompt"), g.name);
      if (nv === null) return;
      if (!renameGroup(g.id, nv)) alert(t("settings.tagGroup.rename.failed"));
      renderTagGroups();
      if (_renderPatientUIFn) _renderPatientUIFn();
    });
    head.appendChild(nameBtn);

    const modeBtn = document.createElement("button");
    modeBtn.type = "button";
    modeBtn.className = "iconBtn";
    modeBtn.title = g.mode === GROUP_MODE_SINGLE ? "単選択（タップで複数選択へ）" : "複数選択（タップで単選択へ）";
    modeBtn.innerHTML = g.mode === GROUP_MODE_SINGLE ? SINGLE_ICON : MULTI_ICON;
    modeBtn.addEventListener("click", () => {
      setGroupMode(g.id, g.mode === GROUP_MODE_SINGLE ? GROUP_MODE_MULTI : GROUP_MODE_SINGLE);
      renderTagGroups();
      if (_renderPatientUIFn) _renderPatientUIFn();
    });
    head.appendChild(modeBtn);

    // Tag-add icon (opens picker to choose which tags belong)
    const addTagBtn = document.createElement("button");
    addTagBtn.type = "button";
    addTagBtn.className = "iconBtn";
    addTagBtn.title = "このグループに含めるタグを選ぶ";
    addTagBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>`;
    addTagBtn.addEventListener("click", () => openGroupMembershipPicker(g.id, addTagBtn));
    head.appendChild(addTagBtn);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "iconBtn";
    delBtn.title = "グループ削除";
    delBtn.innerHTML = TRASH_SVG;
    delBtn.addEventListener("click", () => {
      if (!confirm(t("settings.tagGroup.delete.confirm", { name: g.name }))) return;
      deleteGroup(g.id);
      renderTagGroups();
      if (_renderPatientUIFn) _renderPatientUIFn();
    });
    head.appendChild(delBtn);

    card.appendChild(head);

    // Tag chips for this group
    const body = document.createElement("div");
    body.className = "tagGroupBody";
    const tags = getTagsInGroup(g.id);
    if (tags.length === 0) {
      const empty = document.createElement("div");
      empty.className = "qrHint";
      empty.textContent = "（タグなし）";
      body.appendChild(empty);
    } else {
      for (const t of tags) {
        const chip = document.createElement("span");
        chip.className = "tagChip";
        chip.style.cursor = "pointer";
        chip.title = "タップでこのグループから外す";
        chip.textContent = t;
        chip.addEventListener("click", () => {
          setTagGroup(t, "");
          renderTagGroups();
          if (_renderPatientUIFn) _renderPatientUIFn();
        });
        body.appendChild(chip);
      }
    }
    card.appendChild(body);
    host.appendChild(card);
  }

  // Add-group button
  const addGroupBtn = document.createElement("button");
  addGroupBtn.type = "button";
  addGroupBtn.className = "tagGroupAdd";
  addGroupBtn.title = "グループ追加";
  addGroupBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  addGroupBtn.addEventListener("click", () => {
    const nm = prompt(t("settings.tagGroup.add.prompt"));
    if (!nm) return;
    if (!addGroup(nm)) alert(t("settings.tagGroup.add.failed"));
    renderTagGroups();
  });
  host.appendChild(addGroupBtn);

  // Unassigned tags hint
  const un = getUnassignedTags();
  if (un.length) {
    const hint = document.createElement("div");
    hint.className = "qrHint";
    hint.style.cssText = "margin-top:10px;";
    hint.textContent = `未分類のタグ: ${un.length}件`;
    host.appendChild(hint);
  }
}

function openGroupMembershipPicker(groupId, anchor) {
  // Simple confirm-based picker using a vertical checkbox list overlay
  const existing = document.getElementById("groupPickerOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "groupPickerOverlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.35);z-index:200;display:flex;align-items:center;justify-content:center;padding:20px;";
  const panel = document.createElement("div");
  panel.style.cssText = "background:#fff;border-radius:12px;max-width:360px;width:100%;max-height:70vh;display:flex;flex-direction:column;overflow:hidden;";
  const head = document.createElement("div");
  head.style.cssText = "padding:10px 14px;border-bottom:1px solid var(--line);font-weight:700;";
  head.textContent = "このグループに含めるタグを選択";
  panel.appendChild(head);
  const body = document.createElement("div");
  body.style.cssText = "overflow:auto;padding:8px 14px;";
  const tags = getAllTags();
  for (const t of tags) {
    const cur = getGroupForTag(t);
    const lbl = document.createElement("label");
    lbl.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 0;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = cur === groupId;
    cb.addEventListener("change", () => {
      setTagGroup(t, cb.checked ? groupId : "");
    });
    lbl.appendChild(cb);
    const sp = document.createElement("span");
    sp.textContent = t + (cur && cur !== groupId ? "（別グループ）" : "");
    lbl.appendChild(sp);
    body.appendChild(lbl);
  }
  panel.appendChild(body);
  const foot = document.createElement("div");
  foot.style.cssText = "padding:10px 14px;border-top:1px solid var(--line);display:flex;justify-content:flex-end;";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "secondary";
  closeBtn.textContent = "閉じる";
  closeBtn.addEventListener("click", () => {
    overlay.remove();
    renderTagGroups();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });
  foot.appendChild(closeBtn);
  panel.appendChild(foot);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

// ============================
// Tag list (chip-based UI with tap-to-edit, long-press to delete/drag)
// ============================

let _draftTagIndex = -1; // index of empty draft tag being added

function makeTagChip(idx) {
  const name = settings.tags[idx] || "";
  const wrap = document.createElement("div");
  wrap.className = "tagSettingChip";
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
      if (confirm(t("settings.tag.delete.confirm", { name }))) {
        deleteTagAt(idx);
        renderTagsList();
        if (_renderPatientUIFn) _renderPatientUIFn();
      }
    },
    () => openInlineTagEditor(wrap, idx)
  );

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
          alert(t("settings.tag.name.duplicate"));
          settings.tags.splice(idx, 1);
        } else {
          settings.tags[idx] = next;
          saveSettings();
          recordOp({ type: "tag.add", name: next });
        }
      } else if (next !== old) {
        if (!renameTagAt(idx, next)) {
          alert(t("settings.tag.name.duplicate"));
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

  // 「+ 新規タグ」は features/tags.js の共通ウィジェットを使う（患者画面・
  // メモ/共有ピッカーと同じ実装＆見た目）。
  wrap.appendChild(makeAddTagWidget({
    onAdded: () => {
      _draftTagIndex = -1;
      renderTagsList();
      if (_renderPatientUIFn) _renderPatientUIFn();
    },
  }));

  host.appendChild(wrap);
}

export function renderSettings() {
  renderClearTargets();
  renderAdminToggles();
  renderAdminExtras();
  renderTagGroupingToggleIcon();
  renderTagsList();
  renderTagGroups();
  renderFormatList();
}

// Callbacks wired by main.js to avoid circular deps
let _renderDetailFn = null;
let _renderQrFn = null;
let _renderPatientUIFn = null;

export function initSettingsView(renderDetailFn, renderQrFn, renderPatientUIFn) {
  _renderDetailFn = renderDetailFn;
  _renderQrFn = renderQrFn;
  _renderPatientUIFn = renderPatientUIFn;

  const addTagBtn = document.getElementById("addTagBtn");
  const resetTagsBtn = document.getElementById("resetTagsBtn");

  // S/O/A/P それぞれの「+」ボタンをそのパネル用にバインド
  for (const panel of PANELS_IN_ORDER) {
    const btn = document.getElementById("addFormatBtn" + panel);
    if (!btn) continue;
    btn.addEventListener("click", () => {
      startNewFormat(() => {
        renderFormatList();
        if (_renderDetailFn) _renderDetailFn();
      }, panel);
    });
  }

  const adminEnableBtn = document.getElementById("adminEnableBtn");
  if (adminEnableBtn) adminEnableBtn.addEventListener("click", () => {
    if (settings.adminEnabled) {
      // 被管理端末は脱出不可（管理端末から名簿を受け取った時点で固定）。
      // 単に管理機能を切りたいなら、管理機能オフの端末から名簿を取り直すこと。
      if (isNonAdminTerminal()) {
        alert(t("admin.toggle.locked"));
        return;
      }
      if (!confirm(t("admin.toggle.confirm.off"))) return;
      settings.adminEnabled = false;
      settings.adminTerminal = false;
    } else {
      // トグルをオン → この端末が管理端末に。
      if (!confirm(t("admin.toggle.confirm.on"))) return;
      settings.adminEnabled = true;
      settings.adminTerminal = true;
      if (!settings.rosterPassphrase) {
        // 12 文字未満なら再入力を促す。キャンセルは何もせず終了。
        while (true) {
          const phrase = prompt(t("admin.passphrase.prompt"));
          if (phrase === null) break;
          const trimmed = phrase.trim();
          if ([...trimmed].length < PASSPHRASE_MIN_LEN) {
            alert(t("admin.passphrase.tooShort", { len: [...trimmed].length }));
            continue;
          }
          settings.rosterPassphrase = trimmed;
          break;
        }
      }
    }
    saveSettings();
    renderAdminToggles();
    renderAdminExtras();
    renderTagsList();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });

  const rosterPassphraseInput = document.getElementById("rosterPassphraseInput");
  if (rosterPassphraseInput) rosterPassphraseInput.addEventListener("input", () => {
    settings.rosterPassphrase = String(rosterPassphraseInput.value ?? "");
    const meter = document.getElementById("passphraseStrengthMeter");
    if (meter) renderPassphraseStrength(meter, settings.rosterPassphrase);
    saveSettings();
  });

  if (addTagBtn) addTagBtn.addEventListener("click", () => {
    if (!Array.isArray(settings.tags)) settings.tags = [];
    settings.tags.push("");
    saveSettings();
    renderTagsList();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });

  const tagGroupingEnableBtn = document.getElementById("tagGroupingEnableBtn");
  if (tagGroupingEnableBtn) tagGroupingEnableBtn.addEventListener("click", () => {
    if (settings.tagGroupingEnabled) {
      if (!confirm(t("tag.group.disable.confirm"))) return;
      settings.tagGroupingEnabled = false;
    } else {
      if (!confirm(t("tag.group.enable.confirm"))) return;
      settings.tagGroupingEnabled = true;
    }
    saveSettings();
    renderTagGroupingToggleIcon();
    renderTagGroups();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });

  if (resetTagsBtn) resetTagsBtn.addEventListener("click", () => {
    const ok = confirm(t("tag.reset.confirm"));
    if (!ok) return;
    settings.tags = clone(DEFAULT_TAGS);
    saveSettings();
    renderTagsList();
    if (_renderPatientUIFn) _renderPatientUIFn();
  });
}
