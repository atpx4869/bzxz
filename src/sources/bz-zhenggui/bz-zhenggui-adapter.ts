import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { chromium, type Browser, type Page } from 'playwright';

import type {
  ExportResult,
  PreviewInfo,
  SearchStandardsInput,
  SourceAdapter,
  StandardDetail,
  StandardSummary,
} from '../../domain/standard';
import { EXPORTS_DIR } from '../../shared/fs';
import { NotFoundError, UpstreamError } from '../../shared/errors';
import { createStandardId, parseStandardId } from '../../shared/id';

interface SearchApiResponse {
  scode?: number;
  result?: string;
  message?: string;
  code?: number;
  msg?: string;
  retcode?: number;
  retmsg?: string;
  data?: {
    records?: BzSearchRecord[];
    rows?: BzSearchRecord[];
  };
}

interface BzSearchRecord {
  id?: number | string;
  standardId?: number | string;
  standardNum?: string;
  stdNo?: string;
  cname?: string;
  standardName?: string;
  stdName?: string;
  standardType?: string;
  statusName?: string;
  standardStatus?: string;
  issueDate?: string | null;
  publishDate?: string | null;
  executeDate?: string | null;
  implDate?: string | null;
  abolishDate?: string | null;
  docStatus?: number | string;
  [key: string]: unknown;
}

interface StdContentApiResponse {
  scode?: number;
  result?: string;
  message?: string;
  data?: Record<string, unknown>;
}

interface PdfListApiResponse {
  scode?: number;
  result?: string;
  message?: string;
  data?: Array<Record<string, unknown>>;
}

interface PreviewMetaResponse {
  epc?: number;
  pc?: number;
  pw?: number;
  ph?: number;
  ext?: string;
  pro?: string;
  type?: number;
  version?: string;
  result?: string;
  message?: string;
  scode?: number;
}

const BZ_BASE = 'https://bz.zhenggui.vip';
const BZ_API_BASE = 'https://login.bz.zhenggui.vip/bzy-api/org';
const WM_QUERY = 'wmType=1&wmValue=www.zhenggui.vip&wmHeight=600&wmWidth=500';

export class BzZhengguiAdapter implements SourceAdapter {
  readonly source = 'bz' as const;
  private browserPromise: Promise<Browser> | null = null;

  async searchStandards(input: SearchStandardsInput): Promise<StandardSummary[]> {
    const browser = await this.getBrowser();

    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    try {
      const searchResponsePromise = page
        .waitForResponse((response) => response.url().includes('/bzy-api/org/std/search'), {
          timeout: 15000,
        })
        .catch(() => null);

      await page.goto(`${BZ_BASE}/standardList?searchText=${encodeURIComponent(input.query)}&activeTitle=true`, {
        waitUntil: 'networkidle',
        timeout: 120000,
      });

      const searchResponse = await searchResponsePromise;
      let apiPayload: SearchApiResponse | undefined;

      if (searchResponse) {
        try {
          apiPayload = (await searchResponse.json()) as SearchApiResponse;
        } catch {
          apiPayload = undefined;
        }
      }

      const rawRows = apiPayload?.data?.rows ?? apiPayload?.data?.records ?? [];

      if (rawRows.length === 0) {
        const fallbackResults = await this.parseSearchResultsFromDom(page);
        if (fallbackResults.length > 0) {
          return fallbackResults;
        }

        throw new UpstreamError('Failed to capture search API response from source');
      }

      return rawRows.map((record) => this.mapSearchRecord(record));
    } finally {
      await page.close();
    }
  }

  async getStandardDetail(id: string): Promise<StandardDetail> {
    const { sourceId } = parseStandardId(id);
    const browser = await this.getBrowser();

    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    try {
      let stdContent: StdContentApiResponse | undefined;
      let pdfList: PdfListApiResponse | undefined;

      page.on('response', async (response) => {
        const url = response.url();

        try {
          if (url.includes('/bzy-api/org/standard/stdcontent')) {
            stdContent = (await response.json()) as StdContentApiResponse;
          }

          if (url.includes('/bzy-api/org/standard/getPdfList')) {
            pdfList = (await response.json()) as PdfListApiResponse;
          }
        } catch {
          // Ignore malformed upstream JSON and fallback to DOM extraction.
        }
      });

      const detailUrl = `${BZ_BASE}/standardDetail?standardId=${encodeURIComponent(sourceId)}&docStatus=0&searchType=1`;
      await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 120000 });

      const bodyText = await page.locator('body').innerText();
      const mapped = this.mapDetail(page, sourceId, stdContent, pdfList, bodyText);

      if (!mapped.title || !mapped.standardNumber) {
        throw new NotFoundError(`Standard detail not found for id ${id}`);
      }

