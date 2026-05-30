/**
 * In-memory ring buffer of recent server logs. Exposed via /api/diagnostics/logs
 * so the user can see what's happening on the backend without opening the
 * Electron dev console.
 *
 * We intercept console.warn / console.error / console.log on import. The
 * originals are still called so anyone with a real console still sees output.
 */

const MAX_ENTRIES = 500;

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

function push(level: LogEntry['level'], args: unknown[]): void {
  const message = args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ');
  buffer.push({ ts: new Date().toISOString(), level, message, module: inferModule(message) });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
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
