import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

  const requests: Array<{ method: string; url: string }> = [];
  const responses: Array<{ status: number; url: string; contentType: string; bodyPreview?: string }> = [];

  page.on('request', (request) => {
    requests.push({ method: request.method(), url: request.url() });
  });

  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] ?? '';
    let bodyPreview: string | undefined;
    if (contentType.includes('json') || contentType.includes('text/plain')) {
      try {
        bodyPreview = (await response.text()).slice(0, 8000);
      } catch {
        bodyPreview = undefined;
      }
    }
    responses.push({
      status: response.status(),
      url,
      contentType,
      bodyPreview,
    });
  });

  await page.goto('https://bz.gxzl.org.cn/standard/queryList?stdName=3325-2024', {
    waitUntil: 'networkidle',
    timeout: 120000,
  });

  const title = await page.title();
  const bodyText = await page.locator('body').innerText();

  console.log('TITLE:', title);
  console.log('BODY_START');
  console.log(bodyText.slice(0, 6000));
  console.log('BODY_END');

  console.log('\n=== ALL REQUESTS ===');
  for (const r of requests) {
    console.log(r.method, r.url);
  }

  console.log('\n=== API RESPONSES ===');
  for (const r of responses) {
    if (r.contentType.includes('json') || r.bodyPreview) {
      console.log(`\n--- ${r.status} ${r.url} [${r.contentType}] ---`);
      console.log(r.bodyPreview ?? '(no body)');
    }
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
