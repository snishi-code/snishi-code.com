"use strict";

import { appState, settings, saveSettings, saveNow, ensurePatientsHaveAllOKeys, makeDefaultPatient } from "../store.js";
import { STATUS } from "../constants.js";
import { utf8ByteLength } from "../payload.js";

const MAX_BYTES_PER_PAGE = 750;
const PAGE_HEAD_RE = /==ADMIN\s+(\d+)\/(\d+)==/g;

// ============================
// State helpers
// ============================

export function isAdminEnabled() { return !!settings.adminEnabled; }
export function isAdminTerminal() { return !!settings.adminTerminal; }
export function isNonAdminTerminal() { return isAdminEnabled() && !isAdminTerminal(); }

export function canEditPatientFields() {
  // Returns true if room/tags can be edited, and existing names can be changed
  if (!isAdminEnabled()) return true;
  return isAdminTerminal();
}

export function canFillEmptyName() {
  // On non-admin terminal, only allow filling empty names
  return true; // Always allowed (empty → filled)
}

export function canEditORule(rule) {
  if (!isAdminEnabled() || isAdminTerminal()) return true;
  return !rule?.fromAdmin;
}

export function canDeleteORule(rule) {
  return canEditORule(rule);
}

// ============================
// Encode (admin terminal → QR)
// ============================

function escapeField(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\^/g, "\\^")
    .replace(/\r/g, "")
    .replace(/\n/g, "\\n");
}

function splitByCaret(s) {
  const parts = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      cur += s[i] + s[i + 1];
      i++;
    } else if (s[i] === "^") {
      parts.push(cur);
      cur = "";
    } else {
      cur += s[i];
    }
  }
  parts.push(cur);
  return parts;
}

function unescapeField(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === "n") out += "\n";
      else if (n === "^") out += "^";
      else if (n === "\\") out += "\\";
      else out += n;
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}

function buildAdminLines(includeMemo, includeShared) {
  const lines = [];
  // Defaults
  lines.push(`D^${escapeField(settings.defaults?.s ?? "")}^${escapeField(settings.defaults?.a ?? "")}^${escapeField(settings.defaults?.p ?? "")}`);
  // Tags
  const tags = (settings.tags || []).filter(t => typeof t === "string" && t.trim());
  for (const t of tags) lines.push(`T^${escapeField(t)}`);
  // O rules (admin distributes all current rules)
  for (const r of (settings.oRules || [])) {
    lines.push(`O^${escapeField(r.key)}^${escapeField(r.label)}^${escapeField(r.normalText ?? "")}^${escapeField(r.placeholder ?? "")}`);
  }
  // Patients
  const tagIdx = new Map();
  tags.forEach((t, i) => tagIdx.set(t, i + 1));
  for (let i = 0; i < appState.patients.length; i++) {
    const p = appState.patients[i];
    const name = String(p.name || "").trim();
    const room = String(p.room || "").trim();
    if (!name && !room) continue; // skip empty slots
    const tIdx = (p.tags || []).map(t => tagIdx.get(t)).filter(x => x).join(",");
    const memo = includeMemo ? String(p.memo || "") : "";
    const shared = includeShared ? String(p.shared || "") : "";
    lines.push(`R^${i + 1}^${escapeField(room)}^${escapeField(name)}^${tIdx}^${escapeField(memo)}^${escapeField(shared)}`);
  }
  return lines;
}

