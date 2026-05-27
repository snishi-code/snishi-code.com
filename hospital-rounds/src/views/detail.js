"use strict";

import { appState, settings, selectedNo, markUpdated, scheduleSave } from "../store.js";
import { renderFormatStrip } from "../features/formats.js";
import { STATUS } from "../constants.js";
import { buildTabPayload } from "../payload.js";
import { utf8ByteLength } from "../payload.js";
import { qrcodegen } from "../libs/qrcodegen.js";
import { makePatientTagPicker, getPatientTags, setPatientTags } from "../features/tags.js";
import { makeRoomInput, formatPatientLabel } from "../features/room.js";
import { isPatientTransferred } from "../features/move-patient.js";
import { t } from "../i18n.js";
import { isNonAdminTerminal } from "../features/admin.js";
import { recordOp } from "../features/roster.js";
import { scanQR, isScannerSupported } from "../features/qr-scan.js";
import { buildTimestampHeader } from "../features/qr-protocol.js";
import { createEditToggle } from "../features/edit-toggle.js";
import { statusClass } from "./home.js";

let qrVisible = false;
let nameToggle = null; // createEditToggle で初期化

// 詳細画面・ホーム編集モード共通のステータス巡回。
//   - タップ: 白→黄→緑→灰→白 を巡回 (青はサイクル外、青のタップは白に戻る)
//   - 長押し: 白 → 青 / それ以外 → 白
// 青は「新着 (取込で追加された患者) / 注意」を任意で示すスロット。
export const STATUS_CYCLE = [STATUS.NONE, STATUS.YELLOW, STATUS.GREEN, STATUS.GRAY];

export function nextStatusInCycle(current) {
  const idx = STATUS_CYCLE.indexOf(current);
  // 青などサイクル外から短タップで戻ると idx=-1 → 0 (= NONE) になる
  return STATUS_CYCLE[(idx + 1 + STATUS_CYCLE.length) % STATUS_CYCLE.length] || STATUS.YELLOW;
}

export function statusOnLongPress(current) {
  // 白からの長押しのみ青へ。青を含むそれ以外は全て白へ強制リセット。
  return current === STATUS.NONE ? STATUS.BLUE : STATUS.NONE;
}

// シンプルな「タップ vs 長押し」判定。長押し閾値 600ms。
export function bindTapOrLongPress(el, onTap, onLongPress, longMs = 600) {
  let timer = null;
  let longFired = false;
  let started = false;

  const start = () => {
    started = true;
    longFired = false;
    timer = setTimeout(() => {
      longFired = true;
      onLongPress();
    }, longMs);
  };
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    started = false;
  };
  const finish = () => {
    if (!started) return;
    if (timer) { clearTimeout(timer); timer = null; }
    if (!longFired) onTap();
    started = false;
  };

  el.addEventListener("pointerdown", (e) => { e.preventDefault(); start(); });
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointerleave", cancel);
  el.addEventListener("pointercancel", cancel);
}

// ============================
// QR generation helpers
// ============================

const MAX_BYTES_PER_QR = 800;

// 患者画面 QR は EMR に接続された QR スキャナで「そのまま打鍵」される用途
// なので、各ページの内容は SOAP テキストそのままにする。多ページ時のページ
// 番号は QR カード UI 側 (qrPageMeta) に出すだけで、ペイロードには埋め込まない。
function splitTextToFitQr(raw, ecl) {
  const s = String(raw ?? "");
  if (utf8ByteLength(s) <= MAX_BYTES_PER_QR) {
    try {
      qrcodegen.QrCode.encodeText(s, ecl);
      return [s];
    } catch (_) { }
  }

  const cps = Array.from(s);
  const pages = [];
  let pos = 0;
  while (pos < cps.length) {
    let hi = cps.length;
    let lo = pos + 1;
    let best = -1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const chunk = cps.slice(pos, mid).join("");
      if (utf8ByteLength(chunk) > MAX_BYTES_PER_QR) { hi = mid - 1; continue; }
      try {
        qrcodegen.QrCode.encodeText(chunk, ecl);
        best = mid;
        lo = mid + 1;
      } catch (_e) {
        hi = mid - 1;
      }
    }
    if (best <= pos) throw new Error("分割してもQRに入りません（1文字でも不可）");
    pages.push(cps.slice(pos, best).join(""));
    pos = best;
  }
  return pages;
}

