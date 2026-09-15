# Hazard Reporter

iOS app + centralized API for reporting public hazards (hanging wires, potholes, and other dangers) across the United States. Latitude/longitude determine which authority is notified.

## What it does

1. Capture a photo and GPS location (iOS app or web demo).
2. Upload to the centralized server with a hazard type.
3. Server resolves locality and routes the report:
   - **Hanging wires on Long Island** → Verizon, Altice, and Cablevision outside-plant desks **plus** the NY State Outside Plant Authority.
   - **Wires elsewhere** → state outside-plant authority (NY when known) or US OSP placeholder + regional utility placeholder.
   - **Potholes / road issues** → the town that contains the coordinates (LI towns seeded); otherwise county or US town placeholder.
4. Stores the report and **emails** configured contacts when `EMAIL_ENABLED=true` (otherwise queues contact details for outreach).

Authority coverage is **US-wide in the API**, with **Long Island / New York seeded contacts** and placeholders elsewhere.

## Repository layout

| Path | Purpose |
|------|---------|
| `server/` | Node.js + TypeScript API, SQLite, routing engine, demo web UI |
| `ios/HazardReporter/` | SwiftUI iOS client (camera, location, multipart upload, on-device wire VI) |
| `ml/wire-visual-intelligence/` | Train Core ML to recognize non-standard outside wires for Visual Intelligence |

## Visual Intelligence (non-standard outside wires)

The iOS app ships `NonStandardOutsideWireClassifier.mlpackage` and runs it with Vision whenever a photo is captured. Non-standard outside wires auto-select hazard type **Hanging / damaged wire**.

On iOS 26+ (Xcode with Visual Intelligence SDK), App Intents expose the same classifier to system Visual Intelligence so Camera / screenshot search can surface Hazard Reporter results.

Retrain (bootstrap synthetic set or your own photos):

```bash
cd ml/wire-visual-intelligence
python3 scripts/generate_synthetic_dataset.py
python3 scripts/train_coreml.py
python3 scripts/evaluate_model.py
# then copy models/NonStandardOutsideWireClassifier.mlpackage → ios/.../Resources/
```

See `ml/wire-visual-intelligence/README.md` for Create ML (macOS) and class definitions.

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
- Create report: `POST /api/reports` (multipart: `photo`, `hazardType`, `latitude`, `longitude`, `description`)
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
