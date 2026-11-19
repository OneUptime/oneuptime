import ObservabilityAssistant, {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
  ObservabilityAssistantResult,
} from "../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIService, {
  AILogResponse,
} from "../../../../Server/Services/AIService";
import AIAgentRunLimitsHelper from "../../../../Types/AI/AIAgentRunLimits";
import LlmType from "../../../../Types/LLM/LlmType";
import LlmLog from "../../../../Models/DatabaseModels/LlmLog";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { ToolCallOutcome } from "../../../../Server/Utils/AI/Toolbox/Index";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHICH MODEL WROTE THE ANSWER (issue #7762). The agent loop names the
 * provider and model of its last model call: the call whose words the
 * answer is, which people read and judge. A run whose provider changed
 * while it ran - its rule's provider removed, the project's default
 * switched - is the model it ended on. The investigation records it
 * (AIRun.modelName), its report says "using" it, and AI Results counts the
 * run under it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

function toolRound(
  modelName: string | undefined,
  providerType?: string,
): ObservabilityAssistantModelReply {
  return {
    content: "",
    toolCalls: [{ id: "call_1", name: "search_logs", arguments: {} }],
    stopReason: "tool_use",
    tokenCount: 100,
    ...(modelName ? { providerName: "Provider", modelName } : {}),
    ...(providerType ? { providerType } : {}),
  };
}

function answer(
  modelName: string | undefined,
  providerType?: string,
): ObservabilityAssistantModelReply {
  return {
    content: "**Summary** — the pool ran dry.",
    stopReason: "stop",
    tokenCount: 50,
    ...(modelName ? { providerName: "Provider", modelName } : {}),
    ...(providerType ? { providerType } : {}),
  };
}

async function runLoop(
  replies: Array<ObservabilityAssistantModelReply>,
): Promise<ObservabilityAssistantResult> {
  const calls: Array<ObservabilityAssistantModelCall> = [];

  return ObservabilityAssistant.answerQuestion({
    projectId: PROJECT_ID,
    props: { isRoot: true, tenantId: PROJECT_ID },
    feature: "AI Incident Investigation",
    aiContext: null,
    question: "Why is checkout down?",
    runLimits: AIAgentRunLimitsHelper.getDefault(),
    maxOutputTokens: 1024,
    transport: {
      callModel: async (
        call: ObservabilityAssistantModelCall,
      ): Promise<ObservabilityAssistantModelReply> => {
        calls.push(call);
        const reply: ObservabilityAssistantModelReply | undefined =
          replies[calls.length - 1];

        if (!reply) {
          throw new Error(`No reply for call ${calls.length}.`);
        }

        return reply;
      },
      executeTool: async (_call: {
        name: string;
        arguments: JSONObject;
      }): Promise<ToolCallOutcome> => {
        return { success: true, textForLlm: "No logs matched." };
      },
    },
  });
}

describe("ObservabilityAssistant: the model that wrote the answer", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("one model all along: that model, and its provider's type", async () => {
    const result: ObservabilityAssistantResult = await runLoop([
      toolRound("chat-large", LlmType.OpenAI),
      answer("chat-large", LlmType.OpenAI),
    ]);

    expect(result.modelName).toBe("chat-large");
    expect(result.providerName).toBe("Provider");
    expect(result.providerType).toBe(LlmType.OpenAI);
  });

  test("a run whose provider changed while it ran: the model it ended on, not the one it started with", async () => {
    const result: ObservabilityAssistantResult = await runLoop([
      toolRound("chat-large", LlmType.OpenAI),
      answer("chat-medium", LlmType.Anthropic),
    ]);

    expect(result.modelName).toBe("chat-medium");
    expect(result.providerType).toBe(LlmType.Anthropic);
  });

  test("a last call that names no model leaves the latest one that did", async () => {
    const result: ObservabilityAssistantResult = await runLoop([
      toolRound("chat-large", LlmType.OpenAI),
      answer(undefined),
    ]);

    expect(result.modelName).toBe("chat-large");
    expect(result.providerType).toBe(LlmType.OpenAI);
  });

  test("no call named a model: none, and no provider type key at all", async () => {
    const result: ObservabilityAssistantResult = await runLoop([
      toolRound(undefined),
      answer(undefined),
    ]);

    expect(result.modelName).toBeUndefined();
    expect(Object.keys(result)).not.toContain("providerType");
  });

  test("a call to the project's provider names the provider's type from its AI Log", async () => {
    const log: LlmLog = new LlmLog();
    log.llmProviderName = "Team provider";
    log.modelName = "chat-large";
    log.llmType = LlmType.Mistral;
    log.totalTokens = 10;

    jest.spyOn(AIService, "executeWithLogging").mockResolvedValue({
      content: "**Summary** — the pool ran dry.",
      toolCalls: undefined,
      stopReason: "stop",
      llmLog: log,
    } as unknown as AILogResponse);

    const result: ObservabilityAssistantResult =
      await ObservabilityAssistant.answerQuestion({
        projectId: PROJECT_ID,
        props: { isRoot: true, tenantId: PROJECT_ID },
        feature: "AI Incident Investigation",
        aiContext: null,
        question: "Why is checkout down?",
        runLimits: AIAgentRunLimitsHelper.getDefault(),
        maxOutputTokens: 1024,
      });

    expect(result.providerName).toBe("Team provider");
    expect(result.modelName).toBe("chat-large");
    expect(result.providerType).toBe(LlmType.Mistral);
  });
});
