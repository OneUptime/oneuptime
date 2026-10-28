import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Log from "Common/Models/AnalyticsModels/Log";
import Span, { SpanStatus } from "Common/Models/AnalyticsModels/Span";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "Common/Types/Monitor/MonitorStepTraceMonitor";
import TelemetryRulePreviewUtil, {
  MAX_PREVIEW_RANGE_IN_SECONDS,
  PREVIEW_WINDOW_COUNT,
  TelemetryRulePreviewAnswer,
  TelemetryRulePreviewBucket,
  TelemetryRulePreviewPoint,
  TelemetryRulePreviewRange,
} from "Common/Types/Monitor/TelemetryRulePreview";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import QueryTimeoutException from "Common/Types/Exception/QueryTimeoutException";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import { TelemetryReadScope } from "Common/Server/Utils/Telemetry/TelemetryReadScope";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ------------------------------------------------------------------
 * A telemetry rule's preview against a real ClickHouse server: what a Logs,
 * Traces or Exceptions monitor's rule would have caught, one count per
 * window of its length over the hours before now (POST
 * /telemetry/<signal>/monitor-preview, TelemetryRulePreviewService).
 *
 * The unit suites pin the windows asked for and the statement built. What
 * they cannot show is what the read COUNTS against real rows, and how it
 * behaves with plenty of them. So this suite loads a busy project's last
 * twelve hours - about two hundred thousand logs, spans and exceptions,
 * with another project's and older rows beside them - and checks that:
 *
 *   1. every window's count is exactly the rows the monitor's own filters
 *      match in it (severities, text, services, span statuses, exception
 *      types), and windows with nothing in them are left for the client to
 *      fill in;
 *   2. the newest window is the very count the monitor's check makes
 *      (monitorLogs, monitorTrace, monitorException - the worker's own
 *      functions) when it evaluates at the end of that window;
 *   3. the read keeps to the reader's services, the project, and resolved
 *      or archived exceptions left out as the check leaves them out;
 *   4. the read is bounded - at most PREVIEW_WINDOW_COUNT windows, never
 *      more than a week - answers in well under a second here, and carries
 *      the interactive time limit, at which it stops with the 504 the API
 *      sends rather than draw a partial count as quiet windows.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Workers/Jobs/TelemetryMonitor/TelemetryRulePreviewClickhouse.test.ts
 *
 * The App Test workflow provides the server; the guard at the bottom fails
 * the run there if it ever goes missing.
 * ------------------------------------------------------------------
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The criteria evaluator loads isolated-vm; nothing here runs JavaScript.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

