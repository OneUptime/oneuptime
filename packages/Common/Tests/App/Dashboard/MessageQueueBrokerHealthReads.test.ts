import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * How a queue's broker metrics are READ, against an emulation of the
 * aggregate endpoint that does what the server does with a request: it
 * buckets the stored points on the interval grid (the window's own
 * interval, or the one pinned), groups them by the request's group-by,
 * folds each group with the request's aggregation, orders the rows newest
 * first, applies the row limit and flags a full page `truncated`
 * (AnalyticsDatabaseService.aggregateBy). What these pin:
 *
 *   - a per-period count (aggregation Sum) is never carried into an
 *     interval it has no point in: one burst of errors counts once, and the
 *     page reads the very query its monitor evaluates (Sum, no group-by);
 *   - a per-series read that the row limit cut off is read again at a
 *     coarser interval its series fit, so a partitioned topic's chart
 *     starts at the start of the range with every partition in every
 *     interval; where the fold composes (Max of Max, Sum of Sum) there is
 *     one pooled read and nothing to cut off; a read still cut off drops
 *     the interval the limit cut through rather than chart a partial total;
 *   - a per-period count keeps whole intervals only: the one still filling
 *     is never the tile, and a late source's recent intervals wait until
 *     its points can have arrived.
 */

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (request: unknown): Promise<unknown> => {
        return Promise.resolve(emulateAggregate(request as AggregateRequest));
      },
    },
  };
});

import {
  MESSAGE_QUEUE_SERIES_READ_MAX_WIDENINGS,
  MessageQueueMetricReadPlan,
  MessageQueueTimePoint,
  combineMessageQueueCountSeries,
  fetchMessageQueueCatalogMetricSeries,
  getCompleteMessageQueueCountSeries,
  getMessageQueueCountSettleMs,
  getMessageQueueMetricReadPlan,
  getMessageQueueSeriesReadInterval,
  toMessageQueueBrokerMetricResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  getMessageQueueMetricDescriptorsByName,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MessageQueueMetricMonitorSeed,
  getMessageQueueMetricMonitorSeed,
} from "../../../Types/Monitor/MessageQueueAlertTemplates";

interface AggregateRequest {
  modelType: unknown;
  aggregateBy: {
    query: Record<string, unknown>;
    aggregationType: AggregationType;
    aggregationInterval?: AggregationInterval | undefined;
    groupBy?: Record<string, unknown> | undefined;
    groupByAttributeKeys?: Array<string> | undefined;
    startTimestamp: Date;
    endTimestamp: Date;
    limit: number;
  };
}

// One stored datapoint of the metric the test reads.
interface StoredPoint {
  time: number;
  value: number;
  attributes: Record<string, string>;
}

interface RowGroup {
  time: number;
  attributes: Record<string, string> | null;
  values: Array<number>;
}

let stored: Array<StoredPoint> = [];
let requests: Array<AggregateRequest> = [];
// A row limit below the request's, for a test that must stay cut off.
let serverRowLimit: number | null = null;

function fold(values: Array<number>, type: AggregationType): number {
  const total: number = values.reduce((sum: number, value: number): number => {
    return sum + value;
  }, 0);
  switch (type) {
    case AggregationType.Max:
      return Math.max(...values);
    case AggregationType.Min:
      return Math.min(...values);
    case AggregationType.Avg:
      return total / values.length;
    case AggregationType.Count:
      return values.length;
    default:
      return total;
  }
}

