import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  HistogramSelectionWindow,
  getHistogramSelectionWindow,
} from "./HistogramSelection";
import {
  ChartPointerEvent,
  DOUBLE_CLICK_DISAMBIGUATION_MS,
  DoubleClickReset,
  useDoubleClickReset,
} from "../ChartLibrary/Utils/DoubleClick";
import { RANGE_SELECTION_THROTTLED_EVENTS } from "../ChartLibrary/Utils/UseChartRangeSelection";
import OneUptimeDate from "../../../../Types/Date";

/*
 * The part of recharts' chart state the handlers read. `activeLabel` is the
 * category under the pointer: the bucket start of the hovered bar.
 */
export interface HistogramPointerState {
  activeLabel?: string | number | undefined;
}

/*
 * How far the pointer may wander from where it was pressed and still be a
 * pointer that has not moved: a hand on a mouse is never quite still.
 */
export const HISTOGRAM_PRESS_STILLNESS_PX: number = 3;

export interface HistogramRangeSelectionOptions {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onZoomOut?: (() => void) | undefined;
  /*
   * How much time one bar covers. Without it a selection can only run from
   * label to label, so a click on a single bar selects nothing.
   */
  bucketIntervalMs?: number | undefined;
}

export interface HistogramRangeSelectionState {
  /*
   * Labels of the first and last bar (in time order) the selection band
   * spans, or null while there is none.
   */
  selectionStart: string | null;
  selectionEnd: string | null;
  /*
   * True while a selection drags across bars - from the move that leaves
   * the pressed bar to the release. A press that stays put is a click.
   */
  isDragging: boolean;
  /** Whether a click on a single bar zooms into it. */
  canClickToZoom: boolean;
  /*
   * Spread onto the host's recharts chart root. recharts works out the bar
   * under the pointer a frame after each mousemove by default, but hands
   * mousedown and mouseup over at once, with the bar it last worked out -
   * so a quick drag started a bar early or lost its last bars; a
   * selectable histogram takes mousemove unthrottled (see
   * RANGE_SELECTION_THROTTLED_EVENTS). Empty when nothing can be selected,
   * which leaves recharts' default alone.
   */
  chartRootProps: HistogramChartRootProps;
  /*
   * The chart root's mouse handlers. recharts hands them its state and the
   * React event; the event is optional so a caller without one still gets
   * the label-only behaviour.
   */
  onMouseDown: (
    state?: HistogramPointerState | null,
    event?: ChartPointerEvent | null,
  ) => void;
  onMouseMove: (
    state?: HistogramPointerState | null,
    event?: ChartPointerEvent | null,
  ) => void;
  onMouseUp: (
    state?: HistogramPointerState | null,
    event?: ChartPointerEvent | null,
  ) => void;
  onDoubleClick: () => void;
}

export interface HistogramChartRootProps {
  throttledEvents?: ReadonlyArray<keyof GlobalEventHandlersEventMap>;
}

const SELECTABLE_CHART_ROOT_PROPS: HistogramChartRootProps = {
  throttledEvents: RANGE_SELECTION_THROTTLED_EVENTS,
};

const INERT_CHART_ROOT_PROPS: HistogramChartRootProps = {};

export type UseHistogramRangeSelectionFunction = (
  options: HistogramRangeSelectionOptions,
) => HistogramRangeSelectionState;

function toLabel(state?: HistogramPointerState | null): string | null {
  const label: string | number | undefined = state?.activeLabel;

  if (label === undefined || label === null || label === "") {
    return null;
  }

  return String(label);
}

/*
 * Two bars' labels in time order. recharts draws a band's x1 from the left
 * edge of its bar and x2 to the right edge of its own, so a band in drag
 * order shaded neither end bar of a right-to-left drag (and nothing at all
 * across two neighbours). Labels that are not dates keep their order.
 */
function inTimeOrder(first: string, second: string): [string, string] {
  const firstMs: number = OneUptimeDate.fromString(first).getTime();
  const secondMs: number = OneUptimeDate.fromString(second).getTime();

  if (
    Number.isFinite(firstMs) &&
    Number.isFinite(secondMs) &&
    secondMs < firstMs
  ) {
    return [second, first];
  }

  return [first, second];
}

