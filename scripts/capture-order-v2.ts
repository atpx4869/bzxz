// Plan A: Playwright 注入 token → 打开 bzuser 标准详情页 → 点击下载 → 捕获 order/save 请求
// 用法: npx tsx scripts/capture-order-v2.ts [标准号]
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const stdNo = process.argv[2] ?? 'GB/T 3325-2024';
const ACCOUNTS_FILE = path.join(process.cwd(), 'data', 'accounts.json');

interface Account {
  username: string; password: string; accessToken?: string;
  refreshToken?: string; loggedInAt?: string; expiresIn?: number;
}

function getFreshToken(): string | null {
  if (!existsSync(ACCOUNTS_FILE)) return null;
  const accounts: Account[] = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
  // Pick newest logged-in account whose token isn't expired
  let best: Account | null = null;
  for (const a of accounts) {
    if (!a.accessToken || !a.loggedInAt || !a.expiresIn) continue;
    const expiresAt = new Date(a.loggedInAt).getTime() + a.expiresIn * 1000;
    if (Date.now() > expiresAt) continue;
    if (!best || new Date(a.loggedInAt) > new Date(best.loggedInAt!)) best = a;
  }
  return best?.accessToken ?? null;
}

async function main() {
  const token = getFreshToken();
  if (!token) {
    console.error('No valid token found. Run: npx tsx scripts/register-bot.ts 1 --login');
    process.exit(1);
  }
  console.log(`Token: ${token.substring(0, 30)}...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1200 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  // === Intercept ALL requests ===
  const captured: Array<{ method: string; url: string; body?: string; headers: Record<string,string> }> = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('gxzl.org.cn') || url.includes('api/')) {
      captured.push({ method: req.method(), url, body: req.postData() ?? undefined, headers: req.headers() });
    }
  });
  page.on('response', (res) => {
    const url = res.url();
    if ((url.includes('order/save') || url.includes('order/create') || url.includes('standardOrder')) && res.status() !== 404) {
      console.log(`\n>>> RESPONSE ${res.status()} ${url}`);
    }
  });

  // === Step 1: Go to bzuser homepage to set domain ===
  console.log('\n[1] Loading bzuser homepage...');
  await page.goto('https://bzuser.gxzl.org.cn/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  // === Step 2: Inject token via multiple methods ===
  console.log('[2] Injecting auth token...');
  await page.evaluate((t) => {
    // Method 1: localStorage
    localStorage.setItem('token', t);
    localStorage.setItem('access_token', t);
    localStorage.setItem('blade-auth', 'bearer ' + t);
    localStorage.setItem('blade_token', t);
    localStorage.setItem('user-token', t);
    // Method 2: sessionStorage
    sessionStorage.setItem('token', t);
    sessionStorage.setItem('access_token', t);
    // Method 3: cookie
    document.cookie = `blade-auth=bearer ${t}; path=/; domain=.gxzl.org.cn`;
    document.cookie = `access_token=${t}; path=/; domain=.gxzl.org.cn`;
    document.cookie = `token=${t}; path=/; domain=.gxzl.org.cn`;
  }, token);
  console.log('   localStorage keys:', await page.evaluate(() => Object.keys(localStorage)));

  // === Step 3: Navigate to standard detail page ===
  const detailUrl = `https://bzuser.gxzl.org.cn/#/standard/standardDetail?stdNo=${encodeURIComponent(stdNo)}`;
  console.log(`\n[3] Navigating to: ${detailUrl}`);
  await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Check what the page looks like
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log(`   Page body length: ${bodyText.length} chars`);
  console.log(`   First 500: ${bodyText.substring(0, 500)}`);

  // Take screenshot for debugging
  await page.screenshot({ path: path.join(process.cwd(), 'data', 'bzuser-debug.png'), fullPage: true });
  console.log('   Screenshot saved to data/bzuser-debug.png');

  // === Step 4: Try to find download button ===
  console.log('\n[4] Searching for download button...');
  const selectors = [
    'button:has-text("下载PDF")',
    'button:has-text("下载")',
    'span:has-text("下载PDF")',
    'span:has-text("下载")',
    'a:has-text("下载")',
    'div:has-text("下载PDF")',
    '[class*="download"]',
    '[class*="Download"]',
    '.el-button:has-text("下载")',
    'text=下载PDF',
    'text=下载标准',
    '[title*="下载"]',
  ];

  let clicked = false;
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        const text = await el.textContent().catch(() => '');
        console.log(`   Found: "${sel}" text="${text?.substring(0,30)}", clicking...`);
        await el.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(5000);
        clicked = true;
        break;
      }
    } catch {}
  }

  if (!clicked) {
    console.log('   No download button found with text selectors.');
    console.log('   Trying to find any clickable element near "下载"...');
    // Dump all button-like elements
    const buttons = await page.$$eval('button, a, span, div[class*="btn"]', els =>
      els.filter(e => {
        const t = (e.textContent || '').trim();
        return t.length > 0 && t.length < 50;
      }).map(e => ({ tag: e.tagName, text: (e.textContent || '').trim().substring(0, 40), className: (e as HTMLElement).className?.substring(0, 60) }))
    );
    console.log('   All buttons on page:', JSON.stringify(buttons.slice(0, 50), null, 2));
  }

  // === Step 5: Log captured requests ===
  console.log('\n=== Captured order-related requests ===');
  const orderReqs = captured.filter(r =>
    r.url.includes('order') || r.url.includes('save') || r.url.includes('create') || r.url.includes('download') || r.url.includes('submit')
  );
  if (orderReqs.length === 0) {
    console.log('  NONE FOUND!');
  }
  for (const r of orderReqs) {
    console.log(`\n${r.method} ${r.url}`);
    if (r.body) console.log(`  BODY: ${r.body.substring(0, 2000)}`);
  }

  // Also log ALL POST requests
  console.log('\n=== All POST requests ===');
  const posts = captured.filter(r => r.method === 'POST');
  for (const r of posts) {
    console.log(`\nPOST ${r.url}`);
    if (r.body) console.log(`  BODY: ${r.body.substring(0, 1000)}`);
  }
  if (posts.length === 0) console.log('  NONE');

  // Log all unique API paths
  console.log('\n=== All API paths seen ===');
  const paths = [...new Set(captured.map(r => {
    try { return new URL(r.url).pathname; } catch { return r.url; }
  }))].sort();
  paths.forEach(p => console.log(`  ${p}`));

  await browser.close();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
