import type Database from 'better-sqlite3';
import { getDb } from './db';
import { CmaScraper, type CmaCapability } from './cma-scraper';
import { CnasScraper, type CnasCapability, type CnasLabInfo } from './cnas-scraper';

export interface Qualification {
  source: 'CNAS' | 'CMA';
  stdCode: string;
  stdName: string;
  labNo: string;
  labName: string;
  effectiveDate: string;
  expiryDate: string;
  category: string;
  testItem: string;
  testStandard: string;
  limitDesc: string;
}

export interface CnasLab {
  id: number;
  lab_no: string;
  lab_name: string;
  base_info_id: string;
  cert_update_ts: string;
  validate: string;
  cached_cert_date: string;
  last_check_at: string | null;
  last_sync_at: string | null;
  next_sync_at: string | null;
  sync_status: string;
  sync_error: string | null;
  record_count: number;
  subscribed_at: string;
}

export interface CmaLab {
  id: number;
  cert_number: string;
  lab_name: string;
  credit_code: string;
  lic_sys_id: string;
  cached_lic_date: string;
  cached_update_time: number;
  last_check_at: string | null;
  last_sync_at: string | null;
  next_sync_at: string | null;
  sync_status: string;
  sync_error: string | null;
  record_count: number;
  subscribed_at: string;
}

export interface SyncLog {
  id: number;
  lab_no: string;
  action: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_fetched: number;
  error_message: string | null;
}

export class QualificationService {
  private db: Database.Database;
  private cmaScraper = new CmaScraper();
  private cnasScraper = new CnasScraper();

  constructor(db?: Database.Database) {
    this.db = db ?? getDb();
  }

  // ─── Query ───

  /** Extract base standard number (prefix + number, no year/type): "GB/T 23440-2009" → "GB23440" */
  private extractBaseCode(code: string): string {
    return code
      .replace(/\s*-\s*\d{4}$/, '')  // remove year suffix
      .replace(/\/[A-Z]+(?=\s)/i, '') // remove type designation: /T, /Z, /TR etc.
      .replace(/[\s]/g, '')           // remove spaces
      .toUpperCase();
  }

