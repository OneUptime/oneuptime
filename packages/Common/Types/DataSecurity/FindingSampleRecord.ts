/*
 * THE RECORDS A TELEMETRY SCAN FOUND A FINDING'S DATA IN.
 *
 * A telemetry finding - a data type at a location of one service's logs,
 * traces, metrics, exceptions, AI conversations or session replays - comes
 * from a sample: the newest records of the hour before a scan. The scan
 * keeps, with the finding, which of those records held the data type
 * (DataStoreFinding.sampleRecords), so the issue's page reads exactly those
 * records again when a person asks where it was found (issue #9549), instead
 * of searching for them among everything the service wrote since.
 *
 * A reference is when the record was written, to the millisecond - the
 * primary key's own column, so the read is a lookup, not a search - and the
 * keys that tell it from its neighbours of the same millisecond: its trace
 * and span, its session, or - for a metric's data point - the metric it is
 * a point of, which the metrics table is keyed by before the time. Never a
 * value: what the record holds is read from the telemetry itself, by
 * someone who may read that telemetry. A metric's name is kept only where
 * it is the record's key and not the data: never for a finding in the
 * name itself, nor when a detector finds sensitive data in the name (a
 * name a project built from a user's email is a value, not a key).
 */

// The most records one finding keeps: as many as its records list shows.
export const MAX_FINDING_SAMPLE_RECORDS: number = 10;

// The longest a kept trace, span or session id may be.
export const MAX_SAMPLE_RECORD_ID_LENGTH: number = 128;

/*
 * The longest a kept metric name may be: OpenTelemetry's limit is 255
 * characters and Prometheus has none, so a longer name is kept as no key.
 */
export const MAX_SAMPLE_RECORD_METRIC_NAME_LENGTH: number = 1_024;

export interface FindingSampleRecord {
  // When the record was written (ISO 8601, to the millisecond).
  time: string;
  traceId?: string | undefined;
  spanId?: string | undefined;
  sessionId?: string | undefined;
  // A metric's data point: the metric it is a point of.
  metricName?: string | undefined;
}

type SampleRecordIdKey = "traceId" | "spanId" | "sessionId";

const ID_KEYS: ReadonlyArray<SampleRecordIdKey> = [
  "traceId",
  "spanId",
  "sessionId",
];

function readId(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed: string = value.trim();

  return trimmed.length <= MAX_SAMPLE_RECORD_ID_LENGTH ? trimmed : "";
}

/*
 * A metric's name as the table keys it: as written, spaces and all, since
 * the read matches it exactly - none when it is blank or too long.
 */
function readMetricName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "";
  }

  return value.length <= MAX_SAMPLE_RECORD_METRIC_NAME_LENGTH ? value : "";
}

function readTime(value: unknown): Date | null {
  const time: Date =
    typeof value === "number"
      ? new Date(value)
      : new Date(typeof value === "string" ? value : NaN);

  return Number.isFinite(time.getTime()) && time.getTime() > 0 ? time : null;
}

/*
 * A record as a reference: its time (a Date, milliseconds since the epoch,
 * or ISO text), the ids it has and the metric it is a point of. Null
 * without a time it was written.
 */
export function toFindingSampleRecord(data: {
  time: unknown;
  traceId?: unknown;
  spanId?: unknown;
  sessionId?: unknown;
  metricName?: unknown;
}): FindingSampleRecord | null {
  const time: Date | null =
    data.time instanceof Date
      ? readTime(data.time.getTime())
      : readTime(data.time);

  if (!time) {
    return null;
  }

  const record: FindingSampleRecord = { time: time.toISOString() };

  for (const key of ID_KEYS) {
    const id: string = readId(data[key]);

    if (id) {
      record[key] = id;
    }
  }

  const metricName: string = readMetricName(data.metricName);

  if (metricName) {
    record.metricName = metricName;
  }

  return record;
}

// What tells two references apart: the same record is kept once.
export function getFindingSampleRecordKey(record: FindingSampleRecord): string {
  return [
    record.time,
    record.traceId || "",
    record.spanId || "",
    record.sessionId || "",
    record.metricName || "",
  ].join("|");
}

/*
 * A finding's kept references as its JSON column holds them, read
 * defensively: each one a record with a time, the same record once, at most
 * MAX_FINDING_SAMPLE_RECORDS, in the order the scan kept them (the newest
 * first). Anything else - a row from before the column, a value someone
 * wrote by hand - reads as none.
 */
export function readFindingSampleRecords(
  value: unknown,
): Array<FindingSampleRecord> {
  if (!Array.isArray(value)) {
    return [];
  }

  const records: Array<FindingSampleRecord> = [];
  const seen: Set<string> = new Set();

  for (const item of value) {
    if (records.length >= MAX_FINDING_SAMPLE_RECORDS) {
      break;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const entry: Record<string, unknown> = item as Record<string, unknown>;
    const record: FindingSampleRecord | null = toFindingSampleRecord({
      time: entry["time"],
      traceId: entry["traceId"],
      spanId: entry["spanId"],
      sessionId: entry["sessionId"],
      metricName: entry["metricName"],
    });

    if (!record) {
      continue;
    }

    const key: string = getFindingSampleRecordKey(record);

    if (!seen.has(key)) {
      seen.add(key);
      records.push(record);
    }
  }

  return records;
}
