import { chromium } from 'playwright';

const target = process.env.TARGET_URL || 'http://localhost:5176/';
const out = process.env.OUT_FILE || 'tmp-page.png';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const logs = [];
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') {
    logs.push(`[${msg.type()}] ${msg.text()}`);
  }
});
page.on('pageerror', (err) => logs.push(`[pageerror] ${String(err)}`));

await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: out, fullPage: true });

const status = await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll('.status-row span')).map((el) => el.textContent || '');
  return {
    statusSpans: spans,
    canvasCount: document.querySelectorAll('canvas').length,
  };
});

console.log(JSON.stringify({ target, out, status, logs }, null, 2));
await browser.close();
