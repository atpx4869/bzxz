// Playwright 浏览器抓包：打开 bzuser 标准详情页，捕获订单创建请求
import { chromium } from 'playwright';

const stdNo = process.argv[2] ?? 'GB/T 3325-2024';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage({ viewport: { width: 1600, height: 1200 } });

  const allRequests: Array<{ method: string; url: string; body?: string; headers: Record<string, string> }> = [];

  page.on('request', (request) => {
    allRequests.push({
      method: request.method(),
      url: request.url(),
      body: request.postData() ?? undefined,
      headers: request.headers(),
    });
  });

  const detailUrl = `https://bzuser.gxzl.org.cn/#/standard/standardDetail?stdNo=${encodeURIComponent(stdNo)}`;
  console.log(`Navigating to: ${detailUrl}`);
  await page.goto(detailUrl, { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForTimeout(8000);

  const bodyText = await page.locator('body').innerText();
  console.log('Page loaded');
  console.log('Body preview:', bodyText.substring(0, 800));

  // Try clicking download
  const downloadSelectors = [
    'button:has-text("下载")',
    'span:has-text("下载PDF")',
    'span:has-text("下载")',
    '[title*="下载"]',
    '.download-btn',
    'text=/下载PDF|下载标准|下载文件/',
  ];

  for (const sel of downloadSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      console.log(`\nFound: ${sel}, clicking...`);
      try {
        await btn.click({ timeout: 5000 });
        await page.waitForTimeout(8000);
        console.log('Clicked, waiting for requests...');
      } catch (e) { console.log(`Click failed: ${e}`); }
    }
  }

  // Log all order-related requests
  console.log('\n=== Order/Dowload Related Requests ===');
  for (const r of allRequests) {
    if (r.url.includes('order') || r.url.includes('save') || r.url.includes('download') || r.url.includes('submit')) {
      console.log(`\n${r.method} ${r.url}`);
      if (r.body) console.log(`BODY: ${r.body.substring(0, 2000)}`);
    }
  }

  // Log all POST requests
  console.log('\n=== All POST Requests ===');
  for (const r of allRequests) {
    if (r.method === 'POST') {
      console.log(`\nPOST ${r.url}`);
      if (r.body) console.log(`BODY: ${r.body.substring(0, 1000)}`);
    }
  }

  await browser.close();
}

main().catch(console.error);
