import { load } from 'cheerio';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  DownloadSessionInfo,
  ExportResult,
  PreviewInfo,
  SearchStandardsInput,
  SourceAdapter,
  StandardDetail,
  StandardSummary,
} from '../../domain/standard';
import { BadRequestError, NotFoundError, UpstreamError } from '../../shared/errors';
import { buildFileName, getExportsDir } from '../../shared/fs';
import { createStandardId, parseStandardId } from '../../shared/id';
import { GbwDownloadSessionStore } from './gbw-download-session-store';
import { ocrCaptcha } from '../shared/captcha-ocr';

interface GbwSearchResponse {
  total?: number;
  pageNumber?: number;
  rows?: GbwSearchRow[];
}

interface GbwSearchRow {
  id?: string;
  C_STD_CODE?: string;
  C_C_NAME?: string;
  STD_NATURE?: string;
  ACT_DATE?: string;
  STATE?: string;
  ISSUE_DATE?: string;
}

interface OcrAttemptLog {
  round: number;
  sessionId: string;
  ocrText: string;
  ocrConfidence: number;
  submittedCode: string;
  verifyResponse?: string;
  resultStatus?: string;
  error?: string;
}

const GBW_STD_BASE = 'https://std.samr.gov.cn';
const GBW_OPENSTD_BASE = 'https://openstd.samr.gov.cn';
const GBW_DOWNLOAD_BASE = 'http://c.gb688.cn';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

export class GbwAdapter implements SourceAdapter {
  readonly source = 'gbw' as const;

  constructor(private readonly downloadSessionStore = new GbwDownloadSessionStore()) {}

