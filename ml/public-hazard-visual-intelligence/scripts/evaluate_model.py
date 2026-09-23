#!/usr/bin/env python3
"""Quick evaluation helper for PublicHazardClassifier training artifacts."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--metrics", type=Path, default=Path("models/metrics.json"))
    args = parser.parse_args()
    if not args.metrics.exists():
        raise SystemExit(f"Missing {args.metrics}. Train first with scripts/train_coreml.py")
    data = json.loads(args.metrics.read_text())
    history = data.get("history") or []
    best = max((row.get("val_acc") or 0) for row in history) if history else 0
    print(f"classes: {', '.join(data.get('classes') or [])}")
    print(f"epochs: {len(history)}")
    print(f"best val_acc: {best:.3f}")
    print(f"package: {data.get('package')}")


if __name__ == "__main__":
    main()
