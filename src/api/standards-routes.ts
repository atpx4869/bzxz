import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import multer from 'multer';

import { StandardService } from '../services/standard-service';
import { StandardResolver } from '../services/standard-resolver';
import { ExportTaskService } from '../services/export-task-service';
import type { ExportTaskStore } from '../services/export-task-store';
import type { SourceRegistry } from '../services/source-registry';
import { trackEvent } from '../services/usage-tracker';
import { BadRequestError, NotFoundError, normalizeError } from '../shared/errors';
import { parseStandardId, VALID_SOURCES } from '../shared/id';
import type { SourceName } from '../domain/standard';

const SOURCES = [...VALID_SOURCES] as SourceName[];
const sourceEnum = z.enum(SOURCES as [string, ...string[]]);

function normalizeStandardNumber(value: string) {
  return value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
}

function previewHasText(preview: Awaited<ReturnType<StandardService['detectPreview']>>) {
  return Boolean(
    preview.downloadUrl ||
    (preview.totalPages && preview.totalPages > 0) ||
    preview.pageUrls.length > 0 ||
    preview.meta?.hasPdf === true,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new BadRequestError('仅支持 .xlsx / .xls / .csv 格式'));
    }
  },
});

interface StandardsRoutesDeps {
  db: Database.Database;
  sourceRegistry: SourceRegistry;
  exportTaskStore: ExportTaskStore;
  requireAuth: RequestHandler;
  baseDir: string;
}

