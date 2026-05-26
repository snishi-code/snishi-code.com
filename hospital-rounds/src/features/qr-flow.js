"use strict";

import { qrcodegen } from "../libs/qrcodegen.js";
import { scanQRStream, isScannerSupported } from "./qr-scan.js";
import { encodePages, decodePage, newBatchId } from "./qr-protocol.js";
import { t } from "../i18n.js";

// ============================
// QR フロー共通ファクトリ
//
// 4 種 (HM/MM/SH/ST) すべてが「送信側 QR カードのレンダリング + 連続スキャン
// 受信 + バッチID ベースの多ページ集合 + 全ページ揃った瞬間の auto-apply」
// という同じライフサイクルを持つ。ここに集約してターゲット固有の差は cfg
// に閉じる:
//
//   - kind / kindLabel       : 種別タグと表示名（スキャナ警告に使う）
//   - ids                    : DOM ID 一式（wrap/canvas/meta/prev/next/show/scan）
//   - encodePayload()        : in-memory → 文字列ペイロード
//   - decodePayload(string)  : ペイロード → 任意の decoded データ
//   - onApply(decoded, ctrl) : N/N 揃った瞬間に呼ばれる。ctrl.close で送信
//                              カードを閉じられる
//
// 受信ヘッダー解析と多ページ集合は qr-protocol.js に任せ、ここはフロー制御
// と DOM 配線だけを担当する。
// ============================

const MAX_BYTES = 800;

function drawQrToCanvas(canvasId, text) {
  const canvas = document.getElementById(canvasId);
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
    console.error(`QR generation failed (${canvasId})`, err);
  }
}

export function createQrFlow(cfg) {
  let qrPages = [];
  let qrPageIndex = 0;

  let recvBatchId = null;
  let recvTotal = 0;
  const recvPages = new Map();
  function resetRecv() {
    recvBatchId = null;
    recvTotal = 0;
    recvPages.clear();
  }

  function renderQrPage() {
    const meta = document.getElementById(cfg.ids.pageMetaId);
    const prevBtn = document.getElementById(cfg.ids.prevBtnId);
    const nextBtn = document.getElementById(cfg.ids.nextBtnId);
    const canvas = document.getElementById(cfg.ids.canvasId);

    if (!qrPages || qrPages.length === 0) {
      if (meta) meta.textContent = cfg.emptyMessage || "（表示する内容がありません）";
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
    if (meta) meta.textContent = `(${i + 1}/${total})`;
    if (prevBtn) prevBtn.disabled = (i === 0);
    if (nextBtn) nextBtn.disabled = (i === total - 1);
    drawQrToCanvas(cfg.ids.canvasId, text);
  }

  function regenerateAndRender() {
    const payload = cfg.encodePayload();
    qrPages = payload
      ? encodePages({ kind: cfg.kind, payload, batchId: newBatchId(), maxBytes: MAX_BYTES })
      : [];
    qrPageIndex = 0;
    renderQrPage();
  }

  function open() {
    const wrap = document.getElementById(cfg.ids.wrapId);
    if (!wrap) return;
    wrap.classList.add("active");
    regenerateAndRender();
  }
  function close() {
    const wrap = document.getElementById(cfg.ids.wrapId);
    if (!wrap) return;
    wrap.classList.remove("active");
  }
  function isActive() {
    const wrap = document.getElementById(cfg.ids.wrapId);
    return !!(wrap && wrap.classList.contains("active"));
  }
  function refresh() {
    if (!isActive()) return;
    regenerateAndRender();
  }

  function startScan() {
    const session = scanQRStream({
      onScan: (text, ctrl) => {
        const decoded = decodePage(text);
        if (!decoded) {
          ctrl.setStatus("QR 形式が認識できません");
          return;
        }
        if (decoded.kind !== cfg.kind) {
          ctrl.setStatus(`これは ${cfg.kindLabel} ではありません（kind=${decoded.kind}）`);
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
          // スキャナが閉じてから apply（alert がスキャナの裏に隠れないように）
          setTimeout(() => {
            let decodedPayload;
            try {
              decodedPayload = cfg.decodePayload(payload);
            } catch (e) {
              alert(t("qr.recv.parse.failed", { message: e.message || e }));
              return;
            }
            cfg.onApply(decodedPayload, { close });
          }, 100);
          return { stop: true };
        }
        ctrl.setStatus(`${recvPages.size}/${recvTotal} 受信`);
      },
    });
    if (!session) alert(t("qr.scanner.open.failed"));
  }

  function init() {
    const showBtn = document.getElementById(cfg.ids.showBtnId);
    if (showBtn) showBtn.addEventListener("click", () => {
      if (isActive()) close();
      else open();
    });

    const prevBtn = document.getElementById(cfg.ids.prevBtnId);
    const nextBtn = document.getElementById(cfg.ids.nextBtnId);
    if (prevBtn) prevBtn.addEventListener("click", () => {
      if (qrPageIndex > 0) { qrPageIndex--; renderQrPage(); }
    });
    if (nextBtn) nextBtn.addEventListener("click", () => {
      if (qrPageIndex < qrPages.length - 1) { qrPageIndex++; renderQrPage(); }
    });

    const scanBtn = document.getElementById(cfg.ids.scanBtnId);
    if (scanBtn) {
      if (!isScannerSupported()) {
        scanBtn.disabled = true;
        scanBtn.title = "このブラウザはカメラ非対応";
      }
      scanBtn.addEventListener("click", startScan);
    }
  }

  return { init, isActive, refresh, close, open };
}
