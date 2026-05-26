// 标准 PDF 预览端点（Phase 1 of 预览功能）
//
// 两条端点：
// - POST /api/preview/request — 查本地库，命中返回 fileId + 直链；未命中返回
//   not_in_library 让前端提示用户先下载（Phase 2 才会自动触发下载）
// - GET  /api/preview/file/:id — 流式回 PDF，支持 HTTP Range、ETag、内联打开
//
// 安全要点：
// - stdCode / source 永远当 SQL 参数用，不拼路径
// - file 端点返回前 isInsideLibrary 二次校验（防扫描时跟随 symlink 出界）
// - requireAuth（含 guest），与搜索口径一致

import { Router } from 'express';
import { z } from 'zod';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Request, Response, NextFunction } from 'express';
import { lookupFile, getFileById } from '../services/library-index';
import { resolveLibraryDir, isInsideLibrary } from '../shared/library-paths';
import { respond, respondError } from '../shared/response';
import { normalizeError } from '../shared/errors';
import { getSetting } from '../services/db';
import type { SourceName } from '../domain/standard';
import type { SourceRegistry } from '../services/source-registry';
import { moveDownloadToLibrary } from '../services/download-to-library';
import { createTask, updateTask, getTask } from '../services/preview-task-store';
import { trackEvent } from '../services/usage-tracker';
import { StandardService } from '../services/standard-service';

const sourceEnum = z.enum(['gbw', 'bz', 'by']);
const DEFAULT_SOURCE_PRIORITY: SourceName[] = ['gbw', 'bz', 'by'];

/**
 * 从 settings.library_source_priority 读全局优先级；坏数据 / 缺设置 → 用默认。
 * 请求级 sources 参数会覆盖这里读出的全局值。
 */
function getConfiguredSourcePriority(db: Database.Database): SourceName[] {
  const raw = getSetting(db, 'library_source_priority', '');
  if (!raw) return DEFAULT_SOURCE_PRIORITY;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_SOURCE_PRIORITY;
    const filtered = parsed.filter((s): s is SourceName =>
      s === 'gbw' || s === 'bz' || s === 'by');
    return filtered.length > 0 ? filtered : DEFAULT_SOURCE_PRIORITY;
  } catch {
    return DEFAULT_SOURCE_PRIORITY;
  }
}

