import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function getRootDir(): string {
  return process.env.BZXZ_BASE_DIR || process.cwd();
}

export function getExportsDir(): string {
  return path.join(getRootDir(), 'data', 'exports');
}

export async function ensureDataDirs(): Promise<void> {
  await mkdir(getExportsDir(), { recursive: true });
}

export async function safeWriteExportFile(fileName: string, data: Buffer | string): Promise<string> {
  const exportsDir = getExportsDir();
  const resolved = path.resolve(exportsDir, fileName);
  if (!resolved.startsWith(exportsDir + path.sep)) {
    throw new Error(`Path traversal detected: ${fileName}`);
  }
  await writeFile(resolved, data);
  return resolved;
}
