import {
  SQL,
  Statement,
  escapeIlikePattern,
} from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import SpanService from "./SpanService";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";
import TelemetryReadScopeUtil, {
  TelemetryServiceFilter,
} from "../Utils/Telemetry/TelemetryReadScope";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import AnalyticsTableName from "../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { SpanStatus } from "../../Models/AnalyticsModels/Span";
import {
  LlmAnswerIssue,
  LlmAnswerIssueUtil,
} from "../../Types/Telemetry/LlmAnswerIssue";
import {
  LlmCallKind,
  LlmCallKindUtil,
} from "../../Types/Telemetry/LlmCallKind";
import {
  LLM_CONVERSATION_MAX_CALLS,
  LlmConversationIssueFilter,
  LlmConversationKey,
  LlmConversationKeyKind,
  LlmConversationKeyUtil,
  LlmConversationListItem,
  LlmConversationListResponse,
  LlmConversationSort,
  LlmConversationSummary,
  LlmIssueCounts,
  emptyIssueCounts,
  readNumber,
  readOptionalNumber,
  readString,
  readStringArray,
} from "../../Types/Telemetry/LlmConversationApi";
import LlmMessageParser, {
  LlmCallContent,
} from "../../Utils/Telemetry/LlmMessageParser";
import LlmConversationTranscriptUtil, {
  LlmConversationCall,
  LlmTranscript,
} from "../../Utils/Telemetry/LlmConversationTranscript";

/*
 * AI CONVERSATIONS, READ FROM THE SPAN TABLE.
 *
 * An AI call is a span with isLlmSpan = 1. A conversation is the calls that
 * share llmConversationId, or - for calls that report no conversation id -
 * the calls of one trace (see LlmConversationApi). Both reads below are
 * hand-written ClickHouse SQL, so they take the caller's service filter
 * (serviceIds / excludedServiceIds) from the route, which asks
 * TelemetryReadAccess for it: a member limited to some services never sees,
 * counts or groups a call from another.
 *
 * The list groups calls in ClickHouse; filters that describe a CONVERSATION
 * (a model it used, a person in it, text anywhere in it, an issue in any of
 * its calls) go in HAVING, so a matching conversation keeps every one of its
 * calls in its totals. Filters on what the caller may read go in WHERE.
 *
 * Every read is bounded below nginx's 60 s read timeout with 'throw', never
 * 'break': a grouped read cut short with 'break' answers an EMPTY body, which
 * would read as "no conversations" (see the ClickHouse query limits note).
 */

const TABLE_NAME: string = AnalyticsTableName.Span;

const QUERY_SETTINGS: string = getQuerySettings({
  maxExecutionTimeInSeconds: 45,
  timeoutOverflowMode: "throw",
});

// The conversation a call belongs to - the same expression everywhere.
const CONVERSATION_KEY_SQL: string = `if(llmConversationId != '', concat('${LlmConversationKeyUtil.CONVERSATION_PREFIX}', llmConversationId), concat('${LlmConversationKeyUtil.REQUEST_PREFIX}', lower(traceId)))`;

/*
 * When a call started and ended. Trace ingest stores startTime and endTime
 * to the whole second; the exact times are in startTimeUnixNano and
 * endTimeUnixNano. Read from the whole-second columns, a call shorter than
 * a second lasts 0 ms - its answer arriving with its question in the
 * replay - and calls made within one second come back in any order. So a
 * call's times, the order of a conversation's calls, and which call came
 * first all read the exact columns. The time window still filters on
 * startTime, which the table is sorted and partitioned by.
 */
const CALL_START_SQL: string = "startTimeUnixNano";
const CALL_END_SQL: string = "endTimeUnixNano";
const NANOS_PER_MILLI: number = 1_000_000;

/*
 * A call that produced an answer. Rows ingested before llmCallKind existed
 * read "": a model on them still says a model was called.
 */
const IS_ANSWER_SQL: string = `(llmCallKind = '${LlmCallKind.Answer}' OR (llmCallKind = '' AND llmRequestModel != ''))`;

