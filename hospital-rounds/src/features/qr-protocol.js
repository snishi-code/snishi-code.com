"use strict";

import { utf8ByteLength } from "../payload.js";

// ============================
// 多ページ QR 共通プロトコル
//
// すべての QR 種（ホーム/メモ/共有/設定…）が以下のページ書式を共有する:
//
//   RND_<KIND> #<batchId> N/M\n<本文>
//
//   - KIND: HM | MM | SH | ST など 2 文字以上の大文字
//   - batchId: 1 回の送信を識別する短い ID（Date.now().toString(36)）
//   - N/M: ページ番号 / 総ページ数
//
// 本文は種ごとに自由（terse pipe 区切り、JSON、etc.）。共通のエスケープ
// ユーティリティ (escapeField/unescapeField/splitEscapedPipe) を本モジュールで
// 提供する。改行は `\n` 2 文字にエスケープして 1 行 = 1 レコードを保つ。
// ============================

const MAX_BYTES = 800;
// 'RND_HM #abcdef12 99/99\n' = 約 25 バイト。余裕を持って 50 バイト確保
const HEADER_BUDGET = 50;
const HEADER_RE = /^RND_([A-Z]+)\s+#(\S+)\s+(\d+)\/(\d+)\n([\s\S]*)$/;

export function newBatchId() {
  return Date.now().toString(36);
}

// ============================
// Escape helpers
// ============================

export function escapeField(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\n/g, "\\n");
}

export function unescapeField(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) {
      const c = s[i + 1];
      out += c === "n" ? "\n" : c;
      i++;
    } else {
      out += s[i];
    }
  }
  return out;
}

export function splitEscapedPipe(line) {
  const parts = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && i + 1 < line.length) {
      cur += line[i] + line[i + 1];
      i++;
    } else if (line[i] === "|") {
      parts.push(cur);
      cur = "";
    } else {
      cur += line[i];
    }
  }
  parts.push(cur);
  return parts;
}

// ============================
// Page chunking + headers
//
// payload を `budget` バイト以下に分割。可能な限り `\n` 境界で切り、
// 改行が無い payload（設定 JSON など）もコードポイント境界で分割する。
// チャンクは境界の `\n` を保持するので、受信側は ""（空文字）で連結すれば
// 元の payload に戻る。
// ============================

function chunkPayload(payload, budget) {
  if (utf8ByteLength(payload) <= budget) return [payload];

  const chunks = [];
  let i = 0;
  const len = payload.length;
  while (i < len) {
    let chunkBytes = 0;
    let lastNewlineEnd = -1;
    let j = i;
    while (j < len) {
      const code = payload.codePointAt(j);
      const cpBytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      if (chunkBytes + cpBytes > budget) break;
      chunkBytes += cpBytes;
      const cpUtf16 = code >= 0x10000 ? 2 : 1;
      if (payload[j] === "\n") lastNewlineEnd = j + 1;
      j += cpUtf16;
    }
    if (j === i) {
      // 1 文字でも budget を超える病的ケース。これ以上分割できないので強制送出
      chunks.push(payload.slice(i, i + 1));
      i += 1;
      continue;
    }
    const splitJ = lastNewlineEnd > i ? lastNewlineEnd : j;
    chunks.push(payload.slice(i, splitJ));
    i = splitJ;
  }
  return chunks.length === 0 ? [""] : chunks;
}

// payload を全ページ分の文字列配列に変換
export function encodePages({ kind, payload, batchId, maxBytes = MAX_BYTES }) {
  const trimmed = String(payload || "").trim();
  if (!trimmed) return [];
  const id = batchId || newBatchId();
  const budget = maxBytes - HEADER_BUDGET;
  const chunks = chunkPayload(payload, budget);
  const total = chunks.length;
  return chunks.map((c, i) => `RND_${kind} #${id} ${i + 1}/${total}\n${c}`);
}

// ヘッダー解析。形式に合わなければ null
export function decodePage(text) {
  const m = String(text || "").match(HEADER_RE);
  if (!m) return null;
  return {
    kind: m[1],
    batchId: m[2],
    pageNum: parseInt(m[3], 10),
    totalPages: parseInt(m[4], 10),
    content: m[5],
  };
}
