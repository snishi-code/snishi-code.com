"""PNG アイコン生成スクリプト（依存パッケージなし）

回診 PWA: 「Rounds = 回転」を象徴する 2 本の回転矢印（時計回りで円を構成）と、
医療カテゴリを示す心電図波形（snishi-code.com トップと同じ pulse パス）を
中央に重ねたアイコン。

形:
  - 中心の円周上に 2 本のアーチ（太線の円環セグメント）
  - 各アーチの終端に三角形の矢頭
  - 中央に lucide pulse パスを縮小したミニ心電図（5 セグメント）

色: 本番 = 青 (#2563eb)、テスト = スレートグレー (#475569)
十字 (+) は含まない。

依存パッケージ無しで動かす設計なので、輪郭はアンチエイリアスせず
ピクセル単位のしきい値判定。192/512 程度なら許容範囲。
"""
import math
import os
import struct
import zlib


def make_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def in_thick_segment(x, y, x1, y1, x2, y2, half):
    """2 点間を半径 `half` の太線（端は丸キャップ）で結んだ範囲に入っているか。"""
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


def in_annulus_arc(x, y, cx, cy, r_inner, r_outer, theta_low_deg, theta_high_deg):
    """円環 (内径 r_inner、外径 r_outer) の指定角度範囲に入っているか。
    角度は数学角度（0° = 右、90° = 上）。画像座標 (y 反転) で評価。"""
    dx = x - cx
    dy = y - cy
    d2 = dx * dx + dy * dy
    if not (r_inner * r_inner <= d2 <= r_outer * r_outer):
        return False
    angle_rad = math.atan2(-dy, dx)
    angle_deg = math.degrees(angle_rad)
    if angle_deg < 0:
        angle_deg += 360
    return theta_low_deg <= angle_deg <= theta_high_deg


def in_triangle(x, y, ax, ay, bx, by, ccx, ccy):
    """三角形 (ax,ay)-(bx,by)-(ccx,ccy) の内部に点 (x,y) が入っているか。"""
    def sign(p1x, p1y, p2x, p2y, p3x, p3y):
        return (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y)
    d1 = sign(x, y, ax, ay, bx, by)
    d2 = sign(x, y, bx, by, ccx, ccy)
    d3 = sign(x, y, ccx, ccy, ax, ay)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def _arrowhead_tri(cx, cy, r_inner, r_outer, end_deg):
    """円環の終端角度 end_deg に取り付ける矢頭三角形の頂点 (3 つ) を返す。
    矢頭は時計回り (= 数学角度の減少方向) を motion direction とする。"""
    theta = math.radians(end_deg)
    r_mid = (r_inner + r_outer) / 2
    h = r_outer - r_inner
    px = cx + r_mid * math.cos(theta)
    py = cy - r_mid * math.sin(theta)  # 画像座標 (y 反転)
    # 径方向（外向き）
    rx = math.cos(theta)
    ry = -math.sin(theta)
    # 時計回り tangent（motion direction）
    tx = math.sin(theta)
    ty = math.cos(theta)
    base_half = 1.45 * h    # 矢頭ベースの半幅（アーチ太さの 1.45 倍）
    tip_len = 2.2 * h       # 先端までの距離
    v_outer = (px + base_half * rx, py + base_half * ry)
    v_inner = (px - base_half * rx, py - base_half * ry)
    v_tip = (px + tip_len * tx, py + tip_len * ty)
    return v_outer, v_inner, v_tip


def make_png_rounds_pulse(width: int, height: int, bg, fg) -> bytes:
    cx = width / 2.0
    cy = height / 2.0

    # 回転矢印 (2 本で円を構成)
    r_outer = width * 0.36
    r_inner = width * 0.29

    # 上アーチ: 数学角度 15° → 175° の範囲。motion は時計回り (175° → 15°)、
    # 矢頭は終端 15° (右下方向) に取り付け。
    top_low_deg = 15
    top_high_deg = 175
    # 下アーチ: 195° → 355°。motion は時計回り (355° → 195°)、矢頭は終端 195° (左上方向)。
    bot_low_deg = 195
    bot_high_deg = 355

    top_o, top_i, top_t = _arrowhead_tri(cx, cy, r_inner, r_outer, top_low_deg)
    bot_o, bot_i, bot_t = _arrowhead_tri(cx, cy, r_inner, r_outer, bot_low_deg)

    # 中央の心電図 (lucide pulse パス: 22→18→15→9→6→2 の x、各 y は 12 を基準に上下)
    # 中央 (12,12) を原点に置き直すと: (10,0)→(6,0)→(3,9)→(-3,-9)→(-6,0)→(-10,0)
    sx = width * 0.016
    sy = height * 0.010
    pulse_units = [(10, 0), (6, 0), (3, 9), (-3, -9), (-6, 0), (-10, 0)]
    pulse_pts = [(cx + u[0] * sx, cy + u[1] * sy) for u in pulse_units]
    pulse_half = width * 0.022

    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter: None
        for x in range(width):
            on = (
                in_annulus_arc(x, y, cx, cy, r_inner, r_outer, top_low_deg, top_high_deg)
                or in_annulus_arc(x, y, cx, cy, r_inner, r_outer, bot_low_deg, bot_high_deg)
                or in_triangle(x, y, top_o[0], top_o[1], top_i[0], top_i[1], top_t[0], top_t[1])
                or in_triangle(x, y, bot_o[0], bot_o[1], bot_i[0], bot_i[1], bot_t[0], bot_t[1])
            )
            if not on:
                # Pulse line
                for i in range(len(pulse_pts) - 1):
                    p1 = pulse_pts[i]
                    p2 = pulse_pts[i + 1]
                    if in_thick_segment(x, y, p1[0], p1[1], p2[0], p2[1], pulse_half):
                        on = True
                        break

            r, g, b = fg if on else bg
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
        data = make_png_rounds_pulse(size, size, bg, WHITE)
        path = f"public/icons/{name}"
        with open(path, "wb") as f:
            f.write(data)
        print(f"Created {path} ({size}x{size}, {len(data)} bytes)")