// Resolved and archived exception groups live in Postgres: stubbed.
jest.mock("Common/Server/Services/TelemetryExceptionService", () => {
  return {
    __esModule: true,
    default: { getResolvedOrArchivedFingerprints: jest.fn() },
  };
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

import AnalyticsDatabaseService, {
  ClickhouseExecuteOptions,
} from "Common/Server/Services/AnalyticsDatabaseService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import LogService from "Common/Server/Services/LogService";
import SpanService from "Common/Server/Services/SpanService";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import TelemetryRulePreviewService from "Common/Server/Services/TelemetryRulePreviewService";
import {
  monitorException,
  monitorLogs,
  monitorTrace,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `telemetry_rule_preview_test_${process.pid}_${Date.now()}`;

const resolvedFingerprints: jest.Mock =
  TelemetryExceptionService.getResolvedOrArchivedFingerprints as unknown as jest.Mock;

const PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000002",
);
const CHECKOUT: ObjectID = new ObjectID("5b000000-0000-4000-8000-000000000001");
const PAYMENTS: ObjectID = new ObjectID("5b000000-0000-4000-8000-000000000002");

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;

/*
 * Now, on a five-minute boundary, so the preview's newest five-minute window
 * ends exactly where a check made now starts counting back from.
 */
const NOW: Date = new Date(Math.floor(Date.now() / (5 * MINUTE)) * 5 * MINUTE);

// Twelve hours of a busy project, then the same again for its neighbours.
const LOG_ROWS: number = 150000;
const SPAN_ROWS: number = 60000;
const EXCEPTION_ROWS: number = 20000;
const SPAN_OF_DATA: number = 12 * HOUR;

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

/*
 * When row `index` of `rows` happened: spread evenly over the last twelve
 * hours, a little off every whole second so no row sits on a window's
 * boundary (where a check's inclusive window and a preview's half-open one
 * would each claim it).
 */
function timeOf(index: number, rows: number): Date {
  return new Date(
    NOW.getTime() -
      SPAN_OF_DATA +
      Math.floor((index * SPAN_OF_DATA) / rows) +
      337,
  );
}

// A spike of checkout errors two hours ago: what an "errors" rule catches.
const SPIKE_START: number = NOW.getTime() - 2 * HOUR;

function isInSpike(time: Date): boolean {
  return (
    time.getTime() >= SPIKE_START && time.getTime() < SPIKE_START + 10 * MINUTE
  );
}

interface LogFacts {
  time: Date;
  serviceId: ObjectID;
  severity: LogSeverity;
  body: string;
  tenant: string;
}

function logFacts(index: number): LogFacts {
  const time: Date = timeOf(index, LOG_ROWS);
  const isError: boolean =
    index % 25 === 0 || (isInSpike(time) && index % 2 === 0);

  return {
    time,
    serviceId: index % 3 === 0 ? PAYMENTS : CHECKOUT,
    severity: isError
      ? index % 50 === 0
        ? LogSeverity.Fatal
        : LogSeverity.Error
      : index % 7 === 0
        ? LogSeverity.Warning
        : LogSeverity.Information,
    body: isError
      ? `Payment declined for order ${index}: card expired`
      : `request ${index} served`,
    tenant: index % 4 === 0 ? "acme" : "globex",
  };
}

function logRow(index: number, projectId: ObjectID = PROJECT_ID): JSONObject {
  const facts: LogFacts = logFacts(index);
  const attributes: Record<string, string> = { tenant: facts.tenant };

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    primaryEntityId: facts.serviceId.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(facts.time),
    timeUnixNano: String(facts.time.getTime() * 1000000 + (index % 1000)),
    severityText: facts.severity,
    severityNumber:
      facts.severity === LogSeverity.Fatal
        ? 21
        : facts.severity === LogSeverity.Error
          ? 17
          : facts.severity === LogSeverity.Warning
            ? 13
            : 9,
    attributes,
    attributeKeys: Object.keys(attributes).sort(),
    entityKeys: [],
    traceId: "",
    spanId: "",
    body: facts.body,
    retentionDate,
  };
}

interface SpanFacts {
  time: Date;
  serviceId: ObjectID;
  status: SpanStatus;
  name: string;
}

function spanFacts(index: number): SpanFacts {
  const time: Date = timeOf(index, SPAN_ROWS);

  return {
    time,
    serviceId: index % 2 === 0 ? CHECKOUT : PAYMENTS,
    status:
      index % 11 === 0 || (isInSpike(time) && index % 3 === 0)
        ? SpanStatus.Error
        : index % 5 === 0
          ? SpanStatus.Ok
          : SpanStatus.Unset,
    name: index % 4 === 0 ? "POST /api/checkout" : `GET /api/cart/${index % 9}`,
  };
}

function spanRow(index: number, projectId: ObjectID = PROJECT_ID): JSONObject {
  const facts: SpanFacts = spanFacts(index);
  const startNs: string = String(
    BigInt(facts.time.getTime()) * BigInt(1000000),
  );
  const durationNs: number = 12 * 1000000;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    primaryEntityId: facts.serviceId.toString(),
    primaryEntityType: "Service",
    startTime: OneUptimeDate.toClickhouseDateTime64(facts.time),
    endTime: OneUptimeDate.toClickhouseDateTime64(facts.time),
    startTimeUnixNano: startNs,
    endTimeUnixNano: String(BigInt(startNs) + BigInt(durationNs)),
    durationUnixNano: String(durationNs),
    traceId: `trace-${index}`,
    spanId: `span-${index}`,
    parentSpanId: "",
    attributes: { "http.method": "POST" },
    attributeKeys: ["http.method"],
    entityKeys: [],
    statusCode: facts.status,
    name: facts.name,
    kind: "SPAN_KIND_SERVER",
    isRootSpan: true,
    retentionDate,
  };
}

