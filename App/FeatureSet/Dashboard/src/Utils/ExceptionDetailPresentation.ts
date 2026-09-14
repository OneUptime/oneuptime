import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TimeRange from "Common/Types/Time/TimeRange";

/*
 * Pure helpers for the exception detail pages (header, Overview trend,
 * Settings status). Kept out of the components so the wording and the
 * request shapes can be unit tested without rendering.
 */

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

function toValidDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date: Date =
    value instanceof Date ? value : new Date(value as string | number);

  return Number.isNaN(date.getTime()) ? null : date;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/*
 * "4 minutes ago", "in 2 hours". Deliberately coarse: the header and the
 * occurrence rows answer "how recent?", and the absolute time is always one
 * hover away. Null for a missing or unparseable time so callers can show
 * their own "Not recorded" fallback instead of "Invalid date".
 */
export function formatRelativeTime(
  value: unknown,
  now: Date = new Date(),
): string | null {
  const date: Date | null = toValidDate(value);

  if (!date) {
    return null;
  }

  const diffMs: number = now.getTime() - date.getTime();
  const absMs: number = Math.abs(diffMs);

  if (absMs < 45 * SECOND_MS) {
    return "just now";
  }

  let phrase: string;

  if (absMs < 45 * MINUTE_MS) {
    phrase = plural(Math.max(1, Math.round(absMs / MINUTE_MS)), "minute");
  } else if (absMs < 22 * HOUR_MS) {
    phrase = plural(Math.max(1, Math.round(absMs / HOUR_MS)), "hour");
  } else if (absMs < 26 * DAY_MS) {
    phrase = plural(Math.max(1, Math.round(absMs / DAY_MS)), "day");
  } else if (absMs < 320 * DAY_MS) {
    phrase = plural(Math.max(1, Math.round(absMs / (30 * DAY_MS))), "month");
  } else {
    phrase = plural(Math.max(1, Math.round(absMs / (365 * DAY_MS))), "year");
  }

  return diffMs >= 0 ? `${phrase} ago` : `in ${phrase}`;
}

/*
 * How long an exception group has been active: first seen to last seen.
 * Null when either end is missing or they are out of order.
 */
export function formatActiveSpan(
  firstSeenAt: unknown,
  lastSeenAt: unknown,
): string | null {
  const first: Date | null = toValidDate(firstSeenAt);
  const last: Date | null = toValidDate(lastSeenAt);

  if (!first || !last || last.getTime() < first.getTime()) {
    return null;
  }

  const spanMs: number = last.getTime() - first.getTime();

  if (spanMs < MINUTE_MS) {
    return "less than a minute";
  }

  if (spanMs < HOUR_MS) {
    return plural(Math.round(spanMs / MINUTE_MS), "minute");
  }

  if (spanMs < DAY_MS) {
    return plural(Math.round(spanMs / HOUR_MS), "hour");
  }

  return plural(Math.round(spanMs / DAY_MS), "day");
}

export function formatOccurrenceCount(count: unknown): string {
  const value: number =
    typeof count === "number" && Number.isFinite(count) && count > 0
      ? Math.floor(count)
      : 0;

  return new Intl.NumberFormat().format(value);
}

/*
 * Shortened fingerprint for tight spaces; the full value stays copyable.
 */
export const EXCEPTION_FINGERPRINT_PREVIEW_LENGTH: number = 16;

export function getFingerprintPreview(fingerprint: string | undefined): string {
  const value: string = (fingerprint || "").trim();

  if (value.length <= EXCEPTION_FINGERPRINT_PREVIEW_LENGTH) {
    return value;
  }

  return `${value.slice(0, EXCEPTION_FINGERPRINT_PREVIEW_LENGTH)}…`;
}

// --- Occurrence trend (Overview) ---

export enum ExceptionTrendWindowKey {
  Day = "24h",
  Week = "7d",
  Month = "30d",
}

export interface ExceptionTrendWindow {
  key: ExceptionTrendWindowKey;
  label: string;
  description: string;
  durationMs: number;
  bucketSizeInMinutes: number;
}

/*
 * Bucket sizes keep every window between 30 and 48 bars: enough shape to see
 * a spike or a release boundary, few enough to stay readable in a card.
 */
export const EXCEPTION_TREND_WINDOWS: ReadonlyArray<ExceptionTrendWindow> = [
  {
    key: ExceptionTrendWindowKey.Day,
    label: "24h",
    description: "last 24 hours",
    durationMs: DAY_MS,
    bucketSizeInMinutes: 30,
  },
  {
    key: ExceptionTrendWindowKey.Week,
    label: "7d",
    description: "last 7 days",
    durationMs: 7 * DAY_MS,
    bucketSizeInMinutes: 240,
  },
  {
    key: ExceptionTrendWindowKey.Month,
    label: "30d",
    description: "last 30 days",
    durationMs: 30 * DAY_MS,
    bucketSizeInMinutes: 1440,
  },
];

