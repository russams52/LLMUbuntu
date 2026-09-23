#!/usr/bin/env python3
"""Generate a small synthetic dataset for PublicHazardClassifier bootstrapping.

Creates JPEG folders under data/training and data/validation for:
  hanging_wire, pothole, road_damage, debris_obstacle, safe_scene
"""

from __future__ import annotations

import argparse
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw


CLASSES = [
    "hanging_wire",
    "pothole",
    "road_damage",
    "debris_obstacle",
    "safe_scene",
]


def sky_ground(draw: ImageDraw.ImageDraw, size: int, seed: int) -> None:
    rng = random.Random(seed)
    for y in range(size):
        t = y / size
        if t < 0.55:
            color = (120 + rng.randint(0, 30), 160 + rng.randint(0, 40), 210 + rng.randint(0, 40))
        else:
            color = (70 + rng.randint(0, 20), 95 + rng.randint(0, 25), 55 + rng.randint(0, 20))
        draw.line([(0, y), (size, y)], fill=color)


def draw_wire(img: Image.Image, seed: int) -> None:
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    sky_ground(draw, size, seed)
    rng = random.Random(seed)
    for i in range(3):
        y = 35 + i * 10 + rng.randint(-2, 2)
        points = []
        for x in range(10, size - 10, 4):
            sag = int(18 * math.sin(math.pi * (x / size))) + rng.randint(-1, 1)
            points.append((x, y + sag))
        draw.line(points, fill=(20, 20, 20), width=2)
    # poles
    draw.rectangle([18, 20, 24, size - 10], fill=(90, 60, 30))
    draw.rectangle([size - 24, 20, size - 18, size - 10], fill=(90, 60, 30))


def draw_pothole(img: Image.Image, seed: int) -> None:
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    rng = random.Random(seed)
    for y in range(size):
        for x in range(size):
            g = 90 + ((x * 13 + y * 7 + seed) % 17) - 8
            img.putpixel((x, y), (g, g, max(0, g - 2)))
    cx, cy = size // 2 + rng.randint(-8, 8), int(size * 0.68) + rng.randint(-6, 6)
    rx, ry = rng.randint(18, 28), rng.randint(12, 20)
    draw.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(22, 18, 16))


def draw_road_damage(img: Image.Image, seed: int) -> None:
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    rng = random.Random(seed)
    for y in range(size):
        for x in range(size):
            g = 100 + ((x * 9 + y * 3 + seed) % 13) - 6
            img.putpixel((x, y), (g, g, g - 1))
    for _ in range(8):
        x0 = rng.randint(10, size - 20)
        y0 = rng.randint(40, size - 20)
        draw.line([(x0, y0), (x0 + rng.randint(20, 50), y0 + rng.randint(-10, 10))], fill=(40, 40, 40), width=2)


def draw_debris(img: Image.Image, seed: int) -> None:
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    rng = random.Random(seed)
    sky_ground(draw, size, seed + 3)
    for _ in range(5):
        x = rng.randint(20, size - 40)
        y = rng.randint(int(size * 0.55), size - 30)
        w = rng.randint(12, 30)
        h = rng.randint(8, 22)
        color = (rng.randint(40, 120), rng.randint(30, 90), rng.randint(20, 70))
        draw.rectangle([x, y, x + w, y + h], fill=color)


def draw_safe(img: Image.Image, seed: int) -> None:
    draw = ImageDraw.Draw(img)
    size = img.size[0]
    sky_ground(draw, size, seed + 9)
    # even horizon road
    draw.rectangle([0, int(size * 0.7), size, size], fill=(110, 110, 112))
    draw.line([(size // 2, int(size * 0.7)), (size // 2, size)], fill=(200, 200, 160), width=2)


DRAWERS = {
    "hanging_wire": draw_wire,
    "pothole": draw_pothole,
    "road_damage": draw_road_damage,
    "debris_obstacle": draw_debris,
    "safe_scene": draw_safe,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=Path("data"))
    parser.add_argument("--train", type=int, default=40)
    parser.add_argument("--val", type=int, default=10)
    parser.add_argument("--size", type=int, default=224)
    args = parser.parse_args()

    for split, count in (("training", args.train), ("validation", args.val)):
        for cls in CLASSES:
            folder = args.out / split / cls
            folder.mkdir(parents=True, exist_ok=True)
            drawer = DRAWERS[cls]
            for i in range(count):
                img = Image.new("RGB", (args.size, args.size))
                drawer(img, seed=hash((cls, split, i)) % 10_000)
                img.save(folder / f"{cls}_{i:03d}.jpg", quality=90)

    print(f"Wrote synthetic dataset to {args.out.resolve()}")


if __name__ == "__main__":
    main()
