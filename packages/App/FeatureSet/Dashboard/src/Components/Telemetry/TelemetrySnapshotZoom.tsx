import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { JSONObject } from "Common/Types/JSON";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import TelemetryQueryTimeRange from "Common/Utils/Telemetry/TelemetryQueryTimeRange";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import useTimeRangeZoom, {
  TimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TelemetrySnapshotWindowAlert from "./TelemetrySnapshotWindowAlert";

/*
 * Drag-to-zoom for the telemetry snapshot of an incident, an alert or an
 * episode (issue #4105). Everything in the snapshot card shows one window,
 * the one the monitor evaluated over: the primary signal and the companion
 * Logs, Traces, Metrics and Exceptions tabs. A drag on the primary signal's
 * chart (the metric chart, or the volume histogram of a Logs, Traces or
 * Exceptions explorer) zooms the whole snapshot to the slice dragged out,
 * so every tab shows that slice, the ones opened afterwards included. A
 * double-click on that chart, or "Reset zoom" beside the snapshot badge on
 * any tab, puts the whole card back on the snapshot window.
 *
 * The host holds the zoom, not the chart. The card's tabs mount only the
 * one that is open, so a zoom kept inside the chart was gone the moment
 * the reader went to look at the logs for the slice, and it never reached
 * them in the first place.
 */

export interface TelemetrySnapshotZoom {
  /*
   * The window the whole snapshot shows: the slice a drag zoomed it to, or
   * the snapshot window itself. It keeps its identity while its value stays
   * the same, so the companion tabs (which derive their queries from it)
   * see nothing new when the page merely re-reads an equal snapshot.
   */
  window: InBetween<Date> | null;
  isZoomed: boolean;
  /*
   * The zoom itself, for the snapshot badge's "Reset zoom" (see
   * TelemetrySnapshotBadge), and to offer a Logs, Traces or Exceptions
   * primary explorer through a TimeRangeZoomProvider: pinned to the window
   * this zoom is over, the explorer follows it. Null when the snapshot
   * stored no window.
   */
  zoom: TimeRangeZoom | null;
  /*
   * For the primary metric chart's drag. Undefined when there is no window
   * to zoom: the chart then zooms itself alone, as it always did.
   */
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  /*
   * For the primary metric chart's double-click, set only while zoomed:
   * charts hold every single click for a moment while a reset is armed.
   */
  onTimeRangeReset: (() => void) | undefined;
  /*
   * The primary metric chart's data, on the window shown. The host's own
   * object whenever the snapshot is not zoomed.
   */
  metricViewData: MetricViewData | null;
  /*
   * A Logs, Traces or Exceptions snapshot's stored query, for the primary
   * explorer, on the window shown: the window it carries (`time`, or a
   * span's `startTime`) is the slice while the snapshot is zoomed. The
   * explorer follows a new window by value, and follows the snapshot's
   * zoom while on its window, so a drag on its histogram zooms the whole
   * snapshot. The host's own object whenever the snapshot is not zoomed.
   */
  explorerQuery: TelemetryQuery["telemetryQuery"];
}

export interface UseTelemetrySnapshotZoomOptions {
  // The window the monitor evaluated over, as the host resolved it.
  snapshotWindow: InBetween<Date> | null | undefined;
  metricViewData?: MetricViewData | null | undefined;
  /*
   * What the monitor evaluated, and for a Logs, Traces or Exceptions
   * snapshot its stored query: the explorer that shows it is pinned to the
   * window shown through that query's own window field.
   */
  telemetryType?: TelemetryType | null | undefined;
  explorerQuery?: TelemetryQuery["telemetryQuery"] | undefined;
  /*
   * The event the snapshot belongs to. The incident and alert pages stay
   * mounted while the reader moves to another event, and one evaluation of
   * a grouped monitor opens several events over the very same window: a
   * zoom made on one of them must not turn up on the next.
   */
  subjectKey?: string | undefined;
}

interface ViewedRange {
  // The snapshot (event and window, by value) the range was chosen over.
  snapshotKey: string;
  timeRange: RangeStartAndEndDateTime;
}

/*
 * Stands in for the range while there is no window. Nothing is offered then
 * (see the hook), so no zoom is ever made over it.
 */
const NO_WINDOW: RangeStartAndEndDateTime = { range: TimeRange.CUSTOM };

type UseTelemetrySnapshotZoomFunction = (
  options: UseTelemetrySnapshotZoomOptions,
) => TelemetrySnapshotZoom;

/**
 * Holds the snapshot's zoom for the page (or panel) that renders the
 * snapshot card. The zoom is tied to the snapshot it was made over, by
 * value: the page's background refresh re-reads an equal window after
 * every acknowledge or edit and keeps the zoom, while a different window,
 * or another event, starts unzoomed. Only the first zoom is remembered, as
 * everywhere else: after zooming twice, one reset returns to the snapshot
 * window.
 */
const useTelemetrySnapshotZoom: UseTelemetrySnapshotZoomFunction = (
  options: UseTelemetrySnapshotZoomOptions,
): TelemetrySnapshotZoom => {
  // A stored window can still hold ISO strings; compare by the instants.
  const snapshotWindow: InBetween<Date> | null =
    TelemetryQueryTimeRange.toDateWindow(options.snapshotWindow);
  const hasWindow: boolean = snapshotWindow !== null;
  const snapshotStartMs: number = snapshotWindow
    ? snapshotWindow.startValue.getTime()
    : Number.NaN;
  const snapshotEndMs: number = snapshotWindow
    ? snapshotWindow.endValue.getTime()
    : Number.NaN;
  const snapshotKey: string = hasWindow
    ? `${options.subjectKey || ""}|${snapshotStartMs}|${snapshotEndMs}`
    : "";

  const snapshotTimeRange: RangeStartAndEndDateTime | null =
    useMemo((): RangeStartAndEndDateTime | null => {
      if (!hasWindow) {
        return null;
      }

      return {
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(
          new Date(snapshotStartMs),
          new Date(snapshotEndMs),
        ),
      };
    }, [hasWindow, snapshotStartMs, snapshotEndMs]);

  const [viewed, setViewed] = useState<ViewedRange | null>(null);

  // A range chosen over another snapshot says nothing about this one.
  const timeRange: RangeStartAndEndDateTime | null =
    viewed && viewed.snapshotKey === snapshotKey
      ? viewed.timeRange
      : snapshotTimeRange;

  const latestSnapshotKey: React.MutableRefObject<string> =
    useRef<string>(snapshotKey);
  latestSnapshotKey.current = snapshotKey;

  const onTimeRangeChange: (next: RangeStartAndEndDateTime) => void =
    useCallback((next: RangeStartAndEndDateTime): void => {
      setViewed({
        snapshotKey: latestSnapshotKey.current,
        timeRange: next,
      });
    }, []);

  const zoom: TimeRangeZoom = useTimeRangeZoom({
    timeRange: timeRange || NO_WINDOW,
    onTimeRangeChange: onTimeRangeChange,
  });

  /*
   * Forget a range chosen over a snapshot the page has left, so coming
   * back to it (the reader returning to the previous incident) starts
   * unzoomed, as it did while the chart kept the zoom.
   */
  useEffect(() => {
    setViewed((current: ViewedRange | null): ViewedRange | null => {
      return current && current.snapshotKey !== snapshotKey ? null : current;
    });
  }, [snapshotKey]);

  const isZoomed: boolean = hasWindow && zoom.isZoomed;

  const shownStartMs: number =
    timeRange?.startAndEndDate?.startValue.getTime() ?? Number.NaN;
  const shownEndMs: number =
    timeRange?.startAndEndDate?.endValue.getTime() ?? Number.NaN;

  const window: InBetween<Date> | null = useMemo((): InBetween<Date> | null => {
    if (!Number.isFinite(shownStartMs) || !Number.isFinite(shownEndMs)) {
      return null;
    }

    return new InBetween<Date>(new Date(shownStartMs), new Date(shownEndMs));
  }, [shownStartMs, shownEndMs]);

  const hostMetricViewData: MetricViewData | null =
    options.metricViewData || null;

  const metricViewData: MetricViewData | null =
    useMemo((): MetricViewData | null => {
      if (!hostMetricViewData || !isZoomed || !window) {
        return hostMetricViewData;
      }

      // A zoomed window is pinned: no relative preset re-anchors it.
      return {
        ...hostMetricViewData,
        startAndEndDate: window,
        rangeToken: undefined,
      };
    }, [hostMetricViewData, isZoomed, window]);

  const hostExplorerQuery: TelemetryQuery["telemetryQuery"] =
    options.explorerQuery || null;
  // Where the query keeps its window: `time`, or a span's `startTime`.
  const explorerWindowField: string | null =
    TelemetryQueryTimeRange.getWindowFieldName(options.telemetryType);

  const explorerQuery: TelemetryQuery["telemetryQuery"] =
    useMemo((): TelemetryQuery["telemetryQuery"] => {
      if (!hostExplorerQuery || !explorerWindowField || !isZoomed || !window) {
        return hostExplorerQuery;
      }

      return {
        ...(hostExplorerQuery as JSONObject),
        [explorerWindowField]: window,
      } as TelemetryQuery["telemetryQuery"];
    }, [hostExplorerQuery, explorerWindowField, isZoomed, window]);

  return {
    window: window,
    isZoomed: isZoomed,
    zoom: hasWindow ? zoom : null,
    onTimeRangeSelect: hasWindow ? zoom.zoomToTimeRange : undefined,
    onTimeRangeReset: isZoomed ? zoom.resetZoom : undefined,
    metricViewData: metricViewData,
    explorerQuery: explorerQuery,
  };
};

export default useTelemetrySnapshotZoom;

export interface TelemetrySnapshotBadgeProps {
  /*
   * The window the monitor evaluated over. The badge names it zoomed or
   * not: it says which moment the card is about, while the charts and the
   * explorers' pickers show the slice.
   */
  window: InBetween<Date>;
  zoom: TimeRangeZoom | null;
}

/**
 * The snapshot badge, with the snapshot's "Reset zoom" beside it while the
 * snapshot is zoomed. It goes on the right of every card in the snapshot,
 * the companion tabs' cards included, so the way back to the snapshot
 * window is there whichever tab the reader is on, even one with no chart
 * of the snapshot's to double-click.
 */
export const TelemetrySnapshotBadge: FunctionComponent<
  TelemetrySnapshotBadgeProps
> = (props: TelemetrySnapshotBadgeProps): ReactElement => {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/*
       * The zoom is offered to this button alone. The companion tabs
       * withdraw every zoom from what they render (their explorers keep
       * windows of their own), and this button sits inside their cards
       * too.
       */}
      <TimeRangeZoomProvider zoom={props.zoom}>
        <ResetTimeRangeZoomButton />
      </TimeRangeZoomProvider>
      <TelemetrySnapshotWindowAlert window={props.window} />
    </div>
  );
};
