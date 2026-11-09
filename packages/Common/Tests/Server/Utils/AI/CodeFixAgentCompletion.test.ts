import CodeFixAgentCompletion, {
  AgentCompletionResult,
  CODE_AGENT_ANSWER_GRACE_MS,
  CodeAgentLimitDecision,
  LEGACY_MAX_COMPLETION_CALLS,
  LEGACY_MAX_OUTPUT_TOKENS,
  LEGACY_MAX_TELEMETRY_TOOL_CALLS,
  MAX_TOKENS_PER_COMPLETION_CALL,
} from "../../../../Server/Utils/AI/CodeFix/CodeFixAgentCompletion";
import AIRunLimitsReader from "../../../../Server/Utils/AI/AIRunLimitsReader";
import AIAgentRunLimitsHelper, {
  AIAgentRunLimits,
  AIRunStopReason,
  AIRunTimeLimitSource,
} from "../../../../Types/AI/AIAgentRunLimits";
import AIRunService from "../../../../Server/Services/AIRunService";
import AIRunEventService from "../../../../Server/Services/AIRunEventService";
import LlmLogService from "../../../../Server/Services/LlmLogService";
import LlmProviderChoice from "../../../../Server/Utils/AI/LlmProviderChoice";
import { AIRunEventResultSummary } from "../../../../Types/AI/AIChatTypes";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import {
  LlmProviderFallbackReason,
  LlmProviderSource,
} from "../../../../Types/AI/LlmProviderChoice";
import LlmProviderService from "../../../../Server/Services/LlmProviderService";
import AIService, {
  AILogRequest,
  AI_CODE_FIX_FEATURE,
} from "../../../../Server/Services/AIService";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import LlmProvider from "../../../../Models/DatabaseModels/LlmProvider";
import LlmLog from "../../../../Models/DatabaseModels/LlmLog";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import ObjectID from "../../../../Types/ObjectID";
import { LLMMessage } from "../../../../Server/Utils/LLM/LLMService";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * The server-mediated code-fix completion endpoint (B4 Tier 0). These tests
 * lock in the guard matrix the design doc requires: completions are served
 * ONLY for a claimed Running CodeFix run owned by the calling agent, the
 * run's limits are held server-side (never trusted to the worker) - none
 * but its time limit unless the project set them (issue #6440) - the
 * provider comes from the METERED resolution, and the call executes under
 * the "AI Code Fix" feature with content previews redacted.
 */

const LIMITS_LOCATION: string =
  "Project Settings → AI → AI Features → More settings → Limits per run";

const MINUTE: number = 60 * 1000;

function caps(overrides: Partial<AIAgentRunLimits> = {}): AIAgentRunLimits {
  return { ...AIAgentRunLimitsHelper.getDefault(), ...overrides };
}

const agentId: ObjectID = ObjectID.generate();
const runId: ObjectID = ObjectID.generate();
const projectId: ObjectID = ObjectID.generate();

const messages: Array<LLMMessage> = [
  { role: "system", content: "recipe prompt" },
  { role: "user", content: "begin" },
];

function fakeRun(overrides: Partial<AIRun> = {}): AIRun {
  return {
    id: runId,
    projectId,
    runType: AIRunType.CodeFix,
    status: AIRunStatus.Running,
    aiAgentId: agentId,
    ...overrides,
  } as unknown as AIRun;
}

function fakeProvider(): LlmProvider {
  return {
    id: ObjectID.generate(),
    name: "provider",
    isGlobalLlm: true,
  } as unknown as LlmProvider;
}

type ExecuteSpy = jest.SpiedFunction<typeof AIService.executeWithLogging>;
type UpdateSpy = jest.SpiedFunction<typeof AIRunService.updateOneBy>;

function mockHappyDependencies(data?: {
  completionCalls?: number;
  outputTokens?: number;
  totalTokens?: number;
  run?: Partial<AIRun>;
  limits?: AIAgentRunLimits;
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>;
}): { executeSpy: ExecuteSpy; updateSpy: UpdateSpy } {
  jest.spyOn(AIRunService, "findOneById").mockResolvedValue(fakeRun(data?.run));
  const updateSpy: UpdateSpy = jest
    .spyOn(AIRunService, "updateOneBy")
    .mockResolvedValue(1);
  jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
    completionCalls: data?.completionCalls ?? 2,
    outputTokens: data?.outputTokens ?? 500,
    totalTokens: data?.totalTokens ?? 3000,
  });
  // The project's limits per run: none, by default.
  jest
    .spyOn(AIRunLimitsReader, "read")
    .mockResolvedValue(data?.limits ?? AIAgentRunLimitsHelper.getDefault());
  jest
    .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
    .mockResolvedValue(fakeProvider());
  // The project's enableAi kill switch, read before the provider is resolved.
  jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue(undefined);

  const executeSpy: ExecuteSpy = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue({
      content: "done",
      toolCalls: data?.toolCalls as never,
      llmLog: {
        completionTokens: 123,
        totalTokens: 900,
      } as unknown as LlmLog,
    });

  return { executeSpy, updateSpy };
}

