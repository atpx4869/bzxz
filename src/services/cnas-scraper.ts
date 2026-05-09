import type { Browser, Page } from 'playwright';

const CNAS_BASE = 'https://las.cnas.org.cn/LAS/publish';

export interface CnasCapability {
  num: number;
  objCh: string;
  paramNum: number;
  paramCh: string;
  paramEn: string;
  stdDescAndClause: string;
  stdDescAndClauseEn: string;
  stdCode: string;
  stdCodeEn: string;
  stdAllDesc: string;
  stdAllDescEn: string;
  limitCh: string;
  limitEn: string;
  stdStatus: number;
  bigTypeName: string;
  bigTypeNameE: string;
  typeName: string;
  typeNameE: string;
  startDate: string;
  branchId: string;
  objId: string;
  paramId: string;
  objStdId: string;
}

interface CnasApiResponse {
  totalSize: number;
  startIndex: number;
  sizePerPage: number;
  data: CnasCapability[];
}

export interface CnasLabInfo {
  baseInfoId: string;
  labNo: string;
  labName: string;
  certUpdateTs: string;
  validate: string;
}

export class CnasScraper {
  private browser: Browser | null = null;
  private page: Page | null = null;

  /** Launch stealth browser and navigate to CNAS page */
  private async ensureBrowser(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;

    const pw = await import('playwright');
    this.browser = await pw.chromium.launch({
      headless: true,
      channel: 'chrome',
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    });
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    this.page = await context.newPage();
    return this.page;
  }

