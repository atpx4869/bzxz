import Database from 'better-sqlite3';
import path from 'node:path';
import { getRootDir } from '../shared/fs';

let _db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (_db && !dbPath) return _db;

  const resolved = dbPath || path.join(getRootDir(), 'data', 'bzxz.db');
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);

  if (!dbPath) {
    _db = db;
    // Clean up expired sessions on startup
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  }
  return db;
}

export function resetDbForTesting(): void {
  if (_db) { _db.close(); _db = null; }
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password      TEXT NOT NULL,
      display_name  TEXT NOT NULL DEFAULT '',
      role          TEXT NOT NULL DEFAULT 'user',
      is_active     INTEGER NOT NULL DEFAULT 1,
      allowed_tabs  TEXT DEFAULT NULL,
      created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at  TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS usage_events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      event_type  TEXT NOT NULL,
      source      TEXT,
      standard_id TEXT,
      metadata    TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_events_user_date ON usage_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_type_date ON usage_events(event_type, created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    -- CNAS qualification tables
    CREATE TABLE IF NOT EXISTS cnas_labs (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_no              TEXT NOT NULL UNIQUE,
      lab_name            TEXT DEFAULT '',
      base_info_id        TEXT DEFAULT '',
      cert_update_ts      TEXT DEFAULT '',
      validate            TEXT DEFAULT '',
      cached_cert_date    TEXT DEFAULT '',
      last_check_at       TEXT,
      last_sync_at        TEXT,
      next_sync_at        TEXT,
      sync_status         TEXT DEFAULT 'pending',
      sync_error          TEXT,
      record_count        INTEGER DEFAULT 0,
      subscribed_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cnas_qualifications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_no          TEXT NOT NULL,
      std_code        TEXT NOT NULL,
      std_name        TEXT DEFAULT '',
      qual_type       TEXT DEFAULT 'CNAS',
      effective_date  TEXT DEFAULT '',
      expiry_date     TEXT DEFAULT '',
      category        TEXT DEFAULT '',
      sub_category    TEXT DEFAULT '',
      test_object     TEXT DEFAULT '',
      test_param      TEXT DEFAULT '',
      test_param_en   TEXT DEFAULT '',
      test_standard   TEXT DEFAULT '',
      std_code_en     TEXT DEFAULT '',
      limit_desc      TEXT DEFAULT '',
      branch_address  TEXT DEFAULT '',
      synced_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cnas_qual_std_code ON cnas_qualifications(std_code);
    CREATE INDEX IF NOT EXISTS idx_cnas_qual_lab_no ON cnas_qualifications(lab_no);
    CREATE INDEX IF NOT EXISTS idx_cnas_qual_std_lab ON cnas_qualifications(std_code, lab_no);

    CREATE TABLE IF NOT EXISTS cnas_sync_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      lab_no          TEXT NOT NULL,
      action          TEXT NOT NULL,
      started_at      TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at     TEXT,
      status          TEXT DEFAULT 'success',
      records_fetched INTEGER DEFAULT 0,
      error_message   TEXT
    );

    -- CMA qualification tables
    CREATE TABLE IF NOT EXISTS cma_labs (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      cert_number         TEXT NOT NULL UNIQUE,
      lab_name            TEXT DEFAULT '',
      credit_code         TEXT DEFAULT '',
      lic_sys_id          TEXT DEFAULT '',
      cached_lic_date     TEXT DEFAULT '',
      cached_update_time  INTEGER DEFAULT 0,
      last_check_at       TEXT,
      last_sync_at        TEXT,
      next_sync_at        TEXT,
      sync_status         TEXT DEFAULT 'pending',
      sync_error          TEXT,
      record_count        INTEGER DEFAULT 0,
      subscribed_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cma_qualifications (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      cert_number     TEXT NOT NULL,
      std_code        TEXT NOT NULL,
      std_name        TEXT DEFAULT '',
      qual_type       TEXT DEFAULT 'CMA',
      effective_date  TEXT DEFAULT '',
      expiry_date     TEXT DEFAULT '',
      category        TEXT DEFAULT '',
      sub_category    TEXT DEFAULT '',
      test_item       TEXT DEFAULT '',
      test_standard   TEXT DEFAULT '',
      limit_desc      TEXT DEFAULT '',
      note            TEXT DEFAULT '',
      place_name      TEXT DEFAULT '',
      synced_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cma_qual_std_code ON cma_qualifications(std_code);
    CREATE INDEX IF NOT EXISTS idx_cma_qual_cert ON cma_qualifications(cert_number);
    CREATE INDEX IF NOT EXISTS idx_cma_qual_std_cert ON cma_qualifications(std_code, cert_number);

    CREATE TABLE IF NOT EXISTS cma_sync_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      cert_number     TEXT NOT NULL,
      action          TEXT NOT NULL,
      started_at      TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at     TEXT,
      status          TEXT DEFAULT 'success',
      records_fetched INTEGER DEFAULT 0,
      error_message   TEXT
    );
  `);

  // Migration: add allowed_tabs column if missing (existing DBs)
  try { db.exec("ALTER TABLE users ADD COLUMN allowed_tabs TEXT DEFAULT NULL"); } catch { /* column exists */ }

  // Seed defaults
  const regEnabled = db.prepare("SELECT value FROM settings WHERE key = 'registration_enabled'").get();
  if (!regEnabled) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('registration_enabled', '1')").run();
  }
  const qualDefaults: [string, string][] = [
    ['qual_sync_enabled', '1'],
    ['qual_sync_cron', '0 3 * * 0'],
    ['qual_sync_concurrency', '1'],
  ];
  for (const [k, v] of qualDefaults) {
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    if (!existing) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, v);
  }
}

export function getSetting(db: Database.Database, key: string, defaultValue = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? defaultValue;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(key, value, value);
}
