import fs from 'node:fs';
import path from 'node:path';
import { incidentDuration, incidentLevel } from './analytics.js';
import { DATA_DIR } from './config.js';

// Turns per-module capture results into classified incidents + CSV/JSON output.
export class IncidentReport {
  constructor(taskName, outputBase = DATA_DIR) {
    this.taskName = taskName;
    this.outputBase = outputBase;
    this.timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.dir = path.join(outputBase, `${taskName}_${this.timestamp}`);
    this.summaries = [];
    this.results = [];
    fs.mkdirSync(this.dir, { recursive: true }); // screenshots land here before write()
  }

  // captures = one entry per window. Level = worst window's level; duration =
  // sum of window durations (5 one-hour drops = 5 hours of incident); avg %
  // across windows that produced data.
  addModule(moduleCfg, _entry, captures) {
    const valid = captures.filter((c) => c.hasData);
    // A dead capture (site 500 / nothing rendered) is NOT "No Incident" — we
    // didn't measure anything. Say so.
    const failed = valid.length === 0;
    const duration = captures.reduce((s, c) => s + incidentDuration(c.entry.start, c.entry.end), 0);
    const avgPct = failed ? 0 : valid.reduce((s, c) => s + c.percentageChange, 0) / valid.length;
    // Absolute-value bands (DANA Cicil) match the compare value of the newest window.
    const lastValue = failed ? 0 : valid[valid.length - 1].value2;
    const level = failed ? 'CAPTURE FAILED' : incidentLevel(duration, avgPct, moduleCfg.rules, lastValue);
    const reason = failed ? captures.map((c) => c.reason).filter(Boolean).join('; ') || 'no data rows' : null;

    const summary = {
      module: moduleCfg.key,
      dashboardItem: moduleCfg.dashboardItem,
      incidentLevel: level,
      reason,
      averagePercentage: failed ? null : +avgPct.toFixed(2),
      durationMinutes: duration,
      windows: captures.length,
      entriesWithDate: captures.length,
      entriesWithData: valid.length,
      rules: moduleCfg.rules,
    };
    this.summaries.push(summary);

    for (const c of captures) {
      this.results.push({
        module: moduleCfg.key,
        incidentLevel: level,
        averagePercentage: summary.averagePercentage,
        durationMinutes: incidentDuration(c.entry.start, c.entry.end),
        entry: c.entry,
        value1: c.value1,
        value2: c.value2,
        percentageChange: +c.percentageChange.toFixed(2),
        hasData: c.hasData,
        reason: c.reason || null,
        screenshot: c.screenshot,
        tableRows: c.tableRows,
        queriedDates: c.queriedDates || [], // dates the site actually queried — the evidence trail
      });
    }
    console.log(`  [${moduleCfg.key}] avg ${summary.averagePercentage}% over ${duration}m -> ${level}`);
    return summary;
  }

  write() {
    const meta = {
      task: this.taskName,
      runId: path.basename(this.dir),
      generatedAt: new Date().toISOString(),
      summaries: this.summaries,
      results: this.results,
    };
    const jsonPath = path.join(this.dir, 'incidents.json');
    fs.writeFileSync(jsonPath, JSON.stringify(meta, null, 2), 'utf-8');

    const csvPath = path.join(this.dir, 'report.csv');
    fs.writeFileSync(csvPath, this.#csv(), 'utf-8');

    console.log(`Report: ${csvPath}\nJSON:  ${jsonPath}`);
    return { dir: this.dir, jsonPath, csvPath, meta };
  }

  #csv() {
    const lines = [
      `Task,${this.taskName}`,
      `Generated At,${new Date().toISOString()}`,
      '',
      'Module,Incident Level,Avg % Change,Duration (min),Entries With Data,Value 1,Value 2,% Change,Screenshot',
    ];
    for (const r of this.results) {
      lines.push(
        [
          r.module,
          r.incidentLevel,
          r.averagePercentage,
          r.durationMinutes,
          r.hasData ? 'YES' : 'NO',
          r.value1,
          r.value2,
          r.percentageChange,
          r.screenshot,
        ].join(',')
      );
    }
    lines.push('', 'Module,Metric,Date 1 Value,Date 2 Value');
    for (const r of this.results) {
      const label = `${r.module} ${r.entry.from} vs ${r.entry.to}`;
      if (r.tableRows.length === 0) lines.push(`${label},(no data),,`);
      for (const row of r.tableRows) {
        lines.push(`${label},"${row.metric}","${row.date1Value}","${row.date2Value}"`);
      }
    }
    return lines.join('\n');
  }
}
