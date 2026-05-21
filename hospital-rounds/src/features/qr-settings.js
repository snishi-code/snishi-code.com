"use strict";

import { settings, setSettings, saveSettings } from "../store.js";
import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { scanQRStream, isScannerSupported } from "./qr-scan.js";
import { encodePages, decodePage, newBatchId } from "./qr-protocol.js";

// ============================
// 設定QR
//
// 安全な設定フィールド（タグ・Oルール・デフォルト文・クリア対象・タググループ等）
// だけを JSON シリアライズして QR 化。管理機能・端末固有値は持ち出さない。
// 受信側は上書き confirm の上で「安全フィールドだけ」を差し替え、admin/device
// 関連は現在値を維持する（=他端末の設定で汚染されない）。
//
// プロトコルはホーム/メモ/共有と共通の `RND_ST #<batchId> N/M\n<本文>`。
// 本文は 1 オブジェクト分の JSON 文字列で、必要なら自然に多ページに分割される。
// ============================

const KIND = "ST";
const MAX_BYTES = 800;

// 受信時に上書きするフィールド（管理機能・端末固有値は除外）
const SAFE_FIELDS = [
  "defaults",
  "oRules",
  "clearTargets",
  "tags",
  "tagGroups",
  "tagGroupingEnabled",
  "tagGroupAssign",
];

// ============================
// QR wire 形式
//
// 位置依存セクションが順序変更や項目追加で壊れないよう、wire 自体に
// スキーマ宣言 `ks` を埋め込む。受信側は `ks` を見て decode するので、
// アプリ側の field 順が将来変わっても古い QR を正しく解釈できる。
//
//   - ks: 各セクションのフィールド順を宣言する辞書
//   - d: defaults を ks.d 順の文字列配列で
//   - o: oRules を ks.o 順の配列の配列で（fromAdmin が true の時だけ末尾に 1）
//   - c: clearTargets を ks.c 順のビット列 "0110001110" で
//   - tg: tagGroups を ks.tg 順の配列の配列で
//   - t / tge / tga はそのまま（位置依存ではない）
// ============================

const WIRE_V = 2;
const SCHEMAS = {
  d: ["s", "a", "p"],
  o: ["key", "label", "normalText", "fromAdmin"],
  c: [
    "memo", "s", "o", "a", "p", "shared",
    "statusYellow", "statusGreen", "statusGray", "statusBlue",
  ],
  tg: ["id", "name", "mode"],
};
const BOOL_FIELDS = new Set(["fromAdmin"]);

function serializeForWire(s) {
  const out = { v: WIRE_V, ks: SCHEMAS };
  if (s.defaults) {
    out.d = SCHEMAS.d.map(f => String(s.defaults[f] || ""));
  }
  if (Array.isArray(s.oRules)) {
    out.o = s.oRules.map(r => {
      const arr = [];
      for (let i = 0; i < SCHEMAS.o.length; i++) {
        const f = SCHEMAS.o[i];
        if (BOOL_FIELDS.has(f)) arr.push(r[f] ? 1 : 0);
        else arr.push(String(r[f] || ""));
      }
      // 末尾の falsy（boolean=0 / 空文字）を削って bytes 節約
      while (arr.length > 1 && (arr[arr.length - 1] === "" || arr[arr.length - 1] === 0)) arr.pop();
      return arr;
    });
  }
  if (s.clearTargets) {
    out.c = SCHEMAS.c.map(f => s.clearTargets[f] ? "1" : "0").join("");
  }
  if (Array.isArray(s.tags)) out.t = s.tags;
  if (typeof s.tagGroupingEnabled === "boolean") out.tge = s.tagGroupingEnabled;
  if (Array.isArray(s.tagGroups)) {
    out.tg = s.tagGroups.map(g => SCHEMAS.tg.map(f => String(g[f] || "")));
  }
  if (s.tagGroupAssign && Object.keys(s.tagGroupAssign).length) {
    out.tga = s.tagGroupAssign;
  }
  return out;
}

