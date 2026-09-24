import { getDatabaseServerEntityKeysQueryValue } from "./DatabaseTelemetryScope";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  DatabaseServerMetricDefinition,
  getDatabaseServerMetrics,
} from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";

/*
 * The Database pages' own aggregate queries: the Overview's sections and
 * the Metrics tab's in-place chart of a clicked metric (the metric explorer
 * scopes by attributes only, so it cannot chart one database). Every query
 * here is scoped by `entityKeys: new Includes(keys)` — the database's key
 * set from DatabaseTelemetryScope — and NOTHING is sent for an empty key
 * set: the builders return null and the fetchers resolve to an empty result
 * without touching the API. (An empty Includes drops the predicate server
 * side, so a database with no parseable endpoint would otherwise chart the
 * whole project as its own traffic.)
 *
 * Kept local to the Databases product rather than added to
 * Components/TelemetryResource/telemetryMetrics, which scopes by attribute
 * or primaryEntityId only. No React here; the pure builders and the series
 * math are unit-tested, the fetchers are tested with the API mocked.
 */

export interface DatabaseTimePoint {
  x: Date;
  y: number;
}

/*
 * RED over the database's CLIENT spans: how often applications query it,
 * how often those queries fail, and how long they take (p95).
 */
export interface DatabaseQueryMetrics {
  total: number;
  errors: number;
  errorRatePercent: number | null;
  p95DurationMs: number | null;
  countSeries: Array<DatabaseTimePoint>;
  errorSeries: Array<DatabaseTimePoint>;
  p95Series: Array<DatabaseTimePoint>;
}

/** One application service that queries the database. */
export interface DatabaseCallingService {
  // Span.primaryEntityId — the calling Service's id.
  serviceId: string;
  calls: number;
  errors: number;
  errorRatePercent: number | null;
  p95DurationMs: number | null;
}

export interface DatabaseQueryWindow {
  projectId: ObjectID | string | null | undefined;
  keys: ReadonlyArray<string>;
  start: Date;
  end: Date;
}

export const EMPTY_DATABASE_QUERY_METRICS: DatabaseQueryMetrics = {
  total: 0,
  errors: 0,
  errorRatePercent: null,
  p95DurationMs: null,
  countSeries: [],
  errorSeries: [],
  p95Series: [],
};

export const DEFAULT_CALLING_SERVICE_LIMIT: number = 10;

const NANOSECONDS_PER_MILLISECOND: number = 1_000_000;

function projectIdOf(
  projectId: ObjectID | string | null | undefined,
): ObjectID | null {
  if (!projectId) {
    return null;
  }
  if (projectId instanceof ObjectID) {
    return projectId;
  }
  const text: string = String(projectId).trim();
  return text ? new ObjectID(text) : null;
}

/**
 * The Span query for the database's client spans in a window, or null when
 * the database is unscoped (no keys) or there is no project. `errorsOnly`
 * narrows to failed queries.
 */
export function buildDatabaseSpanQuery(
  window: DatabaseQueryWindow,
  options?: { errorsOnly?: boolean | undefined },
): Record<string, unknown> | null {
  const entityKeys: Includes | null = getDatabaseServerEntityKeysQueryValue(
    window.keys,
  );
  const projectId: ObjectID | null = projectIdOf(window.projectId);

  if (!entityKeys || !projectId) {
    return null;
  }

  const query: Record<string, unknown> = {
    projectId: projectId,
    startTime: new InBetween<Date>(window.start, window.end),
    entityKeys: entityKeys,
    /*
     * Only CLIENT spans carry a database endpoint key; the filter keeps a
     * member key (a database pod that happens to be instrumented) from
     * adding the database's OWN outbound calls to "queries from
     * applications".
     */
    kind: SpanKind.Client,
  };

  if (options?.errorsOnly) {
    query["statusCode"] = SpanStatus.Error;
  }

  return query;
}

/**
 * The Metric query for one metric name over the database's keys, or null
 * when unscoped.
 */
export function buildDatabaseMetricQuery(
  window: DatabaseQueryWindow & { metricName: string },
): Record<string, unknown> | null {
  const entityKeys: Includes | null = getDatabaseServerEntityKeysQueryValue(
    window.keys,
  );
  const projectId: ObjectID | null = projectIdOf(window.projectId);
  const metricName: string = (window.metricName || "").trim();

  if (!entityKeys || !projectId || !metricName) {
    return null;
  }

  return {
    projectId: projectId,
    time: new InBetween<Date>(window.start, window.end),
    name: metricName,
    entityKeys: entityKeys,
  };
}

