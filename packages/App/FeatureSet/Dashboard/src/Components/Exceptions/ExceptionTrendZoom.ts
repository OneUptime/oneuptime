import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  ExceptionTrendWindowKey,
  buildExceptionTrendRequest,
} from "../../Utils/ExceptionDetailPresentation";

/*
 * Pure helpers for drag-to-zoom on the Occurrence Trend card (issue #4105).
 * The card zooms its own chart only: nothing else on the exception's
 * Overview is windowed, so there is no page range for a drag to retime.
 */

const MINUTE_MS: number = 60 * 1000;
const DAY_MS: number = 24 * 60 * MINUTE_MS;

/*
 * The most bars a zoomed window is drawn with, the same ceiling the preset
 * windows keep (their bucket sizes give 30 to 48 bars).
 */
export const EXCEPTION_TREND_ZOOM_MAX_BARS: number = 48;

/*
 * Bucket widths a zoomed window picks from, smallest first. Each divides a
 * day evenly, so buckets still line up with the clock the way the presets'
 * 30 minute, 4 hour and 1 day buckets do. One minute is the finest bucket
 * the histogram endpoint takes.
 */
export const EXCEPTION_TREND_ZOOM_BUCKET_MINUTES: ReadonlyArray<number> = [
  1, 2, 5, 10, 15, 30, 60, 120, 240, 360, 720, 1440,
];

/**
 * The narrowest bucket that draws the window in at most
 * EXCEPTION_TREND_ZOOM_MAX_BARS bars: a zoom should show more detail, not
 * the same handful of preset-sized bars stretched across the card.
 */
export function pickExceptionTrendZoomBucketMinutes(
  durationMs: number,
): number {
  const safeDurationMs: number =
    Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 0;

  for (const minutes of EXCEPTION_TREND_ZOOM_BUCKET_MINUTES) {
    if (
      safeDurationMs / (minutes * MINUTE_MS) <=
      EXCEPTION_TREND_ZOOM_MAX_BARS
    ) {
      return minutes;
    }
  }

  return EXCEPTION_TREND_ZOOM_BUCKET_MINUTES[
    EXCEPTION_TREND_ZOOM_BUCKET_MINUTES.length - 1
  ]!;
}

/*
 * The relative range a preset window stands for, so the card's zoom can go
 * back to "the last 7 days" (still ending now) rather than to the dates it
 * resolved to when the zoom was made.
 */
export function getExceptionTrendPresetTimeRange(
  windowKey: ExceptionTrendWindowKey,
): TimeRange {
  if (windowKey === ExceptionTrendWindowKey.Week) {
    return TimeRange.PAST_ONE_WEEK;
  }

  if (windowKey === ExceptionTrendWindowKey.Month) {
    return TimeRange.PAST_ONE_MONTH;
  }

  return TimeRange.PAST_ONE_DAY;
}

export interface ExceptionTrendZoomRequestArgs {
  windowKey: ExceptionTrendWindowKey;
  fingerprint: string | undefined;
  primaryEntityId?: ObjectID | string | undefined;
  // The window a drag zoomed the chart to; null or unusable means the preset.
  zoomWindow: InBetween<Date> | null;
  now?: Date | undefined;
}

/**
 * The histogram request for the card: the preset's request, narrowed to the
 * zoomed window when there is one. The scoping (the fingerprint, and the
 * service it is unique within) always comes from the preset builder, so a
 * zoom can never widen what the card counts.
 */
export function buildExceptionTrendZoomRequest(
  args: ExceptionTrendZoomRequestArgs,
): JSONObject | null {
  const base: JSONObject | null = buildExceptionTrendRequest({
    windowKey: args.windowKey,
    fingerprint: args.fingerprint,
    primaryEntityId: args.primaryEntityId,
    now: args.now,
  });

  if (!base || !args.zoomWindow) {
    return base;
  }

  const startMs: number = OneUptimeDate.fromString(
    args.zoomWindow.startValue,
  ).getTime();
  const endMs: number = OneUptimeDate.fromString(
    args.zoomWindow.endValue,
  ).getTime();

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    endMs <= startMs
  ) {
    return base;
  }

  return {
    ...base,
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
    bucketSizeInMinutes: pickExceptionTrendZoomBucketMinutes(endMs - startMs),
  };
}

/*
 * Whether a tick should name the time of day (a window of two days or less)
 * or the date: the same split the presets make between 24h and 7d / 30d.
 */
export function isExceptionTrendIntraday(spanMs: number): boolean {
  return Number.isFinite(spanMs) && spanMs <= 2 * DAY_MS;
}

export interface ExceptionTrendZoomWindowEdges {
  start: string;
  end: string;
}

/*
 * The zoomed window's edges - "Sep 28, 10:00" and "Sep 28, 11:30" - in the
 * reader's zone and clock, for the card's sentences ("12 occurrences between
 * {{start}} and {{end}}").
 */
export function getExceptionTrendZoomWindowEdges(
  zoomWindow: InBetween<Date>,
): ExceptionTrendZoomWindowEdges {
  return {
    start: OneUptimeDate.getDateAsLocalShortDateTimeString(
      OneUptimeDate.fromString(zoomWindow.startValue),
    ),
    end: OneUptimeDate.getDateAsLocalShortDateTimeString(
      OneUptimeDate.fromString(zoomWindow.endValue),
    ),
  };
}
