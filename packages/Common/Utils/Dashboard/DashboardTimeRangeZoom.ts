import InBetween from "../../Types/BaseDatabase/InBetween";
import RangeStartAndEndDateTime from "../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../Types/Time/TimeRange";

/**
 * The dashboard's time window, plus the window to go back to when a zoom
 * is undone.
 *
 * A dashboard has exactly ONE time range and every widget renders it, so
 * drag-selecting a window on a time-series panel is a statement about the
 * whole board, not about that one panel. `baseline` is what makes the
 * gesture reversible: the first zoom records the range that was in effect
 * before it, later zooms keep that same original, and a reset restores it.
 * `baseline === null` is the canonical "not zoomed" signal — the toolbar's
 * reset affordance and the panels' double-click-to-reset both key off it.
 */
export interface DashboardTimeRangeZoomState {
  /** The window every widget on the board is currently querying. */
  current: RangeStartAndEndDateTime;
  /** Window a reset returns to; null when no zoom is active. */
  baseline: RangeStartAndEndDateTime | null;
}

export default class DashboardTimeRangeZoomUtil {
  public static getInitialState(
    range: RangeStartAndEndDateTime,
  ): DashboardTimeRangeZoomState {
    return {
      current: range,
      baseline: null,
    };
  }

  public static isZoomed(state: DashboardTimeRangeZoomState): boolean {
    return state.baseline !== null;
  }

  /**
   * An explicit pick from the time-range picker. That is a new baseline,
   * not a zoom: it drops any pending "return to" window, so the reset
   * affordance disappears instead of offering to jump back to a range the
   * user has deliberately moved on from.
   */
  public static selectRange(
    _state: DashboardTimeRangeZoomState,
    range: RangeStartAndEndDateTime,
  ): DashboardTimeRangeZoomState {
    return {
      current: range,
      baseline: null,
    };
  }

  /**
   * Drag-selected window from a time-series panel. Returns the state
   * unchanged (same reference, so callers can skip a render) when the
   * selection is not a usable window — the chart library can hand back a
   * zero-width or invalid pair when a drag never left its starting bucket.
   */
  public static zoomToWindow(
    state: DashboardTimeRangeZoomState,
    startTime: Date,
    endTime: Date,
  ): DashboardTimeRangeZoomState {
    if (!(startTime instanceof Date) || !(endTime instanceof Date)) {
      return state;
    }

    const startTimeInMs: number = startTime.getTime();
    const endTimeInMs: number = endTime.getTime();

    if (Number.isNaN(startTimeInMs) || Number.isNaN(endTimeInMs)) {
      return state;
    }

    // A drag right-to-left is the same window as left-to-right.
    const lowerInMs: number = Math.min(startTimeInMs, endTimeInMs);
    const upperInMs: number = Math.max(startTimeInMs, endTimeInMs);

    if (lowerInMs === upperInMs) {
      return state;
    }

    return {
      current: {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date(lowerInMs),
          new Date(upperInMs),
        ),
      },
      /*
       * Zooming again while already zoomed keeps the ORIGINAL baseline, so
       * one reset always lands back where the investigation started rather
       * than unwinding one drag at a time.
       */
      baseline: state.baseline || state.current,
    };
  }

  /**
   * Undo the zoom. A no-op (same state reference) when nothing is zoomed,
   * so a stray double-click on an unzoomed dashboard cannot retime the
   * board or spend a refetch.
   */
  public static resetZoom(
    state: DashboardTimeRangeZoomState,
  ): DashboardTimeRangeZoomState {
    if (state.baseline === null) {
      return state;
    }

    return {
      current: state.baseline,
      baseline: null,
    };
  }
}
