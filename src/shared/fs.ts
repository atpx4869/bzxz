import { access, mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const DEFAULT_EXPORT_RETENTION_DAYS = 14;

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

export function getExportsDir(): string {
  return path.join(getRootDir(), 'data', 'exports');
}

export async function ensureDataDirs(): Promise<void> {
  await mkdir(getExportsDir(), { recursive: true });
  await cleanupOldExportFiles();
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

export async function cleanupOldExportFiles(retentionDays = getExportRetentionDays()): Promise<void> {
  const exportsDir = getExportsDir();
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

  let entries: string[];
  try {
    entries = await readdir(exportsDir);
  } catch {
    return;
  }

  await Promise.all(entries.map(async (name) => {
    const filePath = path.join(exportsDir, name);
    try {
      const info = await stat(filePath);
      if (info.isFile() && info.mtimeMs < cutoff) {
        await unlink(filePath);
      }
    } catch {
      // Ignore cleanup races; downloads should not fail because old files could not be removed.
    }
  }));
}

function getExportRetentionDays(): number {
  const raw = Number(process.env.BZXZ_EXPORT_RETENTION_DAYS ?? DEFAULT_EXPORT_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_EXPORT_RETENTION_DAYS;
}
