// データ層の回帰検査。
//
// Vite ビルドは構文・import チェックしかしないので、モジュール初期化中の
// 実行時バグ（TDZ など）や、Bundle 形式のパース／射影の互換性は素通りする。
// このスクリプトは fixtures/*.json を順に読ませて、parseBundle・projectBundle・
// store.js のコールド／ウォームブートまで一通り走らせ、main の挙動に近い経路で
// データ層が壊れていないかを確認する。
//
// 使い方:   npm test

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ============================
// Browser API stubs
// ============================
class LocalStorageStub {
  constructor() { this._data = {}; }
  getItem(k) { return this._data[k] ?? null; }
  setItem(k, v) { this._data[k] = String(v); }
  removeItem(k) { delete this._data[k]; }
  clear() { this._data = {}; }
}
globalThis.localStorage = new LocalStorageStub();
if (!globalThis.crypto) {
  globalThis.crypto = (await import("node:crypto")).webcrypto;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");
const srcDir = resolve(__dirname, "..", "src");
const storeUrl = pathToFileURL(join(srcDir, "store.js")).href;
const bundleUrl = pathToFileURL(join(srcDir, "bundle.js")).href;

const {
  parseBundle, projectBundle,
  SECTION, getSection, BUNDLE_FORMAT,
} = await import(bundleUrl);

// Re-import store.js with a unique URL each time so the module-init code
// (which reads localStorage) runs fresh against whatever fixture we just
// loaded into the stub.
async function freshStore() {
  return await import(storeUrl + `?t=${Math.random()}`);
}

// ============================
// Tiny test harness
// ============================
let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message || e}`);
    if (e.stack) console.error(`    ${e.stack.split("\n").slice(1, 3).join("\n    ")}`);
    failed++;
  }
}

function section(label) {
  console.log(`\n${label}`);
}

// ============================
// 1) Cold boot
// ============================
section("cold boot");

await test("clean localStorage → defaults populated", async () => {
  localStorage.clear();
  const store = await freshStore();
  assert.equal(store.appState.patients.length, 50, "50 default patient slots");
  assert.equal(store.appState.title, "回診");
  assert.equal(store.rosterState, null, "rosterState is null when nothing stored");
  assert.ok(store.settings.oRules.length > 0, "default oRules populated");
  assert.ok(store.appState.patients.every(p => typeof p.pid === "string" && p.pid.length > 0), "every default patient has a pid");
});

// ============================
// 2) parseBundle on each fixture
// ============================
section("parseBundle");

const fixtureFiles = readdirSync(fixturesDir).filter(f => f.endsWith(".json"));
const fixtures = {};
for (const f of fixtureFiles) {
  fixtures[f] = JSON.parse(readFileSync(join(fixturesDir, f), "utf8"));
}

for (const [name, raw] of Object.entries(fixtures)) {
  await test(`${name} parses to a bundle`, () => {
    const b = parseBundle(raw);
    assert.equal(b.format, BUNDLE_FORMAT);
    assert.equal(b.schema, 1);
    assert.ok(b.sections && typeof b.sections === "object");
  });
}

await test("null input is rejected", () => {
  assert.throws(() => parseBundle(null));
});
await test("non-object input is rejected", () => {
  assert.throws(() => parseBundle("not-a-bundle"));
});
await test("unknown shape is rejected", () => {
  assert.throws(() => parseBundle({ random: "object" }));
});

// ============================
// 3) projectBundle round-trip
// ============================
section("round-trip");

for (const [name, raw] of Object.entries(fixtures)) {
  await test(`${name} round-trips preserving pids and section keys`, () => {
    const b = parseBundle(raw);
    const patients = getSection(b, SECTION.PATIENTS) || [];
    const settings = getSection(b, SECTION.SETTINGS) || { deviceId: "", oRules: [], tags: [] };
    const meta = getSection(b, SECTION.META) || {};
    const history = getSection(b, SECTION.HISTORY);
    const rosterState = history ? {
      rosterId: b.rosterId,
      baseSnapshot: history.baseSnapshot,
      commits: history.commits || [],
      head: history.head,
    } : null;

    const projected = projectBundle({
      appState: { title: meta.title, patients },
      settings,
      rosterState,
    });
    const reparsed = parseBundle(projected);

    // Patient pids preserved through serialization
    const origPids = patients.map(p => p.pid);
    const newPids = (getSection(reparsed, SECTION.PATIENTS) || []).map(p => p.pid);
    assert.deepEqual(newPids, origPids);

    // Sections present in source survive projection (other than derived ones).
    if (getSection(b, SECTION.META)?.title) {
      assert.ok(getSection(reparsed, SECTION.META), "meta section retained");
    }
    if (history) {
      assert.ok(getSection(reparsed, SECTION.HISTORY), "history section retained");
    }
  });
}

// ============================
// 4) Warm boot: fixture in storage → store.js hydrates
// ============================
section("warm boot from fixture");

for (const [name, raw] of Object.entries(fixtures)) {
  await test(`${name} hydrates store.js`, async () => {
    localStorage.clear();
    if (raw.format === BUNDLE_FORMAT) {
      localStorage.setItem("rounds_v2_soap_ryoyo_ward_bundle_v1", JSON.stringify(raw));
    } else if (raw.appState) {
      localStorage.setItem("rounds_v2_soap_ryoyo_ward", JSON.stringify(raw.appState));
      if (raw.settings) {
        localStorage.setItem("rounds_v2_soap_ryoyo_ward_settings_v1", JSON.stringify(raw.settings));
      }
    }
    const store = await freshStore();

    // Title round-trips through normalizeLoaded
    const expectedTitle = raw.format === BUNDLE_FORMAT
      ? raw.sections?.meta?.title
      : raw.appState?.title;
    if (expectedTitle) {
      assert.equal(store.appState.title, expectedTitle);
    }

    // history section in fixture → rosterState non-null
    const hasHistory = raw.format === BUNDLE_FORMAT
      ? !!raw.sections?.history
      : !!(raw.appState?.baseSnapshot || (raw.appState?.commits || []).length);
    if (hasHistory) {
      assert.ok(store.rosterState, "rosterState should be hydrated when fixture has history");
    }

    // Patients are normalized to objects with all expected fields
    const samplePid = raw.format === BUNDLE_FORMAT
      ? raw.sections?.patients?.[0]?.pid
      : raw.appState?.patients?.[0]?.pid;
    if (samplePid) {
      const found = store.appState.patients.find(p => p.pid === samplePid);
      assert.ok(found, `patient ${samplePid} present after hydration`);
      assert.ok(found.vitals, "patient has vitals object");
      assert.ok(found.o, "patient has o object");
    }
  });
}

// ============================
// Summary
// ============================
console.log("");
if (failed > 0) {
  console.error(`${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
