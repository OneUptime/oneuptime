import PinnedModel, {
  PinnedModelCall,
} from "../../../../../Server/Utils/AI/Eval/PinnedModel";
import {
  ObservabilityAssistantModelCall,
  ObservabilityAssistantModelReply,
} from "../../../../../Server/Utils/AI/Chat/ObservabilityAssistant";
import AIService from "../../../../../Server/Services/AIService";
import LLMService, {
  LLMCompletionRequest,
  LLMCompletionResponse,
} from "../../../../../Server/Utils/LLM/LLMService";
import AiTokenCount from "../../../../../Types/AI/AiTokenCount";
import LlmType from "../../../../../Types/LLM/LlmType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE MODEL AN EVAL RUNS (issue #6800): one provider and model, named
 * outright on the command line, called straight through LLMService - no
 * project billed, no AI Log written - so a replay's score measures the
 * change under test and not a project's default of the day.
 *
 * Under test: the provider config it builds from the options (nothing it was
 * not given), that every call goes to LLMService.getCompletion as the loop
 * asked for it, with no provider error details (the prompt holds a
 * project's telemetry), and the reply the loop reads back: the content, the
 * tool calls, the stop reason, the tokens as OneUptime counts them, and the
 * provider and model that answered.
 */

const CALL: ObservabilityAssistantModelCall = {
  messages: [
    { role: "system", content: "You are OneUptime AI." },
    { role: "user", content: "Why is checkout failing?" },
  ],
  tools: [
    {
      name: "search_logs",
      description: "Search logs.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
  maxTokens: 4096,
  temperature: 0.2,
};

function completion(
  overrides: Partial<LLMCompletionResponse> = {},
): LLMCompletionResponse {
  return {
    content: "The pool ran dry [C1].",
    toolCalls: undefined,
    stopReason: "stop",
    usage: {
      promptTokens: 1000,
      completionTokens: 200,
      totalTokens: 1200,
    },
    ...overrides,
  };
}

function mockCompletion(
  response: LLMCompletionResponse = completion(),
): SpyInstance<typeof LLMService.getCompletion> {
  return jest.spyOn(LLMService, "getCompletion").mockResolvedValue(response);
}

function sentRequest(
  getCompletion: SpyInstance<typeof LLMService.getCompletion>,
): LLMCompletionRequest {
  return getCompletion.mock.calls[0]![0];
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PinnedModel.isLlmType", () => {
  test("knows every provider type by its exact name, and nothing else", () => {
    for (const llmType of Object.values(LlmType)) {
      expect(PinnedModel.isLlmType(llmType)).toBe(true);
    }

    expect(PinnedModel.isLlmType("anthropic")).toBe(false);
    expect(PinnedModel.isLlmType("Claude")).toBe(false);
    expect(PinnedModel.isLlmType("")).toBe(false);
  });
});

describe("PinnedModel.getProviderConfig", () => {
  test("names only the provider when nothing else is given: its default model, its default endpoint", () => {
    expect(
      PinnedModel.getProviderConfig({ llmType: LlmType.Anthropic }),
    ).toEqual({ llmType: LlmType.Anthropic });
  });

  test("carries the model, the key, the endpoint and the timeout it is given", () => {
    expect(
      PinnedModel.getProviderConfig({
        llmType: LlmType.OpenAICompatible,
        modelName: "qwen3-32b",
        apiKey: "sk-eval",
        baseUrl: "http://localhost:8000/v1",
        requestTimeoutInSeconds: 600,
      }),
    ).toEqual({
      llmType: LlmType.OpenAICompatible,
      modelName: "qwen3-32b",
      apiKey: "sk-eval",
      baseUrl: "http://localhost:8000/v1",
      requestTimeoutInSeconds: 600,
    });
  });

  test("an empty option is left out, never sent as an empty value", () => {
    const config: Record<string, unknown> = PinnedModel.getProviderConfig({
      llmType: LlmType.OpenAI,
      modelName: "",
      apiKey: "",
      baseUrl: "",
      requestTimeoutInSeconds: 0,
    }) as unknown as Record<string, unknown>;

    expect(Object.keys(config)).toEqual(["llmType"]);
  });

  test("is never a global provider: an eval's endpoint is the operator's own", () => {
    expect(
      PinnedModel.getProviderConfig({
        llmType: LlmType.Ollama,
        baseUrl: "http://10.0.0.5:11434",
      }).isGlobalProvider,
    ).toBeUndefined();
  });
});

describe("PinnedModel.create", () => {
  test("sends the loop's call to LLMService as it was asked, without provider error details", async () => {
    const getCompletion: SpyInstance<typeof LLMService.getCompletion> =
      mockCompletion();
    const callModel: PinnedModelCall = PinnedModel.create({
      llmType: LlmType.Anthropic,
      modelName: "claude-opus-5-5",
      apiKey: "sk-ant-eval",
    });

    await callModel(CALL);

    expect(getCompletion).toHaveBeenCalledTimes(1);
    expect(sentRequest(getCompletion)).toEqual({
      llmProviderConfig: {
        llmType: LlmType.Anthropic,
        modelName: "claude-opus-5-5",
        apiKey: "sk-ant-eval",
      },
      messages: CALL.messages,
      tools: CALL.tools,
      maxTokens: 4096,
      temperature: 0.2,
      includeProviderErrorDetails: false,
    });
  });

  test("a call that must answer without tools is sent without tools, at the temperature it names", async () => {
    const getCompletion: SpyInstance<typeof LLMService.getCompletion> =
      mockCompletion();

    await PinnedModel.create({ llmType: LlmType.OpenAI })({
      messages: CALL.messages,
      tools: undefined,
      maxTokens: 20,
      temperature: 0,
    });

    const request: LLMCompletionRequest = sentRequest(getCompletion);

    expect(request.tools).toBeUndefined();
    expect(request.maxTokens).toBe(20);
    expect(request.temperature).toBe(0);
  });

  test("bills no project and writes no AI Log: AIService is never asked", async () => {
    mockCompletion();
    const executeWithLogging: SpyInstance<typeof AIService.executeWithLogging> =
      jest.spyOn(AIService, "executeWithLogging");

    await PinnedModel.create({ llmType: LlmType.Anthropic })(CALL);

    expect(executeWithLogging).not.toHaveBeenCalled();
  });

  test("hands back the content, the tool calls and the stop reason as the provider gave them", async () => {
    mockCompletion(
      completion({
        content: "Looking at the logs.",
        toolCalls: [
          {
            id: "call_1",
            name: "search_logs",
            arguments: { query: "checkout" },
          },
        ],
        stopReason: "tool_use",
      }),
    );

    const reply: ObservabilityAssistantModelReply = await PinnedModel.create({
      llmType: LlmType.Anthropic,
      modelName: "claude-opus-5-5",
    })(CALL);

    expect(reply.content).toBe("Looking at the logs.");
    expect(reply.toolCalls).toEqual([
      { id: "call_1", name: "search_logs", arguments: { query: "checkout" } },
    ]);
    expect(reply.stopReason).toBe("tool_use");
  });

  test("a reply with no content reads as empty, never undefined", async () => {
    mockCompletion(
      completion({
        content: undefined as unknown as string,
        stopReason: "length",
      }),
    );

    const reply: ObservabilityAssistantModelReply = await PinnedModel.create({
      llmType: LlmType.OpenAI,
    })(CALL);

    expect(reply.content).toBe("");
    expect(reply.stopReason).toBe("length");
  });

  test("counts the tokens as OneUptime counts them, cached ones at the model's own prices", async () => {
    mockCompletion(
      completion({
        usage: {
          promptTokens: 24_000,
          completionTokens: 117,
          totalTokens: 24_117,
          cachedInputTokens: 20_000,
          cacheCreationTokens: 600,
        },
        modelName: "claude-sonnet-5-5",
      }),
    );

    const reply: ObservabilityAssistantModelReply = await PinnedModel.create({
      llmType: LlmType.Anthropic,
    })(CALL);

    expect(reply.tokenCount).toBe(
      AiTokenCount.count({
        totalTokens: 24_117,
        cachedInputTokens: 20_000,
        cacheCreationTokens: 600,
        modelName: "claude-sonnet-5-5",
      }),
    );
    // Fewer than were sent: a cached token weighs what it costs.
    expect(reply.tokenCount).toBeLessThan(24_117);
  });

  test("a reply with no usage counts no tokens", async () => {
    mockCompletion(completion({ usage: undefined }));

    const reply: ObservabilityAssistantModelReply = await PinnedModel.create({
      llmType: LlmType.Ollama,
    })(CALL);

    expect(reply.tokenCount).toBe(0);
  });

  test("names the provider, and the model the provider says answered over the one asked for", async () => {
    mockCompletion(completion({ modelName: "claude-opus-5-5-20261101" }));

    const reply: ObservabilityAssistantModelReply = await PinnedModel.create({
      llmType: LlmType.Anthropic,
      modelName: "claude-opus-5-5",
    })(CALL);

    expect(reply.providerName).toBe(LlmType.Anthropic);
    expect(reply.modelName).toBe("claude-opus-5-5-20261101");
  });

  test("the model asked for, when the provider does not say; none when neither does", async () => {
    mockCompletion(completion({ modelName: undefined }));

    expect(
      (
        await PinnedModel.create({
          llmType: LlmType.OpenAI,
          modelName: "gpt-5.6",
        })(CALL)
      ).modelName,
    ).toBe("gpt-5.6");
    expect(
      (await PinnedModel.create({ llmType: LlmType.OpenAI })(CALL)).modelName,
    ).toBeUndefined();
  });

  test("a provider that fails fails the call: the loop decides what then", async () => {
    jest
      .spyOn(LLMService, "getCompletion")
      .mockRejectedValue(new Error("401 Unauthorized"));

    await expect(
      PinnedModel.create({ llmType: LlmType.Anthropic })(CALL),
    ).rejects.toThrow("401 Unauthorized");
  });

  test("one model for every call of a run: the config is built once and reused", async () => {
    const getCompletion: SpyInstance<typeof LLMService.getCompletion> =
      mockCompletion();
    const callModel: PinnedModelCall = PinnedModel.create({
      llmType: LlmType.Mistral,
      modelName: "mistral-large",
    });

    await callModel(CALL);
    await callModel(CALL);

    expect(getCompletion).toHaveBeenCalledTimes(2);
    expect(getCompletion.mock.calls[0]![0].llmProviderConfig).toEqual(
      getCompletion.mock.calls[1]![0].llmProviderConfig,
    );
  });
});