function deserializeFromWire(wire) {
  if (!wire || typeof wire !== "object" || wire.v !== WIRE_V) return null;
  // ks が wire に含まれていればそれを優先、なければ現行の SCHEMAS をフォールバック
  const ks = (wire.ks && typeof wire.ks === "object") ? wire.ks : SCHEMAS;
  const out = {};

  if (Array.isArray(wire.d) && Array.isArray(ks.d)) {
    out.defaults = {};
    for (let i = 0; i < ks.d.length; i++) {
      const f = ks.d[i];
      const val = wire.d[i];
      if (val !== undefined) out.defaults[f] = String(val || "");
    }
  }

  if (Array.isArray(wire.o) && Array.isArray(ks.o)) {
    out.oRules = wire.o.map(arr => {
      const r = {};
      for (let i = 0; i < ks.o.length; i++) {
        const f = ks.o[i];
        const val = arr[i];
        if (val === undefined) continue;
        if (BOOL_FIELDS.has(f)) r[f] = !!val;
        else r[f] = String(val || "");
      }
      return r;
    });
  }

  if (typeof wire.c === "string" && Array.isArray(ks.c)) {
    out.clearTargets = {};
    for (let i = 0; i < ks.c.length; i++) {
      out.clearTargets[ks.c[i]] = wire.c[i] === "1";
    }
  }

  if (Array.isArray(wire.t)) out.tags = wire.t.filter(x => typeof x === "string");
  if (typeof wire.tge === "boolean") out.tagGroupingEnabled = wire.tge;

  if (Array.isArray(wire.tg) && Array.isArray(ks.tg)) {
    out.tagGroups = wire.tg.map(arr => {
      const g = {};
      for (let i = 0; i < ks.tg.length; i++) {
        const f = ks.tg[i];
        const val = arr[i];
        if (val !== undefined) g[f] = String(val || "");
      }
      return g;
    });
  }

  if (wire.tga && typeof wire.tga === "object") {
    out.tagGroupAssign = {};
    for (const [k, v] of Object.entries(wire.tga)) {
      if (typeof k === "string" && typeof v === "string") out.tagGroupAssign[k] = v;
    }
  }

  return out;
}

function buildSafeSettings() {
  const out = {};
  for (const k of SAFE_FIELDS) {
    if (settings[k] !== undefined) out[k] = settings[k];
  }
  return out;
}

function encodePayload() {
  return JSON.stringify(serializeForWire(buildSafeSettings()));
}

function decodePayload(payload) {
  try {
    const obj = JSON.parse(String(payload || ""));
    return deserializeFromWire(obj);
  } catch (_) {
    return null;
  }
}

// ============================
// 送信側 QR 描画
// ============================

let qrPages = [];
let qrPageIndex = 0;

function drawQrToCanvas(text) {
  const canvas = document.getElementById("settingsQrCanvas");
  if (!canvas) return;
  try {
    const ecl = qrcodegen.QrCode.Ecc.LOW;
    const qr = qrcodegen.QrCode.encodeText(text, ecl);
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
    const ctx = canvas.getContext("2d");
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
  } catch (err) {
    console.error("Settings QR generation failed", err);
  }
}

function renderQrPage() {
  const meta = document.getElementById("settingsQrPageMeta");
  const prevBtn = document.getElementById("settingsQrPrevBtn");
  const nextBtn = document.getElementById("settingsQrNextBtn");
  const canvas = document.getElementById("settingsQrCanvas");

  if (!qrPages || qrPages.length === 0) {
    if (meta) meta.textContent = "（設定が空です）";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (canvas) {
      canvas.width = 1; canvas.height = 1;
      canvas.style.width = "0";
    }
    return;
  }

  const i = Math.max(0, Math.min(qrPageIndex, qrPages.length - 1));
  qrPageIndex = i;
  const total = qrPages.length;
  const text = qrPages[i];
  const bytes = utf8ByteLength(text);
  if (meta) meta.textContent = `(${i + 1}/${total}) ${bytes} bytes`;
  if (prevBtn) prevBtn.disabled = (i === 0);
  if (nextBtn) nextBtn.disabled = (i === total - 1);
  drawQrToCanvas(text);
}

function regenerateAndRender() {
  qrPages = encodePages({ kind: KIND, payload: encodePayload(), batchId: newBatchId(), maxBytes: MAX_BYTES });
  qrPageIndex = 0;
  renderQrPage();
}

function open() {
  const wrap = document.getElementById("settingsQrWrap");
  if (!wrap) return;
  wrap.classList.add("active");
  regenerateAndRender();
}
function close() {
  const wrap = document.getElementById("settingsQrWrap");
  if (!wrap) return;
  wrap.classList.remove("active");
}
export function isSettingsQrActive() {
  const wrap = document.getElementById("settingsQrWrap");
  return !!(wrap && wrap.classList.contains("active"));
}
export function refreshSettingsQrIfActive() {
  if (!isSettingsQrActive()) return;
  regenerateAndRender();
}