export const DEFAULT_EXCEPTION_TREND_WINDOW: ExceptionTrendWindowKey =
  ExceptionTrendWindowKey.Day;

export function getExceptionTrendWindow(key: unknown): ExceptionTrendWindow {
  return (
    EXCEPTION_TREND_WINDOWS.find((window: ExceptionTrendWindow): boolean => {
      return window.key === key;
    }) || EXCEPTION_TREND_WINDOWS[0]!
  );
}

export interface ExceptionTrendRequestArgs {
  windowKey: ExceptionTrendWindowKey;
  fingerprint: string | undefined;
  primaryEntityId?: ObjectID | string | undefined;
  now?: Date | undefined;
}

/*
 * Body for POST /telemetry/exceptions/histogram, scoped to this one group.
 * A fingerprint is only unique within a service, so the service id travels
 * with it whenever the group has one. Null when there is no fingerprint:
 * an unscoped request would chart every exception in the project.
 */
export function buildExceptionTrendRequest(
  args: ExceptionTrendRequestArgs,
): JSONObject | null {
  const fingerprint: string = (args.fingerprint || "").trim();

  if (!fingerprint) {
    return null;
  }

  const window: ExceptionTrendWindow = getExceptionTrendWindow(args.windowKey);
  const end: Date = args.now || new Date();
  const start: Date = new Date(end.getTime() - window.durationMs);
  const primaryEntityId: string = args.primaryEntityId
    ? args.primaryEntityId.toString().trim()
    : "";

  const request: JSONObject = {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    bucketSizeInMinutes: window.bucketSizeInMinutes,
    fingerprints: [fingerprint],
  };

  if (primaryEntityId) {
    request["serviceIds"] = [primaryEntityId];
  }

  return request;
}

export interface ExceptionTrendBucket {
  time: string;
  series: string;
  count: number;
}

export interface ExceptionTrendSummary {
  total: number;
  unhandled: number;
  handled: number;
  peakCount: number;
  peakTime: string | null;
}

/*
 * Totals for the trend card header. Buckets for the same time (one per
 * series) are summed before the peak is picked, so a stacked bar's height
 * is what counts as the peak.
 */
export function summarizeExceptionTrend(
  buckets: ReadonlyArray<ExceptionTrendBucket> | null | undefined,
): ExceptionTrendSummary {
  const summary: ExceptionTrendSummary = {
    total: 0,
    unhandled: 0,
    handled: 0,
    peakCount: 0,
    peakTime: null,
  };

  const perTime: Map<string, number> = new Map();

  for (const bucket of buckets || []) {
    const count: number =
      typeof bucket?.count === "number" && Number.isFinite(bucket.count)
        ? Math.max(0, bucket.count)
        : 0;

    if (count === 0) {
      continue;
    }

    summary.total += count;

    if (bucket.series === "handled") {
      summary.handled += count;
    } else {
      summary.unhandled += count;
    }

    perTime.set(bucket.time, (perTime.get(bucket.time) || 0) + count);
  }

  for (const [time, count] of perTime.entries()) {
    if (count > summary.peakCount) {
      summary.peakCount = count;
      summary.peakTime = time;
    }
  }

  return summary;
}

export interface ExceptionTrendRow {
  // Bucket start as epoch milliseconds (the chart's category key).
  timeMs: number;
  unhandled: number;
  handled: number;
}

// A 30 day window at the smallest bucket we ever ask for, with headroom.
export const EXCEPTION_TREND_MAX_ROWS: number = 1500;

const CLICKHOUSE_DATE_TIME_PATTERN: RegExp =
  /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/;

