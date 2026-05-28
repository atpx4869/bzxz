/**
 * SPC 在线阅读勘察脚本：登录 → 搜索 → 进入第一个结果 → 点"在线阅读"，全程
 * 录制 network + DOM，给出分类总结，判断后续 adapter 走哪条路。
 *
 * 必须配置 .env.local 里的 SPC_USERNAME / SPC_PASSWORD。
 * headless=false：你能看到流程、必要时手过滑块/验证码。
 */

import { loadDotEnvLocal } from '../../../src/shared/env-loader';
loadDotEnvLocal();

import { chromium, type BrowserContext, type Page, type Request, type Response } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const KEYWORD = process.env.SPC_KEYWORD?.trim() || '18584';
const OUT_DIR = path.resolve(process.cwd(), 'out');
const READER_DWELL_MS = Number(process.env.SPC_DWELL_MS || 45000);   // 在 reader 页待多久
const MANUAL = process.env.SPC_MANUAL === '1';                       // 手动登录 + 手动操作模式

const USERNAME = process.env.SPC_USERNAME?.trim();
const PASSWORD = process.env.SPC_PASSWORD?.trim();

if (!USERNAME || !PASSWORD) {
  console.error('[spc-reader] missing SPC_USERNAME / SPC_PASSWORD in .env.local');
  process.exit(1);
}

interface NetRecord {
  ts: number;
  phase: 'req' | 'resp';
  method?: string;
  status?: number;
  url: string;
  resourceType?: string;
  contentType?: string;
  bodySize?: number;
  bodyPreview?: string;   // 仅 json/text，前 4KB
}

const records: NetRecord[] = [];

function recordRequest(req: Request) {
  const url = req.url();
  if (!url.includes('spc')) return;
  records.push({
    ts: Date.now(),
    phase: 'req',
    method: req.method(),
    url,
    resourceType: req.resourceType(),
  });
}

async function recordResponse(resp: Response) {
  const url = resp.url();
  if (!url.includes('spc')) return;
  const contentType = resp.headers()['content-type'] ?? '';
  const rec: NetRecord = {
    ts: Date.now(),
    phase: 'resp',
    status: resp.status(),
    url,
    contentType,
  };
  if (contentType.includes('json') || contentType.includes('text') || contentType.includes('javascript')) {
    try {
      const buf = await resp.body();
      rec.bodySize = buf.length;
      rec.bodyPreview = buf.toString('utf-8').slice(0, 4096);
    } catch { /* ignore */ }
  } else {
    try {
      const buf = await resp.body();
      rec.bodySize = buf.length;
    } catch { /* ignore */ }
  }
  records.push(rec);
}

/**
 * Context 级监听 —— 覆盖所有 Page（含 target=_blank 弹出的新窗口），
 * 这样 spc「在线阅读」开新页面后，新页里的 PDF/图片请求才能录到。
 */
function attachContextRecorders(ctx: BrowserContext) {
  ctx.on('request', recordRequest);
  ctx.on('response', recordResponse);
}

