#!/usr/bin/env python3
"""Generate the overlay's source app icon: a faceted gem in the project's gold accent.

Draws at 2x then downsamples (LANCZOS) for clean antialiasing, on a transparent
background, and writes ../app-icon.png. Feed that to `tauri icon` to regenerate the
full platform icon set:

    cd overlay
    python scripts/make_icon.py
    npx tauri icon app-icon.png      # writes src-tauri/icons/*

The gem palette is keyed to the UI accent (#ffcc44, see src/styles.css --accent).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

SS = 2  # supersample factor
S = 1024 * SS


def s(pts):
    """Scale a list of (x, y) points from the 1024 design space to the SS canvas."""
    return [(x * SS, y * SS) for (x, y) in pts]


# Gold palette (warm, centred on #ffcc44).
TABLE = (255, 232, 150)
LIGHT = (255, 212, 104)
MID = (250, 190, 72)
ACCENT = (255, 204, 68)
DARK = (210, 150, 40)
DARKER = (172, 116, 26)
EDGE = (96, 62, 8, 235)  # facet outline

# Gem geometry in 1024 design space (centred ~ (512, 515)).
TABLE_TL, TABLE_TR = (332, 210), (692, 210)
TBL_BL, TBL_BR = (392, 290), (632, 290)
G_L, G_ML, G_C, G_MR, G_R = (212, 390), (412, 390), (512, 390), (612, 390), (812, 390)
TIP = (512, 820)

# (polygon, fill) — crown facets then pavilion facets, brightest at the table.
FACETS = [
    ([TABLE_TL, TABLE_TR, TBL_BR, TBL_BL], TABLE),
    ([TABLE_TL, TBL_BL, G_L], MID),
    ([TABLE_TR, TBL_BR, G_R], LIGHT),
    ([TBL_BL, TBL_BR, G_MR, G_ML], ACCENT),
    ([TBL_BL, G_ML, G_L], DARK),
    ([TBL_BR, G_R, G_MR], MID),
    ([G_L, G_ML, TIP], DARKER),
    ([G_ML, G_C, TIP], DARK),
    ([G_C, G_MR, TIP], MID),
    ([G_MR, G_R, TIP], DARKER),
]
SILHOUETTE = [TABLE_TL, TABLE_TR, G_R, TIP, G_L]


def main():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Soft outer glow: the gem silhouette in gold, blurred, behind everything.
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).polygon(s(SILHOUETTE), fill=(255, 200, 80, 150))
    glow = glow.filter(ImageFilter.GaussianBlur(28 * SS))
    img = Image.alpha_composite(img, glow)

    d = ImageDraw.Draw(img)
    for poly, fill in FACETS:
        d.polygon(s(poly), fill=fill, outline=EDGE, width=max(1, SS))
    # Crisp outer edge over the whole silhouette.
    d.line(s(SILHOUETTE + [SILHOUETTE[0]]), fill=(70, 44, 4, 255), width=3 * SS, joint="curve")

    img = img.resize((1024, 1024), Image.LANCZOS)
    out = Path(__file__).resolve().parent.parent / "app-icon.png"
    img.save(out)
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
