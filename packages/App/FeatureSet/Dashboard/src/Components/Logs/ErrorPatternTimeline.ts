import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import { ErrorPatternTimelinePoint } from "../../Utils/LogsInsights";

/*
 * The rows the error drawer's "When it happened" chart draws. Pure, so the
 * bucket arithmetic can be tested without rendering a chart.
 */

export interface ErrorPatternTimelineRow {
  /*
   * The bucket start as an ISO string: the chart's category label, which
   * the drag selection reads back as a date.
   */
  time: string;
  count: number;
}

/*
 * A window of three months at the finest bucket the server picks for it is
 * well under this; the cap only guards against a malformed bucket size
 * turning into an enormous array.
 */
export const ERROR_PATTERN_TIMELINE_MAX_ROWS: number = 2000;

const DAY_MS: number = 24 * 60 * 60 * 1000;

export interface BuildErrorPatternTimelineRowsInput {
  points: Array<ErrorPatternTimelinePoint>;
  // The window the correlation was fetched for.
  window: InBetween<Date>;
  // How much time one bucket covers; unknown means no zero-filling.
  bucketIntervalMs: number | undefined;
}

type ToEpochMsFunction = (value: unknown) => number;

const toEpochMs: ToEpochMsFunction = (value: unknown): number => {
  if (value === undefined || value === null || value === "") {
    return Number.NaN;
  }

  try {
    return OneUptimeDate.fromString(value as Date).getTime();
  } catch {
    return Number.NaN;
  }
};

/**
 * One row per bucket across the whole window, quiet buckets included.
 *
 * The correlation only returns buckets the error fired in. Drawn as they
 * come, a burst and a week of silence get bars of the same width, so the
 * chart misstates when things happened - and a drag across it could not be
 * read as a window of time. Buckets line up with the epoch, the way the
 * server's toStartOfInterval aligns them. Without a known bucket width the
 * points are drawn as they are, in time order.
 */
export function buildErrorPatternTimelineRows(
  input: BuildErrorPatternTimelineRowsInput,
): Array<ErrorPatternTimelineRow> {
  const datedPoints: Array<{ timeMs: number; count: number }> = input.points
    .map(
      (point: ErrorPatternTimelinePoint): { timeMs: number; count: number } => {
        return {
          timeMs: toEpochMs(point.time),
          count: Number.isFinite(point.count) ? Math.max(0, point.count) : 0,
        };
      },
    )
    .filter((point: { timeMs: number; count: number }): boolean => {
      return Number.isFinite(point.timeMs);
    })
    .sort(
      (
        left: { timeMs: number; count: number },
        right: { timeMs: number; count: number },
      ): number => {
        return left.timeMs - right.timeMs;
      },
    );

  const asRows: () => Array<ErrorPatternTimelineRow> =
    (): Array<ErrorPatternTimelineRow> => {
      return datedPoints.map(
        (point: { timeMs: number; count: number }): ErrorPatternTimelineRow => {
          return {
            time: new Date(point.timeMs).toISOString(),
            count: point.count,
          };
        },
      );
    };

  const bucketMs: number = input.bucketIntervalMs || 0;
  const startMs: number = toEpochMs(input.window?.startValue);
  const endMs: number = toEpochMs(input.window?.endValue);

  if (
    !Number.isFinite(bucketMs) ||
    bucketMs <= 0 ||
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs ||
    (endMs - startMs) / bucketMs > ERROR_PATTERN_TIMELINE_MAX_ROWS
  ) {
    return asRows();
  }

  const rowsByBucket: Map<number, ErrorPatternTimelineRow> = new Map();
  const rows: Array<ErrorPatternTimelineRow> = [];

  for (
    let bucketStartMs: number = Math.floor(startMs / bucketMs) * bucketMs;
    bucketStartMs < endMs;
    bucketStartMs += bucketMs
  ) {
    const row: ErrorPatternTimelineRow = {
      time: new Date(bucketStartMs).toISOString(),
      count: 0,
    };
    rows.push(row);
    rowsByBucket.set(bucketStartMs, row);
  }

  for (const point of datedPoints) {
    const bucketStartMs: number =
      Math.floor(point.timeMs / bucketMs) * bucketMs;
    let row: ErrorPatternTimelineRow | undefined =
      rowsByBucket.get(bucketStartMs);

    /*
     * A bucket the window does not cover (the server's clock ran a little
     * past ours) is still an occurrence the reader should see.
     */
    if (!row) {
      row = { time: new Date(bucketStartMs).toISOString(), count: 0 };
      rowsByBucket.set(bucketStartMs, row);
      rows.push(row);
    }

    row.count += point.count;
  }

  return rows.sort(
    (left: ErrorPatternTimelineRow, right: ErrorPatternTimelineRow): number => {
      return (
        OneUptimeDate.fromString(left.time).getTime() -
        OneUptimeDate.fromString(right.time).getTime()
      );
    },
  );
}

/*
 * Whether the chart's ticks should name the time of day (a window of two
 * days or less) or the date.
 */
export function isErrorPatternTimelineIntraday(
  window: InBetween<Date>,
): boolean {
  const startMs: number = toEpochMs(window?.startValue);
  const endMs: number = toEpochMs(window?.endValue);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return true;
  }

  return endMs - startMs <= 2 * DAY_MS;
}
