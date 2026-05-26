// データ層の回帰検査。
//
// Vite ビルドは構文・import チェックしかしないので、モジュール初期化中の
// 実行時バグ（TDZ など）や、Bundle 形式のパース／射影の互換性は素通りする。
// このスクリプトは fixtures/*.json を順に読ませて、parseBundle・projectBundle・
// store.js のコールド／ウォームブートまで一通り走らせ、main の挙動に近い経路で
// データ層が壊れていないかを確認する。
//
// v4 以降: 永続化は IndexedDB だが Node には indexedDB が無いため、
// テストは「fixture を初期 bundle として直接 initStore に渡す」方式で
// 状態を仕込む (storage.js には触らない)。
//
// 使い方:   npm test

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ============================
// Browser API stubs
// ============================
// localStorage stub は legacy fallback 経路を含めて検査するため残す
// (IDB が空でかつ legacy localStorage に bundle がある時の挙動)
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

// store.js を「同じインスタンスで再初期化」するヘルパ。
// - opts.bundle: 直接渡せば storage を経由せず initStore がそれを採用
// - opts.legacy: localStorage に legacy bundle を仕込んでから initStore する
//   (storage.js の localStorage fallback 経路を検査するため)
//
// 注意: 以前は import URL に query string を付けてキャッシュバスティングしていたが、
// store.js と roster.js が別 module instance になると `rosterState` が共有されず
// テスト失敗するため、同じインスタンスを共有して _resetInitForTests で
// 内部状態だけリセットする方式に変更。
let _storeMod = null;
async function freshStore({ bundle = null, legacy = null } = {}) {
  if (!_storeMod) _storeMod = await import(storeUrl);
  _storeMod._resetInitForTests();
  localStorage.clear();
  if (legacy) {
    if (legacy.bundle) {
      localStorage.setItem("rounds_v2_soap_ryoyo_ward_bundle_v1", JSON.stringify(legacy.bundle));
    }
    if (legacy.appState) {
      localStorage.setItem("rounds_v2_soap_ryoyo_ward", JSON.stringify(legacy.appState));
    }
    if (legacy.settings) {
      localStorage.setItem("rounds_v2_soap_ryoyo_ward_settings_v1", JSON.stringify(legacy.settings));
    }
  }
  await _storeMod.initStore(bundle ? { bundle } : undefined);
  return _storeMod;
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

await test("empty storage → defaults populated", async () => {
  const store = await freshStore();
  assert.equal(store.appState.patients.length, 50, "50 default patient slots");
  assert.equal(store.appState.title, "回診");
  assert.equal(store.rosterState, null, "rosterState is null when nothing stored");
  assert.ok(Array.isArray(store.settings.formats) && store.settings.formats.length > 0, "default formats populated");
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
// 4) Warm boot: fixture as initStore seed
// ============================
section("warm boot from fixture");

for (const [name, raw] of Object.entries(fixtures)) {
  await test(`${name} hydrates store.js`, async () => {
    const store = await freshStore({ bundle: raw });

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
      assert.equal(typeof found.oFree, "string", "patient has oFree string");
      assert.equal(found.vitals, undefined, "legacy vitals removed after migration");
      assert.equal(found.o, undefined, "legacy o removed after migration");
    }
  });
}

// ============================
// 5) isPatientEmpty
// ============================
section("isPatientEmpty");

await test("default patient (status NONE, all empty) IS empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  assert.equal(store.isPatientEmpty(p), true);
});

await test("status NONE + name set is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.name = "山田";
  assert.equal(store.isPatientEmpty(p), false);
});

await test("status NONE + room set is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.room = "301";
  assert.equal(store.isPatientEmpty(p), false);
});

await test("status NONE + tag set is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.tags = ["A"];
  assert.equal(store.isPatientEmpty(p), false);
});

await test("status NONE + SOAP s is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.s = "発熱あり";
  assert.equal(store.isPatientEmpty(p), false);
});

await test("status NONE + memo is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.memo = "メモ";
  assert.equal(store.isPatientEmpty(p), false);
});

await test("status NONE + shared is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.shared = "共有";
  assert.equal(store.isPatientEmpty(p), false);
});

await test("status NONE + oFree text is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.oFree = "BP 128/76";
  assert.equal(store.isPatientEmpty(p), false);
});

await test("status GRAY (終了マーク) with empty fields is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.status = "gray";
  assert.equal(store.isPatientEmpty(p), false);
});

await test("status YELLOW with empty fields is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.status = "yellow";
  assert.equal(store.isPatientEmpty(p), false);
});