  async searchStandards(input: SearchStandardsInput): Promise<StandardSummary[]> {
    const searchUrl = new URL('/gb/search/gbQueryPage', GBW_STD_BASE);
    searchUrl.searchParams.set('searchText', input.query);
    searchUrl.searchParams.set('page', '1');
    searchUrl.searchParams.set('pageSize', '20');

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json, text/plain, */*',
      },
    });

    if (!response.ok) {
      throw new UpstreamError('Failed to query gbw search endpoint', { status: response.status });
    }

    const payload = (await response.json()) as GbwSearchResponse;
    const rows = payload.rows ?? [];

    return rows.map((row) => this.mapSearchRow(row));
  }

  async getStandardDetail(id: string): Promise<StandardDetail> {
    const { source, sourceId } = parseStandardId(id);
    if (source !== 'gbw') {
      throw new BadRequestError(`gbw adapter cannot resolve id from source ${source}`);
    }

    const detailUrl = new URL('/gb/search/gbDetailed', GBW_STD_BASE);
    detailUrl.searchParams.set('id', sourceId);

    const response = await fetch(detailUrl, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new UpstreamError('Failed to fetch gbw detail page', { status: response.status });
    }

    const html = await response.text();
    const $ = load(html);
    const bodyText = $('body').text();

    const standardNumber = cleanText(extractBasicInfoField($, '标准号') ?? '');
    const title = cleanText($('.page-header h4').first().text());
    const englishTitle = cleanText($('.page-header h5').first().text());
    const status = cleanText($('.page-header .label-primary').first().text());

    const fieldMap = extractFieldMap($);
    const hcno = extractHcno(html);

    if (!standardNumber || !title) {
      throw new NotFoundError(`gbw detail not found for ${id}`);
    }

    return {
      id,
      source: 'gbw',
      sourceId,
      standardNumber,
      title,
      standardType: cleanText($('.page-header .label-success').first().text()) || fieldMap['标准类别'] || undefined,
      status,
      publishDate: extractBasicInfoField($, '发布日期') ?? null,
      implementDate: extractBasicInfoField($, '实施日期') ?? null,
      abolishedDate: null,
      previewAvailable: Boolean(hcno),
      detailUrl: detailUrl.toString(),
      contentText: englishTitle || '',
      moreInfo: {
        enName: englishTitle || undefined,
        fields: fieldMap,
        hcno,
        openstdDetailUrl: hcno ? `${GBW_OPENSTD_BASE}/bzgk/std/newGbInfo?hcno=${hcno}` : null,
      },
      meta: {
        html,
      },
    };
  }

  async detectPreview(id: string): Promise<PreviewInfo> {
    const detail = await this.getStandardDetail(id);
    const hcno = asString(detail.moreInfo?.hcno);

    if (!hcno) {
      return {
        standardId: id,
        pageUrls: [],
        previewUrl: undefined,
        downloadUrl: undefined,
        captchaRequired: false,
        meta: {
          hcno: null,
          openstdDetailUrl: null,
          capability: 'metadata_only',
        },
      };
    }

    return {
      standardId: id,
      pageUrls: [],
      previewUrl: `${GBW_DOWNLOAD_BASE}/bzgk/gb/showGb?type=online&hcno=${hcno}`,
      downloadUrl: `${GBW_DOWNLOAD_BASE}/bzgk/gb/showGb?type=download&hcno=${hcno}`,
      captchaRequired: true,
      meta: {
        hcno,
        openstdDetailUrl: `${GBW_OPENSTD_BASE}/bzgk/std/newGbInfo?hcno=${hcno}`,
        capability: 'gated_preview_download',
      },
    };
  }

  async exportStandard(id: string, _onProgress?: (current: number, total: number) => void): Promise<ExportResult> {
    throw new BadRequestError('gbw export requires a captcha-assisted download session first');
  }

  async createDownloadSession(id: string): Promise<DownloadSessionInfo> {
    const detail = await this.getStandardDetail(id);
    const hcno = asString(detail.moreInfo?.hcno);

    if (!hcno) {
      throw new BadRequestError('No hcno found for this gbw standard; download is not available');
    }

    const showUrl = `${GBW_DOWNLOAD_BASE}/bzgk/gb/showGb?type=download&hcno=${hcno}`;
    const showResponse = await fetch(showUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: `${GBW_OPENSTD_BASE}/`,
      },
      redirect: 'manual',
    });

    const setCookies = showResponse.headers.getSetCookie?.() ?? [];
    const cookieHeader = extractCookieHeader(setCookies);

    if (!cookieHeader) {
      throw new UpstreamError('Failed to establish gbw download session cookies');
    }

    const captchaUrl = `${GBW_DOWNLOAD_BASE}/bzgk/gb/gc?_${Date.now()}`;
    const captchaResponse = await fetch(captchaUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: showUrl,
        Cookie: cookieHeader,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    if (!captchaResponse.ok) {
      throw new UpstreamError('Failed to fetch gbw captcha image', { status: captchaResponse.status });
    }

    const captchaBytes = Buffer.from(await captchaResponse.arrayBuffer());
    const created = this.downloadSessionStore.create({
      standardId: id,
      source: 'gbw',
      status: 'captcha_required',
      captchaImageBase64: captchaBytes.toString('base64'),
      captchaContentType: captchaResponse.headers.get('content-type') ?? 'image/jpeg',
      cookies: [cookieHeader],
      showUrl,
      hcno,
      meta: {
        hcno,
        detailUrl: detail.detailUrl,
      },
    });

    return stripDownloadSessionSecrets(created);
  }

  async submitDownloadCaptcha(sessionId: string, code: string): Promise<DownloadSessionInfo> {
    const session = this.downloadSessionStore.get(sessionId);
    if (!session) {
      throw new NotFoundError(`gbw download session not found: ${sessionId}`);
    }

    const normalizedCode = code.trim();
    if (normalizedCode.length !== 4) {
      throw new BadRequestError('Captcha code must be 4 characters');
    }

    const cookieHeader = session.cookies.join('; ');
    const verifyUrl = `${GBW_DOWNLOAD_BASE}/bzgk/gb/verifyCode`;
    const response = await fetch(verifyUrl, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Referer: session.showUrl,
        Origin: GBW_DOWNLOAD_BASE,
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Cookie: cookieHeader,
      },
      body: new URLSearchParams({ verifyCode: normalizedCode }),
    });

    if (!response.ok) {
      throw new UpstreamError('Failed to submit gbw captcha', { status: response.status });
    }

    const resultText = (await response.text()).trim();
    const verificationPassed = isVerificationSuccess(resultText);
    const viewUrl = `${GBW_DOWNLOAD_BASE}/bzgk/gb/viewGb?hcno=${session.hcno}`;

    let nextStatus: DownloadSessionInfo['status'] = verificationPassed ? 'verified' : 'failed';
    let nextMeta: Record<string, unknown> = {
      ...session.meta,
      verifyResponse: resultText,
      viewUrl,
    };

    if (verificationPassed) {
      const fileProbe = await this.tryDownloadFinalFile(session, viewUrl);
      if (fileProbe.kind === 'file') {
        nextStatus = 'downloaded';
        nextMeta = {
          ...nextMeta,
          filePath: fileProbe.filePath,
          fileName: fileProbe.fileName,
          contentType: fileProbe.contentType,
          fileSize: fileProbe.fileSize,
        };
      } else {
        nextMeta = {
          ...nextMeta,
          contentType: fileProbe.contentType,
          htmlPreview: fileProbe.htmlPreview,
          note: 'Captcha verification succeeded, but final response was not a direct file stream.',
        };
      }
    }

    const updated = this.downloadSessionStore.update(sessionId, {
      status: nextStatus,
      meta: nextMeta,
    });

    if (!updated) {
      throw new NotFoundError(`gbw download session not found after update: ${sessionId}`);
    }

    return stripDownloadSessionSecrets(updated);
  }

  async getDownloadSession(sessionId: string): Promise<DownloadSessionInfo> {
    const session = this.downloadSessionStore.get(sessionId);
    if (!session) {
      throw new NotFoundError(`gbw download session not found: ${sessionId}`);
    }

    return stripDownloadSessionSecrets(session);
  }

  async autoDownload(id: string, maxRetries: number = 5): Promise<DownloadSessionInfo> {
    const attempts: OcrAttemptLog[] = [];

    for (let round = 1; round <= maxRetries; round++) {
      const session = await this.createDownloadSession(id);

      if (!session.captchaImageBase64) {
        throw new UpstreamError('No captcha image in download session');
      }

      const ocrResult = await ocrCaptcha(session.captchaImageBase64);
      const code = ocrResult.text.slice(0, 4);

      if (code.length !== 4) {
        attempts.push({ round, sessionId: session.id, ocrText: ocrResult.rawText, ocrConfidence: ocrResult.confidence, submittedCode: code, error: `OCR returned ${code.length} chars` });
        continue;
      }

      const result = await this.submitDownloadCaptcha(session.id, code);
      const record = this.downloadSessionStore.get(session.id);
      const verifyResponse = asString(record?.meta?.verifyResponse) ?? '';

      attempts.push({ round, sessionId: session.id, ocrText: ocrResult.rawText, ocrConfidence: ocrResult.confidence, submittedCode: code, verifyResponse, resultStatus: result.status });

      if (result.status === 'downloaded' && record) {
        this.downloadSessionStore.update(session.id, {
          meta: {
            ...record.meta,
            ocrText: ocrResult.rawText,
            ocrConfidence: ocrResult.confidence,
            autoSubmitted: true,
            attempts,
            totalRounds: round,
          },
        });
        return stripDownloadSessionSecrets(this.downloadSessionStore.get(session.id) ?? result);
      }

      if (record) {
        this.downloadSessionStore.update(session.id, {
          meta: {
            ...record.meta,
            ocrText: ocrResult.rawText,
            ocrConfidence: ocrResult.confidence,
            autoSubmitted: true,
            retryAttempt: round,
          },
        });
      }
    }

    return {
      id: `gbw_auto_${Date.now()}`,
      standardId: id,
      source: 'gbw',
      status: 'failed',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      captchaImageBase64: undefined,
      meta: {
        attempts,
        maxRetries,
        error: `All ${maxRetries} OCR attempts failed to produce correct captcha`,
      },
    };
  }

  private async tryDownloadFinalFile(
    session: { cookies: string[]; showUrl: string; hcno: string; standardId: string },
    viewUrl: string,
  ): Promise<
    | { kind: 'file'; filePath: string; fileName: string; fileSize: number; contentType: string }
    | { kind: 'html'; contentType: string; htmlPreview: string }
  > {
    const cookieHeader = session.cookies.join('; ');
    const response = await fetch(viewUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: session.showUrl,
        Cookie: cookieHeader,
      },
      redirect: 'manual',
    });

    if (!response.ok) {
      throw new UpstreamError('Failed to fetch gbw final download response', { status: response.status });
    }

    const rawContentType = response.headers.get('content-type') ?? '';
    const contentType = rawContentType.replace(/^content-type:\s*/i, '').toLowerCase();
    if (contentType.includes('html')) {
      const htmlPreview = (await response.text()).slice(0, 4000);
      return {
        kind: 'html',
        contentType,
        htmlPreview,
      };
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const detail = await this.getStandardDetail(session.standardId);
    const fileName = buildFileName(detail.standardNumber, detail.title, guessExtension(contentType));
    const filePath = path.join(getExportsDir(), fileName);
    await writeFile(filePath, bytes);

    return {
      kind: 'file',
      filePath,
      fileName,
      fileSize: bytes.length,
      contentType,
    };
  }

