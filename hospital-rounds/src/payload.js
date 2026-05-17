"use strict";

import { appState, settings, oRuleMap } from "./store.js";

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

function buildOItem(rule, item) {
  if (!rule) return "";
  const note = oneLineText(item?.note ?? "");
  if (note) return rule.label + "：" + note;
  const normal = !!item?.normal;
  if (normal) return rule.label + "：" + rule.normalText;
  return "";
}

function buildOOutput(p) {
  const v = p.vitals || {};
  const hasSpo2 = v.spo2 !== undefined && v.spo2 !== "";
  const hasRr = v.rr !== undefined && v.rr !== "";
  const hasBpSys = v.bp_sys !== undefined && v.bp_sys !== "";
  const hasBpDia = v.bp_dia !== undefined && v.bp_dia !== "";
  const hasPr = v.pr !== undefined && v.pr !== "";
  const hasBt = v.bt !== undefined && v.bt !== "";

  const vParts = [];
  if (hasSpo2) {
    let s = `SpO2 ${v.spo2}%`;
    if (v.spo2_memo) s += ` (${v.spo2_memo})`;
    vParts.push(s);
  } else if (v.spo2_memo) {
    vParts.push(`SpO2 ${v.spo2_memo}`);
  }
  if (hasRr) vParts.push(`RR ${v.rr}`);
  if (hasBpSys || hasBpDia) vParts.push(`BP ${v.bp_sys || ""}/${v.bp_dia || ""}mmHg`);
  if (hasPr) vParts.push(`P ${v.pr}`);
  if (hasBt) vParts.push(`BT ${v.bt}℃`);

  const parts = [];
  if (vParts.length > 0) {
    parts.push(vParts.join(", "));
  } else {
    parts.push("Vital 安定");
  }

  const map = oRuleMap();
  for (const r of settings.oRules) {
    const item = p?.o ? p.o[r.key] : null;
    const rule = map[r.key];
    const s = buildOItem(rule, item);
    if (s) parts.push(s);
  }
  const base = parts.join("\n");
  const free = multiLineText(p?.oFree ?? "");
  if (!free.trim()) return base;
  if (!base.trim()) return free;
  return base + "\n" + free;
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
