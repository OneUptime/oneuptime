import fs from "fs";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MetricItemAggMV1m from "Common/Models/AnalyticsModels/MetricItemAggMV1m";
import MetricItemAggMV1mByHostV2 from "Common/Models/AnalyticsModels/MetricItemAggMV1mByHostV2";
import MetricItemAggMV1mByK8sCluster from "Common/Models/AnalyticsModels/MetricItemAggMV1mByK8sCluster";
import Profile from "Common/Models/AnalyticsModels/Profile";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepExceptionMonitorUtil } from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepKubernetesMonitorUtil } from "Common/Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepLlmMonitorUtil } from "Common/Types/Monitor/MonitorStepLlmMonitor";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepProfileMonitorUtil } from "Common/Types/Monitor/MonitorStepProfileMonitor";
import { MonitorStepSecurityEventsMonitorUtil } from "Common/Types/Monitor/MonitorStepSecurityEventsMonitor";
import { MonitorStepTraceMonitorUtil } from "Common/Types/Monitor/MonitorStepTraceMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import TelemetryCheckWindow from "Common/Types/Monitor/TelemetryCheckWindow";
import MetricsViewConfig from "Common/Types/Metrics/MetricsViewConfig";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import { LlmCallKind } from "Common/Types/Telemetry/LlmCallKind";
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

/*
 * ------------------------------------------------------------------
 * A RECORD ON THE EDGE BETWEEN TWO CHECKS IS COUNTED ONCE, AGAINST A REAL
 * CLICKHOUSE, FOR EVERY KIND OF TELEMETRY CHECK (issue #11334).
 *
 * Since #11248 a monitor's windows follow on: the check due at 10:02:07
 * judges 10:01:07 to 10:02:07, the one before it 10:00:07 to 10:01:07. A
 * check's window now holds its start and not its end (TelemetryCheckWindow),
 * so a record stamped exactly 10:01:07 - data stamped to the second, on a
 * monitor whose moment falls on a whole second - is counted by the later
 * check alone.
 *
 * Here every kind of check runs for real, through the evaluation job
 * (processTelemetryMonitorEvaluationFromQueue) and the services' own reads,
 * over tables built from the models: nine records around two windows that
 * share an edge - 3 s before the first window, on its start, inside it, a
 * millisecond before the edge, ON the edge, inside the second window, a
 * millisecond before its end, on its end and 30 s after it. A Metrics or
 * infrastructure check sums the records' values, each its own power of two,
 * so a sum names exactly which records its window read.
 *
 * Each runs twice: as checks read their windows now, and as they read them
 * before (TelemetryCheckWindow handing out ranges that hold both ends, which
 * routes every read as the old code did). Before:
 *
 *   - every check counted the record on the edge in both windows;
 *   - a Traces check of a service's error spans was counted by the span
 *     projection, rounded to whole minutes: 10:00:00 to 10:01:59 for the
 *     first window, so the minute the two windows share was counted twice
 *     and the records outside both were counted too;
 *   - a Metrics, Host or Kubernetes check of one metric read the one-minute
 *     rollup bucket starting inside its window, 10:01:00 to 10:02:00, mostly
 *     after the window: the records of the window's own start were judged
 *     by no check.
 *
 * Opt in by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18334:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18334 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/TelemetryMonitorWindowEdgesClickhouse.test.ts
 *
 * TELEMETRY_WINDOW_EDGES_CLICKHOUSE_REPORT_FILE, when set, is where what
 * each check counted is written as JSON.
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

// The metric catalog and the exception groups live in Postgres: none here.
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

jest.mock("Common/Server/Services/TelemetryExceptionService", () => {
  return {
    __esModule: true,
    default: {
      getResolvedOrArchivedFingerprints: jest.fn(async () => {
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
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import MetricService from "Common/Server/Services/MetricService";
import ProfileService from "Common/Server/Services/ProfileService";
import SecurityEventService from "Common/Server/Services/SecurityEventService";
import SpanService from "Common/Server/Services/SpanService";
import PostgresAppInstance from "Common/Server/Infrastructure/PostgresDatabase";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import TelemetryIngestBacklog from "Common/Server/Utils/Telemetry/TelemetryIngestBacklog";
import { processTelemetryMonitorEvaluationFromQueue } from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

jest.setTimeout(10 * 60 * 1000);

const database: string = `telemetry_window_edges_test_${process.pid}_${Date.now()}`;

const SECOND_MS: number = 1000;
const MINUTE_MS: number = 60 * SECOND_MS;

// Where each record is, from the edge the two windows share.
const PLACED: Array<{ atMs: number; name: string }> = [
  { atMs: -63 * SECOND_MS, name: "3 s before window 1" },
  { atMs: -60 * SECOND_MS, name: "window 1's start" },
  { atMs: -40 * SECOND_MS, name: "inside window 1" },
  { atMs: -1, name: "1 ms before the edge" },
  { atMs: 0, name: "ON THE EDGE" },
  { atMs: 20 * SECOND_MS, name: "inside window 2" },
  { atMs: 59999, name: "1 ms before window 2's end" },
  { atMs: 60 * SECOND_MS, name: "window 2's end" },
  { atMs: 90 * SECOND_MS, name: "30 s after window 2" },
];

const EDGE_INDEX: number = 4;
const WINDOW_2_END_INDEX: number = 7;

// A record's value on a metric: its own power of two.
function valueOf(index: number): number {
  return 2 ** index;
}

/*
 * How a read holds a record in a window: from its start up to but not
 * including its end (a check's window now); both ends (before); whole
 * minutes, both ends (the span projection before); the one-minute buckets
 * starting inside it, both ends (the metric rollups before).
 */
