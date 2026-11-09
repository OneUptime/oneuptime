import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  CollectorMessagingQueues,
  getMessagingNamespaceSeriesKey,
  getMessagingQueueSeriesKey,
  withoutCollectorQueues,
} from "Common/Server/Utils/CloudConnection/CloudCollectorQueues";
import {
  CloudMetricGroup,
  OtlpAttribute,
  buildMetricsPayloads,
  connectionResourceAttributes,
  stringAttribute,
} from "Common/Server/Utils/CloudConnection/CloudMetricPayload";
import { CLOUD_CONNECTION_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudConnectionTelemetry";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import MessagingEntityKeyResolver from "../../../../FeatureSet/Telemetry/Services/MessagingEntityKeys";
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
 * An Azure cloud connection's read of Service Bus and Event Hubs, split
 * per queue (#6373), beside a collector's azure_monitor receiver.
 *
 * The connection writes each queue's series the way the receiver does,
 * so the ingest files both on the same queue - which is why a queue both
 * read must be written by one of them only. The collector wins, per queue
 * and per metric: before it writes, a read asks the stored metrics which
 * queues' metrics a collector delivered in the last half hour
 * (findCollectorMessagingQueues: one grouped count of the series that
 * carry no cloud connection's id) and leaves those out.
 *
 * This suite runs that lookup through the REAL MetricService against a
 * table built from the REAL Metric model: a collector's queues in either
 * dimension spelling, a connection's own series never counted as a
 * collector's, the half hour's edge, another project, another metric, a
 * total split by nothing - the namespace's own, which keeps the read's
 * queues of that metric off the namespace's totals - and a lookup past its
 * limit, which hands the whole namespace's metric to the collector.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18393:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18393 \
 *     npx jest Tests/Workers/Jobs/Cloud/CloudCollectorQueuesClickhouse.test.ts
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

import MetricService from "Common/Server/Services/MetricService";
import {
  COLLECTOR_QUEUE_LOOKUP_LIMIT,
  findCollectorMessagingQueues,
} from "Common/Server/Utils/CloudConnection/CloudCollectorQueuesReader";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `cloud_collector_queues_test_${process.pid}_${Date.now()}`;

const MINUTE_MS: number = 60 * 1000;
const NOW: Date = new Date(Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS);
const SINCE: Date = new Date(NOW.getTime() - 30 * MINUTE_MS);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const CONNECTION_ID: string = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
const SERVICE_BUS_TYPE: string = "Microsoft.ServiceBus/namespaces";
const EVENT_HUBS_TYPE: string = "Microsoft.EventHub/namespaces";
const INCOMING: string = "azure_incomingmessages_total";
const ACTIVE: string = "azure_activemessages_average";

const PROJECT: string = ObjectID.generate().toString();
const OTHER_PROJECT: string = ObjectID.generate().toString();
const BIG_PROJECT: string = ObjectID.generate().toString();

// What the azure_monitor receiver puts on a datapoint, in either spelling.
function receiver(data: {
  namespace: string;
  type?: string;
  entity?: string;
  entityKey?: string;
}): JSONObject {
  const type: string = data.type || "Microsoft.ServiceBus/Namespaces";
  const attributes: JSONObject = {
    "resource.azuremonitor.subscription_id": SUBSCRIPTION,
    "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/${type}/${data.namespace}`,
    name: data.namespace,
    type,
    resource_group: "rg",
    location: "westeurope",
  };

  if (data.entity !== undefined) {
    attributes[data.entityKey || "metadata_entityname"] = data.entity;
  }

  return attributes;
}

// What a cloud connection delivers: its id on the resource.
function connection(data: {
  namespace: string;
  entity?: string;
  connectionId?: string;
}): JSONObject {
  return {
    ...receiver(data),
    "resource.service.name": "Production Azure",
    [`resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`]:
      data.connectionId === undefined ? CONNECTION_ID : data.connectionId,
  };
}

interface Datapoint {
  projectId: string;
  name: string;
  agoMs: number;
  attributes: JSONObject;
}

const DATAPOINTS: Array<Datapoint> = [
  // A collector's orders queue, incoming messages: the collector's.
  {
    projectId: PROJECT,
    name: INCOMING,
    agoMs: 10 * MINUTE_MS,
    attributes: receiver({ namespace: "orders-ns", entity: "orders" }),
  },
  // Its invoices queue, in the documented spelling: the collector's.
  {
    projectId: PROJECT,
    name: ACTIVE,
    agoMs: 5 * MINUTE_MS,
    attributes: receiver({
      namespace: "orders-ns",
      entity: "Invoices",
      entityKey: "metadata_EntityName",
    }),
  },
  // An event hub a collector reads.
  {
    projectId: PROJECT,
    name: INCOMING,
    agoMs: 3 * MINUTE_MS,
    attributes: receiver({
      namespace: "clicks-ns",
      type: "Microsoft.EventHub/Namespaces",
      entity: "clickstream",
    }),
  },
  // The connection's own series of another queue: never a collector's.
  {
    projectId: PROJECT,
    name: INCOMING,
    agoMs: 5 * MINUTE_MS,
    attributes: connection({ namespace: "orders-ns", entity: "payments" }),
  },
  // A connection id stored empty is no connection's.
  {
    projectId: PROJECT,
    name: INCOMING,
    agoMs: 6 * MINUTE_MS,
    attributes: connection({
      namespace: "orders-ns",
      entity: "shipping",
      connectionId: "",
    }),
  },
  // Older than the half hour: the collector stopped.
  {
    projectId: PROJECT,
    name: INCOMING,
    agoMs: 40 * MINUTE_MS,
    attributes: receiver({ namespace: "orders-ns", entity: "refunds" }),
  },
  // A metric the read did not split.
  {
    projectId: PROJECT,
    name: "azure_size_average",
    agoMs: 5 * MINUTE_MS,
    attributes: receiver({ namespace: "orders-ns", entity: "orders" }),
  },
  // A total split by nothing: the namespace's own, no queue's.
  {
    projectId: PROJECT,
    name: INCOMING,
    agoMs: 5 * MINUTE_MS,
    attributes: receiver({ namespace: "orders-ns" }),
  },
  // Another namespace's total, by a connection: never a collector's.
  {
    projectId: PROJECT,
    name: ACTIVE,
    agoMs: 5 * MINUTE_MS,
    attributes: connection({ namespace: "clicks-ns" }),
  },
  // Another project's collector.
  {
    projectId: OTHER_PROJECT,
    name: INCOMING,
    agoMs: 5 * MINUTE_MS,
    attributes: receiver({ namespace: "orders-ns", entity: "audit" }),
  },
];

// A namespace with more queues than one lookup lists.
for (let index: number = 0; index < COLLECTOR_QUEUE_LOOKUP_LIMIT; index++) {
  DATAPOINTS.push({
    projectId: BIG_PROJECT,
    name: INCOMING,
    agoMs: 2 * MINUTE_MS,
    attributes: receiver({ namespace: "big-ns", entity: `queue-${index}` }),
  });
}

function insertRows(datapoints: Array<Datapoint>): Array<JSONObject> {
  return datapoints.map((datapoint: Datapoint): JSONObject => {
    const time: Date = new Date(NOW.getTime() - datapoint.agoMs);
    return {
      projectId: datapoint.projectId,
      primaryEntityId: ObjectID.generate().toString(),
      primaryEntityType: "OpenTelemetry",
      name: datapoint.name,
      metricPointType: "Gauge",
      time: OneUptimeDate.toClickhouseDateTime64(time),
      timeUnixNano: String(time.getTime() * 1000000),
      value: 1,
      attributes: datapoint.attributes,
      attributeKeys: Object.keys(datapoint.attributes),
      entityKeys: [],
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

function queueKey(
  metricName: string,
  type: string,
  namespace: string,
  entity: string,
): string {
  return getMessagingQueueSeriesKey({ metricName, type, namespace, entity });
}

// A connection's read of namespace orders-ns, split per queue.
function readPayload(): JSONObject {
  const set: (
    entity: string,
  ) => CloudMetricGroup["metrics"][number]["datapointSets"][number] = (
    entity: string,
  ): CloudMetricGroup["metrics"][number]["datapointSets"][number] => {
    const attributes: Array<OtlpAttribute> = [
      stringAttribute(
        "azuremonitor.resource_id",
        `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg/providers/${SERVICE_BUS_TYPE}/orders-ns`,
      ),
      stringAttribute("name", "orders-ns"),
      stringAttribute("type", SERVICE_BUS_TYPE),
      stringAttribute("resource_group", "rg"),
      stringAttribute("location", "westeurope"),
      stringAttribute("timegrain", "PT1M"),
      stringAttribute("metadata_entityname", entity),
    ];

    return {
      attributes,
      points: [{ timeMs: NOW.getTime() - 4 * MINUTE_MS, value: 2 }],
    };
  };

  return buildMetricsPayloads([
    {
      resourceAttributes: [
        ...connectionResourceAttributes({
          serviceName: "Production Azure",
          connectionId: CONNECTION_ID,
          cloudProvider: CloudProvider.Azure,
        }),
        stringAttribute("azuremonitor.subscription_id", SUBSCRIPTION),
      ],
      metrics: [
        {
          name: INCOMING,
          unit: "Count",
          datapointSets: [set("orders"), set("invoices"), set("payments")],
        },
        {
          name: ACTIVE,
          unit: "Count",
          datapointSets: [set("orders"), set("invoices"), set("payments")],
        },
      ],
    },
  ])[0]!;
}

function writtenSeries(payload: JSONObject | null): Array<string> {
  const found: Array<string> = [];

  for (const rm of ((payload || {})["resourceMetrics"] as Array<JSONObject>) ||
    []) {
    for (const sm of rm["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of sm["metrics"] as Array<JSONObject>) {
        for (const point of (metric["gauge"] as JSONObject)[
          "dataPoints"
        ] as Array<JSONObject>) {
          const entity: JSONObject | undefined = (
            point["attributes"] as Array<JSONObject>
          ).find((attribute: JSONObject): boolean => {
            return attribute["key"] === "metadata_entityname";
          });

          found.push(
            `${metric["name"] as string}|${
              (entity?.["value"] as JSONObject)["stringValue"] as string
            }`,
          );
        }
      }
    }
  }

  return found;
}

// Each written series as metric|queue|the namespace whose totals it adds to, or none.
function onNamespace(payload: JSONObject | null): Array<string> {
  const found: Array<string> = [];

  for (const rm of ((payload || {})["resourceMetrics"] as Array<JSONObject>) ||
    []) {
    for (const sm of rm["scopeMetrics"] as Array<JSONObject>) {
      for (const metric of sm["metrics"] as Array<JSONObject>) {
        for (const point of (metric["gauge"] as JSONObject)[
          "dataPoints"
        ] as Array<JSONObject>) {
          const valueOf: (key: string) => string | undefined = (
            key: string,
          ): string | undefined => {
            const attribute: JSONObject | undefined = (
              point["attributes"] as Array<JSONObject>
            ).find((candidate: JSONObject): boolean => {
              return candidate["key"] === key;
            });

            return attribute
              ? ((attribute["value"] as JSONObject)["stringValue"] as string)
              : undefined;
          };
          const resourceId: string | undefined = valueOf(
            "azuremonitor.resource_id",
          );

          found.push(
            `${metric["name"] as string}|${valueOf("metadata_entityname")}|${
              resourceId ? resourceId.split("/").slice(-1)[0] : "none"
            }`,
          );
        }
      }
    }
  }

  return found;
}

describe("a connection's queue series and a collector's are filed on the same queue", () => {
  function keysOf(attributes: JSONObject, name: string): Array<string> {
    const row: JSONObject = { name, attributes, entityKeys: [] };
    new MessagingEntityKeyResolver(PROJECT).appendToMetricRow(row);
    return [...((row["entityKeys"] as Array<string>) || [])];
  }

  test("by the ingest's own stamper, whichever wrote it", () => {
    const fromCollector: Array<string> = keysOf(
      receiver({ namespace: "orders-ns", entity: "orders" }),
      INCOMING,
    );
    const fromConnection: Array<string> = keysOf(
      {
        ...connection({ namespace: "orders-ns", entity: "orders" }),
        // The read writes the catalog's spelling of the type.
        type: SERVICE_BUS_TYPE,
      },
      INCOMING,
    );

    expect(fromCollector).toHaveLength(1);
    expect(fromConnection).toEqual(fromCollector);
    // Another queue of the namespace is another key.
    expect(
      keysOf(
        connection({ namespace: "orders-ns", entity: "invoices" }),
        INCOMING,
      ),
    ).not.toEqual(fromCollector);
    // The namespace's own share is no queue.
    expect(
      keysOf(
        connection({ namespace: "orders-ns", entity: "-NamespaceOnlyMetric-" }),
        INCOMING,
      ),
    ).toEqual([]);
  });
});

integration("Which queues a collector reads, from ClickHouse", () => {
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

    await client.insert({
      table: `${database}.${new Metric().tableName}`,
      values: insertRows(DATAPOINTS),
      format: "JSONEachRow",
    });
  });

  afterAll(async (): Promise<void> => {
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

  test("each queue's metric a collector delivered in the half hour, and nothing a connection did", async () => {
    const found: CollectorMessagingQueues = await findCollectorMessagingQueues({
      projectId: new ObjectID(PROJECT),
      metricNames: [ACTIVE, INCOMING],
      since: SINCE,
      until: NOW,
    });

    expect(Array.from(found.series).sort()).toEqual(
      [
        queueKey(INCOMING, SERVICE_BUS_TYPE, "orders-ns", "orders"),
        queueKey(ACTIVE, SERVICE_BUS_TYPE, "orders-ns", "invoices"),
        queueKey(INCOMING, EVENT_HUBS_TYPE, "clicks-ns", "clickstream"),
        // A connection id stored empty is no connection's.
        queueKey(INCOMING, SERVICE_BUS_TYPE, "orders-ns", "shipping"),
      ].sort(),
    );
    expect(found.wholeNamespaces.size).toBe(0);
    // The total split by nothing is the namespace's own, a collector's.
    expect(Array.from(found.namespaceTotals)).toEqual([
      getMessagingNamespaceSeriesKey({
        metricName: INCOMING,
        type: SERVICE_BUS_TYPE,
        namespace: "orders-ns",
      }),
    ]);
  });

  test("one metric asked, one metric answered", async () => {
    const found: CollectorMessagingQueues = await findCollectorMessagingQueues({
      projectId: new ObjectID(PROJECT),
      metricNames: [ACTIVE],
      since: SINCE,
      until: NOW,
    });

    expect(Array.from(found.series)).toEqual([
      queueKey(ACTIVE, SERVICE_BUS_TYPE, "orders-ns", "invoices"),
    ]);
  });

  test("the read then writes every other queue, and nothing of the collector's", async () => {
    const found: CollectorMessagingQueues = await findCollectorMessagingQueues({
      projectId: new ObjectID(PROJECT),
      metricNames: [ACTIVE, INCOMING],
      since: SINCE,
      until: NOW,
    });

    const toWrite: {
      payload: JSONObject | null;
      leftOut: number;
      offNamespace: number;
    } = withoutCollectorQueues({ payload: readPayload(), collector: found });

    expect(toWrite.leftOut).toBe(2);
    expect(writtenSeries(toWrite.payload)).toEqual([
      `${INCOMING}|invoices`,
      `${INCOMING}|payments`,
      `${ACTIVE}|orders`,
      `${ACTIVE}|payments`,
    ]);
    /*
     * The collector sent orders-ns's own total of incoming messages: the
     * read's queues of it are filed on each queue, off the namespace.
     */
    expect(toWrite.offNamespace).toBe(2);
    expect(onNamespace(toWrite.payload)).toEqual([
      `${INCOMING}|invoices|none`,
      `${INCOMING}|payments|none`,
      `${ACTIVE}|orders|orders-ns`,
      `${ACTIVE}|payments|orders-ns`,
    ]);
  });

  test("a project without a collector has no collector's queue", async () => {
    const found: CollectorMessagingQueues = await findCollectorMessagingQueues({
      projectId: ObjectID.generate(),
      metricNames: [ACTIVE, INCOMING],
      since: SINCE,
      until: NOW,
    });

    expect(found.series.size).toBe(0);
    expect(found.wholeNamespaces.size).toBe(0);
    expect(found.namespaceTotals.size).toBe(0);
  });

  test("more queues than a lookup lists hand the whole namespace's metric to the collector", async () => {
    const found: CollectorMessagingQueues = await findCollectorMessagingQueues({
      projectId: new ObjectID(BIG_PROJECT),
      metricNames: [INCOMING],
      since: SINCE,
      until: NOW,
    });

    expect(Array.from(found.wholeNamespaces)).toEqual([
      getMessagingNamespaceSeriesKey({
        metricName: INCOMING,
        type: SERVICE_BUS_TYPE,
        namespace: "big-ns",
      }),
    ]);

    // Any queue of it, listed or not, is the collector's.
    const toWrite: { payload: JSONObject | null; leftOut: number } =
      withoutCollectorQueues({
        payload: buildMetricsPayloads([
          {
            resourceAttributes: [],
            metrics: [
              {
                name: INCOMING,
                unit: "Count",
                datapointSets: [
                  {
                    attributes: [
                      stringAttribute("name", "big-ns"),
                      stringAttribute("type", SERVICE_BUS_TYPE),
                      stringAttribute("metadata_entityname", "queue-new"),
                    ],
                    points: [{ timeMs: NOW.getTime(), value: 1 }],
                  },
                ],
              },
            ],
          },
        ])[0]!,
        collector: found,
      });

    expect(toWrite).toEqual({ payload: null, leftOut: 1, offNamespace: 0 });
  });
});

describe("Which queues a collector reads: ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