  /** Batch query qualifications by standard codes (for search result badges) */
  queryByStdCodes(stdCodes: string[]): Record<string, Qualification[]> {
    if (stdCodes.length === 0) return {};

    const placeholders = stdCodes.map(() => '?').join(',');
    const result: Record<string, Qualification[]> = {};

    // Build base code → input codes mapping for fuzzy matching
    const baseToInputs = new Map<string, string[]>();
    for (const code of stdCodes) {
      const base = this.extractBaseCode(code);
      if (!baseToInputs.has(base)) baseToInputs.set(base, []);
      baseToInputs.get(base)!.push(code);
    }

    // Helper: map a qualification row to result under all matching input codes
    const addMatch = (key: string, qual: Qualification) => {
      if (!result[key]) result[key] = [];
      // Deduplicate by source+labNo
      if (!result[key].some(q => q.source === qual.source && q.labNo === qual.labNo)) {
        result[key].push(qual);
      }
    };

    // CNAS
    const cnasRows = this.db.prepare(`
      SELECT q.std_code, q.std_name, q.lab_no, l.lab_name,
             q.effective_date, q.expiry_date, q.category,
             q.test_object, q.test_param, q.test_standard, q.limit_desc
      FROM cnas_qualifications q
      LEFT JOIN cnas_labs l ON q.lab_no = l.lab_no
      WHERE q.std_code IN (${placeholders})
    `).all(...stdCodes) as any[];

    const matchedCnasBases = new Set<string>();
    for (const row of cnasRows) {
      const qual: Qualification = {
        source: 'CNAS', stdCode: row.std_code, stdName: row.std_name,
        labNo: row.lab_no, labName: row.lab_name ?? '',
        effectiveDate: row.effective_date, expiryDate: row.expiry_date,
        category: row.category,
        testItem: [row.test_object, row.test_param].filter(Boolean).join(' > '),
        testStandard: row.test_standard, limitDesc: row.limit_desc,
      };
      // Exact match: add under exact code
      for (const code of stdCodes) {
        if (code === row.std_code) addMatch(code, qual);
      }
      // Fuzzy: add under all input codes with same base
      const rowBase = this.extractBaseCode(row.std_code);
      matchedCnasBases.add(rowBase);
      for (const input of baseToInputs.get(rowBase) ?? []) {
        addMatch(input, qual);
      }
    }

    // CMA
    const cmaRows = this.db.prepare(`
      SELECT q.std_code, q.std_name, q.cert_number, l.lab_name,
             q.effective_date, q.expiry_date, q.category,
             q.test_item, q.test_standard, q.limit_desc
      FROM cma_qualifications q
      LEFT JOIN cma_labs l ON q.cert_number = l.cert_number
      WHERE q.std_code IN (${placeholders})
    `).all(...stdCodes) as any[];

    for (const row of cmaRows) {
      const qual: Qualification = {
        source: 'CMA', stdCode: row.std_code, stdName: row.std_name,
        labNo: row.cert_number, labName: row.lab_name ?? '',
        effectiveDate: row.effective_date, expiryDate: row.expiry_date,
        category: row.category, testItem: row.test_item,
        testStandard: row.test_standard, limitDesc: row.limit_desc,
      };
      // Exact match
      for (const code of stdCodes) {
        if (code === row.std_code) addMatch(code, qual);
      }
      // Fuzzy: add under all input codes with same base
      const rowBase = this.extractBaseCode(row.std_code);
      for (const input of baseToInputs.get(rowBase) ?? []) {
        addMatch(input, qual);
      }
    }

    // For any input codes with no results, try loading all and fuzzy matching
    const unmatchedInputs = stdCodes.filter(code => !result[code]?.length);
    if (unmatchedInputs.length > 0) {
      const allCnas = this.db.prepare(`
        SELECT q.std_code, q.std_name, q.lab_no, l.lab_name,
               q.effective_date, q.expiry_date, q.category,
               q.test_object, q.test_param, q.test_standard, q.limit_desc
        FROM cnas_qualifications q LEFT JOIN cnas_labs l ON q.lab_no = l.lab_no
      `).all() as any[];
      const allCma = this.db.prepare(`
        SELECT q.std_code, q.std_name, q.cert_number, l.lab_name,
               q.effective_date, q.expiry_date, q.category,
               q.test_item, q.test_standard, q.limit_desc
        FROM cma_qualifications q LEFT JOIN cma_labs l ON q.cert_number = l.cert_number
      `).all() as any[];

      for (const input of unmatchedInputs) {
        const inputBase = this.extractBaseCode(input);
        for (const row of allCnas) {
          if (this.extractBaseCode(row.std_code) === inputBase) {
            addMatch(input, {
              source: 'CNAS', stdCode: row.std_code, stdName: row.std_name,
              labNo: row.lab_no, labName: row.lab_name ?? '',
              effectiveDate: row.effective_date, expiryDate: row.expiry_date,
              category: row.category,
              testItem: [row.test_object, row.test_param].filter(Boolean).join(' > '),
              testStandard: row.test_standard, limitDesc: row.limit_desc,
            });
          }
        }
        for (const row of allCma) {
          if (this.extractBaseCode(row.std_code) === inputBase) {
            addMatch(input, {
              source: 'CMA', stdCode: row.std_code, stdName: row.std_name,
              labNo: row.cert_number, labName: row.lab_name ?? '',
              effectiveDate: row.effective_date, expiryDate: row.expiry_date,
              category: row.category, testItem: row.test_item,
              testStandard: row.test_standard, limitDesc: row.limit_desc,
            });
          }
        }
      }
    }

    return result;
  }

