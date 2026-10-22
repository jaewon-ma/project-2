"""Turn the stick figure .mov clips into sprite sheets with transparency.

The clips are drawn on black with no alpha channel, so the black is turned
into transparency here. Each output sheet is one row of frames.

Usage:
    mkdir frames && for f in clips/*.mov; do
        n=$(basename "$f" .mov); mkdir -p frames/$n
        ffmpeg -i "$f" -an frames/$n/%03d.png
    done
    python make_sprites.py frames ../assets

Needs Pillow and numpy.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

FRAMES, OUT = Path(sys.argv[1]), Path(sys.argv[2])

# Which frames of each clip hold the motion (1-based, inclusive). The clips are
# 5 s long but the pose change happens in the first (or, for the Reverse clips,
# the last) ~0.7 s; the rest is the pose held still.
FIGURE_CLIPS = {
    "up": ("GoingUp", 1, 24),
    "up_back": ("GoingUpReverse", 127, 150),
    "down": ("GoingDown", 1, 24),
    "down_back": ("GoingDownReverse", 127, 150),
    "left": ("GoingLeft", 1, 24),
    "left_back": ("GoingLeftReverse", 127, 150),
    "right": ("GoingRight", 1, 24),
    "right_back": ("GoingRightReverse", 127, 150),
}
FIGURE_CROP = (230, 150, 840, 1040)  # x0, y0, x1, y1 in the 1080x1080 video; same for every clip so frames line up
FIGURE_H = 320  # stored frame height in pixels

CAPE_CLIP = ("CapeAnimationFull", 4, 26)  # one full loop of the flutter
CAPE_CROP = (20, 410, 1070, 1110)
CAPE_W = 320

NOISE_FLOOR = 16  # darker than this is video noise in the black background: fully transparent
BLACK_CUTOFF = 70  # at least this bright: fully opaque
FIGURE_COLOUR = (14, 111, 252)  # the stick figure is one flat blue, so every pixel gets exactly it


def to_rgba(path, crop, flat_colour=None):
    """Black background -> transparent. Dim edge pixels become partly transparent
    with their colour brightened back up, so the outlines stay smooth."""
    rgb = np.asarray(Image.open(path).convert("RGB").crop(crop)).astype(np.float32)
    alpha = np.clip((rgb.max(axis=2) - NOISE_FLOOR) / (BLACK_CUTOFF - NOISE_FLOOR), 0, 1)
    if flat_colour:
        colour = np.broadcast_to(np.array(flat_colour, np.float32), rgb.shape)
    else:
        colour = np.where(alpha[..., None] > 0, rgb / np.maximum(alpha[..., None], 1e-3), 0)
    rgba = np.dstack([np.clip(colour, 0, 255), alpha * 255]).astype(np.uint8)
    return Image.fromarray(rgba, "RGBA")


def sheet(clip, first, last, crop, size, flat_colour=None):
    frames = [to_rgba(FRAMES / clip / f"{i:03d}.png", crop, flat_colour) for i in range(first, last + 1)]
    w, h = frames[0].size
    if "h" in size:
        fw, fh = round(w * size["h"] / h), size["h"]
    else:
        fw, fh = size["w"], round(h * size["w"] / w)
    out = Image.new("RGBA", (fw * len(frames), fh))
    for n, f in enumerate(frames):
        out.paste(f.resize((fw, fh), Image.LANCZOS), (n * fw, 0))
    return out, fw, fh, len(frames)


info = {}
for name, (clip, first, last) in FIGURE_CLIPS.items():
    img, fw, fh, n = sheet(clip, first, last, FIGURE_CROP, {"h": FIGURE_H}, FIGURE_COLOUR)
    img.save(OUT / f"figure-{name}.webp", quality=90, method=6)
    info[name] = {"frames": n, "w": fw, "h": fh}

# Pointing: the standing pose with one arm rubbed out (frame 0 = left arm gone,
# frame 1 = right arm gone). The app draws the pointing arm itself.
# Boxes are x0, y0, x1, y1 in stored-frame pixels (219 x 320), found by eye.
ERASE = {
    "left": [(0, 128, 104, 200), (0, 128, 60, 216)],
    "right": [(119, 128, 219, 198), (160, 128, 219, 216)],
}
img, fw, fh, n = sheet("GoingDown", 1, 1, FIGURE_CROP, {"h": FIGURE_H}, FIGURE_COLOUR)
out = Image.new("RGBA", (fw * 2, fh))
for n, side in enumerate(["left", "right"]):
    frame = np.asarray(img).copy()
    for x0, y0, x1, y1 in ERASE[side]:
        frame[y0:y1, x0:x1, 3] = 0
    out.paste(Image.fromarray(frame), (n * fw, 0))
out.save(OUT / "figure-point.webp", lossless=True, method=6)
info["point"] = {"frames": 2, "w": fw, "h": fh}

img, fw, fh, n = sheet(*CAPE_CLIP, CAPE_CROP, {"w": CAPE_W})
img.save(OUT / "cape.webp", quality=90, method=6)
info["cape"] = {"frames": n, "w": fw, "h": fh}

print(json.dumps(info, indent=1))
