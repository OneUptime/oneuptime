import React, { useCallback, useRef, useState } from "react";
import RangeStartAndEndDateTime from "../../../../Types/Time/RangeStartAndEndDateTime";
import TimeRangeZoomUtil from "./TimeRangeZoomUtil";

export interface UseTimeRangeZoomOptions {
  /** The range the page is showing right now. */
  timeRange: RangeStartAndEndDateTime;
  /** How the page changes its range: a zoom and a reset both go through it. */
  onTimeRangeChange: (timeRange: RangeStartAndEndDateTime) => void;
}

export interface TimeRangeZoom {
  /** True while the page is on a window a chart drag zoomed it to. */
  isZoomed: boolean;
  /** The range a reset returns to; null while the page is not zoomed. */
  rangeBeforeZoom: RangeStartAndEndDateTime | null;
  /** A drag-selection on any chart: zooms the whole page to that window. */
  zoomToTimeRange: (startTime: Date, endTime: Date) => void;
  /** A double-click on any chart, or a reset button: undoes the zoom. */
  resetZoom: () => void;
}

export type UseTimeRangeZoomFunction = (
  options: UseTimeRangeZoomOptions,
) => TimeRangeZoom;

interface ZoomRecord {
  /** The range the page was on before its first zoom. */
  rangeBeforeZoom: RangeStartAndEndDateTime;
  /** The window the latest zoom asked the page for. */
  zoomedTo: RangeStartAndEndDateTime;
}

interface LatestZoomInputs {
  timeRange: RangeStartAndEndDateTime;
  onTimeRangeChange: (timeRange: RangeStartAndEndDateTime) => void;
  activeZoom: ZoomRecord | null;
}

/**
 * Page-wide drag-to-zoom over a range the page already owns.
 *
 * A page keeps its time range wherever it always has (component state, the
 * URL, a saved view) and hands it here together with its setter. A drag on
 * any chart then retimes the whole page, and a reset puts the page back on
 * the range it had before the zoom.
 *
 * - Only the FIRST zoom is remembered. After drilling from "past hour" into
 *   ten minutes and then into one, a single reset returns the whole hour
 *   rather than making the reader climb back out a level at a time. This
 *   matches the dashboards, the log and trace histograms and the metric
 *   explorer.
 * - Any other change of range (the time picker, a saved view, the URL) is
 *   the reader choosing a new starting point. The zoom is over, and the
 *   reset affordance goes away with it. No wrapper around the picker is
 *   needed for that: the page is "zoomed" only while its range is still the
 *   window the last zoom asked for, compared by value.
 * - zoomToTimeRange and resetZoom keep their identity for the life of the
 *   page. Charts downstream are often memoized on comparators that ignore
 *   function props, so a callback that changed identity could leave a chart
 *   holding a closure over a stale range.
 */
const useTimeRangeZoom: UseTimeRangeZoomFunction = (
  options: UseTimeRangeZoomOptions,
): TimeRangeZoom => {
  const [zoomRecord, setZoomRecord] = useState<ZoomRecord | null>(null);

  const activeZoom: ZoomRecord | null =
    zoomRecord &&
    TimeRangeZoomUtil.isSameRange(options.timeRange, zoomRecord.zoomedTo)
      ? zoomRecord
      : null;

  /*
   * The callbacks read the latest inputs through this ref so they can stay
   * identity-stable. It is also written straight after a zoom or a reset,
   * so a second gesture that lands before the page re-renders still sees
   * the first one.
   */
  const latest: React.MutableRefObject<LatestZoomInputs> =
    useRef<LatestZoomInputs>({
      timeRange: options.timeRange,
      onTimeRangeChange: options.onTimeRangeChange,
      activeZoom: activeZoom,
    });

  latest.current = {
    timeRange: options.timeRange,
    onTimeRangeChange: options.onTimeRangeChange,
    activeZoom: activeZoom,
  };

  const zoomToTimeRange: (startTime: Date, endTime: Date) => void = useCallback(
    (startTime: Date, endTime: Date): void => {
      const current: LatestZoomInputs = latest.current;

      const zoomedTo: RangeStartAndEndDateTime | null =
        TimeRangeZoomUtil.getZoomedRange({
          startTime: startTime,
          endTime: endTime,
          currentRange: current.timeRange,
        });

      if (!zoomedTo) {
        return;
      }

      const nextRecord: ZoomRecord = {
        rangeBeforeZoom: current.activeZoom
          ? current.activeZoom.rangeBeforeZoom
          : current.timeRange,
        zoomedTo: zoomedTo,
      };

      latest.current = {
        ...current,
        timeRange: zoomedTo,
        activeZoom: nextRecord,
      };

      setZoomRecord(nextRecord);
      current.onTimeRangeChange(zoomedTo);
    },
    [],
  );

  const resetZoom: () => void = useCallback((): void => {
    const current: LatestZoomInputs = latest.current;

    // Nothing to undo: a stray double-click must not retime the page.
    if (!current.activeZoom) {
      return;
    }

    const rangeBeforeZoom: RangeStartAndEndDateTime =
      current.activeZoom.rangeBeforeZoom;

    latest.current = {
      ...current,
      timeRange: rangeBeforeZoom,
      activeZoom: null,
    };

    setZoomRecord(null);
    current.onTimeRangeChange(rangeBeforeZoom);
  }, []);

  return {
    isZoomed: activeZoom !== null,
    rangeBeforeZoom: activeZoom ? activeZoom.rangeBeforeZoom : null,
    zoomToTimeRange: zoomToTimeRange,
    resetZoom: resetZoom,
  };
};

export default useTimeRangeZoom;
