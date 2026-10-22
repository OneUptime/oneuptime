import CodeFixAgentCompletion, {
  AgentCompletionResult,
  LoopBudgetDecision,
  MAX_COMPLETION_CALLS_PER_RUN,
  MAX_OUTPUT_TOKENS_PER_RUN,
  MAX_TELEMETRY_TOOL_CALLS_PER_RUN,
  MAX_TOKENS_PER_COMPLETION_CALL,
} from "../../../../Server/Utils/AI/CodeFix/CodeFixAgentCompletion";
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
 * ONLY for a claimed Running CodeFix run owned by the calling agent, per-run
 * loop budgets are enforced server-side (never trusted to the worker), the
 * provider comes from the METERED resolution, and the call executes under
 * the "AI Code Fix" feature with content previews redacted.
 */

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
  run?: Partial<AIRun>;
}): { executeSpy: ExecuteSpy; updateSpy: UpdateSpy } {
  jest.spyOn(AIRunService, "findOneById").mockResolvedValue(fakeRun(data?.run));
  const updateSpy: UpdateSpy = jest
    .spyOn(AIRunService, "updateOneBy")
    .mockResolvedValue(1);
  jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
    completionCalls: data?.completionCalls ?? 2,
    outputTokens: data?.outputTokens ?? 500,
  });
  jest
    .spyOn(LlmProviderService, "getLlmProviderForMeteredAgentPath")
    .mockResolvedValue(fakeProvider());
  // The project's enableAi kill switch, read before the provider is resolved.
  jest.spyOn(AIService, "assertProjectAIEnabled").mockResolvedValue(undefined);

  const executeSpy: ExecuteSpy = jest
    .spyOn(AIService, "executeWithLogging")
    .mockResolvedValue({
      content: "done",
      toolCalls: undefined,
      llmLog: { completionTokens: 123 } as unknown as LlmLog,
    });

  return { executeSpy, updateSpy };
}

describe("CodeFixAgentCompletion.evaluateLoopBudget (pure)", () => {
  test("allows a run under both budgets", () => {
    const decision: LoopBudgetDecision =
      CodeFixAgentCompletion.evaluateLoopBudget({
        completionCalls: MAX_COMPLETION_CALLS_PER_RUN - 1,
        outputTokens: MAX_OUTPUT_TOKENS_PER_RUN - 1,
      });

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBeNull();
  });

  test("refuses at the completion-call cap, naming the numbers", () => {
    const decision: LoopBudgetDecision =
      CodeFixAgentCompletion.evaluateLoopBudget({
        completionCalls: MAX_COMPLETION_CALLS_PER_RUN,
        outputTokens: 0,
      });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain(`${MAX_COMPLETION_CALLS_PER_RUN}`);
  });

  test("refuses at the output-token cap, naming the numbers", () => {
    const decision: LoopBudgetDecision =
      CodeFixAgentCompletion.evaluateLoopBudget({
        completionCalls: 0,
        outputTokens: MAX_OUTPUT_TOKENS_PER_RUN,
      });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("output-token");
  });

  test("production telemetry calls count against the same calls as completions", () => {
    const atCap: LoopBudgetDecision = CodeFixAgentCompletion.evaluateLoopBudget(
      {
        completionCalls: MAX_COMPLETION_CALLS_PER_RUN - 10,
        outputTokens: 0,
        toolCalls: 10,
      },
    );

    expect(atCap.allowed).toBe(false);
    expect(atCap.reason).toContain(
      `${MAX_COMPLETION_CALLS_PER_RUN - 10} completion calls and 10 production telemetry queries`,
    );

    expect(
      CodeFixAgentCompletion.evaluateLoopBudget({
        completionCalls: MAX_COMPLETION_CALLS_PER_RUN - 10,
        outputTokens: 0,
        toolCalls: 9,
      }).allowed,
    ).toBe(true);
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

  test("refuses an over-budget run (call cap) without executing", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(fakeRun());
    jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
      completionCalls: MAX_COMPLETION_CALLS_PER_RUN,
      outputTokens: 0,
    });
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
    ).rejects.toThrow("LLM call budget");

    // Over-budget short-circuits before provider resolution and execution.
    expect(providerSpy).not.toHaveBeenCalled();
  });

  test("refuses a run whose completions and telemetry queries reach the call cap", async () => {
    jest
      .spyOn(AIRunService, "findOneById")
      .mockResolvedValue(fakeRun({ toolCallCount: 8 } as Partial<AIRun>));
    jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
      completionCalls: MAX_COMPLETION_CALLS_PER_RUN - 8,
      outputTokens: 0,
    });

    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages,
      }),
    ).rejects.toThrow("production telemetry queries");
  });

  test("refuses an over-budget run (output tokens) without executing", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(fakeRun());
    jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
      completionCalls: 1,
      outputTokens: MAX_OUTPUT_TOKENS_PER_RUN,
    });

    await expect(
      CodeFixAgentCompletion.execute({
        aiAgentId: agentId,
        aiRunId: runId,
        messages,
      }),
    ).rejects.toThrow("output-token budget");
  });

  test("refuses when no provider resolves on the metered path", async () => {
    jest.spyOn(AIRunService, "findOneById").mockResolvedValue(fakeRun());
    jest.spyOn(LlmLogService, "getRunCompletionUsage").mockResolvedValue({
      completionCalls: 0,
      outputTokens: 0,
    });
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

  test("reports post-call budget usage so the worker can wind down early", async () => {
    mockHappyDependencies({ completionCalls: 5, outputTokens: 1000 });

    const result: AgentCompletionResult = await CodeFixAgentCompletion.execute({
      aiAgentId: agentId,
      aiRunId: runId,
      messages,
    });

    expect(result.budget).toEqual({
      completionCallsUsed: 6,
      maxCompletionCalls: MAX_COMPLETION_CALLS_PER_RUN,
      outputTokensUsed: 1000 + 123,
      maxOutputTokens: MAX_OUTPUT_TOKENS_PER_RUN,
      toolCallsUsed: 0,
      maxToolCalls: MAX_TELEMETRY_TOOL_CALLS_PER_RUN,
    });
  });

  test("counts the run's production telemetry queries among the calls it reports", async () => {
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
          "Using Azure GPT-4o, the project's default LLM provider: the rule's provider is no longer available",
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
