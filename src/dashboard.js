import { DASHBOARD } from './selectors.js';
import { sleep } from './util.js';

// Navigation inside Optimus: dashboard prep (cookies, workspace modal), opening
// charts by title, clicking tabs, resetting between modules.
export class Dashboard {
  constructor(page) {
    this.page = page;
  }

  async prepare() {
    await this.#setTimezoneAndLocale();
    await this.#waitForUrlSettled();
    await this.#dismissWorkspaceModal();
    await this.openChart('DANA_Overall_Dashboard');
    await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  }

  // The site rewrites its own URL with a doubled workspaceName param right
  // after load, re-rendering and killing its in-flight queries. Wait for the
  // bounce to finish before touching anything. (audit 2026-08-19)
  async #waitForUrlSettled(timeout = 15000) {
    await this.page
      .waitForFunction(
        () => !/[?&]workspaceName=[^&]*&workspaceName=/.test(location.href),
        { timeout }
      )
      .catch(() => {});
  }

  // The dashboard renders dates in the browser timezone — force Asia/Jakarta
  // and English so captured numbers are deterministic.
  async #setTimezoneAndLocale() {
    const page = this.page;
    const cookies = await page.context().cookies();
    const tz = cookies.find(
      (c) => c.name === 'xflush_time_zone' && c.domain.includes('monitor.paas.dana.id')
    );
    const locale = cookies.find((c) => c.name === 'LOCALE' && c.domain.includes('dana.id'));
    if (
      tz &&
      decodeURIComponent(tz.value) === 'Asia/Jakarta' &&
      locale &&
      decodeURIComponent(locale.value) === 'en'
    ) {
      return;
    }
    await page.context().addCookies([
      { name: 'xflush_time_zone', value: 'Asia/Jakarta', domain: 'monitor.paas.dana.id', path: '/' },
      { name: 'LOCALE', value: 'en', domain: '.dana.id', path: '/' },
    ]);
    console.log('Set timezone=Asia/Jakarta, locale=en.');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  }

  // "Select workspace" modal, two generations in the wild. Non-fatal if absent
  // (it never appears when LOGIN_URL carries tenant+workspace params — one
  // 4s combined wait instead of the old 10s + 6s of blind loops).
  async #dismissWorkspaceModal() {
    const page = this.page;
    const { productionModal1: m1, productionModal2: m2 } = DASHBOARD;
    const anyModal = [m1.option, m2.optionA, m2.optionB].join(', ');
    const found = await page.waitForSelector(anyModal, { timeout: 4000 }).catch(() => null);
    if (!found) return;

    try {
      if (await page.$(m1.option)) {
        await page.click(m1.option);
        await page.click(m1.submit);
        await sleep(3000);
      }
      const a = await page.$(m2.optionA);
      const b = await page.$(m2.optionB);
      const target = a && (await a.isVisible()) ? a : b && (await b.isVisible()) ? b : null;
      if (target) {
        await target.click();
        await page.click(m2.submit);
      }
    } catch {}
  }

  // Open a display board by its SPA route. Jumping straight to /display/<board>
  // from inside a board page leaves the SPA in an empty shell — route via the
  // clean overview first, then hop to the display index, where the board's own
  // tile is a normal chart title.
  async openDisplayBoard(name) {
    const page = this.page;
    const m = page.url().match(/#\/([^/]+)\/([^/]+)\//);
    if (!m) throw new Error(`cannot parse tenant/workspace from ${page.url()}`);
    const base = page.url().split('#')[0];
    const route = `${base}#/${m[1]}/${m[2]}/display/${name}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.goto(`${base}#/${m[1]}/${m[2]}/overview/overview`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.#waitForUrlSettled();
      await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
      await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await this.#waitForUrlSettled();
      await this.escapeModals();
      // the tile list swaps in late after the hash-only reroute — wait for the tile
      await page
        .waitForFunction(
          (n) =>
            [...document.querySelectorAll("span[ng-click='click();'], span[ng-click='click()'], h3.chart-title span")].some(
              (e) => (e.textContent || '').includes(n)
            ),
          name,
          { timeout: 30000 }
        )
        .catch(() => {});
      try {
        await this.openChart(name);
        return;
      } catch {
        console.log(`  [openDisplayBoard] "${name}" tile not clickable (attempt ${attempt + 1}/3) — reloading`);
      }
    }
    throw new Error(`display board "${name}" never opened`);
  }

  // Generic modal guard: the Command Center board (and occasionally the
  // overall page after a board switch) lands with a leftover top-level modal
  // whose backdrop intercepts every click. Escape clears it; harmless no-op
  // when nothing is open.
  async escapeModals() {
    for (let i = 0; i < 3; i++) {
      const blocked = await this.page.$('.modal-backdrop, div.modal.top').catch(() => null);
      if (!blocked || !(await blocked.isVisible().catch(() => false))) return;
      await this.page.keyboard.press('Escape').catch(() => {});
      await sleep(800);
    }
  }

  // Click a dashboard chart by its visible title. Text-match beats absolute
  // paths — this survived every UI reshuffle in the old project.
  //
  // expectTabs: the chart's detail view only renders if the site's data query
  // succeeds; when it 500s the click lands but the detail never opens and we
  // stay on the dashboard (audit 2026-08-19). Verify + reload + retry.
  async openChart(title, { expectTabs = false } = {}) {
    const page = this.page;
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const selector of DASHBOARD.chartTitle) {
        const els = await page.$$(selector).catch(() => []);
        for (const el of els) {
          const text = await el.textContent().catch(() => null);
          if (text && text.includes(title) && (await el.isVisible().catch(() => false))) {
            await el.click();
            await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
            if (!expectTabs) return;
            const detail = await page
              .waitForSelector(DASHBOARD.detailTabs, { timeout: 20000 })
              .catch(() => null);
            if (detail) return;
            console.log(
              `  [openChart] "${title}" detail did not render (attempt ${attempt + 1}/3) — reloading and retrying`
            );
            await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
            await page
              .waitForSelector(DASHBOARD.chartTitle[0], { timeout: 30000 })
              .catch(() => {});
            break; // retry from the outer loop
          }
        }
      }
      await sleep(2000);
    }
    throw new Error(
      expectTabs
        ? `chart "${title}" detail never rendered (site query failing — try again later)`
        : `chart "${title}" not found`
    );
  }

  async clickTab(label) {
    const page = this.page;
    for (let attempt = 0; attempt < 6; attempt++) {
      for (const selector of DASHBOARD.tabs) {
        const els = await page.$$(selector).catch(() => []);
        for (const el of els) {
          const text = await el.textContent().catch(() => null);
          if (text && text.trim().includes(label) && (await el.isVisible().catch(() => false))) {
            await el.click();
            return;
          }
        }
      }
      await sleep(1000);
    }
    throw new Error(`tab "${label}" not found`);
  }

  // Back to the dashboard root for the next module.
  async reset() {
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await this.page.waitForSelector(DASHBOARD.chartTitle[0], { timeout: 30000 }).catch(() => {});
  }
}
