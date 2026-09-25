import { getDatabaseServerEntityKeysQueryValue } from "./DatabaseTelemetryScope";
import {
  CounterRatePoint,
  computeCounterRate,
} from "../../../Utils/CounterRateUtils";
import Metric, {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { DATABASE_CONNECTION_SPAN_NAMES } from "Common/Types/DatabaseServer/DatabaseConnectionSpan";
import {
  DatabaseServerMetricDefinition,
  DatabaseServerMetricSeriesCombine,
  findDatabaseServerMetricByName,
  getDatabaseServerMetricGroupKeys,
} from "Common/Types/DatabaseServer/DatabaseServerMetricCatalog";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";

/*
 * The Database pages' own aggregate queries: the Overview's sections and
 * the Metrics tab's in-place chart of a clicked metric (the metric explorer
 * scopes by attributes only, so it cannot chart one database). Every query
 * here is scoped by `entityKeys: new Includes(keys)` — the database's key
 * set from DatabaseTelemetryScope — and NOTHING is sent for an empty key
 * set: the builders return null and the fetchers resolve to an empty result
 * without touching the API. (An empty Includes drops the predicate server
 * side, so a database with no parseable endpoint would otherwise chart the
 * whole project as its own traffic.) The only attribute filter ever sent is
 * a catalog entry's own pin (connections of type "current"); it narrows a
 * metric, it never scopes the database.
 *
 * Engine metrics are almost never one series (see the catalog), so they are
 * read per series and combined here: gauges grouped by the entry's series
 * keys and reporting instance, then summed / maxed per bucket; cumulative
 * counters grouped by their whole attribute set and turned into a rate per
 * series (CounterRateUtils, shared with the Ceph / Proxmox / Kubernetes
 * rate charts) before the rates are summed.
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
  // The p95 of every query in the window (one percentile, not an average).
  p95DurationMs: number | null;
  countSeries: Array<DatabaseTimePoint>;
  errorSeries: Array<DatabaseTimePoint>;
  // The p95 of each time bucket, for the chart.
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

/*
 * The busiest calling services (at most the limit) and how many services
 * called the database in all — the table shows the first, the Overview's
 * tile the second.
 */
export interface DatabaseCallingServices {
  services: Array<DatabaseCallingService>;
  total: number;
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

export const EMPTY_DATABASE_CALLING_SERVICES: DatabaseCallingServices = {
  services: [],
  total: 0,
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

/*
 * The span names a "Queries" count leaves out (DatabaseConnectionSpan): as
 * the instrumentations spell them, and lower-cased — the column comparison
 * is exact, while the shared rule compares without case.
 */
export function getDatabaseConnectionSpanNameExclusions(): Array<string> {
  const names: Array<string> = [];
  for (const name of DATABASE_CONNECTION_SPAN_NAMES) {
    for (const variant of [name, name.toLowerCase()]) {
      if (!names.includes(variant)) {
        names.push(variant);
      }
    }
  }
  return names;
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
    /*
     * Queries only: a client library's connection-management spans
     * (`pg-pool.connect`, `pg.connect`, `redis-connect`, ...) carry the same
     * endpoint, and counted as calls they doubled a pooled client's
     * "Queries". The list is the one client-span discovery's min-calls
     * threshold leaves out, so the two counts agree.
     */
    name: new IncludesNone(getDatabaseConnectionSpanNameExclusions()),
  };

  if (options?.errorsOnly) {
    query["statusCode"] = SpanStatus.Error;
  }

  return query;
}

function pinsOf(
  pins: Readonly<Record<string, string>> | null | undefined,
): Record<string, string> | null {
  const entries: Array<[string, string]> = Object.entries(pins || {}).filter(
    ([key, value]: [string, string]): boolean => {
      return (
        typeof key === "string" &&
        key.trim().length > 0 &&
        typeof value === "string" &&
        value.length > 0
      );
    },
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * The Metric query for one metric name over the database's keys, or null
 * when unscoped. `pins` is a catalog entry's datapoint-attribute filter
 * (e.g. `{ type: "current" }`) — it narrows the metric to one breakdown
 * value and is the only attribute predicate this file ever sends.
 */
export function buildDatabaseMetricQuery(
  window: DatabaseQueryWindow & {
    metricName: string;
    pins?: Readonly<Record<string, string>> | null | undefined;
  },
): Record<string, unknown> | null {
  const entityKeys: Includes | null = getDatabaseServerEntityKeysQueryValue(
    window.keys,
  );
  const projectId: ObjectID | null = projectIdOf(window.projectId);
  const metricName: string = (window.metricName || "").trim();

  if (!entityKeys || !projectId || !metricName) {
    return null;
  }

  const query: Record<string, unknown> = {
    projectId: projectId,
    time: new InBetween<Date>(window.start, window.end),
    name: metricName,
    entityKeys: entityKeys,
  };

  const pins: Record<string, string> | null = pinsOf(window.pins);
  if (pins) {
    query["attributes"] = pins;
  }

  return query;
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

function sortByTime(
  points: Array<DatabaseTimePoint>,
): Array<DatabaseTimePoint> {
  return points.sort((a: DatabaseTimePoint, b: DatabaseTimePoint): number => {
    return a.x.getTime() - b.x.getTime();
  });
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
  return sortByTime(points);
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
 * The identity of one series in a grouped result: its attribute map (the
 * whole map for `groupBy: { attributes: true }`, the grouped keys for
 * `groupByAttributeKeys`), keys sorted so the same series always gets the
 * same key. A row without attributes is the single ungrouped series.
 */
export function getAttributeSeriesKey(attributes: unknown): string {
  if (!attributes || typeof attributes !== "object") {
    return "{}";
  }
  const record: Record<string, unknown> = attributes as Record<string, unknown>;
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(record).sort()) {
    const value: unknown = record[key];
    sorted[key] =
      value === null || value === undefined
        ? ""
        : typeof value === "object"
          ? JSON.stringify(value)
          : String(value);
  }
  return JSON.stringify(sorted);
}

function combineValues(
  values: ReadonlyArray<number>,
  combine: DatabaseServerMetricSeriesCombine,
): number {
  switch (combine) {
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
    case "avg":
      return (
        values.reduce((total: number, value: number): number => {
          return total + value;
        }, 0) / values.length
      );
    default:
      return values.reduce((total: number, value: number): number => {
        return total + value;
      }, 0);
  }
}

/*
 * How many buckets a series' last value stands in for it when it has no row
 * (see combineGaugeSeries). Two: a member scraping every 30 s is in every
 * one-minute bucket once complete, so it is only ever missing from the one
 * still filling; one that has been silent for longer is gone.
 */
export const DATABASE_GAUGE_CARRY_FORWARD_BUCKETS: number = 2;

/*
 * The bucket width of a result, read off its bucket times (the interval
 * the server picked is not in the result): the median gap between
 * consecutive buckets, so a stretch with no data at all does not widen it.
 * Null with fewer than two buckets.
 */
function bucketWidthOf(times: ReadonlyArray<number>): number | null {
  const gaps: Array<number> = [];
  for (let index: number = 1; index < times.length; index++) {
    const gap: number = times[index]! - times[index - 1]!;
    if (gap > 0) {
      gaps.push(gap);
    }
  }
  if (gaps.length === 0) {
    return null;
  }
  gaps.sort((a: number, b: number): number => {
    return a - b;
  });
  return gaps[Math.floor((gaps.length - 1) / 2)]!;
}

/**
 * A grouped gauge result (one row per series per bucket) → one point per
 * bucket: the series of each bucket combined with `combine` — "sum" when
 * they are parts of one total (backends per database), "max" / "min" for
 * the worst one, "avg" for ratios. Rows without a bucket or a finite value
 * are skipped.
 *
 * A series with no row in a bucket keeps its last value there for up to
 * DATABASE_GAUGE_CARRY_FORWARD_BUCKETS buckets. Agents of one database (a
 * replica set's members) scrape at their own moments, and the newest bucket
 * — the window ends now — is still filling: counting only the members that
 * already reported would show a third of a three-member total, or miss the
 * member a "min" is about. A series silent for longer is gone and stops
 * counting; nothing is carried backwards or across a gap in the whole
 * metric.
 */
export function combineGaugeSeries(
  result: AggregatedResult | null | undefined,
  combine: DatabaseServerMetricSeriesCombine,
): Array<DatabaseTimePoint> {
  // bucket time → (series key → value); a repeated row keeps the last.
  const buckets: Map<number, Map<string, number>> = new Map();

  for (const row of (result?.data || []) as Array<AggregatedModel>) {
    const x: Date | null = bucketDate(row);
    const y: number = Number(row["value"]);
    if (!x || !Number.isFinite(y)) {
      continue;
    }
    const time: number = x.getTime();
    let series: Map<string, number> | undefined = buckets.get(time);
    if (!series) {
      series = new Map<string, number>();
      buckets.set(time, series);
    }
    series.set(getAttributeSeriesKey(row["attributes"]), y);
  }

  const times: Array<number> = Array.from(buckets.keys()).sort(
    (a: number, b: number): number => {
      return a - b;
    },
  );
  const width: number | null = bucketWidthOf(times);
  const carryFor: number =
    width === null ? 0 : width * DATABASE_GAUGE_CARRY_FORWARD_BUCKETS;

  // series key → its newest value so far, and the bucket it came from.
  const lastSeen: Map<string, { value: number; time: number }> = new Map();

  const points: Array<DatabaseTimePoint> = [];
  for (const time of times) {
    for (const [key, value] of buckets.get(time)!) {
      lastSeen.set(key, { value: value, time: time });
    }
    const values: Array<number> = [];
    for (const [key, seen] of lastSeen) {
      if (time - seen.time <= carryFor) {
        values.push(seen.value);
      } else {
        lastSeen.delete(key);
      }
    }
    points.push({ x: new Date(time), y: combineValues(values, combine) });
  }
  return points;
}

/**
 * A grouped cumulative-counter result (one row per series per bucket, the
 * Max of the bucket) → a per-second rate: consecutive buckets differenced
 * PER SERIES, a reset clamped to zero, then the rates of every series
 * summed per bucket (CounterRateUtils.computeCounterRate). A cumulative
 * value is never compared across two series, so the busiest database, a
 * row-lock time counter or a second agent cannot masquerade as the rate.
 */
export function counterResultToRatePerSecond(
  result: AggregatedResult | null | undefined,
): Array<DatabaseTimePoint> {
  if (!result) {
    return [];
  }
  return computeCounterRate(result, {
    getSeriesKey: (attributes: Record<string, unknown>): string => {
      return getAttributeSeriesKey(attributes);
    },
  }).map((point: CounterRatePoint): DatabaseTimePoint => {
    return { x: point.x, y: point.y };
  });
}

function aggregateBy<TModel extends Span | Metric>(data: {
  query: Record<string, unknown>;
  aggregationType: AggregationType;
  aggregateColumnName: string;
  timestampColumnName: string;
  start: Date;
  end: Date;
  groupBy?: Record<string, true> | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
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
  if (data.groupByAttributeKeys && data.groupByAttributeKeys.length > 0) {
    request["groupByAttributeKeys"] = data.groupByAttributeKeys;
  }
  if (data.aggregationInterval) {
    request["aggregationInterval"] = data.aggregationInterval;
  }
  if (data.topK) {
    request["topK"] = data.topK;
  }
  return request as unknown as AggregateBy<TModel>;
}

function firstFiniteValue(
  result: AggregatedResult | null | undefined,
  scale: number = 1,
): number | null {
  for (const row of (result?.data || []) as Array<AggregatedModel>) {
    const value: number = Number(row["value"]);
    if (Number.isFinite(value)) {
      return value * scale;
    }
  }
  return null;
}

/**
 * The points of a per-bucket COUNT series whose bucket lies wholly inside
 * the window. The window ends now, so its newest bucket is still filling
 * (and its oldest started before the window did): charted as is, every
 * "Queries from applications" line fell at its right edge, as if traffic
 * had halved. The bucket width is the one the aggregate API picks for the
 * window (AggregationIntervalUtil, the server's own rule). A series whose
 * every bucket is partial — a window shorter than one bucket — is kept.
 */
export function getCompleteBucketSeries(
  series: ReadonlyArray<DatabaseTimePoint>,
  window: { start: Date; end: Date },
): Array<DatabaseTimePoint> {
  const width: number = AggregationIntervalUtil.getAggregationIntervalMs(
    AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: window.start,
      endDate: window.end,
    }),
  );
  if (!Number.isFinite(width) || width <= 0) {
    return [...series];
  }
  const start: number = window.start.getTime();
  const end: number = window.end.getTime();
  const complete: Array<DatabaseTimePoint> = series.filter(
    (point: DatabaseTimePoint): boolean => {
      const bucketStart: number = point.x.getTime();
      return bucketStart >= start && bucketStart + width <= end;
    },
  );
  return complete.length > 0 ? complete : [...series];
}

/**
 * Rate, errors and p95 duration of the queries applications send the
 * database. The tile's p95 is ONE percentile over every query in the window
 * (not the mean of per-bucket p95s); the chart keeps the per-bucket p95.
 * Resolves to the empty metrics (no API call) when unscoped; a failed
 * request also resolves to the empty metrics so the Overview never breaks
 * on one bad chart.
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
    aggregationInterval?: AggregationInterval,
  ) => AggregateBy<Span> = (
    query: Record<string, unknown>,
    aggregationType: AggregationType,
    aggregationInterval?: AggregationInterval,
  ): AggregateBy<Span> => {
    return aggregateBy<Span>({
      query: query,
      aggregationType: aggregationType,
      aggregateColumnName: "durationUnixNano",
      timestampColumnName: "startTime",
      start: window.start,
      end: window.end,
      aggregationInterval: aggregationInterval,
    });
  };

  try {
    const [countResult, errorResult, p95Result, windowP95Result]: [
      AggregatedResult,
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
      AnalyticsModelAPI.aggregate<Span>({
        modelType: Span,
        aggregateBy: build(
          baseQuery,
          AggregationType.P95,
          AggregationInterval.Total,
        ),
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

    // The tiles count every query in the range, partial buckets included.
    const total: number = sum(countSeries);
    const errors: number = sum(errorSeries);

    return {
      total: total,
      errors: errors,
      errorRatePercent: total > 0 ? (errors / total) * 100 : null,
      p95DurationMs:
        total > 0
          ? firstFiniteValue(windowP95Result, 1 / NANOSECONDS_PER_MILLISECOND)
          : null,
      countSeries: getCompleteBucketSeries(countSeries, window),
      errorSeries: getCompleteBucketSeries(errorSeries, window),
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
 * row per calling service, busiest first, at most `limit` rows — plus the
 * number of services that called at all, counted BEFORE the limit. Pure —
 * the fetcher below and the tests share it.
 */
export function combineCallingServiceResults(data: {
  countResult: AggregatedResult | null | undefined;
  errorResult: AggregatedResult | null | undefined;
  p95Result: AggregatedResult | null | undefined;
  limit?: number | undefined;
}): DatabaseCallingServices {
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

  return { services: rows.slice(0, limit), total: rows.length };
}

/**
 * The application services that query the database, busiest first — the
 * client spans grouped by their service (primaryEntityId) over the whole
 * window — and how many there are in all. Empty (no API call) when unscoped
 * or on failure.
 */
export async function fetchDatabaseCallingServices(
  window: DatabaseQueryWindow & { limit?: number | undefined },
): Promise<DatabaseCallingServices> {
  const baseQuery: Record<string, unknown> | null =
    buildDatabaseSpanQuery(window);
  const errorQuery: Record<string, unknown> | null = buildDatabaseSpanQuery(
    window,
    { errorsOnly: true },
  );

  if (!baseQuery || !errorQuery) {
    return { ...EMPTY_DATABASE_CALLING_SERVICES, services: [] };
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
    return { ...EMPTY_DATABASE_CALLING_SERVICES, services: [] };
  }
}

/**
 * One metric as a single series over the database's keys, per time bucket
 * — every series of the metric pooled with `aggregationType`. Right for a
 * metric whose pooled value means something (a pod's CPU averaged across
 * pods, a histogram's percentile), never for an engine counter. Empty (no
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

/**
 * A cumulative monotonic counter as a per-second rate over the database's
 * keys: the Max of every distinct series per bucket (`groupBy: { attributes:
 * true }`), a rate per series, the rates summed. `pins` narrows it to one
 * breakdown value. Empty (no API call) when unscoped or on failure.
 */
export async function fetchDatabaseCounterRateSeries(
  window: DatabaseQueryWindow & {
    metricName: string;
    pins?: Readonly<Record<string, string>> | null | undefined;
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
        // The latest cumulative value of each series in the bucket.
        aggregationType: AggregationType.Max,
        aggregateColumnName: "value",
        timestampColumnName: "time",
        start: window.start,
        end: window.end,
        groupBy: { attributes: true },
      }),
    });
    return counterResultToRatePerSecond(result);
  } catch {
    return [];
  }
}

