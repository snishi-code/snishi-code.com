"use strict";

import { appState, selectedNo } from "../store.js";

export function showView(which, pushState = true) {
  if (pushState) {
    history.pushState({ view: which }, "", "");
  }
  const homeView = document.getElementById("homeView");
  const memoView = document.getElementById("memoView");
  const sharedView = document.getElementById("sharedView");
  const overviewView = document.getElementById("overviewView");
  const settingsView = document.getElementById("settingsView");
  const detailView = document.getElementById("detailView");
  const docsViewEl = document.getElementById("docsView");

  if (homeView) homeView.classList.toggle("active", which === "home");
  if (memoView) memoView.classList.toggle("active", which === "memo");
  if (sharedView) sharedView.classList.toggle("active", which === "shared");
  if (overviewView) overviewView.classList.toggle("active", which === "overview");
  if (settingsView) settingsView.classList.toggle("active", which === "settings");
  if (detailView) detailView.classList.toggle("active", which === "detail");
  if (docsViewEl) docsViewEl.classList.toggle("active", which === "docs");

  // ヘッダーのナビボタンを CSS の attribute selector で active 表示する
  // ためのフラグ。html[data-view="memo"] #headerMemoBtn { ... } などで使う
  document.documentElement.dataset.view = which;

  if (which !== "shared") {
    const sharedQrWrap = document.getElementById("sharedQrWrap");
    if (sharedQrWrap) sharedQrWrap.classList.remove("active");
  }

  window.scrollTo(0, 0);
}

export function syncDetailMemoDisplay() {
  const detailMemoText = document.getElementById("detailMemoText");
  if (!detailMemoText) return;
  const p = appState.patients[selectedNo - 1];
  detailMemoText.value = String(p?.memo ?? "");
}

export function lastMemoNo() {
  for (let i = appState.patients.length; i >= 1; i--) {
    const m = String(appState.patients[i - 1]?.memo ?? "").trim();
    if (m) return i;
  }
  return 0;
}

export function lastSharedNo() {
  for (let i = appState.patients.length; i >= 1; i--) {
    const m = String(appState.patients[i - 1]?.shared ?? "").trim();
    if (m) return i;
  }
  return 0;
}
