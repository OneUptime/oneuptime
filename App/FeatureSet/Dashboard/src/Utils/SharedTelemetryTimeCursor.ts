import InBetween from "Common/Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";

/*
 * Shared time cursor for the entity telemetry hub (the Inventory item's
 * Telemetry tab).
 *
 * Every signal tab there — Traces, Logs, Metrics, Profiles — reads the same
 * item, but each embedded viewer historically owned its own time picker:
 * isolating a bad five-minute window in Logs and then clicking Traces reset
 * the investigation to the default hour. The cursor is one page-local piece
 * of state that all tabs follow; a window change inside any controlled
 * viewer (histogram drag-zoom, its own picker) lifts back up into it.
 *
 * The model is deliberately pure so the propagation rules — what each viewer
 * receives, when a lifted change is a no-op, when an override must be
 * adopted — can be tested without mounting a viewer.
 */

export interface SharedTelemetryTimeCursorState {
  /*
   * The current cursor value — a preset (rolling) range or a CUSTOM absolute
   * window. Object identity is meaningful: it only changes when the value
   * does, so viewers can key their adopt effects on it without churn.
   */
  range: RangeStartAndEndDateTime;
  /*
   * False until the user touches the cursor (page picker, viewer picker, or
   * histogram zoom). Tabs that are unbounded by default (Profiles) only get
   * a window stamped once this is true, so an untouched page behaves exactly
   * as it did before the cursor existed.
   */
  hasUserSelection: boolean;
}

/*
 * The prop shapes the hub page passes down, derived from one cursor state.
 * `viewerTimeRange` feeds the controlled `timeRangeOverride` prop of the
 * Traces / Logs / Metrics viewers verbatim (identity included — see
 * applyTimeCursorChange); `profilesCapturedWindow` is the absolute
 * `startTime` window for the profiles table, or null while untouched.
 */
export interface SharedTelemetryViewerWindows {
  viewerTimeRange: RangeStartAndEndDateTime;
  profilesCapturedWindow: InBetween<Date> | null;
}

// Matches the default window of every embedded telemetry viewer.
export const DEFAULT_TELEMETRY_TIME_CURSOR_RANGE: TimeRange =
  TimeRange.PAST_ONE_HOUR;

/*
 * Shown on the Exceptions tab, which cannot follow the cursor: exception
 * groups are lifetime aggregates (first seen / last seen), not windowed rows.
 */
export const EXCEPTIONS_TIME_CURSOR_HINT: string =
  "Exception groups are lifetime aggregates for this item and do not follow the selected time range.";

// Shown on the Profiles tab once the cursor narrows it.
export const PROFILES_TIME_CURSOR_HINT: string =
  "Showing recordings captured within the selected time range.";

export type CreateDefaultTimeCursorStateFunction =
  () => SharedTelemetryTimeCursorState;

export const createDefaultTimeCursorState: CreateDefaultTimeCursorStateFunction =
  (): SharedTelemetryTimeCursorState => {
    return {
      range: { range: DEFAULT_TELEMETRY_TIME_CURSOR_RANGE },
      hasUserSelection: false,
    };
  };

export type ApplyTimeCursorChangeFunction = (
  state: SharedTelemetryTimeCursorState,
  next: RangeStartAndEndDateTime,
) => SharedTelemetryTimeCursorState;

/*
 * Advance the cursor — from the page-level picker or from a viewer lifting
 * its own window change. Returns the SAME state object when the value did
 * not actually move, which is half of the feedback-loop guard: a viewer
 * echoing the cursor's current window back up leaves the state reference
 * untouched, React bails out of the re-render, and nothing flows back down.
 * (The other half is shouldAdoptTimeRangeOverride below.)
 */
export const applyTimeCursorChange: ApplyTimeCursorChangeFunction = (
  state: SharedTelemetryTimeCursorState,
  next: RangeStartAndEndDateTime,
): SharedTelemetryTimeCursorState => {
  if (
    state.hasUserSelection &&
    TelemetryQueryTimeRange.isSameRange(state.range, next)
  ) {
    return state;
  }

  return {
    range: next,
    hasUserSelection: true,
  };
};

export type ShouldAdoptTimeRangeOverrideFunction = (
  override: RangeStartAndEndDateTime | null | undefined,
  current: RangeStartAndEndDateTime,
) => boolean;

/*
 * Whether a controlled viewer should adopt a new `timeRangeOverride` value.
 * Compares by value, not identity: when a viewer lifts its own zoom, the
 * page re-renders and hands the same window straight back — adopting that
 * echo would refetch identical data (or, worse, loop). Only a genuinely
 * different window (page picker, or a lift from a sibling tab that stayed
 * mounted) is adopted.
 */
export const shouldAdoptTimeRangeOverride: ShouldAdoptTimeRangeOverrideFunction =
  (
    override: RangeStartAndEndDateTime | null | undefined,
    current: RangeStartAndEndDateTime,
  ): boolean => {
    if (!override) {
      return false;
    }

    return !TelemetryQueryTimeRange.isSameRange(override, current);
  };

export type ToProfilesCapturedWindowFunction = (
  state: SharedTelemetryTimeCursorState,
) => InBetween<Date> | null;

/*
 * The absolute `startTime` window for the profiles table. Null while the
 * cursor is untouched: profiles are sparse (~60s recordings), so the tab's
 * historical unbounded default must survive until the user actually narrows
 * the investigation. A preset range resolves against "now" at call time.
 */
export const toProfilesCapturedWindow: ToProfilesCapturedWindowFunction = (
  state: SharedTelemetryTimeCursorState,
): InBetween<Date> | null => {
  if (!state.hasUserSelection) {
    return null;
  }

  const resolved: InBetween<Date> =
    RangeStartAndEndDateTimeUtil.getStartAndEndDate(state.range);

  return new InBetween<Date>(resolved.startValue, resolved.endValue);
};

export type ToViewerWindowsFunction = (
  state: SharedTelemetryTimeCursorState,
) => SharedTelemetryViewerWindows;

/*
 * One cursor state → every embedded viewer's prop shape. `viewerTimeRange`
 * is `state.range` by reference on purpose: the identity only moves when
 * the value does, so a lifted echo hands each viewer a prop it has already
 * adopted and their adopt effects no-op.
 */
export const toViewerWindows: ToViewerWindowsFunction = (
  state: SharedTelemetryTimeCursorState,
): SharedTelemetryViewerWindows => {
  return {
    viewerTimeRange: state.range,
    profilesCapturedWindow: toProfilesCapturedWindow(state),
  };
};
