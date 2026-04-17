import { chromium } from 'playwright';

const target = process.env.TARGET_URL || 'http://localhost:5173/';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();

const pageErrors = [];
const consoleErrors = [];

page.on('pageerror', (err) => {
  pageErrors.push(String(err));
});
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    consoleErrors.push(msg.text());
  }
});

let headerText = '';
let secondStatus = '';

try {
  await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForSelector('.status-row', { timeout: 15000 });
  headerText = await page.locator('.status-row span').first().innerText();
  secondStatus = await page.locator('.status-row span').nth(1).innerText();

  const resetButton = page.locator('text=重置姿势');
  if (await resetButton.count()) {
    await resetButton.first().click();
  }
  const nodBtn = page.locator('text=点头 (脖子转动)');
  if (await nodBtn.count()) {
    await nodBtn.first().click();
  }
} catch (e) {
  pageErrors.push(`diagnose exception: ${e instanceof Error ? e.message : String(e)}`);
}

console.log(JSON.stringify({ target, headerText, secondStatus, pageErrors, consoleErrors }, null, 2));
await browser.close();
