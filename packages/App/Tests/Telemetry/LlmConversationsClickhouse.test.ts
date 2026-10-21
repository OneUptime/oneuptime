import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Span from "Common/Models/AnalyticsModels/Span";
import { ClickHouseClientConfigOptions } from "Common/Server/Infrastructure/ClickhouseConfig";
import ClickhouseDatabase, {
  ClickhouseClient,
} from "Common/Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "Common/Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "Common/Server/Utils/AnalyticsDatabase/Statement";
import {
  LlmConversationKeyKind,
  LlmConversationListItem,
  LlmConversationListResponse,
  LlmConversationSort,
} from "Common/Types/Telemetry/LlmConversationApi";
import { LlmAnswerIssue } from "Common/Types/Telemetry/LlmAnswerIssue";
import {
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "Common/Utils/Telemetry/LlmConversationTranscript";
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
 * The AI conversation list and transcript against a real ClickHouse.
 *
 * The unit tests pin the SQL the service writes. What they cannot show is
 * that ClickHouse accepts it and answers what the page needs: that calls
 * group by conversation id - or by trace when none was sent - that a
 * conversation-level filter keeps every call of a matching conversation,
 * that the per-conversation quantile states merge into an answer latency,
 * that the service scope leaves out every call of a service the reader may
 * not read, and that the transcript is built from the stored attributes.
 *
 * Opt in locally by pointing TEST_CLICKHOUSE_URL at a disposable server:
 *
 *   docker run -d --rm -p 18124:8123 -e CLICKHOUSE_PASSWORD=test \
 *     clickhouse/clickhouse-server:26.7
 *   TEST_CLICKHOUSE_URL=http://default:test@localhost:18124 \
 *     npx jest Tests/Telemetry/LlmConversationsClickhouse.test.ts
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
import LlmConversationService, {
  LlmAnswerCountQuery,
  LlmAnswerCounts,
  LlmConversationDetail,
  LlmConversationListQuery,
} from "Common/Server/Services/LlmConversationService";

const endpoint: string | undefined = process.env["TEST_CLICKHOUSE_URL"];

jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;

const database: string = `llm_conversations_test_${process.pid}_${Date.now()}`;

const projectId: ObjectID = new ObjectID("8800000000000000000000a1");
const otherProjectId: ObjectID = new ObjectID("8800000000000000000000a2");
// Two quick calls of one conversation, both inside one whole second.
const quickProjectId: ObjectID = new ObjectID("8800000000000000000000a3");
const supportBotId: ObjectID = new ObjectID("8800000000000000000000b1");
const internalToolId: ObjectID = new ObjectID("8800000000000000000000b2");

const now: number = Date.now();
const windowStart: Date = new Date(now - 60 * 60 * 1000);
const windowEnd: Date = new Date(now + 60 * 1000);

const retentionDate: string = OneUptimeDate.toClickhouseDateTime(
  OneUptimeDate.addRemoveDays(new Date(), 30),
).substring(0, 10);

const TRACE_A: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01";
const TRACE_B: string = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa02";
const TRACE_REQUEST: string = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb03";
const TRACE_FAILED: string = "cccccccccccccccccccccccccccccc04";
const TRACE_INTERNAL: string = "dddddddddddddddddddddddddddddd05";
const TRACE_OTHER: string = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeee06";
/*
 * The second quick call's trace sorts BEFORE the first one's, so the table
 * (sorted by projectId, startTime, primaryEntityId, traceId) stores it first
 * among rows that share a whole-second startTime.
 */
const TRACE_QUICK_FIRST: string = "ffffffffffffffffffffffffffffff08";
const TRACE_QUICK_SECOND: string = "ffffffffffffffffffffffffffffff07";

// A whole second two minutes ago; the quick calls start 100 ms and 300 ms in.
const quickSecond: number = Math.floor((now - 2 * 60 * 1000) / 1000) * 1000;

interface CallFixture {
  projectId?: ObjectID;
  serviceId?: ObjectID;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  conversationId?: string;
  minutesAgo?: number;
  // When the call started (epoch ms), instead of minutesAgo.
  startMs?: number;
  durationMs: number;
  isLlm?: boolean;
  kind?: string;
  operation?: string;
  model?: string;
  statusCode?: number;
  statusMessage?: string;
  issues?: Array<string>;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
  email?: string;
  preview?: string;
  attributes?: Record<string, string>;
  toolName?: string;
}

function messages(list: Array<{ role: string; content: string }>): string {
  return JSON.stringify(list);
}

const calls: Array<CallFixture> = [
  // conv-travel: two traces, three answers by ada, one refusal.
  {
    traceId: TRACE_A,
    spanId: "a000000000000001",
    conversationId: "conv-travel",
    minutesAgo: 30,
    durationMs: 1200,
    model: "gpt-4o",
    cost: 0.01,
    inputTokens: 100,
    outputTokens: 20,
    email: "ada@example.com",
    preview: "Plan a trip to Paris",
    attributes: {
      "gen_ai.input.messages": messages([
        { role: "system", content: "You are a travel bot." },
        { role: "user", content: "Plan a trip to Paris" },
      ]),
      "gen_ai.output.messages": messages([
        { role: "assistant", content: "Day 1: the Louvre." },
      ]),
    },
  },
  {
    traceId: TRACE_B,
    spanId: "a000000000000002",
    conversationId: "conv-travel",
    minutesAgo: 25,
    durationMs: 2400,
    model: "gpt-4o",
    cost: 0.02,
    inputTokens: 200,
    outputTokens: 30,
    email: "ada@example.com",
    preview: "And day 2?",
    attributes: {
      "gen_ai.input.messages": messages([
        { role: "system", content: "You are a travel bot." },
        { role: "user", content: "Plan a trip to Paris" },
        { role: "assistant", content: "Day 1: the Louvre." },
        { role: "user", content: "And day 2?" },
      ]),
      "gen_ai.output.messages": messages([
        { role: "assistant", content: "Day 2: Montmartre." },
      ]),
    },
  },
  {
    traceId: TRACE_B,
    spanId: "a000000000000003",
    conversationId: "conv-travel",
    minutesAgo: 24,
    durationMs: 600,
    model: "gpt-4o-mini",
    cost: 0.001,
    issues: [LlmAnswerIssue.Refused],
    email: "ada@example.com",
    preview: "Book it with my card",
    attributes: {
      "gen_ai.input.messages": messages([
        { role: "user", content: "Book it with my card" },
      ]),
      "gen_ai.output.messages": messages([
        { role: "assistant", content: "I'm sorry, but I can't do that." },
      ]),
    },
  },

  // A request: no conversation id, a chat, a tool run and an embedding.
  {
    traceId: TRACE_REQUEST,
    spanId: "b000000000000001",
    minutesAgo: 20,
    durationMs: 900,
    model: "claude-sonnet-4",
    cost: 0.03,
    email: "bob@example.com",
    preview: "Summarize ticket 42",
    issues: [LlmAnswerIssue.CutOff],
  },
  {
    traceId: TRACE_REQUEST,
    spanId: "b000000000000002",
    parentSpanId: "b000000000000001",
    minutesAgo: 20,
    durationMs: 100,
    kind: "tool",
    operation: "execute_tool",
    model: "",
    toolName: "fetch_ticket",
    attributes: {
      "gen_ai.tool.name": "fetch_ticket",
      "gen_ai.tool.call.result": "Ticket 42: printer on fire",
    },
  },
  {
    traceId: TRACE_REQUEST,
    spanId: "b000000000000003",
    minutesAgo: 19,
    durationMs: 50,
    kind: "embedding",
    operation: "embeddings",
    model: "text-embedding-3-small",
    cost: 0.0001,
  },

  // A failed conversation, written before llmIssues existed (status only).
  {
    traceId: TRACE_FAILED,
    spanId: "c000000000000001",
    conversationId: "conv-failed",
    minutesAgo: 10,
    durationMs: 30000,
    model: "gpt-4o",
    statusCode: 2,
    statusMessage: "upstream timeout",
    kind: "",
    email: "carol@example.com",
    preview: "Why is the 100% discount not applied?",
  },

  // Another service: the scope tests leave it out.
  {
    serviceId: internalToolId,
    traceId: TRACE_INTERNAL,
    spanId: "d000000000000001",
    conversationId: "conv-internal",
    minutesAgo: 5,
    durationMs: 700,
    model: "gpt-4o",
    cost: 0.5,
    issues: [LlmAnswerIssue.Flagged, LlmAnswerIssue.Empty],
    email: "dave@example.com",
    preview: "Internal question",
  },

  // Never listed: another project, outside the window, not an AI call.
  {
    projectId: otherProjectId,
    traceId: TRACE_OTHER,
    spanId: "e000000000000001",
    conversationId: "conv-travel",
    minutesAgo: 15,
    durationMs: 100,
    model: "gpt-4o",
    cost: 99,
  },
  {
    traceId: TRACE_OTHER,
    spanId: "e000000000000002",
    conversationId: "conv-ancient",
    minutesAgo: 600,
    durationMs: 100,
    model: "gpt-4o",
  },
  {
    traceId: TRACE_OTHER,
    spanId: "e000000000000003",
    minutesAgo: 3,
    durationMs: 100,
    isLlm: false,
    statusCode: 2,
  },

  /*
   * conv-quick: a 5 ms answer and, 200 ms later, a 40 ms one - all inside
   * one whole second, in a project of its own.
   */
  {
    projectId: quickProjectId,
    traceId: TRACE_QUICK_FIRST,
    spanId: "f000000000000001",
    conversationId: "conv-quick",
    startMs: quickSecond + 100,
    durationMs: 5,
    model: "gpt-4o",
    email: "erin@example.com",
    preview: "Where should I travel in May?",
    attributes: {
      "gen_ai.input.messages": messages([
        { role: "user", content: "Where should I travel in May?" },
      ]),
      "gen_ai.output.messages": messages([
        { role: "assistant", content: "Lisbon is lovely in May." },
      ]),
    },
  },
  {
    projectId: quickProjectId,
    traceId: TRACE_QUICK_SECOND,
    spanId: "f000000000000002",
    conversationId: "conv-quick",
    startMs: quickSecond + 300,
    durationMs: 40,
    model: "gpt-4o",
    email: "erin@example.com",
    preview: "And in June?",
    attributes: {
      "gen_ai.input.messages": messages([
        { role: "user", content: "Where should I travel in May?" },
        { role: "assistant", content: "Lisbon is lovely in May." },
        { role: "user", content: "And in June?" },
      ]),
      "gen_ai.output.messages": messages([
        { role: "assistant", content: "Porto in June." },
      ]),
    },
  },
];

function callRow(fixture: CallFixture): JSONObject {
  const start: Date = new Date(
    fixture.startMs ?? now - (fixture.minutesAgo ?? 0) * 60 * 1000,
  );
  const end: Date = new Date(start.getTime() + fixture.durationMs);
  const isLlm: boolean = fixture.isLlm !== false;
  const attributes: Record<string, string> = fixture.attributes || {};

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: OneUptimeDate.toClickhouseDateTime(new Date()),
    projectId: (fixture.projectId || projectId).toString(),
    primaryEntityId: (fixture.serviceId || supportBotId).toString(),
    primaryEntityType: "Service",
    /*
     * As trace ingest (OtelTracesIngestService) stores a span: startTime
     * and endTime to the whole second, the exact times only in the
     * UnixNano columns.
     */
    startTime: OneUptimeDate.toClickhouseDateTime(start),
    endTime: OneUptimeDate.toClickhouseDateTime(end),
    startTimeUnixNano: String(start.getTime() * 1000000),
    endTimeUnixNano: String(end.getTime() * 1000000),
    durationUnixNano: String(fixture.durationMs * 1000000),
    traceId: fixture.traceId,
    spanId: fixture.spanId,
    parentSpanId: fixture.parentSpanId || "",
    name: isLlm ? `chat ${fixture.model || ""}` : "GET /health",
    kind: "SPAN_KIND_CLIENT",
    statusCode: fixture.statusCode ?? 1,
    statusMessage: fixture.statusMessage || "",
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    events: "[]",
    isLlmSpan: isLlm,
    llmSystem: isLlm ? "openai" : "",
    llmOperation: isLlm ? fixture.operation ?? "chat" : "",
    llmRequestModel: isLlm ? fixture.model ?? "" : "",
    llmToolName: fixture.toolName || "",
    llmInputTokens: fixture.inputTokens || 0,
    llmOutputTokens: fixture.outputTokens || 0,
    llmTotalTokens: (fixture.inputTokens || 0) + (fixture.outputTokens || 0),
    llmCost: fixture.cost || 0,
    llmConversationId: fixture.conversationId || "",
    llmUserEmail: fixture.email || "",
    llmCallKind: isLlm ? fixture.kind ?? "answer" : "",
    llmIssues: fixture.issues || [],
    llmUserMessagePreview: fixture.preview || "",
    retentionDate: retentionDate,
  };
}

