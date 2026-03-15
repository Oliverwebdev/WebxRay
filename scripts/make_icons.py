import struct
import zlib
import math

def make_png_rgba(width, height, pixels_rgba):
    """Create a valid PNG binary from an RGBA pixel array (list of [r,g,b,a] values, row-major)."""
    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)

    # PNG signature
    sig = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = chunk(b'IHDR', ihdr_data)

    # IDAT - build raw scanlines with filter byte 0
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter type None
        for x in range(width):
            idx = (y * width + x) * 4
            raw.extend(pixels_rgba[idx:idx+4])

    compressed = zlib.compress(bytes(raw), 9)
    idat = chunk(b'IDAT', compressed)

    # IEND
    iend = chunk(b'IEND', b'')

    return sig + ihdr + idat + iend


def blend_pixel(pixels, width, height, x, y, r, g, b, a_factor):
    """Blend a color onto a pixel with alpha compositing."""
    if x < 0 or x >= width or y < 0 or y >= height:
        return
    idx = (y * width + x) * 4
    src_a = a_factor
    dst_a = pixels[idx + 3] / 255.0
    out_a = src_a + dst_a * (1.0 - src_a)
    if out_a > 0:
        pixels[idx]     = int((r * src_a + pixels[idx]     * dst_a * (1.0 - src_a)) / out_a)
        pixels[idx + 1] = int((g * src_a + pixels[idx + 1] * dst_a * (1.0 - src_a)) / out_a)
        pixels[idx + 2] = int((b * src_a + pixels[idx + 2] * dst_a * (1.0 - src_a)) / out_a)
        pixels[idx + 3] = int(out_a * 255)


def draw_circle_aa(pixels, width, height, cx, cy, radius, r, g, b, alpha=1.0):
    """Draw an anti-aliased filled circle."""
    ix0 = max(0, int(cx - radius - 2))
    ix1 = min(width - 1, int(cx + radius + 2))
    iy0 = max(0, int(cy - radius - 2))
    iy1 = min(height - 1, int(cy + radius + 2))

    for py in range(iy0, iy1 + 1):
        for px in range(ix0, ix1 + 1):
            dist = math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
            if dist < radius - 1:
                blend_pixel(pixels, width, height, px, py, r, g, b, alpha)
            elif dist < radius + 1:
                # Anti-alias edge
                coverage = (radius + 1 - dist) / 2.0
                coverage = max(0.0, min(1.0, coverage))
                blend_pixel(pixels, width, height, px, py, r, g, b, alpha * coverage)


def draw_glow(pixels, width, height, cx, cy, radius, r, g, b):
    """Draw a soft glow halo around a circle."""
    glow_r = radius * 2.5
    ix0 = max(0, int(cx - glow_r - 2))
    ix1 = min(width - 1, int(cx + glow_r + 2))
    iy0 = max(0, int(cy - glow_r - 2))
    iy1 = min(height - 1, int(cy + glow_r + 2))

    for py in range(iy0, iy1 + 1):
        for px in range(ix0, ix1 + 1):
            dist = math.sqrt((px - cx) ** 2 + (py - cy) ** 2)
            if dist > radius and dist < glow_r:
                # Soft falloff
                t = (dist - radius) / (glow_r - radius)
                alpha = (1.0 - t) * 0.4
                blend_pixel(pixels, width, height, px, py, r, g, b, alpha)


def draw_line_aa(pixels, width, height, x0, y0, x1, y1, r, g, b, thickness=1.0):
    """Draw an anti-aliased line by placing small circles along the path."""
    dx = x1 - x0
    dy = y1 - y0
    length = math.sqrt(dx * dx + dy * dy)
    if length < 0.001:
        return
    steps = max(int(length * 2), 2)
    for i in range(steps + 1):
        t = i / steps
        px = x0 + t * dx
        py = y0 + t * dy
        draw_circle_aa(pixels, width, height, px, py, thickness / 2.0, r, g, b, 0.7)


def make_icon(size):
    """Generate the WEBXRAY icon at the given size."""
    # Background color
    bg_r, bg_g, bg_b = 26, 26, 46

    # Initialize pixel buffer with background
    pixels = bytearray(size * size * 4)
    for i in range(size * size):
        idx = i * 4
        pixels[idx]     = bg_r
        pixels[idx + 1] = bg_g
        pixels[idx + 2] = bg_b
        pixels[idx + 3] = 255

    cx = size / 2.0
    cy = size / 2.0

    # Size-specific parameters
    if size == 128:
        center_r = 11.0
        sat_r = 5.0
        orbit_r = 30.0
        line_thick = 1.2
        full_detail = True
    elif size == 48:
        center_r = 8.0
        sat_r = 4.0
        orbit_r = 20.0
        line_thick = 1.0
        full_detail = True
    else:  # 16
        center_r = 3.0
        sat_r = 1.5
        orbit_r = 5.0
        line_thick = 0.8
        full_detail = False

    # Satellite colors and angles (pentagon, starting at top = -90 deg = 270 deg)
    # 0°=top, 72°=top-right, 144°=bottom-right, 216°=bottom-left, 288°=top-left
    satellites = [
        (0,   0,   255, 136),   # green  - top
        (72,  255, 215, 0),     # yellow - top-right
        (144, 255, 140, 0),     # orange - bottom-right
        (216, 255, 51,  102),   # red    - bottom-left
        (288, 168, 85,  247),   # purple - top-left
    ]

    # For 16px, only use 4 satellites (skip one for clarity)
    if not full_detail:
        satellites = satellites[:4]

    # Calculate satellite positions
    sat_positions = []
    for (angle_deg, sr, sg, sb) in satellites:
        angle_rad = math.radians(angle_deg - 90)  # -90 to start from top
        sx = cx + orbit_r * math.cos(angle_rad)
        sy = cy + orbit_r * math.sin(angle_rad)
        sat_positions.append((sx, sy, sr, sg, sb))

    # Draw lines first (behind nodes)
    for (sx, sy, sr, sg, sb) in sat_positions:
        # Line from center node edge to satellite edge
        dx = sx - cx
        dy = sy - cy
        dist = math.sqrt(dx * dx + dy * dy)
        if dist > 0:
            nx = dx / dist
            ny = dy / dist
            lx0 = cx + nx * center_r
            ly0 = cy + ny * center_r
            lx1 = sx - nx * sat_r
            ly1 = sy - ny * sat_r
            draw_line_aa(pixels, size, size, lx0, ly0, lx1, ly1, sr, sg, sb, line_thick)

    # Draw glow on central node (full detail only)
    if full_detail:
        draw_glow(pixels, size, size, cx, cy, center_r, 0, 212, 255)

    # Draw satellite nodes
    for (sx, sy, sr, sg, sb) in sat_positions:
        draw_circle_aa(pixels, size, size, sx, sy, sat_r, sr, sg, sb)

    # Draw central node (cyan, on top)
    draw_circle_aa(pixels, size, size, cx, cy, center_r, 0, 212, 255)

    return make_png_rgba(size, size, pixels)


# Generate and save the three icons
import os
os.makedirs(r'C:\Dev\WebxRay\icons', exist_ok=True)

for size in [16, 48, 128]:
    path = rf'C:\Dev\WebxRay\icons\icon-{size}.png'
    png_data = make_icon(size)
    with open(path, 'wb') as f:
        f.write(png_data)
    print(f"Written {path} ({len(png_data)} bytes)")

print("Done!")
