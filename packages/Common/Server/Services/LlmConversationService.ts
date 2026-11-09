import {
  SQL,
  Statement,
  escapeIlikePattern,
} from "../Utils/AnalyticsDatabase/Statement";
import { getQuerySettings } from "../Utils/AnalyticsDatabase/QuerySettingsHelper";
import SpanService from "./SpanService";
import { DbJSONResponse, Results } from "./AnalyticsDatabaseService";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
  TelemetryServiceFilter,
} from "../Utils/Telemetry/TelemetryReadScope";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import LlmLogEventReader, {
  LlmLogEventReadResult,
  LlmLogEventTitleRequest,
} from "../Utils/Telemetry/LlmLogEventReader";
import LlmCountedCallsSql, {
  LlmCountedCallsScope,
} from "../Utils/Telemetry/LlmCountedCallsSql";
import logger from "../Utils/Logger";
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
  LlmLogEventsRead,
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
import LlmLogEventsUtil, {
  LlmLogEventCall,
  LlmLogEventRecord,
} from "../../Utils/Telemetry/LlmLogEvents";

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
 * A conversation's tokens and cost count each model call once: an agent
 * run's or a wrapper span's repeat of what its calls report is left out
 * (LlmCountedCallsSql), as the Usage tab and the transcript count them.
 *
 * Every read is bounded below nginx's 60 s read timeout with 'throw', never
 * 'break': a grouped read cut short with 'break' answers an EMPTY body, which
 * would read as "no conversations" (see the ClickHouse query limits note).
 *
 * Prompts and answers an app sends as GenAI log events rather than on its
 * spans (the OpenTelemetry instrumentations for JavaScript and Java, and
 * Python's with `true` or `event_only`) are read from the Log table when a
 * conversation is opened, for the answers whose spans lack them, and for
 * the titles of list rows whose spans recorded no question
 * (LlmLogEventReader). Those reads take the caller's LOG read scope: what
 * they may read on the Logs page.
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
export const IS_ANSWER_SQL: string = `(llmCallKind = '${LlmCallKind.Answer}' OR (llmCallKind = '' AND llmRequestModel != ''))`;

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
  /*
   * What the caller may read of logs, for the titles of rows whose spans
   * recorded no question; null or absent: no log is read.
   */
  logScope?: TelemetryReadScope | null | undefined;
}

export interface LlmConversationDetailQuery extends TelemetryServiceFilter {
  projectId: ObjectID;
  key: LlmConversationKey;
  startTime: Date;
  endTime: Date;
  /*
   * What the caller may read of logs, for the prompts and answers sent as
   * GenAI log events; null: they may read no log.
   */
  logScope: TelemetryReadScope | null;
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
  // Whether the prompts and answers sent as GenAI log events were read.
  logEvents: LlmLogEventsRead;
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