function drawQrToCanvas(qr, canvas) {
  const ctx = canvas.getContext("2d");
  const border = 4;
  const modules = qr.size + border * 2;
  const parentW = (canvas.parentElement && canvas.parentElement.clientWidth) ? canvas.parentElement.clientWidth : 800;
  const cssW = Math.max(240, Math.min(parentW, 980));
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const scale = Math.max(2, Math.floor((cssW * dpr) / modules));
  const sizePx = modules * scale;
  canvas.width = sizePx;
  canvas.height = sizePx;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.maxWidth = cssW + "px";
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sizePx, sizePx);
  ctx.fillStyle = "#000000";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) {
        ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
      }
    }
  }
}

let qrPages = [];
let qrPageIndex = 0;

function showQrError(msg) {
  const qrError = document.getElementById("qrError");
  const qrCanvas = document.getElementById("qrCanvas");
  if (qrError) { qrError.style.display = "block"; qrError.textContent = String(msg); }
  if (qrCanvas) {
    const ctx = qrCanvas.getContext("2d");
    qrCanvas.width = 860;
    qrCanvas.height = 220;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
    ctx.fillStyle = "#111827";
    ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("QR生成に失敗しました。", 16, 40);
  }
}

function clearQrError() {
  const qrError = document.getElementById("qrError");
  if (qrError) { qrError.style.display = "none"; qrError.textContent = ""; }
}

// 患者ヘッダ直下に「他ワークスペースへ移動済」の控えめなバナーを出す。
// 元 ws の患者として履歴として残った状態 (転棟マーカー) のみ表示。
function renderTransferredBanner(p) {
  const host = document.getElementById("detailTransferredBannerHost");
  if (!host) return;
  host.textContent = "";
  if (!isPatientTransferred(p)) return;
  const banner = document.createElement("div");
  banner.className = "detailTransferredBanner";
  const d = new Date(p.transferredAt);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  banner.textContent = t("move.banner", { dest: p.transferredTo || "?", date: ymd });
  host.appendChild(banner);
}

function syncQrToggleButtons() {
  const b = document.getElementById("qrToggleBtn");
  if (!b) return;
  b.classList.toggle("editActive", qrVisible);
  b.setAttribute("aria-pressed", qrVisible ? "true" : "false");
}

export function renderQrIfNeeded() {
  const qrWrap = document.getElementById("qrWrap");
  if (!qrWrap) return;
  qrWrap.classList.toggle("active", qrVisible);
  syncQrToggleButtons();
  if (!qrVisible) return;

  const qrTextPreview = document.getElementById("qrTextPreview");
  const qrCanvas = document.getElementById("qrCanvas");
  if (qrTextPreview) qrTextPreview.textContent = buildTabPayload(selectedNo);
  clearQrError();

  try {
    const ecl = qrcodegen.QrCode.Ecc.LOW;
    qrPages = splitTextToFitQr(buildTabPayload(selectedNo), ecl);
    qrPageIndex = Math.min(qrPageIndex, Math.max(0, qrPages.length - 1));
    renderQrPage(ecl);
  } catch (e) {
    showQrError(e && e.message ? e.message : String(e));
  }
}

