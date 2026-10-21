import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import OneUptimeDate from "../../../Types/Date";
import TimeRangeZoomUtil from "../Charts/TimeRangeZoom/TimeRangeZoomUtil";
import { TimeRangeZoom } from "../Charts/TimeRangeZoom/UseTimeRangeZoom";
import {
  ChartTimeRangeZoomContextValue,
  isTimeRangeZoomFor,
  useChartTimeRangeZoom,
} from "../Charts/TimeRangeZoom/TimeRangeZoomContext";

export interface ViewerTimeRangeZoomOptions {
  /** The window the explorer is showing right now (its host owns it). */
  timeRange: RangeStartAndEndDateTime | undefined;
  /** How the host applies a window a reader dragged out of a chart. */
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  /*
   * How the host applies any other range: the toolbar picker, and the way
   * back out of a zoom.
   */
  onTimeRangeChange:
    | ((timeRange: RangeStartAndEndDateTime) => void)
    | undefined;
}

export interface ViewerTimeRangeZoom {
  /*
   * The zoom the explorer offers every chart inside it (hand it to a
   * TimeRangeZoomProvider), or null when its host cannot apply a zoom. While
   * the explorer follows the zoom around it, this hands that zoom on.
   */
  zoom: TimeRangeZoom | null;
  /** Hand to the volume histogram in place of the host's select handler. */
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  /*
   * Hand to the volume histogram: set only while a zoom can be undone, so
   * the chart offers the double-click exactly when it does something.
   */
  onZoomOut: (() => void) | undefined;
  /** Hand to the toolbar picker in place of the host's change handler. */
  onTimeRangeChange:
    | ((timeRange: RangeStartAndEndDateTime) => void)
    | undefined;
  /*
   * True while the explorer follows the zoom offered around it instead of
   * keeping one of its own (see useViewerTimeRangeZoom). Whoever offers that
   * zoom shows its "Reset zoom" (the telemetry snapshot, beside its badge),
   * so the explorer's picker must not show a second one for the same zoom.
   */
  followsEnclosingZoom: boolean;
}

export type UseViewerTimeRangeZoomFunction = (
  options: ViewerTimeRangeZoomOptions,
) => ViewerTimeRangeZoom;

interface ViewerZoomRecord {
  /** The window the explorer was on before its first zoom. */
  rangeBeforeZoom: RangeStartAndEndDateTime;
  /** The window the latest zoom asked the host for. */
  zoomedTo: RangeStartAndEndDateTime;
  /** The window the explorer was on when that zoom was made. */
  zoomedFrom: RangeStartAndEndDateTime;
  /*
   * True until the host's window first moves off `zoomedFrom`. Until then
   * the host may simply not have applied the zoom yet, so being on
   * `zoomedFrom` still counts as zoomed.
   */
  isAwaitingHost: boolean;
}

interface LatestInputs {
  timeRange: RangeStartAndEndDateTime | undefined;
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeChange:
    | ((timeRange: RangeStartAndEndDateTime) => void)
    | undefined;
  activeRecord: ViewerZoomRecord | null;
  // The zoom around the explorer that it follows, or null.
  followedZoom: ChartTimeRangeZoomContextValue | null;
}

export type ShouldFollowEnclosingZoomFunction = (
  enclosingZoom: ChartTimeRangeZoomContextValue | null,
  timeRange: RangeStartAndEndDateTime | undefined,
) => boolean;

/**
 * Whether an explorer on `timeRange` follows the zoom offered around it
 * (useChartTimeRangeZoom) rather than keeping a zoom of its own.
 *
 * Only a zoom over the explorer's very window is followed: the telemetry
 * snapshot's, which pins its primary explorer to the window the snapshot
 * shows, so a drag on that explorer's histogram is a drag on the snapshot.
 * A zoom over any other range is about a window this explorer does not
 * show (the snapshot's, once the reader has picked a range of the
 * explorer's own in its picker), and a drag here must not retime it. Nor
 * is a zoom that does not say which range it works over (the investigation
 * drawer's, a hand-built one): nothing ties it to this explorer's window.
 */