describe("CodeFixAgentCompletion.evaluateRunLimits (pure)", () => {
  const NOW: number = Date.parse("2026-11-09T12:00:00.000Z");

  /*
   * THE CUSTOMER'S CASE (issue #6440). The server used to refuse a code
   * task's 41st call and its calls past 100,000 output tokens. With nothing
   * set, no count refuses one.
   */
  test("with no limit set, no number of calls or tokens is refused", () => {
    for (const used of [0, 40, 41, 200, 10_000]) {
      const decision: CodeAgentLimitDecision =
        CodeFixAgentCompletion.evaluateRunLimits({
          limits: caps(),
          usage: { modelCalls: used, tokens: used * 50_000 },
          nowMs: NOW,
          deadlineAtMs: NOW + 60 * MINUTE,
        });

      expect(decision).toEqual({
        allowed: true,
        reason: null,
        withoutTools: false,
        stopReason: null,
      });
    }
  });

  test("the project's model calls per run: refused at the cap, naming the setting", () => {
    const limits: AIAgentRunLimits = caps({ maxLlmCalls: 25 });

    expect(
      CodeFixAgentCompletion.evaluateRunLimits({
        limits,
        usage: { modelCalls: 24, tokens: 0 },
        nowMs: NOW,
        deadlineAtMs: null,
      }).allowed,
    ).toBe(true);

    expect(
      CodeFixAgentCompletion.evaluateRunLimits({
        limits,
        usage: { modelCalls: 25, tokens: 0 },
        nowMs: NOW,
        deadlineAtMs: null,
      }),
    ).toEqual({
      allowed: false,
      reason: `This run has made 25 model calls, this project's limit per run, so it may make no more. Change it in ${LIMITS_LOCATION}.`,
      withoutTools: false,
      stopReason: AIRunStopReason.ModelCalls,
    });
  });

  test("the project's tokens per run: refused at the cap, naming the setting", () => {
    const limits: AIAgentRunLimits = caps({ maxTokens: 500_000 });

    expect(
      CodeFixAgentCompletion.evaluateRunLimits({
        limits,
        usage: { modelCalls: 3, tokens: 499_999 },
        nowMs: NOW,
        deadlineAtMs: null,
      }).allowed,
    ).toBe(true);

    expect(
      CodeFixAgentCompletion.evaluateRunLimits({
        limits,
        usage: { modelCalls: 3, tokens: 500_000 },
        nowMs: NOW,
        deadlineAtMs: null,
      }),
    ).toEqual({
      allowed: false,
      reason: `This run has used this project's limit of 500,000 tokens per run, so it may make no more calls. Change it in ${LIMITS_LOCATION}.`,
      withoutTools: false,
      stopReason: AIRunStopReason.Tokens,
    });
  });

  test("the time limit: the last call is served without tools, and none past the grace", () => {
    const limits: AIAgentRunLimits = caps();
    const deadlineAtMs: number = NOW;

    expect(
      CodeFixAgentCompletion.evaluateRunLimits({
        limits,
        usage: { modelCalls: 3, tokens: 0 },
        nowMs: deadlineAtMs - 1,
        deadlineAtMs,
      }).withoutTools,
    ).toBe(false);

    expect(
      CodeFixAgentCompletion.evaluateRunLimits({
        limits,
        usage: { modelCalls: 3, tokens: 0 },
        nowMs: deadlineAtMs,
        deadlineAtMs,
      }),
    ).toEqual({
      allowed: true,
      reason: null,
      withoutTools: true,
      stopReason: AIRunStopReason.TimeLimit,
    });

    expect(
      CodeFixAgentCompletion.evaluateRunLimits({
        limits,
        usage: { modelCalls: 3, tokens: 0 },
        nowMs: deadlineAtMs + CODE_AGENT_ANSWER_GRACE_MS - 1,
        deadlineAtMs,
      }).allowed,
    ).toBe(true);

    expect(
      CodeFixAgentCompletion.evaluateRunLimits({
        limits,
        usage: { modelCalls: 3, tokens: 0 },
        nowMs: deadlineAtMs + CODE_AGENT_ANSWER_GRACE_MS,
        deadlineAtMs,
      }),
    ).toEqual({
      allowed: false,
      reason: `This run has reached its time limit of 120 minutes, so it may make no more calls. Change it in ${LIMITS_LOCATION}.`,
      withoutTools: false,
      stopReason: AIRunStopReason.TimeLimit,
    });
  });

  test("a run whose start is not recorded is held to no time here", () => {
    expect(
      CodeFixAgentCompletion.evaluateRunLimits({
        limits: caps(),
        usage: { modelCalls: 3, tokens: 0 },
        nowMs: NOW + 1000 * 24 * 60 * MINUTE,
        deadlineAtMs: null,
      }).allowed,
    ).toBe(true);
  });

  test("a refusal never speaks of a budget", () => {
    for (const limits of [
      caps({ maxLlmCalls: 1 }),
      caps({ maxTokens: 1000 }),
    ]) {
      const decision: CodeAgentLimitDecision =
        CodeFixAgentCompletion.evaluateRunLimits({
          limits,
          usage: { modelCalls: 5, tokens: 5000 },
          nowMs: NOW,
          deadlineAtMs: NOW - CODE_AGENT_ANSWER_GRACE_MS,
        });

      expect(decision.allowed).toBe(false);
      expect((decision.reason || "").toLowerCase()).not.toContain("budget");
    }
  });
});

