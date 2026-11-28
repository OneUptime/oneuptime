import fs from "fs";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import MetricItemAggMV1mByHostV2 from "Common/Models/AnalyticsModels/MetricItemAggMV1mByHostV2";
import MetricItemAggMV1mByK8sCluster from "Common/Models/AnalyticsModels/MetricItemAggMV1mByK8sCluster";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import AggregateBy from "Common/Server/Types/AnalyticsDatabase/AggregateBy";
import MinuteRollupRange from "Common/Server/Utils/AnalyticsDatabase/MinuteRollupRange";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepKubernetesMonitorUtil } from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepTraceMonitorUtil } from "Common/Types/Monitor/MonitorStepTraceMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import TelemetryCheckWindow from "Common/Types/Monitor/TelemetryCheckWindow";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import {
  keyForHost,
  keyForKubernetesCluster,
} from "Common/Utils/Telemetry/EntityKey";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * ------------------------------------------------------------------
 * A LONG TELEMETRY CHECK READS ITS WHOLE MINUTES FROM THE ROLLUPS AND ITS
 * EDGES FROM THE RAW ROWS, AGAINST A REAL CLICKHOUSE (issue #11373).
 *
 * Since #11334 a check's window holds its start and not its end, and a
 * one-minute rollup served it only when both its ends were whole minutes.
 * A check's window ends at its monitor's own moment, so every long
 * ungrouped Metrics, Host or Kubernetes check of one metric, and every
 * Traces check of a service, read its whole window from the raw rows. Now
 * its whole minutes come from the rollup (the metric rollups, the span
 * projection) and only the partial minute at each end from the raw rows
 * (MinuteRollupRange.split).
 *
 * THE COUNTS. Every kind of check whose read is split runs through the
 * evaluation job and the services' own reads, over tables built from the
 * models - the rollups' views and the span table's projections with them -
 * for two windows of an hour (and of six hours, in five-minute buckets)
 * that share an edge at a monitor's own moment, 10:mm:07. Records sit on
 * every boundary a split has: each window's start, a millisecond either
 * side of its first and its last whole minute, its middle, a millisecond
 * before its end, ON the edge the two share, the second window's end, and
 * outside both. Each record's value is its own power of two, so a sum names
 * exactly the records a window read. Each case also runs as such a window
 * was read before (MinuteRollupRange.split answering no split): from the
 * raw rows, whole. Both read every record in its window once, the one on
 * the edge only in the later window.
 *
 * WHERE EACH PART CAME FROM. A metric case also writes two rows into the
 * rollup alone, as no raw row is: one in a whole minute of the first
 * window, which the split read counts - its whole minutes are the
 * rollup's - and one in the bucket of the first window's partial first
 * minute, which it must not - that minute is the raw rows'. A read of the
 * raw rows counts neither. A Traces case's count reads its whole minutes
 * through the span projection (system.query_log's projections).
 *
 * MEASURED. A busy project - a metric of 400 hosts of one series each over
 * 30 services, another of 10 hosts of 64 series each, and 1,500 spans a
 * minute, for three hours, every point every 10 s - is read as the checks
 * read it, over windows of 5 minutes to 3 hours, split and from the raw
 * rows: rows and bytes read, and time (median of five, system.query_log).
 * A window under half an hour is not split (MinuteRollupRange
 * .MIN_WINDOW_TO_SPLIT_MS): its raw read is small, and the split's two
 * edge reads read as many rows or a granule more. From half an hour on the
 * split never reads more bytes, and the longer the window and the denser
 * its rows, the less of them it reads: three hours of the dense metric,
 * 92 thousand rows and 7 MB against 691 thousand and 66 MB. One host of
 * the 400 is the exception: it shares its service's granules with a dozen
 * others, so the bloom filter on hostEntityKey holds its raw read to those
 * few granules at any length (2 to 6 here), as little as the split's three
 * reads read. Over half an hour or an hour the two read about as much, and
 * which reads a granule more moves with where the run's random ids put the
 * granule boundaries; over the three hours its raw read reads all of its
 * service's rows, and the split reads less (savesFromMinutes).
 *
 * Opt in by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18373:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18373 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/TelemetryMonitorLongWindowsClickhouse.test.ts
 *
 * TELEMETRY_LONG_WINDOWS_CLICKHOUSE_REPORT_FILE, when set, is where what
 * each check counted, and what each read cost, is written as JSON.
 * ------------------------------------------------------------------
 */

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

jest.mock("Common/Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneById: jest.fn(),
      getEnabledMonitorQuery: jest.fn(() => {
        return {};
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return { __esModule: true, default: { monitorResource: jest.fn() } };
});

// The metric catalog lives in Postgres: none here.
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(async () => {
        return [];
      }),
    },
  };
});

// An infrastructure step's resource is its own: no rename to follow.
jest.mock("Common/Server/Utils/Monitor/InfrastructureResourceBinding", () => {
  return {
    __esModule: true,
    default: {
      resolveForEvaluation: jest.fn(
        async (data: { monitorStep: unknown }): Promise<unknown> => {
          return data.monitorStep;
        },
      ),
    },
  };
});

jest.mock(
  "../../../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: { addTelemetryMonitorEvaluationJob: jest.fn() },
    };
  },
);

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return { __esModule: true, default: jest.fn() };
});

import MonitorService from "Common/Server/Services/MonitorService";
import MetricService from "Common/Server/Services/MetricService";
import SpanService from "Common/Server/Services/SpanService";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import TelemetryIngestBacklog from "Common/Server/Utils/Telemetry/TelemetryIngestBacklog";
import { processTelemetryMonitorEvaluationFromQueue } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

jest.setTimeout(15 * 60 * 1000);

const database: string = `telemetry_long_windows_test_${process.pid}_${Date.now()}`;

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;
const HOUR_MS: number = 60 * MINUTE_MS;

