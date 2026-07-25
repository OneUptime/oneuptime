/*
 * Gap filling for the Traffic page's bandwidth-over-time series. The API
 * returns only non-empty buckets (plain GROUP BY), so a device that talked
 * for five minutes at each end of a day would otherwise render as one
 * continuous line with the silent 23 hours invisible — and Min/Avg Mbps
 * would be computed over traffic-carrying buckets only, never showing the
 * true zero periods.
 *
 * Pure and react-free so the bucket math is unit-testable.
 */

export interface FlowSeriesPointLike {
  // Bucket start — ISO or ClickHouse "YYYY-MM-DD HH:MM:SS" (UTC) string.
  time: string;
  octets: number;
  packets: number;
}

// Hard cap on generated points, mirroring the API's ~120-bucket target.
const MAX_FILLED_POINTS: number = 400;

// Trailing Z or a ±hh:mm / ±hhmm offset — anything else is timezone-less.
const TIMEZONE_SUFFIX_REGEX: RegExp = /z$|[+-]\d{2}:?\d{2}$/i;

function parseBucketTime(value: string): number {
  /*
   * ClickHouse DateTime strings carry no timezone marker but are UTC in
   * the standard deployment — append Z when no offset is present so JS
   * does not reinterpret them in the browser's zone.
   */
  const hasTimezone: boolean = TIMEZONE_SUFFIX_REGEX.test(value.trim());
  const normalized: string = hasTimezone
    ? value.trim()
    : `${value.trim().replace(" ", "T")}Z`;
  return new Date(normalized).getTime();
}

export function fillFlowSeriesGaps<T extends FlowSeriesPointLike>(
  series: Array<T>,
  bucketSeconds: number,
  windowStartAt: string,
  windowEndAt: string,
): Array<FlowSeriesPointLike> {
  if (bucketSeconds <= 0) {
    return series;
  }

  const bucketMs: number = bucketSeconds * 1000;

  const windowStartMs: number = parseBucketTime(windowStartAt);
  const windowEndMs: number = parseBucketTime(windowEndAt);

  if (
    !Number.isFinite(windowStartMs) ||
    !Number.isFinite(windowEndMs) ||
    windowEndMs <= windowStartMs
  ) {
    return series;
  }

  const byBucketMs: Map<number, T> = new Map<number, T>();
  for (const point of series) {
    const pointMs: number = parseBucketTime(point.time);
    if (Number.isFinite(pointMs)) {
      byBucketMs.set(pointMs, point);
    }
  }

  // Buckets are toStartOfInterval-aligned — align the walk the same way.
  const firstBucketMs: number = Math.floor(windowStartMs / bucketMs) * bucketMs;

  const bucketCount: number = Math.ceil(
    (windowEndMs - firstBucketMs) / bucketMs,
  );

  if (bucketCount > MAX_FILLED_POINTS) {
    // Malformed input (tiny bucket for a huge window) — don't amplify it.
    return series;
  }

  const filled: Array<FlowSeriesPointLike> = [];

  for (
    let bucketMsCursor: number = firstBucketMs;
    bucketMsCursor < windowEndMs;
    bucketMsCursor += bucketMs
  ) {
    const existing: T | undefined = byBucketMs.get(bucketMsCursor);

    filled.push(
      existing || {
        time: new Date(bucketMsCursor).toISOString(),
        octets: 0,
        packets: 0,
      },
    );
  }

  return filled;
}

export default fillFlowSeriesGaps;