// 保留旧名兼容（自动模式还在用 page 级）
function attachRecorders(page: Page) {
  page.on('request', recordRequest);
  page.on('response', recordResponse);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  attachContextRecorders(ctx);    // 必须先挂 context-level，新弹窗才能被覆盖到
  const page = await ctx.newPage();

  // ── 1. 登录 ──────────────────────────────────
  console.log('[spc-reader] step 1: login');
  await page.goto('https://www.spc.org.cn/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  if (MANUAL) {
    console.log('');
    console.log('=============================================================');
    console.log('  SPC_MANUAL=1：手动模式');
    console.log('  请在弹出的浏览器中：');
    console.log('    1) 登录 spc.org.cn');
    console.log('    2) 进入 https://www.spc.org.cn/basicsearch 搜 18584');
    console.log('    3) 点任意一条标准的「在线阅读」');
    console.log('    4) 翻几页让懒加载触发');
    console.log('  你有 300 秒，全程脚本只录制 network，不打扰');
    console.log('=============================================================');
    console.log('');
    await page.waitForTimeout(300_000);

    // 收工：抓最后停留页的 DOM
    const allPages = ctx.pages();
    const reader = allPages[allPages.length - 1];
    const readerHtml = await reader.locator('body').innerHTML().catch(() => '<error>');
    await writeFile(path.join(OUT_DIR, 'spc-reader-dom.html'), readerHtml, 'utf-8');

    const watermarkProbe = await reader.evaluate(`(() => {
      const sel = '[class*="watermark"], [class*="mark"], [id*="watermark"]';
      return Array.from(document.querySelectorAll(sel)).slice(0, 10).map(el => ({
        tag: el.tagName,
        cls: el.className,
        text: (el.textContent || '').trim().slice(0, 200),
      }));
    })()`).catch(() => []);
    await writeFile(path.join(OUT_DIR, 'spc-reader-watermark.json'),
      JSON.stringify(watermarkProbe, null, 2), 'utf-8');

    await writeManualSummary(reader.url());
    await browser.close();
    return;
  }

  // 尝试找登录链接
  const loginLink = page.locator('a:has-text("登录"), a:has-text("登 录")').first();
  if (await loginLink.count()) {
    await loginLink.click();
    await page.waitForTimeout(3000);
  }

  // 模式 1：纯账号密码（常见 placeholder："手机号" / "账号" / "用户名"）
  const userInput = page.locator('input[placeholder*="账号"], input[placeholder*="手机"], input[placeholder*="用户"], input[name*="user"], input[type="text"]').first();
  const passInput = page.locator('input[type="password"]').first();

  if (await userInput.count() && await passInput.count()) {
    await userInput.fill(USERNAME!);
    await passInput.fill(PASSWORD!);
    console.log('[spc-reader] filled credentials, click 登录 button (you may need to pass captcha)');
    const submit = page.locator('button:has-text("登录"), button:has-text("登 录"), .login-btn, button[type=submit]').first();
    if (await submit.count()) {
      await submit.click().catch(() => { /* ignore */ });
    }
  } else {
    console.warn('[spc-reader] could not auto-fill — please log in manually within 60s');
  }

  // 等登录成功（通过 URL 变化 / 头像出现等启发式；这里粗暴等 30s 给用户操作时间）
  await page.waitForTimeout(30000);

  // ── 2. 搜索 ──────────────────────────────────
  console.log('[spc-reader] step 2: search', KEYWORD);
  await page.goto('https://www.spc.org.cn/basicsearch', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  const searchInput = page.locator('input[type=text], input[type=search], input:not([type])').first();
  if (await searchInput.count()) {
    await searchInput.fill(KEYWORD);
    await searchInput.press('Enter');
    await page.waitForTimeout(6000);
  }

  // ── 3. 找在线阅读链接 ────────────────────────
  console.log('[spc-reader] step 3: find 在线阅读');
  const readBtn = page.locator('a:has-text("在线阅读"), button:has-text("在线阅读")').first();
  const hasReader = await readBtn.count();
  if (!hasReader) {
    console.warn('[spc-reader] "在线阅读" not found on result page — saving DOM');
    await writeFile(path.join(OUT_DIR, 'spc-reader-search-dom.html'),
      await page.locator('body').innerHTML(), 'utf-8');
  } else {
    const [popup] = await Promise.all([
      ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null),
      readBtn.click(),
    ]);

    const reader = popup ?? page;
    if (popup) attachRecorders(popup);

    console.log(`[spc-reader] reader opened at ${reader.url()}, dwelling ${READER_DWELL_MS}ms`);
    await reader.waitForTimeout(READER_DWELL_MS);

    // 试着翻几页（PageDown / 滚动）以触发懒加载
    for (let i = 0; i < 8; i++) {
      await reader.keyboard.press('PageDown').catch(() => {});
      await reader.waitForTimeout(1500);
    }

    // reader 页 DOM
    const readerHtml = await reader.locator('body').innerHTML().catch(() => '<error>');
    await writeFile(path.join(OUT_DIR, 'spc-reader-dom.html'), readerHtml, 'utf-8');

    // 查水印元素（用字符串 evaluate 绕开 tsx `__name` helper）
    const watermarkProbe = await reader.evaluate(`(() => {
      const sel = '[class*="watermark"], [class*="mark"], [id*="watermark"]';
      return Array.from(document.querySelectorAll(sel)).slice(0, 10).map(el => ({
        tag: el.tagName,
        cls: el.className,
        text: (el.textContent || '').trim().slice(0, 200),
      }));
    })()`).catch(() => []);
    await writeFile(path.join(OUT_DIR, 'spc-reader-watermark.json'),
      JSON.stringify(watermarkProbe, null, 2), 'utf-8');
  }

  // ── 4. 写产物 ────────────────────────────────
  await writeFile(path.join(OUT_DIR, 'spc-reader-requests.json'),
    JSON.stringify(records, null, 2), 'utf-8');

  // 自动分类总结
  const byCT = new Map<string, { count: number; totalSize: number; samples: string[] }>();
  for (const r of records) {
    if (r.phase !== 'resp') continue;
    const ct = (r.contentType ?? 'unknown').split(';')[0].trim();
    const slot = byCT.get(ct) ?? { count: 0, totalSize: 0, samples: [] };
    slot.count++;
    slot.totalSize += r.bodySize ?? 0;
    if (slot.samples.length < 3) slot.samples.push(r.url);
    byCT.set(ct, slot);
  }

  const lines: string[] = [];
  lines.push(`# SPC reader inspection summary\n`);
  lines.push(`- keyword: ${KEYWORD}`);
  lines.push(`- total requests: ${records.filter(r => r.phase === 'req').length}`);
  lines.push(`- total responses: ${records.filter(r => r.phase === 'resp').length}`);
  lines.push(`\n## Content-Type 分布\n`);
  lines.push(`| Content-Type | 数量 | 总字节 | 样例 URL |`);
  lines.push(`|---|---:|---:|---|`);
  for (const [ct, info] of [...byCT.entries()].sort((a, b) => b[1].count - a[1].count)) {
    lines.push(`| \`${ct}\` | ${info.count} | ${(info.totalSize / 1024).toFixed(1)} KB | ${info.samples[0] ?? ''} |`);
  }
  lines.push(`\n## 判断口径\n`);
  lines.push(`- 若 \`image/jpeg|png|webp\` 数量 ≥ 10 → 大概率逐页图，可仿 bz 源拉图拼 PDF`);
  lines.push(`- 若 \`application/pdf\` 出现 → 最理想，直拉 PDF`);
  lines.push(`- 若以上都没有，只见大量 \`application/octet-stream\` 或异常 \`text/plain\` → canvas/加密分片，难度高`);
  lines.push(`- DOM 里有 watermark 节点 → 水印是 DOM overlay，可程序化剥离`);
  lines.push(`- 无 watermark DOM 但服务端图片自带水印 → 拼出来的 PDF 自带账号绑定水印\n`);

  await writeFile(path.join(OUT_DIR, 'spc-reader-summary.md'), lines.join('\n'), 'utf-8');

  console.log('[spc-reader] done. outputs in out/:');
  console.log('  - spc-reader-requests.json');
  console.log('  - spc-reader-dom.html');
  console.log('  - spc-reader-watermark.json');
  console.log('  - spc-reader-summary.md   ← 把这份贴给 Claude');

  await browser.close();
}

