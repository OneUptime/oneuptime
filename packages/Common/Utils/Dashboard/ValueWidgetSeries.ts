/*
 * The series behind a dashboard Value widget's sparkline, and the trend its
 * arrow shows, worked out with no opinion about the order the points came in.
 *
 * Why this exists: OneUptime's metrics API hands its buckets back NEWEST
 * first. AnalyticsDatabaseService sorts an aggregate by time descending
 * unless the caller asks otherwise, on purpose: a read that runs into its
 * row limit then drops the oldest buckets rather than the newest. The line
 * and bar charts never noticed, because they place each point by its time.
 * The Value widget drew its points evenly spaced in the order it was handed
 * them and split them into halves by position, so its sparkline ran from the
 * newest point on the left to the oldest on the right, and its arrow
 * compared the older half against the newer one: every trend pointed the
 * wrong way, by the wrong percentage. An external Data Source can return its
 * rows in any order at all.
 *
 * So nothing here trusts the order it is given. Every series is sorted by
 * time first, and the two halves the trend compares are halves of the TIME
 * RANGE, split at its midpoint, never halves of the array.
 *
 * Plain TypeScript with no React, so the arithmetic is unit-testable and the
 * metric and Data Source hosts share one definition.
 */

import OneUptimeDate from "../../Types/Date";
import Timezone from "../../Types/Timezone";

export interface ValueWidgetPoint {
  timestamp: Date;
  value: number;
}

/*
 * A point as a host has it: an AggregatedModel straight off an API, whose
 * timestamp may still be an ISO string and whose value may be null.
 */
export interface ValueWidgetPointInput {
  timestamp?: unknown;
  value?: unknown;
}

/*
 * The reduction a widget shows its number with - sum, mean, min, max, first
 * or last - over a list of values; null when there is nothing to reduce.
 */
export type ValueWidgetReduce = (values: Array<number>) => number | null;

export enum ValueWidgetTrendDirection {
  Up = "Up",
  Down = "Down",
  Flat = "Flat",
}

/*
 * A change smaller than this, in percent, reads as "about the same": a
 * series that wobbles by a few hundredths of a percent is flat, not rising.
 */
export const VALUE_WIDGET_FLAT_TREND_PERCENT: number = 0.5;

export interface ValueWidgetTrend {
  direction: ValueWidgetTrendDirection;
  /*
   * The change from the first half to the second, in percent of the first
   * half, rounded to one decimal. Null when the first half is exactly zero
   * and the second is not: a rise from nothing is no percentage of anything.
   */
  percent: number | null;
  // Each half of the time range, reduced the way the widget's number is.
  firstHalfValue: number;
  secondHalfValue: number;
  firstHalfStart: Date;
  // The midpoint of the time range: where the first half ends and the second begins.
  midpoint: Date;
  secondHalfEnd: Date;
}

// The mean, or null for no values: what a widget with no reduction of its own shows.
export const getMeanOfValues: ValueWidgetReduce = (
  values: Array<number>,
): number | null => {
  if (values.length === 0) {
    return null;
  }

  let sum: number = 0;

  for (const value of values) {
    sum = sum + value;
  }

  return sum / values.length;
};

/*
 * A point's time in milliseconds, or NaN when it has none: a Date, an ISO
 * string or epoch milliseconds as an API hands them over, or the
 * { _type: "DateTime", value } shape of a date that was never deserialized.
 */
export const getValueWidgetPointTime: (timestamp: unknown) => number = (
  timestamp: unknown,
): number => {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }

  if (typeof timestamp === "string" || typeof timestamp === "number") {
    if (timestamp === "") {
      return Number.NaN;
    }

    return new Date(timestamp).getTime();
  }

  if (
    timestamp &&
    typeof timestamp === "object" &&
    typeof (timestamp as { value?: unknown }).value === "string"
  ) {
    return new Date((timestamp as { value: string }).value).getTime();
  }

  return Number.NaN;
};

