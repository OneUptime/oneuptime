import ObjectID from "Common/Types/ObjectID";
import {
  WebVitalDefinitions,
  WebVitalDefinition,
  WebVitalRouteAttributeKeys,
} from "Common/Types/Rum/WebVitals";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProjectUtil from "Common/UI/Utils/Project";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import API from "Common/UI/Utils/API/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";
import {
  formatBytes,
  formatCompact,
  formatDurationMs,
  formatPercent,
} from "./telemetryFormat";

/*
 * The formatters are pure and live in telemetryFormat.ts so a node test
 * (and a React-free helper module) can use them without pulling in the
 * API client this file needs. Re-exported so existing imports keep working.
 */
export { formatBytes, formatCompact, formatDurationMs, formatPercent };

export interface TimePoint {
  x: Date;
  y: number;
}

/*
 * RED (Rate / Errors / Duration) metrics + trend series derived from the
 * Span analytics model. Shared by the Serverless, Cloud and RUM overview
 * pages — all span-heavy workloads (invocations / requests / page loads),
 * so spans are the universal, always-present signal.
 */
export interface SpanMetrics {
  total: number;
  errors: number;
  errorRatePercent: number | null;
  p95DurationMs: number | null;
  countSeries: Array<TimePoint>;
  errorSeries: Array<TimePoint>;
  p95Series: Array<TimePoint>;
  /*
   * The aggregate queries failed (e.g. a 403 without trace read access).
   * The numbers are then zero, which is unknown rather than none - a tile
   * should say "could not load" instead of showing 0.
   */
  failed?: boolean | undefined;
}

export interface SpanScope {
  attributes?: Record<string, string> | undefined;
  primaryEntityId?: ObjectID | undefined;
  /*
   * Only spans with exactly this name - e.g. "documentLoad", the span the
   * OpenTelemetry browser SDK records for each full page load.
   */
  spanName?: string | undefined;
  start: Date;
  end: Date;
}

const getBucketDate: (p: AggregatedModel) => Date | null = (
  p: AggregatedModel,
): Date | null => {
  const raw: unknown =
    p["timestamp"] !== undefined ? p["timestamp"] : p["time"];
  if (raw instanceof Date) {
    return raw;
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const d: Date = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
};

const toTimePoints: (
  result: AggregatedResult,
  scale?: number,
) => Array<TimePoint> = (
  result: AggregatedResult,
  scale: number = 1,
): Array<TimePoint> => {
  const points: Array<TimePoint> = [];
  for (const p of (result.data || []) as Array<AggregatedModel>) {
    const x: Date | null = getBucketDate(p);
    const y: number = Number(p["value"]);
    if (x && Number.isFinite(y)) {
      points.push({ x: x, y: y * scale });
    }
  }
  points.sort((a: TimePoint, b: TimePoint): number => {
    return a.x.getTime() - b.x.getTime();
  });
  return points;
};

const sumY: (series: Array<TimePoint>) => number = (
  series: Array<TimePoint>,
): number => {
  return series.reduce((acc: number, p: TimePoint): number => {
    return acc + p.y;
  }, 0);
};

const meanY: (series: Array<TimePoint>) => number | null = (
  series: Array<TimePoint>,
): number | null => {
  if (series.length === 0) {
    return null;
  }
  return sumY(series) / series.length;
};

export const fetchSpanMetrics: (
  scope: SpanScope,
) => Promise<SpanMetrics> = async (scope: SpanScope): Promise<SpanMetrics> => {
  const empty: SpanMetrics = {
    total: 0,
    errors: 0,
    errorRatePercent: null,
    p95DurationMs: null,
    countSeries: [],
    errorSeries: [],
    p95Series: [],
  };

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  if (!projectId) {
    return empty;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseQuery: any = {
    projectId: projectId,
    startTime: new InBetween<Date>(scope.start, scope.end),
  };
  if (scope.primaryEntityId) {
    baseQuery.primaryEntityId = scope.primaryEntityId;
  }
  if (scope.spanName) {
    baseQuery.name = scope.spanName;
  }
  if (scope.attributes && Object.keys(scope.attributes).length > 0) {
    baseQuery.attributes = scope.attributes;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorQuery: any = { ...baseQuery, statusCode: SpanStatus.Error };

  const build: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: any,
    aggregationType: AggregationType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => any = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: any,
    aggregationType: AggregationType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any => {
    return {
      query: query,
      aggregationType: aggregationType,
      aggregateColumnName: "durationUnixNano",
      aggregationTimestampColumnName: "startTime",
      startTimestamp: scope.start,
      endTimestamp: scope.end,
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      sort: { startTime: SortOrder.Descending },
    };
  };

  try {
    const [countResult, errorResult, p95Result]: [
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
    ] = await Promise.all([
      AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: build(
          baseQuery,
          AggregationType.Count,
        ) as AggregateBy<Span>,
      }),
      AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: build(
          errorQuery,
          AggregationType.Count,
        ) as AggregateBy<Span>,
      }),
      AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: build(baseQuery, AggregationType.P95) as AggregateBy<Span>,
      }),
    ]);

    const countSeries: Array<TimePoint> = toTimePoints(countResult);
    const errorSeries: Array<TimePoint> = toTimePoints(errorResult);
    // durationUnixNano (nanoseconds) → milliseconds for display.
    const p95Series: Array<TimePoint> = toTimePoints(p95Result, 1 / 1_000_000);

    const total: number = sumY(countSeries);
    const errors: number = sumY(errorSeries);

    return {
      total: total,
      errors: errors,
      errorRatePercent: total > 0 ? (errors / total) * 100 : null,
      p95DurationMs: meanY(p95Series),
      countSeries: countSeries,
      errorSeries: errorSeries,
      p95Series: p95Series,
    };
  } catch {
    return { ...empty, failed: true };
  }
};