// A failed call - by its status too, so rows from before llmIssues count.
const IS_FAILED_SQL: string = `(statusCode = ${SpanStatus.Error} OR has(llmIssues, '${LlmAnswerIssue.Failed}'))`;

const HAS_PROBLEM_SQL: string = `(statusCode = ${SpanStatus.Error} OR notEmpty(llmIssues))`;

const PERSON_SQL: string = `if(llmUserEmail != '', llmUserEmail, llmUserId)`;

const ISSUE_COUNT_ALIASES: Record<LlmAnswerIssue, string> = {
  [LlmAnswerIssue.Failed]: "failedCount",
  [LlmAnswerIssue.Refused]: "refusedCount",
  [LlmAnswerIssue.CutOff]: "cutOffCount",
  [LlmAnswerIssue.Empty]: "emptyCount",
  [LlmAnswerIssue.Flagged]: "flaggedCount",
};

// A call with the issue - by its status too for "failed", as IS_FAILED_SQL.
function issueConditionSql(issue: LlmAnswerIssue): string {
  return issue === LlmAnswerIssue.Failed
    ? IS_FAILED_SQL
    : `has(llmIssues, '${issue}')`;
}

function issueCountSql(issue: LlmAnswerIssue): string {
  return `countIf(${issueConditionSql(issue)})`;
}

export interface LlmConversationListQuery extends TelemetryServiceFilter {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  model?: string | undefined;
  person?: string | undefined;
  search?: string | undefined;
  issue?: LlmConversationIssueFilter | undefined;
  sort: LlmConversationSort;
  limit: number;
  skip: number;
  includeSummary: boolean;
}

export interface LlmConversationDetailQuery extends TelemetryServiceFilter {
  projectId: ObjectID;
  key: LlmConversationKey;
  startTime: Date;
  endTime: Date;
}

/*
 * The answers of a window and how many were bad, for the AI / LLM monitor
 * (MonitorStepLlmMonitor) and its preview. An answer is bad when it had
 * one of `issues`, or took longer than `slowAnswerMs`.
 */
export interface LlmAnswerCountQuery extends TelemetryServiceFilter {
  projectId: ObjectID;
  startTime: Date;
  endTime: Date;
  issues: Array<LlmAnswerIssue>;
  slowAnswerMs: number | null;
  // Only answers from this model, requested or served; "" or undefined = any.
  model?: string | undefined;
}

export interface LlmAnswerCounts {
  answerCount: number;
  badAnswerCount: number;
}

export interface LlmConversationDetail {
  key: string;
  kind: LlmConversationKeyKind;
  // The conversation id; "" for a request (trace) key.
  conversationId: string;
  transcript: LlmTranscript;
  // More calls exist than the view read (LLM_CONVERSATION_MAX_CALLS).
  truncated: boolean;
}

function ilike(text: string): string {
  return `%${escapeIlikePattern(text)}%`;
}

