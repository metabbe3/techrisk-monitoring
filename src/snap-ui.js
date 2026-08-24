import { chromium } from 'playwright';
import process from 'node:process';

// Screenshot the dashboard UI for visual verification: node src/snap-ui.js [url]
const url = process.argv[2] || 'http://localhost:8788/';
const token = process.argv[3];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
if (token) await page.evaluate(() => localStorage.setItem('token', process.argv[3]), token).catch(() => {});
if (token) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('token', t), token);
}
await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.screenshot({ path: 'output/ui-dashboard.png', fullPage: false });
// expand newest run shots
await page.click('[data-toggle-run]').catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'output/ui-dashboard-expanded.png', fullPage: false });
console.log('shots saved: output/ui-dashboard.png, output/ui-dashboard-expanded.png');
await browser.close();