export interface MetricScope {
  name: string;
  attributes?: Record<string, string> | undefined;
  primaryEntityId?: ObjectID | undefined;
  aggregationType: AggregationType;
  /*
   * Omitted: buckets sized to the window. Total: one value over the whole
   * window - an exact mean of the range rather than a mean of per-interval
   * means, and the only way to get a percentile of the range.
   */
  aggregationInterval?: AggregationInterval | undefined;
  start: Date;
  end: Date;
}

/*
 * Time series for a named Metric (e.g. container.memory.usage). Returns the
 * value per time bucket; scale converts units if needed.
 */
export const fetchMetricSeries: (
  scope: MetricScope,
  scale?: number,
) => Promise<Array<TimePoint>> = async (
  scope: MetricScope,
  scale: number = 1,
): Promise<Array<TimePoint>> => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  if (!projectId) {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    projectId: projectId,
    time: new InBetween<Date>(scope.start, scope.end),
    name: scope.name,
  };
  if (scope.primaryEntityId) {
    query.primaryEntityId = scope.primaryEntityId;
  }
  if (scope.attributes && Object.keys(scope.attributes).length > 0) {
    query.attributes = scope.attributes;
  }

  try {
    const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
      modelType: Metric,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      aggregateBy: {
        query: query,
        aggregationType: scope.aggregationType,
        ...(scope.aggregationInterval
          ? { aggregationInterval: scope.aggregationInterval }
          : {}),
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp: scope.start,
        endTimestamp: scope.end,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: { time: SortOrder.Descending },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    return toTimePoints(result, scale);
  } catch {
    return [];
  }
};

export interface WebVital {
  key: string;
  label: string;
  // What the vital measures (from WebVitalDefinitions).
  description: string;
  value: number | null;
  unit: "ms" | "score";
  // Core Web Vitals thresholds (good < warn, poor >= danger).
  thresholds: { warn: number; danger: number };
  // The metric name that reported, so a follow-up query can reuse it.
  metricName: string | null;
}

/*
 * Best-effort Core Web Vitals. OpenTelemetry has no finalized web-vitals
 * metric convention, so we probe the common community / SDK metric names
 * for each vital and surface the first that reports data. Empty when the
 * browser SDK does not emit web vitals (the page renders a clear hint).
 *
 * Each value is the mean over the WHOLE range (one Total bucket), so a
 * quiet interval no longer counts as much as a busy one. It stays a mean
 * rather than Google's p75 on purpose: a histogram's percentile is read
 * from its bucket midpoints, and the OpenTelemetry default buckets
 * (0, 5, 10, 25 ...) put every CLS value in (0, 5] - a p75 of 2.5 for a
 * page that barely moves. The mean comes from the histogram's exact sum
 * and count, whatever its buckets.
 */