  private mapSearchRow(row: GbwSearchRow): StandardSummary {
    const sourceId = row.id ?? '';
    const standardNumber = parseStdCode(row.C_STD_CODE ?? '');
    const title = cleanText(row.C_C_NAME ?? '');
    const status = cleanText(row.STATE ?? '');
    const standardType = cleanText(row.STD_NATURE ?? '');

    return {
      id: createStandardId('gbw', sourceId),
      source: 'gbw',
      sourceId,
      standardNumber,
      title,
      standardType: standardType || undefined,
      status: status || undefined,
      publishDate: row.ISSUE_DATE ?? null,
      implementDate: row.ACT_DATE ?? null,
      abolishedDate: null,
      previewAvailable: status === '现行' || status === '即将实施',
      detailUrl: `${GBW_STD_BASE}/gb/search/gbDetailed?id=${sourceId}`,
      meta: row as Record<string, unknown>,
    };
  }
}

function parseStdCode(value: string): string {
  return cleanText(value).replace(/\s*\/\s*/g, '/');
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFieldMap($: ReturnType<typeof load>): Record<string, string> {
  const map: Record<string, string> = {};
  const titles = $('.title').toArray();
  for (const element of titles) {
    const title = cleanText($(element).text()).replace(/[:：]$/u, '');
    const content = cleanText($(element).next('.content').text());
    if (title) {
      map[title] = content;
    }
  }
  return map;
}

function extractBasicInfoField($: ReturnType<typeof load>, name: string): string | undefined {
  const names = $('.basicInfo-item.name').toArray();
  for (const element of names) {
    const label = cleanText($(element).text());
    if (label === name) {
      return cleanText($(element).next('.basicInfo-item.value').text()) || undefined;
    }
  }

  return undefined;
}

function extractHcno(html: string): string | undefined {
  const match = html.match(/hcno=([A-Fa-f0-9]{32})/);
  return match?.[1];
}

function extractCookieHeader(setCookies: string[]): string {
  return setCookies
    .map((value) => value.split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function isVerificationSuccess(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === 'success' || normalized === 'ok' || normalized === '1';
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function stripDownloadSessionSecrets(session: DownloadSessionInfo & { cookies?: string[]; showUrl?: string; hcno?: string }): DownloadSessionInfo {
  const { id, standardId, source, status, captchaImageBase64, captchaContentType, createdAt, updatedAt, meta } = session;
  return {
    id,
    standardId,
    source,
    status,
    captchaImageBase64,
    captchaContentType,
    createdAt,
    updatedAt,
    meta,
  };
}

function guessExtension(contentType: string): string {
  if (contentType.includes('pdf')) {
    return 'pdf';
  }
  if (contentType.includes('zip')) {
    return 'zip';
  }
  if (contentType.includes('msword') || contentType.includes('wordprocessingml')) {
    return 'docx';
  }
  if (contentType.includes('octet-stream') || contentType.includes('binary')) {
    return 'pdf'; // gbw viewGb always returns PDF; fallback to .pdf
  }
  return 'pdf';
}