export const shouldFollowEnclosingZoom: ShouldFollowEnclosingZoomFunction = (
  enclosingZoom: ChartTimeRangeZoomContextValue | null,
  timeRange: RangeStartAndEndDateTime | undefined,
): boolean => {
  if (!enclosingZoom || !enclosingZoom.timeRange || !timeRange) {
    return false;
  }

  return isTimeRangeZoomFor(enclosingZoom, timeRange);
};

type ToEpochMsFunction = (value: unknown) => number;

// NaN for anything that is not a date: a window restored from a URL can hold strings.
const toEpochMs: ToEpochMsFunction = (value: unknown): number => {
  if (value === undefined || value === null || value === "") {
    return Number.NaN;
  }

  try {
    return OneUptimeDate.fromString(value as Date).getTime();
  } catch {
    return Number.NaN;
  }
};

type GetTimeRangeKeyFunction = (
  timeRange: RangeStartAndEndDateTime | undefined,
) => string;

/*
 * The value a range is compared by, as a string an effect can depend on: a
 * host re-rendering with a new but equal object must not look like a move.
 * A relative range is the same range whatever it last resolved to.
 */
const getTimeRangeKey: GetTimeRangeKeyFunction = (
  timeRange: RangeStartAndEndDateTime | undefined,
): string => {
  if (!timeRange) {
    return "";
  }

  if (timeRange.range !== TimeRange.CUSTOM) {
    return timeRange.range;
  }

  return [
    timeRange.range,
    toEpochMs(timeRange.startAndEndDate?.startValue),
    toEpochMs(timeRange.startAndEndDate?.endValue),
  ].join("|");
};

type IsRecordActiveFunction = (
  record: ViewerZoomRecord | null,
  timeRange: RangeStartAndEndDateTime | undefined,
) => boolean;

const isRecordActive: IsRecordActiveFunction = (
  record: ViewerZoomRecord | null,
  timeRange: RangeStartAndEndDateTime | undefined,
): boolean => {
  if (!record || !timeRange) {
    return false;
  }

  if (TimeRangeZoomUtil.isSameRange(timeRange, record.zoomedTo)) {
    return true;
  }

  return (
    record.isAwaitingHost &&
    TimeRangeZoomUtil.isSameRange(timeRange, record.zoomedFrom)
  );
};

/**
 * Drag-to-zoom for an explorer (the logs viewer, and the traces, exceptions
 * and security events viewers on the telemetry shell): the histogram, the
 * analytics charts and the toolbar's "Reset zoom" all share one zoom over
 * the window the explorer's host owns.
 *
 * - A zoom goes to the host's own select handler, which sets a custom window
 *   (and does whatever else the host does on a zoom: turns live mode off,
 *   goes back to page one, lifts the window to a page that shares it).
 * - Only the FIRST zoom is remembered: after drilling from "past hour" into
 *   ten minutes and then into one, a reset returns the whole hour.
 * - The way back goes to the host's change handler, like a picked range.
 * - The zoom is over as soon as the explorer's window is anything other
 *   than the one the zoom asked for: the toolbar picker, a saved view, the
 *   URL or a page steering the explorer are all the reader starting from
 *   somewhere new, and a reset must not jump them back past that. (The
 *   older useHistogramZoom kept the pre-zoom window until the picker was
 *   used, so after a saved view "zoom out" jumped to a window from before
 *   it.) A host that has not applied the zoom yet still counts as zoomed.
 * - The callbacks keep their identity for the life of the explorer, and
 *   read the latest window through a ref.
 * - An explorer whose window is the very one a zoom offered around it is
 *   over (see shouldFollowEnclosingZoom) follows that zoom and keeps none
 *   of its own: a drag on any of its charts goes to that zoom, and so do a
 *   double-click and the way back. The telemetry snapshot of an incident
 *   pins its Logs, Traces or Exceptions explorer to the window its zoom
 *   shows, so a drag on the explorer's histogram retimes the whole
 *   snapshot, every tab of it, and one reset undoes it all. With a zoom of
 *   its own as well there would be two zooms and two ways back, each
 *   undoing only part of what the reader sees.
 */