export const fetchWebVitals: (data: {
  primaryEntityId: ObjectID;
  start: Date;
  end: Date;
}) => Promise<Array<WebVital>> = async (data: {
  primaryEntityId: ObjectID;
  start: Date;
  end: Date;
}): Promise<Array<WebVital>> => {
  const results: Array<WebVital> = await Promise.all(
    WebVitalDefinitions.map(
      async (def: WebVitalDefinition): Promise<WebVital> => {
        let value: number | null = null;
        let metricName: string | null = null;
        for (const name of def.names) {
          // eslint-disable-next-line no-await-in-loop
          const series: Array<TimePoint> = await fetchMetricSeries({
            name: name,
            primaryEntityId: data.primaryEntityId,
            aggregationType: AggregationType.Avg,
            aggregationInterval: AggregationInterval.Total,
            start: data.start,
            end: data.end,
          });
          // One Total bucket; the mean only guards against a split answer.
          const mean: number | null = meanY(series);
          if (mean !== null) {
            value = mean;
            metricName = name;
            break;
          }
        }
        return {
          key: def.key,
          label: def.label,
          description: def.description,
          value: value,
          unit: def.unit,
          thresholds: def.thresholds,
          metricName: metricName,
        };
      },
    ),
  );
  return results;
};

export interface WebVitalRoute {
  route: string;
  value: number;
}

export interface WebVitalByRoute {
  // The attribute the routes were read from; null when none had data.
  routeAttribute: string | null;
  // Slowest first.
  routes: Array<WebVitalRoute>;
  // Every route that reported in the range, when more were left out.
  totalRoutes: number | null;
  // The lookup failed (e.g. a 403): unknown, not "no routes".
  failed: boolean;
}

export const WEB_VITAL_ROUTE_LIMIT: number = 10;

/*
 * One web vital's range mean per route, slowest first - the answer
 * to "which page is slow" that a single app-wide number cannot give, and
 * in a single-page app the only way to see INP per view at all. Reads the
 * route from the first of WebVitalRouteAttributeKeys that reports; rows
 * without the attribute (instrumentation that sends none) are not a route
 * and are left out rather than shown as a blank one.
 */
