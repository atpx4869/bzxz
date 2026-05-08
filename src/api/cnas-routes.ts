import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { QualificationService } from '../services/qualification-service';
import { normalizeError } from '../shared/errors';

export function createQualificationRoutes(db: Database.Database, requireAuth: express.RequestHandler) {
  const router = express.Router();
  const svc = new QualificationService(db);

  // ─── Batch query for search result badges ───
  router.post('/api/standards/qualifications', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({ stdCodes: z.array(z.string().trim()).min(1).max(200) });
      const { stdCodes } = schema.parse(req.body);
      const result = svc.queryByStdCodes(stdCodes);
      res.json(result);
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
      res.json({ items, total: items.length });
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── CNAS Labs ───
  router.get('/api/cnas/labs', requireAuth, (_req, res) => {
    res.json(svc.listCnasLabs());
  });

  router.post('/api/cnas/labs', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({
        lab_no: z.string().trim().min(1).max(50),
        lab_name: z.string().trim().max(200).optional(),
        base_info_id: z.string().trim().max(100).optional(),
        cert_update_ts: z.string().trim().max(50).optional(),
        validate: z.string().trim().max(50).optional(),
      });
      const data = schema.parse(req.body);
      const lab = svc.addCnasLab(data);
      res.status(201).json(lab);
    } catch (e) { next(normalizeError(e)); }
  });

  router.delete('/api/cnas/labs/:labNo', requireAuth, (req, res, next) => {
    try {
      svc.deleteCnasLab(req.params.labNo as string);
      res.json({ ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── CMA Labs ───
  router.get('/api/cma/labs', requireAuth, (_req, res) => {
    res.json(svc.listCmaLabs());
  });

  router.post('/api/cma/labs', requireAuth, (req, res, next) => {
    try {
      const schema = z.object({
        cert_number: z.string().trim().min(1).max(50),
        lab_name: z.string().trim().max(200).optional(),
        credit_code: z.string().trim().max(50).optional(),
        lic_sys_id: z.string().trim().max(100).optional(),
        lic_date: z.string().trim().max(50).optional(),
      });
      const data = schema.parse(req.body);
      const lab = svc.addCmaLab(data);
      res.status(201).json(lab);
    } catch (e) { next(normalizeError(e)); }
  });

  router.delete('/api/cma/labs/:certNumber', requireAuth, (req, res, next) => {
    try {
      svc.deleteCmaLab(req.params.certNumber as string);
      res.json({ ok: true });
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── Sync ───
  router.post('/api/cnas/sync', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({ lab_no: z.string().trim().optional(), force: z.coerce.boolean().default(false) });
      const { lab_no, force } = schema.parse(req.query);

      if (lab_no) {
        const result = await svc.syncCnasLab(lab_no, force);
        res.json(result);
      } else {
        const labs = svc.listCnasLabs();
        const results = [];
        for (const lab of labs) {
          try {
            const r = await svc.syncCnasLab(lab.lab_no, force);
            results.push({ lab_no: lab.lab_no, ...r });
          } catch (err) {
            results.push({ lab_no: lab.lab_no, error: String(err) });
          }
        }
        res.json(results);
      }
    } catch (e) { next(normalizeError(e)); }
  });

  router.post('/api/cma/sync', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({ cert_number: z.string().trim().optional(), force: z.coerce.boolean().default(false) });
      const { cert_number, force } = schema.parse(req.query);

      if (cert_number) {
        const result = await svc.syncCmaLab(cert_number, force);
        res.json(result);
      } else {
        const labs = svc.listCmaLabs();
        const results = [];
        for (const lab of labs) {
          try {
            const r = await svc.syncCmaLab(lab.cert_number, force);
            results.push({ cert_number: lab.cert_number, ...r });
          } catch (err) {
            results.push({ cert_number: lab.cert_number, error: String(err) });
          }
        }
        res.json(results);
      }
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── Sync Logs ───
  router.get('/api/cnas/sync-logs', requireAuth, (req, res) => {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 20, 100));
    res.json(svc.getCnasSyncLogs(limit));
  });

  router.get('/api/cma/sync-logs', requireAuth, (req, res) => {
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string) || 20, 100));
    res.json(svc.getCmaSyncLogs(limit));
  });

  // ─── Settings ───
  router.get('/api/qualifications/settings', requireAuth, (_req, res) => {
    res.json(svc.getSettings());
  });

  router.put('/api/qualifications/settings', requireAuth, (req, res, next) => {
    try {
      const schema = z.record(z.string(), z.string());
      const data = schema.parse(req.body);
      for (const [k, v] of Object.entries(data)) {
        svc.updateSetting(k, v);
      }
      res.json(svc.getSettings());
    } catch (e) { next(normalizeError(e)); }
  });

  // ─── Stats ───
  router.get('/api/qualifications/stats', requireAuth, (_req, res) => {
    const cnasCount = (db.prepare('SELECT COUNT(*) as c FROM cnas_qualifications').get() as any).c;
    const cmaCount = (db.prepare('SELECT COUNT(*) as c FROM cma_qualifications').get() as any).c;
    const cnasLabs = (db.prepare('SELECT COUNT(*) as c FROM cnas_labs').get() as any).c;
    const cmaLabs = (db.prepare('SELECT COUNT(*) as c FROM cma_labs').get() as any).c;
    res.json({ cnasQualifications: cnasCount, cmaQualifications: cmaCount, cnasLabs, cmaLabs });
  });

  return router;
}
