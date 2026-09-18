import { useCallback, useState } from "react";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";

export interface HistogramZoomOptions {
  /** The window the explorer is showing right now. */
  timeRange?: RangeStartAndEndDateTime | undefined;
  /** Applies a range the reader dragged out on the histogram. */
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  /** Applies a range picked anywhere else (the toolbar picker, a reset). */
  onTimeRangeChange?:
    | ((timeRange: RangeStartAndEndDateTime) => void)
    | undefined;
}

export interface HistogramZoomState {
  /** Hand to the histogram in place of the raw select handler. */
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  /**
   * Hand to the histogram: set only while a drag-zoom is in effect, so the
   * chart can both offer the affordance and act on a double-click.
   */
  onZoomOut: (() => void) | undefined;
  /** Hand to the time range picker in place of the raw change handler. */
  onTimeRangeChange:
    | ((timeRange: RangeStartAndEndDateTime) => void)
    | undefined;
}

export type UseHistogramZoomFunction = (
  options: HistogramZoomOptions,
) => HistogramZoomState;

/**
 * Remembers the window a reader was on before they dragged a zoom out of the
 * histogram, so a double-click can put them back on it.
 *
 * Only the *first* zoom is remembered: after drilling from "past one hour"
 * into a minute and then into ten seconds, one double-click returns the whole
 * hour rather than making the reader climb back out a level at a time. Any
 * time range picked by other means — the toolbar picker, a saved view — is
 * the reader choosing a new starting point, so it forgets what it held and
 * the zoom-out affordance goes away until the next drag.
 */
const useHistogramZoom: UseHistogramZoomFunction = (
  options: HistogramZoomOptions,
): HistogramZoomState => {
  const [rangeBeforeZoom, setRangeBeforeZoom] =
    useState<RangeStartAndEndDateTime | null>(null);

  const timeRange: RangeStartAndEndDateTime | undefined = options.timeRange;
  const onTimeRangeSelect:
    | ((startTime: Date, endTime: Date) => void)
    | undefined = options.onTimeRangeSelect;
  const onTimeRangeChange:
    | ((timeRange: RangeStartAndEndDateTime) => void)
    | undefined = options.onTimeRangeChange;

  const handleTimeRangeSelect: (startTime: Date, endTime: Date) => void =
    useCallback(
      (startTime: Date, endTime: Date): void => {
        if (!onTimeRangeSelect) {
          return;
        }

        if (timeRange) {
          setRangeBeforeZoom((current: RangeStartAndEndDateTime | null) => {
            return current || timeRange;
          });
        }

        onTimeRangeSelect(startTime, endTime);
      },
      [onTimeRangeSelect, timeRange],
    );

  const handleZoomOut: () => void = useCallback((): void => {
    if (!rangeBeforeZoom || !onTimeRangeChange) {
      return;
    }

    setRangeBeforeZoom(null);
    onTimeRangeChange(rangeBeforeZoom);
  }, [rangeBeforeZoom, onTimeRangeChange]);

  const handleTimeRangeChange: (timeRange: RangeStartAndEndDateTime) => void =
    useCallback(
      (nextTimeRange: RangeStartAndEndDateTime): void => {
        setRangeBeforeZoom(null);
        onTimeRangeChange?.(nextTimeRange);
      },
      [onTimeRangeChange],
    );

  return {
    onTimeRangeSelect: onTimeRangeSelect ? handleTimeRangeSelect : undefined,
    onZoomOut: rangeBeforeZoom && onTimeRangeChange ? handleZoomOut : undefined,
    onTimeRangeChange: onTimeRangeChange ? handleTimeRangeChange : undefined,
  };
};

export default useHistogramZoom;
