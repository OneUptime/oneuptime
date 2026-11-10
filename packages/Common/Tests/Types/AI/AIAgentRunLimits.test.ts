import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIAgentRunUsage,
  AIRunStopDecision,
  AIRunStopReason,
  AIRunTimeLimitSource,
  AI_RUN_STOP_NOTE_OPENINGS,
  ALERT_AI_INVESTIGATION_LIMITS_LOCATION,
  CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES,
  DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES,
  INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION,
  MAX_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES,
  MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
  MIN_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES,
  MIN_AI_RUN_TIME_LIMIT_IN_MINUTES,
  PROJECT_AI_RUN_LIMITS_LOCATION,
  TOOL_OUTPUT_PAGE_CHARS,
} from "../../../Types/AI/AIAgentRunLimits";
import { describe, expect, test } from "@jest/globals";

/*
 * The run-limit rules every AI agent loop shares (issue #6440: "Why is there
 * a budget? Can we remove all of the artificial limits by default, customers
 * can add them if they need it"). The product promise these pin:
 *
 *   - by default a run has no cap on model calls, tool calls or tokens - the
 *     old 8/12, 40 and 100,000 are gone, and so is the "runaway guard";
 *   - every run has a time limit, generous by default (120 minutes), so
 *     none runs forever; a project or an investigation lane may set its own;
 *   - a cap a project sets is held exactly, with one model call kept for
 *     the answer where there can be one;
 *   - every sentence about a limit names the limit the run really has, and
 *     where it is changed - and none speaks of a budget.
 */

const MINUTE_MS: number = 60 * 1000;

function usage(overrides: Partial<AIAgentRunUsage>): AIAgentRunUsage {
  return {
    llmCallCount: 0,
    toolCallCount: 0,
    tokenCount: 0,
    lastCallTokenCount: 0,
    startedAtMs: 0,
    nowMs: 0,
    ...overrides,
  };
}

function limitsWith(overrides: Partial<AIAgentRunLimits>): AIAgentRunLimits {
  return { ...AIAgentRunLimitsHelper.getDefault(), ...overrides };
}

const EVERY_REASON: Array<AIRunStopReason> = [
  AIRunStopReason.TimeLimit,
  AIRunStopReason.ModelCalls,
  AIRunStopReason.ToolCalls,
  AIRunStopReason.Tokens,
  AIRunStopReason.Loop,
];

const EVERY_SOURCE: Array<AIRunTimeLimitSource> = [
  AIRunTimeLimitSource.Default,
  AIRunTimeLimitSource.Project,
  AIRunTimeLimitSource.IncidentInvestigation,
  AIRunTimeLimitSource.AlertInvestigation,
  AIRunTimeLimitSource.ChatApp,
];

const CAPPED: AIAgentRunLimits = limitsWith({
  maxLlmCalls: 25,
  maxToolCalls: 60,
  maxTokens: 500_000,
  maxWallClockMs: 30 * MINUTE_MS,
  timeLimitSource: AIRunTimeLimitSource.Project,
});

describe("the defaults", () => {
  test("a run has no cap on model calls, tool calls or tokens", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.getDefault();

    expect(limits.maxLlmCalls).toBeUndefined();
    expect(limits.maxToolCalls).toBeUndefined();
    expect(limits.maxTokens).toBeUndefined();
    expect(AIAgentRunLimitsHelper.hasCaps(limits)).toBe(false);
  });

  test("every run has a time limit: 120 minutes, the default", () => {
    expect(DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES).toBe(120);

    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.getDefault();

    expect(limits.maxWallClockMs).toBe(120 * MINUTE_MS);
    expect(limits.timeLimitSource).toBe(AIRunTimeLimitSource.Default);
  });

  test("the default time limit is far past what a real run takes", () => {
    /*
     * The code agent used to stop at 30 minutes, the bound of an
     * investigation was 60: the default must never be tighter than either.
     */
    expect(DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES).toBeGreaterThan(60);
  });

  test("the bounds of a time limit a project sets: 1 minute to a day", () => {
    expect(MIN_AI_RUN_TIME_LIMIT_IN_MINUTES).toBe(1);
    expect(MAX_AI_RUN_TIME_LIMIT_IN_MINUTES).toBe(24 * 60);
    // The lanes' settings share them.
    expect(MIN_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES).toBe(
      MIN_AI_RUN_TIME_LIMIT_IN_MINUTES,
    );
    expect(MAX_AI_INVESTIGATION_TIME_LIMIT_IN_MINUTES).toBe(
      MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
    );
    expect(DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES).toBeLessThanOrEqual(
      MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
    );
  });

  test("a chat answer's window is under Slack's 30 minutes for a reply", () => {
    expect(CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES).toBeLessThan(30);
    expect(CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES).toBeGreaterThanOrEqual(10);
  });

  test("returns a fresh object each time", () => {
    const first: AIAgentRunLimits = AIAgentRunLimitsHelper.getDefault();
    first.maxLlmCalls = 1;
    first.maxWallClockMs = 1;

    expect(AIAgentRunLimitsHelper.getDefault().maxLlmCalls).toBeUndefined();
    expect(AIAgentRunLimitsHelper.getDefault().maxWallClockMs).toBe(
      120 * MINUTE_MS,
    );
  });

  test("a default run is never stopped by its calls or tokens, however many", () => {
    expect(
      AIAgentRunLimitsHelper.getStopDecision(
        AIAgentRunLimitsHelper.getDefault(),
        usage({
          llmCallCount: 10_000,
          toolCallCount: 100_000,
          tokenCount: 1_000_000_000,
          lastCallTokenCount: 1_000_000,
          nowMs: 119 * MINUTE_MS,
        }),
      ),
    ).toBeNull();
  });

  test("the old fixed limits stop nothing: 8 and 40 model calls, 12 and 200 tool calls, 100,000 tokens", () => {
    for (const llmCallCount of [8, 9, 40, 41, 50, 200]) {
      for (const toolCallCount of [12, 13, 200, 201, 1000]) {
        expect(
          AIAgentRunLimitsHelper.getCapStopDecision(
            AIAgentRunLimitsHelper.getDefault(),
            {
              llmCallCount,
              toolCallCount,
              tokenCount: 100_001,
              lastCallTokenCount: 50_000,
            },
          ),
        ).toBeNull();
      }
    }
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
  ])("%p is not set", (value: unknown) => {
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
      MIN_AI_RUN_TIME_LIMIT_IN_MINUTES,
    );
  });

  test("clamps an absurdly long limit to a day", () => {
    expect(AIAgentRunLimitsHelper.normalizeTimeLimitInMinutes(1_000_000)).toBe(
      MAX_AI_RUN_TIME_LIMIT_IN_MINUTES,
    );
  });

  test("accepts a numeric string (form values arrive as strings)", () => {
    expect(AIAgentRunLimitsHelper.normalizeTimeLimitInMinutes("20")).toBe(20);
  });
});

