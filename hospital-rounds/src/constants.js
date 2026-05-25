"use strict";

export const DEFAULT_PATIENT_COUNT = 50;

export const STATUS = {
  NONE: "none",
  YELLOW: "yellow",
  GREEN: "green",
  GRAY: "gray",
  BLUE: "blue",
};

// 旧 O 構造体の正常文。マイグレーション時にのみ参照する (旧 patient.o[key].normal=true
// を文字列化するための表)。新コードからは settings.oRules も DEFAULT_O_RULES も使わない。
export const LEGACY_O_RULES = [
  { key: "general", label: "General", normalText: "良好" },
  { key: "lung", label: "肺音", normalText: "明らかなラ音なし" },
  { key: "bowel", label: "腸音", normalText: "正常" },
  { key: "abdomen", label: "腹部", normalText: "平坦軟、圧痛なし" },
  { key: "meal", label: "食事", normalText: "摂取良好" },
  { key: "elimination", label: "排泄", normalText: "尿・便ともに特記なし" },
];

// 新フォーマット概念。アプリ起動時にユーザーが空なら以下が並ぶ。
// type: "numeric" | "text"
// panel: "S" | "O" | "A" | "P"  (内部フィールド。UI では SOAP セクション帰属で自動推定)
// joiner: 項目間の区切り
// pinned: 患者画面で 1-tap クイックアクセスボタンとして並ぶか
// isDefault: 患者画面の対象パネルが空欄の時に QR/出力で fallback として使う規定文か
// items: numeric は {label,unit}, text は {label,normal}
export const DEFAULT_FORMATS = [
  {
    name: "バイタル", panel: "O", type: "numeric", joiner: ", ", pinned: true, isDefault: false,
    items: [
      { label: "BP",   unit: "mmHg" },
      { label: "P",    unit: "bpm"  },
      { label: "SpO2", unit: "%"    },
      { label: "RR",   unit: ""     },
      { label: "T",    unit: "℃"   },
    ],
  },
  {
    name: "身体所見", panel: "O", type: "text", joiner: "\n", pinned: true, isDefault: false,
    items: [
      { label: "General",  normal: "良好" },
      { label: "肺音",     normal: "明らかなラ音なし" },
      { label: "腸音",     normal: "正常" },
      { label: "腹部",     normal: "平坦軟、圧痛なし" },
      { label: "食事",     normal: "摂取良好" },
      { label: "排泄",     normal: "尿・便ともに特記なし" },
    ],
  },
];

export const FORMAT_PANELS = Object.freeze(["S", "O", "A", "P"]);
export const FORMAT_TYPES = Object.freeze(["numeric", "text"]);

export const DEFAULT_TAGS = [];
export const DEFAULT_ADMIN_ENABLED = false;
export const DEFAULT_ADMIN_TERMINAL = false;

// Roster diff sync (admin feature)
export const ROSTER_DIFF_WINDOW_DAYS = 30;
export const DEFAULT_ROSTER_PASSPHRASE = "";

// Tag filter modes
export const TAG_FILTER_MODE_AND = "and";
export const TAG_FILTER_MODE_OR = "or";
export const DEFAULT_TAG_FILTER_MODE = TAG_FILTER_MODE_AND;

// Virtual status tags exposed in filter pickers (not stored on patient.tags)
export const STATUS_TAG_PREFIX = "__status:";

// Tag grouping (categorize tags into groups, off by default)
export const DEFAULT_TAG_GROUPING_ENABLED = false;
export const GROUP_MODE_SINGLE = "single";
export const GROUP_MODE_MULTI = "multi";
export const STATUS_GROUP_ID = "__status";

export const DEFAULT_CLEAR_TARGETS = {
  memo: false,
  s: true,
  o: true,
  a: false,
  p: false,
  shared: false,
  statusYellow: true,
  statusGreen: true,
  statusGray: true,
  statusBlue: false,
};

export function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