  /** Search qualifications by keyword */
  searchQualifications(query: string, source?: 'CNAS' | 'CMA', limit = 50): Qualification[] {
    const q = `%${query}%`;
    const results: Qualification[] = [];

    if (!source || source === 'CNAS') {
      const rows = this.db.prepare(`
        SELECT q.std_code, q.std_name, q.lab_no, l.lab_name,
               q.effective_date, q.expiry_date, q.category,
               q.test_object, q.test_param, q.test_standard, q.limit_desc
        FROM cnas_qualifications q
        LEFT JOIN cnas_labs l ON q.lab_no = l.lab_no
        WHERE q.std_code LIKE ? OR q.std_name LIKE ? OR q.lab_no LIKE ?
           OR q.test_object LIKE ? OR q.category LIKE ?
        ORDER BY q.std_code, q.effective_date DESC
        LIMIT ?
      `).all(q, q, q, q, q, limit) as any[];

      for (const row of rows) {
        results.push({
          source: 'CNAS',
          stdCode: row.std_code,
          stdName: row.std_name,
          labNo: row.lab_no,
          labName: row.lab_name ?? '',
          effectiveDate: row.effective_date,
          expiryDate: row.expiry_date,
          category: row.category,
          testItem: [row.test_object, row.test_param].filter(Boolean).join(' > '),
          testStandard: row.test_standard,
          limitDesc: row.limit_desc,
        });
      }
    }

    if (!source || source === 'CMA') {
      const rows = this.db.prepare(`
        SELECT q.std_code, q.std_name, q.cert_number, l.lab_name,
               q.effective_date, q.expiry_date, q.category,
               q.test_item, q.test_standard, q.limit_desc
        FROM cma_qualifications q
        LEFT JOIN cma_labs l ON q.cert_number = l.cert_number
        WHERE q.std_code LIKE ? OR q.std_name LIKE ? OR q.cert_number LIKE ?
           OR q.test_item LIKE ? OR q.category LIKE ?
        ORDER BY q.std_code, q.effective_date DESC
        LIMIT ?
      `).all(q, q, q, q, q, limit) as any[];

      for (const row of rows) {
        results.push({
          source: 'CMA',
          stdCode: row.std_code,
          stdName: row.std_name,
          labNo: row.cert_number,
          labName: row.lab_name ?? '',
          effectiveDate: row.effective_date,
          expiryDate: row.expiry_date,
          category: row.category,
          testItem: row.test_item,
          testStandard: row.test_standard,
          limitDesc: row.limit_desc,
        });
      }
    }

    return results;
  }

  // ─── CNAS Lab Management ───

  listCnasLabs(): CnasLab[] {
    return this.db.prepare('SELECT * FROM cnas_labs ORDER BY subscribed_at DESC').all() as CnasLab[];
  }

  addCnasLab(lab: { lab_no: string; lab_name?: string; base_info_id?: string; cert_update_ts?: string; validate?: string }): CnasLab {
    this.db.prepare(`
      INSERT INTO cnas_labs (lab_no, lab_name, base_info_id, cert_update_ts, validate)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(lab_no) DO UPDATE SET lab_name = excluded.lab_name, base_info_id = excluded.base_info_id
    `).run(lab.lab_no, lab.lab_name ?? '', lab.base_info_id ?? '', lab.cert_update_ts ?? '', lab.validate ?? '');
    return this.db.prepare('SELECT * FROM cnas_labs WHERE lab_no = ?').get(lab.lab_no) as CnasLab;
  }

