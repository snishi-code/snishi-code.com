"""PNG アイコン生成スクリプト（依存パッケージなし）

回診PWA用のアイコン: 青背景に白いクリップボード（十字なし）。
各アプリで固有の形を持たせ、医療カテゴリと混同しないようにする。

NOTE: 本番（青）アイコンは別途手動調整されているため、このスクリプトは
**テスト用（slate）アイコンのみを再生成**する。本番アイコンを再生成したい
場合は VARIANTS の BLUE 行のコメントを外すこと。
"""
import struct
import zlib
import os


def make_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def in_rounded(x, y, x1, y1, x2, y2, r):
    if x < x1 or x > x2 or y < y1 or y > y2:
        return False
    if x < x1 + r and y < y1 + r:
        return (x - (x1 + r)) ** 2 + (y - (y1 + r)) ** 2 <= r * r
    if x > x2 - r and y < y1 + r:
        return (x - (x2 - r)) ** 2 + (y - (y1 + r)) ** 2 <= r * r
    if x < x1 + r and y > y2 - r:
        return (x - (x1 + r)) ** 2 + (y - (y2 - r)) ** 2 <= r * r
    if x > x2 - r and y > y2 - r:
        return (x - (x2 - r)) ** 2 + (y - (y2 - r)) ** 2 <= r * r
    return True


def make_png_clipboard(width: int, height: int, bg, fg) -> bytes:
    body_x1 = int(width * 0.22)
    body_x2 = int(width * 0.78)
    body_y1 = int(height * 0.20)
    body_y2 = int(height * 0.90)

    clip_x1 = int(width * 0.36)
    clip_x2 = int(width * 0.64)
    clip_y1 = int(height * 0.08)
    clip_y2 = int(height * 0.22)

    body_r = max(2, int(min(width, height) * 0.06))
    clip_r = max(2, int(min(width, height) * 0.025))

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: None
        for x in range(width):
            on_shape = (
                in_rounded(x, y, body_x1, body_y1, body_x2, body_y2, body_r)
                or in_rounded(x, y, clip_x1, clip_y1, clip_x2, clip_y2, clip_r)
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
    # ("", BLUE),       # 本番（青）— 手動調整されているため通常は再生成しない
    ("-test", SLATE), # テスト（スレートグレー）
]

for suffix, bg in VARIANTS:
    for size, base in [(192, "icon-192"), (512, "icon-512"), (180, "apple-touch-icon")]:
        name = f"{base}{suffix}.png"
        data = make_png_clipboard(size, size, bg, WHITE)
        path = f"public/icons/{name}"
        with open(path, "wb") as f:
            f.write(data)
        print(f"Created {path} ({size}x{size}, {len(data)} bytes)")