export function createStandardsRoutes({ db, sourceRegistry, exportTaskStore, requireAuth, baseDir }: StandardsRoutesDeps) {
  const router = Router();
  // Source detection: test each source with a quick search
  router.get('/api/standards/check-sources', requireAuth, async (req, res) => {
    const sources = (req.query.sources as string || '').split(',').filter(Boolean) as SourceName[];
    const targets = sources.length ? sources : sourceRegistry.list();
    const results: Record<string, { status: string; ms: number; error?: string }> = {};
    await Promise.all(targets.map(async (src) => {
      const start = Date.now();
      try {
        const adapter = sourceRegistry.get(src);
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        await adapter.searchStandards({ query: 'GB/T 1.1' });
        clearTimeout(timer);
        results[src] = { status: 'ok', ms: Date.now() - start };
      } catch (e: any) {
        results[src] = { status: 'error', ms: Date.now() - start, error: e.name === 'AbortError' ? '超时' : (e.message || '连接失败') };
      }
    }));
    res.json({ results });
  });

  // Search cache: key = "source:query", value = { items, expires }
  // Map iteration is insertion-ordered, so we use it as a simple LRU: on hit we re-insert
  // to bump recency, and on overflow we drop the oldest entry.
  const searchCache = new Map<string, { items: any[]; expires: number }>();
  const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  const CACHE_MAX_ENTRIES = 200;

  router.get('/api/standards/search', requireAuth, async (req, res, next) => {
    try {
      const querySchema = z.object({
        q: z.string().trim().min(1, 'q is required').max(500),
        source: sourceEnum.optional(),
      });

      const { q, source } = querySchema.parse(req.query);
      const selectedSource = (source ?? 'bz') as SourceName;
      const cacheKey = `${selectedSource}:${q}`;

      // Check cache
      const cached = searchCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        searchCache.delete(cacheKey);
        searchCache.set(cacheKey, cached); // bump to most-recent position
        trackEvent(db, req.user!.id, 'search', selectedSource, undefined, { query: q, resultCount: cached.items.length, cached: true });
        res.json({ items: cached.items, total: cached.items.length, sourceSummary: { requested: 1, succeeded: 1, failed: 0, source: selectedSource } });
        return;
      }
      if (cached) searchCache.delete(cacheKey); // expired

      const service = new StandardService(sourceRegistry.get(selectedSource));
      const results = await service.searchStandards({ query: q });
      // Store in cache; evict oldest entry if at capacity
      if (searchCache.size >= CACHE_MAX_ENTRIES) {
        const oldestKey = searchCache.keys().next().value;
        if (oldestKey !== undefined) searchCache.delete(oldestKey);
      }
      searchCache.set(cacheKey, { items: results, expires: Date.now() + CACHE_TTL_MS });
      trackEvent(db, req.user!.id, 'search', selectedSource, undefined, { query: q, resultCount: results.length });

      res.json({
        items: results,
        total: results.length,
        sourceSummary: {
          requested: 1,
          succeeded: 1,
          failed: 0,
          source: selectedSource,
        },
      });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  /** Poll endpoint: returns cached GBW text availability for given source IDs */
  router.get('/api/standards/text-availability', requireAuth, (req, res) => {
    const ids = ((req.query.ids as string) || '').split(',').filter(Boolean);
    if (!ids.length) { res.json({}); return; }
    res.json(sourceRegistry.getGbwTextAvailability(ids));
  });

  router.post('/api/standards/resolve', requireAuth, async (req, res, next) => {
    try {
      const bodySchema = z.object({
        lines: z.array(z.string().trim()).min(1, 'lines is required').max(200),
        sources: z.array(sourceEnum).min(1).optional(),
      });

      const { lines, sources } = bodySchema.parse(req.body);
      const selectedSources = (sources ?? sourceRegistry.list()) as SourceName[];
      const resolver = new StandardResolver(sourceRegistry);
      const result = await resolver.resolve(lines, selectedSources);
      trackEvent(db, req.user!.id, 'batch_resolve', selectedSources.join(','), undefined, {
        lineCount: lines.length, resolvedCount: result.resolved.length, unmatchedCount: result.unmatched.length,
      });
      res.json(result);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/api/standards/source-check', requireAuth, async (req, res, next) => {
    try {
      const bodySchema = z.object({
        standardNumber: z.string().trim().min(1, 'standardNumber is required').max(120),
        title: z.string().trim().max(1000).optional(),
        sources: z.array(sourceEnum).min(1).optional(),
      });

      const { standardNumber, sources } = bodySchema.parse(req.body);
      const selectedSources = (sources ?? sourceRegistry.list()) as SourceName[];
      const wantedNumber = normalizeStandardNumber(standardNumber);
      const results: Record<string, {
        status: 'text' | 'no_text' | 'not_found' | 'error';
        id?: string;
        standardNumber?: string;
        title?: string;
        previewAvailable?: boolean;
        message?: string;
      }> = {};

      await Promise.all(selectedSources.map(async (src) => {
        try {
          const service = new StandardService(sourceRegistry.get(src));
          const searchResults = await withTimeout(
            service.searchStandards({ query: standardNumber }),
            12000,
            '检测超时',
          );
          const match = searchResults.find(item => normalizeStandardNumber(item.standardNumber) === wantedNumber);
          if (!match) {
            results[src] = { status: 'not_found' };
            return;
          }

          if (match.previewAvailable) {
            results[src] = {
              status: 'text',
              id: match.id,
              standardNumber: match.standardNumber,
              title: match.title,
              previewAvailable: true,
            };
            return;
          }

          const preview = await withTimeout(
            service.detectPreview(match.id),
            15000,
            '文本检测超时',
          );
          const hasText = previewHasText(preview);
          results[src] = {
            status: hasText ? 'text' : 'no_text',
            id: match.id,
            standardNumber: match.standardNumber,
            title: match.title,
            previewAvailable: hasText,
          };
        } catch (e: any) {
          results[src] = {
            status: 'error',
            message: e?.message || '检测失败',
          };
        }
      }));

      res.json({ standardNumber, results });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/api/standards/:id', requireAuth, async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const parsed = parseStandardId(id);
      const service = new StandardService(sourceRegistry.get(parsed.source));
      const detail = await service.getStandardDetail(id);
      res.json(detail);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/api/standards/:id/preview/detect', requireAuth, async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const parsed = parseStandardId(id);
      const service = new StandardService(sourceRegistry.get(parsed.source));
      const preview = await service.detectPreview(id);
      res.json(preview);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/api/standards/:id/export', requireAuth, async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const parsed = parseStandardId(id);
      const adapter = sourceRegistry.get(parsed.source);
      const exportTaskService = new ExportTaskService(adapter, exportTaskStore);
      const task = exportTaskService.createTask(id);
      trackEvent(db, req.user!.id, 'download', parsed.source, id);
      res.status(202).json(task);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/api/standards/:id/download-session', requireAuth, async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const parsed = parseStandardId(id);
      const adapter = sourceRegistry.get(parsed.source);
      if (!adapter.createDownloadSession) {
        throw new BadRequestError(`Source ${parsed.source} does not support download sessions`);
      }

      const session = await adapter.createDownloadSession(id);
      res.status(201).json(session);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/api/standards/:id/auto-download', requireAuth, async (req, res, next) => {
    try {
      const id = req.params.id as string;
      const parsed = parseStandardId(id);
      const adapter = sourceRegistry.get(parsed.source);
      if (!adapter.autoDownload) {
        throw new BadRequestError(`Source ${parsed.source} does not support auto-download`);
      }

      const result = await adapter.autoDownload(id, 5);
      trackEvent(db, req.user!.id, 'download', parsed.source, id);
      res.json(result);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  // Multi-source download with auto-fallback
  router.post('/api/standards/multi-download', requireAuth, async (req, res, next) => {
    try {
      const bodySchema = z.object({
        sourceIds: z.record(z.string(), z.string()), // { gbw: 'gbw:xxx', bz: 'bz:yyy', ... }
        sources: z.array(sourceEnum).min(1),          // priority order: ['gbw','by','bz']
      });
      const { sourceIds, sources } = bodySchema.parse(req.body);

      const errors: Record<string, string> = {};
      for (const src of sources) {
        const standardId = sourceIds[src];
        if (!standardId) { errors[src] = '未提供此源的ID'; continue; }

        const adapter = sourceRegistry.get(src as SourceName);
        try {
          if (adapter.autoDownload) {
            const result = await adapter.autoDownload(standardId, 3);
            if (result.status === 'downloaded') {
              trackEvent(db, req.user!.id, 'download', src, standardId);
              res.json({ ...result, source: src });
              return;
            }
            errors[src] = result.status;
          } else if (adapter.exportStandard) {
            // Async adapter (bz, by) — use export and wait
            const exportResult = await adapter.exportStandard(standardId);
            trackEvent(db, req.user!.id, 'download', src, standardId);
            res.json({ source: src, status: 'downloaded', fileName: exportResult.fileName, fileSize: exportResult.fileSize });
            return;
          } else {
            errors[src] = '不支持下载';
          }
        } catch (e: any) {
          errors[src] = e.message || '下载失败';
        }
      }

      res.status(404).json({ status: 'failed', errors, message: '所有源均下载失败' });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/api/download-sessions/:sessionId/verify', requireAuth, async (req, res, next) => {
    try {
      const bodySchema = z.object({
        source: z.enum(['gbw']),
        code: z.string().trim().min(4).max(4),
      });
      const { source, code } = bodySchema.parse(req.body);
      const adapter = sourceRegistry.get(source);
      if (!adapter.submitDownloadCaptcha) {
        throw new BadRequestError(`Source ${source} does not support captcha verification`);
      }

      const result = await adapter.submitDownloadCaptcha(req.params.sessionId as string, code);
      res.json(result);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/api/download-sessions/:sessionId', requireAuth, async (req, res, next) => {
    try {
      const source = (req.query.source as string | undefined) ?? 'gbw';
      if (source !== 'gbw') {
        throw new BadRequestError(`Unsupported download session source: ${source}`);
      }

      const adapter = sourceRegistry.get(source as 'gbw');
      if (!adapter.getDownloadSession) {
        throw new BadRequestError('Source gbw does not support download session lookup');
      }

      const session = await adapter.getDownloadSession(req.params.sessionId as string);
      res.json(session);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/api/standards/complete', requireAuth, upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) {
        throw new BadRequestError('请上传文件');
      }

      const bodySchema = z.object({
        sources: z.array(sourceEnum).min(1).optional(),
        inputColumn: z.string().trim().min(1).max(3).optional(),
        outputColumn: z.string().trim().min(1).max(3).optional(),
        preserveStyle: z.boolean().optional(),
        includeSource: z.boolean().optional(),
        includeStatus: z.boolean().optional(),
        includeDownloadLink: z.boolean().optional(),
        includeTextFlag: z.boolean().optional(),
      });
      const parsedBody = bodySchema.parse({
        sources: req.body.sources ? JSON.parse(req.body.sources) : undefined,
        inputColumn: req.body.inputColumn,
        outputColumn: req.body.outputColumn,
        preserveStyle: req.body.preserveStyle === 'true',
        includeSource: req.body.includeSource !== 'false',
        includeStatus: req.body.includeStatus !== 'false',
        includeDownloadLink: req.body.includeDownloadLink === 'true',
        includeTextFlag: req.body.includeTextFlag === 'true',
      });
      const { sources } = parsedBody;
      const colToIndex = (value: string | undefined, fallback: number) => {
        const s = (value || '').trim().toUpperCase();
        if (!s) return fallback;
        if (/^\d+$/.test(s)) return Math.max(0, Number(s) - 1);
        let index = 0;
        for (const ch of s) index = index * 26 + (ch.charCodeAt(0) - 64);
        return Math.max(0, index - 1);
      };
      const inputCol = colToIndex(parsedBody.inputColumn, 0);
      const outputCol = colToIndex(parsedBody.outputColumn, 1);

      // Parse workbook — lazy load xlsx only when needed
      const XLSX = (await import('xlsx')).default;
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new BadRequestError('表格为空或格式无法识别');
      const sheet = workbook.Sheets[sheetName];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      // Extract column A, skip header row if it looks like a header
      const lines: string[] = [];
      let startRow = 0;
      const firstVal = String(rows[0]?.[inputCol] ?? '').trim();
      if (firstVal && !/[A-Z]{2,}/i.test(firstVal)) {
        startRow = 1; // Skip header row
      }
      for (let i = startRow; i < rows.length; i++) {
        const val = String(rows[i]?.[inputCol] ?? '').trim();
        if (val) lines.push(val);
      }

      if (lines.length === 0) throw new BadRequestError(`未在${parsedBody.inputColumn || 'A'}列找到有效的标准号`);

      // Resolve
      const selectedSources = (sources ?? sourceRegistry.list()) as SourceName[];
      const resolver = new StandardResolver(sourceRegistry);
      const { resolved, unmatched } = await resolver.resolve(lines, selectedSources);

      // Build lookup map
      const lookup = new Map<string, (typeof resolved)[0]>();
      for (const r of resolved) {
        const key = r.input.trim();
        if (!lookup.has(key)) lookup.set(key, r);
      }

      const outputHeaders = ['标准号', '标准名称'];
      if (parsedBody.includeStatus) outputHeaders.push('状态');
      if (parsedBody.includeSource) outputHeaders.push('来源');
      if (parsedBody.includeDownloadLink) outputHeaders.push('下载链接');
      if (parsedBody.includeTextFlag) outputHeaders.push('是否有文本');
      outputHeaders.push('备注');

      const rowValues = (original: string) => {
        const match = lookup.get(original);
        if (match) {
          const values = [match.standardNumber, match.title];
          if (parsedBody.includeStatus) values.push(match.status ?? '');
          if (parsedBody.includeSource) values.push(match.source);
          if (parsedBody.includeDownloadLink) values.push(`/api/standards/${encodeURIComponent(match.standardId)}/export`);
          if (parsedBody.includeTextFlag) values.push('未检测');
          values.push('');
          return values;
        }
        const values = ['', ''];
        if (parsedBody.includeStatus) values.push('');
        if (parsedBody.includeSource) values.push('');
        if (parsedBody.includeDownloadLink) values.push('');
        if (parsedBody.includeTextFlag) values.push('');
        values.push(unmatched.find(u => u.input === original)?.reason ?? '未匹配');
        return values;
      };

      let outWorkbook: any;
      let outSheet: any;
      if (parsedBody.preserveStyle) {
        outWorkbook = workbook;
        outSheet = sheet;
        outputHeaders.forEach((header, offset) => {
          outSheet[XLSX.utils.encode_cell({ r: Math.max(0, startRow - 1), c: outputCol + offset })] = { t: 's', v: header };
        });
        for (let i = startRow; i < rows.length; i++) {
          const original = String(rows[i]?.[inputCol] ?? '').trim();
          if (!original) continue;
          rowValues(original).forEach((value, offset) => {
            outSheet[XLSX.utils.encode_cell({ r: i, c: outputCol + offset })] = { t: 's', v: value };
          });
        }
        const range = XLSX.utils.decode_range(outSheet['!ref'] || 'A1:A1');
        range.e.c = Math.max(range.e.c, outputCol + outputHeaders.length - 1);
        range.e.r = Math.max(range.e.r, rows.length - 1);
        outSheet['!ref'] = XLSX.utils.encode_range(range);
        outSheet['!cols'] = outSheet['!cols'] || [];
        outputHeaders.forEach((_header, offset) => {
          outSheet['!cols']![outputCol + offset] = { wch: offset === 1 ? 50 : 18 };
        });
      } else {
        const outRows: string[][] = [];
        outRows.push(['用户提供', ...outputHeaders]);
        for (let i = startRow; i < rows.length; i++) {
          const original = String(rows[i]?.[inputCol] ?? '').trim();
          if (!original) continue;
          outRows.push([original, ...rowValues(original)]);
        }
        outWorkbook = XLSX.utils.book_new();
        outSheet = XLSX.utils.aoa_to_sheet(outRows);
        outSheet['!cols'] = [
          { wch: 25 }, { wch: 28 }, { wch: 50 }, ...outputHeaders.slice(2).map(() => ({ wch: 18 })),
        ];
        XLSX.utils.book_append_sheet(outWorkbook, outSheet, '标准补全结果');
      }

      // Write output file
      const exportsDir = path.resolve(baseDir, 'data', 'exports');
      await mkdir(exportsDir, { recursive: true });
      const outFileName = `标准补全_${Date.now()}.xlsx`;
      const outPath = path.resolve(exportsDir, outFileName);
      const buf = XLSX.write(outWorkbook, { type: 'buffer', bookType: 'xlsx' });
      await writeFile(outPath, buf);

      trackEvent(db, req.user!.id, 'complete', undefined, undefined, {
        fileName: outFileName, totalLines: lines.length, resolved: resolved.length, unmatched: unmatched.length,
      });

      res.json({
        fileName: outFileName,
        downloadUrl: `/api/downloads/${encodeURIComponent(outFileName)}`,
        summary: {
          total: lines.length,
          resolved: resolved.length,
          unmatched: unmatched.length,
        },
      });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/api/tasks/:taskId', requireAuth, async (req, res, next) => {
    try {
      const task = exportTaskStore.get(req.params.taskId as string);
      if (!task) {
        throw new NotFoundError(`Export task not found: ${req.params.taskId as string}`);
      }
      res.json(task);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  // SSE endpoint for real-time task progress
  router.get('/api/tasks/:taskId/stream', requireAuth, (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const taskId = req.params.taskId as string;
    const interval = setInterval(() => {
      const task = exportTaskStore.get(taskId);
      if (task) {
        res.write(`data: ${JSON.stringify(task)}\n\n`);
        if (task.status === 'success' || task.status === 'failed') {
          clearInterval(interval);
          res.end();
        }
      }
    }, 500);

    // Timeout to prevent permanent timer for non-existent tasks
    const timeout = setTimeout(() => {
      clearInterval(interval);
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify({ id: taskId, status: 'failed', error: 'Task not found or expired' })}\n\n`);
        res.end();
      }
    }, 10000);

    req.on('close', () => { clearInterval(interval); clearTimeout(timeout); });
  });


  return router;
}
