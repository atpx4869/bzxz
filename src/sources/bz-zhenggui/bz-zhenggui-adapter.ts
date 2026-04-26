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

    return {
      standardId: id,
      pageUrls: [],
      previewUrl: hasPdf ? `${BZ_NEW_BASE}/api/gxist-standard/standardstd/detail?id=${detail.sourceId}` : undefined,
      downloadUrl: undefined,
      captchaRequired: false,
      meta: {
        hasPdf,
        sourceId: detail.sourceId,
        note: hasPdf ? 'PDF available via standard detail page (login may be required)' : 'No PDF preview available',
      },
    };
  }

  async exportStandard(id: string): Promise<ExportResult> {
    throw new BadRequestError('bz export: PDF download requires login authentication on the new platform');
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
