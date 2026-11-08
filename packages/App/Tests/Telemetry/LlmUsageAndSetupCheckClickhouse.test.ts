import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Log from "Common/Models/AnalyticsModels/Log";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  LlmMetricUsageDimension,
  LlmMetricUsageGroup,
  LlmMetricUsageResponse,
} from "Common/Types/Telemetry/LlmMetricUsageApi";
import {
  LlmMetricSource,
  LlmSetupCheckConnection,
  LlmSetupCheckResponse,
} from "Common/Types/Telemetry/LlmSetupCheckApi";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import {
  LLM_CONNECTION_ID_ATTRIBUTE,
  LLM_PROVIDER_COST_METRIC_NAME,
} from "Common/Types/LlmObservability/LlmProviderUsageMetrics";
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
 * GenAI metric usage and the AI / LLM setup check against a real
 * ClickHouse (#5776).
 *
 * The unit suites pin the SQL the two readers write. What they cannot
 * show is that ClickHouse accepts it and answers the right numbers:
 *
 *   - a cumulative counter counts what it grew by in the range - from
 *     zero when it started there, from its first point there when it
 *     started before, each restart (a new start time) a series of its
 *     own - and a delta counter the sum of its points: the Usage tab once
 *     summed every running total, and a week read as $852,328;
 *   - Claude Code's cache tokens count as input; points are grouped by
 *     the first identity key they carry; scopes (project, service,
 *     provider under any spelling) hold;
 *   - the setup check's six reads: AI calls by app and provider, the
 *     newest call before the window, HTTP calls to an AI API nothing
 *     recorded as an AI call, GenAI events on the logs signal, coding
 *     tools by metric name, and provider accounts' newest usage day.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/LlmUsageAndSetupCheckClickhouse.test.ts
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

import SpanService from "Common/Server/Services/SpanService";
import MetricService from "Common/Server/Services/MetricService";
import LogService from "Common/Server/Services/LogService";
import LlmObservabilityConnectionService from "Common/Server/Services/LlmObservabilityConnectionService";
import LlmObservabilityConnection from "Common/Models/DatabaseModels/LlmObservabilityConnection";
import LlmMetricUsageReader, {
  LlmMetricUsageReadQuery,
} from "Common/Server/Utils/Telemetry/LlmMetricUsageReader";
import LlmSetupCheckReader, {
  LlmSetupCheckQuery,
} from "Common/Server/Utils/Telemetry/LlmSetupCheckReader";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `llm_usage_setup_test_${process.pid}_${Date.now()}`;

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const now: number = Date.now();
const rangeStart: Date = new Date(now - 7 * DAY);
const rangeEnd: Date = new Date(now + MINUTE);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

// Projects: one per scenario, so each read sees only its own rows.
const usageProject: ObjectID = new ObjectID("8810000000000000000000a1");
const otherProject: ObjectID = new ObjectID("8810000000000000000000a2");
const checkProject: ObjectID = new ObjectID("8810000000000000000000a3");
const quietProject: ObjectID = new ObjectID("8810000000000000000000a4");

const laptopService: ObjectID = new ObjectID("8810000000000000000000b1");
const ciService: ObjectID = new ObjectID("8810000000000000000000b2");
const checkoutService: ObjectID = new ObjectID("8810000000000000000000b3");
const searchService: ObjectID = new ObjectID("8810000000000000000000b4");
const toolService: ObjectID = new ObjectID("8810000000000000000000b5");
const accountService: ObjectID = new ObjectID("8810000000000000000000b6");

const ACCOUNT_CONNECTION: string = "8810000000000000000000c1";
const TOOL_CONNECTION: string = "8810000000000000000000c2";

interface MetricFixture {
  projectId?: ObjectID;
  serviceId?: ObjectID;
  name: string;
  value: number;
  at: number;
  temporality?: "Cumulative" | "Delta" | null;
  // When the series started (epoch ms); none for a delta point.
  startedAt?: number | undefined;
  attributes?: Record<string, string>;
}

function metricRow(fixture: MetricFixture): JSONObject {
  const at: Date = new Date(fixture.at);
  const attributes: Record<string, string> = fixture.attributes || {};

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (fixture.projectId || usageProject).toString(),
    primaryEntityId: (fixture.serviceId || laptopService).toString(),
    primaryEntityType: "Service",
    name: fixture.name,
    time: OneUptimeDate.toClickhouseDateTime(at),
    timeUnixNano: String(at.getTime() * 1000000),
    metricPointType: "Sum",
    aggregationTemporality:
      fixture.temporality === undefined ? "Delta" : fixture.temporality,
    isMonotonic: true,
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    value: fixture.value,
    startTime:
      fixture.startedAt !== undefined
        ? OneUptimeDate.toClickhouseDateTime(new Date(fixture.startedAt))
        : null,
    startTimeUnixNano:
      fixture.startedAt !== undefined
        ? String(fixture.startedAt * 1000000)
        : null,
    retentionDate: retentionDate,
  };
}

