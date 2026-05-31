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
}

// 状态归一：各源文案不同，按"是否含废止/作废"判断更稳，别死比字符串。
function isAbolished(status: string | null | undefined): boolean {
  if (!status) return false;
  return /废止|废除|作废|已经废止|即将废止/.test(status);
}

export class CheckService {
  private resolver: StandardResolver;
  constructor(private readonly db: Database.Database, registry: SourceRegistry) {
    this.resolver = new StandardResolver(registry);
  }

  // 创建清单并导入标准号（首查存基线）。sources 默认三源（labr 不参与查新元数据）。
  async createWatchlist(
    userId: number,
    name: string,
    lines: string[],
    sources: SourceName[] = ['bz', 'gbw', 'by'],
  ): Promise<{ id: number; itemCount: number }> {
    const info = this.db
      .prepare('INSERT INTO check_watchlists (user_id, name) VALUES (?, ?)')
      .run(userId, name || '未命名清单');
    const watchlistId = Number(info.lastInsertRowid);

    const result = await this.resolver.resolve(lines, sources);
    const byInput = new Map(result.resolved.map((r) => [r.input, r]));

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
    const dedup = [...new Set(lines.map((l) => l.trim()).filter(Boolean))];
    txn(dedup);
    this.db.prepare('UPDATE check_watchlists SET last_checked_at = ? WHERE id = ?').run(now, watchlistId);

    const itemCount = (this.db.prepare('SELECT COUNT(*) c FROM check_items WHERE watchlist_id = ?').get(watchlistId) as { c: number }).c;
    return { id: watchlistId, itemCount };
  }

  // 重新查新：逐项再查 + 与基线 diff，更新 last_* 与 change_flags。
  async recheck(watchlistId: number, sources: SourceName[] = ['bz', 'gbw', 'by']): Promise<void> {
    const items = this.db
      .prepare('SELECT id, std_code FROM check_items WHERE watchlist_id = ?')
      .all(watchlistId) as Array<{ id: number; std_code: string }>;
    if (!items.length) return;

    const result = await this.resolver.resolve(items.map((i) => i.std_code), sources);
    const byInput = new Map(result.resolved.map((r) => [r.input, r]));

    const now = new Date().toISOString();
    const update = this.db.prepare(`
      UPDATE check_items
      SET last_status = ?, last_title = ?, last_impl_date = ?, last_replaced_by = ?,
          last_checked_at = ?, change_flags = ?, source_used = ?
      WHERE id = ?
    `);
    const txn = this.db.transaction(() => {
      for (const it of items) {
        const base = this.db.prepare(
          'SELECT base_status, base_title, base_impl_date, base_replaced_by FROM check_items WHERE id = ?',
        ).get(it.id) as { base_status: string | null; base_title: string | null; base_impl_date: string | null; base_replaced_by: string | null };
        const fresh = byInput.get(it.std_code) ?? byInput.get(cleanStdCode(it.std_code));
        const sourceUsed = fresh ? fresh.source : 'not_found';
        const flags = fresh ? this.diff(base, fresh, result.resolved) : [];
        update.run(
          fresh?.status ?? null, fresh?.title ?? null, fresh?.implementDate ?? null, fresh?.replacedStd ?? null,
          now, JSON.stringify(flags), sourceUsed, it.id,
        );
      }
    });
    txn();
    this.db.prepare('UPDATE check_watchlists SET last_checked_at = ? WHERE id = ?').run(now, watchlistId);
  }

  // 逐字段 diff，产出变动标记。
  private diff(
    base: { base_status: string | null; base_impl_date: string | null; base_replaced_by: string | null },
    fresh: ResolvedItem,
    allFresh: ResolvedItem[],
  ): ChangeFlag[] {
    const flags: ChangeFlag[] = [];
    // 状态：按"是否废止"归一比，跨过文案差异
    if (isAbolished(base.base_status) !== isAbolished(fresh.status)) flags.push('status');
    // 实施日期
    if ((base.base_impl_date ?? '') !== (fresh.implementDate ?? '')) flags.push('implDate');
    // 被代替关系（仅 BZ 可靠；为空不算变化）
    if ((base.base_replaced_by ?? '') !== (fresh.replacedStd ?? '') && (fresh.replacedStd ?? '')) flags.push('replacedBy');
    // 新版本：同基础号（剥年份）出现更高年版
    const baseCode = extractBaseCode(fresh.standardNumber);
    const freshYear = yearOf(fresh.standardNumber);
    const newer = allFresh.some((r) => extractBaseCode(r.standardNumber) === baseCode && yearOf(r.standardNumber) > freshYear);
    if (newer) flags.push('newVersion');
    return flags;
  }

  getWatchlists(userId: number) {
    return this.db.prepare(`
      SELECT w.id, w.name, w.created_at, w.last_checked_at,
             (SELECT COUNT(*) FROM check_items i WHERE i.watchlist_id = w.id) AS item_count,
             (SELECT COUNT(*) FROM check_items i WHERE i.watchlist_id = w.id AND i.change_flags != '[]') AS changed_count
      FROM check_watchlists w
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `).all(userId);
  }

  // 单清单明细（含每项的基线/最新/变动标记），按"有变动优先"排序留给前端分组。
  getItems(watchlistId: number): CheckItemRow[] {
    const rows = this.db.prepare(`
      SELECT id, watchlist_id, std_code, base_status, base_title, base_impl_date, base_replaced_by,
             last_status, last_title, last_impl_date, last_replaced_by, last_checked_at,
             change_flags, source_used
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
