import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { runCapture } from './main.js';
import { parseArgs, DATA_DIR, MODULES } from './config.js';
import { MysqlSink } from './mysql-sink.js';

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
  '.js': 'text/javascript',
  '.css': 'text/css',
};

// Vendored CSS should be cacheable — it's the page's biggest asset.
const CACHEABLE = new Set(['.css', '.js', '.png']);

let running = false;
let lastRun = { finishedAt: null, ok: null, error: null };
let currentRun = null; // { startedAt, args, moduleList, steps: [{at, step, detail}] }

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
    for (const dir of fs
      .readdirSync(OUTPUT_ROOT)
      .filter((d) => fs.existsSync(path.join(OUTPUT_ROOT, d, 'incidents.json')))
      .sort()
      .reverse()) {
      const meta = JSON.parse(fs.readFileSync(path.join(OUTPUT_ROOT, dir, 'incidents.json'), 'utf-8'));
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

    if (url.pathname.startsWith('/api/runs/')) {
      return serveFile(res, OUTPUT_ROOT, url.pathname.replace('/api/runs', '') + '/incidents.json');
    }

    if (route === 'POST /api/capture') {
      if (running) return json(res, 409, { error: 'capture already running' });
      running = true;
      console.log(`[api] capture triggered: ${url.search}`);
      const args = parseArgs((url.searchParams.get('args') || '').split(/\s+/).filter(Boolean));
      currentRun = { startedAt: new Date().toISOString(), args, steps: [] };
      broadcast('run-started', { startedAt: currentRun.startedAt, args });
      json(res, 202, { started: true, args });
      // Fire and forget — live progress streams over /api/events.
      runCapture(args, {
        onProgress: (p) => {
          currentRun?.steps.push({ at: p.at, step: p.step, detail: p.detail });
          broadcast('progress', p);
        },
      })
        .then((out) => {
          lastRun = { finishedAt: new Date().toISOString(), ok: true, dir: out.dir };
          broadcast('run-finished', { ok: true, dir: out.dir });
        })
        .catch((e) => {
          lastRun = { finishedAt: new Date().toISOString(), ok: false, error: e.message };
          broadcast('run-finished', { ok: false, error: e.message });
        })
        .finally(() => {
          running = false;
          currentRun = null;
        });
      return;
    }

    if (route === 'GET /api/modules') {
      // Single source of truth: the form chips and the Module filter render from this.
      return json(res, 200, Object.keys(MODULES).map((m) =>
        ({ name: m, retentionDays: MODULES[m].retentionDays ?? null })));
    }

    if (route === 'GET /api/status') {
      return json(res, 200, {
        running,
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
    if (running || lastFired === today) return;
    if (now.getHours() !== h || now.getMinutes() !== m) return;
    lastFired = today;
    console.log(`[scheduler] starting daily capture: ${process.env.CAPTURE_ARGS || '--modules all'}`);
    running = true;
    runCapture(parseArgs((process.env.CAPTURE_ARGS || '--modules all').split(/\s+/)))
      .then((out) => (lastRun = { finishedAt: new Date().toISOString(), ok: true, dir: out.dir }))
      .catch((e) => (lastRun = { finishedAt: new Date().toISOString(), ok: false, error: e.message }))
      .finally(() => (running = false));
  }, 20000);
}
