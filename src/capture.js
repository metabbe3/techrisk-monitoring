import path from 'node:path';
import { COMPARE, POPUP } from './selectors.js';
import { sleep, retry } from './util.js';
import { aggregate, normalizeTime } from './analytics.js';

// One comparison-view capture: fill the date/time form, hover the chart link,
// scrape the stat table, screenshot, close the popup.
export class ComparisonCapture {
  constructor(page) {
    this.page = page;
  }

  async capture(moduleCfg, entry, index, outputDir) {
    const page = this.page;
    console.log(`[${moduleCfg.key}] ${entry.from} vs ${entry.to} ${entry.start}-${entry.end}`);

    await retry(() => this.#fillForm(entry), 3, 2000, 'fill comparison form');
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    const found = await this.#hoverChartLink();
    if (!found) {
      const screenshot = await this.#screenshot(`${moduleCfg.key}_nodata_${index}`, outputDir);
      return this.#result(entry, { value1: 0, value2: 0, percentageChange: 0 }, [], screenshot, false, 'popup link not found');
    }

    // universalQuery takes 16-18s under load, full-day compares worse (audit
    // 2026-08-19) — default 90s, tunable for slower deployments.
    const tableTimeout = parseInt(process.env.CAPTURE_TABLE_TIMEOUT_MS || '90000', 10);
    await page.waitForSelector(POPUP.tableRows, { timeout: tableTimeout });
    const tableRows = await this.#extractRows();

    // Evidence check: the popup's metric names embed the dates the site
    // actually queried. If they don't match the requested window, the form
    // fill raced Angular (audit 2026-08-20: requested 08-11→08-18, popup
    // returned 08-19/08-20) — retry rather than record wrong-day data.
    const queried = [...new Set(tableRows
      .map((r) => (r.metric.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1])
      .filter(Boolean))].sort();
    const expected = [entry.from, entry.to].sort();
    if (queried.length && JSON.stringify(queried) !== JSON.stringify(expected)) {
      // keep what the form actually held when this raced — the fix starts here
      await this.#screenshot(`${moduleCfg.key}_datemismatch_${index}`, outputDir);
      await this.#closePopup();
      throw new Error(`date mismatch: popup queried ${queried.join('+')} but window was ${entry.from}→${entry.to}`);
    }

    const agg = aggregate(tableRows, moduleCfg);
    const screenshot = await this.#screenshot(`${moduleCfg.key}_${index}`, outputDir);
    const hasData = tableRows.length > 0 && (agg.value1 !== 0 || agg.value2 !== 0);
    let reason = null;
    if (!hasData) {
      // Distinguish "site said no data" (its own literal message) from an
      // extraction failure — different remedies.
      const popupText = await page
        .$eval('.xf-pop-up-container', (e) => (e.textContent || '').trim().slice(0, 120))
        .catch(() => '');
      reason = /no\s*data/i.test(popupText)
        ? 'site returned no data'
        : tableRows.length === 0
          ? 'no table rows'
          : 'all values zero';
    }

    await this.#closePopup();

    if (hasData) {
      console.log(`[${moduleCfg.key}] ${agg.value1} -> ${agg.value2} (${agg.percentageChange.toFixed(2)}%)`);
    } else {
      console.log(`[${moduleCfg.key}] WARNING: no data rows extracted.`);
    }
    return this.#result(entry, agg, tableRows, screenshot, hasData, reason, queried);
  }

  async #fillForm(entry) {
    const page = this.page;
    await page.waitForSelector(COMPARE.modal, { timeout: 15000 });
    await this.#setField(COMPARE.date1, entry.from);
    await this.#setField(COMPARE.date2, entry.to);
    await this.#setField(COMPARE.startTime, normalizeTime(entry.start));
    await this.#setField(COMPARE.endTime, normalizeTime(entry.end));
    // Let Angular's digest and the site's on-blur formatters commit before
    // firing the query — clicking sooner sends the previous model state
    // (audit 2026-08-20: requested 08-18, site queried 08-19). Under server
    // load the digest can outrun 800ms — 1500ms cut the mismatch retries.
    await sleep(1500);
    // Readback: only proceed when the form shows the dates we asked for.
    // Soft check (unknown formats fail open) — the popup-date gate in
    // capture() is the hard enforcement.
    const shown = await page.$$eval(
      `${COMPARE.date1}, ${COMPARE.date2}`,
      (els) => els.map((e) => (e.value || '').trim())
    );
    const norm = (v) => {
      let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return `${m[1]}-${m[2]}-${m[3]}`;
      m = v.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); // dd/mm/yyyy (site locale)
      if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
      return null; // unrecognized display format — don't guess
    };
    const got = shown.map(norm);
    if (got[0] === null || got[1] === null) return page.click(COMPARE.compareBtn);
    if (got[0] !== entry.from || got[1] !== entry.to) {
      throw new Error(`form shows ${shown.join(' / ')} but window is ${entry.from}→${entry.to}`);
    }
    await page.click(COMPARE.compareBtn);
  }

  // AngularJS ng-model inputs don't always react to fill() on pre-filled
  // values — blank at DOM level, fill, then dispatch the events the digest
  // binds to and blur so the site's on-blur formatter commits.
  async #setField(selector, value) {
    const page = this.page;
    await page.waitForSelector(selector, { timeout: 10000 });
    await page.evaluate((sel) => {
      const input = document.querySelector(sel);
      if (input) input.value = '';
    }, selector);
    await page.fill(selector, value);
    await page.evaluate((sel) => {
      const input = document.querySelector(sel);
      if (!input) return;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('keyup', { bubbles: true })); // some digests bind here
      input.blur();
    }, selector);
    await sleep(300);
  }

  async #hoverChartLink() {
    const page = this.page;
    for (const selector of POPUP.link) {
      try {
        await page.waitForSelector(selector, { timeout: 10000 });
        const links = await page.$$(selector);
        for (const link of links) {
          if (await link.isVisible().catch(() => false)) {
            await link.hover();
            await sleep(500);
            return true;
          }
        }
      } catch {}
    }
    return false;
  }

  async #extractRows() {
    return this.page.evaluate((selector) => {
      const out = [];
      document.querySelectorAll(selector).forEach((tr) => {
        const cells = tr.querySelectorAll('td');
        if (cells.length >= 5) {
          out.push({
            metric: (cells[0].textContent || '').trim(),
            date1Value: (cells[3].textContent || '').trim(),
            date2Value: (cells[4].textContent || '').trim(),
          });
        }
      });
      return out;
    }, POPUP.tableRows);
  }

  async #closePopup() {
    const page = this.page;
    try {
      await page.click(POPUP.close, { timeout: 5000 });
    } catch {
      await page.keyboard.press('Escape');
    }
    await page.waitForSelector(POPUP.statWrapper, { state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  async #screenshot(name, dir) {
    // JPEG q70: ~30-40KB vs ~130KB PNG — charts are flat color, visually
    // identical at 1280x720.
    const file = path.join(dir, `${name}.jpg`);
    await this.page.screenshot({ path: file, fullPage: false, timeout: 60000, type: 'jpeg', quality: 70 });
    return path.relative(process.cwd(), file);
  }

  #result(entry, agg, tableRows, screenshot, hasData, reason = null, queriedDates = []) {
    return { entry, ...agg, tableRows, screenshot, hasData, reason, queriedDates };
  }
}