function renderQrPage(ecl) {
  const qrCanvas = document.getElementById("qrCanvas");
  const qrPageMeta = document.getElementById("qrPageMeta");
  const qrPrevBtn = document.getElementById("qrPrevBtn");
  const qrNextBtn = document.getElementById("qrNextBtn");

  const total = qrPages.length || 0;
  if (total <= 0) { if (qrPageMeta) qrPageMeta.textContent = ""; return; }
  const i = Math.max(0, Math.min(qrPageIndex, total - 1));
  qrPageIndex = i;
  const text = qrPages[i];

  if (qrPageMeta) qrPageMeta.textContent = `(${i + 1}/${total})`;
  if (qrPrevBtn) qrPrevBtn.disabled = i === 0;
  if (qrNextBtn) qrNextBtn.disabled = i === total - 1;

  if (qrCanvas) {
    const qr = qrcodegen.QrCode.encodeText(text, ecl);
    drawQrToCanvas(qr, qrCanvas);
  }
}

export function initQrNavButtons() {
  const qrPrevBtn = document.getElementById("qrPrevBtn");
  const qrNextBtn = document.getElementById("qrNextBtn");
  const ecl = qrcodegen.QrCode.Ecc.LOW;
  if (qrPrevBtn) qrPrevBtn.addEventListener("click", () => {
    if (qrPageIndex > 0) { qrPageIndex--; renderQrPage(ecl); }
  });
  if (qrNextBtn) qrNextBtn.addEventListener("click", () => {
    if (qrPageIndex < qrPages.length - 1) { qrPageIndex++; renderQrPage(ecl); }
  });
}

// ============================
// O-list editor row
// ============================

// ============================
// Status buttons
// ============================

// 名前ボタンの背景色を現在ステータスに合わせて更新する。
// 旧 setSelectedStatusButtons の置き換え（外部呼び出し互換のため同名で残置）。
export function setSelectedStatusButtons(status) {
  const btn = document.getElementById("detailNameBtn");
  if (!btn) return;
  btn.className = "patientBtn " + statusClass(status);
}

// ============================
// renderDetail
// ============================

export function renderDetail(syncDetailMemoDisplay) {
  qrVisible = false;
  const p = appState.patients[selectedNo - 1];
  const detailTitle = document.getElementById("detailTitle");
  const sText = document.getElementById("sText");
  const aText = document.getElementById("aText");
  const pText = document.getElementById("pText");
  const detailSharedText = document.getElementById("detailSharedText");
  const oFreeText = document.getElementById("oFreeText");

  // 名前ボタン（表示モード）の中身とステータス色
  const nameBtn = document.getElementById("detailNameBtn");
  if (nameBtn) {
    nameBtn.textContent = formatPatientLabel(p, String(selectedNo));
  }
  // 編集モード用の name input は隠れた状態で値だけ保持
  if (detailTitle) {
    detailTitle.value = String(p?.name ?? "");
    // Non-admin terminal: cannot edit existing names; can fill empty
    if (isNonAdminTerminal() && p?.name) {
      detailTitle.readOnly = true;
    } else {
      detailTitle.readOnly = false;
    }
  }
  if (syncDetailMemoDisplay) syncDetailMemoDisplay();
  setSelectedStatusButtons(p.status);

  // 患者切替時は常に表示モードに戻す
  setDetailEditing(false);

  const nonAdmin = isNonAdminTerminal();
  const detailRoomSlot = document.getElementById("detailRoomSlot");
  if (detailRoomSlot) {
    detailRoomSlot.textContent = "";
    const roomInp = makeRoomInput(selectedNo - 1);
    roomInp.classList.add("detailRoomInput");
    if (nonAdmin) roomInp.readOnly = true;
    detailRoomSlot.appendChild(roomInp);
  }

  const detailDoctorSlot = document.getElementById("detailDoctorSlot");
  if (detailDoctorSlot) {
    detailDoctorSlot.textContent = "";
    const picker = makePatientTagPicker(selectedNo - 1, () => renderInlineTags());
    if (nonAdmin) {
      const trigger = picker.querySelector(".tagPickerTrigger");
      if (trigger) { trigger.disabled = true; trigger.style.cursor = "default"; trigger.style.background = "#f9fafb"; }
    }
    detailDoctorSlot.appendChild(picker);
  }

  renderInlineTags();
  renderTransferredBanner(p);

  if (sText) sText.value = p.s;
  if (aText) aText.value = p.a.text;
  if (pText) pText.value = p.p.text;
  if (detailSharedText) detailSharedText.value = p.shared || "";
  if (oFreeText) oFreeText.value = String(p.oFree ?? "");

  // 各パネル右肩の [+] [pin...] [≡] ボタン strip を描画
  renderFormatStrip("S", document.getElementById("sFormatStrip"));
  renderFormatStrip("O", document.getElementById("oFormatStrip"));
  renderFormatStrip("A", document.getElementById("aFormatStrip"));
  renderFormatStrip("P", document.getElementById("pFormatStrip"));

  renderQrIfNeeded();
}

