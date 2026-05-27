"use strict";

// ============================
// フォーマット 1 つだけを QR で共有
//
// 送信: フォーマット編集モーダルの「QR 共有」ボタン → このモジュールの
//        setFormatToShare(format) → openQrFormatOverlay() → QR を表示
// 受信: 同じオーバーレイのスキャンボタンから読み取り → applyFormat
//
// 受信ポリシー (case-by-case で前回ご相談時に合意):
//   - ID: 常に新発番 (修正版の上書きを避ける)
//   - 同名: 末尾に "(2)", "(3)"... と自動付与で常に追加成功
//   - tags: 受信側に未登録のタグは無視 (タグ辞書を勝手に増やさない)
//
// 移植性のため、store への直接書き込みは行わず、`setFormatStoreAdapter`
// で渡された adapter を経由する。これにより qr-format.js は store の構造を
// 知らずに動く (他アプリへの移植や Preact 化時の差し替えが容易)。
// ============================

import { FORMAT_PANELS, FORMAT_ITEM_KINDS, DEFAULT_ITEM_KIND, DEFAULT_LABEL_SEP_TEXT, DEFAULT_LABEL_SEP_OTHER } from "../constants.js";
import { createQrFlow } from "./qr-flow.js";
import { t } from "../i18n.js";

const WIRE_V = 1;

// 共有対象。null なら encodePayload が空ペイロードを返す (= 何も表示しない)
let _formatToShare = null;
export function setFormatToShare(format) { _formatToShare = format || null; }

// store adapter: 受信フォーマット適用時の read/write を外から注入する。
//   getExistingFormats(): 現存フォーマット配列 (read-only) を返す。同名チェックに使う
//   getKnownTags():        登録済タグ名の配列。未登録タグの除外に使う
//   addFormat(newFmt):     新フォーマットを永続化する。store / IDB への書き込みは
//                          adapter の責務 (本モジュールは触らない)
// adapter 未注入時は no-op フォールバック (テスト時 / 移植先未配線時の安全装置)
let _adapter = {
  getExistingFormats: () => [],
  getKnownTags: () => [],
  addFormat: () => { console.warn("[qr-format] addFormat called without adapter"); },
};
export function setFormatStoreAdapter(adapter) {
  _adapter = { ..._adapter, ...(adapter || {}) };
}

function newFmtId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return "fmt_" + crypto.randomUUID();
  return "fmt_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function encodePayload() {
  if (!_formatToShare) return "";
  // ID は送信に含めない (受信側で新発番)。本質的なフィールドだけ載せる
  const f = _formatToShare;
  const slim = {
    v: WIRE_V,
    name: String(f.name || ""),
    panel: FORMAT_PANELS.includes(f.panel) ? f.panel : "O",
    joiner: typeof f.joiner === "string" ? f.joiner : ", ",
    labelSep: typeof f.labelSep === "string" ? f.labelSep : DEFAULT_LABEL_SEP_OTHER,
    tags: Array.isArray(f.tags) ? f.tags.filter(t => typeof t === "string") : [],
    pinned: !!f.pinned,
    isDefault: !!f.isDefault,
    items: (Array.isArray(f.items) ? f.items : []).map(it => {
      const kind = FORMAT_ITEM_KINDS.includes(it?.kind) ? it.kind : DEFAULT_ITEM_KIND;
      const o = { label: String(it?.label ?? ""), kind };
      if (kind === "number" || kind === "fraction") o.unit = String(it?.unit ?? "");
      else o.normal = String(it?.normal ?? "");
      return o;
    }),
  };
  return JSON.stringify(slim);
}

function decodePayload(payload) {
  const obj = JSON.parse(String(payload || ""));
  if (!obj || typeof obj !== "object") throw new Error(t("qrFormat.invalid"));
  if (obj.v !== WIRE_V) throw new Error(t("qrFormat.versionMismatch", { a: obj.v, b: WIRE_V }));
  if (!obj.name || typeof obj.name !== "string") throw new Error(t("qrFormat.noName"));
  return obj;
}