export const fetchWebVitalByRoute: (data: {
  primaryEntityId: ObjectID;
  metricName: string;
  start: Date;
  end: Date;
}) => Promise<WebVitalByRoute> = async (data: {
  primaryEntityId: ObjectID;
  metricName: string;
  start: Date;
  end: Date;
}): Promise<WebVitalByRoute> => {
  const empty: WebVitalByRoute = {
    routeAttribute: null,
    routes: [],
    totalRoutes: null,
    failed: false,
  };

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  if (!projectId) {
    return empty;
  }

  try {
    for (const routeAttribute of WebVitalRouteAttributeKeys) {
      // eslint-disable-next-line no-await-in-loop
      const result: AggregatedResult =
        await AnalyticsModelAPI.aggregate<Metric>({
          modelType: Metric,
          aggregateBy: {
            query: {
              projectId: projectId,
              time: new InBetween<Date>(data.start, data.end),
              name: data.metricName,
              primaryEntityId: data.primaryEntityId,
            },
            // A mean, like the vitals card and for the same reason.
            aggregationType: AggregationType.Avg,
            aggregationInterval: AggregationInterval.Total,
            aggregateColumnName: "value",
            aggregationTimestampColumnName: "time",
            startTimestamp: data.start,
            endTimestamp: data.end,
            groupByAttributeKeys: [routeAttribute],
            /*
             * One spare slot: the rows WITHOUT the attribute pool into one
             * blank group, which may rank among the slowest.
             */
            topK: { count: WEB_VITAL_ROUTE_LIMIT + 1, rankBy: "max" },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            sort: { time: SortOrder.Descending },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        });

      const routes: Array<WebVitalRoute> = [];
      let sawBlankRoute: boolean = false;

      for (const row of (result.data || []) as Array<AggregatedModel>) {
        const attributes: unknown = row["attributes"];
        const route: unknown =
          attributes && typeof attributes === "object"
            ? (attributes as Record<string, unknown>)[routeAttribute]
            : undefined;
        const value: number = Number(row["value"]);

        if (typeof route !== "string" || !route.trim()) {
          sawBlankRoute = true;
          continue;
        }

        if (Number.isFinite(value)) {
          routes.push({ route: route, value: value });
        }
      }

      if (routes.length === 0) {
        continue;
      }

      routes.sort((a: WebVitalRoute, b: WebVitalRoute): number => {
        return b.value - a.value;
      });

      const totalGroups: number | null =
        typeof result.totalGroups === "number" ? result.totalGroups : null;

      return {
        routeAttribute: routeAttribute,
        routes: routes.slice(0, WEB_VITAL_ROUTE_LIMIT),
        totalRoutes:
          totalGroups === null
            ? null
            : Math.max(routes.length, totalGroups - (sawBlankRoute ? 1 : 0)),
        failed: false,
      };
    }

    return empty;
  } catch {
    return { ...empty, failed: true };
  }
};

/*
 * Log + exception signal summaries for a resource's overview page —
 * one projection-backed histogram call per pillar, both scoped by the
 * resource's primaryEntityId. Complements SpanMetrics so an overview can
 * show all four golden-ish signals (rate, errors, duration, and the
 * log/exception context) without a raw-row scan.
 */

export interface LogSignalSummary {
  total: number;
  errorCount: number;
  countSeries: Array<TimePoint>;
  errorSeries: Array<TimePoint>;
  /*
   * The lookup failed (e.g. a 403 without log read access). The counts are
   * then zero, which is unknown rather than none - a tile should say so.
   */
  failed: boolean;
}

export interface ExceptionSignalSummary {
  total: number;
  unhandledCount: number;
  unhandledSeries: Array<TimePoint>;
  handledSeries: Array<TimePoint>;
  // As LogSignalSummary.failed.
  failed: boolean;
}

export interface LogAndExceptionSignals {
  logs: LogSignalSummary;
  exceptions: ExceptionSignalSummary;
}

// Log severities that count as errors (matches the server's default set).
const ERROR_LOG_SEVERITY_SET: Set<string> = new Set<string>(["Error", "Fatal"]);

export interface RawHistogramBucket {
  time?: string;
  severity?: string;
  series?: string;
  count?: number;
}

function addPoint(
  seriesByTime: Map<number, number>,
  time: string | undefined,
  count: number,
): void {
  if (!time) {
    return;
  }
  const ms: number = new Date(time).getTime();
  if (Number.isNaN(ms)) {
    return;
  }
  seriesByTime.set(ms, (seriesByTime.get(ms) || 0) + count);
}

function toSortedSeries(seriesByTime: Map<number, number>): Array<TimePoint> {
  return Array.from(seriesByTime.entries())
    .sort((a: [number, number], b: [number, number]) => {
      return a[0] - b[0];
    })
    .map(([ms, y]: [number, number]): TimePoint => {
      return { x: new Date(ms), y };
    });
}

/*
 * Fold the two histograms' buckets into per-pillar totals and series. A
 * pillar whose request failed is passed as null and comes back zeroed with
 * `failed` set, so a tile can say "could not load" instead of a confident 0.
 * Exported for tests.
 */
export const summarizeLogAndExceptionBuckets: (
  logBuckets: Array<RawHistogramBucket> | null,
  exceptionBuckets: Array<RawHistogramBucket> | null,
) => LogAndExceptionSignals = (
  logBuckets: Array<RawHistogramBucket> | null,
  exceptionBuckets: Array<RawHistogramBucket> | null,
): LogAndExceptionSignals => {
  const logCountByTime: Map<number, number> = new Map<number, number>();
  const logErrorByTime: Map<number, number> = new Map<number, number>();
  let logTotal: number = 0;
  let logErrorCount: number = 0;

  for (const bucket of logBuckets || []) {
    const count: number = typeof bucket.count === "number" ? bucket.count : 0;
    logTotal += count;
    addPoint(logCountByTime, bucket.time, count);
    if (ERROR_LOG_SEVERITY_SET.has(bucket.severity || "")) {
      logErrorCount += count;
      addPoint(logErrorByTime, bucket.time, count);
    }
  }

  const unhandledByTime: Map<number, number> = new Map<number, number>();
  const handledByTime: Map<number, number> = new Map<number, number>();
  let exceptionTotal: number = 0;
  let unhandledCount: number = 0;

  for (const bucket of exceptionBuckets || []) {
    const count: number = typeof bucket.count === "number" ? bucket.count : 0;
    exceptionTotal += count;
    if (bucket.series === "unhandled") {
      unhandledCount += count;
      addPoint(unhandledByTime, bucket.time, count);
    } else {
      addPoint(handledByTime, bucket.time, count);
    }
  }

  return {
    logs: {
      total: logTotal,
      errorCount: logErrorCount,
      countSeries: toSortedSeries(logCountByTime),
      errorSeries: toSortedSeries(logErrorByTime),
      failed: logBuckets === null,
    },
    exceptions: {
      total: exceptionTotal,
      unhandledCount,
      unhandledSeries: toSortedSeries(unhandledByTime),
      handledSeries: toSortedSeries(handledByTime),
      failed: exceptionBuckets === null,
    },
  };
};

export const fetchLogAndExceptionSignals: (scope: {
  primaryEntityId: ObjectID;
  start: Date;
  end: Date;
}) => Promise<LogAndExceptionSignals> = async (scope: {
  primaryEntityId: ObjectID;
  start: Date;
  end: Date;
}): Promise<LogAndExceptionSignals> => {
  const body: JSONObject = {
    startTime: scope.start.toISOString(),
    endTime: scope.end.toISOString(),
    serviceIds: [scope.primaryEntityId.toString()],
  };

  const postHistogram: (
    path: string,
  ) => Promise<Array<RawHistogramBucket>> = async (
    path: string,
  ): Promise<Array<RawHistogramBucket>> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post({
        url: URL.fromString(APP_API_URL.toString()).addRoute(path),
        data: body,
        headers: ModelAPI.getCommonHeaders(),
      });
    if (response instanceof HTTPErrorResponse) {
      throw response;
    }
    const buckets: unknown = response.data["buckets"];
    return Array.isArray(buckets) ? (buckets as Array<RawHistogramBucket>) : [];
  };

  // Overview signals are best-effort — a failure never breaks the page.
  const [logBuckets, exceptionBuckets]: [
    Array<RawHistogramBucket> | null,
    Array<RawHistogramBucket> | null,
  ] = await Promise.all([
    postHistogram("/telemetry/logs/histogram").catch((): null => {
      return null;
    }),
    postHistogram("/telemetry/exceptions/histogram").catch((): null => {
      return null;
    }),
  ]);

  return summarizeLogAndExceptionBuckets(logBuckets, exceptionBuckets);
};

