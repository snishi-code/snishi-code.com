"use strict";

// Thin abstraction over device persistence.
//
// Today: a single bundle is kept under one localStorage key. The legacy
// two-key layout (state + settings) is read once at boot for migration.
// Tomorrow: swap this for IndexedDB or a multi-bundle store without touching
// call sites — the public surface is loadBundle / saveBundle / listBundles.

import { BUNDLE_FORMAT, parseBundle } from "./bundle.js";

const BUNDLE_KEY = "rounds_v2_soap_ryoyo_ward_bundle_v1";

// Legacy keys (pre-bundle). Read-only fallback for migration. We do not
// rewrite or delete them: a stale tab or a manual rollback can still find the
// old snapshot.
const LEGACY_STATE_KEY = "rounds_v2_soap_ryoyo_ward";
const LEGACY_SETTINGS_KEY = "rounds_v2_soap_ryoyo_ward_settings_v1";

export const STORAGE_KEYS = Object.freeze({
  bundle: BUNDLE_KEY,
  legacyState: LEGACY_STATE_KEY,
  legacySettings: LEGACY_SETTINGS_KEY,
});

export function loadBundle() {
  try {
    const s = localStorage.getItem(BUNDLE_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      if (parsed && parsed.format === BUNDLE_FORMAT) return parseBundle(parsed);
    }
  } catch (e) {
    console.warn("bundle load failed:", e);
  }
  // Fall back to the pre-bundle two-key layout.
  try {
    const stateRaw = localStorage.getItem(LEGACY_STATE_KEY);
    const settingsRaw = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (stateRaw || settingsRaw) {
      return parseBundle({
        appState: stateRaw ? JSON.parse(stateRaw) : null,
        settings: settingsRaw ? JSON.parse(settingsRaw) : null,
      });
    }
  } catch (e) {
    console.warn("legacy load failed:", e);
  }
  return null;
}

export function saveBundle(bundle) {
  try {
    localStorage.setItem(BUNDLE_KEY, JSON.stringify(bundle));
  } catch (e) {
    console.error("bundle save failed:", e);
  }
}

// Forward-looking: the UI may eventually let the user pick among multiple
// stored bundles (e.g. when IndexedDB-backed). Today there is exactly one.
export function listBundles() {
  return [{ id: "default", key: BUNDLE_KEY }];
}
