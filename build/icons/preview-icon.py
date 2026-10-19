from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[2]
icons = root / "build" / "icons"
out = root / "build" / "shots" / "appicon-preview.png"

W, H = 1200, 660
sheet = Image.new("RGB", (W, H), "#161719")
d = ImageDraw.Draw(sheet)


def font(size):
    for name in ("C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/segoeui.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


d.text((48, 40), "ReadS · 应用图标", fill="#f2f2f2", font=font(28))
d.text((48, 80), "橙色瓦片 + 白色页面 + RSS 信号 · 16 / 24 使用简化版本", fill="#8b8b8b", font=font(14))

# Large tile on dark and light surfaces.
for x, bg, label in ((48, "#222428", "深色背景"), (380, "#f2f2f4", "浅色背景")):
    d.rounded_rectangle((x, 130, x + 280, 410), radius=18, fill=bg)
    tile = Image.open(icons / "appicon-256.png").convert("RGBA")
    sheet.paste(tile, (x + 12, 142), tile)
    d.text((x + 14, 418), label, fill="#777777", font=font(12))

# Size ladder.
sizes = [128, 64, 48, 32, 24, 16]
x = 700
d.text((x, 130), "尺寸阶梯（原始像素）", fill="#8b8b8b", font=font(13))
for size in sizes:
    src = icons / ("appicon-16.png" if size == 16 else "appicon-24.png" if size == 24 else f"appicon-{size}.png")
    img = Image.open(src).convert("RGBA")
    y = 170 + (128 - size) // 2
    sheet.paste(img, (x, y), img)
    d.text((x, 315), str(size), fill="#777777", font=font(11))
    x += size + 26

# Zoomed 32 / 16 for legibility check.
d.text((48, 470), "16px / 32px 放大检查（nearest）", fill="#8b8b8b", font=font(13))
for i, size in enumerate((16, 32)):
    img = Image.open(icons / f"appicon-{size}.png").convert("RGBA")
    zoom = img.resize((size * 6, size * 6), Image.NEAREST)
    px = 48 + i * (32 * 6 + 40)
    sheet.paste(zoom, (px, 500), zoom)
    d.text((px, 500 + size * 6 + 8), f"{size}px ×6", fill="#777777", font=font(11))

sheet.save(out)
print(f"[preview] {out}")
