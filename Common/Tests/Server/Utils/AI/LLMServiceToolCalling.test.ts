import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMCompletionResponse,
} from "../../../../Server/Utils/LLM/LLMService";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type PostSpy = ReturnType<typeof jest.spyOn>;

function mockPostResponse(jsonData: JSONObject): PostSpy {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData,
  } as unknown as HTTPResponse<JSONObject>) as PostSpy;
}

// These hosts are placeholders; the SSRF guard is covered elsewhere.
beforeEach(() => {
  stubLLMEgressGuard();
});

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
      llmProviderConfig: {
        llmType: LlmType.OpenAI,
        apiKey: "test-key",
        /*
         * Pinned to a legacy (non-reasoning) model: the blank-model default is
         * now a reasoning model that sends max_completion_tokens, and this
         * test asserts the legacy max_tokens request shape.
         */
        modelName: "gpt-4o",
      },
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

  /*
   * num_ctx is the reason additionalParams had to reach the Ollama branch at
   * all. Ollama silently truncates a request that exceeds the server's
   * default context (2048/4096 on common builds) — no error, no warning — and
   * the chat agent's tool belt alone is several thousand tokens. The
   * definitions fall off the end of the prompt and the model then answers
   * that it has no tool for the question, which is exactly the bug users
   * reported. Raising num_ctx is the operator's only lever, and before this
   * change the Ollama branch ignored additionalParams entirely.
   */
  test("merges additionalParams.options into the Ollama options block, keeping the defaults", async () => {
    const spy: PostSpy = mockPostResponse({
      message: { content: "OK" },
    });

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.Ollama,
        baseUrl: "http://localhost:11434",
      },
      messages: [{ role: "user", content: "which incidents are active?" }],
      maxTokens: 512,
      additionalParams: { options: { num_ctx: 32768 } },
    });

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    const options: JSONObject = requestBody["options"] as JSONObject;

    expect(options["num_ctx"]).toBe(32768);

    /*
     * Merged INTO the defaults, not over them: an operator raising num_ctx
     * must not silently lose the sampling temperature or the output cap the
     * caller asked for.
     */
    expect(options["temperature"]).toBe(0.7);
    expect(options["num_predict"]).toBe(512);
  });

  test("applies a non-options additionalParams key at the top level of the body", async () => {
    const spy: PostSpy = mockPostResponse({
      message: { content: "OK" },
    });

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.Ollama,
        baseUrl: "http://localhost:11434",
      },
      messages: [{ role: "user", content: "hi" }],
      // keep_alive is a top-level /api/chat field, not a generation option.
      additionalParams: { keep_alive: "30m" },
    });

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(requestBody["keep_alive"]).toBe("30m");
    // A top-level key must not leak into the generation options.
    expect(
      (requestBody["options"] as JSONObject)["keep_alive"],
    ).toBeUndefined();
  });

  /*
   * additionalParams is operator-supplied tuning stored on the provider row,
   * so it must never be able to replace the conversation, silence the tool
   * belt, swap the model, or flip the request to streaming (which this branch
   * cannot parse). Fail closed on the structural fields regardless of whether
   * the caller protected its request.
   */
  test("additionalParams cannot overwrite model, messages, tools or stream", async () => {
    const spy: PostSpy = mockPostResponse({
      message: { content: "OK" },
    });

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.Ollama,
        baseUrl: "http://localhost:11434",
        modelName: "llama3.1",
      },
      messages: [{ role: "user", content: "which incidents are active?" }],
      tools: [
        {
          name: "query_incidents",
          description: "query incidents",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      additionalParams: {
        model: "attacker-model",
        messages: [],
        tools: [],
        stream: true,
      },
    });

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(requestBody["model"]).toBe("llama3.1");

    const messages: Array<JSONObject> = requestBody[
      "messages"
    ] as Array<JSONObject>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!["content"]).toBe("which incidents are active?");

    const tools: Array<JSONObject> = requestBody["tools"] as Array<JSONObject>;
    expect(tools).toHaveLength(1);
    expect((tools[0]!["function"] as JSONObject)["name"]).toBe(
      "query_incidents",
    );

    // Non-streaming: this branch reads a single JSON body, not an SSE stream.
    expect(requestBody["stream"]).toBe(false);
  });

  test("protectRequestParameters limits top-level additionalParams to the allowlist but still merges options", async () => {
    const spy: PostSpy = mockPostResponse({
      message: { content: "OK" },
    });

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.Ollama,
        baseUrl: "http://localhost:11434",
      },
      messages: [{ role: "user", content: "hi" }],
      protectRequestParameters: true,
      additionalParams: {
        // On the allowlist of generation-safe tuning fields.
        top_p: 0.5,
        // Not on it — a protected caller drops anything it does not know.
        keep_alive: "30m",
        options: { num_ctx: 16384 },
      },
    });

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(requestBody["top_p"]).toBe(0.5);
    expect(requestBody["keep_alive"]).toBeUndefined();

    /*
     * The options merge still applies for a protected caller, and unlike the
     * top-level keys it is not filtered by the allowlist. That is what keeps
     * num_ctx reachable for the chat agent — the caller that protects its
     * request and is also the one whose tool definitions have to survive the
     * context window. Pinned here so the merge is not later "tidied" behind
     * the protection check, which would put the truncation bug back.
     */
    expect((requestBody["options"] as JSONObject)["num_ctx"]).toBe(16384);
  });

  test("a protected caller keeps its own temperature and output cap through an options merge", async () => {
    /*
     * Every Ollama generation knob lives inside `options`, so the merge that
     * makes num_ctx reachable is also the one that would let provider config
     * overwrite what the CALLER owns. Unattended callers protect their
     * request precisely so their temperature and output cap survive provider
     * tuning — the OpenAI wire re-asserts both after applying
     * additionalParams, and the Ollama wire has to match it. Without this,
     * a provider configured with a creative temperature would silently apply
     * to graders and summarisers that asked for a deterministic one.
     */
    const spy: PostSpy = mockPostResponse({
      message: { content: "OK" },
    });

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.Ollama,
        baseUrl: "http://localhost:11434",
      },
      messages: [{ role: "user", content: "hi" }],
      temperature: 0,
      maxTokens: 64,
      protectRequestParameters: true,
      additionalParams: {
        options: {
          num_ctx: 32768,
          temperature: 1.5,
          num_predict: 4096,
        },
      },
    });

    const options: JSONObject = (spy.mock.calls[0]![0] as { data: JSONObject })
      .data["options"] as JSONObject | undefined as JSONObject;

    // The operator's context size still applies — that is the whole point.
    expect(options["num_ctx"]).toBe(32768);

    // The caller's own settings win over the provider's.
    expect(options["temperature"]).toBe(0);
    expect(options["num_predict"]).toBe(64);
  });

  test("an unprotected caller lets provider options tuning through", async () => {
    /*
     * The counterpart to the test above: the chat agent does not protect its
     * request, and an operator who sets a temperature on their provider row
     * expects it to take effect. Protection is what narrows this, not the
     * default.
     */
    const spy: PostSpy = mockPostResponse({
      message: { content: "OK" },
    });

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.Ollama,
        baseUrl: "http://localhost:11434",
      },
      messages: [{ role: "user", content: "hi" }],
      temperature: 0,
      additionalParams: {
        options: { temperature: 1.5 },
      },
    });

    const options: JSONObject = (spy.mock.calls[0]![0] as { data: JSONObject })
      .data["options"] as JSONObject;

    expect(options["temperature"]).toBe(1.5);
  });
});

