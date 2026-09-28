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

export interface ChartRechartsMouseHandlers {
  onMouseDown?: (chartState: RangeSelectionChartState) => void;
  onMouseMove?: (
    chartState: RangeSelectionChartState,
    mouseEvent: React.MouseEvent<SVGGraphicsElement>,
  ) => void;
  onMouseUp?: (chartState?: RangeSelectionChartState | null) => void;
}

export interface ChartRangeSelection {
  /** Whether the chart offers drag-to-select at all. */
  canSelect: boolean;
  /** Labels of the buckets the live selection band spans, or null. */
  selectionStartLabel: string | null;
  selectionEndLabel: string | null;
  /*
   * True for the click the browser delivers straight after a drag, which
   * must not also toggle a legend, dot or bar selection.
   */
  isClickSuppressed: () => boolean;
  /** Spread onto the recharts chart root. Empty when canSelect is false. */
  chartEventProps: ChartRechartsMouseHandlers;
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
 * - The release is resolved from the bucket recharts reports under the
 *   pointer at mouseup, falling back to the last move. recharts delivers
 *   mousemove on the next animation frame but mousedown and mouseup at
 *   once, so a quick drag is routinely released before its last move has
 *   been processed - reading only the last move lost the final bucket.
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
  const [isDragging, setIsDragging] = React.useState<boolean>(false);

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

  const clearSelection: () => void = React.useCallback((): void => {
    isSelecting.current = false;
    startIndexRef.current = null;
    endIndexRef.current = null;
    setSelectionStartLabel(null);
    setSelectionEndLabel(null);
    setIsDragging(false);
  }, []);

  const getLabel: (rowIndex: number) => string | null = React.useCallback(
    (rowIndex: number): string | null => {
      const label: unknown =
        latest.current.data[rowIndex]?.[latest.current.index];
      return typeof label === "string" ? label : null;
    },
    [],
  );

  const onMouseDown: (chartState: RangeSelectionChartState) => void =
    React.useCallback(
      (chartState: RangeSelectionChartState): void => {
        const rowIndex: number | null = getChartRowIndex(
          latest.current.data,
          latest.current.index,
          chartState,
        );
        if (rowIndex === null) {
          return;
        }
        const rowLabel: string | null = getLabel(rowIndex);
        if (rowLabel === null) {
          return;
        }
        isSelecting.current = true;
        startIndexRef.current = rowIndex;
        endIndexRef.current = rowIndex;
        setSelectionStartLabel(rowLabel);
        setSelectionEndLabel(null);
        setIsDragging(true);
      },
      [getLabel],
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
      const rowLabel: string | null = getLabel(rowIndex);
      if (rowLabel === null) {
        return;
      }
      endIndexRef.current = rowIndex;
      setSelectionEndLabel(rowLabel);
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

  /*
   * A drag released outside the chart: the chart's own mouseup never
   * fires, so listen on the window for as long as a drag is in progress.
   * A release over the chart reaches the chart's handler first (React
   * listens below the window) and ends the selection, so this is then a
   * no-op.
   */
  React.useEffect(() => {
    if (!isDragging) {
      return undefined;
    }

    const finishDragOutsideChart: () => void = (): void => {
      onMouseUp(null);
    };

    window.addEventListener("mouseup", finishDragOutsideChart);

    return () => {
      window.removeEventListener("mouseup", finishDragOutsideChart);
    };
  }, [isDragging, onMouseUp]);

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
        }
      : {},
  };
};

export default useChartRangeSelection;