function emulateAggregate(request: AggregateRequest): AggregatedResult {
  requests.push(request);
  const by: AggregateRequest["aggregateBy"] = request.aggregateBy;
  const widthMs: number = AggregationIntervalUtil.getAggregationIntervalMs(
    AggregationIntervalUtil.getAggregationIntervalForWindow({
      startDate: by.startTimestamp,
      endDate: by.endTimestamp,
      aggregationInterval: by.aggregationInterval,
    }),
  );

  const groups: Map<string, RowGroup> = new Map<string, RowGroup>();
  for (const point of stored) {
    if (
      point.time < by.startTimestamp.getTime() ||
      point.time > by.endTimestamp.getTime()
    ) {
      continue;
    }
    // toStartOfInterval: the epoch-aligned grid.
    const bucket: number = Math.floor(point.time / widthMs) * widthMs;
    let attributes: Record<string, string> | null = null;
    if (by.groupBy && by.groupBy["attributes"]) {
      attributes = { ...point.attributes };
    } else if (by.groupByAttributeKeys && by.groupByAttributeKeys.length > 0) {
      attributes = {};
      for (const key of by.groupByAttributeKeys) {
        attributes[key] = point.attributes[key] || "";
      }
    }
    const key: string = `${bucket}|${JSON.stringify(attributes)}`;
    let group: RowGroup | undefined = groups.get(key);
    if (!group) {
      group = { time: bucket, attributes: attributes, values: [] };
      groups.set(key, group);
    }
    group.values.push(point.value);
  }

  const rows: Array<AggregatedModel> = Array.from(groups.values())
    .map((group: RowGroup): AggregatedModel => {
      const row: AggregatedModel = {
        timestamp: new Date(group.time),
        value: fold(group.values, by.aggregationType),
      };
      if (group.attributes) {
        row["attributes"] = group.attributes;
      }
      return row;
    })
    .sort((a: AggregatedModel, b: AggregatedModel): number => {
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

  const limit: number = Math.min(
    Number(by.limit),
    serverRowLimit === null ? Number.POSITIVE_INFINITY : serverRowLimit,
  );
  const data: Array<AggregatedModel> = rows.slice(0, limit);
  return { data: data, truncated: data.length >= limit };
}

const MINUTE: number = 60 * 1000;
const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const KEY: string = "0123456789abcdef";
// A window in the past, on the fifteen-minute grid: every interval closed.
const T0: number = Date.UTC(2026, 8, 20, 6, 0, 0);

function descriptorOf(
  system: string,
  metricName: string,
): MessageQueueMetricDescriptor {
  const descriptor: MessageQueueMetricDescriptor | undefined =
    getMessageQueueMetricDescriptorsByName(metricName).find(
      (candidate: MessageQueueMetricDescriptor): boolean => {
        return candidate.system === system;
      },
    );
  if (!descriptor) {
    throw new Error(`No catalog entry ${system}:${metricName}`);
  }
  return descriptor;
}

function store(
  time: number,
  value: number,
  attributes: Record<string, string> = {},
): void {
  stored.push({ time: time, value: value, attributes: attributes });
}

function read(data: {
  descriptor: MessageQueueMetricDescriptor;
  start: number;
  end: number;
  now?: number | undefined;
}): Promise<Array<MessageQueueTimePoint>> {
  return fetchMessageQueueCatalogMetricSeries({
    projectId: PROJECT_ID,
    keys: [KEY],
    start: new Date(data.start),
    end: new Date(data.end),
    descriptor: data.descriptor,
    now: data.now,
  });
}

function valuesOf(series: Array<MessageQueueTimePoint>): Array<number> {
  return series.map((point: MessageQueueTimePoint): number => {
    return point.y;
  });
}

function minutesOf(series: Array<MessageQueueTimePoint>): Array<number> {
  return series.map((point: MessageQueueTimePoint): number => {
    return (point.x.getTime() - T0) / MINUTE;
  });
}

beforeEach(() => {
  stored = [];
  requests = [];
  serverRowLimit = null;
});

describe("a per-period count is never carried into an interval it has no point in", () => {
  test("Pub/Sub publish requests: one minute of failed requests counts in that minute only", async () => {
    const sendRequests: MessageQueueMetricDescriptor = descriptorOf(
      "gcp_pubsub",
      "pubsub.googleapis.com/topic/send_request_count",
    );
    // A DELTA series per response code: failures only in the minutes with some.
    for (let minute: number = 0; minute < 5; minute++) {
      store(T0 + minute * MINUTE, 100, {
        response_class: "success",
        response_code: "OK",
      });
    }
    store(T0 + MINUTE, 7, {
      response_class: "deadline_exceeded",
      response_code: "DEADLINE_EXCEEDED",
    });

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: sendRequests,
      start: T0,
      end: T0 + 60 * MINUTE,
    });

    expect(valuesOf(series)).toEqual([100, 107, 100, 100, 100]);
    expect(minutesOf(series)).toEqual([0, 1, 2, 3, 4]);

    // One pooled Sum: the query the metric's monitor evaluates.
    expect(requests).toHaveLength(1);
    const by: AggregateRequest["aggregateBy"] = requests[0]!.aggregateBy;
    expect(by.aggregationType).toBe(AggregationType.Sum);
    expect(by.groupByAttributeKeys).toBeUndefined();
    expect(by.groupBy).toBeUndefined();
    const seed: MessageQueueMetricMonitorSeed =
      getMessageQueueMetricMonitorSeed(sendRequests)!;
    expect(seed.aggregationType).toBe(by.aggregationType);
    expect(seed.groupByAttributeKeys).toEqual([]);
  });

  test("Service Bus server errors: a burst is not the newest interval's count", async () => {
    const serverErrors: MessageQueueMetricDescriptor = descriptorOf(
      "servicebus",
      "azure_servererrors_total",
    );
    for (let minute: number = 0; minute < 4; minute++) {
      store(T0 + minute * MINUTE, 1, {
        metadata_operationresult: "ServerBusy",
      });
    }
    store(T0 + MINUTE, 50, {
      metadata_operationresult: "InternalServerError",
    });

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: serverErrors,
      start: T0,
      end: T0 + 60 * MINUTE,
    });

    expect(valuesOf(series)).toEqual([1, 51, 1, 1]);
    // The tile: the one server error of the newest minute.
    expect(toMessageQueueBrokerMetricResult(serverErrors, series).value).toBe(
      1,
    );
  });

  test("a count read per series (the busiest one) combines only the series each interval has", async () => {
    const serverErrors: MessageQueueMetricDescriptor = descriptorOf(
      "servicebus",
      "azure_servererrors_total",
    );
    // A catalog entry that shows the busiest operation result, not the total.
    const busiest: MessageQueueMetricDescriptor = {
      ...serverErrors,
      seriesCombine: "max",
    };
    expect(getMessageQueueMetricReadPlan(busiest)).toEqual({
      mode: "series",
      aggregationType: AggregationType.Sum,
      groupByAttributeKeys: [...serverErrors.seriesKeys!],
      isPerPeriodCount: true,
    });
    store(T0, 5, { metadata_operationresult: "ServerBusy" });
    for (let minute: number = 0; minute < 4; minute++) {
      store(T0 + minute * MINUTE, 1, {
        metadata_operationresult: "InternalServerError",
      });
    }

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: busiest,
      start: T0,
      end: T0 + 60 * MINUTE,
    });

    // Carried forward, the first minute's 5 would read in the next two.
    expect(valuesOf(series)).toEqual([5, 1, 1, 1]);
    expect(requests[0]!.aggregateBy.groupByAttributeKeys).toEqual(
      serverErrors.seriesKeys,
    );
  });

  test("combineMessageQueueCountSeries: the series present, summed, the busiest or averaged", () => {
    const result: AggregatedResult = {
      data: [
        { timestamp: new Date(T0), value: 4, attributes: { code: "a" } },
        { timestamp: new Date(T0), value: 6, attributes: { code: "b" } },
        {
          timestamp: new Date(T0 + MINUTE),
          value: 3,
          attributes: { code: "a" },
        },
        /*
         * Unreadable rows are skipped. (Rows arrive as JSON, so a timestamp
         * is text until it is read.)
         */
        { timestamp: "not a time", value: 9, attributes: { code: "a" } },
        { timestamp: new Date(T0), value: "x", attributes: { code: "c" } },
      ] as unknown as AggregatedResult["data"],
    };

    expect(valuesOf(combineMessageQueueCountSeries(result, "sum"))).toEqual([
      10, 3,
    ]);
    expect(valuesOf(combineMessageQueueCountSeries(result, "max"))).toEqual([
      6, 3,
    ]);
    expect(valuesOf(combineMessageQueueCountSeries(result, "avg"))).toEqual([
      5, 3,
    ]);
    expect(combineMessageQueueCountSeries(null, "sum")).toEqual([]);
  });
});

