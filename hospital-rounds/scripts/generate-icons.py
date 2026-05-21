"""PNG アイコン生成スクリプト（依存パッケージなし）

回診PWA用のアイコン: 色付き背景に白いベッド（病棟ベッドサイドを象徴）。
紙系アプリ（問診票など）と形で確実に区別できるよう、ベッドのシルエット
を採用。

形は lucide-icons の `bed` を参考にした側面ビュー:
  - 左に背の高いヘッドボード（縦線）
  - マットレス上下の横線、右上に曲がり角の小円弧
  - 内部に短い縦線（枕とマットレスの仕切り）
  - 床まで届く左右の縦線（脚に見立てる）

色: 本番 = 青 (BLUE)、テスト = スレートグレー (SLATE)
安全マージン: 全パーツが画像中心から半径 40% 内に収まる（maskable 対応）

依存パッケージ無しで動かす設計なので、輪郭はアンチエイリアスせず
ピクセル単位のしきい値判定。192/512 程度なら許容範囲。
"""
import struct
import zlib
import os


def make_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


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


def in_arc_quadrant(x, y, cx, cy, r, half, *, right=True, top=True):
    """円 (cx, cy, r) の指定 4 分円上に半径 `half` の輪郭が乗っているか。
    右上 (right=True, top=True) など。"""
    if right and x < cx:
        return False
    if not right and x > cx:
        return False
    if top and y > cy:
        return False
    if not top and y < cy:
        return False
    dx, dy = x - cx, y - cy
    d2 = dx * dx + dy * dy
    inner = max(0.0, r - half)
    outer = r + half
    return inner * inner <= d2 <= outer * outer


def make_png_bed(width: int, height: int, bg, fg) -> bytes:
    # lucide bed の 24-grid 座標をそのままスケール
    s = width / 24.0
    half = width * 0.04  # 線の半径（線の太さは 8% ≒ lucide stroke-width 2 相当）

    # キーポイント
    left_x = 2 * s
    headboard_top_y = 4 * s
    mattress_top_y = 8 * s
    mattress_bot_y = 17 * s
    floor_y = 20 * s
    right_x_inner = 20 * s    # 上辺の水平線が終わる x
    right_x_outer = 22 * s    # コーナー後の右縦線の x
    pillow_x = 6 * s          # 枕とマットレスの仕切り

    # 右上コーナーの円弧（中心 (20s, 10s)、半径 2s、右上 1/4）
    arc_cx = 20 * s
    arc_cy = 10 * s
    arc_r = 2 * s

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: None
        for x in range(width):
            on_shape = (
                # 左縦線（ヘッドボード上端から床まで）
                in_thick_segment(x, y, left_x, headboard_top_y, left_x, floor_y, half)
                # マットレス上辺の水平線
                or in_thick_segment(x, y, left_x, mattress_top_y, right_x_inner, mattress_top_y, half)
                # 右上コーナーの円弧
                or in_arc_quadrant(x, y, arc_cx, arc_cy, arc_r, half, right=True, top=True)
                # コーナー後の右縦線（床まで）
                or in_thick_segment(x, y, right_x_outer, arc_cy, right_x_outer, floor_y, half)
                # マットレス底辺
                or in_thick_segment(x, y, left_x, mattress_bot_y, right_x_outer, mattress_bot_y, half)
                # 枕の仕切り
                or in_thick_segment(x, y, pillow_x, mattress_top_y, pillow_x, mattress_bot_y, half)
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
        data = make_png_bed(size, size, bg, WHITE)
        path = f"public/icons/{name}"
        with open(path, "wb") as f:
            f.write(data)
        print(f"Created {path} ({size}x{size}, {len(data)} bytes)")
