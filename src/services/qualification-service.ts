import type Database from 'better-sqlite3';
import { getDb } from './db';
import { CmaScraper, type CmaCapability, type CmaSearchResult } from './cma-scraper';
import { CnasScraper, type CnasCapability, type CnasLabInfo } from './cnas-scraper';

export interface Qualification {
  source: 'CNAS' | 'CMA';
  stdCode: string;
  stdName: string;
  labNo: string;
  labName: string;
  linkedLabName?: string;
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
  url_params: string;
  other_names: string;
  org_address: string;
  validity_period: string;
  cert_tasks: string;
  linked_display_name?: string;
  linked_cma_cert_number?: string;
}

export interface CmaLab {
  id: number;
  cert_number: string;
  lab_name: string;
  credit_code: string;
  lic_sys_id: string;
  public_detail_id: string;
  address: string;
  area_name: string;
  industry: string;
  issue_date: string;
  valid_from: string;
  valid_to: string;
  cert_status: string;
  cached_lic_date: string;
  cached_update_time: number;
  last_check_at: string | null;
  last_sync_at: string | null;
  next_sync_at: string | null;
  sync_status: string;
  sync_error: string | null;
  record_count: number;
  subscribed_at: string;
  linked_display_name?: string;
  linked_cnas_lab_no?: string;
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

export interface SyncProgress {
  fetched: number;
  total: number;
}

export class QualificationService {
  private db: Database.Database;
  private cmaScraper = new CmaScraper();
  private cnasScraper = new CnasScraper();
  /** In-memory sync progress: key = "cnas:labNo" or "cma:certNumber" */
  private syncProgress = new Map<string, SyncProgress>();

  constructor(db?: Database.Database) {
    this.db = db ?? getDb();
  }

  // ─── Query ───