describe("the aggregate API's row limit", () => {
  test("Kafka Produced over three hours for a 64-partition topic: read again in five-minute intervals, whole from the start", async () => {
    const produced: MessageQueueMetricDescriptor = descriptorOf(
      "kafka",
      "kafka.partition.current_offset",
    );
    // Each partition's offset grows 10 messages a second.
    for (let minute: number = 0; minute < 180; minute++) {
      for (let partition: number = 0; partition < 64; partition++) {
        store(T0 + minute * MINUTE, 1_000_000 + minute * 600, {
          topic: "orders",
          partition: String(partition),
        });
      }
    }

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: produced,
      start: T0,
      end: T0 + 180 * MINUTE,
    });

    // 64 series × 180 minutes is over the limit: the first read is cut off.
    expect(requests).toHaveLength(2);
    expect(requests[0]!.aggregateBy.aggregationInterval).toBeUndefined();
    expect(requests[0]!.aggregateBy.limit).toBe(LIMIT_PER_PROJECT);
    expect(requests[1]!.aggregateBy.aggregationInterval).toBe(
      AggregationInterval.FiveMinutes,
    );
    expect(requests[1]!.aggregateBy.groupBy).toEqual({ attributes: true });

    // 640 a second from the first interval that has a predecessor on.
    expect(minutesOf(series)[0]).toBe(5);
    expect(series).toHaveLength(35);
    for (const point of series) {
      expect(point.y).toBeCloseTo(640, 6);
    }
  });

  test("Kafka partition lag over a day: one pooled read, the laggiest partition from the first interval", async () => {
    const partitionLag: MessageQueueMetricDescriptor = descriptorOf(
      "kafka",
      "kafka.consumer_group.lag",
    );
    // 3 groups × 40 partitions, one point each per fifteen minutes.
    for (let interval: number = 0; interval < 96; interval++) {
      for (let group: number = 0; group < 3; group++) {
        for (let partition: number = 0; partition < 40; partition++) {
          store(
            T0 + interval * 15 * MINUTE,
            group === 2 && partition === 39 ? 5000 : 10,
            {
              topic: "orders",
              group: `g${group}`,
              partition: String(partition),
            },
          );
        }
      }
    }

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: partitionLag,
      start: T0,
      end: T0 + 96 * 15 * MINUTE,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.aggregateBy.aggregationType).toBe(AggregationType.Max);
    expect(requests[0]!.aggregateBy.groupByAttributeKeys).toBeUndefined();
    expect(series).toHaveLength(96);
    expect(minutesOf(series)[0]).toBe(0);
    expect(new Set(valuesOf(series))).toEqual(new Set([5000]));
  });

  test("Pulsar topic backlog over three hours for 64 partitions: widened, every partition in every interval", async () => {
    const backlog: MessageQueueMetricDescriptor = descriptorOf(
      "pulsar",
      "pulsar_msg_backlog",
    );
    expect(getMessageQueueMetricReadPlan(backlog).mode).toBe("series");
    for (let minute: number = 0; minute < 180; minute++) {
      for (let partition: number = 0; partition < 64; partition++) {
        store(T0 + minute * MINUTE, 100, {
          cluster: "standalone",
          topic: `persistent://public/default/orders-partition-${partition}`,
          partition: String(partition),
        });
      }
    }

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: backlog,
      start: T0,
      end: T0 + 180 * MINUTE,
    });

    expect(requests).toHaveLength(2);
    expect(requests[1]!.aggregateBy.aggregationInterval).toBe(
      AggregationInterval.FiveMinutes,
    );
    expect(requests[1]!.aggregateBy.groupByAttributeKeys).toEqual(
      backlog.seriesKeys,
    );
    expect(minutesOf(series)[0]).toBe(0);
    expect(series).toHaveLength(36);
    expect(new Set(valuesOf(series))).toEqual(new Set([6400]));
  });

  test("still cut off at the widest interval tried: the interval the limit cut through is dropped, never charted partial", async () => {
    const backlog: MessageQueueMetricDescriptor = descriptorOf(
      "pulsar",
      "pulsar_msg_backlog",
    );
    for (let minute: number = 0; minute < 60; minute++) {
      for (let partition: number = 0; partition < 64; partition++) {
        store(T0 + minute * MINUTE, 100, {
          cluster: "standalone",
          topic: `persistent://public/default/orders-partition-${partition}`,
          partition: String(partition),
        });
      }
    }
    // Two whole fifteen-minute intervals and part of a third fit.
    serverRowLimit = 150;

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: backlog,
      start: T0,
      end: T0 + 60 * MINUTE,
    });

    expect(requests).toHaveLength(1 + MESSAGE_QUEUE_SERIES_READ_MAX_WIDENINGS);
    expect(
      requests.map((request: AggregateRequest): unknown => {
        return request.aggregateBy.aggregationInterval;
      }),
    ).toEqual([
      undefined,
      AggregationInterval.FiveMinutes,
      AggregationInterval.FifteenMinutes,
    ]);
    // The newest two intervals, whole; the one the limit cut through is gone.
    expect(minutesOf(series)).toEqual([30, 45]);
    expect(valuesOf(series)).toEqual([6400, 6400]);
  });

  test("a read that fits is read once, at the window's own interval", async () => {
    const produced: MessageQueueMetricDescriptor = descriptorOf(
      "kafka",
      "kafka.partition.current_offset",
    );
    for (let minute: number = 0; minute < 60; minute++) {
      for (let partition: number = 0; partition < 3; partition++) {
        store(T0 + minute * MINUTE, minute * 60, {
          topic: "orders",
          partition: String(partition),
        });
      }
    }

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: produced,
      start: T0,
      end: T0 + 60 * MINUTE,
    });

    expect(requests).toHaveLength(1);
    expect(series).toHaveLength(59);
    expect(series[0]!.y).toBeCloseTo(3, 6);
  });

  test("the interval a cut-off read widens to: the finest coarser one its series fit", () => {
    const hour: { start: Date; end: Date } = {
      start: new Date(T0),
      end: new Date(T0 + 60 * MINUTE),
    };
    // 192 series (3 groups × 64 partitions): 61 minutes do not fit, 13 do.
    expect(
      getMessageQueueSeriesReadInterval({
        ...hour,
        seriesCount: 192,
        after: AggregationInterval.Minute,
      }),
    ).toBe(AggregationInterval.FiveMinutes);
    // Coarser than the interval that was cut off, even when it would fit.
    expect(
      getMessageQueueSeriesReadInterval({
        ...hour,
        seriesCount: 1,
        after: AggregationInterval.FiveMinutes,
      }),
    ).toBe(AggregationInterval.FifteenMinutes);
    /*
     * A page exactly full reads as cut off: under the limit, not at it
     * (100 series × 13 five-minute intervals is exactly 1,300).
     */
    expect(
      getMessageQueueSeriesReadInterval({
        ...hour,
        seriesCount: 100,
        after: AggregationInterval.Minute,
        limit: 1300,
      }),
    ).toBe(AggregationInterval.FifteenMinutes);
    expect(
      getMessageQueueSeriesReadInterval({
        ...hour,
        seriesCount: 100,
        after: AggregationInterval.Minute,
        limit: 1301,
      }),
    ).toBe(AggregationInterval.FiveMinutes);
    expect(
      getMessageQueueSeriesReadInterval({
        ...hour,
        seriesCount: 1_000_000,
        after: AggregationInterval.Minute,
      }),
    ).toBeNull();
    expect(
      getMessageQueueSeriesReadInterval({
        ...hour,
        seriesCount: 5,
        after: AggregationInterval.Year,
      }),
    ).toBeNull();
  });
});