describe("AIAgentRunLimitsHelper.normalizeCap", () => {
  test.each([
    [null],
    [undefined],
    [0],
    [-1],
    [0.5],
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [""],
    ["   "],
    ["abc"],
    ["0"],
    [true],
    [{}],
    [[]],
  ])("%p is no cap", (value: unknown) => {
    expect(AIAgentRunLimitsHelper.normalizeCap(value)).toBeUndefined();
  });

  test("a whole number of at least 1 is the cap", () => {
    expect(AIAgentRunLimitsHelper.normalizeCap(1)).toBe(1);
    expect(AIAgentRunLimitsHelper.normalizeCap(250)).toBe(250);
    expect(AIAgentRunLimitsHelper.normalizeCap(2_000_000_000)).toBe(
      2_000_000_000,
    );
  });

  test("a fraction is rounded down, never up past what was set", () => {
    expect(AIAgentRunLimitsHelper.normalizeCap(12.9)).toBe(12);
  });

  test("a numeric string, as Postgres hands a bigint back, is read", () => {
    expect(AIAgentRunLimitsHelper.normalizeCap("5000000")).toBe(5_000_000);
    expect(AIAgentRunLimitsHelper.normalizeCap(" 40 ")).toBe(40);
  });
});

describe("AIAgentRunLimitsHelper.fromSettings", () => {
  test("nothing set is the default: no caps, 120 minutes", () => {
    expect(AIAgentRunLimitsHelper.fromSettings({})).toEqual(
      AIAgentRunLimitsHelper.getDefault(),
    );
    expect(
      AIAgentRunLimitsHelper.fromSettings({
        maxModelCalls: null,
        maxToolCalls: null,
        maxTokens: null,
        timeLimitInMinutes: null,
      }),
    ).toEqual(AIAgentRunLimitsHelper.getDefault());
  });

  test("the project's caps are the run's", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.fromSettings({
      maxModelCalls: 25,
      maxToolCalls: 60,
      maxTokens: "500000",
    });

    expect(limits.maxLlmCalls).toBe(25);
    expect(limits.maxToolCalls).toBe(60);
    expect(limits.maxTokens).toBe(500_000);
    expect(AIAgentRunLimitsHelper.hasCaps(limits)).toBe(true);
    // Caps leave the time limit at the default.
    expect(limits.maxWallClockMs).toBe(120 * MINUTE_MS);
    expect(limits.timeLimitSource).toBe(AIRunTimeLimitSource.Default);
  });

  test("each cap is its own: one set leaves the others unset", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.fromSettings({
      maxToolCalls: 60,
    });

    expect(limits.maxLlmCalls).toBeUndefined();
    expect(limits.maxToolCalls).toBe(60);
    expect(limits.maxTokens).toBeUndefined();
  });

  test("the project's time limit replaces the default", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.fromSettings({
      timeLimitInMinutes: 45,
    });

    expect(limits.maxWallClockMs).toBe(45 * MINUTE_MS);
    expect(limits.timeLimitSource).toBe(AIRunTimeLimitSource.Project);
  });

  test("a project may set a time limit longer than the default", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.fromSettings({
      timeLimitInMinutes: 600,
    });

    expect(limits.maxWallClockMs).toBe(600 * MINUTE_MS);
  });

  test("a lane's time limit comes before the project's", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.fromSettings({
      timeLimitInMinutes: 45,
      maxModelCalls: 30,
      lane: {
        timeLimitInMinutes: 10,
        source: AIRunTimeLimitSource.IncidentInvestigation,
      },
    });

    expect(limits.maxWallClockMs).toBe(10 * MINUTE_MS);
    expect(limits.timeLimitSource).toBe(
      AIRunTimeLimitSource.IncidentInvestigation,
    );
    // The lane sets only the time: the project's caps hold.
    expect(limits.maxLlmCalls).toBe(30);
  });

  test("a lane with no time limit of its own uses the project's, then the default", () => {
    expect(
      AIAgentRunLimitsHelper.fromSettings({
        timeLimitInMinutes: 45,
        lane: {
          timeLimitInMinutes: null,
          source: AIRunTimeLimitSource.AlertInvestigation,
        },
      }),
    ).toMatchObject({
      maxWallClockMs: 45 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Project,
    });

    expect(
      AIAgentRunLimitsHelper.fromSettings({
        lane: {
          timeLimitInMinutes: 0,
          source: AIRunTimeLimitSource.AlertInvestigation,
        },
      }),
    ).toMatchObject({
      maxWallClockMs: 120 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Default,
    });
  });

  test("a value the server would never have stored stops nothing", () => {
    expect(
      AIAgentRunLimitsHelper.fromSettings({
        maxModelCalls: 0,
        maxToolCalls: -4,
        maxTokens: "lots",
        timeLimitInMinutes: "soon",
      }),
    ).toEqual(AIAgentRunLimitsHelper.getDefault());
  });
});

