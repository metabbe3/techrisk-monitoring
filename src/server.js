import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { runCapture, requestAbort } from './main.js';
import { parseArgs, DATA_DIR, MODULES } from './config.js';
import { MysqlSink } from './mysql-sink.js';
import yazl from 'yazl';

// The data directory IS the database: each run dir holds incidents.json,
// report.csv and screenshots. This server lists/serves them and can trigger a
// capture run in-process.

const PORT = process.env.PORT || 8080;
const OUTPUT_ROOT = path.resolve(DATA_DIR);
const WEB_ROOT = path.resolve('web');
const API_TOKEN = process.env.API_TOKEN || null; // set to require ?token= / X-API-Token

const MIME = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript',
  '.css': 'text/css',
};

// Vendored CSS should be cacheable — it's the page's biggest asset.
const CACHEABLE = new Set(['.css', '.js', '.png']);

let running = false;
let lastRun = { finishedAt: null, ok: null, error: null };
let currentRun = null; // { startedAt, args, moduleList, steps: [{at, step, detail}] }

// One browser, one session — captures can only run one at a time. Requests
// that arrive mid-run queue FIFO instead of being rejected; drain() starts
// the next as each run finishes.
const queue = []; // { args, enqueuedAt }
const MAX_QUEUE = 20;

function startQueuedRun(job) {
  running = true;
  currentRun = { startedAt: new Date().toISOString(), args: job.args, steps: [] };
  broadcast('run-started', { startedAt: currentRun.startedAt, args: job.args });
  console.log(`[api] capture starting (${queue.length} queued behind): ${job.args.moduleList}`);
  runCapture(job.args, {
    onProgress: (p) => {
      currentRun?.steps.push({ at: p.at, step: p.step, detail: p.detail });
      broadcast('progress', p);
    },
  })
    .then((out) => {
      lastRun = { finishedAt: new Date().toISOString(), ok: !out.stopped, dir: out.dir };
      broadcast('run-finished', { ok: !out.stopped, stopped: !!out.stopped, dir: out.dir });
    })
    .catch((e) => {
      lastRun = { finishedAt: new Date().toISOString(), ok: false, error: e.message };
      broadcast('run-finished', { ok: false, error: e.message });
    })
    .finally(() => {
      running = false;
      currentRun = null;
      drain();
    });
}

function drain() {
  if (running || queue.length === 0) return;
  const job = queue.shift();
  try {
    startQueuedRun(job);
  } catch (e) {
    // runCapture threw synchronously (never returned a promise) — record it
    // and keep the queue flowing instead of freezing `running` forever.
    lastRun = { finishedAt: new Date().toISOString(), ok: false, error: e.message };
    broadcast('run-finished', { ok: false, error: e.message });
    drain();
  }
}

// Live updates via Server-Sent Events — the UI never needs a manual refresh.
const sseClients = new Set();
const HEARTBEAT = setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n');
}, 15000);
HEARTBEAT.unref();

function broadcast(type, data = {}) {
  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

const json = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// Runs are immutable once written — cache the parsed incidents.json keyed on
// mtime so each /api/runs request doesn't re-read every retained run's
// (tableRows-embedding, large) JSON. Corrupt files are skipped, not fatal.
const runCache = new Map(); // dir → { mtimeMs, meta }
function loadRunMeta(dir) {
  const file = path.join(OUTPUT_ROOT, dir, 'incidents.json');
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    runCache.delete(dir);
    return null; // not a run dir (no incidents.json)
  }
  const hit = runCache.get(dir);
  if (hit && hit.mtimeMs === mtimeMs) return hit.meta;
  try {
    const meta = JSON.parse(fs.readFileSync(file, 'utf-8'));
    runCache.set(dir, { mtimeMs, meta });
    return meta;
  } catch (e) {
    console.log(`[api] skipping unreadable run ${dir}: ${e.message}`);
    return null;
  }
}