/**
 * A gauge read per series and combined per bucket: grouped by `groupKeys`,
 * each group aggregated with `aggregationType`, the groups combined with
 * `combine`. Empty (no API call) when unscoped or on failure.
 */
export async function fetchDatabaseGaugeSeries(
  window: DatabaseQueryWindow & {
    metricName: string;
    aggregationType: AggregationType;
    groupKeys: Array<string>;
    combine: DatabaseServerMetricSeriesCombine;
    pins?: Readonly<Record<string, string>> | null | undefined;
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
        groupByAttributeKeys: window.groupKeys,
      }),
    });
    return combineGaugeSeries(result, window.combine);
  } catch {
    return [];
  }
}

/**
 * One catalog metric, chart-ready: a counter as its per-second rate, a
 * gauge combined across its series as the catalog says. `aggregationType`
 * overrides a gauge's per-series aggregation (the Metrics tab lets you pick
 * Max); a counter always reads Max.
 */
export async function fetchDatabaseCatalogMetricSeries(
  window: DatabaseQueryWindow & {
    definition: DatabaseServerMetricDefinition;
    aggregationType?: AggregationType | undefined;
  },
): Promise<Array<DatabaseTimePoint>> {
  const definition: DatabaseServerMetricDefinition = window.definition;
  const base: DatabaseQueryWindow & {
    metricName: string;
    pins?: Readonly<Record<string, string>> | undefined;
  } = {
    projectId: window.projectId,
    keys: window.keys,
    start: window.start,
    end: window.end,
    metricName: definition.metricName,
    pins: definition.attributes,
  };

  if (definition.kind === "counter") {
    return fetchDatabaseCounterRateSeries(base);
  }

  return fetchDatabaseGaugeSeries({
    ...base,
    aggregationType: window.aggregationType || definition.aggregation,
    groupKeys: getDatabaseServerMetricGroupKeys(definition),
    combine: definition.seriesCombine,
  });
}