// A cumulative series: its running totals, one export a minute apart.
function cumulative(data: {
  name: string;
  totals: Array<number>;
  firstAt: number;
  startedAt: number;
  attributes?: Record<string, string>;
  projectId?: ObjectID;
  serviceId?: ObjectID;
}): Array<MetricFixture> {
  return data.totals.map((total: number, index: number): MetricFixture => {
    return {
      name: data.name,
      value: total,
      at: data.firstAt + index * MINUTE,
      temporality: "Cumulative",
      startedAt: data.startedAt,
      attributes: data.attributes,
      projectId: data.projectId,
      serviceId: data.serviceId,
    };
  });
}

const ANA: Record<string, string> = { "user.email": "ana@example.com" };
const BEN: Record<string, string> = { "user.email": "ben@example.com" };

/*
 * The usage project's points, each scenario's arithmetic in its comment.
 * Cost metrics are in USD unless named otherwise.
 */
const usageMetrics: Array<MetricFixture> = [
  /*
   * Ana's Claude Code, exporting its running cost every minute (cumulative):
   * one session that started in the range, 0.5 -> 1.25 -> 2.0. Counts 2.0
   * (its largest), never 3.75 (the sum).
   */
  ...cumulative({
    name: "claude_code.cost.usage",
    totals: [0.5, 1.25, 2.0],
    firstAt: now - 3 * DAY,
    startedAt: now - 3 * DAY - MINUTE,
    attributes: { ...ANA, "session.id": "s1" },
  }),
  /*
   * Her process restarted: a new start time, a new series, from zero again.
   * 0.25 -> 1.0 counts 1.0. Together with the first: 3.0.
   */
  ...cumulative({
    name: "claude_code.cost.usage",
    totals: [0.25, 1.0],
    firstAt: now - 2 * DAY,
    startedAt: now - 2 * DAY - MINUTE,
    attributes: { ...ANA, "session.id": "s1" },
  }),
  /*
   * A long-running session that started BEFORE the range: 10 days ago. Its
   * points in the range are 40 -> 41.5 -> 44: it grew by 4 in the range.
   */
  ...cumulative({
    name: "claude_code.cost.usage",
    totals: [40, 41.5, 44],
    firstAt: now - 1 * DAY,
    startedAt: now - 10 * DAY,
    attributes: { ...BEN, "session.id": "s9" },
  }),
  // Its points before the range are not read at all.
  ...cumulative({
    name: "claude_code.cost.usage",
    totals: [20, 30],
    firstAt: now - 9 * DAY,
    startedAt: now - 10 * DAY,
    attributes: { ...BEN, "session.id": "s9" },
  }),
  /*
   * Ana's tokens, as Claude Code sends them by default (delta): each point
   * what was added. Input 100 + 50, output 30, cache read 400 and cache
   * creation 20 - which Claude Code leaves out of its input count, so they
   * count as input: 570 in, 30 out.
   */
  {
    name: "claude_code.token.usage",
    value: 100,
    at: now - 3 * DAY,
    attributes: { ...ANA, type: "input" },
  },
  {
    name: "claude_code.token.usage",
    value: 50,
    at: now - 3 * DAY + MINUTE,
    attributes: { ...ANA, type: "input" },
  },
  {
    name: "claude_code.token.usage",
    value: 30,
    at: now - 3 * DAY,
    attributes: { ...ANA, type: "output" },
  },
  {
    name: "claude_code.token.usage",
    value: 400,
    at: now - 3 * DAY,
    attributes: { ...ANA, type: "cacheRead" },
  },
  {
    name: "claude_code.token.usage",
    value: 20,
    at: now - 3 * DAY,
    attributes: { ...ANA, type: "cacheCreation" },
  },
  /*
   * The conventions' token counter from an SDK, cumulative, started before
   * the range: 500 -> 520 -> 560 in it, 60 output tokens.
   */
  ...cumulative({
    name: "gen_ai.client.token.usage",
    totals: [500, 520, 560],
    firstAt: now - 2 * DAY,
    startedAt: now - 9 * DAY,
    attributes: { ...BEN, "gen_ai.token.type": "output" },
  }),
  /*
   * A point that names no temporality is summed, as before: 0.5 + 0.5.
   */
  {
    name: "gen_ai.client.cost",
    value: 0.5,
    at: now - DAY,
    temporality: null,
    attributes: { "user.id": "u-77", "gen_ai.provider.name": "azure.ai.openai" },
  },
  {
    name: "gen_ai.client.cost",
    value: 0.5,
    at: now - DAY + MINUTE,
    temporality: null,
    attributes: { "user.id": "u-77", "gen_ai.system": "az.ai.openai" },
  },
  // Codex's millionths of a dollar, delta: 2,500,000 = $2.50, from CI.
  {
    name: "codex.turn.cost_microusd",
    value: 2500000,
    at: now - DAY,
    serviceId: ciService,
    attributes: { "user.account_id": "acct-ci" },
  },
  // Another project's spend, never counted here.
  {
    name: "claude_code.cost.usage",
    value: 1000,
    at: now - DAY,
    projectId: otherProject,
    attributes: ANA,
  },
  // A metric that is not a usage metric, never counted.
  {
    name: "claude_code.lines_of_code.count",
    value: 999,
    at: now - DAY,
    attributes: ANA,
  },
];

