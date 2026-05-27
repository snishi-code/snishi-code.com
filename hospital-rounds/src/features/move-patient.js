"use strict";

// ============================
// 患者の他ワークスペースへの移動
//
// 設計指針 (案 3):
//   - 元データは触らない (name / room は無傷)
//   - 元 ws の患者には transferredAt / transferredTo マーカーを立て、status = GRAY に
//   - 移動先 ws には新規 pid + status = BLUE で append (slot push 方式、既存
//     appendNewPatients と同じ流儀)
//   - 表示時に "(移)" prefix を付け、ソートで末尾に押し出すのは home.js / detail.js
//     / room.js 側の責務
//
// 既存 admin 機能との関係 (将来):
//   - 元 ws では物理 delete op を発火しない (= 他端末でデータが消えない)
//   - update op として transferredAt / transferredTo / status の変更を流せば最低限の整合
//   - これは admin 実装時にあらためて考える。今はローカル端末モードなので op は流さない
// ============================

import { appState, settings, selectedNo, markUpdated, scheduleSave, saveNow, makeDefaultPatient } from "../store.js";
import { STATUS } from "../constants.js";
import {
  listBundles, loadBundle, saveBundle, getActiveWorkspaceId,
} from "../storage.js";
import { getSection, SECTION } from "../bundle.js";
import { t } from "../i18n.js";

// 新 pid 生成 (storage 側の crypto を再利用するため makeDefaultPatient 経由でだけ取得)
function newPatientId() {
  return makeDefaultPatient().pid;
}

