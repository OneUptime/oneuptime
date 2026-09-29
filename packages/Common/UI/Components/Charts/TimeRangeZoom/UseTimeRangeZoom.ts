import React, { useCallback, useEffect, useRef, useState } from "react";
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
  /*
   * The range this zoom works over right now: the page's current range.
   * Lets a picker or a card tell the zoom of ITS range apart from one an
   * enclosing page or chart offers over a different range. Optional so a
   * zoom that cannot say (a hand-built one) is still usable; it is then
   * taken to be the range's.
   */
  timeRange?: RangeStartAndEndDateTime | undefined;
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
  /** The range the page was on when the latest zoom was made. */
  zoomedFrom: RangeStartAndEndDateTime;
  /*
   * True until the page first shows `zoomedTo`. Until then the page may
   * simply not have applied the zoom yet (one that sets its range a render
   * later), so still being on `zoomedFrom` does not end the zoom.
   */
  isAwaitingHost: boolean;
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
 * - Once the page has moved off that window the zoom is forgotten, not set
 *   aside. A page that later comes back to the very same window (a saved
 *   view of it, the same custom range picked by hand) is on a new starting
 *   point too: it offers no "Reset zoom", and a zoom made there resets to
 *   that window, not to a range from before an abandoned zoom. A page that
 *   applies the zoom a render late still counts as zoomed once it does.
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

  /*
   * Drops the record once the page's range is anywhere but the zoomed
   * window, so the zoom cannot come back if the page returns there later.
   * Keyed on the range's value: a page that re-states its range in a new
   * object on every render has not moved. The page is still allowed to be
   * where the zoom was made from until it first shows the zoomed window.
   */
  const timeRangeKey: string = TimeRangeZoomUtil.getRangeKey(options.timeRange);

  useEffect(() => {
    setZoomRecord((current: ZoomRecord | null): ZoomRecord | null => {
      if (!current) {
        return current;
      }

      const timeRange: RangeStartAndEndDateTime = latest.current.timeRange;

      if (TimeRangeZoomUtil.isSameRange(timeRange, current.zoomedTo)) {
        return current.isAwaitingHost
          ? { ...current, isAwaitingHost: false }
          : current;
      }

      if (
        current.isAwaitingHost &&
        TimeRangeZoomUtil.isSameRange(timeRange, current.zoomedFrom)
      ) {
        return current;
      }

      return null;
    });
  }, [timeRangeKey]);

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
        zoomedFrom: current.timeRange,
        isAwaitingHost: true,
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
    timeRange: options.timeRange,
    rangeBeforeZoom: activeZoom ? activeZoom.rangeBeforeZoom : null,
    zoomToTimeRange: zoomToTimeRange,
    resetZoom: resetZoom,
  };
};

export default useTimeRangeZoom;
