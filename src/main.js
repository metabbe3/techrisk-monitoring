import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { MODULES, ENV, parseArgs, DATA_DIR } from './config.js';
import { BrowserSession } from './browser.js';
import { AuthService } from './auth.js';
import { Dashboard } from './dashboard.js';
import { ComparisonCapture } from './capture.js';
import { IncidentReport } from './report.js';
import { MysqlSink } from './mysql-sink.js';

const HARD_TIMEOUT_MS = 30 * 60 * 1000; // site is slow; never run away

// Cooperative stop: the UI's Stop button sets this; runCapture checks it at
// every loop boundary and unwinds cleanly (browser closed in the finally).
let abortRequested = false;
export function requestAbort() {
  abortRequested = true;
}
const checkAbort = () => {
  if (abortRequested) throw new Error('capture stopped by user');
};

// Orchestrates one full capture run. Exported so the web server can trigger it.
// onProgress(step, detail) is called at each step so the web UI can show
// live progress for the running capture.
export async function runCapture(args, { onProgress = () => {} } = {}) {
  if (!ENV.email || !ENV.password) throw new Error('LOGIN_EMAIL / LOGIN_PASSWORD missing in .env');

  const started = Date.now();
  const progress = (step, detail = '') => {
    const msg = detail ? `${step} — ${detail}` : step;
    console.log(msg);
    onProgress({ at: new Date().toISOString(), step, detail, modules: args.moduleList });
  };

  const session = new BrowserSession({ headless: ENV.headless });
  await session.start();

  try {
    progress('login', 'checking saved session');
    const auth = new AuthService(session.page);
    await auth.ensureLoggedIn(ENV.email, ENV.password, ENV.loginUrl);

    const dashboard = new Dashboard(session.page);
    progress('dashboard', 'opening DANA overall dashboard');
    await dashboard.prepare();
    await session.saveSession();

    const report = new IncidentReport(args.task);
    const capturer = new ComparisonCapture(session.page);

    let currentBoard = 'DANA_Overall_Dashboard'; // prepare() opened this
    abortRequested = false;
    let stopped = false;
    try {
    for (const key of args.moduleList) {
      checkAbort();
      if (Date.now() - started > HARD_TIMEOUT_MS) throw new Error('capture exceeded 30 min, aborting');

      const cfg = { key, ...MODULES[key] };
      // Modules can live on different dashboards (dana_cicil → Command Center).
      // reset() is a plain reload, so it stays on the current board — switch
      // boards only when the next module needs a different one.
      const board = cfg.dashboard || 'DANA_Overall_Dashboard';
      if (board !== currentBoard) {
        progress('dashboard', `opening ${board}`);
        await dashboard.openDisplayBoard(board); // route-based; works in both directions
        await dashboard.escapeModals(); // the new board can land with its own modal
        currentBoard = board;
      }
      // Dev escape hatch: MODULE_CHART_OVERRIDE=bogus simulates a dead chart
      // (testing the CAPTURE FAILED path without waiting for a real outage).
      if (process.env.MODULE_CHART_OVERRIDE) cfg.dashboardItem = process.env.MODULE_CHART_OVERRIDE;
      const i = args.moduleList.indexOf(key) + 1;

      // Retention warning: some charts only keep a few days of queryable data
      // (va_topup ≈ 3 days) — baselines older than that return "no data".
      const retention = MODULES[key].retentionDays;
      const oldest = args.windowList.map((w) => w.from).sort()[0];
      const stale = retention && new Date(oldest) < new Date(Date.now() - retention * 86400000);
      if (stale) {
        console.log(
          `  [${key}] WARNING: baseline ${oldest} is older than this chart's ~${retention}-day data retention — expect "no data"`
        );
      }

      const captures = [];
      let lastError = null;

      for (let wi = 0; wi < args.windowList.length; wi++) {
        const entry = args.windowList[wi];
        progress(
          `module ${i}/${args.moduleList.length}`,
          `${cfg.dashboardItem} · window ${wi + 1}/${args.windowList.length} (${entry.from} vs ${entry.to} ${entry.start}–${entry.end})`
        );

        // Site queries 500 randomly and heavy full-day compares come back
        // "no data" (audit 2026-08-19) — retry the whole module until it has
        // data or attempts run out; keep the last (no-data) result for the report.
        let captured = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          checkAbort();
          try {
            progress(`module ${i}/${args.moduleList.length}`, `${cfg.dashboardItem} · window ${wi + 1} (attempt ${attempt})`);
            await dashboard.openChart(cfg.dashboardItem, { expectTabs: true });
            checkAbort();
            await dashboard.clickTab('Comparison View');
            checkAbort();
            captured = await capturer.capture(cfg, entry, `${wi}_${attempt - 1}`, report.dir);
            checkAbort();
            if (captured.hasData) break;
            lastError = captured.reason;
            progress(`module ${i}/${args.moduleList.length}`, `${cfg.dashboardItem}: ${captured.reason}, retrying`);
          } catch (e) {
            lastError = e.message;
            captured = null;
            console.log(`  [${key}] attempt ${attempt} failed: ${e.message}`);
          }
          if (attempt < 3) await dashboard.reset();
        }

        if (captured && captured.hasData) captures.push(captured);
        else {
          console.log(`  [${key}] window ${wi + 1} giving up after retries — recording failure`);
          captures.push(
            captured || {
              entry,
              value1: 0,
              value2: 0,
              percentageChange: 0,
              tableRows: [],
              screenshot: null,
              hasData: false,
              reason: lastError || 'capture failed',
            }
          );
        }
      }

      report.addModule(cfg, args.windowList[0], captures);
      if (key !== args.moduleList[args.moduleList.length - 1]) await dashboard.reset();
    }
    } catch (e) {
      // A user stop still writes what completed — the partial run is evidence.
      if (e.message !== 'capture stopped by user') throw e;
      stopped = true;
      console.log('  [stop] requested — writing partial report');
    }

    const out = report.write();
    pruneRuns();
    progress('saving', 'writing report / MySQL / webhook');
    const sink = new MysqlSink();
    await sink.flushPending();
    await sink.save(out.meta); // best-effort — queued on failure, never throws
    await sink.close();
    await notifyWebhook(out.meta);
    progress(stopped ? 'stopped' : 'done', out.dir);
    return { ...out, stopped };
  } finally {
    await session.close();
  }
}