/*
 * The busy project, measured, for BUSY_HOURS: every point every 10 s.
 *
 *   - a fleet: SPARSE_HOSTS hosts, one series each of system.cpu.utilization,
 *     spread over BUSY_SERVICES services;
 *   - DENSE_HOSTS hosts, each its own service, each DENSE_SERIES series of
 *     system.cpu.time (16 cores in 4 states), as a host agent reports them;
 *   - BUSY_SPANS_A_MINUTE spans a minute over BUSY_SERVICES services, a
 *     tenth of them errors.
 */
const BUSY_HOURS: number = 3;
const BUSY_POINTS_EVERY_MS: number = 10 * SECOND_MS;
const BUSY_SERVICES: number = 30;
const SPARSE_HOSTS: number = 400;
const DENSE_HOSTS: number = 10;
const DENSE_SERIES: number = 64;
const BUSY_SPANS_A_MINUTE: number = 1500;
const MEASURED_RUNS: number = 5;
const MEASURED_WINDOWS_IN_MINUTES: Array<number> = [5, 15, 30, 60, 180];

function minuteOf(atMs: number): number {
  return Math.floor(atMs / MINUTE_MS) * MINUTE_MS;
}

/*
 * Where each record sits, around two windows of `lengthMs` that share the
 * edge E at a monitor's own moment (a whole second, not a whole minute):
 * window 1 is [E - length, E), window 2 is [E, E + length).
 */
function placementsOf(
  edgeMs: number,
  lengthMs: number,
): Array<{ atMs: number; name: string }> {
  const window1StartMs: number = edgeMs - lengthMs;
  const window1WholeFromMs: number =
    Math.ceil(window1StartMs / MINUTE_MS) * MINUTE_MS;
  const window1WholeToMs: number = minuteOf(edgeMs);

  return [
    { atMs: window1StartMs - 3 * SECOND_MS, name: "3 s before window 1" },
    { atMs: window1StartMs, name: "window 1's start" },
    {
      atMs: window1WholeFromMs - 1,
      name: "1 ms before window 1's first whole minute",
    },
    { atMs: window1WholeFromMs, name: "window 1's first whole minute" },
    { atMs: window1StartMs + lengthMs / 2, name: "the middle of window 1" },
    {
      atMs: window1WholeToMs - 1,
      name: "1 ms before window 1's last partial minute",
    },
    { atMs: window1WholeToMs, name: "window 1's last partial minute" },
    { atMs: edgeMs - 1, name: "1 ms before the edge" },
    { atMs: edgeMs, name: "ON THE EDGE" },
    { atMs: edgeMs + lengthMs / 2, name: "the middle of window 2" },
    { atMs: edgeMs + lengthMs - 1, name: "1 ms before window 2's end" },
    { atMs: edgeMs + lengthMs, name: "window 2's end" },
    { atMs: edgeMs + lengthMs + 30 * SECOND_MS, name: "30 s after window 2" },
  ];
}

const EDGE_INDEX: number = 8;

// A record's value on a metric: its own power of two.
function valueOf(index: number): number {
  return 2 ** index;
}

// The rollup-only rows: one in a whole minute of window 1, one in its first partial minute's bucket.
const WHOLE_MINUTE_MARKER: number = 2 ** 20;
const EDGE_BUCKET_MARKER: number = 2 ** 21;

type Reading = "count" | "sum";

interface LongCase {
  name: string;
  monitorType: MonitorType;
  reading: Reading;
  lengthMs: number;
  // The rollup the case's read is served by, when it is a metric's.
  rollup?:
    | {
        tableName: string;
        keyColumn: string;
        keyOf: (ids: CaseIds) => string;
      }
    | undefined;
  step: (ids: CaseIds) => MonitorStep;
  insert: (ids: CaseIds, times: Array<Date>) => Promise<void>;
  read: (response: JSONObject) => number;
}

interface CaseIds {
  projectId: ObjectID;
  serviceId: ObjectID;
  monitorId: ObjectID;
}

interface LongCaseCounted {
  edgeAt: string;
  split: [number, number];
  raw: [number, number];
  expected: [number, number];
}

interface ReadCost {
  readRows: number;
  readBytes: number;
  durationMs: number;
  projections: Array<string>;
}

let clickhouse: ClickhouseDatabase;
let client: ClickhouseClient;

async function createTable(modelType: {
  new (): AnalyticsBaseModel;
}): Promise<void> {
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

  // Its projections, as the analytics schema sync adds them.
  for (const projection of model.projections || []) {
    await client.command({
      query: `ALTER TABLE ${database}.${model.tableName} ADD PROJECTION IF NOT EXISTS ${projection.name} (${projection.query})`,
    });
  }

  // A rollup's view, as the analytics schema sync makes it.
  for (const view of model.materializedViews || []) {
    await client.command({ query: view.query });
  }
}

async function insert(
  modelType: { new (): AnalyticsBaseModel },
  rows: Array<JSONObject>,
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();

  for (const row of rows.slice(0, 1)) {
    for (const key of Object.keys(row)) {
      if (!model.getTableColumn(key)) {
        throw new Error(`${model.tableName} has no column ${key}`);
      }
    }
  }

  await client.insert({
    table: `${database}.${model.tableName}`,
    format: "JSONEachRow",
    values: rows,
  });
}

function asDateTime64(at: Date): string {
  return OneUptimeDate.toClickhouseDateTime64(
    at,
    (BigInt(at.getTime()) * BigInt(1000000)).toString(),
  );
}

function retentionDate(): string {
  return OneUptimeDate.toClickhouseDateTime(
    OneUptimeDate.addRemoveDays(new Date(), 30),
  );
}

function nanos(at: Date): string {
  return (BigInt(at.getTime()) * BigInt(1000000)).toString();
}

function stepsOf(step: MonitorStep): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

