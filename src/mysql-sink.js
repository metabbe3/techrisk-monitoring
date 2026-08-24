import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';

// Best-effort MySQL index of capture results (techrisk-dashboard's
// incident_captures table). Never throws into the caller: on any failure the
// rows land in a pending file and are flushed on a later run — a DB outage
// can't fail a capture, and a capture can't stall the website's DB
// (pool of 1, 5s connect timeout, single batched insert).
//
// Env: MYSQL_HOST (enables the sink), MYSQL_PORT (3306), MYSQL_USER (root),
//      MYSQL_PASSWORD, MYSQL_DATABASE (laravel), MYSQL_TABLE (incident_captures)

const PENDING_FILE = path.join(DATA_DIR, '.mysql-pending.log');
const PENDING_CAP = 1000;

export class MysqlSink {
  constructor(env = process.env) {
    this.enabled = Boolean(env.MYSQL_HOST);
    if (!this.enabled) return;
    this.table = env.MYSQL_TABLE || 'incident_captures';
    this.cfg = {
      host: env.MYSQL_HOST,
      port: Number(env.MYSQL_PORT || 3306),
      user: env.MYSQL_USER || 'root',
      password: env.MYSQL_PASSWORD || '',
      database: env.MYSQL_DATABASE || 'laravel',
      connectionLimit: 1,
      connectTimeout: 5000,
    };
    this.pool = null; // lazy — mysql2 only loads when sink is on
  }

  async #conn() {
    if (!this.pool) {
      const mysql = await import('mysql2/promise');
      this.pool = mysql.createPool(this.cfg);
    }
    return this.pool;
  }

  // meta = IncidentReport.write() output's meta
  async save(meta) {
    if (!this.enabled) return true;
    const rows = meta.results.map((r) => [
      meta.runId, meta.task, r.module, meta.generatedAt,
      r.entry?.from ?? null, r.entry?.to ?? null, r.entry?.start ?? null, r.entry?.end ?? null,
      r.hasData ? r.value1 : null, r.hasData ? r.value2 : null,
      r.hasData ? r.percentageChange : null, r.incidentLevel, r.reason ?? null,
      r.screenshot ?? null, JSON.stringify(r),
    ]);
    try {
      const conn = await this.#conn();
      await conn.query(
        `INSERT INTO ${this.table}
         (run_id, task, module, captured_at, date_from, date_to, time_start, time_end,
          value_from, value_to, percentage_change, incident_level, reason, screenshot_path, payload)
         VALUES ?`,
        [rows.map((r) => this.#toSqlRow(r))]
      );
      console.log(`mysql: ${rows.length} row(s) saved to ${this.table}`);
      return true;
    } catch (e) {
      console.log(`mysql: save failed (${e.message}) — queued for retry`);
      this.#queue(rows);
      return false;
    }
  }

  // Retry everything queued from earlier failed runs; drop lines that succeed.
  async flushPending() {
    if (!this.enabled || !fs.existsSync(PENDING_FILE)) return;
    const lines = fs.readFileSync(PENDING_FILE, 'utf-8').split('\n').filter(Boolean);
    if (!lines.length) return;
    const kept = [];
    let flushed = 0;
    try {
      const conn = await this.#conn();
      for (const line of lines) {
        try {
          await conn.query(
            `INSERT INTO ${this.table}
             (run_id, task, module, captured_at, date_from, date_to, time_start, time_end,
              value_from, value_to, percentage_change, incident_level, reason, screenshot_path, payload)
             VALUES ?`,
            // NOTE: `?` needs an ARRAY OF ROWS ([[values]]), not a flat row —
            // a flat row expands without parentheses → SQL syntax error.
            [[this.#toSqlRow(JSON.parse(line))]]
          );
          flushed++;
        } catch (e) {
          console.log(`mysql: pending row kept (${e.message})`);
          kept.push(line);
        }
      }
      this.#writePending(kept);
      console.log(`mysql: flushed ${flushed} pending row(s), ${kept.length} still queued`);
    } catch (e) {
      console.log(`mysql: flush unavailable (${e.message})`);
    }
  }

  // MySQL strict mode wants 'YYYY-MM-DD HH:MM:SS', not ISO with T/Z.
  #toSqlRow(row) {
    const copy = [...row];
    copy[3] = String(copy[3]).replace('T', ' ').replace(/\.\d+Z$/, '');
    return copy;
  }

  #queue(rows) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const existing = fs.existsSync(PENDING_FILE)
        ? fs.readFileSync(PENDING_FILE, 'utf-8').split('\n').filter(Boolean)
        : [];
      const all = [...existing, ...rows.map((r) => JSON.stringify(r))].slice(-PENDING_CAP);
      this.#writePending(all);
    } catch {}
  }

  #writePending(lines) {
    if (lines.length) fs.writeFileSync(PENDING_FILE, lines.join('\n') + '\n', 'utf-8');
    else if (fs.existsSync(PENDING_FILE)) fs.unlinkSync(PENDING_FILE);
  }

  async close() {
    if (this.pool) await this.pool.end().catch(() => {});
  }
}
