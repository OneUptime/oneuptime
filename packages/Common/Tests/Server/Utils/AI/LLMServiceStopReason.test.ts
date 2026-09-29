import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMCompletionResponse,
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Output-length truncation must surface as stopReason "length" — mapping it to
 * "stop" makes callers present cut-off answers as complete. These tests pin
 * the wire mapping for every provider branch, mocked at the HTTP boundary the
 * same way the other LLMService suites are.
 */

type PostSpy = ReturnType<typeof jest.spyOn>;

function mockPost(response: JSONObject): PostSpy {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData: response,
  } as unknown as HTTPResponse<JSONObject>) as PostSpy;
}

const openAIConfig: LLMProviderConfig = {
  llmType: LlmType.OpenAI,
  apiKey: "test-key",
  modelName: "gpt-test",
};

const azureConfig: LLMProviderConfig = {
  llmType: LlmType.AzureOpenAI,
  apiKey: "test-key",
  baseUrl:
    "https://example.openai.azure.com/openai/deployments/test-deployment",
  modelName: "gpt-test",
};

const anthropicConfig: LLMProviderConfig = {
  llmType: LlmType.Anthropic,
  apiKey: "test-key",
  modelName: "claude-test",
};

const ollamaConfig: LLMProviderConfig = {
  llmType: LlmType.Ollama,
  baseUrl: "http://localhost:11434",
  modelName: "llama-test",
};

function openAIStyleResponse(data: {
  finishReason: string;
  withToolCalls?: boolean;
}): JSONObject {
  const message: JSONObject = {
    role: "assistant",
    content: data.withToolCalls ? null : "partial or complete answer",
  };

  if (data.withToolCalls) {
    message["tool_calls"] = [
      {
        id: "call_1",
        type: "function",
        function: { name: "get_monitor", arguments: '{"monitorId":"m1"}' },
      },
    ];
  }

  return {
    choices: [{ message: message, finish_reason: data.finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

async function getStopReason(
  config: LLMProviderConfig,
  response: JSONObject,
): Promise<LLMCompletionResponse> {
  mockPost(response);

  return LLMService.getCompletion({
    llmProviderConfig: config,
    messages: [{ role: "user", content: "hello" }],
  });
}

beforeEach(() => {
  stubLLMEgressGuard();
});

afterEach(() => {
  jest.restoreAllMocks();
  LLMService.clearRequestAdaptationCache();
});

describe("OpenAI-compatible finish_reason mapping", () => {
  test('maps finish_reason "length" to stopReason "length"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      openAIConfig,
      openAIStyleResponse({ finishReason: "length" }),
    );

    expect(result.stopReason).toBe("length");
  });

  test('maps finish_reason "stop" to stopReason "stop"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      openAIConfig,
      openAIStyleResponse({ finishReason: "stop" }),
    );

    expect(result.stopReason).toBe("stop");
  });

  test('maps finish_reason "tool_calls" with tool calls to "tool_use"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      openAIConfig,
      openAIStyleResponse({ finishReason: "tool_calls", withToolCalls: true }),
    );

    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toHaveLength(1);
  });

  test('keeps "tool_use" for compatible servers that report finish_reason "stop" alongside tool calls', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      openAIConfig,
      openAIStyleResponse({ finishReason: "stop", withToolCalls: true }),
    );

    expect(result.stopReason).toBe("tool_use");
  });

  test('truncation wins over tool calls: finish_reason "length" with tool calls maps to "length"', async () => {
    /*
     * A response cut off mid-tool-call still carries the partial tool_calls
     * array. Executing a truncated call would be wrong, so the wire truth
     * ("length") must win over the tool-call heuristic.
     */
    const result: LLMCompletionResponse = await getStopReason(
      openAIConfig,
      openAIStyleResponse({ finishReason: "length", withToolCalls: true }),
    );

    expect(result.stopReason).toBe("length");
  });

  test("missing finish_reason still maps to a defined stopReason", async () => {
    const response: JSONObject = openAIStyleResponse({ finishReason: "stop" });
    delete ((response["choices"] as Array<JSONObject>)[0] as JSONObject)[
      "finish_reason"
    ];

    const result: LLMCompletionResponse = await getStopReason(
      openAIConfig,
      response,
    );

    expect(result.stopReason).toBe("stop");
  });
});

