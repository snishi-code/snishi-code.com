"use strict";

// Workspace-backed persistence on IndexedDB.
//
// データモデル:
//   - `bundles` object store の 1 レコード = 1 ワークスペース
//   - 「アクティブワークスペース」を 1 個だけ指し示すポインタを別管理
//     (= localStorage に保存。サイズが小さく同期 API で済むため)
//   - 編集中のオートセーブは常にアクティブワークスペースを上書きする
//   - 切替時はアクティブを保存 → 新ワークスペースをロード → live state 差し替え
//
// public surface (すべて async):
//   loadBundle(id?)            -> parsed bundle | null    (id 省略時は active)
//   saveBundle(b, id?, label?) -> void                    (id 省略時は active)
//   listBundles()              -> [{id, label, title, updatedAt}]
//   renameBundle(id, label)    -> void                    (label のみ書き換え)
//   deleteBundle(id)           -> void                    (active は拒否)
//   createWorkspaceRecord(label, bundle) -> id            (新規ワークスペースを作成)
//
//   getActiveWorkspaceId()     -> string  (active workspace の ID。同期)
//   setActiveWorkspaceId(id)   -> void    (同期)

import { BUNDLE_FORMAT, parseBundle } from "./bundle.js";

const DB_NAME = "hospital-rounds";
const DB_VERSION = 1;
const STORE_NAME = "bundles";

// 初回起動時 / v4 系からのマイグレーション時に既定で active になる ID。
// 既存ユーザの "default" レコードがそのままアクティブになる。
const DEFAULT_WORKSPACE_ID = "default";
export const DEFAULT_WORKSPACE_LABEL = "メイン";

// active workspace ID は IDB ではなく localStorage に置く:
//   - 値は短い文字列 (= 容量問題なし)
//   - module 初期化や render 直前で同期に読みたい
//   - 別タブが workspace 切替したとき storage event で気付ける
const ACTIVE_KEY = "hospital_rounds_active_workspace_id";

// Legacy localStorage keys (pre-IDB). Read-only migration source.
const LEGACY_BUNDLE_KEY = "rounds_v2_soap_ryoyo_ward_bundle_v1";
const LEGACY_STATE_KEY = "rounds_v2_soap_ryoyo_ward";
const LEGACY_SETTINGS_KEY = "rounds_v2_soap_ryoyo_ward_settings_v1";

// Device-wide app title (localStorage). v6.5+ で workspace ごとの title から
// 端末固定の title に変更 (workspace 切替で reset されないように)。
// 旧 workspace の meta.title は migration 元として 1 回だけ参照する。
const DEVICE_TITLE_KEY = "hospital_rounds_device_app_title";

export const STORAGE_KEYS = Object.freeze({
  db: DB_NAME,
  store: STORE_NAME,
  defaultWorkspace: DEFAULT_WORKSPACE_ID,
  activeKey: ACTIVE_KEY,
  deviceTitle: DEVICE_TITLE_KEY,
  legacyBundle: LEGACY_BUNDLE_KEY,
  legacyState: LEGACY_STATE_KEY,
  legacySettings: LEGACY_SETTINGS_KEY,
});

// ============================
// Active workspace pointer (localStorage)
// ============================

export function getActiveWorkspaceId() {
  if (typeof localStorage === "undefined") return DEFAULT_WORKSPACE_ID;
  return localStorage.getItem(ACTIVE_KEY) || DEFAULT_WORKSPACE_ID;
}

export function setActiveWorkspaceId(id) {
  if (typeof localStorage === "undefined") return;
  if (!id || typeof id !== "string") return;
  localStorage.setItem(ACTIVE_KEY, id);
}

// ============================
// Device-wide app title (localStorage)
// ============================

// 端末固定のタイトル。未設定なら "" を返す (caller 側でデフォルト文言を充てる)
export function getDeviceAppTitle() {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(DEVICE_TITLE_KEY) || "";
}

export function setDeviceAppTitle(title) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(DEVICE_TITLE_KEY, String(title || ""));
}

// migration 用: localStorage に未設定なら旧 workspace の meta.title から
// 1 回だけコピーして移行する。空 / 既に設定済みなら何もしない。
export function migrateLegacyTitleIfNeeded(fallbackFromWorkspace) {
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(DEVICE_TITLE_KEY) != null) return;
  const t = String(fallbackFromWorkspace || "").trim();
  if (!t) return;
  localStorage.setItem(DEVICE_TITLE_KEY, t);
}

// ============================
// DB open (lazy, memoized)
// ============================

let _dbPromise = null;

function hasIndexedDb() {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}

function openDb() {
  if (_dbPromise) return _dbPromise;
  if (!hasIndexedDb()) {
    _dbPromise = Promise.resolve(null);
    return _dbPromise;
  }
  _dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn("indexedDB open failed:", req.error);
      resolve(null);
    };
    req.onblocked = () => {
      console.warn("indexedDB open blocked");
      resolve(null);
    };
  });
  return _dbPromise;
}

