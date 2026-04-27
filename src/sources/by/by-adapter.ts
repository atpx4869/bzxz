import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ExportResult,
  PreviewInfo,
  SearchStandardsInput,
  SourceAdapter,
  StandardDetail,
  StandardSummary,
} from '../../domain/standard';
import { BadRequestError, NotFoundError, UpstreamError } from '../../shared/errors';
import { EXPORTS_DIR } from '../../shared/fs';
import { createStandardId, parseStandardId } from '../../shared/id';

// BY 内网系统配置
const BY_BASE = 'http://172.16.100.72:8080';
const LOGIN_URL = `${BY_BASE}/login.aspx`;
const DEPT_ID = 'fc4186fba640402188b91e6bd0d491a6';
const USERNAME = 'leiming';
const PASSWORD = '888888';
const MAX_PAGES = 5;
const TIMEOUT_MS = 10000;
const TIMEOUT_FAST_MS = 5000;

interface BySearchItem {
  idx: number;
  stdNo: string;
  stdName: string;
  status: string;
  publish: string;
  implement: string;
  siid: string;
  pdfPath: string;
}

export class ByAdapter implements SourceAdapter {
  readonly source = 'by' as const;

  private sessionCookies: string | null = null;
  private loggedIn = false;

  async searchStandards(input: SearchStandardsInput): Promise<StandardSummary[]> {
    if (!(await this.isAvailable())) {
      throw new UpstreamError('BY internal network is not accessible');
    }

    if (!(await this.ensureLogin())) {
      throw new UpstreamError('BY login failed');
    }

    const keyword = input.query;
    const items = await this.searchInternal(keyword);

    return items.map((item) => this.mapSearchItem(item));
  }

  async getStandardDetail(id: string): Promise<StandardDetail> {
    const { sourceId } = parseStandardId(id);

    if (!(await this.ensureLogin())) {
      throw new UpstreamError('BY login failed');
    }

    const searchResults = await this.searchInternal(sourceId);
    const match = searchResults.find((item) => item.siid === sourceId || item.stdNo === sourceId);

    if (!searchResults.length) {
      throw new NotFoundError(`BY detail not found for ${id}`);
    }

    const item = match ?? searchResults[0];
    return this.mapDetail(item, id);
  }

  async detectPreview(id: string): Promise<PreviewInfo> {
    const detail = await this.getStandardDetail(id);

    const downloadUrl =
      typeof detail.moreInfo?.pdfPath === 'string' ? this.resolvePdfUrl(detail.moreInfo.pdfPath) : '';

    return {
      standardId: id,
      pageUrls: [],
      previewUrl: `${BY_BASE}/Manager/StandManager/StandDetail.aspx?SIId=${detail.sourceId}`,
      downloadUrl: downloadUrl || undefined,
      captchaRequired: false,
      fileType: 'pdf',
      meta: {
        siid: detail.sourceId,
        pdfPath: detail.moreInfo?.pdfPath ?? null,
        capability: 'direct_pdf_download',
      },
    };
  }

  async exportStandard(id: string): Promise<ExportResult> {
    if (!(await this.ensureLogin())) {
      throw new UpstreamError('BY login failed');
    }

    const { sourceId } = parseStandardId(id);

    // Access detail page directly using siid
    const detailUrl = `${BY_BASE}/Manager/StandManager/StandDetail.aspx?SIId=${encodeURIComponent(sourceId)}`;
    let html: string;
    try {
      const resp = await fetch(detailUrl, {
        headers: { Cookie: this.sessionCookies ?? '' },
        signal: AbortSignal.timeout(TIMEOUT_FAST_MS),
      });
      if (!resp.ok) {
        throw new UpstreamError('BY detail page not accessible');
      }
      html = await resp.text();
    } catch (err) {
      throw new UpstreamError('BY export failed: cannot access detail page');
    }

    // Extract standard info from detail page
    const stdNo = extractStdNo(extractRegex(html, /id="txtA100"[^>]*>([^<]+)/));
    const stdName = extractStdName(extractRegex(html, /id="txtA298"[^>]*>([^<]+)/));

    // Extract PDF path from hidden field
    const pdfPathMatch = html.match(/name="hidB000"[^>]+value="([^"]+)"/);
    if (!pdfPathMatch?.[1]) {
      throw new UpstreamError('BY export failed: no PDF path found on detail page');
    }

    const pdfUrl = this.resolvePdfUrl(pdfPathMatch[1]);
    const fileName = buildByFileName(stdNo || sourceId, stdName || 'unknown');
    const filePath = path.join(EXPORTS_DIR, fileName);

    const downloaded = await this.downloadPdf(pdfUrl, filePath);
    if (!downloaded) {
      throw new UpstreamError('BY export failed: PDF download failed');
    }