/*
 * The points a sparkline draws and a trend reads, oldest first, whatever
 * order they came in:
 *
 * - a point with no usable time, or a value that is not a finite number (a
 *   ClickHouse NULL arrives as null), is left out - one of them used to turn
 *   every coordinate of the line into NaN;
 * - points that share a timestamp (a query grouped by an attribute returns
 *   one per group per bucket) become one, through `combine`: the widget's own
 *   reduction, so a summed metric draws the sum of its groups. The mean when
 *   no reduction is given.
 *
 * The sort is stable, so points that tie on time keep the order they came in
 * before they are combined.
 */
export const getValueWidgetSeries: (
  points: Array<ValueWidgetPointInput>,
  combine?: ValueWidgetReduce | undefined,
) => Array<ValueWidgetPoint> = (
  points: Array<ValueWidgetPointInput>,
  combine?: ValueWidgetReduce | undefined,
): Array<ValueWidgetPoint> => {
  const combineValues: ValueWidgetReduce = combine || getMeanOfValues;
  const usable: Array<{ timeMs: number; value: number }> = [];

  for (const point of points || []) {
    const timeMs: number = getValueWidgetPointTime(point?.timestamp);
    const value: unknown = point?.value;

    if (
      !Number.isFinite(timeMs) ||
      typeof value !== "number" ||
      !Number.isFinite(value)
    ) {
      continue;
    }

    usable.push({ timeMs: timeMs, value: value });
  }

  usable.sort(
    (
      a: { timeMs: number; value: number },
      b: { timeMs: number; value: number },
    ): number => {
      return a.timeMs - b.timeMs;
    },
  );

  const series: Array<ValueWidgetPoint> = [];
  let index: number = 0;

  while (index < usable.length) {
    const timeMs: number = usable[index]!.timeMs;
    let end: number = index + 1;

    while (end < usable.length && usable[end]!.timeMs === timeMs) {
      end++;
    }

    if (end - index === 1) {
      series.push({ timestamp: new Date(timeMs), value: usable[index]!.value });
    } else {
      const combined: number | null = combineValues(
        usable
          .slice(index, end)
          .map((entry: { timeMs: number; value: number }): number => {
            return entry.value;
          }),
      );

      if (combined !== null && Number.isFinite(combined)) {
        series.push({ timestamp: new Date(timeMs), value: combined });
      }
    }

    index = end;
  }

  return series;
};

/*
 * How much time one point of a series stands for: the smallest gap between
 * two neighbouring points, which is the interval the host bucketed at (a
 * missing bucket only ever makes a gap wider). Zero for fewer than two
 * points. Expects a series from getValueWidgetSeries: sorted, one point per
 * time.
 */
export const getValueWidgetBucketWidthMs: (
  series: Array<ValueWidgetPoint>,
) => number = (series: Array<ValueWidgetPoint>): number => {
  let widthMs: number = 0;

  for (let index: number = 1; index < series.length; index++) {
    const gapMs: number =
      series[index]!.timestamp.getTime() -
      series[index - 1]!.timestamp.getTime();

    if (gapMs > 0 && (widthMs === 0 || gapMs < widthMs)) {
      widthMs = gapMs;
    }
  }

  return widthMs;
};

export interface GetValueWidgetTrendData {
  // In any order; sorted, cleaned and combined here.
  points: Array<ValueWidgetPointInput>;
  /*
   * The widget's own reduction. Each half of the time range is reduced with
   * it, so the trend compares the number the widget shows, worked out for
   * each half: the sum of each half for a summed metric, the highest of each
   * for a max, the latest of each for "Last".
   */
  reduce: ValueWidgetReduce;
  /*
   * True for a reduction that adds its values up (a sum, a count). A bucket
   * that straddles the midpoint is then shared between the halves by the time
   * it covers in each, so both halves add up the same length of time: a
   * steady count reads as flat however the range falls on the bucket grid.
   * Any other reduction takes the bucket whole, into the half that holds most
   * of it.
   */
  isAdditive?: boolean | undefined;
  /*
   * The time range the points were asked for. The halves are its halves, so
   * a metric that stopped reporting half way is measured against the silence
   * after it. Without one, the points' own span stands in.
   */
  windowStart?: Date | undefined;
  windowEnd?: Date | undefined;
  /*
   * The bucket interval the points were aggregated at, when the host knows
   * it; otherwise read off the points (getValueWidgetBucketWidthMs).
   */
  bucketWidthMs?: number | undefined;
}

