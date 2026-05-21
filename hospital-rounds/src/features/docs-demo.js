"use strict";

// 説明書ビュー上部に表示するインタラクティブデモバー。
//
// 設計方針:
//   - state は本モジュール内の `_state` (メモリのみ) で管理。
//     localStorage は触らないので実患者データ・実 settings に一切影響しない。
//   - 説明書を抜けた時点で `resetDocsDemo()` を呼び、デフォルトに戻す。
//   - 説明書ページ間の遷移 (showView は変えず srcdoc 差し替え) では維持。
//   - 患者数は DEMO_PATIENT_COUNT で集中管理 (将来 N 変更時はここだけ)。

import { STATUS } from "../constants.js";
import { bindTapOrLongPress, nextStatusInCycle, statusOnLongPress } from "../views/detail.js";
import { statusClass } from "../views/home.js";
import { formatPatientLabel } from "./room.js";

const DEMO_PATIENT_COUNT = 3;

// test/fixtures/bundle.json と同形の placeholder データ。
// 名前は明らかな仮名 (テスト1/2/3)、タグも英字 1 文字でデモ用。
function defaultDemoState() {
  return {
    patients: [
      { status: STATUS.NONE, name: "テスト1", room: "101", tags: ["A"] },
      { status: STATUS.NONE, name: "テスト2", room: "102", tags: ["B"] },
      { status: STATUS.NONE, name: "テスト3", room: "203", tags: ["A"] },
    ].slice(0, DEMO_PATIENT_COUNT),
    tags: ["A", "B"],
  };
}

let _state = null;

export function resetDocsDemo() {
  _state = defaultDemoState();
  renderDocsDemo();
}

function ensureState() {
  if (!_state) _state = defaultDemoState();
  return _state;
}

export function renderDocsDemo() {
  const grid = document.getElementById("docsDemoGrid");
  if (!grid) return;
  const state = ensureState();
  grid.textContent = "";
  state.patients.forEach((p, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "patientBtn " + statusClass(p.status);
    const label = formatPatientLabel(p, String(i + 1));
    btn.textContent = label;
    btn.setAttribute("aria-label", label);
    const applyStatus = (next) => {
      p.status = next;
      btn.className = "patientBtn " + statusClass(next);
    };
    bindTapOrLongPress(
      btn,
      () => applyStatus(nextStatusInCycle(p.status)),
      () => applyStatus(statusOnLongPress(p.status))
    );
    grid.appendChild(btn);
  });
}

export function initDocsDemo() {
  const reloadBtn = document.getElementById("docsDemoReloadBtn");
  if (reloadBtn) reloadBtn.addEventListener("click", resetDocsDemo);
}