/** A catalog metric with the series to chart and the value its tile shows. */
export interface DatabaseEngineMetricResult {
  definition: DatabaseServerMetricDefinition;
  // Gauges: the combined value per bucket. Counters: the per-second rate.
  series: Array<DatabaseTimePoint>;
  // Gauges: the latest bucket. Counters: the mean rate over the window.
  value: number | null;
}

/**
 * The tile value of one catalog metric's chart-ready series (see
 * fetchDatabaseCatalogMetricSeries): a gauge shows its latest bucket, a
 * counter its mean rate over the window.
 */
export function toEngineMetricResult(
  definition: DatabaseServerMetricDefinition,
  series: ReadonlyArray<DatabaseTimePoint>,
): DatabaseEngineMetricResult {
  const points: Array<DatabaseTimePoint> = sortByTime([...series]);
  return {
    definition,
    series: points,
    value:
      definition.kind === "counter"
        ? meanOfSeries(points)
        : latestOfSeries(points),
  };
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
        const series: Array<DatabaseTimePoint> =
          await fetchDatabaseCatalogMetricSeries({
            projectId: window.projectId,
            keys: window.keys,
            start: window.start,
            end: window.end,
            definition: definition,
          });
        return toEngineMetricResult(definition, series);
      },
    ),
  );
}

