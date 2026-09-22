import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  HistogramSelectionWindow,
  getHistogramSelectionWindow,
} from "./HistogramSelection";
import { DOUBLE_CLICK_DISAMBIGUATION_MS } from "../ChartLibrary/Utils/DoubleClick";

/*
 * The part of recharts' chart state the handlers read. `activeLabel` is the
 * category under the pointer: the bucket start of the hovered bar.
 */
export interface HistogramPointerState {
  activeLabel?: string | number | undefined;
}

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
  /** Bucket labels the selection band spans, or null while there is none. */
  selectionStart: string | null;
  selectionEnd: string | null;
  /** True between the press and the release of a selection. */
  isDragging: boolean;
  /** Whether a click on a single bar zooms into it. */
  canClickToZoom: boolean;
  onMouseDown: (state?: HistogramPointerState | null) => void;
  onMouseMove: (state?: HistogramPointerState | null) => void;
  onMouseUp: (state?: HistogramPointerState | null) => void;
  onDoubleClick: () => void;
}

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
 *
 * The release is resolved against refs rather than render state. Recharts
 * delivers `mousemove` on the next animation frame but `mousedown` and
 * `mouseup` straight away, so a quick drag is routinely released before its
 * last move has been rendered - or before any move has arrived at all. The
 * bar under the pointer at release time, which recharts hands to the
 * `mouseup` handler, is the most current answer and wins.
 */
const useHistogramRangeSelection: UseHistogramRangeSelectionFunction = (
  options: HistogramRangeSelectionOptions,
): HistogramRangeSelectionState => {
  const [selectionStart, setSelectionStart] = useState<string | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

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
    };
  }, [cancelPendingClick]);

  const onMouseDown: (state?: HistogramPointerState | null) => void =
    useCallback(
      (state?: HistogramPointerState | null): void => {
        const label: string | null = toLabel(state);

        if (!canSelect || !label) {
          return;
        }

        // A second press before the first click zoomed replaces it.
        cancelPendingClick();

        isSelecting.current = true;
        startLabel.current = label;
        endLabel.current = null;
        setIsDragging(true);
        setSelectionStart(label);
        setSelectionEnd(null);
      },
      [canSelect, cancelPendingClick],
    );

  const onMouseMove: (state?: HistogramPointerState | null) => void =
    useCallback((state?: HistogramPointerState | null): void => {
      const label: string | null = toLabel(state);

      if (!isSelecting.current || !label) {
        return;
      }

      endLabel.current = label;
      setSelectionEnd(label);
    }, []);

  const onMouseUp: (state?: HistogramPointerState | null) => void = useCallback(
    (state?: HistogramPointerState | null): void => {
      if (!isSelecting.current) {
        return;
      }

      isSelecting.current = false;
      setIsDragging(false);

      const from: string | null = startLabel.current;
      const to: string | null = toLabel(state) || endLabel.current || from;

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
      setSelectionEnd(to);

      pendingClick.current = setTimeout(() => {
        pendingClick.current = null;
        clearSelection();
        onTimeRangeSelectRef.current?.(selected.startTime, selected.endTime);
      }, DOUBLE_CLICK_DISAMBIGUATION_MS);
    },
    [bucketIntervalMs, clearSelection, onZoomOut],
  );

  const onDoubleClick: () => void = useCallback((): void => {
    if (cancelPendingClick()) {
      clearSelection();
    }

    onZoomOut?.();
  }, [cancelPendingClick, clearSelection, onZoomOut]);

  /*
   * Readers routinely drag past the edge of a 120px-tall chart and let go
   * outside it, where the chart's own mouseup never fires. Without this the
   * drag would never end: the selection band would stay painted and the
   * tooltip would stay suppressed until the next click.
   */
  useEffect(() => {
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

  return {
    selectionStart: selectionStart,
    selectionEnd: selectionEnd,
    isDragging: isDragging,
    canClickToZoom:
      canSelect &&
      typeof bucketIntervalMs === "number" &&
      Number.isFinite(bucketIntervalMs) &&
      bucketIntervalMs > 0,
    onMouseDown: onMouseDown,
    onMouseMove: onMouseMove,
    onMouseUp: onMouseUp,
    onDoubleClick: onDoubleClick,
  };
};

export default useHistogramRangeSelection;
