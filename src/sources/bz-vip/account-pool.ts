import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import https from 'node:https';

// --- Types ---

export interface PoolAccount {
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
  // Pool management
  downloadsUsed?: number;
  downloadMonth?: string;
  tokenObtainedAt?: string;
}

interface StoredAccount {
  username: string; password: string; realName: string; phone: string;
  accessToken?: string; refreshToken?: string; tokenType?: string;
  expiresIn?: number; registeredAt: string; loggedInAt?: string;
  downloadsUsed?: number; downloadMonth?: string; tokenObtainedAt?: string;
}

// --- HTTP helper ---

const API_IP = '222.84.61.205';
const API_HOST = 'bz.gxzl.org.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function jsonReq<T = unknown>(method: string, p: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; data: T }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      'User-Agent': UA, 'Content-Type': 'application/json', Host: API_HOST, ...extraHeaders,
    };
    if (payload) headers['Content-Length'] = String(Buffer.byteLength(payload));

    const req = https.request({
      hostname: API_IP, port: 443, path: p, method,
      rejectUnauthorized: false, family: 4, timeout: 15000, headers,
    }, (res) => {
      let buf = '';
      res.on('data', (c: Buffer) => buf += c.toString());
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(buf) as T }); }
        catch { resolve({ status: res.statusCode ?? 0, data: buf as T }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export function bzVipGet(path: string, extraHeaders?: Record<string, string>): Promise<{ status: number; data: unknown }> {
  return jsonReq('GET', path, undefined, extraHeaders);
}

export function bzVipPost(path: string, body: unknown, extraHeaders?: Record<string, string>): Promise<{ status: number; data: unknown }> {
  return jsonReq('POST', path, body, extraHeaders);
}

export function bzVipDownload(urlPath: string): Promise<{ status: number; data: Buffer; contentType: string; disposition: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': UA, Host: API_HOST,
    };
    const req = https.request({
      hostname: API_IP, port: 443, path: urlPath, method: 'GET',
      rejectUnauthorized: false, family: 4, timeout: 60000, headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode ?? 0,
          data: Buffer.concat(chunks),
          contentType: res.headers['content-type'] ?? '',
          disposition: res.headers['content-disposition'] ?? '',
        });
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

// --- OCR helper ---

const OCR_BRIDGE = path.join(process.cwd(), 'scripts', 'ocr_ddddocr.py');

function solveCaptcha(base64Image: string): string {
  try {
    const raw = execFileSync('python', [OCR_BRIDGE], {
      input: base64Image, encoding: 'utf-8', timeout: 8000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    return raw.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  } catch { return ''; }
}

const AUTH_HEADER = process.env.BZVIP_CLIENT_AUTH ?? 'Basic cG9ydGFsOnBvcnRhbF9zZWNyZXQ=';

const ACCOUNTS_FILE = path.join(process.cwd(), 'data', 'accounts.json');

export class AccountPoolManager {
  private accounts: PoolAccount[] = [];
  private locks = new Set<string>();
  private _acquireQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.load();
  }

  load(): void {
    if (!existsSync(ACCOUNTS_FILE)) { this.accounts = []; return; }
    try {
      const raw: StoredAccount[] = JSON.parse(readFileSync(ACCOUNTS_FILE, 'utf-8'));
      this.accounts = raw.map(a => ({
        ...a,
        downloadsUsed: a.downloadsUsed ?? 0,
        downloadMonth: a.downloadMonth ?? '',
      }));
    } catch { this.accounts = []; }
  }

  async save(): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(ACCOUNTS_FILE, JSON.stringify(this.accounts, null, 2), 'utf-8');
  }

  /** Get a usable account with valid token and remaining quota */
  async acquire(): Promise<PoolAccount> {
    // Serialize acquires to prevent race conditions
    const prev = this._acquireQueue;
    let release: () => void;
    this._acquireQueue = new Promise<void>(resolve => { release = resolve; });

    await prev;

    try {
      this.load(); // refresh from disk

      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      // Reset monthly counters
      for (const a of this.accounts) {
        if (a.downloadMonth !== month) {
          a.downloadsUsed = 0;
          a.downloadMonth = month;
        }
      }

      // Sort: prefer accounts with valid tokens + remaining quota
      const available = this.accounts.filter(a => {
        if (this.locks.has(a.username)) return false;
        if ((a.downloadsUsed ?? 0) >= 15) return false;
        return true;
      });

      available.sort((a, b) => {
        const aValid = a.accessToken && a.loggedInAt && this.tokenValid(a);
        const bValid = b.accessToken && b.loggedInAt && this.tokenValid(b);
        if (aValid && !bValid) return -1;
        if (!aValid && bValid) return 1;
        return (a.downloadsUsed ?? 0) - (b.downloadsUsed ?? 0);
      });

      if (available.length === 0) {
        throw new Error('No available accounts in pool (all locked, exhausted, or missing)');
      }

      const account = available[0];
      this.locks.add(account.username);

      // Ensure valid token
      if (!account.accessToken || !this.tokenValid(account)) {
        await this.refreshOrLogin(account);
      }

      return account;
    } finally {
      release!();
    }
  }

  /** Release an account after download */
  async release(account: PoolAccount, success: boolean): Promise<void> {
    this.locks.delete(account.username);
    if (success) {
      account.downloadsUsed = (account.downloadsUsed ?? 0) + 1;
      const now = new Date();
      account.downloadMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    try {
      await this.save();
    } catch (e) {
      console.error(`Failed to save account state: ${(e as Error).message}`);
    }
  }

  /** Get pool statistics */
  getStats(): { total: number; available: number; locked: number; exhausted: number } {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const total = this.accounts.length;
    const exhausted = this.accounts.filter(a => (a.downloadMonth === month && (a.downloadsUsed ?? 0) >= 15)).length;
    const locked = this.locks.size;
    const available = total - exhausted - locked;
    return { total, available, locked, exhausted };
  }

  private tokenValid(a: PoolAccount): boolean {
    if (!a.accessToken || !a.loggedInAt || !a.expiresIn) return false;
    const expiresAt = new Date(a.loggedInAt).getTime() + a.expiresIn * 1000;
    // Consider expired if less than 5 minutes remaining
    return Date.now() < expiresAt - 300_000;
  }

  private async refreshOrLogin(account: PoolAccount): Promise<void> {
    // Try refresh token first
    if (account.refreshToken) {
      const refreshed = await this.tryRefreshToken(account);
      if (refreshed) return;
    }

    // Full re-login
    await this.loginAccount(account);
  }

  private async tryRefreshToken(account: PoolAccount): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        tenantId: '000000', grant_type: 'refresh_token', refresh_token: account.refreshToken!,
      });
      console.warn(`Token refresh attempt for ${account.username}`);
      const res = await jsonReq<{ access_token?: string; refresh_token?: string; token_type?: string; expires_in?: number }>(
        'POST', '/api/blade-auth/oauth/token?' + params.toString(), undefined,
        { 'Authorization': AUTH_HEADER, 'Tenant-Id': '000000' },
      );
      if (res.status === 200 && res.data.access_token) {
        account.accessToken = res.data.access_token;
        account.refreshToken = res.data.refresh_token;
        account.tokenType = res.data.token_type;
        account.expiresIn = res.data.expires_in;
        account.loggedInAt = new Date().toISOString();
        this.save();
        return true;
      }
    } catch { /* fall through to login */ }
    return false;
  }

  private async loginAccount(account: PoolAccount): Promise<void> {
    // Get captcha
    const cap = await jsonReq<{ key: string; image: string }>('GET', '/api/blade-auth/oauth/captcha');
    if (cap.status !== 200 || !cap.data?.image) {
      throw new Error('Failed to get captcha for login');
    }
    const { key, image } = cap.data;
    const b64 = image.replace(/^data:image\/png;base64,/, '');

    let code = '';
    for (let i = 0; i < 3; i++) {
      code = solveCaptcha(b64);
      if (code.length >= 4) break;
    }
    if (code.length < 4) throw new Error('OCR failed for login captcha');

    const md5pw = createHash('md5').update(account.password).digest('hex');
    const params = new URLSearchParams({
      tenantId: '000000', username: account.username, password: md5pw,
      grant_type: 'captcha', scope: 'all', type: 'account',
    });

    const login = await jsonReq<{ access_token: string; refresh_token: string; token_type: string; expires_in: number }>(
      'POST', '/api/blade-auth/oauth/token?' + params.toString(), undefined,
      {
        'Authorization': AUTH_HEADER,
        'Tenant-Id': '000000', 'Captcha-Key': key, 'Captcha-Code': code,
      },
    );

    if (login.status !== 200 || !login.data?.access_token) {
      throw new Error(`Login failed for ${account.username}`);
    }

    account.accessToken = login.data.access_token;
    account.refreshToken = login.data.refresh_token;
    account.tokenType = login.data.token_type;
    account.expiresIn = login.data.expires_in;
    account.loggedInAt = new Date().toISOString();
    this.save();
  }
}

// Singleton
export const accountPool = new AccountPoolManager();
