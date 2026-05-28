/**
 * spc.org.cn HTTP 客户端 —— 协议层（stateless，无 cookie 持久化、无编排）。
 *
 * 跟 labr-client.ts 类似但 spc 是 SourceAdapter 形态（单 stdCode → 单 PDF），编排合入
 * spc-adapter.ts（仿 by-adapter 套路），不另起 spc-service。
 *
 * 勘察结论（来自 out/spc-chain-summary.md，2026-05 实测）：
 * 1. POST /submitlogin             → 302 + Set-Cookie。需要 GET /checkcode/service 拿验证码
 *    body: type=&loginmethod=0&loginfrom=&username=...&password=...&checkcode=<XNTW>
 * 2. POST /queryfocus              → JSON 列表 [{a100,idmd5,a301,a302}]（匿名可调）
 *    body: text=<keyword>
 * 3. POST /stdlib/stdonline        → HTML 含 <script>var rc = "<base64-token>";</script>（必须登录）
 *    body: a100=<a100>&standclass=<CN|ISO|GW|...>
 * 4. GET  /stdlib/onlinereading?token=<rc>&type=  → 201 application/pdf 完整正本字节流
 *
 * 字节通道关键：第 4 步响应是 `Content-Type: application/pdf;charset=utf-8`（spc 后端
 * 错误添加了 charset）。在浏览器侧 Playwright resp.body() / CDP Network.getResponseBody
 * 都会按 utf-8 解码字节、破坏 PDF。但 Node undici 的 `arrayBuffer()` 不看 charset，永远
 * 返回原始字节 —— 这是 spc 接入能走纯 HTTP 的核心。**必须用 arrayBuffer()，不能 text()**。
 *
 * Token 单次有效：第 3 步拿到的 rc 只能给第 4 步用一次，下次下载必须重新走 stdonline。
 * 不允许在并发请求间复用同一个 token。
 */

import { UpstreamError } from '../../shared/errors';
import { pooledFetch } from '../../shared/http';

const SPC_BASE = 'https://www.spc.org.cn';

/** 登录失败 / cookie 失效。spc-adapter 拿到这个会清 settings 表里的 cookie，让用户重新粘贴。 */
export class SpcAuthError extends UpstreamError {
  constructor(message: string, details?: unknown) {
    super(`spc auth: ${message}`, details);
    this.name = 'SpcAuthError';
  }
}

// ─── 协议类型 ──────────────────────────────────────────────────────────────

/** queryfocus 单条结果。a100 = 标准号（含 <font> 高亮），a301 = 中文标题，a302 = 英文标题 */
export interface SpcSearchItem {
  /** 标准号原始字符串，可能带 `<font color='red'>185</font>-2017` 高亮，调用方要 stripHighlightTags */
  a100: string;
  /** spc 自己的主键（md5），备查用 */
  idmd5: string;
  /** 中文标题 */
  a301: string;
  /** 英文标题（可能空） */
  a302?: string;
  /** 其它字段一并保留 */
  meta?: Record<string, unknown>;
}

/** 调用方持有，传给需要登录的方法。cookie 持久化在 spc-adapter（settings 表）。 */
export interface SpcSession {
  /** 拼好的 Cookie header 值，形如 `JSESSIONID=...; userInfo=...`。client 不解析，原样发 */
  cookieHeader: string;
  /** epoch ms。spc-adapter 自己判过期，client 不查 */
  expiresAt: number;
}

// ─── 纯函数工具 ────────────────────────────────────────────────────────────

/**
 * 剥 spc queryfocus 的 `<font color='red'>185</font>-2017` 高亮标签，保留文本。
 * 不动其它字符，cleanStdCode / extractFullCode 在 adapter 层再跑。
 */
export function stripHighlightTags(s: string): string {
  if (!s) return '';
  return s.replace(/<\/?font[^>]*>/gi, '').replace(/<\/?mark[^>]*>/gi, '');
}

/**
 * 从 a100 前缀推断 stdonline 必带的 standclass 参数。
 *
 * spc 后端把标准按发布机构分大类：CN（中国）/ ISO / GW（国外行业）。stdonline POST
 * 必须带正确的 standclass，否则返回的 HTML 抠不到 rc token。
 *
 * 已知前缀映射（来自 basicquerycount 接口枚举 + 实测 GB 18584-2024 → CN）。
 */
export function inferStandclass(a100: string): string {
  const head = a100.trim().toUpperCase().replace(/\s+/g, ' ');

  // 国外大类
  if (/^(ISO|IEC|ISO\/IEC|ITU)\b/.test(head)) return 'ISO';
  if (/^(ASTM|BS|DIN|ANSI|JIS|NF|EN|UL|API)\b/.test(head)) return 'GW';

  // 中国大类：国标 / 行标 / 地标 / 检定规程等
  if (/^(GB|JJF|JJG|DB|HB|HG|HJ|JC|JG|JT|JY|JR|JB|NY|QB|QC|QJ|QX|SH|SJ|SL|SN|SY|TB|TY|YB|YC|YD|YS|YY|YZ|CB|CH|CJ|CY|DA|DL|DZ|EJ|FZ|GA|GH|GM|GY|JT|JZ|LD|LS|LY|MH|MT|MZ|NJ|RB|SB|SC|SD|SE|SF|WB|WH|WJ|WM|WS|XB|ZB|ZY|T\/CECS|T\/CAGHP|T\/)\b/.test(head)) {
    return 'CN';
  }

  // 默认按中国处理（spc 站本身以中国标准为主）
  return 'CN';
}

