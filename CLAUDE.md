# CLAUDE.md — 開発方針

## このリポジトリについて

snishi-code.com のソースリポジトリ。医療・個人向けの PWA / 単一HTMLアプリを開発・配信する。

## データ設計の原則（必ず守ること）

- **外部送信禁止**: ユーザーが入力したデータは端末内にのみ保存する
  - `fetch` / `XMLHttpRequest` / `WebSocket` / `navigator.sendBeacon` 等による個人・患者データの外部送信は一切実装しない
  - Google Analytics、Sentry、Mixpanel 等のトラッキング・エラー収集ライブラリは導入しない
- **ストレージ**: アプリデータ本体は **IndexedDB**。小さなポインタ・初回起動マーカーなど数バイトの値は `localStorage` を許容 (同期 API で読みたい用途のみ)。外部DBやクラウド同期は使わない
- **オフライン動作前提**: ネット接続がなくても全機能が使えるように設計する

## 配布・ビルド

- **PWA** または **Vite + vite-plugin-singlefile による単一HTML** を基本とする
- 単一HTMLは CSS・JS をすべてインライン化し、ファイル1つで動作すること
- ビルド成果物（`dist/`）はコミットしない。Cloudflare Pages がビルドする

## ライブラリ方針

- 外部CDNからの読み込みは使わない（オフライン動作のため、ライブラリはバンドルに含める）
- ライブラリを直接ソースに埋め込む場合はライセンス表記をファイル先頭に残す

---

## デザイン方針

### イメージカラーとフォルダの対応

リポジトリのフォルダ構成と、それぞれが採用するイメージカラー：

| スコープ | フォルダ | 主色 (`var(--xxx)`) | アクセント | 用途 |
|---|---|---|---|---|
| サイト全体（ルート） | `/` (`index.html`) | **neutral** `#475569` (slate-600) | `#f1f5f9` / `#cbd5e1` | カテゴリを並べる入口・ヘッダー・ロゴ背景 |
| 医療カテゴリ | `/medical/`、配下の各医療アプリ（例 `/hospital-rounds/`） | **blue** `#2563eb` | `#eff6ff` / `#bfdbfe` | バッジ・カードアイコン背景・リンク色 |
| 個人カテゴリ | `/personal/`、配下の各個人アプリ | **green (teal)** `#14b8a6` | `#f0fdfa` / `#5eead4` | バッジ・カードアイコン背景・リンク色 |

ルールの要点：
- **ルート画面（全体）では青や緑のイメージカラーは使わない**。badge は `badge-neutral`、リンクは muted/neutral 系を使う
- **医療配下のページ**は青系で統一。`badge-blue` / `cat-card-blue` / `app-icon-blue` 等のクラスを利用
- **個人配下のページ**は teal 系（色盲対応）で統一。`badge-green` / `cat-card-green` / `app-icon-green` 等のクラスを利用（クラス名は歴史的経緯で `green` だが、実値は teal）
- 新規アプリを `/medical/` または `/personal/` 配下に追加する場合は、その配下の主色に従ってデザインする

カラー変数は `shared.css` の `:root` で一元管理（`--blue` / `--green` / `--neutral` + `-light` / `-border`）。直接ハードコードしない。

- **背景**: `--bg: #f8fafc`（near-white slate）。サーフェスは白 `#ffffff`
- ビビッド系（黄・赤）、癖の強い紫はサイト共通色として採用しない

### カテゴリアイコン

- **医療カテゴリの代表アイコン**: 心電図波形（heartbeat / pulse）。`<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>` のような線
- **個人カテゴリの代表アイコン**: 家のシルエット（home）
- **サイトロゴ**: コード括弧 `</>`（snishi-code を表す）。十字・宗教的シンボルは避ける

### 個別アプリのアイコン

- 各アプリは**カテゴリ色 + 固有の形**で識別する。カテゴリ色だけの汎用アイコンは禁止（複数アプリ間で見分けがつかなくなる）
- 例: 回診 = 青背景 + クリップボード
- **十字（+ 形）アイコンは使わない**:
  - 赤十字・赤新月はジュネーブ条約で保護されている
  - 十字はキリスト教を強く連想し、イスラム教圏では文化的に違和感
  - 「医療らしさ」を出したい場合は心電図・聴診器・薬剤などのシンボルを使う

