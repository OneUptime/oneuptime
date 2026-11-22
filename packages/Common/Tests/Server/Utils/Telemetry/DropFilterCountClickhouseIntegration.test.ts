import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Log from "../../../../Models/AnalyticsModels/Log";
import Span, { SpanKind } from "../../../../Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "../../../../Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "../../../../Server/Infrastructure/ClickhouseDatabase";
import LogService from "../../../../Server/Services/LogService";
import SpanService from "../../../../Server/Services/SpanService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  buildDropFilterCountStatement,
  countDropFilterRecords,
} from "../../../../Server/Utils/Telemetry/DropFilterRecordCount";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DropFilterRecordCount,
  DropFilterRecordCountState,
} from "../../../../Types/Telemetry/DropFilterImpact";
import { TelemetryFieldSignal } from "../../../../Types/Telemetry/TelemetryFieldReaders";
import {
  TelemetryFilterExpression,
  parseTelemetryFilterQuery,
} from "../../../../Utils/Telemetry/TelemetryFilterQuery";
import {
  CompiledFilter,
  compileFilter,
  evaluateCompiledFilter,
} from "../../../../../App/FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import { matchesSecurityLogPrefilter } from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";

/*
 * WHAT A DROP FILTER WOULD TAKE, COUNTED IN A REAL CLICKHOUSE (#10436).
 *
 * The count reads a filter's query as ingest does, as one ClickHouse
 * condition (TelemetryFilterQuerySql), over one project's last day of
 * records, with Security Events' own prefilters beside it. Here it runs
 * on a real server, against rows written to real Log and Span tables:
 *
 *   - a filter of SSH lines, in a project whose Security Events reads its
 *     logs, counts how many of the day's matching lines Security Events
 *     read (the issue's first test);
 *   - for a set of filters across every operator, field and attribute
 *     fallback, the count is exactly the rows the ingest engine itself
 *     (LogFilterEvaluator) would drop of the same rows;
 *   - the trace side counts the server spans whose URL the trace scan's
 *     prefilter reads, and no client span's;
 *   - a record older than the day is not counted;
 *   - a count over a table too big for its time limit is stopped, and
 *     said to have timed out.
 *
 * Opt in against a local, disposable ClickHouse server, for example
 *   docker run -d --rm -p 127.0.0.1:18436:8123 -e CLICKHOUSE_PASSWORD=test clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@127.0.0.1:18436 npx jest <this file>
 * The suite creates and removes only its own uniquely named database.
 */

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(240000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `drop_filter_count_${process.pid}_${Date.now()}`;

const PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000104360",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0192f1a0-0000-7000-8000-000000104361",
);
const CHECKOUT: string = "0192f1a0-0000-7000-8000-00000010436a";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-00000010436b";

const NOW: Date = new Date();

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

// A time as the Log table's DateTime64(9) column takes it.
function toColumnTime(date: Date): string {
  return `${date.toISOString().replace("T", " ").replace("Z", "")}000000`;
}

interface LogRecord {
  service: string;
  severityText: string;
  body: string;
  attributes: Record<string, string>;
  at: Date;
  project?: ObjectID | undefined;
}

// The day's logs, as the engine reads a row and as the Log table stores it.
const LOGS: Array<LogRecord> = [
  {
    service: CHECKOUT,
    severityText: "Information",
    body: "sshd[1123]: Failed password for invalid user admin from 203.0.113.9 port 50122 ssh2",
    attributes: { "process.name": "sshd", env: "prod" },
    at: minutesAgo(30),
  },
  {
    service: CHECKOUT,
    severityText: "Information",
    body: "sshd[1124]: Accepted publickey for deploy from 198.51.100.4 port 41110 ssh2",
    attributes: { "process.name": "sshd", env: "prod" },
    at: minutesAgo(45),
  },
  {
    service: CHECKOUT,
    severityText: "Debug",
    body: "sshd[1125]: debug1: Connection established, keepalive every 30s",
    attributes: { "process.name": "sshd", env: "prod" },
    at: minutesAgo(50),
  },
  {
    service: CHECKOUT,
    severityText: "Debug",
    body: "GET /healthcheck 200 1ms",
    attributes: { "http.route": "/healthcheck", env: "prod" },
    at: minutesAgo(60),
  },
  {
    service: CHECKOUT,
    severityText: "Error",
    body: "Payment provider timed out after 30s",
    attributes: { "http.route": "/api/checkout", env: "prod", retries: "3" },
    at: minutesAgo(70),
  },
  {
    service: PAYMENTS,
    severityText: "Warning",
    body: "GET /search?q=' or '1'='1 HTTP/1.1 403",
    attributes: { "http.route": "/search", env: "staging" },
    at: minutesAgo(80),
  },
  {
    service: PAYMENTS,
    severityText: "Debug",
    body: "Cache warmed in 12ms",
    attributes: { "resource.env": "staging", component: "cache" },
    at: minutesAgo(90),
  },
  {
    service: PAYMENTS,
    severityText: "Information",
    body: "User signed in",
    attributes: { "user.email": "alice@example.com", env: "staging" },
    at: minutesAgo(100),
  },
  // Older than the last day: never counted.
  {
    service: CHECKOUT,
    severityText: "Information",
    body: "sshd[1001]: Failed password for root from 203.0.113.9 port 50001 ssh2",
    attributes: { "process.name": "sshd", env: "prod" },
    at: minutesAgo(26 * 60),
  },
  // Another project's: never counted.
  {
    service: CHECKOUT,
    severityText: "Debug",
    body: "sshd[9]: Failed password for invalid user test from 192.0.2.1",
    attributes: { "process.name": "sshd" },
    at: minutesAgo(20),
    project: OTHER_PROJECT_ID,
  },
];

