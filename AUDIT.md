# Live E2E Audit — DANA Optimus (2026-08-19)

Full walk of every flow with instrumented browser: login → landing → dashboard →
all 4 module charts → comparison form → popup table → close → reset, ×2 rounds,
route-blocking OFF (true site speed). Raw data: `output/audit_*/audit-report.json`,
screenshots alongside.

## Verdict

**All our selectors are correct.** The instability is the site itself. Three
site-side bugs + one bug in our code (now fixed).

## Findings

### S1 — Chart detail randomly fails to open (the "not showing" bug) — SITE
Clicking a chart title navigates to `#/STZEYPCN/prod/overview/shotcuts/cms/21`,
but the detail view (the part with `fc-tab-item` tabs + Comparison form) only
renders if the site's data query succeeds. Evidence:
- Same module, same selectors, different outcome per round:
  - `trade_trends`: round 1 **fail** → round 2 **ok**
  - `va_topup`: **fail both rounds** (0/2)
  - `cashout`, `x2x`: ok both rounds
- Console: `Query Error query minute ds fail, query fail, status code: 500`
- Page errors: `TypeError: Cannot read properties of undefined (reading 'chart')` ×3 —
  their chart JS crashes when data is missing, detail never renders.

**Fix (ours): `Dashboard.openChart(title, { expectTabs: true })`** — after the
click, verify `fc-tab-item` appeared within 20s; if not, reload and re-click,
up to 3 attempts. Plus module-level retry (×2) in `main.js`. When all retries
fail we record a no-data entry instead of crashing the run.

### S2 — Site rewrites its own URL (the "refresh/different page" bug) — SITE
Right after load, the SPA re-navigates 2–3 times, at one point producing a
**doubled `workspaceName` param**:
```
...overview?workspaceName=prod&tenantName=STZEYPCN
...overview?workspaceName=prod&workspaceName=prod&tenantName=...
...overview?tenantName=STZEYPCN&workspaceName=prod
```
Each rewrite re-renders the page and aborts in-flight `universalQuery` calls
(many `net::ERR_ABORTED`). Interacting during the bounce = clicks lost on a
page that's about to be replaced.

**Fix (ours): `Dashboard.#waitForUrlSettled()`** — wait until the URL no longer
contains the doubled param before any interaction after login/reload.

### S3 — Backend queries are slow — SITE
`monitor.paas.dana.id/.../universalQuery` takes **16–18 s per call**, several
per page. Nothing to fix client-side; expect ~20–40 s per chart open. Our
mitigations: route-blocking (images/fonts/analytics) in capture mode, hard
30-min run timeout, retries instead of infinite waits.

### S4 — Site JS brokenness (cosmetic but noisy) — SITE
- `ReferenceError: regeneratorRuntime is not defined` (missing polyfill in their bundle)
- `document.domain mutation is ignored` warnings ×many
- `kcart.alipay.com` analytics beacon (aborted by our route-blocking in capture mode)

### C1 — `openChart` clicked blind — OURS (fixed)
Old code clicked the title and returned without checking the destination, so a
failed detail silently poisoned every later step (tab, form, popup all fail,
each burning its full timeout — 15s+15s per broken module). Now: verify +
reload + retry, and fail fast with a clear message.

### C2 — Selector drift, minor — OURS (fixed)
`h3.chart-title span` returns **0 matches** on today's DOM — chart titles are
bare `span[ng-click='click();']` (8 visible). Chain reordered (winner first),
legacy kept as last fallback. New `DASHBOARD.detailTabs` added as the
"detail is open" signal.

### C3 — Workspace modal wasted 10–16 s per run — OURS (fixed)
The workspace-selection modal never appears when `LOGIN_URL` carries
`tenantName`/`workspaceName` (audited: both modal variants 0 matches), but we
still burned 10 s waiting for variant 1 + 6 s looping variant 2. Now one
combined 4 s wait, full handling kept if a modal does appear.

## Selector winners on today's DOM (all verified live)

| Purpose | Winner | Note |
|---|---|---|
| login email | `.login-form-cnt input[ng-model]` (2 vis) | password field is separate, see next |
| login password | `.login-form-cnt input[type="password"]` | 1 vis |
| login submit | `.login-form-cnt button` | 1 vis |
| chart title | `span[ng-click='click();']` | 8 vis; `h3.chart-title span` = 0 (dead) |
| detail tabs | `fc-tab-item` | 2 vis on detail, 0 on dashboard — good signal |
| compare form | `input[ng-model="queryInfo.day1"]` etc. | all 4 + `button[ng-click="compare()"]` live |
| popup link | `.xf-pop-up-container h3 a` | 1 vis |
| workspace modals | none present | bypassed via tenant URL params |

## Timing (route-blocking OFF, true site speed)

| Step | Measured |
|---|---|
| login page load | 1.9 s |
| fill + submit + land | 3.5 s |
| dashboard prepare (old code) | 16.2 s → **~4 s** after C3 fix |
| chart open (success) | 1.5–7.6 s |
| broken module (old code, all timeouts) | ~22 s wasted → now fails fast |
| popup + table extract | 0.65–0.93 s |
| session reuse check | 1.6 s — **session survives the full run** |

