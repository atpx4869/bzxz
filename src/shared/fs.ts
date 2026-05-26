import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

// Phase 2 起：标准 PDF 永久保留在 standards 库目录（resolveLibraryDir），不再走
// data/exports/ 中转 + 14 天清理。exports/ 只剩补全功能输出的 xlsx 报表，那些也
// 不再自动清理 —— 用户决定。

export function buildFileName(standardNumber: string, title: string, ext = 'pdf'): string {
  const safeNum = standardNumber.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  const safeTitle = title.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  const joined = [safeNum, safeTitle].filter(Boolean).join(' ');
  const suffix = `${Date.now().toString(36)}-${randomBytes(2).toString('hex')}`;
  return `${joined || 'standard'}_${suffix}.${ext}`;
}

export function getRootDir(): string {
  return process.env.BZXZ_BASE_DIR || process.cwd();
}

/**
 * Directory holding read-only bundled assets (public/, scripts/ocr_ddddocr.py).
 * In Electron packaged mode this is `process.resourcesPath` (set by
 * electron/main.ts via BZXZ_STATIC_DIR). In dev mode it defaults to the
 * same root as writable data, so paths still resolve correctly.
 */
export function getStaticDir(): string {
  return process.env.BZXZ_STATIC_DIR || getRootDir();
}

/**
 * exports/ 现在只用于补全功能输出的 xlsx 报表。adapter 下载 PDF 仍然先写到这里，
 * 然后由 standards-routes 立刻 move 进 standards 库目录（addFileToLibrary）。
 * 文件不再有 14 天自动清理。
 */
export function getExportsDir(): string {
  return path.join(getRootDir(), 'data', 'exports');
}

export async function ensureDataDirs(): Promise<void> {
  await mkdir(getExportsDir(), { recursive: true });
}

export async function safeWriteExportFile(fileName: string, data: Buffer | string): Promise<string> {
  const exportsDir = getExportsDir();
  await mkdir(exportsDir, { recursive: true });
  const resolved = path.resolve(exportsDir, await uniqueExportFileName(fileName));
  if (!resolved.startsWith(exportsDir + path.sep)) {
    throw new Error(`Path traversal detected: ${fileName}`);
  }
  await writeFile(resolved, data);
  return resolved;
}

async function uniqueExportFileName(fileName: string): Promise<string> {
  const exportsDir = getExportsDir();
  const parsed = path.parse(fileName);
  let candidate = fileName;
  let index = 1;

  while (await exists(path.join(exportsDir, candidate))) {
    candidate = `${parsed.name}_${Date.now().toString(36)}-${index}${parsed.ext}`;
    index++;
  }
  return candidate;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