type ReadRule =
  | "start, not end"
  | "both ends"
  | "whole minutes, both ends"
  | "buckets starting in it";

function minuteOf(atMs: number): number {
  return Math.floor(atMs / MINUTE_MS) * MINUTE_MS;
}

function holds(
  rule: ReadRule,
  window: { startMs: number; endMs: number },
  atMs: number,
): boolean {
  switch (rule) {
    case "start, not end":
      return atMs >= window.startMs && atMs < window.endMs;
    case "both ends":
      return atMs >= window.startMs && atMs <= window.endMs;
    case "whole minutes, both ends":
      return (
        minuteOf(atMs) >= minuteOf(window.startMs) &&
        minuteOf(atMs) <= minuteOf(window.endMs)
      );
    case "buckets starting in it":
      return (
        minuteOf(atMs) >= Math.floor(window.startMs / SECOND_MS) * SECOND_MS &&
        minuteOf(atMs) <= Math.floor(window.endMs / SECOND_MS) * SECOND_MS
      );
  }
}

// What a case's check reads of its response: a count, or a sum of values.
type Reading = "count" | "sum";

interface EdgeCase {
  name: string;
  monitorType: MonitorType;
  reading: Reading;
  // How a check read its window before: what routing the old code took.
  before: ReadRule;
  // A window whose ends are whole minutes, where a rollup can serve it.
  wholeMinutes?: boolean | undefined;
  step: (ids: CaseIds) => MonitorStep;
  insert: (ids: CaseIds, times: Array<Date>) => Promise<void>;
  read: (response: JSONObject) => number;
}

interface CaseIds {
  projectId: ObjectID;
  serviceId: ObjectID;
  monitorId: ObjectID;
}

// What one case's two checks counted, each way.
interface CaseCounted {
  edgeAt: string;
  now: [number, number];
  nowExpected: [number, number];
  before: [number, number];
  beforeExpected: [number, number];
  edgeCountedBy: { now: number; before: number };
}

let clickhouse: ClickhouseDatabase;
let client: ClickhouseClient;

/*
 * A model's table on one server: its own columns, engine and keys, under
 * the name every read and every rollup view reads it by (production's are a
 * Distributed table over a replicated local one, which needs a cluster).
 */
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

  // A rollup's view, as the analytics schema sync makes it.
  for (const view of model.materializedViews || []) {
    await client.command({ query: view.query });
  }
}

// A row of `modelType`, every key of it one of the model's columns.
function rowOf(
  modelType: { new (): AnalyticsBaseModel },
  values: JSONObject,
): JSONObject {
  const model: AnalyticsBaseModel = new modelType();

  for (const key of Object.keys(values)) {
    if (!model.getTableColumn(key)) {
      throw new Error(`${model.tableName} has no column ${key}`);
    }
  }

  return values;
}