function logRowOf(record: LogRecord): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    createdAt: toColumnTime(record.at),
    projectId: (record.project || PROJECT_ID).toString(),
    primaryEntityId: record.service,
    primaryEntityType: "Service",
    time: toColumnTime(record.at),
    timeUnixNano: `${record.at.getTime()}000000`,
    severityText: record.severityText,
    severityNumber: 9,
    attributes: record.attributes,
    attributeKeys: Object.keys(record.attributes),
    entityKeys: [],
    traceId: "",
    spanId: "",
    sessionId: "",
    body: record.body,
    observedTimeUnixNano: `${record.at.getTime()}000000`,
    droppedAttributesCount: 0,
    flags: 0,
    retentionDate: toColumnTime(minutesAgo(-30 * 24 * 60)).slice(0, 19),
  };
}

// The row as ingest's drop filter reads it: the stored row without the stamps.
function evaluationRowOf(record: LogRecord): JSONObject {
  const row: JSONObject = logRowOf(record);

  delete row["_id"];
  delete row["createdAt"];
  delete row["retentionDate"];

  return row;
}

interface SpanRecord {
  kind: SpanKind;
  name: string;
  attributes: Record<string, string>;
  at: Date;
}

const SPANS: Array<SpanRecord> = [
  {
    kind: SpanKind.Server,
    name: "GET /search",
    attributes: { "url.path": "/search", "url.query": "q=' or 1=1--" },
    at: minutesAgo(10),
  },
  {
    kind: SpanKind.Server,
    name: "GET /static",
    attributes: { "url.path": "/static/../../etc/passwd" },
    at: minutesAgo(15),
  },
  {
    kind: SpanKind.Server,
    name: "GET /health",
    attributes: { "url.path": "/health" },
    at: minutesAgo(20),
  },
  // The same attack string in a client span: the trace scan reads server spans only.
  {
    kind: SpanKind.Client,
    name: "GET /search",
    attributes: { "url.path": "/search", "url.query": "q=' or 1=1--" },
    at: minutesAgo(25),
  },
];

function spanRowOf(record: SpanRecord, index: number): JSONObject {
  const at: string = toColumnTime(record.at);

  return {
    _id: ObjectID.generate().toString(),
    createdAt: at,
    projectId: PROJECT_ID.toString(),
    primaryEntityId: CHECKOUT,
    primaryEntityType: "Service",
    startTime: at,
    endTime: at,
    startTimeUnixNano: `${record.at.getTime()}000000`,
    endTimeUnixNano: `${record.at.getTime()}000000`,
    durationUnixNano: 1000,
    traceId: `trace${index}`,
    spanId: `span${index}`,
    sessionId: "",
    parentSpanId: "",
    traceState: "",
    attributes: record.attributes,
    attributeKeys: Object.keys(record.attributes),
    entityKeys: [],
    events: "[]",
    links: "[]",
    statusCode: 0,
    statusMessage: "",
    name: record.name,
    kind: record.kind,
    hasException: false,
    isRootSpan: true,
    isEntrySpan: record.kind === SpanKind.Server,
    isLlmSpan: false,
    llmInputTokens: 0,
    llmOutputTokens: 0,
    llmTotalTokens: 0,
    llmCost: 0,
    llmConversationId: "",
    llmCallKind: "",
    llmIssues: [],
    llmUserMessagePreview: "",
    retentionDate: toColumnTime(minutesAgo(-30 * 24 * 60)).slice(0, 19),
  };
}

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

function exprOf(query: string): TelemetryFilterExpression {
  const expr: TelemetryFilterExpression | null =
    parseTelemetryFilterQuery(query);

  expect(expr).not.toBeNull();

  return expr as TelemetryFilterExpression;
}