// ---- the Metrics tab's list values ---------------------------------------

/*
 * What a catalog metric's row on the Metrics tab shows: the same series and
 * number as its Overview tile (a total across databases, the worst series,
 * a counter's per-second rate), not the generic list's average of every
 * series — which read `postgresql.backends 4` beside an Overview showing 8
 * connections, and a cumulative counter as its raw total.
 */
export interface DatabaseMetricListValue {
  definition: DatabaseServerMetricDefinition;
  points: Array<DatabaseTimePoint>;
  // Gauges: the latest bucket. Counters: the mean rate over the window.
  value: number | null;
  isRate: boolean;
  // One short line under the value saying what the number is.
  caption: string;
}

/**
 * The caption under a catalog metric's list value: how its series combine,
 * and for an entry pinned to one breakdown value (`mysql.threads{kind=
 * running}`), which one — its title.
 */
export function getDatabaseMetricListCaption(
  definition: DatabaseServerMetricDefinition,
): string {
  let how: string;
  if (definition.kind === "counter") {
    how = "per second, all series";
  } else {
    switch (definition.seriesCombine) {
      case "max":
        how = "highest series";
        break;
      case "min":
        how = "lowest series";
        break;
      case "avg":
        how = "average of series";
        break;
      default:
        how = "total of series";
    }
  }
  return Object.keys(definition.attributes || {}).length > 0
    ? `${definition.title}, ${how}`
    : how;
}