function bucketDate(point: AggregatedModel): Date | null {
  const raw: unknown =
    point["timestamp"] !== undefined ? point["timestamp"] : point["time"];
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === "string" || typeof raw === "number") {
    const date: Date = new Date(raw);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/**
 * Aggregated rows → time points sorted by time. Rows without a usable
 * bucket or a finite value are skipped; `scale` converts units.
 */
export function aggregatedResultToTimePoints(
  result: AggregatedResult | null | undefined,
  scale: number = 1,
): Array<DatabaseTimePoint> {
  const points: Array<DatabaseTimePoint> = [];
  for (const row of (result?.data || []) as Array<AggregatedModel>) {
    const x: Date | null = bucketDate(row);
    const y: number = Number(row["value"]);
    if (x && Number.isFinite(y)) {
      points.push({ x: x, y: y * scale });
    }
  }
  points.sort((a: DatabaseTimePoint, b: DatabaseTimePoint): number => {
    return a.x.getTime() - b.x.getTime();
  });
  return points;
}

function sum(series: ReadonlyArray<DatabaseTimePoint>): number {
  return series.reduce((total: number, point: DatabaseTimePoint): number => {
    return total + point.y;
  }, 0);
}

/** Mean of the points, or null for an empty series. */
export function meanOfSeries(
  series: ReadonlyArray<DatabaseTimePoint>,
): number | null {
  if (series.length === 0) {
    return null;
  }
  return sum(series) / series.length;
}

/** The most recent point's value, or null for an empty series. */
export function latestOfSeries(
  series: ReadonlyArray<DatabaseTimePoint>,
): number | null {
  if (series.length === 0) {
    return null;
  }
  let latest: DatabaseTimePoint = series[0]!;
  for (const point of series) {
    if (point.x.getTime() >= latest.x.getTime()) {
      latest = point;
    }
  }
  return latest.y;
}

/**
 * A cumulative counter (commits, commands processed) as a per-second rate,
 * computed client-side from consecutive buckets: (v[i] - v[i-1]) / Δt. The
 * rate is stamped at the later bucket. A drop in the cumulative value is a
 * restart (the counter went back to zero) — that interval is skipped rather
 * than charted as a huge negative rate. Unsorted input is sorted; buckets
 * with the same timestamp are skipped (no Δt).
 */
export function counterSeriesToRatePerSecond(
  series: ReadonlyArray<DatabaseTimePoint>,
): Array<DatabaseTimePoint> {
  const sorted: Array<DatabaseTimePoint> = [...series]
    .filter((point: DatabaseTimePoint): boolean => {
      return (
        point &&
        point.x instanceof Date &&
        Number.isFinite(point.x.getTime()) &&
        Number.isFinite(point.y)
      );
    })
    .sort((a: DatabaseTimePoint, b: DatabaseTimePoint): number => {
      return a.x.getTime() - b.x.getTime();
    });

  const rates: Array<DatabaseTimePoint> = [];
  for (let i: number = 1; i < sorted.length; i++) {
    const previous: DatabaseTimePoint = sorted[i - 1]!;
    const current: DatabaseTimePoint = sorted[i]!;
    const seconds: number = (current.x.getTime() - previous.x.getTime()) / 1000;
    const delta: number = current.y - previous.y;
    if (seconds <= 0 || delta < 0) {
      continue;
    }
    rates.push({ x: current.x, y: delta / seconds });
  }
  return rates;
}

function aggregateBy<TModel extends Span | Metric>(data: {
  query: Record<string, unknown>;
  aggregationType: AggregationType;
  aggregateColumnName: string;
  timestampColumnName: string;
  start: Date;
  end: Date;
  groupBy?: Record<string, true> | undefined;
  aggregationInterval?: AggregationInterval | undefined;
  topK?: { count: number; rankBy: "max" | "avg" } | undefined;
}): AggregateBy<TModel> {
  const request: Record<string, unknown> = {
    query: data.query,
    aggregationType: data.aggregationType,
    aggregateColumnName: data.aggregateColumnName,
    aggregationTimestampColumnName: data.timestampColumnName,
    startTimestamp: data.start,
    endTimestamp: data.end,
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    sort: { [data.timestampColumnName]: SortOrder.Descending },
  };
  if (data.groupBy) {
    request["groupBy"] = data.groupBy;
  }
  if (data.aggregationInterval) {
    request["aggregationInterval"] = data.aggregationInterval;
  }
  if (data.topK) {
    request["topK"] = data.topK;
  }
  return request as unknown as AggregateBy<TModel>;
}

/**
 * Rate, errors and p95 duration of the queries applications send the
 * database. Resolves to the empty metrics (no API call) when unscoped; a
 * failed request also resolves to the empty metrics so the Overview never
 * breaks on one bad chart.
 */
export async function fetchDatabaseQueryMetrics(
  window: DatabaseQueryWindow,
): Promise<DatabaseQueryMetrics> {
  const baseQuery: Record<string, unknown> | null =
    buildDatabaseSpanQuery(window);
  const errorQuery: Record<string, unknown> | null = buildDatabaseSpanQuery(
    window,
    { errorsOnly: true },
  );

  if (!baseQuery || !errorQuery) {
    return { ...EMPTY_DATABASE_QUERY_METRICS };
  }

  const build: (
    query: Record<string, unknown>,
    aggregationType: AggregationType,
  ) => AggregateBy<Span> = (
    query: Record<string, unknown>,
    aggregationType: AggregationType,
  ): AggregateBy<Span> => {
    return aggregateBy<Span>({
      query: query,
      aggregationType: aggregationType,
      aggregateColumnName: "durationUnixNano",
      timestampColumnName: "startTime",
      start: window.start,
      end: window.end,
    });
  };

  try {
    const [countResult, errorResult, p95Result]: [
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
    ] = await Promise.all([
      AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: build(baseQuery, AggregationType.Count),
      }),
      AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: build(errorQuery, AggregationType.Count),
      }),
      AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: build(baseQuery, AggregationType.P95),
      }),
    ]);

    const countSeries: Array<DatabaseTimePoint> =
      aggregatedResultToTimePoints(countResult);
    const errorSeries: Array<DatabaseTimePoint> =
      aggregatedResultToTimePoints(errorResult);
    const p95Series: Array<DatabaseTimePoint> = aggregatedResultToTimePoints(
      p95Result,
      1 / NANOSECONDS_PER_MILLISECOND,
    );

    const total: number = sum(countSeries);
    const errors: number = sum(errorSeries);

    return {
      total: total,
      errors: errors,
      errorRatePercent: total > 0 ? (errors / total) * 100 : null,
      p95DurationMs: meanOfSeries(p95Series),
      countSeries: countSeries,
      errorSeries: errorSeries,
      p95Series: p95Series,
    };
  } catch {
    return { ...EMPTY_DATABASE_QUERY_METRICS };
  }
}

