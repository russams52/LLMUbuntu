#!/usr/bin/env python3
"""Train a MobileNetV3 transfer classifier and export Core ML for iOS Visual Intelligence.

Usage:
  python3 scripts/generate_synthetic_dataset.py
  python3 scripts/train_coreml.py

Outputs:
  models/NonStandardOutsideWireClassifier.mlpackage
  models/metrics.json
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import coremltools as ct
import torch
import torch.nn as nn
from PIL import Image
from torch.utils.data import DataLoader
from torchvision import datasets, models, transforms

CLASS_ORDER = [
    "non_standard_outside_wire",
    "standard_outside_wire",
    "no_outside_wire",
]


def build_loaders(data_root: Path, batch_size: int = 16):
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
    train_ds = datasets.ImageFolder(data_root / "training", transform=train_tf)
    val_ds = datasets.ImageFolder(data_root / "validation", transform=val_tf)

    # Enforce stable class order for Core ML metadata
    if list(train_ds.classes) != CLASS_ORDER:
        # Remap folder order if needed by rebuilding targets
        class_to_idx = {c: i for i, c in enumerate(CLASS_ORDER)}
        for ds in (train_ds, val_ds):
            ds.class_to_idx = class_to_idx
            ds.classes = CLASS_ORDER
            ds.samples = [
                (path, class_to_idx[Path(path).parent.name]) for path, _ in ds.samples
            ]
            ds.targets = [s[1] for s in ds.samples]

    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False, num_workers=0)
    return train_loader, val_loader


def build_model(num_classes: int) -> nn.Module:
    weights = models.MobileNet_V3_Small_Weights.DEFAULT
    model = models.mobilenet_v3_small(weights=weights)
    in_features = model.classifier[-1].in_features
    model.classifier[-1] = nn.Linear(in_features, num_classes)
    return model


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, device: torch.device) -> float:
    model.eval()
    correct = 0
    total = 0
    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        preds = model(images).argmax(dim=1)
        correct += (preds == labels).sum().item()
        total += labels.size(0)
    return correct / max(1, total)


def train(model, train_loader, val_loader, epochs: int, device: torch.device):
    model.to(device)
    # Fine-tune classifier head + last blocks
    for name, param in model.named_parameters():
        param.requires_grad = ("classifier" in name) or ("features.11" in name) or (
            "features.12" in name
        )
    opt = torch.optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=1e-3)
    loss_fn = nn.CrossEntropyLoss()
    history = []
    best_acc = 0.0
    best_state = None

    for epoch in range(1, epochs + 1):
        model.train()
        running = 0.0
        for images, labels in train_loader:
            images, labels = images.to(device), labels.to(device)
            opt.zero_grad()
            logits = model(images)
            loss = loss_fn(logits, labels)
            loss.backward()
            opt.step()
            running += loss.item() * images.size(0)
        train_loss = running / len(train_loader.dataset)
        val_acc = evaluate(model, val_loader, device)
        history.append({"epoch": epoch, "train_loss": train_loss, "val_acc": val_acc})
        print(f"epoch {epoch}: loss={train_loss:.4f} val_acc={val_acc:.3f}")
        if val_acc >= best_acc:
            best_acc = val_acc
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    if best_state:
        model.load_state_dict(best_state)
    return history, best_acc


def export_coreml(model: nn.Module, out_path: Path) -> None:
    model.eval().cpu()

    class SoftmaxWrapper(nn.Module):
        def __init__(self, backbone: nn.Module):
            super().__init__()
            self.backbone = backbone
            self.register_buffer(
                "mean", torch.tensor([0.485, 0.456, 0.406]).view(1, 3, 1, 1)
            )
            self.register_buffer(
                "std", torch.tensor([0.229, 0.224, 0.225]).view(1, 3, 1, 1)
            )

        def forward(self, x):
            # Core ML ImageType delivers RGB floats in [0, 1] via scale=1/255.
            x = (x - self.mean) / self.std
            return torch.nn.functional.softmax(self.backbone(x), dim=1)

    wrapped = SoftmaxWrapper(model)
    example = torch.rand(1, 3, 224, 224)
    traced = torch.jit.trace(wrapped, example)

    mlmodel = ct.convert(
        traced,
        convert_to="mlprogram",
        inputs=[
            ct.ImageType(
                name="image",
                shape=(1, 3, 224, 224),
                scale=1 / 255.0,
                bias=[0.0, 0.0, 0.0],
                color_layout=ct.colorlayout.RGB,
            )
        ],
        classifier_config=ct.ClassifierConfig(CLASS_ORDER),
        minimum_deployment_target=ct.target.iOS17,
    )
    mlmodel.author = "Hazard Reporter"
    mlmodel.short_description = (
        "Recognizes non-standard outside wires for Visual Intelligence hazard reporting."
    )
    mlmodel.version = "1.0.0"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.exists():
        import shutil

        shutil.rmtree(out_path) if out_path.is_dir() else out_path.unlink()
    mlmodel.save(str(out_path))


def smoke_predict(model: nn.Module, image_path: Path) -> dict:
    tf = transforms.Compose(
        [
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
        ]
    )
    img = Image.open(image_path).convert("RGB")
    tensor = tf(img).unsqueeze(0)
    with torch.no_grad():
        probs = torch.softmax(model(tensor), dim=1)[0]
    ranked = sorted(
        (
            {"label": CLASS_ORDER[i], "confidence": float(probs[i])}
            for i in range(len(CLASS_ORDER))
        ),
        key=lambda x: x["confidence"],
        reverse=True,
    )
    return {"top": ranked[0], "all": ranked}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    root = Path(__file__).resolve().parents[1]
    parser.add_argument("--data", type=Path, default=root / "dataset")
    parser.add_argument("--out", type=Path, default=root / "models" / "NonStandardOutsideWireClassifier.mlpackage")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=16)
    args = parser.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    train_loader, val_loader = build_loaders(args.data, args.batch_size)
    model = build_model(len(CLASS_ORDER))
    started = time.time()
    history, best_acc = train(model, train_loader, val_loader, args.epochs, device)
    export_coreml(model, args.out)

    sample = next((args.data / "validation" / CLASS_ORDER[0]).glob("*.jpg"))
    prediction = smoke_predict(model.cpu(), sample)
    metrics = {
        "best_val_accuracy": best_acc,
        "epochs": args.epochs,
        "classes": CLASS_ORDER,
        "elapsed_sec": round(time.time() - started, 2),
        "sample_prediction": prediction,
        "model_path": str(args.out),
    }
    metrics_path = args.out.parent / "metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2))
    torch.save(model.state_dict(), args.out.parent / "pytorch_weights.pt")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