async function count(data: {
  signal: TelemetryFieldSignal;
  query: string;
  countSecurityEvents?: boolean | undefined;
  timeLimitInSeconds?: number | undefined;
}): Promise<DropFilterRecordCount> {
  return await countDropFilterRecords({
    signal: data.signal,
    projectId: PROJECT_ID,
    expr: exprOf(data.query),
    countSecurityEvents: data.countSecurityEvents ?? true,
    props: { isRoot: true },
    now: NOW,
    timeLimitInSeconds: data.timeLimitInSeconds,
  });
}

type WiredService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
};

integration("a drop filter's count, in a real ClickHouse (#10436)", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const saved: Array<{ service: WiredService; was: WiredService }> = [];

  beforeAll(async (): Promise<void> => {
    // The real ClickHouse HTTP client needs Node timers with unref().
    jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(nodeClearTimeout);

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
      request_timeout: 120000,
    };
    const admin: ClickhouseDatabase = new ClickhouseDatabase(options);
    const adminClient: ClickhouseClient = await admin.connect(options);

    await adminClient.command({ query: `CREATE DATABASE ${database}` });
    await adminClient.close();

    const testOptions: ClickHouseClientConfigOptions = { ...options, database };

    clickhouse = new ClickhouseDatabase(testOptions);
    client = await clickhouse.connect(testOptions);
    await createTable(client, clickhouse, Log);
    await createTable(client, clickhouse, Span);

    for (const service of [
      LogService,
      SpanService,
    ] as unknown as Array<WiredService>) {
      saved.push({
        service,
        was: {
          database: service.database,
          databaseClient: service.databaseClient,
        },
      });
      service.database = clickhouse;
      service.databaseClient = client;
    }

    await client.insert({
      table: `${database}.${new Log().tableName}`,
      values: LOGS.map(logRowOf),
      format: "JSONEachRow",
    });
    await client.insert({
      table: `${database}.${new Span().tableName}`,
      values: SPANS.map(spanRowOf),
      format: "JSONEachRow",
    });
  });

  afterAll(async (): Promise<void> => {
    for (const entry of saved) {
      entry.service.database = entry.was.database;
      entry.service.databaseClient = entry.was.databaseClient;
    }

    if (client) {
      try {
        await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
      } finally {
        await client.close();
      }
    }

    jest.restoreAllMocks();
  });

  test("a filter of SSH lines says how many of the day's matching lines Security Events read", async () => {
    const answer: DropFilterRecordCount = await count({
      signal: "log",
      query: "attributes.process.name = 'sshd'",
    });

    expect(answer.state).toBe(DropFilterRecordCountState.Counted);
    // The project's 8 logs of the day; the older line and the other project's are left out.
    expect(answer.total).toBe(8);
    expect(answer.matched).toBe(3);
    // The failed and the accepted sign-in: the debug line holds no word the scan reads.
    expect(answer.securityEventsRead).toBe(2);
  });

  test("Security Events' count is the scan's own prefilter, read in JavaScript the same way", async () => {
    const answer: DropFilterRecordCount = await count({
      signal: "log",
      query: "env LIKE 'prod' OR env LIKE 'staging'",
    });
    const day: Array<LogRecord> = LOGS.filter((record: LogRecord): boolean => {
      return (
        !record.project && record.at.getTime() > minutesAgo(24 * 60).getTime()
      );
    });

    expect(answer.securityEventsRead).toBe(
      day.filter((record: LogRecord): boolean => {
        const env: string =
          record.attributes["env"] ?? record.attributes["resource.env"] ?? "";

        return (
          (env.toLowerCase().includes("prod") ||
            env.toLowerCase().includes("staging")) &&
          matchesSecurityLogPrefilter(record.body)
        );
      }).length,
    );
  });

  test("where Security Events reads none of the signal, it counts none of them", async () => {
    const answer: DropFilterRecordCount = await count({
      signal: "log",
      query: "attributes.process.name = 'sshd'",
      countSecurityEvents: false,
    });

    expect(answer.matched).toBe(3);
    expect(answer.securityEventsRead).toBeNull();
  });

  describe("the count is what the ingest engine would drop of the same rows", () => {
    const QUERIES: Array<string> = [
      "severityText = 'Debug'",
      "severityText = 'debug'",
      "severityText != 'Debug'",
      "severityText IN ('Debug', 'Error')",
      "NOT severityText IN ('Debug', 'Error')",
      "body LIKE 'healthcheck'",
      "body LIKE 'HEALTHCHECK'",
      "body LIKE 'GET %'",
      "body LIKE '%timed out%'",
      "body LIKE 'sshd[112_]%'",
      "attributes.env = 'prod'",
      "env = 'prod'",
      "env = 'staging'",
      "env LIKE 'stag'",
      "attributes.retries = '3'",
      "retries IN ('1', '2', '3')",
      `primaryEntityId = '${CHECKOUT}'`,
      `primaryEntityId != '${CHECKOUT}' AND severityText = 'Debug'`,
      "severityText = 'Debug' OR attributes.http.route = '/api/checkout'",
      "(severityText = 'Debug' OR severityText = 'Information') AND NOT body LIKE 'sshd'",
      "attributes.missing = ''",
      "attributes.missing != ''",
      "user.email LIKE '@example.com'",
      "component = 'cache' AND env = 'staging'",
    ];

    const day: Array<LogRecord> = LOGS.filter((record: LogRecord): boolean => {
      return (
        !record.project && record.at.getTime() > minutesAgo(24 * 60).getTime()
      );
    });

    test.each(QUERIES)("%s", async (query: string) => {
      const compiled: CompiledFilter = compileFilter(query, {
        emptyQueryMatches: false,
      });
      const engineDrops: number = day.filter((record: LogRecord): boolean => {
        return evaluateCompiledFilter(evaluationRowOf(record), compiled);
      }).length;
      const answer: DropFilterRecordCount = await count({
        signal: "log",
        query,
        countSecurityEvents: false,
      });

      expect(answer.state).toBe(DropFilterRecordCountState.Counted);
      expect(answer.matched).toBe(engineDrops);
    });

    test("the queries cover rows both matched and not", async () => {
      // Control: the differential above would prove little if every query matched all or none.
      const matchedSome: Array<boolean> = await Promise.all(
        QUERIES.map(async (query: string): Promise<boolean> => {
          const answer: DropFilterRecordCount = await count({
            signal: "log",
            query,
            countSecurityEvents: false,
          });

          return answer.matched > 0 && answer.matched < day.length;
        }),
      );

      expect(
        matchedSome.filter((isPartial: boolean): boolean => {
          return isPartial;
        }).length,
      ).toBeGreaterThan(QUERIES.length / 2);
    });
  });

  test("the trace side counts the server spans the trace scan's URL prefilter reads", async () => {
    const answer: DropFilterRecordCount = await count({
      signal: "trace",
      query: "name LIKE 'GET'",
    });

    expect(answer.state).toBe(DropFilterRecordCountState.Counted);
    expect(answer.matched).toBe(4);
    // The SQL injection and the path traversal in server spans; not the client span's copy.
    expect(answer.securityEventsRead).toBe(2);
  });

  test("a span filter of client spans takes nothing the trace scan reads", async () => {
    const answer: DropFilterRecordCount = await count({
      signal: "trace",
      query: `kind = '${SpanKind.Client}'`,
    });

    expect(answer.matched).toBe(1);
    expect(answer.securityEventsRead).toBe(0);
  });

  test("a count held to some services counts only theirs", async () => {
    const result: {
      json: () => Promise<{ data: Array<JSONObject> }>;
    } = (await LogService.executeQuery(
      buildDropFilterCountStatement({
        signal: "log",
        projectId: PROJECT_ID,
        expr: exprOf("severityText = 'Debug'"),
        since: minutesAgo(24 * 60),
        until: NOW,
        countSecurityEvents: false,
        serviceFilter: { serviceIds: [new ObjectID(PAYMENTS)] },
        tableName: `${database}.${new Log().tableName}`,
        timeColumn: "time",
        timeLimitInSeconds: 10,
      }),
    )) as unknown as { json: () => Promise<{ data: Array<JSONObject> }> };
    const row: JSONObject = (await result.json()).data[0]!;

    expect(Number(row["total"])).toBe(3);
    expect(Number(row["matched"])).toBe(1);
  });

  test("a count that runs out of its time is stopped and says so", async () => {
    // A table far too big for a thousandth of a second: a few million rows.
    await client.command({
      query: `INSERT INTO ${database}.${new Log().tableName} (_id, createdAt, projectId, primaryEntityId, time, timeUnixNano, severityText, severityNumber, attributes, attributeKeys, entityKeys, traceId, spanId, sessionId, body, observedTimeUnixNano, droppedAttributesCount, flags, retentionDate) SELECT generateUUIDv4(), now(), {projectId:String}, {serviceId:String}, now64(9) - toIntervalSecond(number % 3600), 0, 'Debug', 5, map('n', toString(number)), ['n'], [], '', '', '', concat('padding ', repeat('x', 200), toString(number)), 0, 0, 0, today() + 30 FROM numbers(3000000)`,
      query_params: {
        projectId: PROJECT_ID.toString(),
        serviceId: PAYMENTS,
      },
    });

    const answer: DropFilterRecordCount = await count({
      signal: "log",
      query: "body LIKE '%no such text%' AND attributes.n LIKE '%9%'",
      timeLimitInSeconds: 0.001,
    });

    expect(answer.state).toBe(DropFilterRecordCountState.TimedOut);
    expect(answer.timeLimitInSeconds).toBe(0.001);
    expect(answer.matched).toBe(0);
  });
});
