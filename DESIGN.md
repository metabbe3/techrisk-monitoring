---
name: TechRisk Monitor
description: Evidence-first incident ledger for DANA Optimus module health — quiet paper where severity is the only raised voice.
colors:
  alarm-red: "#bb2d3b"
  signal-amber: "#b45309"
  instrument-blue: "#2563eb"
  slate-gray: "#6b727c"
  verified-green: "#2f9e6e"
  ink-black: "#1f2530"
  ink-soft: "#5b6472"
  hairline: "#e3e7ec"
  surface: "#ffffff"
  page: "#f5f6f8"
  ok-tint: "#dff2e9"
  neg-tint: "#f7e3e6"
  hover-tint: "#f0f4fd"
  th-band: "#f8f9fb"
  ok-border: "#c9e8da"
  ok-ink: "#1d6b4c"
  run-tint: "#f7ecd9"
  run-ink: "#8a4b04"
  hover-wash: "#fafbfc"
  border-hover: "#cdd4dc"
  selection-tint: "#dbe5fb"
  run-track: "#f0e2c8"
  run-border: "#e5c891"
  primary-deep: "#1d4fc4"
typography:
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 650
    lineHeight: 1.5
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  body-small:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  micro:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.04em"
  log:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
rounded:
  hair: "2px"
  focus: "4px"
  control: "6px"
  card: "8px"
  hero: "10px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.control}"
    padding: "4px 14px"
    height: "32px"
  button-hover:
    backgroundColor: "{colors.hover-wash}"
  button-primary:
    backgroundColor: "{colors.instrument-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "4px 14px"
    height: "32px"
    width: "120px"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.control}"
    padding: "4px 8px"
    height: "32px"
  select:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.control}"
    padding: "4px 28px"
    height: "32px"
  badge-severity:
    backgroundColor: "{colors.alarm-red}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  badge-ok:
    backgroundColor: "{colors.ok-tint}"
    textColor: "{colors.ok-ink}"
    rounded: "{rounded.pill}"
    padding: "2px 10px"
  pill-status:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  chip-module:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-black}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
    height: "32px"
  chip-module-checked:
    backgroundColor: "{colors.selection-tint}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
---

# Design System: TechRisk Monitor

## Overview

**Creative North Star: "The Incident Ledger"**

TechRisk Monitor is an incident ledger, not an alarm console. It sits on quiet paper (`#f5f6f8` page, white surface cards, hairline `#e3e7ec` borders) and speaks in a voice of quiet diligence: unhurried, exact, trustworthy. The page never raises its voice — severity badges are the only strong color anywhere, so a P1 red pixel is loud precisely because nothing else competes with it. The ledger's authority comes from what it can prove: every level and percentage is backed by a stored screenshot and raw values, and "not measured" is always visually distinct from "no incident".

Components are calm and soft — admin-panel comfort, not scientific instrumentation. Buttons read as dependable actions, inputs as patient fields, cards as tidy ledger entries. Spacing is generous between groups (24px section rhythm) and tight within them; the reading experience should feel like a well-kept logbook page, scanned top-to-bottom in seconds by a time-pressed on-call responder.

**Confirmed visual rejection: terminal cosplay.** Neon-on-dark surfaces, monospace-as-costume, hacker-console aesthetics do not belong here. Monospace is reserved for actual machine output (the capture step log, numeric data pairs) — never a voice for prose, labels, or chrome.

**Key Characteristics:**
- Quiet paper: near-monochrome surfaces, hairline borders, severity owns all strong color
- Calm, soft, familiar components on a strict 32px control floor
- Five-step type ramp, each size one job; tabular numerals everywhere numbers appear
- Flat by default — shadows only for floating layers (popover, lightbox)
- Skeletons, not spinners; motion is subtle and reduced-motion aware

## Colors

One accent, one functional severity scale, and quiet neutrals — the palette is an ink-and-paper system where chroma means something.

### Primary
- **Instrument Blue** (`#2563eb`): the single interactive accent — primary buttons, links, focus rings, active pager cell. It deliberately doubles as P3's hue: interactive chrome and mild severity share a register so strong warmth (red/amber) stays reserved for real incidents.

### Severity (the functional scale)
- **Alarm Red** (`#bb2d3b`): P1 — critical drops. The loudest thing on any page.
- **Signal Amber** (`#b45309`): P2 — major drops; also the busy/running tint family.
- **Instrument Blue** (`#2563eb`): P3 — minor drops (shared with the accent).
- **Slate Gray** (`#6b727c`): P4 — any measurable drop; the default badge fallback.
- **Verified Green** (`#2f9e6e`) on **Mint Paper** (`#dff2e9`, text `#1d6b4c`): No Incident — the only tinted badge; health is quiet, not celebratory. Measurement captions reuse the same tint pair: **Neg Tint** (`#f7e3e6`) for below-baseline deltas, Mint Paper for above.
- **Ink Black** (`#1f2530`): CAPTURE FAILED — darker than P1 on purpose: absence of data outranks any measurement.
- **Amber Draft Paper** (`#f7ecd9`, text `#8a4b04`): RUNNING — a process state, not a verdict. Its family includes the progress **run track** (`#f0e2c8`), the sliding bar in Signal Amber, and the running card's warm edge (**run border**, `#e5c891`). It sits near Signal Amber; keep process states visually subordinate to verdicts.