// 現アクティブ以外のワークスペース一覧 (id / label / title / updatedAt)
export async function listOtherWorkspaces() {
  const activeId = getActiveWorkspaceId();
  const all = await listBundles();
  return all
    .filter(r => r.id !== activeId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// 指定 ws の bundle に 1 患者を末尾追加して保存 (active か非 active かを問わない)。
// 戻り値: 追加後の bundle の patients.length (= 新患者の表示上の position+1)
async function appendPatientToWorkspace(destId, patient) {
  const bundle = await loadBundle(destId);
  if (!bundle) throw new Error(`workspace not found: ${destId}`);
  // patients セクションが空 or 無いケースも素直に array 化
  const current = getSection(bundle, SECTION.PATIENTS);
  const next = Array.isArray(current) ? current.slice() : [];
  next.push(patient);
  bundle.sections = bundle.sections || {};
  bundle.sections.patients = next;
  // saveBundle は label を省略すれば既存 label を温存する
  await saveBundle(bundle, destId);
  return next.length;
}

// 移動操作の本体。
//   srcPatientIdx: 元 ws の患者 index (0-based)
//   destId / destLabel: 移動先 workspace の id + 表示用 label
export async function movePatient(srcPatientIdx, destId, destLabel) {
  const src = appState.patients[srcPatientIdx];
  if (!src) throw new Error("patient not found");
  if (destId === getActiveWorkspaceId()) {
    throw new Error("cannot move within the same workspace");
  }

  // 1) 移動先用のコピー作成。pid は新発番 (移動先で患者識別子が衝突しないように)。
  //    transferredAt / transferredTo は付けない (移動先では「新規追加された患者」扱い)。
  //    status は BLUE (新着マーク)。updatedAt は now。
  const copy = {
    ...src,
    pid: newPatientId(),
    status: STATUS.BLUE,
    updatedAt: Date.now(),
    transferredAt: 0,
    transferredTo: "",
    // tags / a / p は配列/オブジェクトなので shallow copy だと参照共有してしまう
    tags: Array.isArray(src.tags) ? src.tags.slice() : [],
    a: { text: String(src.a?.text ?? "") },
    p: { text: String(src.p?.text ?? "") },
  };

  // 2) 移動先 ws へ append + save。失敗したら元 ws を一切触らず例外を caller に投げる
  await appendPatientToWorkspace(destId, copy);

  // 3) 元 ws のレコードにマーカーを立てる (物理削除はしない = データ温存)
  src.transferredAt = Date.now();
  src.transferredTo = String(destLabel || "");
  src.status = STATUS.GRAY;
  markUpdated(srcPatientIdx + 1);
  // 移動の完全性のためここは即時保存 (debounce しない)
  await saveNow();
}

// 表示用ヘルパ
// 移動済 = transferredAt > 0 (false な GRAY = ユーザーが手動で付けた灰 (例: 退院済)
// と区別したいケースで利用)
export function isPatientTransferred(p) {
  return !!(p && p.transferredAt);
}

// 名前表示時に "(移)" prefix を付ける装飾 (元 name は触らない)
// (実装は room.js#formatPatientLabel に集約。ここは将来 caller 側から
//  直接装飾したい時のためのエクスポート枠)
export function decorateTransferredName(name, p) {
  if (!isPatientTransferred(p)) return name;
  return `${t("move.namePrefix")} ${name}`;
}

// ============================
// 移動先ピッカー モーダル
// ============================

let _onMoveDoneCb = null;

// 患者画面の「移動」ボタン → ピッカーを開く。完了時に onMoveDone() を呼ぶ
// (caller 側で renderHome / renderDetail を再描画する想定)。
export function openMovePatientModal(patientIdx, onMoveDone) {
  const overlay = document.getElementById("movePatientOverlay");
  if (!overlay) return;
  _onMoveDoneCb = onMoveDone || null;
  renderMovePatientList(patientIdx);
  overlay.classList.add("active");
}

function closeMovePatientModal() {
  const overlay = document.getElementById("movePatientOverlay");
  if (overlay) overlay.classList.remove("active");
  _onMoveDoneCb = null;
}

async function renderMovePatientList(patientIdx) {
  const host = document.getElementById("movePatientList");
  if (!host) return;
  host.textContent = "";
  const others = await listOtherWorkspaces();
  if (!others.length) {
    const empty = document.createElement("div");
    empty.className = "ioDbListEmpty";
    empty.textContent = t("move.list.empty");
    host.appendChild(empty);
    return;
  }
  for (const ws of others) {
    const row = document.createElement("div");
    row.className = "ioDbRow";
    const main = document.createElement("div");
    main.className = "ioDbRowMain";
    const lbl = document.createElement("div");
    lbl.className = "ioDbRowLabel";
    lbl.textContent = ws.label || ws.title || t("io.ws.untitled");
    const meta = document.createElement("div");
    meta.className = "ioDbRowMeta";
    meta.textContent = ws.title || "";
    main.appendChild(lbl);
    main.appendChild(meta);
    row.appendChild(main);
    row.addEventListener("click", async () => {
      const destName = ws.label || ws.title || t("io.ws.untitled");
      const srcPatient = appState.patients[patientIdx];
      const patientLabel = (srcPatient?.name || srcPatient?.room || `#${patientIdx + 1}`);
      if (!confirm(t("move.confirm", { patient: patientLabel, dest: destName }))) return;
      try {
        await movePatient(patientIdx, ws.id, destName);
        closeMovePatientModal();
        if (_onMoveDoneCb) _onMoveDoneCb();
      } catch (err) {
        console.error("move failed:", err);
        alert(t("move.failed"));
      }
    });
    host.appendChild(row);
  }
}

// 画面 ready 後に main.js から initMovePatient を呼んで配線する
export function initMovePatient(callbacks) {
  const overlay = document.getElementById("movePatientOverlay");
  const cancelBtn = document.getElementById("movePatientCancelBtn");
  if (cancelBtn) cancelBtn.addEventListener("click", closeMovePatientModal);
  if (overlay) overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeMovePatientModal();
  });

  // patientDetail のヘッダー右側「移動」ボタン
  const trigger = document.getElementById("detailMovePatientBtn");
  if (trigger) {
    trigger.addEventListener("click", () => {
      const idx = (selectedNo | 0) - 1;
      if (idx < 0) return;
      openMovePatientModal(idx, () => {
        if (callbacks?.renderHome) callbacks.renderHome();
        if (callbacks?.renderDetail) callbacks.renderDetail();
      });
    });
  }
}
