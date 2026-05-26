// 标准库路径解析与可写性探针（Phase 1 of 预览功能）
//
// 设计要点：
// - 默认路径放在 exe 同级 `/standards/`，不放 C 盘 userData（避免 C 盘膨胀）。
// - 但 Windows 用户如果把 bzxz 装到 Program Files，普通用户没写权限。
//   startup 时写一个 1 字节探针文件，失败就回退到 userData/standards 并挂 banner。
// - 用户可在设置里手动改路径，覆盖默认值与自动回退。

import path from 'node:path';
import { promises as fs } from 'node:fs';
import type Database from 'better-sqlite3';
import { getRootDir } from './fs';
import { getSetting, setSetting } from '../services/db';

export interface LibraryStatus {
  /** 当前实际生效的库根目录绝对路径 */
  dir: string;
  /** 是否可写（探针通过） */
  writable: boolean;
  /** 是否使用了回退路径（用户配置的或默认的路径不可写） */
  fallbackUsed: boolean;
  /** 回退原因（写给 banner 看） */
  fallbackReason: string;
  /** 用户在设置里配的原始值（空字符串代表用默认） */
  configuredDir: string;
}

let cachedStatus: LibraryStatus | null = null;

/**
 * exe 同级目录（生产）/ 仓库根（dev）。
 * Electron 生产模式 main.ts 应把可执行文件路径写入 BZXZ_EXE_DIR，
 * 这里就读它；fallback 到 BZXZ_BASE_DIR / cwd。
 */
function getDefaultLibraryDir(): string {
  const exeDir = process.env.BZXZ_EXE_DIR;
  if (exeDir) return path.join(exeDir, 'standards');
  return path.join(getRootDir(), 'standards');
}

/**
 * userData 回退路径。Electron 主进程应把 app.getPath('userData') 写入
 * BZXZ_USER_DATA_DIR；非 Electron 模式（开发 / 测试）下用临时目录占位。
 */
function getFallbackLibraryDir(): string {
  const userData = process.env.BZXZ_USER_DATA_DIR;
  if (userData) return path.join(userData, 'standards');
  // dev / test 兜底：用 data/standards-fallback 与正常 standards 区分
  return path.join(getRootDir(), 'data', 'standards-fallback');
}

/**
 * 探针：尝试 mkdir + 写一个 1 字节文件 + 删除。任何一步抛 EACCES / EPERM
 * 就视为不可写（典型场景：Windows Program Files 普通用户）。
 */
async function probeWritable(dir: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = path.join(dir, `.bzxz-write-probe-${Date.now()}.tmp`);
    await fs.writeFile(probe, '.', { flag: 'w' });
    await fs.unlink(probe).catch(() => { /* probe 残留下次清理周期会带走 */ });
    return { ok: true };
  } catch (e: any) {
    const code = e?.code || 'UNKNOWN';
    return { ok: false, reason: `${code}: ${e?.message || '未知错误'}` };
  }
}

/**
 * 解析当前库目录：
 * 1. 读 setting `standards_library_dir`，空串则用 default
 * 2. 探针，写得通就用它
 * 3. 写不通：回退到 userData/standards，再探针一次
 * 4. 再不通：硬塞默认值并记录 reason，让 UI banner 抛红字
 *
 * 结果缓存到 cachedStatus，避免每次预览都跑 fs 探针。
 * 改了设置 / 重启进程会重置缓存。
 */
export async function resolveLibraryDir(db: Database.Database): Promise<LibraryStatus> {
  if (cachedStatus) return cachedStatus;

  const configured = getSetting(db, 'standards_library_dir', '').trim();
  const preferred = configured || getDefaultLibraryDir();
  const preferredAbs = path.resolve(preferred);

  const preferredProbe = await probeWritable(preferredAbs);
  if (preferredProbe.ok) {
    cachedStatus = {
      dir: preferredAbs,
      writable: true,
      fallbackUsed: false,
      fallbackReason: '',
      configuredDir: configured,
    };
    return cachedStatus;
  }

  const fallback = getFallbackLibraryDir();
  const fallbackAbs = path.resolve(fallback);
  const fallbackProbe = await probeWritable(fallbackAbs);
  cachedStatus = {
    dir: fallbackProbe.ok ? fallbackAbs : preferredAbs,
    writable: fallbackProbe.ok,
    fallbackUsed: true,
    fallbackReason: `首选路径 "${preferredAbs}" 不可写（${preferredProbe.reason}），${fallbackProbe.ok ? `已临时使用 "${fallbackAbs}"` : `回退路径也不可写（${fallbackProbe.reason}）`}`,
    configuredDir: configured,
  };
  return cachedStatus;
}

/**
 * 用户在设置里改路径后调用。验证新路径可写、保存到 settings、清缓存。
 * 抛错时不写 settings，让前端拿到错误并 4xx。
 */
export async function setLibraryDir(db: Database.Database, newDir: string): Promise<LibraryStatus> {
  const trimmed = newDir.trim();
  if (trimmed) {
    const abs = path.resolve(trimmed);
    const probe = await probeWritable(abs);
    if (!probe.ok) {
      throw new Error(`目录不可写：${probe.reason}`);
    }
  }
  setSetting(db, 'standards_library_dir', trimmed);
  cachedStatus = null;
  return resolveLibraryDir(db);
}

/** 测试 / 单测专用：清缓存让下次 resolveLibraryDir 重跑探针。 */
export function _resetLibraryPathCacheForTesting(): void {
  cachedStatus = null;
}

/**
 * 安全校验：返回的绝对路径必须落在当前库根之内，防止扫描跟随 symlink
 * 把库外文件纳入索引（预览端点也会再校验一次）。
 */
export function isInsideLibrary(absPath: string, libraryDir: string): boolean {
  const resolvedPath = path.resolve(absPath);
  const resolvedRoot = path.resolve(libraryDir);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + path.sep);
}
