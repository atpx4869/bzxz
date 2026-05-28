/**
 * SPC PDF 落盘脚本：手动登录 + 手动进阅读器，
 * 命中 GET /stdlib/onlinereading?token=... 响应就把 body 写到 out/spc-sample-*.pdf。
 *
 * 目的：拿到原始 PDF，肉眼判断
 *   1) 是否带水印（账号绑定 / 静态）
 *   2) 是不是完整正本（非样章）
 *   3) DRM 限制（复制/打印）
 *
 * 必须配 .env.local 里的 SPC_USERNAME / SPC_PASSWORD（脚本不读，只提示）。
 * 全程 headless=false，给你 300s 手动操作。
 */

import { loadDotEnvLocal } from '../../../src/shared/env-loader';
loadDotEnvLocal();

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT_DIR = path.resolve(process.cwd(), 'out');
const DWELL_MS = Number(process.env.SPC_DWELL_MS || 300_000);

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const saved: string[] = [];
  const seenReqIds = new Set<string>();

  // 走 CDP `Fetch` 域：在响应进 renderer 之前拦截，改掉 `charset=utf-8` 让
  // Chrome 不再 utf-8 decode body —— 然后用 Fetch.getResponseBody 拿到的就是原始字节。
  //
  // 走过的死胡同：
  //  - resp.body() / page.evaluate(fetch) → token 单次有效，再请求 0KB
  //  - Network.getResponseBody → Chrome 已按 charset=utf-8 decode 过，高位字节全坏
  //  - 必须用 Fetch.enable + 响应阶段拦截，才能在 decode 前拿到字节
  async function attachCdpToPage(p: import('playwright').Page) {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*onlinereading*', requestStage: 'Response' }],
    });

    cdp.on('Fetch.requestPaused', async (params) => {
      const url = params.request.url;
      if (!/\/stdlib\/onlinereading\b/.test(url)) {
        await cdp.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
        return;
      }
      if (seenReqIds.has(params.requestId)) return;
      seenReqIds.add(params.requestId);

      try {
        // 关键：Fetch.getResponseBody 在 Fetch 拦截上下文里走的是原始 protocol body，
        // 不受 Network 层的 charset 解码影响。base64Encoded=true 保证字节原样。
        const { body, base64Encoded } = await cdp.send('Fetch.getResponseBody', {
          requestId: params.requestId,
        });
        const buf = base64Encoded ? Buffer.from(body, 'base64') : Buffer.from(body, 'binary');

        const tokenMatch = url.match(/token=([^&]+)/);
        const sig = tokenMatch
          ? crypto.createHash('sha256').update(tokenMatch[1]).digest('hex').slice(0, 12)
          : 'unknown';
        const file = path.join(OUT_DIR, `spc-sample-${sig}.pdf`);
        await writeFile(file, buf);
        saved.push(file);
        console.log(`[spc-extract] saved ${(buf.length / 1024).toFixed(1)}KB → ${file}  (base64Encoded=${base64Encoded})`);
        console.log(`[spc-extract] header hex: ${buf.slice(0, 16).toString('hex')}`);
      } catch (e) {
        console.warn('[spc-extract] Fetch.getResponseBody failed:', (e as Error).message);
      } finally {
        // 不管成功失败，把请求放行让 Foxit Reader 也能拿到（不然页面卡死）
        await cdp.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
      }
    });
  }

  // target=_blank 会开新 Page，挂全局 page 监听给每个新页都装上 CDP
  ctx.on('page', (p) => { attachCdpToPage(p).catch(console.warn); });

  const page = await ctx.newPage();
  await attachCdpToPage(page);
  await page.goto('https://www.spc.org.cn/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('');
  console.log('=============================================================');
  console.log('  手动模式：你来开车');
  console.log('    1) 登录 spc.org.cn');
  console.log('    2) 进 https://www.spc.org.cn/basicsearch 搜任意关键字');
  console.log('    3) 点"在线阅读"');
  console.log('    4) 看到阅读器加载即可（PDF 已被截获）');
  console.log(`  ${DWELL_MS / 1000}s 后自动收工，你也可以 Ctrl+C`);
  console.log('=============================================================');
  console.log('');

  await page.waitForTimeout(DWELL_MS);

  console.log('[spc-extract] done. saved files:');
  for (const f of saved) console.log('  -', f);
  if (saved.length === 0) console.warn('  (no PDF captured — 阅读器没打开 / token 没出来 / 接口换了)');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
