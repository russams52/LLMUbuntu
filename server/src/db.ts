import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import fs from "fs";
import path from "path";

const dbPath =
  process.env.DATABASE_PATH || path.join(process.cwd(), "data", "hazard-reporter.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db: DatabaseType = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authorities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      authority_type TEXT NOT NULL,
      jurisdiction TEXT NOT NULL,
      state TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      website TEXT,
      notes TEXT,
      min_lat REAL,
      max_lat REAL,
      min_lng REAL,
      max_lng REAL,
      is_placeholder INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      hazard_type TEXT NOT NULL,
      description TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      photo_path TEXT,
      locality TEXT,
      county TEXT,
      state TEXT,
      status TEXT NOT NULL DEFAULT 'received',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS report_authorities (
      report_id TEXT NOT NULL,
      authority_id TEXT NOT NULL,
      role TEXT NOT NULL,
      notified INTEGER NOT NULL DEFAULT 0,
      notified_at TEXT,
      PRIMARY KEY (report_id, authority_id, role),
      FOREIGN KEY (report_id) REFERENCES reports(id),
      FOREIGN KEY (authority_id) REFERENCES authorities(id)
    );
  `);
}