describe("AIAgentRunLimitsHelper.withTimeCeiling", () => {
  test("a longer time limit comes down to the ceiling, which says it set it", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.withTimeCeiling(
      AIAgentRunLimitsHelper.getDefault(),
      CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES,
      AIRunTimeLimitSource.ChatApp,
    );

    expect(limits.maxWallClockMs).toBe(
      CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES * MINUTE_MS,
    );
    expect(limits.timeLimitSource).toBe(AIRunTimeLimitSource.ChatApp);
  });

  test("a shorter time limit is kept, with what set it", () => {
    const shorter: AIAgentRunLimits = limitsWith({
      maxWallClockMs: 5 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Project,
    });

    expect(
      AIAgentRunLimitsHelper.withTimeCeiling(
        shorter,
        CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES,
        AIRunTimeLimitSource.ChatApp,
      ),
    ).toEqual(shorter);
  });

  test("the caps are kept as they are", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.withTimeCeiling(
      CAPPED,
      10,
      AIRunTimeLimitSource.ChatApp,
    );

    expect(limits.maxLlmCalls).toBe(25);
    expect(limits.maxToolCalls).toBe(60);
    expect(limits.maxTokens).toBe(500_000);
  });
});

describe("the time limit", () => {
  test("getTimeLimitInMinutes says it in whole minutes, at least one", () => {
    expect(
      AIAgentRunLimitsHelper.getTimeLimitInMinutes(
        AIAgentRunLimitsHelper.getDefault(),
      ),
    ).toBe(120);
    expect(
      AIAgentRunLimitsHelper.getTimeLimitInMinutes(
        limitsWith({ maxWallClockMs: 1_000 }),
      ),
    ).toBe(1);
  });

  test("the deadline is the limit after the run started", () => {
    expect(
      AIAgentRunLimitsHelper.getDeadlineAtMs(
        { maxWallClockMs: 10 * MINUTE_MS },
        5_000,
      ),
    ).toBe(5_000 + 10 * MINUTE_MS);
  });

  test("time is up exactly at the limit", () => {
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

describe("AIAgentRunLimitsHelper.getStopDecision", () => {
  test("a fresh run goes on", () => {
    expect(
      AIAgentRunLimitsHelper.getStopDecision(CAPPED, usage({})),
    ).toBeNull();
  });

  test("at its time limit a run makes one more call, for its answer", () => {
    expect(
      AIAgentRunLimitsHelper.getStopDecision(
        CAPPED,
        usage({ nowMs: 30 * MINUTE_MS - 1 }),
      ),
    ).toBeNull();
    expect(
      AIAgentRunLimitsHelper.getStopDecision(
        CAPPED,
        usage({ nowMs: 30 * MINUTE_MS }),
      ),
    ).toEqual({ reason: AIRunStopReason.TimeLimit, mayAnswer: true });
  });

  test("a default run is stopped by its 120 minutes and by nothing sooner", () => {
    const limits: AIAgentRunLimits = AIAgentRunLimitsHelper.getDefault();

    expect(
      AIAgentRunLimitsHelper.getStopDecision(
        limits,
        usage({ startedAtMs: 1_000, nowMs: 1_000 + 120 * MINUTE_MS - 1 }),
      ),
    ).toBeNull();
    expect(
      AIAgentRunLimitsHelper.getStopDecision(
        limits,
        usage({ startedAtMs: 1_000, nowMs: 1_000 + 120 * MINUTE_MS }),
      ),
    ).toEqual({ reason: AIRunStopReason.TimeLimit, mayAnswer: true });
  });

  test("the time limit comes first: it is what the stop note names", () => {
    expect(
      AIAgentRunLimitsHelper.getStopDecision(
        CAPPED,
        usage({ nowMs: 31 * MINUTE_MS, llmCallCount: 25, tokenCount: 9e9 }),
      ),
    ).toEqual({ reason: AIRunStopReason.TimeLimit, mayAnswer: true });
  });

  test("otherwise it is the caps' decision", () => {
    expect(
      AIAgentRunLimitsHelper.getStopDecision(
        CAPPED,
        usage({ llmCallCount: 24 }),
      ),
    ).toEqual(
      AIAgentRunLimitsHelper.getCapStopDecision(CAPPED, {
        llmCallCount: 24,
        toolCallCount: 0,
        tokenCount: 0,
        lastCallTokenCount: 0,
      }),
    );
  });
});

describe("AIAgentRunLimitsHelper.getCapStopDecision", () => {
  function decide(
    limits: AIAgentRunLimits,
    counts: Partial<
      Pick<
        AIAgentRunUsage,
        "llmCallCount" | "toolCallCount" | "tokenCount" | "lastCallTokenCount"
      >
    >,
  ): AIRunStopDecision | null {
    return AIAgentRunLimitsHelper.getCapStopDecision(limits, {
      llmCallCount: 0,
      toolCallCount: 0,
      tokenCount: 0,
      lastCallTokenCount: 0,
      ...counts,
    });
  }

  test("model calls: the last call the cap allows is the answer", () => {
    const limits: AIAgentRunLimits = limitsWith({ maxLlmCalls: 10 });

    expect(decide(limits, { llmCallCount: 8 })).toBeNull();
    expect(decide(limits, { llmCallCount: 9 })).toEqual({
      reason: AIRunStopReason.ModelCalls,
      mayAnswer: true,
    });
  });

  test("model calls: none left at all, the run stops without another", () => {
    const limits: AIAgentRunLimits = limitsWith({ maxLlmCalls: 10 });

    expect(decide(limits, { llmCallCount: 10 })).toEqual({
      reason: AIRunStopReason.ModelCalls,
      mayAnswer: false,
    });
    expect(decide(limits, { llmCallCount: 11 })).toEqual({
      reason: AIRunStopReason.ModelCalls,
      mayAnswer: false,
    });
  });

  test("a cap of one model call: that call is the answer", () => {
    expect(decide(limitsWith({ maxLlmCalls: 1 }), {})).toEqual({
      reason: AIRunStopReason.ModelCalls,
      mayAnswer: true,
    });
  });

  test("tokens: a run that has used its tokens stops where it is", () => {
    const limits: AIAgentRunLimits = limitsWith({ maxTokens: 100_000 });

    expect(decide(limits, { tokenCount: 100_000 })).toEqual({
      reason: AIRunStopReason.Tokens,
      mayAnswer: false,
    });
  });

  test("tokens: when the next call would reach the cap, it is the answer", () => {
    const limits: AIAgentRunLimits = limitsWith({ maxTokens: 100_000 });

    // The next call uses at least what the last one did.
    expect(
      decide(limits, { tokenCount: 70_000, lastCallTokenCount: 29_999 }),
    ).toBeNull();
    expect(
      decide(limits, { tokenCount: 70_000, lastCallTokenCount: 30_000 }),
    ).toEqual({ reason: AIRunStopReason.Tokens, mayAnswer: true });
  });

  test("tool calls: at the cap, one more model call, for the answer", () => {
    const limits: AIAgentRunLimits = limitsWith({ maxToolCalls: 60 });

    expect(decide(limits, { toolCallCount: 59 })).toBeNull();
    expect(decide(limits, { toolCallCount: 60 })).toEqual({
      reason: AIRunStopReason.ToolCalls,
      mayAnswer: true,
    });
  });

  test("a run past every cap is stopped by the model-call cap first", () => {
    expect(
      decide(CAPPED, {
        llmCallCount: 25,
        toolCallCount: 60,
        tokenCount: 500_000,
      }),
    ).toEqual({ reason: AIRunStopReason.ModelCalls, mayAnswer: false });
  });

  test("an unset cap is never reached", () => {
    expect(
      decide(limitsWith({ maxToolCalls: 5 }), {
        llmCallCount: 5_000,
        tokenCount: 1e12,
        lastCallTokenCount: 1e9,
        toolCallCount: 4,
      }),
    ).toBeNull();
  });
});

/*
 * A cut-off answer is finished with more model calls (MAX_ANSWER_CONTINUATIONS
 * of them at most), and a cap the project set holds for those too.
 */
describe("AIAgentRunLimitsHelper.getContinuationStopReason", () => {
  function reason(
    limits: AIAgentRunLimits,
    overrides: Partial<AIAgentRunUsage>,
  ): AIRunStopReason | null {
    return AIAgentRunLimitsHelper.getContinuationStopReason(
      limits,
      usage(overrides),
    );
  }

  test("a default run always finishes its answer", () => {
    expect(
      reason(AIAgentRunLimitsHelper.getDefault(), {
        llmCallCount: 100_000,
        toolCallCount: 100_000,
        tokenCount: 1e12,
        lastCallTokenCount: 1e9,
      }),
    ).toBeNull();
  });

  test("model calls: the last call the cap allows may still go on with the answer, none after it", () => {
    const limits: AIAgentRunLimits = limitsWith({ maxLlmCalls: 3 });

    expect(reason(limits, { llmCallCount: 1 })).toBeNull();
    // The next call is the last the cap allows: it may be made.
    expect(reason(limits, { llmCallCount: 2 })).toBeNull();
    expect(reason(limits, { llmCallCount: 3 })).toBe(
      AIRunStopReason.ModelCalls,
    );
    expect(reason(limits, { llmCallCount: 40 })).toBe(
      AIRunStopReason.ModelCalls,
    );
  });

  test("tokens: a call that may reach the cap is made, none once it is reached", () => {
    const limits: AIAgentRunLimits = limitsWith({ maxTokens: 1_000 });

    expect(
      reason(limits, { tokenCount: 400, lastCallTokenCount: 400 }),
    ).toBeNull();
    expect(
      reason(limits, { tokenCount: 800, lastCallTokenCount: 400 }),
    ).toBeNull();
    expect(reason(limits, { tokenCount: 1_000, lastCallTokenCount: 200 })).toBe(
      AIRunStopReason.Tokens,
    );
  });

  test("the tool-call cap leaves the answer its continuations: they call no tools", () => {
    expect(
      reason(limitsWith({ maxToolCalls: 2 }), { toolCallCount: 2 }),
    ).toBeNull();
    expect(
      reason(limitsWith({ maxToolCalls: 2 }), { toolCallCount: 50 }),
    ).toBeNull();
  });

  test("the time limit leaves the answer its continuations: it is no cap", () => {
    expect(
      AIAgentRunLimitsHelper.getContinuationStopReason(
        limitsWith({ maxWallClockMs: MINUTE_MS }),
        usage({ startedAtMs: 0, nowMs: 600 * MINUTE_MS }),
      ),
    ).toBeNull();
  });

  test("a run past both caps is stopped by the model-call cap first", () => {
    expect(
      reason(CAPPED, {
        llmCallCount: 25,
        tokenCount: 500_000,
      }),
    ).toBe(AIRunStopReason.ModelCalls);
  });
});

describe("AIAgentRunLimitsHelper.getToolCallRefusal", () => {
  test("a default run's batch may run any number of calls", () => {
    expect(
      AIAgentRunLimitsHelper.getToolCallRefusal(
        AIAgentRunLimitsHelper.getDefault(),
        { toolCallCount: 100_000, startedAtMs: 0, nowMs: 60 * MINUTE_MS },
      ),
    ).toBeNull();
  });

  test("a call past the tool-call cap is refused", () => {
    const limits: AIAgentRunLimits = limitsWith({ maxToolCalls: 3 });

    expect(
      AIAgentRunLimitsHelper.getToolCallRefusal(limits, {
        toolCallCount: 2,
        startedAtMs: 0,
        nowMs: 0,
      }),
    ).toBeNull();
    expect(
      AIAgentRunLimitsHelper.getToolCallRefusal(limits, {
        toolCallCount: 3,
        startedAtMs: 0,
        nowMs: 0,
      }),
    ).toBe(AIRunStopReason.ToolCalls);
  });

  test("a call once the time is up is refused, before the tool-call cap", () => {
    expect(
      AIAgentRunLimitsHelper.getToolCallRefusal(CAPPED, {
        toolCallCount: 60,
        startedAtMs: 0,
        nowMs: 30 * MINUTE_MS,
      }),
    ).toBe(AIRunStopReason.TimeLimit);
  });
});

describe("the sentences", () => {
  test("the wrap-up names the limit reached, then asks for the answer", () => {
    expect(
      AIAgentRunLimitsHelper.getWrapUpInstruction(
        AIRunStopReason.TimeLimit,
        CAPPED,
      ),
    ).toBe(
      "This run has reached its time limit of 30 minutes. Answer now with the findings so far, clearly stating what you could and could not verify and what you would check next. Do not request more tools.",
    );
    expect(
      AIAgentRunLimitsHelper.getWrapUpInstruction(
        AIRunStopReason.ModelCalls,
        CAPPED,
      ),
    ).toMatch(
      /^This is the last model call this run may make: the project allows 25 model calls per run\. Answer now/,
    );
    expect(
      AIAgentRunLimitsHelper.getWrapUpInstruction(
        AIRunStopReason.ToolCalls,
        CAPPED,
      ),
    ).toMatch(
      /^This run has made 60 tool calls, the most the project allows per run\. Answer now/,
    );
    expect(
      AIAgentRunLimitsHelper.getWrapUpInstruction(
        AIRunStopReason.Tokens,
        CAPPED,
      ),
    ).toMatch(
      /^This run is about to reach the project's limit of 500,000 tokens per run\. Answer now/,
    );
    expect(
      AIAgentRunLimitsHelper.getWrapUpInstruction(AIRunStopReason.Loop, CAPPED),
    ).toMatch(
      /^Your recent tool calls keep returning what you have already seen, so this run is going in circles\. Answer now/,
    );
  });

  test("singular counts read as one", () => {
    const one: AIAgentRunLimits = limitsWith({
      maxLlmCalls: 1,
      maxToolCalls: 1,
      maxWallClockMs: MINUTE_MS,
    });

    expect(
      AIAgentRunLimitsHelper.getLimitReachedSentence(
        AIRunStopReason.TimeLimit,
        one,
      ),
    ).toBe("This run has reached its time limit of 1 minute.");
    expect(
      AIAgentRunLimitsHelper.getLimitReachedSentence(
        AIRunStopReason.ModelCalls,
        one,
      ),
    ).toContain("allows 1 model call per run");
    expect(
      AIAgentRunLimitsHelper.getLimitReachedSentence(
        AIRunStopReason.ToolCalls,
        one,
      ),
    ).toContain("has made 1 tool call,");
  });

  test("a refusal says which limit and where it is changed", () => {
    expect(
      AIAgentRunLimitsHelper.getRefusal(AIRunStopReason.ModelCalls, CAPPED),
    ).toBe(
      `This run has made 25 model calls, this project's limit per run, so it may make no more. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}.`,
    );
    expect(
      AIAgentRunLimitsHelper.getRefusal(AIRunStopReason.ToolCalls, CAPPED),
    ).toBe(
      `This run has made 60 tool calls, this project's limit per run, so it may make no more. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}.`,
    );
    expect(
      AIAgentRunLimitsHelper.getRefusal(AIRunStopReason.Tokens, CAPPED),
    ).toBe(
      `This run has used this project's limit of 500,000 tokens per run, so it may make no more calls. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}.`,
    );
    expect(
      AIAgentRunLimitsHelper.getRefusal(AIRunStopReason.TimeLimit, CAPPED),
    ).toBe(
      `This run has reached its time limit of 30 minutes, so it may make no more calls. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}.`,
    );
  });

  test("loop detection is not a setting: its refusal names none", () => {
    expect(
      AIAgentRunLimitsHelper.getRefusal(AIRunStopReason.Loop, CAPPED),
    ).toBe(
      "This run kept repeating calls that showed it nothing new, so it was stopped.",
    );
  });

  test("a skipped tool call says why, and to answer with what the run has", () => {
    for (const reason of EVERY_REASON) {
      const text: string = AIAgentRunLimitsHelper.getSkippedToolCallText(
        reason,
        CAPPED,
      );

      expect(text).toMatch(/^Skipped: /);
      expect(text).toMatch(/Answer with the data you already have\.$/);
    }

    expect(
      AIAgentRunLimitsHelper.getSkippedToolCallText(
        AIRunStopReason.ToolCalls,
        CAPPED,
      ),
    ).toContain("60 tool calls, the most the project allows per run");
    expect(
      AIAgentRunLimitsHelper.getSkippedToolCallText(
        AIRunStopReason.TimeLimit,
        CAPPED,
      ),
    ).toContain("time limit of 30 minutes");
  });

  test("no sentence, for any limit or source, speaks of a budget", () => {
    for (const reason of EVERY_REASON) {
      for (const source of EVERY_SOURCE) {
        const limits: AIAgentRunLimits = { ...CAPPED, timeLimitSource: source };
        const texts: Array<string> = [
          AIAgentRunLimitsHelper.getWrapUpInstruction(reason, limits),
          AIAgentRunLimitsHelper.getLimitReachedSentence(reason, limits),
          AIAgentRunLimitsHelper.getRefusal(reason, limits),
          AIAgentRunLimitsHelper.getSkippedToolCallText(reason, limits),
          AIAgentRunLimitsHelper.getStopNote({ reason, limits }),
          AIAgentRunLimitsHelper.getStopNote({
            reason,
            limits,
            settingsUrl: "https://oneuptime.example.com/dashboard/p/settings",
          }),
        ];

        for (const text of texts) {
          expect(text).not.toMatch(/budget/i);
          expect(text).not.toMatch(/undefined|NaN|null/);
        }
      }
    }

    expect(AIAgentRunLimitsHelper.describeTimeLimit(null)).not.toMatch(
      /budget/i,
    );
  });
});

describe("AIAgentRunLimitsHelper.getSettingLocation", () => {
  test("a cap is changed on the project's Limits per run", () => {
    for (const reason of [
      AIRunStopReason.ModelCalls,
      AIRunStopReason.ToolCalls,
      AIRunStopReason.Tokens,
    ]) {
      expect(AIAgentRunLimitsHelper.getSettingLocation(reason, CAPPED)).toBe(
        PROJECT_AI_RUN_LIMITS_LOCATION,
      );
    }

    expect(PROJECT_AI_RUN_LIMITS_LOCATION).toBe(
      "Project Settings → AI → AI Features → More settings → Limits per run",
    );
  });

  test("a time limit is changed where it was set", () => {
    expect(
      AIAgentRunLimitsHelper.getSettingLocation(
        AIRunStopReason.TimeLimit,
        limitsWith({ timeLimitSource: AIRunTimeLimitSource.Default }),
      ),
    ).toBe(PROJECT_AI_RUN_LIMITS_LOCATION);
    expect(
      AIAgentRunLimitsHelper.getSettingLocation(
        AIRunStopReason.TimeLimit,
        limitsWith({ timeLimitSource: AIRunTimeLimitSource.Project }),
      ),
    ).toBe(PROJECT_AI_RUN_LIMITS_LOCATION);
    expect(
      AIAgentRunLimitsHelper.getSettingLocation(
        AIRunStopReason.TimeLimit,
        limitsWith({
          timeLimitSource: AIRunTimeLimitSource.IncidentInvestigation,
        }),
      ),
    ).toBe(INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION);
    expect(
      AIAgentRunLimitsHelper.getSettingLocation(
        AIRunStopReason.TimeLimit,
        limitsWith({
          timeLimitSource: AIRunTimeLimitSource.AlertInvestigation,
        }),
      ),
    ).toBe(ALERT_AI_INVESTIGATION_LIMITS_LOCATION);
  });

  test("a chat app's answer window and loop detection are no setting", () => {
    expect(
      AIAgentRunLimitsHelper.getSettingLocation(
        AIRunStopReason.TimeLimit,
        limitsWith({ timeLimitSource: AIRunTimeLimitSource.ChatApp }),
      ),
    ).toBeNull();
    expect(
      AIAgentRunLimitsHelper.getSettingLocation(AIRunStopReason.Loop, CAPPED),
    ).toBeNull();
  });
});

describe("AIAgentRunLimitsHelper.getStopNote", () => {
  test("each cap's note names the limit and where it is changed", () => {
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.ModelCalls,
        limits: CAPPED,
      }),
    ).toBe(
      `_This run stopped at this project's limit of 25 model calls per run. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}._`,
    );
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.ToolCalls,
        limits: CAPPED,
      }),
    ).toBe(
      `_This run stopped at this project's limit of 60 tool calls per run. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}._`,
    );
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.Tokens,
        limits: CAPPED,
      }),
    ).toBe(
      `_This run stopped at this project's limit of 500,000 tokens per run. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}._`,
    );
  });

  test("the time limit's note says which time limit it was", () => {
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.TimeLimit,
        limits: AIAgentRunLimitsHelper.getDefault(),
      }),
    ).toBe(
      `_This run stopped at the default time limit of 120 minutes per run. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}._`,
    );
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.TimeLimit,
        limits: CAPPED,
      }),
    ).toBe(
      `_This run stopped at this project's time limit of 30 minutes per run. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}._`,
    );
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.TimeLimit,
        limits: limitsWith({
          maxWallClockMs: 15 * MINUTE_MS,
          timeLimitSource: AIRunTimeLimitSource.IncidentInvestigation,
        }),
      }),
    ).toBe(
      `_This investigation stopped at the incident investigation time limit of 15 minutes. Change it in ${INCIDENT_AI_INVESTIGATION_LIMITS_LOCATION}._`,
    );
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.TimeLimit,
        limits: limitsWith({
          maxWallClockMs: 15 * MINUTE_MS,
          timeLimitSource: AIRunTimeLimitSource.AlertInvestigation,
        }),
      }),
    ).toBe(
      `_This investigation stopped at the alert investigation time limit of 15 minutes. Change it in ${ALERT_AI_INVESTIGATION_LIMITS_LOCATION}._`,
    );
  });

  test("a chat answer's note says where a longer answer can be had, and names no setting", () => {
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.TimeLimit,
        limits: limitsWith({
          maxWallClockMs: CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES * MINUTE_MS,
          timeLimitSource: AIRunTimeLimitSource.ChatApp,
        }),
        settingsUrl: "https://oneuptime.example.com/dashboard/p/settings",
      }),
    ).toBe(
      `_This answer stopped after ${CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES} minutes, the longest a chat answer may take. Ask AI in the Dashboard can take longer._`,
    );
  });

  test("loop detection's note says why, with no setting to change", () => {
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.Loop,
        limits: CAPPED,
        settingsUrl: "https://oneuptime.example.com/dashboard/p/settings",
      }),
    ).toBe(
      "_This run stopped early: it kept repeating calls that showed it nothing new._",
    );
  });

  test("with the setting's address, the place is a link", () => {
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.ToolCalls,
        limits: CAPPED,
        settingsUrl:
          "https://oneuptime.example.com/dashboard/p1/settings/ai-features#LimitsPerRun",
      }),
    ).toBe(
      `_This run stopped at this project's limit of 60 tool calls per run. Change it in [${PROJECT_AI_RUN_LIMITS_LOCATION}](https://oneuptime.example.com/dashboard/p1/settings/ai-features#LimitsPerRun)._`,
    );
  });

  test("an empty address is no link", () => {
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.ToolCalls,
        limits: CAPPED,
        settingsUrl: "",
      }),
    ).not.toContain("](");
  });

  test("large counts are written with separators", () => {
    expect(
      AIAgentRunLimitsHelper.getStopNote({
        reason: AIRunStopReason.Tokens,
        limits: limitsWith({ maxTokens: 12_500_000 }),
      }),
    ).toContain("12,500,000 tokens");
  });
});

