"use strict";

import { appState, settings, selectedNo, oRuleMap, makeEmptyOByRules, markUpdated, scheduleSave } from "../store.js";
import { STATUS } from "../constants.js";
import { buildTabPayload } from "../payload.js";
import { utf8ByteLength } from "../payload.js";
import { qrcodegen } from "../libs/qrcodegen.js";
import { makePatientTagPicker } from "../features/tags.js";
import { makeRoomInput } from "../features/room.js";
import { isNonAdminTerminal } from "../features/admin.js";
import { recordOp } from "../features/roster.js";

// ============================
// QR generation helpers
// ============================

const MAX_BYTES_PER_QR = 800;

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

  const total = pages.length;
  const out = [];
  for (let i = 0; i < pages.length; i++) {
    const head = `RND2 ${i + 1}/${total}\n`;
    out.push(head + pages[i]);
  }
  for (const t of out) {
    try { qrcodegen.QrCode.encodeText(t, ecl); }
    catch (_) { return pages; }
  }
  return out;
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

export function renderQrIfNeeded() {
  const p = appState.patients[selectedNo - 1];
  const qrWrap = document.getElementById("qrWrap");
  if (!qrWrap) return;
  const show = p.status === STATUS.GREEN;
  qrWrap.classList.toggle("active", show);
  if (!show) return;

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

  const bytes = utf8ByteLength(text);
  if (qrPageMeta) qrPageMeta.textContent = `(${i + 1}/${total}) ${bytes} bytes`;
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

function renderOEditorRow(rule, item, onChange) {
  const row = document.createElement("div");
  row.style.marginTop = "10px";

  const lbl = document.createElement("label");
  lbl.textContent = rule.label;
  row.appendChild(lbl);

  const seg = document.createElement("div");
  seg.className = "segRow";
  row.appendChild(seg);

  const b = document.createElement("button");
  b.type = "button";
  b.className = "segBtn normalCheck" + (item.normal ? " selected" : "");
  b.title = "正常";
  b.setAttribute("aria-label", "正常");
  b.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
  b.addEventListener("click", () => {
    const cur = appState.patients[selectedNo - 1]?.o?.[rule.key] ?? { normal: false, note: "" };
    const next = { ...cur, normal: !cur.normal };
    b.classList.toggle("selected", next.normal);
    onChange(next);
  });
  seg.appendChild(b);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "oInput";
  input.placeholder = "";
  input.value = String(item.note ?? "");
  input.addEventListener("input", () => {
    const cur = appState.patients[selectedNo - 1]?.o?.[rule.key] ?? { normal: false, note: "" };
    const note = String(input.value ?? "");
    const next = { ...cur, note, normal: note.trim() ? false : cur.normal };
    b.classList.toggle("selected", next.normal);
    onChange(next);
  });
  seg.appendChild(input);

  return row;
}

// ============================
// Status buttons
// ============================

export function setSelectedStatusButtons(status) {
  const statusYellowBtn = document.getElementById("statusYellowBtn");
  const statusGreenBtn = document.getElementById("statusGreenBtn");
  const statusGrayBtn = document.getElementById("statusGrayBtn");
  const topStatusYellowBtn = document.getElementById("topStatusYellowBtn");
  const topStatusGreenBtn = document.getElementById("topStatusGreenBtn");
  const topStatusGrayBtn = document.getElementById("topStatusGrayBtn");

  if (statusYellowBtn) statusYellowBtn.classList.toggle("selected", status === STATUS.YELLOW);
  if (statusGreenBtn) statusGreenBtn.classList.toggle("selected", status === STATUS.GREEN);
  if (statusGrayBtn) statusGrayBtn.classList.toggle("selected", status === STATUS.GRAY);
  if (topStatusYellowBtn) topStatusYellowBtn.classList.toggle("selected", status === STATUS.YELLOW);
  if (topStatusGreenBtn) topStatusGreenBtn.classList.toggle("selected", status === STATUS.GREEN);
  if (topStatusGrayBtn) topStatusGrayBtn.classList.toggle("selected", status === STATUS.GRAY);
}

// ============================
// renderDetail
// ============================

export function renderDetail(syncDetailMemoDisplay) {
  const p = appState.patients[selectedNo - 1];
  const detailTitle = document.getElementById("detailTitle");
  const sText = document.getElementById("sText");
  const aText = document.getElementById("aText");
  const pText = document.getElementById("pText");
  const detailSharedText = document.getElementById("detailSharedText");
  const oList = document.getElementById("oList");
  const oFreeText = document.getElementById("oFreeText");

  const displayName = p?.name ? p.name : String(selectedNo);
  if (detailTitle) {
    detailTitle.value = displayName;
    // Non-admin terminal: cannot edit existing names; can fill empty
    if (isNonAdminTerminal() && p?.name) {
      detailTitle.readOnly = true;
    } else {
      detailTitle.readOnly = false;
    }
  }
  if (syncDetailMemoDisplay) syncDetailMemoDisplay();
  setSelectedStatusButtons(p.status);

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
    const picker = makePatientTagPicker(selectedNo - 1);
    if (nonAdmin) {
      const trigger = picker.querySelector(".tagPickerTrigger");
      if (trigger) { trigger.disabled = true; trigger.style.cursor = "default"; trigger.style.background = "#f9fafb"; }
    }
    detailDoctorSlot.appendChild(picker);
  }

  if (sText) sText.value = p.s;
  if (aText) aText.value = p.a.text;
  if (pText) pText.value = p.p.text;
  if (detailSharedText) detailSharedText.value = p.shared || "";

  const v = p.vitals || {};
  const vitalFields = [
    ["vitalSpo2", "spo2"], ["vitalSpo2Memo", "spo2_memo"], ["vitalRr", "rr"],
    ["vitalBpSys", "bp_sys"], ["vitalBpDia", "bp_dia"], ["vitalPr", "pr"], ["vitalBt", "bt"]
  ];
  for (const [id, key] of vitalFields) {
    const el = document.getElementById(id);
    if (el) el.value = v[key] || "";
  }
  if (oFreeText) oFreeText.value = String(p.oFree ?? "");

  if (oList) {
    oList.textContent = "";
    const map = oRuleMap();
    for (const r of settings.oRules) {
      const rule = map[r.key];
      if (!rule) continue;
      if (!p.o || typeof p.o !== "object") p.o = makeEmptyOByRules();
      if (!p.o[r.key]) p.o[r.key] = { normal: false, note: "" };
      const row = renderOEditorRow(rule, p.o[r.key], (next) => {
        p.o[r.key] = next;
        markUpdated(selectedNo);
        scheduleSave();
        renderQrIfNeeded();
      });
      oList.appendChild(row);
    }
  }

  renderQrIfNeeded();
}

