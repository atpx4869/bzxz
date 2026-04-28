import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const ROOT_DIR = process.env.BZXZ_BASE_DIR || process.cwd();
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

export async function ensureDataDirs(): Promise<void> {
  await mkdir(EXPORTS_DIR, { recursive: true });
}

export async function safeWriteExportFile(fileName: string, data: Buffer | string): Promise<string> {
  const resolved = path.resolve(EXPORTS_DIR, fileName);
  if (!resolved.startsWith(EXPORTS_DIR + path.sep)) {
    throw new Error(`Path traversal detected: ${fileName}`);
  }
  await writeFile(resolved, data);
  return resolved;
}
