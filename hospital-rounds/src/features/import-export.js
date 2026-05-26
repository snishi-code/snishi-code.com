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
import {
  listBundles, loadBundle, saveBundle, deleteBundle, newSnapshotId,
  ACTIVE_BUNDLE_ID,
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
      if (sSettings) applyImportedSettings(sSettings);
      ensurePatientsHaveAllOKeys();
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
      ensurePatientsHaveAllOKeys();
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
    ensurePatientsHaveAllOKeys();
    vibrate();
    rerenderCurrentView();
  }

  // ============================
  // 入出力 chooser: 端末ファイル ↔ DB スナップショット トグル
  // ============================
  const ioOverlay = document.getElementById("ioChooserOverlay");
  const ioTitle = document.getElementById("ioChooserTitle");
  const ioToggleBtns = ioOverlay ? ioOverlay.querySelectorAll(".ioSourceToggleBtn") : [];
  const ioPanelFileImport = document.getElementById("ioPanelFileImport");
  const ioPanelFileExport = document.getElementById("ioPanelFileExport");
  const ioPanelDbImport = document.getElementById("ioPanelDbImport");
  const ioPanelDbExport = document.getElementById("ioPanelDbExport");
  const ioFilePickBtn = document.getElementById("ioFilePickBtn");
  const ioFileSaveBtn = document.getElementById("ioFileSaveBtn");
  const ioDbImportList = document.getElementById("ioDbImportList");
  const ioDbExportList = document.getElementById("ioDbExportList");
  const ioDbLabelInp = document.getElementById("ioDbLabelInp");
  const ioDbSaveBtn = document.getElementById("ioDbSaveBtn");
  const ioCancelBtn = document.getElementById("ioChooserCancelBtn");

  let _ioMode = "import"; // "import" | "export"
  let _ioSource = "file"; // "file" | "db"

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

  function renderDbList(hostEl, { allowImport, allowDelete, onImport, onDelete }) {
    if (!hostEl) return Promise.resolve();
    hostEl.textContent = "";
    return listBundles().then(all => {
      // active bundle (= "default") は「現在のデータ」なので一覧から除外。
      // 取込/削除対象になるのはユーザが明示的に作ったスナップショットのみ。
      const snaps = all
        .filter(r => r.id !== ACTIVE_BUNDLE_ID)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      for (const r of snaps) {
        const row = document.createElement("div");
        row.className = "ioDbRow";

        const main = document.createElement("div");
        main.className = "ioDbRowMain";
        const lbl = document.createElement("div");
        lbl.className = "ioDbRowLabel";
        lbl.textContent = r.label || r.title || "(無題)";
        const meta = document.createElement("div");
        meta.className = "ioDbRowMeta";
        meta.textContent = `${fmtTimestamp(r.updatedAt)} ・ ${r.title || ""}`;
        main.appendChild(lbl);
        main.appendChild(meta);
        if (allowImport) {
          main.addEventListener("click", () => onImport && onImport(r));
        } else {
          main.style.cursor = "default";
        }
        row.appendChild(main);

        if (allowDelete) {
          const del = document.createElement("button");
          del.type = "button";
          del.className = "ioDbRowDel";
          del.title = "削除";
          del.setAttribute("aria-label", "削除");
          del.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
          del.addEventListener("click", (e) => {
            e.stopPropagation();
            onDelete && onDelete(r);
          });
          row.appendChild(del);
        }

        hostEl.appendChild(row);
      }
    });
  }

  function applyIoMode(mode) {
    _ioMode = mode;
    if (ioTitle) {
      ioTitle.textContent = mode === "import" ? "データを取り込む" : "データを保存";
    }
    applyIoSource(_ioSource);
  }

  function applyIoSource(source) {
    _ioSource = source;
    for (const b of ioToggleBtns) {
      b.classList.toggle("selected", b.dataset.source === source);
    }
    if (ioPanelFileImport) ioPanelFileImport.style.display = (_ioMode === "import" && source === "file") ? "" : "none";
    if (ioPanelFileExport) ioPanelFileExport.style.display = (_ioMode === "export" && source === "file") ? "" : "none";
    if (ioPanelDbImport)   ioPanelDbImport.style.display   = (_ioMode === "import" && source === "db")   ? "" : "none";
    if (ioPanelDbExport)   ioPanelDbExport.style.display   = (_ioMode === "export" && source === "db")   ? "" : "none";

    if (_ioMode === "import" && source === "db") {
      renderDbList(ioDbImportList, {
        allowImport: true,
        allowDelete: true,
        onImport: async (rec) => {
          try {
            const bundle = await loadBundle(rec.id);
            if (!bundle) {
              alert("選択したスナップショットを読み込めませんでした");
              return;
            }
            closeIoChooser();
            await importFromBundle(bundle);
          } catch (err) {
            console.error("db import failed:", err);
            alert("DB からの取込に失敗しました");
          }
        },
        onDelete: async (rec) => {
          if (!confirm(`スナップショット「${rec.label || rec.title || "(無題)"}」を削除しますか？`)) return;
          try {
            await deleteBundle(rec.id);
            applyIoSource("db"); // 同じ panel を再描画
          } catch (err) {
            console.error("db delete failed:", err);
            alert("削除に失敗しました");
          }
        },
      });
    }
    if (_ioMode === "export" && source === "db") {
      renderDbList(ioDbExportList, {
        allowImport: false,
        allowDelete: true,
        onDelete: async (rec) => {
          if (!confirm(`スナップショット「${rec.label || rec.title || "(無題)"}」を削除しますか？`)) return;
          try {
            await deleteBundle(rec.id);
            await applyIoSource("db"); // re-render
          } catch (err) {
            console.error("db delete failed:", err);
            alert("削除に失敗しました");
          }
        },
      });
    }
  }

  function openIoChooser(mode) {
    if (!ioOverlay) return;
    applyIoMode(mode);
    // 保存モード時はラベル入力欄を空にしてフォーカス
    if (mode === "export" && ioDbLabelInp) ioDbLabelInp.value = "";
    ioOverlay.classList.add("active");
  }

  for (const b of ioToggleBtns) {
    b.addEventListener("click", () => applyIoSource(b.dataset.source));
  }
  if (ioCancelBtn) ioCancelBtn.addEventListener("click", closeIoChooser);
  if (ioOverlay) ioOverlay.addEventListener("click", (e) => {
    if (e.target === ioOverlay) closeIoChooser();
  });

  if (ioFilePickBtn && settingsImportFile) {
    ioFilePickBtn.addEventListener("click", () => settingsImportFile.click());
  }
  if (ioFileSaveBtn) {
    ioFileSaveBtn.addEventListener("click", () => {
      closeIoChooser();
      downloadCurrentAsJson();
    });
  }
  if (ioDbSaveBtn) {
    ioDbSaveBtn.addEventListener("click", async () => {
      const label = String(ioDbLabelInp?.value || "").trim();
      if (!label) {
        alert("名前を入力してください");
        if (ioDbLabelInp) ioDbLabelInp.focus();
        return;
      }
      try {
        const bundle = projectBundle({ appState, rosterState, settings });
        const id = newSnapshotId();
        await saveBundle(bundle, id, label);
        vibrate();
        // 保存後は一覧を更新して残す (連続保存しないなら閉じてもよいが、確認できた方が安心)
        await applyIoSource("db");
        if (ioDbLabelInp) ioDbLabelInp.value = "";
      } catch (err) {
        console.error("db save failed:", err);
        alert("DB への保存に失敗しました");
      }
    });
  }

  // ============================
  // ヘッダーメニューからのエントリポイント
  // ============================
  if (settingsImportBtn) {
    settingsImportBtn.addEventListener("click", () => openIoChooser("import"));
  }
  if (settingsExportBtn) {
    settingsExportBtn.addEventListener("click", () => openIoChooser("export"));
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
