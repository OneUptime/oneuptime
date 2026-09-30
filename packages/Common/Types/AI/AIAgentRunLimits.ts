/*
 * How far an AI agent loop (an investigation, a conversation turn) may run
 * before it has to answer with what it has.
 *
 * By default nothing stops a run early: there is no wall clock, and the step
 * counts are a runaway guard sized far above what any real investigation
 * needs — they exist so a model stuck calling tools in a circle cannot spend
 * forever, not to ration a healthy run. A project that wants a hard time
 * limit sets one in its AI settings (per incident / alert lane); until then
 * the investigation keeps going until it is done.
 */

// LLM rounds one run may make before it is asked to answer.
export const AI_AGENT_RUNAWAY_MAX_LLM_CALLS: number = 100;

// Tool calls one run may make before it is asked to answer.
export const AI_AGENT_RUNAWAY_MAX_TOOL_CALLS: number = 300;

/*
 * Long command output is never cut before the model: it is shown a page at a
 * time (the server's ToolOutputPager). This is one page — roughly 10k
 * tokens, enough for a `kubectl describe node` of a busy node in one go.
 */
export const TOOL_OUTPUT_PAGE_CHARS: number = 40_000;

// Bounds for a project's optional investigation time limit.
export const MIN_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES: number = 1;
export const MAX_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES: number = 24 * 60;

export interface AIAgentRunLimits {
  // Undefined means the run has no time limit.
  maxWallClockMs: number | undefined;
  maxLlmCalls: number;
  maxToolCalls: number;
}

export default class AIAgentRunLimitsHelper {
  // No time limit and only the runaway guard on steps.
  public static getDefault(): AIAgentRunLimits {
    return {
      maxWallClockMs: undefined,
      maxLlmCalls: AI_AGENT_RUNAWAY_MAX_LLM_CALLS,
      maxToolCalls: AI_AGENT_RUNAWAY_MAX_TOOL_CALLS,
    };
  }

  /*
   * A project's configured time limit, as stored (minutes, nullable). Null,
   * undefined, zero, negative or non-numeric values all mean "no limit":
   * the setting is opt-in, so anything that is not a usable positive number
   * leaves the run unbounded rather than cutting it short. Positive values
   * are clamped into the supported range.
   */
  public static normalizeTimeLimitInMinutes(
    value: number | string | null | undefined,
  ): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    const minutes: number =
      typeof value === "number" ? value : Number.parseFloat(value);

    if (!Number.isFinite(minutes) || minutes <= 0) {
      return null;
    }

    return Math.min(
      MAX_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES,
      Math.max(MIN_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES, Math.round(minutes)),
    );
  }

  public static fromTimeLimitInMinutes(
    value: number | string | null | undefined,
  ): AIAgentRunLimits {
    const minutes: number | null = this.normalizeTimeLimitInMinutes(value);

    return {
      ...this.getDefault(),
      maxWallClockMs: minutes === null ? undefined : minutes * 60 * 1000,
    };
  }

  // When the run's time is up (epoch ms), or undefined for an unlimited run.
  public static getDeadlineAtMs(
    limits: Pick<AIAgentRunLimits, "maxWallClockMs">,
    startedAtMs: number,
  ): number | undefined {
    if (limits.maxWallClockMs === undefined) {
      return undefined;
    }

    return startedAtMs + limits.maxWallClockMs;
  }

  public static isTimeUp(data: {
    maxWallClockMs: number | undefined;
    startedAtMs: number;
    nowMs: number;
  }): boolean {
    if (data.maxWallClockMs === undefined) {
      return false;
    }

    return data.nowMs - data.startedAtMs >= data.maxWallClockMs;
  }

  /*
   * Whether a run must stop calling tools and answer now: out of LLM rounds
   * (one is always kept for the answer itself), out of tool calls, or out of
   * time.
   */
  public static isExhausted(data: {
    limits: AIAgentRunLimits;
    llmCallCount: number;
    toolCallCount: number;
    startedAtMs: number;
    nowMs: number;
  }): boolean {
    return (
      data.llmCallCount >= data.limits.maxLlmCalls - 1 ||
      data.toolCallCount >= data.limits.maxToolCalls ||
      this.isTimeUp({
        maxWallClockMs: data.limits.maxWallClockMs,
        startedAtMs: data.startedAtMs,
        nowMs: data.nowMs,
      })
    );
  }

  // A human-readable description for settings pages and run details.
  public static describeTimeLimit(
    value: number | string | null | undefined,
  ): string {
    const minutes: number | null = this.normalizeTimeLimitInMinutes(value);

    if (minutes === null) {
      return "No time limit — the investigation runs until it is done.";
    }

    return `Stops investigating after ${minutes} minute${
      minutes === 1 ? "" : "s"
    } and reports what it found.`;
  }
}
