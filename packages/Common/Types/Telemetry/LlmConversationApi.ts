import { LlmAnswerIssue, LlmAnswerIssueUtil } from "./LlmAnswerIssue";
import { JSONObject } from "../JSON";

/*
 * The contract of the two conversation routes:
 *
 *   POST /telemetry/llm/conversations  - the conversations of a time range,
 *       one row each (calls grouped by conversation), with the summary the
 *       page shows above them and a count per answer issue for its chips;
 *   POST /telemetry/llm/conversation   - one conversation as a transcript,
 *       built on the server (Common/Utils/Telemetry/LlmConversationTranscript)
 *       so the browser downloads each message once instead of every call's
 *       full prompt history.
 *
 * A conversation is the calls that share a conversation id
 * (gen_ai.conversation.id, session.id ... - Span.llmConversationId). Calls
 * that report none are grouped by their trace: one request, and everything
 * the AI did for it. The conventions forbid instrumentations from inventing
 * a conversation id, so this grouping is OneUptime's, and the key says
 * which it is.
 *
 * Both bodies are read defensively on both sides: a server mid-rollout or a
 * hand-made request must degrade to "nothing", never to a crash.
 */

export const LLM_CONVERSATIONS_ROUTE: string = "/telemetry/llm/conversations";
export const LLM_CONVERSATION_ROUTE: string = "/telemetry/llm/conversation";

/*
 * What an AI / LLM monitor would see right now: the answers of its window
 * and how many were bad, for the monitor form's preview. The body is the
 * monitor's step (MonitorStepLlmMonitor as JSON).
 */
export const LLM_ANSWER_STATS_ROUTE: string = "/telemetry/llm/answer-stats";

export const LLM_CONVERSATION_PAGE_SIZE: number = 25;
export const LLM_CONVERSATION_MAX_PAGE_SIZE: number = 100;

// Longest search text, model or person filter the list accepts.
export const LLM_CONVERSATION_MAX_FILTER_LENGTH: number = 200;

// How many calls one conversation view reads.
export const LLM_CONVERSATION_MAX_CALLS: number = 500;

/*
 * How far around the time hint a conversation view looks, and how far back
 * without one. A conversation id can span days; the hint (the list row's
 * first and last call) keeps the read on the partitions that hold it.
 */
export const LLM_CONVERSATION_HINT_PADDING_MS: number = 24 * 60 * 60 * 1000;
export const LLM_CONVERSATION_DEFAULT_LOOKBACK_MS: number =
  30 * 24 * 60 * 60 * 1000;

export enum LlmConversationKeyKind {
  // Calls that share a conversation id.
  Conversation = "conversation",
  // Calls of one trace that report no conversation id.
  Request = "request",
}

export interface LlmConversationKey {
  kind: LlmConversationKeyKind;
  // The conversation id, or the trace id.
  value: string;
}

export enum LlmConversationSort {
  Newest = "newest",
  Oldest = "oldest",
  MostExpensive = "most_expensive",
  Slowest = "slowest",
  MostCalls = "most_calls",
}

// "any" is every conversation with at least one issue.
export type LlmConversationIssueFilter = LlmAnswerIssue | "any";

export interface LlmConversationListRequestBody {
  startTime: string;
  endTime: string;
  serviceIds?: Array<string> | undefined;
  model?: string | undefined;
  person?: string | undefined;
  search?: string | undefined;
  issue?: LlmConversationIssueFilter | undefined;
  sort?: LlmConversationSort | undefined;
  limit?: number | undefined;
  skip?: number | undefined;
  includeSummary?: boolean | undefined;
}

export type LlmIssueCounts = Record<LlmAnswerIssue, number>;

export interface LlmConversationSummary {
  conversationCount: number;
  callCount: number;
  answerCount: number;
  // Calls with at least one issue.
  problemCallCount: number;
  // Conversations with at least one call with an issue.
  problemConversationCount: number;
  // Conversations with at least one call with each issue.
  issueConversationCounts: LlmIssueCounts;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  // How long answers took (null when there were none).
  medianAnswerMs: number | null;
  p95AnswerMs: number | null;
}

export interface LlmConversationListItem {
  // The encoded key (LlmConversationKeyUtil.encode).
  key: string;
  kind: LlmConversationKeyKind;
  conversationId: string;
  // The first trace of the conversation, for "open in traces".
  traceId: string;
  // What the person first asked ("" when the prompt was not recorded).
  title: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  callCount: number;
  answerCount: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  // Calls with each issue.
  issueCounts: LlmIssueCounts;
  slowestAnswerMs: number;
  models: Array<string>;
  people: Array<string>;
  serviceIds: Array<string>;
  agents: Array<string>;
}

