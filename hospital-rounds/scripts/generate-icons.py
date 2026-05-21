"""PWA アイコン生成スクリプト

`scripts/icon-source.png` (作者作成のソース画像) を読み、

  - 背景 (ライトグレー) を透明化
  - 元画像の青を、本番カラー (#2563eb) / テストカラー (#475569) に再合成
  - 余白を自動でクロップして正方形に整形
  - 192 / 512 / 180 px へリサイズして `public/icons/` に保存

色置換は (元の青 → 白) の RGB 軸にピクセルを射影してパラメータ t を求め、
t = 0 のとき target_color、t = 1 のとき白で再合成する。アンチエイリアスや
内部の白いデザイン (心電図・矢頭の縁) も自然に出力色に追随する。

依存: Pillow (`pip install Pillow`)。アイコン再生成のたびに使う一回限り
のスクリプトなので、ランタイム本体には影響しない。
"""
import os
from PIL import Image

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


def recolor_pixel(pixel, target):
    r, g, b = pixel[:3]
    if is_background(r, g, b):
        return (0, 0, 0, 0)  # 背景を透明化
    t = t_along_blue_white(r, g, b)
    nr, ng, nb = target
    return (
        round((1 - t) * nr + t * 255),
        round((1 - t) * ng + t * 255),
        round((1 - t) * nb + t * 255),
        255,
    )


def process(target_color):
    src = Image.open(SRC).convert("RGB")
    w, h = src.size
    out = Image.new("RGBA", (w, h))
    sp = src.load()
    op = out.load()
    for y in range(h):
        for x in range(w):
            op[x, y] = recolor_pixel(sp[x, y], target_color)
    bbox = out.getbbox()
    if bbox is None:
        raise RuntimeError("No icon pixels detected; check ICON_BLUE / is_background")
    cropped = out.crop(bbox)
    cw, ch = cropped.size
    side = max(cw, ch)
    # 中心揃えで正方形に
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(cropped, ((side - cw) // 2, (side - ch) // 2))
    return square


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
