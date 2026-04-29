// Force direct connection — bypass any system proxy (Clash, etc.)
for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
  delete (process.env as Record<string, string | undefined>)[key];
}
process.env.NO_PROXY = '*';

import { createServer } from 'node:http';

import { createApp } from './api/app';
import { ensureDataDirs } from './shared/fs';

async function main() {
  await ensureDataDirs();

  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);

  createServer(app).listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
