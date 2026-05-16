"""PNG アイコン生成スクリプト（依存パッケージなし）"""
import struct
import zlib
import os


def make_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def make_png(width: int, height: int, bg: tuple, fg: tuple) -> bytes:
    bw = int(min(width, height) * 0.50)  # 横棒の長さ
    bh = int(min(width, height) * 0.14)  # 横棒の太さ
    cx, cy = width // 2, height // 2

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: None
        for x in range(width):
            in_h = abs(y - cy) <= bh // 2 and abs(x - cx) <= bw // 2
            in_v = abs(x - cx) <= bh // 2 and abs(y - cy) <= bw // 2
            r, g, b = fg if (in_h or in_v) else bg
            raw += bytes([r, g, b])

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = make_chunk(b"IHDR", struct.pack(">II5B", width, height, 8, 2, 0, 0, 0))
    idat = make_chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    iend = make_chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


BLUE = (37, 99, 235)
WHITE = (255, 255, 255)

os.makedirs("public/icons", exist_ok=True)

for size, name in [(192, "icon-192.png"), (512, "icon-512.png"), (180, "apple-touch-icon.png")]:
    data = make_png(size, size, BLUE, WHITE)
    path = f"public/icons/{name}"
    with open(path, "wb") as f:
        f.write(data)
    print(f"Created {path} ({size}x{size}, {len(data)} bytes)")
