# Hazard Reporter

iOS app + centralized API for reporting public hazards (hanging wires, potholes, and other dangers) across the United States. **Visual Intelligence** identifies the issue from the photo; latitude/longitude determine which authority is notified.

## What it does

1. Capture a photo and GPS location (iOS app or web demo).
2. **Visual Intelligence** classifies the scene (hanging wire, pothole, road damage, debris, or safe).
3. Upload to the centralized server with the detected (or manually chosen) hazard type.
4. Server resolves locality and routes the report:
   - **Hanging wires on Long Island** → Verizon, Altice, and Cablevision outside-plant desks **plus** the NY State Outside Plant Authority.
   - **Wires elsewhere** → state outside-plant authority (NY when known) or US OSP placeholder + regional utility placeholder.
   - **Potholes / road issues** → the town that contains the coordinates (LI towns seeded); otherwise county or US town placeholder.
5. Stores the report and **emails** configured contacts when `EMAIL_ENABLED=true` (otherwise queues contact details for outreach).

Authority coverage is **US-wide in the API**, with **Long Island / New York seeded contacts** and placeholders elsewhere.

## Repository layout

| Path | Purpose |
|------|---------|
| `server/` | Node.js + TypeScript API, SQLite, routing engine, Visual Intelligence, demo web UI |
| `ios/HazardReporter/` | SwiftUI iOS client (camera, location, on-device + server VI, multipart upload) |
| `ml/public-hazard-visual-intelligence/` | Train Core ML for multi-class public hazard recognition |

## Visual Intelligence

### Server

`POST /api/vision/classify` (multipart `photo`, optional `description`) returns a label, confidence, and suggested `hazardType`.

Backends:

- `VISION_BACKEND=heuristic` (default) — offline CV features via `sharp` (fast, testable).
- `VISION_BACKEND=clip` — Xenova CLIP zero-shot image classification.

Report create (`POST /api/reports`) runs auto-detect by default (`autoDetect=true`) and can accept on-device `visionLabel` / `visionConfidence` from iOS.

### iOS

1. Prefer bundled `PublicHazardClassifier.mlpackage` (Core ML + Vision).
2. Else map Apple Vision taxonomy labels to hazard classes.
3. Else call the server classify API.

Suggested hazard type is applied automatically when confidence clears the threshold.

Retrain Core ML:

```bash
cd ml/public-hazard-visual-intelligence
python3 scripts/generate_synthetic_dataset.py
python3 scripts/train_coreml.py
# copy models/PublicHazardClassifier.mlpackage → ios/.../Resources/
```

## Server quick start

```bash
cd server
cp .env.example .env
npm install
npm run seed   # optional; also runs on startup
npm run dev
```

- API health: `http://localhost:3000/health`
- Demo UI: `http://localhost:3000/demo/`
- Classify: `POST /api/vision/classify`
- Create report: `POST /api/reports` (multipart: `photo`, optional `hazardType`, `latitude`, `longitude`, `description`, `autoDetect`)
- Preview routing: `GET /api/routing/preview?hazardType=wire&latitude=40.7062&longitude=-73.6187`

```bash
npm test
```

### Email

Set in `.env`:

```
EMAIL_ENABLED=true
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@yourdomain.com
```

Without SMTP, reports still route and store; notification details explain that email is disabled.

## iOS app

Requires a Mac with Xcode 15+ / iOS 17+.

1. Optionally generate the Xcode project with [XcodeGen](https://github.com/yonaskolb/XcodeGen):

   ```bash
   cd ios/HazardReporter
   xcodegen generate
   open HazardReporter.xcodeproj
   ```

   Or create a new **App** project in Xcode, set bundle id `com.hazardreporter.app`, and add the Swift sources under `HazardReporter/` plus `Info.plist`.

2. Set the API base URL (default `http://127.0.0.1:3000`) via scheme environment variable `HAZARD_API_URL`, or edit `APIClient.swift`.

3. Run on a device or simulator (camera falls back to photo library on simulator). Enable location when prompted.

## Sample coordinates

| Place | Lat | Lng | Expected routing |
|-------|-----|-----|------------------|
| Hempstead, LI | 40.7062 | -73.6187 | Wire → Verizon, Altice, Cablevision, NY OSP |
| Brookhaven, LI | 40.92 | -72.85 | Pothole → Town of Brookhaven |
| Los Angeles | 34.0522 | -118.2437 | Wire → US utility + OSP placeholders |

## Expanding nationwide

Add rows to `server/src/data/authorities.ts` (town boxes, telecom footprints, per-state OSP contacts) and re-seed. Routing prefers the tightest matching bounding box; placeholders cover gaps.