await test("status GREEN with empty fields is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.status = "green";
  assert.equal(store.isPatientEmpty(p), false);
});

await test("status BLUE with empty fields is NOT empty", async () => {
  const store = await freshStore();
  const p = store.makeDefaultPatient();
  p.status = "blue";
  assert.equal(store.isPatientEmpty(p), false);
});

// ============================
// 6) 旧 vitals / o 構造体マイグレーション → oFree
// ============================
section("legacy migration (vitals + o → oFree)");

await test("legacy vitals are folded into oFree text", async () => {
  const legacyBundle = {
    format: BUNDLE_FORMAT,
    schema: 1,
    sections: {
      meta: { title: "回診" },
      settings: {},
      patients: [{
        pid: "p_test_vit",
        status: "none",
        name: "",
        room: "",
        tags: [],
        s: "",
        memo: "",
        shared: "",
        vitals: { spo2: "95", spo2_memo: "O2 2L", bp_sys: "128", bp_dia: "76", pr: "72", rr: "18", bt: "36.8" },
        o: {},
        oFree: "",
        a: { text: "" },
        p: { text: "" },
      }],
    },
  };
  const store = await freshStore({ bundle: legacyBundle });
  const found = store.appState.patients.find(p => p.pid === "p_test_vit");
  assert.ok(found, "patient hydrated");
  assert.equal(found.vitals, undefined, "vitals stripped");
  assert.ok(found.oFree.includes("SpO2 95"), "SpO2 in oFree");
  assert.ok(found.oFree.includes("O2 2L"), "SpO2 memo in oFree");
  assert.ok(found.oFree.includes("BP 128/76"), "BP in oFree");
  assert.ok(found.oFree.includes("T 36.8") || found.oFree.includes("BT 36.8"), "BT in oFree");
});

await test("legacy o structured findings fold into oFree with labels", async () => {
  const legacyBundle = {
    format: BUNDLE_FORMAT,
    schema: 1,
    sections: {
      meta: { title: "回診" },
      settings: {
        oRules: [
          { key: "lung", label: "肺音", normalText: "明らかなラ音なし" },
          { key: "abdomen", label: "腹部", normalText: "平坦軟" },
        ],
      },
      patients: [{
        pid: "p_test_o",
        status: "none",
        name: "",
        room: "",
        tags: [],
        s: "",
        memo: "",
        shared: "",
        o: {
          lung: { normal: true, note: "" },
          abdomen: { normal: false, note: "圧痛あり" },
        },
        oFree: "",
        a: { text: "" },
        p: { text: "" },
      }],
    },
  };
  const store = await freshStore({ bundle: legacyBundle });
  const found = store.appState.patients.find(p => p.pid === "p_test_o");
  assert.ok(found, "patient hydrated");
  assert.equal(found.o, undefined, "structured o stripped");
  assert.ok(found.oFree.includes("肺音：明らかなラ音なし"), "lung normal text injected");
  assert.ok(found.oFree.includes("腹部：圧痛あり"), "abdomen note injected");
});

await test("existing oFree is preserved when vitals/o also present", async () => {
  const legacyBundle = {
    format: BUNDLE_FORMAT,
    schema: 1,
    sections: {
      meta: { title: "回診" },
      settings: {},
      patients: [{
        pid: "p_test_both",
        status: "none",
        name: "",
        room: "",
        tags: [],
        s: "",
        memo: "",
        shared: "",
        vitals: { spo2: "98" },
        o: {},
        oFree: "既存メモ",
        a: { text: "" },
        p: { text: "" },
      }],
    },
  };
  const store = await freshStore({ bundle: legacyBundle });
  const found = store.appState.patients.find(p => p.pid === "p_test_both");
  assert.ok(found.oFree.includes("既存メモ"), "existing oFree preserved");
  assert.ok(found.oFree.includes("SpO2 98"), "migrated SpO2 appended");
});

// ============================
// 7) フォーマット (formats[]) 設計サニティ
// ============================
section("formats");

await test("default formats include バイタル (numeric) and 身体所見 (text)", async () => {
  const store = await freshStore();
  const fmts = store.settings.formats;
  assert.ok(Array.isArray(fmts) && fmts.length >= 2, "at least 2 default formats");
  const vital = fmts.find(f => f.name === "バイタル");
  const phys = fmts.find(f => f.name === "身体所見");
  assert.ok(vital, "バイタル exists");
  assert.equal(vital.type, "numeric");
  assert.equal(vital.panel, "O");
  assert.equal(vital.pinned, true);
  assert.ok(phys, "身体所見 exists");
  assert.equal(phys.type, "text");
  assert.equal(phys.panel, "O");
});

