// Pure data logic: aggregation + incident classification. No browser, no I/O.

export function normalizeTime(timeStr) {
  const t = (timeStr || '').trim();
  if (!t) return '00:00:00';
  const colons = (t.match(/:/g) || []).length;
  if (colons >= 2) return t;
  if (colons === 1) return t + ':00';
  return t + ':00:00';
}

// Date-string normalizer for form/model readback: accepts ISO (what we fill)
// and the site's dd/mm/yyyy locale; returns ISO or null when unrecognized.
export function normDate(v) {
  if (typeof v !== 'string') return null;
  let m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.trim().match(/(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return null; // unrecognized — don't guess
}

export function pctChange(v1, v2) {
  if (v1 === 0) return v2 === 0 ? 0 : 100;
  return ((v2 - v1) / v1) * 100;
}

// tableRows: [{metric, date1Value, date2Value}]
export function aggregate(tableRows, moduleCfg) {
  return moduleCfg.aggregation === 'sum_by_date'
    ? aggregateByDate(tableRows)
    : aggregateByFilter(tableRows, moduleCfg.rowFilter);
}

function toNum(s) {
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? null : n;
}

function aggregateByFilter(rows, rowFilter) {
  const values = [];
  for (const row of rows) {
    if (rowFilter && !row.metric.includes(rowFilter)) continue;
    const n = toNum(row.date2Value);
    if (n !== null) values.push(n);
  }
  if (values.length < 2) return { value1: 0, value2: 0, percentageChange: 0 };
  const value1 = values[values.length - 2];
  const value2 = values[values.length - 1];
  return { value1, value2, percentageChange: pctChange(value1, value2) };
}

function aggregateByDate(rows) {
  const sums = new Map();
  for (const row of rows) {
    const m = row.metric.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    const n = toNum(row.date2Value);
    if (n === null) continue;
    sums.set(m[1], (sums.get(m[1]) || 0) + n);
  }
  const dates = [...sums.keys()].sort();
  if (dates.length < 2) return { value1: 0, value2: 0, percentageChange: 0 };
  const value1 = sums.get(dates[dates.length - 2]);
  const value2 = sums.get(dates[dates.length - 1]);
  return { value1, value2, percentageChange: pctChange(value1, value2) };
}

export function incidentDuration(startTimeStr, endTimeStr) {
  const [sh, sm] = normalizeTime(startTimeStr).split(':');
  const [eh, em] = normalizeTime(endTimeStr).split(':');
  let d = +eh * 60 + +em - (+sh * 60 + +sm);
  if (d < 0) d += 24 * 60;
  return d;
}

export function incidentLevel(totalDurationMinutes, averagePercentage, rules, value2 = Infinity) {
  if (averagePercentage >= 0) return 'No Incident';
  const drop = -averagePercentage;

  // Band rules (e.g. login/register policy matrices): drop% band + duration → level,
  // first match wins, listed worst-first. Expresses lower drop bounds the six
  // legacy knobs below can't (their P3 branch hard-codes drop < 50).
  // `maxValue` (optional, e.g. DANA Cicil) matches on the absolute compare
  // value — some policy matrices threshold counts, not percentages.
  if (rules.bands) {
    for (const b of rules.bands) {
      if (drop >= (b.minDrop ?? 0) && drop < (b.maxDrop ?? 101)
          && totalDurationMinutes >= (b.minDur ?? 0)
          && value2 <= (b.maxValue ?? Infinity)) return b.level;
    }
    return 'No Incident';
  }

  if (
    (drop === 100 && totalDurationMinutes > rules.p1_100pct_drop_min) ||
    (drop >= 50 && totalDurationMinutes >= rules.p1_50pct_drop_min)
  )
    return 'P1';
  if (
    (drop >= 20 && drop < 50 && totalDurationMinutes >= rules.p2_20to50pct_drop_min) ||
    (drop >= 50 && totalDurationMinutes > rules.p2_50pct_drop_min)
  )
    return 'P2';
  if (drop < 50 && totalDurationMinutes >= rules.p3_under50pct_drop_min) return 'P3';
  if (totalDurationMinutes > rules.p4_any_drop_min) return 'P4';
  return 'No Incident';
}

// ponytail: assert-based self-check — `node src/analytics.js`
if (process.argv[1] && process.argv[1].endsWith('analytics.js')) {
  const rules = {
    p1_100pct_drop_min: 15,
    p1_50pct_drop_min: 120,
    p2_20to50pct_drop_min: 720,
    p2_50pct_drop_min: 15,
    p3_under50pct_drop_min: 120,
    p4_any_drop_min: 15,
  };
  const rows = [
    { metric: 'Trade Success', date1Value: '1,000', date2Value: '1,000' },
    { metric: 'Trade Success', date1Value: '900', date2Value: '900' },
    { metric: 'Trade Fail', date1Value: '5', date2Value: '5' },
  ];
  const agg = aggregate(rows, { aggregation: 'last_two_values', rowFilter: 'Trade Success' });
  console.assert(agg.value1 === 1000 && agg.value2 === 900 && agg.percentageChange === -10, 'filter agg');

  const byDate = aggregate(
    [
      { metric: '2026-08-17 foo', date1Value: '', date2Value: '100' },
      { metric: '2026-08-17 bar', date1Value: '', date2Value: '50' },
      { metric: '2026-08-18 foo', date1Value: '', date2Value: '150' },
    ],
    { aggregation: 'sum_by_date' }
  );
  console.assert(byDate.value1 === 150 && byDate.value2 === 150, 'date agg');

  console.assert(incidentDuration('09:00', '11:30') === 150, 'duration');
  console.assert(incidentLevel(60, -100, rules) === 'P1', 'P1 total outage');
  console.assert(incidentLevel(200, -60, rules) === 'P1', 'P1 50% 3h');
  console.assert(incidentLevel(20, -30, rules) === 'P4', 'any drop >15min is P4');
  console.assert(incidentLevel(20, -60, rules) === 'P2', 'P2 50% >15min');
  console.assert(incidentLevel(200, -30, rules) === 'P3', 'P3 <50% 2h+');
  console.assert(normalizeTime('09:30') === '09:30:00', 'time norm');
  console.assert(normDate('2026-08-21') === '2026-08-21', 'date norm ISO');
  console.assert(normDate('21/08/2026') === '2026-08-21', 'date norm locale');
  console.assert(normDate('1-8-2026') === '2026-08-01', 'date norm zero-pads');
  console.assert(normDate('Aug 21') === null, 'date norm rejects junk');

  // Band rules: login/register policy matrices (ID-ARC-PRO-02 p.30–31).
  const loginRules = { bands: [
    { minDrop: 50, minDur: 360, level: 'P1' },
    { minDrop: 50, minDur: 15, level: 'P2' },
    { minDrop: 30, maxDrop: 50, minDur: 360, level: 'P2' },
    { minDrop: 30, maxDrop: 50, minDur: 15, level: 'P3' },
    { minDur: 360, level: 'P3' },
    { minDur: 15, level: 'P4' },
  ] };
  const regRules = { bands: [
    { minDrop: 50, minDur: 360, level: 'P2' },
    { minDrop: 50, minDur: 15, level: 'P3' },
    { minDur: 360, level: 'P3' },
    { minDur: 15, level: 'P4' },
  ] };
  console.assert(incidentLevel(60, -60, loginRules) === 'P2', 'login ≥50% base');
  console.assert(incidentLevel(400, -60, loginRules) === 'P1', 'login ≥50% 6h → P1');
  console.assert(incidentLevel(60, -40, loginRules) === 'P3', 'login 30–50% base');
  console.assert(incidentLevel(400, -40, loginRules) === 'P2', 'login 30–50% 6h → P2');
  console.assert(incidentLevel(60, -20, loginRules) === 'P4', 'login <30% base');
  console.assert(incidentLevel(400, -20, loginRules) === 'P3', 'login <30% 6h → P3');
  console.assert(incidentLevel(400, -100, loginRules) === 'P1', 'login 100% is ≥50 band');
  console.assert(incidentLevel(14, -60, loginRules) === 'No Incident', 'under 15min = not incident');
  console.assert(incidentLevel(60, -50, regRules) === 'P3', 'register ≥50% base');
  console.assert(incidentLevel(400, -50, regRules) === 'P2', 'register ≥50% 6h → P2');
  console.assert(incidentLevel(60, -20, regRules) === 'P4', 'register <50% base');
  console.assert(incidentLevel(400, -20, regRules) === 'P3', 'register <50% 6h → P3');
  console.assert(incidentLevel(60, 5, regRules) === 'No Incident', 'rise = no incident');

  // PDF p.33 non-critical matrix (cashout): drops → P4, 6h → P3, 12h → P2; outage → P2, 6h → P1.
  const cashRules = { bands: [
    { minDrop: 100, minDur: 360, level: 'P1' },
    { minDrop: 100, minDur: 15, level: 'P2' },
    { minDur: 720, level: 'P2' },
    { minDur: 360, level: 'P3' },
    { minDur: 15, level: 'P4' },
  ] };
  console.assert(incidentLevel(300, -100, cashRules) === 'P2', 'cashout outage 5h → P2');
  console.assert(incidentLevel(420, -100, cashRules) === 'P1', 'cashout outage 7h → P1');
  console.assert(incidentLevel(120, -60, cashRules) === 'P4', 'cashout 60% 2h → P4 (no P1 for drops)');
  console.assert(incidentLevel(420, -60, cashRules) === 'P3', 'cashout 60% 7h → P3');
  console.assert(incidentLevel(780, -30, cashRules) === 'P2', 'cashout 30% 13h → P2');
  console.assert(incidentLevel(90, -10, cashRules) === 'P4', 'cashout 10% 90m → P4');
  console.assert(incidentLevel(14, -60, cashRules) === 'No Incident', 'cashout under 15min');

  // Topup/P2P matrix (va_topup, x2x): total outage is P2 until 6h — no 15-min P1.
  const topupRules = {
    p1_100pct_drop_min: 360,
    p1_50pct_drop_min: 360,
    p2_20to50pct_drop_min: 720,
    p2_50pct_drop_min: 15,
    p3_under50pct_drop_min: 360,
    p4_any_drop_min: 15,
  };
  console.assert(incidentLevel(30, -100, topupRules) === 'P2', 'topup outage 30m → P2');
  console.assert(incidentLevel(420, -100, topupRules) === 'P1', 'topup outage 7h → P1');
  console.assert(incidentLevel(120, -60, topupRules) === 'P2', 'topup 60% 2h → P2');
  console.assert(incidentLevel(420, -40, topupRules) === 'P3', 'topup 40% 7h → P3');
  console.assert(incidentLevel(780, -30, topupRules) === 'P2', 'topup 30% 13h → P2');

  // DANA Cicil (Edik V.5.0 p.42, exclude-due-date matrix): absolute success-count caps.
  const cicilRules = { bands: [
    { maxValue: 0, minDur: 15, level: 'P1' },
    { maxValue: 10, minDur: 120, level: 'P1' },
    { maxValue: 10, minDur: 15, level: 'P2' },
    { maxValue: 29, minDur: 720, level: 'P2' },
    { maxValue: 29, minDur: 120, level: 'P3' },
    { maxValue: 41, minDur: 120, level: 'P3' },
    { maxValue: 41, minDur: 15, level: 'P4' },
  ] };
  console.assert(incidentLevel(20, -100, cicilRules, 0) === 'P1', 'cicil zero → P1');
  console.assert(incidentLevel(150, -80, cicilRules, 8) === 'P1', 'cicil ≤10 @2h → P1');
  console.assert(incidentLevel(30, -80, cicilRules, 8) === 'P2', 'cicil ≤10 base P2');
  console.assert(incidentLevel(150, -60, cicilRules, 25) === 'P3', 'cicil ≤29 @2h → P3');
  console.assert(incidentLevel(800, -60, cicilRules, 25) === 'P2', 'cicil ≤29 @12h → P2');
  console.assert(incidentLevel(30, -40, cicilRules, 25) === 'P4', 'cicil ≤29 base P4');
  console.assert(incidentLevel(150, -20, cicilRules, 40) === 'P3', 'cicil ≤41 @2h → P3');
  console.assert(incidentLevel(30, -10, cicilRules, 40) === 'P4', 'cicil ≤41 base P4');
  console.assert(incidentLevel(150, -90, cicilRules, 500) === 'No Incident', 'cicil >41 not in matrix');
  console.assert(incidentLevel(150, 10, cicilRules, 5) === 'No Incident', 'rise = no incident');
  console.log('analytics self-test OK');
}
