import OneUptimeDate from "../../../Types/Date";

/*
 * Per-second memo for the wall-clock stamps every ingested telemetry row
 * carries (createdAt and retentionDate, both stored with second
 * granularity).
 *
 * The Otel logs / traces / metrics row builders used to derive these per
 * row: a current-Date allocation, a ClickHouse DateTime format, a
 * moment-based add-days, and a second format — for every log record, span,
 * and metric datapoint. All of that output only changes once per second
 * (createdAt has no sub-second component) and once per distinct retention
 * window, so a burst of rows in the same second re-derived identical
 * strings millions of times. This memo pays the derivation once per second
 * (and once per retention window within that second) instead.
 *
 * Not thread-shared state to worry about: workers are single-threaded, and
 * the memo is replaced wholesale when the second rolls over, so the map of
 * retention strings can never grow past the number of distinct retention
 * windows seen within one second.
 */

export interface IngestionStamp {
  /** Current time truncated to the second the stamp was minted. */
  date: Date;
  /** ClickHouse DateTime string ("YYYY-MM-DD HH:mm:ss", UTC) of `date`. */
  db: string;
}

type CachedStamp = IngestionStamp & {
  epochSecond: number;
  retentionDbByDays: Map<number, string>;
};

let cachedStamp: CachedStamp | null = null;

export function getIngestionStamp(): IngestionStamp {
  const epochSecond: number = Math.floor(Date.now() / 1000);

  if (!cachedStamp || cachedStamp.epochSecond !== epochSecond) {
    const date: Date = new Date(epochSecond * 1000);
    cachedStamp = {
      epochSecond: epochSecond,
      date: date,
      db: OneUptimeDate.toClickhouseDateTime(date),
      retentionDbByDays: new Map<number, string>(),
    };
  }

  return cachedStamp;
}

/*
 * ClickHouse DateTime string for `stamp.date + retentionDays`, memoized per
 * (stamp second, retention window). Must be called with a stamp obtained
 * from getIngestionStamp() in the same row-building pass, so the retention
 * date stays consistent with the row's createdAt.
 */
export function getRetentionDateDb(
  stamp: IngestionStamp,
  retentionDays: number,
): string {
  const cached: CachedStamp = stamp as CachedStamp;

  let db: string | undefined = cached.retentionDbByDays?.get(retentionDays);

  if (db === undefined) {
    db = OneUptimeDate.toClickhouseDateTime(
      OneUptimeDate.addRemoveDays(stamp.date, retentionDays),
    );
    cached.retentionDbByDays?.set(retentionDays, db);
  }

  return db;
}
