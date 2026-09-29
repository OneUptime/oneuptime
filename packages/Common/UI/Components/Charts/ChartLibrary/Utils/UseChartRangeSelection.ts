import React from "react";
import { CHART_DATA_POINT_DATE_KEY } from "../Types/ChartDataPoint";

/*
 * Subset of the recharts MouseHandlerDataParam passed to chart-level
 * mouse handlers — just the fields range selection needs.
 */
export type RangeSelectionChartState = {
  activeTooltipIndex?: number | string | null | undefined;
  activeLabel?: string | number | undefined;
};

export interface ChartBucketWindow {
  start: Date;
  end: Date;
}

type ChartRows = Array<Record<string, unknown>>;

/**
 * The row under the pointer: recharts' active tooltip index when it is a
 * valid row, else the row whose label matches recharts' active label.
 */
export function getChartRowIndex(
  data: ChartRows,
  index: string,
  chartState: RangeSelectionChartState | null | undefined,
): number | null {
  const activeTooltipIndex: number | string | null | undefined =
    chartState?.activeTooltipIndex;
  const numericIndex: number =
    typeof activeTooltipIndex === "number"
      ? activeTooltipIndex
      : Number(activeTooltipIndex);
  if (
    activeTooltipIndex !== undefined &&
    activeTooltipIndex !== null &&
    activeTooltipIndex !== "" &&
    Number.isInteger(numericIndex) &&
    numericIndex >= 0 &&
    numericIndex < data.length
  ) {
    return numericIndex;
  }
  // Fall back to matching activeLabel against the row labels.
  if (chartState?.activeLabel !== undefined) {
    const rowIndex: number = data.findIndex((row: Record<string, unknown>) => {
      return row[index] === chartState.activeLabel;
    });
    return rowIndex >= 0 ? rowIndex : null;
  }
  return null;
}

/** When a row's bucket starts, from the epoch ms every row carries. */
export function getChartBucketStart(
  data: ChartRows,
  rowIndex: number,
): Date | null {
  const rawDate: unknown = data[rowIndex]?.[CHART_DATA_POINT_DATE_KEY];
  return typeof rawDate === "number" ? new Date(rawDate) : null;
}

/**
 * The time rows lowerIndex..upperIndex cover: from the start of the first
 * bucket to the END of the last one. Its end is its start plus one bucket
 * width, derived from the adjacent row (the rows are an evenly spaced
 * grid). A single row with no neighbour has no known width.
 */
export function getChartBucketWindow(
  data: ChartRows,
  lowerIndex: number,
  upperIndex: number,
): ChartBucketWindow | null {
  const start: Date | null = getChartBucketStart(data, lowerIndex);
  const lastBucketStart: Date | null = getChartBucketStart(data, upperIndex);
  if (!start || !lastBucketStart) {
    return null;
  }

  const adjacentDate: Date | null =
    upperIndex > 0
      ? getChartBucketStart(data, upperIndex - 1)
      : getChartBucketStart(data, upperIndex + 1);
  const bucketWidthInMs: number = adjacentDate
    ? Math.abs(lastBucketStart.getTime() - adjacentDate.getTime())
    : 0;

  return {
    start: start,
    end: new Date(lastBucketStart.getTime() + bucketWidthInMs),
  };
}

export interface UseChartRangeSelectionOptions {
  data: ChartRows;
  /** The row key recharts draws the x-axis from (the formatted label). */
  index: string;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  /*
   * false turns selection off even with a handler: a vertical bar chart
   * has its categories on the y-axis, so there is no time to drag across.
   */
  enabled?: boolean | undefined;
}

/*
 * The events recharts may hold for the next animation frame on a chart that
 * offers a drag: its defaults, less "mousemove".
 *
 * recharts works out the bucket under the pointer a frame after each
 * mousemove, but hands mousedown and mouseup to the chart at once, with
 * the bucket it last worked out. So a drag released in the frame of its
 * last move lost the buckets that move crossed, and a press in the frame
 * the pointer arrived started one bucket early, or was dropped outright
 * when the move queued before it (no button held yet) landed after it.
 * Browsers already coalesce mousemove to about one a frame, so taking it
 * at once costs no extra renders.
 */
