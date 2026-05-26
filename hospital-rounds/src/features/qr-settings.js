"use strict";

import { settings, setSettings, saveSettings } from "../store.js";
import { createQrFlow } from "./qr-flow.js";
import { t } from "../i18n.js";

// ============================
// 設定QR
//
// JSON + 短縮キー方式。トップレベルは in-memory と同名（可読性優先）、繰り返し
// 多い oRules / tagGroups の中だけ短縮キーで bytes 節約。位置依存配列や
// スキーマ宣言（ks）は使わず key-based に統一しているので、フィールドの
// 追加・削除・順序変更すべてに耐性がある。
//
// 形式:
//   {
//     "v": 2,
//     "defaults":     {"s":"","a":"著変なし","p":"現行加療継続"},
//     "oRules":       [{"k":"general","l":"General","n":"良好","a":1?}],
//     "clearTargets": {"memo":false,"s":true,...},
//     "tags":         ["内科","外科"],
//     "tagGroupingEnabled": false,
//     "tagGroups":    [{"id":"abc","name":"診療科","mode":"single"}],
//     "tagGroupAssign": {"内科":"abc"}
//   }
//
//   - oRules: k/l/n = key/label/normalText（多数繰り返すので短縮）。
//     a (fromAdmin) は真の時だけ 1 を載せる
//   - clearTargets: ビットフィールドではなく key-based の object
//     （フィールド追加に強い）
//   - tagGroups: id/name/mode は in-memory 同名（数が少ないので短縮メリット薄い）
//
// 管理機能 (adminEnabled, adminTerminal, rosterPassphrase) と端末固有値
// (deviceId) は載せない。受信側でも上書きされない。
// ============================

const WIRE_V = 2;
const SAFE_FIELDS = [
  "defaults",
  "formats",
  "clearTargets",
  "tags",
  "tagGroups",
  "tagGroupingEnabled",
  "tagGroupAssign",
];

function buildSafeSettings() {
  const out = {};
  for (const k of SAFE_FIELDS) {
    if (settings[k] !== undefined) out[k] = settings[k];
  }
  return out;
}

function encodePayload() {
  const s = buildSafeSettings();
  const out = { v: WIRE_V };
  if (s.defaults) out.defaults = s.defaults;
  if (Array.isArray(s.formats)) out.formats = s.formats;
  if (s.clearTargets) out.clearTargets = s.clearTargets;
  if (Array.isArray(s.tags)) out.tags = s.tags;
  if (typeof s.tagGroupingEnabled === "boolean") out.tagGroupingEnabled = s.tagGroupingEnabled;
  if (Array.isArray(s.tagGroups)) {
    out.tagGroups = s.tagGroups.map(g => ({
      id: String(g.id || ""),
      name: String(g.name || ""),
      mode: g.mode === "single" ? "single" : "multi",
    }));
  }
  if (s.tagGroupAssign && Object.keys(s.tagGroupAssign).length) {
    out.tagGroupAssign = s.tagGroupAssign;
  }
  return JSON.stringify(out);
}

function decodePayload(payload) {
  const obj = JSON.parse(String(payload || ""));
  if (!obj || typeof obj !== "object") throw new Error("不正な設定形式");
  if (obj.v !== WIRE_V) throw new Error(`バージョン不一致 (wire=${obj.v}, expected=${WIRE_V})`);

  const out = {};
  if (obj.defaults && typeof obj.defaults === "object") {
    out.defaults = {
      s: String(obj.defaults.s || ""),
      a: String(obj.defaults.a || ""),
      p: String(obj.defaults.p || ""),
    };
  }
  if (Array.isArray(obj.formats)) {
    out.formats = obj.formats;
  }
  if (obj.clearTargets && typeof obj.clearTargets === "object") {
    out.clearTargets = {};
    for (const [k, v] of Object.entries(obj.clearTargets)) {
      if (typeof v === "boolean") out.clearTargets[k] = v;
    }
  }
  if (Array.isArray(obj.tags)) out.tags = obj.tags.filter(x => typeof x === "string");
  if (typeof obj.tagGroupingEnabled === "boolean") out.tagGroupingEnabled = obj.tagGroupingEnabled;
  if (Array.isArray(obj.tagGroups)) {
    out.tagGroups = obj.tagGroups.map(g => ({
      id: String(g?.id || ""),
      name: String(g?.name || ""),
      mode: g?.mode === "single" ? "single" : "multi",
    }));
  }
  if (obj.tagGroupAssign && typeof obj.tagGroupAssign === "object") {
    out.tagGroupAssign = {};
    for (const [k, v] of Object.entries(obj.tagGroupAssign)) {
      if (typeof k === "string" && typeof v === "string") out.tagGroupAssign[k] = v;
    }
  }
  return out;
}

let onAppliedHandler = null;
export function setOnSettingsApplied(fn) { onAppliedHandler = fn; }

function applySettings(safe, ctrl) {
  if (!safe) {
    alert(t("qrSettings.parse.failed"));
    return;
  }
  const summary = [];
  if (Array.isArray(safe.tags)) summary.push(t("qrSettings.summary.tags", { n: safe.tags.length }));
  if (Array.isArray(safe.formats)) summary.push(t("qrSettings.summary.formats", { n: safe.formats.length }));
  if (safe.defaults) summary.push(t("qrSettings.summary.defaults"));
  if (safe.clearTargets) summary.push(t("qrSettings.summary.clearTargets"));
  if (Array.isArray(safe.tagGroups)) summary.push(t("qrSettings.summary.tagGroups", { n: safe.tagGroups.length }));
  const summaryText = summary.length ? `（${summary.join(", ")}）` : "";

  const ok = confirm(t("qrSettings.import.confirm", { summary: summaryText }));
  if (!ok) return;

  const next = { ...settings };
  for (const k of SAFE_FIELDS) {
    if (safe[k] !== undefined) next[k] = safe[k];
  }
  setSettings(next);
  saveSettings();
  ctrl.close();
  if (onAppliedHandler) onAppliedHandler();
  alert(t("qrSettings.imported.alert"));
}

const flow = createQrFlow({
  kind: "ST",
  kindLabel: "設定QR",
  emptyMessage: "（設定が空です）",
  ids: {
    wrapId: "settingsQrWrap",
    canvasId: "settingsQrCanvas",
    pageMetaId: "settingsQrPageMeta",
    prevBtnId: "settingsQrPrevBtn",
    nextBtnId: "settingsQrNextBtn",
    showBtnId: "settingsShowQrBtn",
    scanBtnId: "settingsQrScanBtn",
  },
  encodePayload,
  decodePayload,
  onApply: applySettings,
});

export const initSettingsQr = () => flow.init();
export const isSettingsQrActive = () => flow.isActive();
export const refreshSettingsQrIfActive = () => flow.refresh();
