import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span from "Common/Models/AnalyticsModels/Span";
import Metric from "Common/Models/AnalyticsModels/Metric";
import LlmCostBudget from "Common/Models/DatabaseModels/LlmCostBudget";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import { ClickHouseSettings } from "Common/Server/Services/AnalyticsDatabaseService";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import {
  SQL,
  Statement,
} from "Common/Server/Utils/AnalyticsDatabase/Statement";
import AnalyticsTableName from "Common/Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import LlmBudgetSpendSource from "Common/Types/LlmObservability/LlmBudgetSpendSource";
import {
  LLM_CONNECTION_ID_ATTRIBUTE,
  LLM_PROVIDER_COST_METRIC_NAME,
  LLM_PROVIDER_TOKENS_METRIC_NAME,
  LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE,
} from "Common/Types/LlmObservability/LlmProviderUsageMetrics";
import { LlmCallKind } from "Common/Types/Telemetry/LlmCallKind";
import {
  LlmConversationListItem,
  LlmConversationListResponse,
  LlmConversationSort,
} from "Common/Types/Telemetry/LlmConversationApi";
import {
  LlmUsageDimension,
  LlmUsageGroup,
  LlmUsageResponse,
  LlmUsageService,
  LlmUsageSource,
} from "Common/Types/Telemetry/LlmUsageApi";
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
 * #6349: the AI usage totals against a real ClickHouse, under both of its
 * query analyzers.
 *
 * The unit suites pin the SQL the readers write and the fold that decides
 * each service's source. What they cannot show is that ClickHouse accepts
 * the SQL and answers the right numbers:
 *
 *   - each service is counted from the signal it sends: a Cursor export (a
 *     service of its own, metrics only) beside the apps' AI calls, an app
 *     that sends spans and metrics for the same calls once, from its spans,
 *     a metric that names no service as one more service - and Cursor's
 *     Admin API points (oneuptime.llm.provider.*) never added to its
 *     export, so the setup check's "never added together" stays true;
 *   - each model call is counted once: an agent run's repeat of its calls'
 *     figures is left out, whether the calls are its children or further
 *     down its trace, an agent run keeps its own figures when no call
 *     inside it reports them, and a framework's span around the SDK's own
 *     span is counted once, each figure on its own - in the Usage tab, a
 *     budget and the conversation list alike;
 *   - a cumulative counter that drops (a restart that keeps its start
 *     time) counts the way Prometheus' increase() does, its points in time
 *     order however they were stored;
 *   - the sets that find the covered calls are built once per query, however
 *     many figures a read counts: the read costs the same for one figure as
 *     for four.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18126:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18126 \
 *     npx jest Tests/Telemetry/LlmUsageCountingClickhouse.test.ts
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
import LlmConversationService from "Common/Server/Services/LlmConversationService";
import LlmCostBudgetEvaluator from "Common/Server/Utils/Telemetry/LlmCostBudgetEvaluator";
import LlmCountedCallsSql, {
  LlmCountedCallsScope,
  LlmFigureColumn,
} from "Common/Server/Utils/Telemetry/LlmCountedCallsSql";
import LlmUsageReader, {
  LlmUsageReadQuery,
} from "Common/Server/Utils/Telemetry/LlmUsageReader";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `llm_usage_counting_test_${process.pid}_${Date.now()}`;

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const now: number = Date.now();
const rangeStart: Date = new Date(now - DAY);
const rangeEnd: Date = new Date(now + MINUTE);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

// One project per scenario, so each read sees only its own rows.
const MIX_PROJECT: ObjectID = new ObjectID("8830000000000000000000a1");
const RESET_PROJECT: ObjectID = new ObjectID("8830000000000000000000a2");
const AGENT_PROJECT: ObjectID = new ObjectID("8830000000000000000000a3");
const WRAPPER_PROJECT: ObjectID = new ObjectID("8830000000000000000000a4");

// The mixed project: two apps, Cursor's export and a Cursor account.
const CHECKOUT: ObjectID = new ObjectID("8830000000000000000000b1");
const SEARCH: ObjectID = new ObjectID("8830000000000000000000b2");
const CURSOR: ObjectID = new ObjectID("8830000000000000000000b3");
const CURSOR_ACCOUNT: ObjectID = new ObjectID("8830000000000000000000b4");
// A laptop's Claude Code, in the reset project.
const LAPTOP: ObjectID = new ObjectID("8830000000000000000000b5");
// An agent app, and an app instrumented twice over.
const AGENT_APP: ObjectID = new ObjectID("8830000000000000000000b6");
const WRAPPED_APP: ObjectID = new ObjectID("8830000000000000000000b7");

const CURSOR_CONNECTION: string = "8830000000000000000000c1";

interface CallFixture {
  projectId: ObjectID;
  serviceId: ObjectID;
  traceId: string;
  spanId: string;
  parentSpanId?: string | undefined;
  at: number;
  durationMs?: number | undefined;
  // An AI call (a GenAI span); false for an app's own span in the trace.
  isLlm?: boolean | undefined;
  kind?: LlmCallKind | undefined;
  model?: string | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cost?: number | undefined;
  email?: string | undefined;
  conversationId?: string | undefined;
}