async function insert(
  modelType: { new (): AnalyticsBaseModel },
  rows: Array<JSONObject>,
): Promise<void> {
  await client.insert({
    table: `${database}.${new modelType().tableName}`,
    format: "JSONEachRow",
    values: rows.map((row: JSONObject): JSONObject => {
      return rowOf(modelType, row);
    }),
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
function summedMetric(data: {
  metricName: string;
  groupByAttributeKeys?: Array<string> | undefined;
}): MetricsViewConfig {
  return {
    queryConfigs: [
      {
        metricQueryData: {
          filterData: {
            metricName: data.metricName,
            aggegationType: AggregationType.Sum,
          },
          ...(data.groupByAttributeKeys
            ? { groupByAttributeKeys: data.groupByAttributeKeys }
            : {}),
        },
      },
    ],
    formulaConfigs: [],
  } as unknown as MetricsViewConfig;
}

function sumOfMetricResult(response: JSONObject): number {
  const results: Array<AggregatedResult> =
    (response["metricResult"] as unknown as Array<AggregatedResult>) || [];
  const series: Array<{ aggregatedResults: Array<AggregatedResult> }> =
    (response["seriesBreakdown"] as unknown as Array<{
      aggregatedResults: Array<AggregatedResult>;
    }>) || [];

  // A grouped check judges its series: their rows are the same rows.
  const rows: Array<AggregatedModel> =
    series.length > 0
      ? series.flatMap(
          (item: {
            aggregatedResults: Array<AggregatedResult>;
          }): Array<AggregatedModel> => {
            return item.aggregatedResults[0]?.data || [];
          },
        )
      : results[0]?.data || [];

  return rows.reduce((sum: number, row: AggregatedModel): number => {
    return sum + Number(row.value);
  }, 0);
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
        name: "edge.points",
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

async function insertLogs(
  ids: CaseIds,
  times: Array<Date>,
  attributes: JSONObject,
): Promise<void> {
  await insert(
    Log,
    times.map((at: Date): JSONObject => {
      return {
        _id: ObjectID.generate().toString(),
        createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
        projectId: ids.projectId.toString(),
        primaryEntityId: ids.serviceId.toString(),
        primaryEntityType: "Service",
        time: asDateTime64(at),
        timeUnixNano: nanos(at),
        severityText: "Error",
        severityNumber: 17,
        attributes: attributes,
        attributeKeys: Object.keys(attributes),
        entityKeys: [],
        body: "tunnel down",
        retentionDate: retentionDate(),
      };
    }),
  );
}

async function insertSpans(
  ids: CaseIds,
  times: Array<Date>,
  extra: JSONObject,
): Promise<void> {
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
        ...extra,
      };
    }),
  );
}