describe("LLMService — OpenAI-compatible (generic, e.g. vLLM)", () => {
  test("works without an API key and omits the Authorization header", async () => {
    const spy: PostSpy = mockPostResponse({
      choices: [{ message: { content: "OK" } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    });

    const response: LLMCompletionResponse = await LLMService.getCompletion({
      // No apiKey — a keyless self-hosted vLLM server must work.
      llmProviderConfig: {
        llmType: LlmType.OpenAICompatible,
        baseUrl: "http://vllm.local:8000/v1",
        modelName: "meta-llama/Llama-3.1-8B-Instruct",
      },
      messages: [{ role: "user", content: "ping" }],
    });

    expect(response.content).toBe("OK");

    const call: {
      url: { toString: () => string };
      data: JSONObject;
      headers: JSONObject;
    } = spy.mock.calls[0]![0] as {
      url: { toString: () => string };
      data: JSONObject;
      headers: JSONObject;
    };
    expect(call.url.toString()).toContain("/v1/chat/completions");
    expect(call.data["model"]).toBe("meta-llama/Llama-3.1-8B-Instruct");
    expect(call.headers["Authorization"]).toBeUndefined();
  });

  test("sends the Authorization header when an API key is provided", async () => {
    const spy: PostSpy = mockPostResponse({
      choices: [{ message: { content: "OK" } }],
    });

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.OpenAICompatible,
        baseUrl: "http://vllm.local:8000/v1",
        modelName: "my-model",
        apiKey: "secret",
      },
      messages: [{ role: "user", content: "ping" }],
    });

    const call: { headers: JSONObject } = spy.mock.calls[0]![0] as {
      headers: JSONObject;
    };
    expect(call.headers["Authorization"]).toBe("Bearer secret");
  });

  test("requires a base URL", async () => {
    await expect(
      LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.OpenAICompatible,
          modelName: "my-model",
        },
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toThrow("Base URL is required");
  });

  test("requires a model name", async () => {
    await expect(
      LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.OpenAICompatible,
          baseUrl: "http://vllm.local:8000/v1",
        },
        messages: [{ role: "user", content: "ping" }],
      }),
    ).rejects.toThrow("Model Name is required");
  });
});

