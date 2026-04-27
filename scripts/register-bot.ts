// 注册机：批量注册 bz.gxzl.org.cn 个人账号，形成账号池
// 用法: npx tsx scripts/register-bot.ts [数量] [--login]
//   npx tsx scripts/register-bot.ts 5          # 注册5个账号
//   npx tsx scripts/register-bot.ts 5 --login  # 注册5个账号并登录获取token

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';

const BASE_HOST = 'bz.gxzl.org.cn';
const BASE_PORT = 443;
const ACCOUNTS_FILE = path.join(process.cwd(), 'data', 'accounts.json');
const PYTHON_BRIDGE = path.join(process.cwd(), 'scripts', 'ocr_ddddocr.py');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

interface Account {
  username: string;
  password: string;
  realName: string;
  phone: string;
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  registeredAt: string;
  loggedInAt?: string;
}

// ========== 随机数据生成 ==========

const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴',
  '徐', '孙', '胡', '朱', '高', '林', '何', '郭', '马', '罗'];
const GIVEN_NAMES = ['明', '华', '伟', '强', '磊', '洋', '勇', '军', '杰', '涛',
  '斌', '浩', '鹏', '飞', '超', '波', '鑫', '晶', '玲', '芳'];

function randomInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[randomInt(0, arr.length - 1)]; }

function generateUsername(): string {
  const l = 'abcdefghijklmnopqrstuvwxyz';
  return Array.from({ length: randomInt(5, 7) }, () => pick(l)).join('') + randomInt(100, 999);
}