// One metric, summed: each record's value tells it apart.
function summedMetric(metricName: string): MetricsViewConfig {
  return {
    queryConfigs: [
      {
        metricQueryData: {
          filterData: {
            metricName: metricName,
            aggegationType: AggregationType.Sum,
          },
        },
      },
    ],
    formulaConfigs: [],
  } as unknown as MetricsViewConfig;
}

function sumOfMetricResult(response: JSONObject): number {
  const results: Array<AggregatedResult> =
    (response["metricResult"] as unknown as Array<AggregatedResult>) || [];

  return (results[0]?.data || []).reduce(
    (sum: number, row: AggregatedModel): number => {
      return sum + Number(row.value);
    },
    0,
  );
}

async function insertMetrics(
  ids: CaseIds,
  times: Array<Date>,
  extra: { attributes?: JSONObject; entityKeyColumns?: JSONObject },
): Promise<void> {
  await insert(
    Metric,
    times.map((at: Date, index: number): JSONObject => {
      return {
        projectId: ids.projectId.toString(),
        primaryEntityId: ids.serviceId.toString(),
        primaryEntityType: "Service",
        name: "long.points",
        time: asDateTime64(at),
        timeUnixNano: nanos(at),
        value: valueOf(index),
        metricPointType: "Gauge",
        attributes: extra.attributes || {},
        attributeKeys: Object.keys(extra.attributes || {}),
        ...(extra.entityKeyColumns || {}),
        retentionDate: retentionDate(),
      };
    }),
  );
}

async function insertSpans(ids: CaseIds, times: Array<Date>): Promise<void> {
  await insert(
    Span,
    times.map((at: Date): JSONObject => {
      return {
        projectId: ids.projectId.toString(),
        primaryEntityId: ids.serviceId.toString(),
        primaryEntityType: "Service",
        startTime: asDateTime64(at),
        startTimeUnixNano: nanos(at),
        endTime: asDateTime64(at),
        endTimeUnixNano: nanos(at),
        durationUnixNano: 1000000,
        traceId: ObjectID.generate().toString().split("-").join(""),
        spanId: ObjectID.generate().toString().split("-").join("").slice(0, 16),
        name: "POST /checkout",
        statusCode: SpanStatus.Error,
        retentionDate: retentionDate(),
      };
    }),
  );
}

const MINUTE_ROLLUP: LongCase["rollup"] = {
  tableName: new MetricItemAggMV1m().tableName,
  keyColumn: "primaryEntityId",
  keyOf: (ids: CaseIds): string => {
    return ids.serviceId.toString();
  },
};

