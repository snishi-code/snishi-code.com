"use strict";

import { appState, settings } from "./store.js";

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

// 各パネルの isDefault フォーマット (1 個) の中身を text として描画する。
// 旧 settings.defaults.{s,a,p} の役割を引き継ぐ fallback テキスト生成。
// 対象は text 型のみ (numeric は normal 値を持たないため)。
function renderDefaultForPanel(panel) {
  const fmts = (settings && Array.isArray(settings.formats)) ? settings.formats : [];
  const def = fmts.find(f => f.panel === panel && f.isDefault && f.type === "text");
  if (!def) return "";
  const parts = [];
  for (const item of (def.items || [])) {
    const label = String(item.label ?? "").trim();
    const normal = String(item.normal ?? "").trim();
    if (!normal) continue;
    parts.push(label ? `${label}：${normal}` : normal);
  }
  return parts.join(def.joiner || ", ");
}

function buildOOutput(p) {
  // v2: O 欄は oFree (自由記述) のみ。バイタル/構造化所見はフォーマットで挿入された
  // テキストとしてここに含まれる
  const t = multiLineText(p?.oFree ?? "");
  return t.trim() ? t : renderDefaultForPanel("O");
}

function buildAOutput(p) {
  const t = multiLineText(p.a.text);
  return t.trim() ? t : renderDefaultForPanel("A");
}

function buildPOutput(p) {
  const t = multiLineText(p.p.text);
  return t.trim() ? t : renderDefaultForPanel("P");
}

export function buildSoapParts(no) {
  const p = appState.patients[no - 1];
  const sTyped = multiLineText(p.s);
  const sOut = sTyped.trim() ? sTyped : renderDefaultForPanel("S");
  const oOut = buildOOutput(p);
  const aOut = buildAOutput(p);
  const pOut = buildPOutput(p);
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
