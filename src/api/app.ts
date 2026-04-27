import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { StandardService } from '../services/standard-service';
import { ExportTaskService } from '../services/export-task-service';
import { ExportTaskStore } from '../services/export-task-store';
import { SourceRegistry } from '../services/source-registry';
import { AppError, BadRequestError, NotFoundError } from '../shared/errors';
import { parseStandardId } from '../shared/id';
import type { SourceName } from '../domain/standard';
import { GbwAdapter } from '../sources/gbw/gbw-adapter';

export function createApp() {
  const app = express();
  const sourceRegistry = new SourceRegistry();
  const exportTaskStore = new ExportTaskStore();

  app.use(express.json());
  app.use(express.static(path.join(process.cwd(), 'public')));

  // Serve exported files for browser download
  app.get('/api/downloads/:filename', (req, res) => {
    const filePath = path.join(process.cwd(), 'data', 'exports', req.params.filename);
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
        q: z.string().trim().min(1, 'q is required'),
        source: z.enum(['bz', 'gbw', 'by']).optional(),
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
      if (!(adapter as GbwAdapter).autoDownload) {
        throw new BadRequestError(`Source ${parsed.source} does not support auto-download`);
      }

      const result = await (adapter as GbwAdapter).autoDownload(req.params.id, 5);
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
