/**
 * SPC 下载链路勘察：在登录态下，从「搜索结果 → 点在线阅读 → 收到 PDF」全程录所有
 * spc.org.cn 域请求（含 POST body / response body），按时间排序输出。
 *
 * 目的：弄清 token 怎么生成 —— 是前端 JS 算的，还是某个 JSP 接口返回，
 *       还是服务端 session 状态。决定 adapter 能否走纯 HTTP。
 *
 * 输出：
 *   out/spc-chain-timeline.json   时间排序的请求 + 响应链
 *   out/spc-chain-summary.md      关键接口分类总结，重点标"返回 token 的那个接口"
 *
 * 必须配 .env.local 里的 SPC_USERNAME / SPC_PASSWORD（脚本不读，只提示）。
 * 全程 headless=false，300s 手动操作。
 */

import { loadDotEnvLocal } from '../../../src/shared/env-loader';
loadDotEnvLocal();

import { chromium, type BrowserContext, type Request, type Response } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT_DIR = path.resolve(process.cwd(), 'out');
const DWELL_MS = Number(process.env.SPC_DWELL_MS || 300_000);

interface ChainEvent {
  ts: number;
  /** 单调递增序号，按时间 */
  seq: number;
  phase: 'req' | 'resp';
  method?: string;
  status?: number;
  url: string;
  resourceType?: string;
  contentType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  postData?: string;          // POST 请求 body（如果有）
  bodyPreview?: string;       // 响应 body 前 8KB（json/text）
  bodySize?: number;
}

let seq = 0;
const events: ChainEvent[] = [];

/**
 * 只录"业务接口" —— 把静态资源（js/css/img/font/wasm）全过滤掉，
 * 不然 Foxit Reader 一启动 80 个文件，关键 3-5 个接口被淹没。
 *
 * 留下：text/html / json / 任何 POST / 任何路径含 reading|token|reader|stdlib 的请求
 */