/*
 * The setup check project: two apps sending AI calls, a company AI tool's
 * imported chats, an app calling Azure OpenAI with only an HTTP client
 * instrumentation (in the quiet project), coding tools' metrics, provider
 * usage, and a GenAI event on the logs signal.
 */
interface SpanFixture {
  projectId?: ObjectID;
  serviceId: ObjectID;
  at: number;
  isLlm: boolean;
  kind?: string;
  llmSystem?: string;
  callKind?: string;
  model?: string;
  preview?: string;
  attributes?: Record<string, string>;
}

function spanRow(fixture: SpanFixture, index: number): JSONObject {
  const start: Date = new Date(fixture.at);
  const end: Date = new Date(fixture.at + 1200);
  const attributes: Record<string, string> = fixture.attributes || {};

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (fixture.projectId || checkProject).toString(),
    primaryEntityId: fixture.serviceId.toString(),
    primaryEntityType: "Service",
    startTime: OneUptimeDate.toClickhouseDateTime(start),
    endTime: OneUptimeDate.toClickhouseDateTime(end),
    startTimeUnixNano: String(start.getTime() * 1000000),
    endTimeUnixNano: String(end.getTime() * 1000000),
    durationUnixNano: String(1200 * 1000000),
    traceId: `${String(index).padStart(2, "0")}${"a".repeat(30)}`,
    spanId: `${String(index).padStart(2, "0")}${"b".repeat(14)}`,
    parentSpanId: "",
    name: fixture.isLlm ? `chat ${fixture.model || ""}` : "POST",
    kind: fixture.kind || "SPAN_KIND_CLIENT",
    statusCode: 1,
    statusMessage: "",
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    events: "[]",
    isLlmSpan: fixture.isLlm,
    llmSystem: fixture.llmSystem || "",
    llmOperation: fixture.isLlm ? "chat" : "",
    llmRequestModel: fixture.isLlm ? fixture.model || "gpt-4o" : "",
    llmCallKind: fixture.isLlm ? fixture.callKind ?? "answer" : "",
    llmUserMessagePreview: fixture.preview || "",
    llmIssues: [],
    retentionDate: retentionDate,
  };
}

