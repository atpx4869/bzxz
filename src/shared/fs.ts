import { mkdir } from 'node:fs/promises';
import path from 'node:path';

export const ROOT_DIR = process.cwd();
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

export async function ensureDataDirs(): Promise<void> {
  await mkdir(EXPORTS_DIR, { recursive: true });
}
