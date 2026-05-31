import { Router } from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import { respond, respondError } from '../shared/response';
import { toCamelCase } from '../shared/case';

export function createStatsRoutes(db: Database.Database, requireAuth: (req: Request, res: Response, next: NextFunction) => void) {
  const router = Router();
  router.use(requireAuth);

  const querySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    userId: z.string().optional(),
    eventType: z.string().optional(),
    source: z.string().optional(),
    result: z.enum(['success', 'fail']).optional(),
    client: z.string().optional(),
  });

  function buildWhere(userId: number, isAdmin: boolean, params: z.infer<typeof querySchema>) {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.from) { conditions.push('e.created_at >= ?'); values.push(params.from); }
    if (params.to) { conditions.push('e.created_at <= ?'); values.push(params.to); }
    if (params.eventType) { conditions.push('e.event_type = ?'); values.push(params.eventType); }
    if (params.source) { conditions.push('e.source = ?'); values.push(params.source); }
    if (params.result) { conditions.push('e.result = ?'); values.push(params.result); }
    if (params.client) { conditions.push('e.client = ?'); values.push(params.client); }

    // Non-admin can only see own data
    if (!isAdmin) {
      conditions.push('e.user_id = ?');
      values.push(userId);
    } else if (params.userId) {
      const uid = parseInt(params.userId, 10);
      if (Number.isNaN(uid)) return { where: 'WHERE 0', values: [] };
      conditions.push('e.user_id = ?');
      values.push(uid);
    }

    return { where: conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '', values };
  }

  // GET /api/stats/summary
  router.get('/summary', (req, res) => {
    const params = querySchema.parse(req.query);
    const isAdmin = req.user!.role === 'admin';
    const { where, values } = buildWhere(req.user!.id, isAdmin, params);

    const byType = db.prepare(`SELECT event_type, COUNT(*) as count FROM usage_events e ${where} GROUP BY event_type`).all(...values) as { event_type: string; count: number }[];
    const total = byType.reduce((s, r) => s + r.count, 0);
    const uniqueUsers = (db.prepare(`SELECT COUNT(DISTINCT user_id) as cnt FROM usage_events e ${where}`).get(...values) as { cnt: number }).cnt;
    const failCount = (db.prepare(`SELECT COUNT(*) as cnt FROM usage_events e ${where}${where ? ' AND' : ' WHERE'} e.result = 'fail'`).get(...values) as { cnt: number }).cnt;

    respond(res, { total, byType: toCamelCase(byType), uniqueUsers, failCount });
  });

  // GET /api/stats/timeseries
  router.get('/timeseries', (req, res) => {
    const params = querySchema.parse(req.query);
    const isAdmin = req.user!.role === 'admin';
    const { where, values } = buildWhere(req.user!.id, isAdmin, params);

    const rows = db.prepare(`
      SELECT DATE(e.created_at) as date, event_type, COUNT(*) as count
      FROM usage_events e ${where}
      GROUP BY DATE(e.created_at), event_type
      ORDER BY date
    `).all(...values) as { date: string; event_type: string; count: number }[];

    respond(res, { items: toCamelCase(rows) });
  });

  // GET /api/stats/by-source
  router.get('/by-source', (req, res) => {
    const params = querySchema.parse(req.query);
    const isAdmin = req.user!.role === 'admin';
    const { where, values } = buildWhere(req.user!.id, isAdmin, params);

    const rows = db.prepare(`
      SELECT source, COUNT(*) as count
      FROM usage_events e ${where} ${where ? 'AND' : 'WHERE'} source IS NOT NULL
      GROUP BY source
      ORDER BY count DESC
    `).all(...values) as { source: string; count: number }[];

    respond(res, { items: rows });
  });

  // GET /api/stats/by-user — admin only
  router.get('/by-user', (req, res) => {
    if (req.user!.role !== 'admin') {
      respondError(res, 403, 'FORBIDDEN', '需要管理员权限');
      return;
    }

    const params = querySchema.parse(req.query);
    const { where, values } = buildWhere(req.user!.id, true, params);

    const rows = db.prepare(`
      SELECT u.username, u.display_name, COUNT(e.id) as count
      FROM usage_events e
      JOIN users u ON u.id = e.user_id
      ${where}
      GROUP BY e.user_id
      ORDER BY count DESC
    `).all(...values) as { username: string; display_name: string; count: number }[];

    respond(res, { items: toCamelCase(rows) });
  });

  // GET /api/stats/recent
  router.get('/recent', (req, res) => {
    const isAdmin = req.user!.role === 'admin';
    const limit = Math.max(1, Math.min(parseInt((req.query.limit as string) ?? '20', 10) || 20, 100));
    const { where, values } = buildWhere(req.user!.id, isAdmin, querySchema.parse(req.query));

    const rows = db.prepare(`
      SELECT e.id, e.event_type, e.source, e.standard_id, e.metadata, e.created_at,
             u.username, u.display_name
      FROM usage_events e
      JOIN users u ON u.id = e.user_id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT ?
    `).all(...values, limit) as {
      id: number; event_type: string; source: string | null; standard_id: string | null;
      metadata: string | null; created_at: string; username: string; display_name: string;
    }[];

    respond(res, {
      items: toCamelCase(rows.map(r => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
      }))),
    });
  });

  // GET /api/stats/activity — 操作明细，含 ip/hostname/client/result/error；
  // collapse=5m 时把"同用户 + 同 event_type + 相邻且间隔≤5min"的连续记录折叠成一组。
  router.get('/activity', (req, res) => {
    const isAdmin = req.user!.role === 'admin';
    const params = querySchema.parse(req.query);
    const limit = Math.max(1, Math.min(parseInt((req.query.limit as string) ?? '300', 10) || 300, 1000));
    const collapseMin = req.query.collapse === '5m' ? 5 : 0;
    const { where, values } = buildWhere(req.user!.id, isAdmin, params);

    const rows = db.prepare(`
      SELECT e.id, e.event_type, e.source, e.standard_id, e.created_at,
             e.ip, e.hostname, e.client, e.result, e.error,
             u.username, u.display_name
      FROM usage_events e
      JOIN users u ON u.id = e.user_id
      ${where}
      ORDER BY e.created_at DESC
      LIMIT ?
    `).all(...values, limit) as Array<{
      id: number; event_type: string; source: string | null; standard_id: string | null;
      created_at: string; ip: string | null; hostname: string | null; client: string | null;
      result: string | null; error: string | null; username: string; display_name: string;
    }>;

    if (!collapseMin) { respond(res, { items: toCamelCase(rows) }); return; }

    // 折叠：rows 已按时间倒序。把相邻的同 user(username) + 同 event_type + 间隔≤5min 归一组。
    const WINDOW = collapseMin * 60_000;
    type Row = (typeof rows)[number];
    const groups: Array<{
      eventType: string; username: string; displayName: string;
      ip: string | null; hostname: string | null; client: string | null;
      startAt: string; endAt: string; count: number; successCount: number; failCount: number;
      children: Row[];
    }> = [];
    for (const r of rows) {
      const g = groups[groups.length - 1];
      const sameBucket = g && g.username === r.username && g.eventType === r.event_type
        && Math.abs(new Date(g.endAt).getTime() - new Date(r.created_at).getTime()) <= WINDOW;
      if (sameBucket) {
        g.children.push(r);
        g.count++;
        if (r.result === 'fail') g.failCount++; else if (r.result === 'success') g.successCount++;
        g.endAt = r.created_at; // rows 倒序，越往后越早
      } else {
        groups.push({
          eventType: r.event_type, username: r.username, displayName: r.display_name,
          ip: r.ip, hostname: r.hostname, client: r.client,
          startAt: r.created_at, endAt: r.created_at, count: 1,
          successCount: r.result === 'fail' ? 0 : (r.result === 'success' ? 1 : 0),
          failCount: r.result === 'fail' ? 1 : 0,
          children: [r],
        });
      }
    }
    respond(res, { groups: toCamelCase(groups) });
  });

  return router;
}
