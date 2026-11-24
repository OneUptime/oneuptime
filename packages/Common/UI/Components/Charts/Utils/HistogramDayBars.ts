import AggregationInterval from "../../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../../Types/BaseDatabase/AggregationIntervalUtil";
import OneUptimeDate from "../../../../Types/Date";
import Timezone from "../../../../Types/Timezone";
import TimezoneAlias from "../../../../Types/TimezoneAlias";

/*
 * A TELEMETRY HISTOGRAM'S DAY BARS, ON THE READER'S DAYS (issue #7923).
 *
 * The Logs, Traces and Exceptions histograms and the Logs and Traces
 * Analytics charts ask for their bars with the reader's zone - the zone
 * User Settings picked, else the browser's, when the Timezone list holds
 * it - and the server starts a bar of a day at that zone's midnight
 * (TelemetryHistogramBuckets). The answer names the zone it cut its day bars
 * in (`bucketTimezone`). A day bar is then labelled by its date, and a click
 * on it zooms into exactly that day: to the next midnight of that zone, 23
 * or 25 hours on, the day the clocks change, not 24.
 */

export const DAY_BAR_MS: number = 24 * 60 * 60 * 1000;
export const DAY_BAR_MINUTES: number = 24 * 60;

/**
 * The zone a histogram or an analytics request names for its day bars: the
 * reader's (AggregationIntervalUtil.getListedReaderTimezone), or undefined
 * for a zone the Timezone list does not hold - the server refuses those, so
 * such a reader's day bars stay UTC's rather than the chart failing.
 */
export function getHistogramRequestTimezone(): Timezone | undefined {
  return AggregationIntervalUtil.getListedReaderTimezone();
}

/**
 * The zone an answer says its day bars were cut in (`bucketTimezone`), or
 * undefined: none, or anything that is not a zone the Timezone list holds.
 */
export function readHistogramBucketTimezone(
  value: unknown,
): Timezone | undefined {
  if (!TimezoneAlias.isListedName(value)) {
    return undefined;
  }

  return TimezoneAlias.getCanonicalTimezone(value);
}

/**
 * A bar width the Traces and Exceptions explorers draw: the width that
 * gives their forty or so bars, and one day for a bar of twelve hours or
 * more. Forty bars over a month were 18.6 hours each and over three months
 * 2.3 days, counted from the epoch: days no reader has (#7923). A bar of a
 * day starts at the reader's midnight.
 */
export function getExplorerBarMinutes(minutes: number): number {
  return minutes >= DAY_BAR_MINUTES / 2 ? DAY_BAR_MINUTES : minutes;
}

// Whether bars `bucketIntervalMs` wide are a day each.
export function isDayBar(bucketIntervalMs: number | undefined): boolean {
  return bucketIntervalMs === DAY_BAR_MS;
}

/**
 * Where the bar that starts at `startMs` ends: a day bar at the next
 * midnight of the zone it was cut in (UTC's when the answer named none), any
 * other bar `bucketIntervalMs` on. NaN without a width.
 */
export function getHistogramBarEndMs(data: {
  startMs: number;
  bucketIntervalMs: number | undefined;
  bucketTimezone?: Timezone | undefined;
}): number {
  if (
    typeof data.bucketIntervalMs !== "number" ||
    !Number.isFinite(data.bucketIntervalMs) ||
    data.bucketIntervalMs <= 0 ||
    !Number.isFinite(data.startMs)
  ) {
    return Number.NaN;
  }

  if (!isDayBar(data.bucketIntervalMs)) {
    return data.startMs + data.bucketIntervalMs;
  }

  return AggregationIntervalUtil.getBucketEnd({
    bucketStart: new Date(data.startMs),
    interval: AggregationInterval.Day,
    timezone: data.bucketTimezone || Timezone.UTC,
  }).getTime();
}

/**
 * The label under a histogram's bar, the start of its bucket: the day a
 * day bar holds ("12 Nov", in the reader's language), and the time any
 * shorter bar starts at, as it always read. A day bar is named by the
 * middle of its day, which is on that day in the zone it was cut in and in
 * the reader's: the same zone, or UTC for a reader whose zone the server
 * could not take, within twelve hours of it.
 */
export function formatHistogramTick(
  time: string,
  data: { bucketIntervalMs?: number | undefined },
): string {
  const date: Date = OneUptimeDate.fromString(time);

  if (isNaN(date.getTime())) {
    return time;
  }

  if (isDayBar(data.bucketIntervalMs)) {
    return OneUptimeDate.getDateAsLocalDayMonthString(
      new Date(date.getTime() + DAY_BAR_MS / 2),
    );
  }

  return OneUptimeDate.getLocalTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}
