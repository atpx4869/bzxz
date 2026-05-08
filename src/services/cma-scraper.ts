import { pooledFetch } from '../shared/http';

const CMA_BASE = 'https://scjg.hubei.gov.cn/iframework/zjj';

export interface CmaSearchResult {
  licSysId: string;
  sysName: string;
  licHolderCode: string;
  licNumber: string;
  licDate: string;
  licValidTimeBegin: string;
  licValidTimeEnd: string;
  licState: string;
  addr: string;
}

export interface CmaDetail {
  licSysId: string;
  sysName: string;
  sysZzjgdm: string;
  certificateNumber: string;
  sysGjsjzx: string;
  majorCategory: string;
  businessDepartment: string;
  registerAddress: string;
  sysFzrName: string;
  sysLxrName: string;
  leRep: string;
  techDirectorName: string;
  licNumber: string;
  licDate: string;
  licValidTimeBegin: string;
  licValidTimeEnd: string;
  licUnitname: string;
  licHolder: string;
  addr: string;
  updateTime: number;
}

export interface CmaCapability {
  jcnlId: string;
  type: string;
  cpNumber: string;
  cpName: string;
  yjbzNameNumber: string;
  yjbzNumber: string;
  xzfw: string;
  sm: string;
  parentNo: string;
  parentName: string;
  placeName: string;
  certId: string;
  updateTime: number;
}

interface CmaListResponse {
  id: string;
  data: {
    records: CmaSearchResult[];
    total: number;
    size: number;
    current: number;
  };
}

interface CmaDetailResponse extends CmaDetail {}

interface CmaCapabilityResponse {
  data: {
    records: CmaCapability[];
    total: number;
    size: number;
    current: number;
  };
}

export class CmaScraper {
  /** Search by credit code, certificate number, or org name */
  async search(params: {
    creditCode?: string;
    certNumber?: string;
    orgName?: string;
  }): Promise<CmaSearchResult[]> {
    const qs = new URLSearchParams();
    qs.set('tyshxydm', params.creditCode ?? '');
    qs.set('zsbh', params.certNumber ?? '');
    qs.set('dwmc', params.orgName ?? '');
    qs.set('limit', '10');
    qs.set('pageNum', '1');

    const url = `${CMA_BASE}/lic-jyjcjgzzrd-main/findAllJyjcMain?${qs}`;
    const resp = await pooledFetch(url);
    if (!resp.ok) throw new Error(`CMA search failed: ${resp.status}`);
    const json = (await resp.json()) as CmaListResponse;
    if (json.id !== '01') throw new Error(`CMA search error: ${JSON.stringify(json)}`);
    return json.data?.records ?? [];
  }

  /** Get certificate detail */
  async getDetail(licSysId: string): Promise<CmaDetail> {
    const url = `${CMA_BASE}/lic-jyjcjgzzrd-main/getJyjcMainEn?id=${licSysId}`;
    const resp = await pooledFetch(url);
    if (!resp.ok) throw new Error(`CMA detail failed: ${resp.status}`);
    return (await resp.json()) as CmaDetail;
  }

  /** Get all capabilities with pagination */
  async getCapabilities(
    licSysId: string,
    onProgress?: (fetched: number, total: number) => void,
  ): Promise<CmaCapability[]> {
    const all: CmaCapability[] = [];
    let page = 1;
    const pageSize = 500;
    let total = Infinity;

    while (all.length < total) {
      const url = `${CMA_BASE}/lic-jyjcjgzzrd-jcnl/jcnlPageTable?licSysId=${licSysId}&limit=${pageSize}&pageNum=${page}`;
      const resp = await pooledFetch(url);
      if (!resp.ok) throw new Error(`CMA capabilities failed: ${resp.status} at page ${page}`);
      const json = (await resp.json()) as CmaCapabilityResponse;
      const records = json.data?.records ?? [];
      total = json.data?.total ?? 0;

      if (records.length === 0) break;
      all.push(...records);
      onProgress?.(all.length, total);
      page++;

      // Small delay to be polite
      if (all.length < total) await sleep(200);
    }

    return all;
  }

  /** Full scrape: search → detail → capabilities */
  async scrapeFull(
    creditCode: string,
    onProgress?: (stage: string, fetched: number, total: number) => void,
  ): Promise<{
    detail: CmaDetail;
    capabilities: CmaCapability[];
  }> {
    onProgress?.('search', 0, 0);
    const results = await this.search({ creditCode });
    if (results.length === 0) throw new Error(`No CMA certificate found for: ${creditCode}`);

    const first = results[0];
    onProgress?.('detail', 0, 0);
    const detail = await this.getDetail(first.licSysId);

    onProgress?.('capabilities', 0, 0);
    const capabilities = await this.getCapabilities(first.licSysId, (fetched, total) => {
      onProgress?.('capabilities', fetched, total);
    });

    return { detail, capabilities };
  }

  /** Check if certificate date has changed (lightweight update detection) */
  async checkForUpdate(creditCode: string, cachedLicDate: string): Promise<{
    hasUpdate: boolean;
    currentLicDate: string;
    licSysId: string;
  }> {
    const results = await this.search({ creditCode });
    if (results.length === 0) throw new Error(`No CMA certificate found for: ${creditCode}`);
    const first = results[0];
    return {
      hasUpdate: first.licDate !== cachedLicDate,
      currentLicDate: first.licDate,
      licSysId: first.licSysId,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
