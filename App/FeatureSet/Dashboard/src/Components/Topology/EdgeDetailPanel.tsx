import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
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
import {
  XAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import { YAxisPrecision } from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationship from "Common/Models/DatabaseModels/TelemetryEntityRelationship";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { APP_API_URL } from "Common/UI/Config";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import {
  HEALTH_COLORS,
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
 */

export interface ComponentProps {
  fromEntity: TelemetryEntity;
  toEntity: TelemetryEntity;
  relationship: TelemetryEntityRelationship;
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

const EdgeDetailPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const fromName: string = props.fromEntity.displayName || "Unknown service";
  const toName: string = props.toEntity.displayName || "Unknown service";

  const [result, setResult] = useState<TimeseriesResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  /*
   * Freeze the window per range change: relative presets anchor to "now",
   * so recomputing every render would shift the chart axis away from the
   * buckets fetched when the panel opened.
   */
  const window: InBetween<Date> = useMemo(() => {
    return RangeStartAndEndDateTimeUtil.getStartAndEndDate(props.timeRange);
  }, [props.timeRange]);

  useEffect(() => {
    /*
     * Stale-response guard: switching edges must not let the previous
     * edge's slower response overwrite the newer one's state.
     */
    let cancelled: boolean = false;
    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      setResult(null);
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
        setResult({
          buckets,
          filledBuckets,
          callerServiceId: data["callerServiceId"]
            ? String(data["callerServiceId"])
            : null,
          calleeServiceId: data["calleeServiceId"]
            ? String(data["calleeServiceId"])
            : null,
          truncated: Boolean(data["truncated"]),
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
  }, [fromName, toName, props.timeRange, window]);

  const buildCharts: () => Array<Chart> = (): Array<Chart> => {
    if (!result || result.buckets.length === 0) {
      return [];
    }

    const hours: number =
      (window.endValue.getTime() - window.startValue.getTime()) /
      (60 * 60 * 1000);
    const xAxisType: XAxisType = hours > 48 ? XAxisType.Date : XAxisType.Time;

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

    const xAxis: XAxis = {
      legend: "Time",
      options: {
        type: xAxisType,
        min: window.startValue,
        max: window.endValue,
        aggregateType: XAxisAggregateType.Sum,
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
        min: window.startValue,
        max: window.endValue,
        aggregateType: XAxisAggregateType.Average,
      },
    };

    return [
      {
        id: "edge-calls",
        title: "Calls and errors",
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
        title: "Average latency",
        description: "How long the callee took to answer",
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

  const rel: TelemetryEntityRelationship = props.relationship;
  const hasLatestMetrics: boolean = Boolean(rel.callCount && rel.callCount > 0);
  const healthColor: string =
    HEALTH_COLORS[healthForErrorRate(rel.callCount, rel.errorCount)];

  return (
    <SideOver
      title={`${fromName} → ${toName}`}
      description="Service dependency"
      onClose={props.onClose}
      size={SideOverSize.Medium}
    >
      <div className="space-y-6">
        {hasLatestMetrics ? (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              Latest window (~15 min)
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

        {result?.truncated ? (
          <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
            These services have more traffic than can be analyzed for this time
            range, so the history shows the most recent part only. Narrow the
            time range for complete data.
          </div>
        ) : (
          <></>
        )}

        {isLoading ? (
          <ComponentLoader />
        ) : error ? (
          <ErrorMessage message={error} />
        ) : !result || result.buckets.length === 0 ? (
          <p className="text-sm text-gray-500">
            No calls between these services were recorded in the selected time
            range.
          </p>
        ) : (
          <ChartGroup charts={buildCharts()} />
        )}

        <div>
          <h3 className="text-sm font-semibold text-gray-900">Open</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {result?.callerServiceId && (
              <li>
                <Link
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route,
                    { modelId: new ObjectID(result.callerServiceId) },
                  )}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  Traces for {fromName}
                </Link>
              </li>
            )}
            {result?.calleeServiceId && (
              <li>
                <Link
                  to={RouteUtil.populateRouteParams(
                    RouteMap[PageMap.SERVICE_VIEW_TRACES] as Route,
                    { modelId: new ObjectID(result.calleeServiceId) },
                  )}
                  className="font-medium text-indigo-600 hover:text-indigo-800"
                >
                  Traces for {toName}
                </Link>
              </li>
            )}
          </ul>
        </div>
      </div>
    </SideOver>
  );
};

export default EdgeDetailPanel;