// ============================
// Detail event bindings
// ============================

export function initDetailEvents(renderHomeFn) {
  const detailTitle = document.getElementById("detailTitle");
  const detailMemoText = document.getElementById("detailMemoText");
  const sText = document.getElementById("sText");
  const aText = document.getElementById("aText");
  const pText = document.getElementById("pText");
  const detailSharedText = document.getElementById("detailSharedText");
  const oFreeText = document.getElementById("oFreeText");

  if (detailTitle) {
    detailTitle.addEventListener("input", () => {
      const p = appState.patients[selectedNo - 1];
      if (!p) return;
      const next = detailTitle.value;
      if (p.name !== next) {
        p.name = next;
        if (p.pid) recordOp({ type: "update", pid: p.pid, field: "name", value: next });
      }
      markUpdated(selectedNo);
      scheduleSave();
      if (renderHomeFn) renderHomeFn();
    });
  }

  if (detailMemoText) {
    detailMemoText.addEventListener("input", () => {
      const p = appState.patients[selectedNo - 1];
      p.memo = String(detailMemoText.value ?? "");
      markUpdated(selectedNo);
      scheduleSave();
    });
  }

  if (sText) sText.addEventListener("input", () => {
    const p = appState.patients[selectedNo - 1];
    p.s = String(sText.value ?? "");
    markUpdated(selectedNo);
    scheduleSave();
    renderQrIfNeeded();
  });

  if (detailSharedText) {
    detailSharedText.addEventListener("input", () => {
      const p = appState.patients[selectedNo - 1];
      p.shared = String(detailSharedText.value ?? "");
      markUpdated(selectedNo);
      scheduleSave();
    });
  }

  if (aText) aText.addEventListener("input", () => {
    const p = appState.patients[selectedNo - 1];
    p.a.text = String(aText.value ?? "");
    markUpdated(selectedNo);
    scheduleSave();
    renderQrIfNeeded();
  });

  if (pText) pText.addEventListener("input", () => {
    const p = appState.patients[selectedNo - 1];
    p.p.text = String(pText.value ?? "");
    markUpdated(selectedNo);
    scheduleSave();
    renderQrIfNeeded();
  });

  if (oFreeText) oFreeText.addEventListener("input", () => {
    const p = appState.patients[selectedNo - 1];
    p.oFree = String(oFreeText.value ?? "");
    markUpdated(selectedNo);
    scheduleSave();
    renderQrIfNeeded();
  });

  const qrToggleBtn = document.getElementById("qrToggleBtn");
  if (qrToggleBtn) qrToggleBtn.addEventListener("click", () => {
    qrVisible = !qrVisible;
    renderQrIfNeeded();
  });

  // 受信側カメラボタン：QR カード内にあり、QR 表示中だけ見える。
  // 読み取り結果を現在の患者の受診メモへタイムスタンプ付きで追記する。
  const detailScanBtn = document.getElementById("detailScanBtn");
  if (detailScanBtn) {
    if (!isScannerSupported()) {
      detailScanBtn.disabled = true;
      detailScanBtn.title = "このブラウザはカメラ非対応";
    }
    detailScanBtn.addEventListener("click", async () => {
      const text = await scanQR();
      if (text == null) return;
      const area = document.getElementById("detailMemoText");
      const p = appState.patients[selectedNo - 1];
      if (!area || !p) return;
      const cur = String(area.value || "");
      const sep = cur && !cur.endsWith("\n") ? "\n" : "";
      const next = cur + sep + buildTimestampHeader() + "\n" + text;
      area.value = next;
      p.memo = next;
      markUpdated(selectedNo);
      scheduleSave();
    });
  }
}