function callRow(fixture: CallFixture): JSONObject {
  const start: Date = new Date(fixture.at);
  const durationMs: number = fixture.durationMs ?? 1200;
  const end: Date = new Date(fixture.at + durationMs);
  const isLlm: boolean = fixture.isLlm !== false;

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: fixture.projectId.toString(),
    primaryEntityId: fixture.serviceId.toString(),
    primaryEntityType: "Service",
    startTime: OneUptimeDate.toClickhouseDateTime(start),
    endTime: OneUptimeDate.toClickhouseDateTime(end),
    startTimeUnixNano: String(start.getTime() * 1000000),
    endTimeUnixNano: String(end.getTime() * 1000000),
    durationUnixNano: String(durationMs * 1000000),
    traceId: fixture.traceId,
    spanId: fixture.spanId,
    parentSpanId: fixture.parentSpanId || "",
    name: isLlm ? `chat ${fixture.model || "gpt-4o"}` : "POST /tools/search",
    kind: "SPAN_KIND_CLIENT",
    statusCode: 1,
    statusMessage: "",
    attributes: {},
    attributeKeys: [],
    events: "[]",
    isLlmSpan: isLlm,
    llmSystem: isLlm ? "openai" : "",
    llmOperation: isLlm
      ? fixture.kind === LlmCallKind.Agent
        ? "invoke_agent"
        : "chat"
      : "",
    llmRequestModel: isLlm ? fixture.model || "gpt-4o" : "",
    llmInputTokens: fixture.inputTokens || 0,
    llmOutputTokens: fixture.outputTokens || 0,
    llmTotalTokens: (fixture.inputTokens || 0) + (fixture.outputTokens || 0),
    llmCost: fixture.cost || 0,
    llmConversationId: fixture.conversationId || "",
    llmUserEmail: fixture.email || "",
    llmCallKind: isLlm ? fixture.kind || LlmCallKind.Answer : "",
    llmIssues: [],
    llmUserMessagePreview: "",
    retentionDate: retentionDate,
  };
}

interface MetricFixture {
  projectId: ObjectID;
  serviceId: ObjectID;
  name: string;
  value: number;
  at: number;
  // "Delta" unless named; a cumulative point carries its series' start.
  temporality?: "Cumulative" | "Delta" | undefined;
  startedAt?: number | undefined;
  attributes?: Record<string, string> | undefined;
}

