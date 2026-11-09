import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import ObjectID from "Common/Types/ObjectID";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import { CLOUD_CONNECTION_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudConnectionTelemetry";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import DatabaseService from "Common/Server/Services/DatabaseService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { ToolExecutionResult } from "Common/Server/Utils/AI/Toolbox/ToolTypes";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
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
 * Metrics monitors on a Service Bus namespace, before and after its
 * metrics were split by queue, and after the data migration that gives
 * them the namespace's numbers back (#6460) - against a real ClickHouse
 * server.
 *
 * Until #6415 a connected Azure subscription read each of a namespace's
 * metrics once, for the namespace: one series, whose average was the
 * namespace's number, and a monitor made then reads it with the average.
 * Since, they arrive once per queue - as the collector's azure_monitor
 * receiver always wrote them - and that monitor reads the average queue:
 * a stalled producer is reported while 6 messages a minute arrive, and a
 * backlog of 60 goes unseen. RestoreNamespaceMetricMonitorTotals moves
 * each such query read a minute at a time to Sum.
 *
 * This stores the namespace both ways, as each connection wrote it - its
 * own series for 7 hours, then its three queues' for 7 more - and runs the
 * REAL Metrics monitor reader (monitorMetric) and the REAL criteria
 * evaluator on monitors of a count, an amount held and a latency: as made,
 * over the namespace's own series; the same monitors over its queues; and
 * the monitors the REAL data migration writes back. A monitor read in
 * 5-minute intervals is left as it is, and what its Sum would read there
 * shows why. OneUptime AI's query_metrics reads the namespace's totals
 * from the same points.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/DataMigrations/NamespaceMonitorTotalsClickhouse.test.ts
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

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import MonitorFeedService from "Common/Server/Services/MonitorFeedService";
import MonitorService from "Common/Server/Services/MonitorService";
import MetricMonitorCriteria from "Common/Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import { QueryMetricsTool } from "Common/Server/Utils/AI/Toolbox/MetricTools";
import { monitorMetric } from "../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import RestoreNamespaceMetricMonitorTotals from "../../../FeatureSet/Workers/DataMigrations/RestoreNamespaceMetricMonitorTotals";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `namespace_monitor_totals_test_${process.pid}_${Date.now()}`;

const MINUTE_MS: number = 60 * 1000;

// The newest stored minute: a whole minute before now, so it is complete.
const NEWEST_MINUTE_MS: number =
  Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS - MINUTE_MS;

// Each way the namespace was read, for 7 hours: a 6-hour window fits.
const MINUTES_EACH_WAY: number = 7 * 60;

// The first minute read once per queue; the namespace's own series end before it.
const SPLIT_MS: number = NEWEST_MINUTE_MS - (MINUTES_EACH_WAY - 1) * MINUTE_MS;

// Where each read ends: before the split, after it, and across it.
const BEFORE_THE_SPLIT: Date = new Date(SPLIT_MS);
const AFTER_THE_SPLIT: Date = new Date(NEWEST_MINUTE_MS + MINUTE_MS);
const ACROSS_THE_SPLIT: Date = new Date(SPLIT_MS + 7 * MINUTE_MS);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

const PROJECT_ID: ObjectID = ObjectID.generate();
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const CLOUD_CONNECTION_ID: string = "5f0c1d2e-3a4b-4c5d-8e6f-7a8b9c0d1e2f";
const SERVICE_BUS: string = "Microsoft.ServiceBus/namespaces";
const SHOP: string = `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/${SERVICE_BUS}/shop`;

const WAITING: string = "azure_activemessages_average";
const INCOMING: string = "azure_incomingmessages_total";
const LATENCY: string = "azure_serversendlatency_average";

/*
 * Each of shop's queues, every minute: messages waiting, messages in, a
 * send's latency in milliseconds. The namespace holds 60 waiting, takes 6
 * messages a minute and sends in 10 ms; its average queue holds 20 and
 * takes 2.
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

const NAMESPACE: { waiting: number; incoming: number; latency: number } = {
  waiting: 60,
  incoming: 6,
  latency: 10,
};

interface Point {
  name: string;
  timeMs: number;
  value: number;
  attributes: Record<string, string>;
}

// The attributes the Azure connection writes on a namespace's series.
function namespaceAttributes(): Record<string, string> {
  return {
    "azuremonitor.resource_id": SHOP,
    "resource.azuremonitor.subscription_id": SUBSCRIPTION,
    name: "shop",
    type: SERVICE_BUS,
    "resource.service.name": "oneuptime-cloud-azure",
    [`resource.${CLOUD_CONNECTION_ID_ATTRIBUTE}`]: CLOUD_CONNECTION_ID,
  };
}

const POINTS: Array<Point> = [];

for (let minute: number = 0; minute < 2 * MINUTES_EACH_WAY; minute++) {
  // Ten seconds into each minute, as Azure stamps a grain's start.
  const timeMs: number = NEWEST_MINUTE_MS - minute * MINUTE_MS + 10000;

  if (minute < MINUTES_EACH_WAY) {
    // Since #6415: once per queue, split by EntityName.
    for (const queue of QUEUES) {
      const attributes: Record<string, string> = {
        ...namespaceAttributes(),
        metadata_entityname: queue.entity,
      };
      POINTS.push({ name: WAITING, timeMs, value: queue.waiting, attributes });
      POINTS.push({
        name: INCOMING,
        timeMs,
        value: queue.incoming,
        attributes,
      });
      POINTS.push({ name: LATENCY, timeMs, value: queue.latency, attributes });
    }
    continue;
  }

  // Before: the namespace's own series.
  const attributes: Record<string, string> = namespaceAttributes();
  POINTS.push({ name: WAITING, timeMs, value: NAMESPACE.waiting, attributes });
  POINTS.push({
    name: INCOMING,
    timeMs,
    value: NAMESPACE.incoming,
    attributes,
  });
  POINTS.push({ name: LATENCY, timeMs, value: NAMESPACE.latency, attributes });
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

function valuesOf(result: AggregatedResult | undefined): Array<number> {
  return [...(result?.data || [])]
    .sort((a: AggregatedModel, b: AggregatedModel): number => {
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    })
    .map((row: AggregatedModel): number => {
      return Number(row.value);
    });
}

/*
 * ------------------------------------------------------------------
 * The monitors, as Postgres holds them
 * ------------------------------------------------------------------
 */

const MONITOR_IDS: {
  messagesIn: string;
  waiting: string;
  latency: string;
  sixHours: string;
} = {
  messagesIn: "0a7d3c1e-1b2c-4d3e-8f4a-5b6c7d8e9f01",
  waiting: "0b8e4d2f-2c3d-4e4f-9a5b-6c7d8e9f0a12",
  latency: "0c9f5e3a-3d4e-4f5a-8b6c-7d8e9f0a1b23",
  sixHours: "0d0a6f4b-4e5f-4a6b-9c7d-8e9f0a1b2c34",
};

const STATUS_IDS: {
  online: ObjectID;
  offline: ObjectID;
  incident: ObjectID;
  alert: ObjectID;
} = {
  online: new ObjectID("5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
  offline: new ObjectID("6b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e"),
  incident: new ObjectID("7c3d4e5f-6a7b-4c8d-8e9f-1a2b3c4d5e6f"),
  alert: new ObjectID("8d4e5f6a-7b8c-4d9e-9f0a-2b3c4d5e6f7a"),
};

function query(data: {
  variable: string;
  metricName: string;
  aggregationType?: AggregationType | undefined;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: data.variable,
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        attributes: { "azuremonitor.resource_id": SHOP },
        aggregateBy: {},
        ...(data.aggregationType
          ? { aggegationType: data.aggregationType }
          : {}),
      },
    },
  } as MetricQueryConfigData;
}