/*
 * A Runner from before #6440 winds down on `budget` - and stops itself at
 * 40 calls whatever it is told. It is told the numbers it always wound down
 * on, or the project's caps when they are lower, so it works as it did.
 */
describe("CodeFixAgentCompletion.buildLegacyBudget (pure)", () => {
  test("no caps: the numbers such a Runner always wound down on", () => {
    expect(
      CodeFixAgentCompletion.buildLegacyBudget({
        limits: caps(),
        completionCalls: 7,
        outputTokens: 2000,
        toolCalls: 3,
      }),
    ).toEqual({
      completionCallsUsed: 10,
      maxCompletionCalls: LEGACY_MAX_COMPLETION_CALLS,
      outputTokensUsed: 2000,
      maxOutputTokens: LEGACY_MAX_OUTPUT_TOKENS,
      toolCallsUsed: 3,
      maxToolCalls: LEGACY_MAX_TELEMETRY_TOOL_CALLS,
    });
    expect([
      LEGACY_MAX_COMPLETION_CALLS,
      LEGACY_MAX_OUTPUT_TOKENS,
      LEGACY_MAX_TELEMETRY_TOOL_CALLS,
    ]).toEqual([40, 100_000, 12]);
  });

  test("a project's lower caps: such a Runner winds down on them", () => {
    const budget: ReturnType<typeof CodeFixAgentCompletion.buildLegacyBudget> =
      CodeFixAgentCompletion.buildLegacyBudget({
        limits: caps({ maxLlmCalls: 10, maxToolCalls: 4 }),
        completionCalls: 1,
        outputTokens: 0,
        toolCalls: 0,
      });

    expect(budget.maxCompletionCalls).toBe(10);
    expect(budget.maxToolCalls).toBe(4);
  });

  test("a project's higher caps: never more than such a Runner can use", () => {
    const budget: ReturnType<typeof CodeFixAgentCompletion.buildLegacyBudget> =
      CodeFixAgentCompletion.buildLegacyBudget({
        limits: caps({ maxLlmCalls: 500, maxToolCalls: 300 }),
        completionCalls: 1,
        outputTokens: 0,
        toolCalls: 0,
      });

    expect(budget.maxCompletionCalls).toBe(40);
    expect(budget.maxToolCalls).toBe(12);
  });
});

