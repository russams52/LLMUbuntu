#!/usr/bin/env python3
"""Evaluate the trained wire classifier on the validation split (no Core ML required)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from torchvision import datasets, models, transforms

CLASS_ORDER = [
    "non_standard_outside_wire",
    "standard_outside_wire",
    "no_outside_wire",
]


def build_model(num_classes: int) -> nn.Module:
    model = models.mobilenet_v3_small(weights=None)
    in_features = model.classifier[-1].in_features
    model.classifier[-1] = nn.Linear(in_features, num_classes)
    return model


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=root / "dataset" / "validation")
    parser.add_argument("--weights", type=Path, default=root / "models" / "pytorch_weights.pt")
    parser.add_argument("--min-accuracy", type=float, default=0.9)
    args = parser.parse_args()

    if not args.weights.exists():
        print(f"Missing weights: {args.weights}", file=sys.stderr)
        return 1

    tf = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    ds = datasets.ImageFolder(args.data, transform=tf)
    class_to_idx = {c: i for i, c in enumerate(CLASS_ORDER)}
    ds.class_to_idx = class_to_idx
    ds.classes = CLASS_ORDER
    ds.samples = [(path, class_to_idx[Path(path).parent.name]) for path, _ in ds.samples]
    ds.targets = [s[1] for s in ds.samples]
    loader = DataLoader(ds, batch_size=16, shuffle=False)

    model = build_model(len(CLASS_ORDER))
    model.load_state_dict(torch.load(args.weights, map_location="cpu"))
    model.eval()

    correct = 0
    total = 0
    per_class = {c: {"correct": 0, "total": 0} for c in CLASS_ORDER}
    with torch.no_grad():
        for images, labels in loader:
            preds = model(images).argmax(dim=1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)
            for label, pred in zip(labels.tolist(), preds.tolist()):
                name = CLASS_ORDER[label]
                per_class[name]["total"] += 1
                if label == pred:
                    per_class[name]["correct"] += 1

    accuracy = correct / max(1, total)
    report = {
        "accuracy": accuracy,
        "correct": correct,
        "total": total,
        "per_class": {
            k: {
                "accuracy": (v["correct"] / v["total"] if v["total"] else 0.0),
                **v,
            }
            for k, v in per_class.items()
        },
    }
    print(json.dumps(report, indent=2))
    if accuracy < args.min_accuracy:
        print(f"Accuracy {accuracy:.3f} below minimum {args.min_accuracy}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
