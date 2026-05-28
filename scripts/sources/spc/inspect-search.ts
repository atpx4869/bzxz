/**
 * SPC 搜索勘察脚本：匿名访问 https://www.spc.org.cn/basicsearch，关键字 "18584"，
 * 录制所有 search 相关 network，输出请求清单 + 解析后的结果列表。
 *
 * 不需要登录。
 */

import { loadDotEnvLocal } from '../../../src/shared/env-loader';
loadDotEnvLocal();

import { chromium, type Request, type Response } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const KEYWORD = process.env.SPC_KEYWORD?.trim() || '18584';
const OUT_DIR = path.resolve(process.cwd(), 'out');

interface RequestRecord {
  ts: number;
  method: string;
  url: string;
  resourceType: string;
  postData?: string;
}

interface ResponseRecord {
  ts: number;
  status: number;
  url: string;
  contentType: string;
  bodyPreview?: string;     // 仅 json/text 前 8KB
  bodySize?: number;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  // 复用本机已装的 chromium-1194（playwright 1.59 期望 1217，但 npmmirror 没该版本，
  // 官方源走不通；版本不匹配只是 warning，跑 web 抓取无影响）
  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const requests: RequestRecord[] = [];
  const responses: ResponseRecord[] = [];

  const isInteresting = (url: string) =>
    url.includes('spc.org.cn') &&
    !url.match(/\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|css|js)(\?|$)/i);

  page.on('request', (req: Request) => {
    if (!isInteresting(req.url())) return;
    requests.push({
      ts: Date.now(),
      method: req.method(),
      url: req.url(),
      resourceType: req.resourceType(),
      postData: req.postData() || undefined,
    });
  });

  page.on('response', async (resp: Response) => {
    if (!isInteresting(resp.url())) return;
    const contentType = resp.headers()['content-type'] ?? '';
    let bodyPreview: string | undefined;
    let bodySize: number | undefined;
    if (contentType.includes('json') || contentType.includes('text')) {
      try {
        const buf = await resp.body();
        bodySize = buf.length;
        bodyPreview = buf.toString('utf-8').slice(0, 8192);
      } catch {
        // ignore — body may be unavailable for redirects / preflight
      }
    }
    responses.push({
      ts: Date.now(),
      status: resp.status(),
      url: resp.url(),
      contentType,
      bodyPreview,
      bodySize,
    });
  });

  console.log('[spc-search] navigating to basicsearch');
  await page.goto('https://www.spc.org.cn/basicsearch', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 站点用 SPA 渲染 + 异步搜索接口，不知道具体输入框选择器 —— 用通用兜底：
  // 1. 找页面里第一个 input[type=text] 或 input[type=search]
  // 2. 模拟键入 + 回车
  // 不行就把页面 DOM 存下来供人工分析。
  console.log('[spc-search] looking for search input');
  const inputs = page.locator('input[type=text], input[type=search], input:not([type])');
  const inputCount = await inputs.count();
  console.log(`[spc-search] found ${inputCount} candidate inputs`);

  if (inputCount > 0) {
    await inputs.first().fill(KEYWORD);
    await inputs.first().press('Enter');
    console.log(`[spc-search] submitted keyword "${KEYWORD}", waiting 8s for results`);
    await page.waitForTimeout(8000);
  } else {
    console.warn('[spc-search] no input found — saving DOM only');
  }

  const finalUrl = page.url();
  const title = await page.title();
  const bodyHtml = await page.locator('body').innerHTML();

  // 用字符串形式 evaluate 绕开 tsx 注入的 `__name` helper（浏览器上下文里没有）
  const resultProbe = await page.evaluate(`(() => {
    const probe = (sel) => Array.from(document.querySelectorAll(sel)).slice(0, 5).map(el => ({
      tag: el.tagName,
      text: (el.textContent || '').trim().slice(0, 200),
      html: el.outerHTML.slice(0, 600),
    }));
    return {
      'a[href*="online"]': probe('a[href*="online"]'),
      'a[href*="standardonline"]': probe('a[href*="standardonline"]'),
      '.result, .result-item, .list-item, .item': probe('.result, .result-item, .list-item, .item'),
    };
  })()`);

  await writeFile(path.join(OUT_DIR, 'spc-search-requests.json'), JSON.stringify({
    keyword: KEYWORD,
    finalUrl,
    title,
    requests,
    responses,
  }, null, 2), 'utf-8');

  await writeFile(path.join(OUT_DIR, 'spc-search-dom.html'), bodyHtml, 'utf-8');

  await writeFile(path.join(OUT_DIR, 'spc-search-results.json'), JSON.stringify(resultProbe, null, 2), 'utf-8');

  console.log('[spc-search] done. outputs:');
  console.log('  - out/spc-search-requests.json  (', requests.length, 'reqs /', responses.length, 'resps )');
  console.log('  - out/spc-search-dom.html');
  console.log('  - out/spc-search-results.json   (DOM probes)');

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