describe("CodeFixAgentCompletion.execute guards", () => {
  beforeEach(() => {
    // Fails the test loudly if a guard leaks through to execution.
    jest.spyOn(AIService, "executeWithLogging").mockImplementation(() => {
      throw new Error("executeWithLogging must not be reached");
    });
    jest
      .spyOn(AIService, "assertProjectAIEnabled")
      .mockResolvedValue(undefined);
    // The project's limits per run: none, unless a test sets them.
    jest
      .spyOn(AIRunLimitsReader, "read")
      .mockResolvedValue(AIAgentRunLimitsHelper.getDefault());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("refuses empty messages", async () => {
    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages: [],
      }),
    ).rejects.toThrow("messages must be a non-empty array");
  });

  test("refuses when the run does not exist", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(null);

    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages,
      }),
    ).rejects.toThrow("Task not found");
  });

  test("refuses a non-CodeFix run", async () => {
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(fakeRun({ runType: AIRunType.Investigation }));

    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages,
      }),
    ).rejects.toThrow("only served for code-fix runs");
  });

  test("refuses a run that is not Running (terminal or queued)", async () => {
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(fakeRun({ status: AIRunStatus.Completed }));

    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages,
      }),
    ).rejects.toThrow("not running");
  });

  test("refuses a run claimed by a DIFFERENT agent", async () => {
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(fakeRun({ aiAgentId: ObjectID.generate() }));

    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages,
      }),
    ).rejects.toThrow("claimed by a different agent");
  });

  test("refuses a run at the project's model calls per run, without executing", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(fakeRun());
    jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
      completionCalls: 30,
      outputTokens: 0,
      totalTokens: 0,
    });
    jest
      .spyOn(AIRunLimitsReader, "read")
      .mockResolvedValue(caps({ maxLlmCalls: 30 }));
    const providerSpy: jest.SpyInstance = jest.spyOn(
      LlmProviderService,
      "getLlmProviderForMeteredAgentPath",
    );

    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages,
      }),
    ).rejects.toThrow(
      `This run has made 30 model calls, this project's limit per run, so it may make no more. Change it in ${LIMITS_LOCATION}.`,
    );

    // A refusal short-circuits before provider resolution and execution.
    expect(providerSpy).not.toHaveBeenCalled();
  });

  test("refuses a run at the project's tokens per run, without executing", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(fakeRun());
    jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
      completionCalls: 1,
      outputTokens: 40,
      totalTokens: 2_000_000,
    });
    jest
      .spyOn(AIRunLimitsReader, "read")
      .mockResolvedValue(caps({ maxTokens: 2_000_000 }));

    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages,
      }),
    ).rejects.toThrow("this project's limit of 2,000,000 tokens per run");
  });

  test("refuses a run past its time limit and the grace for its answer", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(
      fakeRun({
        startedAt: new Date(Date.now() - 50 * MINUTE),
      } as Partial<AIRun>),
    );
    jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
      completionCalls: 4,
      outputTokens: 0,
      totalTokens: 0,
    });
    jest.spyOn(AIRunLimitsReader, "read").mockResolvedValue(
      AIAgentRunLimitsHelper.fromSettings({ timeLimitInMinutes: 30 }),
    );

    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages,
      }),
    ).rejects.toThrow(
      `This run has reached its time limit of 30 minutes, so it may make no more calls. Change it in ${LIMITS_LOCATION}.`,
    );
  });

  test("refuses when no provider resolves on the metered path", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(fakeRun());
    jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
      completionCalls: 0,
      outputTokens: 0,
      totalTokens: 0,
    });
    jest
      .spyOn(AIRunLimitsReader, "read")
      .mockResolvedValue(AIAgentRunLimitsHelper.getDefault());
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(null);

    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages,
      }),
    ).rejects.toThrow("No LLM provider is available");
  });
});

