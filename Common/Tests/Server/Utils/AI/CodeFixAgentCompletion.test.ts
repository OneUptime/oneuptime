import CodeFixAgentCompletion, {
  AgentCompletionResult,
  LoopBudgetDecision,
  MAX_COMPLETION_CALLS_PER_RUN,
  MAX_OUTPUT_TOKENS_PER_RUN,
  MAX_TOKENS_PER_COMPLETION_CALL,
} from "../../../../Server/Utils/AI/CodeFix/CodeFixAgentCompletion";
import AIRunService from "../../../../Server/Services/AIRunService";
import LlmLogService from "../../../../Server/Services/LlmLogService";
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
}): { executeSpy: ExecuteSpy; updateSpy: UpdateSpy } {
  jest.spyOn(AIRunService, "findOneById").mockResolvedValue(fakeRun());
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
});

describe("CodeFixAgentCompletion.execute guards", () => {
  beforeEach(() => {
    // Fails the test loudly if a guard leaks through to execution.
    jest.spyOn(AIService, "executeWithLogging").mockImplementation(() => {
      throw new Error("executeWithLogging must not be reached");
    });
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
    });
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
