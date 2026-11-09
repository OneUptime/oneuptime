/*
 * The limits of a code task's run as the server tells the Runner's code
 * agent (issue #6440), with every completion it serves and with the run's
 * production telemetry tools: the project's caps (none by default), its
 * time limit and how much of it is left, and what the run has used so far.
 *
 * The server holds what it can count - model calls and tokens from the
 * run's own LlmLog rows, and the time from when the run was claimed - and
 * refuses a call past them. The agent holds the cap on tool calls (it runs
 * the tools) and winds down before each limit from these numbers, so a run
 * ends with an honest summary rather than a refusal.
 *
 * Shared by the server and the Runner. Kept free of server code.
 */

import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunTimeLimitSource,
} from "./AIAgentRunLimits";

export interface CodeAgentRunLimits {
  // Null: no cap.
  maxModelCalls: number | null;
  maxToolCalls: number | null;
  maxTokens: number | null;
  // Every run has one.
  timeLimitInMinutes: number;
  timeLimitSource: AIRunTimeLimitSource;
  /*
   * When the run's time is up (ISO 8601): when it was claimed, plus its time
   * limit. Null for a run whose start is not recorded.
   */
  deadlineAt: string | null;
  /*
   * How long the run had left when the server answered: what the agent
   * keeps its clock to, so a Runner whose clock is off by minutes still
   * winds down on time.
   */
  timeLeftMs: number | null;
  // What the run has used, the call this came with included.
  modelCallsUsed: number;
  // The production telemetry calls the server ran for it.
  toolCallsUsed: number;
  // Counted as OneUptime counts them (AiTokenCount).
  tokensUsed: number;
  /*
   * Of tokensUsed, the call this came with: what the next call will use at
   * least, since the conversation only grows. 0 with an answer that is not
   * a model call's.
   */
  lastCallTokens: number;
}

const MILLISECONDS_IN_A_MINUTE: number = 60 * 1000;

function readCap(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : null;
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export default class CodeAgentRunLimitsUtil {
  // What the server tells the agent, from a run's limits and usage.
  public static build(data: {
    limits: AIAgentRunLimits;
    // When this attempt of the run was claimed.
    startedAt: Date | null | undefined;
    modelCallsUsed: number;
    toolCallsUsed: number;
    tokensUsed: number;
    // The tokens of the model call this goes with, if it goes with one.
    lastCallTokens?: number | undefined;
    // Now, on the server's clock.
    nowMs?: number | undefined;
  }): CodeAgentRunLimits {
    const startedAtMs: number | null = data.startedAt
      ? new Date(data.startedAt).getTime()
      : null;

    const deadlineAtMs: number | null =
      startedAtMs !== null && Number.isFinite(startedAtMs)
        ? AIAgentRunLimitsHelper.getDeadlineAtMs(data.limits, startedAtMs)
        : null;

    const nowMs: number = data.nowMs ?? Date.now();

    return {
      maxModelCalls: data.limits.maxLlmCalls ?? null,
      maxToolCalls: data.limits.maxToolCalls ?? null,
      maxTokens: data.limits.maxTokens ?? null,
      timeLimitInMinutes: AIAgentRunLimitsHelper.getTimeLimitInMinutes(
        data.limits,
      ),
      timeLimitSource: data.limits.timeLimitSource,
      deadlineAt:
        deadlineAtMs !== null ? new Date(deadlineAtMs).toISOString() : null,
      timeLeftMs:
        deadlineAtMs !== null ? Math.max(0, deadlineAtMs - nowMs) : null,
      modelCallsUsed: data.modelCallsUsed,
      toolCallsUsed: data.toolCallsUsed,
      tokensUsed: data.tokensUsed,
      lastCallTokens: data.lastCallTokens ?? 0,
    };
  }

  /*
   * The limits as a Runner reads them from an answer, or null when the
   * answer holds none (a server from before #6440): every field checked,
   * since the Runner may be newer or older than the server.
   */
  public static fromJSON(raw: unknown): CodeAgentRunLimits | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }

    const data: Record<string, unknown> = raw as Record<string, unknown>;
    const minutes: unknown = data["timeLimitInMinutes"];

    if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
      return null;
    }

    const source: AIRunTimeLimitSource = Object.values(
      AIRunTimeLimitSource,
    ).includes(data["timeLimitSource"] as AIRunTimeLimitSource)
      ? (data["timeLimitSource"] as AIRunTimeLimitSource)
      : AIRunTimeLimitSource.Default;

    const deadlineAt: string | null =
      typeof data["deadlineAt"] === "string" &&
      Number.isFinite(new Date(data["deadlineAt"]).getTime())
        ? data["deadlineAt"]
        : null;

    const timeLeft: unknown = data["timeLeftMs"];

    return {
      maxModelCalls: readCap(data["maxModelCalls"]),
      maxToolCalls: readCap(data["maxToolCalls"]),
      maxTokens: readCap(data["maxTokens"]),
      timeLimitInMinutes: Math.max(1, Math.round(minutes)),
      timeLimitSource: source,
      deadlineAt,
      timeLeftMs:
        typeof timeLeft === "number" && Number.isFinite(timeLeft)
          ? Math.max(0, timeLeft)
          : null,
      modelCallsUsed: readCount(data["modelCallsUsed"]),
      toolCallsUsed: readCount(data["toolCallsUsed"]),
      tokensUsed: readCount(data["tokensUsed"]),
      lastCallTokens: readCount(data["lastCallTokens"]),
    };
  }

  /*
   * The same limits as an agent loop's (Types/AI/AIAgentRunLimits): the
   * caps, and the time limit the sentences about it name. No limits - a
   * server from before #6440 - are the defaults.
   */
  public static toAgentRunLimits(
    limits: CodeAgentRunLimits | null,
  ): AIAgentRunLimits {
    if (!limits) {
      return AIAgentRunLimitsHelper.getDefault();
    }

    return {
      maxLlmCalls: limits.maxModelCalls ?? undefined,
      maxToolCalls: limits.maxToolCalls ?? undefined,
      maxTokens: limits.maxTokens ?? undefined,
      maxWallClockMs: limits.timeLimitInMinutes * MILLISECONDS_IN_A_MINUTE,
      timeLimitSource: limits.timeLimitSource,
    };
  }

  /*
   * When the run's time is up on the agent's own clock, from an answer it
   * received at `receivedAtMs`: the time the server said was left, so the
   * two clocks need not agree - or, from a server that did not say, its
   * deadline as written. Null when the server gave neither.
   */
  public static getLocalDeadlineAtMs(
    limits: CodeAgentRunLimits | null,
    receivedAtMs: number,
  ): number | null {
    if (!limits) {
      return null;
    }

    if (limits.timeLeftMs !== null) {
      return receivedAtMs + limits.timeLeftMs;
    }

    if (limits.deadlineAt) {
      const at: number = new Date(limits.deadlineAt).getTime();

      return Number.isFinite(at) ? at : null;
    }

    return null;
  }
}