// Keep the newest RETENTION_RUNS run dirs (default 50); 0 disables.
// Runs hold ~600KB each — without this, a daily cron grows forever.
export function pruneRuns(keep = parseInt(process.env.RETENTION_RUNS || '50', 10)) {
  if (!keep || !fs.existsSync(DATA_DIR)) return;
  const dirs = fs
    .readdirSync(DATA_DIR)
    .filter((d) => /^\w+_\d{4}-\d{2}-\d{2}T/.test(d))
    .sort();
  for (const d of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    fs.rmSync(path.join(DATA_DIR, d), { recursive: true, force: true });
    console.log(`pruned old run: ${d}`);
  }
}

// POST P1/P2 incidents and capture failures to WEBHOOK_URL (Slack-compatible
// JSON payload) and DINGTALK_WEBHOOK (DingTalk robot, markdown card with the
// findings as an inline CSV block — the robot API can't upload files).
// Silent no-op when unset.
export async function notifyWebhook(meta) {
  await Promise.all([notifySlackWebhook(meta), notifyDingtalk(meta)]);
}

async function notifySlackWebhook(meta) {
  const url = process.env.WEBHOOK_URL;
  if (!url) return;
  const findings = meta.summaries.filter(
    (s) => ['P1', 'P2', 'CAPTURE FAILED'].includes(s.incidentLevel)
  );
  if (!findings.length) return;
  const text = `[techrisk-capture] ${meta.task} @ ${meta.generatedAt}\n` +
    findings
      .map((s) => `• ${s.module}: ${s.incidentLevel} ${s.averagePercentage ?? ''}${s.reason ? ' — ' + s.reason : ''}`)
      .join('\n');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, findings }),
    });
    console.log(`webhook notified: ${res.status}`);
  } catch (e) {
    console.log(`webhook failed: ${e.message}`);
  }
}