    return { standardId: id, filePath, fileName };
  }

  // --- Internal Methods ---

  private async isAvailable(): Promise<boolean> {
    try {
      const resp = await fetch(BY_BASE, { method: 'HEAD', signal: AbortSignal.timeout(3000) });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private async ensureLogin(): Promise<boolean> {
    if (this.loggedIn) {
      return true;
    }

    try {
      // Step 1: GET login page
      const r1 = await fetch(LOGIN_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!r1.ok) return false;

      const html1 = await r1.text();
      const cookies1 = extractSetCookie(r1);
      const vs1 = extractHiddenField(html1, '__VIEWSTATE');
      const ev1 = extractHiddenField(html1, '__EVENTVALIDATION');

      if (!vs1 || !ev1) return false;

      // Step 2: POST department selection
      const deptBody = new URLSearchParams({
        __EVENTTARGET: 'ddlDept',
        __EVENTARGUMENT: '',
        __VIEWSTATE: vs1,
        __EVENTVALIDATION: ev1,
        ddlDept: DEPT_ID,
      });

      const r2 = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: mergeHeaders(cookies1, { 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: deptBody.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r2.ok) return false;

      const html2 = await r2.text();
      const cookies2 = mergeCookies(cookies1, extractSetCookie(r2));
      const vs2 = extractHiddenField(html2, '__VIEWSTATE');
      const ev2 = extractHiddenField(html2, '__EVENTVALIDATION');

      if (!vs2 || !ev2) return false;

      // Step 3: POST credentials
      const loginBody = new URLSearchParams({
        __EVENTTARGET: '',
        __EVENTARGUMENT: '',
        __VIEWSTATE: vs2,
        __EVENTVALIDATION: ev2,
        ddlDept: DEPT_ID,
        ddlUserName: USERNAME,
        txtLogidPwd: PASSWORD,
        btnLogin: '登录',
      });

      const r3 = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: mergeHeaders(cookies2, { 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: loginBody.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (r3.status !== 302) return false;

      const cookies3 = mergeCookies(cookies2, extractSetCookie(r3));
      const location = r3.headers.get('location');

      // Step 4: Follow landing page
      if (location) {
        const landingUrl = location.startsWith('http') ? location : `${BY_BASE}${location}`;
        const r4 = await fetch(landingUrl, {
          headers: { Cookie: cookies3 },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        this.sessionCookies = mergeCookies(cookies3, extractSetCookie(r4));
      } else {
        this.sessionCookies = cookies3;
      }

      this.loggedIn = true;
      return true;
    } catch {
      return false;
    }
  }

  private async searchInternal(keyword: string): Promise<BySearchItem[]> {
    const searchUrl = `${BY_BASE}/Customer/StandSerarch/StandInfoList.aspx?A100=${encodeURIComponent(keyword)}&A298=`;
    const cookieHeader = this.sessionCookies ?? '';
    const results: BySearchItem[] = [];

    try {
      const r1 = await fetch(searchUrl, {
        headers: { Cookie: cookieHeader },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r1.ok) return [];

      const html1 = await r1.text();
      results.push(...parseSearchPage(html1));

      // Pagination
      const totalPages = parseTotalPages(html1);
      const pagesToFetch = Math.min(totalPages, MAX_PAGES);

      let viewstate = extractHiddenField(html1, '__VIEWSTATE');
      let eventvalidation = extractHiddenField(html1, '__EVENTVALIDATION');

      for (let pageIdx = 2; pageIdx <= pagesToFetch; pageIdx++) {
        const body = new URLSearchParams({
          __EVENTTARGET: 'AspNetPager1',
          __EVENTARGUMENT: String(pageIdx),
          __VIEWSTATE: viewstate ?? '',
          __EVENTVALIDATION: eventvalidation ?? '',
          inputA100: keyword,
          inputA298: '',
        });

        const resp = await fetch(searchUrl, {
          method: 'POST',
          headers: {
            Cookie: cookieHeader,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!resp.ok) break;

        const html = await resp.text();
        results.push(...parseSearchPage(html));

        viewstate = extractHiddenField(html, '__VIEWSTATE');
        eventvalidation = extractHiddenField(html, '__EVENTVALIDATION');
      }
    } catch {
      // skip pagination errors
    }

    return results;
  }

  private resolvePdfUrl(pdfPath: string): string {
    const cleaned = pdfPath.replace(/^~/, '').replace(/^\/+/, '');
    if (pdfPath.startsWith('~')) {
      return `${BY_BASE}/${cleaned}`;
    }
    if (pdfPath.startsWith('/')) {
      return `${BY_BASE}${pdfPath}`;
    }
    return `${BY_BASE}/${pdfPath}`;
  }

  private async downloadPdf(pdfUrlOrPath: string, filePath: string): Promise<boolean> {
    try {
      const url = pdfUrlOrPath.startsWith('http') ? pdfUrlOrPath : this.resolvePdfUrl(pdfUrlOrPath);
      const resp = await fetch(url, {
        headers: { Cookie: this.sessionCookies ?? '' },
        signal: AbortSignal.timeout(TIMEOUT_FAST_MS),
      });
      if (!resp.ok) return false;

      const bytes = Buffer.from(await resp.arrayBuffer());
      await writeFile(filePath, bytes);
      return true;
    } catch {
      return false;
    }
  }

  private mapSearchItem(item: BySearchItem): StandardSummary {
    const hasPdf = Boolean(item.pdfPath);
    return {
      id: createStandardId('by', item.siid || item.stdNo),
      source: 'by',
      sourceId: item.siid || item.stdNo,
      standardNumber: item.stdNo,
      title: item.stdName,
      status: item.status || undefined,
      publishDate: item.publish || null,
      implementDate: item.implement || null,
      abolishedDate: null,
      previewAvailable: hasPdf,
      detailUrl: `${BY_BASE}/Manager/StandManager/StandDetail.aspx?SIId=${item.siid}`,
      meta: item as unknown as Record<string, unknown>,
    };
  }

  private mapDetail(item: BySearchItem, id: string): StandardDetail {
    const hasPdf = Boolean(item.pdfPath);
    return {
      id,
      source: 'by',
      sourceId: item.siid || item.stdNo,
      standardNumber: item.stdNo,
      title: item.stdName,
      status: item.status || undefined,
      publishDate: item.publish || null,
      implementDate: item.implement || null,
      abolishedDate: null,
      previewAvailable: hasPdf,
      detailUrl: `${BY_BASE}/Manager/StandManager/StandDetail.aspx?SIId=${item.siid}`,
      contentText: '',
      moreInfo: {
        siid: item.siid,
        pdfPath: item.pdfPath,
      },
      meta: item as unknown as Record<string, unknown>,
    };
  }
}

// --- HTML Parsing Helpers ---

function extractHiddenField(html: string, name: string): string | null {
  const match = html.match(new RegExp(`name="${name}"[^>]+value="([^"]+)"`));
  return match?.[1] ?? null;
}

function extractSetCookie(resp: Response): string {
  const cookies = resp.headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
}

function mergeCookies(existing: string, incoming: string): string {
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

function mergeHeaders(cookie: string, extra: Record<string, string>): HeadersInit {
  const headers: Record<string, string> = { ...extra };
  if (cookie) {
    headers['Cookie'] = cookie;
  }
  return headers;
}

function extractStdNo(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractStdName(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractStatus(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
}

function extractDate(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
}


function parseSearchPage(html: string): BySearchItem[] {
  // Extract result blocks using regex (as in the Python reference)
  const blocks = html.match(/<table[\s\S]*?class="mt20"[\s\S]*?rpStand_HidSIId_\d[\s\S]*?<\/table>/gi) ?? [];

  return blocks.map((block, idx) => {
    const stdNo = extractStdNo(extractRegex(block, /class="\s*c333 f16\s*">\s*([^<]+)/));
    const stdName = extractStdName(extractRegex(block, /<p\s+class="c333 mt5">\s*([^<]+)/));
    const status = extractStatus(extractRegex(block, /标准状态：<span\s+class='[^']*'>([^<]+)/));
    const publish = extractDate(extractRegex(block, /发布日期：([0-9-]+)/));
    const implement = extractDate(extractRegex(block, /实施日期：([0-9-]+)/));
    const siid = extractRegex(block, /id="rpStand_HidSIId_\d"\s+value="([^"]+)"/);
    const pdfPath = extractRegex(block, /id="rpStand_hdfB000_\d"\s+value="([^"]+)"/);

    return {
      idx: idx + 1,
      stdNo,
      stdName,
      status,
      publish,
      implement,
      siid,
      pdfPath,
    };
  });
}

function extractRegex(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? '';
}

function parseTotalPages(html: string): number {
  const match = html.match(/当前页：<font[^>]*><b>\d+\/(\d+)<\/b>/);
  return match?.[1] ? parseInt(match[1], 10) : 1;
}

function buildByFileName(standardNumber: string, title: string): string {
  const num = standardNumber.replace(/[\\/:*?"<>|]/g, '_').replace(/\//g, '_').trim();
  const name = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  const joined = [num, name].filter(Boolean).join(' ');
  return `${joined || 'by-standard'}.pdf`;
}
