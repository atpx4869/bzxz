/**
 * 国家 CMA 一单一库（能力项目库）路由。
 *
 * 路径前缀 /api/cma-diff，挂载方式：app.use(createCapLibRoutes(...)) —— 路径自带前缀，
 * 与 cnas-routes / labr-routes 风格一致；router 挂在根上故必须用 per-route guard（不可
 * 用 router.use(requireXxx)，参考 cnas-routes.ts:18-19 那段教训）。
 *
 * 权限：
 * - 大多数读端点：requireTab('cma-diff')
 * - batch-status（搜索/资质查询页徽章用）：OR `cma-diff` / `qual` / `search` —— 三个 tab 任一即可
 * - 触发同步 / 清理：requireAdmin（在路由内部组合 requireAdmin）
 */
import express from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import {
  CapLibService, getSyncProgress, CAP_LIB_DOMAIN_NAMES, isValidCapLibDomain,
} from '../services/cap-lib-service';
import { normalizeError } from '../shared/errors';
import { respond, respondError } from '../shared/response';
import { toCamelCase } from '../shared/case';
import type { RequireTab } from './auth-middleware';

export function createCapLibRoutes(
  db: Database.Database,
  requireAuth: express.RequestHandler,
  requireAdmin: express.RequestHandler,
  requireTab: RequireTab,
): express.Router {
  const router = express.Router();
  const svc = new CapLibService(db);

  const requireCmaDiff = requireTab('cma-diff');
  // batch-status：徽章注入到搜索结果 / 资质查询页 / 比对页，三方任一都该看到
  const requireBadgeAccess = requireTab('cma-diff', 'qual', 'search');

  // ── 元数据 ──────────────────────────────────────────────────────────

  router.get('/api/cma-diff/domains', requireCmaDiff, (_req, res, next) => {
    try {
      respond(res, toCamelCase({ items: svc.listDomains(), all: CAP_LIB_DOMAIN_NAMES }));
    } catch (e) { next(normalizeError(e)); }
  });

  router.put('/api/cma-diff/domains/:name/subscribe', requireCmaDiff, requireAdmin, (req, res, next) => {
    try {
      const schema = z.object({ subscribed: z.boolean() });
      const { subscribed } = schema.parse(req.body);
      const name = decodeURIComponent(String(req.params.name));
      if (!isValidCapLibDomain(name)) { respondError(res, 400, 'BAD_REQUEST', '非法领域名'); return; }
      svc.setSubscribed(name, subscribed);
      respond(res, { ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  // ── 同步 ────────────────────────────────────────────────────────────

  router.post('/api/cma-diff/sync/:name', requireCmaDiff, requireAdmin, (req, res, next) => {
    try {
      const name = decodeURIComponent(String(req.params.name));
      if (!isValidCapLibDomain(name)) { respondError(res, 400, 'BAD_REQUEST', '非法领域名'); return; }
      const jobId = svc.startSync(name);
      respond(res, { jobId, domain: name });
    } catch (e) { next(normalizeError(e)); }
  });

  router.post('/api/cma-diff/sync-all', requireCmaDiff, requireAdmin, (_req, res, next) => {
    try {
      const subscribed = svc.listDomains().filter(d => d.subscribed);
      const jobs = subscribed.map(d => ({ domain: d.domain, jobId: svc.startSync(d.domain) }));
      respond(res, { jobs });
    } catch (e) { next(normalizeError(e)); }
  });

  router.get('/api/cma-diff/sync/progress/:jobId', requireCmaDiff, (req, res) => {
    const p = getSyncProgress(String(req.params.jobId));
    if (!p) { respondError(res, 404, 'NOT_FOUND', '任务不存在或已过期'); return; }
    respond(res, toCamelCase(p));
  });

  // ── 比对 ────────────────────────────────────────────────────────────

  router.get('/api/cma-diff/summary', requireCmaDiff, (_req, res, next) => {
    try { respond(res, toCamelCase(svc.summary())); } catch (e) { next(normalizeError(e)); }
  });

  router.get('/api/cma-diff/labs', requireCmaDiff, (_req, res, next) => {
    try { respond(res, toCamelCase({ items: svc.labsCounts() })); } catch (e) { next(normalizeError(e)); }
  });

  router.get('/api/cma-diff/labs/:certNumber', requireCmaDiff, (req, res, next) => {
    try {
      const certNumber = String(req.params.certNumber);
      const filterStatus = (typeof req.query.status === 'string' ? req.query.status : '').split(',').filter(Boolean);
      const q = (typeof req.query.q === 'string' ? req.query.q : '').trim().toLowerCase();
      let rows = svc.diffByLab(certNumber);
      if (filterStatus.length > 0) rows = rows.filter(r => filterStatus.includes(r.diffStatus));
      if (q) rows = rows.filter(r =>
        r.stdCode.toLowerCase().includes(q) ||
        r.stdName.toLowerCase().includes(q) ||
        r.testItem.toLowerCase().includes(q));
      respond(res, toCamelCase({ total: rows.length, rows }));
    } catch (e) { next(normalizeError(e)); }
  });

  // ── 徽章 batch-status（共用） ──────────────────────────────────────

  router.post('/api/cma-diff/batch-status', requireBadgeAccess, (req, res, next) => {
    try {
      const schema = z.object({ stdCodes: z.array(z.string().trim()).min(1).max(500) });
      const { stdCodes } = schema.parse(req.body);
      respond(res, toCamelCase(svc.batchStatus(stdCodes)));
    } catch (e) { next(normalizeError(e)); }
  });

  // ── 清理（admin） ──────────────────────────────────────────────────

  router.post('/api/cma-diff/cleanup', requireCmaDiff, requireAdmin, (req, res, next) => {
    try {
      const schema = z.object({ days: z.number().int().min(7).max(365).default(30) });
      const { days } = schema.parse(req.body || {});
      const deleted = svc.cleanupStaleRows(days);
      respond(res, { deleted, days });
    } catch (e) { next(normalizeError(e)); }
  });

  // 为兼容老调用方避免 unused 警告
  void requireAuth;
  return router;
}
