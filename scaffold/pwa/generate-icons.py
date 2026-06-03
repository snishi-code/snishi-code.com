"""PWA アイコン生成スクリプト（snishi-code.com 共通テンプレート / 正本）

新規 PWA を作るときの「型」。`scaffold/pwa/` 一式を新アプリの `scripts/` へコピーし、
下の「このアプリの設定」だけ書き換えて実行する。回診アプリ(hospital-rounds)で
実運用している方式をそのまま一般化したもの。

やること:
  - 1 枚のソース画像（透明背景 + ブランド色ロゴ）を、白い正方形キャンバスの中央に
    Chrome アイコン風の余白で配置（白カードに色付きロゴが浮く見た目）。
  - manifest を `purpose: "any maskable"` にしておくとランチャーが squircle にマスクし、
    白い角が落ちて Chrome 風になる。
  - 本番版（ソース色そのまま）と、テスト版（ブランド色→灰に置換＝環境を見分ける）を生成。
  - 192 / 512 / 180(apple-touch) / 32(favicon) を `public/icons/` に出力。

ソース画像:
  - 推奨: Figma 等から **1024px 以上の正方形 PNG（透明背景）** を書き出して `icon-source.png` に置く。
  - SVG も可（`icon-source.svg`）。その場合 cairosvg が必要（無ければ PNG 書き出しを使う旨を表示）。

依存: Pillow（`pip install Pillow`）。SVG 入力時のみ cairosvg（`pip install cairosvg`）。
"""
import os
from PIL import Image

# ===================== このアプリの設定（ここだけ編集） =====================
SOURCE = "icon-source.png"          # ソース画像（透明背景 + ブランド色ロゴ）。.svg も可
OUT_DIR = "../public/icons"         # 出力先（アプリの public/icons を指すように）
SOURCE_BRAND_COLOR = (37, 99, 235)  # ソース内のブランド色 = #2563eb（テスト版でこの色を置換）
TEST_COLOR = (71, 85, 105)          # テスト版の色 = #475569（slate / neutral）。本番と見分ける用
# ==========================================================================

# レイアウト（通常いじらない）: 白い正方形の中央にロゴを配置。占有比は「主観」ではなく
# maskable アイコンの **セーフゾーン仕様** に基づく:
#   - Web maskable (W3C): 主要素は中央の直径80%円（半径40%）内に収める。
#   - Android adaptive: 108dp 中 可視72dp=2/3、常時可視のセーフ円は66dp≒61%。
#   どのマスク形（円/squircle/角丸）でも欠けない範囲が「2/3」。白カードに浮かせる
#   Chrome 風では 2/3 が定番（セーフゾーン内に余裕があり、角の欠けも起きない）。
REF_SIDE = 1024
CIRCLE_RATIO = 2 / 3
SIZES = [
    (192, "icon-192"),
    (512, "icon-512"),
    (180, "apple-touch-icon"),
    (32,  "favicon"),
]


def load_source(path):
    """ソースを RGBA で読む。SVG なら cairosvg で高解像度ラスタライズ。"""
    if path.lower().endswith(".svg"):
        try:
            import cairosvg
        except ImportError:
            raise SystemExit(
                "SVG 入力には cairosvg が必要です（pip install cairosvg）。\n"
                "入れたくない場合は Figma 等から 1024px 以上の透明 PNG を書き出し、\n"
                f"SOURCE を PNG に変えてください。"
            )
        png_bytes = cairosvg.svg2png(url=path, output_width=REF_SIDE, output_height=REF_SIDE)
        import io
        return Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    return Image.open(path).convert("RGBA")


def recolor_brand_to(src, target):
    """ソースのブランド色を target 色へ置換（白いロゴ部分はそのまま）。
    ブランド色→白の直線軸にピクセルを射影し、t=0 で target、t=1 で白に再合成。
    AA エッジ（色と白のグラデ）も滑らかに追随。透明ピクセルはそのまま。"""
    sb_r, sb_g, sb_b = SOURCE_BRAND_COLOR
    vr, vg, vb = 255 - sb_r, 255 - sb_g, 255 - sb_b
    vv = vr * vr + vg * vg + vb * vb
    tr, tg, tb = target

    out = Image.new("RGBA", src.size)
    sp = src.load()
    op = out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = sp[x, y]
            if a == 0:
                op[x, y] = (0, 0, 0, 0)
                continue
            ur, ug, ub = r - sb_r, g - sb_g, b - sb_b
            t = (ur * vr + ug * vg + ub * vb) / vv if vv > 0 else 0.0
            t = max(0.0, min(1.0, t))
            op[x, y] = (
                round((1 - t) * tr + t * 255),
                round((1 - t) * tg + t * 255),
                round((1 - t) * tb + t * 255),
                a,
            )
    return out


def compose_onto_white_square(src):
    """src を白い正方形キャンバスの中央へ CIRCLE_RATIO 比で配置（Chrome アイコン風）。"""
    bbox = src.getbbox()
    if bbox is None:
        raise RuntimeError("source is fully transparent")
    cropped = src.crop(bbox)
    cw, ch = cropped.size
    target_max = int(REF_SIDE * CIRCLE_RATIO)
    scale = target_max / max(cw, ch)
    new_w, new_h = max(1, round(cw * scale)), max(1, round(ch * scale))
    scaled = cropped.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (REF_SIDE, REF_SIDE), (255, 255, 255, 255))
    paste_x = (REF_SIDE - new_w) // 2
    paste_y = (REF_SIDE - new_h) // 2
    canvas.paste(scaled, (paste_x, paste_y), scaled)
    return canvas


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    src = load_source(SOURCE)

    prod_canvas = compose_onto_white_square(src)
    test_canvas = compose_onto_white_square(recolor_brand_to(src, TEST_COLOR))

    for suffix, canvas in [("", prod_canvas), ("-test", test_canvas)]:
        for size, base in SIZES:
            resized = canvas.resize((size, size), Image.LANCZOS)
            path = f"{OUT_DIR}/{base}{suffix}.png"
            resized.save(path, optimize=True)
            print(f"  saved {path} ({size}x{size})")


if __name__ == "__main__":
    main()
