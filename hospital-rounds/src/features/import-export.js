"use strict";

import { appState, settings, setAppState, setSettings, saveNow, saveSettings, normalizeLoaded, ensurePatientsHaveAllOKeys } from "../store.js";
import { STATUS } from "../constants.js";

export function askImportAction() {
  return new Promise(resolve => {
    const overlay = document.getElementById("importActionOverlay");
    const btnOver = document.getElementById("importOverwriteBtn");
    const btnApp = document.getElementById("importAppendBtn");
    const btnCan = document.getElementById("importCancelBtn");

    const cleanup = () => {
      overlay.classList.remove("active");
      btnOver.removeEventListener("click", onOver);
      btnApp.removeEventListener("click", onApp);
      btnCan.removeEventListener("click", onCan);
    };
    const onOver = () => { cleanup(); resolve("overwrite"); };
    const onApp = () => { cleanup(); resolve("append"); };
    const onCan = () => { cleanup(); resolve("cancel"); };

    btnOver.addEventListener("click", onOver);
    btnApp.addEventListener("click", onApp);
    btnCan.addEventListener("click", onCan);

    overlay.classList.add("active");
  });
}

export function applyAppend(currP, impP) {
  let changed = false;
  const namePrefix = (impP && impP.name && impP.name.trim() !== "") ? impP.name.trim() + "さんのデータが" : "";
  const appendStr = `\n\n（${namePrefix}追記されました）\n`;
  const appendStrFirst = `（${namePrefix}追記されました）\n`;

  function checkAndAppend(objC, objI, key) {
    let currVal = objC[key];
    let impVal = objI[key];
    if (typeof impVal === "string" && impVal.trim() !== "") {
      if (currVal !== impVal) {
        if (currVal && currVal.trim() !== "") {
          objC[key] = currVal.trim() + appendStr + impVal.trim();
        } else {
          objC[key] = appendStrFirst + impVal.trim();
        }
        changed = true;
      }
    }
  }

  checkAndAppend(currP, impP, "memo");
  checkAndAppend(currP, impP, "shared");
  checkAndAppend(currP, impP, "s");
  checkAndAppend(currP.a, impP.a, "text");
  checkAndAppend(currP.p, impP.p, "text");

  let newOFreeText = [];
  if (typeof impP.oFree === "string" && impP.oFree.trim() !== "") {
    if (currP.oFree !== impP.oFree) {
      newOFreeText.push(impP.oFree.trim());
    }
  }

  const vitalLabels = {
    spo2: "SpO2", spo2_memo: "SpO2メモ", rr: "呼吸回数",
    bp_sys: "収縮期血圧", bp_dia: "拡張期血圧", pr: "脈拍", bt: "体温"
  };

  for (let k in impP.vitals) {
    let impVal = impP.vitals[k];
    let currVal = currP.vitals[k];
    if (typeof impVal === "string" && impVal.trim() !== "") {
      if (currVal !== impVal) {
        let label = vitalLabels[k] || k;
        newOFreeText.push(`${label}: ${impVal.trim()}`);
      }
    }
  }

  for (let k in impP.o) {
    if (currP.o[k] && impP.o[k]) {
      let impNote = impP.o[k].note;
      let currNote = currP.o[k].note;
      if (typeof impNote === "string" && impNote.trim() !== "") {
        if (currNote !== impNote) {
          if (currNote && currNote.trim() !== "") {
            currP.o[k].note = currNote.trim() + appendStr + impNote.trim();
          } else {
            currP.o[k].note = appendStrFirst + impNote.trim();
          }
          changed = true;
        }
      }
    }
  }

  if (newOFreeText.length > 0) {
    let appendedText = newOFreeText.join("\n");
    if (currP.oFree && currP.oFree.trim() !== "") {
      currP.oFree = currP.oFree.trim() + appendStr + appendedText;
    } else {
      currP.oFree = appendStrFirst + appendedText;
    }
    changed = true;
  }

  if (typeof impP.name === "string" && impP.name.trim() !== "" && (!currP.name || currP.name.trim() === "")) {
    currP.name = impP.name.trim();
    changed = true;
  }

  if (changed) {
    currP.status = STATUS.BLUE;
  }
}