describe("LLMService — prompt caching", () => {
  test("Anthropic marks system and the last tool with an ephemeral cache breakpoint", async () => {
    const spy: PostSpy = mockPostResponse({
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 12,
        output_tokens: 4,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 8,
      },
    });

    const response: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: { llmType: LlmType.Anthropic, apiKey: "test-key" },
      messages: [
        { role: "system", content: "be helpful" },
        { role: "user", content: "hi" },
      ],
      tools: [
        {
          name: "a",
          description: "a",
          inputSchema: { type: "object", properties: {} },
        },
        {
          name: "b",
          description: "b",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    });

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    // The system prompt is sent as a content-block array with a cache breakpoint.
    const systemBlocks: Array<JSONObject> = requestBody[
      "system"
    ] as Array<JSONObject>;
    expect(Array.isArray(systemBlocks)).toBe(true);
    expect(systemBlocks[0]!["cache_control"]).toEqual({ type: "ephemeral" });

    // Only the last tool carries the breakpoint (it caches the whole block).
    const tools: Array<JSONObject> = requestBody["tools"] as Array<JSONObject>;
    expect(tools[tools.length - 1]!["cache_control"]).toEqual({
      type: "ephemeral",
    });
    expect(tools[0]!["cache_control"]).toBeUndefined();

    // totalTokens folds in cached + cache-creation input tokens (12+100+8+4).
    expect(response.usage!.totalTokens).toBe(124);
    expect(response.usage!.cachedInputTokens).toBe(100);
    expect(response.usage!.cacheCreationTokens).toBe(8);
  });

  test("OpenAI surfaces cached prompt tokens from prompt_tokens_details", async () => {
    mockPostResponse({
      choices: [{ message: { content: "ok" } }],
      usage: {
        prompt_tokens: 50,
        completion_tokens: 5,
        total_tokens: 55,
        prompt_tokens_details: { cached_tokens: 40 },
      },
    });

    const response: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: { llmType: LlmType.OpenAI, apiKey: "test-key" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(response.usage!.cachedInputTokens).toBe(40);
    expect(response.usage!.totalTokens).toBe(55);
  });
});

describe("LLMService — additionalParams (per-provider overrides)", () => {
  test("merges provider additionalParams into the request body", async () => {
    const spy: PostSpy = mockPostResponse({
      choices: [{ message: { content: "OK" } }],
    });

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.OpenAI,
        apiKey: "test-key",
        /*
         * Pinned to a legacy (non-reasoning) model: the blank-model default is
         * now a reasoning model that sends max_completion_tokens, and this
         * test asserts the legacy max_tokens path specifically.
         */
        modelName: "gpt-4o",
      },
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1024,
      additionalParams: { temperature: 0.2, top_p: 0.9 },
    });

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    // additionalParams override defaults and are added to the body...
    expect(requestBody["temperature"]).toBe(0.2);
    expect(requestBody["top_p"]).toBe(0.9);
    // ...while leaving the default max_tokens intact for legacy providers.
    expect(requestBody["max_tokens"]).toBe(1024);
  });

  test("max_completion_tokens in additionalParams drops the legacy max_tokens", async () => {
    const spy: PostSpy = mockPostResponse({
      choices: [{ message: { content: "OK" } }],
    });

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.OpenAI,
        apiKey: "test-key",
        // Legacy model, so max_tokens would be sent unless the override wins.
        modelName: "gpt-4o",
      },
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1024,
      // gpt-5 / o1 / o3 reject max_tokens and require max_completion_tokens.
      additionalParams: { max_completion_tokens: 2048 },
    });

    const requestBody: JSONObject = (
      spy.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    expect(requestBody["max_completion_tokens"]).toBe(2048);
    expect(requestBody["max_tokens"]).toBeUndefined();
  });
});