### Neutral
- **Ledger Ink** (`#1f2530`): primary text (shared hex with CAPTURE FAILED — ink is ink).
- **Faded Ink** (`#5b6472`): secondary text, labels, metadata.
- **Hairline** (`#e3e7ec`): all borders and dividers, 1px. On hover, borders deepen to **Border Hover** (`#cdd4dc`) — the only border-color event besides the running card's edge.
- **Surface** (`#ffffff`) on **Page Gray** (`#f5f6f8`): cards on page.
- **Hover Wash** (`#fafbfc`): the only hover surface change — a breath, not a highlight.
- **Selection Tint** (`#dbe5fb`): text selection — Instrument Blue at whisper strength; the palette's own highlight, never the OS default blue.

### Named Rules
**The Severity Owns Color Rule.** Strong chroma appears only on severity badges and the one interactive accent. Any new element that wants color must earn it by carrying verdict meaning — decoration never qualifies.

**The Nothing-Measured Rule.** "Not measured" never renders in a healthy or neutral-positive register. It is muted with an explicit explanation; CAPTURE FAILED renders darker than P1. Absence of evidence is never styled as evidence of health.

## Typography

**Display Font:** system-ui, -apple-system, Segoe UI, Roboto, sans-serif
**Body Font:** same stack — this is a native-voice tool; no display face, no webfonts, no CDN
**Label/Mono Font:** ui-monospace, SFMono-Regular, Menlo — machine output only

**Character:** The native system stack at five disciplined sizes. Authority comes from weight steps (550 controls, 600 emphasis, 650 headings) and case, not from size or ornament. Numerals are tabular everywhere (`font-feature-settings: "tnum"`), so columns of measurements align like a ledger.

### Hierarchy
- **Title** (650, 15px, 1.5): brand, hero-level verdict, the biggest thing on the page — still modest.
- **Body** (400, 14px, 1.5): default text; tables and form controls inherit it.
- **Body-small** (400, 13px, 1.5): metadata, hero subtitles, status messages.
- **Label** (600, 12px): badge text, pills, footnote counts.
- **Micro** (600, 11px, letter-spacing 0.04em, uppercase): field labels, table headers, captions — the ledger's marginalia.
- **Log** (mono, 12px, `--ink-soft`): the running capture's step log — actual machine output.

### Named Rules
**The Ramp Rule.** Exactly five sizes — 11 / 12 / 13 / 14 / 15px — and each has exactly one job (micro / label / body-small / body / title). Never add a size, never add a half step, never promote a micro to a title because it "feels important"; change its role instead.

**The Tabular Numerals Rule.** Every string of measurement digits renders with tabular numerals. Percentages, counts, durations, and data pairs align in columns; proportional figures in a ledger are a defect.

## Layout

A single centered column (`.wrap`, max-width 1100px, 16px side padding) — a ledger page, not a dashboard grid. Information architecture is results-first: the newest run's hero card leads, the request form is demoted behind a collapsed "New capture" toggle, history collapses into accordion rows. The newest result IS the current status.

- **Control floor:** every interactive element is exactly 32px tall — a fixed `height`, not a `min-height` (buttons, inputs, selects, pager cells, the P-levels? link). Alignment across a row is non-negotiable.
- **Spacing rhythm:** 4 / 8 / 12 / 16 / 24px (`s1–s5`). Tight inside groups (8px between filter controls), generous between regions (24px section padding). More space above a heading than below it.
- **Density:** tables at 13px with 8px vertical cell padding; screenshot grid `repeat(auto-fill, minmax(320px, 1fr))` with reserved 16:9 aspect boxes (no layout shift, ever). Comparison-window fields sit at the 4px (`s1`) gap and fill their grid cells — the four boxes read as one connected strip, 8px (`s2`) between windows.
- **Responsive:** the form grid collapses to one column below 768px; window rows to two columns below 640px. Nothing else changes character — this is a desktop ledger that degrades gracefully.

## Elevation & Depth

Flat paper. Structure comes from 1px hairlines and the page/surface tonal step, not from shadow. Depth exists only where an element genuinely floats above the page:

- **Popover shadow** (`0 12px 40px #0002`): the legend popover.
- **Viewer shadow** (`0 24px 80px #0006`): the fullscreen screenshot lightbox.

**The Flat Paper Rule.** Cards never cast shadows at rest, on hover, or on focus. If a new surface appears to float (dialogs, popovers), it earns one soft offset shadow; if it sits on the page, it gets a hairline. Nothing in between.

## Shapes

