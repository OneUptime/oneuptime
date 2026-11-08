import { getMessageQueueEntityKeysQueryValue } from "./MessageQueueTelemetryScope";
import {
  DatabaseCallingService,
  DatabaseCallingServices,
  DatabaseTimePoint,
  aggregatedResultToTimePoints,
  combineGaugeSeries,
  counterResultToRatePerSecond,
  getAttributeSeriesKey,
  getCompleteBucketSeries,
  latestOfSeries,
  meanOfSeries,
} from "../../Pages/Database/Utils/DatabaseServerTelemetryQueries";
import Metric, {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CLOUD_CONNECTION_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudConnectionTelemetry";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import {
  MessageQueueMetricDescriptor,
  MessageQueueMetricSeriesCombine,
  getMessageQueueMetricsForSystem,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MESSAGE_QUEUE_AWS_RPC_SYSTEMS,
  MESSAGE_QUEUE_AWS_SEND_RPC_METHODS,
  MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE,
  MESSAGE_QUEUE_CLIENT_SPAN_KIND,
  MESSAGE_QUEUE_CONSUME_SPAN_KIND,
  MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE,
  MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,
  MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE,
  MESSAGE_QUEUE_POLLED_RECEIVE_SYSTEMS,
  MESSAGE_QUEUE_PUBLISH_SPAN_KIND,
  MESSAGE_QUEUE_RECEIVE_OPERATION,
  MESSAGE_QUEUE_RPC_METHOD_ATTRIBUTE,
  MESSAGE_QUEUE_SEND_OPERATIONS,
  MESSAGE_QUEUE_SERVICE_LIMIT,
  MessageQueueProducerServices,
  MessageQueueServiceSpanFigures,
  MessageQueueSpanPopulation,
  combineMessageQueueConsumerServices,
  combineMessageQueueProducerServices,
  emptyMessageQueueServiceSpanFigures,
  getMessageQueueSpanPopulationFilter,
  isMessageQueueAwsRpcSystem,
  isMessageQueuePolledReceiveSystem,
} from "Common/Types/MessageQueue/MessageQueueSpanPopulation";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  MessageQueueSourceWindowFloor,
  getMessageQueueMetricFilterAttributeKeys,
  getMessageQueueSourceWindowFloor,
  isMessageQueueMetricMonitorable,
} from "Common/Types/Monitor/MessageQueueAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";

/*
 * The Queue pages' own aggregate queries: the Overview's tiles, charts,
 * Producers / Consumers cards and Broker health section. Every query here is
 * scoped by `entityKeys: new Includes(keys)` — the queue's key set from
 * MessageQueueTelemetryScope (its one family-keyed queue key) — and NOTHING
 * is sent for an empty key set: the builders return null and the fetchers
 * resolve to an empty result without touching the API. No attribute filter
 * ever scopes the queue: its spans name it under five generations of keys
 * and its broker metrics under a different key per broker, which is exactly
 * why ingest stamps one key on all of them. One read is the exception, by
 * design: fetchMessageQueueNamespaceSeries asks what a namespace-scoped
 * queue's NAMESPACE sent — by its scope attribute, without the key — to say
 * why none of it reached the queue (a namespace total, other entities only).
 * It counts series and charts nothing.
 *
 * Spans are told apart by kind AND by the operation they record
 * (MessageQueueSpanPopulation): PRODUCER spans are publishes, and so are the
 * CLIENT spans that record a send — the Azure SDKs time their sends there
 * and make a zero-length PRODUCER span per message, and some AWS SDK
 * instrumentations record publishes only that way; CONSUMER spans are
 * deliveries and processing, less the receives that returned nothing and,
 * on SQS, the receive calls, which time a long poll rather than any work.
 * Every such filter is one conjunction on top of the key, and every one
 * reads an attribute the resolver's direction rule reads, or the batch
 * size. (fetchSpanMetrics in Components/TelemetryResource counts every span
 * it matches and averages per-interval p95s, so it cannot answer any of
 * this; it is left as it is for the products that use it.) Errors and the
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
 * What is taken from DatabaseServerTelemetryQueries is only what is generic
 * and pure: the time-point and calling-service shapes, and arithmetic over
 * an aggregate result (rows to points, series keys, the carry-forward and
 * rate math, whole intervals, a newest or mean value, services by
 * primaryEntityId). None of it reads a database catalog or engine, or
 * builds or sends a query. Everything that does — the queries, and how a
 * clicked metric outside the catalog is charted
 * (getMessageQueueMetricChartSpec: the Databases one consults its engine
 * catalog and engine unit corrections) — is this product's own, below.
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

/*
 * Which of a queue's spans are publishes and which are consumes, and how a
 * service's spans make its row on either side of the queue, are defined once
 * in Common/Types/MessageQueue/MessageQueueSpanPopulation: the Queues
 * topology compiles the very same groups on the server, so a queue's cards
 * and its lines on the topology count the same spans. Re-exported here for
 * the pages and suites that read them from this module.
 */
export {
  MESSAGE_QUEUE_AWS_RPC_SYSTEMS,
  MESSAGE_QUEUE_AWS_SEND_RPC_METHODS,
  MESSAGE_QUEUE_BATCH_MESSAGE_COUNT_ATTRIBUTE,
  MESSAGE_QUEUE_CLIENT_SPAN_KIND,
  MESSAGE_QUEUE_CONSUME_SPAN_KIND,
  MESSAGE_QUEUE_LEGACY_OPERATION_ATTRIBUTE,
  MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,
  MESSAGE_QUEUE_OPERATION_TYPE_ATTRIBUTE,
  MESSAGE_QUEUE_POLLED_RECEIVE_SYSTEMS,
  MESSAGE_QUEUE_PUBLISH_SPAN_KIND,
  MESSAGE_QUEUE_RECEIVE_OPERATION,
  MESSAGE_QUEUE_RPC_METHOD_ATTRIBUTE,
  MESSAGE_QUEUE_SEND_OPERATIONS,
  MESSAGE_QUEUE_SERVICE_LIMIT,
  combineMessageQueueConsumerServices,
  combineMessageQueueProducerServices,
  isMessageQueueAwsRpcSystem,
  isMessageQueuePolledReceiveSystem,
};
export type {
  MessageQueueProducerServices,
  MessageQueueServiceSpanFigures,
  MessageQueueSpanPopulation,
};