function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTxDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// ============================
// Legacy localStorage fallback (read-once on first hydrate)
// ============================

function readLegacyFromLocalStorage() {
  if (typeof localStorage === "undefined") return null;
  try {
    const s = localStorage.getItem(LEGACY_BUNDLE_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      if (parsed && parsed.format === BUNDLE_FORMAT) return parsed;
    }
  } catch (e) {
    console.warn("legacy bundle load failed:", e);
  }
  try {
    const stateRaw = localStorage.getItem(LEGACY_STATE_KEY);
    const settingsRaw = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (stateRaw || settingsRaw) {
      return {
        appState: stateRaw ? JSON.parse(stateRaw) : null,
        settings: settingsRaw ? JSON.parse(settingsRaw) : null,
      };
    }
  } catch (e) {
    console.warn("legacy state/settings load failed:", e);
  }
  return null;
}

// ============================
// Public API
// ============================

export async function loadBundle(id) {
  const targetId = id || getActiveWorkspaceId();
  // 1) IDB 優先
  try {
    const db = await openDb();
    if (db) {
      const tx = db.transaction(STORE_NAME, "readonly");
      const rec = await idbReq(tx.objectStore(STORE_NAME).get(targetId));
      if (rec && rec.bundle) {
        try { return parseBundle(rec.bundle); }
        catch (e) { console.warn("idb bundle parse failed:", e); }
      }
    }
  } catch (e) {
    console.warn("idb load failed:", e);
  }
  // 2) アクティブが "default" の時のみ legacy fallback (v4 以前の起動時)
  if (targetId === DEFAULT_WORKSPACE_ID) {
    const legacy = readLegacyFromLocalStorage();
    if (legacy) {
      try { return parseBundle(legacy); }
      catch (e) { console.warn("legacy parse failed:", e); }
    }
  }
  return null;
}

export async function saveBundle(bundle, id, label) {
  const targetId = id || getActiveWorkspaceId();
  const db = await openDb();
  if (!db) return; // IDB 不可環境 (テスト等) は no-op
  // label が未指定なら既存レコードの label を温存。新規作成だけ default label
  let finalLabel = label;
  if (finalLabel == null) {
    try {
      const txR = db.transaction(STORE_NAME, "readonly");
      const existing = await idbReq(txR.objectStore(STORE_NAME).get(targetId));
      if (existing && typeof existing.label === "string") finalLabel = existing.label;
    } catch (_) { /* ignore */ }
  }
  if (finalLabel == null) {
    finalLabel = (targetId === DEFAULT_WORKSPACE_ID) ? DEFAULT_WORKSPACE_LABEL : "";
  }
  const rec = {
    id: targetId,
    label: String(finalLabel),
    title: bundle?.sections?.meta?.title || "",
    updatedAt: Date.now(),
    bundle,
  };
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(rec);
    await idbTxDone(tx);
  } catch (e) {
    console.error("idb save failed:", e);
    throw e;
  }
}

export async function listBundles() {
  const db = await openDb();
  if (!db) return [];
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const all = await idbReq(tx.objectStore(STORE_NAME).getAll());
    return all.map(r => ({
      id: r.id,
      label: r.label || (r.id === DEFAULT_WORKSPACE_ID ? DEFAULT_WORKSPACE_LABEL : ""),
      title: r.title || "",
      updatedAt: r.updatedAt || 0,
    }));
  } catch (e) {
    console.warn("idb list failed:", e);
    return [];
  }
}

// 既存ワークスペースの label のみを書き換える (bundle / updatedAt / title は触らない)。
// active / 非 active を問わず使える。
export async function renameBundle(id, newLabel) {
  if (!id) throw new Error("renameBundle: id required");
  const db = await openDb();
  if (!db) return;
  try {
    const txR = db.transaction(STORE_NAME, "readonly");
    const existing = await idbReq(txR.objectStore(STORE_NAME).get(id));
    if (!existing) return;
    existing.label = String(newLabel || "");
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(existing);
    await idbTxDone(tx);
  } catch (e) {
    console.error("idb rename failed:", e);
    throw e;
  }
}

// active workspace は誤削除防止。それ以外は削除可。
export async function deleteBundle(id) {
  if (!id) throw new Error("delete: id required");
  if (id === getActiveWorkspaceId()) {
    throw new Error("cannot delete the active workspace");
  }
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    await idbTxDone(tx);
  } catch (e) {
    console.error("idb delete failed:", e);
    throw e;
  }
}

// 新規ワークスペースの ID を発番。
export function newWorkspaceId() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ws_${ts}_${rand}`;
}

// 新規ワークスペースを作成して IDB に保存。switch はしない (caller の責務)。
// bundle が空ならアプリ既定の bundle 形を caller 側で構築して渡す想定。
export async function createWorkspaceRecord(label, bundle) {
  const id = newWorkspaceId();
  await saveBundle(bundle, id, String(label || ""));
  return id;
}

// ============================
// Test hooks
// ============================

export function _resetDbForTests() {
  _dbPromise = null;
}
