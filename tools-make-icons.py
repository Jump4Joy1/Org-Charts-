#!/usr/bin/env python3
"""Deterministically rasterize the OrgChart app icon to PNG (no deps).

Renders at 4x then box-downsamples for clean antialiasing. Output is fully
opaque RGB, edge-to-edge — iOS turns transparency in an apple-touch-icon
black, and crops the icon to a squircle, so the art must bleed to the edges
with the meaningful content kept inside a safe inset.
"""
import struct, zlib, math, sys, os

SS = 4  # supersample factor


def lerp(a, b, t):
    return a + (b - a) * t


class Canvas:
    def __init__(self, size):
        self.n = size
        self.px = [[(255, 255, 255)] * size for _ in range(size)]

    def fill_vgradient(self, top, bot):
        n = self.n
        for y in range(n):
            t = y / (n - 1)
            c = (int(lerp(top[0], bot[0], t)),
                 int(lerp(top[1], bot[1], t)),
                 int(lerp(top[2], bot[2], t)))
            self.px[y] = [c] * n

    def _blend(self, x, y, color, a=1.0):
        if a <= 0:
            return
        if not (0 <= x < self.n and 0 <= y < self.n):
            return
        if a >= 1:
            self.px[y][x] = color
            return
        r, g, b = self.px[y][x]
        self.px[y][x] = (int(lerp(r, color[0], a)),
                         int(lerp(g, color[1], a)),
                         int(lerp(b, color[2], a)))

    def rounded_rect(self, x0, y0, x1, y1, r, color):
        for y in range(int(math.floor(y0)), int(math.ceil(y1)) + 1):
            for x in range(int(math.floor(x0)), int(math.ceil(x1)) + 1):
                cx = min(max(x, x0 + r), x1 - r)
                cy = min(max(y, y0 + r), y1 - r)
                dx, dy = x - cx, y - cy
                if dx * dx + dy * dy <= r * r:
                    self._blend(x, y, color)

    def thick_line(self, x0, y0, x1, y1, w, color):
        half = w / 2.0
        minx = int(min(x0, x1) - half - 1); maxx = int(max(x0, x1) + half + 1)
        miny = int(min(y0, y1) - half - 1); maxy = int(max(y0, y1) + half + 1)
        vx, vy = x1 - x0, y1 - y0
        L2 = vx * vx + vy * vy
        for y in range(miny, maxy + 1):
            for x in range(minx, maxx + 1):
                if L2 == 0:
                    d = math.hypot(x - x0, y - y0)
                else:
                    t = max(0.0, min(1.0, ((x - x0) * vx + (y - y0) * vy) / L2))
                    d = math.hypot(x - (x0 + t * vx), y - (y0 + t * vy))
                if d <= half:
                    self._blend(x, y, color)

    def downsample(self, factor):
        out = Canvas(self.n // factor)
        f2 = factor * factor
        for y in range(out.n):
            row = []
            for x in range(out.n):
                r = g = b = 0
                for dy in range(factor):
                    src = self.px[y * factor + dy]
                    for dx in range(factor):
                        c = src[x * factor + dx]
                        r += c[0]; g += c[1]; b += c[2]
                row.append((r // f2, g // f2, b // f2))
            out.px[y] = row
        return out

    def write_png(self, path):
        n = self.n
        raw = bytearray()
        for y in range(n):
            raw.append(0)
            for c in self.px[y]:
                raw += bytes(c)
        comp = zlib.compress(bytes(raw), 9)

        def chunk(tag, data):
            return (struct.pack('>I', len(data)) + tag + data +
                    struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff))

        png = (b'\x89PNG\r\n\x1a\n'
               + chunk(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 2, 0, 0, 0))
               + chunk(b'IDAT', comp)
               + chunk(b'IEND', b''))
        open(path, 'wb').write(png)


def draw_icon(size, inset=0.0):
    """inset: extra padding as a fraction, for maskable variants."""
    n = size * SS
    c = Canvas(n)
    # Brand gradient background, full bleed.
    c.fill_vgradient((0x4C, 0x84, 0xE8), (0x22, 0x46, 0xA8))

    U = n / 100.0            # 1 unit == 1% of icon
    # Keep the art clear of iOS's squircle crop / Android's maskable circle.
    CONTENT_SCALE = 0.86
    scale = (1.0 - inset) * CONTENT_SCALE
    cx = n / 2.0

    def S(v):                # v is a % of icon size, scaled for maskable inset
        return v * U * scale

    # Node geometry (in % units), tuned to read clearly at 60px.
    bw, bh, br = S(34), S(19), S(5.5)
    top_cy = cx - S(22)
    bot_cy = cx + S(24)
    left_cx = cx - S(24)
    right_cx = cx + S(24)
    lw = S(4.2)
    white = (255, 255, 255)

    # Connectors first so the boxes sit on top of them.
    trunk_top = top_cy + bh / 2
    bus_y = cx + S(3)
    c.thick_line(cx, trunk_top, cx, bus_y, lw, white)
    c.thick_line(left_cx, bus_y, right_cx, bus_y, lw, white)
    c.thick_line(left_cx, bus_y, left_cx, bot_cy - bh / 2, lw, white)
    c.thick_line(right_cx, bus_y, right_cx, bot_cy - bh / 2, lw, white)

    def box(bx, by, w, h):
        c.rounded_rect(bx - w / 2, by - h / 2, bx + w / 2, by + h / 2, br, white)

    box(cx, top_cy, bw, bh)
    box(left_cx, bot_cy, S(30), bh)
    box(right_cx, bot_cy, S(30), bh)

    return c.downsample(SS)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    jobs = [
        ('icon-32.png', 32, 0.0),
        ('icon-180.png', 180, 0.0),
        ('icon-192.png', 192, 0.0),
        ('icon-512.png', 512, 0.0),
        # Maskable: Android/Chrome crop aggressively, so pull the art in.
        ('icon-192-maskable.png', 192, 0.22),
        ('icon-512-maskable.png', 512, 0.22),
    ]
    for name, size, inset in jobs:
        img = draw_icon(size, inset)
        img.write_png(os.path.join(out, name))
        print('wrote', name, f'{size}x{size}')


if __name__ == '__main__':
    main()