function storedSteps(
  queries: Array<MetricQueryConfigData>,
  rollingTime: RollingTime,
): JSONObject {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "shop",
    monitorType: MonitorType.Metrics,
    onlineMonitorStatusId: STATUS_IDS.online,
    offlineMonitorStatusId: STATUS_IDS.offline,
    defaultIncidentSeverityId: STATUS_IDS.incident,
    defaultAlertSeverityId: STATUS_IDS.alert,
  });
  const metricMonitor: MonitorStepMetricMonitor = {
    metricViewConfig: { queryConfigs: queries, formulaConfigs: [] },
    rollingTime,
  };

  step.setMetricMonitor(metricMonitor);

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray([step]);
  monitorSteps.setDefaultMonitorStatusId(STATUS_IDS.online);

  return JSON.parse(JSON.stringify(monitorSteps.toJSON())) as JSONObject;
}

interface MonitorRow {
  _id: string;
  projectId: string;
  monitorType: MonitorType;
  monitorSteps: JSONObject;
}

/*
 * Four Metrics monitors made before the split, each with the average - one
 * from the API, which sends no aggregation and reads the average too:
 *   - messages in fewer than 4 a minute, all of 15 minutes: a stalled producer;
 *   - messages waiting over 50 at any minute of 15: a backlog;
 *   - a send slower than 12 ms at any minute of 15;
 *   - messages waiting over 50 and messages in, over 6 hours.
 */