const checkSpans: Array<SpanFixture> = [
  // checkout: three answers this week through Azure OpenAI, one recorded.
  {
    serviceId: checkoutService,
    at: now - 2 * HOUR,
    isLlm: true,
    llmSystem: "azure.ai.openai",
    preview: "Where is my order?",
  },
  {
    serviceId: checkoutService,
    at: now - 3 * HOUR,
    isLlm: true,
    llmSystem: "azure.ai.openai",
  },
  {
    serviceId: checkoutService,
    at: now - 3 * DAY,
    isLlm: true,
    llmSystem: "azure.ai.openai",
  },
  // A tool call of checkout's agent: an AI call, not an answer.
  {
    serviceId: checkoutService,
    at: now - 2 * HOUR,
    isLlm: true,
    llmSystem: "azure.ai.openai",
    callKind: "tool",
    model: "",
  },
  // search: one answer this week through OpenAI, and one 20 days ago.
  {
    serviceId: searchService,
    at: now - DAY,
    isLlm: true,
    llmSystem: "openai",
  },
  {
    serviceId: searchService,
    at: now - 20 * DAY,
    isLlm: true,
    llmSystem: "openai",
  },
  // The company AI tool's imported chats: its connection's, not an app's.
  {
    serviceId: toolService,
    at: now - HOUR,
    isLlm: true,
    llmSystem: "anthropic",
  },
  {
    serviceId: toolService,
    at: now - 2 * HOUR,
    isLlm: true,
    llmSystem: "anthropic",
  },
  // A plain HTTP call that is not an AI one.
  {
    serviceId: checkoutService,
    at: now - HOUR,
    isLlm: false,
    attributes: { "server.address": "payments.example.com" },
  },
];

const quietSpans: Array<SpanFixture> = [
  /*
   * An app calls Azure OpenAI through an HTTP client instrumentation only:
   * the calls arrive as plain client spans, the host in server.address or
   * in the URL.
   */
  {
    projectId: quietProject,
    serviceId: checkoutService,
    at: now - HOUR,
    isLlm: false,
    attributes: {
      "server.address": "contoso.openai.azure.com",
      "http.request.method": "POST",
    },
  },
  {
    projectId: quietProject,
    serviceId: checkoutService,
    at: now - 2 * HOUR,
    isLlm: false,
    attributes: {
      "url.full":
        "https://contoso.openai.azure.com/openai/deployments/support-chat/chat/completions?api-version=2024-10-21",
    },
  },
  {
    projectId: quietProject,
    serviceId: searchService,
    at: now - 3 * HOUR,
    isLlm: false,
    attributes: { "http.url": "https://api.openai.com/v1/responses" },
  },
  // A look-alike host is not an AI API.
  {
    projectId: quietProject,
    serviceId: searchService,
    at: now - 3 * HOUR,
    isLlm: false,
    attributes: { "server.address": "openai.azure.com.example.org" },
  },
  // A server span to the same host is somebody calling the app.
  {
    projectId: quietProject,
    serviceId: searchService,
    at: now - 3 * HOUR,
    isLlm: false,
    kind: "SPAN_KIND_SERVER",
    attributes: { "server.address": "api.openai.com" },
  },
  // Two days ago: outside the one-day look.
  {
    projectId: quietProject,
    serviceId: searchService,
    at: now - 2 * DAY,
    isLlm: false,
    attributes: { "server.address": "api.openai.com" },
  },
];

