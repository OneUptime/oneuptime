import { describe, expect, test } from "@jest/globals";
import LlmConversationService, {
  LlmAnswerCountQuery,
  LlmConversationDetailQuery,
  LlmConversationListQuery,
} from "../../../Server/Services/LlmConversationService";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  LLM_CONVERSATION_MAX_CALLS,
  LlmConversationKeyKind,
  LlmConversationListItem,
  LlmConversationSort,
  LlmConversationSummary,
} from "../../../Types/Telemetry/LlmConversationApi";
import { LlmAnswerIssue } from "../../../Types/Telemetry/LlmAnswerIssue";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";
import { LlmConversationCall } from "../../../Utils/Telemetry/LlmConversationTranscript";

/*
 * The SQL the conversation reads send, without a server. The ClickHouse
 * suite in App/Tests/Telemetry/LlmConversationsClickhouse.test.ts runs the
 * same statements against a real server; these pin the rules a reader of the
 * SQL would otherwise have to re-derive: the scope is a WHERE (never a
 * HAVING), what a person typed never reaches the SQL text, and a read cut
 * short throws instead of answering an empty body.
 */

const PROJECT: ObjectID = new ObjectID("9900000000000000000000a1");
const SERVICE_A: ObjectID = new ObjectID("9900000000000000000000b1");
const SERVICE_B: ObjectID = new ObjectID("9900000000000000000000b2");

function listQuery(
  overrides: Partial<LlmConversationListQuery> = {},
): LlmConversationListQuery {
  return {
    projectId: PROJECT,
    startTime: new Date("2026-10-10T08:00:00.000Z"),
    endTime: new Date("2026-10-10T09:00:00.000Z"),
    sort: LlmConversationSort.Newest,
    limit: 25,
    skip: 0,
    includeSummary: true,
    ...overrides,
  };
}

function detailQuery(
  overrides: Partial<LlmConversationDetailQuery> = {},
): LlmConversationDetailQuery {
  return {
    projectId: PROJECT,
    key: { kind: LlmConversationKeyKind.Conversation, value: "conv-1" },
    startTime: new Date("2026-10-09T08:00:00.000Z"),
    endTime: new Date("2026-10-11T09:00:00.000Z"),
    ...overrides,
  };
}

function paramValues(statement: Statement): Array<unknown> {
  return Object.values(statement.query_params);
}

