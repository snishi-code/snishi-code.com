"use strict";

export const DEFAULT_PATIENT_COUNT = 50;

export const STATUS = {
  NONE: "none",
  YELLOW: "yellow",
  GREEN: "green",
  GRAY: "gray",
  BLUE: "blue",
};

export const DEFAULT_O_RULES = [
  { key: "general", label: "General", normalText: "良好", placeholder: "例) 倦怠感あり" },
  { key: "lung", label: "肺音", normalText: "明らかなラ音なし", placeholder: "例) 右下肺野、呼吸音減弱" },
  { key: "bowel", label: "腸音", normalText: "正常", placeholder: "例) 腸蠕動音 減弱" },
  { key: "abdomen", label: "腹部", normalText: "平坦軟、圧痛なし", placeholder: "例) 軽度膨満 / 下腹部に軽度圧痛" },
  { key: "meal", label: "食事", normalText: "摂取良好", placeholder: "例) 食事量3割" },
  { key: "elimination", label: "排泄", normalText: "尿・便ともに特記なし", placeholder: "例) 便秘4日、排尿問題なし" },
];

export const DEFAULT_TAGS = [];
export const DEFAULT_ADMIN_ENABLED = false;
export const DEFAULT_ADMIN_TERMINAL = false;
export const DEFAULT_ADMIN_IMPORT_ONLY = false;

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
