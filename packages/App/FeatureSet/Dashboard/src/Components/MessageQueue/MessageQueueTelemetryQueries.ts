import { getMessageQueueEntityKeysQueryValue } from "./MessageQueueTelemetryScope";
import {
  DatabaseCallingService,
  DatabaseCallingServices,
  DatabaseTimePoint,
  aggregatedResultToTimePoints,
  combineCallingServiceResults,
  combineGaugeSeries,
  counterResultToRatePerSecond,
  getAttributeSeriesKey,
  getCompleteBucketSeries,
  latestOfSeries,
  meanOfSeries,
} from "../../Pages/Database/Utils/DatabaseServerTelemetryQueries";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span, { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  MessageQueueMetricDescriptor,
  MessageQueueMetricSeriesCombine,
  getMessageQueueMetricsForSystem,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MessageQueueSourceWindowFloor,
  getMessageQueueMetricFilterAttributeKeys,
  getMessageQueueSourceWindowFloor,
  isMessageQueueMetricMonitorable,
} from "Common/Types/Monitor/MessageQueueAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";

/*
 * The Queue pages' own aggregate queries: the Overview's tiles, charts,
 * Producers / Consumers cards and Broker health section. Every query here is
 * scoped by `entityKeys: new Includes(keys)` — the queue's key set from
 * MessageQueueTelemetryScope (its one family-keyed queue key) — and NOTHING
 * is sent for an empty key set: the builders return null and the fetchers
 * resolve to an empty result without touching the API. No attribute filter
 * ever scopes the queue: its spans name it under five generations of keys
 * and its broker metrics under a different key per broker, which is exactly
 * why ingest stamps one key on all of them.
 *
 * Spans are split by KIND, the direction every instrumentation sets
 * reliably: PRODUCER spans are publishes, CONSUMER spans are deliveries /
 * processing. (fetchSpanMetrics in Components/TelemetryResource counts every
 * span it matches and averages per-interval p95s, so it cannot answer
 * either; it is left as it is for the products that use it.) Errors and the
 * error rate cover the queue's spans of every kind — a failed settlement or
 * a failed pull (CLIENT spans) is a failure on the queue too.
 *
 * Broker metrics are read the way the catalog says
 * (Types/MessageQueue/MessageQueueMetricCatalog): each series folded by its
 * `aggregation`, the series combined by its `seriesCombine`, a counter as a
 * rate per series with the rates summed — and how the page asks for that is
 * getMessageQueueMetricReadPlan's: pooled on the server wherever the fold
 * composes across series (exactly the query the metric's monitor runs, one
 * row per interval), per series and combined here where it does not. The
 * series math is the Databases product's (DatabaseServerTelemetryQueries:
 * combineGaugeSeries with its carry-forward of a level missing from the
 * newest interval, counterResultToRatePerSecond on CounterRateUtils,
 * getCompleteBucketSeries), shared rather than copied so the two products
 * cannot drift. A per-period count (aggregation Sum) is not a level: it is
 * never carried forward, and only its whole intervals are kept.
 *
 * No React here; the pure builders are unit-tested and the fetchers are
 * tested with the API mocked.
 */

export type MessageQueueTimePoint = DatabaseTimePoint;

// One service on either side of the queue, and how its spans went.
export type MessageQueueServiceRow = DatabaseCallingService;

/*
 * The busiest services on one side (at most the limit) and how many there
 * were in all.
 */
export type MessageQueueServices = DatabaseCallingServices;

export interface MessageQueueQueryWindow {
  projectId: ObjectID | string | null | undefined;
  keys: ReadonlyArray<string>;
  start: Date;
  end: Date;
}

// A publish, as every messaging instrumentation marks it.
export const MESSAGE_QUEUE_PUBLISH_SPAN_KIND: SpanKind = SpanKind.Producer;

// A delivery / processing of a message.
export const MESSAGE_QUEUE_CONSUME_SPAN_KIND: SpanKind = SpanKind.Consumer;

// How many services each of the Producers / Consumers cards lists.
export const MESSAGE_QUEUE_SERVICE_LIMIT: number = 10;

/*
 * The span figures of a queue's Overview. Counts are spans (one per
 * message, or per batch when a client records one span for many).
 */
export interface MessageQueueSpanMetrics {
  // Every span naming the queue, of any kind: the error rate's denominator.
  total: number;
  // PRODUCER spans.
  published: number;
  // CONSUMER spans.
  consumed: number;
  // Spans of any kind that ended with an error status.
  errors: number;
  errorRatePercent: number | null;
  // One percentile over every CONSUMER span in the window (not an average).
  p95ProcessingMs: number | null;
  publishedSeries: Array<MessageQueueTimePoint>;
  consumedSeries: Array<MessageQueueTimePoint>;
  errorSeries: Array<MessageQueueTimePoint>;
  // The p95 of each interval's CONSUMER spans, for the chart.
  p95ProcessingSeries: Array<MessageQueueTimePoint>;
}

export const EMPTY_MESSAGE_QUEUE_SPAN_METRICS: MessageQueueSpanMetrics = {
  total: 0,
  published: 0,
  consumed: 0,
  errors: 0,
  errorRatePercent: null,
  p95ProcessingMs: null,
  publishedSeries: [],
  consumedSeries: [],
  errorSeries: [],
  p95ProcessingSeries: [],
};

