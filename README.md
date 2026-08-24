# techrisk-capture

Automated incident capture from the DANA Optimus monitor (`monitor.paas.dana.id/optimus`).
Logs in, opens each dashboard chart's **Comparison View**, scrapes the day-over-day
stats, classifies drops (P1–P4), saves screenshots + CSV/JSON, and serves a small
web UI + API to view results and trigger runs.

Rewrite of `techrisk-monitoring` — same proven selectors and flows, minus the
Express/SQLite task queue. Plain ESM JavaScript, two dependencies (`playwright`,
`dotenv`), no build step.

## Quick start (local, fast)

```bash
npm install
npx playwright install chromium
cp .env.example .env       # fill in LOGIN_EMAIL / LOGIN_PASSWORD
npm run selftest           # checks aggregation + P1-P4 logic

# First run — watch it work and log in:
HEADLESS=false npm run capture -- --modules all

# Later runs (session cookie reused, headless, cron-friendly):
npm run capture -- --modules trade_trends,cashout --from 2026-08-18 --to 2026-08-19 --start 00:00:00 --end 23:59:59
```

Defaults: all modules, yesterday vs today, 00:00:00–23:59:59.

**Comparing the same time window on two dates** (the usual incident workflow —
e.g. 18 Aug 12:00–13:15 vs 11 Aug 12:00–13:15):

```bash
npm run capture -- --modules trade_trends --from 2026-08-11 --to 2026-08-18 --start 12:00:00 --end 13:15:00
```

`--from`/`--to` are the two dates (baseline day first), `--start`/`--end` apply
the same time window to both. Percentage = change on the `--to` date vs the
`--from` date; duration for P-levels = the window length (75 min here).

**Multiple windows** (several drops in one day, or an incident crossing
midnight — the site caps at 23:59:59, so add the next day as its own window):

```bash
npm run capture -- --modules trade_trends \
  --window 2026-08-11,2026-08-17,00:00:00,01:00:00 \
  --window 2026-08-11,2026-08-17,02:00:00,03:00:00 \
  --window 2026-08-12,2026-08-18,00:00:00,01:00:00
```

Each `--window` is `FROM,TO,START,END` (own date pair + own hours — mixing
date pairs is fine). The web form has add/remove window rows for this.
Aggregation across windows: **worst window sets the level, durations add up**
(two 1-hour drops = 120 min incident), average % across windows with data.

**Per-module data retention**: some Optimus charts only keep a few days of
queryable history (`va_topup` ≈ 3 days — baselines older return "no data").
Configured per module as `retentionDays` in `src/config.js`; a baseline older
than that prints a warning before the capture runs.

## What happens when the site crashes / shows nothing

The Optimus backend randomly 500s and sometimes fails to render a chart at all
(see `AUDIT.md`). Handling, layer by layer:

| Failure | What happens |
|---|---|
| Chart detail doesn't render | detected (no tabs) → page reload + re-click, ×3 |
| Whole module keeps failing | module-level retry ×2 |
| Still failing after retries | module recorded as **`CAPTURE FAILED`** with the reason (never "No Incident" — a dead capture is not a healthy day); run continues with the next module, report is still written |
| Popup/table empty (query returned nothing) | screenshot of the empty state + `CAPTURE FAILED` / no-data reason |
| Session expires mid-run | steps fail → module marked `CAPTURE FAILED`; next run re-logins automatically |
| Browser/process crash | process exits non-zero; cron sees the failure; partial `output/` (screenshots) remain on disk |

```bash
# simulate a dead chart without waiting for a real outage:
MODULE_CHART_OVERRIDE=bogus npm run capture -- --modules trade_trends
```

## Where your data lives (never temp)

| Path | Content |
|---|---|
| `output/<task>_<timestamp>/` | `report.csv`, `incidents.json`, one PNG per module (~600KB/run) |
| `sessions/state.json` | auth session (reused until the site expires it) |

Native runs write into the project folder; Docker bind-mounts the same dirs to
the host (`docker-compose.yml` volumes). To pin storage to an absolute server
path: `DATA_DIR=/var/lib/techrisk` (mount it in compose). Old runs are pruned
automatically — newest `RETENTION_RUNS` kept (default 50, `0` = keep forever).

## Ops features (all optional env)

- **MySQL index** (`MYSQL_HOST=...` + `MYSQL_PORT/USER/PASSWORD/DATABASE`) — every
  run writes one row per module into `incident_captures` (level, %, values,
  window, screenshot path, full JSON payload) in the techrisk-dashboard DB, so
  the website can query history/trends and later link rows to `incidents.no`.
  Crash-isolated: files remain the source of truth; if MySQL is unreachable the
  rows queue in `output/.mysql-pending.log` and auto-flush on the next run —
  a DB outage can't fail a capture, and a capture can't stall the website
  (pool of 1, 5s connect timeout, single batched insert). `CAPTURE FAILED` runs
  are stored as rows too, so gaps are visible, not silent.