export interface MessageQueueSpanQueryOptions {
  // Which of the queue's spans; every span when omitted.
  population?: MessageQueueSpanPopulation | undefined;
  // Only the ones that ended with an error status.
  errorsOnly?: boolean | undefined;
  // The row's specific system: SQS reads its receive spans apart.
  messagingSystem?: string | null | undefined;
}

function populationFilter(
  population: MessageQueueSpanPopulation,
  system: string | null | undefined,
): Record<string, unknown> {
  return getMessageQueueSpanPopulationFilter(population, system);
}

/*
 * The span figures of a queue's Overview. Counts are spans (one per
 * message, or per batch when a client records one span for many).
 */
export interface MessageQueueSpanMetrics {
  // Every span naming the queue, of any kind: the error rate's denominator.
  total: number;
  /*
   * PRODUCER spans, plus the send spans of every service that records its
   * publishes only as client spans.
   */
  published: number;
  /*
   * CONSUMER spans that handled messages, plus (SQS) the receives that
   * returned some, once per batch.
   */
  consumed: number;
  // Spans of any kind that ended with an error status.
  errors: number;
  errorRatePercent: number | null;
  /*
   * One percentile over every "consume" span in the window (not an
   * average): receives that returned nothing, and SQS's receive polls, are
   * not in it.
   */
  p95ProcessingMs: number | null;
  publishedSeries: Array<MessageQueueTimePoint>;
  consumedSeries: Array<MessageQueueTimePoint>;
  errorSeries: Array<MessageQueueTimePoint>;
  // The p95 of each interval's "consume" spans, for the chart.
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

// Everything the Overview reads from the queue's spans, in one read.
export interface MessageQueueSpanOverview {
  metrics: MessageQueueSpanMetrics;
  producers: MessageQueueServices;
  consumers: MessageQueueServices;
}

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

function emptySpanOverview(): MessageQueueSpanOverview {
  return {
    metrics: emptySpanMetrics(),
    producers: emptyServices(),
    consumers: emptyServices(),
  };
}

/**
 * The Span query for one group of the queue's spans in a window
 * (MessageQueueSpanPopulation), or null when the queue is unscoped (no
 * keys) or there is no project. `errorsOnly` narrows it to failed spans.
 * The queue is ALWAYS scoped by its entity key; attribute filters only
 * tell its spans apart, never find them.
 */
export function buildMessageQueueSpanQuery(
  window: MessageQueueQueryWindow,
  options?: MessageQueueSpanQueryOptions,
): Record<string, unknown> | null {
  const entityKeys: Includes | null = getMessageQueueEntityKeysQueryValue(
    window.keys,
  );
  const projectId: ObjectID | null = projectIdOf(window.projectId);

  if (!entityKeys || !projectId) {
    return null;
  }

  const query: Record<string, unknown> = {
    ...populationFilter(options?.population || "all", options?.messagingSystem),
    projectId: projectId,
    startTime: new InBetween<Date>(window.start, window.end),
    entityKeys: entityKeys,
  };

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

/**
 * Two count series added up interval by interval: a point of either is kept,
 * and one both have holds the total. Ordered by time.
 */
export function addMessageQueueCountSeries(
  first: ReadonlyArray<MessageQueueTimePoint>,
  second: ReadonlyArray<MessageQueueTimePoint>,
): Array<MessageQueueTimePoint> {
  const totals: Map<number, number> = new Map<number, number>();
  for (const point of [...first, ...second]) {
    const time: number = point.x.getTime();
    if (!Number.isFinite(time) || !Number.isFinite(point.y)) {
      continue;
    }
    totals.set(time, (totals.get(time) || 0) + point.y);
  }
  return Array.from(totals.keys())
    .sort((a: number, b: number): number => {
      return a - b;
    })
    .map((time: number): MessageQueueTimePoint => {
      return { x: new Date(time), y: totals.get(time)! };
    });
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

// service id → the row's value, for rows grouped by primaryEntityId.
function valuesByService(
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

/** The three grouped aggregates of one span group, as per-service maps. */
export function toMessageQueueServiceSpanFigures(data: {
  countResult: AggregatedResult | null | undefined;
  errorResult?: AggregatedResult | null | undefined;
  p95Result?: AggregatedResult | null | undefined;
}): MessageQueueServiceSpanFigures {
  return {
    counts: valuesByService(data.countResult),
    errors: valuesByService(data.errorResult),
    p95Ms: valuesByService(
      data.p95Result,
      MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,
    ),
  };
}

// What the tiles and charts read, before client-only publishers join them.
interface MessageQueueTileReads {
  allSeries: Array<MessageQueueTimePoint>;
  errorSeries: Array<MessageQueueTimePoint>;
  publishedSeries: Array<MessageQueueTimePoint>;
  // "consume" spans plus SQS's receives that returned messages.
  consumedSeries: Array<MessageQueueTimePoint>;
  // The "consume" spans alone: whether there is a processing time.
  handledCount: number;
  p95ProcessingSeries: Array<MessageQueueTimePoint>;
  windowP95Ms: number | null;
}

// What the two cards read.
interface MessageQueueServiceReads {
  producers: MessageQueueProducerServices;
  consumers: MessageQueueServices;
}

/**
 * Everything the Overview reads from the queue's spans:
 *
 *   - the tiles and charts: every span (the error rate's denominator), the
 *     failed ones of any kind, Published ("publish" spans, plus the client
 *     send spans of services that record no producer span), Consumed
 *     ("consume" spans, plus SQS receives that returned messages) and the
 *     p95 of the "consume" spans — ONE percentile over the window for the
 *     tile, one per interval for the chart. The count series keep whole
 *     intervals only (getCompleteBucketSeries: the newest is still
 *     filling); the tiles count every span in the range;
 *   - the Producers and Consumers cards (combineMessageQueueProducerServices,
 *     combineMessageQueueConsumerServices), each group of spans read per
 *     service over the whole window.
 *
 * The groups are MessageQueueSpanPopulation's; which of them a queue reads
 * depends on its system (`messagingSystem`, the row's specific one). The
 * tiles, the cards and the client-only publishers' chart line are read
 * apart, so one failed request empties its own part only. Resolves to the
 * empty figures (no API call) when unscoped.
 */
export async function fetchMessageQueueSpanOverview(
  window: MessageQueueQueryWindow & {
    messagingSystem?: string | null | undefined;
    serviceLimit?: number | undefined;
  },
): Promise<MessageQueueSpanOverview> {
  const system: string | null | undefined = window.messagingSystem;
  const polled: boolean = isMessageQueuePolledReceiveSystem(system);
  const awsRpc: boolean = isMessageQueueAwsRpcSystem(system);
  const base: MessageQueueQueryWindow = {
    projectId: window.projectId,
    keys: window.keys,
    start: window.start,
    end: window.end,
  };

  const queryOf: (
    population: MessageQueueSpanPopulation,
    errorsOnly?: boolean,
  ) => Record<string, unknown> | null = (
    population: MessageQueueSpanPopulation,
    errorsOnly?: boolean,
  ): Record<string, unknown> | null => {
    return buildMessageQueueSpanQuery(base, {
      population: population,
      errorsOnly: errorsOnly,
      messagingSystem: system,
    });
  };

  const allQuery: Record<string, unknown> | null = queryOf("all");
  if (!allQuery) {
    return emptySpanOverview();
  }
  const errorQuery: Record<string, unknown> = queryOf("all", true)!;
  const publishQuery: Record<string, unknown> = queryOf("publish")!;
  const consumeQuery: Record<string, unknown> = queryOf("consume")!;
  const receivedBatchQuery: Record<string, unknown> = queryOf("receivedBatch")!;

  const noRows: AggregatedResult = { data: [] };

  const count: (query: Record<string, unknown>) => Promise<AggregatedResult> = (
    query: Record<string, unknown>,
  ): Promise<AggregatedResult> => {
    return spanAggregate({
      window: base,
      query: query,
      aggregationType: AggregationType.Count,
    });
  };

  const byService: (
    query: Record<string, unknown>,
    aggregationType: AggregationType,
  ) => Promise<AggregatedResult> = (
    query: Record<string, unknown>,
    aggregationType: AggregationType,
  ): Promise<AggregatedResult> => {
    return spanAggregate({
      window: base,
      query: query,
      aggregationType: aggregationType,
      groupBy: { primaryEntityId: true },
      aggregationInterval: AggregationInterval.Total,
    });
  };

  // One group per service: spans, failed spans, p95.
  const figuresOf: (
    population: MessageQueueSpanPopulation,
  ) => Promise<MessageQueueServiceSpanFigures> = (
    population: MessageQueueSpanPopulation,
  ): Promise<MessageQueueServiceSpanFigures> => {
    return Promise.all([
      byService(queryOf(population)!, AggregationType.Count),
      byService(queryOf(population, true)!, AggregationType.Count),
      byService(queryOf(population)!, AggregationType.P95),
    ]).then(
      ([countResult, errorResult, p95Result]: [
        AggregatedResult,
        AggregatedResult,
        AggregatedResult,
      ]): MessageQueueServiceSpanFigures => {
        return toMessageQueueServiceSpanFigures({
          countResult,
          errorResult,
          p95Result,
        });
      },
    );
  };

  /*
   * Each part settles to null on a failed request rather than rejecting:
   * one bad chart never empties the cards, nor a bad card the tiles.
   */
  const readTiles: () => Promise<MessageQueueTileReads | null> =
    (): Promise<MessageQueueTileReads | null> => {
      return Promise.all([
        count(allQuery),
        count(errorQuery),
        count(publishQuery),
        count(consumeQuery),
        polled ? count(receivedBatchQuery) : Promise.resolve(noRows),
        spanAggregate({
          window: base,
          query: consumeQuery,
          aggregationType: AggregationType.P95,
        }),
        spanAggregate({
          window: base,
          query: consumeQuery,
          aggregationType: AggregationType.P95,
          aggregationInterval: AggregationInterval.Total,
        }),
      ])
        .then(
          ([
            allResult,
            errorResult,
            publishResult,
            consumeResult,
            receivedBatchResult,
            p95Result,
            windowP95Result,
          ]: Array<AggregatedResult>): MessageQueueTileReads => {
            const handledSeries: Array<MessageQueueTimePoint> =
              aggregatedResultToTimePoints(consumeResult);
            return {
              allSeries: aggregatedResultToTimePoints(allResult),
              errorSeries: aggregatedResultToTimePoints(errorResult),
              publishedSeries: aggregatedResultToTimePoints(publishResult),
              consumedSeries: addMessageQueueCountSeries(
                handledSeries,
                aggregatedResultToTimePoints(receivedBatchResult),
              ),
              handledCount: sumOf(handledSeries),
              p95ProcessingSeries: aggregatedResultToTimePoints(
                p95Result,
                MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,
              ),
              windowP95Ms: firstFiniteValue(
                windowP95Result,
                MESSAGE_QUEUE_MILLISECONDS_PER_NANOSECOND,
              ),
            };
          },
        )
        .catch((): null => {
          return null;
        });
    };

  const readServices: () => Promise<MessageQueueServiceReads | null> =
    (): Promise<MessageQueueServiceReads | null> => {
      return Promise.all([
        figuresOf("publish"),
        figuresOf("send"),
        awsRpc
          ? figuresOf("awsSend")
          : Promise.resolve(emptyMessageQueueServiceSpanFigures()),
        figuresOf("consume"),
        polled
          ? byService(receivedBatchQuery, AggregationType.Count).then(
              (
                countResult: AggregatedResult,
              ): MessageQueueServiceSpanFigures => {
                return toMessageQueueServiceSpanFigures({ countResult });
              },
            )
          : Promise.resolve(emptyMessageQueueServiceSpanFigures()),
      ])
        .then(
          ([
            producer,
            send,
            awsSend,
            consume,
            receivedBatches,
          ]: Array<MessageQueueServiceSpanFigures>): MessageQueueServiceReads => {
            return {
              producers: combineMessageQueueProducerServices({
                producer: producer!,
                sends: [send!, awsSend!],
                limit: window.serviceLimit,
              }),
              consumers: combineMessageQueueConsumerServices({
                consume: consume!,
                receivedBatches: receivedBatches,
                limit: window.serviceLimit,
              }),
            };
          },
        )
        .catch((): null => {
          return null;
        });
    };

  const [tiles, services]: [
    MessageQueueTileReads | null,
    MessageQueueServiceReads | null,
  ] = await Promise.all([readTiles(), readServices()]);

  const producers: MessageQueueProducerServices | null =
    services?.producers || null;

  /*
   * The chart line of the services counted from client send spans alone:
   * their sends per interval, read only when there are any.
   */
  let clientOnlySeries: Array<MessageQueueTimePoint> = [];
  if (tiles && producers && producers.clientOnlyServiceIds.length > 0) {
    const clientOnlyServices: Includes = new Includes(
      producers.clientOnlyServiceIds.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    );
    const sendPopulations: Array<MessageQueueSpanPopulation> = awsRpc
      ? ["send", "awsSend"]
      : ["send"];
    clientOnlySeries = await Promise.all(
      sendPopulations.map(
        (population: MessageQueueSpanPopulation): Promise<AggregatedResult> => {
          return count({
            ...queryOf(population)!,
            primaryEntityId: clientOnlyServices,
          });
        },
      ),
    )
      .then(
        (results: Array<AggregatedResult>): Array<MessageQueueTimePoint> => {
          let series: Array<MessageQueueTimePoint> = [];
          for (const result of results) {
            series = addMessageQueueCountSeries(
              series,
              aggregatedResultToTimePoints(result),
            );
          }
          return series;
        },
      )
      .catch((): Array<MessageQueueTimePoint> => {
        return [];
      });
  }

  let metrics: MessageQueueSpanMetrics = emptySpanMetrics();
  if (tiles) {
    const total: number = sumOf(tiles.allSeries);
    /*
     * The failed spans are some of the spans: a failed count read a moment
     * later than the total (spans still arriving) never exceeds it.
     */
    const errors: number = Math.min(sumOf(tiles.errorSeries), total);
    const publishedSeries: Array<MessageQueueTimePoint> =
      addMessageQueueCountSeries(tiles.publishedSeries, clientOnlySeries);
    metrics = {
      total: total,
      // The client-only publishers' sends, all of them, whatever the chart got.
      published:
        sumOf(tiles.publishedSeries) + (producers?.clientOnlyPublished || 0),
      consumed: sumOf(tiles.consumedSeries),
      errors: errors,
      errorRatePercent: total > 0 ? (errors / total) * 100 : null,
      p95ProcessingMs: tiles.handledCount > 0 ? tiles.windowP95Ms : null,
      publishedSeries: getCompleteBucketSeries(publishedSeries, window),
      consumedSeries: getCompleteBucketSeries(tiles.consumedSeries, window),
      errorSeries: getCompleteBucketSeries(tiles.errorSeries, window),
      p95ProcessingSeries: tiles.p95ProcessingSeries,
    };
  }

  return {
    metrics: metrics,
    producers: producers
      ? { services: producers.services, total: producers.total }
      : emptyServices(),
    consumers: services?.consumers || emptyServices(),
  };
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

/*
 * How long a metric's observed series are reused across the Overview's
 * refreshes. They only build the "Create monitor" link (the attributes a
 * monitor filter pins, not what a chart shows), and they change when a new
 * partition, consumer group or broker appears, not every tick: re-read on
 * every auto-refresh (30 s by default) they cost a request per monitorable
 * gauge each time.
 */
export const MESSAGE_QUEUE_OBSERVED_SERIES_TTL_MS: number = 5 * 60 * 1000;

/**
 * The observed series of the queue's metrics, kept across the Overview's
 * refreshes: per queue scope (project, keys), metric and RANGE — what the
 * reader picked ("Past 1 Hour", or a zoom's start and end), not the window,
 * which moves with every tick of a relative range — for
 * MESSAGE_QUEUE_OBSERVED_SERIES_TTL_MS. A new range or a zoom reads them
 * again; an empty answer (none, or a failed read) is never kept, so the link
 * appears as soon as a series does.
 */
export class MessageQueueObservedSeriesCache {
  private readonly ttlMs: number;
  private readonly entries: Map<
    string,
    { storedAt: number; series: Array<MessageQueueObservedSeries> }
  > = new Map();

  public constructor(ttlMs: number = MESSAGE_QUEUE_OBSERVED_SERIES_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  public static keyOf(data: {
    window: MessageQueueQueryWindow;
    rangeKey: string;
    metricName: string;
  }): string {
    return JSON.stringify([
      String(data.window.projectId || ""),
      [...data.window.keys],
      data.rangeKey,
      data.metricName,
    ]);
  }

  public get(
    key: string,
    now: number,
  ): Array<MessageQueueObservedSeries> | null {
    const entry:
      | { storedAt: number; series: Array<MessageQueueObservedSeries> }
      | undefined = this.entries.get(key);
    if (!entry || now - entry.storedAt >= this.ttlMs) {
      return null;
    }
    return entry.series.map(
      (series: MessageQueueObservedSeries): MessageQueueObservedSeries => {
        return { ...series };
      },
    );
  }

  public set(
    key: string,
    series: ReadonlyArray<MessageQueueObservedSeries>,
    now: number,
  ): void {
    if (series.length === 0) {
      this.entries.delete(key);
      return;
    }
    this.entries.set(key, {
      storedAt: now,
      series: series.map(
        (entry: MessageQueueObservedSeries): MessageQueueObservedSeries => {
          return { ...entry };
        },
      ),
    });
  }
}

/**
 * Every catalog metric of the queue's system, fetched in parallel, and then
 * — for each gauge a monitor can evaluate that has data — the series it was
 * observed with, which the "Create monitor" link filters on. Counters and
 * quiet gauges cost no second request, and with `observedSeriesCache` a
 * gauge whose series were read for this range lately costs none either.
 * Empty (no API call) when unscoped.
 */
export async function fetchMessageQueueBrokerMetrics(
  window: MessageQueueQueryWindow & {
    metrics: ReadonlyArray<MessageQueueMetricDescriptor>;
    observedSeriesCache?:
      | {
          cache: MessageQueueObservedSeriesCache;
          // The range the reader picked (see MessageQueueObservedSeriesCache).
          rangeKey: string;
          // When the entries are judged fresh; the present by default.
          now?: number | undefined;
        }
      | undefined;
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
        const cached: MessageQueueBrokerMetricsCacheUse | null =
          window.observedSeriesCache
            ? {
                cache: window.observedSeriesCache.cache,
                key: MessageQueueObservedSeriesCache.keyOf({
                  window: base,
                  rangeKey: window.observedSeriesCache.rangeKey,
                  metricName: result.descriptor.metricName,
                }),
                now:
                  window.observedSeriesCache.now ??
                  OneUptimeDate.getCurrentDate().getTime(),
              }
            : null;
        const kept: Array<MessageQueueObservedSeries> | null = cached
          ? cached.cache.get(cached.key, cached.now)
          : null;
        if (kept) {
          return { ...result, observedSeries: kept };
        }
        const observedSeries: Array<MessageQueueObservedSeries> =
          await fetchMessageQueueObservedSeries({
            ...base,
            descriptor: result.descriptor,
          });
        if (cached) {
          cached.cache.set(cached.key, observedSeries, cached.now);
        }
        return { ...result, observedSeries: observedSeries };
      },
    ),
  );
}

// One metric's place in the observed-series cache, for one read.
interface MessageQueueBrokerMetricsCacheUse {
  cache: MessageQueueObservedSeriesCache;
  key: string;
  now: number;
}

/** True when any broker metric returned at least one point. */
export function hasMessageQueueBrokerMetricData(
  results: ReadonlyArray<MessageQueueBrokerMetricResult>,
): boolean {
  return results.some((result: MessageQueueBrokerMetricResult): boolean => {
    return result.series.length > 0;
  });
}

// ---- the Broker metrics card ----------------------------------------------

/*
 * What the Broker metrics card (MessageQueueBrokerMetricsStatus) reads
 * besides the range's own results: when each catalog metric last arrived for
 * the queue, over a lookback longer than any range a reader usually picks,
 * and — for a namespace-scoped queue none of whose metrics is in the range —
 * what the namespace sends at all. Neither ever reads a value: a count of
 * datapoints per interval is all either needs.
 */

// How far back a metric's last arrival is looked for.
export const MESSAGE_QUEUE_BROKER_METRIC_LOOKBACK_DAYS: number = 7;

/*
 * The recent stretch read minute by minute, so a metric that arrived lately
 * says when to the minute; an older arrival is known to the hour.
 */
export const MESSAGE_QUEUE_BROKER_METRIC_RECENT_HOURS: number = 3;

/** When each of a queue's catalog metrics last arrived for it. */
export interface MessageQueueBrokerMetricArrivals {
  // The lookback's start: a metric absent below did not arrive since.
  since: Date;
  /*
   * Stored metric name → the start of the newest interval it arrived in: a
   * minute within the recent stretch, an hour before it.
   */
  lastArrivedAt: ReadonlyMap<string, Date>;
}

function uniqueMetricNamesOf(
  metrics: ReadonlyArray<MessageQueueMetricDescriptor>,
): Array<string> {
  const names: Array<string> = [];
  for (const descriptor of metrics) {
    const name: string = (descriptor.metricName || "").trim().toLowerCase();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

// metric name → its newest interval with a datapoint, from rows by name.
function newestIntervalByName(
  result: AggregatedResult | null | undefined,
): Map<string, number> {
  const newest: Map<string, number> = new Map<string, number>();
  for (const row of (result?.data || []) as Array<AggregatedModel>) {
    const raw: unknown = row["name"];
    const name: string =
      typeof raw === "string" ? raw.trim().toLowerCase() : "";
    const time: number | null = intervalTimeOf(row);
    const count: number = Number(row["value"]);
    if (!name || time === null || !(count > 0)) {
      continue;
    }
    const known: number | undefined = newest.get(name);
    if (known === undefined || time > known) {
      newest.set(name, time);
    }
  }
  return newest;
}

/**
 * When each catalog metric last arrived for the queue in the last
 * MESSAGE_QUEUE_BROKER_METRIC_LOOKBACK_DAYS: two counts of its datapoints by
 * name — per minute over the recent stretch, per hour over the lookback —
 * under the queue's key. Null (and no API call) when unscoped; null too when
 * a read fails or comes back cut off, so the card never claims a metric
 * never arrived on an answer it did not get whole.
 */
export async function fetchMessageQueueBrokerMetricArrivals(data: {
  projectId: ObjectID | string | null | undefined;
  keys: ReadonlyArray<string>;
  metrics: ReadonlyArray<MessageQueueMetricDescriptor>;
  // When the lookback ends; the present by default.
  now?: Date | undefined;
}): Promise<MessageQueueBrokerMetricArrivals | null> {
  const entityKeys: Includes | null = getMessageQueueEntityKeysQueryValue(
    data.keys,
  );
  const projectId: ObjectID | null = projectIdOf(data.projectId);
  const names: Array<string> = uniqueMetricNamesOf(data.metrics);
  if (!entityKeys || !projectId || names.length === 0) {
    return null;
  }

  const now: Date = data.now || OneUptimeDate.getCurrentDate();
  const since: Date = OneUptimeDate.addRemoveDays(
    now,
    -MESSAGE_QUEUE_BROKER_METRIC_LOOKBACK_DAYS,
  );
  const recentSince: Date = OneUptimeDate.addRemoveHours(
    now,
    -MESSAGE_QUEUE_BROKER_METRIC_RECENT_HOURS,
  );

  const read: (
    start: Date,
    interval: AggregationInterval,
  ) => Promise<AggregatedResult> = (
    start: Date,
    interval: AggregationInterval,
  ): Promise<AggregatedResult> => {
    return AnalyticsModelAPI.aggregate<Metric>({
      modelType: Metric,
      aggregateBy: aggregateBy<Metric>({
        query: {
          projectId: projectId,
          time: new InBetween<Date>(start, now),
          name: new Includes(names),
          entityKeys: entityKeys,
        },
        aggregationType: AggregationType.Count,
        aggregateColumnName: "value",
        timestampColumnName: "time",
        start: start,
        end: now,
        groupBy: { name: true },
        aggregationInterval: interval,
      }),
    });
  };

  try {
    const [recent, lookback]: [AggregatedResult, AggregatedResult] =
      await Promise.all([
        read(recentSince, AggregationInterval.Minute),
        read(since, AggregationInterval.Hour),
      ]);
    if (recent.truncated || lookback.truncated) {
      return null;
    }
    const byMinute: Map<string, number> = newestIntervalByName(recent);
    const byHour: Map<string, number> = newestIntervalByName(lookback);
    const lastArrivedAt: Map<string, Date> = new Map<string, Date>();
    for (const name of names) {
      const time: number | undefined = byMinute.get(name) ?? byHour.get(name);
      if (time !== undefined) {
        lastArrivedAt.set(name, new Date(time));
      }
    }
    return { since: since, lastArrivedAt: lastArrivedAt };
  } catch {
    return null;
  }
}

/*
 * How long the arrivals are reused across the Overview's refreshes. They
 * change only when a metric starts or stops arriving, and each read covers
 * a week: re-read on every auto-refresh they would cost two week-long
 * aggregates a tick. The range's own results keep an arriving metric's time
 * current in between (MessageQueueBrokerMetricsStatus takes the newer).
 */
export const MESSAGE_QUEUE_BROKER_METRIC_ARRIVALS_TTL_MS: number =
  5 * 60 * 1000;

/**
 * The arrivals of a queue's metrics, kept across the Overview's refreshes
 * per queue scope (project, keys) and metric set for
 * MESSAGE_QUEUE_BROKER_METRIC_ARRIVALS_TTL_MS. A failed read (null) is never
 * kept, so the next refresh tries again.
 */
export class MessageQueueBrokerMetricArrivalsCache {
  private readonly ttlMs: number;
  private readonly entries: Map<
    string,
    { storedAt: number; arrivals: MessageQueueBrokerMetricArrivals }
  > = new Map();

  public constructor(
    ttlMs: number = MESSAGE_QUEUE_BROKER_METRIC_ARRIVALS_TTL_MS,
  ) {
    this.ttlMs = ttlMs;
  }

  public static keyOf(data: {
    projectId: ObjectID | string | null | undefined;
    keys: ReadonlyArray<string>;
    metrics: ReadonlyArray<MessageQueueMetricDescriptor>;
  }): string {
    return JSON.stringify([
      String(data.projectId || ""),
      [...data.keys],
      uniqueMetricNamesOf(data.metrics),
    ]);
  }

  public get(
    key: string,
    now: number,
  ): MessageQueueBrokerMetricArrivals | null {
    const entry:
      | { storedAt: number; arrivals: MessageQueueBrokerMetricArrivals }
      | undefined = this.entries.get(key);
    if (!entry || now - entry.storedAt >= this.ttlMs) {
      return null;
    }
    return entry.arrivals;
  }

  public set(
    key: string,
    arrivals: MessageQueueBrokerMetricArrivals | null,
    now: number,
  ): void {
    if (!arrivals) {
      this.entries.delete(key);
      return;
    }
    this.entries.set(key, { storedAt: now, arrivals: arrivals });
  }
}

/**
 * The arrivals, from `cache` while fresh, else read and kept
 * (fetchMessageQueueBrokerMetricArrivals).
 */
export async function fetchMessageQueueBrokerMetricArrivalsCached(data: {
  projectId: ObjectID | string | null | undefined;
  keys: ReadonlyArray<string>;
  metrics: ReadonlyArray<MessageQueueMetricDescriptor>;
  cache: MessageQueueBrokerMetricArrivalsCache;
  // When the entry is judged fresh and the lookback ends; the present by default.
  now?: Date | undefined;
}): Promise<MessageQueueBrokerMetricArrivals | null> {
  const now: Date = data.now || OneUptimeDate.getCurrentDate();
  const key: string = MessageQueueBrokerMetricArrivalsCache.keyOf(data);
  const kept: MessageQueueBrokerMetricArrivals | null = data.cache.get(
    key,
    now.getTime(),
  );
  if (kept) {
    return kept;
  }
  const arrivals: MessageQueueBrokerMetricArrivals | null =
    await fetchMessageQueueBrokerMetricArrivals({
      projectId: data.projectId,
      keys: data.keys,
      metrics: data.metrics,
      now: now,
    });
  data.cache.set(key, arrivals, now.getTime());
  return arrivals;
}

/*
 * The stored key of the resource attribute a cloud connection (Cloud >
 * Connect) puts on what it delivers: what tells its namespace totals apart
 * from a collector's.
 */
export const MESSAGE_QUEUE_CLOUD_CONNECTION_ATTRIBUTE_KEY: string = `resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`;

/** One series a namespace sent in the range, by what it names. */
export interface MessageQueueNamespaceSeries {
  // The broker scope it carries, as stored (Azure: the namespace, `name`).
  namespace: string;
  // The destination it names, as stored; "" for a namespace's own total.
  entity: string;
  // Whether a cloud connection delivered it rather than a collector.
  fromCloudConnection: boolean;
}

function stringAttributeOf(
  attributes: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): string {
  for (const key of keys) {
    const value: unknown = Object.prototype.hasOwnProperty.call(attributes, key)
      ? attributes[key]
      : undefined;
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

/**
 * What a namespace-scoped queue's NAMESPACE sent in the range under the
 * system's catalog metric names, whatever queue (if any) each series reached:
 * one count per series over the whole window, grouped by the scope key, the
 * destination keys and the cloud connection key — never scoped by the
 * queue's entity key, since the point is to find metrics that did not reach
 * it. The scope is matched loosely on the server (a case-insensitive
 * contains: an ARM name keeps the casing it was created with, the queue's
 * scope is lowercased) and exactly here, by the caller
 * (getMessageQueueNamespaceFinding). Null when the system's catalog has no
 * scope key or the queue no namespace (no API call), and on failure;
 * `isComplete` is false when the answer was cut off.
 */
export async function fetchMessageQueueNamespaceSeries(data: {
  projectId: ObjectID | string | null | undefined;
  start: Date;
  end: Date;
  metrics: ReadonlyArray<MessageQueueMetricDescriptor>;
  namespace: string | null | undefined;
}): Promise<{
  series: Array<MessageQueueNamespaceSeries>;
  isComplete: boolean;
} | null> {
  const projectId: ObjectID | null = projectIdOf(data.projectId);
  const namespace: string = (data.namespace || "").trim();
  const names: Array<string> = uniqueMetricNamesOf(data.metrics);
  const scopeKeys: Array<string> = [];
  const entityKeys: Array<string> = [];
  for (const descriptor of data.metrics) {
    for (const key of descriptor.scopeAttributes || []) {
      if (!scopeKeys.includes(key)) {
        scopeKeys.push(key);
      }
    }
    for (const key of descriptor.destinationAttributes) {
      if (!entityKeys.includes(key)) {
        entityKeys.push(key);
      }
    }
  }
  if (!projectId || !namespace || names.length === 0 || !scopeKeys[0]) {
    return null;
  }

  const groupKeys: Array<string> = [];
  for (const key of [
    ...scopeKeys,
    ...entityKeys,
    MESSAGE_QUEUE_CLOUD_CONNECTION_ATTRIBUTE_KEY,
  ]) {
    if (!groupKeys.includes(key)) {
      groupKeys.push(key);
    }
  }

  try {
    const result: AggregatedResult = await AnalyticsModelAPI.aggregate<Metric>({
      modelType: Metric,
      aggregateBy: aggregateBy<Metric>({
        query: {
          projectId: projectId,
          time: new InBetween<Date>(data.start, data.end),
          name: new Includes(names),
          attributes: { [scopeKeys[0]]: new Search<string>(namespace) },
        },
        aggregationType: AggregationType.Count,
        aggregateColumnName: "value",
        timestampColumnName: "time",
        start: data.start,
        end: data.end,
        groupByAttributeKeys: groupKeys,
        aggregationInterval: AggregationInterval.Total,
      }),
    });

    const series: Array<MessageQueueNamespaceSeries> = [];
    for (const row of (result.data || []) as Array<AggregatedModel>) {
      const raw: unknown = row["attributes"];
      const attributes: Record<string, unknown> =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      series.push({
        namespace: stringAttributeOf(attributes, scopeKeys),
        entity: stringAttributeOf(attributes, entityKeys),
        fromCloudConnection:
          stringAttributeOf(attributes, [
            MESSAGE_QUEUE_CLOUD_CONNECTION_ATTRIBUTE_KEY,
          ]) !== "",
      });
    }
    return { series: series, isComplete: !result.truncated };
  } catch {
    return null;
  }
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

// ---- a clicked metric outside the catalog ---------------------------------

/*
 * What a clicked metric the catalog does not know IS — a messaging client
 * metric, an application's own gauge — read from its newest stored point
 * under the queue's key: a histogram (charted by percentile: its stored
 * `value` is the bucket sum), a cumulative monotonic counter (charted as a
 * rate), a delta counter, or a gauge. The unit comes from the metric list
 * (MetricType.unit). Unknown fields are null, and the metric is then
 * charted as a gauge.
 */
export interface MessageQueueMetricShape {
  unit: string;
  pointType: MetricPointType | null;
  isMonotonic: boolean | null;
  aggregationTemporality: AggregationTemporality | null;
}

export const UNKNOWN_MESSAGE_QUEUE_METRIC_SHAPE: MessageQueueMetricShape = {
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
 * newest point under the queue's key in the window. Resolves to the unknown
 * shape (no API call) when unscoped, and on failure or no data.
 */
export async function fetchMessageQueueMetricShape(
  window: MessageQueueQueryWindow & {
    metricName: string;
    unit?: string | null | undefined;
  },
): Promise<MessageQueueMetricShape> {
  const unit: string = (window.unit || "").trim();
  const unknown: MessageQueueMetricShape = {
    ...UNKNOWN_MESSAGE_QUEUE_METRIC_SHAPE,
    unit: unit,
  };
  const query: Record<string, unknown> | null =
    buildMessageQueueMetricQuery(window);
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

export const MESSAGE_QUEUE_METRIC_GAUGE_AGGREGATIONS: ReadonlyArray<AggregationType> =
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
export const MESSAGE_QUEUE_METRIC_DISTRIBUTION_AGGREGATIONS: ReadonlyArray<AggregationType> =
  [
    AggregationType.P50,
    AggregationType.P90,
    AggregationType.P95,
    AggregationType.P99,
    AggregationType.Avg,
    AggregationType.Max,
    AggregationType.Min,
  ];

// A delta counter's points are increments: Sum per interval is the total.
export const MESSAGE_QUEUE_METRIC_DELTA_COUNTER_AGGREGATIONS: ReadonlyArray<AggregationType> =
  [
    AggregationType.Sum,
    AggregationType.Avg,
    AggregationType.Max,
    AggregationType.Min,
  ];

// What the chart of a cumulative counter says, curated or not.
export const MESSAGE_QUEUE_METRIC_CHART_COUNTER_NOTE: string = translationKey(
  "A cumulative counter, charted as a per-second rate: each series' rate, added up.",
);

/*
 * "rate": a cumulative counter as a per-second rate, per series then
 * summed. "aggregate": every series pooled with the picked aggregation.
 */
export type MessageQueueMetricChartMode = "rate" | "aggregate";

/** How a clicked metric outside the catalog is charted. */
export interface MessageQueueMetricChartSpec {
  metricName: string;
  // The metric name, "(per second)" added for a rate.
  title: string;
  mode: MessageQueueMetricChartMode;
  // What the picker offers; empty when there is nothing to pick.
  aggregations: ReadonlyArray<AggregationType>;
  defaultAggregation: AggregationType;
  // Charted as a per-second rate (a cumulative counter).
  isRate: boolean;
  // A histogram: percentiles from its buckets.
  isDistribution: boolean;
  // The metric's own unit (UCUM, from the metric list) for formatting.
  unit: string;
  /*
   * One line under the picker saying how the metric is charted: an English
   * translation key, translated where the chart modal draws it.
   */
  note: string;
}

/**
 * How a clicked metric of the queue that the catalog does not know is
 * charted — by what it is and nothing else: a histogram by percentile (P95
 * by default: its stored value is the sum of its observations, not a
 * latency), a cumulative monotonic counter as a per-second rate, a delta
 * counter by its Sum per interval, and any other metric averaged per
 * interval, as the metric explorer does. A curated broker metric never
 * comes here: the chart reads it as Broker health does
 * (fetchMessageQueueCatalogMetricSeries).
 */
export function getMessageQueueMetricChartSpec(
  metricName: string,
  shape?: Partial<MessageQueueMetricShape> | null | undefined,
): MessageQueueMetricChartSpec {
  const name: string = (metricName || "").trim();
  const unit: string = (shape?.unit || "").trim();

  if (shape?.pointType && DISTRIBUTION_POINT_TYPES.includes(shape.pointType)) {
    return {
      metricName: name,
      title: name,
      mode: "aggregate",
      aggregations: MESSAGE_QUEUE_METRIC_DISTRIBUTION_AGGREGATIONS,
      defaultAggregation: AggregationType.P95,
      isRate: false,
      isDistribution: true,
      unit: unit,
      note: translationKey(
        "A distribution: percentiles are computed from its buckets, Average is the mean of every observation.",
      ),
    };
  }

  if (shape?.isMonotonic === true) {
    if (shape.aggregationTemporality === AggregationTemporality.Delta) {
      return {
        metricName: name,
        title: name,
        mode: "aggregate",
        aggregations: MESSAGE_QUEUE_METRIC_DELTA_COUNTER_AGGREGATIONS,
        defaultAggregation: AggregationType.Sum,
        isRate: false,
        isDistribution: false,
        unit: unit,
        note: translationKey(
          "A delta counter: Sum is the total counted in each interval.",
        ),
      };
    }
    if (
      shape.aggregationTemporality === AggregationTemporality.Cumulative ||
      shape.pointType === MetricPointType.Sum
    ) {
      return {
        metricName: name,
        title: translateTemplate("{{metricName}} (per second)", {
          metricName: name,
        }),
        mode: "rate",
        aggregations: [],
        defaultAggregation: AggregationType.Max,
        isRate: true,
        isDistribution: false,
        unit: unit,
        note: MESSAGE_QUEUE_METRIC_CHART_COUNTER_NOTE,
      };
    }
  }

  return {
    metricName: name,
    title: name,
    mode: "aggregate",
    aggregations: MESSAGE_QUEUE_METRIC_GAUGE_AGGREGATIONS,
    defaultAggregation: AggregationType.Avg,
    isRate: false,
    isDistribution: false,
    unit: unit,
    note: "",
  };
}

/**
 * The series of the in-place chart of a metric outside the catalog, over
 * the queue's key, read the way the spec says: a cumulative counter as the
 * Max of every distinct series per interval (`groupBy: { attributes: true
 * }`), a rate per series, the rates summed; anything else every series
 * pooled with `aggregationType`, the picker's choice (ignored for a rate).
 * Empty (no API call) when unscoped, and on failure.
 */
export async function fetchMessageQueueMetricChartSeries(
  window: MessageQueueQueryWindow & {
    spec: MessageQueueMetricChartSpec;
    aggregationType: AggregationType;
  },
): Promise<Array<MessageQueueTimePoint>> {
  const query: Record<string, unknown> | null = buildMessageQueueMetricQuery({
    projectId: window.projectId,
    keys: window.keys,
    start: window.start,
    end: window.end,
    metricName: window.spec.metricName,
  });
  if (!query) {
    return [];
  }

  try {
    if (window.spec.mode === "rate") {
      return counterResultToRatePerSecond(
        await aggregateMetric({
          window: window,
          query: query,
          // The latest cumulative value of each series in the interval.
          aggregationType: AggregationType.Max,
          groupBy: { attributes: true },
        }),
      );
    }
    return aggregatedResultToTimePoints(
      await aggregateMetric({
        window: window,
        query: query,
        aggregationType: window.aggregationType,
      }),
    );
  } catch {
    return [];
  }
}
