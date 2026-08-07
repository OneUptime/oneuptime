import InBetween from "../../Types/BaseDatabase/InBetween";
import { TelemetrySavedViewTimeRange } from "../../Types/Telemetry/TelemetrySavedViewState";
import RangeStartAndEndDateTime from "../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../Types/Time/TimeRange";

/*
 * Saved views (logs, metrics, traces) must remember the time *selection*, not
 * the window that selection happened to resolve to when the view was saved.
 * "Past 1 Hour" saved today has to still mean the last hour next week, so only
 * a Custom range carries absolute timestamps; every rolling range is stored as
 * its token alone and re-resolved against the clock each time it is applied.
 */

export const DEFAULT_SAVED_VIEW_TIME_RANGE: TimeRange = TimeRange.PAST_ONE_HOUR;

export function serializeSavedViewTimeRange(
  timeRange: RangeStartAndEndDateTime,
): TelemetrySavedViewTimeRange {
  const serialized: TelemetrySavedViewTimeRange = { range: timeRange.range };

  if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
    serialized.startValue = toIsoString(timeRange.startAndEndDate.startValue);
    serialized.endValue = toIsoString(timeRange.startAndEndDate.endValue);
  }

  return serialized;
}

/*
 * Read a stored time selection, or undefined when there is nothing usable
 * there. The input is whatever came back out of a JSON column, so nothing
 * about its shape is guaranteed. Callers that have another source to fall
 * back on (e.g. a legacy absolute window) use this; callers that do not use
 * deserializeSavedViewTimeRange below, which substitutes the default.
 */
export function readSavedViewTimeRange(
  saved: TelemetrySavedViewTimeRange | unknown,
): RangeStartAndEndDateTime | undefined {
  if (!saved || typeof saved !== "object") {
    return undefined;
  }

  const rawRange: unknown = (saved as Record<string, unknown>)["range"];

  if (typeof rawRange !== "string") {
    return undefined;
  }

  const knownRanges: Array<string> = Object.values(TimeRange);

  if (!knownRanges.includes(rawRange)) {
    return undefined;
  }

  const range: TimeRange = rawRange as TimeRange;

  if (range !== TimeRange.CUSTOM) {
    return { range: range };
  }

  const start: Date | null = toDate(
    (saved as Record<string, unknown>)["startValue"],
  );
  const end: Date | null = toDate(
    (saved as Record<string, unknown>)["endValue"],
  );

  if (!start || !end) {
    // A Custom range without a usable window says nothing about when to look.
    return undefined;
  }

  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(start, end),
  };
}

/*
 * Rebuild a RangeStartAndEndDateTime from saved state. Unknown or malformed
 * values fall back to the default (past one hour) rather than throwing or
 * producing a nonsensical window.
 */
export function deserializeSavedViewTimeRange(
  saved: TelemetrySavedViewTimeRange | unknown,
): RangeStartAndEndDateTime {
  return (
    readSavedViewTimeRange(saved) || { range: DEFAULT_SAVED_VIEW_TIME_RANGE }
  );
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Dates round-tripped through JSON come back as strings.
  const parsed: Date = new Date(value);
  return isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const parsed: Date = new Date(value);

  return isNaN(parsed.getTime()) ? null : parsed;
}