describe("CodeFixAgentCompletion.execute happy path", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("executes under the AI Code Fix feature, run-linked and preview-redacted", async () => {
    const { executeSpy } = mockHappyDependencies();

    const result: AgentCompletionResult = await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const request: AILogRequest = executeSpy.mock.calls[0]![0]!;
    expect(request.feature).toBe(AI_CODE_FIX_FEATURE);
    expect(request.aiRunId).toBe(runId);
    expect(request.projectId).toBe(projectId);
    expect(request.storeContentPreviews).toBe(false);
    // No worker-supplied maxTokens => the per-call cap applies.
    expect(request.maxTokens).toBe(MAX_TOKENS_PER_COMPLETION_CALL);

    expect(result.content).toBe("done");
    expect(result.toolCalls).toEqual([]);
    expect(result.stopReason).toBe("stop");
  });

  /*
   * Every other call has embedded data left out (PromptText), so a model
   * never pays for a screenshot's base64. The coding agent's messages are
   * source files it rewrites whole: a data: URL in a stylesheet is code, and
   * must reach the model - and come back - exactly as written.
   */
  test("sends the agent's messages with their embedded data, exactly as given", async () => {
    const { executeSpy } = mockHappyDependencies();

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    const request: AILogRequest = executeSpy.mock.calls[0]![0]!;
    expect(request.keepEmbeddedData).toBe(true);
    expect(request.messages).toBe(messages);
  });

  test("clamps a worker-supplied maxTokens to the per-call cap", async () => {
    const { executeSpy } = mockHappyDependencies();

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
      maxTokens: 999_999,
    });

    expect(executeSpy.mock.calls[0]![0]!.maxTokens).toBe(
      MAX_TOKENS_PER_COMPLETION_CALL,
    );
  });

  test("keeps a subject-linked fix completion in its autonomous budget lane", async () => {
    const incidentId: ObjectID = ObjectID.generate();
    const { executeSpy } = mockHappyDependencies({
      run: { triggeredByIncidentId: incidentId },
    });

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId,
        alertId: undefined,
      }),
    );
  });

  test("keeps an alert-linked fix completion in the alert budget lane", async () => {
    const alertId: ObjectID = ObjectID.generate();
    const { executeSpy } = mockHappyDependencies({
      run: { triggeredByAlertId: alertId },
    });

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: undefined,
        alertId,
      }),
    );
  });

  test("keeps a general fix completion in the subjectless budget lane", async () => {
    const { executeSpy } = mockHappyDependencies();

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        incidentId: undefined,
        alertId: undefined,
      }),
    );
  });

  test("tells the worker the run's limits and its usage after the call, so it winds down before them", async () => {
    const startedAt: Date = new Date(Date.now() - 10 * MINUTE);
    mockHappyDependencies({
      completionCalls: 5,
      outputTokens: 1000,
      totalTokens: 50_000,
      run: { startedAt, toolCallCount: 2 } as Partial<AIRun>,
      limits: AIAgentRunLimitsHelper.fromSettings({
        maxModelCalls: 60,
        maxTokens: 1_000_000,
        timeLimitInMinutes: 90,
      }),
    });

    const result: AgentCompletionResult = await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(result.limits).toEqual({
      maxModelCalls: 60,
      maxToolCalls: null,
      maxTokens: 1_000_000,
      timeLimitInMinutes: 90,
      timeLimitSource: AIRunTimeLimitSource.Project,
      deadlineAt: new Date(startedAt.getTime() + 90 * MINUTE).toISOString(),
      timeLeftMs: expect.any(Number),
      modelCallsUsed: 6,
      toolCallsUsed: 2,
      // The tokens before the call, and the call's own 900.
      tokensUsed: 50_900,
      lastCallTokens: 900,
    });
    // About 80 minutes left of the 90.
    expect(result.limits.timeLeftMs).toBeGreaterThan(79 * MINUTE);
    expect(result.limits.timeLeftMs).toBeLessThanOrEqual(80 * MINUTE);
  });

  test("with no limit set, the worker is told of none but the time limit", async () => {
    mockHappyDependencies({ completionCalls: 250 });

    const result: AgentCompletionResult = await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    // The 251st call is served, as every one before it.
    expect(result.content).toBe("done");
    expect(result.limits.maxModelCalls).toBeNull();
    expect(result.limits.maxToolCalls).toBeNull();
    expect(result.limits.maxTokens).toBeNull();
    expect(result.limits.timeLimitInMinutes).toBe(120);
    expect(result.limits.timeLimitSource).toBe(AIRunTimeLimitSource.Default);
    // A run whose start is not recorded has no deadline the server gives.
    expect(result.limits.deadlineAt).toBeNull();
    expect(result.limits.timeLeftMs).toBeNull();
  });

  test("still tells a Runner from before #6440 the budget it winds down on", async () => {
    mockHappyDependencies({ completionCalls: 5, outputTokens: 1000 });

    const result: AgentCompletionResult = await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(result.budget).toEqual({
      completionCallsUsed: 6,
      maxCompletionCalls: LEGACY_MAX_COMPLETION_CALLS,
      outputTokensUsed: 1000 + 123,
      maxOutputTokens: LEGACY_MAX_OUTPUT_TOKENS,
      toolCallsUsed: 0,
      maxToolCalls: LEGACY_MAX_TELEMETRY_TOOL_CALLS,
    });
  });

  test("counts the run's production telemetry queries among the calls an older Runner is told of", async () => {
    mockHappyDependencies({
      completionCalls: 5,
      outputTokens: 1000,
      run: { toolCallCount: 3 } as Partial<AIRun>,
    });

    const result: AgentCompletionResult = await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(result.budget.completionCallsUsed).toBe(5 + 1 + 3);
    expect(result.budget.toolCallsUsed).toBe(3);
    expect(result.limits.toolCallsUsed).toBe(3);
  });

  test("a run whose time is up gets its last call without tools: the answer", async () => {
    const { executeSpy } = mockHappyDependencies({
      run: {
        startedAt: new Date(Date.now() - 31 * MINUTE),
      } as Partial<AIRun>,
      limits: AIAgentRunLimitsHelper.fromSettings({ timeLimitInMinutes: 30 }),
      toolCalls: [{ name: "read_file", arguments: { path: "a.ts" } }],
    });

    const result: AgentCompletionResult = await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
      tools: [
        {
          name: "read_file",
          description: "Read a file.",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    expect(executeSpy.mock.calls[0]![0]!.tools).toBeUndefined();
    // Whatever the provider sent, the run is answered: no tool calls.
    expect(result.toolCalls).toEqual([]);
    expect(result.stopReason).toBe("stop");
    expect(result.limits.timeLeftMs).toBe(0);
  });

  test("the run's time limit runs from when this attempt was claimed", async () => {
    mockHappyDependencies();

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(
      (
        AIRunService.findOneById as unknown as jest.SpiedFunction<
          typeof AIRunService.findOneById
        >
      ).mock.calls[0]![0].select,
    ).toMatchObject({ startedAt: true });
    expect(AIRunLimitsReader.read).toHaveBeenCalledWith({ projectId });
  });

  test("the transcript numbers each call, and names no cap that is not set", async () => {
    mockHappyDependencies({ completionCalls: 44 });
    const append: jest.SpiedFunction<
      typeof AIRunEventService.appendEventToRun
    > = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined);

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    const llmCall: Parameters<typeof AIRunEventService.appendEventToRun>[0] =
      append.mock.calls.find(
        (call: Parameters<typeof AIRunEventService.appendEventToRun>) => {
          return call[0].eventType === AIRunEventType.LlmCallCompleted;
        },
      )![0];

    expect(llmCall.resultSummary?.message).toBe(
      "LLM call 45 — returned a final answer",
    );
  });

  test("the transcript names the project's cap on model calls when it set one", async () => {
    mockHappyDependencies({
      completionCalls: 4,
      limits: caps({ maxLlmCalls: 50 }),
    });
    const append: jest.SpiedFunction<
      typeof AIRunEventService.appendEventToRun
    > = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined);

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(
      append.mock.calls.find(
        (call: Parameters<typeof AIRunEventService.appendEventToRun>) => {
          return call[0].eventType === AIRunEventType.LlmCallCompleted;
        },
      )![0].resultSummary?.message,
    ).toBe("LLM call 5 of 50 — returned a final answer");
  });

  test("a completion refreshes the run heartbeat (Running-guarded)", async () => {
    const { updateSpy } = mockHappyDependencies();

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]![0]!.query["status"]).toBe(
      AIRunStatus.Running,
    );
  });
});