/*
 * Every way a run can stop, each with the limits that name it: the notes
 * below are checked against all of them, so a new reason or source has a
 * case here or fails the count.
 */
const EVERY_STOP: Array<{
  name: string;
  reason: AIRunStopReason;
  limits: AIAgentRunLimits;
}> = [
  { name: "model calls", reason: AIRunStopReason.ModelCalls, limits: CAPPED },
  { name: "tool calls", reason: AIRunStopReason.ToolCalls, limits: CAPPED },
  { name: "tokens", reason: AIRunStopReason.Tokens, limits: CAPPED },
  { name: "loop", reason: AIRunStopReason.Loop, limits: CAPPED },
  {
    name: "the default time limit",
    reason: AIRunStopReason.TimeLimit,
    limits: limitsWith({ timeLimitSource: AIRunTimeLimitSource.Default }),
  },
  {
    name: "the project's time limit",
    reason: AIRunStopReason.TimeLimit,
    limits: CAPPED,
  },
  {
    name: "an incident investigation's time limit",
    reason: AIRunStopReason.TimeLimit,
    limits: limitsWith({
      maxWallClockMs: 20 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.IncidentInvestigation,
    }),
  },
  {
    name: "an alert investigation's time limit",
    reason: AIRunStopReason.TimeLimit,
    limits: limitsWith({
      maxWallClockMs: 20 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.AlertInvestigation,
    }),
  },
  {
    name: "a chat answer's window",
    reason: AIRunStopReason.TimeLimit,
    limits: limitsWith({
      maxWallClockMs: CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.ChatApp,
    }),
  },
];

