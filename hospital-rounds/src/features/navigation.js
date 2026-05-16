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
  const sharedQrViewEl = document.getElementById("sharedQrView");
  const docsQrViewEl = document.getElementById("docsQrView");

  if (homeView) homeView.classList.toggle("active", which === "home");
  if (memoView) memoView.classList.toggle("active", which === "memo");
  if (sharedView) sharedView.classList.toggle("active", which === "shared");
  if (overviewView) overviewView.classList.toggle("active", which === "overview");
  if (settingsView) settingsView.classList.toggle("active", which === "settings");
  if (detailView) detailView.classList.toggle("active", which === "detail");
  if (sharedQrViewEl) sharedQrViewEl.classList.toggle("active", which === "sharedQr");
  if (docsQrViewEl) docsQrViewEl.classList.toggle("active", which === "docsQr");

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