function metricRow(fixture: MetricFixture): JSONObject {
  const at: Date = new Date(fixture.at);
  const attributes: Record<string, string> = fixture.attributes || {};

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: fixture.projectId.toString(),
    primaryEntityId: fixture.serviceId.toString(),
    primaryEntityType: "Service",
    name: fixture.name,
    time: OneUptimeDate.toClickhouseDateTime(at),
    timeUnixNano: String(at.getTime() * 1000000),
    metricPointType: "Sum",
    aggregationTemporality: fixture.temporality || "Delta",
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

// A trace id of 32 hex characters, and a span id of 16, from a short tag.
function traceOf(tag: string): string {
  return tag.padEnd(32, "0");
}

function spanOf(tag: string): string {
  return tag.padEnd(16, "0");
}

const ANA: string = "ana@example.com";
const BEN: string = "ben@example.com";
const CAROL: string = "carol@example.com";

/*
 * THE MIXED PROJECT: checkout and search send AI calls, Cursor's export
 * sends metrics under the service `cursor`, and the team's Cursor account
 * (an Admin API connection) writes its own points.
 *
 *   checkout: Ana's call (100 in, 20 out, $0.010) and Ben's (200, 40, $0.020)
 *   search:   one call (50, 10, $0.005), and the same call again as GenAI
 *             metrics - the instrumentation sends both - never added
 *   cursor:   Carol's $0.05 + $0.03, 300 input and 40 output tokens, and
 *             1,000 cache tokens Cursor counts apart (left out)
 *   account:  $0.57 and 960 tokens of the Admin API's points, never added
 *
 * Totals: 3 calls, 650 in, 110 out, $0.115.
 */
const mixCalls: Array<CallFixture> = [
  {
    projectId: MIX_PROJECT,
    serviceId: CHECKOUT,
    traceId: traceOf("a101"),
    spanId: spanOf("a101"),
    at: now - 2 * HOUR,
    inputTokens: 100,
    outputTokens: 20,
    cost: 0.01,
    email: ANA,
  },
  {
    projectId: MIX_PROJECT,
    serviceId: CHECKOUT,
    traceId: traceOf("a102"),
    spanId: spanOf("a102"),
    at: now - 3 * HOUR,
    inputTokens: 200,
    outputTokens: 40,
    cost: 0.02,
    email: BEN,
  },
  {
    projectId: MIX_PROJECT,
    serviceId: SEARCH,
    traceId: traceOf("a103"),
    spanId: spanOf("a103"),
    at: now - HOUR,
    model: "gpt-4o-mini",
    inputTokens: 50,
    outputTokens: 10,
    cost: 0.005,
  },
];

const CURSOR_POINT: Record<string, string> = {
  "cursor.user.email": CAROL,
  "cursor.model.name": "claude-4.5-sonnet",
};

const mixMetrics: Array<MetricFixture> = [
  // search's own call, as its GenAI metrics count it.
  {
    projectId: MIX_PROJECT,
    serviceId: SEARCH,
    name: "gen_ai.client.token.usage",
    value: 50,
    at: now - HOUR,
    attributes: {
      "gen_ai.token.type": "input",
      "gen_ai.request.model": "gpt-4o-mini",
    },
  },
  {
    projectId: MIX_PROJECT,
    serviceId: SEARCH,
    name: "gen_ai.client.token.usage",
    value: 10,
    at: now - HOUR,
    attributes: {
      "gen_ai.token.type": "output",
      "gen_ai.request.model": "gpt-4o-mini",
    },
  },
  {
    projectId: MIX_PROJECT,
    serviceId: SEARCH,
    name: "gen_ai.client.cost",
    value: 0.005,
    at: now - HOUR,
    attributes: { "gen_ai.request.model": "gpt-4o-mini" },
  },
  // Cursor's OpenTelemetry export: delta points under the service `cursor`.
  {
    projectId: MIX_PROJECT,
    serviceId: CURSOR,
    name: "cursor.cost.usage",
    value: 0.05,
    at: now - 2 * HOUR,
    attributes: CURSOR_POINT,
  },
  {
    projectId: MIX_PROJECT,
    serviceId: CURSOR,
    name: "cursor.cost.usage",
    value: 0.03,
    at: now - HOUR,
    attributes: CURSOR_POINT,
  },
  {
    projectId: MIX_PROJECT,
    serviceId: CURSOR,
    name: "cursor.token.usage",
    value: 300,
    at: now - 2 * HOUR,
    attributes: { ...CURSOR_POINT, "cursor.token.type": "input" },
  },
  {
    projectId: MIX_PROJECT,
    serviceId: CURSOR,
    name: "cursor.token.usage",
    value: 40,
    at: now - 2 * HOUR,
    attributes: { ...CURSOR_POINT, "cursor.token.type": "output" },
  },
  {
    projectId: MIX_PROJECT,
    serviceId: CURSOR,
    name: "cursor.token.usage",
    value: 1000,
    at: now - 2 * HOUR,
    attributes: { ...CURSOR_POINT, "cursor.token.type": "cacheRead" },
  },
  // The Cursor account's Admin API points: Provider accounts', never these totals'.
  {
    projectId: MIX_PROJECT,
    serviceId: CURSOR_ACCOUNT,
    name: LLM_PROVIDER_COST_METRIC_NAME,
    value: 0.57,
    at: now - 2 * HOUR,
    attributes: {
      [LLM_CONNECTION_ID_ATTRIBUTE]: CURSOR_CONNECTION,
      "user.email": CAROL,
    },
  },
  {
    projectId: MIX_PROJECT,
    serviceId: CURSOR_ACCOUNT,
    name: LLM_PROVIDER_TOKENS_METRIC_NAME,
    value: 960,
    at: now - 2 * HOUR,
    attributes: {
      [LLM_CONNECTION_ID_ATTRIBUTE]: CURSOR_CONNECTION,
      [LLM_PROVIDER_TOKEN_TYPE_ATTRIBUTE]: "input",
      "user.email": CAROL,
    },
  },
];

/*
 * THE RESET PROJECT: Claude Code on a laptop, exporting running totals
 * (cumulative) - and restarting under a collector that keeps the start
 * time, so the counters drop.
 *
 *   Ana's cost, started before the range: 10 -> 15 -> 2 -> 5, stored out
 *   of order. Grew by 5 + 2 + 3 = 10 in the range (the point of the day
 *   before is outside it).
 *   Ben's cost, started in the range: 1 -> 3 -> 0.5 -> 2, so from zero:
 *   1 + 2 + 0.5 + 1.5 = 5.
 *   Ana's input tokens, started before: 1000 -> 1500 -> 200 -> 700, grew
 *   by 500 + 200 + 500 = 1,200.
 *   A cost metric that names no service (under the project itself): $0.25,
 *   one more service.
 *
 * Totals: no calls, 1,200 in, $15.25.
 */
const anaSession: Record<string, string> = {
  "user.email": ANA,
  "session.id": "s1",
};
const benSession: Record<string, string> = {
  "user.email": BEN,
  "session.id": "s2",
};

function cumulativePoint(data: {
  name: string;
  value: number;
  at: number;
  startedAt: number;
  attributes: Record<string, string>;
}): MetricFixture {
  return {
    projectId: RESET_PROJECT,
    serviceId: LAPTOP,
    name: data.name,
    value: data.value,
    at: data.at,
    temporality: "Cumulative",
    startedAt: data.startedAt,
    attributes: data.attributes,
  };
}

const anaStarted: number = now - 3 * DAY;
const benStarted: number = now - 5 * HOUR;

const resetMetrics: Array<MetricFixture> = [
  // Ana's cost, stored in the order 2, 10, 5, 15 - and its point of the day before.
  cumulativePoint({
    name: "claude_code.cost.usage",
    value: 2,
    at: now - 2 * HOUR,
    startedAt: anaStarted,
    attributes: anaSession,
  }),
  cumulativePoint({
    name: "claude_code.cost.usage",
    value: 10,
    at: now - 4 * HOUR,
    startedAt: anaStarted,
    attributes: anaSession,
  }),
  cumulativePoint({
    name: "claude_code.cost.usage",
    value: 5,
    at: now - HOUR,
    startedAt: anaStarted,
    attributes: anaSession,
  }),
  cumulativePoint({
    name: "claude_code.cost.usage",
    value: 15,
    at: now - 3 * HOUR,
    startedAt: anaStarted,
    attributes: anaSession,
  }),
  cumulativePoint({
    name: "claude_code.cost.usage",
    value: 3,
    at: now - 2 * DAY,
    startedAt: anaStarted,
    attributes: anaSession,
  }),
  // Ben's cost, a series that started in the range.
  ...[1, 3, 0.5, 2].map((value: number, index: number): MetricFixture => {
    return cumulativePoint({
      name: "claude_code.cost.usage",
      value: value,
      at: benStarted + 30 * MINUTE + index * HOUR,
      startedAt: benStarted,
      attributes: benSession,
    });
  }),
  // Ana's input tokens.
  ...[1000, 1500, 200, 700].map(
    (value: number, index: number): MetricFixture => {
      return cumulativePoint({
        name: "claude_code.token.usage",
        value: value,
        at: now - 4 * HOUR + index * HOUR,
        startedAt: anaStarted,
        attributes: { ...anaSession, type: "input" },
      });
    },
  ),
  // A cost metric that names no service: stored under the project itself.
  {
    projectId: RESET_PROJECT,
    serviceId: RESET_PROJECT,
    name: "gen_ai.client.cost",
    value: 0.25,
    at: now - HOUR,
  },
];

/*
 * THE AGENT PROJECT: three agent runs, a conversation each.
 *
 *   conv-a: a run reporting its two calls' sum (300, 60, $0.03) over its
 *           children (100, 20, $0.01) and (200, 40, $0.02): $0.03 once.
 *   conv-b: a run reporting $0.05 (500, 100) over a tool span of the app's
 *           own, under which the call reports the same: the call is in the
 *           run's time and trace, so $0.05 once.
 *   conv-c: a run reporting (80, 16, $0.008) over a call that reports
 *           nothing (its instrumentation reads no usage): the run's own.
 *
 * Totals: 7 AI calls, 880 in, 176 out, $0.088.
 */
const agentStart: number = now - 3 * HOUR;

const agentCalls: Array<CallFixture> = [
  {
    projectId: AGENT_PROJECT,
    serviceId: AGENT_APP,
    traceId: traceOf("c1"),
    spanId: spanOf("c101"),
    at: agentStart,
    durationMs: 10 * SECOND,
    kind: LlmCallKind.Agent,
    inputTokens: 300,
    outputTokens: 60,
    cost: 0.03,
    email: ANA,
    conversationId: "conv-a",
  },
  {
    projectId: AGENT_PROJECT,
    serviceId: AGENT_APP,
    traceId: traceOf("c1"),
    spanId: spanOf("c102"),
    parentSpanId: spanOf("c101"),
    at: agentStart + SECOND,
    inputTokens: 100,
    outputTokens: 20,
    cost: 0.01,
    email: ANA,
    conversationId: "conv-a",
  },
  {
    projectId: AGENT_PROJECT,
    serviceId: AGENT_APP,
    traceId: traceOf("c1"),
    spanId: spanOf("c103"),
    parentSpanId: spanOf("c101"),
    at: agentStart + 3 * SECOND,
    inputTokens: 200,
    outputTokens: 40,
    cost: 0.02,
    email: ANA,
    conversationId: "conv-a",
  },
  {
    projectId: AGENT_PROJECT,
    serviceId: AGENT_APP,
    traceId: traceOf("c2"),
    spanId: spanOf("c201"),
    at: agentStart + HOUR,
    durationMs: 20 * SECOND,
    kind: LlmCallKind.Agent,
    inputTokens: 500,
    outputTokens: 100,
    cost: 0.05,
    email: BEN,
    conversationId: "conv-b",
  },
  {
    projectId: AGENT_PROJECT,
    serviceId: AGENT_APP,
    traceId: traceOf("c2"),
    spanId: spanOf("c202"),
    parentSpanId: spanOf("c201"),
    at: agentStart + HOUR + SECOND,
    durationMs: 5 * SECOND,
    isLlm: false,
  },
  {
    projectId: AGENT_PROJECT,
    serviceId: AGENT_APP,
    traceId: traceOf("c2"),
    spanId: spanOf("c203"),
    parentSpanId: spanOf("c202"),
    at: agentStart + HOUR + 2 * SECOND,
    inputTokens: 500,
    outputTokens: 100,
    cost: 0.05,
    email: BEN,
    conversationId: "conv-b",
  },
  {
    projectId: AGENT_PROJECT,
    serviceId: AGENT_APP,
    traceId: traceOf("c3"),
    spanId: spanOf("c301"),
    at: agentStart + 2 * HOUR,
    durationMs: 10 * SECOND,
    kind: LlmCallKind.Agent,
    inputTokens: 80,
    outputTokens: 16,
    cost: 0.008,
    email: BEN,
    conversationId: "conv-c",
  },
  {
    projectId: AGENT_PROJECT,
    serviceId: AGENT_APP,
    traceId: traceOf("c3"),
    spanId: spanOf("c302"),
    parentSpanId: spanOf("c301"),
    at: agentStart + 2 * HOUR + SECOND,
    email: BEN,
    conversationId: "conv-c",
  },
];

/*
 * THE WRAPPER PROJECT: an app instrumented twice over, a framework's span
 * around the SDK's own.
 *
 *   one call: the framework's span and the SDK's both report (100, 20,
 *             $0.01): once.
 *   another:  both report the tokens (70, 14), only the framework's span
 *             the cost ($0.007): the SDK's tokens and the framework's cost.
 *
 * Totals: 4 AI calls, 170 in, 34 out, $0.017.
 */
const wrapperCalls: Array<CallFixture> = [
  {
    projectId: WRAPPER_PROJECT,
    serviceId: WRAPPED_APP,
    traceId: traceOf("d1"),
    spanId: spanOf("d101"),
    at: now - 2 * HOUR,
    inputTokens: 100,
    outputTokens: 20,
    cost: 0.01,
  },
  {
    projectId: WRAPPER_PROJECT,
    serviceId: WRAPPED_APP,
    traceId: traceOf("d1"),
    spanId: spanOf("d102"),
    parentSpanId: spanOf("d101"),
    at: now - 2 * HOUR + 100,
    inputTokens: 100,
    outputTokens: 20,
    cost: 0.01,
  },
  {
    projectId: WRAPPER_PROJECT,
    serviceId: WRAPPED_APP,
    traceId: traceOf("d2"),
    spanId: spanOf("d201"),
    at: now - HOUR,
    inputTokens: 70,
    outputTokens: 14,
    cost: 0.007,
  },
  {
    projectId: WRAPPER_PROJECT,
    serviceId: WRAPPED_APP,
    traceId: traceOf("d2"),
    spanId: spanOf("d202"),
    parentSpanId: spanOf("d201"),
    at: now - HOUR + 100,
    inputTokens: 70,
    outputTokens: 14,
  },
];

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

async function readJson<T>(
  client: ClickhouseClient,
  query: string,
  queryParams: Record<string, unknown> = {},
): Promise<Array<T>> {
  const result: { json: () => Promise<unknown> } = await client.query({
    query: query,
    query_params: queryParams,
    format: "JSONEachRow",
  });

  return (await result.json()) as Array<T>;
}

type WiredService = {
  database: ClickhouseDatabase;
  databaseClient: ClickhouseClient | null;
  ingestDatabase: ClickhouseDatabase;
  ingestDatabaseClient: ClickhouseClient | null;
};

interface Connection {
  name: string;
  database: ClickhouseDatabase;
  client: ClickhouseClient;
  olderAnalyzerSetting: string | null;
}

function usageQuery(
  projectId: ObjectID,
  dimension: LlmUsageDimension,
  overrides: Partial<LlmUsageReadQuery> = {},
): LlmUsageReadQuery {
  return {
    projectId: projectId,
    startTime: rangeStart,
    endTime: rangeEnd,
    dimension: dimension,
    ...overrides,
  };
}

function serviceOf(
  response: LlmUsageResponse,
  serviceId: ObjectID,
): LlmUsageService | undefined {
  return response.services.find((service: LlmUsageService): boolean => {
    return service.serviceId === serviceId.toString();
  });
}

function groupOf(
  response: LlmUsageResponse,
  key: string,
): LlmUsageGroup | undefined {
  return response.groups.find((group: LlmUsageGroup): boolean => {
    return group.key === key;
  });
}

// The cost of each group, rounded to a tenth of a cent, by key.
function costsByKey(response: LlmUsageResponse): Record<string, number> {
  const costs: Record<string, number> = {};

  for (const group of response.groups) {
    costs[group.key] = Math.round(group.costUsd * 10000) / 10000;
  }

  return costs;
}

function budget(data: {
  projectId: ObjectID;
  serviceId?: ObjectID | undefined;
}): LlmCostBudget {
  const item: LlmCostBudget = new LlmCostBudget();
  item.projectId = data.projectId;
  item.spendSource = LlmBudgetSpendSource.Calls;

  if (data.serviceId) {
    item.serviceId = data.serviceId;
  }

  return item;
}

/*
 * `SELECT sum(<counted column>), ... FROM <spans> WHERE projectId = ...`:
 * the given figure columns of a project's AI calls, each model call once.
 */
function countedSumsStatement(
  scope: LlmCountedCallsScope,
  columns: Array<LlmFigureColumn>,
): Statement {
  const statement: Statement = new Statement();

  statement.append("SELECT ");

  if (columns.length === 0) {
    statement.append("sum(llmInputTokens) AS figure0");
  }

  columns.forEach((column: LlmFigureColumn, index: number) => {
    if (index > 0) {
      statement.append(", ");
    }

    statement.append("sum(");
    statement.append(LlmCountedCallsSql.buildCountedColumn(scope, column));
    statement.append(`) AS figure${index}`);
  });

  statement.append(
    SQL` FROM ${AnalyticsTableName.Span} WHERE projectId = ${{
      type: TableColumnType.ObjectID,
      value: scope.projectId,
    }} AND isLlmSpan = 1`,
  );

  return statement;
}

integration("AI usage counting against ClickHouse (#6349)", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  const connections: Array<Connection> = [];
  const originals: Array<{ service: WiredService; saved: WiredService }> = [];
  // A setting that turns off ClickHouse's query condition cache, where the server has one.
  let conditionCacheSetting: string | null = null;

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
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    for (const modelType of [Span, Metric]) {
      await createTable(
        client,
        clickhouse,
        modelType as unknown as { new (): AnalyticsBaseModel },
      );
    }

    connections.push({
      name: "the current analyzer",
      database: clickhouse,
      client: client,
      olderAnalyzerSetting: null,
    });

    const [setting] = await readJson<{ name: string }>(
      client,
      "SELECT name FROM system.settings WHERE name IN ('enable_analyzer', 'allow_experimental_analyzer') ORDER BY name = 'enable_analyzer' DESC LIMIT 1",
    );

    if (setting) {
      const olderOptions: ClickHouseClientConfigOptions = {
        ...options,
        clickhouse_settings: { [setting.name]: 0 } as ClickHouseSettings,
      };
      const olderDatabase: ClickhouseDatabase = new ClickhouseDatabase(
        olderOptions,
      );
      const olderClient: ClickhouseClient =
        await olderDatabase.connect(olderOptions);

      connections.push({
        name: "the older analyzer",
        database: olderDatabase,
        client: olderClient,
        olderAnalyzerSetting: setting.name,
      });
    }

    const [cacheSetting] = await readJson<{ name: string }>(
      client,
      "SELECT name FROM system.settings WHERE name = 'use_query_condition_cache' LIMIT 1",
    );

    conditionCacheSetting = cacheSetting ? cacheSetting.name : null;

    for (const service of [SpanService, MetricService]) {
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

    await SpanService.insertJsonRows(
      [...mixCalls, ...agentCalls, ...wrapperCalls].map(callRow),
      { clickhouseSettings: { wait_for_async_insert: 1 } },
    );
    await MetricService.insertJsonRows(
      [...mixMetrics, ...resetMetrics].map(metricRow),
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

    for (const connection of connections) {
      await connection.database.disconnect();
    }
  });

  test("the server knows the older analyzer, so both are run", () => {
    expect(
      connections.map((connection: Connection): string => {
        return connection.name;
      }),
    ).toEqual(["the current analyzer", "the older analyzer"]);
  });

  test("the older connection reads with the older analyzer", async () => {
    const older: Connection | undefined = connections[1];

    expect(older?.olderAnalyzerSetting).toBeTruthy();

    const [row] = await readJson<{ analyzer: string | number }>(
      older!.client,
      `SELECT toUInt8(getSetting('${older!.olderAnalyzerSetting}')) AS analyzer`,
    );

    expect(Number(row!.analyzer)).toBe(0);
  });

  describe.each([
    ["the current analyzer", 0],
    ["the older analyzer (enable_analyzer = 0)", 1],
  ])("through %s", (_name: string, position: number) => {
    beforeAll((): void => {
      const connection: Connection = connections[position]!;

      for (const service of [SpanService, MetricService]) {
        const wired: WiredService = service as unknown as WiredService;
        wired.database = connection.database;
        wired.databaseClient = connection.client;
      }
    });

    test("counts Cursor's export beside the apps' calls, and an app that sends both once", async () => {
      const usage: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(MIX_PROJECT, LlmUsageDimension.None),
      );

      expect(usage.totals.calls).toBe(3);
      expect(usage.totals.inputTokens).toBe(650);
      expect(usage.totals.outputTokens).toBe(110);
      expect(usage.totals.costUsd).toBeCloseTo(0.115, 9);
      expect(usage.totals.tokenSource).toBe(LlmUsageSource.Both);
      expect(usage.totals.costSource).toBe(LlmUsageSource.Both);
      expect(usage.metricsLeftOut).toBe(false);
      expect(usage.truncated).toBe(false);

      // Each service from one signal: never search's metrics on top of its calls.
      expect(serviceOf(usage, CHECKOUT)).toMatchObject({
        calls: 2,
        inputTokens: 300,
        outputTokens: 60,
        tokenSource: LlmUsageSource.Calls,
        costSource: LlmUsageSource.Calls,
      });
      expect(serviceOf(usage, SEARCH)).toMatchObject({
        calls: 1,
        inputTokens: 50,
        outputTokens: 10,
        tokenSource: LlmUsageSource.Calls,
        costSource: LlmUsageSource.Calls,
      });
      expect(serviceOf(usage, SEARCH)!.costUsd).toBeCloseTo(0.005, 9);

      // Cursor's input and output tokens, its cache tokens left out.
      expect(serviceOf(usage, CURSOR)).toMatchObject({
        calls: 0,
        inputTokens: 300,
        outputTokens: 40,
        tokenSource: LlmUsageSource.Metrics,
        costSource: LlmUsageSource.Metrics,
      });
      expect(serviceOf(usage, CURSOR)!.costUsd).toBeCloseTo(0.08, 9);

      // The Cursor account's Admin API points are Provider accounts', never these totals'.
      expect(serviceOf(usage, CURSOR_ACCOUNT)).toBeUndefined();
    });

    test("files a metrics-only tool's spend under the person, model, provider and service its points name", async () => {
      const byPerson: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(MIX_PROJECT, LlmUsageDimension.Employee),
      );

      expect(costsByKey(byPerson)).toEqual({
        [ANA]: 0.01,
        [BEN]: 0.02,
        [CAROL]: 0.08,
        "": 0.005,
      });
      expect(groupOf(byPerson, CAROL)).toMatchObject({
        calls: 0,
        inputTokens: 300,
        outputTokens: 40,
        tokenSource: LlmUsageSource.Metrics,
        costSource: LlmUsageSource.Metrics,
      });
      expect(groupOf(byPerson, ANA)).toMatchObject({
        calls: 1,
        inputTokens: 100,
        tokenSource: LlmUsageSource.Calls,
      });
      // The grouped read's totals are the ungrouped read's.
      expect(byPerson.totals.costUsd).toBeCloseTo(0.115, 9);
      expect(byPerson.totals.inputTokens).toBe(650);

      const byModel: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(MIX_PROJECT, LlmUsageDimension.Model),
      );

      expect(costsByKey(byModel)).toEqual({
        "gpt-4o": 0.03,
        "gpt-4o-mini": 0.005,
        "claude-4.5-sonnet": 0.08,
      });

      // Cursor names no provider: its spend is Unattributed.
      const byProvider: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(MIX_PROJECT, LlmUsageDimension.Provider),
      );

      expect(costsByKey(byProvider)).toEqual({ openai: 0.035, "": 0.08 });

      const byService: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(MIX_PROJECT, LlmUsageDimension.Service),
      );

      expect(costsByKey(byService)).toEqual({
        [CHECKOUT.toString()]: 0.03,
        [SEARCH.toString()]: 0.005,
        [CURSOR.toString()]: 0.08,
      });
    });

    test("leaves the usage metrics out for a reader who may not read metrics, and says so", async () => {
      const usage: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(MIX_PROJECT, LlmUsageDimension.None, {
          metricFilter: null,
        }),
      );

      expect(usage.metricsLeftOut).toBe(true);
      expect(usage.totals.costUsd).toBeCloseTo(0.035, 9);
      expect(usage.totals.costSource).toBe(LlmUsageSource.Calls);
      expect(serviceOf(usage, CURSOR)).toBeUndefined();
    });

    test("a budget counts the same: every service, each from its own signal", async () => {
      const whole: { spendInUSD: number; source: string } =
        await LlmCostBudgetEvaluator.resolveSpend({
          budget: budget({ projectId: MIX_PROJECT }),
          dayStart: rangeStart,
          now: rangeEnd,
        });

      expect(whole.spendInUSD).toBeCloseTo(0.115, 9);
      expect(whole.source).toBe("both");

      const onSearch: { spendInUSD: number; source: string } =
        await LlmCostBudgetEvaluator.resolveSpend({
          budget: budget({ projectId: MIX_PROJECT, serviceId: SEARCH }),
          dayStart: rangeStart,
          now: rangeEnd,
        });

      expect(onSearch.spendInUSD).toBeCloseTo(0.005, 9);
      expect(onSearch.source).toBe("spans");

      const onCursor: { spendInUSD: number; source: string } =
        await LlmCostBudgetEvaluator.resolveSpend({
          budget: budget({ projectId: MIX_PROJECT, serviceId: CURSOR }),
          dayStart: rangeStart,
          now: rangeEnd,
        });

      expect(onCursor.spendInUSD).toBeCloseTo(0.08, 9);
      expect(onCursor.source).toBe("metrics");
    });

    test("counts a cumulative counter's drops as restarts from zero, its points in time order", async () => {
      const usage: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(RESET_PROJECT, LlmUsageDimension.None),
      );

      expect(usage.totals.calls).toBe(0);
      expect(usage.totals.inputTokens).toBe(1200);
      expect(usage.totals.costUsd).toBeCloseTo(15.25, 9);
      expect(usage.totals.costSource).toBe(LlmUsageSource.Metrics);
      expect(usage.totals.tokenSource).toBe(LlmUsageSource.Metrics);

      expect(serviceOf(usage, LAPTOP)!.costUsd).toBeCloseTo(15, 9);
      // A metric that names no service is one service like any other.
      expect(serviceOf(usage, RESET_PROJECT)).toMatchObject({
        costSource: LlmUsageSource.Metrics,
      });
      expect(serviceOf(usage, RESET_PROJECT)!.costUsd).toBeCloseTo(0.25, 9);

      const byPerson: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(RESET_PROJECT, LlmUsageDimension.Employee),
      );

      // Ana's 10 (5 + 2 + 3) and Ben's 5 (1 + 2 + 0.5 + 1.5); the unnamed $0.25 under nobody.
      expect(costsByKey(byPerson)).toEqual({ [ANA]: 10, [BEN]: 5, "": 0.25 });
      expect(groupOf(byPerson, ANA)!.inputTokens).toBe(1200);
    });

    test("counts each model call once in an agent run, and a run's own figures when its calls report none", async () => {
      const usage: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(AGENT_PROJECT, LlmUsageDimension.None),
      );

      // Every AI call is a call; the app's own tool span is not.
      expect(usage.totals.calls).toBe(7);
      expect(usage.totals.inputTokens).toBe(880);
      expect(usage.totals.outputTokens).toBe(176);
      expect(usage.totals.costUsd).toBeCloseTo(0.088, 9);
      expect(usage.totals.costSource).toBe(LlmUsageSource.Calls);

      const byPerson: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(AGENT_PROJECT, LlmUsageDimension.Employee),
      );

      expect(costsByKey(byPerson)).toEqual({ [ANA]: 0.03, [BEN]: 0.058 });

      const onAgents: { spendInUSD: number; source: string } =
        await LlmCostBudgetEvaluator.resolveSpend({
          budget: budget({ projectId: AGENT_PROJECT }),
          dayStart: rangeStart,
          now: rangeEnd,
        });

      expect(onAgents.spendInUSD).toBeCloseTo(0.088, 9);
      expect(onAgents.source).toBe("spans");
    });

    test("the conversation list counts each model call once too", async () => {
      const response: LlmConversationListResponse =
        await LlmConversationService.listConversations({
          projectId: AGENT_PROJECT,
          startTime: rangeStart,
          endTime: rangeEnd,
          sort: LlmConversationSort.Newest,
          limit: 25,
          skip: 0,
          includeSummary: true,
        });

      const byConversation: Record<
        string,
        { costUsd: number; inputTokens: number; outputTokens: number }
      > = {};

      response.conversations.forEach(
        (conversation: LlmConversationListItem): void => {
          byConversation[conversation.conversationId] = {
            costUsd: Math.round(conversation.costUsd * 10000) / 10000,
            inputTokens: conversation.inputTokens,
            outputTokens: conversation.outputTokens,
          };
        },
      );

      expect(byConversation).toEqual({
        "conv-a": { costUsd: 0.03, inputTokens: 300, outputTokens: 60 },
        "conv-b": { costUsd: 0.05, inputTokens: 500, outputTokens: 100 },
        "conv-c": { costUsd: 0.008, inputTokens: 80, outputTokens: 16 },
      });
      expect(response.summary!.costUsd).toBeCloseTo(0.088, 9);
      expect(response.summary!.inputTokens).toBe(880);
    });

    test("counts a framework's span around the SDK's own once, each figure on its own", async () => {
      const usage: LlmUsageResponse = await LlmUsageReader.read(
        usageQuery(WRAPPER_PROJECT, LlmUsageDimension.None),
      );

      expect(usage.totals.calls).toBe(4);
      expect(usage.totals.inputTokens).toBe(170);
      expect(usage.totals.outputTokens).toBe(34);
      // The framework's $0.007 stays: the SDK's span under it reports no cost.
      expect(usage.totals.costUsd).toBeCloseTo(0.017, 9);
    });

    test("builds the covered calls' sets once per query, however many figures a read counts", async () => {
      const connection: Connection = connections[position]!;
      const scope: LlmCountedCallsScope = {
        projectId: AGENT_PROJECT,
        startTime: rangeStart,
        endTime: rangeEnd,
      };

      // The rows a statement read, from the server's query log.
      const readRows: (
        statement: Statement,
        tag: string,
      ) => Promise<{ rows: number; figures: Array<number> }> = async (
        statement: Statement,
        tag: string,
      ): Promise<{ rows: number; figures: Array<number> }> => {
        const comment: string = `${database}-${position}-${tag}`;
        const settings: Record<string, unknown> = { log_comment: comment };

        if (conditionCacheSetting) {
          settings[conditionCacheSetting] = 0;
        }

        const result: { json: () => Promise<unknown> } =
          await connection.client.query({
            query: statement.query,
            query_params: statement.query_params,
            format: "JSONEachRow",
            clickhouse_settings: settings as ClickHouseSettings,
          });
        const [answer] = (await result.json()) as Array<
          Record<string, unknown>
        >;

        /*
         * The server logs the query's end a moment after it answers, so the
         * log is flushed and read again until the entry is there.
         */
        let logged: { readRows: string | number } | undefined = undefined;

        for (let attempt: number = 0; attempt < 50 && !logged; attempt++) {
          if (attempt > 0) {
            await new Promise((resolve: (value: unknown) => void) => {
              setTimeout(resolve, 100);
            });
          }

          await client.command({ query: "SYSTEM FLUSH LOGS" });

          [logged] = await readJson<{ readRows: string | number }>(
            client,
            "SELECT read_rows AS readRows FROM system.query_log WHERE log_comment = {comment:String} AND type = 'QueryFinish' ORDER BY event_time_microseconds DESC LIMIT 1",
            { comment: comment },
          );
        }

        expect(logged).toBeDefined();

        return {
          rows: Number(logged!.readRows),
          figures: Object.keys(answer || {})
            .sort()
            .map((key: string): number => {
              return Number((answer || {})[key]);
            }),
        };
      };

      const plain: { rows: number } = await readRows(
        countedSumsStatement(scope, []),
        "plain",
      );
      const one: { rows: number; figures: Array<number> } = await readRows(
        countedSumsStatement(scope, ["llmInputTokens"]),
        "one",
      );
      const four: { rows: number; figures: Array<number> } = await readRows(
        countedSumsStatement(scope, [
          "llmInputTokens",
          "llmOutputTokens",
          "llmTotalTokens",
          "llmCost",
        ]),
        "four",
      );

      // The figures, each model call once: 880 in, 176 out, 1,056 in all, $0.088.
      expect(one.figures).toEqual([880]);
      expect(four.figures.slice(0, 3)).toEqual([880, 176, 1056]);
      expect(four.figures[3]).toBeCloseTo(0.088, 9);

      // The sets read rows of their own - and the same rows for four figures as for one.
      expect(one.rows).toBeGreaterThan(plain.rows);
      expect(four.rows).toBe(one.rows);
    });
  });
});

describe("AI usage counting ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
