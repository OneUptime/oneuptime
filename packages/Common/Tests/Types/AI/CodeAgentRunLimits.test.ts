import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunTimeLimitSource,
} from "../../../Types/AI/AIAgentRunLimits";
import CodeAgentRunLimitsUtil, {
  CodeAgentRunLimits,
} from "../../../Types/AI/CodeAgentRunLimits";
import { describe, expect, test } from "@jest/globals";

/*
 * The limits of a code task's run as the server tells the Runner's code
 * agent (issue #6440). The server builds them with each completion it
 * serves; the Runner reads them back from JSON - from a server that may be
 * newer or older than it - and keeps its clock to the time left, so a Runner
 * whose clock is off still winds down on time.
 */

const MINUTE_MS: number = 60 * 1000;
const STARTED_AT: Date = new Date("2026-11-09T10:00:00.000Z");

function limitsWith(overrides: Partial<AIAgentRunLimits>): AIAgentRunLimits {
  return { ...AIAgentRunLimitsHelper.getDefault(), ...overrides };
}

describe("CodeAgentRunLimitsUtil.build", () => {
  test("a project with nothing set: no caps, the default 120 minutes from the claim", () => {
    const limits: CodeAgentRunLimits = CodeAgentRunLimitsUtil.build({
      limits: AIAgentRunLimitsHelper.getDefault(),
      startedAt: STARTED_AT,
      modelCallsUsed: 3,
      toolCallsUsed: 1,
      tokensUsed: 12_000,
      lastCallTokens: 5_000,
      nowMs: STARTED_AT.getTime() + 10 * MINUTE_MS,
    });

    expect(limits).toEqual({
      maxModelCalls: null,
      maxToolCalls: null,
      maxTokens: null,
      timeLimitInMinutes: 120,
      timeLimitSource: AIRunTimeLimitSource.Default,
      deadlineAt: "2026-11-09T12:00:00.000Z",
      timeLeftMs: 110 * MINUTE_MS,
      modelCallsUsed: 3,
      toolCallsUsed: 1,
      tokensUsed: 12_000,
      lastCallTokens: 5_000,
    });
  });

  test("the project's caps and time limit", () => {
    const limits: CodeAgentRunLimits = CodeAgentRunLimitsUtil.build({
      limits: limitsWith({
        maxLlmCalls: 50,
        maxToolCalls: 200,
        maxTokens: 2_000_000,
        maxWallClockMs: 45 * MINUTE_MS,
        timeLimitSource: AIRunTimeLimitSource.Project,
      }),
      startedAt: STARTED_AT,
      modelCallsUsed: 0,
      toolCallsUsed: 0,
      tokensUsed: 0,
      nowMs: STARTED_AT.getTime(),
    });

    expect(limits.maxModelCalls).toBe(50);
    expect(limits.maxToolCalls).toBe(200);
    expect(limits.maxTokens).toBe(2_000_000);
    expect(limits.timeLimitInMinutes).toBe(45);
    expect(limits.timeLimitSource).toBe(AIRunTimeLimitSource.Project);
    expect(limits.deadlineAt).toBe("2026-11-09T10:45:00.000Z");
    expect(limits.timeLeftMs).toBe(45 * MINUTE_MS);
    // An answer that is not a model call's has no last call.
    expect(limits.lastCallTokens).toBe(0);
  });

  test("time left never goes below nothing", () => {
    expect(
      CodeAgentRunLimitsUtil.build({
        limits: AIAgentRunLimitsHelper.getDefault(),
        startedAt: STARTED_AT,
        modelCallsUsed: 0,
        toolCallsUsed: 0,
        tokensUsed: 0,
        nowMs: STARTED_AT.getTime() + 500 * MINUTE_MS,
      }).timeLeftMs,
    ).toBe(0);
  });

  test("a run whose claim is not recorded has no deadline to give", () => {
    for (const startedAt of [null, undefined, new Date("not a date")]) {
      const limits: CodeAgentRunLimits = CodeAgentRunLimitsUtil.build({
        limits: AIAgentRunLimitsHelper.getDefault(),
        startedAt,
        modelCallsUsed: 0,
        toolCallsUsed: 0,
        tokensUsed: 0,
      });

      expect(limits.deadlineAt).toBeNull();
      expect(limits.timeLeftMs).toBeNull();
      // The time limit itself is still said.
      expect(limits.timeLimitInMinutes).toBe(120);
    }
  });

  test("a claim time read back as text is a time", () => {
    expect(
      CodeAgentRunLimitsUtil.build({
        limits: AIAgentRunLimitsHelper.getDefault(),
        startedAt: "2026-11-09T10:00:00.000Z" as unknown as Date,
        modelCallsUsed: 0,
        toolCallsUsed: 0,
        tokensUsed: 0,
        nowMs: STARTED_AT.getTime(),
      }).deadlineAt,
    ).toBe("2026-11-09T12:00:00.000Z");
  });

  test("goes over the wire and back unchanged", () => {
    const limits: CodeAgentRunLimits = CodeAgentRunLimitsUtil.build({
      limits: limitsWith({
        maxToolCalls: 75,
        maxWallClockMs: 30 * MINUTE_MS,
        timeLimitSource: AIRunTimeLimitSource.Project,
      }),
      startedAt: STARTED_AT,
      modelCallsUsed: 9,
      toolCallsUsed: 4,
      tokensUsed: 80_000,
      lastCallTokens: 11_000,
      nowMs: STARTED_AT.getTime() + MINUTE_MS,
    });

    expect(
      CodeAgentRunLimitsUtil.fromJSON(JSON.parse(JSON.stringify(limits))),
    ).toEqual(limits);
  });
});