/**
 * The list values of the catalog metrics among `metricNames`, read exactly
 * as the Overview reads them (fetchDatabaseCatalogMetricSeries) — keyed by
 * metric name. A name the engine's catalog does not know is left out, and
 * the list shows its generic value. Empty (no API call) when unscoped.
 */
export async function fetchDatabaseMetricListValues(
  window: DatabaseQueryWindow & {
    dbSystem: string | null | undefined;
    metricNames: ReadonlyArray<string>;
  },
): Promise<Map<string, DatabaseMetricListValue>> {
  const values: Map<string, DatabaseMetricListValue> = new Map();
  if (!getDatabaseServerEntityKeysQueryValue(window.keys)) {
    return values;
  }

  const entries: Array<[string, DatabaseMetricListValue] | null> =
    await Promise.all(
      window.metricNames.map(
        async (
          metricName: string,
        ): Promise<[string, DatabaseMetricListValue] | null> => {
          const definition: DatabaseServerMetricDefinition | null =
            findDatabaseServerMetricByName(window.dbSystem, metricName);
          if (!definition) {
            return null;
          }
          const series: Array<DatabaseTimePoint> =
            await fetchDatabaseCatalogMetricSeries({
              projectId: window.projectId,
              keys: window.keys,
              start: window.start,
              end: window.end,
              definition: definition,
            });
          const result: DatabaseEngineMetricResult = toEngineMetricResult(
            definition,
            series,
          );
          return [
            metricName,
            {
              definition: definition,
              points: result.series,
              value: result.value,
              isRate: definition.kind === "counter",
              caption: getDatabaseMetricListCaption(definition),
            },
          ];
        },
      ),
    );

  for (const entry of entries) {
    if (entry) {
      values.set(entry[0], entry[1]);
    }
  }
  return values;
}