### 色覚多様性への配慮

- ステータス色（黄/緑/灰/青）は **D/P型（赤緑色盲）** でも判別可能なパレットを使う。
  ペール (背景) + 濃い枠 + 濃い文字の3層構成で、明度差と hue family の両方を保つ:
  - 黄: bg `#fef3c7` / 枠 `#d97706` (amber-600) / 文字 `#92400e`
  - 緑: bg `#dcfce7` / 枠 `#16a34a` (green-600) / 文字 `#166534`
    （旧 teal-500 系から純緑系へ。ペール化で teal だと青と混ざるため）
  - 灰: bg `#9ca3af` / 枠 `#374151` / 文字 `#111827`
    （灰は「終了済みで目立たせたくない」用途のため bg を gray-200 → gray-400 に一段濃くする。色覚配慮の3層構造は維持）
  - 青: bg `#bfdbfe` / 枠 `#2563eb` / 文字 `#1e3a8a`
- ステータスボタン内には**形マーク**（チェック/ポーズ/×）を入れ、色だけに依存しないようにする
- 一覧UIなどで形マークが邪魔になる場合は色のみで可（色だけでも明度差で識別可能なパレット）

### UI・i18n 戦略

- **アイコン中心の UI**: 日本語テキストを極力減らし、UI そのものを言語非依存に保つ
- 全アイコンに `title` / `aria-label` を付与（スクリーンリーダー対応 + i18n key 化の足場）
- ユーザー向け説明は **「？」ボタン → 説明書 HTML** に集約。多言語化は説明書HTMLだけ用意すれば済む構造

### i18n 実装ルール (新規 UI 追加時は必ず適用)

各アプリには `src/strings.<lang>.json` (例: `strings.ja.json`) と `src/i18n.js` の基盤がある。**ユーザの目に触れる文字列を直接ハードコードしてはいけない**。

**ステップ:**

1. **キー追加**: `src/strings.ja.json` に `"feature.scope.purpose": "実際の文言"` を追加。プレースホルダは `{name}` 形式
2. **静的 HTML**: 属性で記述
   ```html
   <button data-i18n="common.save">保存</button>
   <button data-i18n-title="patient.delete" data-i18n-aria="patient.delete">×</button>
   <input data-i18n-placeholder="format.placeholder.name" />
   ```
   起動時に `applyI18n()` が `t()` で展開する
3. **動的 JS で生成する DOM**: `import { t } from "../i18n.js"` して `t("key")` を直接呼ぶ
   ```js
   btn.textContent = t("common.save");
   btn.title = t("common.delete");
   alert(t("import.read.failed"));
   if (!confirm(t("format.delete.confirm", { name: fmt.name }))) return;
   ```
4. **既存キーを再利用**: `common.*` (save / cancel / close / delete / edit / add / apply / normal …) は最初に確認。同じ意味で別キーを増やさない

**禁止事項:**

- `alert("..." )` / `confirm("...")` / `prompt("...")` に日本語リテラルを直接書く
- `el.textContent = "..."` で UI 用語を書く (技術的な定数文字列なら OK)
- `el.title = "..."` / `setAttribute("aria-label", "...")` を直接書く
- CSS の `content:` に翻訳対象テキストを書く (`:empty::before` 等)。これらは JS で要素を作って `t()` を使う

**例外 (i18n 不要)**:
- console.log / console.warn / console.error の引数 (開発者向けログ)
- データ層のフィールド名・定数キー (例: `STATUS.YELLOW = "yellow"`)
- 形マーク類 (例: `★`, `+`, `-`) と SVG path

確認ダイアログだけでなく、**ツールチップ・aria-label・placeholder・popup タイトル・成功/失敗メッセージなど全てが対象**。新機能追加 PR を書く時は最後に `grep -n '"[ぁ-んァ-ヶ一-龯]"' src/` で漏れがないか確認すると良い。

### アクセシビリティの基本

- ステータス・選択状態を色だけで示さない（形・アイコン・テキスト併用）
- タッチ操作ターゲットは最小 44×44px を意識
- 長押し・ドラッグなど発見しづらい操作には別の入口（ボタンや明示UI）も用意
