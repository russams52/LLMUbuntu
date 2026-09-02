import { randomUUID } from "crypto";
import { db } from "../db";
import type { HazardType, ReportRecord, RoutedAuthority } from "../types";
import { resolveGeoContext, routeAuthorities } from "./routing";
import { notifyAuthorities, type NotifyResult } from "./email";

export interface CreateReportInput {
  hazardType: HazardType;
  description?: string;
  latitude: number;
  longitude: number;
  photoPath?: string | null;
}

export interface CreateReportResult {
  report: ReportRecord;
  geo: ReturnType<typeof resolveGeoContext>;
  authorities: RoutedAuthority[];
  notifications: NotifyResult[];
}

export function getReport(id: string): (ReportRecord & { authorities: unknown[] }) | null {
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

  return { ...report, authorities };
}

export function listReports(limit = 50): ReportRecord[] {
  return db
    .prepare("SELECT * FROM reports ORDER BY created_at DESC LIMIT ?")
    .all(limit) as ReportRecord[];
}

export async function createReport(input: CreateReportInput): Promise<CreateReportResult> {
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const geo = resolveGeoContext(input.latitude, input.longitude);
  const authorities = routeAuthorities(
    input.hazardType,
    input.latitude,
    input.longitude,
    geo
  );

  const report: ReportRecord = {
    id,
    hazard_type: input.hazardType,
    description: input.description ?? null,
    latitude: input.latitude,
    longitude: input.longitude,
    photo_path: input.photoPath ?? null,
    locality: geo.locality,
    county: geo.county,
    state: geo.state,
    status: "received",
    created_at: createdAt,
  };

  const insertReport = db.prepare(`
    INSERT INTO reports (
      id, hazard_type, description, latitude, longitude, photo_path,
      locality, county, state, status, created_at
    ) VALUES (
      @id, @hazard_type, @description, @latitude, @longitude, @photo_path,
      @locality, @county, @state, @status, @created_at
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

  return { report, geo, authorities, notifications };
}
