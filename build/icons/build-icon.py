import io
import struct
from pathlib import Path

from PIL import Image

root = Path(__file__).resolve().parents[2]
icons = root / "build" / "icons"
public = root / "frontend" / "public"
public.mkdir(parents=True, exist_ok=True)

detail = Image.open(icons / "appicon-1024.png").convert("RGBA")
small = Image.open(icons / "appicon-small-1024.png").convert("RGBA")


def png_bytes(image: Image.Image, size: int) -> bytes:
    buf = io.BytesIO()
    image.resize((size, size), Image.LANCZOS).save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_ico(path: Path, entries: list[tuple[int, bytes]]) -> None:
    """Writes a multi-image ICO with PNG payloads (Vista+)."""
    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    directory = b""
    payload = b""
    for size, data in entries:
        dim = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
        payload += data
    path.write_bytes(header + directory + payload)


# Raster PNGs: below 32px the three text lines blur into an orange block, so
# those sizes use the simplified page + single signal arc.
for size in (512, 256, 128, 64, 48, 32):
    detail.resize((size, size), Image.LANCZOS).save(icons / f"appicon-{size}.png")
for size in (24, 16):
    small.resize((size, size), Image.LANCZOS).save(icons / f"appicon-{size}.png")

# Windows uses 16/24 for small shell views, 32/48 for medium, 256 for large.
write_ico(
    icons / "appicon.ico",
    [
        (16, png_bytes(small, 16)),
        (24, png_bytes(small, 24)),
        (32, png_bytes(detail, 32)),
        (48, png_bytes(detail, 48)),
        (64, png_bytes(detail, 64)),
        (128, png_bytes(detail, 128)),
        (256, png_bytes(detail, 256)),
    ],
)

# Browser tab / in-app assets. Vite copies public/ verbatim into dist/.
detail.resize((180, 180), Image.LANCZOS).save(public / "appicon-180.png")
detail.resize((48, 48), Image.LANCZOS).save(public / "appicon-48.png")
write_ico(
    public / "favicon.ico",
    [
        (16, png_bytes(small, 16)),
        (32, png_bytes(detail, 32)),
        (48, png_bytes(detail, 48)),
    ],
)
(public / "appicon.svg").write_text((icons / "appicon.svg").read_text(encoding="utf-8"), encoding="utf-8")

print("generated appicon.ico, PNG sizes, favicon.ico")