describe("the list statement", () => {
  const statement: Statement = LlmConversationService.buildListStatement(
    listQuery({
      serviceIds: [SERVICE_A],
      excludedServiceIds: [SERVICE_B],
      model: "gpt-4o",
      person: "ada",
      search: "refund'; DROP TABLE x; --",
      issue: LlmAnswerIssue.Refused,
    }),
  );
  const sql: string = statement.query;

  test("reads AI calls of the project, in the window, still retained", () => {
    expect(sql).toContain("FROM SpanItemV3 WHERE projectId = ");
    expect(sql).toContain("AND isLlmSpan = 1");
    expect(sql).toContain("AND startTime >= ");
    expect(sql).toContain("AND startTime <= ");
    expect(sql).toContain("AND retentionDate >= now()");
    expect(paramValues(statement)).toContain(PROJECT.toString());
  });

  test("the service scope is a WHERE, before the grouping", () => {
    const where: string = sql.slice(0, sql.indexOf(" GROUP BY "));

    expect(where).toContain("AND primaryEntityId IN (");
    expect(where).toContain("AND primaryEntityId NOT IN (");
    expect(paramValues(statement)).toContainEqual([SERVICE_A.toString()]);
    expect(paramValues(statement)).toContainEqual([SERVICE_B.toString()]);
  });

  test("calls group by conversation id, or by trace", () => {
    expect(sql).toContain(
      "if(llmConversationId != '', concat('c:', llmConversationId), concat('t:', lower(traceId))) AS conversationKey",
    );
    expect(sql).toContain("GROUP BY conversationKey");
  });

  test("conversation filters are HAVING clauses, after the grouping", () => {
    const having: string = sql.slice(sql.indexOf(" HAVING "));

    expect(sql.indexOf(" HAVING ")).toBeGreaterThan(sql.indexOf(" GROUP BY "));
    expect(having).toContain("countIf(llmRequestModel = ");
    expect(having).toContain("countIf(llmUserEmail ILIKE ");
    expect(having).toContain("countIf(llmUserMessagePreview ILIKE ");
    expect(having).toContain("OR conversationKey ILIKE ");
    expect(having).toContain("countIf(has(llmIssues, 'refused')) > 0");
  });

  test("what a person typed is a parameter, never SQL", () => {
    expect(sql).not.toContain("DROP TABLE");
    expect(sql).not.toContain("ada");
    expect(sql).not.toContain("gpt-4o");
    expect(paramValues(statement)).toContain("%refund'; DROP TABLE x; --%");
    expect(paramValues(statement)).toContain("%ada%");
    expect(paramValues(statement)).toContain("gpt-4o");
  });

  test("% and _ in a search are matched literally", () => {
    const literal: Statement = LlmConversationService.buildListStatement(
      listQuery({ search: "100%_off" }),
    );

    expect(paramValues(literal)).toContain("%100\\%\\_off%");
  });

  test("one row more than the page is read, to know there is a next page", () => {
    const paged: Statement = LlmConversationService.buildListStatement(
      listQuery({ limit: 10, skip: 30 }),
    );

    expect(paged.query).toContain("LIMIT ");
    expect(paged.query).toContain(" OFFSET ");
    expect(paramValues(paged)).toContain(11);
    expect(paramValues(paged)).toContain(30);
  });

  test("a read cut short throws, it never answers an empty body", () => {
    expect(sql).toContain("max_execution_time = 45");
    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).not.toContain("'break'");
  });

  test("no filters means no HAVING at all", () => {
    expect(
      LlmConversationService.buildListStatement(listQuery()).query,
    ).not.toContain(" HAVING ");
  });

  test("'any' issue keeps every conversation with a problem, by status too", () => {
    const anyIssue: string = LlmConversationService.buildListStatement(
      listQuery({ issue: "any" }),
    ).query;

    expect(anyIssue).toContain(
      "countIf((statusCode = 2 OR notEmpty(llmIssues))) > 0",
    );
  });

  test("'failed' counts calls from before llmIssues by their status", () => {
    const failed: string = LlmConversationService.buildListStatement(
      listQuery({ issue: LlmAnswerIssue.Failed }),
    ).query;

    expect(failed).toContain(
      "countIf((statusCode = 2 OR has(llmIssues, 'failed'))) > 0",
    );
  });

  test.each([
    [LlmConversationSort.Newest, "startedAtMs DESC, conversationKey ASC"],
    [LlmConversationSort.Oldest, "startedAtMs ASC, conversationKey ASC"],
    [
      LlmConversationSort.MostExpensive,
      "costUsd DESC, startedAtMs DESC, conversationKey ASC",
    ],
    [
      LlmConversationSort.Slowest,
      "slowestAnswerNano DESC, startedAtMs DESC, conversationKey ASC",
    ],
    [
      LlmConversationSort.MostCalls,
      "callCount DESC, startedAtMs DESC, conversationKey ASC",
    ],
  ])("sort %s orders by %s, with a stable tie-break", (sort: LlmConversationSort, order: string) => {
    expect(
      LlmConversationService.buildListStatement(listQuery({ sort })).query,
    ).toContain(`ORDER BY ${order}`);
  });
});

describe("the summary statement", () => {
  const sql: string = LlmConversationService.buildSummaryStatement(
    listQuery({ issue: LlmAnswerIssue.Refused, model: "gpt-4o" }),
  ).query;

  test("counts over the same conversations, with the issue chip left out", () => {
    expect(sql).toContain("countIf(llmRequestModel = ");
    expect(sql).not.toContain("countIf(has(llmIssues, 'refused')) > 0");
  });

  test("answer latency merges per-conversation quantile states", () => {
    expect(sql).toContain("quantilesStateIf(0.5, 0.95)(durationUnixNano, ");
    expect(sql).toContain("quantilesMerge(0.5, 0.95)(inner_answerLatencyState)");
  });

  test("an outer aggregate never shares its alias with the inner column it reads", () => {
    expect(sql).toContain("sum(inner_callCount) AS callCount");
    expect(sql).not.toMatch(/sum\(callCount\) AS callCount/);
  });
});

