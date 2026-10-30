import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import {
  ClickHouseSettings,
  ClickhouseExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import ObjectID from "Common/Types/ObjectID";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
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
 * The infrastructure monitors' grouped reads, against a real ClickHouse
 * (follow-up of #4912 in #5281).
 *
 * A Kubernetes, Docker, Host, Podman, Proxmox, VMware, Ceph, storage array,
 * IoT or Docker Swarm monitor grouped by an attribute - a pod, a host, a
 * container - used to read up to 10,000 RAW rows a check, newest first, and
 * aggregate them per series and minute in code. A cluster of 400 pods
 * reporting every 30 seconds holds 12,000 rows in a 15-minute window, so
 * the read held only its newest minutes, and "All Values" over the window
 * waited for data it would never read. readQueryDataPoints now groups in
 * SQL - GROUP BY the attribute keys' values, a row per series and minute -
 * as the Metrics monitor reads, up to GROUPED_READ_ROW_LIMIT rows.
 *
 * What a mock cannot show is what ClickHouse makes of that SQL: that it
 * returns rows at all (a GROUP BY on the whole attributes Map once returned
 * none through the client's parameter binding), that each row's attributes
 * hold the bucket's newest data point's attributes with the grouped key
 * laid over them - what Affected Resources names a pod's node from, as it
 * did from the raw rows (includeSampleAttributes) - while a chart's read
 * still gets the grouped keys alone, that every aggregation folds a
 * series' minute as the evaluator expects, that the read is whole where
 * the raw read was cut, and that a read past its limit keeps the newest
 * buckets and says where it is complete. So this suite loads a window of
 * pod metrics into a table built from the real Metric model, reads it
 * through the worker's readQueryDataPoints on both analyzers, and holds
 * every bucket to one worked out from the rows themselves.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/GroupedReadInSqlClickhouse.test.ts
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
import {
  GROUPED_READ_ROW_LIMIT,
  QueryDataPoints,
  readQueryDataPoints,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `grouped_read_in_sql_test_${process.pid}_${Date.now()}`;

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;

/*
 * A 15-minute window ending on a minute a few minutes ago: every row is
 * well within retention, and the window holds exactly 15 whole minutes.
 */
const WINDOW_END_MS: number = Math.floor(Date.now() / MINUTE) * MINUTE - 3 * MINUTE;
const WINDOW_START_MS: number = WINDOW_END_MS - 15 * MINUTE;
const WINDOW_MINUTES: number = 15;

const projectId: ObjectID = new ObjectID(
  "6a1d2c3b-0000-4000-8000-00000000000a",
);
const otherProjectId: ObjectID = new ObjectID(
  "6a1d2c3b-0000-4000-8000-00000000000b",
);

const POD_KEY: string = "resource.k8s.pod.name";
const NAMESPACE_KEY: string = "resource.k8s.namespace.name";
const CLUSTER_KEY: string = "resource.k8s.cluster.name";

// The pods of the namespace the monitor watches: two data points a minute each.
const CPU: string = "k8s.pod.cpu.utilization";
const PODS: number = 400;
const POINT_SECONDS: Array<number> = [10, 40];

/*
 * A fleet past the grouped read's limit, one data point a minute each: so
 * many pods that the limit's worth of buckets ends two minutes into the
 * window.
 */
const FLEET: string = "k8s.pod.memory.working_set";
const FLEET_PODS: number = Math.ceil(GROUPED_READ_ROW_LIMIT / 13);

/*
 * A metric some of whose rows lack the grouped key - a pod's restarts sent
 * by an exporter that names no pod: they make one series of their own,
 * labelled '', as they did when the monitor read raw rows.
 */
const RESTARTS: string = "k8s.container.restarts";

const inThirtyDays: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
);

interface Point {
  name: string;
  timeMs: number;
  value: number;
  attributes: Record<string, string>;
  projectId: ObjectID;
}

function podName(index: number): string {
  return `checkout-${String(index).padStart(4, "0")}`;
}

let rowIndex: number = 0;

function metricRow(point: Point): JSONObject {
  const time: Date = new Date(point.timeMs);

  rowIndex++;

  return {
    _id: ObjectID.generate().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: point.projectId.toString(),
    primaryEntityId: "6a1d2c3b-0000-4000-8000-0000000000ff",
    primaryEntityType: "Service",
    name: point.name,
    aggregationTemporality: "Delta",
    metricPointType: "Gauge",
    time: OneUptimeDate.toClickhouseDateTime64(time),
    timeUnixNano: String(point.timeMs * 1000000 + (rowIndex % 1000000)),
    attributes: point.attributes,
    attributeKeys: Object.keys(point.attributes).sort(),
    entityKeys: [],
    value: point.value,
    count: null,
    sum: null,
    min: null,
    max: null,
    bucketCounts: [],
    explicitBounds: [],
    retentionDate: inThirtyDays,
  };
}

/*
 * The window's rows: every pod of the watched namespace twice a minute, with
 * attributes no monitor groups by (a pod's uid, its node) beside the pod's
 * name - and rows the query must leave out: another namespace, another
 * cluster, another project, and the minute after the window.
 */
function cpuPoints(random: SeededRandom): Array<Point> {
  const points: Array<Point> = [];

  for (let pod: number = 0; pod < PODS; pod++) {
    for (let minute: number = 0; minute < WINDOW_MINUTES; minute++) {
      for (const second of POINT_SECONDS) {
        points.push({
          name: CPU,
          timeMs: WINDOW_START_MS + minute * MINUTE + second * SECOND,
          // Hundredths, so a sum is exact in floating point.
          value: random(10000) / 100,
          attributes: {
            [POD_KEY]: podName(pod),
            [NAMESPACE_KEY]: "shop",
            [CLUSTER_KEY]: "prod",
            "resource.k8s.pod.uid": `uid-${pod}-${minute}-${second}`,
            "resource.k8s.node.name": `node-${pod % 7}`,
          },
          projectId: projectId,
        });
      }
    }
  }

  const leftOut: Array<Partial<Point>> = [
    { attributes: { [NAMESPACE_KEY]: "billing", [CLUSTER_KEY]: "prod" } },
    { attributes: { [NAMESPACE_KEY]: "shop", [CLUSTER_KEY]: "staging" } },
    { projectId: otherProjectId },
    { timeMs: WINDOW_END_MS + 30 * SECOND },
  ];

  for (const shape of leftOut) {
    for (let pod: number = 0; pod < 20; pod++) {
      points.push({
        name: CPU,
        timeMs: shape.timeMs ?? WINDOW_START_MS + 5 * MINUTE + 10 * SECOND,
        value: 999,
        attributes: {
          [POD_KEY]: podName(pod),
          [NAMESPACE_KEY]: "shop",
          [CLUSTER_KEY]: "prod",
          ...(shape.attributes || {}),
        },
        projectId: shape.projectId || projectId,
      });
    }
  }

  return points;
}

function restartPoints(): Array<Point> {
  const points: Array<Point> = [];

  for (let minute: number = 0; minute < 3; minute++) {
    points.push({
      name: RESTARTS,
      timeMs: WINDOW_START_MS + minute * MINUTE + 15 * SECOND,
      value: minute,
      attributes: {
        [POD_KEY]: podName(1),
        [NAMESPACE_KEY]: "shop",
        [CLUSTER_KEY]: "prod",
        "resource.k8s.node.name": "node-1",
      },
      projectId: projectId,
    });
    points.push({
      name: RESTARTS,
      timeMs: WINDOW_START_MS + minute * MINUTE + 25 * SECOND,
      value: 10 + minute,
      attributes: {
        [NAMESPACE_KEY]: "shop",
        [CLUSTER_KEY]: "prod",
        "exporter.name": "kube-state-metrics",
      },
      projectId: projectId,
    });
  }

  return points;
}

/*
 * The newest data point of each metric's pod and minute among the rows a
 * monitor's query reads, worked out once from the points.
 */
let newestPoints: Map<string, Point> | undefined = undefined;

function newestPointKey(
  metricName: string,
  pod: string,
  minuteMs: number,
): string {
  return `${metricName}|${pod}|${minuteMs}`;
}

/*
 * The attributes a sample read gives a pod's minute: those of its newest
 * data point - the one at :40 - with the grouped key as grouped.
 */
function newestAttributes(
  metricName: string,
  pod: string,
  minuteMs: number,
): Record<string, string> {
  if (!newestPoints) {
    newestPoints = new Map();

    for (const point of points) {
      if (
        point.projectId.toString() !== projectId.toString() ||
        point.attributes[NAMESPACE_KEY] !== "shop" ||
        point.attributes[CLUSTER_KEY] !== "prod" ||
        point.timeMs > WINDOW_END_MS
      ) {
        continue;
      }

      const key: string = newestPointKey(
        point.name,
        point.attributes[POD_KEY] || "",
        Math.floor(point.timeMs / MINUTE) * MINUTE,
      );
      const newest: Point | undefined = newestPoints.get(key);

      if (!newest || point.timeMs > newest.timeMs) {
        newestPoints.set(key, point);
      }
    }
  }

  const newest: Point | undefined = newestPoints.get(
    newestPointKey(metricName, pod, minuteMs),
  );

  expect(newest).toBeDefined();

  return { ...newest!.attributes, [POD_KEY]: pod };
}

function fleetPoints(): Array<Point> {
  const points: Array<Point> = [];

  for (let pod: number = 0; pod < FLEET_PODS; pod++) {
    for (let minute: number = 0; minute < WINDOW_MINUTES; minute++) {
      points.push({
        name: FLEET,
        timeMs: WINDOW_START_MS + minute * MINUTE + 20 * SECOND,
        value: pod,
        attributes: {
          [POD_KEY]: podName(pod),
          [NAMESPACE_KEY]: "shop",
          [CLUSTER_KEY]: "prod",
        },
        projectId: projectId,
      });
    }
  }

  return points;
}

// What a series' minute folds to, worked out from its rows.
function fold(
  aggregationType: MetricsAggregationType,
  values: Array<number>,
): number {
  switch (aggregationType) {
    case MetricsAggregationType.Sum:
      return values.reduce((total: number, value: number) => {
        return total + value;
      }, 0);
    case MetricsAggregationType.Avg:
      return (
        values.reduce((total: number, value: number) => {
          return total + value;
        }, 0) / values.length
      );
    case MetricsAggregationType.Min:
      return Math.min(...values);
    case MetricsAggregationType.Max:
      return Math.max(...values);
    case MetricsAggregationType.Count:
      return values.length;
    default:
      throw new Error(`No fold for ${aggregationType}`);
  }
}

/*
 * The buckets the rows make for a monitor over the window: per pod and
 * minute, of the rows its query reads.
 */
function expectedBuckets(
  points: Array<Point>,
  aggregationType: MetricsAggregationType,
): Map<string, number> {
  const values: Map<string, Array<number>> = new Map();

  for (const point of points) {
    if (
      point.name !== CPU ||
      point.projectId.toString() !== projectId.toString() ||
      point.attributes[NAMESPACE_KEY] !== "shop" ||
      point.attributes[CLUSTER_KEY] !== "prod" ||
      point.timeMs < WINDOW_START_MS ||
      point.timeMs > WINDOW_END_MS
    ) {
      continue;
    }

    const minuteMs: number = Math.floor(point.timeMs / MINUTE) * MINUTE;
    const key: string = `${point.attributes[POD_KEY]}|${minuteMs}`;
    const list: Array<number> = values.get(key) || [];
    list.push(point.value);
    values.set(key, list);
  }

  const buckets: Map<string, number> = new Map();

  for (const [key, list] of values) {
    buckets.set(key, fold(aggregationType, list));
  }

  return buckets;
}

function windowRange(): InBetween<Date> {
  return new InBetween<Date>(
    new Date(WINDOW_START_MS),
    new Date(WINDOW_END_MS),
  );
}

// The worker's read of one query, grouped by the pod's name.
async function readGrouped(data: {
  metricName: string;
  aggregationType: MetricsAggregationType;
}): Promise<QueryDataPoints> {
  return await readQueryDataPoints({
    query: {
      projectId: projectId,
      time: windowRange(),
      name: data.metricName,
      attributes: {
        [NAMESPACE_KEY]: "shop",
        [CLUSTER_KEY]: "prod",
      },
    },
    aggregationType: data.aggregationType,
    groupByAttributeKeys: [POD_KEY],
    groupBy: undefined,
    startAndEndDate: windowRange(),
  });
}

function bucketKey(row: AggregatedModel): string {
  const attributes: JSONObject = (row["attributes"] as JSONObject) || {};

  return `${String(attributes[POD_KEY])}|${new Date(row.timestamp).getTime()}`;
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: modelType,
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

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

const AGGREGATIONS: Array<MetricsAggregationType> = [
  MetricsAggregationType.Avg,
  MetricsAggregationType.Sum,
  MetricsAggregationType.Min,
  MetricsAggregationType.Max,
  MetricsAggregationType.Count,
];

let points: Array<Point> = [];

integration("Grouped infrastructure reads, grouped in SQL", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: ServiceConnection | undefined;

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
      request_timeout: 120000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse, Metric);

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

    points = [
      ...cpuPoints(seededRandom(5281)),
      ...fleetPoints(),
      ...restartPoints(),
    ];

    // In slices: one insert of every row is a request of tens of megabytes.
    const rows: Array<JSONObject> = points.map(metricRow);
    for (let start: number = 0; start < rows.length; start += 20000) {
      await MetricService.insertJsonRows(rows.slice(start, start + 20000), {
        clickhouseSettings: { wait_for_async_insert: 1 },
      });
    }
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

  test("the raw read the monitors made before is cut: 12,000 rows of 400 pods hold only the window's newest minutes", async () => {
    const raw: Array<Metric> = await MetricService.findBy({
      query: {
        projectId: projectId,
        time: windowRange(),
        name: CPU,
        attributes: { [NAMESPACE_KEY]: "shop", [CLUSTER_KEY]: "prod" },
      },
      select: { attributes: true, value: true, time: true },
      sort: { time: SortOrder.Descending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    expect(raw).toHaveLength(LIMIT_PER_PROJECT);

    const oldestMs: number = Math.min(
      ...raw.map((row: Metric): number => {
        return new Date(row.time as Date).getTime();
      }),
    );

    // Not even the window's last 13 minutes: everything older is lost.
    expect(oldestMs).toBeGreaterThan(WINDOW_START_MS + 2 * MINUTE);
  });

  test.each(AGGREGATIONS)(
    "%s: a row per pod and minute, the whole window, each bucket what its rows fold to",
    async (aggregationType: MetricsAggregationType) => {
      const read: QueryDataPoints = await readGrouped({
        metricName: CPU,
        aggregationType: aggregationType,
      });
      const rows: Array<AggregatedModel> = read.aggregatedResult.data;
      const expected: Map<string, number> = expectedBuckets(
        points,
        aggregationType,
      );

      // Whole: every pod, every minute - nothing cut.
      expect(read.completeFrom).toBeNull();
      expect(expected.size).toBe(PODS * WINDOW_MINUTES);
      expect(rows).toHaveLength(PODS * WINDOW_MINUTES);

      const seen: Set<string> = new Set();

      for (const row of rows) {
        const key: string = bucketKey(row);

        expect(seen.has(key)).toBe(false);
        seen.add(key);

        /*
         * The minute's start, and the attributes of the pod's newest data
         * point of that minute - its uid of :40, its node - with its name.
         */
        const minuteMs: number = new Date(row.timestamp).getTime();
        const pod: string = String((row["attributes"] as JSONObject)[POD_KEY]);

        expect(minuteMs % MINUTE).toBe(0);
        expect(row["attributes"]).toEqual(
          newestAttributes(CPU, pod, minuteMs),
        );
        expect((row["attributes"] as JSONObject)["resource.k8s.pod.uid"]).toBe(
          `uid-${Number(pod.slice(9))}-${(minuteMs - WINDOW_START_MS) / MINUTE}-40`,
        );
        expect(expected.has(key)).toBe(true);
        expect(Number(row.value)).toBeCloseTo(expected.get(key)!, 6);
      }

      expect(seen.size).toBe(expected.size);

      // Newest first, as the cut detection reads them.
      for (let index: number = 1; index < rows.length; index++) {
        expect(new Date(rows[index]!.timestamp).getTime()).toBeLessThanOrEqual(
          new Date(rows[index - 1]!.timestamp).getTime(),
        );
      }
    },
  );

  test("a fleet past the read's limit keeps the newest buckets of every pod, and says where it is whole", async () => {
    const read: QueryDataPoints = await readGrouped({
      metricName: FLEET,
      aggregationType: MetricsAggregationType.Max,
    });
    const rows: Array<AggregatedModel> = read.aggregatedResult.data;

    expect(FLEET_PODS * WINDOW_MINUTES).toBeGreaterThan(GROUPED_READ_ROW_LIMIT);
    expect(rows).toHaveLength(GROUPED_READ_ROW_LIMIT);
    expect(read.aggregatedResult.truncated).toBe(true);

    const oldestMs: number = Math.min(
      ...rows.map((row: AggregatedModel): number => {
        return new Date(row.timestamp).getTime();
      }),
    );

    // Cut at its oldest minute, which is where the data is whole from.
    expect(read.completeFrom?.getTime()).toBe(oldestMs);
    expect(oldestMs).toBeGreaterThan(WINDOW_START_MS);

    // Every minute after the cut holds every pod.
    const podsByMinute: Map<number, Set<string>> = new Map();

    for (const row of rows) {
      const minuteMs: number = new Date(row.timestamp).getTime();
      const pods: Set<string> = podsByMinute.get(minuteMs) || new Set();
      pods.add(String((row["attributes"] as JSONObject)[POD_KEY]));
      podsByMinute.set(minuteMs, pods);
      // A pod's value is its index: Max of one point.
      expect(Number(row.value)).toBe(
        Number(String((row["attributes"] as JSONObject)[POD_KEY]).slice(9)),
      );
    }

    for (const [minuteMs, pods] of podsByMinute) {
      if (minuteMs > oldestMs) {
        expect(pods.size).toBe(FLEET_PODS);
      }
    }
  });

  test("a chart's grouped read, which asks for no sample, still gets the grouped key alone", async () => {
    const result: AggregatedResult = await MetricService.aggregateBy({
      query: {
        projectId: projectId,
        time: windowRange(),
        name: CPU,
        attributes: { [NAMESPACE_KEY]: "shop", [CLUSTER_KEY]: "prod" },
      },
      aggregationType: MetricsAggregationType.Avg,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: new Date(WINDOW_START_MS),
      endTimestamp: new Date(WINDOW_END_MS),
      limit: GROUPED_READ_ROW_LIMIT,
      skip: 0,
      groupByAttributeKeys: [POD_KEY],
      props: { isRoot: true },
    });

    expect(result.data).toHaveLength(PODS * WINDOW_MINUTES);

    for (const row of result.data) {
      expect(Object.keys(row["attributes"] as JSONObject)).toEqual([POD_KEY]);
    }
  });

  test("rows without the grouped key make a series of their own, labelled '', with their own attributes", async () => {
    const read: QueryDataPoints = await readGrouped({
      metricName: RESTARTS,
      aggregationType: MetricsAggregationType.Max,
    });
    const rows: Array<AggregatedModel> = read.aggregatedResult.data;

    // Two series - the pod and the rows that name none - over three minutes.
    expect(rows).toHaveLength(6);

    for (const row of rows) {
      const minuteMs: number = new Date(row.timestamp).getTime();
      const attributes: JSONObject = row["attributes"] as JSONObject;
      const pod: string = String(attributes[POD_KEY]);
      const minute: number = (minuteMs - WINDOW_START_MS) / MINUTE;

      expect(attributes).toEqual(newestAttributes(RESTARTS, pod, minuteMs));

      if (pod === "") {
        expect(attributes["exporter.name"]).toBe("kube-state-metrics");
        expect(Number(row.value)).toBe(10 + minute);
      } else {
        expect(pod).toBe(podName(1));
        expect(attributes["resource.k8s.node.name"]).toBe("node-1");
        expect(Number(row.value)).toBe(minute);
      }
    }
  });

  test.each([MetricsAggregationType.P50, MetricsAggregationType.P95])(
    "%s, read as ClickHouse computes a percentile, carries the same sample attributes",
    async (aggregationType: MetricsAggregationType) => {
      const read: QueryDataPoints = await readGrouped({
        metricName: CPU,
        aggregationType: aggregationType,
      });
      const rows: Array<AggregatedModel> = read.aggregatedResult.data;

      expect(rows).toHaveLength(PODS * WINDOW_MINUTES);

      for (const row of rows) {
        const minuteMs: number = new Date(row.timestamp).getTime();
        const pod: string = String(
          (row["attributes"] as JSONObject)[POD_KEY],
        );

        expect(row["attributes"]).toEqual(
          newestAttributes(CPU, pod, minuteMs),
        );
      }
    },
  );

  test("the older analyzer reads the same buckets", async () => {
    const found: { json: () => Promise<unknown> } = await client.query({
      query:
        "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
      format: "JSONEachRow",
    });
    const [setting] = (await found.json()) as Array<{ name: string }>;

    if (!setting) {
      return;
    }

    const byKey: (
      rows: Array<AggregatedModel>,
    ) => Record<string, { value: number; attributes: JSONObject }> = (
      rows: Array<AggregatedModel>,
    ): Record<string, { value: number; attributes: JSONObject }> => {
      const out: Record<string, { value: number; attributes: JSONObject }> =
        {};
      for (const row of rows) {
        out[bucketKey(row)] = {
          value: Number(row.value),
          attributes: row["attributes"] as JSONObject,
        };
      }
      return out;
    };

    const current: QueryDataPoints = await readGrouped({
      metricName: CPU,
      aggregationType: MetricsAggregationType.Avg,
    });

    const executeQuery: typeof MetricService.executeQuery =
      MetricService.executeQuery.bind(MetricService);
    const settingsSeen: Array<unknown> = [];

    jest
      .spyOn(MetricService, "executeQuery")
      .mockImplementation(
        (
          statement: Statement | string,
          runOptions?: ClickhouseExecuteOptions,
        ): Promise<never> => {
          const clickhouseSettings: ClickHouseSettings = {
            ...(runOptions?.clickhouseSettings || {}),
            [setting.name]: 0,
          } as ClickHouseSettings;
          settingsSeen.push(
            (clickhouseSettings as Record<string, unknown>)[setting.name],
          );
          return executeQuery(statement, {
            ...(runOptions || {}),
            clickhouseSettings: clickhouseSettings,
          }) as Promise<never>;
        },
      );

    try {
      const older: QueryDataPoints = await readGrouped({
        metricName: CPU,
        aggregationType: MetricsAggregationType.Avg,
      });

      expect(settingsSeen.length).toBeGreaterThan(0);
      expect(new Set(settingsSeen)).toEqual(new Set([0]));
      expect(older.completeFrom).toBeNull();
      expect(older.aggregatedResult.data).toHaveLength(PODS * WINDOW_MINUTES);
      expect(byKey(older.aggregatedResult.data)).toEqual(
        byKey(current.aggregatedResult.data),
      );
    } finally {
      jest.restoreAllMocks();
    }
  });
});

describe("Grouped read ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