describe("a per-period count keeps its whole intervals only", () => {
  // 10:04, the window a day long: fifteen-minute intervals.
  const NOW: number = Date.UTC(2026, 8, 30, 10, 4, 0);
  const DAY_START: number = NOW - 24 * 60 * MINUTE;

  test("Service Bus incoming messages over a day: the interval still filling is not the tile", async () => {
    const incoming: MessageQueueMetricDescriptor = descriptorOf(
      "servicebus",
      "azure_incomingmessages_total",
    );
    // 600 a minute, up to 10:01: Azure's newest minutes are still on the way.
    for (
      let time: number = DAY_START;
      time <= Date.UTC(2026, 8, 30, 10, 1, 0);
      time += MINUTE
    ) {
      store(time, 600, {});
    }

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: incoming,
      start: DAY_START,
      end: NOW,
      now: NOW,
    });

    // The first interval began before the window, the newest is still open.
    expect(series[0]!.x.getTime()).toBe(DAY_START - 4 * MINUTE + 15 * MINUTE);
    expect(series[series.length - 1]!.x.getTime()).toBe(
      Date.UTC(2026, 8, 30, 9, 45, 0),
    );
    expect(new Set(valuesOf(series))).toEqual(new Set([9000]));
    expect(toMessageQueueBrokerMetricResult(incoming, series).value).toBe(9000);
  });

  test("CloudWatch's late counts: a wide interval is whole thirty minutes after it closed", async () => {
    const sent: MessageQueueMetricDescriptor = descriptorOf(
      "aws_sqs",
      "amazonaws.com/aws/sqs/numberofmessagessent",
    );
    expect(getMessageQueueSettleMinutes(sent, DAY_START, NOW)).toBe(30);
    // CloudWatch's points up to 09:50: the rest have not been fetched yet.
    for (
      let time: number = DAY_START;
      time <= Date.UTC(2026, 8, 30, 9, 50, 0);
      time += MINUTE
    ) {
      store(time, 10, { "Dimensions.QueueName": "orders" });
    }

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: sent,
      start: DAY_START,
      end: NOW,
      now: NOW,
    });

    // 09:15–09:30 closed 34 minutes ago; 09:30–09:45 only 19.
    expect(series[series.length - 1]!.x.getTime()).toBe(
      Date.UTC(2026, 8, 30, 9, 15, 0),
    );
    expect(new Set(valuesOf(series))).toEqual(new Set([150]));
  });

  test("the same count from a Metric Stream arrives live: only the interval still open waits", async () => {
    const sent: MessageQueueMetricDescriptor = descriptorOf(
      "aws_sqs",
      "numberofmessagessent",
    );
    expect(getMessageQueueSettleMinutes(sent, DAY_START, NOW)).toBe(0);
    for (
      let time: number = DAY_START;
      time <= Date.UTC(2026, 8, 30, 10, 2, 0);
      time += MINUTE
    ) {
      store(time, 10, { QueueName: "orders", "resource.service.name": "SQS" });
    }

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: sent,
      start: DAY_START,
      end: NOW,
      now: NOW,
    });

    expect(series[series.length - 1]!.x.getTime()).toBe(
      Date.UTC(2026, 8, 30, 9, 45, 0),
    );
    expect(new Set(valuesOf(series))).toEqual(new Set([150]));
  });

  test("an hour in one-minute intervals: a minute's point is whole once it is there, late source or not", async () => {
    const sent: MessageQueueMetricDescriptor = descriptorOf(
      "aws_sqs",
      "amazonaws.com/aws/sqs/numberofmessagessent",
    );
    const hourStart: number = NOW - 60 * MINUTE;
    expect(getMessageQueueSettleMinutes(sent, hourStart, NOW)).toBe(0);
    for (
      let time: number = hourStart;
      time <= Date.UTC(2026, 8, 30, 9, 50, 0);
      time += MINUTE
    ) {
      store(time, 10, { "Dimensions.QueueName": "orders" });
    }

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: sent,
      start: hourStart,
      end: NOW,
      now: NOW,
    });

    expect(series[series.length - 1]!.x.getTime()).toBe(
      Date.UTC(2026, 8, 30, 9, 50, 0),
    );
    expect(toMessageQueueBrokerMetricResult(sent, series).value).toBe(10);
  });

  test("a level is never trimmed: its newest value is the tile", async () => {
    const active: MessageQueueMetricDescriptor = descriptorOf(
      "servicebus",
      "azure_activemessages_average",
    );
    store(Date.UTC(2026, 8, 30, 9, 50, 0), 40, {});
    store(Date.UTC(2026, 8, 30, 10, 3, 0), 42, {});

    const series: Array<MessageQueueTimePoint> = await read({
      descriptor: active,
      start: DAY_START,
      end: NOW,
      now: NOW,
    });

    expect(valuesOf(series)).toEqual([40, 42]);
  });

  test("getCompleteMessageQueueCountSeries keeps a series whose every interval is partial", () => {
    const sent: MessageQueueMetricDescriptor = descriptorOf(
      "aws_sqs",
      "amazonaws.com/aws/sqs/numberofmessagessent",
    );
    const partial: Array<MessageQueueTimePoint> = [
      { x: new Date(Date.UTC(2026, 8, 30, 9, 45, 0)), y: 3 },
    ];
    expect(
      getCompleteMessageQueueCountSeries(
        partial,
        sent,
        { start: new Date(DAY_START), end: new Date(NOW) },
        NOW,
      ),
    ).toEqual(partial);
  });
});

