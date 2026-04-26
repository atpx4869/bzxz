import { createServer } from 'node:http';

import { createApp } from './api/app';
import { ensureDataDirs } from './shared/fs';

async function main() {
  await ensureDataDirs();

  const app = createApp();
  const port = Number(process.env.PORT ?? 3000);

  createServer(app).listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