const isUsableDate: (date: Date | undefined) => date is Date = (
  date: Date | undefined,
): date is Date => {
  return date instanceof Date && Number.isFinite(date.getTime());
};

/*
 * The most points a filled sparkline draws. The metrics API buckets a window
 * into a few hundred at most (AggregationIntervalUtil); a series spread
 * wider than this was not bucketed the way the caller thinks, and is drawn
 * as it came.
 */
export const VALUE_WIDGET_MAX_FILLED_POINTS: number = 2000;

export interface FillValueWidgetSeriesGapsData {
  // From getValueWidgetSeries: oldest first, one point per time.
  series: Array<ValueWidgetPoint>;
  // The interval the server bucketed the window at.
  bucketWidthMs: number;
  /*
   * The zone the server started its day and week buckets in, when the
   * request carried one (AggregateBy.timezone, issue #7277): a bucket a
   * whole number of days wide is then that many of the zone's calendar
   * days, from its midnight, and 23 or 25 hours long where its clocks
   * change. None for buckets on UTC's days, which are all 24 hours.
   */
  timezone?: Timezone | undefined;
}

const DAY_MS: number = 24 * 60 * 60 * 1000;

/*
 * The start of the bucket after the one that starts at `startMs`, when a
 * bucket is `days` of `timezone`'s calendar days: the start of the zone's
 * day that many days on. Half a day past that many 24-hour days is inside
 * that day whatever the clocks did in between (they move by two hours at
 * most), and the day's start is where the server starts its bucket - its
 * midnight, or the first instant after it on a day whose midnight the
 * clocks skip.
 */
const getNextCalendarBucketStartMs: (
  startMs: number,
  days: number,
  timezone: Timezone,
) => number = (startMs: number, days: number, timezone: Timezone): number => {
  return OneUptimeDate.getStartOfDay(
    new Date(startMs + days * DAY_MS + DAY_MS / 2),
    timezone,
  ).getTime();
};

/*
 * The slots of buckets of whole calendar days in a zone, `days` of its days
 * apart: from the first reading's, up to the first at or after the last
 * reading. Null when that is more than VALUE_WIDGET_MAX_FILLED_POINTS.
 */
const getCalendarBucketSlots: (data: {
  firstMs: number;
  lastMs: number;
  days: number;
  timezone: Timezone;
}) => Array<number> | null = (data: {
  firstMs: number;
  lastMs: number;
  days: number;
  timezone: Timezone;
}): Array<number> | null => {
  const slots: Array<number> = [data.firstMs];

  while (slots[slots.length - 1]! < data.lastMs) {
    if (slots.length >= VALUE_WIDGET_MAX_FILLED_POINTS) {
      return null;
    }

    slots.push(
      getNextCalendarBucketStartMs(
        slots[slots.length - 1]!,
        data.days,
        data.timezone,
      ),
    );
  }

  return slots;
};

/*
 * A sum's or a count's series with the empty buckets between its readings
 * drawn as 0.
 *
 * The metrics API answers only the buckets that had a reading. A count of
 * something that happens now and then - deploys, errors, sign-ups - comes
 * back as a few buckets with hours between them, and a line through just
 * those read flat ("4, then 4, then 4") while the arrow beside it, which
 * compares totals per half of the range, said the count rose. For a sum or
 * a count, a bucket with no reading counts nothing: it is a real 0. So each
 * empty bucket between the first reading and the last is drawn at 0, and
 * the spikes show as spikes.
 *
 * Only between readings: the newest bucket is often empty only because its
 * readings have not landed yet, and a line that dropped to 0 at its right
 * end on every refresh would read as an outage. Before the first reading
 * there may be no metric yet at all. And only for a sum or a count: an
 * average or a percentile of no readings is not 0 but unknown, and keeps
 * its gaps. Nothing is filled when
 *
 *   - a point does not sit on the bucket grid the caller names (a calendar
 *     month or year is not a fixed width, and a widget bucketed some other
 *     way must not get zeros between its real points);
 *   - the readings span more buckets than VALUE_WIDGET_MAX_FILLED_POINTS.
 *
 * Days and weeks in the reader's zone (`timezone`) are a grid of its
 * calendar days, not of fixed widths: across a change of its clocks one
 * day is 23 or 25 hours long, and a fixed step would put every later
 * reading off the grid and fill nothing.
 */