describe("Azure OpenAI finish_reason mapping", () => {
  test('maps finish_reason "length" to stopReason "length"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      azureConfig,
      openAIStyleResponse({ finishReason: "length" }),
    );

    expect(result.stopReason).toBe("length");
  });

  test('maps finish_reason "stop" to stopReason "stop"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      azureConfig,
      openAIStyleResponse({ finishReason: "stop" }),
    );

    expect(result.stopReason).toBe("stop");
  });
});

describe("Anthropic stop_reason mapping", () => {
  function anthropicResponse(data: {
    stopReason: string;
    withToolUse?: boolean;
  }): JSONObject {
    const content: Array<JSONObject> = [
      { type: "text", text: "partial or complete answer" },
    ];

    if (data.withToolUse) {
      content.push({
        type: "tool_use",
        id: "toolu_1",
        name: "get_monitor",
        input: { monitorId: "m1" },
      });
    }

    return {
      content: content,
      stop_reason: data.stopReason,
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  }

  test('maps stop_reason "max_tokens" to stopReason "length"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      anthropicConfig,
      anthropicResponse({ stopReason: "max_tokens" }),
    );

    expect(result.stopReason).toBe("length");
  });

  test('maps stop_reason "end_turn" to stopReason "stop"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      anthropicConfig,
      anthropicResponse({ stopReason: "end_turn" }),
    );

    expect(result.stopReason).toBe("stop");
  });

  test('maps stop_reason "tool_use" to stopReason "tool_use"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      anthropicConfig,
      anthropicResponse({ stopReason: "tool_use", withToolUse: true }),
    );

    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toHaveLength(1);
  });
});

describe("Ollama done_reason mapping", () => {
  function ollamaResponse(data: {
    doneReason?: string;
    withToolCalls?: boolean;
  }): JSONObject {
    const message: JSONObject = {
      role: "assistant",
      content: "partial or complete answer",
    };

    if (data.withToolCalls) {
      message["tool_calls"] = [
        { function: { name: "get_monitor", arguments: { monitorId: "m1" } } },
      ];
    }

    const response: JSONObject = {
      message: message,
      prompt_eval_count: 1,
      eval_count: 1,
    };

    if (data.doneReason !== undefined) {
      response["done_reason"] = data.doneReason;
    }

    return response;
  }

  test('maps done_reason "length" to stopReason "length"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      ollamaConfig,
      ollamaResponse({ doneReason: "length" }),
    );

    expect(result.stopReason).toBe("length");
  });

  test('maps done_reason "limit" to stopReason "length"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      ollamaConfig,
      ollamaResponse({ doneReason: "limit" }),
    );

    expect(result.stopReason).toBe("length");
  });

  test('maps done_reason "stop" with tool calls to "tool_use"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      ollamaConfig,
      ollamaResponse({ doneReason: "stop", withToolCalls: true }),
    );

    expect(result.stopReason).toBe("tool_use");
    expect(result.toolCalls).toHaveLength(1);
  });

  test('maps done_reason "stop" without tool calls to "stop"', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      ollamaConfig,
      ollamaResponse({ doneReason: "stop" }),
    );

    expect(result.stopReason).toBe("stop");
  });

  test('missing done_reason maps to "stop" for a plain text answer', async () => {
    const result: LLMCompletionResponse = await getStopReason(
      ollamaConfig,
      ollamaResponse({}),
    );

    expect(result.stopReason).toBe("stop");
  });
});
