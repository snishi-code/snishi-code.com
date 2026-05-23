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

function buildOOutput(p) {
  // v2: O 欄は oFree (自由記述) のみ。バイタル/構造化所見はフォーマットで挿入された
  // テキストとしてここに含まれる
  return multiLineText(p?.oFree ?? "");
}

function buildAOutput(p) {
  const t = multiLineText(p.a.text);
  const def = multiLineText(settings?.defaults?.a ?? "著変なし");
  return t.trim() ? t : def;
}

function buildPOutput(p) {
  const t = multiLineText(p.p.text);
  const def = multiLineText(settings?.defaults?.p ?? "現行加療継続");
  return t.trim() ? t : def;
}

export function buildSoapParts(no) {
  const p = appState.patients[no - 1];
  const sTyped = multiLineText(p.s);
  const sDef = multiLineText(settings?.defaults?.s ?? "");
  const sOut = sTyped.trim() ? sTyped : sDef;
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