await test("settings.defaults is removed from defaultSettings", async () => {
  const store = await freshStore();
  assert.equal(store.settings.defaults, undefined, "no defaults field");
});

await test("legacy settings.defaults.{a,p} migrate to isDefault text formats", async () => {
  const legacyBundle = {
    format: BUNDLE_FORMAT,
    schema: 1,
    sections: {
      meta: { title: "回診" },
      settings: {
        defaults: { s: "", a: "著変なし", p: "現行加療継続" },
      },
      patients: [],
    },
  };
  const store = await freshStore({ bundle: legacyBundle });
  const fmts = store.settings.formats;
  const aDef = fmts.find(f => f.panel === "A" && f.isDefault);
  const pDef = fmts.find(f => f.panel === "P" && f.isDefault);
  const sDef = fmts.find(f => f.panel === "S" && f.isDefault);
  assert.ok(aDef, "A panel got an isDefault format");
  assert.equal(aDef.type, "text");
  assert.equal(aDef.items[0].normal, "著変なし");
  assert.ok(pDef, "P panel got an isDefault format");
  assert.equal(pDef.items[0].normal, "現行加療継続");
  assert.equal(sDef, undefined, "empty S default did NOT create a format");
});

// ============================
// 8) localStorage legacy fallback: 旧 v3 ユーザの初回起動 → IDB 無しでも
// 既存 localStorage から bundle を拾えること
// ============================
section("localStorage legacy fallback (storage.js)");

await test("storage.loadBundle picks up legacy localStorage bundle when IDB unavailable", async () => {
  const storageUrl = pathToFileURL(join(srcDir, "storage.js")).href;
  const storage = await import(storageUrl + `?t=${Math.random()}`);
  localStorage.clear();
  const legacyBundle = {
    format: BUNDLE_FORMAT,
    schema: 1,
    sections: {
      meta: { title: "持ち越し" },
      settings: {},
      patients: [],
    },
  };
  localStorage.setItem("rounds_v2_soap_ryoyo_ward_bundle_v1", JSON.stringify(legacyBundle));
  const loaded = await storage.loadBundle();
  assert.ok(loaded, "loadBundle returned non-null");
  assert.equal(loaded.sections.meta.title, "持ち越し");
});

await test("storage.loadBundle returns null on clean state", async () => {
  const storageUrl = pathToFileURL(join(srcDir, "storage.js")).href;
  const storage = await import(storageUrl + `?t=${Math.random()}`);
  localStorage.clear();
  const loaded = await storage.loadBundle();
  assert.equal(loaded, null);
});

// ============================
// 9) roster compactHistory: 古い commit を baseSnapshot に折りたたむ
// ============================
section("roster compactHistory (30日ローリング)");

// freshStore と同じ instance を使うことで rosterState を roster.js と共有
const rosterUrl = pathToFileURL(join(srcDir, "features", "roster.js")).href;
const rosterMod = await import(rosterUrl);

await test("compactHistory folds old commits into baseSnapshot", async () => {
  const store = await freshStore();
  // admin を有効にして rosterState が記録される状態に
  store.settings.adminEnabled = true;
  rosterMod.ensureRosterState();

  const now = Date.now();
  // baseSnapshot は空、commits に「40日前」と「3日前」を 1 つずつ仕込む
  store.rosterState.baseSnapshot = { patients: [], tags: [], ts: now - 60 * 86400_000 };
  store.rosterState.commits = [
    {
      id: "c1", parent: null, ts: now - 40 * 86400_000, deviceId: "x",
      ops: [{ type: "add", at: 0, patient: { pid: "p1", name: "古い患者", room: "101", tags: [] } }],
    },
    {
      id: "c2", parent: "c1", ts: now - 3 * 86400_000, deviceId: "x",
      ops: [{ type: "add", at: 1, patient: { pid: "p2", name: "新しい患者", room: "102", tags: [] } }],
    },
  ];

  const changed = rosterMod.compactHistory(30);
  assert.equal(changed, true, "compaction reported changes");
  assert.equal(store.rosterState.commits.length, 1, "only the recent commit remains");
  assert.equal(store.rosterState.commits[0].id, "c2");
  assert.equal(store.rosterState.baseSnapshot.patients.length, 1, "old commit was folded in");
  assert.equal(store.rosterState.baseSnapshot.patients[0].name, "古い患者");
});