- `WEBHOOK_URL=...` — POST on **P1 / P2 / CAPTURE FAILED** (Slack-compatible `{text, findings}`)
- `API_TOKEN=...` — UI/API require `?token=` or `X-API-Token` header (UI prompts once)
- `CAPTURE_DAILY_AT=07:05` + `CAPTURE_ARGS="--modules all"` + `TZ=Asia/Jakarta` —
  the web container runs the capture itself every day; **no host cron needed**:
  `docker compose up -d web` is then the entire server deployment.
  Duration (and the 6 h/12 h escalations) always follow the searched window — the
  default window is the full day, so narrow it via `--start/--end` (or `--window`)
  in `CAPTURE_ARGS` if full-day scheduled runs over-badge small drops
- `CAPTURE_TABLE_TIMEOUT_MS=90000`, `WEB_PORT=8080`, `RETENTION_RUNS=50`

## Web UI + API (TechRisk Monitor)

```bash
npm run server            # or: node src/server.js   → http://localhost:8080
```

Single-file dashboard, hand-rolled CSS — no dependencies, no build step:
request-capture form (modules + windows, inline validation), re-run from
history, filters kept in the URL, live status pill, run history with
per-module P-level badges, screenshot gallery with lightbox zoom. Screenshot your own UI any time: `node src/snap-ui.js [url] [token]`.

- `GET  /api/runs` — list all runs with per-module incident summaries
- `GET  /api/runs/<dir>` — full incidents.json for a run
- `POST /api/capture?args=--modules all --from 2026-08-18 --to 2026-08-19` — trigger a run
- `GET  /api/status` — running / last result
- `/output/...` — screenshots + CSV (what the UI displays)

## Old Linux server (Docker)

Modern Chromium needs glibc ≥ 2.28, so native won't work there — but Docker
overhead is near zero once `shm_size` and route blocking are set (both already
configured; the site itself is the bottleneck).

```bash
docker compose build
docker compose run --rm capture --modules all        # one-shot capture
docker compose up -d web                              # always-on UI + trigger → http://localhost:8080
```

Or the one-shot installer — checks Docker, prepares `.env` and the dashboard
network, builds, starts, and waits for health:

```bash
bash install.sh                                      # → http://localhost:8080
```

The `web` service has `restart: unless-stopped` (auto-starts after an instance
reboot or Docker restart), `init: true` (reaps chromium — no ghost browsers if
a capture is killed), and a healthcheck on `/api/modules`. `WEB_PORT` overrides
the host port (default 8080). Validated on colima (arm64): the session file
moves between native and container runs freely. Slower site moments can be
tuned with `CAPTURE_TABLE_TIMEOUT_MS` (default 90000).

Cron (every hour, keep logs):

```
0 * * * * cd /opt/techrisk-capture && docker compose run --rm capture --modules all >> cron.log 2>&1
```

## Finding selectors when the site changes

```bash
npm run inspect
```

Opens a **visible** browser with your saved session. Click any element and the
terminal prints a robust selector (`ng-model` / id / unique class). Paste it
into `src/selectors.js` — that file is the single source of truth for every
selector; nothing else hardcodes them.

## Layout

| File | Role |
|---|---|
| `src/selectors.js` | every DOM selector (fallback chains, edit here first) |
| `src/config.js` | module configs + P1–P4 rules + CLI/env parsing |
| `src/analytics.js` | pure logic: aggregation, % change, incident level (`npm run selftest`) |
| `src/browser.js` | `BrowserSession` — launch, route blocking, session persistence |
| `src/auth.js` | `AuthService` — login, session detection, wrong-redirect recovery |
| `src/dashboard.js` | `Dashboard` — tz/locale cookies, workspace modal, chart/tab navigation |
| `src/capture.js` | `ComparisonCapture` — form fill, table scrape, screenshot |
| `src/report.js` | `IncidentReport` — classification, CSV + JSON output |
| `src/main.js` | orchestration + CLI (`runCapture` exported for the server) |
| `src/server.js` | stdlib `http` API + static viewer (no Express) |
| `src/inspect.js` | live selector finder |

## Robustness notes

The site is slow and sometimes misbehaves; every pattern below came from the
old project's battle log:

- Selector **fallback chains** — resilient selector first, proven-fragile path last
- **Retry + reload** on every navigation step
- Post-login redirect recovery via the `goto=` URL param
- Images/fonts/analytics **blocked at the network level** (biggest speed win)
- Login lands once, cookies persisted to `sessions/state.json` and reused until
  the site bounces us back to auth
- Hard 30-minute timeout so a hung run can't spin forever
