import { Router } from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';

export function createStatsRoutes(db: Database.Database, requireAuth: (req: Request, res: Response, next: NextFunction) => void) {
  const router = Router();
  router.use(requireAuth);

  const querySchema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
    user_id: z.string().optional(),
    event_type: z.string().optional(),
    source: z.string().optional(),
  });

  function buildWhere(userId: number, isAdmin: boolean, params: z.infer<typeof querySchema>) {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.from) { conditions.push('e.created_at >= ?'); values.push(params.from); }
    if (params.to) { conditions.push('e.created_at <= ?'); values.push(params.to); }
    if (params.event_type) { conditions.push('e.event_type = ?'); values.push(params.event_type); }
    if (params.source) { conditions.push('e.source = ?'); values.push(params.source); }

    // Non-admin can only see own data
    if (!isAdmin) {
      conditions.push('e.user_id = ?');
      values.push(userId);
    } else if (params.user_id) {
      conditions.push('e.user_id = ?');
      values.push(parseInt(params.user_id, 10));
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

    res.json({ total, byType, uniqueUsers });
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

    res.json({ data: rows });
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

    res.json({ data: rows });
  });

  // GET /api/stats/by-user — admin only
  router.get('/by-user', (req, res) => {
    if (req.user!.role !== 'admin') {
      res.status(403).json({ code: 'FORBIDDEN', message: '需要管理员权限' });
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

    res.json({ data: rows });
  });

  // GET /api/stats/recent
  router.get('/recent', (req, res) => {
    const isAdmin = req.user!.role === 'admin';
    const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 100);
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

    res.json({
      data: rows.map(r => ({
        ...r,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
      })),
    });
  });

  return router;
}
