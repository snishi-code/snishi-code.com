"use strict";

import { appState, settings, makeDefaultPatient } from "../store.js";
import { qrcodegen } from "../libs/qrcodegen.js";
import { utf8ByteLength } from "../payload.js";
import { scanQR, isScannerSupported } from "./qr-scan.js";
import { finishDataChange } from "./drag.js";
import { recordOp } from "./roster.js";

// ============================
// ホーム QR（名簿: 部屋番号 + 名前 + タグ）
//
// 送信側: 名簿を1本のペイロード文字列に圧縮（JSON-per-line + 連続空RLE）
// し、MAX_BYTES でチャンクして各ページに `RND_HM #<batchId> N/M\n` ヘッダーを付与。
//
// 受信側: 各スキャンでヘッダーを解析。同じ batchId のページを揃えるまでバッファ
// し、N/N 揃った瞬間に auto-apply。同ページ重複は無視、順不同 OK。
// 別 batchId が来たら confirm して破棄。
//
// auto-apply の挙動:
//   - 名簿が空（全患者で room/name/tags すべて空）→ reflect モード
//     スロット 1..N を取込内容で上書き。N が現在の長さより大きければ拡張
//   - 名簿が空でない → append モード
//     取込内容のうち空でない患者だけを末尾に新規スロットとして追加
//     （RLE の `_N` 空患者は捨てる）
// ============================

const MAX_BYTES = 800;
// `RND_HM #<batchIdMax12> NN/NN\n` 程度。余裕を持って 50 確保
const HEADER_BUDGET = 50;
const KIND = "HM";

// ============================
// Encode / Decode payload
//
// 各患者は 1 行 `部屋|名前|タグidx,...` の pipe 区切り。サイズ最優先で
// 位置依存（key 名は持たない）。後ろが空のフィールドは pipe ごと省略可能。
// 連続空患者は `_N` で RLE。
//
// pipe `|` / バックスラッシュ `\` / 改行 `\n` が値に含まれる可能性を考慮し、
// それぞれ `\|` / `\\` / `\n`（2文字）にエスケープする。
// ============================

function escapeField(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "\\n");
}
function unescapeField(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const c = s[i + 1];
      out += c === "n" ? "\n" : c;
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}
function splitEscapedPipe(line) {
  const parts = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) {
      cur += line[i] + line[i + 1];
      i++;
    } else if (line[i] === "|") {
      parts.push(cur);
      cur = "";
    } else {
      cur += line[i];
    }
  }
  parts.push(cur);
  return parts;
}

