"""PNG アイコン生成スクリプト（依存パッケージなし）

回診PWA用のアイコン: 色付き背景に白い聴診器（十字なし）。
「医者が患者を診て回る」道具をシンボル化し、紙系アプリ（問診票など）と
形で確実に区別できるようにしている。

- 形: 上端の U 字ループ（耳バンド）+ 端の耳ピース 2 つ + 集約する管 +
       下端のチェストピース（円盤）
- 色: 本番 = 青 (BLUE)、テスト = スレートグレー (SLATE)
- 安全マージン: 全パーツが画像中心から半径 40% の円内に収まるよう設計
  （maskable PWA アイコンとしてもクロップされない）

依存パッケージ無しで動かす設計なので、輪郭はアンチエイリアスせず
ピクセル単位のしきい値判定。192/512 程度なら許容範囲。
"""
import struct
import zlib
import os


def make_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def in_circle(x, y, cx, cy, r):
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= r * r


def in_thick_segment(x, y, x1, y1, x2, y2, half):
    """2 点間を半径 `half` の太線で結んだ範囲に入っているか。"""
    dx, dy = x2 - x1, y2 - y1
    len2 = dx * dx + dy * dy
    if len2 == 0:
        return (x - x1) ** 2 + (y - y1) ** 2 <= half * half
    t = ((x - x1) * dx + (y - y1) * dy) / len2
    if t < 0:
        t = 0
    elif t > 1:
        t = 1
    px = x1 + t * dx
    py = y1 + t * dy
    return (x - px) ** 2 + (y - py) ** 2 <= half * half


def in_top_arc(x, y, cx, cy, r_outer, r_inner):
    """円 (cx, cy) の上半分（y < cy）の環状帯 (r_inner..r_outer) に入っているか。
    U 字ループのアーチ部分の描画に使う。"""
    dx, dy = x - cx, y - cy
    if dy >= 0:
        return False
    d2 = dx * dx + dy * dy
    return r_inner * r_inner <= d2 <= r_outer * r_outer


def make_png_stethoscope(width: int, height: int, bg, fg) -> bytes:
    cx = width / 2.0

    # U 字ループ（耳バンド）
    u_cy = height * 0.32
    u_outer = width * 0.20
    u_inner = width * 0.14
    # アーチ厚みの中点に耳ピースを置く
    arc_mid = (u_outer + u_inner) / 2.0
    ear_radius = width * 0.04
    left_ear = (cx - arc_mid, u_cy)
    right_ear = (cx + arc_mid, u_cy)

    # チューブが合流する点
    joint = (cx, height * 0.58)

    # チェストピース（聴診面）
    chest_cy = height * 0.80
    chest_r = width * 0.11

    # チューブ半径（線の太さの半分）
    tube = width * 0.026

    # 茎: 合流点 → チェストピース上端
    stem_top = joint
    stem_bot = (cx, chest_cy - chest_r + tube)

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: None
        for x in range(width):
            on_shape = (
                in_top_arc(x, y, cx, u_cy, u_outer, u_inner)
                or in_circle(x, y, left_ear[0], left_ear[1], ear_radius)
                or in_circle(x, y, right_ear[0], right_ear[1], ear_radius)
                or in_thick_segment(x, y, left_ear[0], left_ear[1], joint[0], joint[1], tube)
                or in_thick_segment(x, y, right_ear[0], right_ear[1], joint[0], joint[1], tube)
                or in_thick_segment(x, y, stem_top[0], stem_top[1], stem_bot[0], stem_bot[1], tube)
                or in_circle(x, y, cx, chest_cy, chest_r)
            )
            r, g, b = fg if on_shape else bg
            raw += bytes([r, g, b])

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = make_chunk(b"IHDR", struct.pack(">II5B", width, height, 8, 2, 0, 0, 0))
    idat = make_chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    iend = make_chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


BLUE = (37, 99, 235)
SLATE = (71, 85, 105)  # slate-600 — テスト環境用（snishi-code.com トップのロゴ背景と同色）
WHITE = (255, 255, 255)

os.makedirs("public/icons", exist_ok=True)

VARIANTS = [
    # (出力ファイル接尾辞, 背景色)
    ("", BLUE),       # 本番
    ("-test", SLATE), # テスト
]

for suffix, bg in VARIANTS:
    for size, base in [(192, "icon-192"), (512, "icon-512"), (180, "apple-touch-icon")]:
        name = f"{base}{suffix}.png"
        data = make_png_stethoscope(size, size, bg, WHITE)
        path = f"public/icons/{name}"
        with open(path, "wb") as f:
            f.write(data)
        print(f"Created {path} ({size}x{size}, {len(data)} bytes)")