// DingTalk custom robot: markdown card, keyword-filter compliant ("TR").
// Findings as a GFM table; failure reasons quoted below; deep link to the UI.
async function notifyDingtalk(meta) {
  const url = process.env.DINGTALK_WEBHOOK;
  if (!url) return;
  // any P-level + capture failures notify; only a fully clean run stays silent
  const findings = meta.summaries.filter((s) => s.incidentLevel !== 'No Incident');
  if (!findings.length) return;
  const worst = findings.reduce((w, s) => (LEVEL_ORDER[s.incidentLevel] > LEVEL_ORDER[w] ? s.incidentLevel : w), 'P4');
  const worstMod = findings.find((s) => s.incidentLevel === worst);
  const label = (m) => LABELS[m] || m;
  const when = new Date(meta.generatedAt).toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
  const win = worstMod.windows > 1 ? `${worstMod.windows} windows` : '1 window';
  const title = `TR alert · ${worst} ${label(worstMod.module)} — ${findings.length} finding${findings.length > 1 ? 's' : ''}`;
  const rows = findings.map((s) =>
    `| ${label(s.module)} | **${s.incidentLevel}** | ${s.averagePercentage ?? '—'}% | ${fmtDur(s.durationMinutes)} | ${s.entriesWithData ?? '—'}/${s.entriesWithDate ?? '—'} |`);
  const text = `### TR alert · ${worst}\n\n` +
    `${when} WIB · compared ${win} · worst: **${label(worstMod.module)} ${worstMod.averagePercentage ?? ''}${worstMod.averagePercentage != null ? '%' : ''} over ${fmtDur(worstMod.durationMinutes)}**\n\n` +
    '| Module | Level | Avg Δ | Duration | Data |\n|---|---|---:|---|---|\n' + rows.join('\n') + '\n' +
    findings.filter((s) => s.reason).map((s) => `\n> **${label(s.module)}**: ${s.reason}`).join('') +
    `\n\n**[→ Open dashboard](${process.env.PUBLIC_BASE_URL || 'http://localhost:8080'})**`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text } }),
    });
    const body = await res.json().catch(() => ({}));
    if (body.errcode) console.log(`dingtalk rejected: ${body.errcode} ${body.errmsg}`);
    else console.log('dingtalk notified');
  } catch (e) {
    console.log(`dingtalk failed: ${e.message}`);
  }
}
const LEVEL_ORDER = { P1: 6, 'CAPTURE FAILED': 5, P2: 4, P3: 3, P4: 2 }; // DingTalk worst-pick, UI convention
const LABELS = { trade_trends: 'Trade trends', cashout: 'Cashout', va_topup: 'VA topup', x2x: 'x2x',
                 hold_login: 'Hold Login', user_register: 'User Register', dana_cicil: 'DANA Cicil' };
const fmtDur = (m) => m == null ? '—' : m >= 1440 ? `${(m / 1440).toFixed(1)}d` : m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`;

// CLI entry
const isCli = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Capture: modules=${args.moduleList.join(',')} ${args.from} vs ${args.to} ${args.start}-${args.end}`);
  runCapture(args)
    .then((out) => {
      console.log(`\nDone. Output in ${out.dir}`);
      // cron signal: report exists but nothing was captured
      if (out.meta.summaries.length > 0 && out.meta.summaries.every((s) => s.incidentLevel === 'CAPTURE FAILED')) {
        process.exitCode = 1;
      }
    })
    .catch((e) => {
      console.error(`FAILED: ${e.message}`);
      process.exit(1);
    });
}
