import zlib
import struct
import math
import os

def make_png(width, height, rgba_data):
    def png_chunk(chunk_type, data):
        crc = zlib.crc32(chunk_type + data) & 0xffffffff
        return struct.pack('>I', len(data)) + chunk_type + data + struct.pack('>I', crc)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = png_chunk(b'IHDR', ihdr_data)

    raw_lines = []
    bytes_per_row = width * 4
    for y in range(height):
        start = y * bytes_per_row
        row = rgba_data[start:start + bytes_per_row]
        raw_lines.append(b'\x00' + row)
    
    compressor = zlib.compressobj(level=9)
    idat_data = compressor.compress(b''.join(raw_lines)) + compressor.flush()
    idat = png_chunk(b'IDAT', idat_data)
    iend = png_chunk(b'IEND', b'')
    return header + ihdr + idat + iend

def draw_icon(size):
    # Create an image buffer
    # Background: modern rounded rectangle with emerald to teal gradient
    # Foreground: 3 stacked cards / queue lines and a play/arrow symbol
    buf = bytearray(size * size * 4)
    radius = size * 0.22
    cx, cy = size / 2.0, size / 2.0

    def inside_rounded_rect(x, y, rx, ry, rw, rh, r):
        if x < rx or x > rx + rw or y < ry or y > ry + rh:
            return 0.0
        # Check corners
        corners = [
            (rx + r, ry + r),
            (rx + rw - r, ry + r),
            (rx + r, ry + rh - r),
            (rx + rw - r, ry + rh - r)
        ]
        dx = 0
        dy = 0
        if x < rx + r and y < ry + r:
            dx, dy = x - (rx + r), y - (ry + r)
        elif x > rx + rw - r and y < ry + r:
            dx, dy = x - (rx + rw - r), y - (ry + r)
        elif x < rx + r and y > ry + rh - r:
            dx, dy = x - (rx + r), y - (ry + rh - r)
        elif x > rx + rw - r and y > ry + rh - r:
            dx, dy = x - (rx + rw - r), y - (ry + rh - r)
        else:
            return 1.0 # Inside middle parts
        
        dist = math.hypot(dx, dy)
        if dist <= r - 0.5:
            return 1.0
        elif dist >= r + 0.5:
            return 0.0
        else:
            return (r + 0.5 - dist)

    margin = size * 0.08
    rw = size - 2 * margin
    rh = size - 2 * margin

    for y in range(size):
        for x in range(size):
            idx = (y * size + x) * 4
            alpha_bg = inside_rounded_rect(x + 0.5, y + 0.5, margin, margin, rw, rh, radius)
            if alpha_bg <= 0:
                buf[idx:idx+4] = b'\x00\x00\x00\x00'
                continue
            
            # Monochrome gradient: deep charcoal #121214 (18, 18, 20) to neutral dark #242428 (36, 36, 40)
            t = (x + y) / (2.0 * size)
            val = int(18 * (1 - t) + 38 * t)
            r = val
            g = val
            b = val
            a = int(255 * alpha_bg)

            # Icon graphics: Three stacked queue bars + a play arrow or badge
            # Bar 1 (top): y around 26% - 34%, width ~ 55%
            # Bar 2 (mid): y around 44% - 52%, width ~ 45%
            # Bar 3 (bot): y around 62% - 70%, width ~ 35%
            # Or queue list with play triangle at bottom-right
            
            # Normalize to 0..1
            nx = x / size
            ny = y / size

            is_fg = False
            # Queue bar 1
            if 0.26 <= ny <= 0.36 and 0.24 <= nx <= 0.76:
                is_fg = True
            # Queue bar 2
            elif 0.44 <= ny <= 0.54 and 0.24 <= nx <= 0.62:
                is_fg = True
            # Queue bar 3
            elif 0.62 <= ny <= 0.72 and 0.24 <= nx <= 0.48:
                is_fg = True
            
            # Play triangle at bottom-right
            # Points: (0.60, 0.50), (0.60, 0.76), (0.80, 0.63)
            # Check if point is inside triangle
            p1x, p1y = 0.60, 0.48
            p2x, p2y = 0.60, 0.76
            p3x, p3y = 0.82, 0.62
            
            def sign(p1x, p1y, p2x, p2y, p3x, p3y):
                return (p1x - p3x) * (p2y - p3y) - (p2x - p3x) * (p1y - p3y)

            d1 = sign(nx, ny, p1x, p1y, p2x, p2y)
            d2 = sign(nx, ny, p2x, p2y, p3x, p3y)
            d3 = sign(nx, ny, p3x, p3y, p1x, p1y)
            has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
            has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
            if not (has_neg and has_pos) and nx >= 0.59:
                is_fg = True

            if is_fg:
                # White foreground with full opacity
                buf[idx] = 255
                buf[idx+1] = 255
                buf[idx+2] = 255
                buf[idx+3] = a
            else:
                buf[idx] = r
                buf[idx+1] = g
                buf[idx+2] = b
                buf[idx+3] = a

    return make_png(size, size, bytes(buf))

os.makedirs('icons', exist_ok=True)
for s in [16, 48, 128]:
    png = draw_icon(s)
    with open(f'icons/icon{s}.png', 'wb') as f:
        f.write(png)
    print(f"Generated icons/icon{s}.png ({len(png)} bytes)")