## Login notes

- No OTP/captcha in this flow; credentials from `.env` work.
- Old session file from May was dead; fresh login landed directly on
  `monitor.paas.dana.id` — **goto-recovery not needed this time** (kept as
  safety net for the days it is).
- Popups/new tabs: **0** across the whole audit. The "opens other pages"
  symptom is S2's intra-page re-navigations, not real popups.

## Re-validation (after fixes)

**Audit re-run** (`audit2.log`): every module now opens its chart detail
(open-chart ✓ ×8, including `va_topup` which was 0/2 before). Remaining
failures moved downstream: `popup+table` timing out at 15s — the compare
`universalQuery` now takes longer than the May-era wait. → table wait raised
to 45s.

**Real capture run** (`HEADLESS=false node src/main.js --modules all`,
2026-08-19 ~16:13) — **all 4 modules green, first try, with retries doing
their job**:

```
[openChart] "Trade Trends Acquiring" detail did not render (attempt 1/3) — reloading and retrying   ← verify+retry fired and recovered
trade_trends  3,015,294 → 2,874,659  (-4.66%)  → P3
cashout         292,907 →   276,701  (-5.53%)  → P3
va_topup        452,826 →   432,046  (-4.59%)  → P3   ← was 0/2 in audit round 1
x2x           1,072,840 → 1,026,157  (-4.35%)  → P3
4/4 with data, 4/4 screenshots, report.csv + incidents.json written
```

**Data caveat (not a bug):** default `--from yesterday --to today` compares a
full day against a *partial* day (today up to now), so intraday runs always
show a deficit. For incident monitoring, compare two complete days:
`--from 2026-08-17 --to 2026-08-18` (cron after midnight does this
naturally with the two-day-ago/yesterday pair).

## Docker + headless validation (2026-08-19, colima aarch64)

First-ever execution of the Docker path. Results:

**Works first try:** build, headless Chromium rendering (screenshots identical
quality to headful native), session portability (native-created
`sessions/state.json` valid inside the container — login skipped), virtiofs
bind mounts (`output/`, `sessions/` land on host), identical numbers to native
for the same window (4,015,753 → 3,911,156, -2.60%).

**Bugs found & fixed:**

- **D1 — port collision (compose).** Web service defaulted to host port 8080,
  which is occupied by a long-lived ssh tunnel on the dev machine → container
  failed to start (`Bind for :::8080 failed`). Fixed: `"${WEB_PORT:-8787}:8080"`.
- **D2 — "no data" invisible to retries (code).** `capturer.capture()` returned
  normally when the site rendered its literal "no data" state (screenshot
  evidence), so the module retry loop never engaged — the run recorded a
  failure without ever retrying. Fixed: no-data now (a) detects the site's
  "no data" message and names it in the reason, (b) feeds back into the module
  retry loop (up to 3 attempts).
- **D3 — table wait still too short for heavy queries.** Full-day compares
  (00:00–23:59 both dates) exceed the 45s table wait when the site is loaded;
  window compares (e.g. 12:00–13:15) never did. Fixed: default 90s, env-tunable
  `CAPTURE_TABLE_TIMEOUT_MS`.

**Site behavior under load (documented, not fixable):** failures cluster in
time — one run had cashout fail all 3 attempts (2× 90s timeouts + no-data)
while another run's cashout succeeded first-try with -5.71%. Window compares
(≤ a few hours) are consistently reliable; full-day compares are the flaky
ones. Worst-case module cost: 3 attempts × 90s ≈ 5 min (30-min run cap holds).

**Verified in-container:** `POST /api/capture` trigger works (runs in-process
in the web container, session shared via volume), `/api/runs` + screenshot
static serving + UI all green on the mapped port.

## Second-dashboard navigation (dana_cicil, audited 2026-08-20)

The Command Center board (`DANA_Command_Center_FULL_Display`) is a *display*
page, not a chart on the overall board. Three site behaviors found:

- **S4 — leftover top-level modal intercepts clicks (SITE).** After a board
  switch the page can land with a `div.modal.top` + backdrop that swallows
  every click (30s click timeouts). Fix (ours): `Dashboard.escapeModals()` —
  up to 3× Escape when a backdrop is visible, before interacting.
- **S5 — direct `/display/<board>` boot can render an empty shell (SITE).**
  Navigating (or reloading) straight into `#/tenant/ws/display/<board>` from
  inside a board page sometimes boots the SPA to header-only: no tiles, no
  body content. Fix (ours): `openDisplayBoard()` routes via the clean
  `overview/overview` page first, then hops to the display route — that path
  rendered tiles in every attempt.
- **S6 — hash-only reroute swaps the tile list late (SITE).** After the
  hash-only navigation, `networkidle` passes before the display tiles render.
  Fix (ours): `waitForFunction` on the tile text itself (30s), then click.

Also recorded: the CICIL popup lists 9 metric rows per date; the policy's
"payment success" row is spelled `PaymentSucccess` by the site — `rowFilter`
pins it (the default last-two-rows heuristic would compare RefundApply vs
RefundQueryApply on the same day).
