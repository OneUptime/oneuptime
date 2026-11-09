import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The two reads behind a queue's Broker metrics card, against a recorded
 * aggregate endpoint:
 *
 *   - when each catalog metric last ARRIVED for the queue: two counts of
 *     its datapoints by name, under the queue's key — per minute over the
 *     last MESSAGE_QUEUE_BROKER_METRIC_RECENT_HOURS, per hour over the
 *     week — with the minute winning, and no answer at all (null) when a
 *     read fails or comes back cut off, so the card never says a metric
 *     never arrived on half an answer;
 *   - the cache that keeps those arrivals across the Overview's refreshes
 *     (a week-long pair of reads per auto-refresh tick otherwise), which
 *     never keeps a failure;
 *   - what an Azure queue's NAMESPACE sent: the one read of the page that
 *     is not scoped by the queue's key, since its point is to find the
 *     series that did not reach the queue. It filters by the namespace
 *     alone and groups by the namespace, the destination and the cloud
 *     connection keys.
 */

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (request: unknown): Promise<unknown> => {
        return answerAggregate(request as AggregateRequest);
      },
    },
  };
});

import {
  MESSAGE_QUEUE_BROKER_METRIC_ARRIVALS_TTL_MS,
  MESSAGE_QUEUE_BROKER_METRIC_LOOKBACK_DAYS,
  MESSAGE_QUEUE_BROKER_METRIC_RECENT_HOURS,
  MESSAGE_QUEUE_CLOUD_CONNECTION_ATTRIBUTE_KEY,
  MessageQueueBrokerMetricArrivals,
  MessageQueueBrokerMetricArrivalsCache,
  MessageQueueNamespaceSeries,
  fetchMessageQueueBrokerMetricArrivals,
  fetchMessageQueueBrokerMetricArrivalsCached,
  fetchMessageQueueNamespaceSeries,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { CLOUD_CONNECTION_ID_ATTRIBUTE } from "../../../Types/Cloud/CloudConnectionTelemetry";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";

interface AggregateRequest {
  modelType: unknown;
  aggregateBy: {
    query: Record<string, unknown>;
    aggregationType: AggregationType;
    aggregateColumnName: string;
    aggregationInterval?: AggregationInterval | undefined;
    groupBy?: Record<string, unknown> | undefined;
    groupByAttributeKeys?: Array<string> | undefined;
    startTimestamp: Date;
    endTimestamp: Date;
  };
}

type Answer = AggregatedResult | Error;

let requests: Array<AggregateRequest> = [];
// What the endpoint answers, by the request's interval (Total: the namespace read).
let answers: Partial<Record<AggregationInterval, Answer>> = {};

function answerAggregate(request: AggregateRequest): Promise<unknown> {
  requests.push(request);
  const interval: AggregationInterval =
    request.aggregateBy.aggregationInterval || AggregationInterval.Total;
  const answer: Answer = answers[interval] || { data: [] };
  return answer instanceof Error
    ? Promise.reject(answer)
    : Promise.resolve(answer);
}

beforeEach(() => {
  requests = [];
  answers = {};
});

const PROJECT_ID: string = "6e4b0e6a-6b1f-4a3e-9d3e-0f1c2a3b4c5d";
const KEYS: Array<string> = ["servicebus|orders-ns|orders"];
const NOW: Date = new Date("2026-03-04T12:30:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

const SERVICE_BUS: ReadonlyArray<MessageQueueMetricDescriptor> =
  getMessageQueueMetricsForSystem("servicebus");
const KAFKA: ReadonlyArray<MessageQueueMetricDescriptor> =
  getMessageQueueMetricsForSystem("kafka");

function namesOf(
  metrics: ReadonlyArray<MessageQueueMetricDescriptor>,
): Array<string> {
  return [
    ...new Set(
      metrics.map((descriptor: MessageQueueMetricDescriptor): string => {
        return descriptor.metricName;
      }),
    ),
  ];
}

function row(name: string, at: string, value: number = 1): AggregatedModel {
  return { name: name, timestamp: new Date(at), value: value };
}

function readOf(interval: AggregationInterval): AggregateRequest {
  const found: AggregateRequest | undefined = requests.find(
    (request: AggregateRequest): boolean => {
      return request.aggregateBy.aggregationInterval === interval;
    },
  );
  if (!found) {
    throw new Error(`no ${interval} read`);
  }
  return found;
}

function lastArrivedOf(
  arrivals: MessageQueueBrokerMetricArrivals | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, at] of arrivals?.lastArrivedAt || new Map()) {
    out[name] = at.toISOString();
  }
  return out;
}