const useViewerTimeRangeZoom: UseViewerTimeRangeZoomFunction = (
  options: ViewerTimeRangeZoomOptions,
): ViewerTimeRangeZoom => {
  /*
   * Read here, outside the provider the explorer puts around what it
   * renders, so this is always the zoom around the explorer, never its own.
   */
  const enclosingZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();
  const followedZoom: ChartTimeRangeZoomContextValue | null =
    shouldFollowEnclosingZoom(enclosingZoom, options.timeRange)
      ? enclosingZoom
      : null;
  const followsEnclosingZoom: boolean = followedZoom !== null;

  const [record, setRecord] = useState<ViewerZoomRecord | null>(null);

  const activeRecord: ViewerZoomRecord | null =
    !followedZoom && isRecordActive(record, options.timeRange) ? record : null;

  /*
   * Written on every render and again straight after a gesture, so a second
   * gesture that lands before the explorer re-renders sees the first one.
   */
  const latest: React.MutableRefObject<LatestInputs> = useRef<LatestInputs>({
    timeRange: options.timeRange,
    onTimeRangeSelect: options.onTimeRangeSelect,
    onTimeRangeChange: options.onTimeRangeChange,
    activeRecord: activeRecord,
    followedZoom: followedZoom,
  });

  latest.current = {
    timeRange: options.timeRange,
    onTimeRangeSelect: options.onTimeRangeSelect,
    onTimeRangeChange: options.onTimeRangeChange,
    activeRecord: activeRecord,
    followedZoom: followedZoom,
  };

  /*
   * Once the host has applied the zoom, being back on the window the zoom
   * was made from no longer counts; and once the window has moved anywhere
   * else, the record is dropped so a later zoom starts a fresh baseline.
   */
  const timeRangeKey: string = getTimeRangeKey(options.timeRange);

  useEffect(() => {
    setRecord((current: ViewerZoomRecord | null): ViewerZoomRecord | null => {
      if (!current) {
        return current;
      }

      /*
       * An explorer that follows the zoom around it has no zoom of its own:
       * one it made before was left behind when its host moved it onto that
       * zoom's window, and must not come back once it stops following.
       */
      if (latest.current.followedZoom) {
        return null;
      }

      const timeRange: RangeStartAndEndDateTime | undefined =
        latest.current.timeRange;

      if (
        timeRange &&
        TimeRangeZoomUtil.isSameRange(timeRange, current.zoomedTo)
      ) {
        return current.isAwaitingHost
          ? { ...current, isAwaitingHost: false }
          : current;
      }

      if (isRecordActive(current, timeRange)) {
        return current;
      }

      return null;
    });
  }, [timeRangeKey, followsEnclosingZoom]);

  const zoomToTimeRange: (startTime: Date, endTime: Date) => void = useCallback(
    (startTime: Date, endTime: Date): void => {
      const current: LatestInputs = latest.current;

      /*
       * The followed zoom keeps the record and applies the window (the
       * explorer's host follows it there), so the drag is handed over as it
       * came: that zoom cuts it at the end of its own range.
       */
      if (current.followedZoom) {
        current.followedZoom.onTimeRangeSelect(startTime, endTime);
        return;
      }

      if (!current.onTimeRangeSelect) {
        return;
      }

      const zoomedTo: RangeStartAndEndDateTime | null =
        TimeRangeZoomUtil.getZoomedRange({
          startTime: startTime,
          endTime: endTime,
          currentRange: current.timeRange,
        });

      if (!zoomedTo || !zoomedTo.startAndEndDate) {
        return;
      }

      /*
       * Without a window to go back to, or a way to apply one, there is no
       * zoom to undo; the drag still narrows the explorer.
       */
      if (current.timeRange && current.onTimeRangeChange) {
        const nextRecord: ViewerZoomRecord = {
          rangeBeforeZoom: current.activeRecord
            ? current.activeRecord.rangeBeforeZoom
            : current.timeRange,
          zoomedTo: zoomedTo,
          zoomedFrom: current.timeRange,
          isAwaitingHost: true,
        };

        latest.current = { ...current, activeRecord: nextRecord };
        setRecord(nextRecord);
      }

      current.onTimeRangeSelect(
        zoomedTo.startAndEndDate.startValue,
        zoomedTo.startAndEndDate.endValue,
      );
    },
    [],
  );

  const resetZoom: () => void = useCallback((): void => {
    const current: LatestInputs = latest.current;

    /*
     * The way back is the followed zoom's own: it returns everything that
     * zoom retimed, not just this explorer. It is offered only while that
     * zoom is zoomed, so a stray double-click does nothing here either.
     */
    if (current.followedZoom) {
      current.followedZoom.onTimeRangeReset?.();
      return;
    }

    // Nothing to undo: a stray double-click must not retime the explorer.
    if (!current.activeRecord || !current.onTimeRangeChange) {
      return;
    }

    const rangeBeforeZoom: RangeStartAndEndDateTime =
      current.activeRecord.rangeBeforeZoom;

    latest.current = { ...current, activeRecord: null };
    setRecord(null);
    current.onTimeRangeChange(rangeBeforeZoom);
  }, []);

  const pickTimeRange: (timeRange: RangeStartAndEndDateTime) => void =
    useCallback((timeRange: RangeStartAndEndDateTime): void => {
      const current: LatestInputs = latest.current;

      /*
       * A pick is a new starting point even when it names the window the
       * zoom was made from ("past hour" again), which the value check alone
       * could not tell from a host that has not applied the zoom yet.
       */
      latest.current = { ...current, activeRecord: null };
      setRecord(null);
      current.onTimeRangeChange?.(timeRange);
    }, []);

  const canZoom: boolean = Boolean(options.onTimeRangeSelect);

  let isZoomed: boolean =
    activeRecord !== null && Boolean(options.onTimeRangeChange);
  let rangeBeforeZoom: RangeStartAndEndDateTime | null =
    isZoomed && activeRecord ? activeRecord.rangeBeforeZoom : null;

  if (followedZoom) {
    isZoomed = followedZoom.isZoomed && Boolean(followedZoom.onTimeRangeReset);
    rangeBeforeZoom = isZoomed ? followedZoom.rangeBeforeZoom : null;
  }

  /*
   * Handed on with the zoom it belongs to, so the explorer's charts see a
   * zoom over that zoom's range, as if nothing stood in between.
   */
  const followedTimeRange: RangeStartAndEndDateTime | null = followedZoom
    ? followedZoom.timeRange
    : null;

  const zoom: TimeRangeZoom | null = useMemo((): TimeRangeZoom | null => {
    if (!canZoom) {
      return null;
    }

    return {
      isZoomed: isZoomed,
      ...(followedTimeRange ? { timeRange: followedTimeRange } : {}),
      rangeBeforeZoom: rangeBeforeZoom,
      zoomToTimeRange: zoomToTimeRange,
      resetZoom: resetZoom,
    };
  }, [
    canZoom,
    isZoomed,
    followedTimeRange,
    rangeBeforeZoom,
    zoomToTimeRange,
    resetZoom,
  ]);

  return {
    zoom: zoom,
    /*
     * A followed zoom is applied by whoever offers it, so the histogram
     * takes part in it even where the explorer's host could not apply a
     * zoom itself.
     */
    onTimeRangeSelect:
      canZoom || followsEnclosingZoom ? zoomToTimeRange : undefined,
    onZoomOut: isZoomed ? resetZoom : undefined,
    onTimeRangeChange: options.onTimeRangeChange ? pickTimeRange : undefined,
    followsEnclosingZoom: followsEnclosingZoom,
  };
};

export default useViewerTimeRangeZoom;