Rounded but sober rectangles — stationery, not toys. A hair-step of 2px on the 3px progress bar, 4px on focus rings (inside the 6px controls they outline), controls at 6px, cards at 8px, the hero card at 10px, status pills and severity badges fully rounded (999px). Borders are always 1px hairline; the one deliberate border-color event is the running card's warm `#e5c891` edge, and it stays subtle.

## Components

### Buttons
- **Shape:** gently rounded (6px), exact 32px box, `4px 14px` padding; compact inline variants may tighten horizontal padding to 8px.
- **Primary:** Instrument Blue fill, white text, `min-width: 120px`, centered — reserved for the one main action per view (New capture, Run capture, Retry now, Save).
- **Secondary:** white surface, hairline border, Ledger Ink text — downloads, Re-run, Clear, ✕.
- **Hover/Focus:** primary deepens to `#1d4fc4`; secondary takes the Hover Wash and a slightly darker border. Focus-visible draws a 2px Instrument Blue outline with 2px offset on everything interactive. Transitions are 150ms ease-out — small and quiet.
- **Link-button:** text-style button (P-levels?) with dotted underline, still 32px tall.

### Chips
- **Severity badges** (the signature component): fully rounded pills (999px), `2px 10px`, 12px/600 text. P1–P4 and CAPTURE FAILED are solid fills with white text; No Incident is Mint Paper tint; RUNNING is Amber Draft Paper tint with the progress bar echoing its hue. Badges never have icons or borders — the fill IS the signal.
- **Module toggle chips**: the selectable sibling — exact 32px pill (999px), `4px 12px` padding, 550 weight, hairline border. Checked = Instrument Blue border + Selection Tint fill + ink text; unchecked = surface + hairline. The checkbox itself is visually hidden but native (keyboard Space toggles, focus ring on the label via `:has(:focus-visible)`). Chips render from `/api/modules` (`src/config.js` is the single source of truth) — adding a module in config flows to the form and the Module filter without touching the UI.
- **Delta chips** (screenshot captions): the measurement, louder than context but quieter than a verdict — 13px/650 pill on a tint (Neg Tint below baseline, Mint Paper above), `1px 8px` padding, right-aligned after the tabular value pair. Solid severity fills stay badge-only.

### Cards / Containers
- **Hero card:** 10px radius, white surface, hairline border; head row (badge + title + meta + actions) over the module table over the screenshot grid.
- **History rows:** 8px radius accordion items; the row head is itself a button (keyboard-activatable, `aria-expanded` chevron).
- **Internal padding:** 12–16px; tables sit inside with 0–8px inset wrappers.

### Inputs / Fields
- **Style:** white surface, hairline border, 6px radius, exact 32px box, `4px 8px` padding, control text weight 550; micro uppercase labels above.
- **Dropdowns:** selects are system citizens, not native guests — `appearance: none`, the ledger's own ink chevron (10×6 SVG, Faded Ink stroke, 9px from the right edge), `4px 28px` padding so text never meets the arrow, button-grade text weight, and the same hover border as buttons (Border Hover `#cdd4dc`). The 32px box is a fixed height, never a `min-height` — native date/select widgets round differently and will drift 3px otherwise.
- **Focus:** 2px Instrument Blue outline.
- **Error:** hairline shifts to Alarm Red (`--sev-1`) on the offending field, message sits inline in the status line — never a browser alert.

### Navigation
No nav — one page. Orientation comes from the header status pills (SSE live/reconnecting, capture status with relative time) and the results-first hierarchy.

### Status Pills
Header pills: fully rounded, 12px text, hairline border, colored dot (gray idle, green live, amber pulsing while busy). Text always carries the state too — color is never the only signal.

### Skeletons
Loading states are shimmering gray blocks shaped like the content they replace (`1.2s` linear shimmer, `200%` background sweep), never spinners. Both disable under `prefers-reduced-motion`.

## Do's and Don'ts

### Do:
- **Do** keep every interactive element an exact 32px box and baseline-aligned within its row — fixed height, never `min-height`.
- **Do** render all measurement digits with tabular numerals.
- **Do** use skeletons shaped like the awaited content; reserve spinners for nothing.
- **Do** give every state a visible register: loading (skeleton), running (amber draft card + step log), failed (dark badge + explanation), not-measured (muted + explanation).
- **Do** respect `prefers-reduced-motion` — every animation has a static fallback.
- **Do** keep the type ramp at five sizes; change roles, not sizes.

### Don't:
- **Don't** introduce strong color outside severity meaning and the single accent (The Severity Owns Color Rule).
- **Don't** use monospace for anything except machine output — it is never a voice for prose, labels, or chrome.
- **Don't** add shadows to cards at rest; shadows belong only to floating layers.
- **Don't** style "not measured" or "capture failed" as healthy/neutral (The Nothing-Measured Rule).
- **Don't** add frameworks, bundlers, CDNs, or webfonts — the binding constraint is no-build with minimal dependencies; the system stack is the type system.
- **Don't** add sizes or half-steps to the type ramp.