  /** Close browser */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
    }
  }

  /** Navigate to lab page and wait for SmartClient session */
  private async navigateToLab(labInfo: CnasLabInfo): Promise<Page> {
    // Close existing browser to get fresh session
    await this.close();
    const page = await this.ensureBrowser();

    const labUrl = `${CNAS_BASE}/orgBaseInfoScopePart.jsp?baseInfoId=${labInfo.baseInfoId}&licNo=${labInfo.labNo}`;
    await page.goto(labUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    const title = await page.title();
    if (!title || title.includes('__jsl')) {
      throw new Error('CNAS anti-bot challenge not resolved');
    }
    return page;
  }

  /** Fetch the lab/organization name from the CNAS page */
  async fetchLabName(labInfo: CnasLabInfo): Promise<string> {
    const page = await this.navigateToLab(labInfo);
    try {
      const name = await page.evaluate(() => {
        // Try common selectors for the organization name on the CNAS page
        const el = document.querySelector('.orgName, .lab-name, h2, h3, .title');
        if (el) return el.textContent?.trim() ?? '';
        // Try page title
        const t = document.title;
        if (t && !t.includes('__jsl')) return t;
        return '';
      });
      return name;
    } catch {
      return '';
    }
  }

  /** Fetch a single page of capabilities, returns null if anti-bot triggered */
  private async fetchPage(
    page: Page,
    baseinfoId: string,
    start: number,
    pageSize: number,
  ): Promise<CnasApiResponse | null> {
    const result = await page.evaluate(async (params: { baseinfoId: string; start: number; pageSize: number }) => {
      try {
        const body = new URLSearchParams({
          baseinfoId: params.baseinfoId,
          type: 'L1',
          enstart: '0',
          startIndex: String(params.start),
          sizePerPage: String(params.pageSize),
        });
        const resp = await fetch('/LAS/publish/queryPublishLCheckObj.action?', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        const text = await resp.text();
        // Check if response looks like JSON
        if (text.startsWith('{') || text.startsWith('[')) {
          return { ok: true, text };
        }
        return { ok: false, error: `Non-JSON response (${resp.status}): ${text.substring(0, 100)}` };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }, { baseinfoId, start, pageSize });

    if (!result.ok) {
      console.log(`fetchPage failed: ${result.error}`);
      return null;
    }
    try {
      return JSON.parse(result.text!) as CnasApiResponse;
    } catch {
      return null;
    }
  }

  /** Fetch capabilities for a single lab */
  async fetchCapabilities(
    labInfo: CnasLabInfo,
    onProgress?: (fetched: number, total: number) => void,
  ): Promise<CnasCapability[]> {
    let page = await this.navigateToLab(labInfo);

    const all: CnasCapability[] = [];
    let start = 0;
    const pageSize = 200; // API caps at 200 per page
    let total = Infinity;
    const maxRetries = 5;
    let requestCount = 0;

    try {
      while (all.length < total) {
        let json: CnasApiResponse | null = null;
        let retries = 0;

        while (!json && retries < maxRetries) {
          json = await this.fetchPage(page, labInfo.baseInfoId, start, pageSize);
          if (!json) {
            retries++;
            requestCount = 0;
            const waitSec = 15 + retries * 20;
            console.log(`CNAS anti-bot at offset ${start}, waiting ${waitSec}s then re-navigating (retry ${retries}/${maxRetries})...`);
            await sleep(waitSec * 1000);
            page = await this.navigateToLab(labInfo);
          }
        }

        if (!json) throw new Error(`CNAS fetch failed at offset ${start} after ${maxRetries} retries`);

        total = json.totalSize;
        const records = json.data ?? [];
        if (records.length === 0) break;

        all.push(...records);
        onProgress?.(all.length, total);
        start += pageSize;
        requestCount++;

        // Proactively re-navigate every 8 requests (~1600 records)
        if (requestCount >= 8 && start < total) {
          console.log(`Proactive re-navigation after ${requestCount} requests...`);
          await sleep(5000);
          page = await this.navigateToLab(labInfo);
          requestCount = 0;
          await sleep(3000 + Math.random() * 2000);
        } else if (start < total) {
          await sleep(1500 + Math.random() * 2000);
        }
      }
    } catch (err) {
      await this.close();
      throw err;
    }

    return all;
  }

  /** Parse CNAS URL to extract lab info */
  static parseUrl(url: string): CnasLabInfo | null {
    try {
      const u = new URL(url);
      const params = u.searchParams;
      const baseInfoId = params.get('baseInfoId');
      const licNo = params.get('licNo');
      if (!baseInfoId || !licNo) return null;
      return {
        baseInfoId,
        labNo: licNo,
        labName: '',
        certUpdateTs: params.get('certUpdateTs') ?? '',
        validate: params.get('validate') ?? '',
      };
    } catch {
      return null;
    }
  }

  /** Fetch lab info (lightweight check) */
  async fetchLabInfo(baseInfoId: string): Promise<{ certDate: string; totalSize: number }> {
    const labInfo: CnasLabInfo = { baseInfoId, labNo: '', labName: '', certUpdateTs: '', validate: '' };
    const page = await this.navigateToLab(labInfo);

    const result = await page.evaluate(async (baseinfoId: string) => {
      try {
        const body = new URLSearchParams({
          baseinfoId, type: 'L1', enstart: '0', startIndex: '0', sizePerPage: '1',
        });
        const resp = await fetch('/LAS/publish/queryPublishLCheckObj.action?', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });
        return { ok: resp.status === 200, text: await resp.text() };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }, baseInfoId);

    if (!result.ok) throw new Error(`CNAS check failed: ${result.error}`);
    let json: CnasApiResponse;
    try {
      json = JSON.parse(result.text!) as CnasApiResponse;
    } catch {
      throw new Error('CNAS check returned HTML instead of JSON (anti-bot triggered)');
    }
    return {
      certDate: json.data?.[0]?.startDate ?? '',
      totalSize: json.totalSize,
    };
  }

  /** Check for updates (lightweight) */
  async checkForUpdate(
    baseInfoId: string,
    cachedCertDate: string,
  ): Promise<{ hasUpdate: boolean; currentCertDate: string; totalSize: number }> {
    const info = await this.fetchLabInfo(baseInfoId);
    return {
      hasUpdate: info.certDate !== cachedCertDate,
      currentCertDate: info.certDate,
      totalSize: info.totalSize,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
