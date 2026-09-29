import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Link from "Common/UI/Components/Link/Link";
import ChartGroup, {
  Chart,
  ChartType,
} from "Common/UI/Components/Charts/ChartGroup/ChartGroup";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import useTimeRangeZoom, {
  TimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import TimeRangeZoomUtil from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomUtil";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import {
  XAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import XAxisUtil from "Common/UI/Components/Charts/Utils/XAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import { YAxisPrecision } from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { APP_API_URL } from "Common/UI/Config";
import OneUptimeDate from "Common/Types/Date";
import EntityType from "Common/Types/Telemetry/EntityType";
import useTranslateValue from "Common/UI/Utils/Translation";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import { TopologyEntity, TopologyRelationship } from "./TopologyData";
import { getChartGridStepSeconds } from "../NetworkDevice/ChartGridStep";
import {
  HEALTH_COLORS,
  SERVICE_MAP_TOLERATED_ERROR_RATE,
  formatCallRate,
  formatDurationMs,
  formatErrorRate,
  healthForErrorRate,
} from "./TopologyMeta";

/*
 * Drill-down for one Service Map edge. The edge row itself only stores the
 * latest cron window, so history is aggregated on demand from spans in
 * ClickHouse (POST /telemetry/service-dependency-timeseries) for the time
 * range picked on the Topology page, and rendered with the shared chart
 * components: calls & errors, then average latency.
 *
 * History comes from paired spans, so it exists only between two services.
 * A call into a database or remote API (inferred from client spans) shows
 * the latest window alone, and says why.
 *
 * Drag-to-zoom on the history charts narrows THIS drawer's window only
 * (issue #4105), never the Topology page's range: the maps read only that
 * range's start ("Active in"), and changing it reloads the map this drawer
 * is open on. A double-click on a chart, or "Reset zoom", puts the page's
 * range back; a new range picked on the page starts the drawer over on it.
 * A zoom re-fetches the history at buckets one step of the zoomed chart
 * wide, and the last history stays on screen until the new one lands.
 */

export interface ComponentProps {
  fromEntity: TopologyEntity;
  toEntity: TopologyEntity;
  relationship: TopologyRelationship;
  timeRange: RangeStartAndEndDateTime;
  /** Seconds the latest-window metrics were aggregated over (cron window). */
  metricsWindowSeconds: number;
  onClose: () => void;
}

interface TimeseriesBucket {
  bucketStart: Date;
  callCount: number;
  errorCount: number;
  avgDurationMs: number;
}

interface TimeseriesResult {
  buckets: Array<TimeseriesBucket>;
  /** Buckets zero-filled over the window — for the calls/errors series. */
  filledBuckets: Array<TimeseriesBucket>;
  callerServiceId: string | null;
  calleeServiceId: string | null;
  truncated: boolean;
}

/*
 * ClickHouse JSON emits DateTime as a naive "YYYY-MM-DD hh:mm:ss" string in
 * server time (UTC in our deployments); normalize to ISO-UTC so the Date
 * doesn't get reinterpreted in the viewer's local timezone.
 */
const NAIVE_DATETIME_REGEX: RegExp = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

function parseBucketStart(value: string): Date {
  if (NAIVE_DATETIME_REGEX.test(value)) {
    return new Date(`${value.replace(" ", "T")}Z`);
  }
  return OneUptimeDate.fromString(value);
}

const HOUR_SECONDS: number = 60 * 60;

/*
 * The step the history charts are drawn on for a window: the one the chart
 * library itself picks for the window's length. The history is fetched in
 * buckets of this step (see chartAlignedBucketSeconds) and the charts are
 * pinned to it, so the two cannot drift apart.
 */
function chartPrecisionForWindow(window: InBetween<Date>): XAxisPrecision {
  return XAxisUtil.getPrecision({
    xAxisMin: window.startValue,
    xAxisMax: window.endValue,
  });
}

/*
 * The bucket size to ask the API for: one step of the charts' grid, so the
 * API returns exactly one bucket per chart interval. With 1:1 buckets the
 * chart's per-interval aggregation is exact — no collapsing, so the
 * latency series never averages averages across buckets (which would be
 * unweighted) and counts never sum across misaligned buckets.
 *
 * Read off the step the chart picks rather than a copy of its ladder. A copy
 * drifted: the axis gained its 5-, 15- and 30-minute steps for windows of 3
 * hours to 3 days while the copy kept asking for hourly buckets there, so a
 * zoom from the Topology page's 1-day default re-fetched the very same hourly
 * buckets and only stretched them over a finer axis.
 *
 * Capped at hourly: the API's buckets are epoch-aligned in UTC while the
 * chart's day/week intervals follow the viewer's LOCAL calendar, so
 * daily-or-coarser buckets can miss the chart's interval labels entirely
 * (dropped points). Hourly buckets always format into the right day
 * label, at worst leaving latency as an unweighted average within an
 * interval — the pre-existing behavior.
 */
function chartAlignedBucketSeconds(precision: XAxisPrecision): number {
  const stepSeconds: number | undefined = getChartGridStepSeconds(precision);
  if (stepSeconds === undefined) {
    return HOUR_SECONDS;
  }
  return Math.min(stepSeconds, HOUR_SECONDS);
}

interface LoadedHistory {
  result: TimeseriesResult;
  /*
   * The window the history was fetched over, and the step it was bucketed
   * for. Until the next window's history lands the charts keep drawing this
   * one, on its own axis: laid over the new window's axis, the old buckets
   * would be misplaced or dropped.
   */
  window: InBetween<Date>;
  precision: XAxisPrecision;
}

/*
 * Where the charts' time axis starts: on the grid, at the step holding the
 * FIRST bucket. The API's buckets are aligned to the epoch in UTC, so the
 * first one usually begins before the window does. Where the viewer's clock
 * is not a whole number of steps off UTC (half an hour off, on the hourly
 * step; three quarters of an hour off, on the 30-minute one) it can begin
 * in the step BEFORE the one holding the window start, and an axis walked
 * from the window start has no slot for it: the chart silently dropped the
 * calls of the window's first minutes.
 */
function historyAxisStart(history: LoadedHistory): Date {
  let startMs: number = history.window.startValue.getTime();
  for (const bucket of history.result.filledBuckets) {
    const bucketMs: number = bucket.bucketStart.getTime();
    if (Number.isFinite(bucketMs) && bucketMs < startMs) {
      startMs = bucketMs;
    }
  }
  return XAxisUtil.getBucketStart(new Date(startMs), history.precision);
}

const EdgeDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const fromName: string = props.fromEntity.displayName || "Unknown service";
  const toName: string = props.toEntity.displayName || "Unknown service";
  const historyAvailable: boolean =
    props.fromEntity.entityType === EntityType.Service &&
    props.toEntity.entityType === EntityType.Service;

  // The last history that loaded; a failed fetch keeps it.
  const [loaded, setLoaded] = useState<LoadedHistory | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(historyAvailable);
  const [error, setError] = useState<string>("");

  /*
   * The drawer's own window while a chart zoom narrows it; null follows
   * the page's range. A new range from the page ends the zoom.
   */
  const [zoomedTimeRange, setZoomedTimeRange] =
    useState<RangeStartAndEndDateTime | null>(null);

  useEffect(() => {
    setZoomedTimeRange(null);
  }, [props.timeRange]);

  const timeRange: RangeStartAndEndDateTime =
    zoomedTimeRange || props.timeRange;

  const latestPageTimeRange: React.MutableRefObject<RangeStartAndEndDateTime> =
    useRef<RangeStartAndEndDateTime>(props.timeRange);
  latestPageTimeRange.current = props.timeRange;

  const onDrawerTimeRangeChange: (next: RangeStartAndEndDateTime) => void =
    useCallback((next: RangeStartAndEndDateTime): void => {
      // A reset hands back the page's own range: follow the page again.
      setZoomedTimeRange(
        TimeRangeZoomUtil.isSameRange(next, latestPageTimeRange.current)
          ? null
          : next,
      );
    }, []);

  const zoom: TimeRangeZoom = useTimeRangeZoom({
    timeRange: timeRange,
    onTimeRangeChange: onDrawerTimeRangeChange,
  });

  /*
   * Freeze the window per range change: relative presets anchor to "now",
   * so recomputing every render would shift the chart axis away from the
   * buckets fetched when the panel opened.
   */
  const window: InBetween<Date> = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
  }, [timeRange]);

  useEffect(() => {
    /*
     * Stale-response guard: switching edges must not let the previous
     * edge's slower response overwrite the newer one's state.
     */
    let cancelled: boolean = false;
    if (!historyAvailable) {
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    // The step the charts will be drawn on, and the buckets are asked for at.
    const precision: XAxisPrecision = chartPrecisionForWindow(window);
    const load: () => Promise<void> = async (): Promise<void> => {
      /*
       * The last history stays on screen while this one loads: a drag or a
       * double-click on a chart starts this fetch, and swapping the charts
       * for a loader collapsed the drawer under the pointer that had just
       * made it.
       */
      setIsLoading(true);
      setError("");
      try {
        const url: URL = URL.fromString(APP_API_URL.toString()).addRoute(
          "/telemetry/service-dependency-timeseries",
        );
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url,
            data: {
              projectId: ProjectUtil.getCurrentProjectId()?.toString(),
              callerServiceName: fromName,
              calleeServiceName: toName,
              startTime: OneUptimeDate.toString(window.startValue),
              endTime: OneUptimeDate.toString(window.endValue),
              bucketSeconds: chartAlignedBucketSeconds(precision),
            },
            headers: { ...ModelAPI.getCommonHeaders() },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const data: JSONObject = response.data || {};
        const rawBuckets: JSONArray = Array.isArray(data["buckets"])
          ? (data["buckets"] as JSONArray)
          : [];
        const buckets: Array<TimeseriesBucket> = rawBuckets.map(
          (row: unknown): TimeseriesBucket => {
            const bucket: JSONObject = (row || {}) as JSONObject;
            return {
              bucketStart: parseBucketStart(String(bucket["bucketStart"])),
              callCount: Number(bucket["callCount"]) || 0,
              errorCount: Number(bucket["errorCount"]) || 0,
              avgDurationMs: Number(bucket["avgDurationMs"]) || 0,
            };
          },
        );
        /*
         * Zero-fill the window for the calls/errors series: GROUP BY only
         * returns buckets that saw traffic, and the shared LineChart
         * connects across gaps — without explicit zeros a 6-hour outage
         * renders as a straight line instead of a drop to zero. Buckets
         * are epoch-aligned by toStartOfInterval, so stepping from the
         * window start floor covers them all. Latency keeps only real
         * buckets (a zero-latency dip would be just as misleading).
         */
        const bucketSeconds: number = Number(data["bucketSeconds"]) || 0;
        let filledBuckets: Array<TimeseriesBucket> = buckets;
        if (bucketSeconds > 0) {
          const byTime: Map<number, TimeseriesBucket> = new Map<
            number,
            TimeseriesBucket
          >(
            buckets.map((bucket: TimeseriesBucket) => {
              return [bucket.bucketStart.getTime(), bucket];
            }),
          );
          const stepMs: number = bucketSeconds * 1000;
          const firstMs: number =
            Math.floor(window.startValue.getTime() / stepMs) * stepMs;
          const filled: Array<TimeseriesBucket> = [];
          for (
            let t: number = firstMs;
            t < window.endValue.getTime() && filled.length < 2000;
            t += stepMs
          ) {
            filled.push(
              byTime.get(t) || {
                bucketStart: new Date(t),
                callCount: 0,
                errorCount: 0,
                avgDurationMs: 0,
              },
            );
          }
          filledBuckets = filled;
        }

        if (cancelled) {
          return;
        }
        setLoaded({
          result: {
            buckets,
            filledBuckets,
            callerServiceId: data["callerServiceId"]
              ? String(data["callerServiceId"])
              : null,
            calleeServiceId: data["calleeServiceId"]
              ? String(data["calleeServiceId"])
              : null,
            truncated: Boolean(data["truncated"]),
          },
          window: window,
          precision: precision,
        });
      } catch (err) {
        if (!cancelled) {
          setError(API.getFriendlyMessage(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fromName, toName, timeRange, window, historyAvailable]);

  const buildCharts: (history: LoadedHistory) => Array<Chart> = (
    history: LoadedHistory,
  ): Array<Chart> => {
    const result: TimeseriesResult = history.result;
    if (result.buckets.length === 0) {
      return [];
    }

    const hours: number =
      (history.window.endValue.getTime() -
        history.window.startValue.getTime()) /
      (60 * 60 * 1000);
    const xAxisType: XAxisType = hours > 48 ? XAxisType.Date : XAxisType.Time;
    const axisStart: Date = historyAxisStart(history);

    const callSeries: Array<SeriesPoint> = [
      {
        seriesName: "Calls",
        data: result.filledBuckets.map((bucket: TimeseriesBucket) => {
          return { x: bucket.bucketStart, y: bucket.callCount };
        }),
      },
      {
        seriesName: "Errors",
        data: result.filledBuckets.map((bucket: TimeseriesBucket) => {
          return { x: bucket.bucketStart, y: bucket.errorCount };
        }),
      },
    ];

    const latencySeries: Array<SeriesPoint> = [
      {
        seriesName: "Avg latency",
        data: result.buckets.map((bucket: TimeseriesBucket) => {
          return { x: bucket.bucketStart, y: bucket.avgDurationMs };
        }),
      },
    ];

    /*
     * Pinned to the step the buckets were fetched at: the axis now starts a
     * little before the window (see historyAxisStart), and left to pick its
     * own step from that longer span it could tip into a coarser one - a
     * 3-hour window by a minute into five-minute slots, each summing five of
     * the per-minute buckets.
     */
    const xAxis: XAxis = {
      legend: "Time",
      options: {
        type: xAxisType,
        min: axisStart,
        max: history.window.endValue,
        aggregateType: XAxisAggregateType.Sum,
        precision: history.precision,
      },
    };

    /*
     * The chart re-buckets into its own axis intervals; when several API
     * buckets collapse into one interval, counts must SUM but a latency
     * average must AVERAGE — summing averages inflates latency by the
     * collapse factor (2-7x depending on the range).
     */
    const latencyXAxis: XAxis = {
      legend: "Time",
      options: {
        type: xAxisType,
        min: axisStart,
        max: history.window.endValue,
        aggregateType: XAxisAggregateType.Average,
        precision: history.precision,
      },
    };

    return [
      {
        id: "edge-calls",
        title: translateString("Calls and errors") || "Calls and errors",
        description: `${fromName} → ${toName}`,
        type: ChartType.LINE,
        props: {
          data: callSeries,
          xAxis,
          yAxis: {
            legend: "Calls",
            options: {
              type: YAxisType.Number,
              formatter: (value: number) => {
                return `${Math.round(value)}`;
              },
              precision: YAxisPrecision.NoDecimals,
              min: 0,
              max: "auto",
            },
          },
          curve: ChartCurve.MONOTONE,
          sync: true,
          showLegend: true,
        },
      },
      {
        id: "edge-latency",
        title: translateString("Average latency") || "Average latency",
        description:
          translateString("How long the callee took to answer") ||
          "How long the callee took to answer",
        type: ChartType.LINE,
        props: {
          data: latencySeries,
          xAxis: latencyXAxis,
          yAxis: {
            legend: "Latency",
            options: {
              type: YAxisType.Number,
              formatter: (value: number) => {
                return formatDurationMs(value);
              },
              precision: YAxisPrecision.NoDecimals,
              min: 0,
              max: "auto",
            },
          },
          curve: ChartCurve.MONOTONE,
          sync: true,
        },
      },
    ];
  };

  const rel: TopologyRelationship = props.relationship;
  const hasLatestMetrics: boolean = Boolean(rel.callCount && rel.callCount > 0);
  const healthColor: string =
    HEALTH_COLORS[
      healthForErrorRate(
        rel.callCount,
        rel.errorCount,
        SERVICE_MAP_TOLERATED_ERROR_RATE,
      )
    ];

  return (
    <SideOver
      title={`${fromName} → ${toName}`}
      description={
        translateString(
          historyAvailable ? "Service dependency" : "Dependency",
        ) || ""
      }
      onClose={props.onClose}
      size={SideOverSize.Medium}
    >
      {/*
       * The drawer's own zoom, for its charts and its "Reset zoom". It also
       * shadows any zoom a page around the drawer offers.
       */}
      <TimeRangeZoomProvider zoom={zoom}>
        <div className="space-y-6">
          {hasLatestMetrics ? (
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                {translateString("Latest window (~15 min)") || ""}
              </h3>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600">
                <span>
                  {formatCallRate(rel.callCount!, props.metricsWindowSeconds)}
                </span>
                <span style={{ color: healthColor }}>
                  {formatErrorRate(rel.callCount, rel.errorCount)} errors
                </span>
                <span>avg {formatDurationMs(rel.avgDurationMs)}</span>
              </div>
            </div>
          ) : (
            <></>
          )}

          {!historyAvailable ? (
            <p
              className="text-sm text-gray-500"
              data-testid="edge-history-unavailable"
            >
              {translateString(
                "History is available for calls between two instrumented services. This call was inferred from the client spans of the caller, so only the latest window is shown.",
              ) || ""}
            </p>
          ) : (
            <div data-testid="edge-history" aria-busy={isLoading}>
              {/*
               * The history's header, there whatever the history shows (a
               * loader, the charts or an empty zoomed stretch). The drawer
               * has no picker of its own, so its way out of a zoom sits
               * here. It used to get a row of its own that appeared with
               * the zoom, which pushed the charts down right under the
               * pointer that had just dragged them, and pulled them back up
               * on a reset. This row is as tall as the button, so the
               * button (or the refresh note) coming and going moves nothing.
               */}
              <div
                className="flex h-7 items-center justify-between gap-2"
                data-testid="edge-history-header"
              >
                <h3 className="text-sm font-semibold text-gray-900">
                  {translateString("History") || "History"}
                </h3>
                <div className="flex items-center gap-2">
                  {loaded && isLoading ? (
                    <span
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500"
                      data-testid="edge-history-refreshing"
                    >
                      <Icon
                        icon={IconProp.Refresh}
                        className="h-3 w-3 animate-spin text-gray-400"
                      />
                      {translateString("Refreshing") || "Refreshing"}
                    </span>
                  ) : (
                    <></>
                  )}
                  <ResetTimeRangeZoomButton />
                </div>
              </div>

              <div className="mt-2 space-y-4">
                {loaded?.result.truncated ? (
                  <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
                    {translateString(
                      "These services have more traffic than can be analyzed for this time range, so the history shows the most recent part only. Narrow the time range for complete data.",
                    ) || ""}
                  </div>
                ) : (
                  <></>
                )}

                {/*
                 * A fetch that failed over history already on screen keeps
                 * that history, under a note; with nothing loaded yet, the
                 * error is all there is to show.
                 */}
                {loaded && error ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
                  >
                    <Icon
                      icon={IconProp.Error}
                      className="h-4 w-4 shrink-0 text-red-500"
                    />
                    <span>
                      {translateString(
                        "Couldn't refresh — showing previously loaded data.",
                      ) || ""}{" "}
                      {error}
                    </span>
                  </div>
                ) : (
                  <></>
                )}

                {!loaded ? (
                  isLoading ? (
                    <ComponentLoader />
                  ) : error ? (
                    <ErrorMessage message={error} />
                  ) : (
                    <></>
                  )
                ) : (
                  <div
                    className={isLoading ? "opacity-75 transition-opacity" : ""}
                    data-testid="edge-history-body"
                  >
                    {loaded.result.buckets.length === 0 ? (
                      /*
                       * A zoom into a quiet stretch lands here, with no
                       * chart left to double-click; the message takes the
                       * double-click instead (and then its words cannot be
                       * selected, or the double-click would select one).
                       */
                      <p
                        className={`text-sm text-gray-500${
                          zoom.isZoomed ? " select-none" : ""
                        }`}
                        data-testid="edge-history-empty"
                        onDoubleClick={
                          zoom.isZoomed ? zoom.resetZoom : undefined
                        }
                      >
                        {translateString(
                          "No calls between these services were recorded in the selected time range.",
                        ) || ""}
                      </p>
                    ) : (
                      <ChartGroup charts={buildCharts(loaded)} />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-gray-900">Open</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {loaded?.result.callerServiceId && (
                <li>
                  <Link
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route,
                      { modelId: new ObjectID(loaded.result.callerServiceId) },
                    )}
                    className="font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {translateString("Traces for") || ""} {fromName}
                  </Link>
                </li>
              )}
              {loaded?.result.calleeServiceId && (
                <li>
                  <Link
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route,
                      { modelId: new ObjectID(loaded.result.calleeServiceId) },
                    )}
                    className="font-medium text-indigo-600 hover:text-indigo-800"
                  >
                    {translateString("Traces for") || ""} {toName}
                  </Link>
                </li>
              )}
            </ul>
          </div>
        </div>
      </TimeRangeZoomProvider>
    </SideOver>
  );
};

export default EdgeDetailPanel;