describe("the calls statement (one conversation)", () => {
  test("a conversation reads by its id", () => {
    const statement: Statement = LlmConversationService.buildCallsStatement(
      detailQuery(),
    );

    expect(statement.query).toContain("AND llmConversationId = ");
    expect(paramValues(statement)).toContain("conv-1");
    expect(statement.query).toContain("ORDER BY startTime ASC");
    expect(paramValues(statement)).toContain(LLM_CONVERSATION_MAX_CALLS + 1);
    expect(statement.query).toContain("attributes, events");
  });

  test("a request reads its trace's calls that carry no conversation id", () => {
    const statement: Statement = LlmConversationService.buildCallsStatement(
      detailQuery({
        key: {
          kind: LlmConversationKeyKind.Request,
          value: "0af7651916cd43dd8448eb211c80319c",
        },
      }),
    );

    expect(statement.query).toContain(
      "AND lower(traceId) = {p3:String} AND llmConversationId = ''",
    );
    expect(statement.query_params["p3"]).toBe(
      "0af7651916cd43dd8448eb211c80319c",
    );
  });

  test("the scope applies to a single conversation too", () => {
    const statement: Statement = LlmConversationService.buildCallsStatement(
      detailQuery({ excludedServiceIds: [SERVICE_B] }),
    );

    expect(statement.query).toContain("AND primaryEntityId NOT IN (");
  });
});

describe("reading rows back", () => {
  test("a list row: 64-bit counters arrive as strings", () => {
    const item: LlmConversationListItem | null =
      LlmConversationService.toListItem({
        conversationKey: "c:conv-9",
        conversationId: "conv-9",
        firstTraceId: "abc",
        startedAtMs: "1760086800000",
        endedAtMs: "1760086860000",
        callCount: "4",
        answerCount: "3",
        costUsd: 0.25,
        inputTokens: "1000",
        outputTokens: "250",
        failedCount: "1",
        refusedCount: "0",
        cutOffCount: "2",
        emptyCount: "0",
        flaggedCount: "0",
        slowestAnswerNano: "2500000000",
        title: "Where is my order?",
        models: ["gpt-4o", "", 7],
        people: ["ada@example.com"],
        serviceIds: ["s1"],
        agents: [],
      } as unknown as JSONObject);

    expect(item).toEqual({
      key: "c:conv-9",
      kind: LlmConversationKeyKind.Conversation,
      conversationId: "conv-9",
      traceId: "abc",
      title: "Where is my order?",
      startedAt: new Date(1760086800000).toISOString(),
      endedAt: new Date(1760086860000).toISOString(),
      durationMs: 60000,
      callCount: 4,
      answerCount: 3,
      costUsd: 0.25,
      inputTokens: 1000,
      outputTokens: 250,
      issueCounts: { failed: 1, refused: 0, cut_off: 2, empty: 0, flagged: 0 },
      slowestAnswerMs: 2500,
      models: ["gpt-4o"],
      people: ["ada@example.com"],
      serviceIds: ["s1"],
      agents: [],
    });
  });

  test("a row without a valid key is dropped", () => {
    expect(
      LlmConversationService.toListItem({ conversationKey: "x:1" }),
    ).toBeNull();
    expect(LlmConversationService.toListItem({})).toBeNull();
  });

  test("a summary row, latency in milliseconds", () => {
    const summary: LlmConversationSummary = LlmConversationService.toSummary({
      conversationCount: "3",
      callCount: "10",
      answerCount: "8",
      problemCallCount: "2",
      problemConversationCount: "1",
      failedCountConversations: "1",
      refusedCountConversations: "0",
      cutOffCountConversations: "0",
      emptyCountConversations: "0",
      flaggedCountConversations: "1",
      costUsd: 1.5,
      inputTokens: "100",
      outputTokens: "50",
      answerLatencyNano: [1500000000, 4000000000],
    } as unknown as JSONObject);

    expect(summary.medianAnswerMs).toBe(1500);
    expect(summary.p95AnswerMs).toBe(4000);
    expect(summary.issueConversationCounts).toEqual({
      failed: 1,
      refused: 0,
      cut_off: 0,
      empty: 0,
      flagged: 1,
    });
  });

  test("no answers means no latency, not a latency of 0", () => {
    const summary: LlmConversationSummary = LlmConversationService.toSummary({
      answerCount: "0",
      answerLatencyNano: [0, 0],
    } as unknown as JSONObject);

    expect(summary.medianAnswerMs).toBeNull();
    expect(summary.p95AnswerMs).toBeNull();
    expect(summary.conversationCount).toBe(0);
  });

  test("a call row: content parsed, a failed status always reads as failed", () => {
    const call: LlmConversationCall = LlmConversationService.toCall({
      spanId: "s1",
      traceId: "t1",
      parentSpanId: "",
      name: "chat gpt-4o",
      startMs: "1760086800000",
      endMs: "1760086801500",
      statusCode: 2,
      statusMessage: "boom",
      llmCallKind: "",
      llmOperation: "chat",
      llmRequestModel: "gpt-4o",
      llmResponseModel: "gpt-4o-2024-08-06",
      llmSystem: "openai",
      llmAgentName: "",
      llmToolName: "",
      llmInputTokens: 10,
      llmOutputTokens: 0,
      llmCost: 0.001,
      llmIssues: ["refused"],
      llmUserEmail: "",
      llmUserId: "user-7",
      primaryEntityId: "svc",
      attributes: {
        "gen_ai.input.messages": JSON.stringify([
          { role: "user", content: "Hi" },
        ]),
      },
      events: "[{\"name\":\"gen_ai.evaluation.result\",\"attributes\":{\"gen_ai.evaluation.score.label\":\"fail\"}}]",
    } as unknown as JSONObject);

    expect(call.startMs).toBe(1760086800000);
    expect(call.endMs).toBe(1760086801500);
    expect(call.statusIsError).toBe(true);
    expect(call.issues).toEqual([LlmAnswerIssue.Failed, LlmAnswerIssue.Refused]);
    // An empty stored kind is derived again from the operation.
    expect(call.kind).toBe(LlmCallKind.Answer);
    // The model the provider served is the one shown.
    expect(call.model).toBe("gpt-4o-2024-08-06");
    expect(call.userLabel).toBe("user-7");
    expect(call.content.input[0]?.role).toBe("user");
    expect(call.content.evaluations[0]?.label).toBe("fail");
  });

  test("a call row with unreadable events and attributes still reads", () => {
    const call: LlmConversationCall = LlmConversationService.toCall({
      spanId: "s2",
      events: "{not json",
      attributes: "not an object",
      llmCallKind: "tool",
    } as unknown as JSONObject);

    expect(call.kind).toBe(LlmCallKind.Tool);
    expect(call.content.input).toEqual([]);
    expect(call.issues).toEqual([]);
  });
});

