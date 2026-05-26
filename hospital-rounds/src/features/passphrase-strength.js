"use strict";

// 合言葉 (roster 共有用パスフレーズ) の強度評価とメーター描画。
//
// ・最低長は MIN_LEN (12) 文字。短いものは「短すぎる」として 0 段階扱い。
// ・スコアは長さと文字種多様性の合算。0..4 段階で UI のバーを点灯させる。
//
// 「文字種」は ASCII の lower / upper / digit / symbol に加え、非 ASCII
// (日本語等) を別カテゴリとしてカウント。日本語 1 文字 = エントロピー高
// なので、`設定`のような短い日本語でも MIN_LEN を満たしていれば良スコア。

import { t } from "../i18n.js";

export const PASSPHRASE_MIN_LEN = 12;

const RE_LOWER = /[a-z]/;
const RE_UPPER = /[A-Z]/;
const RE_DIGIT = /[0-9]/;
const RE_SYMBOL = /[^A-Za-z0-9\s]/;
const RE_NON_ASCII = /[^\x00-\x7F]/;

export function computePassphraseStrength(raw) {
  const s = String(raw || "");
  const len = [...s].length;

  if (len === 0) return { score: 0, level: "empty" };
  if (len < PASSPHRASE_MIN_LEN) return { score: 0, level: "tooShort" };

  let classes = 0;
  if (RE_LOWER.test(s)) classes++;
  if (RE_UPPER.test(s)) classes++;
  if (RE_DIGIT.test(s)) classes++;
  if (RE_SYMBOL.test(s) && !RE_NON_ASCII.test(s)) classes++;
  if (RE_NON_ASCII.test(s)) classes += 2; // 非 ASCII は強めに評価

  let score = 1;
  if (len >= 14) score++;
  if (len >= 18) score++;
  if (classes >= 3) score++;
  if (score > 4) score = 4;

  const level =
    score >= 4 ? "strong" :
    score >= 3 ? "good" :
    score >= 2 ? "ok" :
    "weak";
  return { score, level };
}

export function strengthLabel(level) {
  switch (level) {
    case "empty": return "";
    case "tooShort": return t("admin.passphrase.strength.tooShort");
    case "weak": return t("admin.passphrase.strength.weak");
    case "ok": return t("admin.passphrase.strength.ok");
    case "good": return t("admin.passphrase.strength.good");
    case "strong": return t("admin.passphrase.strength.strong");
    default: return "";
  }
}

// host: メーター容器 (空にしてから埋める)。raw: 現在の入力文字列。
// renderPassphraseStrength を呼ぶたびに DOM を作り直す (シンプル優先)。
export function renderPassphraseStrength(host, raw) {
  if (!host) return;
  host.textContent = "";

  const { score, level } = computePassphraseStrength(raw);
  host.dataset.level = level;

  const bars = document.createElement("div");
  bars.className = "passStrengthBars";
  for (let i = 0; i < 4; i++) {
    const seg = document.createElement("span");
    seg.className = "passStrengthBar";
    if (i < score) seg.classList.add("filled");
    bars.appendChild(seg);
  }
  host.appendChild(bars);

  const label = document.createElement("span");
  label.className = "passStrengthLabel";
  label.textContent = strengthLabel(level);
  host.appendChild(label);
}