/*
 * A fix run a rule started - a fix or telemetry pull request an auto
 * remediation rule opened - uses the LLM provider that rule picked
 * (AIRun.llmProviderId, Server/Utils/AI/LlmProviderChoice), not the metered
 * path's. A pick that cannot be used falls back to the metered path's
 * provider, and the run says so - once, on its first completion - as a
 * step of the task. A run no rule picked one for is as it always was.
 */
describe("CodeFixAgentCompletion.execute: the LLM provider the rule picked", () => {
  const PICK: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

  const picked: LlmProvider = Object.assign(new LlmProvider(), {
    _id: PICK,
    name: "Claude Opus",
    modelName: "claude-opus-4-5",
    isGlobalLlm: false,
  });

  const metered: LlmProvider = Object.assign(new LlmProvider(), {
    _id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    name: "Azure GPT-4o",
    isGlobalLlm: false,
  });

  function progressLogs(
    spy: jest.SpiedFunction<typeof AIRunEventService.appendEventToRun>,
  ): Array<AIRunEventResultSummary | undefined> {
    return spy.mock.calls
      .filter((call: Parameters<typeof AIRunEventService.appendEventToRun>) => {
        return call[0].eventType === AIRunEventType.ProgressLog;
      })
      .map((call: Parameters<typeof AIRunEventService.appendEventToRun>) => {
        return call[0].resultSummary;
      });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the pick is used for the completion, and the metered path is not asked", async () => {
    const { executeSpy } = mockHappyDependencies({
      completionCalls: 0,
      run: { llmProviderId: new ObjectID(PICK) },
    });
    const meteredSpy: jest.SpiedFunction<
      typeof LlmProviderService.getLlmProviderForMeteredAgentPath
    > = jest.spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath");
    const decide: jest.SpiedFunction<typeof LlmProviderChoice.decideIfPicked> =
      jest.spyOn(LlmProviderChoice, "decideIfPicked").mockResolvedValue({
        provider: { id: PICK, name: "Claude Opus", isGlobal: false },
        source: LlmProviderSource.RulePick,
        fallbackReason: null,
        pickedProviderId: PICK,
        llmProviderId: new ObjectID(PICK),
        providerRow: picked,
        activity: {
          source: LlmProviderSource.RulePick,
          providerName: "Claude Opus",
        },
      });
    const append: jest.SpiedFunction<
      typeof AIRunEventService.appendEventToRun
    > = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined);

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(decide).toHaveBeenCalledWith({
      projectId,
      pickedProviderId: new ObjectID(PICK),
    });
    expect(meteredSpy).not.toHaveBeenCalled();
    expect(executeSpy.mock.calls[0]![0]!.llmProviderId?.toString()).toBe(PICK);
    expect(progressLogs(append)).toEqual([
      {
        message: "Using Claude Opus, the rule's LLM provider",
        severity: "Info",
        llmProvider: {
          source: LlmProviderSource.RulePick,
          providerName: "Claude Opus",
        },
      },
    ]);
  });

  test("a pick that cannot be used: the metered path's provider, and the run says why", async () => {
    const { executeSpy } = mockHappyDependencies({
      completionCalls: 0,
      run: { llmProviderId: new ObjectID(PICK) },
    });
    jest
      .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
      .mockResolvedValue(metered);
    jest.spyOn(LlmProviderChoice, "decideIfPicked").mockResolvedValue({
      provider: null,
      source: null,
      fallbackReason: LlmProviderFallbackReason.Unavailable,
      pickedProviderId: PICK,
      providerRow: null,
      activity: { fallbackReason: LlmProviderFallbackReason.Unavailable },
    });
    const append: jest.SpiedFunction<
      typeof AIRunEventService.appendEventToRun
    > = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined);

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(executeSpy.mock.calls[0]![0]!.llmProviderId?.toString()).toBe(
      "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    );
    expect(progressLogs(append)).toEqual([
      {
        message:
          "Using Azure GPT-4o, the project's default LLM provider, because the rule's provider is no longer available",
        severity: "Warning",
        llmProvider: {
          source: LlmProviderSource.ProjectDefault,
          providerName: "Azure GPT-4o",
          fallbackReason: LlmProviderFallbackReason.Unavailable,
        },
      },
    ]);
  });

  test("the line is said once: a later completion of the same run says nothing more", async () => {
    mockHappyDependencies({
      completionCalls: 3,
      run: { llmProviderId: new ObjectID(PICK) },
    });
    jest.spyOn(LlmProviderChoice, "decideIfPicked").mockResolvedValue({
      provider: { id: PICK, name: "Claude Opus", isGlobal: false },
      source: LlmProviderSource.RulePick,
      fallbackReason: null,
      pickedProviderId: PICK,
      llmProviderId: new ObjectID(PICK),
      providerRow: picked,
      activity: {
        source: LlmProviderSource.RulePick,
        providerName: "Claude Opus",
      },
    });
    const append: jest.SpiedFunction<
      typeof AIRunEventService.appendEventToRun
    > = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined);

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(progressLogs(append)).toEqual([]);
  });

  test("a run no rule picked a provider for: the metered path, as before, and no line", async () => {
    const { executeSpy } = mockHappyDependencies({ completionCalls: 0 });
    const append: jest.SpiedFunction<
      typeof AIRunEventService.appendEventToRun
    > = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined);

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(
      LlmProviderService.getLlmProviderForMeteredAgentPath,
    ).toHaveBeenCalledWith(projectId);
    expect(executeSpy.mock.calls[0]![0]!.llmProviderId).toBeDefined();
    expect(progressLogs(append)).toEqual([]);
  });

  test("the run is read with its pick", async () => {
    mockHappyDependencies();

    await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(
      (
        AIRunService.findOneById as unknown as jest.SpiedFunction<
          typeof AIRunService.findOneById
        >
      ).mock.calls[0]![0].select,
    ).toMatchObject({ llmProviderId: true });
  });
});