async function createTable(
  client: ClickhouseClient,
  clickhouse: ClickhouseDatabase,
): Promise<void> {
  const model: AnalyticsBaseModel = new Span();
  const generator: StatementGenerator<AnalyticsBaseModel> =
    new StatementGenerator<AnalyticsBaseModel>({
      modelType: Span as unknown as { new (): AnalyticsBaseModel },
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

function listQuery(
  overrides: Partial<LlmConversationListQuery> = {},
): LlmConversationListQuery {
  return {
    projectId: projectId,
    startTime: windowStart,
    endTime: windowEnd,
    sort: LlmConversationSort.Newest,
    limit: 25,
    skip: 0,
    includeSummary: true,
    ...overrides,
  };
}

function keysOf(response: LlmConversationListResponse): Array<string> {
  return response.conversations.map((row: LlmConversationListItem): string => {
    return row.key;
  });
}

integration("AI conversations against ClickHouse", () => {
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
      database: SpanService.database,
      databaseClient: SpanService.databaseClient,
      ingestDatabase: SpanService.ingestDatabase,
      ingestDatabaseClient: SpanService.ingestDatabaseClient,
    };

    SpanService.database = clickhouse;
    SpanService.databaseClient = client;
    SpanService.ingestDatabase = clickhouse;
    SpanService.ingestDatabaseClient = client;

    await SpanService.insertJsonRows(calls.map(callRow), {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(SpanService, original);
    }

    if (client) {
      await client.command({ query: `DROP DATABASE IF EXISTS ${database}` });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  test("calls group by conversation id, or by trace when none was sent", async () => {
    const response: LlmConversationListResponse =
      await LlmConversationService.listConversations(listQuery());

    expect(keysOf(response)).toEqual([
      "c:conv-internal",
      "c:conv-failed",
      `t:${TRACE_REQUEST}`,
      "c:conv-travel",
    ]);
    expect(response.hasMore).toBe(false);
  });

  test("a conversation row carries its totals, issues, title and people", async () => {
    const response: LlmConversationListResponse =
      await LlmConversationService.listConversations(listQuery());

    const travel: LlmConversationListItem = response.conversations.find(
      (row: LlmConversationListItem): boolean => {
        return row.key === "c:conv-travel";
      },
    )!;

    expect(travel.kind).toBe(LlmConversationKeyKind.Conversation);
    expect(travel.conversationId).toBe("conv-travel");
    // Two traces, both of this project only.
    expect(travel.callCount).toBe(3);
    expect(travel.answerCount).toBe(3);
    expect(travel.costUsd).toBeCloseTo(0.031, 10);
    expect(travel.inputTokens).toBe(300);
    expect(travel.outputTokens).toBe(50);
    expect(travel.issueCounts[LlmAnswerIssue.Refused]).toBe(1);
    expect(travel.issueCounts[LlmAnswerIssue.Failed]).toBe(0);
    // The FIRST thing asked.
    expect(travel.title).toBe("Plan a trip to Paris");
    expect(travel.traceId).toBe(TRACE_A);
    expect(travel.slowestAnswerMs).toBe(2400);
    expect([...travel.models].sort()).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(travel.people).toEqual(["ada@example.com"]);
    expect(travel.serviceIds).toEqual([supportBotId.toString()]);
    expect(travel.durationMs).toBeGreaterThanOrEqual(6 * 60 * 1000);
  });

  test("a request groups every AI call of its trace; only the chat is an answer", async () => {
    const response: LlmConversationListResponse =
      await LlmConversationService.listConversations(listQuery());

    const request: LlmConversationListItem = response.conversations.find(
      (row: LlmConversationListItem): boolean => {
        return row.kind === LlmConversationKeyKind.Request;
      },
    )!;

    expect(request.callCount).toBe(3);
    expect(request.answerCount).toBe(1);
    expect(request.issueCounts[LlmAnswerIssue.CutOff]).toBe(1);
    expect(request.conversationId).toBe("");
  });

  test("a call ingested before llmIssues still counts as failed by its status", async () => {
    const response: LlmConversationListResponse =
      await LlmConversationService.listConversations(listQuery());

    const failed: LlmConversationListItem = response.conversations.find(
      (row: LlmConversationListItem): boolean => {
        return row.key === "c:conv-failed";
      },
    )!;

    expect(failed.issueCounts[LlmAnswerIssue.Failed]).toBe(1);
    // llmCallKind '' with a model: still an answer.
    expect(failed.answerCount).toBe(1);
  });

  test("the summary: counts, issue chips, cost and answer latency", async () => {
    const response: LlmConversationListResponse =
      await LlmConversationService.listConversations(listQuery());

    expect(response.summary).not.toBeNull();
    expect(response.summary).toMatchObject({
      conversationCount: 4,
      callCount: 8,
      answerCount: 6,
      problemCallCount: 4,
      problemConversationCount: 4,
      issueConversationCounts: {
        failed: 1,
        refused: 1,
        cut_off: 1,
        empty: 1,
        flagged: 1,
      },
    });
    expect(response.summary!.costUsd).toBeCloseTo(0.5611, 10);
    expect(response.summary!.medianAnswerMs).toBeGreaterThan(0);
    expect(response.summary!.p95AnswerMs).toBeGreaterThanOrEqual(
      response.summary!.medianAnswerMs!,
    );
  });

  test("the issue chips filter the page but never the summary", async () => {
    const refused: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ issue: LlmAnswerIssue.Refused }),
      );

    expect(keysOf(refused)).toEqual(["c:conv-travel"]);
    // The matching conversation keeps ALL its calls.
    expect(refused.conversations[0]!.callCount).toBe(3);
    expect(refused.summary!.conversationCount).toBe(4);

    const anyProblem: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ issue: "any" }),
      );
    expect(keysOf(anyProblem)).toHaveLength(4);

    const failed: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ issue: LlmAnswerIssue.Failed }),
      );
    expect(keysOf(failed)).toEqual(["c:conv-failed"]);
  });

  test("model, person and search filters select whole conversations", async () => {
    const mini: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ model: "gpt-4o-mini" }),
      );
    expect(keysOf(mini)).toEqual(["c:conv-travel"]);
    expect(mini.conversations[0]!.callCount).toBe(3);
    expect(mini.summary!.conversationCount).toBe(1);

    const bob: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ person: "BOB@" }),
      );
    expect(keysOf(bob)).toEqual([`t:${TRACE_REQUEST}`]);

    // What a person asked, anywhere in the conversation.
    const montmartre: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ search: "day 2" }),
      );
    expect(keysOf(montmartre)).toEqual(["c:conv-travel"]);

    // The conversation id itself.
    const byId: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ search: "conv-fail" }),
      );
    expect(keysOf(byId)).toEqual(["c:conv-failed"]);
  });

  test("a % or _ in the search matches itself, not everything", async () => {
    const percent: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ search: "100%" }),
      );
    expect(keysOf(percent)).toEqual(["c:conv-failed"]);

    const underscore: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ search: "_" }),
      );
    expect(keysOf(underscore)).toEqual([]);
  });

  test("the service scope leaves out every call of a service the reader may not read", async () => {
    const onlySupportBot: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ serviceIds: [supportBotId] }),
      );
    expect(keysOf(onlySupportBot)).not.toContain("c:conv-internal");
    expect(onlySupportBot.summary!.conversationCount).toBe(3);

    const blocked: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ excludedServiceIds: [supportBotId] }),
      );
    expect(keysOf(blocked)).toEqual(["c:conv-internal"]);
  });

  test("sorts and pages", async () => {
    const expensive: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ sort: LlmConversationSort.MostExpensive }),
      );
    expect(keysOf(expensive)[0]).toBe("c:conv-internal");

    const slowest: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ sort: LlmConversationSort.Slowest }),
      );
    expect(keysOf(slowest)[0]).toBe("c:conv-failed");

    const mostCalls: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ sort: LlmConversationSort.MostCalls }),
      );
    expect(mostCalls.conversations[0]!.callCount).toBe(3);

    const oldest: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ sort: LlmConversationSort.Oldest }),
      );
    expect(keysOf(oldest)[0]).toBe("c:conv-travel");

    const firstPage: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ limit: 3, includeSummary: false }),
      );
    expect(firstPage.conversations).toHaveLength(3);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.summary).toBeNull();

    const secondPage: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ limit: 3, skip: 3 }),
      );
    expect(keysOf(secondPage)).toEqual(["c:conv-travel"]);
    expect(secondPage.hasMore).toBe(false);
  });

  test("a conversation reads back as a transcript built from the stored attributes", async () => {
    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation({
        projectId: projectId,
        key: {
          kind: LlmConversationKeyKind.Conversation,
          value: "conv-travel",
        },
        startTime: windowStart,
        endTime: windowEnd,
      });

    expect(detail.truncated).toBe(false);
    expect(detail.transcript.callCount).toBe(3);
    expect(detail.transcript.instructions).toBe("You are a travel bot.");
    expect(
      detail.transcript.steps.map((step: LlmTranscriptStep): string => {
        return `${step.type}:${step.text}`;
      }),
    ).toEqual([
      "user:Plan a trip to Paris",
      "assistant:Day 1: the Louvre.",
      "user:And day 2?",
      "assistant:Day 2: Montmartre.",
      "user:Book it with my card",
      "assistant:I'm sorry, but I can't do that.",
    ]);
    expect(detail.transcript.steps[5]!.call.issues).toEqual([
      LlmAnswerIssue.Refused,
    ]);
  });

  test("a request reads only its trace's calls without a conversation id", async () => {
    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation({
        projectId: projectId,
        key: { kind: LlmConversationKeyKind.Request, value: TRACE_REQUEST },
        startTime: windowStart,
        endTime: windowEnd,
      });

    expect(detail.transcript.callCount).toBe(3);
    expect(
      detail.transcript.steps.map((step: LlmTranscriptStep) => {
        return step.type;
      }),
    ).toEqual(
      expect.arrayContaining([
        LlmTranscriptStepType.ToolCall,
        LlmTranscriptStepType.ToolResult,
        LlmTranscriptStepType.Activity,
      ]),
    );
  });

  test("a failed call from before llmIssues reads as failed in the transcript", async () => {
    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation({
        projectId: projectId,
        key: {
          kind: LlmConversationKeyKind.Conversation,
          value: "conv-failed",
        },
        startTime: windowStart,
        endTime: windowEnd,
      });

    const failure: LlmTranscriptStep | undefined = detail.transcript.steps.find(
      (step: LlmTranscriptStep): boolean => {
        return step.type === LlmTranscriptStepType.Failure;
      },
    );

    expect(failure?.text).toBe("upstream timeout");
    expect(detail.transcript.issueCounts[LlmAnswerIssue.Failed]).toBe(1);
  });

  test("the scope applies to a conversation view too", async () => {
    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation({
        projectId: projectId,
        key: {
          kind: LlmConversationKeyKind.Conversation,
          value: "conv-internal",
        },
        startTime: windowStart,
        endTime: windowEnd,
        excludedServiceIds: [internalToolId],
      });

    expect(detail.transcript.callCount).toBe(0);
    expect(detail.transcript.steps).toEqual([]);
  });

  test("another project's calls with the same conversation id are never read", async () => {
    const detail: LlmConversationDetail =
      await LlmConversationService.getConversation({
        projectId: otherProjectId,
        key: {
          kind: LlmConversationKeyKind.Conversation,
          value: "conv-travel",
        },
        startTime: windowStart,
        endTime: windowEnd,
      });

    expect(detail.transcript.callCount).toBe(1);
    expect(detail.transcript.costUsd).toBe(99);
  });

  /*
   * conv-quick's two calls start 200 ms apart inside one whole second, and
   * ingest stores startTime and endTime to the second. Read from those
   * columns, the 5 ms answer would last 0 ms - arriving with its question,
   * so a replay could never show the question alone - and the two calls
   * would come back in the table's order, the second one first.
   */
  function quickConversation(): Promise<LlmConversationDetail> {
    return LlmConversationService.getConversation({
      projectId: quickProjectId,
      key: { kind: LlmConversationKeyKind.Conversation, value: "conv-quick" },
      startTime: windowStart,
      endTime: windowEnd,
    });
  }

  test("a call shorter than a second keeps its exact start and end", async () => {
    const detail: LlmConversationDetail = await quickConversation();

    const question: LlmTranscriptStep = detail.transcript.steps.find(
      (step: LlmTranscriptStep): boolean => {
        return step.text === "Where should I travel in May?";
      },
    )!;
    const answer: LlmTranscriptStep = detail.transcript.steps.find(
      (step: LlmTranscriptStep): boolean => {
        return step.text === "Lisbon is lovely in May.";
      },
    )!;

    expect(answer.type).toBe(LlmTranscriptStepType.AssistantMessage);
    expect(answer.call.startMs).toBe(quickSecond + 100);
    expect(answer.call.endMs).toBe(quickSecond + 105);
    expect(answer.call.durationMs).toBe(5);
    // The answer arrives after its question.
    expect(question.atMs).toBe(quickSecond + 100);
    expect(answer.atMs).toBe(quickSecond + 105);
  });

  test("calls made within one second read in the order they were made", async () => {
    const detail: LlmConversationDetail = await quickConversation();

    expect(
      detail.transcript.steps.map((step: LlmTranscriptStep): string => {
        return `${step.type}:${step.text}`;
      }),
    ).toEqual([
      "user:Where should I travel in May?",
      "assistant:Lisbon is lovely in May.",
      "user:And in June?",
      "assistant:Porto in June.",
    ]);
    expect(detail.transcript.startMs).toBe(quickSecond + 100);
    expect(detail.transcript.endMs).toBe(quickSecond + 340);
  });

  test("the list row starts at the first call and ends at the last, to the millisecond", async () => {
    const response: LlmConversationListResponse =
      await LlmConversationService.listConversations(
        listQuery({ projectId: quickProjectId }),
      );

    expect(keysOf(response)).toEqual(["c:conv-quick"]);

    const quick: LlmConversationListItem = response.conversations[0]!;

    // The FIRST thing asked, from the call that started first.
    expect(quick.title).toBe("Where should I travel in May?");
    expect(quick.traceId).toBe(TRACE_QUICK_FIRST);
    expect(quick.startedAt).toBe(new Date(quickSecond + 100).toISOString());
    expect(quick.endedAt).toBe(new Date(quickSecond + 340).toISOString());
    expect(quick.durationMs).toBe(240);
  });
});

