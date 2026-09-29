import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useContext,
  useMemo,
  useRef,
} from "react";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import useTimeRangeZoom, { TimeRangeZoom } from "./UseTimeRangeZoom";
import TimeRangeZoomUtil from "./TimeRangeZoomUtil";

/**
 * What a chart needs to take part in page-wide drag-to-zoom. Handed down by
 * a page (see TimeRangeZoomScope) so that every time-series chart below it
 * zooms the page instead of doing nothing, without threading two callbacks
 * through every card, tab and wrapper in between.
 */
export interface ChartTimeRangeZoomContextValue {
  /** A drag-selection on a chart: zooms the page to [startTime, endTime). */
  onTimeRangeSelect: (startTime: Date, endTime: Date) => void;
  /*
   * A double-click on a chart: undoes the zoom. Set only while the page is
   * zoomed. Charts hold every single click open for a moment while it is
   * set (to tell it apart from a double-click), so offering it while there
   * is nothing to undo would slow every click down for nothing.
   */
  onTimeRangeReset: (() => void) | undefined;
  isZoomed: boolean;
  /** The range a reset returns to; null while the page is not zoomed. */
  rangeBeforeZoom: RangeStartAndEndDateTime | null;
  /*
   * The range this zoom works over right now (the page's current range),
   * or null when the zoom did not say. A control that owns a range of its
   * own uses it to tell whether this zoom is about ITS range: a viewer or a
   * card nested in a zoomed page must not offer to reset the page.
   */
  timeRange: RangeStartAndEndDateTime | null;
}

const ChartTimeRangeZoomContext: React.Context<ChartTimeRangeZoomContextValue | null> =
  React.createContext<ChartTimeRangeZoomContextValue | null>(null);

/** The zoom the nearest page (or panel) offers, or null when none does. */
export const useChartTimeRangeZoom: () => ChartTimeRangeZoomContextValue | null =
  (): ChartTimeRangeZoomContextValue | null => {
    return useContext(ChartTimeRangeZoomContext);
  };

export interface TimeRangeZoomProviderProps {
  /*
   * The zoom to offer the charts below. null withdraws any zoom offered
   * further up: for a panel whose charts do not follow the page's range.
   */
  zoom: TimeRangeZoom | null;
  children: ReactNode;
}

/**
 * Offers a zoom (from useTimeRangeZoom) to every chart below. Use it when
 * the page needs the zoom itself too, e.g. to show a reset button of its
 * own; otherwise TimeRangeZoomScope is the one-liner.
 */
export const TimeRangeZoomProvider: FunctionComponent<
  TimeRangeZoomProviderProps
> = (props: TimeRangeZoomProviderProps): ReactElement => {
  const zoom: TimeRangeZoom | null = props.zoom;
  const onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | null =
    zoom ? zoom.zoomToTimeRange : null;
  const resetZoom: (() => void) | null = zoom ? zoom.resetZoom : null;
  const isZoomed: boolean = Boolean(zoom?.isZoomed);
  const rangeBeforeZoom: RangeStartAndEndDateTime | null =
    zoom?.rangeBeforeZoom || null;
  /*
   * Kept by value: a page that builds its range inline would otherwise
   * hand every chart a new context on every render.
   */
  const stableTimeRange: React.MutableRefObject<RangeStartAndEndDateTime | null> =
    useRef<RangeStartAndEndDateTime | null>(zoom?.timeRange || null);
  if (
    !TimeRangeZoomUtil.isSameRange(
      stableTimeRange.current,
      zoom?.timeRange || null,
    )
  ) {
    stableTimeRange.current = zoom?.timeRange || null;
  }
  const timeRange: RangeStartAndEndDateTime | null = stableTimeRange.current;

  const value: ChartTimeRangeZoomContextValue | null =
    useMemo((): ChartTimeRangeZoomContextValue | null => {
      if (!onTimeRangeSelect || !resetZoom) {
        return null;
      }

      return {
        onTimeRangeSelect: onTimeRangeSelect,
        onTimeRangeReset: isZoomed ? resetZoom : undefined,
        isZoomed: isZoomed,
        rangeBeforeZoom: rangeBeforeZoom,
        timeRange: timeRange,
      };
    }, [onTimeRangeSelect, resetZoom, isZoomed, rangeBeforeZoom, timeRange]);

  return (
    <ChartTimeRangeZoomContext.Provider value={value}>
      {props.children}
    </ChartTimeRangeZoomContext.Provider>
  );
};