function madeBeforeTheSplit(): Array<MonitorRow> {
  return [
    {
      _id: MONITOR_IDS.messagesIn,
      projectId: PROJECT_ID.toString(),
      monitorType: MonitorType.Metrics,
      monitorSteps: storedSteps(
        [query({ variable: "a", metricName: INCOMING })],
        RollingTime.Past15Minutes,
      ),
    },
    {
      _id: MONITOR_IDS.waiting,
      projectId: PROJECT_ID.toString(),
      monitorType: MonitorType.Metrics,
      monitorSteps: storedSteps(
        [
          query({
            variable: "a",
            metricName: WAITING,
            aggregationType: AggregationType.Avg,
          }),
        ],
        RollingTime.Past15Minutes,
      ),
    },
    {
      _id: MONITOR_IDS.latency,
      projectId: PROJECT_ID.toString(),
      monitorType: MonitorType.Metrics,
      monitorSteps: storedSteps(
        [
          query({
            variable: "a",
            metricName: LATENCY,
            aggregationType: AggregationType.Avg,
          }),
        ],
        RollingTime.Past15Minutes,
      ),
    },
    {
      _id: MONITOR_IDS.sixHours,
      projectId: PROJECT_ID.toString(),
      monitorType: MonitorType.Metrics,
      monitorSteps: storedSteps(
        [
          query({
            variable: "a",
            metricName: WAITING,
            aggregationType: AggregationType.Avg,
          }),
          query({
            variable: "b",
            metricName: INCOMING,
            aggregationType: AggregationType.Avg,
          }),
        ],
        RollingTime.Past6Hours,
      ),
    },
  ];
}

const CRITERIA: Record<string, CriteriaFilter> = {
  [MONITOR_IDS.messagesIn]: {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.LessThan,
    value: 4,
    metricMonitorOptions: {
      metricAlias: "a",
      metricAggregationType: EvaluateOverTimeType.AllValues,
    },
  },
  [MONITOR_IDS.waiting]: {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.GreaterThan,
    value: 50,
    metricMonitorOptions: {
      metricAlias: "a",
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    },
  },
  [MONITOR_IDS.latency]: {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.GreaterThan,
    value: 12,
    metricMonitorOptions: {
      metricAlias: "a",
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    },
  },
  [MONITOR_IDS.sixHours]: {
    checkOn: CheckOn.MetricValue,
    filterType: FilterType.GreaterThan,
    value: 50,
    metricMonitorOptions: {
      metricAlias: "a",
      metricAggregationType: EvaluateOverTimeType.AnyValue,
    },
  },
};

// What a stored monitor reads, and whether its criteria fire on it.
interface Reading {
  aggregations: Array<unknown>;
  // Each query's values, interval by interval.
  values: Array<Array<number>>;
  fires: boolean;
}

function stepOf(row: MonitorRow): MonitorStep {
  return MonitorSteps.fromJSON(row.monitorSteps).data!
    .monitorStepsInstanceArray[0]!;
}

async function read(row: MonitorRow, evaluateUntil: Date): Promise<Reading> {
  const step: MonitorStep = stepOf(row);
  const response: MetricMonitorResponse = await monitorMetric({
    monitorStep: step,
    monitorId: new ObjectID(row._id),
    projectId: PROJECT_ID,
    evaluateUntil,
  });
  const fires: string | null =
    await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: response,
      // A copy: the evaluator writes its context back onto the filter.
      criteriaFilter: JSON.parse(
        JSON.stringify(CRITERIA[row._id]!),
      ) as CriteriaFilter,
      monitorStep: step,
    });

  return {
    aggregations: step.data!.metricMonitor!.metricViewConfig.queryConfigs.map(
      (config: MetricQueryConfigData): unknown => {
        return config.metricQueryData.filterData.aggegationType;
      },
    ),
    values: response.metricResult.map(valuesOf),
    fires: fires !== null,
  };
}