function groupValues(
  result: AggregatedResult | null | undefined,
  scale: number = 1,
): Map<string, number> {
  const values: Map<string, number> = new Map<string, number>();
  for (const row of (result?.data || []) as Array<AggregatedModel>) {
    const raw: unknown = row["primaryEntityId"];
    const id: string =
      raw === null || raw === undefined ? "" : String(raw).trim();
    const value: number = Number(row["value"]);
    if (!id || !Number.isFinite(value)) {
      continue;
    }
    values.set(id, (values.get(id) || 0) + value * scale);
  }
  return values;
}

/**
 * Combine the three grouped aggregates (calls, failed calls, p95) into one
 * row per calling service, busiest first, at most `limit` rows. Pure — the
 * fetcher below and the tests share it.
 */
export function combineCallingServiceResults(data: {
  countResult: AggregatedResult | null | undefined;
  errorResult: AggregatedResult | null | undefined;
  p95Result: AggregatedResult | null | undefined;
  limit?: number | undefined;
}): Array<DatabaseCallingService> {
  const calls: Map<string, number> = groupValues(data.countResult);
  const errors: Map<string, number> = groupValues(data.errorResult);
  const p95: Map<string, number> = groupValues(
    data.p95Result,
    1 / NANOSECONDS_PER_MILLISECOND,
  );

  const limit: number =
    typeof data.limit === "number" && data.limit > 0
      ? Math.floor(data.limit)
      : DEFAULT_CALLING_SERVICE_LIMIT;

  const rows: Array<DatabaseCallingService> = [];
  for (const [serviceId, callCount] of calls) {
    const errorCount: number = Math.min(errors.get(serviceId) || 0, callCount);
    const p95Value: number | undefined = p95.get(serviceId);
    rows.push({
      serviceId: serviceId,
      calls: callCount,
      errors: errorCount,
      errorRatePercent: callCount > 0 ? (errorCount / callCount) * 100 : null,
      p95DurationMs:
        typeof p95Value === "number" && Number.isFinite(p95Value)
          ? p95Value
          : null,
    });
  }

  rows.sort((a: DatabaseCallingService, b: DatabaseCallingService): number => {
    if (b.calls !== a.calls) {
      return b.calls - a.calls;
    }
    return a.serviceId < b.serviceId ? -1 : a.serviceId > b.serviceId ? 1 : 0;
  });

  return rows.slice(0, limit);
}