const checkMetrics: Array<MetricFixture> = [
  {
    projectId: checkProject,
    name: "claude_code.token.usage",
    value: 10,
    at: now - DAY,
    attributes: { type: "input" },
  },
  {
    projectId: checkProject,
    name: "claude_code.active_time.total",
    value: 10,
    at: now - 2 * HOUR,
  },
  {
    projectId: checkProject,
    name: "cursor.usage.cost",
    value: 1,
    at: now - 3 * HOUR,
  },
  {
    projectId: checkProject,
    name: "gen_ai.client.token.usage",
    value: 1,
    at: now - HOUR,
  },
  // Ten days ago: not the past week.
  {
    projectId: checkProject,
    name: "codex.turn.token_usage",
    value: 1,
    at: now - 10 * DAY,
  },
  // A provider account's daily usage, kept as its connection's metrics.
  {
    projectId: checkProject,
    serviceId: accountService,
    name: LLM_PROVIDER_COST_METRIC_NAME,
    value: 12.5,
    at: new Date(new Date(now - 2 * DAY).toISOString().substring(0, 10))
      .getTime(),
    attributes: { [LLM_CONNECTION_ID_ATTRIBUTE]: ACCOUNT_CONNECTION },
  },
  {
    projectId: checkProject,
    serviceId: accountService,
    name: LLM_PROVIDER_COST_METRIC_NAME,
    value: 0,
    at: new Date(new Date(now - DAY).toISOString().substring(0, 10)).getTime(),
    attributes: { [LLM_CONNECTION_ID_ATTRIBUTE]: ACCOUNT_CONNECTION },
  },
];

function logRow(data: {
  projectId: ObjectID;
  serviceId: ObjectID;
  at: number;
  attributes: Record<string, string>;
}): JSONObject {
  const at: Date = new Date(data.at);

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: data.projectId.toString(),
    primaryEntityId: data.serviceId.toString(),
    primaryEntityType: "Service",
    time: OneUptimeDate.toClickhouseDateTime(at),
    timeUnixNano: String(at.getTime() * 1000000),
    severityText: "INFO",
    severityNumber: 9,
    attributes: data.attributes,
    attributeKeys: Object.keys(data.attributes),
    body: "",
    traceId: "",
    spanId: "",
    retentionDate: retentionDate,
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
      modelType: modelType,
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

type WiredService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
};

function usageQuery(
  overrides: Partial<LlmMetricUsageReadQuery> = {},
): LlmMetricUsageReadQuery {
  return {
    projectId: usageProject,
    startTime: rangeStart,
    endTime: rangeEnd,
    dimension: LlmMetricUsageDimension.None,
    ...overrides,
  };
}

function groupOf(
  response: LlmMetricUsageResponse,
  key: string,
): LlmMetricUsageGroup {
  const group: LlmMetricUsageGroup | undefined = response.groups.find(
    (candidate: LlmMetricUsageGroup): boolean => {
      return candidate.key === key;
    },
  );

  expect(group).toBeDefined();

  return group!;
}

function checkQuery(
  overrides: Partial<LlmSetupCheckQuery> = {},
): LlmSetupCheckQuery {
  return {
    projectId: checkProject,
    now: new Date(now + MINUTE),
    metricFilter: {},
    logFilter: {},
    props: { isRoot: true },
    ...overrides,
  };
}

function connection(data: {
  id: string;
  provider: LlmConnectionProvider;
  serviceId: ObjectID;
}): LlmObservabilityConnection {
  const item: LlmObservabilityConnection = new LlmObservabilityConnection();
  item.id = new ObjectID(data.id);
  item.name = data.provider;
  item.provider = data.provider;
  item.isEnabled = true;
  item.serviceId = data.serviceId;
  item.lastPulledAt = new Date(now - 10 * MINUTE);
  item.lastSuccessfulPullAt = new Date(now - 10 * MINUTE);
  item.lastPullResult = {
    status: "success",
    kind: "usage",
    readSince: new Date(now - 30 * DAY).toISOString(),
    resources: 2,
  };

  return item;
}