export const EMPTY_MESSAGE_QUEUE_SERVICES: MessageQueueServices = {
  services: [],
  total: 0,
};

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

function emptySpanMetrics(): MessageQueueSpanMetrics {
  return {
    ...EMPTY_MESSAGE_QUEUE_SPAN_METRICS,
    publishedSeries: [],
    consumedSeries: [],
    errorSeries: [],
    p95ProcessingSeries: [],
  };
}

function emptyServices(): MessageQueueServices {
  return { services: [], total: 0 };
}

/**
 * The Span query for the queue's spans in a window, or null when the queue
 * is unscoped (no keys) or there is no project. `kind` narrows it to one
 * span kind (PRODUCER / CONSUMER); `errorsOnly` to failed spans.
 */
export function buildMessageQueueSpanQuery(
  window: MessageQueueQueryWindow,
  options?: {
    kind?: SpanKind | undefined;
    errorsOnly?: boolean | undefined;
  },
): Record<string, unknown> | null {
  const entityKeys: Includes | null = getMessageQueueEntityKeysQueryValue(
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
  };

  if (options?.kind) {
    query["kind"] = options.kind;
  }

  if (options?.errorsOnly) {
    query["statusCode"] = SpanStatus.Error;
  }

  return query;
}

/**
 * The Metric query for one metric name over the queue's key, or null when
 * unscoped. Never an attribute filter: the key IS the queue.
 */
