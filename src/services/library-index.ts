// 标准库扫描与索引服务（Phase 1 of 预览功能）
//
// 职责：
// 1. 扫描 standards_library_dir，把目录里的 PDF 解析成 (stdCode, year, source) 入索引
// 2. 增量扫描比对 mtime，仅重读变化项
// 3. 提供 lookupFile() 给预览端点用
//
// 不做：
// - 实时 watcher（Windows + OneDrive 易出怪问题）。靠启动扫描 + 手动重扫
// - 写入 / 下载（Phase 2 的事，那时下载流改造后会主动 INSERT）

import path from 'node:path';
import { promises as fs } from 'node:fs';
import type Database from 'better-sqlite3';
import { extractBaseCode } from './qualification-service';
import { resolveLibraryDir, isInsideLibrary } from '../shared/library-paths';
import type { SourceName } from '../domain/standard';

const SUPPORTED_SOURCES: ReadonlyArray<SourceName> = ['gbw', 'bz', 'by'];

// 文件名后缀里写的源名（用户可见标签）↔ 内部 canonical source。
// 命名时用 LABEL（"BW 国标网"出现在 UI），索引和 API 用 canonical。
const SOURCE_LABEL_TO_CANONICAL: Record<string, SourceName> = {
  BW: 'gbw', GBW: 'gbw',
  BZ: 'bz',
  BY: 'by',
};
const CANONICAL_TO_LABEL: Record<SourceName, string> = {
  gbw: 'BW',
  bz: 'BZ',
  by: 'BY',
};

export function sourceLabel(source: SourceName): string {
  return CANONICAL_TO_LABEL[source];
}

export interface LibraryFileRow {
  id: number;
  stdCodeNorm: string;
  year: string;
  source: SourceName;
  absPath: string;
  size: number;
  mtime: number;
  mime: string;
  indexedAt: string;
}

interface ParsedFilename {
  stdCodeRaw: string;
  stdCodeNorm: string;
  year: string;
  source: SourceName;
}

/**
 * 解析文件名。期望格式：`{stdCode} - {sourceLabel}.pdf`，例如
 *   "GB_T 3324-2024 - BW.pdf"
 *   "JJG 196-2006 - BZ.pdf"
 *
 * 兼容：
 * - 文件名里的 `_` 视作 `/`（写入时 `/` 被替换成 `_`）
 * - sourceLabel 大小写不敏感
 *
 * 返回 null 表示文件名不符合库格式，扫描时忽略（用户可能手动塞了别的 PDF）。
 */
export function parseLibraryFilename(name: string): ParsedFilename | null {
  if (!name.toLowerCase().endsWith('.pdf')) return null;
  const stem = name.slice(0, -4);

  // 从右侧匹配 ` - {SOURCE}`；锚定结尾避免标题里有 " - XX" 误匹配
  const m = stem.match(/^(.+?)\s*[-—]\s*([A-Za-z]+)\s*$/);
  if (!m) return null;
  const sourceRaw = m[2].toUpperCase();
  const source = SOURCE_LABEL_TO_CANONICAL[sourceRaw];
  if (!source) return null;

  // 把 _ 换回 / 让 extractBaseCode 能识别 /T、/Z 等
  const stdCodeRaw = m[1].trim().replace(/_/g, '/');
  if (!stdCodeRaw) return null;

  const stdCodeNorm = extractBaseCode(stdCodeRaw);
  if (!stdCodeNorm) return null;

  const yearMatch = stdCodeRaw.match(/-\s*(\d{4})\s*$/);
  const year = yearMatch ? yearMatch[1] : '';

  return { stdCodeRaw, stdCodeNorm, year, source };
}

/**
 * 构造库文件名（写入时用）：把 `/` 替换为 `_`，过滤非法字符，加 source 后缀。
 * 文件名里始终带源后缀（决策见 CHANGELOG 与 docs/PREVIEW.md）。
 */