    const conversations: Array<LlmConversationListItem> = pageRows
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
      );

    await LlmConversationService.addLogEventTitles({
      projectId: query.projectId,
      conversations: conversations,
      logScope: query.logScope || null,
    });

    return {
      summary: summaryRow
        ? LlmConversationService.toSummary(summaryRow[0] || {})
        : null,
      conversations: conversations,
      hasMore: hasMore,
    };
  }

  /*
   * Titles for the page's rows whose spans recorded no question, from the
   * GenAI log events of each conversation's first call (in place). Best
   * effort: a caller who may read no log, or a read that fails, leaves the
   * rows as they were - the row then names its request or conversation id.
   */
  public static async addLogEventTitles(data: {
    projectId: ObjectID;
    conversations: Array<LlmConversationListItem>;
    logScope: TelemetryReadScope | null;
  }): Promise<void> {
    if (!data.logScope) {
      return;
    }

    const logScope: TelemetryReadScope = data.logScope;

    const untitled: Array<LlmConversationListItem> = data.conversations.filter(
      (conversation: LlmConversationListItem): boolean => {
        return (
          !conversation.title &&
          Boolean(conversation.traceId) &&
          conversation.serviceIds.some((serviceId: string): boolean => {
            return TelemetryReadScopeUtil.isReadable(logScope, serviceId);
          })
        );
      },
    );

    if (untitled.length === 0) {
      return;
    }

    try {
      const titles: Map<string, string> = await LlmLogEventReader.readTitles({
        projectId: data.projectId,
        requests: untitled.map(
          (conversation: LlmConversationListItem): LlmLogEventTitleRequest => {
            return {
              key: conversation.key,
              traceId: conversation.traceId,
              startedAtMs: new Date(conversation.startedAt).getTime(),
            };
          },
        ),
        logFilter: TelemetryReadScopeUtil.toServiceFilter(logScope),
      });

      for (const conversation of untitled) {
        conversation.title = titles.get(conversation.key) || "";
      }
    } catch (err: unknown) {
      logger.warn(
        `Could not read conversation titles from GenAI log events: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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

    const logEvents: LlmLogEventsRead =
      await LlmConversationService.addLogEventContent({
        projectId: query.projectId,
        calls: calls,
        logScope: query.logScope,
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
      logEvents: logEvents,
    };
  }

  /*
   * The calls whose prompt or answer is not on their span: the answers
   * (a model asked) that lack either. Tool runs and agent wrappers record
   * theirs elsewhere, and are never read for.
   */
  public static getCallsLackingContent(
    calls: ReadonlyArray<LlmConversationCall>,
  ): Array<LlmConversationCall> {
    return calls.filter((call: LlmConversationCall): boolean => {
      return (
        call.kind === LlmCallKind.Answer &&
        Boolean(call.spanId) &&
        LlmLogEventsUtil.lacksContent(call.content)
      );
    });
  }

  /*
   * Reads the GenAI log events of the answers whose spans lack their prompt
   * or answer, and merges what they say into those calls' content (in
   * place): the span's own content wins, the records fill in only what it
   * leaves out. Says what was read.
   */
  public static async addLogEventContent(data: {
    projectId: ObjectID;
    calls: Array<LlmConversationCall>;
    logScope: TelemetryReadScope | null;
  }): Promise<LlmLogEventsRead> {
    const lacking: Array<LlmConversationCall> =
      LlmConversationService.getCallsLackingContent(data.calls);

    if (lacking.length === 0) {
      return LlmLogEventsRead.NotNeeded;
    }

    if (!data.logScope) {
      return LlmLogEventsRead.NotAllowed;
    }

    const logScope: TelemetryReadScope = data.logScope;

    // A call's records come from its own app: its logs must be readable.
    const readable: Array<LlmConversationCall> = lacking.filter(
      (call: LlmConversationCall): boolean => {
        return (
          !call.serviceId ||
          TelemetryReadScopeUtil.isReadable(logScope, call.serviceId)
        );
      },
    );

    const state: LlmLogEventsRead =
      readable.length < lacking.length
        ? LlmLogEventsRead.NotAllowed
        : LlmLogEventsRead.Read;

    if (readable.length === 0) {
      return state;
    }

    let result: LlmLogEventReadResult;

    try {
      result = await LlmLogEventReader.readForCalls({
        projectId: data.projectId,
        calls: readable.map(LlmConversationService.toLogEventCall),
        logFilter: TelemetryReadScopeUtil.toServiceFilter(logScope),
      });
    } catch (err: unknown) {
      logger.warn(
        `Could not read GenAI log events of a conversation: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      return LlmLogEventsRead.Failed;
    }

    /*
     * Every call of the conversation is a candidate for a record, so a
     * record without a span id is only given to an answer when it is the
     * one it happened during.
     */
    const assigned: Map<
      string,
      Array<LlmLogEventRecord>
    > = LlmLogEventsUtil.assignToCalls(
      data.calls.map(LlmConversationService.toLogEventCall),
      result.records,
    );

    for (const call of readable) {
      const records: Array<LlmLogEventRecord> | undefined = assigned.get(
        call.spanId,
      );

      if (!records || records.length === 0) {
        continue;
      }

      try {
        call.content = LlmLogEventsUtil.mergeContent(
          call.content,
          LlmLogEventsUtil.readContent(records),
        );
      } catch {
        // Records of a shape the parser cannot read say nothing.
      }
    }

    return state;
  }

  public static toLogEventCall(call: LlmConversationCall): LlmLogEventCall {
    return {
      spanId: call.spanId,
      traceId: call.traceId,
      startMs: call.startMs,
      endMs: call.endMs,
      isModelCall: call.kind === LlmCallKind.Answer,
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

  // What the counted figures of a read are counted against: its project, range and scope.
  public static getCountedCallsScope(
    query: TelemetryServiceFilter & {
      projectId: ObjectID;
      startTime: Date;
      endTime: Date;
    },
  ): LlmCountedCallsScope {
    return {
      projectId: query.projectId,
      startTime: query.startTime,
      endTime: query.endTime,
      serviceIds: query.serviceIds,
      excludedServiceIds: query.excludedServiceIds,
    };
  }

  /*
   * `sum(<counted cost>) AS <prefix>costUsd, sum(<counted input tokens>) AS
   * <prefix>inputTokens, sum(<counted output tokens>) AS
   * <prefix>outputTokens, `: each model call's figures once.
   */
  public static appendCountedSums(
    statement: Statement,
    scope: LlmCountedCallsScope,
    prefix: string,
  ): void {
    statement.append("sum(");
    statement.append(LlmCountedCallsSql.buildCountedColumn(scope, "llmCost"));
    statement.append(`) AS ${prefix}costUsd, sum(`);
    statement.append(
      LlmCountedCallsSql.buildCountedColumn(scope, "llmInputTokens"),
    );
    statement.append(`) AS ${prefix}inputTokens, sum(`);
    statement.append(
      LlmCountedCallsSql.buildCountedColumn(scope, "llmOutputTokens"),
    );
    statement.append(`) AS ${prefix}outputTokens, `);
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
        `countIf(${IS_ANSWER_SQL}) AS answerCount, `,
    );
    LlmConversationService.appendCountedSums(
      statement,
      LlmConversationService.getCountedCallsScope(query),
      "",
    );
    statement.append(
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
        `${innerIssueColumns}, `,
    );
    LlmConversationService.appendCountedSums(
      statement,
      LlmConversationService.getCountedCallsScope(query),
      "inner_",
    );
    statement.append(
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