/**
 * Click-or-drag range selection on a time histogram.
 *
 * - A drag across bars zooms into every bar it covered, the last one
 *   included, as soon as the pointer is released.
 * - A click on one bar (or a drag that never left it) zooms into that bar.
 *   While the chart is zoomed, a double-click means "zoom back out", and the
 *   browser delivers both of its clicks before the `dblclick` - so there the
 *   click waits DOUBLE_CLICK_DISAMBIGUATION_MS and a second press or the
 *   double-click cancels it. An unzoomed chart has no double-click gesture
 *   and zooms at once.
 * - On a zoomed chart the second press of a double-click is the zoom-out
 *   and nothing else, and it zooms out even when the browser never sends
 *   the `dblclick` (see useDoubleClickReset). That is what happens when the
 *   chart's new bars land during the press, which, right after a zoom, is
 *   when readers double-click.
 * - A press becomes a drag only once the POINTER leaves its bar. New bars
 *   landing under a pointer that has not moved are not a drag, and a press
 *   whose bar is gone from under its still pointer by the release zooms
 *   nowhere: the reader pressed a bar that is no longer on the chart.
 *
 * The release is resolved against refs rather than render state, from the
 * bar recharts hands the `mouseup` handler, falling back to the last move.
 * That bar is the one under the pointer now only if the host spreads
 * `chartRootProps` onto its chart root (see the field).
 *
 * A press renders nothing until the pointer leaves its bar. A render under
 * a press can take away the node it landed on (a band repainted under the
 * pointer, say), and a press whose node is gone by the release gets no
 * click and no dblclick - the second click of a double-click lands on the
 * band the first one painted.
 */
