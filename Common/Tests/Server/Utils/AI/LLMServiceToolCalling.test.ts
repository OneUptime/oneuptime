import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMCompletionResponse,
} from "../../../../Server/Utils/LLM/LLMService";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

type PostSpy = ReturnType<typeof jest.spyOn>;

function mockPostResponse(jsonData: JSONObject): PostSpy {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData,
  } as unknown as HTTPResponse<JSONObject>) as PostSpy;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LLMService tool calling — OpenAI-compatible", () => {
  test("serializes tools and parses tool_calls", async () => {
    const spy: PostSpy = mockPostResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "search_logs",
                  arguments: '{"traceId":"abc"}',
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });

    const response: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: { llmType: LlmType.OpenAI, apiKey: "test-key" },
      messages: [{ role: "user", content: "find logs" }],
      tools: [
        {
          name: "search_logs",
          description: "search logs",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      maxTokens: 1024,
    });

    expect(response.stopReason).toBe("tool_use");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.name).toBe("search_logs");
    expect(response.toolCalls![0]!.arguments).toEqual({ traceId: "abc" });

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    expect(requestBody["max_tokens"]).toBe(1024);
    expect(requestBody["tools"]).toHaveLength(1);
  });

  test("tolerates malformed tool-call argument JSON", async () => {
    mockPostResponse({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "search_logs", arguments: "{not-json" },
              },
            ],
          },
        },
      ],
    });

    const response: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: { llmType: LlmType.OpenAI, apiKey: "test-key" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(response.toolCalls![0]!.arguments).toEqual({});
  });
});

describe("LLMService tool calling — Anthropic", () => {
  test("always sends the required max_tokens and parses tool_use blocks", async () => {
    const spy: PostSpy = mockPostResponse({
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "query_metrics",
          input: { metricName: "cpu" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 20, output_tokens: 10 },
    });

    const response: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: { llmType: LlmType.Anthropic, apiKey: "test-key" },
      messages: [
        { role: "system", content: "be helpful" },
        { role: "user", content: "cpu usage?" },
      ],
      tools: [
        {
          name: "query_metrics",
          description: "query metrics",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    // max_tokens is required by the Anthropic API — previously missing.
    expect(requestBody["max_tokens"]).toBe(4096);
    expect(
      (requestBody["tools"] as Array<JSONObject>)[0]!["input_schema"],
    ).toBeDefined();

    // A tool_use-only response must not throw "No text content".
    expect(response.content).toBe("");
    expect(response.stopReason).toBe("tool_use");
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.arguments).toEqual({ metricName: "cpu" });
    expect(response.usage!.totalTokens).toBe(30);
  });

  test("merges consecutive tool results into one user message", async () => {
    const spy: PostSpy = mockPostResponse({
      content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 5 },
    });

    await LLMService.getCompletion({
      llmProviderConfig: { llmType: LlmType.Anthropic, apiKey: "test-key" },
      messages: [
        { role: "user", content: "check two things" },
        {
          role: "assistant",
          content: "",
          toolCalls: [
            { id: "t1", name: "query_incidents", arguments: {} },
            { id: "t2", name: "query_alerts", arguments: {} },
          ],
        },
        { role: "tool", toolCallId: "t1", content: "incidents: none" },
        { role: "tool", toolCallId: "t2", content: "alerts: none" },
      ],
    });

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    const messages: Array<JSONObject> = requestBody[
      "messages"
    ] as Array<JSONObject>;

    // user, assistant(tool_use), single merged user(tool_results)
    expect(messages).toHaveLength(3);
    const merged: Array<JSONObject> = messages[2]![
      "content"
    ] as Array<JSONObject>;
    expect(merged).toHaveLength(2);
    expect(merged[0]!["type"]).toBe("tool_result");
    expect(merged[1]!["tool_use_id"]).toBe("t2");
  });
});

describe("LLMService tool calling — Ollama", () => {
  test("works without an API key and parses object tool arguments", async () => {
    const spy: PostSpy = mockPostResponse({
      message: {
        content: "",
        tool_calls: [
          {
            function: {
              name: "top_exceptions",
              arguments: { limit: 5 },
            },
          },
        ],
      },
    });

    const response: LLMCompletionResponse = await LLMService.getCompletion({
      // No apiKey — keyless self-hosted Ollama must keep working.
      llmProviderConfig: {
        llmType: LlmType.Ollama,
        baseUrl: "http://localhost:11434",
      },
      messages: [{ role: "user", content: "top exceptions" }],
      tools: [
        {
          name: "top_exceptions",
          description: "top exceptions",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]!.arguments).toEqual({ limit: 5 });
    expect(response.toolCalls![0]!.id).toBe("tool_call_0");

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    expect(requestBody["tools"]).toHaveLength(1);
    expect(requestBody["stream"]).toBe(false);
  });
});