// 受信したフォーマットを適用 (常に新規追加。ID 新発番、同名は (2)/(3)... に rename、
// 未登録タグは無視)。
function applyReceivedFormat(safe, ctrl) {
  if (!safe) {
    alert(t("qrFormat.parse.failed"));
    return;
  }
  const all = _adapter.getExistingFormats() || [];

  // 同名 → 自動 rename
  const baseName = String(safe.name || t("qrFormat.untitled")).trim();
  let finalName = baseName;
  if (all.some(f => f.name === finalName)) {
    for (let n = 2; n < 1000; n++) {
      const candidate = `${baseName} (${n})`;
      if (!all.some(f => f.name === candidate)) { finalName = candidate; break; }
    }
  }

  // 未登録タグを除外
  const knownTags = new Set(_adapter.getKnownTags() || []);
  const safeTags = (Array.isArray(safe.tags) ? safe.tags : []).filter(t => knownTags.has(t));
  const droppedTags = (Array.isArray(safe.tags) ? safe.tags : []).filter(t => !knownTags.has(t));

  const summaryParts = [
    t("qrFormat.summary.panel", { panel: safe.panel || "O" }),
    t("qrFormat.summary.items", { n: (safe.items || []).length }),
  ];
  if (safeTags.length) summaryParts.push(t("qrFormat.summary.tags", { n: safeTags.length }));
  if (droppedTags.length) summaryParts.push(t("qrFormat.summary.droppedTags", { n: droppedTags.length }));
  const summary = `（${summaryParts.join(", ")}）`;

  if (!confirm(t("qrFormat.import.confirm", { name: finalName, summary }))) return;

  // 構築
  const newFmt = {
    id: newFmtId(),
    name: finalName,
    panel: safe.panel,
    joiner: safe.joiner,
    labelSep: safe.labelSep || (
      Array.isArray(safe.items) && safe.items.every(it => it && it.kind === "text")
        ? DEFAULT_LABEL_SEP_TEXT : DEFAULT_LABEL_SEP_OTHER
    ),
    tags: safeTags,
    pinned: !!safe.pinned,
    // isDefault は受信時は無効化 (元端末の運用にすぎない。受信側で勝手に既定文に
    // すり替わると混乱するため。必要なら受信後に手動でチェック)
    isDefault: false,
    items: (Array.isArray(safe.items) ? safe.items : []).map(it => {
      const kind = FORMAT_ITEM_KINDS.includes(it?.kind) ? it.kind : DEFAULT_ITEM_KIND;
      const out = { label: String(it?.label ?? ""), kind };
      if (kind === "number" || kind === "fraction") out.unit = String(it?.unit ?? "");
      else out.normal = String(it?.normal ?? "");
      return out;
    }),
  };

  // 保存は adapter に委譲。store の実態を qr-format.js は知らない
  _adapter.addFormat(newFmt);
  ctrl.close();
  if (_onAppliedHandler) _onAppliedHandler(newFmt);
  alert(t("qrFormat.imported.alert", { name: finalName }));
}

let _onAppliedHandler = null;
export function setOnFormatApplied(fn) { _onAppliedHandler = fn; }

const flow = createQrFlow({
  kind: "FMT",
  kindLabel: t("qr.kind.format"),
  emptyMessage: t("qrFormat.empty"),
  ids: {
    wrapId: "qrFormatWrap",
    canvasId: "qrFormatCanvas",
    pageMetaId: "qrFormatPageMeta",
    prevBtnId: "qrFormatPrevBtn",
    nextBtnId: "qrFormatNextBtn",
    showBtnId: "qrFormatShowBtn",
    scanBtnId: "qrFormatScanBtn",
  },
  encodePayload,
  decodePayload,
  onApply: applyReceivedFormat,
});

export const initQrFormat = () => flow.init();
export const isQrFormatActive = () => flow.isActive();
export const refreshQrFormatIfActive = () => flow.refresh();

// オーバーレイの open / close (overlay 自体は HTML 側で popupMenuOverlay として用意)
export function openQrFormatOverlay(format) {
  setFormatToShare(format);
  const overlay = document.getElementById("qrFormatOverlay");
  if (overlay) overlay.classList.add("active");
  // QR card 自体を「show」状態にして強制的に描画する
  flow.open();
}

export function closeQrFormatOverlay() {
  const overlay = document.getElementById("qrFormatOverlay");
  if (overlay) overlay.classList.remove("active");
  flow.close();
  setFormatToShare(null);
}
