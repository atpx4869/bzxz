import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, stat, unlink } from 'node:fs/promises';

import { ExportTaskStore } from '../services/export-task-store';
import { SourceRegistry } from '../services/source-registry';
import { getDb } from '../services/db';
import { createAuthMiddleware } from './auth-middleware';
import { createAuthRoutes } from './auth-routes';
import { createAdminRoutes } from './admin-routes';
import { createStatsRoutes } from './stats-routes';
import { createQualificationRoutes } from './cnas-routes';
import { createStandardsRoutes } from './standards-routes';
import { AppError } from '../shared/errors';

export function createApp() {
  const app = express();
  const sourceRegistry = new SourceRegistry();
  const exportTaskStore = new ExportTaskStore();
  const db = getDb();
  const { requireAuth, requireAdmin } = createAuthMiddleware(db);

  // Resolve base path: Electron uses BZXZ_BASE_DIR env, dev mode uses cwd
  const baseDir = process.env.BZXZ_BASE_DIR || process.cwd();

  app.use(express.json());
  app.use(express.static(path.join(baseDir, 'public')));

  // Serve index.html at root
  app.get('/', (_req, res) => {
    const indexPath = path.join(baseDir, 'public', 'index.html');
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.redirect('/index.html');
    }
  });

  // Serve exported files for browser download
  app.get('/api/downloads/:filename', requireAuth, (req, res) => {
    const filename = String(req.params.filename);
    // Strict filename whitelist — no path separators or traversal
    if (!/^[a-zA-Z0-9一-鿿._\-\s()]+$/.test(filename)) {
      res.status(400).json({ code: 'BAD_REQUEST', message: 'Invalid filename' });
      return;
    }
    const exportsDir = path.resolve(baseDir, 'data', 'exports');
    const filePath = path.resolve(exportsDir, filename);
    if (!filePath.startsWith(exportsDir + path.sep)) {
      res.status(400).json({ code: 'BAD_REQUEST', message: 'Invalid filename' });
      return;
    }
    if (!existsSync(filePath)) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'File not found' });
      return;
    }
    if (req.query.inline === '1') {
      res.sendFile(filePath);
    } else {
      res.download(filePath);
    }
  });

  app.get('/api/downloads', requireAuth, async (_req, res, next) => {
    try {
      const exportsDir = path.resolve(baseDir, 'data', 'exports');
      if (!existsSync(exportsDir)) {
        res.json({ items: [] });
        return;
      }
      const names = await readdir(exportsDir);
      const items = await Promise.all(names
        .filter(name => /^[a-zA-Z0-9一-鿿._\-\s()]+$/.test(name))
        .map(async name => {
          const filePath = path.resolve(exportsDir, name);
          if (!filePath.startsWith(exportsDir + path.sep)) return null;
          const s = await stat(filePath);
          if (!s.isFile()) return null;
          const standardNumber = name.match(/((?:GB|GB\/T|YY\/T|YY|JJG|DB\d+\/T|ISO)[\w./ -]*?\d{1,5}(?:[-—]\d{4})?)/i)?.[1]?.trim() ?? '';
          const source = name.match(/_(gbw|by|bz)_/i)?.[1] ?? '';
          return {
            fileName: name,
            size: s.size,
            mtime: s.mtime.toISOString(),
            standardNumber,
            source,
            path: filePath,
            downloadUrl: `/api/downloads/${encodeURIComponent(name)}`,
          };
        }));
      res.json({ items: items.filter(Boolean).sort((a: any, b: any) => String(b.mtime).localeCompare(String(a.mtime))) });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/downloads/:filename', requireAuth, async (req, res, next) => {
    try {
      const filename = String(req.params.filename);
      if (!/^[a-zA-Z0-9一-鿿._\-\s()]+$/.test(filename)) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Invalid filename' });
        return;
      }
      const exportsDir = path.resolve(baseDir, 'data', 'exports');
      const filePath = path.resolve(exportsDir, filename);
      if (!filePath.startsWith(exportsDir + path.sep)) {
        res.status(400).json({ code: 'BAD_REQUEST', message: 'Invalid filename' });
        return;
      }
      await unlink(filePath);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  // Auth routes (no auth required)
  app.use('/api/auth', createAuthRoutes(db, requireAuth));
  app.use('/api/admin', requireAdmin, createAdminRoutes(db));
  app.use('/api/stats', createStatsRoutes(db, requireAuth));
  app.use(createQualificationRoutes(db, requireAuth));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, sources: sourceRegistry.list() });
  });

  app.use(createStandardsRoutes({ db, sourceRegistry, exportTaskStore, requireAuth, baseDir }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Multer errors
    const multerCodes = new Set(['LIMIT_FILE_SIZE', 'LIMIT_UNEXPECTED_FILE', 'LIMIT_FILE_COUNT', 'LIMIT_FIELD_KEY', 'LIMIT_FIELD_VALUE', 'LIMIT_FIELD_COUNT', 'LIMIT_PART_COUNT']);
    if (multerCodes.has((error as any)?.code)) {
      const msg = (error as any)?.code === 'LIMIT_FILE_SIZE' ? '文件大小不能超过 10MB' : (error as any).message || '上传错误';
      res.status(400).json({ code: 'BAD_REQUEST', message: msg });
      return;
    }
    // AppError instances
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        code: error.code,
        message: error.message,
        details: error.details,
      });
      return;
    }

    console.error(error);
    res.status(500).json({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected server error',
    });
  });

  return app;
}
