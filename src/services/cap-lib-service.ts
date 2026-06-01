/**
 * 国家 CMA 一单一库（能力项目库）镜像与比对服务。
 *
 * 三个核心能力：
 * 1) **syncDomain**：抓取一个领域的全量行，hash diff 后 upsert + 标记 last_seen_at（soft delete）
 * 2) **diffByLab**：把订阅机构的 cma_qualifications 行与 cma_capability_lib 对比，输出 5 档状态
 * 3) **batchStatus**：给前端徽章用的轻量批量查询（搜索/资质查询页注入）
 *
 * 远端接口（实测无鉴权，详见 README 数据源章节）：
 *   GET https://cma.caqit.org.cn/cma-admin/system/standardData/list?pageNum=1&pageSize=60000&domain=<name>
 * 返回 RuoYi 标准 `{total, rows[], code, msg}`，单次最大 50000+ 行不分页，41s 一次拉全。
 *
 * 与 cma_qualifications 的关系：两表正交。本表是"政策范围内的合法标准号清单"，
 * cma_qualifications 是"机构持有的资质行"。diffByLab 按 std_code_norm 等值 JOIN，
 * 复用现有索引，O(M log N)。
 */
import crypto from 'crypto';
import type Database from 'better-sqlite3';
import { cleanStdCode, extractFullCode, extractBaseCode } from '../shared/std-code';
import { parseLibStatus, type LibStatus, type DiffStatus } from '../shared/cap-lib-status';
import { CAP_LIB_DOMAIN_NAMES, isValidCapLibDomain } from '../shared/cap-lib-domains';
import { setSetting } from './db';

const REMOTE_BASE = 'https://cma.caqit.org.cn/cma-admin/system/standardData/list';
/** 单次拉取的 pageSize 上限。实测远端不分页，60000 足以容纳最大领域（产品质量检验 ~41k）。 */
const REMOTE_PAGE_SIZE = 60000;
/** 远端响应超时；最大领域实测 41s，留 3 倍余量。 */
const REMOTE_TIMEOUT_MS = 180_000;

// ─── 类型定义 ─────────────────────────────────────────────────────────────

interface RemoteRow {
  id: number;
  domain: string | null;
  standardMethod: string | null;
  standardCode: string | null;
  remark: string | null;
  status: string | null;
  updateTime: string | null;
}

interface RemoteListResp {
  total: number;
  rows: RemoteRow[];
  code: number;
  msg: string;
}

export interface SyncProgress {
  phase: 'pending' | 'fetching' | 'parsing' | 'upserting' | 'done' | 'error';
  domain: string;
  current: number;
  total: number;
  error?: string;
  stats?: SyncStats;
}

export interface SyncStats {
  added: number;
  changed: number;
  unchanged: number;
  removedSoft: number;   // 远端不再出现、本地仍保留（标记 last_seen_at 不更新）
  durationMs: number;
}

export interface DomainMeta {
  domain: string;
  subscribed: boolean;
  lastSyncedAt: string;
  remoteTotal: number;
  localTotal: number;
  lastSyncStats: SyncStats | null;
}

export interface CapLibBadgeStatus {
  /** 4 档徽章状态（搜索/资质查询页用） */
  status: DiffStatus;
  inLib: boolean;
  libDomain: string;       // 在库时给出领域
  libStatus: LibStatus | '';   // 库内 active/cite_only/abolished
  libRemark: string;
  seriesNewCode: string;   // series_only 时给出推荐替代年版
  /** 数据失效标记：该领域未同步 / 同步超过 30 天 / 该领域没数据 */
  stale: boolean;
}

export interface DiffRow {
  qualId: number;
  stdCode: string;
  stdName: string;
  category: string;
  testItem: string;
  diffStatus: DiffStatus;
  libStatus: LibStatus | '';
  libRemark: string;
  libDomain: string;
  seriesNewCode: string;
  seriesDomain: string;
}

export interface DiffSummary {
  labCount: number;
  totalQuals: number;
  byStatus: Record<DiffStatus, number>;
  unsyncedDomains: string[];   // 用户订阅但从未同步的领域名
}

// ─── 同步进度内存 store ───────────────────────────────────────────────────

const progressStore = new Map<string, SyncProgress>();

export function getSyncProgress(jobId: string): SyncProgress | null {
  return progressStore.get(jobId) || null;
}

function setProgress(jobId: string, p: SyncProgress): void {
  progressStore.set(jobId, p);
}

