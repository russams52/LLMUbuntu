#!/usr/bin/env python3
"""Generate a bootstrap outdoor-wire image dataset for Create ML / Core ML training.

Synthetic images approximate visual cues of non-standard vs standard aerial plant
so the pipeline can train before real field photos are collected. Replace/augment
dataset/training with real photos for production accuracy.
"""

from __future__ import annotations

import argparse
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

CLASSES = (
    "non_standard_outside_wire",
    "standard_outside_wire",
    "no_outside_wire",
)

SIZE = (224, 224)


def sky_gradient(rng: random.Random) -> Image.Image:
    img = Image.new("RGB", SIZE)
    top = tuple(rng.randint(90, 170) for _ in range(3))
    bottom = tuple(rng.randint(180, 235) for _ in range(3))
    px = img.load()
    for y in range(SIZE[1]):
        t = y / (SIZE[1] - 1)
        color = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        for x in range(SIZE[0]):
            noise = rng.randint(-6, 6)
            px[x, y] = tuple(max(0, min(255, c + noise)) for c in color)
    return img


def draw_pole(draw: ImageDraw.ImageDraw, x: int, ground_y: int, rng: random.Random) -> None:
    width = rng.randint(4, 8)
    color = (rng.randint(40, 80), rng.randint(30, 60), rng.randint(20, 40))
    draw.rectangle([x - width // 2, 20, x + width // 2, ground_y], fill=color)
    # crossarm
    draw.rectangle([x - 18, 28, x + 18, 34], fill=color)


def draw_standard_span(
    draw: ImageDraw.ImageDraw,
    left: int,
    right: int,
    y: int,
    rng: random.Random,
) -> None:
    color = (rng.randint(15, 45),) * 3
    # nearly straight span with tiny sag
    for i in range(left, right + 1):
        t = (i - left) / max(1, right - left)
        sag = int(4 * math.sin(math.pi * t))
        draw.point((i, y + sag), fill=color)
        if rng.random() < 0.35:
            draw.point((i, y + sag + 1), fill=color)


def draw_nonstandard_span(
    draw: ImageDraw.ImageDraw,
    left: int,
    right: int,
    rng: random.Random,
    subtype: str,
) -> None:
    color = (rng.randint(10, 40),) * 3
    if subtype == "downed_on_ground":
        ground = SIZE[1] - rng.randint(18, 35)
        mid = (left + right) // 2
        # steep drop then rest near ground
        for i in range(left, mid):
            t = (i - left) / max(1, mid - left)
            y = int(40 + t * (ground - 40))
            draw.ellipse([i - 1, y - 1, i + 1, y + 1], fill=color)
        for i in range(mid, right + 1):
            y = ground + rng.randint(-2, 2)
            draw.ellipse([i - 1, y - 1, i + 1, y + 1], fill=color)
        return

    if subtype == "detached_dangling":
        attach = left + rng.randint(10, 30)
        for i in range(left, attach):
            draw.point((i, 42 + rng.randint(0, 2)), fill=color)
        length = rng.randint(70, 130)
        x = attach
        for j in range(length):
            x += rng.choice([-1, 0, 0, 1])
            y = 42 + j
            if y >= SIZE[1] - 10:
                break
            draw.ellipse([x - 1, y - 1, x + 1, y + 1], fill=color)
        return

    if subtype == "tangled_crossed":
        for offset, phase in ((0, 0.0), (8, 0.4), (-6, 1.1)):
            for i in range(left, right + 1):
                t = (i - left) / max(1, right - left)
                y = int(48 + offset + 28 * math.sin(math.pi * t + phase) ** 2)
                draw.point((i, y), fill=color)
                draw.point((i, y + 1), fill=color)
        return

    # sagging_low / service_drop_damaged default: deep catenary
    depth = rng.randint(55, 95) if subtype == "sagging_low" else rng.randint(40, 75)
    base = rng.randint(35, 55)
    for i in range(left, right + 1):
        t = (i - left) / max(1, right - left)
        y = int(base + depth * math.sin(math.pi * t) ** 1.4)
        draw.ellipse([i - 1, y - 1, i + 1, y + 1], fill=color)
        if subtype == "service_drop_damaged" and 0.35 < t < 0.65:
            # frayed secondary strand
            draw.point((i, y + rng.randint(3, 10)), fill=color)


def add_ground(draw: ImageDraw.ImageDraw, rng: random.Random) -> int:
    ground_y = SIZE[1] - rng.randint(20, 40)
    green = (rng.randint(40, 90), rng.randint(90, 140), rng.randint(40, 80))
    draw.rectangle([0, ground_y, SIZE[0], SIZE[1]], fill=green)
    return ground_y


def add_trees(draw: ImageDraw.ImageDraw, rng: random.Random) -> None:
    for _ in range(rng.randint(1, 3)):
        x = rng.randint(10, SIZE[0] - 10)
        h = rng.randint(40, 90)
        top = SIZE[1] - 30 - h
        color = (rng.randint(20, 60), rng.randint(70, 120), rng.randint(20, 50))
        draw.ellipse([x - 18, top, x + 18, top + 36], fill=color)


def make_image(label: str, rng: random.Random) -> Image.Image:
    img = sky_gradient(rng)
    draw = ImageDraw.Draw(img)
    ground_y = add_ground(draw, rng)
    if rng.random() < 0.7:
        add_trees(draw, rng)

    if label == "no_outside_wire":
        if rng.random() < 0.4:
            # building silhouette, no wires
            x0 = rng.randint(20, 120)
            draw.rectangle([x0, ground_y - rng.randint(50, 110), x0 + 50, ground_y], fill=(70, 70, 80))
        return img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.2, 0.8)))

    left = rng.randint(20, 40)
    right = rng.randint(180, 205)
    draw_pole(draw, left, ground_y, rng)
    draw_pole(draw, right, ground_y, rng)

    if label == "standard_outside_wire":
        for y in (38, 46, 54):
            draw_standard_span(draw, left, right, y, rng)
    else:
        subtype = rng.choice(
            [
                "sagging_low",
                "detached_dangling",
                "tangled_crossed",
                "downed_on_ground",
                "service_drop_damaged",
            ]
        )
        draw_nonstandard_span(draw, left, right, rng, subtype)
        if rng.random() < 0.4:
            draw_standard_span(draw, left, right, 36, rng)

    return img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.0, 0.6)))


def write_split(root: Path, split: str, per_class: int, seed: int) -> None:
    rng = random.Random(seed)
    for label in CLASSES:
        out = root / split / label
        out.mkdir(parents=True, exist_ok=True)
        for i in range(per_class):
            img = make_image(label, rng)
            img.save(out / f"{label}_{i:04d}.jpg", quality=90)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "dataset",
    )
    parser.add_argument("--train", type=int, default=80)
    parser.add_argument("--val", type=int, default=20)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    write_split(args.root, "training", args.train, args.seed)
    write_split(args.root, "validation", args.val, args.seed + 1)
    print(
        f"Wrote {args.train} train + {args.val} val images per class under {args.root}"
    )


if __name__ == "__main__":
    main()
