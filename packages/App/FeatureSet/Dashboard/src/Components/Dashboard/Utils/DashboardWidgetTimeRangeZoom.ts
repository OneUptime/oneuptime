import {
  HistogramSelectionWindow,
  clampHistogramSelectionToWindowEnd,
} from "Common/UI/Components/Charts/Utils/HistogramSelection";

/*
 * Board-wide drag-to-zoom for the time-series widgets that do not go
 * through DashboardChartComponent: the Data Source chart, the log and trace
 * charts, the SLO chart and the value widgets' sparkline.
 *
 * The dashboard shell owns the ONE time range every widget renders (see
 * useDashboardTimeRangeZoom), so a widget never narrows itself: a drag hands
 * the window up and the new board range comes back down as
 * dashboardStartAndEndDate, retiming every panel at once. A double-click
 * hands the undo up the same way.
 *
 * Kept as plain functions over the shared props (not a hook, not a context)
 * so every widget applies the same two gates, and its React.memo comparator
 * asks the same question its render does.
 */

/*
 * The slice of DashboardBaseComponentProps the gesture depends on, spelled
 * out here rather than imported so this file stays free of the widget
 * registry DashboardBaseComponent pulls in.
 */
export interface DashboardWidgetTimeRangeZoomProps {
  isEditMode: boolean;
  onDashboardTimeRangeSelect?:
    | ((startTime: Date, endTime: Date) => void)
    | undefined;
  onDashboardTimeRangeReset?: (() => void) | undefined;
  isDashboardTimeRangeZoomed?: boolean | undefined;
}

export interface DashboardWidgetTimeRangeZoomHandlers {
  /** A drag across the widget's time axis; unset when the widget must not zoom. */
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  /** A double-click on the widget; set only while there is a zoom to undo. */
  onTimeRangeReset: (() => void) | undefined;
}

/** The window a histogram widget's bars were fetched for. */
export interface DashboardHistogramWindow {
  startTime: Date;
  endTime: Date;
  /** How much time one bar covers. */
  bucketSizeInMinutes: number;
}

export interface DashboardHistogramZoomSelection {
  /** The START of the first bar the drag covered: each bar's label. */
  firstBucketStart: Date;
  /** The START of the last bar the drag covered. */
  lastBucketStart: Date;
  /** What the drawn bars were fetched for; null before the first fetch. */
  fetchedWindow: DashboardHistogramWindow | null;
}

export default class DashboardWidgetTimeRangeZoom {
  /**
   * The handlers a widget hands its chart.
   *
   * - Edit mode offers neither: the drag gesture belongs to widget
   *   move/resize there, and a board-wide retime mid-edit would land on top
   *   of unsaved layout changes.
   * - The reset is offered only while the board is zoomed. Charts hold a
   *   plain click open for a moment whenever a reset handler is present (to
   *   tell it apart from a double-click), so an idle one would slow every
   *   click on the board for a gesture that could not do anything.
   * - A host that offers no zoom (a surface that mounts a widget without
   *   owning a time range) gets neither, and the widget stays inert rather
   *   than retiming something it knows nothing about.
   */
  public static getHandlers(
    props: DashboardWidgetTimeRangeZoomProps,
  ): DashboardWidgetTimeRangeZoomHandlers {
    if (props.isEditMode) {
      return { onTimeRangeSelect: undefined, onTimeRangeReset: undefined };
    }

    return {
      onTimeRangeSelect: props.onDashboardTimeRangeSelect,
      onTimeRangeReset: props.isDashboardTimeRangeZoomed
        ? props.onDashboardTimeRangeReset
        : undefined,
    };
  }

  /**
   * The window a drag across a log or trace histogram widget zooms the
   * board to.
   *
   * Each bar is labelled with the start of its bucket, so the chart hands
   * over the start of the first and of the last bar the drag covered. Read
   * literally that drops the last bar, the one the reader let go on; the
   * window runs to the END of it instead (the rule the logs and traces
   * explorers follow, issue #3914), so the zoomed board holds everything
   * the selected bars counted.
   *
   * It is then kept from running past the end of the window the bars were
   * fetched for: the newest bucket is usually still filling up, and taken
   * whole it would open a window that ends in the future (see
   * clampHistogramSelectionToWindowEnd).
   */
  public static getHistogramZoomWindow(
    selection: DashboardHistogramZoomSelection,
  ): HistogramSelectionWindow {
    const firstMs: number = Math.min(
      selection.firstBucketStart.getTime(),
      selection.lastBucketStart.getTime(),
    );
    const lastMs: number = Math.max(
      selection.firstBucketStart.getTime(),
      selection.lastBucketStart.getTime(),
    );
    const bucketSizeInMinutes: number =
      selection.fetchedWindow?.bucketSizeInMinutes || 0;
    const bucketSizeInMs: number =
      Number.isFinite(bucketSizeInMinutes) && bucketSizeInMinutes > 0
        ? bucketSizeInMinutes * 60 * 1000
        : 0;

    const zoomWindow: HistogramSelectionWindow = {
      startTime: new Date(firstMs),
      endTime: new Date(lastMs + bucketSizeInMs),
    };

    if (!selection.fetchedWindow) {
      return zoomWindow;
    }

    return clampHistogramSelectionToWindowEnd(
      zoomWindow,
      selection.fetchedWindow.endTime,
    );
  }

  /**
   * For a widget's React.memo comparator: true while the gestures a widget
   * would offer are unchanged.
   *
   * Only whether the shell offers each gesture is compared, never the
   * handlers' identity: the shells hand down identity-stable callbacks (see
   * useDashboardTimeRangeZoom), so a skipped render cannot leave a widget
   * holding a stale one, and comparing references would re-render every
   * widget on every parent tick if one ever came through as an inline
   * lambda - the exact cost these comparators exist to avoid.
   */
  public static isSameZoom(
    prev: DashboardWidgetTimeRangeZoomProps,
    next: DashboardWidgetTimeRangeZoomProps,
  ): boolean {
    return (
      Boolean(prev.isDashboardTimeRangeZoomed) ===
        Boolean(next.isDashboardTimeRangeZoomed) &&
      Boolean(prev.onDashboardTimeRangeSelect) ===
        Boolean(next.onDashboardTimeRangeSelect) &&
      Boolean(prev.onDashboardTimeRangeReset) ===
        Boolean(next.onDashboardTimeRangeReset)
    );
  }
}
