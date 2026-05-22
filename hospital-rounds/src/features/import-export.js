"use strict";

import {
  appState, settings, rosterState,
  setAppState, setSettings, setRosterState,
  saveNow, saveSettings, normalizeLoaded, normalizeRosterMeta,
  ensurePatientsHaveAllOKeys,
} from "../store.js";
import { STATUS } from "../constants.js";
import {
  projectBundle, parseBundle, getSection, SECTION,
} from "../bundle.js";
import { recordOp } from "./roster.js";

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
    const v = p.vitals || {};
    if (v.spo2 || v.rr || v.bp_sys || v.bp_dia || v.pr || v.bt || v.spo2_memo) return false;
    for (const k in (p.o || {})) {
      if (p.o[k]?.note || p.o[k]?.normal) return false;
    }
    if (Array.isArray(p.tags) && p.tags.length > 0) return false;
  }
  return true;
}

function isImportedPatientEmpty(p) {
  if (!p) return true;
  if (p.name || p.room || p.s || p.a?.text || p.p?.text || p.memo || p.shared || p.oFree) return false;
  const v = p.vitals || {};
  if (v.spo2 || v.rr || v.bp_sys || v.bp_dia || v.pr || v.bt || v.spo2_memo) return false;
  for (const k in (p.o || {})) {
    if (p.o[k]?.note || p.o[k]?.normal) return false;
  }
  if (Array.isArray(p.tags) && p.tags.length > 0) return false;
  return true;
}

// 取込側の患者が参照しているタグ名のうち、現行 settings.tags に無いものを末尾に追加。
// 名前ベースなので衝突リネームは不要 (同名タグは同タグとして扱う)。
function unionImportedTags(importedPatients) {
  if (!Array.isArray(settings.tags)) settings.tags = [];
  const currentSet = new Set(settings.tags);
  let added = 0;
  for (const p of importedPatients) {
    if (!Array.isArray(p?.tags)) continue;
    for (const t of p.tags) {
      if (!t || currentSet.has(t)) continue;
      settings.tags.push(t);
      currentSet.add(t);
      added++;
    }
  }
  if (added > 0) saveSettings();
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
    p.vitals = { ...(src.vitals || {}) };
    p.o = {};
    for (const k in (src.o || {})) {
      p.o[k] = { normal: !!src.o[k]?.normal, note: String(src.o[k]?.note ?? "") };
    }
    p.a = { text: String(src.a?.text ?? "") };
    p.p = { text: String(src.p?.text ?? "") };
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

// 受信した settings を反映。管理機能関連 (adminEnabled / adminTerminal /
// rosterPassphrase) は現端末の状態を維持し、取り込まない。
function applyImportedSettings(sSettings) {
  const merged = { ...sSettings };
  merged.adminEnabled = settings.adminEnabled;
  merged.adminTerminal = settings.adminTerminal;
  merged.rosterPassphrase = settings.rosterPassphrase;
  setSettings(merged);
  saveSettings();
}

function importedAppStateFromBundle(bundle) {
  const sPatients = getSection(bundle, SECTION.PATIENTS);
  const sMeta = getSection(bundle, SECTION.META);
  return normalizeLoaded({
    title: sMeta && typeof sMeta.title === "string" ? sMeta.title : "回診",
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
  const printHead = document.querySelector(".overviewPrintHead");
  if (printHead) printHead.textContent = appState.title + " — 総覧";
}

export function initImportExport(callbacks) {
  const { renderHome, renderDetail, renderSettings, renderOverviewScreen, renderMemoScreen, renderSharedScreen } = callbacks;

  const settingsImportFile = document.getElementById("settingsImportFile");
  const settingsImportBtn = document.getElementById("settingsImportBtn");
  const settingsExportBtn = document.getElementById("settingsExportBtn");

  let lastExportUrl = null;

  if (settingsExportBtn) {
    settingsExportBtn.addEventListener("click", () => {
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
        const titleSafe = (appState.title || "回診管理").replace(/[\\/:*?"<>|]/g, "_");
        // 本番以外（test サブドメイン / dev サーバ）の書き出しはファイル名先頭で識別できるようにする
        const envPrefix = document.documentElement.dataset.env === "test" ? "test_" : "";
        a.download = `${envPrefix}${titleSafe}_${yyyy}_${mm}${dd}_${hh}${min}.json`;
        a.click();
        settingsExportBtn.blur();
      } catch (err) {
        console.error("Export failed:", err);
        alert("データの出力に失敗しました。");
      }
    });
  }

  function rerenderCurrentView() {
    renderHome();
    const settingsView = document.getElementById("settingsView");
    const detailView = document.getElementById("detailView");
    const overviewView = document.getElementById("overviewView");
    const memoView = document.getElementById("memoView");
    const sharedView = document.getElementById("sharedView");
    if (settingsView && settingsView.classList.contains("active")) renderSettings();
    if (detailView && detailView.classList.contains("active")) renderDetail();
    if (overviewView && overviewView.classList.contains("active")) renderOverviewScreen();
    if (memoView && memoView.classList.contains("active")) renderMemoScreen();
    if (sharedView && sharedView.classList.contains("active")) renderSharedScreen();
  }

  if (settingsImportBtn && settingsImportFile) {
    settingsImportBtn.addEventListener("click", () => { settingsImportFile.click(); });

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
            alert("ファイル形式を認識できません。別のJSONファイルをお試しください。");
            console.error("parse failed:", err);
            settingsImportFile.value = "";
            return;
          }

          const sPatients = getSection(bundle, SECTION.PATIENTS);
          const sSettings = getSection(bundle, SECTION.SETTINGS);

          // 患者セクション無し (= settings だけ) なら設定だけ取込
          if (!Array.isArray(sPatients)) {
            if (sSettings) applyImportedSettings(sSettings);
            ensurePatientsHaveAllOKeys();
            vibrate();
            rerenderCurrentView();
            return;
          }

          const importedState = importedAppStateFromBundle(bundle);
          const importedRoster = importedRosterStateFromBundle(bundle);

          if (isAppStateEmpty()) {
            // 真っさら: 全部取り込んで、popup も「取込ました」alert も出さず振動だけ
            setAppState(importedState);
            setRosterState(importedRoster);
            refreshTitleUI();
            if (sSettings) applyImportedSettings(sSettings);
            saveNow();
            ensurePatientsHaveAllOKeys();
            vibrate();
            rerenderCurrentView();
            return;
          }

          // データあり: popup で設定込みか選択
          const action = await askImportAction();
          if (action === "cancel") return;

          // どちらの選択でも患者は末尾に追加 (status=BLUE)
          if (action === "patients-only") {
            unionImportedTags(importedState.patients);
          } else if (action === "include-settings" && sSettings) {
            applyImportedSettings(sSettings);
          }
          appendNewPatients(importedState.patients);
          saveNow();
          ensurePatientsHaveAllOKeys();
          vibrate();
          rerenderCurrentView();
        } catch (err) {
          alert("ファイルの読み込みに失敗しました。正しいJSONファイルか確認してください。");
          console.error("Import failed:", err);
        }
        settingsImportFile.value = "";
      };
      reader.readAsText(file);
    });
  }
}