/**
 * The application services that query the database, busiest first — the
 * client spans grouped by their service (primaryEntityId) over the whole
 * window. Empty (no API call) when unscoped or on failure.
 */
export async function fetchDatabaseCallingServices(
  window: DatabaseQueryWindow & { limit?: number | undefined },
): Promise<Array<DatabaseCallingService>> {
  const baseQuery: Record<string, unknown> | null =
    buildDatabaseSpanQuery(window);
  const errorQuery: Record<string, unknown> | null = buildDatabaseSpanQuery(
    window,
    { errorsOnly: true },
  );

  if (!baseQuery || !errorQuery) {
    return [];
  }

  const limit: number =
    typeof window.limit === "number" && window.limit > 0
      ? Math.floor(window.limit)
      : DEFAULT_CALLING_SERVICE_LIMIT;

  const build: (
    query: Record<string, unknown>,
    aggregationType: AggregationType,
  ) => AggregateBy<Span> = (
    query: Record<string, unknown>,
    aggregationType: AggregationType,
  ): AggregateBy<Span> => {
    return aggregateBy<Span>({
      query: query,
      aggregationType: aggregationType,
      aggregateColumnName: "durationUnixNano",
      timestampColumnName: "startTime",
      start: window.start,
      end: window.end,
      groupBy: { primaryEntityId: true },
      aggregationInterval: AggregationInterval.Total,
    });
  };

  try {
    const [countResult, errorResult, p95Result]: [
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
    ] = await Promise.all([
      AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: build(baseQuery, AggregationType.Count),
      }),
      AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: build(errorQuery, AggregationType.Count),
      }),
      AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: build(baseQuery, AggregationType.P95),
      }),
    ]);

    return combineCallingServiceResults({
      countResult,
      errorResult,
      p95Result,
      limit,
    });
  } catch {
    return [];
  }
}

/**
 * One metric's series over the database's keys, per time bucket. Empty (no
 * API call) when unscoped or on failure.
 */
export async function fetchDatabaseMetricSeries(
  window: DatabaseQueryWindow & {
    metricName: string;
    aggregationType: AggregationType;
  },
): Promise<Array<DatabaseTimePoint>> {
  const query: Record<string, unknown> | null =
    buildDatabaseMetricQuery(window);
  if (!query) {
    return [];
  }

  try {
    const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
      modelType: Metric,
      aggregateBy: aggregateBy<Metric>({
        query: query,
        aggregationType: window.aggregationType,
        aggregateColumnName: "value",
        timestampColumnName: "time",
        start: window.start,
        end: window.end,
      }),
    });
    return aggregatedResultToTimePoints(result);
  } catch {
    return [];
  }
}

/** A catalog metric with the series to chart and the value its tile shows. */
export interface DatabaseEngineMetricResult {
  definition: DatabaseServerMetricDefinition;
  // Gauges: the bucketed values. Counters: the per-second rate series.
  series: Array<DatabaseTimePoint>;
  // Gauges: the latest bucket. Counters: the mean rate over the window.
  value: number | null;
}

/**
 * Chart-ready form of one catalog metric's raw series: gauges as they are,
 * counters (cumulative) converted to a per-second rate.
 */
export function toEngineMetricResult(
  definition: DatabaseServerMetricDefinition,
  raw: ReadonlyArray<DatabaseTimePoint>,
): DatabaseEngineMetricResult {
  if (definition.kind === "counter") {
    const rate: Array<DatabaseTimePoint> = counterSeriesToRatePerSecond(raw);
    return { definition, series: rate, value: meanOfSeries(rate) };
  }
  const series: Array<DatabaseTimePoint> = [...raw];
  return { definition, series, value: latestOfSeries(series) };
}