export interface LlmConversationListResponse {
  summary: LlmConversationSummary | null;
  conversations: Array<LlmConversationListItem>;
  hasMore: boolean;
}

export interface LlmConversationDetailRequestBody {
  key: string;
  // The list row's first and last call, when known (ISO).
  startTime?: string | undefined;
  endTime?: string | undefined;
}

export interface LlmAnswerStatsResponse {
  answerCount: number;
  badAnswerCount: number;
  // 0..100, two decimals; 0 when there were no answers.
  badAnswerPercent: number;
  // The window the counts cover (ISO).
  startTime: string;
  endTime: string;
}

export class LlmConversationKeyUtil {
  public static readonly CONVERSATION_PREFIX: string = "c:";
  public static readonly REQUEST_PREFIX: string = "t:";
  public static readonly MAX_LENGTH: number = 1024;

  private static readonly TRACE_ID_LENGTH: number = 32;

  public static encode(key: LlmConversationKey): string {
    return key.kind === LlmConversationKeyKind.Request
      ? `${LlmConversationKeyUtil.REQUEST_PREFIX}${key.value}`
      : `${LlmConversationKeyUtil.CONVERSATION_PREFIX}${key.value}`;
  }

  /*
   * A key read back, or null for anything that is not one: an unknown
   * prefix, an empty value, a request key that is not a 32-hex trace id, or
   * a value too long to be an id.
   */
  public static decode(raw: unknown): LlmConversationKey | null {
    if (typeof raw !== "string" || raw.length > LlmConversationKeyUtil.MAX_LENGTH) {
      return null;
    }

    if (raw.startsWith(LlmConversationKeyUtil.CONVERSATION_PREFIX)) {
      const value: string = raw.slice(
        LlmConversationKeyUtil.CONVERSATION_PREFIX.length,
      );

      return value.length > 0
        ? { kind: LlmConversationKeyKind.Conversation, value: value }
        : null;
    }

    if (raw.startsWith(LlmConversationKeyUtil.REQUEST_PREFIX)) {
      const value: string = raw
        .slice(LlmConversationKeyUtil.REQUEST_PREFIX.length)
        .toLowerCase();

      return LlmConversationKeyUtil.isTraceId(value)
        ? { kind: LlmConversationKeyKind.Request, value: value }
        : null;
    }

    return null;
  }

  // The key as one URL path segment.
  public static toPathSegment(key: LlmConversationKey): string {
    return encodeURIComponent(LlmConversationKeyUtil.encode(key));
  }

  public static fromPathSegment(segment: unknown): LlmConversationKey | null {
    if (typeof segment !== "string" || segment.length === 0) {
      return null;
    }

    try {
      return LlmConversationKeyUtil.decode(decodeURIComponent(segment));
    } catch {
      // A malformed escape is not a key.
      return null;
    }
  }

  public static isTraceId(value: string): boolean {
    if (value.length !== LlmConversationKeyUtil.TRACE_ID_LENGTH) {
      return false;
    }

    for (const character of value) {
      const isHex: boolean =
        (character >= "0" && character <= "9") ||
        (character >= "a" && character <= "f");

      if (!isHex) {
        return false;
      }
    }

    return true;
  }
}

export function emptyIssueCounts(): LlmIssueCounts {
  const counts: Partial<LlmIssueCounts> = {};

  for (const issue of LlmAnswerIssueUtil.getAllIssues()) {
    counts[issue] = 0;
  }

  return counts as LlmIssueCounts;
}

/*
 * Readers for the untyped JSON on either side. ClickHouse answers 64-bit
 * counters as strings, so every number is read with Number(); anything that
 * is not a finite number reads as 0 (or null where "none" means something).
 */
export function readNumber(value: unknown): number {
  const parsed: number =
    typeof value === "number" ? value : Number(value ?? Number.NaN);

  return Number.isFinite(parsed) ? parsed : 0;
}

export function readOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

export function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function readStringArray(value: unknown): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry: unknown): entry is string => {
      return typeof entry === "string" && entry.length > 0;
    })
    .slice(0, 50);
}

