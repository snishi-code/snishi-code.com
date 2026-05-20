"use strict";

import jsQR from "jsqr";

// カメラ＋jsQR ライブスキャナ。scanQR() を呼ぶとモーダル表示、
// QR を認識した瞬間に閉じてテキストを resolve する。
// キャンセル・失敗時は null。完全オフラインで動作。

let activeSession = null;

export function isScannerSupported() {
  return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
}

export function scanQR() {
  if (activeSession) {
    return activeSession.promise;
  }
  if (!isScannerSupported()) {
    alert("このブラウザはカメラを利用できません。代わりにテキストを貼り付けてください。");
    return Promise.resolve(null);
  }

  const overlay = buildOverlay();
  document.body.appendChild(overlay.root);

  let cleaned = false;
  let stream = null;
  let rafId = 0;
  let resolveResult = null;

  const promise = new Promise((res) => { resolveResult = res; });

  function cleanup(result) {
    if (cleaned) return;
    cleaned = true;
    if (rafId) cancelAnimationFrame(rafId);
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    overlay.root.remove();
    activeSession = null;
    resolveResult(result);
  }

  overlay.cancelBtn.addEventListener("click", () => cleanup(null));
  overlay.root.addEventListener("click", (e) => {
    if (e.target === overlay.root) cleanup(null);
  });

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      overlay.video.srcObject = stream;
      await overlay.video.play();
      overlay.status.textContent = "QR コードを枠内に映してください";
      tick();
    } catch (err) {
      overlay.status.textContent = "カメラを起動できませんでした: " + (err && err.message ? err.message : err);
      overlay.status.classList.add("scanErr");
    }
  })();

  function tick() {
    if (cleaned) return;
    const { video, canvas } = overlay;
    if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      let imageData;
      try {
        imageData = ctx.getImageData(0, 0, w, h);
      } catch (_) {
        // canvas tainted などのケース。続行不可なので少し待って再試行。
        rafId = requestAnimationFrame(tick);
        return;
      }
      const found = jsQR(imageData.data, w, h, { inversionAttempts: "dontInvert" });
      if (found && found.data) {
        cleanup(found.data);
        return;
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  activeSession = { promise };
  return promise;
}

function buildOverlay() {
  const root = document.createElement("div");
  root.className = "qrScanOverlay";

  const panel = document.createElement("div");
  panel.className = "qrScanPanel";

  const head = document.createElement("div");
  head.className = "qrScanHead";
  head.textContent = "QR スキャン";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "iconBtn";
  cancelBtn.setAttribute("aria-label", "閉じる");
  cancelBtn.title = "閉じる";
  cancelBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  head.appendChild(cancelBtn);

  const videoWrap = document.createElement("div");
  videoWrap.className = "qrScanVideoWrap";
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.muted = true;
  video.autoplay = true;
  videoWrap.appendChild(video);

  const reticle = document.createElement("div");
  reticle.className = "qrScanReticle";
  videoWrap.appendChild(reticle);

  const canvas = document.createElement("canvas");
  canvas.style.display = "none";

  const status = document.createElement("div");
  status.className = "qrScanStatus";
  status.textContent = "カメラを起動中...";

  panel.appendChild(head);
  panel.appendChild(videoWrap);
  panel.appendChild(canvas);
  panel.appendChild(status);
  root.appendChild(panel);

  return { root, panel, video, canvas, status, cancelBtn };
}