describe("every stop is covered", () => {
  test("one case per reason, and one per time limit source", () => {
    const reasons: Set<string> = new Set(
      EVERY_STOP.map((stop: { reason: AIRunStopReason }): string => {
        return stop.reason;
      }),
    );
    const sources: Set<string> = new Set(
      EVERY_STOP.filter((stop: { reason: AIRunStopReason }): boolean => {
        return stop.reason === AIRunStopReason.TimeLimit;
      }).map((stop: { limits: AIAgentRunLimits }): string => {
        return stop.limits.timeLimitSource;
      }),
    );

    expect([...reasons].sort()).toEqual(Object.values(AIRunStopReason).sort());
    expect([...sources].sort()).toEqual(
      Object.values(AIRunTimeLimitSource).sort(),
    );
  });
});

/*
 * The openings the investigation report's reader knows a stop note by
 * (Common/Utils/AI/InvestigationReport.ts): every note opens with one, so
 * the AI card can draw it apart from the analysis above it.
 */
describe("AI_RUN_STOP_NOTE_OPENINGS", () => {
  test.each(EVERY_STOP)(
    "the note of a run stopped by $name opens with one",
    (stop: { reason: AIRunStopReason; limits: AIAgentRunLimits }) => {
      const sentence: string = AIAgentRunLimitsHelper.getStopSentence(
        stop.reason,
        stop.limits,
      );

      expect(
        AI_RUN_STOP_NOTE_OPENINGS.some((opening: string): boolean => {
          return sentence.startsWith(opening);
        }),
      ).toBe(true);
      expect(
        AIAgentRunLimitsHelper.getStopNote({
          reason: stop.reason,
          limits: stop.limits,
          settingsUrl: "https://oneuptime.example.com/dashboard/p1/x#y",
        }).startsWith(`_${sentence}`),
      ).toBe(true);
    },
  );

  test("each opening is what stopped, then 'stopped' and a space", () => {
    expect(AI_RUN_STOP_NOTE_OPENINGS.length).toBeGreaterThan(0);

    for (const opening of AI_RUN_STOP_NOTE_OPENINGS) {
      expect(opening).toMatch(/^This [a-z]+ stopped $/);
    }
  });
});