integration("GenAI metric usage and the setup check against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const originals: Array<{ service: WiredService; saved: WiredService }> = [];

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
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    for (const modelType of [Span, Metric, Log]) {
      await createTable(
        client,
        clickhouse,
        modelType as unknown as { new (): AnalyticsBaseModel },
      );
    }

    for (const service of [SpanService, MetricService, LogService]) {
      const wired: WiredService = service as unknown as WiredService;

      originals.push({
        service: wired,
        saved: {
          database: wired.database,
          databaseClient: wired.databaseClient,
          ingestDatabase: wired.ingestDatabase,
          ingestDatabaseClient: wired.ingestDatabaseClient,
        },
      });

      wired.database = clickhouse;
      wired.databaseClient = client;
      wired.ingestDatabase = clickhouse;
      wired.ingestDatabaseClient = client;
    }

    await MetricService.insertJsonRows(
      [...usageMetrics, ...checkMetrics].map(metricRow),
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );
    await SpanService.insertJsonRows(
      [...checkSpans, ...quietSpans].map(spanRow),
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );
    await LogService.insertJsonRows(
      [
        /*
         * The OpenTelemetry JavaScript instrumentation's content, as a log -
         * before the "answers without what was said" check's now.
         */
        logRow({
          projectId: checkProject,
          serviceId: checkoutService,
          at: now - 4 * HOUR,
          attributes: {
            "gen_ai.system": "openai",
            "event.name": "gen_ai.user.message",
          },
        }),
        // An ordinary log line of another project.
        logRow({
          projectId: quietProject,
          serviceId: checkoutService,
          at: now - HOUR,
          attributes: { "http.route": "/orders" },
        }),
      ],
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );
  });

  afterAll(async (): Promise<void> => {
    for (const original of originals) {
      Object.assign(original.service, original.saved);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }

    jest.restoreAllMocks();
  });

  describe("GenAI metric usage", () => {
    test("a counter counts what it grew by; a delta counter, its points; never another project's", async () => {
      const response: LlmMetricUsageResponse =
        await LlmMetricUsageReader.read(usageQuery());

      /*
       * Claude Code cost: 2.0 + 1.0 (Ana's two sessions) + 4 (Ben's, grown
       * in the range). Azure: 0.5 + 0.5. Codex: $2.50. Summing every point
       * would have read 0.5 + 1.25 + 2 + 0.25 + 1 + 40 + 41.5 + 44 + ...
       */
      expect(response.totals.costUsd).toBeCloseTo(2 + 1 + 4 + 1 + 2.5, 6);
      expect(response.totals.hasCost).toBe(true);
      expect(response.truncated).toBe(false);
    });

    test("Claude Code's cache tokens count as input; a cumulative token counter its growth", async () => {
      const response: LlmMetricUsageResponse =
        await LlmMetricUsageReader.read(usageQuery());

      expect(response.totals.inputTokens).toBe(100 + 50 + 400 + 20);
      // Claude Code's 30, and the SDK counter's 560 - 500.
      expect(response.totals.outputTokens).toBe(30 + 60);
      expect(response.totals.hasTokens).toBe(true);
    });

    test("by person: the first identity key each point carries", async () => {
      const response: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
        usageQuery({ dimension: LlmMetricUsageDimension.Employee }),
      );

      const ana: LlmMetricUsageGroup = groupOf(response, "ana@example.com");

      expect(ana.costUsd).toBeCloseTo(3, 6);
      expect(ana.inputTokens).toBe(570);
      expect(ana.outputTokens).toBe(30);

      expect(groupOf(response, "ben@example.com").costUsd).toBeCloseTo(4, 6);
      expect(groupOf(response, "u-77").costUsd).toBeCloseTo(1, 6);
      expect(groupOf(response, "acct-ci").costUsd).toBeCloseTo(2.5, 6);

      // Most cost first.
      expect(response.groups[0]!.key).toBe("ben@example.com");
    });

    test("a service's points only", async () => {
      const response: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
        usageQuery({ serviceId: ciService }),
      );

      expect(response.totals.costUsd).toBeCloseTo(2.5, 6);
      expect(response.totals.inputTokens).toBe(0);
    });

    test("the reader's service scope holds", async () => {
      const response: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
        usageQuery({ excludedServiceIds: [ciService] }),
      );

      expect(response.totals.costUsd).toBeCloseTo(2 + 1 + 4 + 1, 6);
    });

    test("a provider's points under every spelling it was sent as", async () => {
      const response: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
        usageQuery({ llmSystem: "azure.ai.openai" }),
      );

      // gen_ai.provider.name azure.ai.openai, and gen_ai.system az.ai.openai.
      expect(response.totals.costUsd).toBeCloseTo(1, 6);
    });

    test("a person's points only", async () => {
      const response: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
        usageQuery({ llmUser: "ana@example.com" }),
      );

      expect(response.totals.costUsd).toBeCloseTo(3, 6);
      expect(response.totals.inputTokens).toBe(570);
    });

    test("a range that started after a session began counts only its growth since", async () => {
      // From the moment between Ben's first and second points in the range.
      const response: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
        usageQuery({
          startTime: new Date(now - DAY + 30 * 1000),
          llmUser: "ben@example.com",
        }),
      );

      // 41.5 -> 44.
      expect(response.totals.costUsd).toBeCloseTo(2.5, 6);
    });

    test("a range with nothing in it reads nothing", async () => {
      const response: LlmMetricUsageResponse = await LlmMetricUsageReader.read(
        usageQuery({
          startTime: new Date(now - 30 * DAY),
          endTime: new Date(now - 20 * DAY),
        }),
      );

      expect(response.totals.hasCost).toBe(false);
      expect(response.totals.hasTokens).toBe(false);
      expect(response.groups).toEqual([]);
    });
  });

  describe("the setup check", () => {
    function wireConnections(
      connections: Array<LlmObservabilityConnection>,
    ): void {
      jest
        .spyOn(LlmObservabilityConnectionService, "findBy")
        .mockResolvedValue(connections as never);
    }

    test("apps, providers, answers and what was recorded; a company tool's chats are its own", async () => {
      wireConnections([
        connection({
          id: TOOL_CONNECTION,
          provider: LlmConnectionProvider.ClaudeEnterprise,
          serviceId: toolService,
        }),
      ]);

      const check: LlmSetupCheckResponse = await LlmSetupCheckReader.read(
        checkQuery({
          windowStart: new Date(now - 6 * HOUR),
          windowEnd: new Date(now + MINUTE),
        }),
      );

      expect(check.apps).not.toBeNull();
      // checkout's four calls and search's one this week; not the tool's.
      expect(check.apps!.callsRecently).toBe(5);
      // In the last six hours: checkout's three.
      expect(check.apps!.callsInWindow).toBe(3);
      expect(
        check.apps!.services.map((service: { serviceId: string }) => {
          return service.serviceId;
        }),
      ).toEqual([checkoutService.toString(), searchService.toString()]);
      expect(
        check.apps!.providers.map((provider: { name: string }) => {
          return provider.name;
        }),
      ).toEqual(["azure.ai.openai", "openai"]);
      // Four answers (the tool call is not one), one with its question.
      expect(check.apps!.answersRecently).toBe(4);
      expect(check.apps!.answersWithContent).toBe(1);
      // Some recorded: the logs are not looked at.
      expect(check.apps!.contentInLogs).toBeNull();
      // Apps send calls: nothing is looked for in plain HTTP spans.
      expect(check.apps!.uninstrumented).toBeNull();

      const tool: LlmSetupCheckConnection | undefined =
        check.connections?.find((item: LlmSetupCheckConnection) => {
          return item.connectionId === TOOL_CONNECTION;
        });

      expect(tool?.kind).toBe("company-tool");
      expect(tool?.callsRecently).toBe(2);
    });

    test("no call in the window: the newest one, so the view can widen to it", async () => {
      wireConnections([]);

      const check: LlmSetupCheckResponse = await LlmSetupCheckReader.read(
        checkQuery({
          projectId: checkProject,
          now: new Date(now - 10 * DAY),
          windowStart: new Date(now - 11 * DAY),
          windowEnd: new Date(now - 10 * DAY),
        }),
      );

      expect(check.apps!.callsInWindow).toBe(0);
      expect(check.apps!.callsRecently).toBe(0);
      // search's call 20 days ago.
      expect(
        Math.abs(
          new Date(check.apps!.newestCallAt!).getTime() - (now - 20 * DAY),
        ),
      ).toBeLessThan(2000);
    });

    test("an app calling Azure OpenAI and OpenAI with nothing recording it", async () => {
      wireConnections([]);

      const check: LlmSetupCheckResponse = await LlmSetupCheckReader.read(
        checkQuery({ projectId: quietProject }),
      );

      expect(check.apps!.callsRecently).toBe(0);
      expect(check.apps!.newestCallAt).toBeNull();
      expect(check.apps!.uninstrumented).toEqual([
        {
          serviceId: checkoutService.toString(),
          host: "contoso.openai.azure.com",
          provider: "azure.ai.openai",
          calls: 2,
        },
        {
          serviceId: searchService.toString(),
          host: "api.openai.com",
          provider: "openai",
          calls: 1,
        },
      ]);
    });

    test("answers without what was said, and GenAI events on the logs signal", async () => {
      wireConnections([]);

      // checkout's two unrecorded answers in the last few hours only.
      const check: LlmSetupCheckResponse = await LlmSetupCheckReader.read(
        checkQuery({
          serviceIds: [checkoutService],
          now: new Date(now - 2.5 * HOUR),
        }),
      );

      expect(check.apps!.answersRecently).toBeGreaterThan(0);
      expect(check.apps!.answersWithContent).toBe(0);
      expect(check.apps!.contentInLogs).toBe(true);
    });

    test("the logs are not read for a reader who may not read them", async () => {
      wireConnections([]);

      const check: LlmSetupCheckResponse = await LlmSetupCheckReader.read(
        checkQuery({
          serviceIds: [checkoutService],
          now: new Date(now - 2.5 * HOUR),
          logFilter: null,
        }),
      );

      expect(check.apps!.contentInLogs).toBeNull();
    });

    test("coding tools by their metrics of the past week", async () => {
      wireConnections([]);

      const check: LlmSetupCheckResponse = await LlmSetupCheckReader.read(
        checkQuery(),
      );

      const sources: Array<LlmMetricSource> = (check.metrics || []).map(
        (metric: { source: LlmMetricSource }) => {
          return metric.source;
        },
      );

      expect(sources).toEqual(
        expect.arrayContaining([
          LlmMetricSource.ClaudeCode,
          LlmMetricSource.Cursor,
          LlmMetricSource.GenAi,
        ]),
      );
      // Codex's point was ten days ago.
      expect(sources).not.toContain(LlmMetricSource.Codex);

      const claude: { points: number } | undefined = (check.metrics || []).find(
        (metric: { source: LlmMetricSource }) => {
          return metric.source === LlmMetricSource.ClaudeCode;
        },
      );

      // Both of Claude Code's metrics, as one tool.
      expect(claude?.points).toBe(2);
    });

    test("a reader who may not read metrics: that part is not read", async () => {
      wireConnections([]);

      const check: LlmSetupCheckResponse = await LlmSetupCheckReader.read(
        checkQuery({ metricFilter: null }),
      );

      expect(check.metrics).toBeNull();
      expect(check.apps).not.toBeNull();
    });

    test("a provider account's newest day with usage, from its own metrics", async () => {
      wireConnections([
        connection({
          id: ACCOUNT_CONNECTION,
          provider: LlmConnectionProvider.AzureOpenAI,
          serviceId: accountService,
        }),
      ]);

      const check: LlmSetupCheckResponse = await LlmSetupCheckReader.read(
        checkQuery(),
      );

      const account: LlmSetupCheckConnection | undefined =
        check.connections?.find((item: LlmSetupCheckConnection) => {
          return item.connectionId === ACCOUNT_CONNECTION;
        });

      expect(account?.kind).toBe("provider-account");
      // Two days ago had cost; yesterday's 0 is not usage.
      expect(account?.newestUsageAt?.substring(0, 10)).toBe(
        new Date(now - 2 * DAY).toISOString().substring(0, 10),
      );
      expect(account?.resources).toBe(2);
      expect(account?.callsRecently).toBeNull();
    });
  });
});

describe("GenAI metric usage and setup check ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