export function buildAdminPages(includeMemo, includeShared) {
  const lines = buildAdminLines(includeMemo, includeShared);
  const pages = [];
  let cur = [];
  let curBytes = 0;
  for (const line of lines) {
    const b = utf8ByteLength(line) + 1;
    if (cur.length > 0 && curBytes + b > MAX_BYTES_PER_PAGE) {
      pages.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(line);
    curBytes += b;
  }
  if (cur.length > 0) pages.push(cur);
  const total = pages.length || 1;
  return pages.map((pageLines, idx) =>
    `==ADMIN ${idx + 1}/${total}==\n${pageLines.join("\n")}`
  );
}

// ============================
// Parse (non-admin terminal: paste → object)
// ============================

export function parseAdminText(text) {
  const src = String(text || "");
  PAGE_HEAD_RE.lastIndex = 0;
  const markers = [];
  let m;
  while ((m = PAGE_HEAD_RE.exec(src)) !== null) {
    markers.push({
      start: m.index,
      end: m.index + m[0].length,
      page: parseInt(m[1], 10),
      total: parseInt(m[2], 10),
    });
  }
  if (markers.length === 0) return { ok: false, error: "管理QRが見つかりません" };

  // Use the largest reported total
  const total = markers.reduce((acc, x) => Math.max(acc, x.total), 0);
  const pageMap = new Map();
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].end;
    const end = i + 1 < markers.length ? markers[i + 1].start : src.length;
    pageMap.set(markers[i].page, src.slice(start, end));
  }

  const missing = [];
  for (let p = 1; p <= total; p++) if (!pageMap.has(p)) missing.push(p);
  if (missing.length > 0) {
    return { ok: false, error: `ページが不足: ${missing.join(", ")} / ${total}`, missing };
  }

  let combined = "";
  for (let p = 1; p <= total; p++) combined += pageMap.get(p) + "\n";

  const result = {
    defaults: { s: "", a: "", p: "" },
    hasDefaults: false,
    tags: [],
    oRules: [],
    patients: [], // { slot, room, name, tagIndices, memo, shared }
  };

  const lines = combined.split(/\r?\n/);
  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    if (/^==ADMIN/.test(rawLine)) continue; // safety
    const parts = splitByCaret(rawLine).map(unescapeField);
    const kind = parts[0];
    if (kind === "D") {
      result.defaults.s = parts[1] || "";
      result.defaults.a = parts[2] || "";
      result.defaults.p = parts[3] || "";
      result.hasDefaults = true;
    } else if (kind === "T") {
      result.tags.push(parts[1] || "");
    } else if (kind === "O") {
      result.oRules.push({
        key: parts[1] || "",
        label: parts[2] || "",
        normalText: parts[3] || "",
        placeholder: parts[4] || "",
      });
    } else if (kind === "R") {
      const slot = parseInt(parts[1], 10);
      const tagIndices = parts[4]
        ? parts[4].split(",").map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n))
        : [];
      result.patients.push({
        slot: isNaN(slot) ? null : slot,
        room: parts[2] || "",
        name: parts[3] || "",
        tagIndices,
        memo: parts[5] || "",
        shared: parts[6] || "",
      });
    }
  }
  return { ok: true, data: result };
}

// ============================
// Apply (non-admin imports admin data)
// ============================

function patientIsEmpty(p) {
  if (!p) return true;
  if ((p.name && p.name.trim()) || (p.room && p.room.trim())) return false;
  if (Array.isArray(p.tags) && p.tags.length) return false;
  if (p.memo && p.memo.trim()) return false;
  if (p.shared && p.shared.trim()) return false;
  if (p.s && p.s.trim()) return false;
  if (p.oFree && p.oFree.trim()) return false;
  if (p.a && p.a.text && p.a.text.trim()) return false;
  if (p.p && p.p.text && p.p.text.trim()) return false;
  if (p.vitals) {
    for (const v of Object.values(p.vitals)) if (v && String(v).trim()) return false;
  }
  if (p.o) {
    for (const k of Object.keys(p.o)) {
      const it = p.o[k];
      if (it && (it.normal || (it.note && it.note.trim()))) return false;
    }
  }
  return true;
}

function appendText(currVal, impVal, namePrefix) {
  const c = String(currVal ?? "").trim();
  const i = String(impVal ?? "").trim();
  if (!i) return c;
  if (c === i) return c;
  const head = `（${namePrefix}追記されました）\n`;
  if (c) return c + "\n\n" + head + i;
  return head + i;
}

