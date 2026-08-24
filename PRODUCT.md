# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: the **on-call responder**. Opens the TechRisk Monitor dashboard reactively, under time pressure, when something may have broken — needs the current worst P-level and the evidence behind it fast. (Confirmed in interview, 2026-08-20.) Secondary: the engineer operating the capture pipeline (CLI, scheduler, MySQL sink).

## Product Purpose

techrisk-capture automates incident capture from the DANA Optimus monitor (`monitor.paas.dana.id/optimus`). It logs in with Playwright, opens each dashboard chart's Comparison View, scrapes day-over-day stats, classifies drops as P1–P4, saves screenshots + CSV/JSON per run, and serves a small web UI + API (`web/index.html`, `src/server.js`) to view results and trigger runs. Success: when a module drops, the on-call responder can see the level, the numbers, and the captured chart — without logging into Optimus and squinting.

## Positioning

**Evidence capture.** The differentiator is the auditable record: scheduled screenshots + CSV per module — what the charts actually showed, on the record — not just scraped numbers or an alert. (Confirmed in interview; auto-classification and window comparison are supporting machinery, not the core claim.)

## Operating Context

- Capture runs: on demand from the UI/CLI, or scheduled (`CAPTURE_DAILY_AT`, default 07:05, `TZ=Asia/Jakarta` in Docker).
- Deployment: Docker Compose inside the company VPN; the web UI is intentionally token-less there (`API_TOKEN` unset). Token support exists for other deployments.
- Upstream site is unreliable: chart detail views randomly fail server-side (500s, chart JS crashes). The capture layer retries and records honest no-data entries; see `AUDIT.md`.
- Terminology: baseline (from) vs compare (to) dates, windows (`FROM,TO,START,END`, multiple per run, add next day when an incident crosses midnight), modules `trade_trends` / `cashout` / `va_topup` / `x2x` (va_topup keeps only ~3 days of queryable data), P-levels where worst window wins and durations add up.

## Capabilities and Constraints

- Incident levels: P1–P4 thresholds per module (`src/config.js`), `CAPTURE FAILED` ranked above P2 — "nothing measured" is a site error, never "healthy".
- Outputs per run: `output/<run-dir>/` with `report.csv`, `incidents.json`, screenshots; runs capped by `RETENTION_RUNS` (default 50). Optional MySQL sink with retry of failed rows.
- **Binding constraint (user-confirmed): no build step, minimal dependencies.** Single-file `web/index.html`, hand-rolled CSS; package deps are `playwright`, `dotenv`, `mysql2`. Do not introduce frameworks, bundlers, or CDNs.
- Self-test: `npm run selftest` exercises aggregation + P1–P4 logic (`src/analytics.js`). Live E2E audit: `npm run audit` / `AUDIT.md`.
- Not confirmed as binding: mobile support, the daily schedule/MySQL sink (facts of the current deployment, not user-locked).

## Evidence on Hand

- `output/` — real capture and audit runs with screenshots, CSVs, JSON (live production data).
- `AUDIT.md` — documented E2E audit of the Optimus flows, including three site-side bugs and the retry strategy.
- `.impeccable/critique/` — two design-critique snapshots of the dashboard (28 → 34/40).
- No marketing copy, testimonials, or claims of any kind exist; future work must not fabricate any.

## Product Principles

1. **Evidence over assertion.** Every level and percentage is backed by a stored screenshot and raw values; "not measured" is always distinguishable from "no incident".
2. **The site under test is unreliable — the tool must not be.** Retries, honest no-data entries, visible failure states; never fabricate, never hang silently.
3. **On-call time pressure is real.** The newest result is the current status; loading/error states must never leave the responder guessing.
4. **Robustness budget goes to the product, not the tooling.** No build step, minimal deps; complexity is spent on capture reliability and state handling.

## Accessibility & Inclusion

The single-file UI maintains keyboard operability (focus-visible rings, Enter/Space row activation, Escape-closable dialogs/popover), screen-reader support (aria-live status, aria-current, sr-only explanations), and `prefers-reduced-motion` handling. Keep this floor as the interface evolves.
