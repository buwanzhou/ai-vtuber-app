import { chromium } from 'playwright';

const baseUrl = process.env.TARGET_URL || 'http://localhost:5173/';

async function run() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();

  const result = {
    pageLoaded: false,
    modelReady: false,
    controlPanelPresent: false,
    expressionButtonPresent: false,
    actionButtonPresent: false,
    streamButtonsPresent: false,
    actionChangedAfterClick: false,
    error: null,
  };

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    result.pageLoaded = true;

    await page.waitForSelector('.control-panel', { timeout: 10000 });
    result.controlPanelPresent = true;

    result.expressionButtonPresent = (await page.locator('text=happy').count()) > 0;
    result.actionButtonPresent = (await page.locator('text=挥挥右手').count()) > 0;
    result.streamButtonsPresent =
      (await page.locator('text=开始模拟').count()) > 0 &&
      (await page.locator('text=停止并回正').count()) > 0;

    try {
      await page.waitForFunction(() => {
        const spans = Array.from(document.querySelectorAll('.status-row span'));
        return spans.some((node) => node.textContent?.includes('Model: Ready'));
      }, { timeout: 45000 });
      result.modelReady = true;
    } catch {
      result.modelReady = false;
    }

    const beforeText = (await page.locator('.status-row span').nth(1).innerText()).trim();
    await page.click('text=点头 (脖子转动)');

    await page.waitForFunction(() => {
      const spans = Array.from(document.querySelectorAll('.status-row span'));
      const current = spans[1]?.textContent || '';
      return current.includes('nod');
    }, { timeout: 6000 });

    const afterText = (await page.locator('.status-row span').nth(1).innerText()).trim();
    result.actionChangedAfterClick = beforeText !== afterText && afterText.includes('nod');
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

run();