export function applyAdminImport(parsed) {
  // Update settings: tags replaced, O rules merged
  settings.tags = parsed.tags.slice();
  if (parsed.hasDefaults) {
    settings.defaults.s = parsed.defaults.s;
    settings.defaults.a = parsed.defaults.a;
    settings.defaults.p = parsed.defaults.p;
  }
  const importedKeys = new Set(parsed.oRules.map(r => r.key));
  const local = (settings.oRules || []).filter(r => !r.fromAdmin && !importedKeys.has(r.key));
  const imported = parsed.oRules.map(r => ({ ...r, fromAdmin: true }));
  settings.oRules = [...imported, ...local];
  saveSettings();
  ensurePatientsHaveAllOKeys();

  // Build tag-name map from imported tags
  const tagNameAt = (idx) => parsed.tags[idx - 1] || "";

  const now = Date.now();
  for (const imp of parsed.patients) {
    if (!imp.slot || imp.slot < 1) continue;
    const i = imp.slot - 1;
    while (appState.patients.length <= i) {
      appState.patients.push(makeDefaultPatient());
    }
    const cur = appState.patients[i];
    const impTags = imp.tagIndices.map(tagNameAt).filter(Boolean);
    const sameName = (cur.name || "") === imp.name;
    const sameRoom = (cur.room || "") === imp.room;
    const curTags = Array.isArray(cur.tags) ? cur.tags : [];
    const sameTags = curTags.length === impTags.length
      && curTags.every(t => impTags.includes(t));
    const matches = sameName && sameRoom && sameTags;
    const namePrefix = (imp.name || "").trim() ? imp.name.trim() + "さんのデータが" : "";

    if (matches) {
      let changed = false;
      if (imp.memo && imp.memo.trim()) {
        const merged = appendText(cur.memo, imp.memo, namePrefix);
        if (merged !== cur.memo) { cur.memo = merged; changed = true; }
      }
      if (imp.shared && imp.shared.trim()) {
        const merged = appendText(cur.shared, imp.shared, namePrefix);
        if (merged !== cur.shared) { cur.shared = merged; changed = true; }
      }
      if (changed) { cur.status = STATUS.BLUE; cur.updatedAt = now; }
    } else if (patientIsEmpty(cur)) {
      cur.room = imp.room;
      cur.name = imp.name;
      cur.tags = impTags;
      if (imp.memo) cur.memo = imp.memo;
      if (imp.shared) cur.shared = imp.shared;
      cur.status = STATUS.BLUE;
      cur.updatedAt = now;
    } else {
      // Displace current to end, replace position with imported (blue)
      appState.patients.push(cur);
      const fresh = makeDefaultPatient();
      fresh.room = imp.room;
      fresh.name = imp.name;
      fresh.tags = impTags;
      if (imp.memo) fresh.memo = imp.memo;
      if (imp.shared) fresh.shared = imp.shared;
      fresh.status = STATUS.BLUE;
      fresh.updatedAt = now;
      appState.patients[i] = fresh;
    }
  }
  saveNow();
}

// ============================
// Validation (admin terminal)
// ============================

export function findIncompleteAdminPatients() {
  if (!isAdminTerminal()) return [];
  const list = [];
  for (let i = 0; i < appState.patients.length; i++) {
    const p = appState.patients[i];
    const name = String(p.name || "").trim();
    if (!name) continue;
    const room = String(p.room || "").trim();
    const hasTags = Array.isArray(p.tags) && p.tags.length > 0;
    if (!room || !hasTags) list.push(i + 1);
  }
  return list;
}

export function clearIncompleteAdminPatients() {
  // Clears name/room/tags for incomplete patients, preserving other content
  if (!isAdminTerminal()) return;
  for (let i = 0; i < appState.patients.length; i++) {
    const p = appState.patients[i];
    const name = String(p.name || "").trim();
    if (!name) continue;
    const room = String(p.room || "").trim();
    const hasTags = Array.isArray(p.tags) && p.tags.length > 0;
    if (!room || !hasTags) {
      p.name = "";
      p.room = "";
      p.tags = [];
    }
  }
  saveNow();
}