function isBusinessUrl(url: string, method: string, ct: string): boolean {
  if (!url.includes('spc.org.cn')) return false;
  // 资源文件
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|css|wasm)(\?|$)/i.test(url)) return false;
  // 第三方 js（jquery / swiper / webpdf.full.mini 这种 200KB+ 通用库不要录）
  if (/\.(js)(\?|$)/i.test(url) && !/onlinereading|token|reader\b|stdlib/i.test(url)) return false;
  // POST 一律保留
  if (method === 'POST') return true;
  // 阅读链路关键词
  if (/onlinereading|getpdf|gettoken|stdlib\/|reader\/|stdonline|getstdinfo|idmd5/i.test(url)) return true;
  // json/text 接口
  if (ct.includes('json') || ct.includes('text/plain')) return true;
  // text/html 通常是页面跳转，留着
  if (ct.includes('text/html')) return true;
  return false;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // context 级监听 —— spc 的"在线阅读"是 target=_blank
  ctx.on('request', (req: Request) => {
    const url = req.url();
    const method = req.method();
    // 先用宽松规则录，response 阶段再按 content-type 二次过滤
    if (!url.includes('spc.org.cn')) return;
    if (/\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf|css|wasm)(\?|$)/i.test(url)) return;
    if (/\.(js)(\?|$)/i.test(url) && !/onlinereading|token|reader\b|stdlib/i.test(url)) return;

    events.push({
      ts: Date.now(),
      seq: seq++,
      phase: 'req',
      method,
      url,
      resourceType: req.resourceType(),
      requestHeaders: req.headers(),
      postData: req.postData() || undefined,
    });
  });

  ctx.on('response', async (resp: Response) => {
    const url = resp.url();
    const method = resp.request().method();
    const ct = resp.headers()['content-type'] ?? '';
    if (!isBusinessUrl(url, method, ct)) return;

    const ev: ChainEvent = {
      ts: Date.now(),
      seq: seq++,
      phase: 'resp',
      method,
      status: resp.status(),
      url,
      resourceType: resp.request().resourceType(),
      contentType: ct,
      responseHeaders: resp.headers(),
    };

    // body 读取 —— json/text 才读，binary 只记 size
    if (ct.includes('json') || ct.includes('text') || ct.includes('javascript')) {
      try {
        const buf = await resp.body();
        ev.bodySize = buf.length;
        ev.bodyPreview = buf.toString('utf-8').slice(0, 8192);
      } catch { /* ignore */ }
    } else {
      try {
        const buf = await resp.body();
        ev.bodySize = buf.length;
      } catch { /* ignore */ }
    }
    events.push(ev);
  });

  const page = await ctx.newPage();
  await page.goto('https://www.spc.org.cn/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('');
  console.log('=============================================================');
  console.log('  下载链路勘察：找出 token 从哪来');
  console.log('  请：');
  console.log('    1) 登录 spc.org.cn');
  console.log('    2) 进 https://www.spc.org.cn/basicsearch 搜 18584');
  console.log('    3) 在结果页打开 DevTools Network 面板 (F12) — 帮助对照');
  console.log('    4) 点任意一条"在线阅读"');
  console.log('    5) 等阅读器加载完（PDF 出现即可，不用翻页）');
  console.log('  ');
  console.log(`  ${DWELL_MS / 1000}s 后自动收工，也可 Ctrl+C 提前结束`);
  console.log('=============================================================');
  console.log('');

  await page.waitForTimeout(DWELL_MS);

  // ── 收尾：按 seq 排序写时间线 ────────────────────────
  events.sort((a, b) => a.seq - b.seq);
  await writeFile(
    path.join(OUT_DIR, 'spc-chain-timeline.json'),
    JSON.stringify(events, null, 2),
    'utf-8',
  );

  // ── 总结：找含 token 的事件 ──────────────────────────
  const tokenEvents = events.filter(e =>
    (e.bodyPreview && /token/i.test(e.bodyPreview)) ||
    /token=/.test(e.url) ||
    (e.postData && /token/i.test(e.postData))
  );

  // 点"在线阅读"前后的关键时间窗 —— 取 onlinereading 出现前 10s 的所有请求
  const onlineReq = events.find(e => /\/stdlib\/onlinereading/.test(e.url) && e.phase === 'req');
  const pivot = onlineReq?.ts ?? 0;
  const windowEvents = pivot
    ? events.filter(e => Math.abs(e.ts - pivot) <= 15_000)
    : [];

  const lines: string[] = [];
  lines.push(`# SPC download chain inspection summary\n`);
  lines.push(`- 总事件数: ${events.length}`);
  lines.push(`- onlinereading 请求时间戳: ${pivot || '(未找到)'}`);
  lines.push(`- ±15s 窗口内事件: ${windowEvents.length}`);
  lines.push(`- token 字样命中事件: ${tokenEvents.length}\n`);

  lines.push(`## ★ "在线阅读"前后 15s 窗口的所有请求（按时间）\n`);
  lines.push(`| seq | Δms | phase | method | status | url | ct | size |`);
  lines.push(`|---:|---:|---|---|---:|---|---|---:|`);
  for (const e of windowEvents) {
    const delta = e.ts - pivot;
    const shortUrl = e.url.length > 90 ? e.url.slice(0, 87) + '...' : e.url;
    lines.push(
      `| ${e.seq} | ${delta} | ${e.phase} | ${e.method ?? ''} | ${e.status ?? ''} | \`${shortUrl}\` | ${e.contentType?.split(';')[0] ?? ''} | ${e.bodySize ?? ''} |`,
    );
  }

  lines.push(`\n## ★ body 里含 "token" 字样的响应（最可能就是 token 颁发接口）\n`);
  for (const e of tokenEvents) {
    if (e.phase !== 'resp') continue;
    lines.push(`### seq=${e.seq}  ${e.method} ${e.url}`);
    lines.push(`- status: ${e.status}`);
    lines.push(`- content-type: ${e.contentType}`);
    lines.push(`- body 前 4KB:\n`);
    lines.push('```');
    lines.push((e.bodyPreview ?? '').slice(0, 4096));
    lines.push('```\n');
  }

  lines.push(`\n## 所有 POST 请求（往往是关键接口）\n`);
  const posts = events.filter(e => e.phase === 'req' && e.method === 'POST');
  for (const e of posts) {
    lines.push(`### seq=${e.seq}  POST ${e.url}`);
    lines.push(`- post body: \`${(e.postData ?? '').slice(0, 600)}\``);
    const respMatch = events.find(r =>
      r.phase === 'resp' && r.url === e.url && r.seq > e.seq && r.seq - e.seq < 30,
    );
    if (respMatch) {
      lines.push(`- response status: ${respMatch.status}`);
      lines.push(`- response body 前 2KB:\n`);
      lines.push('```');
      lines.push((respMatch.bodyPreview ?? '').slice(0, 2048));
      lines.push('```');
    }
    lines.push('');
  }

  await writeFile(path.join(OUT_DIR, 'spc-chain-summary.md'), lines.join('\n'), 'utf-8');

  console.log(`[spc-chain] done. outputs:`);
  console.log(`  - out/spc-chain-timeline.json  (${events.length} events)`);
  console.log(`  - out/spc-chain-summary.md     ← 把这份贴给 Claude`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