export function buildMessageQueueMetricQuery(
  window: MessageQueueQueryWindow & { metricName: string },
): Record<string, unknown> | null {
  const entityKeys: Includes | null = getMessageQueueEntityKeysQueryValue(
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

function aggregateBy<TModel extends Span | Metric>(data: {
  query: Record<string, unknown>;
  aggregationType: AggregationType;
  aggregateColumnName: string;
  timestampColumnName: string;
  start: Date;
  end: Date;
  groupBy?: Record<string, true> | undefined;
  groupByAttributeKeys?: ReadonlyArray<string> | undefined;
  aggregationInterval?: AggregationInterval | undefined;
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
    request["groupByAttributeKeys"] = [...data.groupByAttributeKeys];
  }
  if (data.aggregationInterval) {
    request["aggregationInterval"] = data.aggregationInterval;
  }
  return request as unknown as AggregateBy<TModel>;
}

function spanAggregate(data: {
  window: MessageQueueQueryWindow;
  query: Record<string, unknown>;
  aggregationType: AggregationType;
  aggregationInterval?: AggregationInterval | undefined;
  groupBy?: Record<string, true> | undefined;
}): Promise<AggregatedResult> {
  return AnalyticsModelAPI.aggregate<Span>({
    modelType: Span,
    aggregateBy: aggregateBy<Span>({
      query: data.query,
      aggregationType: data.aggregationType,
      aggregateColumnName: "durationUnixNano",
      timestampColumnName: "startTime",
      start: data.window.start,
      end: data.window.end,
      groupBy: data.groupBy,
      aggregationInterval: data.aggregationInterval,
    }),
  });
}

function sumOf(series: ReadonlyArray<MessageQueueTimePoint>): number {
  return series.reduce(
    (total: number, point: MessageQueueTimePoint): number => {
      return total + point.y;
    },
    0,
  );
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
 * The queue's span figures: PRODUCER spans (published), CONSUMER spans
 * (consumed), failed spans of any kind over all of its spans (errors and
 * the error rate), and the p95 duration of its CONSUMER spans — ONE
 * percentile over the window for the tile, one per interval for the chart.
 * The count series keep whole intervals only (getCompleteBucketSeries: the
 * newest is still filling); the tiles count every span in the range.
 * Resolves to the empty figures (no API call) when unscoped, and on a
 * failed request, so the Overview never breaks on one bad chart.
 */
export async function fetchMessageQueueSpanMetrics(
  window: MessageQueueQueryWindow,
): Promise<MessageQueueSpanMetrics> {
  const allQuery: Record<string, unknown> | null =
    buildMessageQueueSpanQuery(window);
  const errorQuery: Record<string, unknown> | null = buildMessageQueueSpanQuery(
    window,
    { errorsOnly: true },
  );
  const publishQuery: Record<string, unknown> | null =
    buildMessageQueueSpanQuery(window, {
      kind: MESSAGE_QUEUE_PUBLISH_SPAN_KIND,
    });
  const consumeQuery: Record<string, unknown> | null =
    buildMessageQueueSpanQuery(window, {
      kind: MESSAGE_QUEUE_CONSUME_SPAN_KIND,
    });

  if (!allQuery || !errorQuery || !publishQuery || !consumeQuery) {
    return emptySpanMetrics();
  }

  try {
    const [
      allResult,
      errorResult,
      publishResult,
      consumeResult,
      p95Result,
      windowP95Result,
    ]: [
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
      AggregatedResult,
    ] = await Promise.all([
      spanAggregate({
        window,
        query: allQuery,
        aggregationType: AggregationType.Count,
      }),
      spanAggregate({
        window,
        query: errorQuery,
        aggregationType: AggregationType.Count,
      }),
      spanAggregate({
        window,
        query: publishQuery,
        aggregationType: AggregationType.Count,
      }),
      spanAggregate({
        window,
        query: consumeQuery,
        aggregationType: AggregationType.Count,
      }),
      spanAggregate({
        window,
        query: consumeQuery,
        aggregationType: AggregationType.P95,
      }),
      spanAggregate({
        window,
        query: consumeQuery,
        aggregationType: AggregationType.P95,
        aggregationInterval: AggregationInterval.Total,
      }),
    ]);

    const allSeries: Array<MessageQueueTimePoint> =
      aggregatedResultToTimePoints(allResult);
    const errorSeries: Array<MessageQueueTimePoint> =
      aggregatedResultToTimePoints(errorResult);
    const publishedSeries: Array<MessageQueueTimePoint> =
      aggregatedResultToTimePoints(publishResult);
    const consumedSeries: Array<MessageQueueTimePoint> =
      aggregatedResultToTimePoints(consumeResult);
    const p95ProcessingSeries: Array<MessageQueueTimePoint> =
      aggregatedResultToTimePoints(p95Result, 1 / NANOSECONDS_PER_MILLISECOND);

    const total: number = sumOf(allSeries);
    /*
     * The failed spans are some of the spans: a failed count read a moment
     * later than the total (spans still arriving) never exceeds it.
     */
    const errors: number = Math.min(sumOf(errorSeries), total);
    const consumed: number = sumOf(consumedSeries);

    return {
      total: total,
      published: sumOf(publishedSeries),
      consumed: consumed,
      errors: errors,
      errorRatePercent: total > 0 ? (errors / total) * 100 : null,
      p95ProcessingMs:
        consumed > 0
          ? firstFiniteValue(windowP95Result, 1 / NANOSECONDS_PER_MILLISECOND)
          : null,
      publishedSeries: getCompleteBucketSeries(publishedSeries, window),
      consumedSeries: getCompleteBucketSeries(consumedSeries, window),
      errorSeries: getCompleteBucketSeries(errorSeries, window),
      p95ProcessingSeries: p95ProcessingSeries,
    };
  } catch {
    return emptySpanMetrics();
  }
}

/**
 * The services on one side of the queue — its spans of `kind` (PRODUCER:
 * who publishes, CONSUMER: who consumes) grouped by the service that
 * recorded them (primaryEntityId) over the whole window — busiest first,
 * and how many there are in all. Empty (no API call) when unscoped or on
 * failure.
 */
export async function fetchMessageQueueServices(
  window: MessageQueueQueryWindow & {
    kind: SpanKind;
    limit?: number | undefined;
  },
): Promise<MessageQueueServices> {
  const baseQuery: Record<string, unknown> | null = buildMessageQueueSpanQuery(
    window,
    { kind: window.kind },
  );
  const errorQuery: Record<string, unknown> | null = buildMessageQueueSpanQuery(
    window,
    {
      kind: window.kind,
      errorsOnly: true,
    },
  );

  if (!baseQuery || !errorQuery) {
    return emptyServices();
  }

  const byService: (
    query: Record<string, unknown>,
    aggregationType: AggregationType,
  ) => Promise<AggregatedResult> = (
    query: Record<string, unknown>,
    aggregationType: AggregationType,
  ): Promise<AggregatedResult> => {
    return spanAggregate({
      window,
      query: query,
      aggregationType: aggregationType,
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
      byService(baseQuery, AggregationType.Count),
      byService(errorQuery, AggregationType.Count),
      byService(baseQuery, AggregationType.P95),
    ]);

    return combineCallingServiceResults({
      countResult,
      errorResult,
      p95Result,
      limit:
        typeof window.limit === "number" && window.limit > 0
          ? window.limit
          : MESSAGE_QUEUE_SERVICE_LIMIT,
    });
  } catch {
    return emptyServices();
  }
}

/** The service ids of both cards, each once, for one name lookup. */
export function getMessageQueueServiceIds(
  ...sides: Array<MessageQueueServices>
): Array<string> {
  const ids: Array<string> = [];
  for (const side of sides) {
    for (const service of side.services) {
      if (service.serviceId && !ids.includes(service.serviceId)) {
        ids.push(service.serviceId);
      }
    }
  }
  return ids;
}

// ---- broker metrics ------------------------------------------------------

/*
 * The stored attributes of one series of a metric, restricted to the keys a
 * monitor filter can pin (getMessageQueueMetricFilterAttributeKeys). A key
 * the series does not carry reads "" — the value `attributes['<key>']` has
 * in ClickHouse, and what the query builder treats as absent.
 */
export type MessageQueueObservedSeries = Record<string, string>;

/** A catalog metric with the series to chart and the value its tile shows. */
export interface MessageQueueBrokerMetricResult {
  descriptor: MessageQueueMetricDescriptor;
  /*
   * Gauges: the combined value per interval (a per-period count: its whole
   * intervals only). Counters: the per-second rate.
   */
  series: Array<MessageQueueTimePoint>;
  /*
   * Gauges: the newest interval (a per-period count: its newest whole one).
   * Counters: the mean rate over the window.
   */
  value: number | null;
  /*
   * The series the metric was observed with under the queue's key, for the
   * "Create monitor" link — read only for a monitorable gauge that has data.
   */
  observedSeries: Array<MessageQueueObservedSeries>;
}

/*
 * How the page reads one catalog metric (getMessageQueueMetricReadPlan):
 *
 *   - "rate": a cumulative counter. The Max of every distinct series per
 *     interval (`groupBy: { attributes: true }`), a rate per series, the
 *     rates summed (counterResultToRatePerSecond).
 *   - "pooled": one row per interval, folded on the server. A gauge without
 *     series keys has one series to fold; and where the fold composes across
 *     series — the Max of every series' Max is the Max of all their points,
 *     the Sum of every series' Sum the Sum of all of them — grouping only
 *     multiplies the rows. Pooled, the page reads exactly the query its
 *     monitor evaluates (getMessageQueueMetricMonitorSeed: that Max or Sum,
 *     no group-by), and one row per interval never nears the aggregate
 *     API's row limit, which a per-partition read of one busy topic crosses
 *     within the hour: Kafka lag for 3 groups × 64 partitions is 192
 *     series, 11,712 rows of one-minute intervals. What a pooled Max gives
 *     up is combineGaugeSeries' carry-forward, which only the still-filling
 *     newest interval of a source scraped at several moments (Pulsar, one
 *     broker per partition) would use; that interval reads what the
 *     metric's monitor reads.
 *   - "series": grouped by the entry's series keys and combined here, where
 *     the fold does not compose (RabbitMQ's average ready plus average
 *     unacknowledged; each ActiveMQ broker's lowest consumer count, added
 *     up). A level missing from an interval keeps its last value there for
 *     a while (combineGaugeSeries: agents scrape at their own moments); a
 *     per-period count never does (combineMessageQueueCountSeries).
 */
export type MessageQueueMetricReadMode = "rate" | "pooled" | "series";

export interface MessageQueueMetricReadPlan {
  mode: MessageQueueMetricReadMode;
  // How the server folds an interval (a counter: its latest running total).
  aggregationType: AggregationType;
  // "series" only: the attribute keys that tell the series apart.
  groupByAttributeKeys: Array<string>;
  /*
   * A per-period count (aggregation Sum: Azure Monitor's `*_total`,
   * CloudWatch's NumberOf*, Pub/Sub's DELTA counts): each point is how many
   * events one period saw, not a level. A series with no point in an
   * interval saw none there — the azure_monitor receiver emits only the
   * aggregations Azure returned, and a Cloud Monitoring DELTA series has
   * points only for the periods that had some — so it is never carried
   * forward; carried, one burst of errors was counted three times. And an
   * interval still filling holds part of its count, so only whole ones are
   * kept (getCompleteMessageQueueCountSeries).
   */
  isPerPeriodCount: boolean;
}

/** How the page reads a catalog metric (see MessageQueueMetricReadMode). */
export function getMessageQueueMetricReadPlan(
  descriptor: Pick<
    MessageQueueMetricDescriptor,
    "kind" | "aggregation" | "seriesCombine" | "seriesKeys"
  >,
): MessageQueueMetricReadPlan {
  if (descriptor.kind === "counter") {
    return {
      mode: "rate",
      // The latest cumulative value of each series in the interval.
      aggregationType: AggregationType.Max,
      groupByAttributeKeys: [],
      isPerPeriodCount: false,
    };
  }

  const seriesKeys: Array<string> = [...(descriptor.seriesKeys || [])];
  const isPerPeriodCount: boolean =
    descriptor.aggregation === AggregationType.Sum;
  const foldComposes: boolean =
    (descriptor.aggregation === AggregationType.Max &&
      descriptor.seriesCombine === "max") ||
    (descriptor.aggregation === AggregationType.Sum &&
      descriptor.seriesCombine === "sum");

  if (seriesKeys.length === 0 || foldComposes) {
    return {
      mode: "pooled",
      aggregationType: descriptor.aggregation,
      groupByAttributeKeys: [],
      isPerPeriodCount: isPerPeriodCount,
    };
  }

  return {
    mode: "series",
    aggregationType: descriptor.aggregation,
    groupByAttributeKeys: seriesKeys,
    isPerPeriodCount: isPerPeriodCount,
  };
}

/*
 * The intervals a per-series read may widen to, finest first: the ones the
 * aggregate API picks for ever longer windows (AggregationIntervalUtil).
 */
export const MESSAGE_QUEUE_SERIES_READ_INTERVALS: ReadonlyArray<AggregationInterval> =
  [
    AggregationInterval.Minute,
    AggregationInterval.FiveMinutes,
    AggregationInterval.FifteenMinutes,
    AggregationInterval.ThirtyMinutes,
    AggregationInterval.Hour,
    AggregationInterval.Day,
    AggregationInterval.Week,
    AggregationInterval.Month,
    AggregationInterval.Year,
  ];

// How many times a cut-off per-series read is repeated at a wider interval.
export const MESSAGE_QUEUE_SERIES_READ_MAX_WIDENINGS: number = 2;

/**
 * The finest interval coarser than `after` at which `seriesCount` series fit
 * the aggregate API's row limit over the window, or null when none does.
 */
export function getMessageQueueSeriesReadInterval(data: {
  start: Date;
  end: Date;
  seriesCount: number;
  // The interval whose read was cut off.
  after: AggregationInterval;
  limit?: number | undefined;
}): AggregationInterval | null {
  const windowMs: number = Math.max(
    0,
    data.end.getTime() - data.start.getTime(),
  );
  const limit: number =
    typeof data.limit === "number" && data.limit > 0
      ? data.limit
      : LIMIT_PER_PROJECT;
  const seriesCount: number = Math.max(1, Math.ceil(data.seriesCount || 0));

  for (
    let index: number =
      MESSAGE_QUEUE_SERIES_READ_INTERVALS.indexOf(data.after) + 1;
    index < MESSAGE_QUEUE_SERIES_READ_INTERVALS.length;
    index++
  ) {
    const interval: AggregationInterval =
      MESSAGE_QUEUE_SERIES_READ_INTERVALS[index]!;
    const widthMs: number =
      AggregationIntervalUtil.getAggregationIntervalMs(interval);
    // A window that does not start on the interval grid straddles one more.
    const intervals: number = Math.ceil(windowMs / widthMs) + 1;
    // Under the limit, not at it: a page exactly full reads as cut off.
    if (seriesCount * intervals < limit) {
      return interval;
    }
  }

  return null;
}

// A row's interval start, as epoch milliseconds, or null when unreadable.
function intervalTimeOf(row: AggregatedModel): number | null {
  const raw: unknown =
    row["timestamp"] !== undefined ? row["timestamp"] : row["time"];
  const time: number =
    raw instanceof Date
      ? raw.getTime()
      : typeof raw === "string" || typeof raw === "number"
        ? new Date(raw).getTime()
        : Number.NaN;
  return Number.isFinite(time) ? time : null;
}

// How many distinct series a grouped result holds.
function seriesCountOf(result: AggregatedResult): number {
  const keys: Set<string> = new Set<string>();
  for (const row of (result.data || []) as Array<AggregatedModel>) {
    keys.add(getAttributeSeriesKey(row["attributes"]));
  }
  return keys.size;
}

// The result without its oldest interval, the one the row limit cut through.
function withoutOldestInterval(result: AggregatedResult): AggregatedResult {
  let oldest: number | null = null;
  for (const row of (result.data || []) as Array<AggregatedModel>) {
    const time: number | null = intervalTimeOf(row);
    if (time !== null && (oldest === null || time < oldest)) {
      oldest = time;
    }
  }
  return {
    ...result,
    data: ((result.data || []) as Array<AggregatedModel>).filter(
      (row: AggregatedModel): boolean => {
        return intervalTimeOf(row) !== oldest;
      },
    ),
  };
}

function aggregateMetric(data: {
  window: MessageQueueQueryWindow;
  query: Record<string, unknown>;
  aggregationType: AggregationType;
  groupBy?: Record<string, true> | undefined;
  groupByAttributeKeys?: ReadonlyArray<string> | undefined;
  aggregationInterval?: AggregationInterval | undefined;
}): Promise<AggregatedResult> {
  return AnalyticsModelAPI.aggregate<Metric>({
    modelType: Metric,
    aggregateBy: aggregateBy<Metric>({
      query: data.query,
      aggregationType: data.aggregationType,
      aggregateColumnName: "value",
      timestampColumnName: "time",
      start: data.window.start,
      end: data.window.end,
      groupBy: data.groupBy,
      groupByAttributeKeys: data.groupByAttributeKeys,
      aggregationInterval: data.aggregationInterval,
    }),
  });
}

/*
 * A per-series read that fits the aggregate API's row limit. The API returns
 * at most LIMIT_PER_PROJECT rows, newest first, so a read of more series
 * than the window's intervals leave room for loses its OLDEST intervals,
 * and the oldest one it keeps holds only some of the series: a partial
 * total, or a rate against a partial interval. The server flags such a
 * read (`truncated`), and it is read again at the finest coarser interval
 * its series fit (getMessageQueueSeriesReadInterval) — a 64-partition topic
 * over three hours in five-minute intervals rather than minutes — up to
 * MESSAGE_QUEUE_SERIES_READ_MAX_WIDENINGS times. One still cut off after
 * that keeps its newest intervals and drops the oldest, which the limit cut
 * through. `widen: false` keeps the window's own interval (a per-period
 * count: its whole-interval rule reads that interval).
 */
async function readMessageQueueMetricSeries(data: {
  window: MessageQueueQueryWindow;
  query: Record<string, unknown>;
  aggregationType: AggregationType;
  groupBy?: Record<string, true> | undefined;
  groupByAttributeKeys?: ReadonlyArray<string> | undefined;
  widen: boolean;
}): Promise<AggregatedResult> {
  const read: (
    aggregationInterval?: AggregationInterval | undefined,
  ) => Promise<AggregatedResult> = (
    aggregationInterval?: AggregationInterval | undefined,
  ): Promise<AggregatedResult> => {
    return aggregateMetric({
      window: data.window,
      query: data.query,
      aggregationType: data.aggregationType,
      groupBy: data.groupBy,
      groupByAttributeKeys: data.groupByAttributeKeys,
      aggregationInterval: aggregationInterval,
    });
  };

  // The interval the server picks for the window when none is pinned.
  let interval: AggregationInterval =
    AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: data.window.start,
      endDate: data.window.end,
    });
  let result: AggregatedResult = await read();

  for (
    let widenings: number = 0;
    data.widen &&
    result.truncated &&
    widenings < MESSAGE_QUEUE_SERIES_READ_MAX_WIDENINGS;
    widenings++
  ) {
    const wider: AggregationInterval | null = getMessageQueueSeriesReadInterval(
      {
        start: data.window.start,
        end: data.window.end,
        seriesCount: seriesCountOf(result),
        after: interval,
      },
    );
    if (!wider) {
      break;
    }
    interval = wider;
    result = await read(wider);
  }

  return result.truncated ? withoutOldestInterval(result) : result;
}

/**
 * A grouped per-period count (one row per series per interval) → one point
 * per interval: the series present in it combined with `combine` ("max":
 * the busiest, "avg": the average of those present, else their total).
 * Unlike a level (combineGaugeSeries), a count with no point in an interval
 * saw nothing there, so it is never carried into one. Rows without an
 * interval or a finite value are skipped.
 */
export function combineMessageQueueCountSeries(
  result: AggregatedResult | null | undefined,
  combine: MessageQueueMetricSeriesCombine,
): Array<MessageQueueTimePoint> {
  // interval → (series key → count); a repeated row keeps the last.
  const intervals: Map<number, Map<string, number>> = new Map();

  for (const row of (result?.data || []) as Array<AggregatedModel>) {
    const time: number | null = intervalTimeOf(row);
    const value: number = Number(row["value"]);
    if (time === null || !Number.isFinite(value)) {
      continue;
    }
    let series: Map<string, number> | undefined = intervals.get(time);
    if (!series) {
      series = new Map<string, number>();
      intervals.set(time, series);
    }
    series.set(getAttributeSeriesKey(row["attributes"]), value);
  }

  return Array.from(intervals.keys())
    .sort((a: number, b: number): number => {
      return a - b;
    })
    .map((time: number): MessageQueueTimePoint => {
      const values: Array<number> = Array.from(intervals.get(time)!.values());
      const total: number = values.reduce(
        (sum: number, value: number): number => {
          return sum + value;
        },
        0,
      );
      return {
        x: new Date(time),
        y:
          combine === "max"
            ? Math.max(...values)
            : combine === "avg"
              ? total / values.length
              : total,
      };
    });
}

/*
 * The length of an interval that holds one source period: a per-minute
 * count's one-minute interval is whole as soon as its point is there at all.
 */
export const MESSAGE_QUEUE_COUNT_PERIOD_MS: number = 60 * 1000;

/**
 * How long after an interval of a per-period count closes its points may
 * still arrive, beyond the half minute every interval gets
 * (getCompleteBucketSeries). None for one-minute intervals: each holds one
 * period's point, whole once it is there at all. A wider interval holds
 * several periods, and a late source delivers them minutes after the fact
 * — CloudWatch up to 25 minutes, Cloud Monitoring up to 9 — so it is whole
 * only once the source's window floor has passed since it closed
 * (MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS: how long a window over the source
 * needs to be to always hold its points).
 */
export function getMessageQueueCountSettleMs(
  descriptor: MessageQueueMetricDescriptor,
  window: { start: Date; end: Date },
): number {
  const intervalMs: number = AggregationIntervalUtil.getAggregationIntervalMs(
    AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: window.start,
      endDate: window.end,
    }),
  );
  if (!(intervalMs > MESSAGE_QUEUE_COUNT_PERIOD_MS)) {
    return 0;
  }

  const floor: MessageQueueSourceWindowFloor | null =
    getMessageQueueSourceWindowFloor(descriptor);
  if (!floor) {
    return 0;
  }

  const floorWindow: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
    floor.minimumRollingTime,
  );
  return Math.max(
    0,
    floorWindow.endValue.getTime() - floorWindow.startValue.getTime(),
  );
}