function encodeRoster() {
  const tagIdxByName = new Map();
  (settings.tags || []).forEach((t, i) => tagIdxByName.set(t, i + 1));

  const lines = [];
  let emptyRun = 0;
  const flushRun = () => {
    if (emptyRun > 0) { lines.push("_" + emptyRun); emptyRun = 0; }
  };
  for (const p of appState.patients) {
    const room = String(p?.room || "").trim();
    const name = String(p?.name || "").trim();
    const tagIdxs = (p?.tags || [])
      .map(t => tagIdxByName.get(t))
      .filter(v => typeof v === "number");
    if (!room && !name && tagIdxs.length === 0) { emptyRun++; continue; }
    flushRun();
    const parts = [escapeField(room), escapeField(name), tagIdxs.join(",")];
    while (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    lines.push(parts.join("|"));
  }
  // 末尾の連続空は反映時に無意味なので捨てる
  return lines.join("\n");
}

function decodeRoster(payload) {
  const out = [];
  for (const raw of String(payload || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("_")) {
      const n = parseInt(line.slice(1), 10) || 0;
      for (let i = 0; i < n; i++) out.push({ room: "", name: "", tagIdxs: [] });
      continue;
    }
    const parts = splitEscapedPipe(line);
    const room = unescapeField(parts[0] || "");
    const name = unescapeField(parts[1] || "");
    const tagsRaw = parts[2] || "";
    const tagIdxs = tagsRaw
      ? tagsRaw.split(",").map(s => parseInt(s.trim(), 10)).filter(v => Number.isFinite(v))
      : [];
    out.push({ room, name, tagIdxs });
  }
  return out;
}

// ============================
// Page protocol
// ============================

function chunkPayload(payload, budget) {
  const lines = payload.split("\n");
  const chunks = [];
  let cur = "";
  let curBytes = 0;
  for (const line of lines) {
    const lineBytes = utf8ByteLength(line) + 1;
    if (cur && curBytes + lineBytes > budget) {
      chunks.push(cur);
      cur = line;
      curBytes = lineBytes;
    } else {
      cur = cur ? cur + "\n" + line : line;
      curBytes += lineBytes;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.length === 0 ? [""] : chunks;
}

function buildPages() {
  const payload = encodeRoster();
  if (!payload.trim()) return [];
  const batchId = Date.now().toString(36);
  const chunks = chunkPayload(payload, MAX_BYTES - HEADER_BUDGET);
  const total = chunks.length;
  return chunks.map((c, i) => `RND_${KIND} #${batchId} ${i + 1}/${total}\n${c}`);
}

const HEADER_RE = /^RND_([A-Z]+)\s+#(\S+)\s+(\d+)\/(\d+)\n([\s\S]*)$/;
function decodePage(text) {
  const m = String(text || "").match(HEADER_RE);
  if (!m) return null;
  return {
    kind: m[1],
    batchId: m[2],
    pageNum: parseInt(m[3], 10),
    totalPages: parseInt(m[4], 10),
    content: m[5],
  };
}

// ============================
// QR rendering (送信側)
// ============================

let qrPages = [];
let qrPageIndex = 0;

function drawQrToCanvas(text) {
  const canvas = document.getElementById("homeQrCanvas");
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
    console.error("Home QR generation failed", err);
  }
}

function renderQrPage() {
  const meta = document.getElementById("homeQrPageMeta");
  const prevBtn = document.getElementById("homeQrPrevBtn");
  const nextBtn = document.getElementById("homeQrNextBtn");
  const preview = document.getElementById("homeQrTextPreview");
  const canvas = document.getElementById("homeQrCanvas");

  if (!qrPages || qrPages.length === 0) {
    if (meta) meta.textContent = "";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    if (preview) preview.textContent = "（対象の患者がいません）";
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
  if (preview) preview.textContent = text;
  drawQrToCanvas(text);
}

function regenerateAndRender() {
  qrPages = buildPages();
  qrPageIndex = 0;
  renderQrPage();
}

function openHomeQr() {
  const wrap = document.getElementById("homeQrWrap");
  if (!wrap) return;
  wrap.classList.add("active");
  regenerateAndRender();
}
function closeHomeQr() {
  const wrap = document.getElementById("homeQrWrap");
  if (!wrap) return;
  wrap.classList.remove("active");
}
export function isHomeQrActive() {
  const wrap = document.getElementById("homeQrWrap");
  return !!(wrap && wrap.classList.contains("active"));
}
export function refreshHomeQrIfActive() {
  if (!isHomeQrActive()) return;
  regenerateAndRender();
}

// ============================
// 受信バッファ + auto-apply
// ============================

let recvBatchId = null;
let recvTotal = 0;
const recvPages = new Map();

function resetRecv() {
  recvBatchId = null;
  recvTotal = 0;
  recvPages.clear();
  updateRecvStatus("");
}

function updateRecvStatus(text) {
  const el = document.getElementById("homeQrRecvStatus");
  if (el) el.textContent = text;
}

function flashRecv(mode) {
  const wrap = document.getElementById("homeQrWrap");
  if (!wrap) return;
  const cls = mode === "dup" ? "scanFlashDup" : "scanFlashOk";
  wrap.classList.remove("scanFlashOk", "scanFlashDup");
  // 強制リフロー → アニメ再生
  void wrap.offsetWidth;
  wrap.classList.add(cls);
}

function applyRosterPayload(payload) {
  const roster = decodeRoster(payload);
  if (roster.length === 0) {
    alert("取込内容が空でした。");
    return;
  }

  const isEmpty = appState.patients.every(p =>
    !String(p?.room || "").trim() &&
    !String(p?.name || "").trim() &&
    (!p?.tags || p.tags.length === 0)
  );

  const resolveTag = (idx) => settings.tags?.[idx - 1] || null;

  if (isEmpty) {
    // reflect モード: slot 1..N に上書き、必要なら拡張
    while (appState.patients.length < roster.length) {
      const p = makeDefaultPatient();
      appState.patients.push(p);
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
    closeHomeQr();
    alert(`${roster.length} 件の名簿を反映しました。`);
  } else {
    // append モード: 空患者を除いて末尾に追加
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
    closeHomeQr();
    alert(`${added.length} 件を末尾に追加しました。`);
  }
}

async function startScan() {
  const text = await scanQR();
  if (text == null) return;
  const decoded = decodePage(text);
  if (!decoded) {
    alert("ホーム QR の形式ではありません。");
    return;
  }
  if (decoded.kind !== KIND) {
    alert(`これはホーム QR ではありません（kind=${decoded.kind}）。`);
    return;
  }
  // 別バッチに切り替わったら confirm
  if (recvBatchId && recvBatchId !== decoded.batchId) {
    if (!confirm("別のバッチを検出しました。前回までの受信を破棄して新しい QR を取り込みますか?")) return;
    resetRecv();
  }
  if (!recvBatchId) {
    recvBatchId = decoded.batchId;
    recvTotal = decoded.totalPages;
  }
  if (recvPages.has(decoded.pageNum)) {
    flashRecv("dup");
    updateRecvStatus(`重複: ${recvPages.size}/${recvTotal} 受信済`);
    return;
  }
  recvPages.set(decoded.pageNum, decoded.content);
  try { navigator.vibrate?.(80); } catch (_) {}
  flashRecv("ok");

  if (recvPages.size === recvTotal) {
    const full = [];
    for (let i = 1; i <= recvTotal; i++) full.push(recvPages.get(i));
    const payload = full.join("\n");
    resetRecv();
    applyRosterPayload(payload);
  } else {
    updateRecvStatus(`${recvPages.size}/${recvTotal} 受信`);
  }
}

// ============================
// Init
// ============================

export function initHomeQr() {
  const showBtn = document.getElementById("homeShowQrBtn");
  if (showBtn) showBtn.addEventListener("click", () => {
    if (isHomeQrActive()) closeHomeQr();
    else openHomeQr();
  });

  const prevBtn = document.getElementById("homeQrPrevBtn");
  const nextBtn = document.getElementById("homeQrNextBtn");
  if (prevBtn) prevBtn.addEventListener("click", () => {
    if (qrPageIndex > 0) { qrPageIndex--; renderQrPage(); }
  });
  if (nextBtn) nextBtn.addEventListener("click", () => {
    if (qrPageIndex < qrPages.length - 1) { qrPageIndex++; renderQrPage(); }
  });

  const scanBtn = document.getElementById("homeQrScanBtn");
  if (scanBtn) {
    if (!isScannerSupported()) {
      scanBtn.disabled = true;
      scanBtn.title = "このブラウザはカメラ非対応";
    }
    scanBtn.addEventListener("click", startScan);
  }
}