/** True when any engine metric returned at least one point. */
export function hasEngineMetricData(
  results: ReadonlyArray<DatabaseEngineMetricResult>,
): boolean {
  return results.some((result: DatabaseEngineMetricResult): boolean => {
    return result.series.length > 0;
  });
}

// ---- the Metrics tab's in-place chart ------------------------------------

/*
 * What a clicked metric IS, read from its newest stored point: a histogram
 * (charted by percentile — its stored `value` is the bucket sum), a
 * cumulative monotonic counter (charted as a rate), a delta counter, or a
 * gauge. The unit comes from the metric list (MetricType.unit). Unknown
 * fields are null and the metric is then charted as a gauge.
 */
export interface DatabaseMetricShape {
  unit: string;
  pointType: MetricPointType | null;
  isMonotonic: boolean | null;
  aggregationTemporality: AggregationTemporality | null;
}

export const UNKNOWN_DATABASE_METRIC_SHAPE: DatabaseMetricShape = {
  unit: "",
  pointType: null,
  isMonotonic: null,
  aggregationTemporality: null,
};

const DISTRIBUTION_POINT_TYPES: ReadonlyArray<MetricPointType> = [
  MetricPointType.Histogram,
  MetricPointType.ExponentialHistogram,
];

/**
 * Reads the point type, monotonicity and temporality of a metric from its
 * newest point under the database's keys in the window. Resolves to the
 * unknown shape (no API call) when unscoped, and on failure or no data.
 */
export async function fetchDatabaseMetricShape(
  window: DatabaseQueryWindow & {
    metricName: string;
    unit?: string | null | undefined;
  },
): Promise<DatabaseMetricShape> {
  const unit: string = (window.unit || "").trim();
  const unknown: DatabaseMetricShape = {
    ...UNKNOWN_DATABASE_METRIC_SHAPE,
    unit: unit,
  };
  const query: Record<string, unknown> | null =
    buildDatabaseMetricQuery(window);
  if (!query) {
    return unknown;
  }

  try {
    const result: ListResult<Metric> = await AnalyticsModelAPI.getList<Metric>({
      modelType: Metric,
      query: query,
      select: {
        metricPointType: true,
        isMonotonic: true,
        aggregationTemporality: true,
      },
      sort: { time: SortOrder.Descending },
      skip: 0,
      limit: 1,
    });
    const row: Metric | undefined = result.data?.[0];
    if (!row) {
      return unknown;
    }
    const pointType: unknown = row.metricPointType;
    const temporality: unknown = row.aggregationTemporality;
    return {
      unit: unit,
      pointType: Object.values(MetricPointType).includes(
        pointType as MetricPointType,
      )
        ? (pointType as MetricPointType)
        : null,
      isMonotonic:
        typeof row.isMonotonic === "boolean" ? row.isMonotonic : null,
      aggregationTemporality: Object.values(AggregationTemporality).includes(
        temporality as AggregationTemporality,
      )
        ? (temporality as AggregationTemporality)
        : null,
    };
  } catch {
    return unknown;
  }
}

