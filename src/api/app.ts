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
import { respond, respondError } from '../shared/response';
import { getOcrStatus } from '../sources/shared/captcha-ocr';
import { getRecentLogs } from '../shared/log-buffer';
import { getEnvironmentReport, runEnvironmentCheck } from '../services/environment-check';
import { getHostStats } from '../shared/http';

/**
 * Legacy → canonical route rewrites. Express matches by url, so we just patch req.url
 * before the router sees it. New code should only emit canonical paths.
 */
const LEGACY_ROUTE_REWRITES: Array<[RegExp, string]> = [
  [/^\/api\/standards\/qualifications(\?|$)/, '/api/qualifications/batch-query$1'],
  [/^\/api\/cnas\/labs(\/.*)?$/, '/api/qualifications/labs/cnas$1'],
  [/^\/api\/cnas\/sync(\?|$)/, '/api/qualifications/labs/cnas/sync$1'],
  [/^\/api\/cnas\/sync-logs(\?|$)/, '/api/qualifications/labs/cnas/sync-logs$1'],
  [/^\/api\/cma\/search-labs(\?|$)/, '/api/qualifications/labs/cma/search$1'],
  [/^\/api\/cma\/labs(\/.*)?$/, '/api/qualifications/labs/cma$1'],
  [/^\/api\/cma\/sync(\?|$)/, '/api/qualifications/labs/cma/sync$1'],
  [/^\/api\/cma\/sync-logs(\?|$)/, '/api/qualifications/labs/cma/sync-logs$1'],
  [/^\/api\/qualification-links(\/.*)?$/, '/api/qualifications/links$1'],
];

function legacyRouteAlias(req: Request, _res: Response, next: NextFunction): void {
  for (const [pattern, replacement] of LEGACY_ROUTE_REWRITES) {
    if (pattern.test(req.url)) {
      req.url = req.url.replace(pattern, replacement);
      break;
    }
  }
  next();
}

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

  // Legacy route aliases: rewrite old paths to new canonical paths in-place so the actual
  // route handlers below only know about the new layout. Removed in a future major.
  app.use(legacyRouteAlias);

  // Serve index.html at root
  app.get('/', (_req, res) => {
    const indexPath = path.join(baseDir, 'public', 'index.html');
    if (existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.redirect('/index.html');
    }
  });

  // Reject any filename that contains path separators, traversal sequences, or
  // disallowed characters. Always run on the decoded basename so URL-encoded
  // separators (`%2F`, `..%2F`) can't sneak through.
  const FILENAME_ALLOWED = /^[a-zA-Z0-9一-鿿._\-\s()]+$/;
  function safeExportName(raw: string): string | null {
    let decoded: string;
    try { decoded = decodeURIComponent(raw); } catch { return null; }
    const base = path.basename(decoded);
    if (!base || base === '.' || base === '..') return null;
    if (!FILENAME_ALLOWED.test(base)) return null;
    return base;
  }

  // Serve exported files for browser download
  app.get('/api/downloads/:filename', requireAuth, (req, res) => {
    const filename = safeExportName(String(req.params.filename));
    if (!filename) {
      respondError(res, 400, 'BAD_REQUEST', 'Invalid filename');
      return;
    }
    const exportsDir = path.resolve(baseDir, 'data', 'exports');
    const filePath = path.resolve(exportsDir, filename);
    if (!filePath.startsWith(exportsDir + path.sep)) {
      respondError(res, 400, 'BAD_REQUEST', 'Invalid filename');
      return;
    }
    if (!existsSync(filePath)) {
      respondError(res, 404, 'NOT_FOUND', 'File not found');
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
        respond(res, { items: [] });
        return;
      }
      const names = await readdir(exportsDir);
      const items = await Promise.all(names
        .filter(name => FILENAME_ALLOWED.test(name))
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
      respond(res, { items: items.filter(Boolean).sort((a: any, b: any) => String(b.mtime).localeCompare(String(a.mtime))) });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/downloads/:filename', requireAuth, async (req, res, next) => {
    try {
      const filename = safeExportName(String(req.params.filename));
      if (!filename) {
        respondError(res, 400, 'BAD_REQUEST', 'Invalid filename');
        return;
      }
      const exportsDir = path.resolve(baseDir, 'data', 'exports');
      const filePath = path.resolve(exportsDir, filename);
      if (!filePath.startsWith(exportsDir + path.sep)) {
        respondError(res, 400, 'BAD_REQUEST', 'Invalid filename');
        return;
      }
      await unlink(filePath);
      respond(res, { ok: true });
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
    respond(res, { ok: true, sources: sourceRegistry.list() });
  });

  // ─── Diagnostics ──────────────────────────────────────────────────────────
  // Surface OCR engine health and recent server logs so the user can debug
  // slow downloads without opening the Electron dev console.
  app.get('/api/diagnostics/ocr', requireAuth, (_req, res) => {
    const status = getOcrStatus();
    const avg = (n: { count: number; totalMs: number }) => (n.count === 0 ? 0 : Math.round(n.totalMs / n.count));
    respond(res, {
      ...status,
      solves: {
        ddddocr: { ...status.solves.ddddocr, avgMs: avg(status.solves.ddddocr) },
        tesseract: { ...status.solves.tesseract, avgMs: avg(status.solves.tesseract) },
      },
    });
  });
  app.get('/api/diagnostics/logs', requireAuth, (req, res) => {
    const limit = Math.max(1, Math.min(parseInt((req.query.limit as string) || '200', 10) || 200, 500));
    respond(res, { items: getRecentLogs(limit) });
  });
  app.get('/api/diagnostics/environment', requireAuth, (_req, res) => {
    respond(res, getEnvironmentReport());
  });
  app.post('/api/diagnostics/environment/recheck', requireAuth, async (_req, res, next) => {
    try {
      await runEnvironmentCheck();
      respond(res, getEnvironmentReport());
    } catch (e) { next(e); }
  });
  app.get('/api/diagnostics/hosts', requireAuth, (_req, res) => {
    respond(res, { hosts: getHostStats() });
  });

  // Kick off the self-check at server boot. Fire-and-forget — the check runs
  // in parallel with normal request handling, results land in /api/diagnostics
  // /environment when ready.
  void runEnvironmentCheck();

  app.use(createStandardsRoutes({ db, sourceRegistry, exportTaskStore, requireAuth, baseDir }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Multer errors
    const multerCodes = new Set(['LIMIT_FILE_SIZE', 'LIMIT_UNEXPECTED_FILE', 'LIMIT_FILE_COUNT', 'LIMIT_FIELD_KEY', 'LIMIT_FIELD_VALUE', 'LIMIT_FIELD_COUNT', 'LIMIT_PART_COUNT']);
    if (multerCodes.has((error as any)?.code)) {
      const msg = (error as any)?.code === 'LIMIT_FILE_SIZE' ? '文件大小不能超过 10MB' : (error as any).message || '上传错误';
      respondError(res, 400, 'BAD_REQUEST', msg);
      return;
    }
    // AppError instances
    if (error instanceof AppError) {
      respondError(res, error.statusCode, error.code, error.message, error.details);
      return;
    }

    console.error(error);
    respondError(res, 500, 'INTERNAL_SERVER_ERROR', 'Unexpected server error');
  });

  return app;
}
