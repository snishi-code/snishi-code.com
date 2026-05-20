"use strict";

import { showView } from "./navigation.js";

// ============================
// 印刷フロー共通ファクトリ
//
// 各印刷ターゲット（一覧 / メモ / 共有 / 設定…）を cfg で受け取り、
// 「準備 → 対象ビューに切替 → window.print() → 復元 → 元ビューに戻す」を
// 1 つにまとめた print() を返す。createQrFlow と同じ思想で、呼び出し側は
// flow.print() を叩くだけ。新しい印刷対象を足したい場合は createPrintFlow
// のインスタンスを増やしてハンバーガーやボタンに紐付けるだけで済む。
//
// CSS の @media print は .view.active のビューしか印刷しない仕様なので、
// 印刷直前に対象ビューを必ず active にする。終わったら元のビューに戻す。
// 一時的な切替には pushState=false を渡してブラウザ履歴を汚さない。
// ============================

export function createPrintFlow(cfg) {
  function print() {
    const activeViewEl = document.querySelector(".view.active");
    const prevView = activeViewEl ? activeViewEl.id.replace(/View$/, "") : null;

    if (cfg.prepare) cfg.prepare();
    if (cfg.viewName && cfg.viewName !== prevView) {
      showView(cfg.viewName, false);
    }

    requestAnimationFrame(() => window.print());

    const onAfter = () => {
      window.removeEventListener("afterprint", onAfter);
      if (cfg.restore) cfg.restore();
      if (prevView && cfg.viewName && cfg.viewName !== prevView) {
        showView(prevView, false);
      }
    };
    window.addEventListener("afterprint", onAfter);
  }

  return { print };
}
