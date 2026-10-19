from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent
frames_dir = root / "build" / "shots" / "home-motion"
out = root / "build" / "shots" / "home-motion-sheet.png"

paths = sorted(frames_dir.glob("frame-*.png"))
frames = [Image.open(p).convert("RGBA").resize((270, 240), Image.LANCZOS) for p in paths]

cols, rows = 4, 4
sheet = Image.new("RGB", (cols * 270, rows * 240), "#161719")
draw = ImageDraw.Draw(sheet)
for i, frame in enumerate(frames):
    x = (i % cols) * 270
    y = (i // cols) * 240
    sheet.paste(frame, (x, y))
    draw.text((x + 10, y + 8), f"{i * 40}ms", fill="#8a8a8a")
sheet.save(out)
print(f"[sheet] {out} ({out.stat().st_size / 1024:.1f} KiB)")
