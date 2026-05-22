"""PWA アイコン生成スクリプト

`scripts/icon-source.png` (作者作成のソース画像) を読み、Chrome 風の
「白背景の中に色付き円、その中に白いロゴ」レイアウトで合成する。

  - 背景 (ライトグレー) を透明化
  - ソースの白いロゴストロークだけを抽出 (青の地は破棄)
  - 白い正方形キャンバスの中央に色付き円を描く (本番=青 / テスト=スレート)
  - 抽出したロゴを円の中央に重ねる
  - 192 / 512 / 180 px へリサイズして `public/icons/` に保存

「ヘッダー左上のロゴバッジ」と同じ視覚構造を PWA アイコンにも適用するため、
アプリ正方形 → 色付き円 → 白いロゴ、という Chrome アイコンのような階層に
する。ロゴ自体のデザイン (心電図 + 循環矢印) は icon-source.png から
そのまま流用 (改変なし)。

依存: Pillow (`pip install Pillow`)。アイコン再生成のたびに使う一回限り
のスクリプトなので、ランタイム本体には影響しない。
"""
import os
from PIL import Image, ImageDraw, ImageFilter

SRC = os.path.join(os.path.dirname(__file__), "icon-source.png")
OUT_DIR = "public/icons"

# 元画像の青 (作者画像から実測)
ICON_BLUE = (4, 92, 202)
ICON_WHITE = (255, 255, 255)

# 出力色 (アプリ内で使っているのと同じコード)
BLUE_TARGET = (37, 99, 235)   # #2563eb (本番)
SLATE_TARGET = (71, 85, 105)  # #475569 (テスト、snishi-code.com トップと同色)

SIZES = [
    (192, "icon-192"),
    (512, "icon-512"),
    (180, "apple-touch-icon"),
]


def is_background(r, g, b):
    """ライトグレー背景か判定。R≈G≈B (差 ≤ 6) かつ平均輝度 220〜250。"""
    diff = max(r, g, b) - min(r, g, b)
    avg = (r + g + b) / 3
    return diff <= 6 and 220 <= avg <= 250


def t_along_blue_white(r, g, b):
    """ピクセルを (ICON_BLUE → ICON_WHITE) の RGB 軸に射影して t を返す。"""
    ur = r - ICON_BLUE[0]
    ug = g - ICON_BLUE[1]
    ub = b - ICON_BLUE[2]
    vr = ICON_WHITE[0] - ICON_BLUE[0]
    vg = ICON_WHITE[1] - ICON_BLUE[1]
    vb = ICON_WHITE[2] - ICON_BLUE[2]
    dot = ur * vr + ug * vg + ub * vb
    vv = vr * vr + vg * vg + vb * vb
    t = dot / vv if vv > 0 else 0.0
    return max(0.0, min(1.0, t))


def extract_logo_alpha(pixel):
    """ピクセルの「白み度」を 0-255 で返す。青の地は 0、白いロゴは 255、
    AA は中間値。下流で morphology + 閾値で偽陽性 (角丸エッジ) を消す。"""
    r, g, b = pixel[:3]
    if is_background(r, g, b):
        return 0
    t = t_along_blue_white(r, g, b)
    return round(t * 255)


# レイアウト比率: ヘッダー左上の .appLogo (32px 円 + 22px SVG) に近づけた値。
# Chrome のアイコンも円が正方形をほぼ埋め尽くし、ロゴが円の 50-60% 程度。
REF_SIDE = 1024
CIRCLE_RATIO = 0.94   # 円直径 / 正方形辺 (角に薄く白マージン)
LOGO_TO_CIRCLE = 0.62  # ロゴ最大寸 / 円直径


def process(target_color):
    src = Image.open(SRC).convert("RGB")
    w, h = src.size
    sp = src.load()
    # 白み度を 1ch (alpha) で構築。青↔白の射影 t * 255 を入れる。
    alpha_mask = Image.new("L", (w, h), 0)
    ap = alpha_mask.load()
    for y in range(h):
        for x in range(w):
            ap[x, y] = extract_logo_alpha(sp[x, y])
    # Morphological opening = erode -> dilate。細い線 (青の角丸エッジ AA)
    # を消し、太い線 (ロゴ本体) を保つ。ロゴストロークは ~30-50px 幅、
    # 角丸エッジは ~2-3px 幅 なので 7px の min/max で十分分離できる。
    alpha_mask = alpha_mask.filter(ImageFilter.MinFilter(7))  # erode
    alpha_mask = alpha_mask.filter(ImageFilter.MaxFilter(7))  # dilate
    # mask + 白で RGBA を組み立て
    logo = Image.merge("RGBA", (
        Image.new("L", (w, h), 255),
        Image.new("L", (w, h), 255),
        Image.new("L", (w, h), 255),
        alpha_mask,
    ))
    bbox = logo.getbbox()
    if bbox is None:
        raise RuntimeError("No logo pixels detected; check ICON_BLUE / is_background")
    cropped_logo = logo.crop(bbox)
    cw, ch = cropped_logo.size

    # 白い正方形キャンバスに色付き円を描き、その中央にロゴを配置。
    # 全体は不透明 (Chrome の maskable icon 要件を満たす)。
    circle_d = int(REF_SIDE * CIRCLE_RATIO)
    target_logo_max = int(circle_d * LOGO_TO_CIRCLE)
    scale = target_logo_max / max(cw, ch)
    new_w, new_h = max(1, int(cw * scale)), max(1, int(ch * scale))
    scaled_logo = cropped_logo.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGBA", (REF_SIDE, REF_SIDE), (255, 255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    cx = cy = REF_SIDE // 2
    r = circle_d // 2
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=target_color + (255,))

    paste_x = (REF_SIDE - new_w) // 2
    paste_y = (REF_SIDE - new_h) // 2
    canvas.paste(scaled_logo, (paste_x, paste_y), scaled_logo)
    return canvas


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    variants = [("", BLUE_TARGET), ("-test", SLATE_TARGET)]
    for suffix, target in variants:
        sq = process(target)
        for size, base in SIZES:
            resized = sq.resize((size, size), Image.LANCZOS)
            path = f"{OUT_DIR}/{base}{suffix}.png"
            resized.save(path, optimize=True)
            print(f"  saved {path} ({size}x{size})")


if __name__ == "__main__":
    main()