const useHistogramRangeSelection: UseHistogramRangeSelectionFunction = (
  options: HistogramRangeSelectionOptions,
): HistogramRangeSelectionState => {
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  // Whether the pointer has left the pressed bar (a drag, not a click).
  const hasLeftPressedBar: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  // Where the press in progress went down, when recharts said.
  const pressClientX: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  // The page-wide mouseup listener of the press in progress, if any.
  const releaseListener: React.MutableRefObject<(() => void) | null> = useRef<
    (() => void) | null
  >(null);

  /*
   * The ref stays the authority on whether a selection is in progress, so a
   * release seen twice (the chart's handler *and* the page-wide listener
   * below) cannot commit the same selection twice.
   */
  const isSelecting: React.MutableRefObject<boolean> = useRef<boolean>(false);
  const startLabel: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const endLabel: React.MutableRefObject<string | null> = useRef<string | null>(
    null,
  );
  const pendingClick: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * A click zooms after a delay, by which time the host may have re-rendered
   * with a new handler (one that knows the latest window). Read the current
   * one when the zoom actually happens.
   */
  const onTimeRangeSelectRef: React.MutableRefObject<
    ((startTime: Date, endTime: Date) => void) | undefined
  > = useRef(options.onTimeRangeSelect);
  onTimeRangeSelectRef.current = options.onTimeRangeSelect;

  const bucketIntervalMs: number | undefined = options.bucketIntervalMs;
  const onZoomOut: (() => void) | undefined = options.onZoomOut;
  const canSelect: boolean = Boolean(options.onTimeRangeSelect);

  const clearSelection: () => void = useCallback((): void => {
    startLabel.current = null;
    endLabel.current = null;
    setSelectionStart(null);
    setSelectionEnd(null);
  }, []);

  const stopListeningForRelease: () => void = useCallback((): void => {
    if (releaseListener.current) {
      window.removeEventListener("mouseup", releaseListener.current);
      releaseListener.current = null;
    }
  }, []);

  const cancelPendingClick: () => boolean = useCallback((): boolean => {
    if (pendingClick.current === null) {
      return false;
    }

    clearTimeout(pendingClick.current);
    pendingClick.current = null;
    return true;
  }, []);

  useEffect(() => {
    return () => {
      cancelPendingClick();
      stopListeningForRelease();
    };
  }, [cancelPendingClick, stopListeningForRelease]);

  /*
   * The zoom-out, while the chart offers one: the click waiting to zoom in
   * goes, and so does its band.
   */
  const zoomOut: (() => void) | undefined = onZoomOut
    ? (): void => {
        cancelPendingClick();
        clearSelection();
        onZoomOut();
      }
    : undefined;
  const doubleClickReset: DoubleClickReset = useDoubleClickReset(zoomOut);

  /*
   * Whether the pointer has left the spot the press went down on. Without
   * positions to go by (a caller that hands no event), it has: any change
   * of bar counts, as it always did.
   */
  const hasPointerMoved: (event?: ChartPointerEvent | null) => boolean =
    useCallback((event?: ChartPointerEvent | null): boolean => {
      const clientX: number | undefined = event?.clientX;

      if (pressClientX.current === null || typeof clientX !== "number") {
        return true;
      }

      return (
        Math.abs(clientX - pressClientX.current) > HISTOGRAM_PRESS_STILLNESS_PX
      );
    }, []);

  /*
   * The page-wide release listener is added by a press and calls the
   * newest onMouseUp, whatever the host re-rendered with meanwhile.
   */
  const onMouseUpRef: React.MutableRefObject<
    (
      state?: HistogramPointerState | null,
      event?: ChartPointerEvent | null,
    ) => void
  > = useRef<
    (
      state?: HistogramPointerState | null,
      event?: ChartPointerEvent | null,
    ) => void
  >(() => {});

  /*
   * Readers routinely drag past the edge of a 120px-tall chart and let go
   * outside it, where the chart's own mouseup never fires. Listen on the
   * page until the press ends; a release over the chart reaches the
   * chart's handler first, which removes this listener before the page
   * hears it.
   */
  const listenForReleaseOffChart: () => void = useCallback((): void => {
    stopListeningForRelease();
    const finishPressOutsideChart: () => void = (): void => {
      onMouseUpRef.current(null);
    };
    releaseListener.current = finishPressOutsideChart;
    window.addEventListener("mouseup", finishPressOutsideChart);
  }, [stopListeningForRelease]);

  const onMouseDown: (
    state?: HistogramPointerState | null,
    event?: ChartPointerEvent | null,
  ) => void = useCallback(
    (
      state?: HistogramPointerState | null,
      event?: ChartPointerEvent | null,
    ): void => {
      /*
       * The second press of a double-click on a zoomed chart: the zoom-out,
       * on its release, wherever that is (the page hears a release off the
       * chart, as for a drag below). The first click must not zoom in; its
       * band stays until the zoom-out clears it, because this press may
       * have landed on it and a render now would take that node away.
       */
      if (doubleClickReset.onPress(event)) {
        cancelPendingClick();
        isSelecting.current = false;
        listenForReleaseOffChart();
        return;
      }

      const label: string | null = toLabel(state);

      if (!canSelect || !label) {
        return;
      }

      /*
       * A second press before the first click zoomed replaces it. The
       * band that click painted stays until this press ends: this may be
       * the second click of a double-click, landing on that band.
       */
      cancelPendingClick();

      isSelecting.current = true;
      hasLeftPressedBar.current = false;
      startLabel.current = label;
      endLabel.current = null;
      pressClientX.current =
        typeof event?.clientX === "number" ? event.clientX : null;

      listenForReleaseOffChart();
    },
    [canSelect, cancelPendingClick, doubleClickReset, listenForReleaseOffChart],
  );

  const onMouseMove: (
    state?: HistogramPointerState | null,
    event?: ChartPointerEvent | null,
  ) => void = useCallback(
    (
      state?: HistogramPointerState | null,
      event?: ChartPointerEvent | null,
    ): void => {
      const label: string | null = toLabel(state);
      const from: string | null = startLabel.current;

      if (!isSelecting.current || !label || !from) {
        return;
      }

      if (!hasLeftPressedBar.current) {
        // Still on the pressed bar: a click so far, so paint nothing.
        if (label === from) {
          endLabel.current = label;
          return;
        }

        /*
         * Another bar under a pointer that has not moved: the bars changed
         * under the press (the chart's new data landed), the pointer did
         * not leave its bar. Not a drag.
         */
        if (!hasPointerMoved(event)) {
          return;
        }
      }

      endLabel.current = label;
      hasLeftPressedBar.current = true;
      const [first, last]: [string, string] = inTimeOrder(from, label);
      setSelectionStart(first);
      setSelectionEnd(last);
      setIsDragging(true);
    },
    [hasPointerMoved],
  );

  const onMouseUp: (
    state?: HistogramPointerState | null,
    event?: ChartPointerEvent | null,
  ) => void = useCallback(
    (
      state?: HistogramPointerState | null,
      event?: ChartPointerEvent | null,
    ): void => {
      // The end of a double-click's second press: the zoom-out, nothing else.
      if (doubleClickReset.onRelease()) {
        stopListeningForRelease();
        return;
      }

      if (!isSelecting.current) {
        return;
      }

      isSelecting.current = false;
      stopListeningForRelease();
      setIsDragging(false);

      const from: string | null = startLabel.current;
      const releaseLabel: string | null = toLabel(state);
      let to: string | null = from;

      if (hasLeftPressedBar.current || hasPointerMoved(event)) {
        // A drag, or a flick released before any of its moves came in.
        to = releaseLabel || endLabel.current || from;
      } else if (releaseLabel && releaseLabel !== from) {
        /*
         * The pointer never left the bar it pressed, yet another bar is
         * under it now: the chart's data changed during the press, and the
         * pressed bar is gone. Not a drag the reader never made, nor a
         * zoom into a bar that is no longer shown.
         */
        clearSelection();
        return;
      }

      if (!from || !to) {
        clearSelection();
        return;
      }

      const selected: HistogramSelectionWindow | null =
        getHistogramSelectionWindow({
          fromBucket: from,
          toBucket: to,
          bucketIntervalMs: bucketIntervalMs,
        });

      if (!selected) {
        clearSelection();
        return;
      }

      /*
       * A drag cannot be half of a double-click, and nor can a click on a
       * chart that has no double-click gesture.
       */
      if (from !== to || !onZoomOut) {
        clearSelection();
        onTimeRangeSelectRef.current?.(selected.startTime, selected.endTime);
        return;
      }

      /*
       * One bar on a zoomed chart. Keep it highlighted while the click
       * waits out the double-click window, so the reader sees what is about
       * to open.
       */
      endLabel.current = to;
      setSelectionStart(from);
      setSelectionEnd(to);

      pendingClick.current = setTimeout(() => {
        pendingClick.current = null;
        clearSelection();
        onTimeRangeSelectRef.current?.(selected.startTime, selected.endTime);
      }, DOUBLE_CLICK_DISAMBIGUATION_MS);
    },
    [
      bucketIntervalMs,
      clearSelection,
      doubleClickReset,
      hasPointerMoved,
      onZoomOut,
      stopListeningForRelease,
    ],
  );
  onMouseUpRef.current = onMouseUp;

  const onDoubleClick: () => void = useCallback((): void => {
    // Neither click of a double-click zooms in, whatever else it does.
    if (cancelPendingClick()) {
      clearSelection();
    }

    doubleClickReset.onDoubleClick();
  }, [cancelPendingClick, clearSelection, doubleClickReset]);

  return {
    selectionStart: selectionStart,
    selectionEnd: selectionEnd,
    isDragging: isDragging,
    canClickToZoom:
      canSelect &&
      typeof bucketIntervalMs === "number" &&
      Number.isFinite(bucketIntervalMs) &&
      bucketIntervalMs > 0,
    chartRootProps: canSelect
      ? SELECTABLE_CHART_ROOT_PROPS
      : INERT_CHART_ROOT_PROPS,
    onMouseDown: onMouseDown,
    onMouseMove: onMouseMove,
    onMouseUp: onMouseUp,
    onDoubleClick: onDoubleClick,
  };
};

export default useHistogramRangeSelection;
