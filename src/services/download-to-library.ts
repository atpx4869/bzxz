// 下载入库 hook（Phase 2）。adapter 把 PDF 写到 data/exports/ 里某个 filePath，
// 这里立刻 move 到 standards_library_dir 下，按 admin 模板重命名，UPSERT 索引。
//
// 失败容忍：addFileToLibrary 抛错只记日志，不动响应 —— 用户的下载体验不能因
// "入库逻辑出问题"而崩。失败的文件会留在 exports/，/api/downloads 仍可服务。
// 返回值带回新的 absPath / fileName / fileId，便于上层把 downloadUrl 改成
// /api/preview/file/:id 而非旧的 /api/downloads/:filename，省一次磁盘 IO。
//
// 抽出到独立 service 是因为 preview-routes（自动下载预览流）也要复用。

import type Database from 'better-sqlite3';
import type { SourceRegistry } from './source-registry';
import type { SourceName } from '../domain/standard';
import { addFileToLibrary } from './library-index';

export async function moveDownloadToLibrary(
  db: Database.Database,
  sourceRegistry: SourceRegistry,
  source: SourceName,
  standardId: string,
  result: { filePath?: string; fileName?: string; fileSize?: number },
): Promise<{ fileId?: number; absPath?: string; fileName?: string; libraryUrl?: string }> {
  if (!result.filePath) return {};
  try {
    let stdCode = '';
    let title = '';
    try {
      const adapter = sourceRegistry.get(source);
      const detail = await adapter.getStandardDetail(standardId);
      stdCode = detail.standardNumber;
      title = detail.title;
    } catch { /* detail 拿不到 → 用文件名 stem 当 stdCode */ }
    if (!stdCode && result.fileName) {
      stdCode = result.fileName.replace(/\.pdf$/i, '');
    }
    if (!stdCode) return {};

    const moved = await addFileToLibrary(db, {
      srcPath: result.filePath,
      stdCode,
      source,
      title,
    });
    return {
      fileId: moved.fileId,
      absPath: moved.absPath,
      fileName: moved.fileName,
      libraryUrl: `/api/preview/file/${moved.fileId}?attachment=1`,
    };
  } catch (e) {
    console.error('[library] moveDownloadToLibrary failed:', e);
    return {};
  }
}
