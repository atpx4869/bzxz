// Page count cache — persisted to file so survives restarts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getRootDir } from './fs';

interface CacheData {
  [standardNo: string]: { count: number; updatedAt: string };
}

const CACHE_FILE = path.join(getRootDir(), 'data', '.page-cache.json');
let memoryCache: CacheData | null = null;

function load(): CacheData {
  if (memoryCache) return memoryCache;
  try {
    if (existsSync(CACHE_FILE)) {
      memoryCache = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
      return memoryCache!;
    }
  } catch {}
  memoryCache = {};
  return memoryCache!;
}

function save(data: CacheData): void {
  memoryCache = data;
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!existsSync(dir)) {
      const { mkdirSync } = require('node:fs');
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch {}
}

export function getCachedPageCount(standardNo: string): number | null {
  const data = load();
  const entry = data[standardNo];
  if (!entry) return null;
  // Cache for 30 days
  if (Date.now() - new Date(entry.updatedAt).getTime() > 30 * 24 * 60 * 60 * 1000) return null;
  return entry.count;
}

export function setCachedPageCount(standardNo: string, count: number): void {
  const data = load();
  data[standardNo] = { count, updatedAt: new Date().toISOString() };
  save(data);
}
