// Force direct connection — bypass any system proxy (Clash, etc.)
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete (process.env as Record<string, string | undefined>)[key];
}
process.env.NO_PROXY = '*';

// Install console interceptor as early as possible so the diagnostics endpoint
// sees every warning produced at startup (OCR worker boot, source registry, …).
import './shared/log-buffer';

import { createServer } from 'node:http';
import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

import { createApp } from './api/app';
import { ensureDataDirs, getRootDir } from './shared/fs';

const PORT_FILE = path.join(getRootDir(), 'data', '.server-port');

async function listenWithFallback(server: ReturnType<typeof createServer>, preferred: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onListening = () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : preferred;
      server.off('error', onError);
      resolve(port);
    };
    const onError = (err: NodeJS.ErrnoException) => {
      // Preferred port busy — fall back to a random free one rather than
      // crashing. Launcher scripts read the actual port from .server-port.
      if (err.code === 'EADDRINUSE' && preferred !== 0) {
        console.warn(`[bzxz] port ${preferred} in use, falling back to a random port`);
        server.off('listening', onListening);
        server.listen(0, '0.0.0.0');
        server.once('listening', () => {
          const addr = server.address();
          resolve(typeof addr === 'object' && addr ? addr.port : 0);
        });
        server.once('error', reject);
        return;
      }
      reject(err);
    };
    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(preferred, '0.0.0.0');
  });
}

async function main() {
  await ensureDataDirs();

  // Clear any stale port file so launcher scripts don't pick up a dead PID's port.
  try { await unlink(PORT_FILE); } catch { /* not present is fine */ }

  const app = createApp();
  const preferred = Number(process.env.PORT ?? 3000);
  const server = createServer(app);
  const port = await listenWithFallback(server, preferred);
  console.log(`Server listening on http://localhost:${port}`);
  try { await writeFile(PORT_FILE, String(port), 'utf-8'); } catch (e) {
    console.warn('[bzxz] failed to write port file:', e instanceof Error ? e.message : String(e));
  }

  // Cleanup on shutdown so a stale file doesn't mislead next launch.
  const cleanup = async () => { try { await unlink(PORT_FILE); } catch { /* ignore */ } };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);
  process.once('exit', () => { try { require('node:fs').unlinkSync(PORT_FILE); } catch { /* ignore */ } });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
