"use strict";

export const STORAGE_KEY = "rounds_v2_soap_ryoyo_ward";
export const SETTINGS_KEY = STORAGE_KEY + "_settings_v1";
export const DEFAULT_PATIENT_COUNT = 100;

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
];

export const DEFAULT_TAGS = [];
export const DEFAULT_TAGS_ENABLED = false;
export const DEFAULT_ROOM_ENABLED = false;
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

// Tag→Status link feature (off by default; separate toggle from tagsEnabled)
export const DEFAULT_TAG_STATUS_LINK_ENABLED = false;

export const DEFAULT_CLEAR_TARGETS = {
  memo: false,
  s: true,
  o: true,
  a: true,
  p: false,
  shared: false,
  statusYellow: true,
  statusGreen: true,
  statusGray: true,
  statusBlue: false,
};

export function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
