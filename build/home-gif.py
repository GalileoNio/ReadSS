from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
frames_dir = root / "build" / "shots" / "home-motion"
out = root / "build" / "shots" / "home-motion.gif"

paths = sorted(frames_dir.glob("frame-*.png"))
frames = [Image.open(p).convert("RGBA") for p in paths]
assert frames, "no frames"

# Keep the rest pose readable at the loop seam.
durations = [100] + [40] * (len(frames) - 1)
frames[0].save(
    out,
    save_all=True,
    append_images=frames[1:],
    duration=durations,
    loop=0,
    disposal=2,
    optimize=False,
)
print(f"[gif] {out} ({len(frames)} frames, {out.stat().st_size / 1024:.1f} KiB)")
