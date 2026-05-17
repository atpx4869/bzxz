import express from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { QualificationService } from '../services/qualification-service';
import { normalizeError } from '../shared/errors';
import { respond } from '../shared/response';
import { toCamelCase, toSnakeCase } from '../shared/case';

export function createQualificationRoutes(db: Database.Database, requireAuth: express.RequestHandler) {
  const router = express.Router();
  const svc = new QualificationService(db);

  // ─── Batch query for search result badges ───
  router.post('/api/qualifications/batch-query', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({ stdCodes: z.array(z.string().trim()).min(1).max(200) });
      const { stdCodes } = schema.parse(req.body);
      respond(res, toCamelCase(svc.queryByStdCodes(stdCodes)));
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── Qualification search ───
  router.get('/api/qualifications/search', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({
        q: z.string().trim().min(1).max(500),
        source: z.enum(['CNAS', 'CMA']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      });
      const { q, source, limit } = schema.parse(req.query);
      const items = svc.searchQualifications(q, source, limit);
      respond(res, { items: toCamelCase(items), total: items.length });
    } catch (e) { next(normalizeError(e)); }
  });

  router.post('/api/qualifications/visual', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({
        queries: z.array(z.string().trim().min(1).max(500)).min(1).max(100),
        limitPerQuery: z.coerce.number().int().min(1).max(1000).default(500),
      });
      const { queries, limitPerQuery } = schema.parse(req.body);
      const unique = [...new Set(queries)];
      respond(res, toCamelCase(svc.queryVisualKeywords(unique, limitPerQuery)));
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── CNAS Labs (under /qualifications/labs/cnas) ───
  router.get('/api/qualifications/labs/cnas', requireAuth, (_req, res) => {
    respond(res, { items: toCamelCase(svc.listCnasLabs()) });
  });

  router.post('/api/qualifications/labs/cnas', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({
        labNo: z.string().trim().min(1).max(50),
        labName: z.string().trim().max(200).optional(),
        baseInfoId: z.string().trim().max(100).optional(),
        certUpdateTs: z.string().trim().max(50).optional(),
        validate: z.string().trim().max(50).optional(),
        urlParams: z.record(z.string(), z.string()).optional(),
      });
      const data = schema.parse(req.body);
      const lab = svc.addCnasLab(toSnakeCase(data));
      respond(res, toCamelCase(lab), 201);
    } catch (e) { next(normalizeError(e)); }
  });

  router.delete('/api/qualifications/labs/cnas/:labNo', requireAuth, (req, res, next) => {
    try {
      svc.deleteCnasLab(req.params.labNo as string);
      respond(res, { ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  router.put('/api/qualifications/labs/cnas/:labNo', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({ labName: z.string().trim().max(200) });
      const { labName } = schema.parse(req.body);
      db.prepare('UPDATE cnas_labs SET lab_name = ? WHERE lab_no = ?').run(labName, req.params.labNo);
      respond(res, { ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── CMA Labs (under /qualifications/labs/cma) ───
  router.get('/api/qualifications/labs/cma/search', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({ q: z.string().trim().min(1).max(200) });
      const { q } = schema.parse(req.query);
      const items = await svc.searchCmaLabs(q);
      respond(res, { items: toCamelCase(items), total: items.length });
    } catch (e) { next(normalizeError(e)); }
  });

  router.get('/api/qualifications/labs/cma', requireAuth, (_req, res) => {
    respond(res, { items: toCamelCase(svc.listCmaLabs()) });
  });

  router.post('/api/qualifications/labs/cma', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({
        publicDetailId: z.string().trim().min(1).max(120),
      });
      const data = schema.parse(req.body);
      const lab = await svc.addCmaLab(toSnakeCase(data));
      respond(res, toCamelCase(lab), 201);
    } catch (e) { next(normalizeError(e)); }
  });

  router.delete('/api/qualifications/labs/cma/:certNumber', requireAuth, (req, res, next) => {
    try {
      svc.deleteCmaLab(req.params.certNumber as string);
      respond(res, { ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  router.put('/api/qualifications/labs/cma/:certNumber', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({ labName: z.string().trim().max(200) });
      const { labName } = schema.parse(req.body);
      db.prepare('UPDATE cma_labs SET lab_name = ? WHERE cert_number = ?').run(labName, req.params.certNumber);
      respond(res, { ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── Qualification links (under /qualifications/links) ───
  router.post('/api/qualifications/links', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({
        displayName: z.string().trim().min(1).max(200),
        cnasLabNo: z.string().trim().max(80).optional(),
        cmaCertNumber: z.string().trim().max(80).optional(),
      });
      const data = schema.parse(req.body);
      svc.linkQualificationLabs(toSnakeCase(data));
      respond(res, { ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  router.delete('/api/qualifications/links/:source/:id', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({
        source: z.enum(['CNAS', 'CMA']),
        id: z.string().trim().min(1).max(80),
      });
      const { source, id } = schema.parse(req.params);
      svc.unlinkQualificationLab(source, id);
      respond(res, { ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── Sync (under /qualifications/labs/{cnas|cma}/sync) ───
  router.post('/api/qualifications/labs/cnas/sync', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({ labNo: z.string().trim().optional(), force: z.coerce.boolean().default(false) });
      const { labNo, force } = schema.parse(req.query);

      if (labNo) {
        respond(res, toCamelCase(await svc.syncCnasLab(labNo, force)));
      } else {
        respond(res, toCamelCase(await svc.syncAllCnasLabs(force)));
      }
    } catch (e) { next(normalizeError(e)); }
  });

  router.post('/api/qualifications/labs/cma/sync', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({ certNumber: z.string().trim().optional(), force: z.coerce.boolean().default(false) });
      const { certNumber, force } = schema.parse(req.query);

      if (certNumber) {
        respond(res, toCamelCase(await svc.syncCmaLab(certNumber, force)));
      } else {
        respond(res, toCamelCase(await svc.syncAllCmaLabs(force)));
      }
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── Sync Logs ───
  router.get('/api/qualifications/labs/cnas/sync-logs', requireAuth, (req, res) => {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 20, 100));
    respond(res, { items: toCamelCase(svc.getCnasSyncLogs(limit)) });
  });

  router.get('/api/qualifications/labs/cma/sync-logs', requireAuth, (req, res) => {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 20, 100));
    respond(res, { items: toCamelCase(svc.getCmaSyncLogs(limit)) });
  });

  // ─── Settings ───
  router.get('/api/qualifications/settings', requireAuth, (_req, res) => {
    respond(res, svc.getSettings());
  });

  router.put('/api/qualifications/settings', requireAuth, (req, res, next) => {
    try {
      const schema = z.record(z.string(), z.string());
      const data = schema.parse(req.body);
      for (const [k, v] of Object.entries(data)) {
        svc.updateSetting(k, v);
      }
      respond(res, svc.getSettings());
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── Stats ───
  router.get('/api/qualifications/stats', requireAuth, (_req, res) => {
    const cnasCount = (db.prepare('SELECT COUNT(*) as c FROM cnas_qualifications').get() as any).c;
    const cmaCount = (db.prepare('SELECT COUNT(*) as c FROM cma_qualifications').get() as any).c;
    const cnasLabs = (db.prepare('SELECT COUNT(*) as c FROM cnas_labs').get() as any).c;
    const cmaLabs = (db.prepare('SELECT COUNT(*) as c FROM cma_labs').get() as any).c;
    respond(res, { cnasQualifications: cnasCount, cmaQualifications: cmaCount, cnasLabs, cmaLabs });
  });

  return router;
}
