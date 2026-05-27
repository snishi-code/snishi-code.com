"use strict";

// ============================
// ヘッダー右の ☰ ハンバーガーメニュー
//
// ☰ をタップ → メニューオーバーレイを開閉。各アイコン (設定 / データ管理 等)
// は HTML に常駐していて、それぞれの handler が click 時にこの module の
// `closeHeaderMenu` を呼んでオーバーレイを閉じる。
//
// 公開 API:
//   initHeaderMenu()  ... 初期配線 (起動時 1 回)
//   closeHeaderMenu() ... 他 module (reset / clearAll 等) から閉じたい時用
// ============================

function getOverlay() {
  return document.getElementById("headerMenuOverlay");
}

export function closeHeaderMenu() {
  const overlay = getOverlay();
  if (overlay) overlay.classList.remove("active");
}

export function openHeaderMenu() {
  const overlay = getOverlay();
  if (overlay) overlay.classList.add("active");
}

export function initHeaderMenu() {
  const btn = document.getElementById("headerMenuBtn");
  const overlay = getOverlay();
  if (btn) {
    btn.addEventListener("click", () => {
      if (overlay?.classList.contains("active")) closeHeaderMenu();
      else openHeaderMenu();
    });
  }
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeHeaderMenu();
    });
  }

  // DB アイコンは settingsDbBtn の ID のままハンバーガー内に置いてあり、
  // import-export.js が click を拾って chooser を開く。ここではメニュー close
  // だけ追加する (chooser を開く処理は import-export.js の責務)。
  document.getElementById("settingsDbBtn")?.addEventListener("click", closeHeaderMenu);
}
