import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";

/*
 * THE PREVIOUS CHECK'S COUNTERS, PER DATABASE MONITOR.
 *
 * A Database monitor's Cache Hit Ratio and Rollback Ratio are worked out
 * from counters the engine keeps from the moment its statistics start:
 * pg_stat_database's blks_hit, blks_read, xact_commit and xact_rollback,
 * MySQL's Innodb_buffer_pool_read_requests and Innodb_buffer_pool_reads.
 * Divided as they are read, they are ratios over the server's whole life -
 * months of history on a long-running server - which barely move: a cache
 * whose hit rate fell from 99% to 80% an hour ago still read 99.9%, and a
 * criteria on it never fired (follow-up of #5076).
 *
 * So each check divides what the counters moved since the previous check of
 * the same monitor, on this probe: the ratio over the monitor's own
 * interval, which is what a reader of a monitoring chart expects. This class
 * keeps that previous reading - only the few counters the ratios need - in
 * the probe's memory:
 *
 *   - keyed by the monitor and the database it reads (several steps of one
 *     monitor reading different databases keep apart; a monitor whose host
 *     or database is edited starts again);
 *   - per probe process: several probes checking one monitor each divide
 *     their own two readings, and a probe that restarts has none, so its
 *     first check carries neither ratio - "absent is not zero", and a
 *     criteria that cannot see a value never claims a breach
 *     (DatabaseMonitorCriteria);
 *   - bounded: the least recently checked monitors are forgotten past
 *     DATABASE_COUNTER_HISTORY_MAX_ENTRIES, at a few hundred bytes each.
 */

// The raw columns the ratios are divided from (DatabaseMonitor.applyDerivedMetrics).
export const DATABASE_RATIO_COUNTER_COLUMNS: ReadonlyArray<string> = [
  // PostgreSQL: Cache Hit Ratio.
  "blks_hit",
  "blks_read",
  // PostgreSQL: Rollback Ratio.
  "xact_commit",
  "xact_rollback",
  // MySQL: Cache Hit Ratio (the InnoDB buffer pool).
  "bp_read_requests",
  "bp_disk_reads",
];

export const DATABASE_COUNTER_HISTORY_MAX_ENTRIES: number = 20000;

export interface DatabaseCounterReading {
  // Only the DATABASE_RATIO_COUNTER_COLUMNS this check read.
  counters: Record<string, number>;
  readAt: Date;
}

export interface DatabaseCounterHistoryKeyInput {
  monitorId: string;
  databaseType: SqlDatabaseType | string;
  host?: string | undefined;
  port?: number | string | undefined;
  databaseName?: string | undefined;
  username?: string | undefined;
}

/*
 * Which monitor and which database a reading belongs to. The password is
 * never part of it: a key names a database, it does not open one.
 */
export function getDatabaseCounterHistoryKey(
  input: DatabaseCounterHistoryKeyInput,
): string {
  return JSON.stringify([
    input.monitorId,
    input.databaseType,
    (input.host || "").trim().toLowerCase(),
    input.port === undefined || input.port === null ? "" : String(input.port),
    input.databaseName || "",
    input.username || "",
  ]);
}

// The ratio counters among a check's raw columns, and nothing else.
export function pickDatabaseRatioCounters(
  rawColumns: Record<string, number>,
): Record<string, number> {
  const counters: Record<string, number> = {};

  for (const column of DATABASE_RATIO_COUNTER_COLUMNS) {
    const value: number | undefined = rawColumns[column];

    if (typeof value === "number" && Number.isFinite(value)) {
      counters[column] = value;
    }
  }

  return counters;
}

export default class DatabaseCounterHistory {
  private readonly readings: Map<string, DatabaseCounterReading> = new Map<
    string,
    DatabaseCounterReading
  >();

  private readonly maxEntries: number;

  public constructor(
    maxEntries: number = DATABASE_COUNTER_HISTORY_MAX_ENTRIES,
  ) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  /*
   * Keeps this check's reading and hands back the previous one, if this
   * probe has read the database for this monitor before. A Map iterates in
   * insertion order, and every reading is deleted and set again, so the
   * first key is always the monitor checked longest ago: the one forgotten
   * when the history is full.
   */
  public swap(
    key: string,
    reading: DatabaseCounterReading,
  ): DatabaseCounterReading | undefined {
    const previous: DatabaseCounterReading | undefined =
      this.readings.get(key);

    this.readings.delete(key);
    this.readings.set(key, reading);

    while (this.readings.size > this.maxEntries) {
      const oldest: string | undefined = this.readings.keys().next().value;

      if (oldest === undefined) {
        break;
      }

      this.readings.delete(oldest);
    }

    return previous;
  }

  public get size(): number {
    return this.readings.size;
  }

  public clear(): void {
    this.readings.clear();
  }
}
