import InBetween from "Common/Types/BaseDatabase/InBetween";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import { TelemetrySavedViewTimeRange } from "Common/Types/Telemetry/TelemetrySavedViewState";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import {
  DEFAULT_SAVED_VIEW_TIME_RANGE,
  readSavedViewTimeRange,
} from "Common/Utils/Telemetry/SavedViewTimeRange";

/*
 * A saved log view has to remember the time *selection* the user made, not the
 * window that selection resolved to at save time. The log query itself can only
 * carry an absolute `time` InBetween, so the selection lives in its own
 * `timeRange` column and the query's window is re-derived from it on every
 * apply — which is what keeps "Past 1 Hour" rolling instead of freezing into
 * the hour the view was created.
 */

/** The subset of LogSavedView this module reads. */
export interface LogSavedViewTimeRangeSource {
  timeRange?: TelemetrySavedViewTimeRange | undefined;
  query?: Query<Log> | undefined;
}

/*
 * Views saved before the `timeRange` column existed only have the resolved
 * window inside `query.time`. That window is all we know about them, so it is
 * surfaced as a pinned Custom range — the same thing the user saw before this
 * change, rather than a silent reinterpretation of their saved view.
 */
export function readLegacyTimeRangeFromQuery(
  query: Query<Log> | undefined,
): RangeStartAndEndDateTime | undefined {
  const timeFilter: unknown = (query as Record<string, unknown> | undefined)?.[
    "time"
  ];

  if (!timeFilter || !(timeFilter instanceof InBetween)) {
    return undefined;
  }

  const startTime: Date = new Date(timeFilter.startValue as string | Date);
  const endTime: Date = new Date(timeFilter.endValue as string | Date);

  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
    return undefined;
  }

  return {
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(startTime, endTime),
  };
}

/*
 * The time selection to restore when a saved view is applied. Prefers the
 * stored selection, falls back to the legacy absolute window, and finally to
 * the viewer's default so a corrupt row still lands somewhere sensible.
 */
export function resolveLogSavedViewTimeRange(
  savedView: LogSavedViewTimeRangeSource,
): RangeStartAndEndDateTime {
  return (
    readSavedViewTimeRange(savedView.timeRange) ||
    readLegacyTimeRangeFromQuery(savedView.query) || {
      range: DEFAULT_SAVED_VIEW_TIME_RANGE,
    }
  );
}

/*
 * Stamp the window a time selection resolves to *now* onto a log query,
 * replacing whatever `time` the saved query carried. Rolling selections
 * therefore always query forward to the current clock.
 */
export function withResolvedTime(
  query: Query<Log>,
  timeRange: RangeStartAndEndDateTime,
): Query<Log> {
  const dateRange: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

  return {
    ...(query as Record<string, unknown>),
    time: new InBetween<Date>(dateRange.startValue, dateRange.endValue),
  } as unknown as Query<Log>;
}
