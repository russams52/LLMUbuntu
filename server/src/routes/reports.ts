import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { createReport, getReport, listReports } from "../services/reports";
import { resolveGeoContext, routeAuthorities } from "../services/routing";
import {
  classifyHazardImage,
  isVisionLabel,
  type VisionLabel,
} from "../services/vision";
import type { HazardType } from "../types";
import { db } from "../db";

const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image uploads are allowed"));
      return;
    }
    cb(null, true);
  },
});

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only image uploads are allowed"));
      return;
    }
    cb(null, true);
  },
});

const HAZARD_TYPES: HazardType[] = ["wire", "pothole", "road_issue", "other"];

function parseBool(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === "") return defaultValue;
  const s = String(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return defaultValue;
}

export const reportsRouter = Router();

reportsRouter.get("/", (_req, res) => {
  res.json({ reports: listReports() });
});

reportsRouter.get("/:id", (req, res) => {
  const report = getReport(req.params.id);
  if (!report) {
    res.status(404).json({ error: "Report not found" });
    return;
  }
  res.json(report);
});

reportsRouter.post("/", upload.single("photo"), async (req, res) => {
  try {
    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    const description = req.body.description ? String(req.body.description) : undefined;
    const autoDetect = parseBool(req.body.autoDetect, true);
    const rawHazard = req.body.hazardType ? String(req.body.hazardType) : undefined;
    const hazardType = rawHazard as HazardType | undefined;

    if (hazardType && !HAZARD_TYPES.includes(hazardType)) {
      res.status(400).json({
        error: `hazardType must be one of: ${HAZARD_TYPES.join(", ")}`,
      });
      return;
    }
    if (!autoDetect && !hazardType) {
      res.status(400).json({
        error: "hazardType is required when autoDetect is false",
      });
      return;
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      res.status(400).json({ error: "latitude and longitude are required numbers" });
      return;
    }
    if (latitude < 24 || latitude > 50 || longitude < -126 || longitude > -65) {
      res.status(400).json({
        error: "Coordinates must be within the continental United States",
      });
      return;
    }

    const clientVisionLabel = req.body.visionLabel
      ? String(req.body.visionLabel)
      : undefined;
    const clientVisionConfidence = req.body.visionConfidence
      ? Number(req.body.visionConfidence)
      : undefined;

    if (clientVisionLabel && !isVisionLabel(clientVisionLabel)) {
      res.status(400).json({ error: "Invalid visionLabel" });
      return;
    }

    const result = await createReport({
      hazardType,
      description,
      latitude,
      longitude,
      photoPath: req.file?.filename ?? null,
      autoDetect,
      clientVisionLabel: clientVisionLabel as VisionLabel | undefined,
      clientVisionConfidence: Number.isFinite(clientVisionConfidence)
        ? clientVisionConfidence
        : undefined,
    });

    res.status(201).json({
      id: result.report.id,
      status: result.report.status,
      hazardType: result.report.hazard_type,
      location: {
        latitude: result.report.latitude,
        longitude: result.report.longitude,
        locality: result.geo.locality,
        county: result.geo.county,
        state: result.geo.state,
        inLongIsland: result.geo.inLongIsland,
      },
      photoUrl: result.report.photo_path
        ? `/uploads/${result.report.photo_path}`
        : null,
      vision: result.vision
        ? {
            label: result.vision.label,
            title: result.vision.title,
            detail: result.vision.detail,
            confidence: result.vision.confidence,
            reportable: result.vision.reportable,
            hazardType: result.vision.hazardType,
            source: result.vision.source,
            cues: result.vision.cues,
            scores: result.vision.scores,
          }
        : null,
      authorities: result.authorities.map((a) => ({
        id: a.authority.id,
        name: a.authority.name,
        type: a.authority.authority_type,
        role: a.role,
        reason: a.reason,
        email: a.authority.email,
        phone: a.authority.phone,
        website: a.authority.website,
        isPlaceholder: Boolean(a.authority.is_placeholder),
      })),
      notifications: result.notifications,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export const visionRouter = Router();

visionRouter.post("/classify", memoryUpload.single("photo"), async (req, res) => {
  try {
    const description = req.body.description ? String(req.body.description) : undefined;
    const backend =
      req.body.backend === "clip" || req.body.backend === "heuristic"
        ? req.body.backend
        : undefined;
    const clientVisionLabel = req.body.visionLabel
      ? String(req.body.visionLabel)
      : undefined;
    const clientVisionConfidence = req.body.visionConfidence
      ? Number(req.body.visionConfidence)
      : undefined;

    if (!req.file && !description && !clientVisionLabel) {
      res.status(400).json({
        error: "Provide a photo, description, or on-device visionLabel",
      });
      return;
    }
    if (clientVisionLabel && !isVisionLabel(clientVisionLabel)) {
      res.status(400).json({ error: "Invalid visionLabel" });
      return;
    }

    const vision = await classifyHazardImage(req.file?.buffer ?? null, {
      description,
      backend,
      clientPrediction:
        clientVisionLabel && isVisionLabel(clientVisionLabel)
          ? {
              label: clientVisionLabel as VisionLabel,
              confidence: Number.isFinite(clientVisionConfidence)
                ? (clientVisionConfidence as number)
                : 0.7,
            }
          : undefined,
    });

    res.json({ vision });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export const routingRouter = Router();

routingRouter.get("/preview", (req, res) => {
  const hazardType = String(req.query.hazardType || "wire") as HazardType;
  const latitude = Number(req.query.latitude);
  const longitude = Number(req.query.longitude);

  if (!HAZARD_TYPES.includes(hazardType)) {
    res.status(400).json({ error: "Invalid hazardType" });
    return;
  }
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    res.status(400).json({ error: "latitude and longitude required" });
    return;
  }

  const geo = resolveGeoContext(latitude, longitude);
  const authorities = routeAuthorities(hazardType, latitude, longitude, geo);
  res.json({
    geo,
    authorities: authorities.map((a) => ({
      id: a.authority.id,
      name: a.authority.name,
      type: a.authority.authority_type,
      role: a.role,
      reason: a.reason,
      email: a.authority.email,
      phone: a.authority.phone,
      isPlaceholder: Boolean(a.authority.is_placeholder),
    })),
  });
});

export const authoritiesRouter = Router();

authoritiesRouter.get("/", (req, res) => {
  const state = req.query.state ? String(req.query.state) : null;
  const rows = state
    ? db.prepare("SELECT * FROM authorities WHERE state = ? ORDER BY name").all(state)
    : db.prepare("SELECT * FROM authorities ORDER BY state, name").all();
  res.json({ authorities: rows });
});
