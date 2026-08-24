import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { BrowserSession } from './browser.js';
import { AuthService } from './auth.js';
import { Dashboard } from './dashboard.js';
import { MODULES, ENV, DATA_DIR } from './config.js';
import { LOGIN, DASHBOARD, COMPARE, POPUP } from './selectors.js';
import { sleep, firstVisible } from './util.js';

// Live E2E audit: walks every page/flow with full instrumentation — timings,
// console errors, unexpected navigations/popups, slow requests, and a probe of
// every selector chain (which fallback actually wins on today's DOM).
// Usage: node src/audit.js [--rounds 2]

const ROUNDS = parseInt(process.argv.find((a) => a.startsWith('--rounds'))?.split('=')[1] || '2', 10);
const AUDIT_DIR = path.join(DATA_DIR, `audit_${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(AUDIT_DIR, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  steps: [],
  selectorProbes: [],
  consoleErrors: [],
  pageErrors: [],
  unexpectedNavigations: [],
  popups: [],
  dialogs: [],
  failedRequests: [],
  timings: [],
  findings: [],
};

const shot = (name) => path.join(AUDIT_DIR, `${name}.png`);
const short = (u) => String(u).replace(/^https?:\/\//, '').slice(0, 110);

// ── instrumentation ─────────────────────────────────────────────────────────
function instrument(session) {
  const page = session.page;
  const context = session.context;
  const reqStart = new Map();

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      report.consoleErrors.push({ type: msg.type(), text: msg.text().slice(0, 300) });
      if (msg.type() === 'error') console.log(`  [console.error] ${msg.text().slice(0, 160)}`);
    }
  });
  page.on('pageerror', (e) => {
    report.pageErrors.push(String(e).slice(0, 300));
    console.log(`  [pageerror] ${String(e).slice(0, 160)}`);
  });

  let lastUrl = null;
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    const url = frame.url();
    if (url === lastUrl || url === 'about:blank') return;
    lastUrl = url;
    report.unexpectedNavigations.push({ at: new Date().toISOString(), url: short(url) });
    console.log(`  [nav] ${short(url)}`);
  });

  page.on('dialog', async (d) => {
    report.dialogs.push({ type: d.type(), message: d.message().slice(0, 200) });
    console.log(`  [dialog:${d.type()}] ${d.message().slice(0, 120)}`);
    await d.dismiss().catch(() => {});
  });

  context.on('page', async (p) => {
    report.popups.push({ at: new Date().toISOString(), url: short(p.url()) });
    console.log(`  [POPUP-OPENED] ${short(p.url())}`);
    await sleep(1500).catch(() => {});
    console.log(`  [POPUP-FINAL]  ${short(p.url())}`);
    await p.screenshot({ path: shot(`popup_${report.popups.length}`) }).catch(() => {});
    await p.close().catch(() => {});
  });

  context.on('request', (r) => {
    if (reqStart.size < 4000) reqStart.set(r, Date.now());
  });
  context.on('response', (r) => {
    const s = reqStart.get(r.request());
    if (s !== undefined) {
      report.timings.push({ url: short(r.url()), ms: Date.now() - s, status: r.status() });
      reqStart.delete(r.request());
    }
  });
  context.on('requestfailed', (r) => {
    report.failedRequests.push({ url: short(r.url()), err: r.failure()?.errorText });
    reqStart.delete(r);
  });
  return page;
}

// ── step wrapper ────────────────────────────────────────────────────────────
let page;
async function step(name, fn, { soft = false } = {}) {
  const t0 = Date.now();
  console.log(`\n▶ ${name}`);
  try {
    const out = await fn();
    const ms = Date.now() - t0;
    report.steps.push({ name, ms, ok: true });
    console.log(`✓ ${name} — ${ms}ms`);
    return out;
  } catch (e) {
    const ms = Date.now() - t0;
    report.steps.push({ name, ms, ok: false, error: e.message, url: short(page.url()) });
    console.log(`✗ ${name} FAILED after ${ms}ms: ${e.message}`);
    console.log(`  url now: ${short(page.url())}`);
    await page.screenshot({ path: shot(`FAIL_${name.replace(/\W+/g, '_').slice(0, 60)}`) }).catch(() => {});
    if (!soft) throw e;
  }
}

// Probe a selector chain against the live DOM: match count / visible count /
// which fallback wins.
async function probe(label, selectors, { must = false } = {}) {
  const result = { label, candidates: [] };
  let winner = null;
  for (const sel of selectors) {
    const entry = { sel };
    try {
      const els = await page.$$(sel);
      entry.count = els.length;
      let visible = 0;
      let first = null;
      for (const el of els.slice(0, 8)) {
        if (await el.isVisible().catch(() => false)) {
          visible++;
          if (!first) {
            first = await el
              .evaluate((e) => ({
                tag: e.tagName.toLowerCase(),
                ngModel: e.getAttribute('ng-model'),
                ngClick: e.getAttribute('ng-click'),
                type: e.getAttribute('type'),
                text: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
              }))
              .catch(() => null);
          }
        }
      }
      entry.visible = visible;
      entry.first = first;
      if (!winner && visible > 0) winner = entry;
    } catch (e) {
      entry.error = String(e.message).split('\n')[0].slice(0, 120);
    }
    result.candidates.push(entry);
  }
  result.winner = winner?.sel || null;
  report.selectorProbes.push(result);
  console.log(
    `  probe[${label}]: ${winner ? `WINNER ${winner.sel} (${winner.visible} vis/${winner.count} match)` : 'NO VISIBLE MATCH'}${
      result.candidates.some((c) => c.error) ? ' [invalid selector: ' + result.candidates.find((c) => c.error).sel + ']' : ''
    }`
  );
  if (must && !winner) report.findings.push(`MISSING selector for ${label}: no visible match in ${selectors.join(' | ')}`);
  return winner;
}

// ── the flows, one by one ───────────────────────────────────────────────────
async function loginFlow() {
  const auth = new AuthService(page);
  const loginUrl = ENV.loginUrl;

  await step('login.page-load', async () => {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  });

  await probe('login.email', LOGIN.email, { must: true });
  await probe('login.password', LOGIN.password, { must: true });
  await probe('login.submit', LOGIN.submit, { must: true });

  await step('login.fill+submit', async () => {
    const email = await firstVisible(page, LOGIN.email, 30000);
    await email.fill(ENV.email);
    const pass = await firstVisible(page, LOGIN.password, 10000);
    await pass.fill(ENV.password);
    const submit = await firstVisible(page, LOGIN.submit, 10000);
    await submit.click();
    const initialUrl = page.url();
    await page.waitForFunction((u) => window.location.href !== u, initialUrl, { timeout: 60000, polling: 1000 });
  });

  const landing = await step('login.landing-check', async () => {
    await sleep(3000);
    const url = page.url();
    const landedOk = url.includes('monitor.paas.dana.id');
    if (!landedOk) report.findings.push(`LOGIN lands on wrong page: ${short(url)} (goto-recovery needed)`);
    return url;
  }, { soft: true });
  console.log(`  landed on: ${short(landing)}`);

  // goto-recovery (the known workaround) if needed
  if (!String(landing).includes('monitor.paas.dana.id')) {
    await step('login.goto-recovery', async () => {
      const m = loginUrl.match(/[?&]goto=([^&]+)/);
      const target = m ? decodeURIComponent(m[1]) : null;
      if (target) await page.goto(target, { waitUntil: 'networkidle', timeout: 60000 });
      if (!page.url().includes('monitor.paas.dana.id')) throw new Error(`still wrong: ${short(page.url())}`);
    }, { soft: true });
  }
}

async function dashboardFlow(dashboard) {
  await step('dashboard.tz-locale', () => dashboard.prepare().then(() => {}), { soft: true });
  await probe('dashboard.chartTitle', DASHBOARD.chartTitle, { must: true });

  // what does the chart list look like right now?
  await step('dashboard.chart-inventory', async () => {
    const charts = await page.$$eval('h3.chart-title span', (els) =>
      els.map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 30)
    );
    console.log(`  charts on page (${charts.length}): ${charts.join(' | ').slice(0, 400)}`);
  }, { soft: true });

  await probe('dashboard.workspaceModal1', [DASHBOARD.productionModal1.option]);
  await probe('dashboard.workspaceModal2', [DASHBOARD.productionModal2.optionA, DASHBOARD.productionModal2.optionB]);
}

async function moduleFlow(dashboard, key, round) {
  const cfg = { key, ...MODULES[key] };
  console.log(`\n${'═'.repeat(70)}\n  MODULE ${key} (round ${round})\n${'═'.repeat(70)}`);

  await step(`${key}.open-chart`, () => dashboard.openChart(cfg.dashboardItem, { expectTabs: true }), { soft: true });

  await probe(`${key}.tabs`, DASHBOARD.tabs);
  await step(`${key}.comparison-tab`, () => dashboard.clickTab('Comparison View'), { soft: true });

  await step(`${key}.form`, async () => {
    await probe(`${key}.compare-modal`, [COMPARE.modal], { must: true });
    await probe(`${key}.compare-inputs`, [COMPARE.date1, COMPARE.date2, COMPARE.startTime, COMPARE.endTime]);
    await page.waitForSelector(COMPARE.modal, { timeout: 15000 });
    const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const to = new Date().toISOString().slice(0, 10);
    for (const [sel, val] of [
      [COMPARE.date1, from],
      [COMPARE.date2, to],
      [COMPARE.startTime, '00:00:00'],
      [COMPARE.endTime, '23:59:59'],
    ]) {
      await page.evaluate((s) => {
        const i = document.querySelector(s);
        if (i) i.value = '';
      }, sel);
      await page.fill(sel, val);
      // did Angular accept it?
      const took = await page.$eval(sel, (e) => e.value).catch(() => null);
      if (took !== val) report.findings.push(`${key}: fill ${sel} with "${val}" but input holds "${took}"`);
    }
    await page.click(COMPARE.compareBtn);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  }, { soft: true });

  await step(`${key}.popup+table`, async () => {
    const linkWinner = await probe(`${key}.popup-link`, POPUP.link, { must: true });
    if (!linkWinner) throw new Error('no popup link visible');
    await page.hover(linkWinner.sel);
    await sleep(500);
    await page.waitForSelector(POPUP.tableRows, { timeout: 45000 });
    const rows = await page.$$eval(POPUP.tableRows, (trs) =>
      trs.slice(0, 5).map((tr) => [...tr.querySelectorAll('td')].map((td) => (td.textContent || '').trim()))
    );
    console.log(`  table rows (first 5 of raw): ${JSON.stringify(rows).slice(0, 500)}`);
    if (rows.length && rows[0].length < 5)
      report.findings.push(`${key}: table rows have ${rows[0].length} cells, expected >=5 (td[3]/td[4] extraction would break)`);
    await page.screenshot({ path: shot(`${key}_r${round}_table`) });
  }, { soft: true });

  await step(`${key}.close-popup`, async () => {
    try {
      await page.click(POPUP.close, { timeout: 5000 });
    } catch {
      await page.keyboard.press('Escape');
    }
    await page.waitForSelector(POPUP.statWrapper, { state: 'hidden', timeout: 5000 }).catch(() => {});
  }, { soft: true });
}

// ── main ────────────────────────────────────────────────────────────────────
const session = new BrowserSession({
  headless: false, // watch it live
  stateFile: 'sessions/audit-state.json',
  blockRoutes: false, // measure the site's true speed
});

try {
  await session.start();
  page = instrument(session);
  console.log(`Audit started ${report.startedAt} — screenshots/log → ${AUDIT_DIR}`);

  await loginFlow();
  const dashboard = new Dashboard(page);
  await dashboardFlow(dashboard);

  for (let round = 1; round <= ROUNDS; round++) {
    for (const key of Object.keys(MODULES)) {
      await moduleFlow(dashboard, key, round);
      await step(`${key}.reset`, () => dashboard.reset(), { soft: true });
    }
  }

  // session reuse check (2nd login skipped?)
  await step('session.reuse-check', async () => {
    const auth = new AuthService(page);
    const valid = await auth.isLoggedIn();
    console.log(`  session still valid after full run: ${valid}`);
  }, { soft: true });
} catch (e) {
  report.findings.push(`AUDIT ABORTED: ${e.message}`);
} finally {
  report.finishedAt = new Date().toISOString();
  report.slowestRequests = [...report.timings].sort((a, b) => b.ms - a.ms).slice(0, 20);
  delete report.timings;
  report.consoleErrors = report.consoleErrors.slice(0, 30);
  report.failedRequests = report.failedRequests.slice(0, 30);
  fs.writeFileSync(path.join(AUDIT_DIR, 'audit-report.json'), JSON.stringify(report, null, 2));

  console.log(`\n${'═'.repeat(70)}\nAUDIT SUMMARY\n${'═'.repeat(70)}`);
  const okSteps = report.steps.filter((s) => s.ok);
  const failSteps = report.steps.filter((s) => !s.ok);
  console.log(`steps: ${okSteps.length} ok, ${failSteps.length} failed (total ${(
    report.steps.reduce((s, x) => s + x.ms, 0) / 1000
  ).toFixed(0)}s)`);
  for (const s of failSteps) console.log(`  FAIL: ${s.name} — ${s.error}`);
  console.log(`popups: ${report.popups.length}, dialogs: ${report.dialogs.length}, pageerrors: ${report.pageErrors.length}`);
  console.log(`slowest: ${report.slowestRequests.slice(0, 5).map((r) => `${r.ms}ms ${r.url.slice(0, 60)}`).join('  \n         ') || '-'}`);
  console.log(`\nfindings (${report.findings.length}):`);
  report.findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  console.log(`\nfull report: ${path.join(AUDIT_DIR, 'audit-report.json')}`);
  await session.close().catch(() => {});
}