export const DATABASE_METRIC_GAUGE_AGGREGATIONS: ReadonlyArray<AggregationType> =
  [
    AggregationType.Avg,
    AggregationType.Max,
    AggregationType.Min,
    AggregationType.Sum,
  ];

/*
 * A distribution's percentiles come from its buckets (MetricService); Avg
 * is the count-weighted mean, Max / Min the observed extremes.
 */
export const DATABASE_METRIC_DISTRIBUTION_AGGREGATIONS: ReadonlyArray<AggregationType> =
  [
    AggregationType.P50,
    AggregationType.P90,
    AggregationType.P95,
    AggregationType.P99,
    AggregationType.Avg,
    AggregationType.Max,
    AggregationType.Min,
  ];

// A delta counter's points are increments: Sum per bucket is the total.
export const DATABASE_METRIC_DELTA_COUNTER_AGGREGATIONS: ReadonlyArray<AggregationType> =
  [
    AggregationType.Sum,
    AggregationType.Avg,
    AggregationType.Max,
    AggregationType.Min,
  ];

/*
 * A curated gauge keeps its catalog combine; only the per-series aggregation
 * is offered (a Sum of samples would multiply by the scrape count).
 */
export const DATABASE_METRIC_CATALOG_GAUGE_AGGREGATIONS: ReadonlyArray<AggregationType> =
  [AggregationType.Avg, AggregationType.Max, AggregationType.Min];

export type DatabaseMetricChartMode = "catalog" | "rate" | "aggregate";

/** How one metric, clicked on a database's Metrics tab, is charted. */
export interface DatabaseMetricChartSpec {
  metricName: string;
  // The catalog title for a curated metric, else the metric name.
  title: string;
  // The engine's catalog entry for this metric, when it has one.
  definition: DatabaseServerMetricDefinition | null;
  /*
   * "catalog": read exactly as the Overview reads it. "rate": a cumulative
   * counter as a per-second rate, per series then summed. "aggregate": the
   * pooled series with the picked aggregation.
   */
  mode: DatabaseMetricChartMode;
  // What the picker offers; empty when there is nothing to pick.
  aggregations: ReadonlyArray<AggregationType>;
  defaultAggregation: AggregationType;
  // Charted as a per-second rate (curated counters, cumulative counters).
  isRate: boolean;
  // A histogram: percentiles from its buckets.
  isDistribution: boolean;
  // The metric's own unit (UCUM, from the metric list) for formatting.
  unit: string;
  // One line under the picker saying how the metric is charted.
  note: string;
}

/**
 * The chart spec for a metric of this database. A curated metric is read
 * as the catalog says (a counter becomes a per-second rate, a gauge is
 * combined across its series). Anything else is charted by what it is: a
 * histogram by percentile (P95 by default — its stored value is the sum of
 * its observations, not a latency), a cumulative monotonic counter as a
 * per-second rate, a delta counter by its Sum per bucket, and any other
 * metric averaged per bucket, like the metric explorer does.
 */
