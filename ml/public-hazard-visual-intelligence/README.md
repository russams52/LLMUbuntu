# Public Hazard Visual Intelligence

Train a multi-class Core ML classifier for Hazard Reporter so iOS Visual Intelligence can identify:

- hanging / damaged wires
- potholes
- general road damage
- debris / obstacles
- safe scenes (not reportable)

## Labels

See `labels.json`. Class folder names must match the `id` fields.

## Train (Python)

Requires `torch`, `torchvision`, `pillow`, `coremltools`.

```bash
cd ml/public-hazard-visual-intelligence
python3 scripts/generate_synthetic_dataset.py
python3 scripts/train_coreml.py
python3 scripts/evaluate_model.py
```

Copy the exported package into the iOS app:

```bash
cp -R models/PublicHazardClassifier.mlpackage \
  ../../ios/HazardReporter/HazardReporter/Resources/
```

Without the Core ML package, the iOS app still classifies via Apple Vision taxonomy mapping and the server `/api/vision/classify` endpoint.

## Server-side Visual Intelligence

The Node API runs a heuristic CV classifier by default (`VISION_BACKEND=heuristic`). Set `VISION_BACKEND=clip` to use Xenova CLIP zero-shot classification.
