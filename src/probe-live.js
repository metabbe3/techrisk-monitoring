import 'dotenv/config';
import { BrowserSession } from './browser.js';
import { ENV } from './config.js';
import { sleep } from './util.js';

// Live DOM discovery on the chart page: dumps every tab-like element, every
// ng-model input, every button, and anything comparison-related — so we can
// find where "Comparison View" moved after the UI redesign.
// Usage: node src/probe-live.js [chart title]

const CHART = process.argv[2] || 'Trade Trends Acquiring';

const session = new BrowserSession({ headless: false, stateFile: 'sessions/audit-state.json', blockRoutes: false });
await session.start();
const page = session.page;
page.setDefaultTimeout(20000);

try {
  await page.goto(ENV.loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);
  console.log(`URL: ${page.url()}`);
  if (page.url().includes('auth.paas.dana.id')) {
    console.log('SESSION DEAD — login again first (npm run inspect), then re-run.');
    process.exit(1);
  }

  // Open the target chart by text (spans with ng-click are today's chart titles)
  console.log(`\nOpening chart: ${CHART}`);
  for (const sel of ["span[ng-click='click();']", "span[ng-click='click()']", 'h3.chart-title span']) {
    const els = await page.$$(sel).catch(() => []);
    let clicked = false;
    for (const el of els) {
      const t = await el.textContent().catch(() => '');
      if (t && t.includes(CHART) && (await el.isVisible().catch(() => false))) {
        await el.click();
        clicked = true;
        break;
      }
    }
    if (clicked) break;
  }
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await sleep(5000);
  console.log(`Chart page URL: ${page.url()}`);

  const dump = await page.evaluate(() => {
    const out = {};
    const brief = (e) => ({
      tag: e.tagName.toLowerCase(),
      cls: (e.className && e.className.toString().slice(0, 80)) || '',
      ngClick: e.getAttribute('ng-click'),
      ngModel: e.getAttribute('ng-model'),
      text: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
    });
    out.tabs = [...document.querySelectorAll("[class*='tab'],[role='tab'],fc-tab-item")].slice(0, 40).map(brief);
    out.ngModels = [...document.querySelectorAll('[ng-model]')].slice(0, 40).map(brief);
    out.buttons = [...document.querySelectorAll('button, [ng-click]')].slice(0, 60).map(brief);
    out.compare = [...document.querySelectorAll('*')].filter((e) =>
      /compar/i.test(e.textContent || '')
    ).slice(0, 15).map(brief);
    out.popups = [...document.querySelectorAll('.xf-pop-up-container, [class*="pop-up"], [class*="popup"]')].map(brief);
    return out;
  });

  console.log('\n===== TAB-LIKE ELEMENTS =====');
  dump.tabs.forEach((t) => console.log(`${t.tag} .${t.cls.slice(0, 40)} | ng-click=${t.ngClick} | "${t.text}"`));
  console.log('\n===== ng-model INPUTS =====');
  dump.ngModels.forEach((t) => console.log(`${t.tag} ng-model=${t.ngModel} .${t.cls.slice(0, 30)}`));
  console.log('\n===== BUTTONS / ng-click =====');
  dump.buttons.forEach((t) => console.log(`${t.tag} ng-click=${t.ngClick} | "${t.text}"`));
  console.log('\n===== ELEMENTS MENTIONING "compar*" =====');
  dump.compare.forEach((t) => console.log(`${t.tag} .${t.cls.slice(0, 50)} ng-click=${t.ngClick} | "${t.text}"`));
  console.log('\n===== POPUPS PRESENT =====');
  dump.popups.forEach((t) => console.log(`${t.tag} .${t.cls.slice(0, 50)} | "${t.text}"`));

  await page.screenshot({ path: 'output/probe-live-chartpage.png', fullPage: false });

  // Hover experiment: does hovering the chart title or chart body spawn the old popup?
  console.log('\nHovering chart title area...');
  const title = await page.$('.chart-title, h3, [class*="title"]');
  if (title) {
    await title.hover().catch(() => {});
    await sleep(1500);
    const after = await page.evaluate(() =>
      [...document.querySelectorAll('.xf-pop-up-container, [class*="pop-up"] a, h3 a')].map((e) => ({
        cls: (e.className || '').toString().slice(0, 60),
        text: (e.textContent || '').trim().slice(0, 60),
      }))
    );
    console.log('after hover:', JSON.stringify(after, null, 1));
  }
} finally {
  await session.saveSession().catch(() => {});
  await session.close();
}