/**
 * A per-period count's whole intervals: the ones that lie inside the window
 * and closed long enough ago for its source to have delivered them
 * (getCompleteBucketSeries, with `now` moved back by
 * getMessageQueueCountSettleMs). Its newest interval is still filling and
 * its oldest started before the window, so drawn as they are the chart fell
 * at both edges, and the tile — the newest interval — read the few minutes
 * that had arrived as the whole interval's count. A series whose every
 * interval is partial is kept.
 */
export function getCompleteMessageQueueCountSeries(
  series: ReadonlyArray<MessageQueueTimePoint>,
  descriptor: MessageQueueMetricDescriptor,
  window: { start: Date; end: Date },
  now: number = Date.now(),
): Array<MessageQueueTimePoint> {
  return getCompleteBucketSeries(
    series,
    window,
    now - getMessageQueueCountSettleMs(descriptor, window),
  );
}

/**
 * One catalog metric, chart-ready, read as getMessageQueueMetricReadPlan
 * says: a counter as its per-second rate, a gauge pooled on the server or
 * combined across its series, a per-period count's whole intervals only.
 * Empty (no API call) when unscoped or on failure.
 */
export async function fetchMessageQueueCatalogMetricSeries(
  window: MessageQueueQueryWindow & {
    descriptor: MessageQueueMetricDescriptor;
    // When the window's intervals are judged whole; the present by default.
    now?: number | undefined;
  },
): Promise<Array<MessageQueueTimePoint>> {
  const descriptor: MessageQueueMetricDescriptor = window.descriptor;
  const query: Record<string, unknown> | null = buildMessageQueueMetricQuery({
    ...window,
    metricName: descriptor.metricName,
  });
  if (!query) {
    return [];
  }

  const plan: MessageQueueMetricReadPlan =
    getMessageQueueMetricReadPlan(descriptor);

  try {
    if (plan.mode === "rate") {
      const result: AggregatedResult = await readMessageQueueMetricSeries({
        window: window,
        query: query,
        aggregationType: plan.aggregationType,
        groupBy: { attributes: true },
        widen: true,
      });
      return counterResultToRatePerSecond(result);
    }

    let points: Array<MessageQueueTimePoint>;
    if (plan.mode === "pooled") {
      points = aggregatedResultToTimePoints(
        await aggregateMetric({
          window: window,
          query: query,
          aggregationType: plan.aggregationType,
        }),
      );
    } else {
      const result: AggregatedResult = await readMessageQueueMetricSeries({
        window: window,
        query: query,
        aggregationType: plan.aggregationType,
        groupByAttributeKeys: plan.groupByAttributeKeys,
        widen: !plan.isPerPeriodCount,
      });
      points = plan.isPerPeriodCount
        ? combineMessageQueueCountSeries(result, descriptor.seriesCombine)
        : combineGaugeSeries(result, descriptor.seriesCombine);
    }

    return plan.isPerPeriodCount
      ? getCompleteMessageQueueCountSeries(
          points,
          descriptor,
          window,
          window.now,
        )
      : points;
  } catch {
    return [];
  }
}