// ============================
// Detail event bindings
// ============================

function doClear(renderHomeFn, syncMemoFn) {
  const p = appState.patients[selectedNo - 1];
  const ct = settings.clearTargets;
  if (ct.memo) p.memo = "";
  if (ct.s) p.s = "";
  if (ct.o) {
    p.o = makeEmptyOByRules();
    p.oFree = "";
    p.vitals = { spo2: "", spo2_memo: "", rr: "", bp_sys: "", bp_dia: "", pr: "", bt: "" };
  }
  if (ct.a) p.a = { text: "" };
  if (ct.p) p.p = { text: "" };
  if (ct.shared) p.shared = "";
  if (p.status === STATUS.YELLOW && ct.statusYellow) p.status = STATUS.NONE;
  else if (p.status === STATUS.GREEN && ct.statusGreen) p.status = STATUS.NONE;
  else if (p.status === STATUS.GRAY && ct.statusGray) p.status = STATUS.NONE;
  else if (p.status === STATUS.BLUE && ct.statusBlue) p.status = STATUS.NONE;
  markUpdated(selectedNo);
  scheduleSave();
  renderDetail(syncMemoFn);
  if (renderHomeFn) renderHomeFn();
  renderQrIfNeeded();
}

export function initDetailEvents(renderHomeFn, syncMemoFn) {
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

  const vitalBindings = [
    { id: "vitalSpo2", key: "spo2" },
    { id: "vitalSpo2Memo", key: "spo2_memo" },
    { id: "vitalRr", key: "rr" },
    { id: "vitalBpSys", key: "bp_sys" },
    { id: "vitalBpDia", key: "bp_dia" },
    { id: "vitalPr", key: "pr" },
    { id: "vitalBt", key: "bt" },
  ];
  for (const { id, key } of vitalBindings) {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => {
      const p = appState.patients[selectedNo - 1];
      if (!p.vitals) p.vitals = { spo2: "", spo2_memo: "", rr: "", bp_sys: "", bp_dia: "", pr: "", bt: "" };
      p.vitals[key] = String(el.value ?? "");
      markUpdated(selectedNo);
      scheduleSave();
      renderQrIfNeeded();
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

  const clearBtn = document.getElementById("clearBtn");
  const clearBtnBottom = document.getElementById("clearBtnBottom");
  const onClear = () => {
    if (!confirm("対象項目をクリアします。よろしいですか？")) return;
    doClear(renderHomeFn, syncMemoFn);
  };
  if (clearBtn) clearBtn.addEventListener("click", onClear);
  if (clearBtnBottom) clearBtnBottom.addEventListener("click", onClear);
}

export function initStatusButtons(renderHomeFn) {
  const setStatus = (status) => {
    const p = appState.patients[selectedNo - 1];
    const next = p.status === status ? STATUS.NONE : status;
    p.status = next;
    markUpdated(selectedNo);
    setSelectedStatusButtons(next);
    scheduleSave();
    if (renderHomeFn) renderHomeFn();
    renderQrIfNeeded();
  };

  const statusYellowBtn = document.getElementById("statusYellowBtn");
  const statusGreenBtn = document.getElementById("statusGreenBtn");
  const statusGrayBtn = document.getElementById("statusGrayBtn");
  const topStatusYellowBtn = document.getElementById("topStatusYellowBtn");
  const topStatusGreenBtn = document.getElementById("topStatusGreenBtn");
  const topStatusGrayBtn = document.getElementById("topStatusGrayBtn");

  if (statusYellowBtn) statusYellowBtn.addEventListener("click", () => setStatus(STATUS.YELLOW));
  if (statusGreenBtn) statusGreenBtn.addEventListener("click", () => setStatus(STATUS.GREEN));
  if (statusGrayBtn) statusGrayBtn.addEventListener("click", () => setStatus(STATUS.GRAY));
  if (topStatusYellowBtn) topStatusYellowBtn.addEventListener("click", () => setStatus(STATUS.YELLOW));
  if (topStatusGreenBtn) topStatusGreenBtn.addEventListener("click", () => setStatus(STATUS.GREEN));
  if (topStatusGrayBtn) topStatusGrayBtn.addEventListener("click", () => setStatus(STATUS.GRAY));
}
