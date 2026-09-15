from PIL import Image, ImageDraw, ImageFont

# CAD origin: board X 151.535..173.535, Y 28.165..44.165
OX, OY = 151.535, 28.165
W, H = 22.0, 16.0
SCALE = 28
PAD = 72
img_w = int(W * SCALE + PAD * 2)
img_h = int(H * SCALE + PAD * 2 + 90)
im = Image.new("RGB", (img_w, img_h), "#12110f")
d = ImageDraw.Draw(im)
try:
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
    font_s = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 13)
    font_b = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 18)
except OSError:
    font = font_s = font_b = ImageFont.load_default()


def xy(x, y):
    # CAD Y up; image Y down. Flip Y so top edge (pins) is up on the page.
    px = PAD + (x - OX) * SCALE
    py = PAD + (OY + H - y) * SCALE
    return px, py


# board
r = 2.0 * SCALE
box = [xy(OX, OY + H)[0], xy(OX, OY + H)[1], xy(OX + W, OY)[0], xy(OX + W, OY)[1]]
d.rounded_rectangle(box, radius=r, outline="#e8c48a", width=3, fill="#1c1a17")

# pins: CAD Y=42.700 is near top (44.165)
pins = [
    (157.506, "1 5V", "#d9896a"),
    (160.046, "2 GND", "#9a9084"),
    (162.586, "3 RX", "#8fbc8f"),
    (165.126, "4 TX", "#8fbc8f"),
    (167.666, "5 OUT", "#e8c48a"),
]
for x, lab, col in pins:
    cx, cy = xy(x, 42.700)
    d.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), outline=col, width=2)
    d.text((cx, cy - 28), lab, fill=col, font=font_s, anchor="mm")

# LED D1
lx, ly = xy(154.602, 30.532)
d.rectangle((lx - 8, ly - 5, lx + 8, ly + 5), outline="#8fbc8f", width=2)
d.text((lx, ly + 18), "D1 LED", fill="#8fbc8f", font=font_s, anchor="mm")

# U1 radar SoC center
ux, uy = xy(162.535, 32.893)
d.rectangle((ux - 36, uy - 22, ux + 36, uy + 22), outline="#f2eadf", width=2)
d.text((ux, uy), "U1 雷达核", fill="#f2eadf", font=font_s, anchor="mm")

# U2 RF right
rx, ry = xy(169.059, 33.720)
d.rectangle((rx - 22, ry - 16, rx + 22, ry + 16), outline="#d9896a", width=2)
d.text((rx, ry), "U2 RF", fill="#d9896a", font=font_s, anchor="mm")

# U3 regulator
sx, sy = xy(170.196, 40.030)
d.rectangle((sx - 18, sy - 10, sx + 18, sy + 10), outline="#9a9084", width=1)
d.text((sx, sy), "U3", fill="#9a9084", font=font_s, anchor="mm")

d.text((img_w / 2, 28), "HLK-LD2410C  STEP 解析  顶视", fill="#f2eadf", font=font_b, anchor="mm")
d.text((img_w / 2, img_h - 48), "板 22.00 × 16.00 × 1.00 mm   四角 R2   针距 2.54 mm   孔径 Ø0.90", fill="#9a9084", font=font, anchor="mm")
d.text((img_w / 2, img_h - 24), "针在长边。天线/RF 在右侧。接 USB-TTL：TX↔RX 交叉，5V 供电、3.3V 电平。", fill="#9a9084", font=font_s, anchor="mm")

out = r"d:\pro222\sleep-hub\plugins\ld2410c_3d\ld2410c_top.png"
im.save(out)
print("wrote", out, im.size)