await test("compactHistory is idempotent when no old commits", async () => {
  const store = await freshStore();
  store.settings.adminEnabled = true;
  rosterMod.ensureRosterState();

  const now = Date.now();
  store.rosterState.commits = [
    { id: "c1", parent: null, ts: now - 1 * 86400_000, deviceId: "x", ops: [] },
  ];
  const changed = rosterMod.compactHistory(30);
  assert.equal(changed, false, "no compaction when all commits are recent");
  assert.equal(store.rosterState.commits.length, 1);
});

// ============================
// 10) storage workspace API: createWorkspaceRecord / getActiveWorkspaceId
// ============================
section("storage workspace API");

await test("getActiveWorkspaceId returns 'default' when unset", async () => {
  const storageUrl = pathToFileURL(join(srcDir, "storage.js")).href;
  localStorage.clear();
  const storage = await import(storageUrl + `?t=${Math.random()}`);
  assert.equal(storage.getActiveWorkspaceId(), "default");
});

await test("setActiveWorkspaceId persists via localStorage", async () => {
  const storageUrl = pathToFileURL(join(srcDir, "storage.js")).href;
  localStorage.clear();
  const storage = await import(storageUrl + `?t=${Math.random()}`);
  storage.setActiveWorkspaceId("ws_test123");
  assert.equal(storage.getActiveWorkspaceId(), "ws_test123");
});

await test("newWorkspaceId is unique and prefixed 'ws_'", async () => {
  const storageUrl = pathToFileURL(join(srcDir, "storage.js")).href;
  const storage = await import(storageUrl + `?t=${Math.random()}`);
  const a = storage.newWorkspaceId();
  const b = storage.newWorkspaceId();
  assert.ok(a.startsWith("ws_"));
  assert.ok(b.startsWith("ws_"));
  assert.notEqual(a, b);
});

// ============================
// 11) i18n: t() ヘルパが strings.ja.json を引けること
// ============================
section("i18n");

await test("t() resolves known key", async () => {
  const { t } = await import("../src/i18n.js");
  assert.equal(t("common.save"), "保存");
  assert.equal(t("common.cancel"), "キャンセル");
});

await test("t() interpolates {placeholder} params", async () => {
  const { t } = await import("../src/i18n.js");
  const s = t("format.delete.confirm", { name: "バイタル" });
  assert.ok(s.includes("バイタル"), "name placeholder filled");
});

await test("t() returns key on missing entry", async () => {
  const { t } = await import("../src/i18n.js");
  const out = t("totally.unknown.key.xyz");
  assert.equal(out, "totally.unknown.key.xyz");
});

// ============================
// 9b) passphrase strength: 12 文字未満は短すぎる扱い、文字種多様性でスコア加算
// ============================
section("passphrase strength");

await test("computePassphraseStrength: < 12 chars is tooShort (score 0)", async () => {
  const m = await import("../src/features/passphrase-strength.js");
  assert.equal(m.PASSPHRASE_MIN_LEN, 12);
  assert.deepEqual(m.computePassphraseStrength(""), { score: 0, level: "empty" });
  assert.equal(m.computePassphraseStrength("short").level, "tooShort");
  assert.equal(m.computePassphraseStrength("abcdefghijk").level, "tooShort"); // 11 chars
});

await test("computePassphraseStrength: 12+ chars gets at least weak", async () => {
  const m = await import("../src/features/passphrase-strength.js");
  const r = m.computePassphraseStrength("abcdefghijkl");
  assert.ok(r.score >= 1);
  assert.ok(r.level !== "tooShort" && r.level !== "empty");
});

await test("computePassphraseStrength: char-class diversity raises score", async () => {
  const m = await import("../src/features/passphrase-strength.js");
  const weak = m.computePassphraseStrength("aaaaaaaaaaaa"); // 12 lowers only
  const strong = m.computePassphraseStrength("Abcdefgh1234!@");  // 14 with mix
  assert.ok(strong.score > weak.score);
});

// ============================
// 10) defaults.json: 既定値が JSON 由来で読み込めること
// ============================
section("defaults.json");

await test("DEFAULT_FORMATS comes from defaults.json", async () => {
  const c = await import("../src/constants.js");
  assert.ok(Array.isArray(c.DEFAULT_FORMATS));
  assert.equal(c.DEFAULT_FORMATS.length, 2);
  assert.equal(c.DEFAULT_FORMATS[0].name, "バイタル");
  assert.equal(c.DEFAULT_PATIENT_COUNT, 50);
});

// ============================
// Summary
// ============================
console.log("");
if (failed > 0) {
  console.error(`${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`${passed} passed`);