function observedSeriesOf(
  result: AggregatedResult | null | undefined,
  keys: ReadonlyArray<string>,
): Array<MessageQueueObservedSeries> {
  const seen: Set<string> = new Set<string>();
  const series: Array<MessageQueueObservedSeries> = [];

  for (const row of (result?.data || []) as Array<AggregatedModel>) {
    const raw: unknown = row["attributes"];
    const attributes: Record<string, unknown> =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const entry: MessageQueueObservedSeries = {};

    for (const key of keys) {
      const value: unknown = Object.prototype.hasOwnProperty.call(
        attributes,
        key,
      )
        ? attributes[key]
        : undefined;
      entry[key] =
        typeof value === "string"
          ? value
          : typeof value === "number" || typeof value === "boolean"
            ? String(value)
            : "";
    }

    const identity: string = JSON.stringify(
      keys.map((key: string): string => {
        return entry[key] || "";
      }),
    );
    if (!seen.has(identity)) {
      seen.add(identity);
      series.push(entry);
    }
  }

  return series;
}

/**
 * The distinct series one catalog metric arrived with under the queue's key
 * in the window, each as its stored values of the keys a monitor filter can
 * pin (destination, broker scope, required attributes). One aggregate over
 * the whole window grouped by exactly those keys. Empty (no API call) when
 * unscoped, and on failure.
 */