interface ExceptionFacts {
  time: Date;
  serviceId: ObjectID;
  type: string;
  fingerprint: string;
}

const RESOLVED_FINGERPRINT: string = "checkout-timeout-resolved";

function exceptionFacts(index: number): ExceptionFacts {
  const time: Date = timeOf(index, EXCEPTION_ROWS);
  const kind: number = index % 4;

  return {
    time,
    serviceId: index % 2 === 0 ? CHECKOUT : PAYMENTS,
    type: kind === 0 ? "TimeoutError" : kind === 1 ? "TypeError" : "CardError",
    fingerprint:
      kind === 0
        ? index % 8 === 0
          ? RESOLVED_FINGERPRINT
          : "checkout-timeout"
        : `exception-${kind}`,
  };
}

function exceptionRow(
  index: number,
  projectId: ObjectID = PROJECT_ID,
): JSONObject {
  const facts: ExceptionFacts = exceptionFacts(index);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: projectId.toString(),
    primaryEntityId: facts.serviceId.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime64(facts.time),
    timeUnixNano: String(facts.time.getTime() * 1000000),
    exceptionType: facts.type,
    stackTrace: "",
    message: `${facts.type} in checkout`,
    spanStatusCode: 2,
    escaped: false,
    traceId: "",
    spanId: "",
    fingerprint: facts.fingerprint,
    spanName: "",
    release: "",
    environment: "production",
    parsedFrames: "",
    attributes: {},
    attributeKeys: [],
    entityKeys: [],
    retentionDate,
  };
}

// The windows a rule of this length reads now, and their counts in JS.
function expectedCounts(data: {
  windowInSeconds: number;
  rows: number;
  matches: (index: number) => Date | null;
}): Map<number, number> {
  const range: TelemetryRulePreviewRange = TelemetryRulePreviewUtil.getRange({
    windowInSeconds: data.windowInSeconds,
    now: NOW,
  });
  const windowMs: number = range.windowInSeconds * 1000;
  const counts: Map<number, number> = new Map();

  for (let index: number = 0; index < data.rows; index++) {
    const time: Date | null = data.matches(index);

    if (
      !time ||
      time.getTime() < range.startTime.getTime() ||
      time.getTime() >= range.endTime.getTime()
    ) {
      continue;
    }

    const windowStart: number =
      Math.floor(time.getTime() / windowMs) * windowMs;
    counts.set(windowStart, (counts.get(windowStart) || 0) + 1);
  }

  return counts;
}

function answerCounts(answer: TelemetryRulePreviewAnswer): Map<number, number> {
  const counts: Map<number, number> = new Map();

  for (const bucket of answer.buckets) {
    counts.set(OneUptimeDate.fromString(bucket.time).getTime(), bucket.value);
  }

  return counts;
}

