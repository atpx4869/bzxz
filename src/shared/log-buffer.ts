/**
 * In-memory ring buffer of recent server logs. Exposed via /api/diagnostics/logs
 * so the user can see what's happening on the backend without opening the
 * Electron dev console.
 *
 * We intercept console.warn / console.error / console.log on import. The
 * originals are still called so anyone with a real console still sees output.
 *
 * Phase 3：内存 buffer 之外，再按天追加落地到 <userData>/bzxz-logs/app-YYYYMMDD.log，
 * 这样进程重启后仍能在磁盘查历史（内存 buffer 重启即丢）。落地全程 best-effort：
 * 任何 I/O 失败都静默吞掉，绝不影响业务 / console。
 */

import * as fs from 'fs';
import * as path from 'path';

const MAX_ENTRIES = 500;
const LOG_RETENTION_DAYS = 14; // 按天文件保留天数（超期清理）

// 前端「运行日志」页用的模块分类（与前端 LOG_MODULES 对齐）。
export type LogModule = 'search' | 'download' | 'complete' | 'qual' | 'ocr' | 'local' | 'system';

export interface LogEntry {
  ts: string;
  level: 'log' | 'warn' | 'error';
  message: string;
  module: LogModule;
}

const buffer: LogEntry[] = [];

// 按消息里的 [前缀] / 关键词把后端日志归到前端同一套模块分类。
// 前缀来自现有 console 日志：[ocr-worker] [by-adapter] [gbw] [labr-service]
// [resolver] [cnas] [library] [library-watcher] [db] [db-backup] [env] [bzxz] 等。
function inferModule(message: string): LogModule {
  const m = message.toLowerCase();
  if (/\bocr-worker\b|验证码|\bocr\b/.test(m)) return 'ocr';
  if (/\bresolver\b|search|搜索|anti-bot/.test(m)) return 'search';
  if (/\bgbw\b|\bby-adapter\b|\bpreview-task\b|download|下载|pdf-merge/.test(m)) return 'download';
  if (/补全|complete/.test(m)) return 'complete';
  if (/\bcnas\b|\bcma\b|\blabr|资质|qualif|同步|sync/.test(m)) return 'qual';
  if (/\blibrary\b|library-watcher|扫描|文件库/.test(m)) return 'local';
  return 'system';
}

// ── 按天文件落地（best-effort，失败静默）──────────────────────────────
// 目录优先 BZXZ_USER_DATA_DIR（Electron 主进程写入的 userData）；非 Electron
// （开发 / 测试）下没有该变量时直接关闭文件落地，只保留内存 buffer，避免往
// 不确定的 cwd 乱写文件。
function logDir(): string | null {
  const userData = process.env.BZXZ_USER_DATA_DIR;
  if (!userData) return null;
  return path.join(userData, 'bzxz-logs');
}
let cleanedOnce = false;
function cleanupOldLogs(dir: string): void {
  if (cleanedOnce) return;
  cleanedOnce = true;
  fs.readdir(dir, (err, files) => {
    if (err) return;
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 864e5;
    for (const f of files) {
      const m = /^app-(\d{4})(\d{2})(\d{2})\.log$/.exec(f);
      if (!m) continue;
      const t = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).getTime();
      if (t < cutoff) fs.unlink(path.join(dir, f), () => { /* 忽略 */ });
    }
  });
}
function appendToFile(entry: LogEntry): void {
  const dir = logDir();
  if (!dir) return;
  try {
    const d = new Date(entry.ts);
    const p = (n: number) => String(n).padStart(2, '0');
    const file = path.join(dir, `app-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}.log`);
    const line = `${entry.ts}\t${entry.level}\t${entry.module}\t${entry.message.replace(/\r?\n/g, '\\n')}\n`;
    fs.mkdir(dir, { recursive: true }, (mkErr) => {
      if (mkErr) return; // 建目录失败：静默放弃本条落地
      fs.appendFile(file, line, () => { /* 写失败静默 */ });
      cleanupOldLogs(dir);
    });
  } catch { /* 任何异常都不影响 console / 业务 */ }
}

function push(level: LogEntry['level'], args: unknown[]): void {
  const message = args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ');
  const entry: LogEntry = { ts: new Date().toISOString(), level, message, module: inferModule(message) };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  appendToFile(entry);
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

console.log = (...args: unknown[]) => { push('log', args); originalLog(...args as []); };
console.warn = (...args: unknown[]) => { push('warn', args); originalWarn(...args as []); };
console.error = (...args: unknown[]) => { push('error', args); originalError(...args as []); };

export function getRecentLogs(limit = 200): LogEntry[] {
  if (limit >= buffer.length) return buffer.slice();
  return buffer.slice(buffer.length - limit);
}
