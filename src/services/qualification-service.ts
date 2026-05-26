import type Database from 'better-sqlite3';
import { getDb } from './db';
import { CmaScraper, type CmaCapability, type CmaSearchResult } from './cma-scraper';
import { CnasScraper, type CnasCapability, type CnasLabInfo } from './cnas-scraper';
import { extractBaseCode, extractFullCode, cleanStdCode } from '../shared/std-code';

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

  /** Release the playwright Chromium spawned by CnasScraper on shutdown. */
  async close(): Promise<void> {
    await this.cnasScraper.close().catch(() => { /* best-effort */ });
  }

  // ─── Query ───

  /** Batch query qualifications by standard codes (for search result badges).
   *
   * 算法（用 std_code_norm / std_code_base 归一化列做索引等值查询，O(log N)，
   * 不再需要 LIKE + LIMIT 兜底）：
   *
   * 1. 把每个输入 stdCode 算出 fullCode（含年）+ baseCode（剥年）
   * 2. SQL 一次 IN (fullCodes) 拉出"同号同年"精确命中
   * 3. SQL 一次 IN (baseCodes) 拉出"同号跨年"模糊命中（含上一步的超集）
   * 4. 用 fullCode → input、baseCode → inputs 映射回写到每个 input key
   * 5. 用 source+labNo 去重，跨年命中的同源同号会自动并入
   */
  queryByStdCodes(stdCodes: string[]): Record<string, Qualification[]> {
    if (stdCodes.length === 0) return {};

    const result: Record<string, Qualification[]> = {};

    // 算每个 input 的 fullCode / baseCode，并建反向映射
    const fullToInputs = new Map<string, string[]>();
    const baseToInputs = new Map<string, string[]>();
    for (const code of stdCodes) {
      const full = extractFullCode(code);
      const base = extractBaseCode(code);
      if (!fullToInputs.has(full)) fullToInputs.set(full, []);
      fullToInputs.get(full)!.push(code);
      if (!baseToInputs.has(base)) baseToInputs.set(base, []);
      baseToInputs.get(base)!.push(code);
    }
    const fullCodes = Array.from(fullToInputs.keys());
    const baseCodes = Array.from(baseToInputs.keys());

    const addMatch = (key: string, qual: Qualification) => {
      if (!result[key]) result[key] = [];
      // 用 source+labNo 去重 —— 同一实验室同一标准号可能在 DB 里有多条（不同测试项），
      // 徽章层面合并成一条，详情留给 tooltip 渲染
      if (!result[key].some(q => q.source === qual.source && q.labNo === qual.labNo)) {
        result[key].push(qual);
      }
    };

    // CNAS: 一次 IN (baseCodes) 拉出所有同号（含跨年）命中 —— 索引等值查询，
    // baseCodes 是去重过的，几十个 input 也只查几十次索引
    const basePlaceholders = baseCodes.map(() => '?').join(',');
    const cnasRows = this.db.prepare(`
      SELECT q.std_code, q.std_code_base, q.std_name, q.lab_no,
             COALESCE(link.display_name, l.lab_name) AS lab_name,
             link.display_name AS linked_lab_name,
             q.effective_date, q.expiry_date, q.category,
             q.test_object, q.test_param, q.test_standard, q.limit_desc
      FROM cnas_qualifications q
      LEFT JOIN cnas_labs l ON q.lab_no = l.lab_no
      LEFT JOIN qualification_lab_links link ON q.lab_no = link.cnas_lab_no
      WHERE q.std_code_base IN (${basePlaceholders})
    `).all(...baseCodes) as any[];

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
      // 同号跨年的所有 input 都加上 —— 前端 tooltip 自行靠 year 对比标 ⚠ 跨年提示
      for (const input of baseToInputs.get(row.std_code_base) ?? []) {
        addMatch(input, qual);
      }
    }

    // CMA: 同样逻辑
    const cmaRows = this.db.prepare(`
      SELECT q.std_code, q.std_code_base, q.std_name, q.cert_number,
             COALESCE(link.display_name, l.lab_name) AS lab_name,
             link.display_name AS linked_lab_name,
             q.effective_date, q.expiry_date, q.category,
             q.test_item, q.test_standard, q.limit_desc
      FROM cma_qualifications q
      LEFT JOIN cma_labs l ON q.cert_number = l.cert_number
      LEFT JOIN qualification_lab_links link ON q.cert_number = link.cma_cert_number
      WHERE q.std_code_base IN (${basePlaceholders})
    `).all(...baseCodes) as any[];

    for (const row of cmaRows) {
      const qual: Qualification = {
        source: 'CMA', stdCode: row.std_code, stdName: row.std_name,
        labNo: row.cert_number, labName: row.lab_name ?? '',
        linkedLabName: row.linked_lab_name ?? undefined,
        effectiveDate: row.effective_date, expiryDate: row.expiry_date,
        category: row.category, testItem: row.test_item,
        testStandard: row.test_standard, limitDesc: row.limit_desc,
      };
      for (const input of baseToInputs.get(row.std_code_base) ?? []) {
        addMatch(input, qual);
      }
    }

    // fullCodes 暂时只用来调试一致性 —— 上面 baseCodes 已经覆盖（fullCodes ⊂ baseCodes 命中集），
    // 保留映射以便未来需要"严格同年优先排序"时直接用。
    void fullCodes;

    return result;
  }

  /** Search qualifications by keyword.
   *
   * 关键点：用户搜的可能是标准号片段（如 '3325-' / 'GB/T 3325'）、完整带年（'GB/T 3325-2024'，
   * 含全角/脏空格变体）、关键词（实验室名 / 测试项）。
   *
   * 多层匹配，越严越靠前：
   * 1. std_code_norm = ? / std_code_base = ?  — query 解析成完整标准号时索引等值命中
   * 2. std_code_norm LIKE / std_code_base LIKE — query 是片段时归一化形态做子串
   *    （比如 '3325-' 在归一化形态下都是 'GB3325-2024' 的子串，CNAS 脏空格变体不再漏）
   * 3. std_code LIKE — 兜底原始字段子串
   * 4. 其余字段 LIKE — 关键词搜实验室名 / 测试项
   */
  searchQualifications(query: string, source?: 'CNAS' | 'CMA', limit = 50): Qualification[] {
    const q = `%${query}%`;
    const queryFull = extractFullCode(query);
    const queryBase = extractBaseCode(query);
    // 把 query 也归一化一遍再 LIKE：用户搜 '3325-'，extractFullCode → '3325-'，
    // 'GB3325-2024' 含 '3325-' ✓；这一步把"片段不带前缀也能匹"和"脏数据"两个问题一起闭掉
    const qNorm = `%${queryFull}%`;
    const qBase = `%${queryBase}%`;
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
        WHERE q.std_code_norm = ? OR q.std_code_base = ?
           OR q.std_code_norm LIKE ? OR q.std_code_base LIKE ?
           OR q.std_code LIKE ? OR q.std_name LIKE ? OR q.lab_no LIKE ?
           OR l.lab_name LIKE ? OR q.test_object LIKE ? OR q.test_param LIKE ?
           OR q.test_standard LIKE ? OR q.category LIKE ?
        ORDER BY q.std_code, q.effective_date DESC
        LIMIT ?
      `).all(queryFull, queryBase, qNorm, qBase, q, q, q, q, q, q, q, q, limit) as any[];

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
        WHERE q.std_code_norm = ? OR q.std_code_base = ?
           OR q.std_code_norm LIKE ? OR q.std_code_base LIKE ?
           OR q.std_code LIKE ? OR q.std_name LIKE ? OR q.cert_number LIKE ?
           OR l.lab_name LIKE ? OR q.test_item LIKE ? OR q.test_standard LIKE ?
           OR q.category LIKE ?
        ORDER BY q.std_code, q.effective_date DESC
        LIMIT ?
      `).all(queryFull, queryBase, qNorm, qBase, q, q, q, q, q, q, q, limit) as any[];

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

      // Replace data, chunked to keep the Node event loop responsive
      this.db.prepare('DELETE FROM cma_qualifications WHERE cert_number = ?').run(certNumber);
      if (nextCertNumber !== certNumber) {
        this.db.prepare('DELETE FROM cma_qualifications WHERE cert_number = ?').run(nextCertNumber);
      }

      const insertCma = this.db.prepare(`
        INSERT INTO cma_qualifications (cert_number, std_code, std_code_norm, std_code_base, std_name, qual_type, effective_date, expiry_date, category, sub_category, test_item, test_standard, limit_desc, note, place_name)
        VALUES (?, ?, ?, ?, ?, 'CMA', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertCmaChunk = this.db.transaction((chunk: typeof capabilities) => {
        for (const cap of chunk) {
          // 抓取入库前清洗 std_code：CNAS / CMA 网站 HTML 偶发把"年份连字符附近多空格"渲进 std_code，
          // 让 'std_code LIKE %3325-%' 这种子串查询漏命中。cleanStdCode 不动前缀和大小写、
          // 只折叠空白 —— 跟归一化列正交，两层一起防御
          const stdCode = cleanStdCode(cap.yjbzNumber ?? '');
          if (!stdCode) continue;
          insertCma.run(
            nextCertNumber,
            stdCode,
            extractFullCode(stdCode),
            extractBaseCode(stdCode),
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
      });
      const CMA_CHUNK = 200;
      for (let i = 0; i < capabilities.length; i += CMA_CHUNK) {
        insertCmaChunk(capabilities.slice(i, i + CMA_CHUNK));
        await new Promise<void>((resolve) => setImmediate(resolve));
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

  /**
   * 并发安全的 CNAS 同步入口：CnasScraper 内部用 page pool（共享 browser + per-job
   * context/page + 信号量 maxConcurrent=3）承接并发，调用方可以放心并行触发。
   */
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
        } catch (err) {
          // Update-check failure shouldn't abort the sync — fall through to
          // full re-fetch — but log it so HTML changes / blocks are visible.
          console.warn(`[cnas] checkForUpdate failed for ${labNo}, doing full sync:`,
            err instanceof Error ? err.message : String(err));
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
        } catch (err) {
          console.warn(`[cnas] fetchLabName failed for ${labNo}, keeping existing:`,
            err instanceof Error ? err.message : String(err));
        }
      }

      // Fetch org info (other names, address, validity, cert tasks)
      let orgInfo: { otherNames: string; address: string; validityPeriod: string; certTasks: Array<{ taskNo: string; reviewType: string; signDate: string; scopeStatus: string }> } = { otherNames: '', address: '', validityPeriod: '', certTasks: [] };
      try {
        orgInfo = await this.cnasScraper.fetchOrgInfo(labInfo);
      } catch (err) {
        console.warn(`[cnas] fetchOrgInfo failed for ${labNo}, using defaults:`,
          err instanceof Error ? err.message : String(err));
      }

      // Replace data, chunked to keep the Node event loop responsive
      this.db.prepare('DELETE FROM cnas_qualifications WHERE lab_no = ?').run(labNo);

      const insertCnas = this.db.prepare(`
        INSERT INTO cnas_qualifications (lab_no, std_code, std_code_norm, std_code_base, std_name, qual_type, effective_date, expiry_date, category, sub_category, test_object, test_param, test_param_en, test_standard, std_code_en, limit_desc, branch_address)
        VALUES (?, ?, ?, ?, ?, 'CNAS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertCnasChunk = this.db.transaction((chunk: typeof capabilities) => {
        for (const cap of chunk) {
          // 抓取入库前清洗（同 CMA 上方注释）—— CNAS 是已知会产出 'GB/T 3325 -2024' 脏空格变体的源
          const stdCode = cleanStdCode(cap.stdCode ?? cap.stdDescAndClause ?? '');
          if (!stdCode) continue;
          insertCnas.run(
            labNo,
            stdCode,
            extractFullCode(stdCode),
            extractBaseCode(stdCode),
            cap.stdAllDesc ?? cap.stdDescAndClause ?? '',
            '', '',
            cap.bigTypeName ?? '',
            cap.typeName ?? '',
            cap.objCh ?? '',
            cap.paramCh ?? '',
            cap.paramEn ?? '',
            cap.stdDescAndClause ?? '',
            cap.stdCodeEn ?? '',
            cap.limitCh ?? '',
            '',
          );
        }
      });
      const CNAS_CHUNK = 200;
      for (let i = 0; i < capabilities.length; i += CNAS_CHUNK) {
        insertCnasChunk(capabilities.slice(i, i + CNAS_CHUNK));
        await new Promise<void>((resolve) => setImmediate(resolve));
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

/**
 * 从一个标准编码 base（extractBaseCode 的输出，如 'GB3325'）拼出 SQL LIKE 模式。
 * 形如 'GB%3325%' —— prefix 拉前缀、数字尾巴拉过滤，比仅 'GB%' 命中收敛 100×。
 * 输入 base 拆不出数字尾巴或前缀非法时返回 null，调用方按需 fallback。
 *
 * 安全：prefix 必须匹配 /^[A-Z]+$/ 且长度 ≤ 8，digits 用白名单 [A-Z0-9] 过滤
 * 并截断到 16 字符，避免 % / _ 注入把扫描扩成全表 / DoS。
 */
export function buildFuzzyLikePattern(base: string): string | null {
  const m = base.match(/^([A-Z]+)([0-9].*)?$/);
  if (!m) return null;
  const prefix = m[1];
  const digits = m[2] ?? '';
  if (!/^[A-Z]+$/.test(prefix) || prefix.length > 8) return null;
  const safeDigits = digits.replace(/[^A-Z0-9]/gi, '').slice(0, 16);
  return safeDigits ? `${prefix}%${safeDigits}%` : `${prefix}%`;
}

// 标准号归一化函数已抽到 src/shared/std-code.ts（避免 db.ts 迁移逻辑反向依赖 qualification-service.ts）。
// 这里继续 re-export 是为了不破坏现有引用（admin-routes / library-index 已经从这里 import）。
export { extractBaseCode, extractFullCode, cleanStdCode };