function listRuns() {
  const runs = [];
  // The in-flight capture is part of the list (marked running) — refreshing
  // the page mid-capture must not make it disappear.
  if (currentRun) {
    const last = currentRun.steps.at(-1);
    runs.push({
      dir: null,
      task: currentRun.args.task,
      running: true,
      startedAt: currentRun.startedAt,
      generatedAt: currentRun.startedAt,
      progress: { step: last?.step, detail: last?.detail, at: last?.at, steps: currentRun.steps.slice(-12) },
      entries: {
        from: currentRun.args.from,
        to: currentRun.args.to,
        start: currentRun.args.start,
        end: currentRun.args.end,
        windows: currentRun.args.windowList,
        modules: currentRun.args.moduleList,
      },
      summaries: currentRun.args.moduleList.map((m) => ({ module: m, incidentLevel: 'RUNNING', averagePercentage: null, durationMinutes: null, entriesWithData: 0, entriesWithDate: 0, reason: 'in progress' })),
    });
  }
  if (fs.existsSync(OUTPUT_ROOT)) {
    for (const dir of fs.readdirSync(OUTPUT_ROOT).sort().reverse()) {
      const meta = loadRunMeta(dir);
      if (!meta) continue;
      const windows = meta.results?.map((r) => r.entry) || [];
      runs.push({
        dir,
        task: meta.task,
        generatedAt: meta.generatedAt,
        running: false,
        entries: {
          ...(windows[0] || {}),
          modules: [...new Set(meta.results?.map((r) => r.module) || [])],
          windows: [...new Map(windows.map((w) => [`${w.from}${w.to}${w.start}${w.end}`, w])).values()],
        },
        summaries: meta.summaries?.map(({ rules, ...s }) => s) || [],
      });
    }
  }
  return runs;
}

function serveFile(res, root, relPath) {
  const file = path.resolve(root, '.' + relPath);
  if (!file.startsWith(root)) return json(res, 403, { error: 'forbidden' }); // traversal guard
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not found' });
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // reports download instead of opening inline; images stay inline
    ...( ['.csv', '.json'].includes(ext) ? { 'Content-Disposition': `attachment; filename="${path.basename(file)}"` } : {}),
    ...(CACHEABLE.has(ext) ? { 'Cache-Control': 'public, max-age=86400' } : {}),
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;

  // Token gate: static UI passes; everything else needs the token when set.
  if (API_TOKEN && route !== 'GET /' && !route.startsWith('GET /ui')) {
    const token = url.searchParams.get('token') || req.headers['x-api-token'];
    if (token !== API_TOKEN) return json(res, 401, { error: 'unauthorized' });
  }

  try {
    if (route === 'GET /api/runs') return json(res, 200, listRuns());

    if (req.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
      return serveFile(res, OUTPUT_ROOT, url.pathname.replace('/api/runs', '') + '/incidents.json');
    }

    // Backup: one ZIP of everything (screenshots + incidents.json + report.csv)
    // for a date range — the archival answer to pruneRuns deleting old runs.
    // Runs are picked by the UTC date embedded in the dir name; incidents.json
    // presence marks a completed run (in-flight captures and audit dirs are
    // skipped), so the ZIP holds exactly the runs /api/runs lists.
    if (route === 'GET /api/backup') {
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      if ((from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) || (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)))
        return json(res, 400, { error: 'invalid date — use YYYY-MM-DD' });
      // Snapshot before writeHead: any throw here still answers as JSON.
      const picked = [];
      if (fs.existsSync(OUTPUT_ROOT)) {
        for (const dir of fs.readdirSync(OUTPUT_ROOT).sort()) {
          const date = dir.match(/^[A-Za-z0-9_.-]+_(\d{4}-\d{2}-\d{2})T/)?.[1];
          if (!date || (from && date < from) || (to && date > to)) continue;
          if (!fs.existsSync(path.join(OUTPUT_ROOT, dir, 'incidents.json'))) continue;
          picked.push({ dir, date });
        }
      }
      if (picked.length === 0) return json(res, 404, { error: 'no runs in this date range' });
      const zip = new yazl.ZipFile();
      for (const { dir } of picked) {
        for (const f of fs.readdirSync(path.join(OUTPUT_ROOT, dir), { withFileTypes: true })) {
          if (f.isFile()) zip.addFile(path.join(OUTPUT_ROOT, dir, f.name), `${dir}/${f.name}`);
        }
      }
      const name = `techrisk-backup_${from || picked[0].date}_to_${to || picked.at(-1).date}.zip`;
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"` });
      // A dir vanishing mid-stream (prune/delete race) kills the response —
      // the UI's retry feedback covers it; no partial archive.
      zip.on('error', () => res.destroy());
      zip.outputStream.on('error', () => res.destroy());
      zip.end();
      zip.outputStream.pipe(res);
      console.log(`[api] backup zip: ${picked.length} runs (${name})`);
      return;
    }

    if (route === 'POST /api/capture') {
      if (queue.length >= MAX_QUEUE) return json(res, 429, { error: `queue full (${MAX_QUEUE} waiting) — try again later` });
      const args = parseArgs((url.searchParams.get('args') || '').split(/\s+/).filter(Boolean));
      const startedNow = !running; // drain() below starts it immediately when idle
      queue.push({ args, enqueuedAt: new Date().toISOString() });
      console.log(`[api] capture requested: ${url.search} (queue: ${queue.length})`);
      drain();
      json(res, 202, { started: true, queued: startedNow ? 0 : queue.length });
      return;
    }

    // Stop the in-flight capture — it unwinds at the next loop boundary
    // (between modules/window attempts); completed modules stay on disk.
    if (route === 'POST /api/capture/stop') {
      if (!running) return json(res, 409, { error: 'no capture running' });
      console.log('[api] stop requested — finishing current step');
      requestAbort();
      return json(res, 202, { stopping: true });
    }

    // Delete a stored run (screenshots + CSV + JSON). Refused mid-capture: the
    // running capture writes into its own new dir, but a stop-then-delete in
    // one breath is the honest order.
    if (route.startsWith('DELETE /api/runs/')) {
      if (running) return json(res, 409, { error: 'a capture is running — stop it first' });
      const dir = decodeURIComponent(url.pathname.replace('/api/runs/', ''));
      if (!/^[A-Za-z0-9_.-]+$/.test(dir)) return json(res, 400, { error: 'invalid run dir' });
      const target = path.join(OUTPUT_ROOT, dir);
      if (!fs.existsSync(target)) return json(res, 404, { error: 'run not found' });
      fs.rmSync(target, { recursive: true, force: true });
      runCache.delete(dir);
      console.log(`[api] deleted run ${dir}`);
      return json(res, 200, { deleted: dir });
    }

    if (route === 'GET /api/modules') {
      // Single source of truth: the form chips, the Module filter, and the
      // P-levels legend all render from this — rules included, so the legend
      // can never drift from the classifier.
      return json(res, 200, Object.keys(MODULES).map((m) =>
        ({ name: m, retentionDays: MODULES[m].retentionDays ?? null, rules: MODULES[m].rules ?? null })));
    }

    if (route === 'GET /api/status') {
      return json(res, 200, {
        running,
        queueLength: queue.length,
        ...(currentRun
          ? { progress: currentRun.steps.at(-1), startedAt: currentRun.startedAt, args: currentRun.args }
          : {}),
        ...lastRun,
      });
    }

    if (route === 'GET /api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write('retry: 5000\n\n');
      if (currentRun) {
        // late joiner: catch it up on the current run
        res.write(`event: run-started\ndata: ${JSON.stringify({ startedAt: currentRun.startedAt, args: currentRun.args })}\n\n`);
        for (const s of currentRun.steps.slice(-30)) {
          res.write(`event: progress\ndata: ${JSON.stringify(s)}\n\n`);
        }
      }
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (url.pathname.startsWith('/output/')) {
      return serveFile(res, OUTPUT_ROOT, url.pathname.replace('/output', ''));
    }

    // Static web viewer ( / or /index.html )
    return serveFile(res, WEB_ROOT, url.pathname === '/' ? '/index.html' : url.pathname);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`techrisk-capture UI on http://localhost:${PORT}`));

