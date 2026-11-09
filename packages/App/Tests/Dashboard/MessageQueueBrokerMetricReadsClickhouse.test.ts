import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { CLOUD_CONNECTION_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudConnectionTelemetry";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import { MessageQueueIdentity } from "Common/Types/MessageQueue/MessageQueueIdentity";
import { FixtureAttributes } from "Common/Tests/Types/MessageQueue/MessagingTelemetryFixtures";
import MessagingEntityKeyResolver from "../../FeatureSet/Telemetry/Services/MessagingEntityKeys";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * The Broker metrics card's two reads against a real ClickHouse server
 * (#5771).
 *
 * The card (MessageQueueBrokerMetricsStatus) says when each of a queue's
 * catalog metrics last arrived, and - for a Service Bus or Event Hubs queue
 * none of whose metrics arrives - what its namespace sends instead. Both
 * reads are aggregates the dashboard sends to MetricService:
 *
 *   - fetchMessageQueueBrokerMetricArrivals counts datapoints per metric
 *     name under the queue's entity key, per minute over the last 3 hours
 *     and per hour over the last 7 days;
 *   - fetchMessageQueueNamespaceSeries counts the namespace's series over
 *     the range, matched on Azure Monitor's `name` by a case-insensitive
 *     contains (an ARM name keeps the casing it was created with), grouped
 *     by the scope, destination and cloud connection keys, and never
 *     scoped by the queue's key: the point is to find metrics that missed
 *     it.
 *
 * The unit suites (Common/Tests/App/Dashboard/MessageQueueBrokerMetric*)
 * answer those requests from in-memory stores. So this suite stores Azure
 * Monitor datapoints keyed by the REAL ingest stamper in a table built from
 * the real Metric model, runs the REAL fetchers with every request sent
 * across the wire as the dashboard sends it to the REAL MetricService, and
 * checks what the card is told: each metric's last arrival to the minute
 * or the hour, nothing of another queue, project or week, the namespace's
 * other queues, its totals from a cloud connection, a namespace whose name
 * only contains the queue's, and a namespace that sends nothing.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Dashboard/MessageQueueBrokerMetricReadsClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// The dashboard's API client, answered by the real MetricService.
let mockAnswer: ((request: unknown) => Promise<unknown>) | null = null;
const mockRequests: Array<unknown> = [];

jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (request: unknown): Promise<unknown> => {
        if (!mockAnswer) {
          throw new Error("No backend picked for the aggregate request");
        }
        mockRequests.push(request);
        return mockAnswer(request);
      },
    },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import {
  MESSAGE_QUEUE_BROKER_METRIC_LOOKBACK_DAYS,
  MESSAGE_QUEUE_BROKER_METRIC_RECENT_HOURS,
  MESSAGE_QUEUE_CLOUD_CONNECTION_ATTRIBUTE_KEY,
  MessageQueueBrokerMetricArrivals,
  MessageQueueNamespaceSeries,
  fetchMessageQueueBrokerMetricArrivals,
  fetchMessageQueueNamespaceSeries,
} from "../../FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import {
  getMessageQueueScopeIdentity,
  getMessageQueueScopeKeys,
} from "../../FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryScope";
import {
  MessageQueueNamespaceFinding,
  getMessageQueueNamespaceFinding,
} from "../../FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueBrokerMetricsStatus";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `message_queue_broker_metrics_test_${process.pid}_${Date.now()}`;

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;
const DAY_MS: number = 24 * HOUR_MS;