// The settle time of a count over a window, in whole minutes.
function getMessageQueueSettleMinutes(
  descriptor: MessageQueueMetricDescriptor,
  start: number,
  end: number,
): number {
  return Math.round(
    getMessageQueueCountSettleMs(descriptor, {
      start: new Date(start),
      end: new Date(end),
    }) / MINUTE,
  );
}

const GAUGES: Array<[string, MessageQueueMetricDescriptor]> =
  MESSAGE_QUEUE_METRICS.filter(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return descriptor.kind === "gauge";
    },
  ).map(
    (
      descriptor: MessageQueueMetricDescriptor,
    ): [string, MessageQueueMetricDescriptor] => {
      return [`${descriptor.system}:${descriptor.metricName}`, descriptor];
    },
  );

describe("the read plan of every catalog metric", () => {
  test.each(
    MESSAGE_QUEUE_METRICS.map(
      (
        descriptor: MessageQueueMetricDescriptor,
      ): [string, MessageQueueMetricDescriptor] => {
        return [`${descriptor.system}:${descriptor.metricName}`, descriptor];
      },
    ),
  )("%s", (_id: string, descriptor: MessageQueueMetricDescriptor) => {
    const plan: MessageQueueMetricReadPlan =
      getMessageQueueMetricReadPlan(descriptor);
    const seriesKeys: Array<string> = [...(descriptor.seriesKeys || [])];

    if (descriptor.kind === "counter") {
      expect(plan).toEqual({
        mode: "rate",
        aggregationType: AggregationType.Max,
        groupByAttributeKeys: [],
        isPerPeriodCount: false,
      });
      return;
    }

    const composes: boolean =
      (descriptor.aggregation === AggregationType.Max &&
        descriptor.seriesCombine === "max") ||
      (descriptor.aggregation === AggregationType.Sum &&
        descriptor.seriesCombine === "sum");
    expect(plan.aggregationType).toBe(descriptor.aggregation);
    expect(plan.isPerPeriodCount).toBe(
      descriptor.aggregation === AggregationType.Sum,
    );
    if (seriesKeys.length === 0 || composes) {
      expect(plan.mode).toBe("pooled");
      expect(plan.groupByAttributeKeys).toEqual([]);
    } else {
      expect(plan.mode).toBe("series");
      expect(plan.groupByAttributeKeys).toEqual(seriesKeys);
    }
  });

  test("every per-period count of the catalog is one pooled read, and so never cut off", () => {
    const counts: Array<MessageQueueMetricDescriptor> =
      MESSAGE_QUEUE_METRICS.filter(
        (descriptor: MessageQueueMetricDescriptor): boolean => {
          return getMessageQueueMetricReadPlan(descriptor).isPerPeriodCount;
        },
      );
    expect(counts.length).toBeGreaterThan(20);
    for (const descriptor of counts) {
      expect([
        descriptor.metricName,
        getMessageQueueMetricReadPlan(descriptor).mode,
      ]).toEqual([descriptor.metricName, "pooled"]);
    }
  });
});

