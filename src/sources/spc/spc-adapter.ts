/**
 * spc.org.cn 编排层 —— 实现 SourceAdapter，跟 BZ/GBW/BY 并列，作为第 5 个数据源接入。
 *
 * 与 labr 的差异：spc 是「单 stdCode → 单 PDF」契约（适合 SourceAdapter），不像 labr 有
 * kind=0/1 双路径 + 多文件类型 + 5次/日 配额。所以 spc 不另起 spc-service，编排直接
 * 合入 adapter 内（仿 by-adapter）。
 *
 * 关键约束（来自勘察 out/spc-chain-summary.md + 协议层注释）：
 * 1. **Token 单次有效**：stdonline 拿 token 后必须立刻 onlinereading 用掉；不能预拉、不能并发复用
 *    → detectPreview 不预拉 token，仅返回 `previewAvailable: true, pageUrls: []`
 *    → exportStandard 内部串联 stdonline → onlinereading → 入库
 * 2. **Cookie 不能自动获取**：submitlogin 需要验证码（4 字母 JPEG），无 OCR 难自动化
 *    → MVP 走「用户在浏览器手动登录后，把 Cookie 粘到 admin 面板」路径
 *    → cookie 写 settings 表（key=`spc.cookies` / `spc.cookies_expires_at`），重启后复用
 * 3. **Cookie 失效自愈**：stdonline 失败检测 → SpcAuthError → 清 settings → 抛 BadRequestError
 *    给前端弹「spc 凭据失效，请在 admin 面板重新登录」
 * 4. **字节通道**：onlinereading 必须 arrayBuffer() 取 PDF，详见 spc-client.ts 文件头
 *
 * SourceSummary 字段映射：
 *  - id            = `spc:${a100}|${standclass}` （`|` 不与 `:` 冲突，parseStandardId 安全）
 *  - sourceId      = `${a100}|${standclass}`
 *  - standardNumber = stripHighlightTags(a100) → cleanStdCode
 *  - title         = a301（中文标题）
 *  - meta.idmd5    = spc 自己的主键
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';

import type {
  ExportResult,
  PreviewInfo,
  SearchStandardsInput,
  SourceAdapter,
  StandardDetail,
  StandardSummary,
} from '../../domain/standard';
import { BadRequestError, NotFoundError, UpstreamError } from '../../shared/errors';
import { createStandardId, parseStandardId } from '../../shared/id';
import { searchCache } from '../../shared/cache';
import { cleanStdCode } from '../../shared/std-code';
import { getSourceSemaphore } from '../../shared/source-semaphore';
import { getDb, getSetting, setSetting } from '../../services/db';
import { addFileToLibrary } from '../../services/library-index';
import {
  SpcAuthError,
  SpcClient,
  inferStandclass,
  stripHighlightTags,
  type SpcSearchItem,
  type SpcSession,
} from './spc-client';

const SPC_BASE = 'https://www.spc.org.cn';

// settings 表里的 key
const KEY_COOKIES = 'spc.cookies';                    // Cookie header 形态 `JSESSIONID=...; userInfo=...`
const KEY_COOKIES_EXP = 'spc.cookies_expires_at';     // epoch ms

// cookie 寿命未知，保守按 6 小时；用户报告失效后随时可在 admin 面板重新粘
const DEFAULT_COOKIE_LIFETIME_MS = 6 * 3600_000;

export class SpcAdapter implements SourceAdapter {
  readonly source = 'spc' as const;

  private readonly client: SpcClient;
  private session: SpcSession | null = null;

  constructor(client = new SpcClient()) {
    this.client = client;
  }

  // ─── SourceAdapter 实现 ────────────────────────────────────────────────

  async searchStandards(input: SearchStandardsInput): Promise<StandardSummary[]> {
    const cacheKey = `spc:search:${input.query}`;
    const cached = searchCache.get<StandardSummary[]>(cacheKey);
    if (cached) return cached;

    // 搜索匿名可调，不强制 session；带 session 也无害（更稳定）
    const session = this.tryGetSession();
    const items = await this.client.searchByKeyword(input.query, { session: session ?? undefined });
    const result = items.map((it) => this.mapSearchItem(it));
    searchCache.set(cacheKey, result);

    // Side cache: 按 sourceId 存 raw item，让 getStandardDetail / exportStandard 不重复搜
    for (const it of items) {
      const sid = this.makeSourceId(it);
      if (sid) searchCache.set(`spc:item:${sid}`, it, 10 * 60 * 1000);
    }
    return result;
  }

  async getStandardDetail(id: string): Promise<StandardDetail> {
    const { sourceId } = parseStandardId(id);
    const cachedItem = searchCache.get<SpcSearchItem>(`spc:item:${sourceId}`);
    if (cachedItem) {
      return this.mapDetail(cachedItem, id);
    }

    // 未命中 → 反向搜索：sourceId 形如 `a100|standclass`，用 a100 当 keyword 重新搜
    const a100 = this.decodeA100(sourceId.split('|')[0] || '');
    if (!a100) {
      throw new BadRequestError(`Invalid spc sourceId: ${sourceId}`);
    }
    const session = this.tryGetSession();
    const items = await this.client.searchByKeyword(a100, { session: session ?? undefined });
    const match = items.find((it) => this.makeSourceId(it) === sourceId)
      ?? items.find((it) => stripHighlightTags(it.a100).trim() === a100);
    if (!match) {
      throw new NotFoundError(`spc detail not found for ${id}`);
    }
    return this.mapDetail(match, id);
  }

  async detectPreview(id: string): Promise<PreviewInfo> {
    const { sourceId } = parseStandardId(id);
    const [a100Safe, standclass] = sourceId.split('|');
    const a100 = this.decodeA100(a100Safe || '');
    return {
      standardId: id,
      pageUrls: [],
      previewUrl: `${SPC_BASE}/onlinepreview?a100=${encodeURIComponent(a100 || '')}&standclass=${encodeURIComponent(standclass || '')}`,
      captchaRequired: false,
      fileType: 'pdf',
      meta: {
        a100,
        standclass,
        capability: 'reader_token_pdf',
        // 不预拉 token：token 单次有效，预拉立刻就废。前端按这个 flag 走"点导出即下载"
        tokenLazy: true,
      },
    };
  }

  async exportStandard(
    id: string,
    onProgress?: (current: number, total: number) => void,
  ): Promise<ExportResult> {
    // 源级并发限流：spc 默认 2，撞限速再降。详见 src/shared/source-semaphore.ts
    return getSourceSemaphore('spc').run(() => this.exportInner(id, onProgress));
  }

  // ─── 编排内部 ──────────────────────────────────────────────────────────

  private async exportInner(
    id: string,
    _onProgress?: (current: number, total: number) => void,
  ): Promise<ExportResult> {
    const db = getDb();
    const { sourceId } = parseStandardId(id);
    const [a100Safe, standclassRaw] = sourceId.split('|');
    const a100 = this.decodeA100(a100Safe || '');
    const standclass = standclassRaw || inferStandclass(a100);
    if (!a100) {
      throw new BadRequestError(`Invalid spc sourceId: ${sourceId}`);
    }

    const item = await this.resolveItem(sourceId, a100);

    // 走 stdonline → onlinereading，必须串联（token 单次有效）
    const session = this.requireSession();
    let token: string;
    let cookieAfter: string;
    try {
      const r = await this.client.getReaderToken(a100, standclass, session);
      token = r.token;
      cookieAfter = r.cookieHeader;
    } catch (e) {
      if (e instanceof SpcAuthError) {
        this.invalidateSession(db);
        throw new BadRequestError('spc 凭据失效，请在 admin 面板重新粘贴 Cookie');
      }
      throw e;
    }

    // session 内的 JSESSIONID 可能轮换，更新一次
    if (cookieAfter !== session.cookieHeader) {
      const updated: SpcSession = { ...session, cookieHeader: cookieAfter };
      this.session = updated;
      setSetting(db, KEY_COOKIES, cookieAfter);
    }

    let buf: Buffer;
    try {
      buf = await this.client.downloadPdf(token, this.session ?? session);
    } catch (e) {
      // 下载阶段失败更可能是网络抖动，不当作 auth 失效处理
      throw e instanceof Error
        ? new UpstreamError(`spc export failed: ${e.message}`)
        : new UpstreamError('spc export failed: unknown');
    }

    // 临时落盘 → addFileToLibrary 走统一入库
    const stdNumberRaw = stripHighlightTags(item?.a100 ?? a100);
    const stdNumber = cleanStdCode(stdNumberRaw) || stdNumberRaw;
    const title = item?.a301 ?? '';
    const yearMatch = stdNumber.match(/-\s*(\d{4})\s*$/);
    const year = yearMatch?.[1] || '';

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spc-'));
    const tmpFile = path.join(tmpDir, `spc-${Date.now()}.pdf`);
    await fs.writeFile(tmpFile, buf);

    try {
      const r = await addFileToLibrary(db, {
        srcPath: tmpFile,
        stdCode: stdNumber,
        source: 'spc',
        year,
        title,
        ext: 'pdf',
      });
      return {
        standardId: id,
        filePath: r.absPath,
        fileName: r.fileName,
        fileSize: buf.length,
      };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
    }
  }

  /** 取 sourceId 对应的 raw item：先看 cache，没命中就反向搜一次（同 getStandardDetail）。 */
  private async resolveItem(sourceId: string, a100: string): Promise<SpcSearchItem | null> {
    const cached = searchCache.get<SpcSearchItem>(`spc:item:${sourceId}`);
    if (cached) return cached;
    try {
      const session = this.tryGetSession();
      const items = await this.client.searchByKeyword(a100, { session: session ?? undefined });
      const match = items.find((it) => this.makeSourceId(it) === sourceId);
      if (match) {
        searchCache.set(`spc:item:${sourceId}`, match, 10 * 60 * 1000);
        return match;
      }
    } catch (e) {
      // 反向搜索失败不致命：用 a100 兜底
      console.warn('[spc-adapter] resolveItem soft fail:', e instanceof Error ? e.message : String(e));
    }
    return null;
  }

  // ─── Session 管理 ──────────────────────────────────────────────────────

  /** 软取：拿不到不抛错（搜索路径用）。 */
  private tryGetSession(): SpcSession | null {
    const now = Date.now();
    if (this.session && this.session.expiresAt > now) return this.session;
    const db = getDb();
    const cookies = getSetting(db, KEY_COOKIES, '');
    const expRaw = getSetting(db, KEY_COOKIES_EXP, '0');
    const expiresAt = Number(expRaw) || 0;
    if (cookies && expiresAt > now) {
      this.session = { cookieHeader: cookies, expiresAt };
      return this.session;
    }
    return null;
  }

  /** 硬取：拿不到立刻抛错（导出路径用）。 */
  private requireSession(): SpcSession {
    const s = this.tryGetSession();
    if (s) return s;
    // settings 没值 → 用户从没粘过 cookie / 已被 invalidateSession 清空
    throw new BadRequestError('spc 未登录：请在 admin 面板粘贴 Cookie 后重试');
  }

  /** 清 cookie：stdonline 抛 SpcAuthError 时调一次。 */
  private invalidateSession(db: Database.Database): void {
    this.session = null;
    setSetting(db, KEY_COOKIES, '');
    setSetting(db, KEY_COOKIES_EXP, '0');
  }

  /** admin DELETE /spc/cookie 时调；只清进程内缓存（settings 由调用方清）。 */
  _clearMemorySession(): void {
    this.session = null;
  }

  /**
   * Admin 面板调用：把用户从浏览器粘进来的 Cookie header 字符串写进 settings。
   * 不校验有效性 —— 下次 stdonline 失败再统一抛 BadRequestError。
   * 这是 adapter 唯一的"对外写 session" 入口；其它路径只读不写（除 invalidateSession 清空）。
   */
  setSessionFromCookie(cookieHeader: string, lifetimeMs = DEFAULT_COOKIE_LIFETIME_MS): SpcSession {
    const db = getDb();
    const trimmed = cookieHeader.trim();
    if (!trimmed) {
      throw new BadRequestError('Cookie header 为空');
    }
    const expiresAt = Date.now() + lifetimeMs;
    const session: SpcSession = { cookieHeader: trimmed, expiresAt };
    this.session = session;
    setSetting(db, KEY_COOKIES, trimmed);
    setSetting(db, KEY_COOKIES_EXP, String(expiresAt));
    return session;
  }

  // ─── 映射 ──────────────────────────────────────────────────────────────

  private makeSourceId(item: SpcSearchItem): string {
    const a100Plain = stripHighlightTags(item.a100).trim();
    if (!a100Plain) return '';
    const standclass = inferStandclass(a100Plain);
    // a100 可能含 ':'（ISO 形如 'ISO 4287:1997'），但 createStandardId 禁止 sourceId 含 ':'
    // → 替换成 '-'。下载时再 split('|') 拿回前半截做 a100 用 —— 但 spc 后端只认 stdonline
    // 的 a100 参数，必须把 '-' 还原成 ':'？实测勘察的是 'GB+18584-2024'，ISO 路径未实测，
    // 保守做法：sourceId 里把 ':' 编成 '∶'（U+2236，视觉相同但不与分隔符冲突），下载时还原。
    const a100Safe = a100Plain.replace(/:/g, '∶');
    return `${a100Safe}|${standclass}`;
  }

  /** 把 makeSourceId 编码过的 a100 还原成原始形态（恢复 ':'）。 */
  private decodeA100(a100Safe: string): string {
    return a100Safe.replace(/∶/g, ':');
  }

  private mapSearchItem(item: SpcSearchItem): StandardSummary {
    const sourceId = this.makeSourceId(item);
    if (!sourceId) {
      // a100 抠不出 plain text 时无法构造 standardId；用 idmd5 兜底（不参与下载，仅展示）
      return this.toSummary(item, createStandardId('spc', item.idmd5 || 'unknown'));
    }
    // createStandardId 禁止 sourceId 含 ':'；spc 用 '|' 分隔，安全
    return this.toSummary(item, createStandardId('spc', sourceId));
  }

  private mapDetail(item: SpcSearchItem, id: string): StandardDetail {
    return {
      ...this.toSummary(item, id),
      contentText: '',
      moreInfo: {
        idmd5: item.idmd5,
        a100Raw: item.a100,
        a301: item.a301,
        a302: item.a302,
      },
    };
  }

  private toSummary(item: SpcSearchItem, id: string): StandardSummary {
    const plainA100 = stripHighlightTags(item.a100).trim();
    const stdNumber = cleanStdCode(plainA100) || plainA100;
    const standclass = inferStandclass(plainA100);
    // sourceId 形态：跟 id 后半截一致（a100 里 ':' 编成 '∶'）
    const sid = id.startsWith('spc:') ? id.slice(4) : `${plainA100.replace(/:/g, '∶')}|${standclass}`;
    return {
      id,
      source: 'spc',
      sourceId: sid,
      standardNumber: stdNumber,
      title: item.a301 || '',
      publishDate: null,
      implementDate: null,
      abolishedDate: null,
      previewAvailable: true,
      detailUrl: `${SPC_BASE}/onlinepreview?a100=${encodeURIComponent(plainA100)}&standclass=${encodeURIComponent(standclass)}`,
      meta: {
        idmd5: item.idmd5,
        a302: item.a302,
        standclass,
      },
    };
  }
}

// ─── 单例（与 by-adapter 风格一致） ────────────────────────────────────

let _instance: SpcAdapter | null = null;
export function getSpcAdapter(): SpcAdapter {
  if (!_instance) _instance = new SpcAdapter();
  return _instance;
}

/** 测试用：注入 mock client；prod 不调 */
export function _resetSpcAdapter(svc: SpcAdapter | null): void {
  _instance = svc;
}
