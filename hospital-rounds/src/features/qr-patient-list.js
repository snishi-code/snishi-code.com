"use strict";

import { appState, settings } from "../store.js";
import { patientMatchesSharedFilter } from "./tags.js";

// ============================
// 患者リスト系 QR ペイロード (HM/MM/SH 共通)
//
// JSON + 短縮キー方式。位置依存配列やスキーマ宣言は使わず、key-based に統一
// することで、フィールド追加・削除・順序変更すべてに耐性を持たせる。
//
// 形式:
//   {
//     "v": 2,
//     "tags": ["内科","外科"],
//     "p": [
//       {"r":"203","n":"テスト太郎","t":[1,3],"c":"本日体温..."},
//       {},                                ← HM の空 slot
//       {"r":"204","n":"テスト次郎","t":[2]}
//     ]
//   }
//
//   - r/n/t/c = room / name / tags / content
//   - tags    = 送信側のタグ辞書（1-based の index を共有するため）
//   - p       = 患者配列。HM では slot 位置を保つため空 patient は `{}` を入れる
//   - c       = MM/SH のみ。HM では省略
//
// HM (ホーム): 全 slot をその順で並べる。末尾の空はトリム可（receiver はデフォルト
// で埋める）。MM/SH: content がある患者だけを列挙（順序は意味なし）。
// ============================

const WIRE_V = 2;

export function encodePatientList(cfg) {
  // cfg.fieldName: null (HM) | "memo" (MM) | "shared" (SH)
  // cfg.includeEmpty: true (HM) | false (MM/SH)
  // cfg.matchesFilter: 任意フィルタ。指定があれば該当患者だけを対象に
  const fieldName = cfg.fieldName || null;
  const includeEmpty = !!cfg.includeEmpty;
  const matchesFilter = cfg.matchesFilter || (() => true);

  const tagIdxByName = new Map();
  (settings.tags || []).forEach((t, i) => tagIdxByName.set(t, i + 1));

  const patientArr = [];
  for (const p of appState.patients) {
    if (!matchesFilter(p)) {
      if (includeEmpty) patientArr.push({});
      continue;
    }
    const room = String(p?.room || "").trim();
    const name = String(p?.name || "").trim();
    const tagIdxs = (p?.tags || [])
      .map(t => tagIdxByName.get(t))
      .filter(v => typeof v === "number");
    const content = fieldName ? String(p?.[fieldName] ?? "").trim() : "";

    const isEmpty = !room && !name && tagIdxs.length === 0 && !content;
    if (isEmpty) {
      if (includeEmpty) patientArr.push({});
      continue;
    }
    if (fieldName && !content) {
      // MM/SH: content が無い患者は載せない
      continue;
    }
    const obj = {};
    if (room) obj.r = room;
    if (name) obj.n = name;
    if (tagIdxs.length) obj.t = tagIdxs;
    if (fieldName) obj.c = content;
    patientArr.push(obj);
  }

  // HM の末尾連続空を削る（受信側は p.length までを反映、残りはデフォルト）
  if (includeEmpty) {
    while (patientArr.length > 0) {
      const last = patientArr[patientArr.length - 1];
      if (Object.keys(last).length === 0) patientArr.pop();
      else break;
    }
  }

  const out = {
    v: WIRE_V,
    tags: (settings.tags || []).slice(),
    p: patientArr,
  };
  return JSON.stringify(out);
}

export function decodePatientList(payload) {
  const obj = JSON.parse(String(payload || ""));
  if (!obj || typeof obj !== "object") {
    throw new Error("不正な患者リスト形式");
  }
  if (obj.v !== WIRE_V) {
    throw new Error(`バージョン不一致 (wire=${obj.v}, expected=${WIRE_V})`);
  }
  const tagNames = Array.isArray(obj.tags) ? obj.tags.filter(x => typeof x === "string") : [];
  const rawList = Array.isArray(obj.p) ? obj.p : [];
  const patients = rawList.map(entry => {
    if (!entry || typeof entry !== "object") return { room: "", name: "", tagIdxs: [], content: "" };
    const tagIdxs = Array.isArray(entry.t)
      ? entry.t.map(v => typeof v === "number" ? v : parseInt(v, 10)).filter(v => Number.isFinite(v))
      : [];
    return {
      room: String(entry.r || ""),
      name: String(entry.n || ""),
      tagIdxs,
      content: String(entry.c || ""),
    };
  });
  return { tagNames, patients };
}

// 共有/メモ画面で QR 生成対象を絞るときに使う（既存のタグフィルタを尊重）
export { patientMatchesSharedFilter };
