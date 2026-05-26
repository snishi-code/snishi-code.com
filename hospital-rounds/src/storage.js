"use strict";

// Async persistence backed by IndexedDB.
//
// Public surface (all async):
//   loadBundle(id?)   -> parsed bundle | null
//   saveBundle(b, id?) -> void
//   listBundles()     -> [{id, title, updatedAt}]
//
// Migration path:
//   - On first read, if IndexedDB is empty we also try the legacy localStorage
//     keys (single-bundle layout used before v4.0). Anything found there is
//     returned to the caller; the next save automatically lands it in IDB.
//     localStorage entries are *not* deleted — they remain as a manual rollback
//     hatch until we decide they are no longer needed.
//   - In non-browser environments (tests in Node without fake-indexeddb), IDB
//     is unavailable and load/save become no-ops. Tests should inject state
//     via `initStore({ bundle: rawFixture })` rather than relying on storage.

import { BUNDLE_FORMAT, parseBundle } from "./bundle.js";

const DB_NAME = "hospital-rounds";
const DB_VERSION = 1;
const STORE_NAME = "bundles";

// 単一 bundle 運用の固定 ID。multi-bundle 化したらここを動的に振り直す。
export const ACTIVE_BUNDLE_ID = "default";

// Legacy localStorage keys (pre-IDB). Read-only migration source.
const LEGACY_BUNDLE_KEY = "rounds_v2_soap_ryoyo_ward_bundle_v1";
const LEGACY_STATE_KEY = "rounds_v2_soap_ryoyo_ward";
const LEGACY_SETTINGS_KEY = "rounds_v2_soap_ryoyo_ward_settings_v1";

// デバッグ用 (設定画面の小さなラベル表示など)。本来は内部実装の詳細だが
// 既存 UI の互換のため公開している。
export const STORAGE_KEYS = Object.freeze({
  db: DB_NAME,
  store: STORE_NAME,
  activeBundle: ACTIVE_BUNDLE_ID,
  legacyBundle: LEGACY_BUNDLE_KEY,
  legacyState: LEGACY_STATE_KEY,
  legacySettings: LEGACY_SETTINGS_KEY,
});

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
  _dbPromise = new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        // updatedAt index は将来の一覧並べ替え用。今は使っていない
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.warn("indexedDB open failed:", req.error);
      resolve(null);
    };
    req.onblocked = () => {
      console.warn("indexedDB open blocked (other tab holds older version)");
      resolve(null);
    };
  });
  return _dbPromise;
}

// IDBRequest -> Promise<result>
function idbReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// transaction.oncomplete を待つ。put/delete 後の永続化保証に使う。
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
      // parseBundle が legacy {appState, settings} 形式を受け付ける
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

export async function loadBundle(id = ACTIVE_BUNDLE_ID) {
  // 1) IDB 優先
  try {
    const db = await openDb();
    if (db) {
      const tx = db.transaction(STORE_NAME, "readonly");
      const rec = await idbReq(tx.objectStore(STORE_NAME).get(id));
      if (rec && rec.bundle) {
        try { return parseBundle(rec.bundle); }
        catch (e) { console.warn("idb bundle parse failed:", e); }
      }
    }
  } catch (e) {
    console.warn("idb load failed:", e);
  }
  // 2) localStorage 由来 legacy データ (初回起動時のみヒット)
  const legacy = readLegacyFromLocalStorage();
  if (legacy) {
    try { return parseBundle(legacy); }
    catch (e) { console.warn("legacy parse failed:", e); }
  }
  return null;
}

export async function saveBundle(bundle, id = ACTIVE_BUNDLE_ID) {
  const db = await openDb();
  if (!db) return; // IDB 不可環境 (テスト等) は no-op
  const rec = {
    id,
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
      title: r.title || "",
      updatedAt: r.updatedAt || 0,
    }));
  } catch (e) {
    console.warn("idb list failed:", e);
    return [];
  }
}

// ============================
// Test hooks
// ============================

// テスト・開発で「DB ハンドルを捨てて再オープン」させたい時用。
// 通常コードからは呼ばない。
export function _resetDbForTests() {
  _dbPromise = null;
}
