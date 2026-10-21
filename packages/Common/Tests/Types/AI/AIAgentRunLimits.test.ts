import AIAgentRunLimitsHelper, {
  AI_AGENT_RUNAWAY_MAX_LLM_CALLS,
  AI_AGENT_RUNAWAY_MAX_TOOL_CALLS,
  AIAgentRunLimits,
  MAX_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES,
  MIN_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES,
  TOOL_OUTPUT_PAGE_CHARS,
} from "../../../Types/AI/AIAgentRunLimits";
import { describe, expect, test } from "@jest/globals";

/*
 * The run-limit rules every AI agent loop shares. The product promise these
 * pin: by default nothing stops an investigation early — no wall clock, and
 * step counts only a runaway loop could reach — and a project's time limit
 * is strictly opt-in, so anything that is not a usable positive number
 * leaves the run unbounded rather than cutting it short.
 */

const MINUTE_MS: number = 60 * 1000;

describe("AIAgentRunLimitsHelper.getDefault", () => {
  test("has no time limit", () => {
    expect(AIAgentRunLimitsHelper.getDefault().maxWallClockMs).toBeUndefined();
  });

  test("uses the runaway guard for steps", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.getDefault();

    expect(limits.maxLlmCalls).toBe(AI_AGENT_RUNAWAY_MAX_LLM_CALLS);
    expect(limits.maxToolCalls).toBe(AI_AGENT_RUNAWAY_MAX_TOOL_CALLS);
  });

  test("the runaway guard is far above what a real investigation needs", () => {
    /*
     * The old per-run budget was 8 LLM calls and 12 tool calls — the limit
     * that cut real investigations short. The guard must never be that.
     */
    expect(AI_AGENT_RUNAWAY_MAX_LLM_CALLS).toBeGreaterThanOrEqual(50);
    expect(AI_AGENT_RUNAWAY_MAX_TOOL_CALLS).toBeGreaterThanOrEqual(100);
  });

  test("returns a fresh object each time", () => {
    const first: AIAgentRunLimits = AIAgentRunLimitsHelper.getDefault();
    first.maxLlmCalls = 1;

    expect(AIAgentRunLimitsHelper.getDefault().maxLlmCalls).toBe(
      AI_AGENT_RUNAWAY_MAX_LLM_CALLS,
    );
  });
});