/**
 * Every catalog metric of the engine, fetched in parallel. Empty (no API
 * call) when unscoped.
 */
export async function fetchDatabaseEngineMetrics(
  window: DatabaseQueryWindow & {
    metrics: ReadonlyArray<DatabaseServerMetricDefinition>;
  },
): Promise<Array<DatabaseEngineMetricResult>> {
  if (!getDatabaseServerEntityKeysQueryValue(window.keys)) {
    return [];
  }

  return Promise.all(
    window.metrics.map(
      async (
        definition: DatabaseServerMetricDefinition,
      ): Promise<DatabaseEngineMetricResult> => {
        const raw: Array<DatabaseTimePoint> = await fetchDatabaseMetricSeries({
          projectId: window.projectId,
          keys: window.keys,
          start: window.start,
          end: window.end,
          metricName: definition.metricName,
          aggregationType: definition.aggregation,
        });
        return toEngineMetricResult(definition, raw);
      },
    ),
  );
}

/** True when any engine metric returned at least one point. */
export function hasEngineMetricData(
  results: ReadonlyArray<DatabaseEngineMetricResult>,
): boolean {
  return results.some((result: DatabaseEngineMetricResult): boolean => {
    return result.series.length > 0;
  });
}

/*
 * The aggregations the in-place metric chart (the Metrics tab's row click)
 * offers for a metric outside the engine's curated set. A curated counter
 * is not offered a choice: it is charted as a rate, which only Max per
 * bucket gives (see the catalog).
 */
export const DATABASE_METRIC_CHART_AGGREGATIONS: ReadonlyArray<AggregationType> =
  [
    AggregationType.Avg,
    AggregationType.Max,
    AggregationType.Min,
    AggregationType.Sum,
  ];

/** How one metric, clicked on a database's Metrics tab, is charted. */
export interface DatabaseMetricChartSpec {
  metricName: string;
  // The catalog title for a curated metric, else the metric name.
  title: string;
  // The engine's catalog entry for this metric, when it has one.
  definition: DatabaseServerMetricDefinition | null;
  defaultAggregation: AggregationType;
  // A curated counter: charted as a per-second rate, never re-aggregated.
  isRate: boolean;
}

/**
 * The chart spec for a metric of this database: a curated metric keeps the
 * catalog's aggregation and title (a counter becomes a per-second rate);
 * any other metric is averaged per bucket, like the metric explorer does.
 */
export function getDatabaseMetricChartSpec(
  metricName: string,
  dbSystem: string | null | undefined,
): DatabaseMetricChartSpec {
  const name: string = (metricName || "").trim();
  const definition: DatabaseServerMetricDefinition | null =
    getDatabaseServerMetrics(dbSystem).find(
      (candidate: DatabaseServerMetricDefinition): boolean => {
        return candidate.metricName === name;
      },
    ) || null;

  if (!definition) {
    return {
      metricName: name,
      title: name,
      definition: null,
      defaultAggregation: AggregationType.Avg,
      isRate: false,
    };
  }

  const isRate: boolean = definition.kind === "counter";

  return {
    metricName: name,
    title: isRate ? `${definition.title} (per second)` : definition.title,
    definition: definition,
    defaultAggregation: definition.aggregation,
    isRate: isRate,
  };
}

/**
 * The series for the in-place metric chart, over the database's keys. A
 * curated counter is fetched with its catalog aggregation and converted to
 * a per-second rate whatever `aggregationType` says. Empty (no API call)
 * when unscoped or on failure.
 */
export async function fetchDatabaseMetricChartSeries(
  window: DatabaseQueryWindow & {
    spec: DatabaseMetricChartSpec;
    aggregationType: AggregationType;
  },
): Promise<Array<DatabaseTimePoint>> {
  const aggregationType: AggregationType =
    window.spec.isRate && window.spec.definition
      ? window.spec.definition.aggregation
      : window.aggregationType;

  const raw: Array<DatabaseTimePoint> = await fetchDatabaseMetricSeries({
    projectId: window.projectId,
    keys: window.keys,
    start: window.start,
    end: window.end,
    metricName: window.spec.metricName,
    aggregationType: aggregationType,
  });

  return window.spec.isRate ? counterSeriesToRatePerSecond(raw) : raw;
}
