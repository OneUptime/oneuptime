/*
 * THE NUMBERS EACH ROW OF THE EXCEPTIONS LIST SHOWS BESIDE ITSELF.
 *
 * For the exceptions on the page the reader is looking at, over the time
 * range the list is showing:
 *
 *   - how many distinct users their occurrences happened to (the occurrence's
 *     userId, see Common/Utils/Exceptions/ExceptionUserId);
 *   - how many occurrences fell in each of EXCEPTION_TREND_BUCKET_COUNT equal
 *     slices of the range, oldest first: the row's small trend chart.
 *
 * One request answers for the whole page (POST
 * /telemetry-exception/list-stats), so a page of fifty rows costs one round
 * trip, not fifty. Shared by the server, which writes it, and the Dashboard,
 * which reads it back defensively.
 */

// How many bars each row's trend chart has.
export const EXCEPTION_TREND_BUCKET_COUNT: number = 24;

// The narrowest bar: a minute, whatever the range.
export const MIN_EXCEPTION_TREND_BUCKET_SECONDS: number = 60;

// The most exceptions one request asks about: the largest page the list offers.
export const MAX_EXCEPTION_LIST_STATS_IDS: number = 200;

export interface ExceptionListStatsItem {
  telemetryExceptionId: string;
  /*
   * Distinct users in the range, or null when that could not be counted -
   * a reader shows nothing then, rather than a 0 that reads as "nobody".
   */
  affectedUsers: number | null;
  // Occurrences per bar, oldest first: EXCEPTION_TREND_BUCKET_COUNT of them.
  trend: Array<number>;
}

export interface ExceptionListStats {
  items: Array<ExceptionListStatsItem>;
  bucketSizeInSeconds: number;
  startTime: string;
  endTime: string;
}

// The width of one bar for a range: the range in equal slices, at least a minute.
export function getExceptionTrendBucketSizeInSeconds(
  startTime: Date,
  endTime: Date,
): number {
  const rangeSeconds: number = Math.max(
    0,
    Math.ceil((endTime.getTime() - startTime.getTime()) / 1000),
  );

  return Math.max(
    MIN_EXCEPTION_TREND_BUCKET_SECONDS,
    Math.ceil(rangeSeconds / EXCEPTION_TREND_BUCKET_COUNT),
  );
}

/*
 * The bar an occurrence counts in, from its bucket index as the query
 * computed it. The range's last instant falls one past the last bar; it
 * counts in the last one.
 */
export function clampExceptionTrendBucket(index: number): number | null {
  if (!Number.isFinite(index) || index < 0) {
    return null;
  }

  return Math.min(EXCEPTION_TREND_BUCKET_COUNT - 1, Math.floor(index));
}

export function emptyExceptionTrend(): Array<number> {
  return new Array<number>(EXCEPTION_TREND_BUCKET_COUNT).fill(0);
}

function toCount(value: unknown): number {
  const count: number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function readItem(value: unknown): ExceptionListStatsItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: { [key: string]: unknown } = value as { [key: string]: unknown };
  const id: unknown = raw["telemetryExceptionId"];

  if (typeof id !== "string" || id === "" || id.length > 64) {
    return null;
  }

  const trend: Array<number> = emptyExceptionTrend();
  const rawTrend: unknown = raw["trend"];

  if (Array.isArray(rawTrend)) {
    for (
      let index: number = 0;
      index < Math.min(rawTrend.length, EXCEPTION_TREND_BUCKET_COUNT);
      index++
    ) {
      trend[index] = toCount(rawTrend[index]);
    }
  }

  const rawUsers: unknown = raw["affectedUsers"];

  return {
    telemetryExceptionId: id,
    affectedUsers:
      rawUsers === null || rawUsers === undefined ? null : toCount(rawUsers),
    trend,
  };
}

/*
 * The answer as the Dashboard reads it: every item bounded, one per
 * exception, a trend of exactly EXCEPTION_TREND_BUCKET_COUNT counts. Null for
 * anything that is not an answer at all.
 */
export function readExceptionListStats(
  value: unknown,
): ExceptionListStats | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw: { [key: string]: unknown } = value as { [key: string]: unknown };
  const rawItems: unknown = raw["stats"];

  if (!Array.isArray(rawItems)) {
    return null;
  }

  const items: Array<ExceptionListStatsItem> = [];
  const seen: Set<string> = new Set<string>();

  for (const rawItem of rawItems.slice(0, MAX_EXCEPTION_LIST_STATS_IDS)) {
    const item: ExceptionListStatsItem | null = readItem(rawItem);

    if (!item || seen.has(item.telemetryExceptionId.toLowerCase())) {
      continue;
    }

    seen.add(item.telemetryExceptionId.toLowerCase());
    items.push(item);
  }

  const bucketSizeInSeconds: number = toCount(raw["bucketSizeInSeconds"]);

  return {
    items,
    bucketSizeInSeconds:
      bucketSizeInSeconds > 0
        ? bucketSizeInSeconds
        : MIN_EXCEPTION_TREND_BUCKET_SECONDS,
    startTime: typeof raw["startTime"] === "string" ? raw["startTime"] : "",
    endTime: typeof raw["endTime"] === "string" ? raw["endTime"] : "",
  };
}

// The trend's total: how many occurrences the range held.
export function sumExceptionTrend(trend: ReadonlyArray<number>): number {
  let total: number = 0;

  for (const count of trend) {
    total += count;
  }

  return total;
}