export const RANGE_SELECTION_THROTTLED_EVENTS: ReadonlyArray<
  keyof GlobalEventHandlersEventMap
> = ["touchmove", "pointermove", "scroll", "wheel"];

const RANGE_SELECTION_ROOT_STYLE: React.CSSProperties = {
  cursor: "crosshair",
};

export interface ChartRangeSelectionRootProps {
  onMouseDown?: (
    chartState: RangeSelectionChartState,
    mouseEvent?: React.MouseEvent<SVGGraphicsElement>,
  ) => void;
  onMouseMove?: (
    chartState: RangeSelectionChartState,
    mouseEvent: React.MouseEvent<SVGGraphicsElement>,
  ) => void;
  onMouseUp?: (chartState?: RangeSelectionChartState | null) => void;
  throttledEvents?: ReadonlyArray<keyof GlobalEventHandlersEventMap>;
  style?: React.CSSProperties;
}

export interface ChartRangeSelection {
  /** Whether the chart offers drag-to-select at all. */
  canSelect: boolean;
  /*
   * Labels of the first and last bucket (in row order) the live selection
   * band spans, or null.
   */
  selectionStartLabel: string | null;
  selectionEndLabel: string | null;
  /*
   * True for the click the browser delivers straight after a drag, which
   * must not also toggle a legend, dot or bar selection.
   */
  isClickSuppressed: () => boolean;
  /** Spread onto the recharts chart root. Empty when canSelect is false. */
  chartEventProps: ChartRangeSelectionRootProps;
}

interface LatestRangeSelectionInputs {
  data: ChartRows;
  index: string;
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
}

/**
 * Drag-to-select a time window on the line, area and bar charts.
 *
 * - A drag across buckets selects from the start of the first to the END
 *   of the last, as soon as the button is released.
 * - A press and release on one bucket is a plain click and keeps its
 *   meaning (a bucket click, a legend toggle); only a real drag selects.
 * - Nothing re-renders until the pointer leaves the bucket it pressed. A
 *   render under a press can replace the node it landed on (recharts
 *   re-keys a line's dots when it redraws them), and a press whose node
 *   is gone by the release gets no click and no dblclick - so a
 *   double-click on a line never reached the chart's zoom reset.
 * - The release is resolved from the bucket recharts reports under the
 *   pointer at mouseup, falling back to the last move. The chart takes
 *   mousemove unthrottled (RANGE_SELECTION_THROTTLED_EVENTS), so that
 *   bucket is the one under the pointer now, not a frame ago.
 * - A drag released outside the chart still selects: readers overshoot a
 *   180px-tall chart all the time, and the chart's own mouseup never fires
 *   there. Before, the drag was abandoned and its band stayed painted until
 *   the pointer came back.
 * - The click the browser fires after a drag is reported as suppressed.
 */
