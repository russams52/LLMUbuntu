import { randomUUID } from "crypto";
import path from "path";
import { db } from "../db";
import type { HazardType, ReportRecord, RoutedAuthority, VisionSnapshot } from "../types";
import { resolveGeoContext, routeAuthorities } from "./routing";
import { notifyAuthorities, type NotifyResult } from "./email";
import {
  classifyHazardImage,
  isVisionLabel,
  type VisionLabel,
  type VisionResult,
} from "./vision";

export interface CreateReportInput {
  hazardType?: HazardType;
  description?: string;
  latitude: number;
  longitude: number;
  photoPath?: string | null;
  /** When true (default if photo present), run Visual Intelligence to identify the hazard. */
  autoDetect?: boolean;
  clientVisionLabel?: VisionLabel;
  clientVisionConfidence?: number;
}

export interface CreateReportResult {
  report: ReportRecord;
  geo: ReturnType<typeof resolveGeoContext>;
  authorities: RoutedAuthority[];
  notifications: NotifyResult[];
  vision: VisionResult | null;
}

function toVisionSnapshot(vision: VisionResult | null): VisionSnapshot | null {
  if (!vision) return null;
  return {
    label: vision.label,
    confidence: vision.confidence,
    source: vision.source,
    detail: vision.detail,
    reportable: vision.reportable,
    title: vision.title,
    cues: vision.cues,
    scores: vision.scores,
  };
}

export function getReport(id: string): (ReportRecord & { authorities: unknown[]; vision: VisionSnapshot | null }) | null {
  const report = db.prepare("SELECT * FROM reports WHERE id = ?").get(id) as
    | ReportRecord
    | undefined;
  if (!report) return null;

  const authorities = db
    .prepare(
      `SELECT a.*, ra.role, ra.notified, ra.notified_at
       FROM report_authorities ra
       JOIN authorities a ON a.id = ra.authority_id
       WHERE ra.report_id = ?`
    )
    .all(id);

  const vision =
    report.vision_label != null
      ? {
          label: report.vision_label,
          confidence: report.vision_confidence ?? 0,
          source: report.vision_source ?? "unknown",
          detail: report.vision_detail ?? "",
          reportable: true,
        }
      : null;

  return { ...report, authorities, vision };
}

export function listReports(limit = 50): ReportRecord[] {
  return db
    .prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT ?")
    .all(limit) as ReportRecord[];
}

export async function createReport(input: CreateReportInput): Promise<CreateReportResult> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const uploadDir = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");
  const photoFullPath = input.photoPath ? path.join(uploadDir, input.photoPath) : null;

  const shouldDetect =
    input.autoDetect !== false &&
    (Boolean(photoFullPath) ||
      Boolean(input.clientVisionLabel) ||
      Boolean(input.description?.trim()));

  let vision: VisionResult | null = null;
  if (shouldDetect) {
    vision = await classifyHazardImage(photoFullPath, {
      description: input.description,
      clientPrediction:
        input.clientVisionLabel && isVisionLabel(input.clientVisionLabel)
          ? {
              label: input.clientVisionLabel,
              confidence: input.clientVisionConfidence ?? 0.7,
            }
          : undefined,
    });
  }

  const hazardType: HazardType =
    (vision?.reportable ? vision.hazardType : null) ??
    input.hazardType ??
    "other";

  const geo = resolveGeoContext(input.latitude, input.longitude);
  const authorities = routeAuthorities(hazardType, input.latitude, input.longitude, geo);

  const report: ReportRecord = {
    id,
    hazard_type: hazardType,
    description: input.description ?? null,
    latitude: input.latitude,
    longitude: input.longitude,
    photo_path: input.photoPath ?? null,
    locality: geo.locality,
    county: geo.county,
    state: geo.state,
    status: "received",
    created_at: createdAt,
    vision_label: vision?.label ?? null,
    vision_confidence: vision?.confidence ?? null,
    vision_source: vision?.source ?? null,
    vision_detail: vision ? `${vision.title}: ${vision.detail}` : null,
  };

  const insertReport = db.prepare(`
    INSERT INTO reports (
      id, hazard_type, description, latitude, longitude, photo_path,
      locality, county, state, status, created_at,
      vision_label, vision_confidence, vision_source, vision_detail
    ) VALUES (
      @id, @hazard_type, @description, @latitude, @longitude, @photo_path,
      @locality, @county, @state, @status, @created_at,
      @vision_label, @vision_confidence, @vision_source, @vision_detail
    )
  `);

  const insertLink = db.prepare(`
    INSERT INTO report_authorities (report_id, authority_id, role, notified, notified_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    insertReport.run(report);
  });
  tx();

  const baseUrl = process.env.PUBLIC_BASE_URL || "http://localhost:3000";
  const photoUrl = report.photo_path
    ? `${baseUrl}/uploads/${report.photo_path}`
    : null;

  const notifications = await notifyAuthorities(report, authorities, photoUrl);

  const linkTx = db.transaction(() => {
    for (const item of authorities) {
      const note = notifications.find((n) => n.authorityId === item.authority.id);
      insertLink.run(
        id,
        item.authority.id,
        item.role,
        note?.sent ? 1 : 0,
        note?.sent ? new Date().toISOString() : null
      );
    }
  });
  linkTx();

  db.prepare("UPDATE reports SET status = ? WHERE id = ?").run("routed", id);
  report.status = "routed";

  return { report, geo, authorities, notifications, vision };
}

export { toVisionSnapshot };