/**
 * 从 stdonline 返回的 HTML 抠 `<script>var rc = "<base64-token>";</script>` 的 token。
 *
 * 实测 HTML 里有多个 `var xxx = "..."`，必须锚定 `var rc`。token 是 base64-like
 * 字符串（A-Z a-z 0-9 / + =），但稳起见我们抓引号内任意非引号字符。
 */
export function extractTokenFromHtml(html: string): string {
  if (!html) return '';
  const m = html.match(/var\s+rc\s*=\s*"([^"]+)"/);
  return m?.[1] ?? '';
}

/**
 * 把 Response 的 Set-Cookie list 解析成 `key=val` 拼接的 Cookie header 形态。
 * 跟 by-adapter 的 extractSetCookie 同款，不做合并，纯抽取。
 */
export function parseSetCookieList(resp: Response): string {
  const cookies = resp.headers.getSetCookie?.() ?? [];
  return cookies
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

/**
 * 合并两份 Cookie header 字符串，后者覆盖前者同名 key。spc-adapter 的 cookie 自愈
 * 路径需要：拿旧 cookie 走 stdonline，万一 Set-Cookie 给了新 JSESSIONID 要 merge。
 */
export function mergeCookies(existing: string, incoming: string): string {
  if (!incoming) return existing;
  if (!existing) return incoming;
  const map = new Map<string, string>();
  for (const c of existing.split(';')) {
    const [key, ...rest] = c.trim().split('=');
    if (key) map.set(key, rest.join('='));
  }
  for (const c of incoming.split(';')) {
    const [key, ...rest] = c.trim().split('=');
    if (key) map.set(key, rest.join('='));
  }
  return Array.from(map.entries())
    .map(([k, v]) => (v ? `${k}=${v}` : k))
    .join('; ');
}

// ─── 客户端 ────────────────────────────────────────────────────────────────

/**
 * 协议层。所有方法 stateless：调用方在 SpcSession 里维护 cookie，传给需要登录的方法。
 * cookie 持久化和并发限流在 spc-adapter。
 */
export class SpcClient {
  /**
   * POST /queryfocus  body: `text=<keyword>`
   *
   * 匿名可调，返回 JSON 列表。a100 字段含 <font> 高亮，调用方要 stripHighlightTags。
   * 注：上游可能返回非 JSON 错误页（5xx 时），所以要保护性 parse。
   */
  async searchByKeyword(keyword: string, opts: { session?: SpcSession } = {}): Promise<SpcSearchItem[]> {
    const body = new URLSearchParams({ text: keyword });
    const resp = await pooledFetch(`${SPC_BASE}/queryfocus`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: SPC_BASE,
        Referer: `${SPC_BASE}/basicsearch`,
        ...(opts.session ? { Cookie: opts.session.cookieHeader } : {}),
      },
      body: body.toString(),
      timeoutMs: 15_000,
    });
    if (!resp.ok) throw new UpstreamError(`spc queryfocus HTTP ${resp.status}`);
    const json: unknown = await resp.json().catch(() => null);
    if (!Array.isArray(json)) return [];
    return json.map((it: any) => ({
      a100: String(it.a100 ?? ''),
      idmd5: String(it.idmd5 ?? ''),
      a301: String(it.a301 ?? ''),
      a302: it.a302 ? String(it.a302) : undefined,
      meta: it as Record<string, unknown>,
    }));
  }

  /**
   * POST /stdlib/stdonline  body: `a100=<a100>&standclass=<CN|ISO|GW>`
   *
   * **必须登录**。返回 HTML，内含 `<script>var rc = "<token>";</script>`。
   * 失效检测：
   *  - 302 且 Location 指向 /loginpage → cookie 失效 → SpcAuthError
   *  - 200 但 extractTokenFromHtml 抠不到 rc → cookie 失效（被服务端静默渲染登录页）→ SpcAuthError
   *
   * a100 注意：含空格 'GB 18584-2024' → URLSearchParams 会自动编成 `GB+18584-2024`（spc 后端只认 +）。
   */
  async getReaderToken(
    a100: string,
    standclass: string,
    session: SpcSession,
  ): Promise<{ token: string; cookieHeader: string }> {
    const body = new URLSearchParams({ a100, standclass });
    const resp = await pooledFetch(`${SPC_BASE}/stdlib/stdonline`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: session.cookieHeader,
        Origin: SPC_BASE,
        Referer: `${SPC_BASE}/basicsearch`,
      },
      body: body.toString(),
      timeoutMs: 20_000,
      redirect: 'manual',
    });

    // 302 → /loginpage / /login 都视为 cookie 失效
    if (resp.status === 302 || resp.status === 301 || resp.status === 303) {
      const loc = resp.headers.get('location') || '';
      if (/login/i.test(loc)) {
        throw new SpcAuthError(`stdonline redirected to ${loc} (cookie expired)`);
      }
      throw new UpstreamError(`spc stdonline unexpected redirect ${resp.status} → ${loc}`);
    }
    if (!resp.ok) {
      throw new UpstreamError(`spc stdonline HTTP ${resp.status}`);
    }

    const html = await resp.text();
    const token = extractTokenFromHtml(html);
    if (!token) {
      // 服务端可能返回 200 但内容是登录页 / 无权页 —— 兜底当 auth 失效
      throw new SpcAuthError('stdonline response missing var rc (cookie expired or no permission)');
    }

    // 合并可能的 Set-Cookie（JSESSIONID 轮换）让调用方更新
    const newCookies = parseSetCookieList(resp);
    return {
      token,
      cookieHeader: newCookies ? mergeCookies(session.cookieHeader, newCookies) : session.cookieHeader,
    };
  }

  /**
   * GET /stdlib/onlinereading?token=<token>&type=
   *
   * 返回完整 PDF 字节流。**必须 arrayBuffer()，不能 text()**（详见文件头注释）。
   * Token 单次有效，调用前 caller 已经走过 stdonline 拿到 fresh token。
   */
  async downloadPdf(
    token: string,
    session: SpcSession,
    opts: { signal?: AbortSignal } = {},
  ): Promise<Buffer> {
    const url = `${SPC_BASE}/stdlib/onlinereading?token=${encodeURIComponent(token)}&type=`;
    const resp = await pooledFetch(url, {
      method: 'GET',
      headers: {
        Cookie: session.cookieHeader,
        Referer: `${SPC_BASE}/onlinepreview`,
      },
      timeoutMs: 60_000,
      retries: 2,
      signal: opts.signal,
    });
    if (!resp.ok && resp.status !== 201) {
      throw new UpstreamError(`spc onlinereading HTTP ${resp.status}`);
    }
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);
    // sanity check：PDF 必须以 %PDF- 开头，否则可能是登录页 HTML
    if (buf.length < 8 || buf.slice(0, 5).toString('ascii') !== '%PDF-') {
      const head = buf.slice(0, 64).toString('utf8');
      throw new UpstreamError(`spc onlinereading non-PDF response (${buf.length}B): ${head.slice(0, 80)}`);
    }
    return buf;
  }

  /**
   * POST /submitlogin  body: type=&loginmethod=0&loginfrom=&username=...&password=...&checkcode=<4字母>
   *
   * 完整登录路径需要 captcha；当前 MVP 不自动调（OCR 难度高），保留方法供后续 polish。
   * adapter 层默认走"用户手动粘贴 cookie"路径。
   *
   * 调用前必须先 GET /checkcode/service 拿验证码 + 关联的 JSESSIONID cookie，
   * 这里要把那份 cookie 一起传进来（initialCookie），让 submitlogin 复用 session。
   */
  async submitLogin(
    username: string,
    password: string,
    checkcode: string,
    initialCookie: string,
  ): Promise<SpcSession> {
    const body = new URLSearchParams({
      type: '',
      loginmethod: '0',
      loginfrom: '',
      username,
      password,
      checkcode,
    });
    const resp = await pooledFetch(`${SPC_BASE}/submitlogin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: initialCookie,
        Origin: SPC_BASE,
        Referer: `${SPC_BASE}/login`,
      },
      body: body.toString(),
      timeoutMs: 15_000,
      redirect: 'manual',
    });
    // 成功是 302，body 里可能没 Set-Cookie；session cookie 已在 initialCookie 里（JSESSIONID）
    if (resp.status !== 302 && !resp.ok) {
      throw new SpcAuthError(`submitlogin HTTP ${resp.status}`);
    }
    const merged = mergeCookies(initialCookie, parseSetCookieList(resp));
    // spc cookie 寿命未知，保守按 6 小时（用户报告失效后再调）
    return { cookieHeader: merged, expiresAt: Date.now() + 6 * 3600_000 };
  }

  /**
   * GET /checkcode/service  → JPEG 字节 + 关联 JSESSIONID cookie
   * 供后续 admin captcha 流程用；MVP 不调。
   */
  async getCaptcha(): Promise<{ jpeg: Buffer; cookieHeader: string }> {
    const resp = await pooledFetch(`${SPC_BASE}/checkcode/service`, {
      method: 'GET',
      timeoutMs: 10_000,
    });
    if (!resp.ok) throw new UpstreamError(`spc checkcode HTTP ${resp.status}`);
    const ab = await resp.arrayBuffer();
    return {
      jpeg: Buffer.from(ab),
      cookieHeader: parseSetCookieList(resp),
    };
  }
}
