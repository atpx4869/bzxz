import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const requests: Array<{ method: string; url: string }> = [];
  const responses: Array<{ status: number; url: string; contentType: string; bodyPreview?: string }> = [];

  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('zhenggui.vip') || url.includes('resource.zhenggui.vip')) {
      requests.push({ method: request.method(), url });
    }
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('zhenggui.vip') || url.includes('resource.zhenggui.vip')) {
      const contentType = response.headers()['content-type'] ?? '';
      let bodyPreview: string | undefined;
      if (contentType.includes('application/json')) {
        try {
          bodyPreview = (await response.text()).slice(0, 5000);
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
    }
  });

  await page.goto('https://bz.zhenggui.vip/standardList?searchText=3324-2017&activeTitle=true', {
    waitUntil: 'networkidle',
    timeout: 120000,
  });

  const title = await page.title();
  const bodyText = await page.locator('body').innerText();
  const detailLinks = await page.locator('a[href*="/standardDetail?"]').evaluateAll((elements) => {
    return elements.map((element) => ({
      href: (element as HTMLAnchorElement).href,
      text: element.textContent?.trim() ?? '',
    }));
  });
  const bodyHtml = await page.locator('body').innerHTML();

  console.log('PAGE_TITLE:', title);
  console.log('BODY_PREVIEW_START');
  console.log(bodyText.slice(0, 5000));
  console.log('BODY_PREVIEW_END');

  console.log('DETAIL_LINKS_START');
  console.log(JSON.stringify(detailLinks, null, 2));
  console.log('DETAIL_LINKS_END');

  console.log('BODY_HTML_START');
  console.log(bodyHtml.slice(0, 12000));
  console.log('BODY_HTML_END');

  console.log('REQUESTS_START');
  for (const request of requests) {
    console.log(JSON.stringify(request));
  }
  console.log('REQUESTS_END');

  console.log('RESPONSES_START');
  for (const response of responses) {
    console.log(JSON.stringify(response));
  }
  console.log('RESPONSES_END');

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