describe("CodeAgentRunLimitsUtil.fromJSON", () => {
  test.each([
    [undefined],
    [null],
    ["limits"],
    [42],
    [[]],
    [{}],
    [{ timeLimitInMinutes: "120" }],
    [{ timeLimitInMinutes: Number.NaN }],
    [{ maxModelCalls: 40 }],
  ])("%p, as a server from before this release sends, is no limits", (raw: unknown) => {
    expect(CodeAgentRunLimitsUtil.fromJSON(raw)).toBeNull();
  });

  test("unset caps, wrong types and nonsense counts read as none", () => {
    expect(
      CodeAgentRunLimitsUtil.fromJSON({
        maxModelCalls: null,
        maxToolCalls: "200",
        maxTokens: 0,
        timeLimitInMinutes: 0.2,
        timeLimitSource: "Somewhere",
        deadlineAt: "not a date",
        timeLeftMs: "soon",
        modelCallsUsed: -3,
        toolCallsUsed: Number.POSITIVE_INFINITY,
        tokensUsed: "many",
      }),
    ).toEqual({
      maxModelCalls: null,
      maxToolCalls: null,
      maxTokens: null,
      timeLimitInMinutes: 1,
      timeLimitSource: AIRunTimeLimitSource.Default,
      deadlineAt: null,
      timeLeftMs: null,
      modelCallsUsed: 0,
      toolCallsUsed: 0,
      tokensUsed: 0,
      lastCallTokens: 0,
    });
  });

  test("a negative time left is none left", () => {
    expect(
      CodeAgentRunLimitsUtil.fromJSON({
        timeLimitInMinutes: 120,
        timeLeftMs: -5_000,
      })!.timeLeftMs,
    ).toBe(0);
  });

  test("a cap is read as a whole number", () => {
    expect(
      CodeAgentRunLimitsUtil.fromJSON({
        timeLimitInMinutes: 120,
        maxToolCalls: 30.7,
      })!.maxToolCalls,
    ).toBe(30);
  });

  test("every source a server may name is kept", () => {
    for (const source of Object.values(AIRunTimeLimitSource)) {
      expect(
        CodeAgentRunLimitsUtil.fromJSON({
          timeLimitInMinutes: 60,
          timeLimitSource: source,
        })!.timeLimitSource,
      ).toBe(source);
    }
  });
});

describe("CodeAgentRunLimitsUtil.toAgentRunLimits", () => {
  test("no limits from the server are the defaults", () => {
    expect(CodeAgentRunLimitsUtil.toAgentRunLimits(null)).toEqual(
      AIAgentRunLimitsHelper.getDefault(),
    );
  });

  test("the caps and the time limit, as an agent loop holds them", () => {
    expect(
      CodeAgentRunLimitsUtil.toAgentRunLimits({
        maxModelCalls: 50,
        maxToolCalls: null,
        maxTokens: 900_000,
        timeLimitInMinutes: 30,
        timeLimitSource: AIRunTimeLimitSource.Project,
        deadlineAt: null,
        timeLeftMs: null,
        modelCallsUsed: 0,
        toolCallsUsed: 0,
        tokensUsed: 0,
        lastCallTokens: 0,
      }),
    ).toEqual({
      maxLlmCalls: 50,
      maxToolCalls: undefined,
      maxTokens: 900_000,
      maxWallClockMs: 30 * MINUTE_MS,
      timeLimitSource: AIRunTimeLimitSource.Project,
    });
  });
});

describe("CodeAgentRunLimitsUtil.getLocalDeadlineAtMs", () => {
  const base: CodeAgentRunLimits = {
    maxModelCalls: null,
    maxToolCalls: null,
    maxTokens: null,
    timeLimitInMinutes: 120,
    timeLimitSource: AIRunTimeLimitSource.Default,
    deadlineAt: "2026-11-09T12:00:00.000Z",
    timeLeftMs: 30 * MINUTE_MS,
    modelCallsUsed: 0,
    toolCallsUsed: 0,
    tokensUsed: 0,
    lastCallTokens: 0,
  };

  test("is the time left after the answer came, on the agent's own clock", () => {
    // The Runner's clock is a day off: the deadline still comes in 30 minutes.
    const receivedAtMs: number = Date.parse("2026-11-10T11:30:00.000Z");

    expect(CodeAgentRunLimitsUtil.getLocalDeadlineAtMs(base, receivedAtMs)).toBe(
      receivedAtMs + 30 * MINUTE_MS,
    );
  });

  test("without a time left, it is the deadline as written", () => {
    expect(
      CodeAgentRunLimitsUtil.getLocalDeadlineAtMs(
        { ...base, timeLeftMs: null },
        0,
      ),
    ).toBe(Date.parse("2026-11-09T12:00:00.000Z"));
  });

  test("with neither, or no limits at all, there is none", () => {
    expect(
      CodeAgentRunLimitsUtil.getLocalDeadlineAtMs(
        { ...base, timeLeftMs: null, deadlineAt: null },
        0,
      ),
    ).toBeNull();
    expect(CodeAgentRunLimitsUtil.getLocalDeadlineAtMs(null, 0)).toBeNull();
  });
});