/** 防止 progressStore 无限增长：保留最近 50 个 job。 */
function pruneProgressStore(): void {
  if (progressStore.size <= 50) return;
  const keys = [...progressStore.keys()];
  for (const k of keys.slice(0, keys.length - 50)) progressStore.delete(k);
}

// ─── Service ─────────────────────────────────────────────────────────────

export class CapLibService {
  constructor(private db: Database.Database) {}

  // ── 元数据 ──

  listDomains(): DomainMeta[] {
    const rows = this.db.prepare(`
      SELECT domain, subscribed, last_synced_at, remote_total, local_total, last_sync_stats
      FROM cma_capability_lib_meta
      ORDER BY local_total DESC, domain
    `).all() as Array<{
      domain: string; subscribed: number; last_synced_at: string;
      remote_total: number; local_total: number; last_sync_stats: string;
    }>;
    return rows.map(r => ({
      domain: r.domain,
      subscribed: !!r.subscribed,
      lastSyncedAt: r.last_synced_at || '',
      remoteTotal: r.remote_total || 0,
      localTotal: r.local_total || 0,
      lastSyncStats: this.parseStats(r.last_sync_stats),
    }));
  }

  private parseStats(raw: string | null): SyncStats | null {
    if (!raw) return null;
    try { return JSON.parse(raw) as SyncStats; } catch { return null; }
  }

  setSubscribed(domain: string, subscribed: boolean): void {
    if (!isValidCapLibDomain(domain)) throw new Error(`非法领域名: ${domain}`);
    this.db.prepare(`
      UPDATE cma_capability_lib_meta SET subscribed = ? WHERE domain = ?
    `).run(subscribed ? 1 : 0, domain);
  }

  // ── 抓取 ──

