import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import Dictionary from "Common/Types/Dictionary";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationIntervalUtil from "Common/Types/BaseDatabase/AggregationIntervalUtil";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ObjectID from "Common/Types/ObjectID";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { CLOUD_CONNECTION_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudConnectionTelemetry";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import TimeRange from "Common/Types/Time/TimeRange";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepMetricMonitorUtil } from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
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
 * A Service Bus namespace's Metrics tab and the monitors created from it,
 * against a real ClickHouse server (#6410).
 *
 * Since #6373 a connected Azure subscription reads a namespace's key
 * metrics once per queue (Azure Monitor's EntityName), each series
 * carrying the namespace's resource id. The tab charted the average of
 * those series per interval - the average queue - and a monitor created
 * from it read the same. Now each row whose queues add up reads with Sum:
 * a count over any range, and messages waiting while the range is read by
 * the minute (up to 3 hours); over a longer range they keep the average.
 *
 * The unit suites (Common/Tests/App/Dashboard/CloudNamespaceMetricTotals,
 * MetricsViewerRowAggregation) show what the list asks for. This shows
 * what the server answers: it stores a namespace of three queues as the
 * connection writes them in a table built from the real Metric model,
 * reads the rows through the REAL sparkline fetcher with the REAL scope
 * helpers, every request sent across the wire to the REAL MetricService,
 * and runs the REAL Metrics monitor reader on the query a monitor created
 * from the tab carries. Each interval is held to the value worked out
 * from the stored points themselves.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Dashboard/CloudNamespaceTotalsClickhouse.test.ts
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

// The worker module loads the queue and the native isolated-vm addon.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn(), getQueue: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

/*
 * The dashboard's config reads a browser's injected env first; under Node
 * there is no `window`, and it reads the process's.
 */
jest.mock("Common/UI/Config", () => {
  (globalThis as { window?: unknown }).window = undefined;
  return jest.requireActual("Common/UI/Config");
});

// The dashboard's API client, answered by the real MetricService.
let mockAnswer: ((request: unknown) => Promise<unknown>) | null = null;
const mockRequests: Array<JSONObject> = [];

jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (request: unknown): Promise<unknown> => {
        if (!mockAnswer) {
          throw new Error("No backend picked for the aggregate request");
        }
        mockRequests.push((request as { aggregateBy: JSONObject }).aggregateBy);
        return mockAnswer(request);
      },
    },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import ProjectUtil from "Common/UI/Utils/Project";
import MetricUtil from "../../FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics";
import {
  CloudMonitoredResourceRowAggregation,
  getCloudMonitoredResourceAttributeFilters,
  getCloudMonitoredResourceRowAggregation,
} from "../../FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import { monitorMetric } from "../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `cloud_namespace_totals_test_${process.pid}_${Date.now()}`;

const MINUTE_MS: number = 60 * 1000;

// The newest stored minute: a whole minute before now, so it is complete.
const NEWEST_MINUTE_MS: number =
  Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - MINUTE_MS;
// A day and an hour of minutes, so a day's range is full to its start.
const STORED_MINUTES: number = 25 * 60;

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

const PROJECT_ID: ObjectID = ObjectID.generate();
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const CLOUD_CONNECTION_ID: string = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";

function armId(type: string, name: string): string {
  return `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/${type}/${name}`;
}

const SERVICE_BUS: string = "Microsoft.ServiceBus/namespaces";
const VIRTUAL_MACHINE: string = "Microsoft.Compute/virtualMachines";

// The namespace's row in Cloud > All Resources, as the connection records it.
const SHOP: JSONObject = {
  cloudResourceKind: CloudResourceKind.Resource,
  cloudProvider: CloudProvider.Azure,
  cloudResourceType: SERVICE_BUS,
  telemetryAttributes: {
    "azuremonitor.resource_id": armId(SERVICE_BUS, "shop"),
  },
};

const WEB_01: JSONObject = {
  cloudResourceKind: CloudResourceKind.Resource,
  cloudProvider: CloudProvider.Azure,
  cloudResourceType: VIRTUAL_MACHINE,
  telemetryAttributes: {
    "azuremonitor.resource_id": armId(VIRTUAL_MACHINE, "web-01"),
  },
};

const WAITING: string = "azure_activemessages_average";
const INCOMING: string = "azure_incomingmessages_total";
const LATENCY: string = "azure_serversendlatency_average";
const CPU: string = "azure_percentage_cpu_average";

/*
 * Each of shop's queues, every minute: messages waiting, messages in, a
 * send's latency in milliseconds. The namespace holds 60 waiting and takes
 * 6 messages a minute; its average queue holds 20 and takes 2.
 */
const QUEUES: Array<{
  entity: string;
  waiting: number;
  incoming: number;
  latency: number;
}> = [
  { entity: "orders", waiting: 10, incoming: 1, latency: 5 },
  { entity: "invoices", waiting: 20, incoming: 2, latency: 10 },
  { entity: "payments", waiting: 30, incoming: 3, latency: 15 },
];

interface Point {
  name: string;
  timeMs: number;
  value: number;
  attributes: Record<string, string>;
}

const POINTS: Array<Point> = [];

/*
 * What an Azure cloud connection writes of one queue (#6373): the
 * namespace's metric split by EntityName, with the namespace's resource id
 * and the connection's id a resource attribute.
 */
function connectionQueue(
  namespace: string,
  entity: string,
): Record<string, string> {
  return {
    "azuremonitor.resource_id": armId(SERVICE_BUS, namespace),
    "resource.azuremonitor.subscription_id": SUBSCRIPTION,
    name: namespace,
    type: SERVICE_BUS,
    metadata_entityname: entity,
    "resource.service.name": "oneuptime-cloud-azure",
    [`resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`]: CLOUD_CONNECTION_ID,
  };
}

for (let minute: number = 0; minute < STORED_MINUTES; minute++) {
  // Ten seconds into each minute, as Azure stamps a grain's start.
  const timeMs: number = NEWEST_MINUTE_MS - minute * MINUTE_MS + 10000;

  for (const queue of QUEUES) {
    const attributes: Record<string, string> = connectionQueue(
      "shop",
      queue.entity,
    );
    POINTS.push({ name: WAITING, timeMs, value: queue.waiting, attributes });
    POINTS.push({ name: INCOMING, timeMs, value: queue.incoming, attributes });
    POINTS.push({ name: LATENCY, timeMs, value: queue.latency, attributes });
  }

  // Another namespace's queue: never one of shop's.
  POINTS.push({
    name: WAITING,
    timeMs,
    value: 1000,
    attributes: connectionQueue("billing", "orders"),
  });

  // A virtual machine's one series, for the past hour.
  if (minute < 60) {
    POINTS.push({
      name: CPU,
      timeMs,
      value: 42,
      attributes: {
        "azuremonitor.resource_id": armId(VIRTUAL_MACHINE, "web-01"),
        "resource.service.name": "oneuptime-cloud-azure",
      },
    });
  }
}

function insertRows(points: Array<Point>): Array<JSONObject> {
  return points.map((point: Point): JSONObject => {
    const time: Date = new Date(point.timeMs);
    return {
      projectId: PROJECT_ID.toString(),
      primaryEntityId: ObjectID.generate().toString(),
      primaryEntityType: "OpenTelemetry",
      name: point.name,
      metricPointType: "Gauge",
      time: OneUptimeDate.toClickhouseDateTime64(time),
      timeUnixNano: String(time.getTime() * 1000000),
      value: point.value,
      attributes: point.attributes as JSONObject,
      attributeKeys: Object.keys(point.attributes),
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

interface Interval {
  startMs: number;
  value: number;
}

function intervalsOf(result: AggregatedResult | undefined): Array<Interval> {
  return (result?.data || [])
    .map((row: AggregatedModel): Interval => {
      return {
        startMs: new Date(row.timestamp).getTime(),
        value: Number(row.value),
      };
    })
    .sort((a: Interval, b: Interval): number => {
      return a.startMs - b.startMs;
    });
}

// The interval's value, from the points the read's filter matches.
function expectedOf(data: {
  name: string;
  namespace: string;
  window: InBetween<Date>;
  intervalStartMs: number;
  intervalMs: number;
  aggregationType: MetricsAggregationType;
}): number {
  const values: Array<number> = POINTS.filter((point: Point): boolean => {
    return (
      point.name === data.name &&
      point.attributes["azuremonitor.resource_id"] ===
        armId(SERVICE_BUS, data.namespace) &&
      point.timeMs >= data.window.startValue.getTime() &&
      point.timeMs <= data.window.endValue.getTime() &&
      point.timeMs >= data.intervalStartMs &&
      point.timeMs < data.intervalStartMs + data.intervalMs
    );
  }).map((point: Point): number => {
    return point.value;
  });

  const sum: number = values.reduce((total: number, value: number) => {
    return total + value;
  }, 0);

  return data.aggregationType === MetricsAggregationType.Sum
    ? sum
    : sum / values.length;
}

integration("A Service Bus namespace's totals against ClickHouse", () => {
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
      values: insertRows(POINTS),
      format: "JSONEachRow",
    });

    mockAnswer = answerFromClickhouse;

    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    // The monitor converts units from the catalog: these metrics have none.
    jest
      .spyOn(MetricTypeService, "findBy")
      .mockImplementation(async (): Promise<Array<MetricType>> => {
        return [];
      });
  });

  afterAll(async (): Promise<void> => {
    mockAnswer = null;
    jest.restoreAllMocks();

    if (original) {
      MetricService.database = original.database;
      MetricService.databaseClient = original.databaseClient;
      MetricService.ingestDatabase = original.ingestDatabase;
      MetricService.ingestDatabaseClient = original.ingestDatabaseClient;
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      await client.close();
    }
  });

  /*
   * What the tab's list reads for a resource over a picker range: the real
   * sparkline fetcher, scoped by the resource's attribute filter, each row
   * read with the aggregation the scope helper names for it - the one
   * MetricsViewer passes (Avg where it names none).
   */
  async function readRows(data: {
    resource: JSONObject;
    names: Array<string>;
    range: TimeRange;
  }): Promise<{
    window: InBetween<Date>;
    aggregations: Dictionary<MetricsAggregationType>;
    results: Map<string, AggregatedResult>;
  }> {
    const window: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate({ range: data.range });
    const rows: CloudMonitoredResourceRowAggregation | undefined =
      getCloudMonitoredResourceRowAggregation(data.resource);
    const aggregations: Dictionary<MetricsAggregationType> = {};

    for (const name of data.names) {
      aggregations[name] =
        rows?.getRowAggregation(name, window)?.aggregationType ||
        MetricsAggregationType.Avg;
    }

    const results: Map<string, AggregatedResult> =
      await MetricUtil.fetchSparklineAggregates({
        metricNames: data.names,
        attributes: getCloudMonitoredResourceAttributeFilters(data.resource),
        startAndEndDate: window,
        getAggregationType: (name: string): MetricsAggregationType => {
          return aggregations[name]!;
        },
      });

    return { window, aggregations, results };
  }

  function intervalMsOf(window: InBetween<Date>): number {
    return AggregationIntervalUtil.getAggregationIntervalMs(
      AggregationIntervalUtil.getAggregationIntervalForWindow({
        startDate: window.startValue,
        endDate: window.endValue,
      }),
    );
  }

  test("over the past hour, each minute of messages waiting and messages in reads the namespace's total, not its average queue", async () => {
    const read: Awaited<ReturnType<typeof readRows>> = await readRows({
      resource: SHOP,
      names: [WAITING, INCOMING, LATENCY],
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(intervalMsOf(read.window)).toBe(MINUTE_MS);
    expect(read.aggregations).toEqual({
      [WAITING]: MetricsAggregationType.Sum,
      [INCOMING]: MetricsAggregationType.Sum,
      [LATENCY]: MetricsAggregationType.Avg,
    });

    const waiting: Array<Interval> = intervalsOf(read.results.get(WAITING));
    const incoming: Array<Interval> = intervalsOf(read.results.get(INCOMING));
    const latency: Array<Interval> = intervalsOf(read.results.get(LATENCY));

    // A minute each: the hour's, less the minutes since the points' newest.
    for (const intervals of [waiting, incoming, latency]) {
      expect(intervals.length).toBeGreaterThanOrEqual(55);
      expect(intervals.length).toBeLessThanOrEqual(60);
    }

    for (const interval of waiting) {
      // 10 + 20 + 30: the other namespace's 1000 is never in it.
      expect([interval.startMs, interval.value]).toEqual([
        interval.startMs,
        60,
      ]);
    }
    for (const interval of incoming) {
      expect([interval.startMs, interval.value]).toEqual([interval.startMs, 6]);
    }
    for (const interval of latency) {
      // A send's latency is per send: still the average.
      expect([interval.startMs, interval.value]).toEqual([
        interval.startMs,
        10,
      ]);
    }
  });

  test("the same hour read as the tab read it before, the average of series, is the average queue", async () => {
    const window: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate({
        range: TimeRange.PAST_ONE_HOUR,
      });
    const results: Map<string, AggregatedResult> =
      await MetricUtil.fetchSparklineAggregates({
        metricNames: [WAITING, INCOMING],
        attributes: getCloudMonitoredResourceAttributeFilters(SHOP),
        startAndEndDate: window,
      });

    for (const interval of intervalsOf(results.get(WAITING))) {
      expect(interval.value).toBe(20);
    }
    for (const interval of intervalsOf(results.get(INCOMING))) {
      expect(interval.value).toBe(2);
    }
  });

  /*
   * A day is read in 15-minute intervals. Messages in add up to the
   * namespace's count in each; messages waiting keep the average of series,
   * as a Sum would add up every queue's every minute - 15 times the
   * namespace's backlog.
   */
  test("over the past day, messages in read the namespace's count per interval, messages waiting the average of series", async () => {
    const read: Awaited<ReturnType<typeof readRows>> = await readRows({
      resource: SHOP,
      names: [WAITING, INCOMING],
      range: TimeRange.PAST_ONE_DAY,
    });
    const intervalMs: number = intervalMsOf(read.window);

    expect(intervalMs).toBe(15 * MINUTE_MS);
    expect(read.aggregations).toEqual({
      [WAITING]: MetricsAggregationType.Avg,
      [INCOMING]: MetricsAggregationType.Sum,
    });

    const incoming: Array<Interval> = intervalsOf(read.results.get(INCOMING));
    const waiting: Array<Interval> = intervalsOf(read.results.get(WAITING));

    expect(incoming.length).toBeGreaterThanOrEqual(96);
    expect(waiting.length).toBe(incoming.length);

    for (const interval of incoming) {
      expect([interval.startMs, interval.value]).toEqual([
        interval.startMs,
        expectedOf({
          name: INCOMING,
          namespace: "shop",
          window: read.window,
          intervalStartMs: interval.startMs,
          intervalMs: intervalMs,
          aggregationType: MetricsAggregationType.Sum,
        }),
      ]);
    }

    // A whole interval in the middle of the day: 15 minutes of 6.
    expect(incoming[incoming.length - 2]!.value).toBe(90);

    for (const interval of waiting) {
      expect([interval.startMs, interval.value]).toEqual([
        interval.startMs,
        20,
      ]);
    }

    // What a Sum would read there: no amount the namespace ever held.
    const summed: Map<string, AggregatedResult> =
      await MetricUtil.fetchSparklineAggregates({
        metricNames: [WAITING],
        attributes: getCloudMonitoredResourceAttributeFilters(SHOP),
        startAndEndDate: read.window,
        getAggregationType: (): MetricsAggregationType => {
          return MetricsAggregationType.Sum;
        },
      });
    const summedWaiting: Array<Interval> = intervalsOf(summed.get(WAITING));
    expect(summedWaiting[summedWaiting.length - 2]!.value).toBe(15 * 60);
  });

  test("a virtual machine's one series reads as it did", async () => {
    const read: Awaited<ReturnType<typeof readRows>> = await readRows({
      resource: WEB_01,
      names: [CPU],
      range: TimeRange.PAST_ONE_HOUR,
    });

    expect(read.aggregations).toEqual({ [CPU]: MetricsAggregationType.Avg });

    const cpu: Array<Interval> = intervalsOf(read.results.get(CPU));
    expect(cpu.length).toBeGreaterThanOrEqual(55);
    for (const interval of cpu) {
      expect(interval.value).toBe(42);
    }
  });

  /*
   * A monitor created from the tab carries the row's query: its metric, the
   * namespace's filter and the row's aggregation (the unit suite follows a
   * click through the explorer into Monitor Create). The worker reads it
   * per minute over its window.
   */
  async function monitorReads(data: {
    metricName: string;
    aggregationType: MetricsAggregationType;
    rollingTime: RollingTime;
  }): Promise<Array<Interval>> {
    const view: MetricsViewConfig = {
      queryConfigs: [
        {
          metricAliasData: {
            metricVariable: "a",
            title: undefined,
            description: undefined,
            legend: undefined,
            legendUnit: undefined,
          },
          metricQueryData: {
            filterData: {
              metricName: data.metricName,
              attributes: getCloudMonitoredResourceAttributeFilters(SHOP),
              aggegationType: data.aggregationType,
              aggregateBy: {},
            },
          },
        },
      ],
      formulaConfigs: [],
    };

    const step: MonitorStep = new MonitorStep().setMetricMonitor({
      ...MonitorStepMetricMonitorUtil.getDefault(),
      metricViewConfig: view,
      rollingTime: data.rollingTime,
    });

    const response: MetricMonitorResponse = await monitorMetric({
      monitorStep: step,
      monitorId: ObjectID.generate(),
      projectId: PROJECT_ID,
    });

    return intervalsOf(response.metricResult[0]);
  }

  test("a monitor created from the tab reads the namespace's total each minute of its window", async () => {
    const rows: CloudMonitoredResourceRowAggregation | undefined =
      getCloudMonitoredResourceRowAggregation(SHOP);
    const pastHour: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate({
        range: TimeRange.PAST_ONE_HOUR,
      });

    const waiting: Array<Interval> = await monitorReads({
      metricName: WAITING,
      aggregationType: rows!.getRowAggregation(WAITING, pastHour)!
        .aggregationType,
      rollingTime: RollingTime.Past15Minutes,
    });
    const incoming: Array<Interval> = await monitorReads({
      metricName: INCOMING,
      aggregationType: rows!.getRowAggregation(INCOMING, pastHour)!
        .aggregationType,
      rollingTime: RollingTime.Past15Minutes,
    });

    expect(waiting.length).toBeGreaterThanOrEqual(10);
    for (const interval of waiting) {
      expect(interval.value).toBe(60);
    }
    expect(incoming.length).toBeGreaterThanOrEqual(10);
    for (const interval of incoming) {
      expect(interval.value).toBe(6);
    }

    // The monitor made before, with the average, read the average queue.
    for (const interval of await monitorReads({
      metricName: WAITING,
      aggregationType: MetricsAggregationType.Avg,
      rollingTime: RollingTime.Past15Minutes,
    })) {
      expect(interval.value).toBe(20);
    }
  });

  /*
   * The list leaves the interval to the server, so the interval the scope
   * helper judged a range by is the one the server read it in.
   */
  test("every read of the list left its interval to the server", () => {
    expect(mockRequests.length).toBeGreaterThan(0);
    for (const request of mockRequests) {
      expect(request["aggregationInterval"]).toBeUndefined();
    }
    expect(
      mockRequests.map((request: JSONObject): unknown => {
        return request["aggregationType"];
      }),
    ).toEqual(
      expect.arrayContaining([
        MetricsAggregationType.Sum,
        MetricsAggregationType.Avg,
      ]),
    );
  });
});

describe("The Service Bus namespace totals' ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
