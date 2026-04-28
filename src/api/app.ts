import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import multer from 'multer';
import XLSX from 'xlsx';

import { StandardService } from '../services/standard-service';
import { StandardResolver } from '../services/standard-resolver';
import { ExportTaskService } from '../services/export-task-service';
import { ExportTaskStore } from '../services/export-task-store';
import { SourceRegistry } from '../services/source-registry';
import { AppError, BadRequestError, NotFoundError } from '../shared/errors';
import { parseStandardId, VALID_SOURCES } from '../shared/id';
import type { SourceName } from '../domain/standard';

const SOURCES = [...VALID_SOURCES] as SourceName[];
const sourceEnum = z.enum(SOURCES as [string, ...string[]]);

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

export function createApp() {
  const app = express();
  const sourceRegistry = new SourceRegistry();
  const exportTaskStore = new ExportTaskStore();

  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), 'public')));

  // Serve exported files for browser download
  app.get('/api/downloads/:filename', (req, res) => {
    const exportsDir = path.resolve(process.cwd(), 'data', 'exports');
    const filePath = path.resolve(exportsDir, req.params.filename);
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

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, sources: sourceRegistry.list() });
  });

  app.get('/api/standards/search', async (req, res, next) => {
    try {
      const querySchema = z.object({
        q: z.string().trim().min(1, 'q is required').max(500),
        source: sourceEnum.optional(),
      });

      const { q, source } = querySchema.parse(req.query);
      const selectedSource = (source ?? 'bz') as SourceName;
      const service = new StandardService(sourceRegistry.get(selectedSource));
      const results = await service.searchStandards({ query: q });

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

  app.post('/api/standards/resolve', async (req, res, next) => {
    try {
      const bodySchema = z.object({
        lines: z.array(z.string().trim()).min(1, 'lines is required').max(200),
        sources: z.array(sourceEnum).min(1).optional(),
      });

      const { lines, sources } = bodySchema.parse(req.body);
      const selectedSources = (sources ?? sourceRegistry.list()) as SourceName[];
      const resolver = new StandardResolver(sourceRegistry);
      const result = await resolver.resolve(lines, selectedSources);
      res.json(result);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  app.get('/api/standards/:id', async (req, res, next) => {
    try {
      const parsed = parseStandardId(req.params.id);
      const service = new StandardService(sourceRegistry.get(parsed.source));
      const detail = await service.getStandardDetail(req.params.id);
      res.json(detail);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  app.post('/api/standards/:id/preview/detect', async (req, res, next) => {
    try {
      const parsed = parseStandardId(req.params.id);
      const service = new StandardService(sourceRegistry.get(parsed.source));
      const preview = await service.detectPreview(req.params.id);
      res.json(preview);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  app.post('/api/standards/:id/export', async (req, res, next) => {
    try {
      const parsed = parseStandardId(req.params.id);
      const adapter = sourceRegistry.get(parsed.source);
      const exportTaskService = new ExportTaskService(adapter, exportTaskStore);
      const task = exportTaskService.createTask(req.params.id);
      res.status(202).json(task);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  app.post('/api/standards/:id/download-session', async (req, res, next) => {
    try {
      const parsed = parseStandardId(req.params.id);
      const adapter = sourceRegistry.get(parsed.source);
      if (!adapter.createDownloadSession) {
        throw new BadRequestError(`Source ${parsed.source} does not support download sessions`);
      }

      const session = await adapter.createDownloadSession(req.params.id);
      res.status(201).json(session);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  app.post('/api/standards/:id/auto-download', async (req, res, next) => {
    try {
      const parsed = parseStandardId(req.params.id);
      const adapter = sourceRegistry.get(parsed.source);
      if (!adapter.autoDownload) {
        throw new BadRequestError(`Source ${parsed.source} does not support auto-download`);
      }

      const result = await adapter.autoDownload(req.params.id, 5);
      res.json(result);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  app.post('/api/download-sessions/:sessionId/verify', async (req, res, next) => {
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

      const result = await adapter.submitDownloadCaptcha(req.params.sessionId, code);
      res.json(result);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  app.get('/api/download-sessions/:sessionId', async (req, res, next) => {
    try {
      const source = (req.query.source as string | undefined) ?? 'gbw';
      if (source !== 'gbw') {
        throw new BadRequestError(`Unsupported download session source: ${source}`);
      }

      const adapter = sourceRegistry.get(source as 'gbw');
      if (!adapter.getDownloadSession) {
        throw new BadRequestError('Source gbw does not support download session lookup');
      }

      const session = await adapter.getDownloadSession(req.params.sessionId);
      res.json(session);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  app.post('/api/standards/complete', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) {
        throw new BadRequestError('请上传文件');
      }

      const bodySchema = z.object({
        sources: z.array(sourceEnum).min(1).optional(),
      });
      const { sources } = bodySchema.parse(req.body.sources ? { sources: JSON.parse(req.body.sources) } : {});

      // Parse workbook
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new BadRequestError('表格为空或格式无法识别');
      const sheet = workbook.Sheets[sheetName];
      const rows: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

      // Extract column A, skip header row if it looks like a header
      const lines: string[] = [];
      let startRow = 0;
      const firstVal = String(rows[0]?.[0] ?? '').trim();
      if (firstVal && !/[A-Z]{2,}/i.test(firstVal)) {
        startRow = 1; // Skip header row
      }
      for (let i = startRow; i < rows.length; i++) {
        const val = String(rows[i]?.[0] ?? '').trim();
        if (val) lines.push(val);
      }

      if (lines.length === 0) throw new BadRequestError('未在A列找到有效的标准号');

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

      // Build output sheet
      const outRows: string[][] = [];
      // Header
      outRows.push(['用户提供', '标准号', '标准名称', '状态', '来源', '备注']);
      for (let i = startRow; i < rows.length; i++) {
        const original = String(rows[i]?.[0] ?? '').trim();
        if (!original) continue;
        const match = lookup.get(original);
        if (match) {
          outRows.push([original, match.standardNumber, match.title, match.status ?? '', match.source, '']);
        } else {
          const unmatchReason = unmatched.find(u => u.input === original)?.reason ?? '未匹配';
          outRows.push([original, '', '', '', '', unmatchReason]);
        }
      }

      // Write output file
      const outWorkbook = XLSX.utils.book_new();
      const outSheet = XLSX.utils.aoa_to_sheet(outRows);
      // Set column widths
      outSheet['!cols'] = [
        { wch: 25 }, { wch: 28 }, { wch: 50 }, { wch: 12 }, { wch: 10 }, { wch: 30 },
      ];
      XLSX.utils.book_append_sheet(outWorkbook, outSheet, '标准补全结果');

      const exportsDir = path.resolve(process.cwd(), 'data', 'exports');
      await mkdir(exportsDir, { recursive: true });
      const outFileName = `标准补全_${Date.now()}.xlsx`;
      const outPath = path.resolve(exportsDir, outFileName);
      const buf = XLSX.write(outWorkbook, { type: 'buffer', bookType: 'xlsx' });
      await writeFile(outPath, buf);

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

  app.get('/api/tasks/:taskId', async (req, res, next) => {
    try {
      const task = exportTaskStore.get(req.params.taskId);
      if (!task) {
        throw new NotFoundError(`Export task not found: ${req.params.taskId}`);
      }
      res.json(task);
    } catch (error) {
      next(normalizeError(error));
    }
  });

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

function normalizeError(error: unknown): Error {
  if (error instanceof z.ZodError) {
    return new BadRequestError('Invalid request', error.flatten());
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error('Unknown error');
}
