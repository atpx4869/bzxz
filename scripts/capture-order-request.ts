// 抓包脚本：自动登录 bzuser 平台，打开标准详情页，点击下载PDF，
// 捕获创建订单的 POST 请求 body
// 用法: npx tsx scripts/capture-order-request.ts [标准号]

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_HOST = 'bz.gxzl.org.cn';
const BASE_PORT = 443;
const ACCOUNTS_FILE = path.join(process.cwd(), 'data', 'accounts.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const stdNo = process.argv[2] ?? 'GB/T 3325-2024';

// Reuse register-bot functions
function jsonReq(method: string, p: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; data: unknown; cookies?: string[] }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      'User-Agent': UA, 'Content-Type': 'application/json', ...extraHeaders,
    };
    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));

    const req = https.request({
      hostname: BASE_HOST, port: BASE_PORT, path: p, method,
      rejectUnauthorized: false, family: 4, timeout: 15000, headers,
    }, (res) => {
      let buf = '';
      res.on('data', (c: Buffer) => buf += c.toString());
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(buf), cookies: res.headers['set-cookie'] });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: buf, cookies: res.headers['set-cookie'] });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function solveCaptcha(base64Image: string): string {
  try {
    const raw = execFileSync('python', [path.join(process.cwd(), 'scripts', 'ocr_ddddocr.py')], {
      input: base64Image, encoding: 'utf-8', timeout: 8000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    return raw.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  } catch { return ''; }
}

async function loginFromPool(): Promise<string | null> {
  let accounts = [];
  if (existsSync(ACCOUNTS_FILE)) {
    try { accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8')); } catch {}
  }

  // Use first account with valid token
  const now = Date.now();
  for (const a of accounts) {
    if (a.accessToken && a.registeredAt) {
      const registeredTime = new Date(a.registeredAt).getTime();
      if (now - registeredTime < 3500 * 1000) {
        console.log(`Reusing token for ${a.username}`);
        return a.accessToken;
      }
    }
  }

  // Need to register + login
  const username = `capture_${Date.now().toString(36)}`;
  const password = 'Abc!2345';
  const realName = 'TestUser';

  console.log(`Registering new account: ${username}`);
  const reg = await jsonReq('POST', '/api/blade-user/register', {
    userType: '2', tenantId: '000000', name: realName, account: username,
    password, newPassword: password, realName, phone: '13800138000',
    email: `${username}@test.com`, type: '9', checked: true,
  });
  if (reg.status !== 200) { console.error('Register failed'); return null; }

  // Login
  const cap = await jsonReq('GET', '/api/blade-auth/oauth/captcha');
  if (cap.status !== 200) return null;
  const { key, image } = cap.data as { key: string; image: string };
  const captchaImage = image.replace(/^data:image\/png;base64,/, '');
  const code = solveCaptcha(captchaImage);
  if (code.length < 4) { console.error('OCR failed'); return null; }
  console.log(`Captcha: ${code}`);

  const md5pw = createHash('md5').update(password).digest('hex');
  const params = new URLSearchParams({ tenantId: '000000', username, password: md5pw, grant_type: 'captcha', scope: 'all', type: 'account' });
  const login = await jsonReq('POST', `/api/blade-auth/oauth/token?${params}`, undefined, {
    'Authorization': 'Basic cG9ydGFsOnBvcnRhbF9zZWNyZXQ=', 'Tenant-Id': '000000',
    'Captcha-Key': key, 'Captcha-Code': code,
  });
  if (login.status !== 200) { console.error('Login failed'); return null; }
  const t = login.data as { access_token: string };
  console.log(`Token obtained: ${t.access_token.substring(0, 20)}...`);

  // Save
  accounts.unshift({ username, password, realName, phone: '13800138000', accessToken: t.access_token, registeredAt: new Date().toISOString() });
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
  return t.access_token;
}

async function main() {
  const token = await loginFromPool();
  if (!token) { console.error('Cannot obtain token'); process.exit(1); }

  console.log(`\n=== Capturing order request for ${stdNo} ===\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1600, height: 1200 } });

  // Capture ALL requests to any API
  const capturedRequests: Array<{ method: string; url: string; headers: Record<string, string>; body?: string }> = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('gxzl.org.cn') || url.includes('api/') || url.includes('order')) {
      capturedRequests.push({
        method: request.method(),
        url,
        headers: request.headers(),
        body: request.postData() ?? undefined,
      });
    }
  });

  // Navigate to bzuser standard detail page
  // Use the standard ID from our bz search
  const detailUrl = `https://bzuser.gxzl.org.cn/#/standard/standardDetail?stdNo=${encodeURIComponent(stdNo)}`;
  console.log(`Navigating to: ${detailUrl}`);
  await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Try to find and click "下载PDF" button
  const downloadBtn = page.locator('button:has-text("下载PDF"), a:has-text("下载PDF"), span:has-text("下载PDF"), div:has-text("下载PDF")').first();
  if (await downloadBtn.count() > 0) {
    console.log('Found download button, clicking...');
    await downloadBtn.click();
    await page.waitForTimeout(8000);
  } else {
    console.log('Download button not found, checking page text...');
    const bodyText = await page.locator('body').innerText();
    console.log(bodyText.substring(0, 2000));
  }

  // Log all captured order-related requests
  console.log('\n=== Captured API Requests ===');
  for (const req of capturedRequests) {
    if (req.url.includes('order') || req.url.includes('save') || req.url.includes('create') || req.url.includes('download')) {
      console.log(`\n${req.method} ${req.url}`);
      if (req.body) {
        console.log(`Body: ${req.body.substring(0, 2000)}`);
      }
    }
  }

  // Log ALL requests for completeness
  console.log('\n=== ALL Captured Requests ===');
  for (const req of capturedRequests) {
    console.log(`${req.method} ${req.url.substring(0, 150)}`);
    if (req.body) {
      console.log(`  Body: ${req.body.substring(0, 500)}`);
    }
  }

  await browser.close();
  console.log('\nDone. Check output above for order creation request details.');
}

main().catch(console.error);