const CASES: Array<LongCase> = [
  {
    name: "Metrics, one metric, the past hour",
    monitorType: MonitorType.Metrics,
    reading: "sum",
    lengthMs: HOUR_MS,
    rollup: MINUTE_ROLLUP,
    step: (): MonitorStep => {
      return new MonitorStep().setMetricMonitor({
        metricViewConfig: summedMetric("long.points"),
        rollingTime: RollingTime.Past1Hour,
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertMetrics(ids, times, {});
    },
    read: sumOfMetricResult,
  },
  {
    name: "Metrics, one metric, the past six hours, in five-minute buckets",
    monitorType: MonitorType.Metrics,
    reading: "sum",
    lengthMs: 6 * HOUR_MS,
    rollup: MINUTE_ROLLUP,
    step: (): MonitorStep => {
      return new MonitorStep().setMetricMonitor({
        metricViewConfig: summedMetric("long.points"),
        rollingTime: RollingTime.Past6Hours,
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertMetrics(ids, times, {});
    },
    read: sumOfMetricResult,
  },
  {
    name: "Host, the past hour",
    monitorType: MonitorType.Host,
    reading: "sum",
    lengthMs: HOUR_MS,
    rollup: {
      tableName: new MetricItemAggMV1mByHostV2().tableName,
      keyColumn: "hostEntityKey",
      keyOf: (ids: CaseIds): string => {
        return keyForHost(ids.projectId.toString(), "web-01");
      },
    },
    step: (): MonitorStep => {
      return new MonitorStep().setHostMonitor({
        hostIdentifier: "web-01",
        metricViewConfig: summedMetric("long.points"),
        rollingTime: RollingTime.Past1Hour,
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertMetrics(ids, times, {
        attributes: { "resource.host.name": "web-01" },
        entityKeyColumns: {
          hostEntityKey: keyForHost(ids.projectId.toString(), "web-01"),
        },
      });
    },
    read: sumOfMetricResult,
  },
  {
    name: "Kubernetes cluster, the past hour",
    monitorType: MonitorType.Kubernetes,
    reading: "sum",
    lengthMs: HOUR_MS,
    rollup: {
      tableName: new MetricItemAggMV1mByK8sCluster().tableName,
      keyColumn: "k8sClusterEntityKey",
      keyOf: (ids: CaseIds): string => {
        return keyForKubernetesCluster(ids.projectId.toString(), "prod-eu");
      },
    },
    step: (): MonitorStep => {
      return new MonitorStep().setKubernetesMonitor({
        ...MonitorStepKubernetesMonitorUtil.getDefault(),
        clusterIdentifier: "prod-eu",
        metricViewConfig: summedMetric("long.points"),
        rollingTime: RollingTime.Past1Hour,
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertMetrics(ids, times, {
        attributes: { "resource.k8s.cluster.name": "prod-eu" },
        entityKeyColumns: {
          k8sClusterEntityKey: keyForKubernetesCluster(
            ids.projectId.toString(),
            "prod-eu",
          ),
        },
      });
    },
    read: sumOfMetricResult,
  },
  {
    name: "Traces of a service's error spans, the past hour",
    monitorType: MonitorType.Traces,
    reading: "count",
    lengthMs: HOUR_MS,
    step: (ids: CaseIds): MonitorStep => {
      return new MonitorStep().setTraceMonitor({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        lastXSecondsOfSpans: 3600,
        telemetryServiceIds: [ids.serviceId],
        spanStatuses: [SpanStatus.Error],
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertSpans(ids, times);
    },
    read: (response: JSONObject): number => {
      return Number(response["spanCount"]);
    },
  },
];

integration(
  "#11373: a long check reads its whole minutes from the rollups and its edges from the raw rows, against a real ClickHouse",
  () => {
    const original: Map<unknown, Record<string, unknown>> = new Map();
    const captured: Map<string, JSONObject> = new Map();
    const counted: Record<string, LongCaseCounted> = {};
    const costs: Record<string, Record<string, ReadCost>> = {};

    // The edge: a whole second, not a whole minute - a monitor's own moment.
    const now: number = Date.now();
    const EDGE: Date = new Date(minuteOf(now) - 14 * HOUR_MS + 7 * SECOND_MS);
    const BUSY_PROJECT: ObjectID = ObjectID.generate();
    const BUSY_END: Date = new Date(
      minuteOf(now) - 20 * MINUTE_MS + 7 * SECOND_MS,
    );
    const busyServices: Array<ObjectID> = Array.from(
      { length: BUSY_SERVICES },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );
    const denseServices: Array<ObjectID> = Array.from(
      { length: DENSE_HOSTS },
      (): ObjectID => {
        return ObjectID.generate();
      },
    );

    const idsOf: Map<string, CaseIds> = new Map();

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error(
          "TEST_CLICKHOUSE_URL must point at a local, disposable ClickHouse server.",
        );
      }

      const options: ClickHouseClientConfigOptions = {
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        database: database,
        request_timeout: 300000,
        max_open_connections: 20,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      for (const modelType of [
        Span,
        Metric,
        MetricItemAggMV1m,
        MetricItemAggMV1mByHostV2,
        MetricItemAggMV1mByK8sCluster,
      ] as Array<{ new (): AnalyticsBaseModel }>) {
        await createTable(modelType);
      }

      for (const service of [SpanService, MetricService] as Array<unknown>) {
        const target: Record<string, unknown> = service as Record<
          string,
          unknown
        >;

        original.set(service, {
          database: target["database"],
          databaseClient: target["databaseClient"],
          ingestDatabase: target["ingestDatabase"],
          ingestDatabaseClient: target["ingestDatabaseClient"],
        });

        Object.assign(target, {
          database: clickhouse,
          databaseClient: client,
          ingestDatabase: clickhouse,
          ingestDatabaseClient: client,
        });
      }

      for (const longCase of CASES) {
        const ids: CaseIds = {
          projectId: ObjectID.generate(),
          serviceId: ObjectID.generate(),
          monitorId: ObjectID.generate(),
        };
        idsOf.set(longCase.name, ids);

        await longCase.insert(
          ids,
          placementsOf(EDGE.getTime(), longCase.lengthMs).map(
            (placed: { atMs: number }): Date => {
              return new Date(placed.atMs);
            },
          ),
        );

        if (longCase.rollup) {
          await insertRollupMarkers(longCase, ids);
        }
      }

      (MonitorService.findOneById as unknown as jest.Mock).mockImplementation(
        (async (args: { id: ObjectID }): Promise<Monitor> => {
          const longCase: LongCase = CASES.find(
            (candidate: LongCase): boolean => {
              return (
                idsOf.get(candidate.name)!.monitorId.toString() ===
                args.id.toString()
              );
            },
          )!;
          const ids: CaseIds = idsOf.get(longCase.name)!;

          const monitor: Monitor = new Monitor(ids.monitorId);
          monitor.projectId = ids.projectId;
          monitor.monitorType = longCase.monitorType;
          monitor.monitorSteps = stepsOf(longCase.step(ids));
          return monitor;
        }) as never,
      );

      (
        MonitorResourceUtil.monitorResource as unknown as jest.Mock
      ).mockImplementation((async (
        response: JSONObject & { monitorId: ObjectID },
        options: { judgedWindow: { endsAt: Date } },
      ): Promise<null> => {
        captured.set(
          `${response.monitorId.toString()}@${new Date(
            options.judgedWindow.endsAt,
          ).toISOString()}`,
          response,
        );
        return null;
      }) as never);

      // No receiving ledger and no ingest queue: OneUptime kept up throughout.
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);
      jest
        .spyOn(TelemetryIngestBacklog, "getOldestWaitingSince")
        .mockResolvedValue(null);
      ReceivingCoverage.clearCache();

      await insertBusyProject();
    });

    afterAll(async (): Promise<void> => {
      jest.restoreAllMocks();

      for (const [service, saved] of original) {
        Object.assign(service as Record<string, unknown>, saved);
      }

      if (client) {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      }

      if (clickhouse) {
        await clickhouse.disconnect();
      }

      const reportFile: string | undefined =
        process.env["TELEMETRY_LONG_WINDOWS_CLICKHOUSE_REPORT_FILE"];

      if (reportFile) {
        fs.writeFileSync(
          reportFile,
          JSON.stringify({ counted, costs }, null, 2),
        );
      }
    });

    /*
     * Rows written into a metric case's rollup alone, as its view would
     * write them from a raw row that is not there: one in a whole minute
     * of window 1, one in the bucket of window 1's first partial minute.
     */
    async function insertRollupMarkers(
      longCase: LongCase,
      ids: CaseIds,
    ): Promise<void> {
      const window1StartMs: number = EDGE.getTime() - longCase.lengthMs;
      const markers: Array<{ bucketMs: number; value: number }> = [
        {
          bucketMs: minuteOf(window1StartMs + longCase.lengthMs / 4),
          value: WHOLE_MINUTE_MARKER,
        },
        { bucketMs: minuteOf(window1StartMs), value: EDGE_BUCKET_MARKER },
      ];

      for (const marker of markers) {
        await client.command({
          query: `INSERT INTO ${database}.${longCase.rollup!.tableName}
            (projectId, name, ${longCase.rollup!.keyColumn}, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
            SELECT {projectId:String}, 'long.points', {key:String}, toDateTime({bucket:UInt32}),
              sumState(toFloat64({value:Float64})), countState(toFloat64({value:Float64})),
              minState(toFloat64({value:Float64})), maxState(toFloat64({value:Float64})),
              now() + INTERVAL 30 DAY`,
          query_params: {
            projectId: ids.projectId.toString(),
            key: longCase.rollup!.keyOf(ids),
            bucket: Math.floor(marker.bucketMs / SECOND_MS),
            value: marker.value,
          },
        });
      }
    }

    // A busy project's telemetry, for BUSY_HOURS to BUSY_END, written by the server.
    async function insertBusyProject(): Promise<void> {
      const fromMs: number = BUSY_END.getTime() - BUSY_HOURS * HOUR_MS;
      const ticks: number = (BUSY_HOURS * HOUR_MS) / BUSY_POINTS_EVERY_MS;
      const metricTable: string = `${database}.${new Metric().tableName}`;

      // The fleet: one series a host, the hosts over BUSY_SERVICES services.
      await client.command({
        query: `INSERT INTO ${metricTable}
          (projectId, primaryEntityId, primaryEntityType, name, time, timeUnixNano, value,
           metricPointType, attributes, attributeKeys, hostEntityKey, retentionDate)
          SELECT {projectId:String},
            arrayElement({services:Array(String)}, (number % {hosts:UInt32}) % {serviceCount:UInt32} + 1),
            'Service', 'system.cpu.utilization',
            fromUnixTimestamp64Milli(toInt64({fromMs:Int64} + intDiv(number, {hosts:UInt32}) * {everyMs:Int64} + number % {hosts:UInt32})),
            toUInt64(({fromMs:Int64} + intDiv(number, {hosts:UInt32}) * {everyMs:Int64} + number % {hosts:UInt32}) * 1000000),
            (number % 100) / 100, 'Gauge',
            map('resource.host.name', concat('host-', toString(number % {hosts:UInt32}))),
            ['resource.host.name'],
            arrayElement({keys:Array(String)}, number % {hosts:UInt32} + 1),
            now() + INTERVAL 30 DAY
          FROM numbers({rows:UInt64})`,
        query_params: {
          projectId: BUSY_PROJECT.toString(),
          services: busyServices.map((id: ObjectID): string => {
            return id.toString();
          }),
          serviceCount: BUSY_SERVICES,
          hosts: SPARSE_HOSTS,
          fromMs: fromMs,
          everyMs: BUSY_POINTS_EVERY_MS,
          keys: Array.from(
            { length: SPARSE_HOSTS },
            (_value: unknown, host: number): string => {
              return keyForHost(BUSY_PROJECT.toString(), `host-${host}`);
            },
          ),
          rows: SPARSE_HOSTS * ticks,
        },
      });

      // The dense hosts: each its own service, DENSE_SERIES series each.
      await client.command({
        query: `INSERT INTO ${metricTable}
          (projectId, primaryEntityId, primaryEntityType, name, time, timeUnixNano, value,
           metricPointType, attributes, attributeKeys, hostEntityKey, retentionDate)
          SELECT {projectId:String},
            arrayElement({services:Array(String)}, number % {hosts:UInt32} + 1),
            'Service', 'system.cpu.time',
            fromUnixTimestamp64Milli(toInt64({fromMs:Int64} + intDiv(number, {hosts:UInt32} * {series:UInt32}) * {everyMs:Int64} + number % {hosts:UInt32})),
            toUInt64(({fromMs:Int64} + intDiv(number, {hosts:UInt32} * {series:UInt32}) * {everyMs:Int64} + number % {hosts:UInt32}) * 1000000),
            (number % 1000) / 10, 'Gauge',
            map('resource.host.name', concat('dense-', toString(number % {hosts:UInt32})),
                'cpu', toString(intDiv(number, {hosts:UInt32}) % 16),
                'state', arrayElement(['user', 'system', 'idle', 'wait'], intDiv(number, {hosts:UInt32} * 16) % 4 + 1)),
            ['resource.host.name', 'cpu', 'state'],
            arrayElement({keys:Array(String)}, number % {hosts:UInt32} + 1),
            now() + INTERVAL 30 DAY
          FROM numbers({rows:UInt64})`,
        query_params: {
          projectId: BUSY_PROJECT.toString(),
          services: denseServices.map((id: ObjectID): string => {
            return id.toString();
          }),
          hosts: DENSE_HOSTS,
          series: DENSE_SERIES,
          fromMs: fromMs,
          everyMs: BUSY_POINTS_EVERY_MS,
          keys: Array.from(
            { length: DENSE_HOSTS },
            (_value: unknown, host: number): string => {
              return keyForHost(BUSY_PROJECT.toString(), `dense-${host}`);
            },
          ),
          rows: DENSE_HOSTS * DENSE_SERIES * ticks,
        },
      });

      // The spans: BUSY_SPANS_A_MINUTE a minute, a tenth of them errors.
      await client.command({
        query: `INSERT INTO ${database}.${new Span().tableName}
          (projectId, primaryEntityId, primaryEntityType, startTime, startTimeUnixNano,
           endTime, endTimeUnixNano, durationUnixNano, traceId, spanId, name, statusCode, retentionDate)
          SELECT {projectId:String},
            arrayElement({services:Array(String)}, number % {serviceCount:UInt32} + 1),
            'Service',
            fromUnixTimestamp64Milli(toInt64({fromMs:Int64} + intDiv(number * 60000, {perMinute:UInt32}))),
            toUInt64(({fromMs:Int64} + intDiv(number * 60000, {perMinute:UInt32})) * 1000000),
            fromUnixTimestamp64Milli(toInt64({fromMs:Int64} + intDiv(number * 60000, {perMinute:UInt32}))),
            toUInt64(({fromMs:Int64} + intDiv(number * 60000, {perMinute:UInt32})) * 1000000),
            toUInt64(1000000 + (number % 1000) * 1000),
            lower(hex(randomString(16))), lower(hex(randomString(8))), 'GET /items',
            if(number % 10 = 0, {errorCode:Int32}, {okCode:Int32}),
            now() + INTERVAL 30 DAY
          FROM numbers({rows:UInt64})`,
        query_params: {
          projectId: BUSY_PROJECT.toString(),
          services: busyServices.map((id: ObjectID): string => {
            return id.toString();
          }),
          serviceCount: BUSY_SERVICES,
          fromMs: fromMs,
          perMinute: BUSY_SPANS_A_MINUTE,
          errorCode: SpanStatus.Error,
          okCode: SpanStatus.Ok,
          rows: BUSY_SPANS_A_MINUTE * BUSY_HOURS * 60,
        },
      });

      // Merged, as a busy server's background merges keep its parts few.
      for (const table of [
        new Metric().tableName,
        new Span().tableName,
        new MetricItemAggMV1m().tableName,
        new MetricItemAggMV1mByHostV2().tableName,
      ]) {
        await client.command({
          query: `OPTIMIZE TABLE ${database}.${table} FINAL`,
        });
      }
    }

    // The check due at `dueAt`, run by the evaluation job: what it read.
    async function check(longCase: LongCase, dueAt: Date): Promise<number> {
      const ids: CaseIds = idsOf.get(longCase.name)!;

      await processTelemetryMonitorEvaluationFromQueue({
        monitorId: ids.monitorId.toString(),
        projectId: ids.projectId.toString(),
        dueAt: dueAt.toISOString(),
      } as never);

      const response: JSONObject | undefined = captured.get(
        `${ids.monitorId.toString()}@${dueAt.toISOString()}`,
      );

      expect(response).toBeDefined();

      return longCase.read(response!);
    }

    // As such a window was read before this change: from the raw rows, whole.
    async function readRaw<T>(read: () => Promise<T>): Promise<T> {
      const noSplit: SpyInstance<typeof MinuteRollupRange.split> = jest
        .spyOn(MinuteRollupRange, "split")
        .mockReturnValue(null);

      try {
        return await read();
      } finally {
        noSplit.mockRestore();
      }
    }

    function expectedOf(longCase: LongCase): [number, number] {
      const placements: Array<{ atMs: number }> = placementsOf(
        EDGE.getTime(),
        longCase.lengthMs,
      );
      const windows: Array<{ startMs: number; endMs: number }> = [
        {
          startMs: EDGE.getTime() - longCase.lengthMs,
          endMs: EDGE.getTime(),
        },
        {
          startMs: EDGE.getTime(),
          endMs: EDGE.getTime() + longCase.lengthMs,
        },
      ];

      return windows.map((window: { startMs: number; endMs: number }) => {
        return placements.reduce(
          (total: number, placed: { atMs: number }, index: number): number => {
            if (placed.atMs < window.startMs || placed.atMs >= window.endMs) {
              return total;
            }

            return total + (longCase.reading === "sum" ? valueOf(index) : 1);
          },
          0,
        );
      }) as [number, number];
    }

    describe.each(CASES)(
      "$name: two checks a window apart, at a monitor's own moment",
      (longCase: LongCase) => {
        test("each window reads every record in it once, the one on the edge only in the later window, split or from the raw rows alone", async () => {
          const dueAts: [Date, Date] = [
            EDGE,
            new Date(EDGE.getTime() + longCase.lengthMs),
          ];

          const split: [number, number] = [
            await check(longCase, dueAts[0]),
            await check(longCase, dueAts[1]),
          ];
          const raw: [number, number] = await readRaw(
            async (): Promise<[number, number]> => {
              return [
                await check(longCase, dueAts[0]),
                await check(longCase, dueAts[1]),
              ];
            },
          );
          const expected: [number, number] = expectedOf(longCase);

          counted[longCase.name] = {
            edgeAt: EDGE.toISOString(),
            split: split,
            raw: raw,
            expected: expected,
          };

          // From the raw rows alone: exactly the records of each window.
          expect(raw).toEqual(expected);

          if (longCase.reading === "sum") {
            /*
             * Split: the same records - the edge in window 2 alone - and
             * window 1's whole-minute marker, which only the rollup holds:
             * its whole minutes are the rollup's. Not the marker in the
             * bucket of its first partial minute: that minute is the raw
             * rows'.
             */
            expect(split).toEqual([
              expected[0] + WHOLE_MINUTE_MARKER,
              expected[1],
            ]);
            expect(split[0] & valueOf(EDGE_INDEX)).toBe(0);
            expect(split[1] & valueOf(EDGE_INDEX)).toBe(valueOf(EDGE_INDEX));
            expect(split[0] & EDGE_BUCKET_MARKER).toBe(0);
            expect(raw[0] & WHOLE_MINUTE_MARKER).toBe(0);
          } else {
            expect(split).toEqual(expected);
          }
        });
      },
    );

    test("the Traces check's whole minutes are counted by the span projection, its edges from the rows", async () => {
      const longCase: LongCase = CASES.find((candidate: LongCase): boolean => {
        return candidate.monitorType === MonitorType.Traces;
      })!;
      const ids: CaseIds = idsOf.get(longCase.name)!;
      const window: InBetween<Date> = TelemetryCheckWindow.ofSeconds(
        3600,
        EDGE,
      );

      const cost: ReadCost = await costOf(
        SpanService.toCountStatement({
          query: {
            projectId: ids.projectId,
            primaryEntityId: new Includes([ids.serviceId]),
            statusCode: new Includes([SpanStatus.Error]),
            startTime: window,
          } as never,
          props: { isRoot: true },
        }),
      );

      expect(cost.projections).toEqual(
        expect.arrayContaining([
          expect.stringContaining("proj_hist_by_minute"),
        ]),
      );
    });

    // What a statement costs, run alone, from system.query_log.
    async function costOf(statement: Statement): Promise<ReadCost> {
      const queryId: string = ObjectID.generate().toString();

      const result: { json: () => Promise<unknown> } = (await client.query({
        query: statement.query,
        query_params: statement.query_params,
        query_id: queryId,
        format: "JSON",
      })) as never;
      await result.json();

      await client.command({ query: "SYSTEM FLUSH LOGS" });

      const logged: { json: () => Promise<{ data: Array<JSONObject> }> } =
        (await client.query({
          query: `SELECT read_rows, read_bytes, query_duration_ms, projections FROM system.query_log WHERE query_id = {queryId:String} AND type = 'QueryFinish'`,
          query_params: { queryId: queryId },
          format: "JSON",
        })) as never;
      const row: JSONObject = (await logged.json()).data[0]!;

      return {
        readRows: Number(row["read_rows"]),
        readBytes: Number(row["read_bytes"]),
        durationMs: Number(row["query_duration_ms"]),
        projections: (row["projections"] as Array<string>) || [],
      };
    }

    // The median cost of MEASURED_RUNS runs of a statement.
    async function medianCostOf(build: () => Statement): Promise<ReadCost> {
      const runs: Array<ReadCost> = [];

      for (let run: number = 0; run < MEASURED_RUNS; run++) {
        runs.push(await costOf(build()));
      }

      const median: (values: Array<number>) => number = (
        values: Array<number>,
      ): number => {
        return [...values].sort((a: number, b: number): number => {
          return a - b;
        })[Math.floor(values.length / 2)]!;
      };

      return {
        readRows: median(
          runs.map((run: ReadCost): number => {
            return run.readRows;
          }),
        ),
        readBytes: median(
          runs.map((run: ReadCost): number => {
            return run.readBytes;
          }),
        ),
        durationMs: median(
          runs.map((run: ReadCost): number => {
            return run.durationMs;
          }),
        ),
        projections: runs[0]!.projections,
      };
    }

    function metricAggregate(data: {
      lengthMs: number;
      metricName?: string | undefined;
      attributes?: JSONObject | undefined;
    }): AggregateBy<Metric> {
      const window: InBetween<Date> = TelemetryCheckWindow.ofSeconds(
        data.lengthMs / SECOND_MS,
        BUSY_END,
      );

      return {
        query: {
          projectId: BUSY_PROJECT,
          name: data.metricName || "system.cpu.utilization",
          time: window,
          ...(data.attributes ? { attributes: data.attributes } : {}),
        } as AggregateBy<Metric>["query"],
        aggregationType: AggregationType.Avg,
        aggregateColumnName: "value",
        aggregationTimestampColumnName: "time",
        startTimestamp: window.startValue,
        endTimestamp: window.endValue,
        limit: 10000,
        skip: 0,
        sort: { time: SortOrder.Ascending } as AggregateBy<Metric>["sort"],
        props: { isRoot: true },
      };
    }

    /*
     * A Metrics check's read, a Host check's and a Traces check's, each as
     * long as the windows a check can have, split and from the raw rows.
     * `savesFromMinutes`: from how long a window the split reads fewer bytes
     * than the raw rows' read - half an hour, where it starts, for every read
     * whose raw rows grow with its window.
     */
    const MEASURED: Array<{
      name: string;
      minutes: number;
      savesFromMinutes: number;
      build: () => Statement;
    }> = MEASURED_WINDOWS_IN_MINUTES.flatMap((minutes: number) => {
      return [
        {
          name: `Metrics, one metric of ${SPARSE_HOSTS} hosts in ${BUSY_SERVICES} services, one series each, the past ${minutes} minutes`,
          minutes: minutes,
          savesFromMinutes: 30,
          build: (): Statement => {
            return MetricService.toAggregateStatement(
              metricAggregate({ lengthMs: minutes * MINUTE_MS }),
            ).statement;
          },
        },
        {
          name: `Host, one of ${SPARSE_HOSTS} with one series, the past ${minutes} minutes`,
          minutes: minutes,
          /*
           * It shares its service's granules with a dozen other hosts: the
           * bloom filter on hostEntityKey holds its raw read to those few
           * granules at any length, as little as the split's three reads -
           * the rollup's and an edge's at each end, a granule each at the
           * least - read. Over half an hour or an hour the two read about as
           * much, and which reads a granule more moves with where the run's
           * random ids put the granule boundaries; over the three hours its
           * service's rows fill, the split reads less.
           */
          savesFromMinutes: BUSY_HOURS * 60,
          build: (): Statement => {
            return MetricService.toAggregateStatement(
              metricAggregate({
                lengthMs: minutes * MINUTE_MS,
                attributes: { "resource.host.name": "host-7" },
              }),
            ).statement;
          },
        },
        {
          name: `Metrics, one metric of ${DENSE_HOSTS} hosts with ${DENSE_SERIES} series each, the past ${minutes} minutes`,
          minutes: minutes,
          savesFromMinutes: 30,
          build: (): Statement => {
            return MetricService.toAggregateStatement(
              metricAggregate({
                lengthMs: minutes * MINUTE_MS,
                metricName: "system.cpu.time",
              }),
            ).statement;
          },
        },
        {
          name: `Host, one of ${DENSE_HOSTS} with ${DENSE_SERIES} series, the past ${minutes} minutes`,
          minutes: minutes,
          savesFromMinutes: 30,
          build: (): Statement => {
            return MetricService.toAggregateStatement(
              metricAggregate({
                lengthMs: minutes * MINUTE_MS,
                metricName: "system.cpu.time",
                attributes: { "resource.host.name": "dense-3" },
              }),
            ).statement;
          },
        },
        {
          name: `Traces of a service's error spans, ${BUSY_SPANS_A_MINUTE} spans a minute, the past ${minutes} minutes`,
          minutes: minutes,
          savesFromMinutes: 30,
          build: (): Statement => {
            return SpanService.toCountStatement({
              query: {
                projectId: BUSY_PROJECT,
                primaryEntityId: new Includes([busyServices[10]!]),
                statusCode: new Includes([SpanStatus.Error]),
                startTime: TelemetryCheckWindow.ofSeconds(
                  (minutes * MINUTE_MS) / SECOND_MS,
                  BUSY_END,
                ),
              } as never,
              props: { isRoot: true },
            });
          },
        },
      ];
    });

    test("measured on a busy project: a window of half an hour or more is split and reads no more bytes than the raw rows' read (one host of a fleet: over the three hours), three hours of dense rows a third of the rows or less, and a shorter window is read from the raw rows as before", async () => {
      for (const measured of MEASURED) {
        const split: ReadCost = await medianCostOf(measured.build);
        const raw: ReadCost = await readRaw(async (): Promise<ReadCost> => {
          return medianCostOf(measured.build);
        });

        costs[measured.name] = { split: split, raw: raw };
      }

      expect(Object.keys(costs)).toHaveLength(MEASURED.length);

      for (const measured of MEASURED) {
        const split: ReadCost = costs[measured.name]!["split"]!;
        const raw: ReadCost = costs[measured.name]!["raw"]!;

        if (
          measured.minutes * MINUTE_MS <
          MinuteRollupRange.MIN_WINDOW_TO_SPLIT_MS
        ) {
          // Not split: the same read of the raw rows.
          expect({ name: measured.name, rows: split.readRows }).toEqual({
            name: measured.name,
            rows: raw.readRows,
          });
          continue;
        }

        // Split: never more to read than the raw rows' read, in bytes, from where it saves.
        if (measured.minutes < measured.savesFromMinutes) {
          continue;
        }

        expect({
          name: measured.name,
          split: split.readBytes,
          raw: raw.readBytes,
          noMore: split.readBytes <= raw.readBytes,
        }).toEqual({
          name: measured.name,
          split: split.readBytes,
          raw: raw.readBytes,
          noMore: true,
        });
      }

      /*
       * Three hours of what lies dense: a third of the rows or less (a
       * seventh, a quarter and a twelfth measured), and a tenth of the
       * bytes or less.
       */
      for (const measured of MEASURED.filter(
        (candidate: { name: string; minutes: number }): boolean => {
          return (
            candidate.minutes === 180 &&
            (candidate.name.includes(`${DENSE_SERIES} series`) ||
              candidate.name.startsWith("Traces"))
          );
        },
      )) {
        const split: ReadCost = costs[measured.name]!["split"]!;
        const raw: ReadCost = costs[measured.name]!["raw"]!;

        expect({
          name: measured.name,
          rows: [split.readRows, raw.readRows],
          aThirdOrLess: split.readRows * 3 <= raw.readRows,
        }).toEqual({
          name: measured.name,
          rows: [split.readRows, raw.readRows],
          aThirdOrLess: true,
        });
      }
    });

    test("measured: the split read answers what the raw rows' read answers, bucket by bucket, on the busy project", async () => {
      for (const minutes of [5, 60, 180]) {
        for (const read of [
          { metricName: "system.cpu.utilization", attributes: undefined },
          {
            metricName: "system.cpu.utilization",
            attributes: { "resource.host.name": "host-7" },
          },
          { metricName: "system.cpu.time", attributes: undefined },
          {
            metricName: "system.cpu.time",
            attributes: { "resource.host.name": "dense-3" },
          },
        ]) {
          const split: AggregatedResult = await MetricService.aggregateBy(
            metricAggregate({ lengthMs: minutes * MINUTE_MS, ...read }),
          );
          const raw: AggregatedResult = await readRaw(
            async (): Promise<AggregatedResult> => {
              return MetricService.aggregateBy(
                metricAggregate({ lengthMs: minutes * MINUTE_MS, ...read }),
              );
            },
          );

          // The same buckets, each the same mean to within a float sum's order.
          expect(
            split.data.map((row: AggregatedModel): string => {
              return new Date(row.timestamp).toISOString();
            }),
          ).toEqual(
            raw.data.map((row: AggregatedModel): string => {
              return new Date(row.timestamp).toISOString();
            }),
          );
          expect(split.data.length).toBeGreaterThanOrEqual(minutes);

          split.data.forEach((row: AggregatedModel, index: number): void => {
            const rawValue: number = Number(raw.data[index]!.value);
            expect(
              Math.abs(Number(row.value) - rawValue) <=
                1e-9 * Math.max(1, Math.abs(rawValue)),
            ).toBe(true);
          });
        }
      }

      for (const minutes of [5, 60, 180]) {
        const countQuery: () => Promise<number> = async (): Promise<number> => {
          return (
            await SpanService.countBy({
              query: {
                projectId: BUSY_PROJECT,
                primaryEntityId: new Includes([busyServices[10]!]),
                statusCode: new Includes([SpanStatus.Error]),
                startTime: TelemetryCheckWindow.ofSeconds(
                  minutes * 60,
                  BUSY_END,
                ),
              } as never,
              skip: 0,
              limit: 10000000,
              props: { isRoot: true },
            })
          ).toNumber();
        };

        const split: number = await countQuery();
        const raw: number = await readRaw(countQuery);

        expect(split).toBe(raw);
        expect(split).toBeGreaterThan(0);
      }
    });
  },
);