export async function fetchMessageQueueObservedSeries(
  window: MessageQueueQueryWindow & {
    descriptor: MessageQueueMetricDescriptor;
  },
): Promise<Array<MessageQueueObservedSeries>> {
  const descriptor: MessageQueueMetricDescriptor = window.descriptor;
  const keys: Array<string> =
    getMessageQueueMetricFilterAttributeKeys(descriptor);
  const query: Record<string, unknown> | null = buildMessageQueueMetricQuery({
    ...window,
    metricName: descriptor.metricName,
  });
  if (!query || keys.length === 0) {
    return [];
  }

  try {
    const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
      modelType: Metric,
      aggregateBy: aggregateBy<Metric>({
        query: query,
        aggregationType: AggregationType.Count,
        aggregateColumnName: "value",
        timestampColumnName: "time",
        start: window.start,
        end: window.end,
        groupByAttributeKeys: keys,
        aggregationInterval: AggregationInterval.Total,
      }),
    });
    return observedSeriesOf(result, keys);
  } catch {
    return [];
  }
}

/**
 * The tile value of one catalog metric's chart-ready series: a gauge shows
 * its newest interval (a per-period count's series holds whole intervals
 * only, so its newest whole one), a counter its mean rate over the window.
 */
export function toMessageQueueBrokerMetricResult(
  descriptor: MessageQueueMetricDescriptor,
  series: ReadonlyArray<MessageQueueTimePoint>,
  observedSeries?: ReadonlyArray<MessageQueueObservedSeries> | undefined,
): MessageQueueBrokerMetricResult {
  const points: Array<MessageQueueTimePoint> = [...series].sort(
    (a: MessageQueueTimePoint, b: MessageQueueTimePoint): number => {
      return a.x.getTime() - b.x.getTime();
    },
  );
  return {
    descriptor: descriptor,
    series: points,
    value:
      descriptor.kind === "counter"
        ? meanOfSeries(points)
        : latestOfSeries(points),
    observedSeries: [...(observedSeries || [])],
  };
}