export function createPreviewRoutes(
  db: Database.Database,
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
  sourceRegistry: SourceRegistry,
) {
  const router = Router();

  /**
   * 后台跑下载 + 入库（Phase 2 自动下载预览流）。
   *
   * 入参：preview/request 已经算好的 sources 优先级 + stdCode + 可选 year。
   * 行为：按优先级顺序找匹配 → adapter.autoDownload / exportStandard → moveDownloadToLibrary。
   * 任一源成功 → 任务标 ready，带 fileId。所有源都失败 → 任务标 failed，前端提示。
   *
   * 不阻塞 HTTP 响应：preview/request 立刻返回 taskId，前端去打 /api/preview/task/:taskId 轮询。
   * 这是单进程内存任务（preview-task-store），重启即丢失（用户重点预览即可）。
   */
  async function runAutoDownload(taskId: string, userId: number, stdCode: string, year: string | undefined, sources: SourceName[]): Promise<void> {
    updateTask(taskId, { status: 'downloading' });
    for (const src of sources) {
      try {
        const adapter = sourceRegistry.get(src);
        // 1) 用标准号搜索这个源 → 拿到对应 ID
        const service = new StandardService(adapter);
        const searchResults = await service.searchStandards({ query: stdCode });
        const norm = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const wanted = norm(stdCode);
        const match = searchResults.find(item => {
          if (norm(item.standardNumber) !== wanted) return false;
          if (year && item.year && item.year !== year) return false;
          return true;
        }) || searchResults.find(item => norm(item.standardNumber) === wanted);
        if (!match) continue;

        // 2) 下载（autoDownload 优先；不支持时用 exportStandard 兜底）
        let result: { filePath?: string; fileName?: string; fileSize?: number; status?: string } | null = null;
        if (adapter.autoDownload) {
          const r = await adapter.autoDownload(match.id, userId, 3);
          if (r.status === 'downloaded') result = r;
        } else if (adapter.exportStandard) {
          const r = await adapter.exportStandard(match.id);
          result = { ...r, status: 'downloaded' };
        }
        if (!result || !result.filePath) continue;

        trackEvent(db, userId, 'download', src, match.id, { autoTriggeredBy: 'preview' });

        // 3) 入库
        const moved = await moveDownloadToLibrary(db, sourceRegistry, src, match.id, result);
        if (moved.fileId) {
          updateTask(taskId, { status: 'ready', fileId: moved.fileId, source: src });
          return;
        }
      } catch (e: any) {
        console.error(`[preview-task] ${src} 下载失败:`, e?.message || e);
        // 继续试下一个源
      }
    }
    updateTask(taskId, { status: 'failed', error: '所有源都未能下载到此标准' });
  }

  router.post('/api/preview/request', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({
        stdCode: z.string().trim().min(2).max(64),
        year: z.string().regex(/^\d{4}$/).optional(),
        sources: z.array(sourceEnum).optional(),
      });
      const { stdCode, year, sources } = schema.parse(req.body);

      const effectiveSources = sources && sources.length > 0
        ? sources
        : getConfiguredSourcePriority(db);
      const file = await lookupFile(db, {
        stdCode,
        year,
        sources: effectiveSources,
      });

      if (!file) {
        // Phase 2：未命中 → 后台触发自动下载 + 入库，前端 poll /api/preview/task/:id
        const taskId = createTask();
        const userId = (req as any).user?.id as number;
        // fire-and-forget：runAutoDownload 内部把状态推进 store
        runAutoDownload(taskId, userId, stdCode, year, effectiveSources).catch((e) => {
          console.error('[preview-task] runAutoDownload threw:', e);
          updateTask(taskId, { status: 'failed', error: e?.message || '下载启动失败' });
        });
        respond(res, {
          status: 'downloading',
          stdCode,
          year: year ?? null,
          tried: effectiveSources,
          taskId,
        });
        return;
      }

      respond(res, {
        status: 'ready',
        fileId: file.id,
        source: file.source,
        year: file.year || null,
        size: file.size,
        url: `/api/preview/file/${file.id}`,
      });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  /**
   * 轮询自动下载任务状态。
   * - pending / downloading：前端继续轮询（建议 1500ms 间隔，下载常 5~30s）
   * - ready：响应里带 fileId，前端切到 /api/preview/file/:id 渲染 iframe
   * - failed：响应里带 error，前端提示用户失败 / 让其手动重试
   */
  router.get('/api/preview/task/:taskId', requireAuth, (req, res) => {
    const taskId = String(req.params.taskId || '');
    const status = getTask(taskId);
    if (!status) {
      respondError(res, 404, 'NOT_FOUND', '任务不存在或已过期');
      return;
    }
    if (status.status === 'ready') {
      respond(res, {
        status: 'ready',
        fileId: status.fileId,
        source: status.source,
        url: `/api/preview/file/${status.fileId}`,
      });
      return;
    }
    respond(res, status);
  });

  router.get('/api/preview/file/:id', requireAuth, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        respondError(res, 400, 'BAD_REQUEST', 'Invalid file id');
        return;
      }

      const file = await getFileById(db, id);
      if (!file) {
        respondError(res, 404, 'NOT_FOUND', '文件不存在或已被删除');
        return;
      }

      const libStatus = await resolveLibraryDir(db);
      if (!isInsideLibrary(file.absPath, libStatus.dir)) {
        // 库根改了之后旧索引行残留指向库外：拒绝服务、清行，下次扫描重建
        db.prepare('DELETE FROM standard_files WHERE id = ?').run(id);
        respondError(res, 410, 'GONE', '文件已不在当前库目录');
        return;
      }

      let stat;
      try { stat = await fs.stat(file.absPath); } catch {
        db.prepare('DELETE FROM standard_files WHERE id = ?').run(id);
        respondError(res, 404, 'NOT_FOUND', '文件不存在或已被删除');
        return;
      }

      // ETag 用 mtime + size，避免每次预览都跑 hash
      const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }

      const fileName = path.basename(file.absPath);
      // RFC 5987：filename* 编码 UTF-8 支持中文；filename= 兜底纯 ASCII 客户端。
      // ASCII 名再额外 escape `"` 和 `\`，避免用户手动塞名为 `a";x=...".pdf`
      // 的文件时破坏 header 结构（buildLibraryFilename 自己写出的文件不会有，
      // 但库目录里允许人为放文件，必须按不可信处理）。
      const asciiName = fileName
        .replace(/[^\x20-\x7E]/g, '_')
        .replace(/["\\]/g, '_');
      const dispositionType = req.query.attachment === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Type', file.mime || 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `${dispositionType}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
      res.setHeader('Accept-Ranges', 'bytes');

      const range = req.headers.range;
      if (!range) {
        res.setHeader('Content-Length', String(stat.size));
        createReadStream(file.absPath).pipe(res);
        return;
      }

      // Range: bytes=START-END，支持单 range；忽略多段（PDF.js 不需要）
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        return;
      }
      const startRaw = m[1];
      const endRaw = m[2];
      let start: number;
      let end: number;
      if (startRaw === '' && endRaw !== '') {
        // suffix range: bytes=-N → 最后 N 字节
        const suffix = Number(endRaw);
        if (!Number.isFinite(suffix) || suffix <= 0) {
          res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
          return;
        }
        start = Math.max(0, stat.size - suffix);
        end = stat.size - 1;
      } else {
        start = Number(startRaw);
        end = endRaw === '' ? stat.size - 1 : Number(endRaw);
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end >= stat.size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
        return;
      }

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      createReadStream(file.absPath, { start, end }).pipe(res);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  return router;
}