/*
 * The note as text, for a line of the run's activity, which the Dashboard
 * draws as text: written there as Markdown, it read "_This run stopped ...
 * Change it in [Project Settings → ...](https://...)._".
 */
describe("AIAgentRunLimitsHelper.getStopNoteText", () => {
  test.each(EVERY_STOP)(
    "a run stopped by $name: the note's words, without its marks or link",
    (stop: { reason: AIRunStopReason; limits: AIAgentRunLimits }) => {
      const text: string = AIAgentRunLimitsHelper.getStopNoteText({
        reason: stop.reason,
        limits: stop.limits,
      });
      const unlinked: string = AIAgentRunLimitsHelper.getStopNote({
        reason: stop.reason,
        limits: stop.limits,
      });

      // The Markdown note with no address is the text in italics.
      expect(unlinked).toBe(`_${text}_`);
      expect(text).not.toMatch(/^_|_$/);
      expect(text).not.toContain("](");
      expect(text).not.toContain("http");
      expect(text).toMatch(/\.$/);
    },
  );

  test("a cap names the setting's place in words", () => {
    expect(
      AIAgentRunLimitsHelper.getStopNoteText({
        reason: AIRunStopReason.Tokens,
        limits: limitsWith({ maxTokens: 12_500_000 }),
      }),
    ).toBe(
      `This run stopped at this project's limit of 12,500,000 tokens per run. Change it in ${PROJECT_AI_RUN_LIMITS_LOCATION}.`,
    );
  });

  test("an investigation's time limit names its lane's settings", () => {
    expect(
      AIAgentRunLimitsHelper.getStopNoteText({
        reason: AIRunStopReason.TimeLimit,
        limits: limitsWith({
          maxWallClockMs: MINUTE_MS,
          timeLimitSource: AIRunTimeLimitSource.AlertInvestigation,
        }),
      }),
    ).toBe(
      `This investigation stopped at the alert investigation time limit of 1 minute. Change it in ${ALERT_AI_INVESTIGATION_LIMITS_LOCATION}.`,
    );
  });

  test("loop detection and a chat answer's window name no place: they are no setting", () => {
    expect(
      AIAgentRunLimitsHelper.getStopNoteText({
        reason: AIRunStopReason.Loop,
        limits: CAPPED,
      }),
    ).toBe(
      "This run stopped early: it kept repeating calls that showed it nothing new.",
    );
    expect(
      AIAgentRunLimitsHelper.getStopNoteText({
        reason: AIRunStopReason.TimeLimit,
        limits: limitsWith({
          maxWallClockMs: CHAT_APP_ANSWER_TIME_LIMIT_IN_MINUTES * MINUTE_MS,
          timeLimitSource: AIRunTimeLimitSource.ChatApp,
        }),
      }),
    ).not.toContain("Change it in");
  });
});

describe("AIAgentRunLimitsHelper.describeTimeLimit", () => {
  test("an unset lane limit uses the project's, which is 120 minutes unless set", () => {
    expect(AIAgentRunLimitsHelper.describeTimeLimit(null)).toBe(
      "Uses the project's time limit per run: 120 minutes unless the project set its own.",
    );
    // No more promise of a run without any time limit.
    expect(AIAgentRunLimitsHelper.describeTimeLimit(undefined)).not.toMatch(
      /no time limit|until it is done/i,
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
