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
import { createAnnouncementRoutes } from './announcement-routes';
import { createStatsRoutes } from './stats-routes';
import { createQualificationRoutes } from './cnas-routes';
import { createStandardsRoutes } from './standards-routes';
import { createPreviewRoutes } from './preview-routes';
import { createLabrRoutes } from './labr-routes';
import { scanLibrary, startLibraryWatcher, parseLibraryFilename } from '../services/library-index';
import { getSetting } from '../services/db';
import { AppError } from '../shared/errors';
import { respond, respondError } from '../shared/response';
import { getOcrStatus } from '../sources/shared/captcha-ocr';
import { getRecentLogs } from '../shared/log-buffer';
import { getEnvironmentReport, runEnvironmentCheck } from '../services/environment-check';
import { getHostStats } from '../shared/http';
import { getSourceSemaphoreStats } from '../shared/source-semaphore';

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

  // Writable user data (data/, exports/) lives under BZXZ_BASE_DIR.
  // Bundled read-only assets (public/, scripts/) live under BZXZ_STATIC_DIR,
  // which in Electron packaged mode points at `resourcesPath`.
  const baseDir = process.env.BZXZ_BASE_DIR || process.cwd();
  const staticDir = process.env.BZXZ_STATIC_DIR || baseDir;

  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(staticDir, 'public')));

  // Legacy route aliases: rewrite old paths to new canonical paths in-place so the actual
  // route handlers below only know about the new layout. Removed in a future major.
  app.use(legacyRouteAlias);

  // Serve index.html at root
  app.get('/', (_req, res) => {
    const indexPath = path.join(staticDir, 'public', 'index.html');
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

  /**
   * 文件下载兜底（Phase 2 改造）：
   * 1. 先看 exports/（xlsx 报表、旧 PDF 残留）
   * 2. 再按 basename 查 standard_files 索引（PDF 标准入库后只在 library/ 里）
   *
   * 这样旧前端代码 `triggerDownload(fileName)` → `/api/downloads/${fileName}`
   * 仍然能解析，迁移期前后端不必同步改。
   */
  app.get('/api/downloads/:filename', requireAuth, (req, res) => {
    const filename = safeExportName(String(req.params.filename));
    if (!filename) {
      respondError(res, 400, 'BAD_REQUEST', 'Invalid filename');
      return;
    }
    const exportsDir = path.resolve(baseDir, 'data', 'exports');
    const exportsPath = path.resolve(exportsDir, filename);
    if (exportsPath.startsWith(exportsDir + path.sep) && existsSync(exportsPath)) {
      if (req.query.inline === '1') res.sendFile(exportsPath);
      else res.download(exportsPath);
      return;
    }
    // Fallback：从 library 索引按 basename 找。SQL 用 LIKE 锚定 basename 防止
    // 不同库根之间误命中（标准化以 path.sep 为界）。
    const candidates = db.prepare(
      `SELECT id, abs_path FROM standard_files WHERE abs_path LIKE ? ESCAPE '\\'`
    ).all('%' + filename.replace(/[\\%_]/g, m => '\\' + m)) as Array<{ id: number; abs_path: string }>;
    const match = candidates.find(r => path.basename(r.abs_path) === filename);
    if (match) {
      if (req.query.inline === '1') res.sendFile(match.abs_path);
      else res.download(match.abs_path);
      return;
    }
    respondError(res, 404, 'NOT_FOUND', 'File not found');
  });

  /**
   * 下载列表（Phase 2 改造）：union exports/ 里的 xlsx 报表 + library 里的 PDF 标准。
   * PDF 标准走 fileId 作为 downloadUrl —— 命中预览端点既能内联看，也能 attachment=1 另存。
   * xlsx 报表 originatingExports，仍走 /api/downloads/:filename。
   */
  app.get('/api/downloads', requireAuth, async (_req, res, next) => {
    try {
      const exportsDir = path.resolve(baseDir, 'data', 'exports');
      const exportItems: any[] = [];
      if (existsSync(exportsDir)) {
        const names = await readdir(exportsDir);
        const fromExports = await Promise.all(names
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
              kind: 'export' as const,
            };
          }));
        for (const it of fromExports) if (it) exportItems.push(it);
      }
      // Library PDF 索引
      const libraryRows = db.prepare(
        `SELECT id, std_code_norm, year, source, abs_path, size, mtime, indexed_at
         FROM standard_files ORDER BY indexed_at DESC`
      ).all() as Array<{ id: number; std_code_norm: string; year: string; source: string; abs_path: string; size: number; mtime: number; indexed_at: string }>;
      const libraryItems = libraryRows.map(r => {
        const fileName = path.basename(r.abs_path);
        // 反解 fileName 拿真正的 stdCode 形态（带 /T、大小写正确）和 title。
        // std_code_norm 经过 extractBaseCode 剥前缀大写化、不适合直接展示给用户。
        // 兜底：parse 失败（用户手放进库的不规范命名）退回归一化拼装。
        const parsed = parseLibraryFilename(fileName);
        const standardNumber = parsed
          ? (parsed.stdCodeRaw || (r.std_code_norm + (r.year ? `-${r.year}` : '')))
          : (r.std_code_norm + (r.year ? `-${r.year}` : ''));
        const title = parsed?.title || '';
        return {
          fileName,
          size: r.size,
          mtime: new Date(r.mtime).toISOString(),
          standardNumber,
          title,
          source: r.source,
          path: r.abs_path,
          // 预览端点既支持 inline（默认）也支持 attachment=1，前端按需拼参数
          downloadUrl: `/api/preview/file/${r.id}?attachment=1`,
          previewUrl: `/api/preview/file/${r.id}`,
          kind: 'library' as const,
          fileId: r.id,
        };
      });
      const items = [...libraryItems, ...exportItems].sort((a, b) =>
        String(b.mtime).localeCompare(String(a.mtime)));
      respond(res, { items });
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
  const announcementRoutes = createAnnouncementRoutes(db, requireAuth, requireAdmin);
  app.use('/api/announcements', announcementRoutes.userRouter);
  app.use('/api/admin/announcements', announcementRoutes.adminRouter);
  app.use('/api/stats', createStatsRoutes(db, requireAuth));
  const qualRouter = createQualificationRoutes(db, requireAuth);
  app.use(qualRouter);
  // 预览：requireAuth 在路由内部应用，挂在根上即可（端点路径里已带 /api/preview 前缀）。
  app.use(createPreviewRoutes(db, requireAuth, sourceRegistry));
  // labr：独立 sidebar，与 SourceRegistry 解耦；路径自带 /api/labr 前缀
  app.use(createLabrRoutes(requireAuth));

  app.get('/api/health', (_req, res) => {
    const version = process.env.npm_package_version || process.env.BZXZ_APP_VERSION || '';
    respond(res, { ok: true, version, sources: sourceRegistry.list() });
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
  // Admin-only — recent server logs can include upstream URLs / cookies /
  // hcno values that ordinary users have no need to see.
  app.get('/api/diagnostics/logs', requireAdmin, (req, res) => {
    const limit = Math.max(1, Math.min(Number.parseInt(String(req.query.limit ?? ''), 10) || 200, 500));
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
  // 源级并发信号量诊断：admin 看到 active / limit / waiting 三个数；
  // waiting > 0 长期不归零 ⇒ 源端瓶颈（考虑升 limit 或检查源是否变慢）
  app.get('/api/diagnostics/sources', requireAuth, (_req, res) => {
    respond(res, { sources: getSourceSemaphoreStats() });
  });

  // Kick off the self-check at server boot. Fire-and-forget — the check runs
  // in parallel with normal request handling, results land in /api/diagnostics
  // /environment when ready.
  void runEnvironmentCheck();

  // 启动时增量扫描标准库一次：把磁盘新增 / 修改 / 删除的 PDF 同步进索引。
  // fire-and-forget：库目录探针 + readdir 在挂大网盘时可能阻塞，必须脱离启动主路径。
  scanLibrary(db, { full: false }).catch((e) => {
    console.error('[library] startup scan failed:', e);
  });

  // chokidar 监听：用户拖文件进库目录自动入索引。默认开（库 PDF 是主流入口），
  // 用户可在 admin 设置里关掉（OneDrive / SMB 抖动场景）。fire-and-forget：
  // start 内部解析库路径 + 建监听器，慢盘别拖启动主路径。
  if (getSetting(db, 'library_watcher_enabled', '1') === '1') {
    startLibraryWatcher(db).catch((e) => {
      console.error('[library] startup watcher failed:', e);
    });
  }

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

  // Resources owned by this app instance that must be released on shutdown:
  // - playwright Chromium spawned by the CNAS scraper
  // - sqlite handle
  // - pdf-merge worker_threads pool (small, but worth a clean terminate so
  //   Electron's "is anything still holding the event loop?" checks pass)
  async function shutdown(): Promise<void> {
    await qualRouter.qualificationService.close().catch(() => {});
    try {
      const { closePdfMergePool } = await import('../shared/pdf-merge.js');
      await closePdfMergePool();
    } catch { /* pool may not have been initialized */ }
    try { db.close(); } catch { /* may already be closed under test reset */ }
  }

  return Object.assign(app, { shutdown });
}