  deleteCnasLab(labNo: string): void {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM cnas_qualifications WHERE lab_no = ?').run(labNo);
      this.db.prepare('DELETE FROM cnas_sync_logs WHERE lab_no = ?').run(labNo);
      this.db.prepare('DELETE FROM cnas_labs WHERE lab_no = ?').run(labNo);
    });
    txn();
  }

  // ─── CMA Lab Management ───

  listCmaLabs(): CmaLab[] {
    return this.db.prepare('SELECT * FROM cma_labs ORDER BY subscribed_at DESC').all() as CmaLab[];
  }

  addCmaLab(lab: { cert_number: string; lab_name?: string; credit_code?: string; lic_sys_id?: string; lic_date?: string }): CmaLab {
    this.db.prepare(`
      INSERT INTO cma_labs (cert_number, lab_name, credit_code, lic_sys_id, cached_lic_date)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cert_number) DO UPDATE SET lab_name = excluded.lab_name, credit_code = excluded.credit_code
    `).run(lab.cert_number, lab.lab_name ?? '', lab.credit_code ?? '', lab.lic_sys_id ?? '', lab.lic_date ?? '');
    return this.db.prepare('SELECT * FROM cma_labs WHERE cert_number = ?').get(lab.cert_number) as CmaLab;
  }

  deleteCmaLab(certNumber: string): void {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM cma_qualifications WHERE cert_number = ?').run(certNumber);
      this.db.prepare('DELETE FROM cma_sync_logs WHERE cert_number = ?').run(certNumber);
      this.db.prepare('DELETE FROM cma_labs WHERE cert_number = ?').run(certNumber);
    });
    txn();
  }

  // ─── Sync: CMA ───

  async syncCmaLab(certNumber: string, force = false): Promise<{ action: string; records: number }> {
    const lab = this.db.prepare('SELECT * FROM cma_labs WHERE cert_number = ?').get(certNumber) as CmaLab | undefined;
    if (!lab) throw new Error(`CMA lab not found: ${certNumber}`);

    const startTime = new Date().toISOString();
    this.db.prepare("UPDATE cma_labs SET sync_status = 'syncing' WHERE cert_number = ?").run(certNumber);

    try {
      // Update detection
      if (!force && lab.cached_lic_date && lab.credit_code) {
        const check = await this.cmaScraper.checkForUpdate(lab.credit_code, lab.cached_lic_date);
        this.db.prepare("UPDATE cma_labs SET last_check_at = datetime('now') WHERE cert_number = ?").run(certNumber);

        if (!check.hasUpdate) {
          this.db.prepare("UPDATE cma_labs SET sync_status = 'success' WHERE cert_number = ?").run(certNumber);
          this.logCmaSync(certNumber, 'checked_skip', startTime, 'success', 0);
          return { action: 'checked_skip', records: 0 };
        }
      }

      // Full sync
      const creditCode = lab.credit_code;
      if (!creditCode) throw new Error('No credit code stored for update check');

      const results = await this.cmaScraper.search({ creditCode });
      if (results.length === 0) throw new Error('No certificate found');

      const first = results[0];
      const detail = await this.cmaScraper.getDetail(first.licSysId);
      const capabilities = await this.cmaScraper.getCapabilities(first.licSysId);

      // Replace data atomically
      const txn = this.db.transaction(() => {
        this.db.prepare('DELETE FROM cma_qualifications WHERE cert_number = ?').run(certNumber);

        const insert = this.db.prepare(`
          INSERT INTO cma_qualifications (cert_number, std_code, std_name, qual_type, effective_date, expiry_date, category, sub_category, test_item, test_standard, limit_desc, note, place_name)
          VALUES (?, ?, ?, 'CMA', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const cap of capabilities) {
          const stdCode = (cap.yjbzNumber ?? '').trim();
          if (!stdCode) continue;
          insert.run(
            certNumber,
            stdCode,
            cap.yjbzNameNumber ?? '',
            detail.licValidTimeBegin ?? '',
            detail.licValidTimeEnd ?? '',
            cap.parentName ?? '',
            cap.type ?? '',
            cap.cpName ?? '',
            cap.yjbzNameNumber ?? '',
            cap.xzfw ?? '',
            cap.sm ?? '',
            cap.placeName ?? '',
          );
        }

        this.db.prepare(`
          UPDATE cma_labs SET
            lab_name = ?, lic_sys_id = ?, cached_lic_date = ?,
            record_count = ?, sync_status = 'success', sync_error = NULL,
            last_sync_at = datetime('now'), last_check_at = datetime('now')
          WHERE cert_number = ?
        `).run(detail.sysName || detail.licUnitname || lab.cert_number, first.licSysId, first.licDate, capabilities.length, certNumber);
      });
      txn();

      this.logCmaSync(certNumber, force ? 'manual_forced' : 'cert_date_changed', startTime, 'success', capabilities.length);
      return { action: force ? 'manual_forced' : 'cert_date_changed', records: capabilities.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.db.prepare("UPDATE cma_labs SET sync_status = 'error', sync_error = ? WHERE cert_number = ?").run(msg, certNumber);
      this.logCmaSync(certNumber, force ? 'manual_forced' : 'sync_error', startTime, 'error', 0, msg);
      throw err;
    }
  }

  // ─── Sync: CNAS ───

  async syncCnasLab(labNo: string, force = false): Promise<{ action: string; records: number }> {
    const lab = this.db.prepare('SELECT * FROM cnas_labs WHERE lab_no = ?').get(labNo) as CnasLab | undefined;
    if (!lab) throw new Error(`CNAS lab not found: ${labNo}`);
    if (!lab.base_info_id) throw new Error(`No base_info_id for lab: ${labNo}`);

    const startTime = new Date().toISOString();
    this.db.prepare("UPDATE cnas_labs SET sync_status = 'syncing' WHERE lab_no = ?").run(labNo);

    try {
      // Update detection
      if (!force && lab.cached_cert_date) {
        try {
          const check = await this.cnasScraper.checkForUpdate(lab.base_info_id, lab.cached_cert_date);
          this.db.prepare("UPDATE cnas_labs SET last_check_at = datetime('now') WHERE lab_no = ?").run(labNo);

          if (!check.hasUpdate) {
            this.db.prepare("UPDATE cnas_labs SET sync_status = 'success' WHERE lab_no = ?").run(labNo);
            this.logCnasSync(labNo, 'checked_skip', startTime, 'success', 0);
            return { action: 'checked_skip', records: 0 };
          }
        } catch {
          // If check fails, proceed with full sync
        }
      }

      // Full sync
      const labInfo: CnasLabInfo = {
        baseInfoId: lab.base_info_id,
        labNo: lab.lab_no,
        labName: lab.lab_name,
        certUpdateTs: lab.cert_update_ts,
        validate: lab.validate,
      };
      const capabilities = await this.cnasScraper.fetchCapabilities(labInfo);

      // Try to fetch lab name if missing or garbled
      let labName = lab.lab_name;
      if (!labName || /[�]/.test(labName)) {
        try {
          const fetched = await this.cnasScraper.fetchLabName(labInfo);
          if (fetched) labName = fetched;
        } catch { /* keep existing name */ }
      }

      // Replace data atomically
      const txn = this.db.transaction(() => {
        this.db.prepare('DELETE FROM cnas_qualifications WHERE lab_no = ?').run(labNo);

        const insert = this.db.prepare(`
          INSERT INTO cnas_qualifications (lab_no, std_code, std_name, qual_type, effective_date, expiry_date, category, sub_category, test_object, test_param, test_param_en, test_standard, std_code_en, limit_desc, branch_address)
          VALUES (?, ?, ?, 'CNAS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const cap of capabilities) {
          const stdCode = (cap.stdCode ?? cap.stdDescAndClause ?? '').trim();
          if (!stdCode) continue;
          insert.run(
            labNo,
            stdCode,
            cap.stdAllDesc ?? cap.stdDescAndClause ?? '',
            '', // effective_date
            '', // expiry_date
            cap.bigTypeName ?? '',
            cap.typeName ?? '',
            cap.objCh ?? '',
            cap.paramCh ?? '',
            cap.paramEn ?? '',
            cap.stdDescAndClause ?? '',
            cap.stdCodeEn ?? '',
            cap.limitCh ?? '',
            '', // branch_address
          );
        }

        this.db.prepare(`
          UPDATE cnas_labs SET
            lab_name = ?, record_count = ?, sync_status = 'success', sync_error = NULL,
            last_sync_at = datetime('now'), last_check_at = datetime('now'),
            cached_cert_date = ?
          WHERE lab_no = ?
        `).run(labName, capabilities.length, capabilities[0]?.startDate ?? '', labNo);
      });
      txn();

      this.logCnasSync(labNo, force ? 'manual_forced' : 'synced', startTime, 'success', capabilities.length);
      return { action: force ? 'manual_forced' : 'synced', records: capabilities.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.db.prepare("UPDATE cnas_labs SET sync_status = 'error', sync_error = ? WHERE lab_no = ?").run(msg, labNo);
      this.logCnasSync(labNo, force ? 'manual_forced' : 'sync_error', startTime, 'error', 0, msg);
      throw err;
    }
  }

  // ─── Sync Logs ───

  getCnasSyncLogs(limit = 20): SyncLog[] {
    return this.db.prepare('SELECT * FROM cnas_sync_logs ORDER BY started_at DESC LIMIT ?').all(limit) as SyncLog[];
  }

  getCmaSyncLogs(limit = 20): SyncLog[] {
    return this.db.prepare('SELECT * FROM cma_sync_logs ORDER BY started_at DESC LIMIT ?').all(limit) as SyncLog[];
  }

  // ─── Settings ───

  getSettings(): Record<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM settings WHERE key LIKE 'qual_%'").all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  updateSetting(key: string, value: string): void {
    if (!key.startsWith('qual_')) throw new Error('Invalid qualification setting key');
    this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(key, value, value);
  }

  // ─── Helpers ───

  private logCnasSync(labNo: string, action: string, startTime: string, status: string, records: number, error?: string): void {
    this.db.prepare('INSERT INTO cnas_sync_logs (lab_no, action, started_at, finished_at, status, records_fetched, error_message) VALUES (?, ?, ?, datetime(\'now\'), ?, ?, ?)').run(labNo, action, startTime, status, records, error ?? null);
  }

  private logCmaSync(certNumber: string, action: string, startTime: string, status: string, records: number, error?: string): void {
    this.db.prepare('INSERT INTO cma_sync_logs (cert_number, action, started_at, finished_at, status, records_fetched, error_message) VALUES (?, ?, ?, datetime(\'now\'), ?, ?, ?)').run(certNumber, action, startTime, status, records, error ?? null);
  }
}