// 患者ヘッダーのインラインタグを描画する。
// - 表示順は設定タグ配列の順
// - 長押しでそのタグを患者から外す（共通ヘルパ bindTapOrLongPress を流用）
// - はみ出し分は CSS の overflow-x: auto で横スクロール表示
function renderInlineTags() {
  const host = document.getElementById("detailInlineTags");
  if (!host) return;
  host.textContent = "";
  const p = appState.patients[selectedNo - 1];
  if (!p) return;
  const settingsOrder = settings.tags || [];
  const tagSet = new Set(getPatientTags(selectedNo - 1));
  const ordered = settingsOrder.filter(t => tagSet.has(t));

  for (const tagName of ordered) {
    const chip = document.createElement("span");
    chip.className = "inlineTagChip";
    chip.textContent = tagName;
    chip.title = `${tagName}（長押しで外す）`;
    bindTapOrLongPress(
      chip,
      () => { /* タップ単独は何もしない（誤タップ保護） */ },
      () => {
        const cur = getPatientTags(selectedNo - 1).filter(t => t !== tagName);
        setPatientTags(selectedNo - 1, cur);
        renderInlineTags();
      }
    );
    host.appendChild(chip);
  }
}

// 詳細画面の表示モード ↔ 編集モード切替。共通 createEditToggle を使う。
// 表示モード: 名前ボタン（ステータス色つき）。タップでサイクル / 長押しで白。
// 編集モード: 部屋・名前・タグの入力欄。外側クリックや別ビューで自動 exit。
function applyEditingDom(editing) {
  const display = document.getElementById("detailNameBtn");
  const editRow = document.getElementById("detailEditRow");
  if (display) display.style.display = editing ? "none" : "";
  if (editRow) editRow.style.display = editing ? "flex" : "none";
}

function setDetailEditing(on) {
  if (!nameToggle) return;
  if (on) nameToggle.enter();
  else nameToggle.exit();
}

export function initStatusButtons(renderHomeFn) {
  const nameBtn = document.getElementById("detailNameBtn");
  const editBtn = document.getElementById("detailEditBtn");
  const container = document.querySelector("#detailView .detailTop");

  const setStatus = (next) => {
    const p = appState.patients[selectedNo - 1];
    if (!p) return;
    p.status = next;
    markUpdated(selectedNo);
    setSelectedStatusButtons(next);
    scheduleSave();
    if (renderHomeFn) renderHomeFn();
    renderQrIfNeeded();
  };

  if (nameBtn) {
    bindTapOrLongPress(
      nameBtn,
      () => {
        if (nameToggle?.isEditing()) return; // 編集中はサイクルしない
        const p = appState.patients[selectedNo - 1];
        if (!p) return;
        setStatus(nextStatusInCycle(p.status));
      },
      () => {
        if (nameToggle?.isEditing()) return;
        const p = appState.patients[selectedNo - 1];
        if (!p) return;
        setStatus(statusOnLongPress(p.status));
      }
    );
  }

  nameToggle = createEditToggle({
    triggerBtn: editBtn,
    container,
    onEnter: () => {
      applyEditingDom(true);
      const titleInput = document.getElementById("detailTitle");
      if (titleInput) { titleInput.focus(); titleInput.select(); }
    },
    onExit: () => {
      applyEditingDom(false);
      // 名前ボタンの表示を最新化
      const p = appState.patients[selectedNo - 1];
      const display = document.getElementById("detailNameBtn");
      if (display && p) display.textContent = formatPatientLabel(p, String(selectedNo));
    },
  });
}