describe("when a queue's broker metrics last arrived", () => {
  test("the catalog's names are stored as written, so the read can ask for them as they are", () => {
    // The read lowercases what it asks for: it must never change a name.
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      expect(descriptor.metricName).toBe(descriptor.metricName.toLowerCase());
    }
    expect(SERVICE_BUS.length).toBeGreaterThan(0);
    expect(KAFKA.length).toBeGreaterThan(0);
  });

  test("an unscoped queue, a missing project or no metrics: no answer, and no read", async () => {
    for (const data of [
      { projectId: PROJECT_ID, keys: [], metrics: SERVICE_BUS },
      { projectId: null, keys: KEYS, metrics: SERVICE_BUS },
      { projectId: PROJECT_ID, keys: KEYS, metrics: [] },
    ]) {
      expect(
        await fetchMessageQueueBrokerMetricArrivals({ ...data, now: NOW }),
      ).toBeNull();
    }
    expect(requests).toHaveLength(0);
  });

  test("two counts by name under the queue's key: per minute lately, per hour over the week", async () => {
    const arrivals: MessageQueueBrokerMetricArrivals | null =
      await fetchMessageQueueBrokerMetricArrivals({
        projectId: PROJECT_ID,
        keys: KEYS,
        metrics: SERVICE_BUS,
        now: NOW,
      });
    expect(arrivals).not.toBeNull();
    expect(requests).toHaveLength(2);

    const recent: AggregateRequest = readOf(AggregationInterval.Minute);
    const week: AggregateRequest = readOf(AggregationInterval.Hour);
    expect(MESSAGE_QUEUE_BROKER_METRIC_RECENT_HOURS).toBe(3);
    expect(MESSAGE_QUEUE_BROKER_METRIC_LOOKBACK_DAYS).toBe(7);
    expect(recent.aggregateBy.startTimestamp.getTime()).toBe(
      NOW.getTime() - 3 * HOUR_MS,
    );
    expect(week.aggregateBy.startTimestamp.getTime()).toBe(
      NOW.getTime() - 7 * DAY_MS,
    );
    // The lookback's start is what a metric absent from the answer missed.
    expect(arrivals?.since.getTime()).toBe(NOW.getTime() - 7 * DAY_MS);

    for (const read of [recent, week]) {
      const by: AggregateRequest["aggregateBy"] = read.aggregateBy;
      expect(by.endTimestamp.getTime()).toBe(NOW.getTime());
      // A count of datapoints: no value is ever read.
      expect(by.aggregationType).toBe(AggregationType.Count);
      expect(by.groupBy).toEqual({ name: true });
      expect(by.groupByAttributeKeys).toBeUndefined();

      const query: Record<string, unknown> = by.query;
      expect(Object.keys(query).sort()).toEqual(
        ["entityKeys", "name", "projectId", "time"].sort(),
      );
      expect(String(query["projectId"])).toBe(PROJECT_ID);
      // Under the queue's key, never an attribute filter.
      expect(query["entityKeys"]).toBeInstanceOf(Includes);
      expect((query["entityKeys"] as Includes).values).toEqual(KEYS);
      expect(query["name"]).toBeInstanceOf(Includes);
      // Each catalog name once, as stored.
      expect((query["name"] as Includes).values).toEqual(namesOf(SERVICE_BUS));
      const time: InBetween<Date> = query["time"] as InBetween<Date>;
      expect(time).toBeInstanceOf(InBetween);
      expect(time.startValue.getTime()).toBe(by.startTimestamp.getTime());
      expect(time.endValue.getTime()).toBe(NOW.getTime());
    }
  });

  test("the minute wins over the hour, the hour tells an older arrival, and a metric with no datapoint is absent", async () => {
    answers[AggregationInterval.Minute] = {
      data: [
        row("azure_activemessages_average", "2026-03-04T12:28:00.000Z", 1),
        row("azure_activemessages_average", "2026-03-04T12:29:00.000Z", 1),
        // An empty interval (a count of nothing) is not an arrival.
        row("azure_incomingmessages_total", "2026-03-04T12:29:00.000Z", 0),
      ],
    };
    answers[AggregationInterval.Hour] = {
      data: [
        row("azure_activemessages_average", "2026-03-04T12:00:00.000Z", 42),
        row("azure_deadletteredmessages_average", "2026-03-01T08:00:00.000Z"),
        row("azure_deadletteredmessages_average", "2026-02-28T08:00:00.000Z"),
        row("azure_incomingmessages_total", "2026-03-02T10:00:00.000Z", 0),
        // A row of a name the read did not ask for is not one of the queue's.
        row("azure_somethingelse_total", "2026-03-04T11:00:00.000Z"),
      ],
    };

    const arrivals: MessageQueueBrokerMetricArrivals | null =
      await fetchMessageQueueBrokerMetricArrivals({
        projectId: PROJECT_ID,
        keys: KEYS,
        metrics: SERVICE_BUS,
        now: NOW,
      });
    expect(lastArrivedOf(arrivals)).toEqual({
      azure_activemessages_average: "2026-03-04T12:29:00.000Z",
      azure_deadletteredmessages_average: "2026-03-01T08:00:00.000Z",
    });
  });

  test("a row's name is matched without regard to case or spaces, and its time read from either column", async () => {
    answers[AggregationInterval.Hour] = {
      data: [
        {
          name: " AZURE_ActiveMessages_Average ",
          time: "2026-03-03T09:00:00.000Z",
          value: 3,
        } as unknown as AggregatedModel,
        // Unreadable rows are skipped, never a crash.
        {
          name: "azure_scheduledmessages_average",
          timestamp: "not a time",
          value: 1,
        } as unknown as AggregatedModel,
        { name: 7, timestamp: new Date(NOW), value: 1 } as AggregatedModel,
      ],
    };
    const arrivals: MessageQueueBrokerMetricArrivals | null =
      await fetchMessageQueueBrokerMetricArrivals({
        projectId: PROJECT_ID,
        keys: KEYS,
        metrics: SERVICE_BUS,
        now: NOW,
      });
    expect(lastArrivedOf(arrivals)).toEqual({
      azure_activemessages_average: "2026-03-03T09:00:00.000Z",
    });
  });

  test("an answer cut off, or a read that fails: no answer at all", async () => {
    for (const cut of [AggregationInterval.Minute, AggregationInterval.Hour]) {
      answers = {
        [cut]: {
          data: [
            row("azure_activemessages_average", "2026-03-04T12:00:00.000Z"),
          ],
          truncated: true,
        },
      };
      expect(
        await fetchMessageQueueBrokerMetricArrivals({
          projectId: PROJECT_ID,
          keys: KEYS,
          metrics: SERVICE_BUS,
          now: NOW,
        }),
      ).toBeNull();
    }

    answers = { [AggregationInterval.Hour]: new Error("504") };
    expect(
      await fetchMessageQueueBrokerMetricArrivals({
        projectId: PROJECT_ID,
        keys: KEYS,
        metrics: SERVICE_BUS,
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("the arrivals cache across the Overview's refreshes", () => {
  test("an entry is kept per project, key set and metric set", () => {
    const base: string = MessageQueueBrokerMetricArrivalsCache.keyOf({
      projectId: PROJECT_ID,
      keys: KEYS,
      metrics: SERVICE_BUS,
    });
    expect(
      MessageQueueBrokerMetricArrivalsCache.keyOf({
        projectId: PROJECT_ID,
        keys: [...KEYS],
        metrics: [...SERVICE_BUS],
      }),
    ).toBe(base);
    for (const other of [
      { projectId: "another-project", keys: KEYS, metrics: SERVICE_BUS },
      {
        projectId: PROJECT_ID,
        keys: ["servicebus|orders-ns|invoices"],
        metrics: SERVICE_BUS,
      },
      { projectId: PROJECT_ID, keys: KEYS, metrics: KAFKA },
    ]) {
      expect(MessageQueueBrokerMetricArrivalsCache.keyOf(other)).not.toBe(base);
    }
  });

  test("fresh for its time to live, then gone; a failure is never kept", () => {
    const cache: MessageQueueBrokerMetricArrivalsCache =
      new MessageQueueBrokerMetricArrivalsCache(1000);
    const arrivals: MessageQueueBrokerMetricArrivals = {
      since: new Date(NOW.getTime() - 7 * DAY_MS),
      lastArrivedAt: new Map(),
    };
    cache.set("a", arrivals, 5000);
    expect(cache.get("a", 5000)).toBe(arrivals);
    expect(cache.get("a", 5999)).toBe(arrivals);
    expect(cache.get("a", 6000)).toBeNull();
    expect(cache.get("b", 5000)).toBeNull();

    // A failed read clears what was kept, so the next refresh reads again.
    cache.set("a", arrivals, 7000);
    cache.set("a", null, 7001);
    expect(cache.get("a", 7002)).toBeNull();

    expect(MESSAGE_QUEUE_BROKER_METRIC_ARRIVALS_TTL_MS).toBe(5 * 60 * 1000);
  });

  test("a refresh within the time to live reads nothing; one after it reads again", async () => {
    const cache: MessageQueueBrokerMetricArrivalsCache =
      new MessageQueueBrokerMetricArrivalsCache();
    answers[AggregationInterval.Minute] = {
      data: [row("azure_activemessages_average", "2026-03-04T12:29:00.000Z")],
    };
    const first: MessageQueueBrokerMetricArrivals | null =
      await fetchMessageQueueBrokerMetricArrivalsCached({
        projectId: PROJECT_ID,
        keys: KEYS,
        metrics: SERVICE_BUS,
        cache: cache,
        now: NOW,
      });
    expect(requests).toHaveLength(2);
    expect(lastArrivedOf(first)).toEqual({
      azure_activemessages_average: "2026-03-04T12:29:00.000Z",
    });

    const second: MessageQueueBrokerMetricArrivals | null =
      await fetchMessageQueueBrokerMetricArrivalsCached({
        projectId: PROJECT_ID,
        keys: KEYS,
        metrics: SERVICE_BUS,
        cache: cache,
        now: new Date(
          NOW.getTime() + MESSAGE_QUEUE_BROKER_METRIC_ARRIVALS_TTL_MS - 1,
        ),
      });
    expect(second).toBe(first);
    expect(requests).toHaveLength(2);

    // Another queue is its own entry.
    await fetchMessageQueueBrokerMetricArrivalsCached({
      projectId: PROJECT_ID,
      keys: ["servicebus|orders-ns|invoices"],
      metrics: SERVICE_BUS,
      cache: cache,
      now: NOW,
    });
    expect(requests).toHaveLength(4);

    await fetchMessageQueueBrokerMetricArrivalsCached({
      projectId: PROJECT_ID,
      keys: KEYS,
      metrics: SERVICE_BUS,
      cache: cache,
      now: new Date(
        NOW.getTime() + MESSAGE_QUEUE_BROKER_METRIC_ARRIVALS_TTL_MS,
      ),
    });
    expect(requests).toHaveLength(6);
  });

  test("a failed read is read again on the next refresh", async () => {
    const cache: MessageQueueBrokerMetricArrivalsCache =
      new MessageQueueBrokerMetricArrivalsCache();
    answers[AggregationInterval.Hour] = new Error("504");
    expect(
      await fetchMessageQueueBrokerMetricArrivalsCached({
        projectId: PROJECT_ID,
        keys: KEYS,
        metrics: SERVICE_BUS,
        cache: cache,
        now: NOW,
      }),
    ).toBeNull();
    expect(requests).toHaveLength(2);

    answers = {};
    expect(
      await fetchMessageQueueBrokerMetricArrivalsCached({
        projectId: PROJECT_ID,
        keys: KEYS,
        metrics: SERVICE_BUS,
        cache: cache,
        now: new Date(NOW.getTime() + 1000),
      }),
    ).not.toBeNull();
    expect(requests).toHaveLength(4);
  });
});

describe("what an Azure queue's namespace sent", () => {
  const START: Date = new Date(NOW.getTime() - HOUR_MS);

  test("no namespace, no project, or a system with no scope key: no answer, and no read", async () => {
    for (const data of [
      { projectId: PROJECT_ID, namespace: "", metrics: SERVICE_BUS },
      { projectId: PROJECT_ID, namespace: "  ", metrics: SERVICE_BUS },
      { projectId: PROJECT_ID, namespace: null, metrics: SERVICE_BUS },
      { projectId: null, namespace: "orders-ns", metrics: SERVICE_BUS },
      // Kafka's catalog names no broker scope: nothing to read it by.
      { projectId: PROJECT_ID, namespace: "orders-ns", metrics: KAFKA },
      { projectId: PROJECT_ID, namespace: "orders-ns", metrics: [] },
    ]) {
      expect(
        await fetchMessageQueueNamespaceSeries({
          ...data,
          start: START,
          end: NOW,
        }),
      ).toBeNull();
    }
    expect(requests).toHaveLength(0);
  });

  test("filtered by the namespace alone, never the queue's key; grouped by namespace, destination and cloud connection", async () => {
    await fetchMessageQueueNamespaceSeries({
      projectId: PROJECT_ID,
      start: START,
      end: NOW,
      metrics: SERVICE_BUS,
      namespace: " orders-ns ",
    });
    expect(requests).toHaveLength(1);
    const by: AggregateRequest["aggregateBy"] = requests[0]!.aggregateBy;

    expect(by.aggregationInterval).toBe(AggregationInterval.Total);
    expect(by.aggregationType).toBe(AggregationType.Count);
    expect(by.startTimestamp.getTime()).toBe(START.getTime());
    expect(by.endTimestamp.getTime()).toBe(NOW.getTime());
    expect(by.groupBy).toBeUndefined();
    expect(MESSAGE_QUEUE_CLOUD_CONNECTION_ATTRIBUTE_KEY).toBe(
      `resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`,
    );
    expect(by.groupByAttributeKeys).toEqual([
      "name",
      "metadata_entityname",
      "metadata_EntityName",
      "resource.oneuptime.cloud.connection.id",
    ]);
    // The endpoint groups by at most 10 attribute keys.
    expect(by.groupByAttributeKeys!.length).toBeLessThanOrEqual(10);

    const query: Record<string, unknown> = by.query;
    expect(Object.keys(query).sort()).toEqual(
      ["attributes", "name", "projectId", "time"].sort(),
    );
    expect(query["entityKeys"]).toBeUndefined();
    expect((query["name"] as Includes).values).toEqual(namesOf(SERVICE_BUS));
    const attributes: Record<string, unknown> = query["attributes"] as Record<
      string,
      unknown
    >;
    expect(Object.keys(attributes)).toEqual(["name"]);
    /*
     * Loosely on the server (a case-insensitive contains: an ARM name keeps
     * its casing, the queue's scope is lowercased); exactly by the caller.
     */
    expect(attributes["name"]).toBeInstanceOf(Search);
    expect((attributes["name"] as Search<string>).value).toBe("orders-ns");
  });

  test("each series says its namespace, its destination (or none) and whether a cloud connection sent it", async () => {
    answers[AggregationInterval.Total] = {
      data: [
        {
          timestamp: new Date(NOW),
          value: 60,
          attributes: {
            name: "Orders-NS",
            metadata_entityname: "invoices",
          },
        },
        {
          timestamp: new Date(NOW),
          value: 60,
          attributes: {
            name: "orders-ns",
            metadata_EntityName: "Payments",
          },
        },
        {
          timestamp: new Date(NOW),
          value: 12,
          attributes: {
            name: "orders-ns",
            "resource.oneuptime.cloud.connection.id": "a-connection",
          },
        },
        // A row without attributes reads as an empty series, not a crash.
        { timestamp: new Date(NOW), value: 1 },
      ] as Array<AggregatedModel>,
    };
    const answer: {
      series: Array<MessageQueueNamespaceSeries>;
      isComplete: boolean;
    } | null = await fetchMessageQueueNamespaceSeries({
      projectId: PROJECT_ID,
      start: START,
      end: NOW,
      metrics: SERVICE_BUS,
      namespace: "orders-ns",
    });
    expect(answer).toEqual({
      isComplete: true,
      series: [
        {
          namespace: "Orders-NS",
          entity: "invoices",
          fromCloudConnection: false,
        },
        {
          namespace: "orders-ns",
          entity: "Payments",
          fromCloudConnection: false,
        },
        { namespace: "orders-ns", entity: "", fromCloudConnection: true },
        { namespace: "", entity: "", fromCloudConnection: false },
      ],
    });
  });

  test("an answer cut off says it is incomplete; a read that fails gives no answer", async () => {
    answers[AggregationInterval.Total] = {
      data: [
        {
          timestamp: new Date(NOW),
          value: 1,
          attributes: { name: "orders-ns", metadata_entityname: "invoices" },
        },
      ],
      truncated: true,
    };
    const cut: {
      series: Array<MessageQueueNamespaceSeries>;
      isComplete: boolean;
    } | null = await fetchMessageQueueNamespaceSeries({
      projectId: PROJECT_ID,
      start: START,
      end: NOW,
      metrics: SERVICE_BUS,
      namespace: "orders-ns",
    });
    expect(cut?.isComplete).toBe(false);
    expect(cut?.series).toHaveLength(1);

    answers[AggregationInterval.Total] = new Error("504");
    expect(
      await fetchMessageQueueNamespaceSeries({
        projectId: PROJECT_ID,
        start: START,
        end: NOW,
        metrics: SERVICE_BUS,
        namespace: "orders-ns",
      }),
    ).toBeNull();
  });
});