// Graceful stop (docker stop / instance reboot sends SIGTERM): close the HTTP
// server, give in-flight requests 3s, then exit. An active capture's chromium
// is a child of this process and dies with it; `init: true` in compose reaps
// anything left — no ghost browsers.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`received ${sig} — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

// Retry any capture rows that couldn't reach MySQL during earlier runs.
const sink = new MysqlSink();
if (sink.enabled) sink.flushPending();

// Self-contained daily schedule — no host cron needed on the server.
// CAPTURE_DAILY_AT=HH:MM (container-local time; set TZ=Asia/Jakarta),
// CAPTURE_ARGS passes CLI flags (default "--modules all").
const DAILY_AT = process.env.CAPTURE_DAILY_AT;
if (DAILY_AT) {
  const [h, m] = DAILY_AT.split(':').map(Number);
  let lastFired = null;
  console.log(`scheduler: daily capture at ${DAILY_AT} (TZ=${process.env.TZ || 'system'})`);
  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (running || queue.length > 0 || lastFired === today) return; // don't jump queued manual runs
    if (now.getHours() !== h || now.getMinutes() !== m) return;
    lastFired = today;
    console.log(`[scheduler] starting daily capture: ${process.env.CAPTURE_ARGS || '--modules all'}`);
    // Through the same queue as manual runs — the scheduled capture gets the
    // running card, progress log and SSE events like any other.
    queue.push({ args: parseArgs((process.env.CAPTURE_ARGS || '--modules all').split(/\s+/)), enqueuedAt: new Date().toISOString() });
    drain();
  }, 20000);
}