describe("AIAgentRunLimitsHelper.normalizeTimeLimitInMinutes", () => {
  test.each([
    [null],
    [undefined],
    [0],
    [-5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [""],
    ["abc"],
    ["0"],
    ["-3"],
  ])("%p means no limit", (value: unknown) => {
    expect(
      AIAgentRunLimitsHelper.normalizeTimeLimitInMinutes(
        value as number | string | null | undefined,
      ),
    ).toBeNull();
  });

  test("keeps a whole number of minutes", () => {
    expect(AIAgentRunLimitsHelper.normalizeTimeLimitInMinutes(15)).toBe(15);
  });

  test("rounds fractional minutes", () => {
    expect(AIAgentRunLimitsHelper.normalizeTimeLimitInMinutes(2.4)).toBe(2);
    expect(AIAgentRunLimitsHelper.normalizeTimeLimitInMinutes(2.6)).toBe(3);
  });

  test("never rounds a positive value down to nothing", () => {
    expect(AIAgentRunLimitsHelper.normalizeTimeLimitInMinutes(0.2)).toBe(
      MIN_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES,
    );
  });

  test("clamps an absurdly long limit", () => {
    expect(AIAgentRunLimitsHelper.normalizeTimeLimitInMinutes(1_000_000)).toBe(
      MAX_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES,
    );
  });

  test("accepts a numeric string (form values arrive as strings)", () => {
    expect(AIAgentRunLimitsHelper.normalizeTimeLimitInMinutes("20")).toBe(20);
  });
});

describe("AIAgentRunLimitsHelper.fromTimeLimitInMinutes", () => {
  test("unset is the default: no time limit", () => {
    expect(AIAgentRunLimitsHelper.fromTimeLimitInMinutes(null)).toEqual(
      AIAgentRunLimitsHelper.getDefault(),
    );
    expect(AIAgentRunLimitsHelper.fromTimeLimitInMinutes(undefined)).toEqual(
      AIAgentRunLimitsHelper.getDefault(),
    );
  });

  test("a configured limit becomes the wall clock, in milliseconds", () => {
    expect(
      AIAgentRunLimitsHelper.fromTimeLimitInMinutes(15).maxWallClockMs,
    ).toBe(15 * MINUTE_MS);
  });

  test("a time limit never tightens the step guard", () => {
    const limits: AIAgentRunLimits =
      AIAgentRunLimitsHelper.fromTimeLimitInMinutes(5);

    expect(limits.maxLlmCalls).toBe(AI_AGENT_RUNAWAY_MAX_LLM_CALLS);
    expect(limits.maxToolCalls).toBe(AI_AGENT_RUNAWAY_MAX_TOOL_CALLS);
  });
});

describe("AIAgentRunLimitsHelper.getDeadlineAtMs", () => {
  test("an unlimited run has no deadline", () => {
    expect(
      AIAgentRunLimitsHelper.getDeadlineAtMs(
        AIAgentRunLimitsHelper.getDefault(),
        1_000,
      ),
    ).toBeUndefined();
  });

  test("a limited run ends its limit after it started", () => {
    expect(
      AIAgentRunLimitsHelper.getDeadlineAtMs(
        { maxWallClockMs: 10 * MINUTE_MS },
        5_000,
      ),
    ).toBe(5_000 + 10 * MINUTE_MS);
  });
});

describe("AIAgentRunLimitsHelper.isTimeUp", () => {
  test("an unlimited run is never out of time", () => {
    expect(
      AIAgentRunLimitsHelper.isTimeUp({
        maxWallClockMs: undefined,
        startedAtMs: 0,
        nowMs: 365 * 24 * 60 * MINUTE_MS,
      }),
    ).toBe(false);
  });

  test("a limited run is out of time exactly at its limit", () => {
    expect(
      AIAgentRunLimitsHelper.isTimeUp({
        maxWallClockMs: 1_000,
        startedAtMs: 0,
        nowMs: 999,
      }),
    ).toBe(false);
    expect(
      AIAgentRunLimitsHelper.isTimeUp({
        maxWallClockMs: 1_000,
        startedAtMs: 0,
        nowMs: 1_000,
      }),
    ).toBe(true);
  });
});

describe("AIAgentRunLimitsHelper.isExhausted", () => {
  const base: {
    limits: AIAgentRunLimits;
    llmCallCount: number;
    toolCallCount: number;
    startedAtMs: number;
    nowMs: number;
  } = {
    limits: { maxWallClockMs: undefined, maxLlmCalls: 10, maxToolCalls: 20 },
    llmCallCount: 0,
    toolCallCount: 0,
    startedAtMs: 0,
    nowMs: 0,
  };

  test("a fresh run is not exhausted", () => {
    expect(AIAgentRunLimitsHelper.isExhausted(base)).toBe(false);
  });

  test("keeps one LLM round for the answer itself", () => {
    expect(
      AIAgentRunLimitsHelper.isExhausted({ ...base, llmCallCount: 8 }),
    ).toBe(false);
    expect(
      AIAgentRunLimitsHelper.isExhausted({ ...base, llmCallCount: 9 }),
    ).toBe(true);
  });

  test("stops at the tool-call guard", () => {
    expect(
      AIAgentRunLimitsHelper.isExhausted({ ...base, toolCallCount: 19 }),
    ).toBe(false);
    expect(
      AIAgentRunLimitsHelper.isExhausted({ ...base, toolCallCount: 20 }),
    ).toBe(true);
  });

  test("an unlimited run is never exhausted by time", () => {
    expect(
      AIAgentRunLimitsHelper.isExhausted({
        ...base,
        nowMs: 30 * 24 * 60 * MINUTE_MS,
      }),
    ).toBe(false);
  });

  test("a limited run is exhausted by time", () => {
    expect(
      AIAgentRunLimitsHelper.isExhausted({
        ...base,
        limits: { ...base.limits, maxWallClockMs: MINUTE_MS },
        nowMs: MINUTE_MS,
      }),
    ).toBe(true);
  });
});

describe("AIAgentRunLimitsHelper.describeTimeLimit", () => {
  test("says plainly that an unset limit means none", () => {
    expect(AIAgentRunLimitsHelper.describeTimeLimit(null)).toBe(
      "No time limit — the investigation runs until it is done.",
    );
  });

  test("describes a configured limit, singular and plural", () => {
    expect(AIAgentRunLimitsHelper.describeTimeLimit(1)).toBe(
      "Stops investigating after 1 minute and reports what it found.",
    );
    expect(AIAgentRunLimitsHelper.describeTimeLimit(15)).toBe(
      "Stops investigating after 15 minutes and reports what it found.",
    );
  });
});

describe("TOOL_OUTPUT_PAGE_CHARS", () => {
  test("fits a busy node's kubectl describe in one page", () => {
    /*
     * The reported regression: an 8,000-character cap cut `kubectl describe
     * node` before its Capacity/Allocatable and conditions sections. A busy
     * node's describe is ~15–25k characters.
     */
    expect(TOOL_OUTPUT_PAGE_CHARS).toBeGreaterThanOrEqual(30_000);
  });
});
