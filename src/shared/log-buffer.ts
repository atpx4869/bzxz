/**
 * In-memory ring buffer of recent server logs. Exposed via /api/diagnostics/logs
 * so the user can see what's happening on the backend without opening the
 * Electron dev console.
 *
 * We intercept console.warn / console.error / console.log on import. The
 * originals are still called so anyone with a real console still sees output.
 */

const MAX_ENTRIES = 500;

export interface LogEntry {
  ts: string;
  level: 'log' | 'warn' | 'error';
  message: string;
}

const buffer: LogEntry[] = [];

function push(level: LogEntry['level'], args: unknown[]): void {
  const message = args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(' ');
  buffer.push({ ts: new Date().toISOString(), level, message });
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
