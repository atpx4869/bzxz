import { Router } from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import { respond, respondError } from '../shared/response';
import { toCamelCase } from '../shared/case';
import { normalizeError } from '../shared/errors';
import { CheckService, CheckDebounceError } from '../services/check-service';
import type { SourceRegistry } from '../services/source-registry';

// 标准查新路由（见 docs/CHECK-UPDATE-AND-STATS.md）。挂载路径自带 /api/check 前缀。
export function createCheckRoutes(
  db: Database.Database,
  sourceRegistry: SourceRegistry,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
): Router {
  const router = Router();
  const svc = new CheckService(db, sourceRegistry);

  // 校验清单归属：非本人（且非管理员）一律 404，不泄漏存在性。
  function ensureOwner(req: Request, res: Response, id: number): boolean {
    const owner = svc.ownerOf(id);
    if (owner === null || (owner !== req.user!.id && req.user!.role !== 'admin')) {
      respondError(res, 404, 'NOT_FOUND', '清单不存在');
      return false;
    }
    return true;
  }

  // 列出我的查新清单
  router.get('/api/check/watchlists', requireAuth, (req, res, next) => {
    try { respond(res, { items: toCamelCase(svc.getWatchlists(req.user!.id)) }); }
    catch (e) { next(normalizeError(e)); }
  });

  // 创建清单 + 导入标准号（首查存基线）
  router.post('/api/check/watchlists', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({
        name: z.string().trim().max(120).optional(),
        lines: z.array(z.string().trim()).min(1, '至少导入一个标准号').max(500),
      });
      const { name, lines } = schema.parse(req.body);
      const r = await svc.createWatchlist(req.user!.id, name ?? `查新清单 ${new Date().toLocaleDateString('zh-CN')}`, lines);
      respond(res, toCamelCase(r), 201);
    } catch (e) { next(normalizeError(e)); }
  });

  // 单清单明细
  router.get('/api/check/watchlists/:id', requireAuth, (req, res, next) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (Number.isNaN(id) || !ensureOwner(req, res, id)) return;
      respond(res, { items: toCamelCase(svc.getItems(id)) });
    } catch (e) { next(normalizeError(e)); }
  });

  // 重新查新
  router.post('/api/check/watchlists/:id/recheck', requireAuth, async (req, res, next) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (Number.isNaN(id) || !ensureOwner(req, res, id)) return;
      await svc.recheck(id);
      respond(res, { items: toCamelCase(svc.getItems(id)) });
    } catch (e) {
      if (e instanceof CheckDebounceError) { respondError(res, 429, 'TOO_FREQUENT', e.message); return; }
      next(normalizeError(e));
    }
  });

  // 设置自动查新（每清单：开关 + 周期天数，硬下限 15）
  router.put('/api/check/watchlists/:id/auto', requireAuth, (req, res, next) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (Number.isNaN(id) || !ensureOwner(req, res, id)) return;
      const schema = z.object({ enabled: z.boolean(), intervalDays: z.number().int().min(15).max(365).optional() });
      const { enabled, intervalDays } = schema.parse(req.body);
      svc.setAuto(id, enabled, intervalDays ?? 15);
      respond(res, { ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  // 删除清单（不可逆）
  router.delete('/api/check/watchlists/:id', requireAuth, (req, res, next) => {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (Number.isNaN(id) || !ensureOwner(req, res, id)) return;
      svc.deleteWatchlist(id);
      respond(res, { ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  return router;
}