      return mapped;
    } finally {
      await page.close();
    }
  }

  async detectPreview(id: string): Promise<PreviewInfo> {
    const detail = await this.collectDetailAndPreview(id);

    if (!detail.resourceKey || !detail.metaResponse?.pc) {
      throw new NotFoundError(`Preview not available for ${id}`);
    }

    const totalPages = detail.metaResponse.pc;
    const pageUrls = Array.from({ length: totalPages }, (_, index) => {
      return `${detail.previewBaseUrl}/I/${index + 1}`;
    });

    return {
      standardId: id,
      resourceKey: detail.resourceKey,
      totalPages,
      pageWidth: detail.metaResponse.pw,
      pageHeight: detail.metaResponse.ph,
      fileType: detail.metaResponse.ext,
      pageUrls,
      meta: {
        sourceMeta: detail.metaResponse,
        previewBaseUrl: detail.previewBaseUrl,
      },
    };
  }

  async exportStandard(id: string): Promise<ExportResult> {
    const detailInfo = await this.getStandardDetail(id);
    const preview = await this.detectPreview(id);

    const pdfDoc = await PDFDocument.create();

    for (const pageUrl of preview.pageUrls) {
      const response = await fetch(pageUrl);

      if (!response.ok) {
        throw new UpstreamError(`Failed to download preview page: ${pageUrl}`, {
          status: response.status,
        });
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const image = await pdfDoc.embedJpg(bytes);
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }

    const fileName = buildExportFileName(detailInfo.standardNumber, detailInfo.title);
    const filePath = path.join(EXPORTS_DIR, fileName);
    const bytes = await pdfDoc.save();
    await writeFile(filePath, bytes);

    return {
      standardId: id,
      filePath,
      fileName,
      totalPages: preview.totalPages ?? preview.pageUrls.length,
    };
  }

  private async collectDetailAndPreview(id: string): Promise<{
    resourceKey?: string;
    previewBaseUrl: string;
    metaResponse?: PreviewMetaResponse;
  }> {
    const { sourceId } = parseStandardId(id);
    const browser = await this.getBrowser();

    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    try {
      let resourceKey: string | undefined;
      let metaResponse: PreviewMetaResponse | undefined;

      page.on('response', async (response) => {
        const url = response.url();

        if (url.includes('/doc/meta.json')) {
          const match = url.match(/immdoc\/([^/]+)\/doc\/meta\.json/);
          if (match) {
            resourceKey = match[1];
          }

          try {
            metaResponse = (await response.json()) as PreviewMetaResponse;
          } catch {
            metaResponse = undefined;
          }
        }
      });

      await page.goto(`${BZ_BASE}/standardDetail?standardId=${encodeURIComponent(sourceId)}&docStatus=0&searchType=1`, {
        waitUntil: 'networkidle',
        timeout: 120000,
      });

      for (let attempt = 0; attempt < 5 && !metaResponse; attempt += 1) {
        await page.mouse.wheel(0, 2000);
        await page.waitForTimeout(1500);
      }

      if (!resourceKey || !metaResponse) {
        throw new NotFoundError(`Preview metadata not found for ${id}`);
      }

      const previewBaseUrl = resourceKey
        ? `https://resource.zhenggui.vip/immdoc/${resourceKey}/doc`
        : '';

      return {
        resourceKey,
        previewBaseUrl,
        metaResponse,
      };
    } finally {
      await page.close();
    }
  }

  private mapSearchRecord(record: BzSearchRecord): StandardSummary {
    const sourceId = String(record.standardId ?? record.id ?? '');
    const standardNumber = stripHtml(String(record.standardNum ?? record.stdNo ?? '').trim());
    const title = cleanText(String(record.cname ?? record.standardName ?? record.stdName ?? '').trim());
    const status = stringOrUndefined(record.statusName ?? record.standardStatus);
    const publishDate = stringOrNullable(record.issueDate ?? record.publishDate);
    const implementDate = stringOrNullable(record.executeDate ?? record.implDate);
    const abolishedDate = stringOrNullable(record.abolishDate);
    const previewAvailable = !String(record.docStatus ?? '').includes('1');

    return {
      id: createStandardId('bz', sourceId),
      source: 'bz',
      sourceId,
      standardNumber,
      title,
      standardType: stringOrUndefined(record.standardType),
      status,
      publishDate,
      implementDate,
      abolishedDate,
      previewAvailable: sourceId.length > 0 ? previewAvailable : false,
      detailUrl: `${BZ_BASE}/standardDetail?standardId=${encodeURIComponent(sourceId)}&docStatus=0&standardNum=${encodeURIComponent(standardNumber)}&searchType=1`,
      meta: record,
    };
  }

  private async parseSearchResultsFromDom(page: Page): Promise<StandardSummary[]> {
    const links = await page.locator('a[href*="/standardDetail?"]').evaluateAll((elements) => {
      return elements.map((element) => {
        const anchor = element as HTMLAnchorElement;
        return {
          href: anchor.href,
          text: anchor.textContent?.trim() ?? '',
        };
      });
    });

    const unique = new Map<string, StandardSummary>();

    for (const link of links) {
      const parsed = this.mapSearchLink(link.href, link.text);
      if (parsed) {
        unique.set(parsed.id, parsed);
      }
    }

    return Array.from(unique.values());
  }

  private mapSearchLink(href: string, text: string): StandardSummary | null {
    try {
      const url = new URL(href, BZ_BASE);
      const sourceId = url.searchParams.get('standardId');
      const standardNumber = url.searchParams.get('standardNum') ?? '';
      const docStatus = url.searchParams.get('docStatus') ?? '';

      if (!sourceId || !standardNumber) {
        return null;
      }

      const title = text.replace(standardNumber, '').trim() || text.trim();

      return {
        id: createStandardId('bz', sourceId),
        source: 'bz',
        sourceId,
        standardNumber,
        title,
        previewAvailable: docStatus === '0',
        detailUrl: url.toString(),
        meta: {
          href: url.toString(),
          fromDom: true,
        },
      };
    } catch {
      return null;
    }
  }

  private mapDetail(
    page: Page,
    sourceId: string,
    stdContent: StdContentApiResponse | undefined,
    pdfList: PdfListApiResponse | undefined,
    bodyText: string,
  ): StandardDetail {
    const titleLine = bodyText
      .split('\n')
      .map((line) => line.trim())
      .find((line) => /[A-Z]+\/?T?\s*\d+-\d+/.test(line));

    const contentTitle = asRecord(stdContent?.data?.tittle);
    const standardNumber = cleanText(
      stringOrUndefined(contentTitle?.standardNum) ?? titleLine?.match(/([A-Z]+\/?T?\s*\d+-\d+)/)?.[1]?.trim() ?? '',
    );
    const title = cleanText(
      stringOrUndefined(contentTitle?.standardName) ?? titleLine?.replace(standardNumber, '').trim() ?? '',
    );
    const titleStatus = normalizeStandardStatus(stringOrUndefined(contentTitle?.standardStatus));
    const publishDateFromApi = stringOrNullable(contentTitle?.standardPubTime);
    const implementDateFromApi = stringOrNullable(contentTitle?.standardUsefulDate);
    const abolishedDateFromApi = stringOrNullable(contentTitle?.standardUselessDate);

    return {
      id: createStandardId('bz', sourceId),
      source: 'bz',
      sourceId,
      standardNumber,
      title,
      status: titleStatus ?? extractValue(bodyText, /(现行有效|已经废止|部分废止|即将实施|即将废止|调整转号|其他)/),
      publishDate: publishDateFromApi ?? extractLabeledDate(bodyText, '发布日期'),
      implementDate: implementDateFromApi ?? extractLabeledDate(bodyText, '实施日期'),
      abolishedDate: abolishedDateFromApi ?? extractLabeledDate(bodyText, '废止日期'),
      previewAvailable: Array.isArray(pdfList?.data) && pdfList.data.length > 0,
      detailUrl: `${BZ_BASE}/standardDetail?standardId=${encodeURIComponent(sourceId)}&docStatus=0&standardNum=${encodeURIComponent(standardNumber)}&searchType=1`,
      breadcrumbs: bodyText
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.includes('>'))
        ?.split('>')
        .map((part) => part.trim()),
      contentText: bodyText,
      moreInfo: {
        stdContent: stdContent?.data ?? null,
        pdfList: pdfList?.data ?? null,
      },
      meta: {
        bodyText,
      },
    };
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium.launch({ headless: true });
    }

    return this.browserPromise;
  }
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function cleanText(value: string): string {
  return stripHtml(value)
    .replace(/^[>＞]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStandardStatus(value: string | undefined): string | undefined {
  switch (value) {
    case '0':
      return '现行有效';
    case '1':
      return '废止';
    case '2':
      return '部分废止';
    case '3':
      return '即将实施';
    case '4':
      return '已经废止';
    case '5':
      return '即将废止';
    case '6':
      return '调整转号';
    default:
      return value;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}

function sanitizeFileNamePart(value: string): string {
  return cleanText(value)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildExportFileName(standardNumber: string, title: string): string {
  const normalizedNumber = sanitizeFileNamePart(standardNumber).replace(/\//g, '_');
  const normalizedTitle = sanitizeFileNamePart(title);
  const joined = [normalizedNumber, normalizedTitle].filter(Boolean).join(' ');

  return `${joined || 'standard'}.pdf`;
}

function stringOrNullable(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractValue(text: string, pattern: RegExp): string | undefined {
  const match = text.match(pattern);
  return match?.[1];
}

function extractLabeledDate(text: string, label: string): string | null {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escapedLabel}[:：]\s*([^\n]+)`));
  if (!match) {
    return null;
  }

  const value = match[1].trim();
  return value.length > 0 ? value : null;
}
