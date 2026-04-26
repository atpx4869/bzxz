import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';

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

interface BzNewSearchRow {
  id: string;
  stdNo: string;
  cnName: string;
  enName?: string;
  pubDate: string;
  actDate: string;
  stdStatus: string;
  stdNature?: string;
  replacedStd?: string;
  pdf?: string;
  isPdf?: string;
  icsClass?: string;
  cnClass?: string;
  endData?: string;
  drafterName?: string;
  drafter2nd?: string;
  [key: string]: unknown;
}

interface BzNewSearchResponse {
  code: number;
  data?: {
    records?: BzNewSearchRow[];
    total: number;
  };
}

interface BzNewDetailResponse {
  code: number;
  data?: BzNewSearchRow;
}

const STATUS_MAP: Record<string, string> = {
  '1': '现行有效',
  '2': '部分有效',
  '3': '即将实施',
  '4': '即将废止',
  '5': '已经废止',
  '6': '调整转号',
  '9': '其它',
};

const BZ_NEW_BASE = 'https://bz.gxzl.org.cn';
const SEARCH_API = `${BZ_NEW_BASE}/api/gxist-standard/standardstd/list`;

export class BzZhengguiAdapter implements SourceAdapter {
  readonly source = 'bz' as const;

  async searchStandards(input: SearchStandardsInput): Promise<StandardSummary[]> {
    const url = new URL(SEARCH_API);
    url.searchParams.set('language', 'zh');
    url.searchParams.set('current', '1');
    url.searchParams.set('size', '20');
    url.searchParams.set('keywords', input.query);

    const response = await fetch(url);
    if (!response.ok) {
      throw new UpstreamError('bz search API failed', { status: response.status });
    }

    const payload = (await response.json()) as BzNewSearchResponse;
    const rows = payload.data?.records ?? [];
    return rows.map((row) => this.mapSearchRow(row));
  }

  async getStandardDetail(id: string): Promise<StandardDetail> {
    const { sourceId } = parseStandardId(id);

    const detailUrl = `${BZ_NEW_BASE}/api/gxist-standard/standardstd/detail?id=${encodeURIComponent(sourceId)}`;
    const response = await fetch(detailUrl);
    if (!response.ok) {
      throw new UpstreamError('bz detail API failed', { status: response.status });
    }

    const payload = (await response.json()) as BzNewDetailResponse;
    const row = payload.data;
    if (!row) {
      throw new NotFoundError(`bz detail not found for ${id}`);
    }

    return this.mapDetail(row);
  }

  async detectPreview(id: string): Promise<PreviewInfo> {
    const detail = await this.getStandardDetail(id);
    const hasPdf = detail.moreInfo?.hasPdf === true || detail.moreInfo?.isPdf === '1';
    const standardNo = detail.standardNumber;

    if (!hasPdf || !standardNo) {
      return {
        standardId: id,
        pageUrls: [],
        previewUrl: undefined,
        meta: { hasPdf: false, note: 'No preview available for this standard' },
      };
    }

    const totalPages = await this.detectPageCount(id, standardNo);

    const pageUrls = Array.from({ length: totalPages }, (_, index) =>
      `${BZ_NEW_BASE}/api/gxist-standard/standardstd/read-image?no=${encodeURIComponent(standardNo)}&page=${index}`,
    );

    return {
      standardId: id,
      totalPages,
      pageUrls,
      fileType: 'jpeg',
      previewUrl: `${BZ_NEW_BASE}/standard/details/?id=${detail.sourceId}`,
      meta: {
        hasPdf,
        standardNo,
        sourceId: detail.sourceId,
        readImageBase: `${BZ_NEW_BASE}/api/gxist-standard/standardstd/read-image`,
      },
    };
  }

  async exportStandard(id: string): Promise<ExportResult> {
    const detail = await this.getStandardDetail(id);
    const preview = await this.detectPreview(id);

    if (!preview.totalPages || preview.pageUrls.length === 0) {
      throw new BadRequestError('bz export: no preview pages available');
    }

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
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }

    const fileName = buildBzFileName(detail.standardNumber, detail.title);
    const filePath = path.join(EXPORTS_DIR, fileName);
    await writeFile(filePath, await pdfDoc.save());

    return {
      standardId: id,
      filePath,
      fileName,
      totalPages: preview.totalPages,
    };
  }

  private async detectPageCount(id: string, standardNo: string): Promise<number> {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
      const detailUrl = `${BZ_NEW_BASE}/standard/details/?id=${encodeURIComponent(parseStandardId(id).sourceId)}`;

      await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 60000 });

      const paginationText = await page.locator('.el-pagination__total').first().textContent().catch(() => null);
      if (paginationText) {
        const match = paginationText.match(/(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
      }

      return await this.probePageCount(standardNo);
    } finally {
      await browser.close();
    }
  }

  private async probePageCount(standardNo: string): Promise<number> {
    let low = 0;
    let high = 512;

    while (low < high - 1) {
      const mid = Math.floor((low + high) / 2);
      const contentLength = await this.getPageContentLength(standardNo, mid);
      const nextLength = await this.getPageContentLength(standardNo, mid + 1);

      if (contentLength < 5000 || contentLength === nextLength) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    return high;
  }

  private async getPageContentLength(standardNo: string, pageNum: number): Promise<number> {
    try {
      const url = `${BZ_NEW_BASE}/api/gxist-standard/standardstd/read-image?no=${encodeURIComponent(standardNo)}&page=${pageNum}`;
      const response = await fetch(url, { method: 'HEAD' });
      const length = response.headers.get('content-length');
      return length ? parseInt(length, 10) : 0;
    } catch {
      return 0;
    }
  }

  private mapSearchRow(row: BzNewSearchRow): StandardSummary {
    return {
      id: createStandardId('bz', row.id),
      source: 'bz',
      sourceId: row.id,
      standardNumber: row.stdNo ?? '',
      title: row.cnName ?? '',
      standardType: row.stdNature ?? undefined,
      status: STATUS_MAP[row.stdStatus] ?? row.stdStatus,
      publishDate: row.pubDate ?? null,
      implementDate: row.actDate ?? null,
      abolishedDate: row.endData ?? null,
      previewAvailable: row.isPdf === '1' || Boolean(row.pdf),
      detailUrl: `${BZ_NEW_BASE}/api/gxist-standard/standardstd/detail?id=${row.id}`,
      meta: row as Record<string, unknown>,
    };
  }

  private mapDetail(row: BzNewSearchRow): StandardDetail {
    return {
      id: createStandardId('bz', row.id),
      source: 'bz',
      sourceId: row.id,
      standardNumber: row.stdNo ?? '',
      title: row.cnName ?? '',
      standardType: row.stdNature ?? undefined,
      status: STATUS_MAP[row.stdStatus] ?? row.stdStatus,
      publishDate: row.pubDate ?? null,
      implementDate: row.actDate ?? null,
      abolishedDate: row.endData ?? null,
      previewAvailable: row.isPdf === '1' || Boolean(row.pdf),
      detailUrl: `${BZ_NEW_BASE}/api/gxist-standard/standardstd/detail?id=${row.id}`,
      contentText: row.enName ?? '',
      moreInfo: {
        enName: row.enName,
        cnClass: row.cnClass,
        icsClass: row.icsClass,
        replacedStd: row.replacedStd,
        hasPdf: row.isPdf === '1',
        isPdf: row.isPdf,
        pdfPath: row.pdf,
        drafterName: row.drafterName,
        drafter2nd: row.drafter2nd,
      },
      meta: row as Record<string, unknown>,
    };
  }
}

function buildBzFileName(standardNumber: string, title: string): string {
  const num = standardNumber.replace(/[\\/:*?"<>|]/g, '_').replace(/\//g, '_').trim();
  const name = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  const joined = [num, name].filter(Boolean).join(' ');
  return `${joined || 'standard'}.pdf`;
}