async function writeManualSummary(finalUrl: string) {
  await writeFile(path.join(OUT_DIR, 'spc-reader-requests.json'),
    JSON.stringify(records, null, 2), 'utf-8');

  const byCT = new Map<string, { count: number; totalSize: number; samples: string[] }>();
  for (const r of records) {
    if (r.phase !== 'resp') continue;
    const ct = (r.contentType ?? 'unknown').split(';')[0].trim();
    const slot = byCT.get(ct) ?? { count: 0, totalSize: 0, samples: [] };
    slot.count++;
    slot.totalSize += r.bodySize ?? 0;
    if (slot.samples.length < 3) slot.samples.push(r.url);
    byCT.set(ct, slot);
  }

  // reader 阶段特别关心的子集：路径里含 reader/online/view/preview/page 的请求
  const readerHints = records.filter(r => r.phase === 'resp' &&
    /reader|online|view|preview|page|pdf|stdfile|pageimg/i.test(r.url));

  const lines: string[] = [];
  lines.push(`# SPC reader inspection summary (manual mode)\n`);
  lines.push(`- final URL: ${finalUrl}`);
  lines.push(`- total requests: ${records.filter(r => r.phase === 'req').length}`);
  lines.push(`- total responses: ${records.filter(r => r.phase === 'resp').length}`);
  lines.push(`\n## Content-Type 分布\n`);
  lines.push(`| Content-Type | 数量 | 总字节 | 样例 URL |`);
  lines.push(`|---|---:|---:|---|`);
  for (const [ct, info] of [...byCT.entries()].sort((a, b) => b[1].count - a[1].count)) {
    lines.push(`| \`${ct}\` | ${info.count} | ${(info.totalSize / 1024).toFixed(1)} KB | ${info.samples[0] ?? ''} |`);
  }
  lines.push(`\n## reader 阶段相关请求（path 含 reader/online/view/preview/page/pdf/stdfile）\n`);
  lines.push(`共 ${readerHints.length} 条`);
  lines.push('');
  for (const r of readerHints.slice(0, 50)) {
    lines.push(`- [${r.status}] ${r.contentType} ${r.bodySize ?? '-'}B  ${r.url}`);
  }

  // 关键：blob URL 的上游一定是 image/* / application/pdf / octet-stream，
  // 且 body 通常 >= 10KB（页图至少这么大）。把候选列出来给 Claude 判断。
  const blobCandidates = records.filter(r => r.phase === 'resp' &&
    (r.bodySize ?? 0) >= 10_000 &&
    /^(image\/|application\/pdf|application\/octet-stream|application\/x-)/.test(r.contentType ?? ''));
  lines.push(`\n## blob 候选（body >= 10KB 的 image/PDF/octet-stream 响应）\n`);
  lines.push(`共 ${blobCandidates.length} 条 —— 这里的 URL 就是 Foxit Reader 拿来生成 blob: 的源头`);
  lines.push('');
  for (const r of blobCandidates.slice(0, 80)) {
    lines.push(`- [${r.status}] ${r.contentType} ${((r.bodySize ?? 0) / 1024).toFixed(1)}KB  ${r.url}`);
  }
  lines.push(`\n## 判断口径\n`);
  lines.push(`- 看 reader 阶段请求里是否有大量 image/jpeg|png（≥10）→ 拉图拼 PDF 可行`);
  lines.push(`- 若有 application/pdf → 最理想`);
  lines.push(`- 若全是 application/octet-stream / text/plain 二进制流 → canvas/加密分片`);
  await writeFile(path.join(OUT_DIR, 'spc-reader-summary.md'), lines.join('\n'), 'utf-8');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