function parseBucketTimeMs(time: string): number | null {
  if (!time) {
    return null;
  }

  /*
   * ClickHouse sends bucket starts as "YYYY-MM-DD HH:mm:ss" in UTC with no
   * zone marker; fromString reads that shape as UTC rather than local time.
   */
  const date: Date = CLICKHOUSE_DATE_TIME_PATTERN.test(time)
    ? OneUptimeDate.fromString(time)
    : new Date(time);

  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/*
 * One row per bucket across the whole requested window, zeros included.
 * The histogram endpoint only returns buckets that have occurrences, and a
 * bar chart of only the non-empty buckets would squeeze a quiet week and a
 * busy hour into bars of the same width.
 */
export function buildExceptionTrendRows(
  buckets: ReadonlyArray<ExceptionTrendBucket> | null | undefined,
  request: JSONObject | null | undefined,
): Array<ExceptionTrendRow> {
  if (!request) {
    return [];
  }

  const bucketMs: number =
    Number(request["bucketSizeInMinutes"] || 0) * MINUTE_MS;
  const startMs: number = new Date(request["startTime"] as string).getTime();
  const endMs: number = new Date(request["endTime"] as string).getTime();

  if (
    !Number.isFinite(bucketMs) ||
    bucketMs <= 0 ||
    Number.isNaN(startMs) ||
    Number.isNaN(endMs) ||
    endMs <= startMs
  ) {
    return [];
  }

  // toStartOfInterval aligns buckets to the epoch, so align the axis too.
  const firstBucketMs: number = Math.floor(startMs / bucketMs) * bucketMs;
  const rows: Array<ExceptionTrendRow> = [];
  const rowsByTime: Map<number, ExceptionTrendRow> = new Map();

  for (
    let timeMs: number = firstBucketMs;
    timeMs <= endMs && rows.length < EXCEPTION_TREND_MAX_ROWS;
    timeMs += bucketMs
  ) {
    const row: ExceptionTrendRow = { timeMs, unhandled: 0, handled: 0 };
    rows.push(row);
    rowsByTime.set(timeMs, row);
  }

  for (const bucket of buckets || []) {
    const parsedMs: number | null = parseBucketTimeMs(bucket?.time);
    const count: number =
      typeof bucket?.count === "number" && Number.isFinite(bucket.count)
        ? Math.max(0, bucket.count)
        : 0;

    if (parsedMs === null || count === 0) {
      continue;
    }

    const row: ExceptionTrendRow | undefined = rowsByTime.get(
      Math.floor(parsedMs / bucketMs) * bucketMs,
    );

    if (!row) {
      continue;
    }

    if (bucket.series === "handled") {
      row.handled += count;
    } else {
      row.unhandled += count;
    }
  }

  return rows;
}

// --- Occurrence spans (Occurrences page) ---

/*
 * The span list opens on the smallest preset window that still contains the
 * latest occurrence, and never less than a day: an exception page is about
 * the pattern, and an exception last seen three days ago would otherwise
 * open on an empty "past hour".
 */
export function getExceptionSpansDefaultTimeRange(
  lastSeenAt: unknown,
  now: Date = new Date(),
): TimeRange {
  const lastSeen: Date | null = toValidDate(lastSeenAt);

  if (!lastSeen) {
    return TimeRange.PAST_ONE_DAY;
  }

  const ageMs: number = Math.max(0, now.getTime() - lastSeen.getTime());

  if (ageMs <= DAY_MS) {
    return TimeRange.PAST_ONE_DAY;
  }

  if (ageMs <= 7 * DAY_MS) {
    return TimeRange.PAST_ONE_WEEK;
  }

  return TimeRange.PAST_ONE_MONTH;
}

// --- Triage status (header actions, Settings) ---

export interface ExceptionTriageState {
  isResolved: boolean;
  isArchived: boolean;
}

export interface ExceptionTriageAction {
  id: "resolve" | "unresolve" | "archive" | "unarchive";
  label: string;
  nextState: ExceptionTriageState;
}

/*
 * The two actions the header offers for the current state: resolve or
 * reopen, and archive or unarchive. Each carries the state it leads to so
 * the caller can send exactly that update.
 */
export function getExceptionTriageActions(
  state: ExceptionTriageState,
): Array<ExceptionTriageAction> {
  return [
    state.isResolved
      ? {
          id: "unresolve",
          label: "Reopen",
          nextState: { isResolved: false, isArchived: state.isArchived },
        }
      : {
          id: "resolve",
          label: "Resolve",
          nextState: { isResolved: true, isArchived: state.isArchived },
        },
    state.isArchived
      ? {
          id: "unarchive",
          label: "Unarchive",
          nextState: { isResolved: state.isResolved, isArchived: false },
        }
      : {
          id: "archive",
          label: "Archive",
          nextState: { isResolved: state.isResolved, isArchived: true },
        },
  ];
}

export interface ExceptionStatusHistoryArgs {
  isActive: boolean;
  at: unknown;
  byName: string | undefined;
  activeVerb: string;
  inactiveText: string;
  now?: Date | undefined;
}

/*
 * One line of the Settings status history: "Resolved 2 hours ago by Priya
 * Raman", degrading gracefully when the time or the person is unknown (rows
 * resolved by automation or before these columns existed).
 */
export function describeExceptionStatusChange(
  args: ExceptionStatusHistoryArgs,
): string {
  if (!args.isActive) {
    return args.inactiveText;
  }

  const relative: string | null = formatRelativeTime(args.at, args.now);
  const byName: string = (args.byName || "").trim();

  let text: string = args.activeVerb;

  if (relative) {
    text += ` ${relative}`;
  }

  if (byName) {
    text += ` by ${byName}`;
  }

  return text;
}