export const fillValueWidgetSeriesGaps: (
  data: FillValueWidgetSeriesGapsData,
) => Array<ValueWidgetPoint> = (
  data: FillValueWidgetSeriesGapsData,
): Array<ValueWidgetPoint> => {
  const series: Array<ValueWidgetPoint> = data.series;
  const widthMs: number = data.bucketWidthMs;

  if (series.length < 2 || !Number.isFinite(widthMs) || widthMs <= 0) {
    return series;
  }

  const firstMs: number = series[0]!.timestamp.getTime();
  const lastMs: number = series[series.length - 1]!.timestamp.getTime();
  const valuesByTime: Map<number, number> = new Map<number, number>();

  /*
   * Whole days in a zone, from a reading at the start of one of its days:
   * the zone's calendar is the grid. Readings that are not on it - on
   * UTC's midnights, say - are measured against the fixed width below.
   */
  if (
    data.timezone &&
    widthMs % DAY_MS === 0 &&
    OneUptimeDate.getStartOfDay(new Date(firstMs), data.timezone).getTime() ===
      firstMs
  ) {
    const slots: Array<number> | null = getCalendarBucketSlots({
      firstMs: firstMs,
      lastMs: lastMs,
      days: widthMs / DAY_MS,
      timezone: data.timezone,
    });

    if (!slots) {
      return series;
    }

    const onTheGrid: Set<number> = new Set<number>(slots);

    for (const point of series) {
      const timeMs: number = point.timestamp.getTime();

      if (!onTheGrid.has(timeMs)) {
        return series;
      }

      valuesByTime.set(timeMs, point.value);
    }

    if (slots.length === series.length) {
      // No bucket between the readings is empty.
      return series;
    }

    return slots.map((slotMs: number): ValueWidgetPoint => {
      return {
        timestamp: new Date(slotMs),
        value: valuesByTime.get(slotMs) ?? 0,
      };
    });
  }

  for (const point of series) {
    const timeMs: number = point.timestamp.getTime();

    if ((timeMs - firstMs) % widthMs !== 0) {
      return series;
    }

    valuesByTime.set(timeMs, point.value);
  }

  const slotCount: number = (lastMs - firstMs) / widthMs + 1;

  if (
    !Number.isFinite(slotCount) ||
    slotCount > VALUE_WIDGET_MAX_FILLED_POINTS
  ) {
    return series;
  }

  if (slotCount === series.length) {
    // No bucket between the readings is empty.
    return series;
  }

  const filled: Array<ValueWidgetPoint> = [];

  for (let slot: number = 0; slot < slotCount; slot++) {
    const slotMs: number = firstMs + slot * widthMs;

    filled.push({
      timestamp: new Date(slotMs),
      value: valuesByTime.get(slotMs) ?? 0,
    });
  }

  return filled;
};

/*
 * How the widget's number moved across the time range: the second half of
 * the range against the first, each reduced the way the widget reduces the
 * whole range. Null when there is nothing honest to compare - fewer than two
 * points, or a half of the range with no point in it at all (a metric that
 * only began reporting recently has no first half to be compared with).
 */