/*
 * The AI / LLM monitor's one read: the answers of a window and how many
 * were bad. The real-ClickHouse suite runs it; these pin its shape.
 */
describe("the answer count statement (the AI / LLM monitor)", () => {
  function countQuery(
    overrides: Partial<LlmAnswerCountQuery> = {},
  ): LlmAnswerCountQuery {
    return {
      projectId: PROJECT,
      startTime: new Date("2026-10-10T08:00:00.000Z"),
      endTime: new Date("2026-10-10T08:15:00.000Z"),
      issues: [LlmAnswerIssue.Refused, LlmAnswerIssue.CutOff],
      slowAnswerMs: null,
      ...overrides,
    };
  }

  test("reads AI calls of the project, in the window, still retained", () => {
    const sql: string =
      LlmConversationService.buildAnswerCountStatement(countQuery()).query;

    expect(sql).toContain("FROM SpanItemV3 WHERE projectId = ");
    expect(sql).toContain("AND isLlmSpan = 1");
    expect(sql).toContain("AND startTime >= ");
    expect(sql).toContain("AND startTime <= ");
    expect(sql).toContain("AND retentionDate >= now()");
    expect(paramValues(
      LlmConversationService.buildAnswerCountStatement(countQuery()),
    )).toContain(PROJECT.toString());
  });

  test("only answers are counted: kind answer, or a pre-kind row with a model", () => {
    const sql: string =
      LlmConversationService.buildAnswerCountStatement(countQuery()).query;

    expect(sql).toContain(
      "countIf((llmCallKind = 'answer' OR (llmCallKind = '' AND llmRequestModel != ''))) AS answerCount",
    );
    // The bad count is a subset of the answers.
    expect(sql).toContain(
      "countIf((llmCallKind = 'answer' OR (llmCallKind = '' AND llmRequestModel != '')) AND (",
    );
  });

  test("each problem it counts is one OR'd condition on llmIssues", () => {
    const sql: string =
      LlmConversationService.buildAnswerCountStatement(countQuery()).query;

    expect(sql).toContain(
      "AND (has(llmIssues, 'refused') OR has(llmIssues, 'cut_off'))) AS badAnswerCount",
    );
    expect(sql).not.toContain("has(llmIssues, 'empty')");
  });

  test("'failed' counts calls from before llmIssues by their status too", () => {
    const sql: string = LlmConversationService.buildAnswerCountStatement(
      countQuery({ issues: [LlmAnswerIssue.Failed] }),
    ).query;

    expect(sql).toContain(
      "AND ((statusCode = 2 OR has(llmIssues, 'failed')))) AS badAnswerCount",
    );
  });

  test("a slow-answer limit is a parameter in nanoseconds, never SQL text", () => {
    const statement: Statement =
      LlmConversationService.buildAnswerCountStatement(
        countQuery({ issues: [], slowAnswerMs: 30_000 }),
      );

    expect(statement.query).toContain("durationUnixNano > {p");
    expect(statement.query).toContain(":Int64}");
    expect(paramValues(statement)).toContain(30_000_000_000);
    expect(statement.query).not.toContain("30000000000");
  });

  test("problems and a slow limit together: either makes an answer bad", () => {
    const sql: string = LlmConversationService.buildAnswerCountStatement(
      countQuery({ issues: [LlmAnswerIssue.Flagged], slowAnswerMs: 2_500 }),
    ).query;

    expect(sql).toMatch(
      /AND \(has\(llmIssues, 'flagged'\) OR durationUnixNano > \{p\d+:Int64\}\)\) AS badAnswerCount/,
    );
  });

  test("nothing that makes an answer bad counts no answer as bad", () => {
    const sql: string = LlmConversationService.buildAnswerCountStatement(
      countQuery({ issues: [], slowAnswerMs: null }),
    ).query;

    expect(sql).toContain("toUInt64(0) AS badAnswerCount");
  });

  test("an unknown problem never reaches the SQL", () => {
    const sql: string = LlmConversationService.buildAnswerCountStatement(
      countQuery({
        issues: ["bogus') OR 1=1 --" as unknown as LlmAnswerIssue],
      }),
    ).query;

    expect(sql).not.toContain("bogus");
    expect(sql).toContain("toUInt64(0) AS badAnswerCount");
  });

  test("a model narrows to the answers that asked for it or were served by it", () => {
    const statement: Statement =
      LlmConversationService.buildAnswerCountStatement(
        countQuery({ model: "  gpt-4o'; --  " }),
      );

    expect(statement.query).toMatch(
      /AND \(llmRequestModel = \{p\d+:String\} OR llmResponseModel = \{p\d+:String\}\)/,
    );
    expect(paramValues(statement)).toContain("gpt-4o'; --");
    expect(statement.query).not.toContain("gpt-4o");
  });

  test("a blank model adds no condition", () => {
    const sql: string = LlmConversationService.buildAnswerCountStatement(
      countQuery({ model: "   " }),
    ).query;

    expect(sql).not.toContain("llmResponseModel");
  });

  test("the apps and the reader's scope are WHERE clauses", () => {
    const sql: string = LlmConversationService.buildAnswerCountStatement(
      countQuery({
        serviceIds: [SERVICE_A],
        excludedServiceIds: [SERVICE_B],
      }),
    ).query;

    expect(sql).toContain("AND primaryEntityId IN (");
    expect(sql).toContain("AND primaryEntityId NOT IN (");
    expect(sql).not.toContain("GROUP BY");
    expect(sql).not.toContain("HAVING");
  });

  test("a read cut short throws, it never answers an empty body", () => {
    const sql: string =
      LlmConversationService.buildAnswerCountStatement(countQuery()).query;

    expect(sql).toContain("timeout_overflow_mode = 'throw'");
    expect(sql).not.toContain("'break'");
  });
});
