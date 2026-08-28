"""Иконки EVA VPN. Рисуются по тем же кривым, что и сердце в интерфейсе,
без внешних зависимостей: своя растеризация безье + запись PNG и ICO.

Запуск:  python scripts/make-icons.py
Результат: build/icon.png, build/icon.ico, build/tray-on.png, build/tray-off.png
"""

import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "build")
SS = 3  # суперсэмплинг

BLUE = (0x1A, 0x3D, 0xCC)
BLUE_2 = (0x24, 0x50, 0xE8)
CREAM = (0xD8, 0xCD, 0xB8)
CREAM_2 = (0xC9, 0xBD, 0xA6)
DIM = (0x7A, 0x74, 0x68)

# --- геометрия из src/renderer/index.html (viewBox 120x112) -------------------

HEART_OUTER = [
    (60, 104), [(60, 104), (8, 74), (8, 39)], [(8, 19), (24, 6), (41, 6)],
    [(51, 6), (57, 11), (60, 17)], [(63, 11), (69, 6), (79, 6)],
    [(96, 6), (112, 19), (112, 39)], [(112, 74), (60, 104), (60, 104)],
]
HEART_INNER = [
    (60, 96), [(60, 96), (17, 70), (17, 41)], [(17, 24), (30, 14), (43, 14)],
    [(51, 14), (57, 18), (60, 23)], [(63, 18), (69, 14), (77, 14)],
    [(90, 14), (103, 24), (103, 41)], [(103, 70), (60, 96), (60, 96)],
]
KEY_STEM = [(55.5, 52), (52, 70), (68, 70), (64.5, 52)]
KEY_HEAD = (60, 45, 11)  # cx, cy, r

BBOX = (8, 6, 112, 104)


def flatten(path, steps=28):
    """Кубические безье -> замкнутый многоугольник."""
    pts = [path[0]]
    cur = path[0]
    for seg in path[1:]:
        c1, c2, end = seg
        for i in range(1, steps + 1):
            t = i / steps
            u = 1 - t
            x = u ** 3 * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * end[0]
            y = u ** 3 * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * end[1]
            pts.append((x, y))
        cur = end
    return pts


def circle_poly(cx, cy, r, steps=64):
    return [(cx + math.cos(2 * math.pi * i / steps) * r, cy + math.sin(2 * math.pi * i / steps) * r)
            for i in range(steps)]


def inside(poly, x, y):
    """Луч вправо: нечётное число пересечений — точка внутри."""
    hit = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                hit = not hit
        j = i
    return hit


OUTER = flatten(HEART_OUTER)
INNER = flatten(HEART_INNER)
HEAD = circle_poly(*KEY_HEAD)


def write_png(path, w, h, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n" +
           chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) +
           chunk(b"IDAT", zlib.compress(raw, 9)) +
           chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return png


def render(size, heart_fill, inner_fill, key_fill, outline_only=False, margin=0.90):
    """Сердце вписывается в квадрат с сохранением пропорций — без растяжки."""
    n = size * SS
    bw = BBOX[2] - BBOX[0]
    bh = BBOX[3] - BBOX[1]
    scale = n * margin / max(bw, bh)
    ox = (n - bw * scale) / 2 - BBOX[0] * scale
    oy = (n - bh * scale) / 2 - BBOX[1] * scale

    stroke = 5.0 if outline_only else 0.0

    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0.0, 0.0, 0.0]
            hits = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    ux = (px * SS + sx + 0.5 - ox) / scale
                    uy = (py * SS + sy + 0.5 - oy) / scale

                    color = None
                    if inside(OUTER, ux, uy):
                        if outline_only:
                            # только контур: внутренняя часть остаётся прозрачной
                            if not inside(INNER, ux, uy):
                                color = heart_fill
                        else:
                            color = heart_fill
                            if inside(INNER, ux, uy):
                                color = inner_fill
                                d = (ux * 0.62 + uy * 0.78)
                                if 3 < (d % 26) < 9:
                                    color = CREAM_2
                            if inside(HEAD, ux, uy) or inside(KEY_STEM, ux, uy):
                                color = key_fill

                    if color is None:
                        continue
                    acc[0] += color[0]
                    acc[1] += color[1]
                    acc[2] += color[2]
                    hits += 1.0

            if hits > 0:
                a = hits / (SS * SS)
                row += bytes((int(acc[0] / hits), int(acc[1] / hits), int(acc[2] / hits),
                              int(round(a * 255))))
            else:
                row += b"\x00\x00\x00\x00"
        rows.append(bytes(row))
    return rows


def write_ico(path, pngs):
    """ICO с PNG внутри (поддерживается начиная с Vista)."""
    count = len(pngs)
    header = struct.pack("<HHH", 0, 1, count)
    offset = 6 + 16 * count
    entries = b""
    body = b""
    for size, data in pngs:
        entries += struct.pack("<BBBBHHII", size if size < 256 else 0, size if size < 256 else 0,
                               0, 0, 1, 32, len(data), offset)
        offset += len(data)
        body += data
    with open(path, "wb") as f:
        f.write(header + entries + body)


os.makedirs(OUT, exist_ok=True)

# основная иконка + все размеры для .ico
sizes = [256, 128, 64, 48, 32, 24, 16]
pngs = []
tmp = os.path.join(OUT, "_tmp.png")
for s in sizes:
    data = write_png(tmp, s, s, render(s, BLUE, CREAM, BLUE_2))
    pngs.append((s, data))
    if s == 256:
        write_png(os.path.join(OUT, "icon.png"), s, s, render(s, BLUE, CREAM, BLUE_2))
os.remove(tmp)
write_ico(os.path.join(OUT, "icon.ico"), pngs)

# трей: подключено — цветное сердце, отключено — только контур
write_png(os.path.join(OUT, "tray-on.png"), 32, 32, render(32, BLUE_2, CREAM, BLUE_2))
write_png(os.path.join(OUT, "tray-off.png"), 32, 32, render(32, DIM, None, None, outline_only=True))

print("готово:", OUT)
