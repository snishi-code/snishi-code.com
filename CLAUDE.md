# CLAUDE.md — snishi-code.com (apex / 入口サイト)

## このリポジトリについて

`snishi-code.com` (apex) の**入口サイトだけ**を管理する。アプリ本体はここには無い。

Origin 分離により、アプリは別サブドメイン (= 別 origin) に分離した:

| origin | repo | 内容 |
|---|---|---|
| `snishi-code.com` (apex) | **このリポ** `snishi-code.com` | カテゴリ入口 (医療/個人へのリンク) |
| `medical.snishi-code.com` (本番) / `medical-dev.snishi-code.com` (テスト) | `snishi-code-medical` | 医療アプリ (回診ほか) |
| `personal.snishi-code.com` (本番) / `personal-dev.snishi-code.com` (テスト) | `snishi-code-personal` | 個人アプリ |

- main = 本番 / dev = テスト。
- このリポは**静的サイトのみ** (ビルド不要)。`index.html` / `shared.css` / `site-links.js` だけ。

## サイト横断リンクの管理 (重要)

カテゴリをまたぐリンク (apex ↔ medical ↔ personal) は origin が違うため絶対 URL になる。
URL を各 HTML に直書きせず、**`site-links.js` の 1 箇所**で管理する。

- HTML 側は `href` を書かず `data-link="medical"` のように属性で参照する。
- `site-links.js` の**正本 (master) はこの apex リポ**。medical / personal リポにも同一内容の
  コピーがある (別 origin のファイルはブラウザが共有できないため物理コピーが必要)。
- URL を変えるときは、まずこの正本を直し、各リポのコピーへ反映する。

## env (本番/テスト) 判定 — apex には不要

apex は本番のみ (テスト用サブドメインを持たない) ので env 判定は無い。
アプリ側 (medical / personal) はホスト名の規約ベースで判定する:
`-dev.` サブドメイン / `*.pages.dev` / `localhost` を test、それ以外を prod とする
(特定ドメインを直書きしない)。

## デザイン方針 (apex = neutral)

apex (サイト全体の入口) は**青や緑のイメージカラーを使わない** (neutral)。

- 主色: **neutral** `#475569` (slate-600)、アクセント `#f1f5f9` / `#cbd5e1`
- badge は `badge-neutral`、リンクは muted/neutral 系
- 医療カテゴリへの導線カードは blue 系 (`cat-card-blue`)、個人は teal 系 (`cat-card-green`) を
  「カテゴリの色見本」として使うのは可。だが apex 自身のヘッダー/ロゴ/バッジは neutral を保つ
- カラー変数は `shared.css` の `:root` で一元管理 (`--blue` / `--green` / `--neutral` + `-light` / `-border`)。直接ハードコードしない
- 背景: `--bg: #f8fafc`。サーフェスは白 `#ffffff`
- ビビッド系 (黄・赤)・癖の強い紫はサイト共通色として採用しない

### サイトロゴ

- コード括弧 `</>` (snishi-code を表す)。十字・宗教的シンボルは避ける
- 医療カテゴリ代表アイコン = 心電図波形 (heartbeat)、個人カテゴリ代表 = 家 (home)

## データ・配信の原則 (全 origin 共通の根本方針)

- **外部送信禁止**: ユーザー入力データは端末内のみ。`fetch` / `XMLHttpRequest` / `WebSocket` /
  `navigator.sendBeacon` による個人データ外部送信は実装しない。GA / Sentry 等のトラッキングも入れない
- **オフライン動作前提**。外部 CDN からの読み込みは使わない (バンドルに含める)
- apex 自体はデータを持たない静的サイトだが、上記はサイト全体の看板であり守る