// The lookback's end, on a minute, so every expected interval is exact.
const NOW: Date = new Date(Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

const SERVICE_BUS_TYPE: string = "Microsoft.ServiceBus/Namespaces";
const CLOUD_CONNECTION_ID: string = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

// One project per scenario, so that no scenario reads another's rows.
const ARRIVALS_PROJECT: string = ObjectID.generate().toString();
const OTHER_PROJECT: string = ObjectID.generate().toString();
const OTHERS_ONLY_PROJECT: string = ObjectID.generate().toString();
const TOTALS_ONLY_PROJECT: string = ObjectID.generate().toString();
const NOTHING_PROJECT: string = ObjectID.generate().toString();

const SERVICE_BUS_CATALOG: ReadonlyArray<MessageQueueMetricDescriptor> =
  getMessageQueueMetricsForSystem("servicebus");

// What the azure_monitor receiver puts on a Service Bus datapoint.
function serviceBus(
  namespace: string,
  entity: string | null,
): FixtureAttributes {
  const attributes: FixtureAttributes = {
    "resource.azuremonitor.subscription_id":
      "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
    "azuremonitor.resource_id": `/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/rg-queues/providers/Microsoft.ServiceBus/namespaces/${namespace}`,
    name: namespace,
    type: SERVICE_BUS_TYPE,
    resource_group: "rg-queues",
    location: "westeurope",
  };
  if (entity !== null) {
    attributes["metadata_EntityName"] = entity;
  }
  return attributes;
}

/*
 * What a cloud connection (Cloud > Connect) delivers: the namespace's total,
 * its connection id a resource attribute, which ingest stores under
 * `resource.`.
 */
function cloudConnectionTotal(namespace: string): FixtureAttributes {
  return {
    ...serviceBus(namespace, null),
    "resource.service.name": "oneuptime-cloud-azure",
    [`resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`]: CLOUD_CONNECTION_ID,
  };
}

interface Datapoint {
  projectId: string;
  name: string;
  timeMs: number;
  attributes: FixtureAttributes;
}

const DATAPOINTS: Array<Datapoint> = [];

function add(
  projectId: string,
  name: string,
  agoMs: number,
  attributes: FixtureAttributes,
): void {
  DATAPOINTS.push({
    projectId: projectId,
    name: name,
    timeMs: NOW.getTime() - agoMs,
    attributes: attributes,
  });
}

function floorTo(timeMs: number, intervalMs: number): Date {
  return new Date(Math.floor(timeMs / intervalMs) * intervalMs);
}

/*
 * ---- the arrivals of servicebus|orders-ns|orders --------------------------
 */
const ORDERS: FixtureAttributes = serviceBus("orders-ns", "orders");

// Arrived 10 minutes ago, and an hour before: known to the minute.
add(
  ARRIVALS_PROJECT,
  "azure_activemessages_average",
  10 * MINUTE_MS - 5000,
  ORDERS,
);
add(ARRIVALS_PROJECT, "azure_activemessages_average", 70 * MINUTE_MS, ORDERS);
// Two days ago only: known to the hour.
const DEAD_LETTERED_AGO_MS: number = 2 * DAY_MS + 25 * MINUTE_MS;
add(
  ARRIVALS_PROJECT,
  "azure_deadletteredmessages_average",
  DEAD_LETTERED_AGO_MS,
  ORDERS,
);
// Three days ago and half an hour ago: the recent minute wins.
add(ARRIVALS_PROJECT, "azure_scheduledmessages_average", 3 * DAY_MS, ORDERS);
add(
  ARRIVALS_PROJECT,
  "azure_scheduledmessages_average",
  30 * MINUTE_MS - 20000,
  ORDERS,
);
// Just past the recent stretch: known to the hour.
const COMPLETED_AGO_MS: number =
  MESSAGE_QUEUE_BROKER_METRIC_RECENT_HOURS * HOUR_MS + 50 * MINUTE_MS;
add(ARRIVALS_PROJECT, "azure_completemessage_total", COMPLETED_AGO_MS, ORDERS);
// Older than the lookback: not arrived since.
add(
  ARRIVALS_PROJECT,
  "azure_size_average",
  (MESSAGE_QUEUE_BROKER_METRIC_LOOKBACK_DAYS + 1) * DAY_MS,
  ORDERS,
);
// Another queue of the same namespace: its own key, never this queue's.
add(
  ARRIVALS_PROJECT,
  "azure_incomingmessages_total",
  5 * MINUTE_MS,
  serviceBus("orders-ns", "invoices"),
);
// The same queue's name in another project.
add(OTHER_PROJECT, "azure_outgoingmessages_total", 5 * MINUTE_MS, ORDERS);

/*
 * ---- what namespace orders-ns sends instead, an hour's range --------------
 */
const RANGE_START: Date = new Date(NOW.getTime() - HOUR_MS);

// Two other queues, one under the namespace's ARM casing.
add(
  OTHERS_ONLY_PROJECT,
  "azure_activemessages_average",
  20 * MINUTE_MS,
  serviceBus("Orders-NS", "invoices"),
);
add(
  OTHERS_ONLY_PROJECT,
  "azure_activemessages_average",
  19 * MINUTE_MS,
  serviceBus("Orders-NS", "invoices"),
);
add(
  OTHERS_ONLY_PROJECT,
  "azure_incomingmessages_total",
  15 * MINUTE_MS,
  serviceBus("orders-ns", "payments"),
);
// A namespace whose name only contains this one's: the server matches it.
add(
  OTHERS_ONLY_PROJECT,
  "azure_activemessages_average",
  12 * MINUTE_MS,
  serviceBus("orders-ns-archive", "orders"),
);
// Another namespace, a metric the catalog does not chart, and a late hour.
add(
  OTHERS_ONLY_PROJECT,
  "azure_activemessages_average",
  12 * MINUTE_MS,
  serviceBus("billing-ns", "orders"),
);
add(
  OTHERS_ONLY_PROJECT,
  "azure_namespacecpuusage_maximum",
  12 * MINUTE_MS,
  serviceBus("orders-ns", null),
);
add(
  OTHERS_ONLY_PROJECT,
  "azure_activemessages_average",
  2 * HOUR_MS,
  serviceBus("orders-ns", "refunds"),
);

// Namespace shipping-ns sends its totals only: a connection's, Azure's own.
add(
  TOTALS_ONLY_PROJECT,
  "azure_activemessages_average",
  10 * MINUTE_MS,
  cloudConnectionTotal("shipping-ns"),
);
add(
  TOTALS_ONLY_PROJECT,
  "azure_incomingmessages_total",
  9 * MINUTE_MS,
  serviceBus("shipping-ns", "-NamespaceOnlyMetric-"),
);

// Namespace quiet-ns sends nothing; another project's quiet-ns does.
add(
  OTHER_PROJECT,
  "azure_activemessages_average",
  10 * MINUTE_MS,
  serviceBus("quiet-ns", "orders"),
);

interface StoredDatapoint extends Datapoint {
  entityKeys: Array<string>;
}

// The real stamper, as ingest runs it on the final row.
function stamped(datapoint: Datapoint): StoredDatapoint {
  const row: JSONObject = {
    name: datapoint.name,
    attributes: datapoint.attributes as JSONObject,
    entityKeys: [],
  };
  new MessagingEntityKeyResolver(datapoint.projectId).appendToMetricRow(row);
  return {
    ...datapoint,
    entityKeys: [...((row["entityKeys"] as Array<string>) || [])],
  };
}

function insertRows(datapoints: Array<StoredDatapoint>): Array<JSONObject> {
  return datapoints.map((datapoint: StoredDatapoint): JSONObject => {
    const time: Date = new Date(datapoint.timeMs);
    return {
      projectId: datapoint.projectId,
      primaryEntityId: ObjectID.generate().toString(),
      primaryEntityType: "OpenTelemetry",
      name: datapoint.name,
      metricPointType: "Gauge",
      time: OneUptimeDate.toClickhouseDateTime64(time),
      timeUnixNano: String(time.getTime() * 1000000),
      value: 1,
      attributes: datapoint.attributes as JSONObject,
      attributeKeys: Object.keys(datapoint.attributes),
      entityKeys: datapoint.entityKeys,
      retentionDate: retentionDate,
    };
  });
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new Metric();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Metric as unknown as { new (): AnalyticsBaseModel },
      database: clickhouse,
    });

  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = ${model.tableEngine} PARTITION BY (${model.partitionKey}) PRIMARY KEY (${model.primaryKeys.join(", ")}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

// A request as the wire carries it: serialized, sent, deserialized.
function overTheWire<T>(value: T): T {
  return JSONFunctions.deserialize(
    JSON.parse(
      JSON.stringify(JSONFunctions.serialize(value as unknown as JSONObject)),
    ) as JSONObject,
  ) as unknown as T;
}

async function answerFromClickhouse(request: unknown): Promise<unknown> {
  const sent: { aggregateBy: JSONObject } = request as {
    aggregateBy: JSONObject;
  };
  const aggregateBy: JSONObject = overTheWire(sent.aggregateBy);
  const result: AggregatedResult = await MetricService.aggregateBy({
    ...(aggregateBy as unknown as Parameters<
      typeof MetricService.aggregateBy
    >[0]),
    props: { isRoot: true },
  });
  return overTheWire({ ...result } as unknown as JSONObject);
}

interface Queue {
  projectId: string;
  queueIdentifier: string;
}

// The queue's key and namespace, as the Overview derives them.
function scopeOf(queue: Queue): {
  keys: Array<string>;
  identity: MessageQueueIdentity;
} {
  const keys: Array<string> = getMessageQueueScopeKeys(queue);
  const identity: MessageQueueIdentity | null =
    getMessageQueueScopeIdentity(queue);
  expect(keys).toHaveLength(1);
  expect(identity).not.toBeNull();
  return { keys: keys, identity: identity! };
}

function sortedSeries(
  series: Array<MessageQueueNamespaceSeries>,
): Array<MessageQueueNamespaceSeries> {
  return [...series].sort(
    (
      a: MessageQueueNamespaceSeries,
      b: MessageQueueNamespaceSeries,
    ): number => {
      return JSON.stringify(a).localeCompare(JSON.stringify(b));
    },
  );
}

async function namespaceReadOf(queue: Queue): Promise<{
  series: Array<MessageQueueNamespaceSeries>;
  isComplete: boolean;
  finding: MessageQueueNamespaceFinding | null;
}> {
  const { identity } = scopeOf(queue);
  const sent: {
    series: Array<MessageQueueNamespaceSeries>;
    isComplete: boolean;
  } | null = await fetchMessageQueueNamespaceSeries({
    projectId: queue.projectId,
    start: RANGE_START,
    end: NOW,
    metrics: SERVICE_BUS_CATALOG,
    namespace: identity.brokerScope,
  });
  expect(sent).not.toBeNull();
  return {
    series: sortedSeries(sent!.series),
    isComplete: sent!.isComplete,
    finding: getMessageQueueNamespaceFinding({
      namespace: identity.brokerScope,
      destination: identity.destination,
      series: sent!.series,
      isComplete: sent!.isComplete,
    }),
  };
}

integration("The Broker metrics card's reads against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original:
    | {
        database: ClickhouseDatabase;
        databaseClient: ClickhouseClient | null;
        ingestDatabase: ClickhouseDatabase;
        ingestDatabaseClient: ClickhouseClient | null;
      }
    | undefined;
  let stored: Array<StoredDatapoint> = [];

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
      );
    }

    // Connecting creates the database.
    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: database,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse);

    original = {
      database: MetricService.database,
      databaseClient: MetricService.databaseClient,
      ingestDatabase: MetricService.ingestDatabase,
      ingestDatabaseClient: MetricService.ingestDatabaseClient,
    };
    MetricService.database = clickhouse;
    MetricService.databaseClient = client;
    MetricService.ingestDatabase = clickhouse;
    MetricService.ingestDatabaseClient = client;

    stored = DATAPOINTS.map(stamped);

    await client.insert({
      table: `${database}.${new Metric().tableName}`,
      values: insertRows(stored),
      format: "JSONEachRow",
    });

    mockAnswer = answerFromClickhouse;
  });

  afterAll(async (): Promise<void> => {
    mockAnswer = null;
    if (original) {
      Object.assign(MetricService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("ingest keys every datapoint the way the Overview scopes its queue", () => {
    const orders: { keys: Array<string> } = scopeOf({
      projectId: ARRIVALS_PROJECT,
      queueIdentifier: "servicebus|orders-ns|orders",
    });
    const invoices: { keys: Array<string> } = scopeOf({
      projectId: ARRIVALS_PROJECT,
      queueIdentifier: "servicebus|orders-ns|invoices",
    });

    const keysOf: (projectId: string, entity: string) => Array<string> = (
      projectId: string,
      entity: string,
    ): Array<string> => {
      return Array.from(
        new Set(
          stored
            .filter((datapoint: StoredDatapoint): boolean => {
              return (
                datapoint.projectId === projectId &&
                datapoint.attributes["metadata_EntityName"] === entity &&
                datapoint.attributes["name"] === "orders-ns"
              );
            })
            .flatMap((datapoint: StoredDatapoint): Array<string> => {
              return datapoint.entityKeys;
            }),
        ),
      );
    };

    expect(keysOf(ARRIVALS_PROJECT, "orders")).toEqual(orders.keys);
    expect(keysOf(ARRIVALS_PROJECT, "invoices")).toEqual(invoices.keys);
    expect(orders.keys).not.toEqual(invoices.keys);
  });

  test("each catalog metric's last arrival for the queue: to the minute lately, to the hour before, none past the week", async () => {
    const { keys } = scopeOf({
      projectId: ARRIVALS_PROJECT,
      queueIdentifier: "servicebus|orders-ns|orders",
    });

    const arrivals: MessageQueueBrokerMetricArrivals | null =
      await fetchMessageQueueBrokerMetricArrivals({
        projectId: ARRIVALS_PROJECT,
        keys: keys,
        metrics: SERVICE_BUS_CATALOG,
        now: NOW,
      });

    expect(arrivals).not.toBeNull();
    expect(arrivals!.since).toEqual(
      new Date(
        NOW.getTime() - MESSAGE_QUEUE_BROKER_METRIC_LOOKBACK_DAYS * DAY_MS,
      ),
    );

    const lastArrivedAt: Record<string, string> = {};
    for (const [name, at] of arrivals!.lastArrivedAt) {
      lastArrivedAt[name] = at.toISOString();
    }

    expect(lastArrivedAt).toEqual({
      azure_activemessages_average: new Date(
        NOW.getTime() - 10 * MINUTE_MS,
      ).toISOString(),
      azure_deadletteredmessages_average: floorTo(
        NOW.getTime() - DEAD_LETTERED_AGO_MS,
        HOUR_MS,
      ).toISOString(),
      azure_scheduledmessages_average: new Date(
        NOW.getTime() - 30 * MINUTE_MS,
      ).toISOString(),
      azure_completemessage_total: floorTo(
        NOW.getTime() - COMPLETED_AGO_MS,
        HOUR_MS,
      ).toISOString(),
    });
  });

  test("another queue of the namespace reads its own arrivals, and the scoping is not vacuous", async () => {
    const { keys } = scopeOf({
      projectId: ARRIVALS_PROJECT,
      queueIdentifier: "servicebus|orders-ns|invoices",
    });

    const arrivals: MessageQueueBrokerMetricArrivals | null =
      await fetchMessageQueueBrokerMetricArrivals({
        projectId: ARRIVALS_PROJECT,
        keys: keys,
        metrics: SERVICE_BUS_CATALOG,
        now: NOW,
      });

    expect(arrivals).not.toBeNull();
    expect(Array.from(arrivals!.lastArrivedAt.keys())).toEqual([
      "azure_incomingmessages_total",
    ]);
    expect(arrivals!.lastArrivedAt.get("azure_incomingmessages_total")).toEqual(
      new Date(NOW.getTime() - 5 * MINUTE_MS),
    );
  });

  test("the namespace's other queues, under its ARM casing too, and a namespace that only contains its name", async () => {
    const read: {
      series: Array<MessageQueueNamespaceSeries>;
      isComplete: boolean;
      finding: MessageQueueNamespaceFinding | null;
    } = await namespaceReadOf({
      projectId: OTHERS_ONLY_PROJECT,
      queueIdentifier: "servicebus|orders-ns|orders",
    });

    // One row per series; the late hour, billing-ns and the uncharted metric are not read.
    expect(read.isComplete).toBe(true);
    expect(read.series).toEqual(
      sortedSeries([
        {
          namespace: "Orders-NS",
          entity: "invoices",
          fromCloudConnection: false,
        },
        {
          namespace: "orders-ns",
          entity: "payments",
          fromCloudConnection: false,
        },
        {
          namespace: "orders-ns-archive",
          entity: "orders",
          fromCloudConnection: false,
        },
      ]),
    );

    // The card matches the namespace exactly: orders-ns-archive's orders is not this queue.
    expect(read.finding).toEqual({
      kind: "otherEntitiesOnly",
      namespace: "orders-ns",
      entityCount: 2,
    });
  });

  test("a queue whose own series arrive in the namespace's answer gets no finding", async () => {
    const read: {
      finding: MessageQueueNamespaceFinding | null;
    } = await namespaceReadOf({
      projectId: OTHERS_ONLY_PROJECT,
      queueIdentifier: "servicebus|orders-ns|invoices",
    });

    expect(read.finding).toBeNull();
  });

  test("a namespace that sends only its totals, from a cloud connection and as Azure's namespace-only entity", async () => {
    const read: {
      series: Array<MessageQueueNamespaceSeries>;
      isComplete: boolean;
      finding: MessageQueueNamespaceFinding | null;
    } = await namespaceReadOf({
      projectId: TOTALS_ONLY_PROJECT,
      queueIdentifier: "servicebus|shipping-ns|labels",
    });

    expect(read.isComplete).toBe(true);
    expect(read.series).toEqual(
      sortedSeries([
        { namespace: "shipping-ns", entity: "", fromCloudConnection: true },
        {
          namespace: "shipping-ns",
          entity: "-NamespaceOnlyMetric-",
          fromCloudConnection: false,
        },
      ]),
    );
    expect(read.finding).toEqual({
      kind: "namespaceTotalsOnly",
      namespace: "shipping-ns",
      fromCloudConnection: true,
    });
  });

  test("a namespace that sends nothing, while another project's namesake does", async () => {
    const read: {
      series: Array<MessageQueueNamespaceSeries>;
      isComplete: boolean;
      finding: MessageQueueNamespaceFinding | null;
    } = await namespaceReadOf({
      projectId: NOTHING_PROJECT,
      queueIdentifier: "servicebus|quiet-ns|orders",
    });

    expect(read).toEqual({
      series: [],
      isComplete: true,
      finding: { kind: "nothingFromNamespace", namespace: "quiet-ns" },
    });
  });

  test("the namespace read groups by the cloud connection's stored key, and the arrivals read never reads a value", () => {
    expect(MESSAGE_QUEUE_CLOUD_CONNECTION_ATTRIBUTE_KEY).toBe(
      `resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`,
    );
    expect(mockRequests.length).toBeGreaterThan(0);
    for (const request of mockRequests) {
      const aggregateBy: JSONObject = (request as { aggregateBy: JSONObject })
        .aggregateBy;
      expect(aggregateBy["aggregationType"]).toBe("Count");
    }
  });
});

describe("The Broker metrics card's ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
