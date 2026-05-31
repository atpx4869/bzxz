import type Database from 'better-sqlite3';
import type { SourceName } from '../domain/standard';
import type { SourceRegistry } from './source-registry';
import { StandardResolver, type ResolvedItem } from './standard-resolver';
import { cleanStdCode, extractFullCode, extractBaseCode } from '../shared/std-code';

/**
 * 标准查新（见 docs/CHECK-UPDATE-AND-STATS.md）。
 *
 * 流程：导入标准号 → 逐个走 StandardResolver 查三源 → 存"基线快照"；
 * 查新（recheck）= 再查一遍 + 与基线 diff，产出 change_flags。
 *
 * 复用 StandardResolver（已含并发限流 + 同基础号匹配 + status/implementDate）。
 */

// ── 限流硬上限（用户改不了，见 docs/CHECK-UPDATE-AND-STATS.md）──
const MAX_ITEMS = 200;            // 单清单最多标准数（导入超出截断）
const BATCH_SIZE = 50;            // 每批查询量
const BATCH_GAP_MS = 2000;        // 批间隔，给 BZ 喘息
const MANUAL_DEBOUNCE_MS = 20 * 60 * 1000; // 手动「重新查新」同清单防抖 20 分钟
const MIN_AUTO_INTERVAL_DAYS = 15;         // 自动查新周期硬下限（也是默认值）
// 注：实际出站并发由 BZ source-semaphore(=2) 收口；这里分批 + 批间隔再加一层保险。

export class CheckDebounceError extends Error {
  constructor(public retryAfterMin: number) {
    super(`距上次查新不足 20 分钟，请 ${retryAfterMin} 分钟后再试`);
    this.name = 'CheckDebounceError';
  }
}

export type ChangeFlag = 'status' | 'newVersion' | 'implDate' | 'replacedBy';

export interface CheckItemRow {
  id: number;
  watchlistId: number;
  stdCode: string;
  baseStatus: string | null;
  baseTitle: string | null;
  baseImplDate: string | null;
  baseReplacedBy: string | null;
  lastStatus: string | null;
  lastTitle: string | null;
  lastImplDate: string | null;
  lastReplacedBy: string | null;
  lastCheckedAt: string | null;
  changeFlags: ChangeFlag[];
  sourceUsed: string | null;
  newVersion: string | null;
}

export class CheckService {
  private resolver: StandardResolver;
  // 全局串行锁：同一时刻只允许一个清单在查（防多清单/多用户并发打爆 BZ）。
  private static querying = false;

  constructor(private readonly db: Database.Database, registry: SourceRegistry) {
    this.resolver = new StandardResolver(registry);
  }

  private static sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

  // 分批 resolve：每批 BATCH_SIZE 个，批间 sleep。实际出站并发由 BZ semaphore 收口。
  private async resolveBatched(lines: string[], sources: SourceName[]): Promise<ResolvedItem[]> {
    const out: ResolvedItem[] = [];
    for (let i = 0; i < lines.length; i += BATCH_SIZE) {
      const chunk = lines.slice(i, i + BATCH_SIZE);
      const r = await this.resolver.resolve(chunk, sources);
      out.push(...r.resolved);
      if (i + BATCH_SIZE < lines.length) await CheckService.sleep(BATCH_GAP_MS);
    }
    return out;
  }

