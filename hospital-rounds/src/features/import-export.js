"use strict";

import {
  appState, settings, rosterState,
  setAppState, setSettings, setRosterState,
  saveNow, saveSettings, normalizeLoaded, normalizeRosterMeta,
  switchWorkspace, createWorkspace,
} from "../store.js";
import { STATUS } from "../constants.js";
import {
  projectBundle, parseBundle, getSection, SECTION,
} from "../bundle.js";
import {
  listBundles, deleteBundle, renameBundle, getActiveWorkspaceId,
} from "../storage.js";
import { recordOp } from "./roster.js";
import { t } from "../i18n.js";

// 「設定も取込」「患者のみ」「キャンセル」を返す。データありの時だけ表示する。
function askImportAction() {
  return new Promise(resolve => {
    const overlay = document.getElementById("importActionOverlay");
    const btnInc = document.getElementById("importIncludeSettingsBtn");
    const btnPat = document.getElementById("importPatientsOnlyBtn");
    const btnCan = document.getElementById("importCancelBtn");

    const cleanup = () => {
      overlay.classList.remove("active");
      btnInc.removeEventListener("click", onInc);
      btnPat.removeEventListener("click", onPat);
      btnCan.removeEventListener("click", onCan);
    };
    const onInc = () => { cleanup(); resolve("include-settings"); };
    const onPat = () => { cleanup(); resolve("patients-only"); };
    const onCan = () => { cleanup(); resolve("cancel"); };

    btnInc.addEventListener("click", onInc);
    btnPat.addEventListener("click", onPat);
    btnCan.addEventListener("click", onCan);

    overlay.classList.add("active");
  });
}

function vibrate() {
  try { navigator.vibrate?.(80); } catch (_) { }
}

function isAppStateEmpty() {
  for (const p of appState.patients) {
    if (p.name || p.room || p.s || p.a?.text || p.p?.text || p.memo || p.shared || p.oFree) return false;
    if (Array.isArray(p.tags) && p.tags.length > 0) return false;
  }
  return true;
}

function isImportedPatientEmpty(p) {
  if (!p) return true;
  if (p.name || p.room || p.s || p.a?.text || p.p?.text || p.memo || p.shared || p.oFree) return false;
  if (Array.isArray(p.tags) && p.tags.length > 0) return false;
  return true;
}

// 取込側の患者が参照しているタグ名のうち、現行 settings.tags に無いものを末尾に追加。
// 名前ベースなので衝突リネームは不要 (同名タグは同タグとして扱う)。
// 永続化は呼出側 (importFromBundle) の saveNow に集約 (race condition 回避)。
function unionImportedTags(importedPatients) {
  if (!Array.isArray(settings.tags)) settings.tags = [];
  const currentSet = new Set(settings.tags);
  for (const p of importedPatients) {
    if (!Array.isArray(p?.tags)) continue;
    for (const t of p.tags) {
      if (!t || currentSet.has(t)) continue;
      settings.tags.push(t);
      currentSet.add(t);
    }
  }
}

// 新規患者として末尾に追加 (status=BLUE で「新着」を可視化)。
// 完全に空のレコードはスキップ。
function appendNewPatients(importedPatients) {
  let count = 0;
  for (const src of importedPatients) {
    if (isImportedPatientEmpty(src)) continue;
    const p = { ...src };
    p.status = STATUS.BLUE;
    p.updatedAt = Date.now();
    p.tags = Array.isArray(src.tags) ? src.tags.slice() : [];
    p.a = { text: String(src.a?.text ?? "") };
    p.p = { text: String(src.p?.text ?? "") };
    // 旧 vitals/o は src 側で normalizeLoaded 経由マイグレーション済み (oFree に流れ込んでいる)
    delete p.vitals;
    delete p.o;
    const atIdx = appState.patients.length;
    appState.patients.push(p);
    if (p.pid && rosterState) {
      recordOp({
        type: "add", at: atIdx,
        patient: { pid: p.pid, name: p.name, room: p.room, tags: p.tags.slice() },
      });
    }
    count++;
  }
  return count;
}

// 受信した settings を反映。
// 永続化は呼出側 (importFromBundle) の saveNow に集約。
function applyImportedSettings(sSettings) {
  setSettings({ ...sSettings });
}

function importedAppStateFromBundle(bundle) {
  const sPatients = getSection(bundle, SECTION.PATIENTS);
  const sMeta = getSection(bundle, SECTION.META);
  return normalizeLoaded({
    title: sMeta && typeof sMeta.title === "string" ? sMeta.title : t("app.title"),
    patients: Array.isArray(sPatients) ? sPatients : null,
  });
}