/*
 * Whole-range statistics for the spans with one name - e.g. every
 * "documentLoad" span, one per full page load. Unlike SpanMetrics'
 * p95DurationMs (a mean of per-interval p95s), these percentiles are over
 * every matching span in the range at once.
 */
export interface SpanNameStats {
  count: number;
  errorCount: number;
  avgDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
}

/*
 * The first row of a /telemetry/traces/analytics table response, as
 * SpanNameStats. No row means no matching spans: zero, not unknown.
 * Exported for tests.
 */
export const spanNameStatsFromTableRows: (rows: unknown) => SpanNameStats = (
  rows: unknown,
): SpanNameStats => {
  const first: JSONObject | undefined =
    Array.isArray(rows) &&
    rows.length > 0 &&
    rows[0] &&
    typeof rows[0] === "object"
      ? (rows[0] as JSONObject)
      : undefined;

  const read: (key: string) => number = (key: string): number => {
    const value: number = Number(first?.[key]);
    return Number.isFinite(value) ? value : 0;
  };

  return {
    count: read("count"),
    errorCount: read("errorCount"),
    avgDurationMs: read("avgDurationMs"),
    p50DurationMs: read("p50DurationMs"),
    p95DurationMs: read("p95DurationMs"),
    p99DurationMs: read("p99DurationMs"),
  };
};

/*
 * One aggregated row for `spanName` under `primaryEntityId` over the range.
 * Rejects when the request fails, so the caller can tell "could not load"
 * from "none".
 */
export const fetchSpanNameStats: (scope: {
  primaryEntityId: ObjectID;
  spanName: string;
  start: Date;
  end: Date;
}) => Promise<SpanNameStats> = async (scope: {
  primaryEntityId: ObjectID;
  spanName: string;
  start: Date;
  end: Date;
}): Promise<SpanNameStats> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        "/telemetry/traces/analytics",
      ),
      data: {
        startTime: scope.start.toISOString(),
        endTime: scope.end.toISOString(),
        chartType: "table",
        metric: "count",
        // A table needs a dimension; the name filter leaves one row.
        groupBy: ["name"],
        spanNames: [scope.spanName],
        serviceIds: [scope.primaryEntityId.toString()],
        limit: 1,
      },
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return spanNameStatsFromTableRows(response.data["data"]);
};