/*
 * What the AI / LLM monitor's check counts, from the same fixtures: six
 * answers in the window (a1, a2, a3, b1, c1 in the support bot; d1 in the
 * internal tool). The tool run and the embedding are not answers; the call
 * in another project, the one outside the window and the plain HTTP span
 * are never read.
 */
integration("the AI / LLM monitor's answer counts against ClickHouse", () => {
  let clickhouse: ClickhouseDatabase;
  let client: ClickhouseClient;
  let original: ServiceConnection | undefined;
  const countsDatabase: string = `${database}_counts`;

  beforeAll(async (): Promise<void> => {
    const url: URL = new URL(endpoint!);

    const options: ClickHouseClientConfigOptions = {
      url: `${url.protocol}//${url.host}`,
      username: decodeURIComponent(url.username) || "default",
      password: decodeURIComponent(url.password),
      database: countsDatabase,
      request_timeout: 60000,
    };

    clickhouse = new ClickhouseDatabase(options);
    client = await clickhouse.connect(options);

    const model: AnalyticsBaseModel = new Span();
    const generator: StatementGenerator<AnalyticsBaseModel> =
      new StatementGenerator<AnalyticsBaseModel>({
        modelType: Span as unknown as { new (): AnalyticsBaseModel },
        database: clickhouse,
      });
    const columns: Statement = generator.toColumnsCreateStatement(
      model.tableColumns,
    );

    await client.command({
      query: `CREATE TABLE ${countsDatabase}.${model.tableName} (${columns.query}) ENGINE = MergeTree PARTITION BY (${model.partitionKey}) ORDER BY (${model.sortKeys.join(", ")})`,
      query_params: columns.query_params,
    });

    original = {
      database: SpanService.database,
      databaseClient: SpanService.databaseClient,
      ingestDatabase: SpanService.ingestDatabase,
      ingestDatabaseClient: SpanService.ingestDatabaseClient,
    };

    SpanService.database = clickhouse;
    SpanService.databaseClient = client;
    SpanService.ingestDatabase = clickhouse;
    SpanService.ingestDatabaseClient = client;

    await SpanService.insertJsonRows(calls.map(callRow), {
      clickhouseSettings: { wait_for_async_insert: 1 },
    });
  });

  afterAll(async (): Promise<void> => {
    if (original) {
      Object.assign(SpanService, original);
    }

    if (client) {
      await client.command({
        query: `DROP DATABASE IF EXISTS ${countsDatabase}`,
      });
    }

    if (clickhouse) {
      await clickhouse.disconnect();
    }
  });

  function countQuery(
    overrides: Partial<LlmAnswerCountQuery> = {},
  ): LlmAnswerCountQuery {
    return {
      projectId: projectId,
      startTime: windowStart,
      endTime: windowEnd,
      issues: [
        LlmAnswerIssue.Failed,
        LlmAnswerIssue.Refused,
        LlmAnswerIssue.CutOff,
        LlmAnswerIssue.Empty,
        LlmAnswerIssue.Flagged,
      ],
      slowAnswerMs: null,
      ...overrides,
    };
  }

  test("counts answers only, and every answer with a problem as bad", async () => {
    const counts: LlmAnswerCounts =
      await LlmConversationService.countAnswers(countQuery());

    expect(counts).toEqual({ answerCount: 6, badAnswerCount: 4 });
  });

  test.each([
    [LlmAnswerIssue.Refused, 1],
    [LlmAnswerIssue.CutOff, 1],
    [LlmAnswerIssue.Flagged, 1],
    [LlmAnswerIssue.Empty, 1],
    // c1 was ingested before llmIssues: its error status still counts.
    [LlmAnswerIssue.Failed, 1],
  ])(
    "counts only the answers with %s",
    async (issue: LlmAnswerIssue, expected: number) => {
      const counts: LlmAnswerCounts = await LlmConversationService.countAnswers(
        countQuery({ issues: [issue] }),
      );

      expect(counts).toEqual({ answerCount: 6, badAnswerCount: expected });
    },
  );

  test("a slow-answer limit counts the answers slower than it", async () => {
    const onlySlow: LlmAnswerCounts = await LlmConversationService.countAnswers(
      countQuery({ issues: [], slowAnswerMs: 2000 }),
    );

    // a2 took 2.4 s and c1 30 s.
    expect(onlySlow).toEqual({ answerCount: 6, badAnswerCount: 2 });

    const slowOrRefused: LlmAnswerCounts =
      await LlmConversationService.countAnswers(
        countQuery({ issues: [LlmAnswerIssue.Refused], slowAnswerMs: 2000 }),
      );

    expect(slowOrRefused).toEqual({ answerCount: 6, badAnswerCount: 3 });
  });

  test("no problem and no limit counts nothing as bad", async () => {
    const counts: LlmAnswerCounts = await LlmConversationService.countAnswers(
      countQuery({ issues: [], slowAnswerMs: null }),
    );

    expect(counts).toEqual({ answerCount: 6, badAnswerCount: 0 });
  });

  test("a model narrows both counts to its answers", async () => {
    const counts: LlmAnswerCounts = await LlmConversationService.countAnswers(
      countQuery({ model: "gpt-4o" }),
    );

    // a1, a2, c1 and d1 asked for gpt-4o; c1 failed and d1 was flagged.
    expect(counts).toEqual({ answerCount: 4, badAnswerCount: 2 });
  });

  test("apps narrow the counts, and a blocked app is left out", async () => {
    const supportBotOnly: LlmAnswerCounts =
      await LlmConversationService.countAnswers(
        countQuery({ serviceIds: [supportBotId] }),
      );

    expect(supportBotOnly).toEqual({ answerCount: 5, badAnswerCount: 3 });

    const withoutInternal: LlmAnswerCounts =
      await LlmConversationService.countAnswers(
        countQuery({ excludedServiceIds: [internalToolId] }),
      );

    expect(withoutInternal).toEqual(supportBotOnly);
  });

  test("the window bounds the counts", async () => {
    const counts: LlmAnswerCounts = await LlmConversationService.countAnswers(
      countQuery({ startTime: new Date(now - 15 * 60 * 1000) }),
    );

    // c1 (10 minutes ago) and d1 (5 minutes ago).
    expect(counts).toEqual({ answerCount: 2, badAnswerCount: 2 });
  });

  test("another project's answers are never counted", async () => {
    const counts: LlmAnswerCounts = await LlmConversationService.countAnswers(
      countQuery({ projectId: otherProjectId }),
    );

    expect(counts).toEqual({ answerCount: 1, badAnswerCount: 0 });
  });
});

describe("AI conversations ClickHouse suite wiring", () => {
  test("runs whenever the suite is under CI", () => {
    if (process.env["GITHUB_ACTIONS"] === "true") {
      expect(endpoint).toBeTruthy();
    }
  });
});