export function buildLibraryFilename(stdCode: string, source: SourceName): string {
  // 与 shared/fs.ts buildFileName 一致：去 Windows 非法字符 + 折叠空白
  // 但保留 -、空格、中文。`/` 替换成 `_` 而非删掉，便于人工辨识。
  const safe = stdCode
    .replace(/\//g, '_')
    .replace(/[\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return `${safe || 'standard'} - ${CANONICAL_TO_LABEL[source]}.pdf`;
}

interface ScanResult {
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  skipped: number;
}

/**
 * 扫描库目录。
 *
 * 模式：
 * - 默认增量：对每个文件 stat，mtime 与 size 都没变就跳过；变了就 UPSERT
 * - full=true：先清表再全量扫；用于设置改路径 / 管理员手动触发
 *
 * 不递归子目录（保持库结构扁平，便于用户在文件管理器里直接看）。
 * Phase 2 可能加分类子目录（按发布机构 GB/JJG/HG…），届时再开递归。
 */
export async function scanLibrary(
  db: Database.Database,
  options: { full?: boolean } = {},
): Promise<ScanResult> {
  const status = await resolveLibraryDir(db);
  const result: ScanResult = { scanned: 0, added: 0, updated: 0, removed: 0, skipped: 0 };
  if (!status.writable) return result;

  const libDir = status.dir;
  await fs.mkdir(libDir, { recursive: true }).catch(() => { /* probe 已经 mkdir 过；忽略 */ });

  if (options.full) {
    db.prepare('DELETE FROM standard_files').run();
  }

  // 现有索引快照：abs_path → { mtime, size, id }
  const existingRows = db.prepare(
    'SELECT id, abs_path, mtime, size FROM standard_files'
  ).all() as Array<{ id: number; abs_path: string; mtime: number; size: number }>;
  const existingByPath = new Map(existingRows.map(r => [r.abs_path, r]));
  const seenPaths = new Set<string>();

  let entries: string[];
  try {
    entries = await fs.readdir(libDir);
  } catch {
    return result;
  }

  const upsert = db.prepare(`
    INSERT INTO standard_files (std_code_norm, year, source, abs_path, size, mtime, mime)
    VALUES (?, ?, ?, ?, ?, ?, 'application/pdf')
    ON CONFLICT(std_code_norm, year, source) DO UPDATE SET
      abs_path = excluded.abs_path,
      size = excluded.size,
      mtime = excluded.mtime,
      indexed_at = datetime('now')
  `);

  for (const name of entries) {
    if (!name.toLowerCase().endsWith('.pdf')) { result.skipped++; continue; }
    const absPath = path.join(libDir, name);
    if (!isInsideLibrary(absPath, libDir)) { result.skipped++; continue; }

    let stat;
    try { stat = await fs.stat(absPath); } catch { continue; }
    if (!stat.isFile()) continue;
    seenPaths.add(absPath);
    result.scanned++;

    const existing = existingByPath.get(absPath);
    const mtimeMs = Math.floor(stat.mtimeMs);
    if (existing && existing.mtime === mtimeMs && existing.size === stat.size && !options.full) {
      result.skipped++;
      continue;
    }

    const parsed = parseLibraryFilename(name);
    if (!parsed) { result.skipped++; continue; }

    try {
      upsert.run(parsed.stdCodeNorm, parsed.year, parsed.source, absPath, stat.size, mtimeMs);
      existing ? result.updated++ : result.added++;
    } catch {
      // 唯一约束冲突：同 (norm, year, source) 已有另一个 abs_path
      // 保留旧的，新的当作 skipped（用户手动复制粘贴产生的重复，由扫描日志告知）
      result.skipped++;
    }
  }

  // 清理：表里有但磁盘上没了的行（用户手动删了文件）
  if (!options.full) {
    for (const row of existingRows) {
      if (!seenPaths.has(row.abs_path)) {
        db.prepare('DELETE FROM standard_files WHERE id = ?').run(row.id);
        result.removed++;
      }
    }
  }

  return result;
}

/**
 * 预览查询：按源优先级返回首个命中行。
 * sources 数组 = 全局优先级（来自 setting）或请求级 override，从左往右匹配。
 * year 可选 —— 不传则任意年份命中（用户搜不带年份的关键词时）。
 *
 * 二次校验 fs.access：用户手动删了文件后，扫描清表前可能有 race，
 * 这里再校验一次防止返回 404 文件 ID。校验失败的行就地清掉，下次查询走正常路径。
 */
export async function lookupFile(
  db: Database.Database,
  params: { stdCode: string; year?: string; sources?: SourceName[] },
): Promise<LibraryFileRow | null> {
  const norm = extractBaseCode(params.stdCode);
  if (!norm) return null;

  const sources = params.sources && params.sources.length > 0
    ? params.sources.filter((s): s is SourceName => SUPPORTED_SOURCES.includes(s as SourceName))
    : SUPPORTED_SOURCES;
  if (sources.length === 0) return null;

  const yearClause = params.year ? 'AND year = ?' : '';
  const args: any[] = [norm];
  if (params.year) args.push(params.year);

  // 一次查出所有匹配再按 sources 顺序挑，避免循环里 N 次 SQL
  const rows = db.prepare(`
    SELECT id, std_code_norm, year, source, abs_path, size, mtime, mime, indexed_at
    FROM standard_files
    WHERE std_code_norm = ? ${yearClause}
  `).all(...args) as Array<{
    id: number; std_code_norm: string; year: string; source: string;
    abs_path: string; size: number; mtime: number; mime: string; indexed_at: string;
  }>;
  if (rows.length === 0) return null;

  for (const src of sources) {
    const row = rows.find(r => r.source === src);
    if (!row) continue;
    try {
      await fs.access(row.abs_path);
    } catch {
      db.prepare('DELETE FROM standard_files WHERE id = ?').run(row.id);
      continue;
    }
    return {
      id: row.id,
      stdCodeNorm: row.std_code_norm,
      year: row.year,
      source: row.source as SourceName,
      absPath: row.abs_path,
      size: row.size,
      mtime: row.mtime,
      mime: row.mime,
      indexedAt: row.indexed_at,
    };
  }

  return null;
}

/** 按 id 查行（预览 file 端点用）。同样做 fs.access 校验。 */
export async function getFileById(db: Database.Database, id: number): Promise<LibraryFileRow | null> {
  const row = db.prepare(`
    SELECT id, std_code_norm, year, source, abs_path, size, mtime, mime, indexed_at
    FROM standard_files WHERE id = ?
  `).get(id) as any;
  if (!row) return null;
  try {
    await fs.access(row.abs_path);
  } catch {
    db.prepare('DELETE FROM standard_files WHERE id = ?').run(id);
    return null;
  }
  return {
    id: row.id,
    stdCodeNorm: row.std_code_norm,
    year: row.year,
    source: row.source as SourceName,
    absPath: row.abs_path,
    size: row.size,
    mtime: row.mtime,
    mime: row.mime,
    indexedAt: row.indexed_at,
  };
}

export function getIndexStats(db: Database.Database): { count: number; lastIndexedAt: string | null } {
  const row = db.prepare(`
    SELECT COUNT(*) AS count, MAX(indexed_at) AS last_indexed_at FROM standard_files
  `).get() as { count: number; last_indexed_at: string | null };
  return { count: row.count, lastIndexedAt: row.last_indexed_at };
}
