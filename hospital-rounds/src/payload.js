"use strict";

import { appState, settings } from "./store.js";
import { resolveActiveGroup } from "./features/format-groups.js";

export function oneLineText(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " / ")
    .replace(/\t+/g, " ")
    .trim();
}

export function multiLineText(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function utf8ByteLength(text) {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(String(text ?? "")).length;
  }
  return unescape(encodeURIComponent(String(text ?? ""))).length;
}

// 実効グループが対象パネルに指定した「規定文」フォーマットの中身を text として描画する。
// 空欄パネルの fallback テキスト生成。グループの defaultFormatIds (パネル毎最大1) を参照し、
// 未指定なら空文字を返す。描画対象は normal を持つ kind (text / date)。number / fraction は
// 値が無い状態では意味のある fallback にならないのでスキップする。
function renderDefaultForPanel(panel, group) {
  if (!group) return "";
  const fmts = (settings && Array.isArray(settings.formats)) ? settings.formats : [];
  const defIds = Array.isArray(group.defaultFormatIds) ? group.defaultFormatIds : [];
  const def = fmts.find(f => f.panel === panel && defIds.includes(f.id));
  if (!def) return "";
  const labelSep = typeof def.labelSep === "string" ? def.labelSep : "：";
  const parts = [];
  for (const item of (def.items || [])) {
    const kind = item.kind || "text";
    if (kind !== "text" && kind !== "date") continue;
    const label = String(item.label ?? "").trim();
    const normal = String(item.normal ?? "").trim();
    if (!normal) continue;
    parts.push(label ? `${label}${labelSep}${normal}` : normal);
  }
  return parts.join(def.joiner || ", ");
}

function buildOOutput(p, group) {
  // v2: O 欄は oFree (自由記述) のみ。バイタル/構造化所見はフォーマットで挿入された
  // テキストとしてここに含まれる
  const t = multiLineText(p?.oFree ?? "");
  return t.trim() ? t : renderDefaultForPanel("O", group);
}

function buildAOutput(p, group) {
  const t = multiLineText(p.a.text);
  return t.trim() ? t : renderDefaultForPanel("A", group);
}

function buildPOutput(p, group) {
  const t = multiLineText(p.p.text);
  return t.trim() ? t : renderDefaultForPanel("P", group);
}

export function buildSoapParts(no) {
  const p = appState.patients[no - 1];
  // 規定文は患者の実効グループ (active 指定 or デフォルト) が指定したものを使う
  const group = resolveActiveGroup(p);
  const sTyped = multiLineText(p.s);
  const sOut = sTyped.trim() ? sTyped : renderDefaultForPanel("S", group);
  const oOut = buildOOutput(p, group);
  const aOut = buildAOutput(p, group);
  const pOut = buildPOutput(p, group);
  return { sOut, oOut, aOut, pOut };
}

export function buildTabPayload(no) {
  const p = appState.patients[no - 1];
  const { sOut, oOut, aOut, pOut } = buildSoapParts(no);
  const memo = String(p?.memo ?? "").trim();

  const parts = [];
  if (memo) {
    parts.push(memo);
    parts.push("――");
  }
  parts.push("(S)");
  parts.push(sOut);
  parts.push("――");
  parts.push("(O)");
  parts.push(oOut);
  parts.push("――");
  parts.push("(A)");
  parts.push(aOut);
  parts.push("――");
  parts.push("(P)");
  parts.push(pOut);
  return parts.join("\n");
}