export function getDatabaseMetricChartSpec(
  metricName: string,
  dbSystem: string | null | undefined,
  shape?: Partial<DatabaseMetricShape> | null | undefined,
): DatabaseMetricChartSpec {
  const name: string = (metricName || "").trim();
  const unit: string = (shape?.unit || "").trim();
  const definition: DatabaseServerMetricDefinition | null =
    findDatabaseServerMetricByName(dbSystem, name);

  if (definition) {
    const isRate: boolean = definition.kind === "counter";
    return {
      metricName: name,
      title: isRate ? `${definition.title} (per second)` : definition.title,
      definition: definition,
      mode: "catalog",
      aggregations: isRate ? [] : DATABASE_METRIC_CATALOG_GAUGE_AGGREGATIONS,
      defaultAggregation: definition.aggregation,
      isRate: isRate,
      isDistribution: false,
      unit: unit,
      note: isRate
        ? "A cumulative counter, charted as a per-second rate: each series' rate, added up."
        : `Charted as on the Overview: ${definition.description}`,
    };
  }

  if (shape?.pointType && DISTRIBUTION_POINT_TYPES.includes(shape.pointType)) {
    return {
      metricName: name,
      title: name,
      definition: null,
      mode: "aggregate",
      aggregations: DATABASE_METRIC_DISTRIBUTION_AGGREGATIONS,
      defaultAggregation: AggregationType.P95,
      isRate: false,
      isDistribution: true,
      unit: unit,
      note: "A distribution: percentiles are computed from its buckets, Average is the mean of every observation.",
    };
  }

  if (shape?.isMonotonic === true) {
    if (shape.aggregationTemporality === AggregationTemporality.Delta) {
      return {
        metricName: name,
        title: name,
        definition: null,
        mode: "aggregate",
        aggregations: DATABASE_METRIC_DELTA_COUNTER_AGGREGATIONS,
        defaultAggregation: AggregationType.Sum,
        isRate: false,
        isDistribution: false,
        unit: unit,
        note: "A delta counter: Sum is the total counted in each interval.",
      };
    }
    if (
      shape.aggregationTemporality === AggregationTemporality.Cumulative ||
      shape.pointType === MetricPointType.Sum
    ) {
      return {
        metricName: name,
        title: `${name} (per second)`,
        definition: null,
        mode: "rate",
        aggregations: [],
        defaultAggregation: AggregationType.Max,
        isRate: true,
        isDistribution: false,
        unit: unit,
        note: "A cumulative counter, charted as a per-second rate: each series' rate, added up.",
      };
    }
  }

  return {
    metricName: name,
    title: name,
    definition: null,
    mode: "aggregate",
    aggregations: DATABASE_METRIC_GAUGE_AGGREGATIONS,
    defaultAggregation: AggregationType.Avg,
    isRate: false,
    isDistribution: false,
    unit: unit,
    note: "",
  };
}

/**
 * The range the Metrics tab's list shows on load, read from the URL the
 * same way the metric list reads it (`range`, plus `start` / `end` for a
 * custom range), so a clicked metric opens on that range rather than on a
 * fixed hour. Anything unreadable is the past hour, the list's default.
 */
export function getDatabaseMetricsRangeFromSearch(
  search: string | null | undefined,
): RangeStartAndEndDateTime {
  const fallback: RangeStartAndEndDateTime = {
    range: TimeRange.PAST_ONE_HOUR,
  };
  const params: URLSearchParams = new URLSearchParams(search || "");
  const raw: string | null = params.get("range");
  if (!raw || !(Object.values(TimeRange) as Array<string>).includes(raw)) {
    return fallback;
  }
  const range: TimeRange = raw as TimeRange;
  if (range !== TimeRange.CUSTOM) {
    return { range };
  }
  const start: Date = new Date(params.get("start") || "");
  const end: Date = new Date(params.get("end") || "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return fallback;
  }
  return { range, startAndEndDate: new InBetween<Date>(start, end) };
}

/**
 * The series for the in-place metric chart, over the database's keys, read
 * the way the spec says. `aggregationType` is the picker's choice; it is
 * ignored for a rate. Empty (no API call) when unscoped or on failure.
 */
export async function fetchDatabaseMetricChartSeries(
  window: DatabaseQueryWindow & {
    spec: DatabaseMetricChartSpec;
    aggregationType: AggregationType;
  },
): Promise<Array<DatabaseTimePoint>> {
  const base: DatabaseQueryWindow = {
    projectId: window.projectId,
    keys: window.keys,
    start: window.start,
    end: window.end,
  };

  if (window.spec.mode === "catalog" && window.spec.definition) {
    return fetchDatabaseCatalogMetricSeries({
      ...base,
      definition: window.spec.definition,
      aggregationType: window.spec.aggregations.includes(window.aggregationType)
        ? window.aggregationType
        : undefined,
    });
  }

  if (window.spec.mode === "rate") {
    return fetchDatabaseCounterRateSeries({
      ...base,
      metricName: window.spec.metricName,
    });
  }

  return fetchDatabaseMetricSeries({
    ...base,
    metricName: window.spec.metricName,
    aggregationType: window.aggregationType,
  });
}