export function initImportExport(callbacks) {
  const { renderHome, renderDetail, renderSettings, renderOverviewScreen, renderMemoScreen, renderSharedScreen, showView } = callbacks;

  const settingsImportFile = document.getElementById("settingsImportFile");
  const settingsImportBtn = document.getElementById("settingsImportBtn");
  const settingsExportBtn = document.getElementById("settingsExportBtn");
  const settingsPrintBtn = document.getElementById("settingsPrintBtn");

  let lastExportUrl = null;

  if (settingsExportBtn) {
    settingsExportBtn.addEventListener("click", () => {
      try {
        if (lastExportUrl) URL.revokeObjectURL(lastExportUrl);
        const data = { appState, settings };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
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
        a.download = `${titleSafe}_${yyyy}_${mm}${dd}_${hh}${min}.json`;
        a.click();
        settingsExportBtn.blur();
      } catch (err) {
        console.error("Export failed:", err);
        alert("データの出力に失敗しました。");
      }
    });
  }

  if (settingsImportBtn && settingsImportFile) {
    settingsImportBtn.addEventListener("click", () => { settingsImportFile.click(); });

    settingsImportFile.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (parsed.appState) {
            const importedState = normalizeLoaded(parsed.appState);
            let isEmpty = true;
            for (let i = 0; i < appState.patients.length; i++) {
              const p = appState.patients[i];
              if (p.name || p.s || p.a.text || p.p.text || p.memo || p.shared) { isEmpty = false; break; }
              const v = p.vitals;
              if (v && (v.spo2 || v.rr || v.bp_sys || v.pr || v.bt)) { isEmpty = false; break; }
              for (const k in p.o) {
                if (p.o[k].note || p.o[k].normal) { isEmpty = false; break; }
              }
              if (!isEmpty) break;
            }

            let isOverwrite = false;
            let isAppend = false;

            if (isEmpty) {
              setAppState(importedState);
              const appTitleInput = document.getElementById("appTitleInput");
              if (appTitleInput) appTitleInput.value = appState.title;
              document.title = appState.title;
              const printHead = document.querySelector(".overviewPrintHead");
              if (printHead) printHead.textContent = appState.title + " — 総覧";
              isOverwrite = true;
            } else {
              const action = await askImportAction();
              if (action === "cancel") { settingsImportFile.value = ""; return; }
              if (action === "overwrite") {
                if (!confirm("現在のデータは上書きされますが、本当によろしいですか？\n（現在のデータは全て消去されます）")) {
                  settingsImportFile.value = ""; return;
                }
                setAppState(importedState);
                const appTitleInput = document.getElementById("appTitleInput");
                if (appTitleInput) appTitleInput.value = appState.title;
                document.title = appState.title;
                const printHead = document.querySelector(".overviewPrintHead");
                if (printHead) printHead.textContent = appState.title + " — 総覧";
                isOverwrite = true;
              } else if (action === "append") {
                isAppend = true;
                for (let i = 0; i < Math.min(appState.patients.length, importedState.patients.length); i++) {
                  applyAppend(appState.patients[i], importedState.patients[i]);
                }
              }
            }

            saveNow();
            if (parsed.settings && isOverwrite) {
              setSettings(parsed.settings);
              saveSettings();
            }
          } else if (parsed.settings) {
            setSettings(parsed.settings);
            saveSettings();
          }

          ensurePatientsHaveAllOKeys();
          alert("データを取り込みました。");
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
        } catch (err) {
          alert("ファイルの読み込みに失敗しました。正しいJSONファイルか確認してください。");
          console.error("Import failed:", err);
        }
        settingsImportFile.value = "";
      };
      reader.readAsText(file);
    });
  }

  if (settingsPrintBtn) {
    settingsPrintBtn.addEventListener("click", () => {
      requestAnimationFrame(() => window.print());
    });
  }
}