  /** Batch query qualifications by standard codes (for search result badges) */
  queryByStdCodes(stdCodes: string[]): Record<string, Qualification[]> {
    if (stdCodes.length === 0) return {};

    const placeholders = stdCodes.map(() => '?').join(',');
    const result: Record<string, Qualification[]> = {};

    // Build base code → input codes mapping for fuzzy matching
    const baseToInputs = new Map<string, string[]>();
    for (const code of stdCodes) {
      const base = extractBaseCode(code);
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
      SELECT q.std_code, q.std_name, q.lab_no,
             COALESCE(link.display_name, l.lab_name) AS lab_name,
             link.display_name AS linked_lab_name,
             q.effective_date, q.expiry_date, q.category,
             q.test_object, q.test_param, q.test_standard, q.limit_desc
      FROM cnas_qualifications q
      LEFT JOIN cnas_labs l ON q.lab_no = l.lab_no
      LEFT JOIN qualification_lab_links link ON q.lab_no = link.cnas_lab_no
      WHERE q.std_code IN (${placeholders})
    `).all(...stdCodes) as any[];

    const matchedCnasBases = new Set<string>();
    for (const row of cnasRows) {
      const qual: Qualification = {
        source: 'CNAS', stdCode: row.std_code, stdName: row.std_name,
        labNo: row.lab_no, labName: row.lab_name ?? '',
        linkedLabName: row.linked_lab_name ?? undefined,
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
      const rowBase = extractBaseCode(row.std_code);
      matchedCnasBases.add(rowBase);
      for (const input of baseToInputs.get(rowBase) ?? []) {
        addMatch(input, qual);
      }
    }

    // CMA
    const cmaRows = this.db.prepare(`
      SELECT q.std_code, q.std_name, q.cert_number,
             COALESCE(link.display_name, l.lab_name) AS lab_name,
             link.display_name AS linked_lab_name,
             q.effective_date, q.expiry_date, q.category,
             q.test_item, q.test_standard, q.limit_desc
      FROM cma_qualifications q
      LEFT JOIN cma_labs l ON q.cert_number = l.cert_number
      LEFT JOIN qualification_lab_links link ON q.cert_number = link.cma_cert_number
      WHERE q.std_code IN (${placeholders})
    `).all(...stdCodes) as any[];

    for (const row of cmaRows) {
      const qual: Qualification = {
        source: 'CMA', stdCode: row.std_code, stdName: row.std_name,
        labNo: row.cert_number, labName: row.lab_name ?? '',
        linkedLabName: row.linked_lab_name ?? undefined,
        effectiveDate: row.effective_date, expiryDate: row.expiry_date,
        category: row.category, testItem: row.test_item,
        testStandard: row.test_standard, limitDesc: row.limit_desc,
      };
      // Exact match
      for (const code of stdCodes) {
        if (code === row.std_code) addMatch(code, qual);
      }
      // Fuzzy: add under all input codes with same base
      const rowBase = extractBaseCode(row.std_code);
      for (const input of baseToInputs.get(rowBase) ?? []) {
        addMatch(input, qual);
      }
    }

    // For any input codes with no results, narrow to plausible rows via SQL LIKE on
    // the leading prefix (e.g. "GB"), then apply the exact base-code comparison in JS.
    // Falls back from O(N) full-table scans to O(matching-prefix), capped by LIMIT.
    const unmatchedInputs = stdCodes.filter(code => !result[code]?.length);
    if (unmatchedInputs.length > 0) {
      const FUZZY_LIMIT = 500;
      const inputBases = unmatchedInputs.map(code => ({ input: code, base: extractBaseCode(code) }));
      // Group inputs by their alphabetic prefix (GB / GBT / YY / etc.) for prefix-LIKE queries
      // prefix is sanitized to /^[A-Z]+$/ before being used in a LIKE clause —
      // % and _ from user input would otherwise widen the scan to a full-table
      // walk (DoS amplifier) or leak unrelated rows.
      const prefixes = new Set<string>();
      for (const { base } of inputBases) {
        const prefix = base.match(/^[A-Z]+/)?.[0];
        if (prefix && /^[A-Z]+$/.test(prefix) && prefix.length <= 8) {
          prefixes.add(prefix);
        }
      }
      if (prefixes.size > 0) {
        const likeClauses = Array.from(prefixes).map(() => 'q.std_code LIKE ?').join(' OR ');
        const likeArgs = Array.from(prefixes).map(p => `${p}%`);

        const cnasCandidates = this.db.prepare(`
          SELECT q.std_code, q.std_name, q.lab_no, l.lab_name,
                 q.effective_date, q.expiry_date, q.category,
                 q.test_object, q.test_param, q.test_standard, q.limit_desc
          FROM cnas_qualifications q LEFT JOIN cnas_labs l ON q.lab_no = l.lab_no
          WHERE ${likeClauses}
          LIMIT ?
        `).all(...likeArgs, FUZZY_LIMIT) as any[];
        const cmaCandidates = this.db.prepare(`
          SELECT q.std_code, q.std_name, q.cert_number, l.lab_name,
                 q.effective_date, q.expiry_date, q.category,
                 q.test_item, q.test_standard, q.limit_desc
          FROM cma_qualifications q LEFT JOIN cma_labs l ON q.cert_number = l.cert_number
          WHERE ${likeClauses}
          LIMIT ?
        `).all(...likeArgs, FUZZY_LIMIT) as any[];

        for (const { input, base: inputBase } of inputBases) {
          for (const row of cnasCandidates) {
            if (extractBaseCode(row.std_code) === inputBase) {
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
          for (const row of cmaCandidates) {
            if (extractBaseCode(row.std_code) === inputBase) {
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
    }

    return result;
  }

  /** Search qualifications by keyword */
  searchQualifications(query: string, source?: 'CNAS' | 'CMA', limit = 50): Qualification[] {
    const q = `%${query}%`;
    const results: Qualification[] = [];

    if (!source || source === 'CNAS') {
      const rows = this.db.prepare(`
        SELECT q.std_code, q.std_name, q.lab_no,
               COALESCE(link.display_name, l.lab_name) AS lab_name,
               link.display_name AS linked_lab_name,
               q.effective_date, q.expiry_date, q.category,
               q.test_object, q.test_param, q.test_standard, q.limit_desc
        FROM cnas_qualifications q
        LEFT JOIN cnas_labs l ON q.lab_no = l.lab_no
        LEFT JOIN qualification_lab_links link ON q.lab_no = link.cnas_lab_no
        WHERE q.std_code LIKE ? OR q.std_name LIKE ? OR q.lab_no LIKE ?
           OR l.lab_name LIKE ? OR q.test_object LIKE ? OR q.test_param LIKE ?
           OR q.test_standard LIKE ? OR q.category LIKE ?
        ORDER BY q.std_code, q.effective_date DESC
        LIMIT ?
      `).all(q, q, q, q, q, q, q, q, limit) as any[];

      for (const row of rows) {
        results.push({
          source: 'CNAS',
          stdCode: row.std_code,
          stdName: row.std_name,
          labNo: row.lab_no,
          labName: row.lab_name ?? '',
          linkedLabName: row.linked_lab_name ?? undefined,
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
        SELECT q.std_code, q.std_name, q.cert_number,
               COALESCE(link.display_name, l.lab_name) AS lab_name,
               link.display_name AS linked_lab_name,
               q.effective_date, q.expiry_date, q.category,
               q.test_item, q.test_standard, q.limit_desc
        FROM cma_qualifications q
        LEFT JOIN cma_labs l ON q.cert_number = l.cert_number
        LEFT JOIN qualification_lab_links link ON q.cert_number = link.cma_cert_number
        WHERE q.std_code LIKE ? OR q.std_name LIKE ? OR q.cert_number LIKE ?
           OR l.lab_name LIKE ? OR q.test_item LIKE ? OR q.test_standard LIKE ?
           OR q.category LIKE ?
        ORDER BY q.std_code, q.effective_date DESC
        LIMIT ?
      `).all(q, q, q, q, q, q, q, limit) as any[];

      for (const row of rows) {
        results.push({
          source: 'CMA',
          stdCode: row.std_code,
          stdName: row.std_name,
          labNo: row.cert_number,
          labName: row.lab_name ?? '',
          linkedLabName: row.linked_lab_name ?? undefined,
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

  /** Batch keyword query against local subscribed qualification cache only. */
  queryVisualKeywords(queries: string[], limitPerQuery = 500): Record<string, Qualification[]> {
    const result: Record<string, Qualification[]> = {};
    for (const query of queries) {
      result[query] = this.searchQualifications(query, undefined, limitPerQuery);
    }
    return result;
  }

  // ─── CNAS Lab Management ───

  getSyncProgress(key: string): SyncProgress | undefined {
    return this.syncProgress.get(key);
  }

  listCnasLabs(): (CnasLab & { sync_progress?: SyncProgress })[] {
    const labs = this.db.prepare(`
      SELECT l.*, link.display_name AS linked_display_name, link.cma_cert_number AS linked_cma_cert_number
      FROM cnas_labs l
      LEFT JOIN qualification_lab_links link ON l.lab_no = link.cnas_lab_no
      ORDER BY l.subscribed_at DESC
    `).all() as CnasLab[];
    return labs.map(l => {
      const progress = this.syncProgress.get(`cnas:${l.lab_no}`);
      return progress ? { ...l, sync_progress: progress } : l;
    });
  }

  addCnasLab(lab: { lab_no: string; lab_name?: string; base_info_id?: string; cert_update_ts?: string; validate?: string; url_params?: Record<string, string> }): CnasLab {
    const urlParamsJson = JSON.stringify(lab.url_params ?? {});
    this.db.prepare(`
      INSERT INTO cnas_labs (lab_no, lab_name, base_info_id, cert_update_ts, validate, url_params)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(lab_no) DO UPDATE SET lab_name = excluded.lab_name, base_info_id = excluded.base_info_id, url_params = excluded.url_params
    `).run(lab.lab_no, lab.lab_name ?? '', lab.base_info_id ?? '', lab.cert_update_ts ?? '', lab.validate ?? '', urlParamsJson);
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

  listCmaLabs(): (CmaLab & { sync_progress?: SyncProgress })[] {
    const labs = this.db.prepare(`
      SELECT l.*, link.display_name AS linked_display_name, link.cnas_lab_no AS linked_cnas_lab_no
      FROM cma_labs l
      LEFT JOIN qualification_lab_links link ON l.cert_number = link.cma_cert_number
      ORDER BY l.subscribed_at DESC
    `).all() as CmaLab[];
    return labs.map(l => {
      const progress = this.syncProgress.get(`cma:${l.cert_number}`);
      return progress ? { ...l, sync_progress: progress } : l;
    });
  }

  linkQualificationLabs(link: { display_name: string; cnas_lab_no?: string; cma_cert_number?: string }): void {
    if (!link.cnas_lab_no && !link.cma_cert_number) throw new Error('CNAS or CMA identifier is required');
    const displayName = link.display_name.trim();
    if (!displayName) throw new Error('Display name is required');

    const existing = this.db.prepare(`
      SELECT * FROM qualification_lab_links
      WHERE (? IS NOT NULL AND cnas_lab_no = ?)
         OR (? IS NOT NULL AND cma_cert_number = ?)
    `).get(
      link.cnas_lab_no ?? null,
      link.cnas_lab_no ?? null,
      link.cma_cert_number ?? null,
      link.cma_cert_number ?? null,
    ) as any | undefined;
    const existingId = existing?.id ?? 0;

    this.db.prepare(`
      DELETE FROM qualification_lab_links
      WHERE id <> ?
        AND ((? IS NOT NULL AND cnas_lab_no = ?)
          OR (? IS NOT NULL AND cma_cert_number = ?))
    `).run(
      existingId,
      link.cnas_lab_no ?? null,
      link.cnas_lab_no ?? null,
      link.cma_cert_number ?? null,
      link.cma_cert_number ?? null,
    );

    if (existing) {
      this.db.prepare(`
        UPDATE qualification_lab_links
        SET display_name = ?,
            cnas_lab_no = COALESCE(?, cnas_lab_no),
            cma_cert_number = COALESCE(?, cma_cert_number),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(displayName, link.cnas_lab_no ?? null, link.cma_cert_number ?? null, existing.id);
      return;
    }

    this.db.prepare(`
      INSERT INTO qualification_lab_links (display_name, cnas_lab_no, cma_cert_number)
      VALUES (?, ?, ?)
    `).run(displayName, link.cnas_lab_no ?? null, link.cma_cert_number ?? null);
  }

  unlinkQualificationLab(source: 'CNAS' | 'CMA', id: string): void {
    const column = source === 'CNAS' ? 'cnas_lab_no' : 'cma_cert_number';
    this.db.prepare(`DELETE FROM qualification_lab_links WHERE ${column} = ?`).run(id);
  }

  async searchCmaLabs(query: string): Promise<CmaSearchResult[]> {
    return this.cmaScraper.searchLabsByName(query);
  }

  async addCmaLab(lab: { public_detail_id: string }): Promise<CmaLab> {
    const detail = await this.cmaScraper.getDetail(lab.public_detail_id);
    if (!detail.certificateNumber) throw new Error('CMA certificate number not found on public detail page');

    this.db.prepare(`
      INSERT INTO cma_labs (
        cert_number, lab_name, credit_code, lic_sys_id, public_detail_id,
        address, area_name, industry, issue_date, valid_from, valid_to,
        cert_status, cached_lic_date
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cert_number) DO UPDATE SET
        lab_name = excluded.lab_name,
        credit_code = excluded.credit_code,
        lic_sys_id = excluded.lic_sys_id,
        public_detail_id = excluded.public_detail_id,
        address = excluded.address,
        area_name = excluded.area_name,
        industry = excluded.industry,
        issue_date = excluded.issue_date,
        valid_from = excluded.valid_from,
        valid_to = excluded.valid_to,
        cert_status = excluded.cert_status,
        cached_lic_date = excluded.cached_lic_date,
        sync_error = NULL
    `).run(
      detail.certificateNumber,
      detail.sysName,
      detail.sysZzjgdm,
      detail.publicDetailId,
      detail.publicDetailId,
      detail.addr,
      detail.areaName,
      detail.majorCategory,
      detail.licDate,
      detail.licValidTimeBegin,
      detail.licValidTimeEnd,
      detail.certStatus,
      detail.licDate,
    );
    return this.db.prepare('SELECT * FROM cma_labs WHERE cert_number = ?').get(detail.certificateNumber) as CmaLab;
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
    const publicDetailId = lab.public_detail_id || lab.lic_sys_id;
    if (!publicDetailId) throw new Error('No CMA public detail id stored. Search the institution name and subscribe again.');

    const startTime = new Date().toISOString();
    const progressKey = `cma:${certNumber}`;
    this.syncProgress.set(progressKey, { fetched: 0, total: 0 });
    this.db.prepare("UPDATE cma_labs SET sync_status = 'syncing' WHERE cert_number = ?").run(certNumber);

    try {
      // Update detection
      if (!force && lab.cached_lic_date && lab.record_count > 0) {
        const check = await this.cmaScraper.checkForUpdate(publicDetailId, lab.cached_lic_date);
        this.db.prepare("UPDATE cma_labs SET last_check_at = datetime('now') WHERE cert_number = ?").run(certNumber);

        if (!check.hasUpdate) {
          this.db.prepare("UPDATE cma_labs SET sync_status = 'success' WHERE cert_number = ?").run(certNumber);
          this.logCmaSync(certNumber, 'checked_skip', startTime, 'success', 0);
          return { action: 'checked_skip', records: 0 };
        }
      }

      // Full sync
      const { detail, capabilities } = await this.cmaScraper.scrapeFull(publicDetailId);
      const nextCertNumber = detail.certificateNumber || certNumber;

      // Replace data atomically
      const txn = this.db.transaction(() => {
        this.db.prepare('DELETE FROM cma_qualifications WHERE cert_number = ?').run(certNumber);
        if (nextCertNumber !== certNumber) {
          this.db.prepare('DELETE FROM cma_qualifications WHERE cert_number = ?').run(nextCertNumber);
        }

        const insert = this.db.prepare(`
          INSERT INTO cma_qualifications (cert_number, std_code, std_name, qual_type, effective_date, expiry_date, category, sub_category, test_item, test_standard, limit_desc, note, place_name)
          VALUES (?, ?, ?, 'CMA', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const cap of capabilities) {
          const stdCode = (cap.yjbzNumber ?? '').trim();
          if (!stdCode) continue;
          insert.run(
            nextCertNumber,
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
            cert_number = ?, lab_name = ?, credit_code = ?, lic_sys_id = ?, public_detail_id = ?,
            address = ?, area_name = ?, industry = ?, issue_date = ?, valid_from = ?, valid_to = ?,
            cert_status = ?, cached_lic_date = ?,
            record_count = ?, sync_status = 'success', sync_error = NULL,
            last_sync_at = datetime('now'), last_check_at = datetime('now')
          WHERE cert_number = ?
        `).run(
          nextCertNumber,
          detail.sysName || detail.licUnitname || lab.lab_name,
          detail.sysZzjgdm || lab.credit_code,
          detail.publicDetailId,
          detail.publicDetailId,
          detail.addr,
          detail.areaName,
          detail.majorCategory,
          detail.licDate,
          detail.licValidTimeBegin,
          detail.licValidTimeEnd,
          detail.certStatus,
          detail.licDate,
          capabilities.length,
          certNumber,
        );
      });
      txn();

      this.syncProgress.delete(progressKey);
      this.logCmaSync(nextCertNumber, force ? 'manual_forced' : 'cert_date_changed', startTime, 'success', capabilities.length);
      return { action: force ? 'manual_forced' : 'cert_date_changed', records: capabilities.length };
    } catch (err) {
      this.syncProgress.delete(progressKey);
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

    let urlParams: Record<string, string> = {};
    try { urlParams = JSON.parse(lab.url_params || '{}'); } catch { /* ignore */ }

    const startTime = new Date().toISOString();
    const progressKey = `cnas:${labNo}`;
    this.syncProgress.set(progressKey, { fetched: 0, total: 0 });
    this.db.prepare("UPDATE cnas_labs SET sync_status = 'syncing' WHERE lab_no = ?").run(labNo);

    try {
      // Update detection
      if (!force && lab.cached_cert_date) {
        try {
          const check = await this.cnasScraper.checkForUpdate(lab.base_info_id, lab.cached_cert_date, urlParams);
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
        urlParams,
      };
      const capabilities = await this.cnasScraper.fetchCapabilities(labInfo, (fetched, total) => {
        this.syncProgress.set(progressKey, { fetched, total });
      });

      // Try to fetch lab name if missing or garbled
      let labName = lab.lab_name;
      if (!labName || /[�]/.test(labName)) {
        try {
          const fetched = await this.cnasScraper.fetchLabName(labInfo);
          if (fetched) labName = fetched;
        } catch { /* keep existing name */ }
      }

      // Fetch org info (other names, address, validity, cert tasks)
      let orgInfo: { otherNames: string; address: string; validityPeriod: string; certTasks: Array<{ taskNo: string; reviewType: string; signDate: string; scopeStatus: string }> } = { otherNames: '', address: '', validityPeriod: '', certTasks: [] };
      try {
        orgInfo = await this.cnasScraper.fetchOrgInfo(labInfo);
      } catch { /* keep defaults */ }

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
            cached_cert_date = ?,
            other_names = ?, org_address = ?, validity_period = ?, cert_tasks = ?
          WHERE lab_no = ?
        `).run(
          labName, capabilities.length, capabilities[0]?.startDate ?? '',
          orgInfo.otherNames, orgInfo.address, orgInfo.validityPeriod, JSON.stringify(orgInfo.certTasks),
          labNo,
        );
      });
      txn();

      this.syncProgress.delete(progressKey);
      this.logCnasSync(labNo, force ? 'manual_forced' : 'synced', startTime, 'success', capabilities.length);
      return { action: force ? 'manual_forced' : 'synced', records: capabilities.length };
    } catch (err) {
      this.syncProgress.delete(progressKey);
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

  /** Read qual_sync_concurrency setting, clamped to [1, 8]. */
  private getSyncConcurrency(): number {
    const raw = this.db.prepare("SELECT value FROM settings WHERE key = 'qual_sync_concurrency'").get() as { value: string } | undefined;
    const n = Number.parseInt(raw?.value ?? '1', 10);
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(n, 8);
  }

  async syncAllCnasLabs(force = false): Promise<Array<{ lab_no: string; action?: string; records?: number; error?: string }>> {
    const labs = this.listCnasLabs();
    return runWithConcurrency(labs, this.getSyncConcurrency(), async (lab) => {
      try {
        const r = await this.syncCnasLab(lab.lab_no, force);
        return { lab_no: lab.lab_no, ...r };
      } catch (err) {
        return { lab_no: lab.lab_no, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  async syncAllCmaLabs(force = false): Promise<Array<{ cert_number: string; action?: string; records?: number; error?: string }>> {
    const labs = this.listCmaLabs();
    return runWithConcurrency(labs, this.getSyncConcurrency(), async (lab) => {
      try {
        const r = await this.syncCmaLab(lab.cert_number, force);
        return { cert_number: lab.cert_number, ...r };
      } catch (err) {
        return { cert_number: lab.cert_number, error: err instanceof Error ? err.message : String(err) };
      }
    });
  }

  // ─── Helpers ───

  private logCnasSync(labNo: string, action: string, startTime: string, status: string, records: number, error?: string): void {
    this.db.prepare('INSERT INTO cnas_sync_logs (lab_no, action, started_at, finished_at, status, records_fetched, error_message) VALUES (?, ?, ?, datetime(\'now\'), ?, ?, ?)').run(labNo, action, startTime, status, records, error ?? null);
  }

  private logCmaSync(certNumber: string, action: string, startTime: string, status: string, records: number, error?: string): void {
    this.db.prepare('INSERT INTO cma_sync_logs (cert_number, action, started_at, finished_at, status, records_fetched, error_message) VALUES (?, ?, ?, datetime(\'now\'), ?, ?, ?)').run(certNumber, action, startTime, status, records, error ?? null);
  }
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

/** "GB/T 23440-2009" → "GB23440" — strip year suffix, type designator, and whitespace. */
function extractBaseCode(code: string): string {
  return code
    .replace(/\s*-\s*\d{4}$/, '')
    .replace(/\/[A-Z]+(?=\s)/i, '')
    .replace(/[\s]/g, '')
    .toUpperCase();
}
