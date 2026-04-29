import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

import type {
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
import { pooledFetch } from '../../shared/http';
import { getCachedPageCount, setCachedPageCount } from '../../shared/page-cache';
import { searchCache } from '../../shared/cache';

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
    const cacheKey = `bz:search:${input.query}`;
    const cached = searchCache.get<StandardSummary[]>(cacheKey);
    if (cached) return cached;

    const url = new URL(SEARCH_API);
    url.searchParams.set('language', 'zh');
    url.searchParams.set('current', '1');
    url.searchParams.set('size', '20');
    url.searchParams.set('keywords', input.query);

    const response = await pooledFetch(url.toString());
    if (!response.ok) {
      throw new UpstreamError('bz search API failed', { status: response.status });
    }

    const payload = (await response.json()) as BzNewSearchResponse;
    const rows = payload.data?.records ?? [];
    const result = rows.map((row) => this.mapSearchRow(row));
    searchCache.set(cacheKey, result);
    return result;
  }

  async getStandardDetail(id: string): Promise<StandardDetail> {
    const cacheKey = `bz:detail:${id}`;
    const cached = searchCache.get<StandardDetail>(cacheKey);
    if (cached) return cached;

    const { sourceId } = parseStandardId(id);
    const detailUrl = `${BZ_NEW_BASE}/api/gxist-standard/standardstd/detail?id=${encodeURIComponent(sourceId)}`;
    const response = await pooledFetch(detailUrl);
    if (!response.ok) {
      throw new UpstreamError('bz detail API failed', { status: response.status });
    }

    const payload = (await response.json()) as BzNewDetailResponse;
    const row = payload.data;
    if (!row) {
      throw new NotFoundError(`bz detail not found for ${id}`);
    }

    const result = this.mapDetail(row);
    searchCache.set(cacheKey, result, 10 * 60 * 1000); // 10 min cache
    return result;
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
        downloadUrl: undefined,
        captchaRequired: false,
        fileType: undefined,
        meta: { hasPdf: false, note: 'No preview available for this standard' },
      };
    }

    const totalPages = await this.detectPageCount(standardNo);

    const pageUrls = Array.from({ length: totalPages }, (_, index) =>
      `${BZ_NEW_BASE}/api/gxist-standard/standardstd/read-image?no=${encodeURIComponent(standardNo)}&page=${index}`,
    );

    return {
      standardId: id,
      totalPages,
      pageUrls,
      fileType: 'jpeg',
      previewUrl: `${BZ_NEW_BASE}/standard/details/?id=${detail.sourceId}`,
      downloadUrl: undefined,
      captchaRequired: false,
      meta: {
        hasPdf,
        standardNo,
        sourceId: detail.sourceId,
        readImageBase: `${BZ_NEW_BASE}/api/gxist-standard/standardstd/read-image`,
      },
    };
  }

  async exportStandard(id: string, onProgress?: (current: number, total: number) => void): Promise<ExportResult> {
    const detail = await this.getStandardDetail(id);
    let preview: PreviewInfo;
    for (let retry = 0; retry < 3; retry++) {
      preview = await this.detectPreview(id);
      if (preview.totalPages && preview.totalPages > 0 && preview.pageUrls.length > 0) break;
      if (retry < 2) await new Promise(r => setTimeout(r, 3000));
    }
    preview = preview!;

    if (!preview.totalPages || preview.pageUrls.length === 0) {
      throw new BadRequestError(`bz export: no preview pages available for ${detail.standardNumber}`);
    }

    const totalPages = preview.totalPages;
    const pdfDoc = await PDFDocument.create();

    // Download pages in parallel batches of 8
    const BATCH = 8;
    const pageBuffers: Map<number, Uint8Array> = new Map();

    for (let i = 0; i < preview.pageUrls.length; i += BATCH) {
      const batch = preview.pageUrls.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map(async (pageUrl, idx) => {
          const response = await pooledFetch(pageUrl);
          if (!response.ok) {
            throw new UpstreamError(`Failed to download preview page: ${pageUrl}`, { status: response.status });
          }
          return { idx: i + idx, bytes: new Uint8Array(await response.arrayBuffer()) };
        }),
      );
      for (const r of results) pageBuffers.set(r.idx, r.bytes);
      onProgress?.(Math.min(i + BATCH, totalPages), totalPages);
    }

    // Embed in order
    for (let idx = 0; idx < totalPages; idx++) {
      const bytes = pageBuffers.get(idx)!;
      const image = await pdfDoc.embedJpg(bytes);
      const page = pdfDoc.addPage([image.width, image.height]);
      page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    }

    const fileName = buildFileName(detail.standardNumber, detail.title);
    const filePath = path.join(getExportsDir(), fileName);
    await writeFile(filePath, await pdfDoc.save());

    return {
      standardId: id,
      filePath,
      fileName,
      totalPages,
    };
  }

  private async detectPageCount(standardNo: string): Promise<number> {
    // Cache hit
    const cached = getCachedPageCount(standardNo);
    if (cached !== null) return cached;

    // Binary search via HEAD requests to find page boundary
    const count = await this.probePageCount(standardNo);
    setCachedPageCount(standardNo, count);
    return count;
  }

  private async probePageCount(standardNo: string): Promise<number> {
    // First, try to read pages 0..8 in parallel to get a quick baseline
    const probes = await Promise.all(
      Array.from({ length: 9 }, (_, i) => this.getPageContentLength(standardNo, i)),
    );

    // Find first page with content < 5000 bytes
    let maxPage = 0;
    for (let i = 0; i < probes.length; i++) {
      if (probes[i] >= 5000) maxPage = i;
    }

    // If all first 9 pages have content, binary search higher
    if (probes.every((len) => len >= 5000)) {
      let low = 8;
      let high = 512;
      while (low < high - 1) {
        const mid = Math.floor((low + high) / 2);
        const [midLen, nextLen] = await Promise.all([
          this.getPageContentLength(standardNo, mid),
          this.getPageContentLength(standardNo, mid + 1),
        ]);
        if (midLen < 5000 || midLen === nextLen) {
          high = mid;
        } else {
          low = mid + 1;
        }
      }
      maxPage = low;
    }

    return maxPage + 1; // pages are 0-indexed, count = last+1
  }

  private async getPageContentLength(standardNo: string, pageNum: number): Promise<number> {
    try {
      const url = `${BZ_NEW_BASE}/api/gxist-standard/standardstd/read-image?no=${encodeURIComponent(standardNo)}&page=${pageNum}`;
      const response = await pooledFetch(url, { method: 'HEAD' });
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
