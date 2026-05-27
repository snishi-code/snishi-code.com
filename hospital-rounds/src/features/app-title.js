"use strict";

// ============================
// アプリヘッダーのタイトル + ワークスペース名 入力欄
//
// - タイトルは「端末固定」(localStorage 経由で永続化、live state に反映)。
//   普段は readonly。鉛筆 (createEditToggle) でだけ編集可能
//   タップ (非編集時) → ホーム遷移
//
// - ワークスペース名は「アクティブ ws の label」(IDB の bundles テーブル):
//   - 普段は readonly。タップで WS picker を開く (features/ws-picker.js)
//   - 鉛筆 (createEditToggle) で editable に切替 → blur/Enter で renameBundle
//   v7.6.0 で「常時 readonly + 設定画面 rename」にしたが、v7.6.1 で「ヘッダー
//   でも鉛筆経由で rename 可」を復活させた。設定画面の rename と二系統並立
//
// 公開 API:
//   initAppTitle({ titleToggleSetter, navToHome })
//     - getTitleToggle: createEditToggle の戻り値を後で受け取る getter
//     - navToHome: タイトル input をタップ (非編集時) → ホームへ
//   refreshAppWsLabel()
//     - active ws の label を IDB から取得して input に反映 (ws 切替時に呼ぶ)
//   updateAppTitle(newTitle)
//     - タイトル変更 (input イベント or 別 view から呼ぶ用)
//   syncInputSize(inp)
//     - field-sizing 未対応ブラウザの size 属性同期
// ============================

import { appState, updateDeviceTitle, scheduleSave } from "../store.js";
import { listBundles, getActiveWorkspaceId, renameBundle } from "../storage.js";
import { t } from "../i18n.js";

// field-sizing 未対応ブラウザ向けの size 属性同期。
export function syncInputSize(inp) {
  if (!inp) return;
  const len = (inp.value || "").length || 1;
  inp.size = Math.max(2, Math.min(20, len));
}

// タイトル文字列を端末固定の永続値として保存し、live state にも反映。
export function updateAppTitle(val) {
  updateDeviceTitle(val || t("app.title"));
  document.title = appState.title;
}

// アクティブワークスペースの label を IDB から取得 → ヘッダー入力欄へ反映
export async function refreshAppWsLabel() {
  const inp = document.getElementById("appWsLabelInput");
  if (!inp) return;
  try {
    const activeId = getActiveWorkspaceId();
    const all = await listBundles();
    const me = all.find(r => r.id === activeId);
    inp.value = me ? (me.label || t("io.ws.untitled")) : "";
  } catch (e) {
    console.warn("refreshAppWsLabel failed:", e);
  }
}

// initAppTitle({ getTitleToggle, navToHome })
//   getTitleToggle: createEditToggle 適用後の戻り値を返す getter (循環参照
//                   を避けるため、関数で間接アクセスする)。getTitleToggle()
//                   が null を返す瞬間 (rendered before createEditToggle) も
//                   許容する。
export function initAppTitle({ getTitleToggle, navToHome }) {
  const appTitleInput = document.getElementById("appTitleInput");
  const appWsLabelInput = document.getElementById("appWsLabelInput");

  if (appTitleInput) {
    appTitleInput.value = appState.title;
    updateAppTitle(appState.title);
    syncInputSize(appTitleInput);
    appTitleInput.addEventListener("input", (e) => {
      updateAppTitle(e.target.value);
      syncInputSize(appTitleInput);
      // title は updateDeviceTitle 内で localStorage に保存済。
      // bundle 側の meta.title も整合させるため debounce save を発火しておく
      scheduleSave();
    });
    appTitleInput.addEventListener("click", () => {
      if (!getTitleToggle()?.isEditing()) navToHome();
    });
    appTitleInput.addEventListener("keydown", (e) => {
      if (getTitleToggle()?.isEditing() && e.key === "Enter") {
        e.preventDefault();
        getTitleToggle().exit();
      }
    });
  }

  if (appWsLabelInput) {
    refreshAppWsLabel();
    appWsLabelInput.readOnly = true;
    appWsLabelInput.placeholder = t("header.ws.placeholder");
    appWsLabelInput.addEventListener("input", () => syncInputSize(appWsLabelInput));
    // 編集モード時の blur/Enter で renameBundle を発火。
    // (タップ時の WS picker 起動は features/ws-picker.js が配線、readonly チェックで競合回避)
    const commitWsLabel = async () => {
      // 編集モードに入っていない (readonly) 時の blur は無視 (picker タップ後など)
      if (appWsLabelInput.readOnly) return;
      const newLabel = String(appWsLabelInput.value || "").trim();
      const activeId = getActiveWorkspaceId();
      if (!newLabel) {
        refreshAppWsLabel();
        return;
      }
      try {
        await renameBundle(activeId, newLabel);
      } catch (e) {
        console.error("ws rename failed:", e);
        refreshAppWsLabel();
      }
    };
    appWsLabelInput.addEventListener("blur", commitWsLabel);
    appWsLabelInput.addEventListener("keydown", (e) => {
      if (getTitleToggle()?.isEditing() && e.key === "Enter") {
        e.preventDefault();
        getTitleToggle().exit();
      }
    });
  }
}