function parseJsonArray(value: unknown): Array<unknown> {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default class LlmConversationService {
  @CaptureSpan()
  public static async listConversations(
    query: LlmConversationListQuery,
  ): Promise<LlmConversationListResponse> {
    const [pageRows, summaryRow] = await Promise.all([
      LlmConversationService.readRows(
        LlmConversationService.buildListStatement(query),
      ),
      query.includeSummary
        ? LlmConversationService.readRows(
            LlmConversationService.buildSummaryStatement(query),
          )
        : Promise.resolve(null),
    ]);

    const hasMore: boolean = pageRows.length > query.limit;

    return {
      summary: summaryRow
        ? LlmConversationService.toSummary(summaryRow[0] || {})
        : null,
      conversations: pageRows
        .slice(0, query.limit)
        .map((row: JSONObject): LlmConversationListItem | null => {
          return LlmConversationService.toListItem(row);
        })
        .filter(
          (
            row: LlmConversationListItem | null,
          ): row is LlmConversationListItem => {
            return row !== null;
          },
        ),
      hasMore: hasMore,
    };
  }

  @CaptureSpan()
  public static async getConversation(
    query: LlmConversationDetailQuery,
  ): Promise<LlmConversationDetail> {
    const rows: Array<JSONObject> = await LlmConversationService.readRows(
      LlmConversationService.buildCallsStatement(query),
    );

    const truncated: boolean = rows.length > LLM_CONVERSATION_MAX_CALLS;

    const calls: Array<LlmConversationCall> = rows
      .slice(0, LLM_CONVERSATION_MAX_CALLS)
      .map((row: JSONObject): LlmConversationCall => {
        return LlmConversationService.toCall(row);
      });

    return {
      key: LlmConversationKeyUtil.encode(query.key),
      kind: query.key.kind,
      conversationId:
        query.key.kind === LlmConversationKeyKind.Conversation
          ? query.key.value
          : "",
      transcript: LlmConversationTranscriptUtil.build(calls),
      truncated: truncated,
    };
  }

  @CaptureSpan()
  public static async countAnswers(
    query: LlmAnswerCountQuery,
  ): Promise<LlmAnswerCounts> {
    const rows: Array<JSONObject> = await LlmConversationService.readRows(
      LlmConversationService.buildAnswerCountStatement(query),
    );
    const row: JSONObject = rows[0] || {};
    const answerCount: number = Math.max(0, readNumber(row["answerCount"]));

    return {
      answerCount: answerCount,
      badAnswerCount: Math.min(
        answerCount,
        Math.max(0, readNumber(row["badAnswerCount"])),
      ),
    };
  }

  /*
   * One row: the answers in the window, and how many were bad. Only
   * answers are counted (see IS_ANSWER_SQL) - tool runs, embeddings and
   * agent wrappers would dilute the share of bad answers.
   */
  public static buildAnswerCountStatement(
    query: LlmAnswerCountQuery,
  ): Statement {
    const statement: Statement = new Statement();
    const badConditions: Array<Statement> = LlmAnswerIssueUtil.fromValues(
      query.issues,
    ).map((issue: LlmAnswerIssue): Statement => {
      return new Statement([issueConditionSql(issue)]);
    });

    const slowAnswerMs: number = Number(query.slowAnswerMs);

    if (Number.isFinite(slowAnswerMs) && slowAnswerMs > 0) {
      badConditions.push(
        SQL`durationUnixNano > ${{
          type: TableColumnType.BigNumber,
          value: Math.round(slowAnswerMs) * 1_000_000,
        }}`,
      );
    }

    statement.append(`SELECT countIf(${IS_ANSWER_SQL}) AS answerCount, `);

    if (badConditions.length === 0) {
      statement.append("toUInt64(0) AS badAnswerCount");
    } else {
      statement.append(`countIf(${IS_ANSWER_SQL} AND (`);

      badConditions.forEach((condition: Statement, index: number) => {
        if (index > 0) {
          statement.append(" OR ");
        }

        statement.append(condition);
      });

      statement.append(")) AS badAnswerCount");
    }

    statement.append(` FROM ${TABLE_NAME}`);

    LlmConversationService.appendScope(statement, query);

    if (query.model && query.model.trim()) {
      const model: string = query.model.trim();

      statement.append(
        SQL` AND (llmRequestModel = ${{
          type: TableColumnType.Text,
          value: model,
        }} OR llmResponseModel = ${{
          type: TableColumnType.Text,
          value: model,
        }})`,
      );
    }

    statement.append(QUERY_SETTINGS);

    return statement;
  }

  // The WHERE every read shares: the project, AI calls, the window, the scope.
  public static appendScope(
    statement: Statement,
    query: TelemetryServiceFilter & {
      projectId: ObjectID;
      startTime: Date;
      endTime: Date;
    },
  ): void {
    statement.append(
      SQL` WHERE projectId = ${{
        type: TableColumnType.ObjectID,
        value: query.projectId,
      }} AND isLlmSpan = 1 AND startTime >= ${{
        type: TableColumnType.Date,
        value: query.startTime,
      }} AND startTime <= ${{
        type: TableColumnType.Date,
        value: query.endTime,
      }} AND retentionDate >= now()`,
    );

    TelemetryReadScopeUtil.appendServiceFilter(statement, query);
  }

  /*
   * HAVING clauses that describe a conversation: it used the model, has the
   * person in it, holds the text, or has a call with the issue.
   */
  public static appendHaving(
    statement: Statement,
    query: LlmConversationListQuery,
    data: { includeIssue: boolean },
  ): void {
    const clauses: Array<Statement> = [];

    if (query.model) {
      clauses.push(
        SQL`countIf(llmRequestModel = ${{
          type: TableColumnType.Text,
          value: query.model,
        }} OR llmResponseModel = ${{
          type: TableColumnType.Text,
          value: query.model,
        }}) > 0`,
      );
    }

    if (query.person) {
      clauses.push(
        SQL`countIf(llmUserEmail ILIKE ${{
          type: TableColumnType.Text,
          value: ilike(query.person),
        }} OR llmUserId ILIKE ${{
          type: TableColumnType.Text,
          value: ilike(query.person),
        }}) > 0`,
      );
    }

    if (query.search) {
      const pattern: string = ilike(query.search);

      clauses.push(
        SQL`(countIf(llmUserMessagePreview ILIKE ${{
          type: TableColumnType.Text,
          value: pattern,
        }} OR llmUserEmail ILIKE ${{
          type: TableColumnType.Text,
          value: pattern,
        }} OR llmUserId ILIKE ${{
          type: TableColumnType.Text,
          value: pattern,
        }} OR llmRequestModel ILIKE ${{
          type: TableColumnType.Text,
          value: pattern,
        }} OR llmAgentName ILIKE ${{
          type: TableColumnType.Text,
          value: pattern,
        }}) > 0 OR conversationKey ILIKE ${{
          type: TableColumnType.Text,
          value: pattern,
        }})`,
      );
    }

    if (data.includeIssue && query.issue) {
      clauses.push(
        new Statement([
          query.issue === "any"
            ? `countIf(${HAS_PROBLEM_SQL}) > 0`
            : `${issueCountSql(query.issue)} > 0`,
        ]),
      );
    }

    if (clauses.length === 0) {
      return;
    }

    statement.append(" HAVING ");

    clauses.forEach((clause: Statement, index: number) => {
      if (index > 0) {
        statement.append(" AND ");
      }

      statement.append(clause);
    });
  }

  public static buildListStatement(query: LlmConversationListQuery): Statement {
    const statement: Statement = new Statement();

    const issueColumns: string = LlmAnswerIssueUtil.getAllIssues()
      .map((issue: LlmAnswerIssue): string => {
        return `${issueCountSql(issue)} AS ${ISSUE_COUNT_ALIASES[issue]}`;
      })
      .join(", ");

    statement.append(
      `SELECT ${CONVERSATION_KEY_SQL} AS conversationKey, ` +
        `any(llmConversationId) AS conversationId, ` +
        `argMin(traceId, ${CALL_START_SQL}) AS firstTraceId, ` +
        `intDiv(min(${CALL_START_SQL}), ${NANOS_PER_MILLI}) AS startedAtMs, ` +
        `intDiv(max(${CALL_END_SQL}), ${NANOS_PER_MILLI}) AS endedAtMs, ` +
        `count() AS callCount, ` +
        `countIf(${IS_ANSWER_SQL}) AS answerCount, ` +
        `sum(llmCost) AS costUsd, ` +
        `sum(llmInputTokens) AS inputTokens, ` +
        `sum(llmOutputTokens) AS outputTokens, ` +
        `${issueColumns}, ` +
        `maxIf(durationUnixNano, ${IS_ANSWER_SQL}) AS slowestAnswerNano, ` +
        `argMinIf(llmUserMessagePreview, ${CALL_START_SQL}, llmUserMessagePreview != '') AS title, ` +
        `groupUniqArrayIf(5)(llmRequestModel, llmRequestModel != '') AS models, ` +
        `groupUniqArrayIf(5)(${PERSON_SQL}, ${PERSON_SQL} != '') AS people, ` +
        `groupUniqArray(5)(primaryEntityId) AS serviceIds, ` +
        `groupUniqArrayIf(5)(llmAgentName, llmAgentName != '') AS agents ` +
        `FROM ${TABLE_NAME}`,
    );

    LlmConversationService.appendScope(statement, query);
    statement.append(" GROUP BY conversationKey");
    LlmConversationService.appendHaving(statement, query, {
      includeIssue: true,
    });

    statement.append(
      ` ORDER BY ${LlmConversationService.getOrderBy(query.sort)}`,
    );
    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: query.limit + 1,
      }} OFFSET ${{
        type: TableColumnType.Number,
        value: query.skip,
      }}`,
    );
    statement.append(QUERY_SETTINGS);

    return statement;
  }

  /*
   * One row over every conversation the filters (but not the issue chip)
   * select: the page's summary and each chip's count. Answer latency is
   * merged from per-conversation quantile states, so the median is over
   * answers, not over conversations.
   */
  public static buildSummaryStatement(
    query: LlmConversationListQuery,
  ): Statement {
    const statement: Statement = new Statement();

    /*
     * The inner (per-conversation) columns carry an "inner" prefix: an outer
     * aggregate whose alias is the name of the inner column it reads
     * (sum(callCount) AS callCount) makes ClickHouse read the alias inside
     * the other aggregates - "aggregate function found inside another".
     */
    const innerIssueColumns: string = LlmAnswerIssueUtil.getAllIssues()
      .map((issue: LlmAnswerIssue): string => {
        return `${issueCountSql(issue)} AS inner_${ISSUE_COUNT_ALIASES[issue]}`;
      })
      .join(", ");

    const outerIssueColumns: string = LlmAnswerIssueUtil.getAllIssues()
      .map((issue: LlmAnswerIssue): string => {
        return `countIf(inner_${ISSUE_COUNT_ALIASES[issue]} > 0) AS ${ISSUE_COUNT_ALIASES[issue]}Conversations`;
      })
      .join(", ");

    statement.append(
      `SELECT count() AS conversationCount, ` +
        `sum(inner_callCount) AS callCount, ` +
        `sum(inner_answerCount) AS answerCount, ` +
        `sum(inner_problemCallCount) AS problemCallCount, ` +
        `countIf(inner_problemCallCount > 0) AS problemConversationCount, ` +
        `${outerIssueColumns}, ` +
        `sum(inner_costUsd) AS costUsd, ` +
        `sum(inner_inputTokens) AS inputTokens, ` +
        `sum(inner_outputTokens) AS outputTokens, ` +
        `quantilesMerge(0.5, 0.95)(inner_answerLatencyState) AS answerLatencyNano ` +
        `FROM (SELECT ${CONVERSATION_KEY_SQL} AS conversationKey, ` +
        `count() AS inner_callCount, ` +
        `countIf(${IS_ANSWER_SQL}) AS inner_answerCount, ` +
        `countIf(${HAS_PROBLEM_SQL}) AS inner_problemCallCount, ` +
        `${innerIssueColumns}, ` +
        `sum(llmCost) AS inner_costUsd, ` +
        `sum(llmInputTokens) AS inner_inputTokens, ` +
        `sum(llmOutputTokens) AS inner_outputTokens, ` +
        `quantilesStateIf(0.5, 0.95)(durationUnixNano, ${IS_ANSWER_SQL}) AS inner_answerLatencyState ` +
        `FROM ${TABLE_NAME}`,
    );

    LlmConversationService.appendScope(statement, query);
    statement.append(" GROUP BY conversationKey");
    LlmConversationService.appendHaving(statement, query, {
      includeIssue: false,
    });
    statement.append(")");
    statement.append(QUERY_SETTINGS);

    return statement;
  }

  // Every AI call of one conversation, oldest first, with its content.
  public static buildCallsStatement(
    query: LlmConversationDetailQuery,
  ): Statement {
    const statement: Statement = new Statement();

    statement.append(
      `SELECT spanId, traceId, parentSpanId, name, ` +
        `intDiv(${CALL_START_SQL}, ${NANOS_PER_MILLI}) AS startMs, ` +
        `intDiv(${CALL_END_SQL}, ${NANOS_PER_MILLI}) AS endMs, ` +
        `statusCode, statusMessage, llmCallKind, llmOperation, ` +
        `llmRequestModel, llmResponseModel, llmSystem, llmAgentName, llmToolName, ` +
        `llmInputTokens, llmOutputTokens, llmCost, llmIssues, ` +
        `llmUserEmail, llmUserId, primaryEntityId, attributes, events ` +
        `FROM ${TABLE_NAME}`,
    );

    LlmConversationService.appendScope(statement, query);

    if (query.key.kind === LlmConversationKeyKind.Conversation) {
      statement.append(
        SQL` AND llmConversationId = ${{
          type: TableColumnType.Text,
          value: query.key.value,
        }}`,
      );
    } else {
      /*
       * A request is the calls of one trace that report no conversation id.
       * A call in the same trace that does report one belongs to that
       * conversation instead, exactly as the list grouped it.
       */
      statement.append(
        SQL` AND lower(traceId) = ${{
          type: TableColumnType.Text,
          value: query.key.value,
        }} AND llmConversationId = ''`,
      );
    }

    // A column name, so plain text: the SQL tag would bind it as a value.
    statement.append(` ORDER BY ${CALL_START_SQL} ASC`);
    statement.append(
      SQL` LIMIT ${{
        type: TableColumnType.Number,
        value: LLM_CONVERSATION_MAX_CALLS + 1,
      }}`,
    );
    statement.append(QUERY_SETTINGS);

    return statement;
  }

  public static getOrderBy(sort: LlmConversationSort): string {
    switch (sort) {
      case LlmConversationSort.Oldest:
        return "startedAtMs ASC, conversationKey ASC";
      case LlmConversationSort.MostExpensive:
        return "costUsd DESC, startedAtMs DESC, conversationKey ASC";
      case LlmConversationSort.Slowest:
        return "slowestAnswerNano DESC, startedAtMs DESC, conversationKey ASC";
      case LlmConversationSort.MostCalls:
        return "callCount DESC, startedAtMs DESC, conversationKey ASC";
      case LlmConversationSort.Newest:
      default:
        return "startedAtMs DESC, conversationKey ASC";
    }
  }

  public static toListItem(row: JSONObject): LlmConversationListItem | null {
    const key: LlmConversationKey | null = LlmConversationKeyUtil.decode(
      row["conversationKey"],
    );

    if (!key) {
      return null;
    }

    const startedAtMs: number = readNumber(row["startedAtMs"]);
    const endedAtMs: number = Math.max(
      readNumber(row["endedAtMs"]),
      startedAtMs,
    );

    return {
      key: LlmConversationKeyUtil.encode(key),
      kind: key.kind,
      conversationId:
        key.kind === LlmConversationKeyKind.Conversation ? key.value : "",
      traceId: readString(row["firstTraceId"]),
      title: readString(row["title"]),
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: endedAtMs - startedAtMs,
      callCount: readNumber(row["callCount"]),
      answerCount: readNumber(row["answerCount"]),
      costUsd: readNumber(row["costUsd"]),
      inputTokens: readNumber(row["inputTokens"]),
      outputTokens: readNumber(row["outputTokens"]),
      issueCounts: LlmConversationService.readIssueColumns(row, ""),
      slowestAnswerMs: Math.round(readNumber(row["slowestAnswerNano"]) / 1e6),
      models: readStringArray(row["models"]),
      people: readStringArray(row["people"]),
      serviceIds: readStringArray(row["serviceIds"]),
      agents: readStringArray(row["agents"]),
    };
  }

  public static toSummary(row: JSONObject): LlmConversationSummary {
    const latency: Array<unknown> = Array.isArray(row["answerLatencyNano"])
      ? (row["answerLatencyNano"] as Array<unknown>)
      : [];
    const answerCount: number = readNumber(row["answerCount"]);

    const toMs: (value: unknown) => number | null = (
      value: unknown,
    ): number | null => {
      const nano: number | null = readOptionalNumber(value);
      return nano === null || answerCount === 0 ? null : Math.round(nano / 1e6);
    };

    return {
      conversationCount: readNumber(row["conversationCount"]),
      callCount: readNumber(row["callCount"]),
      answerCount: answerCount,
      problemCallCount: readNumber(row["problemCallCount"]),
      problemConversationCount: readNumber(row["problemConversationCount"]),
      issueConversationCounts: LlmConversationService.readIssueColumns(
        row,
        "Conversations",
      ),
      costUsd: readNumber(row["costUsd"]),
      inputTokens: readNumber(row["inputTokens"]),
      outputTokens: readNumber(row["outputTokens"]),
      medianAnswerMs: toMs(latency[0]),
      p95AnswerMs: toMs(latency[1]),
    };
  }

  public static toCall(row: JSONObject): LlmConversationCall {
    const attributes: JSONObject =
      row["attributes"] && typeof row["attributes"] === "object"
        ? (row["attributes"] as JSONObject)
        : {};
    const events: Array<unknown> = parseJsonArray(row["events"]);

    let content: LlmCallContent;

    try {
      content = LlmMessageParser.readCallContent({
        attributes: attributes,
        events: events,
      });
    } catch {
      content = {
        systemInstructions: "",
        input: [],
        output: [],
        finishReasons: [],
        tool: null,
        evaluations: [],
        errorType: "",
      };
    }

    const statusIsError: boolean =
      readNumber(row["statusCode"]) === SpanStatus.Error;
    const issues: Array<LlmAnswerIssue> = LlmAnswerIssueUtil.fromValues(
      row["llmIssues"],
    );

    // Rows from before llmIssues existed: the status still says it failed.
    if (statusIsError && !issues.includes(LlmAnswerIssue.Failed)) {
      issues.unshift(LlmAnswerIssue.Failed);
    }

    const model: string =
      readString(row["llmResponseModel"]) || readString(row["llmRequestModel"]);

    return {
      spanId: readString(row["spanId"]),
      traceId: readString(row["traceId"]),
      parentSpanId: readString(row["parentSpanId"]),
      name: readString(row["name"]),
      startMs: readNumber(row["startMs"]),
      endMs: readNumber(row["endMs"]),
      statusIsError: statusIsError,
      statusMessage: readString(row["statusMessage"]),
      kind:
        LlmCallKindUtil.fromStoredValue(row["llmCallKind"]) ||
        LlmCallKindUtil.getKind({
          operation: readString(row["llmOperation"]),
          model: model,
          toolName: readString(row["llmToolName"]),
          agentName: readString(row["llmAgentName"]),
        }),
      model: model,
      provider: readString(row["llmSystem"]),
      agentName: readString(row["llmAgentName"]),
      toolName: readString(row["llmToolName"]),
      inputTokens: readNumber(row["llmInputTokens"]),
      outputTokens: readNumber(row["llmOutputTokens"]),
      costUsd: readNumber(row["llmCost"]),
      issues: issues,
      userLabel:
        readString(row["llmUserEmail"]) || readString(row["llmUserId"]),
      serviceId: readString(row["primaryEntityId"]),
      content: content,
    };
  }

  private static readIssueColumns(
    row: JSONObject,
    suffix: string,
  ): LlmIssueCounts {
    const counts: LlmIssueCounts = emptyIssueCounts();

    for (const issue of LlmAnswerIssueUtil.getAllIssues()) {
      counts[issue] = Math.max(
        0,
        readNumber(row[`${ISSUE_COUNT_ALIASES[issue]}${suffix}`]),
      );
    }

    return counts;
  }

  private static async readRows(
    statement: Statement,
  ): Promise<Array<JSONObject>> {
    const result: Results = await SpanService.executeQuery(statement);
    const response: DbJSONResponse = await result.json<{
      data?: Array<JSONObject>;
    }>();

    return (response.data || []) as Array<JSONObject>;
  }
}