export interface TimeRangeZoomScopeProps {
  /** The range the page is showing right now. */
  timeRange: RangeStartAndEndDateTime;
  /** The page's own setter for it. */
  onTimeRangeChange: (timeRange: RangeStartAndEndDateTime) => void;
  children: ReactNode;
}

/**
 * Makes every time-series chart inside it zoom the page: a drag on any of
 * them sets the page's range to the window dragged out, a double-click on
 * any of them puts the previous range back, and the page's time picker
 * offers a "Reset zoom" button while it is zoomed.
 *
 *   <TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>
 *     ...the page...
 *   </TimeRangeZoomScope>
 *
 * Wrap the page's picker too, so it can show the reset button.
 */
export const TimeRangeZoomScope: FunctionComponent<TimeRangeZoomScopeProps> = (
  props: TimeRangeZoomScopeProps,
): ReactElement => {
  const zoom: TimeRangeZoom = useTimeRangeZoom({
    timeRange: props.timeRange,
    onTimeRangeChange: props.onTimeRangeChange,
  });

  return (
    <TimeRangeZoomProvider zoom={zoom}>{props.children}</TimeRangeZoomProvider>
  );
};

/**
 * Whether a zoom is over the given range. A zoom that did not say which
 * range it works over is taken to be over any; see
 * ChartTimeRangeZoomContextValue.timeRange.
 */
export const isTimeRangeZoomFor: (
  zoom: ChartTimeRangeZoomContextValue | null,
  timeRange: RangeStartAndEndDateTime,
) => boolean = (
  zoom: ChartTimeRangeZoomContextValue | null,
  timeRange: RangeStartAndEndDateTime,
): boolean => {
  if (!zoom) {
    return false;
  }

  if (!zoom.timeRange) {
    return true;
  }

  return TimeRangeZoomUtil.isSameRange(zoom.timeRange, timeRange);
};

export interface ChartTimeRangeZoomHandlers {
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset: (() => void) | undefined;
}

export interface ResolveChartTimeRangeZoomInput {
  /** Handlers the chart's host passed explicitly. They always win. */
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  /*
   * Only a chart whose x-axis is time can be zoomed: a window dragged
   * across categories ("top services") is not a time range.
   */
  isTimeAxis: boolean;
  /** The chart opted out of zooming altogether. */
  disableTimeRangeZoom?: boolean | undefined;
  /** What the enclosing page offers (useChartTimeRangeZoom). */
  pageZoom: ChartTimeRangeZoomContextValue | null;
}

/**
 * Which zoom handlers a chart ends up with.
 *
 * - disableTimeRangeZoom: none at all.
 * - A host that passes either handler owns zooming for that chart: it gets
 *   exactly what the host passed. A host that zooms its own way also resets
 *   its own way; borrowing the page's reset would undo a zoom the chart did
 *   not make, and borrowing the page's zoom would make a reset-only chart
 *   (a dashboard bar panel) retime something its host does not know about.
 * - Otherwise a time-axis chart takes the page's zoom, if the page offers
 *   one.
 */
export const resolveChartTimeRangeZoom: (
  input: ResolveChartTimeRangeZoomInput,
) => ChartTimeRangeZoomHandlers = (
  input: ResolveChartTimeRangeZoomInput,
): ChartTimeRangeZoomHandlers => {
  if (input.disableTimeRangeZoom) {
    return { onTimeRangeSelect: undefined, onTimeRangeReset: undefined };
  }

  if (input.onTimeRangeSelect || input.onTimeRangeReset) {
    return {
      onTimeRangeSelect: input.onTimeRangeSelect,
      onTimeRangeReset: input.onTimeRangeReset,
    };
  }

  if (input.isTimeAxis && input.pageZoom) {
    return {
      onTimeRangeSelect: input.pageZoom.onTimeRangeSelect,
      onTimeRangeReset: input.pageZoom.onTimeRangeReset,
    };
  }

  return { onTimeRangeSelect: undefined, onTimeRangeReset: undefined };
};

export default ChartTimeRangeZoomContext;
