# Non-Standard Outside Wire — Visual Intelligence training

On-device image classifier that teaches Hazard Reporter (and iOS Visual Intelligence) to recognize **non-standard outside wires**: sagging, dangling, tangled, low-clearance, downed, or damaged aerial plant.

## Classes

| Label | Meaning | Reportable |
|-------|---------|------------|
| `non_standard_outside_wire` | Hazard-like outdoor wire | Yes → hazard type `wire` |
| `standard_outside_wire` | Even-tension aerial plant | No |
| `no_outside_wire` | Outdoor scene without wires | No |

## Quick start (Linux / CI bootstrap)

```bash
cd ml/wire-visual-intelligence
python3 scripts/generate_synthetic_dataset.py   # bootstrap images
python3 scripts/train_coreml.py --epochs 6      # exports Core ML package
python3 scripts/evaluate_model.py               # asserts ≥90% val accuracy
```

Outputs:

- `models/NonStandardOutsideWireClassifier.mlpackage` — bundled in the iOS app
- `models/pytorch_weights.pt` — for offline evaluation
- `models/metrics.json` — training summary

The synthetic set is for pipeline bootstrapping. Replace images under `dataset/training/<class>/` with real field photos before shipping.

## Create ML on Mac (recommended for production photos)

1. Drop real JPEGs into `dataset/training/<class>/` and `dataset/validation/<class>/`.
2. From this directory on macOS:

```bash
swift scripts/train_createml.swift
```

3. Copy the resulting `.mlmodel` into `ios/HazardReporter/HazardReporter/Resources/`.

## iOS integration

- `WireVisualIntelligenceService` runs Vision + Core ML on captured photos.
- `WireVisualIntelligenceQuery` (`#if canImport(VisualIntelligence)`) answers system Visual Intelligence with `WireHazardEntity` results.
- `OpenWireHazardIntent` / continue-in-app intent hand off into the report form with hazard type `wire`.

Requires Xcode with the iOS 26+ SDK for the Visual Intelligence App Intents path; in-app classification works on iOS 17+ with the bundled model.
