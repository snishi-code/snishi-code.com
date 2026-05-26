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

// 旧 O 構造体の正常文。マイグレーション時にのみ参照する (旧 patient.o[key].normal=true
// を文字列化するための表)。新コードは settings.formats に置換済み。
export const LEGACY_O_RULES = APP_DEFAULTS._migration_legacy_o_rules;

// 新フォーマット概念。アプリ起動時にユーザーが空なら以下が並ぶ。
// type: "numeric" | "text"
// panel: "S" | "O" | "A" | "P"  (内部フィールド。UI では SOAP セクション帰属で自動推定)
// joiner: 項目間の区切り
// pinned: 患者画面で 1-tap クイックアクセスボタンとして並ぶか
// isDefault: 患者画面の対象パネルが空欄の時に QR/出力で fallback として使う規定文か
// items: numeric は {label,unit}, text は {label,normal}
export const DEFAULT_FORMATS = APP_DEFAULTS.formats;

export const FORMAT_PANELS = Object.freeze(["S", "O", "A", "P"]);
export const FORMAT_TYPES = Object.freeze(["numeric", "text"]);

export const DEFAULT_TAGS = APP_DEFAULTS.tags;
export const DEFAULT_ADMIN_ENABLED = APP_DEFAULTS.adminEnabled;
export const DEFAULT_ADMIN_TERMINAL = APP_DEFAULTS.adminTerminal;

// Roster diff sync (admin feature)
export const ROSTER_DIFF_WINDOW_DAYS = APP_DEFAULTS._app.rosterDiffWindowDays;
export const DEFAULT_ROSTER_PASSPHRASE = APP_DEFAULTS.rosterPassphrase;

// Tag filter modes
export const TAG_FILTER_MODE_AND = "and";
export const TAG_FILTER_MODE_OR = "or";
export const DEFAULT_TAG_FILTER_MODE = TAG_FILTER_MODE_AND;

// Virtual status tags exposed in filter pickers (not stored on patient.tags)
export const STATUS_TAG_PREFIX = "__status:";

// Tag grouping (categorize tags into groups, off by default)
export const DEFAULT_TAG_GROUPING_ENABLED = APP_DEFAULTS.tagGroupingEnabled;
export const GROUP_MODE_SINGLE = "single";
export const GROUP_MODE_MULTI = "multi";
export const STATUS_GROUP_ID = "__status";

export const DEFAULT_CLEAR_TARGETS = APP_DEFAULTS.clearTargets;

export function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// アプリ既定値の生 JSON (デバッグ・テスト用)
export const APP_DEFAULTS_JSON = APP_DEFAULTS;