const CASES: Array<EdgeCase> = [
  {
    name: "Logs",
    monitorType: MonitorType.Logs,
    reading: "count",
    before: "both ends",
    step: (ids: CaseIds): MonitorStep => {
      return new MonitorStep().setLogMonitor({
        ...MonitorStepLogMonitorUtil.getDefault(),
        lastXSecondsOfLogs: 60,
        telemetryServiceIds: [ids.serviceId],
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertLogs(ids, times, {});
    },
    read: (response: JSONObject): number => {
      return Number(response["logCount"]);
    },
  },
  {
    name: "Logs grouped by an attribute",
    monitorType: MonitorType.Logs,
    reading: "count",
    before: "both ends",
    step: (ids: CaseIds): MonitorStep => {
      return new MonitorStep().setLogMonitor({
        ...MonitorStepLogMonitorUtil.getDefault(),
        lastXSecondsOfLogs: 60,
        telemetryServiceIds: [ids.serviceId],
        groupByAttributes: ["tunnel"],
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertLogs(ids, times, { tunnel: "vpn-1" });
    },
    read: (response: JSONObject): number => {
      return Number(response["logCount"]);
    },
  },
  {
    name: "Logs resolved by a log",
    monitorType: MonitorType.Logs,
    reading: "count",
    before: "both ends",
    step: (ids: CaseIds): MonitorStep => {
      return new MonitorStep().setLogMonitor({
        ...MonitorStepLogMonitorUtil.getDefault(),
        lastXSecondsOfLogs: 60,
        telemetryServiceIds: [ids.serviceId],
        groupByAttributes: ["tunnel"],
        resolvedByAttributes: { "event.name": "tunnel.up" },
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertLogs(ids, times, { tunnel: "vpn-1" });
    },
    read: (response: JSONObject): number => {
      return Number(response["logCount"]);
    },
  },
  {
    name: "Traces of a service's error spans",
    monitorType: MonitorType.Traces,
    reading: "count",
    before: "whole minutes, both ends",
    step: (ids: CaseIds): MonitorStep => {
      return new MonitorStep().setTraceMonitor({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        lastXSecondsOfSpans: 60,
        telemetryServiceIds: [ids.serviceId],
        spanStatuses: [SpanStatus.Error],
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertSpans(ids, times, {});
    },
    read: (response: JSONObject): number => {
      return Number(response["spanCount"]);
    },
  },
  {
    name: "Traces grouped by an install",
    monitorType: MonitorType.Traces,
    reading: "count",
    before: "both ends",
    step: (ids: CaseIds): MonitorStep => {
      return new MonitorStep().setTraceMonitor({
        ...MonitorStepTraceMonitorUtil.getDefault(),
        lastXSecondsOfSpans: 60,
        telemetryServiceIds: [ids.serviceId],
        groupByAttributes: ["resource.app.installation.id"],
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertSpans(ids, times, {
        attributes: { "resource.app.installation.id": "install-1" },
        attributeKeys: ["resource.app.installation.id"],
      });
    },
    read: (response: JSONObject): number => {
      return Number(response["spanCount"]);
    },
  },
  {
    name: "Exceptions",
    monitorType: MonitorType.Exceptions,
    reading: "count",
    before: "both ends",
    step: (ids: CaseIds): MonitorStep => {
      return new MonitorStep().setExceptionMonitor({
        ...MonitorStepExceptionMonitorUtil.getDefault(),
        lastXSecondsOfExceptions: 60,
        telemetryServiceIds: [ids.serviceId],
      });
    },
    insert: async (ids: CaseIds, times: Array<Date>): Promise<void> => {
      await insert(
        ExceptionInstance,
        times.map((at: Date): JSONObject => {
          return {
            projectId: ids.projectId.toString(),
            primaryEntityId: ids.serviceId.toString(),
            primaryEntityType: "Service",
            time: asDateTime64(at),
            timeUnixNano: nanos(at),
            exceptionType: "TimeoutError",
            message: "the payment provider timed out",
            fingerprint: "fingerprint-edge",
            retentionDate: retentionDate(),
          };
        }),
      );
    },
    read: (response: JSONObject): number => {
      return Number(response["exceptionCount"]);
    },
  },
  {
    name: "Profiles",
    monitorType: MonitorType.Profiles,
    reading: "count",
    before: "both ends",
    step: (ids: CaseIds): MonitorStep => {
      return new MonitorStep().setProfileMonitor({
        ...MonitorStepProfileMonitorUtil.getDefault(),
        lastXSecondsOfProfiles: 60,
        telemetryServiceIds: [ids.serviceId],
        profileTypes: [],
      });
    },
    insert: async (ids: CaseIds, times: Array<Date>): Promise<void> => {
      await insert(
        Profile,
        times.map((at: Date): JSONObject => {
          return {
            projectId: ids.projectId.toString(),
            primaryEntityId: ids.serviceId.toString(),
            primaryEntityType: "Service",
            profileId: ObjectID.generate().toString(),
            startTime: asDateTime64(at),
            startTimeUnixNano: nanos(at),
            endTime: asDateTime64(at),
            endTimeUnixNano: nanos(at),
            profileType: "cpu",
            sampleCount: 1,
            retentionDate: retentionDate(),
          };
        }),
      );
    },
    read: (response: JSONObject): number => {
      return Number(response["profileCount"]);
    },
  },
  {
    name: "Security Events",
    monitorType: MonitorType.SecurityEvents,
    reading: "count",
    before: "both ends",
    step: (): MonitorStep => {
      return new MonitorStep().setSecurityEventsMonitor({
        ...MonitorStepSecurityEventsMonitorUtil.getDefault(),
        lastXSecondsOfEvents: 60,
      });
    },
    insert: async (ids: CaseIds, times: Array<Date>): Promise<void> => {
      await insert(
        SecurityEvent,
        times.map((at: Date): JSONObject => {
          return {
            projectId: ids.projectId.toString(),
            time: asDateTime64(at),
            message: "a sign-in from a new country",
            retentionDate: retentionDate(),
          };
        }),
      );
    },
    read: (response: JSONObject): number => {
      return Number(response["securityEventCount"]);
    },
  },
  {
    name: "AI answers",
    monitorType: MonitorType.Llm,
    reading: "count",
    before: "both ends",
    step: (ids: CaseIds): MonitorStep => {
      return new MonitorStep().setLlmMonitor({
        ...MonitorStepLlmMonitorUtil.getDefault(),
        lastXSecondsOfCalls: 60,
        telemetryServiceIds: [ids.serviceId],
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertSpans(ids, times, {
        isLlmSpan: true,
        llmCallKind: LlmCallKind.Answer,
        llmRequestModel: "chat-large",
        statusCode: SpanStatus.Ok,
      });
    },
    read: (response: JSONObject): number => {
      return Number(response["llmAnswerCount"]);
    },
  },
  {
    name: "Metrics, one metric",
    monitorType: MonitorType.Metrics,
    reading: "sum",
    before: "buckets starting in it",
    step: (): MonitorStep => {
      return new MonitorStep().setMetricMonitor({
        metricViewConfig: summedMetric({ metricName: "edge.points" }),
        rollingTime: RollingTime.Past1Minute,
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertMetrics(ids, times, {});
    },
    read: sumOfMetricResult,
  },
  {
    name: "Metrics grouped by an attribute",
    monitorType: MonitorType.Metrics,
    reading: "sum",
    before: "both ends",
    step: (): MonitorStep => {
      return new MonitorStep().setMetricMonitor({
        metricViewConfig: summedMetric({
          metricName: "edge.points",
          groupByAttributeKeys: ["region"],
        }),
        rollingTime: RollingTime.Past1Minute,
      });
    },
    insert: (ids: CaseIds, times: Array<Date>): Promise<void> => {
      return insertMetrics(ids, times, { attributes: { region: "eu" } });
    },
    read: sumOfMetricResult,
  },
  {
    name: "Host",
    monitorType: MonitorType.Host,
    reading: "sum",
    before: "buckets starting in it",
    step: (): MonitorStep => {
      return new MonitorStep().setHostMonitor({
        hostIdentifier: "web-01",
        metricViewConfig: summedMetric({ metricName: "edge.points" }),
        rollingTime: RollingTime.Past1Minute,
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
    name: "Kubernetes cluster",
    monitorType: MonitorType.Kubernetes,
    reading: "sum",
    before: "buckets starting in it",
    step: (): MonitorStep => {
      return new MonitorStep().setKubernetesMonitor({
        ...MonitorStepKubernetesMonitorUtil.getDefault(),
        clusterIdentifier: "prod-eu",
        metricViewConfig: summedMetric({ metricName: "edge.points" }),
        rollingTime: RollingTime.Past1Minute,
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
];

// The same checks, at a moment that is a whole minute: a rollup serves them.
const WHOLE_MINUTE_CASES: Array<EdgeCase> = CASES.filter(
  (edgeCase: EdgeCase): boolean => {
    return [
      "Traces of a service's error spans",
      "Metrics, one metric",
      "Host",
    ].includes(edgeCase.name);
  },
).map((edgeCase: EdgeCase): EdgeCase => {
  return {
    ...edgeCase,
    name: `${edgeCase.name}, a window of whole minutes`,
    wholeMinutes: true,
  };
});

integration(
  "#11334: a record on the edge between two checks is counted once, against a real ClickHouse",
  () => {
    const original: Map<unknown, Record<string, unknown>> = new Map();
    const captured: Map<string, JSONObject> = new Map();
    const measured: Record<string, CaseCounted> = {};

    // The edge: a whole second, not a whole minute - a monitor's own moment.
    const now: number = Date.now();
    const EDGE: Date = new Date(minuteOf(now) - 5 * MINUTE_MS + 7 * SECOND_MS);
    // The edge of the whole-minute checks: two minutes before the other's.
    const WHOLE_MINUTE_EDGE: Date = new Date(minuteOf(now) - 10 * MINUTE_MS);

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
        request_timeout: 120000,
        max_open_connections: 20,
      };

      clickhouse = new ClickhouseDatabase(options);
      client = await clickhouse.connect(options);

      for (const modelType of [
        Log,
        Span,
        ExceptionInstance,
        Profile,
        SecurityEvent,
        Metric,
        MetricItemAggMV1m,
        MetricItemAggMV1mByHostV2,
        MetricItemAggMV1mByK8sCluster,
      ] as Array<{ new (): AnalyticsBaseModel }>) {
        await createTable(modelType);
      }

      for (const service of [
        LogService,
        SpanService,
        ExceptionInstanceService,
        ProfileService,
        SecurityEventService,
        MetricService,
      ] as Array<unknown>) {
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

      // Every case its own project, service and monitor, and its records.
      for (const edgeCase of [...CASES, ...WHOLE_MINUTE_CASES]) {
        const ids: CaseIds = {
          projectId: ObjectID.generate(),
          serviceId: ObjectID.generate(),
          monitorId: ObjectID.generate(),
        };
        idsOf.set(edgeCase.name, ids);

        const edge: Date = edgeCase.wholeMinutes ? WHOLE_MINUTE_EDGE : EDGE;

        await edgeCase.insert(
          ids,
          PLACED.map((placed: { atMs: number }): Date => {
            return new Date(edge.getTime() + placed.atMs);
          }),
        );
      }

      (MonitorService.findOneById as unknown as jest.Mock).mockImplementation(
        (async (args: { id: ObjectID }): Promise<Monitor> => {
          const edgeCase: EdgeCase = [...CASES, ...WHOLE_MINUTE_CASES].find(
            (candidate: EdgeCase): boolean => {
              return (
                idsOf.get(candidate.name)!.monitorId.toString() ===
                args.id.toString()
              );
            },
          )!;
          const ids: CaseIds = idsOf.get(edgeCase.name)!;

          const monitor: Monitor = new Monitor(ids.monitorId);
          monitor.projectId = ids.projectId;
          monitor.monitorType = edgeCase.monitorType;
          monitor.monitorSteps = stepsOf(edgeCase.step(ids));
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
        process.env["TELEMETRY_WINDOW_EDGES_CLICKHOUSE_REPORT_FILE"];

      if (reportFile) {
        fs.writeFileSync(reportFile, JSON.stringify(measured, null, 2));
      }
    });

    // The check due at `dueAt`, run by the evaluation job: what it read.
    async function check(edgeCase: EdgeCase, dueAt: Date): Promise<number> {
      const ids: CaseIds = idsOf.get(edgeCase.name)!;

      await processTelemetryMonitorEvaluationFromQueue({
        monitorId: ids.monitorId.toString(),
        projectId: ids.projectId.toString(),
        dueAt: dueAt.toISOString(),
      } as never);

      const response: JSONObject | undefined = captured.get(
        `${ids.monitorId.toString()}@${dueAt.toISOString()}`,
      );

      expect(response).toBeDefined();

      return edgeCase.read(response!);
    }

    // What a read holding records by `rule` reads of the two windows.
    function expectedOf(
      edgeCase: EdgeCase,
      rule: ReadRule,
      edge: Date,
    ): [number, number] {
      const windows: Array<{ startMs: number; endMs: number }> = [
        { startMs: edge.getTime() - MINUTE_MS, endMs: edge.getTime() },
        { startMs: edge.getTime(), endMs: edge.getTime() + MINUTE_MS },
      ];

      return windows.map((window: { startMs: number; endMs: number }) => {
        return PLACED.reduce(
          (total: number, placed: { atMs: number }, index: number): number => {
            if (!holds(rule, window, edge.getTime() + placed.atMs)) {
              return total;
            }

            return total + (edgeCase.reading === "sum" ? valueOf(index) : 1);
          },
          0,
        );
      }) as [number, number];
    }

    // The two checks either side of the edge, as checks read them now and before.
    async function countBothWays(edgeCase: EdgeCase): Promise<CaseCounted> {
      const edge: Date = edgeCase.wholeMinutes ? WHOLE_MINUTE_EDGE : EDGE;
      const dueAts: [Date, Date] = [edge, new Date(edge.getTime() + MINUTE_MS)];

      const nowCounts: [number, number] = [
        await check(edgeCase, dueAts[0]),
        await check(edgeCase, dueAts[1]),
      ];

      // Before: every window a range that holds both its ends.
      const closed: jest.SpiedFunction<typeof TelemetryCheckWindow.from> = jest
        .spyOn(TelemetryCheckWindow, "from")
        .mockImplementation((startsAt: Date, endsAt: Date): InBetween<Date> => {
          return new InBetween<Date>(startsAt, endsAt);
        });

      let beforeCounts: [number, number];

      try {
        beforeCounts = [
          await check(edgeCase, dueAts[0]),
          await check(edgeCase, dueAts[1]),
        ];
      } finally {
        closed.mockRestore();
      }

      const edgeIn: (
        rule: ReadRule,
        window: { startMs: number; endMs: number },
      ) => boolean = (
        rule: ReadRule,
        window: { startMs: number; endMs: number },
      ): boolean => {
        return holds(rule, window, edge.getTime() + PLACED[EDGE_INDEX]!.atMs);
      };

      const counted: CaseCounted = {
        edgeAt: edge.toISOString(),
        now: nowCounts,
        nowExpected: expectedOf(edgeCase, "start, not end", edge),
        before: beforeCounts,
        beforeExpected: expectedOf(edgeCase, edgeCase.before, edge),
        edgeCountedBy: {
          now: [
            { startMs: edge.getTime() - MINUTE_MS, endMs: edge.getTime() },
            { startMs: edge.getTime(), endMs: edge.getTime() + MINUTE_MS },
          ].filter((window: { startMs: number; endMs: number }) => {
            return edgeIn("start, not end", window);
          }).length,
          before: [
            { startMs: edge.getTime() - MINUTE_MS, endMs: edge.getTime() },
            { startMs: edge.getTime(), endMs: edge.getTime() + MINUTE_MS },
          ].filter((window: { startMs: number; endMs: number }) => {
            return edgeIn(edgeCase.before, window);
          }).length,
        },
      };

      measured[edgeCase.name] = counted;
      return counted;
    }

    describe.each(CASES)(
      "$name: two checks a minute apart, at a monitor's own moment",
      (edgeCase: EdgeCase) => {
        test("now: each window reads its records from its start up to its end, and the record on the edge is the later check's alone; before: the edge in both", async () => {
          const counted: CaseCounted = await countBothWays(edgeCase);

          // ClickHouse read exactly the records the window holds, each way.
          expect(counted.now).toEqual(counted.nowExpected);
          expect(counted.before).toEqual(counted.beforeExpected);

          /*
           * Now: the window before the edge leaves the record on it out,
           * the window after holds it; together they read every record
           * from the first window's start to the second's end, once.
           */
          const edgeRecord: number =
            edgeCase.reading === "sum" ? valueOf(EDGE_INDEX) : 1;
          const between: number = PLACED.reduce(
            (total: number, placed: { atMs: number }, index: number) => {
              return placed.atMs >= -MINUTE_MS && placed.atMs < MINUTE_MS
                ? total + (edgeCase.reading === "sum" ? valueOf(index) : 1)
                : total;
            },
            0,
          );

          expect(counted.edgeCountedBy.now).toBe(1);
          expect(counted.now[0] + counted.now[1]).toBe(between);

          if (edgeCase.reading === "sum") {
            expect(counted.now[0] & edgeRecord).toBe(0);
            expect(counted.now[1] & edgeRecord).toBe(edgeRecord);
          }

          // Before, the same checks read otherwise - the bug, as it was.
          expect(counted.before).not.toEqual(counted.now);

          if (edgeCase.before === "both ends") {
            expect(counted.edgeCountedBy.before).toBe(2);
            expect(counted.before[0] + counted.before[1]).toBe(
              between +
                edgeRecord +
                (edgeCase.reading === "sum" ? valueOf(WINDOW_2_END_INDEX) : 1),
            );
          }
        });
      },
    );

    describe.each(WHOLE_MINUTE_CASES)(
      "$name: a rollup serves it, its end left out",
      (edgeCase: EdgeCase) => {
        test("now: the rollup's whole buckets are exactly the window; before: a whole minute read by both checks", async () => {
          const counted: CaseCounted = await countBothWays(edgeCase);

          expect(counted.now).toEqual(counted.nowExpected);
          expect(counted.before).toEqual(counted.beforeExpected);
          expect(counted.edgeCountedBy.now).toBe(1);
          expect(counted.edgeCountedBy.before).toBe(2);
          expect(counted.before).not.toEqual(counted.now);
        });
      },
    );

    test("the records were written: every case's nine, read back whole", async () => {
      for (const edgeCase of [...CASES, ...WHOLE_MINUTE_CASES]) {
        expect(idsOf.get(edgeCase.name)).toBeDefined();
      }

      const result: { json: () => Promise<{ data: Array<JSONObject> }> } =
        (await client.query({
          query: `SELECT count() AS rows FROM ${database}.${new Metric().tableName}`,
          format: "JSON",
        })) as never;
      const rows: Array<JSONObject> = (await result.json()).data;

      // Metrics, grouped, Host, Kubernetes, and the whole-minute Metrics and Host.
      expect(Number(rows[0]!["rows"])).toBe(6 * PLACED.length);
    });
  },
);
