"use strict";

import { appState, settings, makeDefaultPatient, saveSettings } from "../store.js";
import { finishDataChange } from "./drag.js";
import { recordOp } from "./roster.js";
import { createQrFlow } from "./qr-flow.js";
import { encodePatientList, decodePatientList } from "./qr-patient-list.js";
import { t } from "../i18n.js";

// ============================
// ホームQR (名簿: 部屋番号 + 名前 + タグ)
//
// プロトコルとフローは共通 (qr-flow / qr-patient-list)。ホーム固有なのは:
//   - includeEmpty=true で送る（slot 位置を保つ）
//   - 受信時の挙動分岐:
//     * 名簿が全患者で空 → reflect モード (slot 1..N を上書き、必要なら拡張)
//     * 名簿が空でない   → append モード (空患者を除き末尾に追加)
//   - タグも一緒に取り込む:
//     * reflect → settings.tags 丸ごと差し替え
//     * append  → 既存タグと衝突しないよう A→A(1)→A(2) と suffix 改名で union
// ============================

// 同名タグの衝突回避（ファイルコピー風の括弧付き連番）
function uniqueTagName(name, existing) {
  if (!existing.includes(name)) return name;
  for (let i = 1; i < 10000; i++) {
    const cand = `${name}(${i})`;
    if (!existing.includes(cand)) return cand;
  }
  return `${name}(${Date.now().toString(36)})`;
}

function applyRoster(decoded, ctrl) {
  const { tagNames: senderTagNames, patients: roster } = decoded;
  if (roster.length === 0) {
    alert(t("qr.import.empty.home"));
    return;
  }

  const isEmpty = appState.patients.every(p =>
    !String(p?.room || "").trim() &&
    !String(p?.name || "").trim() &&
    (!p?.tags || p.tags.length === 0)
  );

  if (isEmpty) {
    // reflect モード: 設定タグを丸ごと送信側のものに差し替え
    settings.tags = senderTagNames.slice();
    saveSettings();
    const resolveTag = (idx) => settings.tags[idx - 1] || null;

    while (appState.patients.length < roster.length) {
      appState.patients.push(makeDefaultPatient());
    }
    for (let i = 0; i < roster.length; i++) {
      const p = appState.patients[i];
      const r = roster[i];
      p.room = r.room;
      p.name = r.name;
      p.tags = r.tagIdxs.map(resolveTag).filter(Boolean);
      if (p.pid) {
        recordOp({ type: "update", pid: p.pid, field: "room", value: p.room });
        recordOp({ type: "update", pid: p.pid, field: "name", value: p.name });
        recordOp({ type: "update", pid: p.pid, field: "tags", value: p.tags.slice() });
      }
    }
    finishDataChange();
    ctrl.close();
    const msg = senderTagNames.length
      ? `${roster.length} 件の名簿と ${senderTagNames.length} 件のタグを反映しました。`
      : `${roster.length} 件の名簿を反映しました。`;
    alert(msg);
    return;
  }

  // append モード: 送信側タグを衝突回避しつつ追加、患者は末尾に追加
  const existing = (settings.tags || []).slice();
  const senderIdxToReceiverName = [null];
  let tagsAdded = 0;
  let tagsRenamed = 0;
  for (let i = 0; i < senderTagNames.length; i++) {
    const name = senderTagNames[i];
    if (existing.includes(name)) {
      senderIdxToReceiverName[i + 1] = name;
    } else {
      const unique = uniqueTagName(name, existing);
      existing.push(unique);
      settings.tags.push(unique);
      senderIdxToReceiverName[i + 1] = unique;
      tagsAdded++;
      if (unique !== name) tagsRenamed++;
    }
  }
  if (tagsAdded > 0) saveSettings();
  const resolveTag = (idx) => senderIdxToReceiverName[idx] || null;

  const added = [];
  for (const r of roster) {
    if (!r.room && !r.name && r.tagIdxs.length === 0) continue;
    const p = makeDefaultPatient();
    p.room = r.room;
    p.name = r.name;
    p.tags = r.tagIdxs.map(resolveTag).filter(Boolean);
    const atIdx = appState.patients.length;
    appState.patients.push(p);
    added.push(p);
    recordOp({ type: "add", at: atIdx, patient: { pid: p.pid, name: p.name, room: p.room, tags: p.tags.slice() } });
  }
  finishDataChange();
  ctrl.close();
  const msgs = [`${added.length} 件を末尾に追加しました。`];
  if (tagsAdded) {
    msgs.push(tagsRenamed
      ? `新規タグ ${tagsAdded} 件を追加（うち ${tagsRenamed} 件は同名衝突のため A(1)/A(2) 形式に改名）`
      : `新規タグ ${tagsAdded} 件を追加しました。`);
  }
  alert(msgs.join("\n"));
}

const flow = createQrFlow({
  kind: "HM",
  kindLabel: "ホームQR",
  emptyMessage: "（対象の患者がいません）",
  ids: {
    wrapId: "homeQrWrap",
    canvasId: "homeQrCanvas",
    pageMetaId: "homeQrPageMeta",
    prevBtnId: "homeQrPrevBtn",
    nextBtnId: "homeQrNextBtn",
    showBtnId: "homeShowQrBtn",
    scanBtnId: "homeQrScanBtn",
  },
  encodePayload: () => encodePatientList({ fieldName: null, includeEmpty: true }),
  decodePayload: (payload) => decodePatientList(payload),
  onApply: applyRoster,
});

export const initHomeQr = () => flow.init();
export const isHomeQrActive = () => flow.isActive();
export const refreshHomeQrIfActive = () => flow.refresh();
