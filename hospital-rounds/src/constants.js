"use strict";

// 既定値は src/defaults.json に集約。ここでは JSON を読み込んで名前付きで再エクスポート
// するだけ。ユーザーが触らずに保存した時の状態 = defaults.json で、コードからは
// この constants.js を通じて参照する設計。
import APP_DEFAULTS from "./defaults.json" with { type: "json" };

export const DEFAULT_PATIENT_COUNT = APP_DEFAULTS._app.patientCount;

export const STATUS = {
  NONE: "none",
  YELLOW: "yellow",
  GREEN: "green",
  GRAY: "gray",
  BLUE: "blue",
};

// 新フォーマット概念。アプリ起動時にユーザーが空なら以下が並ぶ。
// type: "numeric" | "text"
// panel: "S" | "O" | "A" | "P"  (内部フィールド。UI では SOAP セクション帰属で自動推定)
// joiner: 項目間の区切り
// pinned: 患者画面で 1-tap クイックアクセスボタンとして並ぶか
// isDefault: 患者画面の対象パネルが空欄の時に QR/出力で fallback として使う規定文か
// items: numeric は {label,unit}, text は {label,normal}
export const DEFAULT_FORMATS = APP_DEFAULTS.formats;

export const FORMAT_PANELS = Object.freeze(["S", "O", "A", "P"]);
// item ごとに kind を持つ
//   text     : label + 規定文 (normal) + textarea 入力。labelSep は既定で「：」
//   number   : label + 単位 (unit) + 数値入力 + memo。labelSep は既定で " "
//   fraction : label + 単位 (unit) + 数値2つを "/" で結合 (例 BP 120/53)
//   date     : label + 月日のみのカレンダー入力 + memo (規定文 normal が prefill される)
export const FORMAT_ITEM_KINDS = Object.freeze(["text", "number", "fraction", "date"]);
export const DEFAULT_ITEM_KIND = "text";
// labelSep を未指定でフォーマットを新規作成する時のフォールバック。
// (全 item が kind=text なら "："、それ以外は " " を migration / 新規作成 UI で割り当てる)
export const DEFAULT_LABEL_SEP_TEXT = "：";
export const DEFAULT_LABEL_SEP_OTHER = " ";

export const DEFAULT_TAGS = APP_DEFAULTS.tags;


// QR 種別 (kind コード) と設定キー (settings.qrEncryption / qrRedistribution)。
// 患者画面 QR (clinical text → 電子カルテ貼付) は外部ツールで読む前提のため
// このマトリクスに含まれない (常に平文・常に再配布可)。
export const QR_KINDS = Object.freeze(["HM", "MM", "SH", "ST", "FMT"]);
// それぞれ「暗号化のデフォルト」「再配布のデフォルト」。設定 UI から変更可。
//   redistribution: "restricted" = 受信したデータを再配布できない (= origin=external を export 時に除外)
//                   "free"       = 制限なし
export const DEFAULT_QR_ENCRYPTION = Object.freeze({
  HM: true, MM: true, SH: true, ST: true, FMT: true,
});
export const DEFAULT_QR_REDISTRIBUTION = Object.freeze({
  HM:  "restricted",
  MM:  "restricted",
  SH:  "free",
  ST:  "free",
  FMT: "free",
});

// Tag filter modes
export const TAG_FILTER_MODE_AND = "and";
export const TAG_FILTER_MODE_OR = "or";
export const DEFAULT_TAG_FILTER_MODE = TAG_FILTER_MODE_AND;

// Virtual status tags exposed in filter pickers (not stored on patient.tags)
export const STATUS_TAG_PREFIX = "__status:";

// Tag grouping (categorize tags into groups, off by default)
// v7.7+: GROUP_MODE_* / STATUS_GROUP_ID / DEFAULT_TAG_GROUPING_ENABLED は撤去
// (タグ・カテゴリ機能撤去のため)。再実装は git tag hospital-rounds-v7.6.1 を参照

export const DEFAULT_CLEAR_TARGETS = APP_DEFAULTS.clearTargets;

export function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// アプリ既定値の生 JSON (デバッグ・テスト用)
export const APP_DEFAULTS_JSON = APP_DEFAULTS;
