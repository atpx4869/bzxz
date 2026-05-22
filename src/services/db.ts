import Database from 'better-sqlite3';
import path from 'node:path';
import { getRootDir } from '../shared/fs';

let _db: Database.Database | null = null;

export const GUEST_USERNAME = '_guest';
const GUEST_PASSWORD_SENTINEL = 'guest-login-disabled';
const GUEST_DISPLAY_NAME = '访客';

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
      public_detail_id    TEXT DEFAULT '',
      address             TEXT DEFAULT '',
      area_name           TEXT DEFAULT '',
      industry            TEXT DEFAULT '',
      issue_date          TEXT DEFAULT '',
      valid_from          TEXT DEFAULT '',
      valid_to            TEXT DEFAULT '',
      cert_status         TEXT DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS qualification_lab_links (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name    TEXT NOT NULL,
      cnas_lab_no     TEXT UNIQUE,
      cma_cert_number TEXT UNIQUE,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Admin-authored announcements shown once per user on next entry.
    CREATE TABLE IF NOT EXISTS announcements (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT NOT NULL,
      content_md  TEXT NOT NULL DEFAULT '',
      created_by  INTEGER REFERENCES users(id),
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS announcement_reads (
      announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      read_at         TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (announcement_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_announcement_reads_user ON announcement_reads(user_id);
  `);

  // Schema migrations: add columns that may be missing on older DBs.
  // We check column existence first so genuine SQL errors (file perms, disk, etc.) surface
  // instead of being swallowed by a blanket try/catch.
  addColumnIfMissing(db, 'users',    'allowed_tabs',    "TEXT DEFAULT NULL");
  addColumnIfMissing(db, 'cma_labs', 'public_detail_id', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cma_labs', 'address',          "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cma_labs', 'area_name',        "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cma_labs', 'industry',         "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cma_labs', 'issue_date',       "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cma_labs', 'valid_from',       "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cma_labs', 'valid_to',         "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cma_labs', 'cert_status',      "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cnas_labs', 'url_params',      "TEXT DEFAULT '{}'");
  addColumnIfMissing(db, 'cnas_labs', 'other_names',     "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cnas_labs', 'org_address',     "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cnas_labs', 'validity_period', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cnas_labs', 'cert_tasks',      "TEXT DEFAULT '[]'");
  cleanupLegacyCmaData(db);

  ensureGuestUser(db);

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

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function cleanupLegacyCmaData(db: Database.Database): void {
  db.exec(`
    DELETE FROM cma_qualifications
    WHERE cert_number IN (
      SELECT cert_number FROM cma_labs
      WHERE COALESCE(public_detail_id, '') = ''
        AND (length(cert_number) >= 18 OR cert_number GLOB '*[A-Za-z]*')
    );

    DELETE FROM cma_labs
    WHERE COALESCE(public_detail_id, '') = ''
      AND (length(cert_number) >= 18 OR cert_number GLOB '*[A-Za-z]*');

    DELETE FROM cma_qualifications
    WHERE (length(cert_number) >= 18 OR cert_number GLOB '*[A-Za-z]*')
      AND cert_number NOT IN (SELECT cert_number FROM cma_labs);
  `);
}

function ensureGuestUser(db: Database.Database): void {
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(GUEST_USERNAME);
  if (!existing) {
    db.prepare(
      'INSERT INTO users (username, password, display_name, role, is_active, allowed_tabs) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(GUEST_USERNAME, GUEST_PASSWORD_SENTINEL, GUEST_DISPLAY_NAME, 'user', 1, null);
    return;
  }

  db.prepare(
    'UPDATE users SET display_name = ?, role = ?, is_active = 1, allowed_tabs = NULL WHERE username = ?'
  ).run(GUEST_DISPLAY_NAME, 'user', GUEST_USERNAME);
}

export function getRealUserCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) as cnt FROM users WHERE username <> ?').get(GUEST_USERNAME) as { cnt: number }).cnt;
}

export function getSetting(db: Database.Database, key: string, defaultValue = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? defaultValue;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(key, value, value);
}
