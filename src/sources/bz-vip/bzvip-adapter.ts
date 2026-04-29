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
import { buildFileName, safeWriteExportFile } from '../../shared/fs';
import { createStandardId, parseStandardId } from '../../shared/id';
import { accountPool, bzVipGet, bzVipDownload, bzVipPost } from './account-pool';

interface BzSearchRow {
  id: number | string;
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

interface BzSearchResponse {
  code: number;
  data?: { records?: BzSearchRow[]; total: number };
}

interface BzDetailResponse {
  code: number;
  data?: BzSearchRow;
}

const STATUS_MAP: Record<string, string> = {
  '1': '现行有效', '2': '部分有效', '3': '即将实施',
  '4': '即将废止', '5': '已经废止', '6': '调整转号', '9': '其它',
};

const BZ_NEW_BASE = 'https://bz.gxzl.org.cn';

export class BzVipAdapter implements SourceAdapter {
  readonly source = 'bzvip' as const;

  // --- Public API (same as bz, no auth needed) ---

  async searchStandards(input: SearchStandardsInput): Promise<StandardSummary[]> {
    const params = new URLSearchParams({ language: 'zh', current: '1', size: '20', keywords: input.query });
    const { status, data } = await bzVipGet(`/api/gxist-standard/standardstd/list?${params.toString()}`);
    if (status !== 200) {
      throw new UpstreamError('bzvip search API failed', { status });
    }

    const payload = data as BzSearchResponse;
    const rows = payload.data?.records ?? [];
    return rows.map((row) => this.mapSearchRow(row));
  }

  async getStandardDetail(id: string): Promise<StandardDetail> {
    const { sourceId } = parseStandardId(id);
    const { status, data } = await bzVipGet(`/api/gxist-standard/standardstd/detail?id=${encodeURIComponent(sourceId)}`);
    if (status !== 200) {
      throw new UpstreamError('bzvip detail API failed', { status });
    }

    const payload = data as BzDetailResponse;
    const row = payload.data;
    if (!row) throw new NotFoundError(`bzvip detail not found for ${id}`);

    return this.mapDetail(row);
  }

  async detectPreview(id: string): Promise<PreviewInfo> {
    const detail = await this.getStandardDetail(id);
    const hasPdf = detail.moreInfo?.hasPdf === true || detail.moreInfo?.isPdf === '1';

    return {
      standardId: id,
      pageUrls: [],
      fileType: 'pdf',
      previewUrl: `${BZ_NEW_BASE}/standard/details/?id=${detail.sourceId}`,
      downloadUrl: undefined,
      captchaRequired: false,
      meta: {
        hasPdf,
        standardNo: detail.standardNumber,
        sourceId: detail.sourceId,
        capability: 'direct_pdf_via_order',
      },
    };
  }

  // --- VIP Download via Account Pool ---

  async exportStandard(id: string, _onProgress?: (current: number, total: number) => void): Promise<ExportResult> {
    const detail = await this.getStandardDetail(id);
    const standardNo = detail.standardNumber;
    const sourceId = detail.sourceId;

    // Acquire account from pool
    let account;
    try {
      account = await accountPool.acquire();
    } catch (e) {
      throw new UpstreamError(`No available bzvip account: ${(e as Error).message}`);
    }

    try {
      // Step 1: Create order
      const orderBody = {
        businessType: 'std-download',
        businessId: String(sourceId),
        title: '标准下载',
        description: `标准号：${standardNo}，标准名称：${detail.title}`,
        businessNumber: standardNo,
        businessName: detail.title,
        money: '0.00',
        discount: '100.00',
        totalMoney: '0.00',
        remark: '会员免费下载',
      };

      const authParam = `Blade-Auth=bearer%20${encodeURIComponent(account.accessToken!)}`;
      const orderRes = await bzVipPost(`/api/gxist-order/order/save?${authParam}`, orderBody);
      const orderData = orderRes.data as { code: number; success: boolean; data?: { id: string; auditStatus?: string } };
      if (!orderData?.data?.id) {
        throw new UpstreamError('Failed to create download order');
      }

      const orderId = orderData.data.id;

      // Step 2: Download PDF
      const dlUrl = `/api/gxist-standard/standardOrder/download?id=${orderId}&${authParam}`;
      const dl = await bzVipDownload(dlUrl);

      if (dl.status !== 200 || !isValidPdf(dl.data)) {
        throw new UpstreamError('Download returned invalid data');
      }

      const fileName = buildBzVipFileName(standardNo, detail.title, dl.disposition);
      const filePath = await safeWriteExportFile(fileName, dl.data);

      accountPool.release(account, true);
      return { standardId: id, filePath, fileName };
    } catch (e) {
      accountPool.release(account, false);
      throw e instanceof UpstreamError ? e : new UpstreamError(`bzvip download failed: ${(e as Error).message}`);
    }
  }

  async autoDownload(id: string, _maxRetries?: number): Promise<DownloadSessionInfo> {
    try {
      const result = await this.exportStandard(id);
      return {
        id: `bzvip_auto_${Date.now()}`,
        standardId: id,
        source: 'bzvip',
        status: 'downloaded',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        captchaImageBase64: undefined,
        meta: {
          fileName: result.fileName,
          filePath: result.filePath,
        },
      };
    } catch (e) {
      return {
        id: `bzvip_auto_${Date.now()}`,
        standardId: id,
        source: 'bzvip',
        status: 'failed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        captchaImageBase64: undefined,
        meta: { error: (e as Error).message },
      };
    }
  }

  // --- Private helpers ---

  private mapSearchRow(row: BzSearchRow): StandardSummary {
    return {
      id: createStandardId('bzvip', String(row.id)),
      source: 'bzvip',
      sourceId: String(row.id),
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

  private mapDetail(row: BzSearchRow): StandardDetail {
    return {
      id: createStandardId('bzvip', String(row.id)),
      source: 'bzvip',
      sourceId: String(row.id),
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
      },
      meta: row as Record<string, unknown>,
    };
  }
}

function isValidPdf(data: Buffer): boolean {
  // Must start with %PDF- magic bytes
  if (data.length < 1024) return false;
  return data.slice(0, 5).toString() === '%PDF-';
}

function buildBzVipFileName(standardNumber: string, title: string, disposition: string): string {
  const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
  if (match) {
    const fname = match[1].replace(/['"]/g, '').trim();
    if (fname) return decodeURIComponent(fname);
  }
  return buildFileName(standardNumber, title);
}