// ============================
// 受信バッファ
// ============================

let recvBatchId = null;
let recvTotal = 0;
const recvPages = new Map();
function resetRecv() {
  recvBatchId = null;
  recvTotal = 0;
  recvPages.clear();
}

// applied 後のレンダー再描画フックは main.js から渡してもらう
let onAppliedHandler = null;
export function setOnSettingsApplied(fn) { onAppliedHandler = fn; }

function applySettings(safe) {
  if (!safe) {
    alert("受信した設定の形式が認識できませんでした。");
    return;
  }
  const summary = [];
  if (Array.isArray(safe.tags)) summary.push(`タグ ${safe.tags.length} 件`);
  if (Array.isArray(safe.oRules)) summary.push(`Oルール ${safe.oRules.length} 件`);
  if (safe.defaults) summary.push("デフォルト文");
  if (safe.clearTargets) summary.push("クリア対象");
  if (Array.isArray(safe.tagGroups)) summary.push(`タググループ ${safe.tagGroups.length} 件`);
  const summaryText = summary.length ? `（${summary.join(", ")}）` : "";

  const ok = confirm(`現在の設定 ${summaryText} を上書きします。\n管理機能・端末固有設定は維持されます。よろしいですか？`);
  if (!ok) return;

  // 管理機能・端末固有フィールドを維持しつつ、安全フィールドを差し替え
  const next = { ...settings };
  for (const k of SAFE_FIELDS) {
    if (safe[k] !== undefined) next[k] = safe[k];
  }
  setSettings(next);
  saveSettings();
  close();
  if (onAppliedHandler) onAppliedHandler();
  alert("設定を取り込みました。");
}

function startScan() {
  const session = scanQRStream({
    onScan: (text, ctrl) => {
      const decoded = decodePage(text);
      if (!decoded) {
        ctrl.setStatus("QR 形式が認識できません");
        return;
      }
      if (decoded.kind !== KIND) {
        ctrl.setStatus(`これは設定QRではありません（kind=${decoded.kind}）`);
        return;
      }
      if (recvBatchId && recvBatchId !== decoded.batchId) {
        resetRecv();
        ctrl.setStatus("新しいバッチを検出。受信バッファをリセットしました");
      }
      if (!recvBatchId) {
        recvBatchId = decoded.batchId;
        recvTotal = decoded.totalPages;
      }
      if (recvPages.has(decoded.pageNum)) {
        ctrl.setStatus(`重複: ${recvPages.size}/${recvTotal} 受信済`);
        return;
      }
      recvPages.set(decoded.pageNum, decoded.content);
      try { navigator.vibrate?.(80); } catch (_) {}
      if (recvPages.size === recvTotal) {
        const full = [];
        for (let i = 1; i <= recvTotal; i++) full.push(recvPages.get(i));
        const payload = full.join("");
        resetRecv();
        ctrl.setStatus(`全 ${recvTotal} ページ受信完了`);
        setTimeout(() => applySettings(decodePayload(payload)), 100);
        return { stop: true };
      }
      ctrl.setStatus(`${recvPages.size}/${recvTotal} 受信`);
    },
  });
  if (!session) alert("スキャナを開けませんでした。");
}

// ============================
// Init
// ============================

export function initSettingsQr() {
  const showBtn = document.getElementById("settingsShowQrBtn");
  if (showBtn) showBtn.addEventListener("click", () => {
    if (isSettingsQrActive()) close();
    else open();
  });

  const prevBtn = document.getElementById("settingsQrPrevBtn");
  const nextBtn = document.getElementById("settingsQrNextBtn");
  if (prevBtn) prevBtn.addEventListener("click", () => {
    if (qrPageIndex > 0) { qrPageIndex--; renderQrPage(); }
  });
  if (nextBtn) nextBtn.addEventListener("click", () => {
    if (qrPageIndex < qrPages.length - 1) { qrPageIndex++; renderQrPage(); }
  });

  const scanBtn = document.getElementById("settingsQrScanBtn");
  if (scanBtn) {
    if (!isScannerSupported()) {
      scanBtn.disabled = true;
      scanBtn.title = "このブラウザはカメラ非対応";
    }
    scanBtn.addEventListener("click", startScan);
  }
}