// Every value of a query's intervals, once each: [60] when all read 60.
function distinct(values: Array<number>): Array<number> {
  return Array.from(new Set(values)).sort((a: number, b: number): number => {
    return a - b;
  });
}

/*
 * The migration's table: its SELECT answered from the rows, paged by id,
 * and its UPDATE written only while the row holds what was read - as
 * Postgres does, through TypeORM, which hands back [rows, rowCount].
 */
function stubMonitorTable(rows: Array<MonitorRow>): void {
  jest
    .spyOn(
      MonitorService as unknown as DatabaseService<BaseModel>,
      "getRepository",
    )
    .mockReturnValue({
      metadata: { tableName: "Monitor" },
      manager: {
        query: async (
          sql: string,
          parameters: Array<unknown>,
        ): Promise<unknown> => {
          if (sql.startsWith("SELECT")) {
            const contains: string = String(parameters[2]).slice(1, -1);
            const after: string | undefined = parameters[3] as
              | string
              | undefined;

            return rows
              .filter((row: MonitorRow): boolean => {
                return (
                  row.monitorType === parameters[1] &&
                  JSON.stringify(row.monitorSteps).includes(contains) &&
                  (!after || row._id > after)
                );
              })
              .sort((a: MonitorRow, b: MonitorRow): number => {
                return a._id < b._id ? -1 : 1;
              })
              .slice(0, parameters[0] as number);
          }

          const row: MonitorRow | undefined = rows.find(
            (candidate: MonitorRow): boolean => {
              return candidate._id === parameters[1];
            },
          );

          if (
            !row ||
            JSON.stringify(row.monitorSteps) !==
              JSON.stringify(JSON.parse(parameters[2] as string))
          ) {
            return [[], 0];
          }

          row.monitorSteps = JSON.parse(parameters[0] as string) as JSONObject;

          return [[{ _id: row._id }], 1];
        },
      },
    } as never);
}