  /**
   * 同步单一领域。fire-and-forget — 调用方拿到 jobId 后通过 getSyncProgress 轮询。
   * 同一领域并发触发会被丢弃（progressStore 检测 phase != done/error）。
   */
  startSync(domain: string): string {
    if (!isValidCapLibDomain(domain)) throw new Error(`非法领域名: ${domain}`);
    // 防并发：本领域已有 running job 直接复用其 jobId
    for (const [jid, p] of progressStore) {
      if (p.domain === domain && p.phase !== 'done' && p.phase !== 'error') return jid;
    }
    const jobId = `cap-lib-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setProgress(jobId, { phase: 'pending', domain, current: 0, total: 0 });
    pruneProgressStore();

    // fire-and-forget；内部错误存到 progressStore 而非抛出
    void this.runSync(jobId, domain).catch(err => {
      setProgress(jobId, {
        phase: 'error', domain, current: 0, total: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    return jobId;
  }

  private async runSync(jobId: string, domain: string): Promise<void> {
    const startedAt = Date.now();
    setProgress(jobId, { phase: 'fetching', domain, current: 0, total: 0 });

    // 1) 远端拉
    const url = `${REMOTE_BASE}?pageNum=1&pageSize=${REMOTE_PAGE_SIZE}&domain=${encodeURIComponent(domain)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) throw new Error(`远端 HTTP ${resp.status}`);
    const data = await resp.json() as RemoteListResp;
    if (data.code !== 200) throw new Error(`远端返回 code=${data.code} msg=${data.msg}`);
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const total = rows.length;

    // 2) 解析 + 入库
    setProgress(jobId, { phase: 'upserting', domain, current: 0, total });
    const now = new Date().toISOString();
    const stats: SyncStats = { added: 0, changed: 0, unchanged: 0, removedSoft: 0, durationMs: 0 };

    // 入库前先记录该领域之前的 source_id 集合，本次未出现的算 removedSoft
    const prevIds = new Set<number>(
      (this.db.prepare('SELECT source_id FROM cma_capability_lib WHERE domain = ?')
        .all(domain) as Array<{ source_id: number }>).map(r => r.source_id),
    );
    const seenIds = new Set<number>();

    const selStmt = this.db.prepare('SELECT row_hash FROM cma_capability_lib WHERE source_id = ?');
    const insStmt = this.db.prepare(`
      INSERT INTO cma_capability_lib
        (source_id, domain, standard_method, std_code, std_code_norm, std_code_base,
         remark, lib_status, raw_status, row_hash, last_seen_at, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        domain          = excluded.domain,
        standard_method = excluded.standard_method,
        std_code        = excluded.std_code,
        std_code_norm   = excluded.std_code_norm,
        std_code_base   = excluded.std_code_base,
        remark          = excluded.remark,
        lib_status      = excluded.lib_status,
        raw_status      = excluded.raw_status,
        row_hash        = excluded.row_hash,
        last_seen_at    = excluded.last_seen_at
    `);
    const touchStmt = this.db.prepare(
      'UPDATE cma_capability_lib SET last_seen_at = ? WHERE source_id = ?',
    );

    const tx = this.db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (typeof r.id !== 'number') continue;
        const sourceId = r.id;
        seenIds.add(sourceId);

        const rawCode = r.standardCode || '';
        const stdCode = cleanStdCode(rawCode);
        const stdCodeNorm = extractFullCode(stdCode);
        const stdCodeBase = extractBaseCode(stdCode);
        const remark = r.remark || '';
        const libStatus = parseLibStatus(remark);
        const rawStatus = r.status || '';
        const standardMethod = r.standardMethod || '';
        const rowHash = hashRow(domain, standardMethod, stdCode, remark, libStatus, rawStatus);

        const existing = selStmt.get(sourceId) as { row_hash: string } | undefined;
        if (existing && existing.row_hash === rowHash) {
          touchStmt.run(now, sourceId);
          stats.unchanged++;
        } else {
          insStmt.run(
            sourceId, domain, standardMethod, stdCode, stdCodeNorm, stdCodeBase,
            remark, libStatus, rawStatus, rowHash, now, now,
          );
          if (existing) stats.changed++; else stats.added++;
        }
        // 千行一报进度
        if ((i + 1) % 1000 === 0 || i + 1 === rows.length) {
          setProgress(jobId, { phase: 'upserting', domain, current: i + 1, total });
        }
      }
    });
    tx();

    // soft delete 统计：之前有、本次没出现 = removedSoft
    for (const id of prevIds) if (!seenIds.has(id)) stats.removedSoft++;

    stats.durationMs = Date.now() - startedAt;

    // 写回 meta + 全局 last sync
    const localTotal = (this.db.prepare(
      'SELECT COUNT(*) AS c FROM cma_capability_lib WHERE domain = ?',
    ).get(domain) as { c: number }).c;
    this.db.prepare(`
      UPDATE cma_capability_lib_meta
      SET subscribed = 1, last_synced_at = ?, remote_total = ?, local_total = ?, last_sync_stats = ?
      WHERE domain = ?
    `).run(now, total, localTotal, JSON.stringify(stats), domain);
    setSetting(this.db, 'cma_lib_last_synced_at', now);

    setProgress(jobId, { phase: 'done', domain, current: total, total, stats });
  }

  /** 清理 30 天未见的孤儿行（admin 触发）。返回删除条数。 */
  cleanupStaleRows(daysThreshold = 30): number {
    const cutoff = new Date(Date.now() - daysThreshold * 86400_000).toISOString();
    const result = this.db.prepare(
      'DELETE FROM cma_capability_lib WHERE last_seen_at != "" AND last_seen_at < ?',
    ).run(cutoff);
    // 同步重算各领域 local_total
    this.db.prepare(`
      UPDATE cma_capability_lib_meta
      SET local_total = (
        SELECT COUNT(*) FROM cma_capability_lib WHERE domain = cma_capability_lib_meta.domain
      )
    `).run();
    return result.changes ?? 0;
  }

  // ── 比对 ──

  /**
   * 给前端搜索结果 / 资质查询页徽章用的轻量批量查询。
   *
   * 算法：把每个输入 stdCode 算成 fullCode + baseCode，分别在 cma_capability_lib 走
   * std_code_norm 等值（保年命中）和 std_code_base 等值（剥年兜底）两路索引。
   *
   * 返回 4 档（合并 cite_only / abolished 为前端简化 ⚠ 状态，详见 cap-lib-status.ts）。
   */
  batchStatus(stdCodes: string[]): Record<string, CapLibBadgeStatus> {
    const result: Record<string, CapLibBadgeStatus> = {};
    if (stdCodes.length === 0) return result;

    // 任何领域是否已同步过 —— 全空则徽章全标 stale
    const anySynced = (this.db.prepare(
      'SELECT COUNT(*) AS c FROM cma_capability_lib_meta WHERE last_synced_at != ""',
    ).get() as { c: number }).c > 0;

    // 输入归一化
    type Key = { input: string; full: string; base: string };
    const keys: Key[] = [];
    const fullSet = new Set<string>();
    const baseSet = new Set<string>();
    for (const c of stdCodes) {
      const full = extractFullCode(c);
      const base = extractBaseCode(c);
      keys.push({ input: c, full, base });
      if (full) fullSet.add(full);
      if (base) baseSet.add(base);
    }
    const fulls = [...fullSet];
    const bases = [...baseSet];

    // 保年命中：std_code_norm IN (...)
    const exactMap = new Map<string, { libStatus: LibStatus; remark: string; domain: string }>();
    if (fulls.length > 0) {
      const ph = fulls.map(() => '?').join(',');
      const rows = this.db.prepare(`
        SELECT std_code_norm, lib_status, remark, domain
        FROM cma_capability_lib
        WHERE std_code_norm IN (${ph})
      `).all(...fulls) as Array<{
        std_code_norm: string; lib_status: LibStatus; remark: string; domain: string;
      }>;
      for (const r of rows) {
        // 同一 std_code_norm 可能在多个领域出现：active > cite_only > abolished 优先级
        const prev = exactMap.get(r.std_code_norm);
        if (!prev || priority(r.lib_status) > priority(prev.libStatus)) {
          exactMap.set(r.std_code_norm, { libStatus: r.lib_status, remark: r.remark || '', domain: r.domain });
        }
      }
    }

    // 剥年命中（只看 active 的最新年版）
    const seriesMap = new Map<string, { stdCode: string; domain: string }>();
    if (bases.length > 0) {
      const ph = bases.map(() => '?').join(',');
      const rows = this.db.prepare(`
        SELECT std_code_base, std_code, std_code_norm, domain
        FROM cma_capability_lib
        WHERE std_code_base IN (${ph}) AND lib_status = 'active'
        ORDER BY std_code_norm DESC
      `).all(...bases) as Array<{
        std_code_base: string; std_code: string; std_code_norm: string; domain: string;
      }>;
      for (const r of rows) {
        if (!seriesMap.has(r.std_code_base)) {
          seriesMap.set(r.std_code_base, { stdCode: r.std_code, domain: r.domain });
        }
      }
    }

    for (const k of keys) {
      const exact = k.full ? exactMap.get(k.full) : undefined;
      const series = k.base ? seriesMap.get(k.base) : undefined;
      let status: DiffStatus;
      if (exact) {
        status = exact.libStatus === 'active'    ? 'in_lib'
              : exact.libStatus === 'cite_only'  ? 'cite_only'
              : 'abolished';
      } else if (series && series.stdCode && extractFullCode(series.stdCode) !== k.full) {
        status = 'series_only';
      } else {
        status = 'not_in_lib';
      }
      result[k.input] = {
        status,
        inLib: status === 'in_lib' || status === 'cite_only' || status === 'abolished',
        libDomain: exact?.domain || '',
        libStatus: exact?.libStatus || '',
        libRemark: exact?.remark || '',
        seriesNewCode: status === 'series_only' ? (series?.stdCode || '') : '',
        stale: !anySynced || (status === 'not_in_lib' && !this.isDomainKnownToBeFull(exact?.domain)),
      };
    }
    return result;
  }

  /** 是否至少同步过一个领域（用于 stale 判定的兜底） */
  private isDomainKnownToBeFull(_domain?: string): boolean {
    // 简化版：只要任何领域同步过，未命中即视作真实 not_in_lib（false → stale）；
    // 否则 batchStatus 顶部 anySynced 判定已覆盖全空场景，此处保持快速返回 true。
    return true;
  }

  /**
   * 单订阅机构的 diff 行表（cma-diff 详情页用）。
   */
  diffByLab(certNumber: string): DiffRow[] {
    const rows = this.db.prepare(`
      SELECT
        q.id, q.std_code, q.std_code_norm, q.std_code_base,
        q.std_name, q.category, q.test_item,
        (SELECT lib_status FROM cma_capability_lib
           WHERE std_code_norm = q.std_code_norm AND q.std_code_norm <> '' LIMIT 1) AS exact_status,
        (SELECT remark FROM cma_capability_lib
           WHERE std_code_norm = q.std_code_norm AND q.std_code_norm <> '' LIMIT 1) AS exact_remark,
        (SELECT domain FROM cma_capability_lib
           WHERE std_code_norm = q.std_code_norm AND q.std_code_norm <> '' LIMIT 1) AS exact_domain,
        (SELECT std_code FROM cma_capability_lib
           WHERE std_code_base = q.std_code_base
             AND q.std_code_base <> ''
             AND std_code_norm <> q.std_code_norm
             AND lib_status = 'active'
           ORDER BY std_code_norm DESC LIMIT 1) AS series_new_code,
        (SELECT domain FROM cma_capability_lib
           WHERE std_code_base = q.std_code_base
             AND q.std_code_base <> ''
             AND std_code_norm <> q.std_code_norm
             AND lib_status = 'active'
           ORDER BY std_code_norm DESC LIMIT 1) AS series_domain
      FROM cma_qualifications q
      WHERE q.cert_number = ?
      ORDER BY q.std_code
    `).all(certNumber) as Array<{
      id: number; std_code: string; std_name: string; category: string; test_item: string;
      exact_status: LibStatus | null; exact_remark: string | null; exact_domain: string | null;
      series_new_code: string | null; series_domain: string | null;
    }>;

    const result: DiffRow[] = [];
    for (const r of rows) {
      let diffStatus: DiffStatus;
      if (r.exact_status === 'active')         diffStatus = 'in_lib';
      else if (r.exact_status === 'cite_only') diffStatus = 'cite_only';
      else if (r.exact_status === 'abolished') diffStatus = 'abolished';
      else if (r.series_new_code)              diffStatus = 'series_only';
      else                                     diffStatus = 'not_in_lib';

      result.push({
        qualId: r.id,
        stdCode: r.std_code,
        stdName: r.std_name,
        category: r.category,
        testItem: r.test_item,
        diffStatus,
        libStatus: r.exact_status || '',
        libRemark: r.exact_remark || '',
        libDomain: r.exact_domain || '',
        seriesNewCode: r.series_new_code || '',
        seriesDomain: r.series_domain || '',
      });
    }
    return result;
  }

  /**
   * 订阅机构整体汇总（cma-diff 顶部统计卡）。
   */
  summary(): DiffSummary {
    const labs = this.db.prepare(`
      SELECT cert_number FROM cma_labs WHERE subscribed_at IS NOT NULL
    `).all() as Array<{ cert_number: string }>;

    const byStatus: Record<DiffStatus, number> = {
      in_lib: 0, cite_only: 0, abolished: 0, series_only: 0, not_in_lib: 0,
    };
    let totalQuals = 0;
    for (const lab of labs) {
      const rows = this.diffByLab(lab.cert_number);
      for (const r of rows) {
        byStatus[r.diffStatus]++;
        totalQuals++;
      }
    }
    const unsyncedDomains = (this.db.prepare(`
      SELECT domain FROM cma_capability_lib_meta WHERE subscribed = 1 AND last_synced_at = ''
    `).all() as Array<{ domain: string }>).map(r => r.domain);

    return { labCount: labs.length, totalQuals, byStatus, unsyncedDomains };
  }

  /** 订阅机构维度计数（cma-diff 机构列表） */
  labsCounts(): Array<{ certNumber: string; labName: string; total: number; byStatus: Record<DiffStatus, number> }> {
    const labs = this.db.prepare(`
      SELECT cert_number, lab_name FROM cma_labs WHERE subscribed_at IS NOT NULL ORDER BY lab_name
    `).all() as Array<{ cert_number: string; lab_name: string }>;
    return labs.map(lab => {
      const rows = this.diffByLab(lab.cert_number);
      const byStatus: Record<DiffStatus, number> = {
        in_lib: 0, cite_only: 0, abolished: 0, series_only: 0, not_in_lib: 0,
      };
      for (const r of rows) byStatus[r.diffStatus]++;
      return {
        certNumber: lab.cert_number,
        labName: lab.lab_name || lab.cert_number,
        total: rows.length,
        byStatus,
      };
    });
  }
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────

function hashRow(domain: string, method: string, stdCode: string, remark: string, status: LibStatus, raw: string): string {
  const h = crypto.createHash('sha1');
  h.update(domain); h.update('|');
  h.update(method); h.update('|');
  h.update(stdCode); h.update('|');
  h.update(remark); h.update('|');
  h.update(status); h.update('|');
  h.update(raw);
  return h.digest('hex');
}

function priority(s: LibStatus): number {
  return s === 'active' ? 3 : s === 'cite_only' ? 2 : 1;
}

// re-export 给路由用
export { CAP_LIB_DOMAIN_NAMES, isValidCapLibDomain };