describe("a monitor evaluates the number the page shows", () => {
  test.each(GAUGES)(
    "%s: a pooled read is the monitor's own query, unless the seed says otherwise",
    (_id: string, descriptor: MessageQueueMetricDescriptor) => {
      const plan: MessageQueueMetricReadPlan =
        getMessageQueueMetricReadPlan(descriptor);
      const seed: MessageQueueMetricMonitorSeed | null =
        getMessageQueueMetricMonitorSeed(descriptor);
      if (plan.mode !== "pooled" || !seed || seed.note !== null) {
        return;
      }
      expect(seed.aggregationType).toBe(plan.aggregationType);
      expect(seed.groupByAttributeKeys).toEqual([]);
      expect(seed.seriesTotal).toBeNull();
    },
  );

  test("the Kafka, Pulsar and RocketMQ lags read pooled, as their monitors do", () => {
    for (const [system, metricName] of [
      ["kafka", "kafka.consumer_group.lag_sum"],
      ["kafka", "kafka.consumer_group.lag"],
      ["pulsar", "pulsar_subscription_back_log"],
      ["rocketmq", "rocketmq_consumer_lag_messages"],
      ["rocketmq", "rocketmq_consumer_ready_messages"],
    ] as Array<[string, string]>) {
      const descriptor: MessageQueueMetricDescriptor = descriptorOf(
        system,
        metricName,
      );
      expect([
        metricName,
        getMessageQueueMetricReadPlan(descriptor).mode,
      ]).toEqual([metricName, "pooled"]);
      expect(getMessageQueueMetricMonitorSeed(descriptor)).toEqual(
        expect.objectContaining({
          aggregationType: AggregationType.Max,
          groupByAttributeKeys: [],
          note: null,
        }),
      );
    }
  });
});