  // 创建清单并导入标准号（首查存基线）。单源 BZ；超 MAX_ITEMS 截断。
  async createWatchlist(
    userId: number,
    name: string,
    lines: string[],
    sources: SourceName[] = ['bz'],
  ): Promise<{ id: number; itemCount: number; truncated: boolean }> {
    const dedupAll = [...new Set(lines.map((l) => l.trim()).filter(Boolean))];
    const truncated = dedupAll.length > MAX_ITEMS;
    const dedup = dedupAll.slice(0, MAX_ITEMS);

    const info = this.db
      .prepare('INSERT INTO check_watchlists (user_id, name) VALUES (?, ?)')
      .run(userId, name || '未命名清单');
    const watchlistId = Number(info.lastInsertRowid);

    if (CheckService.querying) {
      // 已有清单在查：本次只建清单 + 存号、不立即查（基线留空，用户稍后手动查新）
      this.insertItemsNoBaseline(watchlistId, dedup);
      return { id: watchlistId, itemCount: dedup.length, truncated };
    }
    CheckService.querying = true;
    let resolved: ResolvedItem[];
    try {
      resolved = await this.resolveBatched(dedup, sources);
    } finally {
      CheckService.querying = false;
    }
    const byInput = new Map(resolved.map((r) => [r.input, r]));

    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO check_items
        (watchlist_id, std_code, std_code_norm, base_status, base_title, base_impl_date,
         base_replaced_by, base_snapshot_at, last_status, last_title, last_impl_date,
         last_replaced_by, last_checked_at, change_flags, source_used)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?)
    `);
    const txn = this.db.transaction((rawLines: string[]) => {
      for (const raw of rawLines) {
        const code = cleanStdCode(raw);
        if (!code) continue;
        const m: ResolvedItem | undefined = byInput.get(raw) ?? byInput.get(code);
        const sourceUsed = m ? m.source : 'not_found';
        insert.run(
          watchlistId, code, extractFullCode(code),
          m?.status ?? null, m?.title ?? null, m?.implementDate ?? null, m?.replacedStd ?? null, now,
          m?.status ?? null, m?.title ?? null, m?.implementDate ?? null, m?.replacedStd ?? null, now,
          sourceUsed,
        );
      }
    });
    txn(dedup);
    this.db.prepare('UPDATE check_watchlists SET last_checked_at = ? WHERE id = ?').run(now, watchlistId);

    const itemCount = (this.db.prepare('SELECT COUNT(*) c FROM check_items WHERE watchlist_id = ?').get(watchlistId) as { c: number }).c;
    return { id: watchlistId, itemCount, truncated };
  }

  // 已有清单在查时的兜底：只存标准号、不查基线（base_* 留空，change_flags='[]'，source_used='pending'）。
  private insertItemsNoBaseline(watchlistId: number, dedup: string[]): void {
    const insert = this.db.prepare(`
      INSERT INTO check_items
        (watchlist_id, std_code, std_code_norm, base_snapshot_at, change_flags, source_used)
      VALUES (?, ?, ?, NULL, '[]', 'pending')
    `);
    const txn = this.db.transaction((rawLines: string[]) => {
      for (const raw of rawLines) {
        const code = cleanStdCode(raw);
        if (code) insert.run(watchlistId, code, extractFullCode(code));
      }
    });
    txn(dedup);
  }

  // 重新查新：逐项再查 + 与基线 diff，更新 last_* 与 change_flags。
  // manual=true（用户点按钮）走 20 分钟防抖；自动查新传 manual=false 跳过防抖。
  async recheck(watchlistId: number, sources: SourceName[] = ['bz'], manual = true): Promise<void> {
    // 手动防抖：同清单 20 分钟内拒绝重复
    if (manual) {
      const row = this.db.prepare('SELECT last_checked_at FROM check_watchlists WHERE id = ?').get(watchlistId) as { last_checked_at: string | null } | undefined;
      if (row?.last_checked_at) {
        const elapsed = Date.now() - new Date(row.last_checked_at).getTime();
        if (elapsed < MANUAL_DEBOUNCE_MS) {
          throw new CheckDebounceError(Math.ceil((MANUAL_DEBOUNCE_MS - elapsed) / 60000));
        }
      }
    }
    // 全局串行：已有清单在查则拒绝（避免叠加打 BZ）
    if (CheckService.querying) throw new Error('已有查新任务进行中，请稍后再试');

    const items = this.db
      .prepare('SELECT id, std_code FROM check_items WHERE watchlist_id = ?')
      .all(watchlistId) as Array<{ id: number; std_code: string }>;
    if (!items.length) return;

    CheckService.querying = true;
    let resolvedArr: ResolvedItem[];
    try {
      resolvedArr = await this.resolveBatched(items.map((i) => i.std_code), sources);
    } finally {
      CheckService.querying = false;
    }
    const result = { resolved: resolvedArr };
    const byInput = new Map(result.resolved.map((r) => [r.input, r]));

    const now = new Date().toISOString();
    const update = this.db.prepare(`
      UPDATE check_items
      SET last_status = ?, last_title = ?, last_impl_date = ?, last_replaced_by = ?,
          last_checked_at = ?, change_flags = ?, source_used = ?, new_version = ?
      WHERE id = ?
    `);
    const txn = this.db.transaction(() => {
      for (const it of items) {
        const base = this.db.prepare(
          'SELECT base_status, base_title, base_impl_date, base_replaced_by FROM check_items WHERE id = ?',
        ).get(it.id) as { base_status: string | null; base_title: string | null; base_impl_date: string | null; base_replaced_by: string | null };
        const fresh = byInput.get(it.std_code) ?? byInput.get(cleanStdCode(it.std_code));
        const sourceUsed = fresh ? fresh.source : 'not_found';
        const d = fresh ? this.diff(base, fresh, result.resolved) : { flags: [] as ChangeFlag[], newVersion: null };
        update.run(
          fresh?.status ?? null, fresh?.title ?? null, fresh?.implementDate ?? null, fresh?.replacedStd ?? null,
          now, JSON.stringify(d.flags), sourceUsed, d.newVersion, it.id,
        );
      }
    });
    txn();
    this.db.prepare('UPDATE check_watchlists SET last_checked_at = ? WHERE id = ?').run(now, watchlistId);
  }

  // 逐字段 diff，产出变动标记 + 检出的具体新版本号（供 UI 展示 "GB/T 1.1-2020"）。
  private diff(
    base: { base_status: string | null; base_impl_date: string | null; base_replaced_by: string | null },
    fresh: ResolvedItem,
    allFresh: ResolvedItem[],
  ): { flags: ChangeFlag[]; newVersion: string | null } {
    const flags: ChangeFlag[] = [];
    // 状态：精确文案比对（现行有效→即将废止 逐级预警）
    if ((base.base_status ?? '') !== (fresh.status ?? '')) flags.push('status');
    // 实施日期
    if ((base.base_impl_date ?? '') !== (fresh.implementDate ?? '')) flags.push('implDate');
    // 被代替关系（BZ 的 replacedStd；为空不算变化）
    if ((base.base_replaced_by ?? '') !== (fresh.replacedStd ?? '') && (fresh.replacedStd ?? '')) flags.push('replacedBy');
    // 新版本：同基础号（剥年份）出现更高年版 → 记下具体版本号
    const baseCode = extractBaseCode(fresh.standardNumber);
    const freshYear = yearOf(fresh.standardNumber);
    let newVersion: string | null = null;
    for (const r of allFresh) {
      if (extractBaseCode(r.standardNumber) === baseCode && yearOf(r.standardNumber) > freshYear) {
        if (!newVersion || yearOf(r.standardNumber) > yearOf(newVersion)) newVersion = r.standardNumber;
      }
    }
    if (newVersion) flags.push('newVersion');
    return { flags, newVersion };
  }

  getWatchlists(userId: number) {
    return this.db.prepare(`
      SELECT w.id, w.name, w.created_at, w.last_checked_at,
             w.auto_enabled, w.auto_interval_days, w.next_run_at,
             (SELECT COUNT(*) FROM check_items i WHERE i.watchlist_id = w.id) AS item_count,
             (SELECT COUNT(*) FROM check_items i WHERE i.watchlist_id = w.id AND i.change_flags != '[]') AS changed_count
      FROM check_watchlists w
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `).all(userId);
  }

  // 设置自动查新：enabled + 周期天数（硬下限 15）。开启时算出 next_run_at。
  setAuto(watchlistId: number, enabled: boolean, intervalDays: number): void {
    const days = Math.max(MIN_AUTO_INTERVAL_DAYS, Math.floor(intervalDays) || MIN_AUTO_INTERVAL_DAYS);
    const next = enabled ? new Date(Date.now() + days * 864e5).toISOString() : null;
    this.db.prepare(
      'UPDATE check_watchlists SET auto_enabled = ?, auto_interval_days = ?, next_run_at = ? WHERE id = ?',
    ).run(enabled ? 1 : 0, days, next, watchlistId);
  }

  // 跑所有到期的自动查新（启动时 + 定时器调用）。串行执行，每个查完重排下次时间。
  // 返回有变动的清单摘要，供调用方写运行日志 / 通知。
  async runDueAutoChecks(): Promise<Array<{ id: number; name: string; changedCount: number }>> {
    const due = this.db.prepare(`
      SELECT id, name, auto_interval_days FROM check_watchlists
      WHERE auto_enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)
      ORDER BY next_run_at
    `).all(new Date().toISOString()) as Array<{ id: number; name: string; auto_interval_days: number }>;
    const out: Array<{ id: number; name: string; changedCount: number }> = [];
    for (const w of due) {
      try {
        await this.recheck(w.id, ['bz'], false); // 自动：跳过手动防抖
        const changed = (this.db.prepare(
          "SELECT COUNT(*) c FROM check_items WHERE watchlist_id = ? AND change_flags != '[]'",
        ).get(w.id) as { c: number }).c;
        if (changed > 0) out.push({ id: w.id, name: w.name, changedCount: changed });
      } catch (e) {
        // 单个清单失败不阻断其它（如串行锁占用）；下一轮再补
        console.warn(`[check-auto] watchlist ${w.id} 自动查新失败:`, e instanceof Error ? e.message : String(e));
      } finally {
        const days = Math.max(MIN_AUTO_INTERVAL_DAYS, w.auto_interval_days || MIN_AUTO_INTERVAL_DAYS);
        this.db.prepare('UPDATE check_watchlists SET next_run_at = ? WHERE id = ?')
          .run(new Date(Date.now() + days * 864e5).toISOString(), w.id);
      }
    }
    return out;
  }

  // 单清单明细（含每项的基线/最新/变动标记），按"有变动优先"排序留给前端分组。
  getItems(watchlistId: number): CheckItemRow[] {
    const rows = this.db.prepare(`
      SELECT id, watchlist_id, std_code, base_status, base_title, base_impl_date, base_replaced_by,
             last_status, last_title, last_impl_date, last_replaced_by, last_checked_at,
             change_flags, source_used, new_version
      FROM check_items WHERE watchlist_id = ? ORDER BY id
    `).all(watchlistId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: r.id as number,
      watchlistId: r.watchlist_id as number,
      stdCode: r.std_code as string,
      baseStatus: (r.base_status as string) ?? null,
      baseTitle: (r.base_title as string) ?? null,
      baseImplDate: (r.base_impl_date as string) ?? null,
      baseReplacedBy: (r.base_replaced_by as string) ?? null,
      lastStatus: (r.last_status as string) ?? null,
      lastTitle: (r.last_title as string) ?? null,
      lastImplDate: (r.last_impl_date as string) ?? null,
      lastReplacedBy: (r.last_replaced_by as string) ?? null,
      lastCheckedAt: (r.last_checked_at as string) ?? null,
      changeFlags: safeFlags(r.change_flags as string),
      sourceUsed: (r.source_used as string) ?? null,
      newVersion: (r.new_version as string) ?? null,
    }));
  }

  // 删除清单（含明细）。调用方需校验 user_id 归属。
  deleteWatchlist(watchlistId: number): void {
    const txn = this.db.transaction(() => {
      this.db.prepare('DELETE FROM check_items WHERE watchlist_id = ?').run(watchlistId);
      this.db.prepare('DELETE FROM check_watchlists WHERE id = ?').run(watchlistId);
    });
    txn();
  }

  ownerOf(watchlistId: number): number | null {
    const row = this.db.prepare('SELECT user_id FROM check_watchlists WHERE id = ?').get(watchlistId) as { user_id: number } | undefined;
    return row ? row.user_id : null;
  }
}

function yearOf(stdNumber: string): number {
  const m = stdNumber.match(/(\d{4})\s*$/);
  return m ? parseInt(m[1], 10) : 0;
}
function safeFlags(s: string | null): ChangeFlag[] {
  if (!s) return [];
  try { const a = JSON.parse(s); return Array.isArray(a) ? a : []; } catch { return []; }
}