const EVERYTHING: TelemetryReadScope = { readableIds: null, blockedIds: [] };

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
  modelType: { new (): AnalyticsBaseModel },
): Promise<void> {
  const model: AnalyticsBaseModel = new modelType();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType,
      database: clickhouse,
    });
  const columns: Statement = generator.toColumnsCreateStatement(
    model.tableColumns,
  );

  await client.command({
    query: `CREATE TABLE ${database}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
    query_params: columns.query_params,
  });
}

interface ServiceConnection {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
}

type AnyService = AnalyticsDatabaseService<AnalyticsBaseModel>;

const SERVICES: Array<AnyService> = [
  LogService as unknown as AnyService,
  SpanService as unknown as AnyService,
  ExceptionInstanceService as unknown as AnyService,
];

// The statements every service runs from here on, as sent.
function recordStatements(): Array<string> {
  const statements: Array<string> = [];

  for (const service of SERVICES) {
    const original: AnyService["executeQuery"] =
      service.executeQuery.bind(service);

    jest
      .spyOn(service, "executeQuery")
      .mockImplementation(
        (
          statement: Statement | string,
          options?: ClickhouseExecuteOptions,
        ): ReturnType<AnyService["executeQuery"]> => {
          statements.push(
            typeof statement === "string" ? statement : statement.query,
          );
          return original(statement, options);
        },
      );
  }

  return statements;
}

/*
 * Every read from here on, slowed down past a one-second limit: each row
 * the WHERE reads sleeps a little, and the 45-second limit the statement
 * carries becomes one second.
 */
function slowDown(service: AnyService): void {
  const original: AnyService["executeQuery"] =
    service.executeQuery.bind(service);

  jest
    .spyOn(service, "executeQuery")
    .mockImplementation(
      (
        statement: Statement | string,
        options?: ClickhouseExecuteOptions,
      ): ReturnType<AnyService["executeQuery"]> => {
        const source: Statement = statement as Statement;

        const slow: Statement = new (class extends Statement {
          public override get query(): string {
            return source.query
              .split("max_execution_time = 45")
              .join("max_execution_time = 1, optimize_move_to_prewhere = 0")
              .split("WHERE TRUE")
              .join("WHERE sleepEachRow(0.0002) = 0");
          }

          public override get query_params(): Record<string, unknown> {
            return source.query_params;
          }
        })();

        return original(slow, options);
      },
    );
}

// The fastest of three reads, in milliseconds: one read is a noisy timing.
async function fastestOfThree(work: () => Promise<unknown>): Promise<number> {
  let fastest: number = Number.POSITIVE_INFINITY;

  for (let attempt: number = 0; attempt < 3; attempt++) {
    const startedAt: number = Date.now();
    await work();
    fastest = Math.min(fastest, Date.now() - startedAt);
  }

  return fastest;
}

function logMonitor(
  overrides: Partial<MonitorStepLogMonitor>,
): MonitorStepLogMonitor {
  return { ...MonitorStepLogMonitorUtil.getDefault(), ...overrides };
}

function traceMonitor(
  overrides: Partial<MonitorStepTraceMonitor>,
): MonitorStepTraceMonitor {
  return { ...MonitorStepTraceMonitorUtil.getDefault(), ...overrides };
}

function exceptionMonitor(
  overrides: Partial<MonitorStepExceptionMonitor>,
): MonitorStepExceptionMonitor {
  return { ...MonitorStepExceptionMonitorUtil.getDefault(), ...overrides };
}

integration("A telemetry rule's preview against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const originals: Array<[AnyService, ServiceConnection]> = [];

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
      database,
      request_timeout: 120000,
      compression: { request: true, response: true },
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    await createTable(client, clickhouse, Log);
    await createTable(
      client,
      clickhouse,
      Span as unknown as { new (): AnalyticsBaseModel },
    );
    await createTable(
      client,
      clickhouse,
      ExceptionInstance as unknown as { new (): AnalyticsBaseModel },
    );

    for (const service of SERVICES) {
      originals.push([
        service,
        {
          database: service.database,
          databaseClient: service.databaseClient,
          ingestDatabase: service.ingestDatabase,
          ingestDatabaseClient: service.ingestDatabaseClient,
        },
      ]);
      service.database = clickhouse;
      service.databaseClient = client;
      service.ingestDatabase = clickhouse;
      service.ingestDatabaseClient = client;
    }

    // The project's rows, and a neighbouring project's (every tenth row).
    const insert: (
      table: string,
      rows: number,
      build: (index: number, projectId?: ObjectID) => JSONObject,
    ) => Promise<void> = async (
      table: string,
      rows: number,
      build: (index: number, projectId?: ObjectID) => JSONObject,
    ): Promise<void> => {
      const values: Array<JSONObject> = [];

      for (let index: number = 0; index < rows; index++) {
        values.push(build(index));

        if (index % 10 === 0) {
          values.push(build(index, OTHER_PROJECT_ID));
        }
      }

      await client.insert({
        table: `${database}.${table}`,
        values,
        format: "JSONEachRow",
      });
    };

    await insert(new Log().tableName, LOG_ROWS, logRow);
    await insert(new Span().tableName, SPAN_ROWS, spanRow);
    await insert(
      new ExceptionInstance().tableName,
      EXCEPTION_ROWS,
      exceptionRow,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    resolvedFingerprints.mockReset().mockResolvedValue([]);
  });

  afterAll(async (): Promise<void> => {
    for (const [service, connection] of originals) {
      Object.assign(service, connection);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  describe("Logs: Too many errors from checkout", () => {
    const monitor: MonitorStepLogMonitor = logMonitor({
      severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
      telemetryServiceIds: [CHECKOUT],
      lastXSecondsOfLogs: 300,
    });

    function matches(index: number): Date | null {
      const facts: LogFacts = logFacts(index);

      return facts.serviceId.toString() === CHECKOUT.toString() &&
        (facts.severity === LogSeverity.Error ||
          facts.severity === LogSeverity.Fatal)
        ? facts.time
        : null;
    }

    test("counts exactly the rows the monitor's filters match, in every 5-minute window of the last 12 hours", async () => {
      const answer: TelemetryRulePreviewAnswer =
        await TelemetryRulePreviewService.previewLogs({
          projectId: PROJECT_ID,
          logMonitor: monitor,
          scope: EVERYTHING,
          now: NOW,
        });

      expect(answer.windowInSeconds).toBe(300);
      expect(OneUptimeDate.fromString(answer.endTime).getTime()).toBe(
        NOW.getTime(),
      );
      expect(
        OneUptimeDate.fromString(answer.endTime).getTime() -
          OneUptimeDate.fromString(answer.startTime).getTime(),
      ).toBe(PREVIEW_WINDOW_COUNT * 300 * SECOND);

      expect(answerCounts(answer)).toEqual(
        expectedCounts({ windowInSeconds: 300, rows: LOG_ROWS, matches }),
      );

      // The spike two hours ago stands out of what is usual.
      const points: Array<TelemetryRulePreviewPoint> =
        TelemetryRulePreviewUtil.toPoints(answer);

      expect(points).toHaveLength(PREVIEW_WINDOW_COUNT);

      const highest: TelemetryRulePreviewPoint = points.reduce(
        (a: TelemetryRulePreviewPoint, b: TelemetryRulePreviewPoint) => {
          return b.value > a.value ? b : a;
        },
      );

      expect(Math.abs(highest.time.getTime() - SPIKE_START)).toBeLessThan(
        10 * MINUTE,
      );
    });

    test("the newest window is the count the monitor's check makes at its end", async () => {
      const answer: TelemetryRulePreviewAnswer =
        await TelemetryRulePreviewService.previewLogs({
          projectId: PROJECT_ID,
          logMonitor: monitor,
          scope: EVERYTHING,
          now: NOW,
        });

      const newest: TelemetryRulePreviewBucket | undefined =
        answer.buckets[answer.buckets.length - 1];

      const step: MonitorStep = new MonitorStep();
      step.setLogMonitor(monitor);

      const check: { logCount: number } = (await monitorLogs({
        monitorStep: step,
        monitorId: ObjectID.generate(),
        projectId: PROJECT_ID,
        evaluateUntil: NOW,
      })) as unknown as { logCount: number };

      expect(newest).toBeDefined();
      expect(OneUptimeDate.fromString(newest!.time).getTime()).toBe(
        NOW.getTime() - 300 * SECOND,
      );
      expect(newest!.value).toBe(check.logCount);
      expect(check.logCount).toBeGreaterThan(0);
    });

    test("text and attribute filters count as the check counts them", async () => {
      const filtered: MonitorStepLogMonitor = logMonitor({
        body: "card expired",
        attributes: { tenant: "acme" },
        lastXSecondsOfLogs: 900,
      });

      const answer: TelemetryRulePreviewAnswer =
        await TelemetryRulePreviewService.previewLogs({
          projectId: PROJECT_ID,
          logMonitor: filtered,
          scope: EVERYTHING,
          now: NOW,
        });

      expect(answerCounts(answer)).toEqual(
        expectedCounts({
          windowInSeconds: 900,
          rows: LOG_ROWS,
          matches: (index: number): Date | null => {
            const facts: LogFacts = logFacts(index);
            return facts.body.toLowerCase().includes("card expired") &&
              facts.tenant === "acme"
              ? facts.time
              : null;
          },
        }),
      );
    });

    test("a reader of the payments service alone gets the payments rows alone", async () => {
      const answer: TelemetryRulePreviewAnswer =
        await TelemetryRulePreviewService.previewLogs({
          projectId: PROJECT_ID,
          logMonitor: logMonitor({ lastXSecondsOfLogs: 3600 }),
          scope: { readableIds: [PAYMENTS.toString()], blockedIds: [] },
          now: NOW,
        });

      expect(answerCounts(answer)).toEqual(
        expectedCounts({
          windowInSeconds: 3600,
          rows: LOG_ROWS,
          matches: (index: number): Date | null => {
            const facts: LogFacts = logFacts(index);
            return facts.serviceId.toString() === PAYMENTS.toString()
              ? facts.time
              : null;
          },
        }),
      );
    });

    test("a reader of no service gets nothing, not the whole project", async () => {
      const answer: TelemetryRulePreviewAnswer =
        await TelemetryRulePreviewService.previewLogs({
          projectId: PROJECT_ID,
          logMonitor: logMonitor({ lastXSecondsOfLogs: 300 }),
          scope: { readableIds: [], blockedIds: [] },
          now: NOW,
        });

      expect(answer.buckets).toEqual([]);
    });
  });

  describe("Traces: Too many failed requests", () => {
    const monitor: MonitorStepTraceMonitor = traceMonitor({
      spanStatuses: [SpanStatus.Error],
      spanName: "checkout",
      lastXSecondsOfSpans: 300,
    });

    test("counts the failed checkout spans of every window, as the check does in the newest", async () => {
      const answer: TelemetryRulePreviewAnswer =
        await TelemetryRulePreviewService.previewSpans({
          projectId: PROJECT_ID,
          traceMonitor: monitor,
          scope: EVERYTHING,
          now: NOW,
        });

      expect(answerCounts(answer)).toEqual(
        expectedCounts({
          windowInSeconds: 300,
          rows: SPAN_ROWS,
          matches: (index: number): Date | null => {
            const facts: SpanFacts = spanFacts(index);
            return facts.status === SpanStatus.Error &&
              facts.name.toLowerCase().includes("checkout")
              ? facts.time
              : null;
          },
        }),
      );

      const step: MonitorStep = new MonitorStep();
      step.setTraceMonitor(monitor);

      const check: { spanCount: number } = (await monitorTrace({
        monitorStep: step,
        monitorId: ObjectID.generate(),
        projectId: PROJECT_ID,
        evaluateUntil: NOW,
      })) as unknown as { spanCount: number };

      const newest: number =
        answerCounts(answer).get(NOW.getTime() - 300 * SECOND) || 0;

      expect(newest).toBe(check.spanCount);
    });
  });

  describe("Exceptions: Any exception", () => {
    test("counts every window's exceptions of the types watched, leaving out a resolved group as the check does", async () => {
      resolvedFingerprints.mockResolvedValue([RESOLVED_FINGERPRINT]);

      const monitor: MonitorStepExceptionMonitor = exceptionMonitor({
        exceptionTypes: ["TimeoutError"],
        lastXSecondsOfExceptions: 1800,
      });

      const answer: TelemetryRulePreviewAnswer =
        await TelemetryRulePreviewService.previewExceptions({
          projectId: PROJECT_ID,
          exceptionMonitor: monitor,
          scope: EVERYTHING,
          now: NOW,
        });

      expect(answerCounts(answer)).toEqual(
        expectedCounts({
          windowInSeconds: 1800,
          rows: EXCEPTION_ROWS,
          matches: (index: number): Date | null => {
            const facts: ExceptionFacts = exceptionFacts(index);
            return facts.type === "TimeoutError" &&
              facts.fingerprint !== RESOLVED_FINGERPRINT
              ? facts.time
              : null;
          },
        }),
      );

      const step: MonitorStep = new MonitorStep();
      step.setExceptionMonitor(monitor);

      /*
       * Half-hour windows end on the half hour before now: the check made
       * at that moment counts the newest of them.
       */
      const newestEnd: Date = OneUptimeDate.fromString(answer.endTime);

      const check: { exceptionCount: number } = (await monitorException({
        monitorStep: step,
        monitorId: ObjectID.generate(),
        projectId: PROJECT_ID,
        evaluateUntil: newestEnd,
      })) as unknown as { exceptionCount: number };

      expect(check.exceptionCount).toBeGreaterThan(0);
      expect(
        answerCounts(answer).get(newestEnd.getTime() - 1800 * SECOND) || 0,
      ).toBe(check.exceptionCount);
    });

    test("a monitor that counts resolved exceptions too counts the resolved group", async () => {
      resolvedFingerprints.mockResolvedValue([RESOLVED_FINGERPRINT]);

      const answer: TelemetryRulePreviewAnswer =
        await TelemetryRulePreviewService.previewExceptions({
          projectId: PROJECT_ID,
          exceptionMonitor: exceptionMonitor({
            exceptionTypes: ["TimeoutError"],
            includeResolved: true,
            includeArchived: true,
            lastXSecondsOfExceptions: 1800,
          }),
          scope: EVERYTHING,
          now: NOW,
        });

      expect(answerCounts(answer)).toEqual(
        expectedCounts({
          windowInSeconds: 1800,
          rows: EXCEPTION_ROWS,
          matches: (index: number): Date | null => {
            const facts: ExceptionFacts = exceptionFacts(index);
            return facts.type === "TimeoutError" ? facts.time : null;
          },
        }),
      );
    });
  });

  describe("bounded, and quick with plenty of rows", () => {
    test("never more than a week, nor more windows than the chart draws, whatever the window", async () => {
      for (const windowInSeconds of [5, 60, 300, 3600, 21600, 86400]) {
        const answer: TelemetryRulePreviewAnswer =
          await TelemetryRulePreviewService.previewLogs({
            projectId: PROJECT_ID,
            logMonitor: logMonitor({ lastXSecondsOfLogs: windowInSeconds }),
            scope: EVERYTHING,
            now: NOW,
          });

        const rangeMs: number =
          OneUptimeDate.fromString(answer.endTime).getTime() -
          OneUptimeDate.fromString(answer.startTime).getTime();

        expect(rangeMs).toBeLessThanOrEqual(
          MAX_PREVIEW_RANGE_IN_SECONDS * SECOND,
        );
        expect(answer.buckets.length).toBeLessThanOrEqual(PREVIEW_WINDOW_COUNT);

        for (const bucket of answer.buckets) {
          const time: number = OneUptimeDate.fromString(bucket.time).getTime();
          expect(time).toBeGreaterThanOrEqual(
            OneUptimeDate.fromString(answer.startTime).getTime(),
          );
          expect(time).toBeLessThan(
            OneUptimeDate.fromString(answer.endTime).getTime(),
          );
        }
      }
    });

    test("one grouped count, with the interactive time limit, answered well under a second", async () => {
      const statements: Array<string> = recordStatements();

      const fastestMs: number = await fastestOfThree(() => {
        return TelemetryRulePreviewService.previewLogs({
          projectId: PROJECT_ID,
          logMonitor: logMonitor({
            severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
            lastXSecondsOfLogs: 300,
          }),
          scope: EVERYTHING,
          now: NOW,
        });
      });

      // One statement a read: the windows are counted in ClickHouse.
      expect(statements).toHaveLength(3);
      expect(statements[0]).toContain("toStartOfInterval(");
      expect(statements[0]).toContain("count()");
      expect(statements[0]).toContain("GROUP BY windowStart");
      expect(statements[0]).toContain("max_execution_time = 45");
      expect(statements[0]).toContain("timeout_overflow_mode = 'throw'");

      expect(fastestMs).toBeLessThan(1000);
    });

    test("a read that runs into the time limit stops with the 504 the API sends, never as quiet windows", async () => {
      slowDown(LogService as unknown as AnyService);

      let caught: unknown = null;

      try {
        await TelemetryRulePreviewService.previewLogs({
          projectId: PROJECT_ID,
          logMonitor: logMonitor({ lastXSecondsOfLogs: 300 }),
          scope: EVERYTHING,
          now: NOW,
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(QueryTimeoutException);
      expect((caught as QueryTimeoutException).code).toBe(
        ExceptionCode.QueryTimeoutException,
      );
    });
  });
});

describe("Telemetry rule preview ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