integration(
  "Metrics monitors on a Service Bus namespace, before and after its metrics were split by queue",
  () => {
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

      // The monitor converts units from the catalog: these metrics have none.
      jest
        .spyOn(MetricTypeService, "findBy")
        .mockImplementation(async (): Promise<Array<MetricType>> => {
          return [];
        });
      jest
        .spyOn(MonitorFeedService, "createMonitorFeedItem")
        .mockImplementation(async (): Promise<void> => {});
    });

    afterAll(async (): Promise<void> => {
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

    function rowOf(rows: Array<MonitorRow>, id: string): MonitorRow {
      return rows.find((row: MonitorRow): boolean => {
        return row._id === id;
      })!;
    }

    test("as made, over the namespace's own series, each monitor reads the namespace's number", async () => {
      const rows: Array<MonitorRow> = madeBeforeTheSplit();

      const messagesIn: Reading = await read(
        rowOf(rows, MONITOR_IDS.messagesIn),
        BEFORE_THE_SPLIT,
      );
      const waiting: Reading = await read(
        rowOf(rows, MONITOR_IDS.waiting),
        BEFORE_THE_SPLIT,
      );
      const latency: Reading = await read(
        rowOf(rows, MONITOR_IDS.latency),
        BEFORE_THE_SPLIT,
      );
      const sixHours: Reading = await read(
        rowOf(rows, MONITOR_IDS.sixHours),
        BEFORE_THE_SPLIT,
      );

      // 15 minutes, one interval each.
      for (const reading of [messagesIn, waiting, latency]) {
        expect(reading.values[0]).toHaveLength(15);
      }

      expect(distinct(messagesIn.values[0]!)).toEqual([6]);
      expect(messagesIn.fires).toBe(false);
      expect(distinct(waiting.values[0]!)).toEqual([60]);
      expect(waiting.fires).toBe(true);
      expect(distinct(latency.values[0]!)).toEqual([10]);
      expect(latency.fires).toBe(false);

      // 6 hours in 5-minute intervals: the average of each interval's minutes.
      expect(sixHours.values[0]!.length).toBeGreaterThanOrEqual(72);
      expect(distinct(sixHours.values[0]!)).toEqual([60]);
      expect(distinct(sixHours.values[1]!)).toEqual([6]);
      expect(sixHours.fires).toBe(true);
    });

    test("the same monitors over its queues read the average queue: a stalled producer reported, a backlog missed", async () => {
      const rows: Array<MonitorRow> = madeBeforeTheSplit();

      const messagesIn: Reading = await read(
        rowOf(rows, MONITOR_IDS.messagesIn),
        AFTER_THE_SPLIT,
      );
      const waiting: Reading = await read(
        rowOf(rows, MONITOR_IDS.waiting),
        AFTER_THE_SPLIT,
      );
      const latency: Reading = await read(
        rowOf(rows, MONITOR_IDS.latency),
        AFTER_THE_SPLIT,
      );
      const sixHours: Reading = await read(
        rowOf(rows, MONITOR_IDS.sixHours),
        AFTER_THE_SPLIT,
      );

      expect(distinct(messagesIn.values[0]!)).toEqual([2]);
      expect(messagesIn.fires).toBe(true);
      expect(distinct(waiting.values[0]!)).toEqual([20]);
      expect(waiting.fires).toBe(false);
      // A send's latency is per send: the average still reads it.
      expect(distinct(latency.values[0]!)).toEqual([10]);
      expect(latency.fires).toBe(false);
      expect(distinct(sixHours.values[0]!)).toEqual([20]);
      expect(distinct(sixHours.values[1]!)).toEqual([2]);
      expect(sixHours.fires).toBe(false);
    });

    test("the data migration moves the count and the amount held read by the minute to Sum, and they read the namespace's numbers again", async () => {
      const rows: Array<MonitorRow> = madeBeforeTheSplit();
      const sixHoursBefore: string = JSON.stringify(
        rowOf(rows, MONITOR_IDS.sixHours).monitorSteps,
      );
      const latencyBefore: string = JSON.stringify(
        rowOf(rows, MONITOR_IDS.latency).monitorSteps,
      );

      stubMonitorTable(rows);
      await new RestoreNamespaceMetricMonitorTotals().migrate();

      // The latency and the monitor read in 5-minute intervals are as they were.
      expect(
        JSON.stringify(rowOf(rows, MONITOR_IDS.latency).monitorSteps),
      ).toBe(latencyBefore);
      expect(
        JSON.stringify(rowOf(rows, MONITOR_IDS.sixHours).monitorSteps),
      ).toBe(sixHoursBefore);

      const messagesIn: Reading = await read(
        rowOf(rows, MONITOR_IDS.messagesIn),
        AFTER_THE_SPLIT,
      );
      const waiting: Reading = await read(
        rowOf(rows, MONITOR_IDS.waiting),
        AFTER_THE_SPLIT,
      );
      const latency: Reading = await read(
        rowOf(rows, MONITOR_IDS.latency),
        AFTER_THE_SPLIT,
      );

      expect(messagesIn.aggregations).toEqual([AggregationType.Sum]);
      expect(distinct(messagesIn.values[0]!)).toEqual([NAMESPACE.incoming]);
      expect(messagesIn.fires).toBe(false);
      expect(waiting.aggregations).toEqual([AggregationType.Sum]);
      expect(distinct(waiting.values[0]!)).toEqual([NAMESPACE.waiting]);
      expect(waiting.fires).toBe(true);
      expect(latency.aggregations).toEqual([AggregationType.Avg]);
      expect(distinct(latency.values[0]!)).toEqual([NAMESPACE.latency]);
      expect(latency.fires).toBe(false);

      // Over the namespace's own series a Sum is that series: the same numbers.
      for (const id of [MONITOR_IDS.messagesIn, MONITOR_IDS.waiting]) {
        const before: Reading = await read(rowOf(rows, id), BEFORE_THE_SPLIT);
        expect(distinct(before.values[0]!)).toEqual([
          id === MONITOR_IDS.waiting ? NAMESPACE.waiting : NAMESPACE.incoming,
        ]);
      }

      // And a window across the split reads one number all through it.
      const across: Reading = await read(
        rowOf(rows, MONITOR_IDS.waiting),
        ACROSS_THE_SPLIT,
      );
      expect(across.values[0]).toHaveLength(15);
      expect(distinct(across.values[0]!)).toEqual([NAMESPACE.waiting]);

      // As made, the average read the two sides apart.
      const acrossAsMade: Reading = await read(
        rowOf(madeBeforeTheSplit(), MONITOR_IDS.waiting),
        ACROSS_THE_SPLIT,
      );
      expect(distinct(acrossAsMade.values[0]!)).toEqual([20, 60]);
    });

    /*
     * Read in 5-minute intervals, no aggregation reads what the monitor
     * read before: the average is the average queue's, and a Sum adds up
     * every queue's every minute - 5 times the namespace's backlog, and
     * messages in per 5 minutes, not per minute. The migration leaves it.
     */
    test("over 6 hours, neither aggregation reads what the monitor read before, so it is left as it is", async () => {
      const rows: Array<MonitorRow> = madeBeforeTheSplit();
      const summed: MonitorRow = {
        ...rowOf(rows, MONITOR_IDS.sixHours),
        monitorSteps: storedSteps(
          [
            query({
              variable: "a",
              metricName: WAITING,
              aggregationType: AggregationType.Sum,
            }),
            query({
              variable: "b",
              metricName: INCOMING,
              aggregationType: AggregationType.Sum,
            }),
          ],
          RollingTime.Past6Hours,
        ),
      };

      const reading: Reading = await read(summed, AFTER_THE_SPLIT);
      // A whole interval, away from the window's edges.
      const middle: number = Math.floor(reading.values[0]!.length / 2);

      expect(reading.values[0]![middle]).toBe(5 * NAMESPACE.waiting);
      expect(reading.values[1]![middle]).toBe(5 * NAMESPACE.incoming);
    });

    test("OneUptime AI's query_metrics reads the namespace's totals from the same points", async () => {
      const lastHour: { startTime: string; endTime: string } = {
        startTime: new Date(
          AFTER_THE_SPLIT.getTime() - 60 * MINUTE_MS,
        ).toISOString(),
        endTime: AFTER_THE_SPLIT.toISOString(),
      };
      const ctx: {
        projectId: ObjectID;
        props: DatabaseCommonInteractionProps;
      } = {
        projectId: PROJECT_ID,
        props: { isRoot: true },
      };

      const messagesIn: ToolExecutionResult = await QueryMetricsTool.execute(
        {
          metricName: INCOMING,
          attributes: { "azuremonitor.resource_id": SHOP },
          ...lastHour,
        },
        ctx,
      );
      const waiting: ToolExecutionResult = await QueryMetricsTool.execute(
        {
          metricName: WAITING,
          attributes: { "azuremonitor.resource_id": SHOP },
          ...lastHour,
        },
        ctx,
      );
      const latency: ToolExecutionResult = await QueryMetricsTool.execute(
        {
          metricName: LATENCY,
          attributes: { "azuremonitor.resource_id": SHOP },
          ...lastHour,
        },
        ctx,
      );

      // The values of the chart the answer carries, interval by interval.
      function pointsOf(result: ToolExecutionResult): Array<number> {
        const data: {
          series?: Array<{ points: Array<{ y: number | null }> }>;
        } = (result.widget?.data || {}) as {
          series?: Array<{ points: Array<{ y: number | null }> }>;
        };

        return (data.series?.[0]?.points || []).map(
          (point: { y: number | null }): number => {
            return Number(point.y);
          },
        );
      }

      expect(pointsOf(messagesIn).length).toBeGreaterThanOrEqual(59);
      expect(distinct(pointsOf(messagesIn))).toEqual([NAMESPACE.incoming]);
      expect(distinct(pointsOf(waiting))).toEqual([NAMESPACE.waiting]);
      expect(distinct(pointsOf(latency))).toEqual([NAMESPACE.latency]);
      expect(messagesIn.citationLabel).toMatch(/^Sum\(/);
      expect(waiting.citationLabel).toMatch(/^Sum\(/);
      expect(latency.citationLabel).toMatch(/^Avg\(/);
      expect(messagesIn.dataForLlm).toContain("Read with Sum");
      expect(latency.dataForLlm).not.toContain("Read with Sum");

      // Asked for the average, it reads the average queue, and is told so.
      const averaged: ToolExecutionResult = await QueryMetricsTool.execute(
        {
          metricName: INCOMING,
          attributes: { "azuremonitor.resource_id": SHOP },
          aggregationType: "Avg",
          ...lastHour,
        },
        ctx,
      );
      expect(distinct(pointsOf(averaged))).toEqual([2]);
      expect(averaged.dataForLlm).toContain("aggregationType Sum");
    });
  },
);

describe("The namespace monitor totals' ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