export const getValueWidgetTrend: (
  data: GetValueWidgetTrendData,
) => ValueWidgetTrend | null = (
  data: GetValueWidgetTrendData,
): ValueWidgetTrend | null => {
  const series: Array<ValueWidgetPoint> = getValueWidgetSeries(
    data.points,
    data.reduce,
  );

  if (series.length < 2) {
    return null;
  }

  const firstMs: number = series[0]!.timestamp.getTime();
  const lastMs: number = series[series.length - 1]!.timestamp.getTime();

  const bucketWidthMs: number =
    typeof data.bucketWidthMs === "number" &&
    Number.isFinite(data.bucketWidthMs) &&
    data.bucketWidthMs > 0
      ? data.bucketWidthMs
      : getValueWidgetBucketWidthMs(series);

  let startMs: number = isUsableDate(data.windowStart)
    ? data.windowStart.getTime()
    : firstMs;
  let endMs: number = isUsableDate(data.windowEnd)
    ? data.windowEnd.getTime()
    : lastMs + bucketWidthMs;

  if (!(endMs > startMs)) {
    startMs = firstMs;
    endMs = lastMs + bucketWidthMs;
  }

  if (!(endMs > startMs)) {
    return null;
  }

  const midMs: number = startMs + (endMs - startMs) / 2;
  const firstHalf: Array<number> = [];
  const secondHalf: Array<number> = [];

  for (const point of series) {
    const timeMs: number = point.timestamp.getTime();

    /*
     * The stretch of the range this point's value stands for: its bucket,
     * cut to the range. The first bucket starts before the range does (a
     * bucket is stamped with the start of its interval) and the last one is
     * still filling up, so both are cut.
     */
    const coverStartMs: number = Math.max(timeMs, startMs);
    const coverEndMs: number = Math.min(timeMs + bucketWidthMs, endMs);

    if (!(coverEndMs > coverStartMs)) {
      // No stretch of the range at all: the point goes by its own time.
      (timeMs < midMs ? firstHalf : secondHalf).push(point.value);
      continue;
    }

    if (coverEndMs <= midMs) {
      firstHalf.push(point.value);
      continue;
    }

    if (coverStartMs >= midMs) {
      secondHalf.push(point.value);
      continue;
    }

    if (data.isAdditive) {
      const firstShare: number =
        (midMs - coverStartMs) / (coverEndMs - coverStartMs);

      firstHalf.push(point.value * firstShare);
      secondHalf.push(point.value * (1 - firstShare));
      continue;
    }

    ((coverStartMs + coverEndMs) / 2 < midMs ? firstHalf : secondHalf).push(
      point.value,
    );
  }

  if (firstHalf.length === 0 || secondHalf.length === 0) {
    return null;
  }

  const firstHalfValue: number | null = data.reduce(firstHalf);
  const secondHalfValue: number | null = data.reduce(secondHalf);

  if (
    firstHalfValue === null ||
    secondHalfValue === null ||
    !Number.isFinite(firstHalfValue) ||
    !Number.isFinite(secondHalfValue)
  ) {
    return null;
  }

  let direction: ValueWidgetTrendDirection = ValueWidgetTrendDirection.Flat;
  let percent: number | null = 0;

  if (firstHalfValue === 0) {
    if (secondHalfValue !== 0) {
      percent = null;
      direction =
        secondHalfValue > 0
          ? ValueWidgetTrendDirection.Up
          : ValueWidgetTrendDirection.Down;
    }
  } else {
    // "+ 0" turns a rounded -0 into 0, so a flat trend never reads "-0%".
    percent =
      Math.round(
        ((secondHalfValue - firstHalfValue) / Math.abs(firstHalfValue)) * 1000,
      ) /
        10 +
      0;

    if (percent > VALUE_WIDGET_FLAT_TREND_PERCENT) {
      direction = ValueWidgetTrendDirection.Up;
    } else if (percent < -VALUE_WIDGET_FLAT_TREND_PERCENT) {
      direction = ValueWidgetTrendDirection.Down;
    }
  }

  return {
    direction: direction,
    percent: percent,
    firstHalfValue: firstHalfValue,
    secondHalfValue: secondHalfValue,
    firstHalfStart: new Date(startMs),
    midpoint: new Date(midMs),
    secondHalfEnd: new Date(endMs),
  };
};