/**
 * Every catalog metric of the queue's system, fetched in parallel, and then
 * — for each gauge a monitor can evaluate that has data — the series it was
 * observed with, which the "Create monitor" link filters on. Counters and
 * quiet gauges cost no second request. Empty (no API call) when unscoped.
 */
export async function fetchMessageQueueBrokerMetrics(
  window: MessageQueueQueryWindow & {
    metrics: ReadonlyArray<MessageQueueMetricDescriptor>;
  },
): Promise<Array<MessageQueueBrokerMetricResult>> {
  if (!getMessageQueueEntityKeysQueryValue(window.keys)) {
    return [];
  }

  const base: MessageQueueQueryWindow = {
    projectId: window.projectId,
    keys: window.keys,
    start: window.start,
    end: window.end,
  };

  const charted: Array<MessageQueueBrokerMetricResult> = await Promise.all(
    window.metrics.map(
      async (
        descriptor: MessageQueueMetricDescriptor,
      ): Promise<MessageQueueBrokerMetricResult> => {
        const series: Array<MessageQueueTimePoint> =
          await fetchMessageQueueCatalogMetricSeries({
            ...base,
            descriptor: descriptor,
          });
        return toMessageQueueBrokerMetricResult(descriptor, series);
      },
    ),
  );

  return Promise.all(
    charted.map(
      async (
        result: MessageQueueBrokerMetricResult,
      ): Promise<MessageQueueBrokerMetricResult> => {
        if (
          result.series.length === 0 ||
          !isMessageQueueMetricMonitorable(result.descriptor)
        ) {
          return result;
        }
        const observedSeries: Array<MessageQueueObservedSeries> =
          await fetchMessageQueueObservedSeries({
            ...base,
            descriptor: result.descriptor,
          });
        return { ...result, observedSeries: observedSeries };
      },
    ),
  );
}

