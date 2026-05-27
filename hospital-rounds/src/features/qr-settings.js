"use strict";

import { settings, setSettings, saveSettings } from "../store.js";
import { createQrFlow } from "./qr-flow.js";
import { t } from "../i18n.js";

// ============================
// 設定 QR
//
// wire format v3 (v7.1.1+): bytes 削減のため、formats / items は短キーで
// シリアライズする。clearTargets 等の小さい構造はそのまま (既に短い)。
//
// 形式:
//   {
//     "v": 3,
//     "f": [   // formats (短縮: name=n, panel=p, joiner=j, labelSep=ls, tags=t,
//              //                pinned=pn, isDefault=d, items=i;
//              //          item: label=l, kind=k, unit=u, normal=nm)
//       {"n":"バイタル","p":"O","j":", ","ls":" ","pn":1,
//        "i":[{"l":"BP","k":"fraction","u":"mmHg"},{"l":"P","k":"number","u":"bpm"},...]},
//       ...
//     ],
//     "ct": {"memo":false,"s":true,...},  // clearTargets
//     "tg": ["内科","外科"],               // tags (省略時は無し)
//     "tge": 1,                            // tagGroupingEnabled (省略時は false)
//     "tgs": [{"id":"abc","name":"診療科","mode":"single"}],  // tagGroups (省略時は無し)
//     "tga": {"内科":"abc"}                // tagGroupAssign (省略時は無し)
//   }
//
// デフォルト値 (空配列 / false 等) は省略してさらに圧縮。
// id は wire に載せない (受信側で新発番)。
// 端末固有値 (deviceId) も載せない。
// ============================

const WIRE_V = 3;

function formatToWire(f) {
  const o = { n: String(f.name || ""), p: String(f.panel || "O") };
  if (typeof f.joiner === "string") o.j = f.joiner;
  if (typeof f.labelSep === "string") o.ls = f.labelSep;
  if (Array.isArray(f.tags) && f.tags.length) o.t = f.tags.slice();
  if (f.pinned) o.pn = 1;
  if (f.isDefault) o.d = 1;
  o.i = (Array.isArray(f.items) ? f.items : []).map(itemToWire);
  return o;
}
function itemToWire(it) {
  const o = { l: String(it?.label ?? "") };
  if (typeof it?.kind === "string") o.k = it.kind;
  if (typeof it?.unit === "string" && it.unit) o.u = it.unit;
  if (typeof it?.normal === "string" && it.normal) o.nm = it.normal;
  return o;
}
function wireToFormat(w) {
  return {
    name: String(w?.n || ""),
    panel: String(w?.p || "O"),
    joiner: typeof w?.j === "string" ? w.j : ", ",
    labelSep: typeof w?.ls === "string" ? w.ls : " ",
    tags: Array.isArray(w?.t) ? w.t.slice() : [],
    pinned: !!w?.pn,
    isDefault: !!w?.d,
    items: (Array.isArray(w?.i) ? w.i : []).map(wireToItem),
  };
}
function wireToItem(w) {
  const o = { label: String(w?.l || "") };
  if (typeof w?.k === "string") o.kind = w.k;
  if (typeof w?.u === "string") o.unit = w.u;
  if (typeof w?.nm === "string") o.normal = w.nm;
  return o;
}

function encodePayload() {
  const out = { v: WIRE_V };
  if (Array.isArray(settings.formats) && settings.formats.length) {
    out.f = settings.formats.map(formatToWire);
  }
  if (settings.clearTargets && typeof settings.clearTargets === "object") {
    out.ct = settings.clearTargets;
  }
  if (Array.isArray(settings.tags) && settings.tags.length) {
    out.tg = settings.tags.slice();
  }
  if (settings.tagGroupingEnabled) out.tge = 1;
  if (Array.isArray(settings.tagGroups) && settings.tagGroups.length) {
    out.tgs = settings.tagGroups.map(g => ({
      id: String(g.id || ""),
      name: String(g.name || ""),
      mode: g.mode === "single" ? "single" : "multi",
    }));
  }
  if (settings.tagGroupAssign && typeof settings.tagGroupAssign === "object" && Object.keys(settings.tagGroupAssign).length) {
    out.tga = settings.tagGroupAssign;
  }
  return JSON.stringify(out);
}

function decodePayload(payload) {
  const obj = JSON.parse(String(payload || ""));
  if (!obj || typeof obj !== "object") throw new Error(t("qrSettings.invalid"));
  if (obj.v !== WIRE_V) throw new Error(t("qrSettings.versionMismatch", { a: obj.v, b: WIRE_V }));

  const out = {};
  if (Array.isArray(obj.f)) out.formats = obj.f.map(wireToFormat);
  if (obj.ct && typeof obj.ct === "object") {
    out.clearTargets = {};
    for (const [k, v] of Object.entries(obj.ct)) {
      if (typeof v === "boolean") out.clearTargets[k] = v;
    }
  }
  if (Array.isArray(obj.tg)) out.tags = obj.tg.filter(x => typeof x === "string");
  out.tagGroupingEnabled = !!obj.tge;
  if (Array.isArray(obj.tgs)) {
    out.tagGroups = obj.tgs.map(g => ({
      id: String(g?.id || ""),
      name: String(g?.name || ""),
      mode: g?.mode === "single" ? "single" : "multi",
    }));
  }
  if (obj.tga && typeof obj.tga === "object") {
    out.tagGroupAssign = {};
    for (const [k, v] of Object.entries(obj.tga)) {
      if (typeof k === "string" && typeof v === "string") out.tagGroupAssign[k] = v;
    }
  }
  return out;
}

let onAppliedHandler = null;
export function setOnSettingsApplied(fn) { onAppliedHandler = fn; }

const APPLIED_FIELDS = ["formats", "clearTargets", "tags", "tagGroups", "tagGroupingEnabled", "tagGroupAssign"];

function applySettings(safe, ctrl) {
  if (!safe) {
    alert(t("qrSettings.parse.failed"));
    return;
  }
  const summary = [];
  if (Array.isArray(safe.tags)) summary.push(t("qrSettings.summary.tags", { n: safe.tags.length }));
  if (Array.isArray(safe.formats)) summary.push(t("qrSettings.summary.formats", { n: safe.formats.length }));
  if (safe.clearTargets) summary.push(t("qrSettings.summary.clearTargets"));
  if (Array.isArray(safe.tagGroups)) summary.push(t("qrSettings.summary.tagGroups", { n: safe.tagGroups.length }));
  const summaryText = summary.length ? `（${summary.join(", ")}）` : "";

  const ok = confirm(t("qrSettings.import.confirm", { summary: summaryText }));
  if (!ok) return;

  const next = { ...settings };
  for (const k of APPLIED_FIELDS) {
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
  kindLabel: t("qr.kind.settings"),
  emptyMessage: t("qr.empty.noSettings"),
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
  shouldEncrypt: () => !!settings.qrEncryption?.ST,
  // 設定 QR は一括書き出しの 1 ショット用途。HM/MM のように頻繁ではないので
  // 1 QR にできるだけ収まる密度に。QR ver ~26 (~117 modules) で iPad camera で
  // 十分読める範囲。デフォルト (= 800B) の 1.4 倍。
  maxBytes: 1100,
});

export const initSettingsQr = () => flow.init();
export const isSettingsQrActive = () => flow.isActive();
export const refreshSettingsQrIfActive = () => flow.refresh();
