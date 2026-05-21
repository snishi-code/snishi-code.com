"""PNG アイコン生成スクリプト（依存パッケージなし）

回診PWA用のアイコン: 色付き背景に白い聴診器（十字なし）。
「医者が患者を診て回る」道具をシンボル化し、紙系アプリ（問診票など）と
形で確実に区別できるようにしている。

- 形: 耳ピース 2 つ → Y 字チューブ → 短い茎 → チェストピース（円盤）
- 色: 本番 = 青 (BLUE)、テスト = スレートグレー (SLATE)
- 安全マージン: 全パーツが画像中心から半径 40% の円内に収まるよう設計
  （maskable PWA アイコンとしてもクロップされない）

スクリプトは依存パッケージ無しで動かしたいので、外周はアンチエイリアスせず
ピクセル単位のしきい値判定。サイズ 192/512 程度であれば許容範囲。
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


def make_png_stethoscope(width: int, height: int, bg, fg) -> bytes:
    cx = width / 2.0

    # 耳ピース
    ear_r = width * 0.06
    ear_x_off = width * 0.22
    ear_y = height * 0.20
    left_ear = (cx - ear_x_off, ear_y)
    right_ear = (cx + ear_x_off, ear_y)

    # Y 字の合流点
    joint = (cx, height * 0.55)

    # チェストピース（聴診面）
    chest_cy = height * 0.78
    chest_r = width * 0.15

    # チューブの半径（線の太さの半分）
    tube = width * 0.035

    # 茎: 合流点 → チェストピース上端のすぐ内側まで
    stem_top = joint
    stem_bot = (cx, chest_cy - chest_r + tube)

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: None
        for x in range(width):
            on_shape = (
                in_circle(x, y, left_ear[0], left_ear[1], ear_r)
                or in_circle(x, y, right_ear[0], right_ear[1], ear_r)
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