const useChartRangeSelection: (
  options: UseChartRangeSelectionOptions,
) => ChartRangeSelection = (
  options: UseChartRangeSelectionOptions,
): ChartRangeSelection => {
  const canSelect: boolean =
    Boolean(options.onTimeRangeSelect) && options.enabled !== false;

  const [selectionStartLabel, setSelectionStartLabel] = React.useState<
    string | null
  >(null);
  const [selectionEndLabel, setSelectionEndLabel] = React.useState<
    string | null
  >(null);

  /*
   * The refs, not render state, are the authority on a selection in
   * progress: a release can be seen twice (the chart's own mouseup and the
   * page-wide listener below) and must only commit once.
   */
  const isSelecting: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);
  const startIndexRef: React.MutableRefObject<number | null> = React.useRef<
    number | null
  >(null);
  const endIndexRef: React.MutableRefObject<number | null> = React.useRef<
    number | null
  >(null);
  const suppressNextClickRef: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);
  // Whether the band is painted, i.e. the selection is in render state.
  const isBandShownRef: React.MutableRefObject<boolean> =
    React.useRef<boolean>(false);
  // The page-wide mouseup listener of the press in progress, if any.
  const releaseListenerRef: React.MutableRefObject<(() => void) | null> =
    React.useRef<(() => void) | null>(null);

  /*
   * A release outside the chart is handled by a window listener installed
   * a render earlier, so it reads the latest rows and handler from here.
   */
  const latest: React.MutableRefObject<LatestRangeSelectionInputs> =
    React.useRef<LatestRangeSelectionInputs>({
      data: options.data,
      index: options.index,
      onTimeRangeSelect: options.onTimeRangeSelect,
    });
  latest.current = {
    data: options.data,
    index: options.index,
    onTimeRangeSelect: options.onTimeRangeSelect,
  };

  const stopListeningForRelease: () => void = React.useCallback((): void => {
    if (releaseListenerRef.current) {
      window.removeEventListener("mouseup", releaseListenerRef.current);
      releaseListenerRef.current = null;
    }
  }, []);

  const clearSelection: () => void = React.useCallback((): void => {
    isSelecting.current = false;
    startIndexRef.current = null;
    endIndexRef.current = null;
    stopListeningForRelease();
    // A press that never became a drag painted nothing: leave render alone.
    if (isBandShownRef.current) {
      isBandShownRef.current = false;
      setSelectionStartLabel(null);
      setSelectionEndLabel(null);
    }
  }, [stopListeningForRelease]);

  const getLabel: (rowIndex: number) => string | null = React.useCallback(
    (rowIndex: number): string | null => {
      const label: unknown =
        latest.current.data[rowIndex]?.[latest.current.index];
      return typeof label === "string" ? label : null;
    },
    [],
  );

  const onMouseMove: (
    chartState: RangeSelectionChartState,
    mouseEvent: React.MouseEvent<SVGGraphicsElement>,
  ) => void = React.useCallback(
    (
      chartState: RangeSelectionChartState,
      mouseEvent: React.MouseEvent<SVGGraphicsElement>,
    ): void => {
      if (!isSelecting.current) {
        return;
      }
      /*
       * No button held: it came up somewhere no mouseup could be heard
       * (outside the browser window, say). Abandon the selection.
       */
      if (mouseEvent && mouseEvent.buttons === 0) {
        clearSelection();
        return;
      }
      const rowIndex: number | null = getChartRowIndex(
        latest.current.data,
        latest.current.index,
        chartState,
      );
      if (rowIndex === null) {
        return;
      }
      const startIndex: number | null = startIndexRef.current;
      if (startIndex === null || getLabel(rowIndex) === null) {
        return;
      }
      endIndexRef.current = rowIndex;
      // Still on the pressed bucket: a click so far, so paint nothing.
      if (!isBandShownRef.current && rowIndex === startIndex) {
        return;
      }
      /*
       * The band runs between its buckets in row order, whichever way the
       * drag goes: a bar chart draws x1 from the left edge of its bar and
       * x2 to the right edge of its own, so a right-to-left drag in drag
       * order left both end bars unshaded (and two neighbours none).
       */
      const lowerLabel: string | null = getLabel(
        Math.min(startIndex, rowIndex),
      );
      const upperLabel: string | null = getLabel(
        Math.max(startIndex, rowIndex),
      );
      if (lowerLabel === null || upperLabel === null) {
        return;
      }
      isBandShownRef.current = true;
      setSelectionStartLabel(lowerLabel);
      setSelectionEndLabel(upperLabel);
    },
    [clearSelection, getLabel],
  );

  const onMouseUp: (chartState?: RangeSelectionChartState | null) => void =
    React.useCallback(
      (chartState?: RangeSelectionChartState | null): void => {
        if (!isSelecting.current) {
          return;
        }

        const releaseIndex: number | null = chartState
          ? getChartRowIndex(
              latest.current.data,
              latest.current.index,
              chartState,
            )
          : null;
        const startIndex: number | null = startIndexRef.current;
        const endIndex: number | null =
          releaseIndex !== null ? releaseIndex : endIndexRef.current;
        clearSelection();

        /*
         * A plain click (the pointer never left the starting bucket) must
         * keep behaving exactly as before — only a real drag selects.
         */
        if (
          startIndex === null ||
          endIndex === null ||
          startIndex === endIndex
        ) {
          return;
        }

        /*
         * The browser fires a click right after mouseup; swallow it so a
         * drag doesn't also toggle a legend, dot or bar selection. Cleared
         * on a timeout so a never-delivered click can't suppress a later
         * one.
         */
        suppressNextClickRef.current = true;
        setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);

        const selectedWindow: ChartBucketWindow | null = getChartBucketWindow(
          latest.current.data,
          Math.min(startIndex, endIndex),
          Math.max(startIndex, endIndex),
        );
        if (!selectedWindow) {
          return;
        }

        latest.current.onTimeRangeSelect?.(
          selectedWindow.start,
          selectedWindow.end,
        );
      },
      [clearSelection],
    );

  const onMouseDown: (
    chartState: RangeSelectionChartState,
    mouseEvent?: React.MouseEvent<SVGGraphicsElement>,
  ) => void = React.useCallback(
    (
      chartState: RangeSelectionChartState,
      mouseEvent?: React.MouseEvent<SVGGraphicsElement>,
    ): void => {
      // Only the main button drags; a right-click opens a context menu.
      if (mouseEvent && mouseEvent.button > 0) {
        return;
      }
      const rowIndex: number | null = getChartRowIndex(
        latest.current.data,
        latest.current.index,
        chartState,
      );
      if (rowIndex === null || getLabel(rowIndex) === null) {
        return;
      }
      clearSelection();
      isSelecting.current = true;
      startIndexRef.current = rowIndex;
      endIndexRef.current = rowIndex;

      /*
       * A drag released outside the chart: the chart's own mouseup never
       * fires, so listen on the window until the press ends. A release
       * over the chart reaches the chart's handler first (React listens
       * below the window), which ends the press and removes this listener
       * before the window hears it. Added here rather than from render
       * state so the press itself renders nothing (see above).
       */
      const finishPressOutsideChart: () => void = (): void => {
        onMouseUp(null);
      };
      releaseListenerRef.current = finishPressOutsideChart;
      window.addEventListener("mouseup", finishPressOutsideChart);
    },
    [clearSelection, getLabel, onMouseUp],
  );

  // A chart unmounted mid-press stops listening for its release.
  React.useEffect(() => {
    return () => {
      stopListeningForRelease();
    };
  }, [stopListeningForRelease]);

  const isClickSuppressed: () => boolean = React.useCallback((): boolean => {
    return suppressNextClickRef.current;
  }, []);

  return {
    canSelect: canSelect,
    selectionStartLabel: selectionStartLabel,
    selectionEndLabel: selectionEndLabel,
    isClickSuppressed: isClickSuppressed,
    chartEventProps: canSelect
      ? {
          onMouseDown: onMouseDown,
          onMouseMove: onMouseMove,
          onMouseUp: onMouseUp,
          throttledEvents: RANGE_SELECTION_THROTTLED_EVENTS,
          /*
           * The crosshair that says the plot can be dragged. It has to be
           * on the chart root: recharts gives its wrapper, which fills the
           * plot, an inline cursor: default that a class outside can't
           * beat. Left off entirely otherwise - an explicit undefined
           * would drop recharts' default too.
           */
          style: RANGE_SELECTION_ROOT_STYLE,
        }
      : {},
  };
};

export default useChartRangeSelection;