function generatePassword(): string {
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const specials = '!@#$%&*';
  // 至少1小写+1数字+1特殊字符，6-14位
  const pwd = [
    pick(lower), pick(digits), pick(specials),
    ...Array.from({ length: randomInt(3, 8) }, () => pick(lower + digits + specials)),
  ];
  for (let i = pwd.length - 1; i > 0; i--) {
    const j = randomInt(0, i); [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
  }
  return pwd.join('');
}

function generateRealName(): string { return pick(SURNAMES) + pick(GIVEN_NAMES); }

function generatePhone(): string {
  return pick(['138', '139', '150', '151', '152', '158', '159', '186', '187', '188'])
    + String(randomInt(10000000, 99999999));
}

// ========== HTTPS 请求 (IPv4 only) ==========

function jsonReq(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      'User-Agent': UA,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));

    const req = https.request({
      hostname: BASE_HOST,
      port: BASE_PORT,
      path,
      method,
      rejectUnauthorized: false,
      family: 4,
      timeout: 15000,
      headers,
    }, (res) => {
      let buf = '';
      res.on('data', (c: Buffer) => buf += c.toString());
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, data: JSON.parse(buf) });
        } catch {
          resolve({ status: res.statusCode ?? 0, data: buf });
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ========== 注册 ==========

async function register(username: string, password: string, realName: string, phone: string): Promise<boolean> {
  const { status, data } = await jsonReq('POST', '/api/blade-user/register', {
    userType: '2',
    tenantId: '000000',
    name: realName,
    account: username,
    password,
    newPassword: password,
    realName,
    phone,
    email: `${username}@test.com`,
    type: '9',
    checked: true,
  });

  if (status !== 200) {
    console.error(`  注册请求失败: HTTP ${status}`);
    return false;
  }

  const d = data as { code: number; success: boolean; msg: string };
  if (d.code === 200 && d.success) return true;
  console.error(`  注册失败: ${JSON.stringify(d)}`);
  return false;
}

// ========== 验证码识别 ==========

function solveCaptcha(base64Image: string): string {
  try {
    const raw = execFileSync('python', [PYTHON_BRIDGE], {
      input: base64Image,
      encoding: 'utf-8',
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return raw.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  } catch { return ''; }
}

// ========== 登录 ==========

async function login(username: string, password: string): Promise<{ accessToken: string; refreshToken: string; tokenType: string; expiresIn: number } | null> {
  // Step 1: 获取验证码
  const { status: capStatus, data: capData } = await jsonReq('GET', '/api/blade-auth/oauth/captcha');
  if (capStatus !== 200) { console.error('  获取验证码失败'); return null; }
  const { key, image } = capData as { key: string; image: string };
  const captchaImage = image.replace(/^data:image\/png;base64,/, '');

  // Step 2: OCR识别验证码
  let captchaCode = '';
  for (let i = 0; i < 3; i++) {
    captchaCode = solveCaptcha(captchaImage);
    if (captchaCode.length >= 4) break;
    console.log(`  验证码识别失败(第${i + 1}次): "${captchaCode}"，重试...`);
  }
  if (captchaCode.length < 4) { console.error(`  验证码识别最终失败`); return null; }
  console.log(`  验证码: ${captchaCode}`);

  // Step 3: 提交登录
  const md5pw = createHash('md5').update(password).digest('hex');
  const params = new URLSearchParams({ tenantId: '000000', username, password: md5pw, grant_type: 'captcha', scope: 'all', type: 'account' });

  const { status: loginStatus, data: loginData } = await jsonReq(
    'POST',
    `/api/blade-auth/oauth/token?${params.toString()}`,
    undefined,
    {
      'Authorization': 'Basic cG9ydGFsOnBvcnRhbF9zZWNyZXQ=',
      'Tenant-Id': '000000',
      'Captcha-Key': key,
      'Captcha-Code': captchaCode,
    },
  );

  if (loginStatus !== 200) {
    console.error(`  登录失败: HTTP ${loginStatus} ${JSON.stringify(loginData).substring(0, 200)}`);
    return null;
  }

  const t = loginData as { access_token: string; refresh_token: string; token_type: string; expires_in: number };
  console.log(`  登录成功！expires_in: ${t.expires_in}s`);
  return { accessToken: t.access_token, refreshToken: t.refresh_token, tokenType: t.token_type, expiresIn: t.expires_in };
}

// ========== 账号池管理 ==========

function loadPool(): Account[] {
  if (!existsSync(ACCOUNTS_FILE)) return [];
  try { return JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8')); } catch { return []; }
}

function savePool(accounts: Account[]) {
  writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2), 'utf-8');
  console.log(`账号池: ${ACCOUNTS_FILE} (共${accounts.length}个)`);
}

// ========== 主流程 ==========

async function main() {
  const args = process.argv.slice(2);
  const count = parseInt(args[0]) || 1;
  const doLogin = args.includes('--login');

  console.log(`=== bz注册机（个人账号）===`);
  console.log(`目标: 注册${count}个账号${doLogin ? ' + 登录获取token' : ''}\n`);

  const pool = loadPool();
  const existing = new Set(pool.map(a => a.username));
  let success = 0;

  for (let i = 0; i < count; i++) {
    let username: string;
    do { username = generateUsername(); } while (existing.has(username));

    const password = generatePassword();
    const realName = generateRealName();
    const phone = generatePhone();

    console.log(`[${i + 1}/${count}] ${username} (${realName}) 密码: ${password}`);

    const ok = await register(username, password, realName, phone);
    if (!ok) { console.log(`  跳过\n`); continue; }
    console.log(`  注册成功！`);

    const account: Account = { username, password, realName, phone, registeredAt: new Date().toISOString() };

    if (doLogin) {
      await new Promise(r => setTimeout(r, 2000));
      console.log(`  登录中...`);
      const token = await login(username, password);
      if (token) {
        account.accessToken = token.accessToken;
        account.refreshToken = token.refreshToken;
        account.tokenType = token.tokenType;
        account.expiresIn = token.expiresIn;
        account.loggedInAt = new Date().toISOString();
      }
    }

    pool.push(account);
    existing.add(username);
    success++;
    savePool(pool);

    if (i < count - 1) await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
  }

  console.log(`\n=== 完成: ${success}/${count} ===`);
  if (doLogin) console.log(`已登录: ${pool.filter(a => a.accessToken).length}`);
}

main().catch(e => { console.error('出错:', e); process.exit(1); });
