import Database from 'better-sqlite3';
import path from 'node:path';
import { getRootDir } from '../shared/fs';
import { extractBaseCode, extractFullCode, cleanStdCode } from '../shared/std-code';
import { tryRestoreDbBeforeOpen, backupDbAsync } from './db-backup';

let _db: Database.Database | null = null;

export const GUEST_USERNAME = '_guest';
const GUEST_PASSWORD_SENTINEL = 'guest-login-disabled';
const GUEST_DISPLAY_NAME = '访客';

export function getDb(dbPath?: string): Database.Database {
  if (_db && !dbPath) return _db;

  const resolved = dbPath || path.join(getRootDir(), 'data', 'bzxz.db');
  // 升级 / 重装可能让 $INSTDIR\data\bzxz.db 被旧卸载器抹掉（commit 0bd54c4
  // 之前的 NSIS 没保留 data/）。打开前先看一眼能不能从 userData 还原最新备份。
  // 注入路径只在生产构造路径（无显式 dbPath）时才走 —— 测试用例不应被副作用打断。
  if (!dbPath) tryRestoreDbBeforeOpen(resolved);
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  migrate(db);

  if (!dbPath) {
    _db = db;
    // Clean up expired sessions on startup
    db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
    // 异步备份当前 db 到 userData，保留最近 7 份。失败静默不阻塞启动。
    void backupDbAsync(db);
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

    -- 持久标准库索引（Phase 1 of 预览功能）
    -- 每行 = 一份本地 PDF。文件名永远带源后缀 "{stdCode} - {source}.pdf"，
    -- 由 library-index.ts 扫描时解析。唯一约束让同源同标准只存一份；
    -- 用户手动删文件后下次扫描会清行，预览时也会 fs.access 再校验。
    CREATE TABLE IF NOT EXISTS standard_files (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      std_code_norm  TEXT NOT NULL,           -- extractBaseCode 归一化后的标准号
      year           TEXT NOT NULL DEFAULT '',-- 单独存便于版本区分；空串表示文件名未带年份
      source         TEXT NOT NULL,           -- gbw / by / bz
      abs_path       TEXT NOT NULL,           -- 绝对路径（库根目录之内）
      size           INTEGER NOT NULL DEFAULT 0,
      mtime          INTEGER NOT NULL DEFAULT 0, -- 增量扫描比对依据
      mime           TEXT NOT NULL DEFAULT 'application/pdf',
      indexed_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (std_code_norm, year, source)
    );
    CREATE INDEX IF NOT EXISTS idx_standard_files_lookup ON standard_files(std_code_norm, year);
    CREATE INDEX IF NOT EXISTS idx_standard_files_source ON standard_files(source);

    -- labr 临时 URL 缓存：preview2 API 返回的 PDF/图片 URL 自带短期签名（~分钟级），但
    -- temp/<md5>.pdf 哈希跨 token 轮换稳定。把 (did, url, fetched_at) 落库后，下次同 did
    -- 的"已知 kind=1 资源"先用旧 url 试一发 HTTP，404/403 再去 preview2 续。这把 5/日
    -- Bearer 配额从"每次预览都消耗"摊薄到"实际过期才消耗"。
    -- did = labr 资源 dataId（probe 里看到的 i.dataId / list[0].dataId），唯一键。
    CREATE TABLE IF NOT EXISTS labr_temp_urls (
      did         INTEGER PRIMARY KEY,
      url         TEXT NOT NULL,
      fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 标准查新（见 docs/CHECK-UPDATE-AND-STATS.md）
    CREATE TABLE IF NOT EXISTS check_watchlists (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id            INTEGER NOT NULL REFERENCES users(id),
      name               TEXT NOT NULL,
      created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      last_checked_at    TEXT,
      auto_enabled       INTEGER NOT NULL DEFAULT 0,   -- 自动查新开关（0/1）
      auto_interval_days INTEGER NOT NULL DEFAULT 15,  -- 周期天数，硬下限 15
      next_run_at        TEXT                          -- 下次自动查新时间（ISO）
    );
    CREATE TABLE IF NOT EXISTS check_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      watchlist_id     INTEGER NOT NULL REFERENCES check_watchlists(id),
      std_code         TEXT NOT NULL,
      std_code_norm    TEXT,
      base_status      TEXT,
      base_title       TEXT,
      base_impl_date   TEXT,
      base_replaced_by TEXT,
      base_snapshot_at TEXT,
      last_status      TEXT,
      last_title       TEXT,
      last_impl_date   TEXT,
      last_replaced_by TEXT,
      last_checked_at  TEXT,
      change_flags     TEXT,
      source_used      TEXT,
      new_version      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_check_items_wl ON check_items(watchlist_id);
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
  // 标准查新：new_version 列在中途版本可能缺（建表版先于本列），幂等补一下。
  addColumnIfMissing(db, 'check_items', 'new_version',   'TEXT DEFAULT NULL');
  // 自动查新（Step 2）：旧库补列。
  addColumnIfMissing(db, 'check_watchlists', 'auto_enabled',       'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'check_watchlists', 'auto_interval_days', 'INTEGER NOT NULL DEFAULT 15');
  addColumnIfMissing(db, 'check_watchlists', 'next_run_at',        'TEXT DEFAULT NULL');

  // 资质标准号归一化列（Step 2-3）：把脏空格/全角/无空格/ISO 冒号变体在写入时落成统一形态，
  // 让 queryByStdCodes / searchQualifications 用索引等值查询，不再需要 LIKE + LIMIT 兜底。
  // - std_code_norm = extractFullCode(std_code) 保留年份，用于"同号同年"精确匹配
  // - std_code_base = extractBaseCode(std_code) 剥年份，用于"同号跨年"模糊兜底
  addColumnIfMissing(db, 'cnas_qualifications', 'std_code_norm', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cnas_qualifications', 'std_code_base', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cma_qualifications',  'std_code_norm', "TEXT DEFAULT ''");
  addColumnIfMissing(db, 'cma_qualifications',  'std_code_base', "TEXT DEFAULT ''");

  // 使用统计增强（见 docs/CHECK-UPDATE-AND-STATS.md）：补 5 列。旧行新列为 NULL，安全。
  //   ip/hostname/client = 客户端上下文（hostname 仅桌面端有值）
  //   result = 'success' | 'fail'（NULL=旧数据/未标）；error = 失败原因+日志摘要
  addColumnIfMissing(db, 'usage_events', 'ip',       'TEXT DEFAULT NULL');
  addColumnIfMissing(db, 'usage_events', 'hostname', 'TEXT DEFAULT NULL');
  addColumnIfMissing(db, 'usage_events', 'client',   'TEXT DEFAULT NULL');
  addColumnIfMissing(db, 'usage_events', 'result',   'TEXT DEFAULT NULL');
  addColumnIfMissing(db, 'usage_events', 'error',    'TEXT DEFAULT NULL');
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_cnas_qual_norm ON cnas_qualifications(std_code_norm);
    CREATE INDEX IF NOT EXISTS idx_cnas_qual_base ON cnas_qualifications(std_code_base);
    CREATE INDEX IF NOT EXISTS idx_cma_qual_norm  ON cma_qualifications(std_code_norm);
    CREATE INDEX IF NOT EXISTS idx_cma_qual_base  ON cma_qualifications(std_code_base);
  `);
  backfillNormalizedStdCodes(db);
  fixupDirtyStdCodes(db);

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
    // 标准库 / 预览功能（Phase 1）：
    // - standards_library_dir 空字符串代表"使用默认值"，由 library-paths.ts 启动时
    //   填入 exe 同级 /standards。用户在设置里改成绝对路径会覆盖默认。
    // - library_filename_pattern 文件名模板，支持 {stdCode}/{source}/{year}/{title}。
    //   默认 "{stdCode} {title} - {source}" 带源后缀（决策见 CHANGELOG），不写扩展名（永远 .pdf）。
    //   labr 接入后改默认含 {title}：labr 资源标题是检索结果唯一区分项（同一 stdCode 可能有
    //   多份不同 title 的 PDF / 图片），文件名不带 title 会用 UNIQUE(std_code_norm, year, source)
    //   把后下载的覆盖掉。BW/BZ/BY 由 renderLibraryFilename 对空 title 容错（连分隔符一起删），
    //   旧文件名形态向后兼容。
    ['standards_library_dir', ''],
    ['library_filename_pattern', '{stdCode} {title} - {source}'],
    // library_source_priority：JSON 数组形式存储，源按优先级排列；preview-routes/admin-routes
    // 用 parseSourcePriority 解析。默认顺序与 DEFAULT_SOURCE_PRIORITY 对齐（gbw > bz > by）。
    ['library_source_priority', '["gbw","bz","by"]'],
    // Phase 2：chokidar 监听库目录，新增/改/删自动同步索引。默认开启；
    // Windows + OneDrive 出问题时可在 admin 设置里临时关。
    ['library_watcher_enabled', '1'],
  ];
  for (const [k, v] of qualDefaults) {
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(k);
    if (!existing) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(k, v);
  }

  // 一次性默认值升级：原默认 '{stdCode} - {source}' → '{stdCode} {title} - {source}'。
  // 只在 DB 里"现存值刚好是旧默认"时升（说明用户没动过设置）；用户在 admin 改过的
  // pattern 不动 —— 即便他们改成空 title 形态也保留意愿。labr 资源依然能下，因为
  // renderLibraryFilename 对空 title 容错。
  db.prepare(`
    UPDATE settings SET value = ? WHERE key = 'library_filename_pattern' AND value = ?
  `).run('{stdCode} {title} - {source}', '{stdCode} - {source}');
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * 把 cnas_qualifications / cma_qualifications 里 std_code_norm 还为空的旧行回填一次。
 *
 * 触发场景：列刚被 addColumnIfMissing 加上、或者上一版没回填完跑到一半挂掉。
 * 已经回填过的行（std_code_norm != ''）不会被重跑，所以幂等。回填本身只算
 * 字符串、不查网络、不发请求，几万行也只几百毫秒。
 *
 * 不做的事：跨进程并发保护 —— migrate() 在启动期单进程跑，且后续 INSERT 自带
 * std_code_norm，二者不会撞车。
 */
function backfillNormalizedStdCodes(db: Database.Database): void {
  for (const table of ['cnas_qualifications', 'cma_qualifications'] as const) {
    const rows = db.prepare(`
      SELECT id, std_code FROM ${table}
      WHERE COALESCE(std_code_norm, '') = ''
    `).all() as Array<{ id: number; std_code: string }>;
    if (rows.length === 0) continue;

    const update = db.prepare(`UPDATE ${table} SET std_code_norm = ?, std_code_base = ? WHERE id = ?`);
    const txn = db.transaction((chunk: typeof rows) => {
      for (const r of chunk) {
        update.run(extractFullCode(r.std_code), extractBaseCode(r.std_code), r.id);
      }
    });
    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      txn(rows.slice(i, i + CHUNK));
    }
    console.log(`[db] backfilled ${rows.length} ${table} rows with std_code_norm / std_code_base`);
  }
}

/**
 * 一次性把历史脏 std_code 清洗成干净形态：'GB/T 3325 -2024' → 'GB/T 3325-2024'。
 *
 * 触发场景：升级到 Step 6 前 CNAS 抓取写入的 std_code 含年份连字符附近多空格，
 * 让 `std_code LIKE '%3325-%'` 这种子串搜索漏命中。新版抓取已经在 INSERT 前调
 * cleanStdCode，但**老数据还停在脏形态**，这里把它们一次性 update 干净，同步
 * 重算 std_code_norm / std_code_base（虽然两个归一化列对脏数据本来就有正确值，
 * 重算只是确保一致）。幂等：清洗后 cleanStdCode(x) === x 的行下次启动会被
 * `WHERE std_code != cleanStdCode(std_code)` 过滤掉。
 */
function fixupDirtyStdCodes(db: Database.Database): void {
  for (const table of ['cnas_qualifications', 'cma_qualifications'] as const) {
    // SQL 侧粗筛：含 ' -' 或 '- ' 的行才需要清洗。把全表扫范围压到几百行级别。
    const candidates = db.prepare(`
      SELECT id, std_code FROM ${table}
      WHERE std_code LIKE '% -%' OR std_code LIKE '%- %'
    `).all() as Array<{ id: number; std_code: string }>;
    if (candidates.length === 0) continue;

    // JS 侧精筛：cleanStdCode 后真有改变的行才 update（SQL LIKE 会误匹标题里的 "GB - 2024" 之类）
    const dirty = candidates
      .map(r => ({ id: r.id, std_code: r.std_code, cleaned: cleanStdCode(r.std_code) }))
      .filter(r => r.cleaned !== r.std_code);
    if (dirty.length === 0) continue;

    const update = db.prepare(
      `UPDATE ${table} SET std_code = ?, std_code_norm = ?, std_code_base = ? WHERE id = ?`,
    );
    const txn = db.transaction((chunk: typeof dirty) => {
      for (const r of chunk) {
        update.run(r.cleaned, extractFullCode(r.cleaned), extractBaseCode(r.cleaned), r.id);
      }
    });
    const CHUNK = 1000;
    for (let i = 0; i < dirty.length; i += CHUNK) {
      txn(dirty.slice(i, i + CHUNK));
    }
    console.log(`[db] cleaned ${dirty.length} ${table} rows with whitespace around year suffix (e.g. 'GB/T 3325 -2024' → 'GB/T 3325-2024')`);
  }
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
  // Default permission set: standards search, batch download, complete-info.
  // Admin can broaden this later; we won't overwrite their changes on boot.
  const DEFAULT_GUEST_TABS = JSON.stringify(['search', 'batch', 'complete']);
  const existing = db.prepare('SELECT id, allowed_tabs FROM users WHERE username = ?').get(GUEST_USERNAME) as { id: number; allowed_tabs: string | null } | undefined;
  if (!existing) {
    db.prepare(
      'INSERT INTO users (username, password, display_name, role, is_active, allowed_tabs) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(GUEST_USERNAME, GUEST_PASSWORD_SENTINEL, GUEST_DISPLAY_NAME, 'user', 1, DEFAULT_GUEST_TABS);
    return;
  }
  // Refresh metadata, preserve admin-customized allowed_tabs.
  db.prepare(
    'UPDATE users SET display_name = ?, role = ?, is_active = 1 WHERE username = ?'
  ).run(GUEST_DISPLAY_NAME, 'user', GUEST_USERNAME);
  if (existing.allowed_tabs == null) {
    db.prepare('UPDATE users SET allowed_tabs = ? WHERE username = ?').run(DEFAULT_GUEST_TABS, GUEST_USERNAME);
  }
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
