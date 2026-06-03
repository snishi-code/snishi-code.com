# PWA アイコン/配線 テンプレート（snishi-code.com 共通・正本）

新規 PWA を作るときの「型」。回診アプリ（hospital-rounds）で実運用している方式を一般化したもの。
**正本はこのフォルダ（apex リポ）**。新アプリへはコピーして使う（別 origin + 完全オフラインのため参照不可）。

## 含まれるもの

| ファイル | 役割 |
|---|---|
| `generate-icons.py` | 1 枚のソース画像から PWA 用 PNG（192/512/180/32）を本番/テスト2系統で生成 |
| `manifest.template.json` | `manifest.json` の雛形（`__APP_NAME__` 等を置換） |
| `head.template.html` | `<head>` に貼る PWA 配線（CSP・env判定・manifest/icon・test差替・apple metas） |

## デザイン方針（全アプリ共通）

- **Chrome 風**: 白背景にロゴが浮く。ソースは「透明背景 + ブランド色ロゴ」、白い正方形の中央へ 68% で配置。
- `purpose: "any maskable"` によりランチャーが squircle にマスクし、白角が落ちて Chrome 風になる。
- **テスト版は色を slate(#475569) に置換**して本番と一目で見分ける。

## 手順（新規 PWA）

1. このフォルダ一式を新アプリの `scripts/` へコピー。
2. ロゴを用意して `scripts/icon-source.png` に置く。
   - 推奨: **Figma 等から 1024px 以上の正方形 PNG（透明背景）** を書き出す。
   - SVG（`icon-source.svg`）でも可。その場合のみ `pip install cairosvg`。無ければ PNG 書き出しが手軽。
3. `generate-icons.py` 冒頭の「このアプリの設定」を編集（`SOURCE_BRAND_COLOR` をロゴの色に、`OUT_DIR` を確認）。
4. 実行: `cd scripts && python3 generate-icons.py` → `public/icons/` に 8 枚（本番4 + テスト4）生成。
5. `manifest.template.json` を `public/manifest.json` にコピーし `__APP_NAME__` / `__APP_SHORT__` / `__APP_DESC__` を置換。
   テスト用 `public/manifest-test.json` も同様に作る（中身は同じで可）。
6. `head.template.html` の中身を `index.html` の `<head>` に貼り、`__APP_SHORT__` を置換。
7. ブラウザの DevTools → Application → Manifest でアイコンが出るか確認。実機はホーム画面に追加して確認。

## 依存

- `pip install Pillow`（必須）
- `pip install cairosvg`（SVG 入力時のみ。PNG ソースなら不要）

## メモ

- 外部送信ゼロ方針（憲法）の担保として、`head.template.html` の CSP は `connect-src 'self'`。
  QR 等で `data:`/`blob:` 画像を使う場合のみ `img-src`/`media-src` を調整する（既定で許可済み）。
- 生成された PNG はコミットしてよい（`public/icons/`）。`dist/` はコミットしない。