export function readIssueCounts(value: unknown): LlmIssueCounts {
  const counts: LlmIssueCounts = emptyIssueCounts();
  const object: JSONObject | null =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : null;

  if (!object) {
    return counts;
  }

  for (const issue of LlmAnswerIssueUtil.getAllIssues()) {
    counts[issue] = Math.max(0, readNumber(object[issue]));
  }

  return counts;
}

export function readConversationSummary(
  value: unknown,
): LlmConversationSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const object: JSONObject = value as JSONObject;

  return {
    conversationCount: readNumber(object["conversationCount"]),
    callCount: readNumber(object["callCount"]),
    answerCount: readNumber(object["answerCount"]),
    problemCallCount: readNumber(object["problemCallCount"]),
    problemConversationCount: readNumber(object["problemConversationCount"]),
    issueConversationCounts: readIssueCounts(object["issueConversationCounts"]),
    costUsd: readNumber(object["costUsd"]),
    inputTokens: readNumber(object["inputTokens"]),
    outputTokens: readNumber(object["outputTokens"]),
    medianAnswerMs: readOptionalNumber(object["medianAnswerMs"]),
    p95AnswerMs: readOptionalNumber(object["p95AnswerMs"]),
  };
}

export function readConversationListItem(
  value: unknown,
): LlmConversationListItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const object: JSONObject = value as JSONObject;
  const key: LlmConversationKey | null = LlmConversationKeyUtil.decode(
    object["key"],
  );

  if (!key) {
    return null;
  }

  return {
    key: LlmConversationKeyUtil.encode(key),
    kind: key.kind,
    conversationId: readString(object["conversationId"]),
    traceId: readString(object["traceId"]),
    title: readString(object["title"]),
    startedAt: readString(object["startedAt"]),
    endedAt: readString(object["endedAt"]),
    durationMs: Math.max(0, readNumber(object["durationMs"])),
    callCount: readNumber(object["callCount"]),
    answerCount: readNumber(object["answerCount"]),
    costUsd: readNumber(object["costUsd"]),
    inputTokens: readNumber(object["inputTokens"]),
    outputTokens: readNumber(object["outputTokens"]),
    issueCounts: readIssueCounts(object["issueCounts"]),
    slowestAnswerMs: Math.max(0, readNumber(object["slowestAnswerMs"])),
    models: readStringArray(object["models"]),
    people: readStringArray(object["people"]),
    serviceIds: readStringArray(object["serviceIds"]),
    agents: readStringArray(object["agents"]),
  };
}

export function readConversationListResponse(
  value: unknown,
): LlmConversationListResponse {
  const object: JSONObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};

  const rows: Array<unknown> = Array.isArray(object["conversations"])
    ? (object["conversations"] as Array<unknown>)
    : [];

  return {
    summary: readConversationSummary(object["summary"]),
    conversations: rows
      .map((row: unknown): LlmConversationListItem | null => {
        return readConversationListItem(row);
      })
      .filter(
        (row: LlmConversationListItem | null): row is LlmConversationListItem => {
          return row !== null;
        },
      ),
    hasMore: object["hasMore"] === true,
  };
}

export function readAnswerStatsResponse(
  value: unknown,
): LlmAnswerStatsResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const object: JSONObject = value as JSONObject;
  const answerCount: number = Math.max(0, readNumber(object["answerCount"]));

  return {
    answerCount: answerCount,
    badAnswerCount: Math.min(
      answerCount,
      Math.max(0, readNumber(object["badAnswerCount"])),
    ),
    badAnswerPercent: Math.min(
      100,
      Math.max(0, readNumber(object["badAnswerPercent"])),
    ),
    startTime: readString(object["startTime"]),
    endTime: readString(object["endTime"]),
  };
}

// The sort a request names, or Newest.
export function readConversationSort(value: unknown): LlmConversationSort {
  const sorts: Array<string> = Object.values(LlmConversationSort);

  return typeof value === "string" && sorts.includes(value)
    ? (value as LlmConversationSort)
    : LlmConversationSort.Newest;
}

// The issue filter a request names, or none.
export function readConversationIssueFilter(
  value: unknown,
): LlmConversationIssueFilter | undefined {
  if (value === "any") {
    return "any";
  }

  const issues: Array<LlmAnswerIssue> = LlmAnswerIssueUtil.fromValues([value]);

  return issues[0];
}

// A filter text trimmed and cut to the limit; undefined when blank.
export function readFilterText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed: string = value.trim();

  return trimmed.length > 0
    ? trimmed.slice(0, LLM_CONVERSATION_MAX_FILTER_LENGTH)
    : undefined;
}
