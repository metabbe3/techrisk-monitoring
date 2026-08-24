import 'dotenv/config';

// What to capture and how to classify drops. Mirrors techrisk-monitoring values.
export const MODULES = {
  trade_trends: {
    dashboardItem: 'Trade Trends Acquiring',
    rowFilter: 'Trade Success',
    aggregation: 'last_two_values',
    rules: {
      p1_100pct_drop_min: 15,
      p1_50pct_drop_min: 120,
      p2_20to50pct_drop_min: 720,
      p2_50pct_drop_min: 15,
      p3_under50pct_drop_min: 120,
      p4_any_drop_min: 15,
    },
  },
  cashout: {
    dashboardItem: 'Cashout Transfer Success Channel',
    rowFilter: null,
    aggregation: 'sum_by_date',
    // PDF p.33 "Other non-critical function (withdraw, fundback, etc.)":
    // success-rate drops → P4, 6h → P3, 12h → P2; complete outage → P2, 6h → P1.
    rules: { bands: [
      { minDrop: 100, minDur: 360, level: 'P1' }, // outage sustained 6h
      { minDrop: 100, minDur: 15, level: 'P2' },  // outage (15 min)
      { minDur: 720, level: 'P2' },               // any drop ≥12h
      { minDur: 360, level: 'P3' },               // any drop ≥6h
      { minDur: 15, level: 'P4' },                // any drop (15-min average)
    ] },
  },
  va_topup: {
    dashboardItem: 'Key Topup VA & OTC Overall',
    rowFilter: null,
    aggregation: 'sum_by_date',
    // The Optimus chart only keeps ~3 days of queryable data for this module —
    // baselines older than this come back "no data". Used for warnings only.
    retentionDays: 3,
    rules: {
      // PDF p.31 Topup matrix: ≥50% (incl. total outage) → P2, 6h → P1 — so the
      // 100% special case also escalates at 6h, not at 15 min like Acquiring.
      p1_100pct_drop_min: 360,
      p1_50pct_drop_min: 360,
      p2_20to50pct_drop_min: 720,
      p2_50pct_drop_min: 15,
      p3_under50pct_drop_min: 360,
      p4_any_drop_min: 15,
    },
  },
  x2x: {
    dashboardItem: 'X2X-Transfer-Trend',
    rowFilter: 'P2P_Success',
    aggregation: 'last_two_values',
    rules: null, // same as va_topup, filled below
  },
  // Band rules from the ATI incident policy (ID-ARC-PRO-02 V4.0 p.30–31):
  // drop% is the 15-minute average; sustained 6h escalates one level.
  hold_login: {
    dashboardItem: 'Hold Login',
    rowFilter: null,
    aggregation: 'last_two_values',
    rules: { bands: [
      { minDrop: 50, minDur: 360, level: 'P1' },
      { minDrop: 50, minDur: 15, level: 'P2' },
      { minDrop: 30, maxDrop: 50, minDur: 360, level: 'P2' },
      { minDrop: 30, maxDrop: 50, minDur: 15, level: 'P3' },
      { minDur: 360, level: 'P3' }, // <30% sustained
      { minDur: 15, level: 'P4' },  // <30% any
    ] },
  },
  user_register: {
    dashboardItem: 'User Register',
    rowFilter: 'Success Count', // popup has Success Count + Total per date — compare the same metric day-over-day
    aggregation: 'last_two_values',
    rules: { bands: [
      { minDrop: 50, minDur: 360, level: 'P2' },
      { minDrop: 50, minDur: 15, level: 'P3' },
      { minDur: 360, level: 'P3' }, // <50% sustained
      { minDur: 15, level: 'P4' },  // <50% any
    ] },
  },
  // Lives on a different dashboard (Command Center), not the overall one.
  // Edik V.5.0 p.42 "Dana cicil payment success counts exclude due date":
  // thresholds are absolute success counts per 15-min average, not percentages.
  dana_cicil: {
    dashboard: 'DANA_Command_Center_FULL_Display',
    dashboardItem: 'DANA CICIL Frequency Tendency',
    // popup lists 9 metric rows per date — "PaymentSucccess" (site's spelling)
    // is the payment-success row the policy matrix thresholds
    rowFilter: 'PaymentSucccess',
    aggregation: 'last_two_values',
    rules: { bands: [
      { maxValue: 0, minDur: 15, level: 'P1' },  // drops to zero
      { maxValue: 10, minDur: 120, level: 'P1' },
      { maxValue: 10, minDur: 15, level: 'P2' },
      { maxValue: 29, minDur: 720, level: 'P2' },
      { maxValue: 29, minDur: 120, level: 'P3' },
      { maxValue: 41, minDur: 120, level: 'P3' },
      { maxValue: 41, minDur: 15, level: 'P4' },
      // values > 41 are below every matrix cap → No Incident (no invented policy)
    ] },
  },
};
MODULES.x2x.rules = MODULES.va_topup.rules; // P2P transfer matrix (PDF p.32) = Topup numbers

export const ENV = {
  email: process.env.LOGIN_EMAIL,
  password: process.env.LOGIN_PASSWORD,
  loginUrl: process.env.LOGIN_URL,
  headless: process.env.HEADLESS !== 'false',
};

// Where runs (report.csv / incidents.json / screenshots) are written.
// Relative = project folder (bind-mounted under Docker); set an absolute path
// to pin data to server storage. Nothing is ever written to /tmp.
export const DATA_DIR = process.env.DATA_DIR || 'output';

export function parseArgs(argv) {
  const args = {
    modules: 'all',
    from: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    to: new Date().toISOString().slice(0, 10),
    start: '00:00:00',
    end: '23:59:59',
    task: 'capture',
    windows: [], // repeatable --window FROM,TO,START,END (multi-window mode)
  };
  const single = { ...args };

  for (let i = 0; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'window' && argv[i + 1] !== undefined) {
      args.windows.push(argv[++i]);
    } else if (key in single && key !== 'windows' && argv[i + 1] !== undefined) {
      single[key] = argv[++i];
    }
  }

  // Multi-window mode: each --window is its own comparison (own date pair +
  // own times). Covers "dropped 5 times today at different hours" and
  // incidents spanning midnight (add the next day as another window).
  if (args.windows.length > 0) {
    args.windowList = args.windows.map((w, i) => {
      const [from, to, start, end] = w.split(',');
      if (!from || !to) throw new Error(`--window #${i + 1} needs FROM,TO,START,END (got "${w}")`);
      return {
        from,
        to,
        start: start || '00:00:00',
        end: end || '23:59:59',
      };
    });
  } else {
    args.windowList = [{ from: single.from, to: single.to, start: single.start, end: single.end }];
  }

  args.modules = single.modules;
  args.task = single.task;
  args.moduleList =
    args.modules === 'all' ? Object.keys(MODULES) : args.modules.split(',').map((s) => s.trim());
  for (const m of args.moduleList) {
    if (!MODULES[m]) throw new Error(`unknown module "${m}" (valid: ${Object.keys(MODULES).join(', ')})`);
  }
  return args;
}