/** True when any broker metric returned at least one point. */
export function hasMessageQueueBrokerMetricData(
  results: ReadonlyArray<MessageQueueBrokerMetricResult>,
): boolean {
  return results.some((result: MessageQueueBrokerMetricResult): boolean => {
    return result.series.length > 0;
  });
}

// ---- the Metrics tab -------------------------------------------------------

/**
 * The curated broker metric of the queue's system with exactly this stored
 * name, or null for any other metric (a messaging client metric, an
 * application's own gauge, another system's broker metric, a name a rename
 * rule stored in another casing).
 */
export function findMessageQueueCatalogMetric(
  messagingSystem: string | null | undefined,
  metricName: string | null | undefined,
): MessageQueueMetricDescriptor | null {
  const name: string = (metricName || "").trim();
  if (!name) {
    return null;
  }
  return (
    getMessageQueueMetricsForSystem(messagingSystem).find(
      (descriptor: MessageQueueMetricDescriptor): boolean => {
        return descriptor.metricName === name;
      },
    ) || null
  );
}

/*
 * What a curated broker metric's row on the Metrics tab shows: the same
 * series and number as its Broker health tile (a total across a RabbitMQ
 * queue's states, the consumer group furthest behind, a counter's
 * per-second rate), not the metric list's average of every series.
 */
export interface MessageQueueMetricListValue {
  descriptor: MessageQueueMetricDescriptor;
  points: Array<MessageQueueTimePoint>;
  /*
   * Gauges: the newest interval (a per-period count: its newest whole one).
   * Counters: the mean rate over the window.
   */
  value: number | null;
  isRate: boolean;
}

/**
 * The list values of the curated metrics among `metricNames`, read exactly
 * as Broker health reads them (fetchMessageQueueCatalogMetricSeries), keyed
 * by metric name. A name the system's catalog does not know is left out, and
 * the list shows its own value. Empty (no API call) when unscoped.
 */
export async function fetchMessageQueueMetricListValues(
  window: MessageQueueQueryWindow & {
    messagingSystem: string | null | undefined;
    metricNames: ReadonlyArray<string>;
  },
): Promise<Map<string, MessageQueueMetricListValue>> {
  const values: Map<string, MessageQueueMetricListValue> = new Map();
  if (!getMessageQueueEntityKeysQueryValue(window.keys)) {
    return values;
  }

  const base: MessageQueueQueryWindow = {
    projectId: window.projectId,
    keys: window.keys,
    start: window.start,
    end: window.end,
  };

  const entries: Array<[string, MessageQueueMetricListValue] | null> =
    await Promise.all(
      window.metricNames.map(
        async (
          metricName: string,
        ): Promise<[string, MessageQueueMetricListValue] | null> => {
          const descriptor: MessageQueueMetricDescriptor | null =
            findMessageQueueCatalogMetric(window.messagingSystem, metricName);
          if (!descriptor) {
            return null;
          }
          const result: MessageQueueBrokerMetricResult =
            toMessageQueueBrokerMetricResult(
              descriptor,
              await fetchMessageQueueCatalogMetricSeries({
                ...base,
                descriptor: descriptor,
              }),
            );
          return [
            metricName,
            {
              descriptor: descriptor,
              points: result.series,
              value: result.value,
              isRate: descriptor.kind === "counter",
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