function importedRosterStateFromBundle(bundle) {
  const sHistory = getSection(bundle, SECTION.HISTORY) || {};
  return normalizeRosterMeta({
    rosterId: bundle.rosterId,
    baseSnapshot: sHistory.baseSnapshot || null,
    commits: sHistory.commits || [],
    head: sHistory.head || null,
  });
}

function refreshTitleUI() {
  const appTitleInput = document.getElementById("appTitleInput");
  if (appTitleInput) appTitleInput.value = appState.title;
  document.title = appState.title;
}

export function initImportExport(callbacks) {
  const { renderHome, renderDetail, renderSettings, renderMemoScreen, renderSharedScreen, refreshHeaderWsLabel } = callbacks;

  const settingsImportFile = document.getElementById("settingsImportFile");
  const settingsDbBtn = document.getElementById("settingsDbBtn");

  let lastExportUrl = null;

  function rerenderCurrentView() {
    renderHome();
    const settingsView = document.getElementById("settingsView");
    const detailView = document.getElementById("detailView");
    const memoView = document.getElementById("memoView");
    const sharedView = document.getElementById("sharedView");
    if (settingsView && settingsView.classList.contains("active")) renderSettings();
    if (detailView && detailView.classList.contains("active")) renderDetail();
    if (memoView && memoView.classList.contains("active")) renderMemoScreen();
    if (sharedView && sharedView.classList.contains("active")) renderSharedScreen();
  }

  // ============================
  // 共通: 端末ファイルダウンロード
  // ============================
  function downloadCurrentAsJson() {
    try {
      if (lastExportUrl) URL.revokeObjectURL(lastExportUrl);
      const bundle = projectBundle({ appState, rosterState, settings });
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      lastExportUrl = url;

      let a = document.getElementById("hiddenDownloadLink");
      if (!a) {
        a = document.createElement("a");
        a.id = "hiddenDownloadLink";
        a.style.display = "none";
        document.body.appendChild(a);
      }
      a.href = url;
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const min = String(now.getMinutes()).padStart(2, "0");
      const titleSafe = (appState.title || t("app.title")).replace(/[\\/:*?"<>|]/g, "_");
      const envPrefix = document.documentElement.dataset.env === "test" ? "test_" : "";
      a.download = `${envPrefix}${titleSafe}_${yyyy}_${mm}${dd}_${hh}${min}.json`;
      a.click();
    } catch (err) {
      console.error("Export failed:", err);
      alert(t("export.failed"));
    }
  }

  // ============================
  // 共通: parsed bundle を取り込む (file/DB どちらの経路も共有)
  // ============================
  async function importFromBundle(bundle) {
    const sPatients = getSection(bundle, SECTION.PATIENTS);
    const sSettings = getSection(bundle, SECTION.SETTINGS);

    if (!Array.isArray(sPatients)) {
      if (sSettings) {
        applyImportedSettings(sSettings);
        saveNow();
      }
      vibrate();
      rerenderCurrentView();
      return;
    }

    const importedState = importedAppStateFromBundle(bundle);
    const importedRoster = importedRosterStateFromBundle(bundle);

    if (isAppStateEmpty()) {
      setAppState(importedState);
      setRosterState(importedRoster);
      refreshTitleUI();
      if (sSettings) applyImportedSettings(sSettings);
      saveNow();
      vibrate();
      rerenderCurrentView();
      return;
    }

    const action = await askImportAction();
    if (action === "cancel") return;

    if (action === "patients-only") {
      unionImportedTags(importedState.patients);
    } else if (action === "include-settings" && sSettings) {
      applyImportedSettings(sSettings);
    }
    appendNewPatients(importedState.patients);
    saveNow();
    vibrate();
    rerenderCurrentView();
  }

  // ============================
  // 入出力 chooser: ワークスペース切替/作成 + 末尾に JSON 取込/保存
  // (旧: ヘッダーの保存/取込アイコン 2 つ → mode 別のチューザ。
  //  新: ヘッダーの DB アイコン 1 つ → 同じチューザに集約。JSON は脇役テキスト 2 ボタンに。)
  // ============================
  const ioOverlay = document.getElementById("ioChooserOverlay");
  const ioFilePickBtn = document.getElementById("ioFilePickBtn");
  const ioFileSaveBtn = document.getElementById("ioFileSaveBtn");
  const ioWorkspaceList = document.getElementById("ioWorkspaceList");
  const ioWsAddRow = document.getElementById("ioWsAddRow");
  const ioCancelBtn = document.getElementById("ioChooserCancelBtn");

  function closeIoChooser() {
    if (ioOverlay) ioOverlay.classList.remove("active");
  }

  function fmtTimestamp(ms) {
    if (!ms) return "";
    const d = new Date(ms);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yy}-${mm}-${dd} ${hh}:${mi}`;
  }

  async function renderWorkspaceList() {
    if (!ioWorkspaceList) return;
    ioWorkspaceList.textContent = "";
    const all = await listBundles();
    if (!all.length) {
      const empty = document.createElement("div");
      empty.className = "ioDbListEmpty";
      empty.textContent = t("io.ws.list.empty");
      ioWorkspaceList.appendChild(empty);
      return;
    }
    const activeId = getActiveWorkspaceId();
    // active が一番上、その他は updatedAt 降順
    const sorted = all.slice().sort((a, b) => {
      if (a.id === activeId) return -1;
      if (b.id === activeId) return 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    for (const r of sorted) {
      ioWorkspaceList.appendChild(buildWorkspaceRow(r, r.id === activeId));
    }
  }

  // 1 行ぶんの要素を組み立てる。read mode (label + 鉛筆) と edit mode (input) を
  // 切り替えるためのヘルパ。read mode は label をタップ → switchWorkspace、
  // 鉛筆 → enterEditMode で input に差し替え、Enter / blur で renameBundle、Escape で取消。
  function buildWorkspaceRow(r, isActive) {
    const row = document.createElement("div");
    row.className = "ioDbRow" + (isActive ? " activeRow" : "");

    const main = document.createElement("div");
    main.className = "ioDbRowMain";
    row.appendChild(main);

    const labelHost = document.createElement("div");
    labelHost.className = "ioDbRowLabelHost";
    main.appendChild(labelHost);

    const meta = document.createElement("div");
    meta.className = "ioDbRowMeta";
    meta.textContent = `${fmtTimestamp(r.updatedAt)} ・ ${r.title || ""}`;
    main.appendChild(meta);

    // active 以外は label area をタップで switch。active は cursor=default
    if (!isActive) {
      main.addEventListener("click", async (e) => {
        // 編集中 input のクリックは伝播しない (stopPropagation で先に防がれる想定)
        if (e.target.closest(".ioDbRowEditInput")) return;
        try {
          await switchWorkspace(r.id);
          vibrate();
          closeIoChooser();
        } catch (err) {
          console.error("workspace switch failed:", err);
          alert(t("io.ws.switch.failed"));
        }
      });
    } else {
      main.style.cursor = "default";
    }

    // アクション欄: 鉛筆 (rename) + 削除 (非 active のみ)
    const actions = document.createElement("div");
    actions.className = "ioDbRowActions";
    row.appendChild(actions);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "ioDbRowEdit";
    editBtn.title = t("io.ws.rename.title");
    editBtn.setAttribute("aria-label", t("io.ws.rename.title"));
    editBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      enterRenameMode();
    });
    actions.appendChild(editBtn);

    if (!isActive) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "ioDbRowDel";
      del.title = t("common.delete");
      del.setAttribute("aria-label", t("common.delete"));
      del.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        const name = r.label || r.title || t("io.ws.untitled");
        if (!confirm(t("io.ws.delete.confirm", { name }))) return;
        try {
          await deleteBundle(r.id);
          await renderWorkspaceList();
        } catch (err) {
          console.error("workspace delete failed:", err);
          alert(t("io.ws.delete.failed"));
        }
      });
      actions.appendChild(del);
    }

    // 初期表示は read mode
    showReadMode();

    function showReadMode() {
      labelHost.textContent = "";
      const lbl = document.createElement("div");
      lbl.className = "ioDbRowLabel";
      lbl.textContent = r.label || r.title || t("io.ws.untitled");
      labelHost.appendChild(lbl);
      editBtn.style.display = "";
    }

    function enterRenameMode() {
      labelHost.textContent = "";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "ioDbRowEditInput";
      inp.value = r.label || r.title || "";
      labelHost.appendChild(inp);
      // 編集ボタンは隠す (Enter / blur / Escape のみで操作)
      editBtn.style.display = "none";

      let done = false;
      async function finalize(commit) {
        if (done) return;
        done = true;
        if (!commit) { showReadMode(); return; }
        const next = String(inp.value || "").trim();
        if (!next || next === (r.label || "")) { showReadMode(); return; }
        try {
          await renameBundle(r.id, next);
          r.label = next;
          // active workspace を改名した時のみヘッダーの ws 名表示を更新
          if (r.id === getActiveWorkspaceId() && refreshHeaderWsLabel) refreshHeaderWsLabel();
        } catch (err) {
          console.error("workspace rename failed:", err);
          alert(t("io.ws.rename.failed"));
        }
        showReadMode();
      }
      inp.addEventListener("click", (e) => e.stopPropagation());
      inp.addEventListener("mousedown", (e) => e.stopPropagation());
      inp.addEventListener("blur", () => finalize(true));
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); finalize(true); }
        else if (e.key === "Escape") { e.preventDefault(); finalize(false); }
      });
      setTimeout(() => { inp.focus(); inp.select(); }, 0);
    }

    return row;
  }

  // ============================
  // + 新規作成ウィジェット: 初期は + アイコン 1 つ。クリックで input に展開、
  //   Enter/blur で createWorkspace、Escape または空 commit で + アイコンに戻る
  // ============================
  function renderAddWidget() {
    if (!ioWsAddRow) return;
    ioWsAddRow.textContent = "";
    showAddButton();

    function showAddButton() {
      ioWsAddRow.textContent = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ioWsAddBtn";
      btn.title = t("io.ws.create.action");
      btn.setAttribute("aria-label", t("io.ws.create.action"));
      btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
      btn.addEventListener("click", showAddInput);
      ioWsAddRow.appendChild(btn);
    }

    function showAddInput() {
      ioWsAddRow.textContent = "";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "ioWsAddInput";
      inp.placeholder = t("io.ws.create.placeholder");
      ioWsAddRow.appendChild(inp);

      let done = false;
      async function finalize(commit) {
        if (done) return;
        done = true;
        if (!commit) { showAddButton(); return; }
        const label = String(inp.value || "").trim();
        if (!label) { showAddButton(); return; }
        try {
          await createWorkspace(label);
          vibrate();
          closeIoChooser();
        } catch (err) {
          console.error("workspace create failed:", err);
          alert(t("io.ws.create.failed"));
          showAddButton();
        }
      }
      inp.addEventListener("blur", () => finalize(true));
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); finalize(true); }
        else if (e.key === "Escape") { e.preventDefault(); finalize(false); }
      });
      setTimeout(() => inp.focus(), 0);
    }
  }

  function openIoChooser() {
    if (!ioOverlay) return;
    renderWorkspaceList();
    renderAddWidget();
    ioOverlay.classList.add("active");
  }

  if (ioCancelBtn) ioCancelBtn.addEventListener("click", closeIoChooser);
  if (ioOverlay) ioOverlay.addEventListener("click", (e) => {
    if (e.target === ioOverlay) closeIoChooser();
  });

  // JSON 取込: ファイルピッカーを起こす (file change ハンドラで取込フローへ)。チューザは
  // 開いたままにせず閉じる (ファイル選択ダイアログとモーダルが重なると視覚的に混乱するため)
  if (ioFilePickBtn && settingsImportFile) {
    ioFilePickBtn.addEventListener("click", () => {
      closeIoChooser();
      settingsImportFile.click();
    });
  }
  if (ioFileSaveBtn) {
    ioFileSaveBtn.addEventListener("click", () => {
      closeIoChooser();
      downloadCurrentAsJson();
    });
  }
  // 新規作成は renderAddWidget() の中で完結 (+ アイコン → input → Enter で commit)

  // ============================
  // ヘッダーメニューからのエントリポイント (DB アイコン 1 つに集約)
  // ============================
  if (settingsDbBtn) {
    settingsDbBtn.addEventListener("click", openIoChooser);
  }

  // file picker (input[type=file]) の change イベントは chooser を経由する
  if (settingsImportFile) {
    settingsImportFile.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const parsedRaw = JSON.parse(ev.target.result);
          let bundle;
          try {
            bundle = parseBundle(parsedRaw);
          } catch (err) {
            alert(t("import.parse.failed"));
            console.error("parse failed:", err);
            settingsImportFile.value = "";
            return;
          }
          closeIoChooser();
          await importFromBundle(bundle);
        } catch (err) {
          alert(t("import.read.failed"));
          console.error("Import failed:", err);
        }
        settingsImportFile.value = "";
      };
      reader.readAsText(file);
    });
  }
}
