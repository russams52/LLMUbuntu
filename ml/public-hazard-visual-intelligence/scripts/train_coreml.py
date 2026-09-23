#!/usr/bin/env python3
"""Train MobileNetV3 and export PublicHazardClassifier.mlpackage for iOS.

Usage:
  python3 scripts/generate_synthetic_dataset.py
  python3 scripts/train_coreml.py
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

CLASS_ORDER = [
    "hanging_wire",
    "pothole",
    "road_damage",
    "debris_obstacle",
    "safe_scene",
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--out", type=Path, default=Path("models"))
    args = parser.parse_args()

    try:
        import coremltools as ct
        import torch
        import torch.nn as nn
        from torch.utils.data import DataLoader
        from torchvision import datasets, models, transforms
    except ImportError as exc:
        raise SystemExit(
            "Install torch, torchvision, pillow, and coremltools to train.\n"
            f"Missing dependency detail: {exc}"
        ) from exc

    train_tf = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.RandomHorizontalFlip(),
            transforms.ColorJitter(0.15, 0.15, 0.1, 0.05),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    val_tf = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )

    train_ds = datasets.ImageFolder(args.data / "training", transform=train_tf)
    val_ds = datasets.ImageFolder(args.data / "validation", transform=val_tf)
    class_to_idx = {c: i for i, c in enumerate(CLASS_ORDER)}
    for ds in (train_ds, val_ds):
        ds.class_to_idx = class_to_idx
        ds.classes = CLASS_ORDER
        ds.samples = [(path, class_to_idx[Path(path).parent.name]) for path, _ in ds.samples]
        ds.targets = [s[1] for s in ds.samples]

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
    model.classifier[-1] = nn.Linear(model.classifier[-1].in_features, len(CLASS_ORDER))
    model = model.to(device)
    opt = torch.optim.Adam(model.parameters(), lr=1e-4)
    loss_fn = nn.CrossEntropyLoss()

    def evaluate() -> float:
        model.eval()
        correct = total = 0
        with torch.no_grad():
            for xb, yb in val_loader:
                xb, yb = xb.to(device), yb.to(device)
                pred = model(xb).argmax(1)
                correct += (pred == yb).sum().item()
                total += yb.numel()
        return correct / max(total, 1)

    history = []
    for epoch in range(args.epochs):
        model.train()
        running = 0.0
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            opt.zero_grad()
            loss = loss_fn(model(xb), yb)
            loss.backward()
            opt.step()
            running += loss.item()
        acc = evaluate()
        history.append({"epoch": epoch + 1, "loss": running / max(len(train_loader), 1), "val_acc": acc})
        print(f"epoch {epoch + 1}: loss={history[-1]['loss']:.4f} val_acc={acc:.3f}")

    args.out.mkdir(parents=True, exist_ok=True)
    weights_path = args.out / "pytorch_weights.pt"
    torch.save(model.state_dict(), weights_path)

    model.eval().cpu()
    example = torch.zeros(1, 3, 224, 224)
    traced = torch.jit.trace(model, example)
    mlmodel = ct.convert(
        traced,
        inputs=[ct.ImageType(name="image", shape=example.shape, scale=1 / 255.0, bias=[0, 0, 0])],
        classifier_config=ct.ClassifierConfig(CLASS_ORDER),
        minimum_deployment_target=ct.target.iOS16,
    )
    package = args.out / "PublicHazardClassifier.mlpackage"
    mlmodel.save(str(package))

    metrics = {
        "classes": CLASS_ORDER,
        "history": history,
        "exported_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "package": str(package),
    }
    (args.out / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(f"Wrote {package}")


if __name__ == "__main__":
    main()
