import API from "../../../../Utils/API";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMProviderConfig,
  OPENAI_STREAM_OPTIONS,
  REASONING_WITHOUT_ANSWER_ERROR,
} from "../../../../Server/Utils/LLM/LLMService";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import {
  CUT_OFF_INSIDE_REASONING_STREAM,
  DEEPSEEK_API_STREAM,
  DEEPSEEK_DISTILL_MODEL,
  ERROR_EVENT_STREAM,
  MAGISTRAL_STREAM,
  MODEL_STUDIO_QWQ_ANSWER,
  MODEL_STUDIO_QWQ_STREAM,
  OLLAMA_OPENAI_COMPATIBLE_STREAM,
  QWEN3_OWN_BLOCK_STREAM,
  ROOT_CAUSE_ANSWER,
  ROOT_CAUSE_REASONING,
  STRAY_CLOSING_TAG_ANSWER,
  STRAY_CLOSING_TAG_STREAM,
  TOOL_CALL_STREAM,
  VLLM_TEMPLATE_OPENED_STREAM,
  contentChunk,
  toEventStream,
} from "./ReasoningModelReplies";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * NO PROVIDER'S REPLY IS READ WITH THE MODEL'S REASONING IN IT (#11255).
 *
 * A self-hosted OneUptime with an internal reasoning model answered
 * "</think>I now have a comprehensive picture of this incident..." in Ask
 * AI and on postmortem pages. LLMService took the provider's text as the
 * answer, and the provider had left the model's reasoning tags in it. Every
 * wire's reply now goes through one reading (LLMService.toAnswer,
 * ModelReasoning), non-streamed and streamed alike, mocked here at the HTTP
 * boundary as the other LLMService suites are.
 * ---------------------------------------------------------------------------
 */

type PostSpy = ReturnType<typeof jest.spyOn>;

const ISSUE_ANSWER: string =
  "I now have a comprehensive picture of this incident. Let me summarize my findings.";

const vllmConfig: LLMProviderConfig = {
  llmType: LlmType.OpenAICompatible,
  baseUrl: "http://vllm.internal:8000/v1",
  modelName: DEEPSEEK_DISTILL_MODEL,
};

const groqConfig: LLMProviderConfig = {
  llmType: LlmType.Groq,
  apiKey: "test-key",
  modelName: "deepseek-r1-distill-llama-70b",
};

const mistralConfig: LLMProviderConfig = {
  llmType: LlmType.Mistral,
  apiKey: "test-key",
  modelName: "magistral-medium-2509",
};

const azureConfig: LLMProviderConfig = {
  llmType: LlmType.AzureOpenAI,
  apiKey: "test-key",
  baseUrl: "https://example.openai.azure.com/openai/v1",
  modelName: "DeepSeek-R1",
};

const ollamaConfig: LLMProviderConfig = {
  llmType: LlmType.Ollama,
  baseUrl: "http://ollama.internal:11434",
  modelName: "deepseek-r1:14b",
};

const anthropicConfig: LLMProviderConfig = {
  llmType: LlmType.Anthropic,
  apiKey: "test-key",
  baseUrl: "http://litellm.internal:4000",
  modelName: "claude-sonnet-4-5",
};

// An OpenAI-wire answer whose message is `message`.
const openAIBody: (message: JSONObject, finishReason?: string) => JSONObject = (
  message: JSONObject,
  finishReason?: string,
): JSONObject => {
  return {
    choices: [
      {
        index: 0,
        message: { role: "assistant", ...message },
        finish_reason: finishReason ?? "stop",
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  };
};

const mockJson: (body: JSONObject) => PostSpy = (body: JSONObject): PostSpy => {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData: body,
  } as unknown as HTTPResponse<JSONObject>) as PostSpy;
};

// A provider that streams: its body is the event stream's text.
const streamedResponse: (stream: string) => HTTPResponse<JSONObject> = (
  stream: string,
): HTTPResponse<JSONObject> => {
  return new HTTPResponse<JSONObject>(200, stream as unknown as JSONObject, {
    "content-type": "text/event-stream",
  });
};

const mockStream: (stream: string) => PostSpy = (stream: string): PostSpy => {
  return jest
    .spyOn(API, "post")
    .mockResolvedValue(streamedResponse(stream)) as PostSpy;
};

const complete: (
  config: LLMProviderConfig,
  request?: Partial<LLMCompletionRequest>,
) => Promise<LLMCompletionResponse> = (
  config: LLMProviderConfig,
  request?: Partial<LLMCompletionRequest>,
): Promise<LLMCompletionResponse> => {
  return LLMService.getCompletion({
    llmProviderConfig: config,
    messages: [
      {
        role: "user",
        content: "What is the most likely root cause of this incident?",
      },
    ],
    requestRetries: 0,
    ...(request || {}),
  });
};

// What the request carried, as the provider got it.
const sentBody: (spy: PostSpy, call?: number) => JSONObject = (
  spy: PostSpy,
  call?: number,
): JSONObject => {
  return (spy.mock.calls[call ?? 0]![0] as { data: JSONObject }).data;
};

beforeEach(() => {
  stubLLMEgressGuard();
});

afterEach(() => {
  jest.restoreAllMocks();
  LLMService.clearRequestAdaptationCache();
  LLMService.clearServedModelCache();
});

describe("issue #11255: the stray </think>, on every wire", () => {
  test("a reasoning parser's leftover closing tag (the answer the issue shows)", async () => {
    mockJson(
      openAIBody({
        content: `</think>${ISSUE_ANSWER}`,
        reasoning_content: "The timeline shows the deploy first.",
      }),
    );

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe(ISSUE_ANSWER);
    expect(response.stopReason).toBe("stop");
    expect(response.reasoning).toEqual({ startedInsideReasoning: true });
  });

  test("vLLM with no reasoning parser: the reasoning a template opened, then its closing tag", async () => {
    mockJson(
      openAIBody({
        content: `${ROOT_CAUSE_REASONING}\n</think>\n\n${ROOT_CAUSE_ANSWER}`,
      }),
    );

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
    expect(response.content).not.toContain("Okay, so the user");
    expect(response.reasoning).toEqual({ startedInsideReasoning: true });
  });

  test("Groq's raw reasoning format: the model's own block", async () => {
    mockJson(
      openAIBody({
        content: `<think>\n${ROOT_CAUSE_REASONING}\n</think>\n\n${ROOT_CAUSE_ANSWER}`,
      }),
    );

    const response: LLMCompletionResponse = await complete(groqConfig);

    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
    expect(response.reasoning).toEqual({ startedInsideReasoning: false });
  });

  test("DeepSeek-R1 on Azure AI Foundry, which answers with its block in the text", async () => {
    mockJson(
      openAIBody({
        content: `<think>\n${ROOT_CAUSE_REASONING}\n</think>\n\n${ROOT_CAUSE_ANSWER}`,
      }),
    );

    const response: LLMCompletionResponse = await complete(azureConfig);

    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
    expect(response.modelName).toBe("DeepSeek-R1");
  });

  test("an older Ollama, which leaves deepseek-r1's block in message.content", async () => {
    mockJson({
      model: "deepseek-r1:14b",
      message: {
        role: "assistant",
        content: `<think>\n${ROOT_CAUSE_REASONING}\n</think>\n\n${ROOT_CAUSE_ANSWER}`,
      },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 100,
      eval_count: 50,
    });

    const response: LLMCompletionResponse = await complete(ollamaConfig);

    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
    expect(response.modelName).toBe("deepseek-r1:14b");
    expect(response.usage?.totalTokens).toBe(150);
  });

  test("a gateway speaking the Anthropic wire for a reasoning model", async () => {
    mockJson({
      type: "message",
      role: "assistant",
      content: [
        { type: "text", text: `${ROOT_CAUSE_REASONING}</think>\n\n` },
        { type: "text", text: ROOT_CAUSE_ANSWER },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const response: LLMCompletionResponse = await complete(anthropicConfig);

    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
  });

  test("a tool call's text carries no reasoning either", async () => {
    mockJson(
      openAIBody(
        {
          content: "I should look at the incident.\n</think>\n\n",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "query_incidents",
                arguments: '{"incidentId":"abc"}',
              },
            },
          ],
        },
        "tool_calls",
      ),
    );

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe("");
    expect(response.stopReason).toBe("tool_use");
    expect(response.toolCalls?.[0]?.arguments).toEqual({ incidentId: "abc" });
  });
});

describe("reasoning a provider sends apart from the text", () => {
  test("reasoning_content (DeepSeek, vLLM, SGLang, Model Studio) is never the answer", async () => {
    mockJson(
      openAIBody({
        content: ROOT_CAUSE_ANSWER,
        reasoning_content: ROOT_CAUSE_REASONING,
      }),
    );

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
    expect(response.reasoning).toEqual({ startedInsideReasoning: false });
  });

  test("reasoning (newer vLLM, OpenRouter, Groq's parsed format) is never the answer", async () => {
    mockJson(
      openAIBody({
        content: ROOT_CAUSE_ANSWER,
        reasoning: ROOT_CAUSE_REASONING,
      }),
    );

    const response: LLMCompletionResponse = await complete(groqConfig);

    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
    expect(response.reasoning).toBeDefined();
  });

  test("Magistral's content parts: the thinking part is left out", async () => {
    mockJson(
      openAIBody({
        content: [
          {
            type: "thinking",
            thinking: [{ type: "text", text: ROOT_CAUSE_REASONING }],
          },
          { type: "text", text: ROOT_CAUSE_ANSWER },
        ],
      }),
    );

    const response: LLMCompletionResponse = await complete(mistralConfig);

    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
    expect(typeof response.content).toBe("string");
    expect(response.reasoning).toBeDefined();
  });

  test("content parts of text only are joined", async () => {
    mockJson(
      openAIBody({
        content: [
          { type: "text", text: "The deploy " },
          { type: "text", text: "is the cause." },
        ],
      }),
    );

    const response: LLMCompletionResponse = await complete(mistralConfig);

    expect(response.content).toBe("The deploy is the cause.");
    expect(response.reasoning).toBeUndefined();
  });

  test("Ollama's message.thinking is never the answer", async () => {
    mockJson({
      model: "deepseek-r1:14b",
      message: {
        role: "assistant",
        content: ROOT_CAUSE_ANSWER,
        thinking: ROOT_CAUSE_REASONING,
      },
      done: true,
      done_reason: "stop",
    });

    const response: LLMCompletionResponse = await complete(ollamaConfig);

    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
    expect(response.reasoning).toEqual({ startedInsideReasoning: false });
  });

  test("Anthropic's thinking blocks stay out, as they always did", async () => {
    mockJson({
      type: "message",
      role: "assistant",
      content: [
        { type: "thinking", thinking: ROOT_CAUSE_REASONING, signature: "sig" },
        { type: "text", text: ROOT_CAUSE_ANSWER },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const response: LLMCompletionResponse = await complete(anthropicConfig);

    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
    expect(response.reasoning).toEqual({ startedInsideReasoning: false });
  });

  test("an empty reasoning field says nothing", async () => {
    mockJson(openAIBody({ content: "OK", reasoning_content: "" }));

    expect((await complete(vllmConfig)).reasoning).toBeUndefined();
  });
});

describe("a reply that is only reasoning", () => {
  test("the model stopped without an answer: an error that says so, not an empty answer", async () => {
    mockJson(openAIBody({ content: `<think>${ROOT_CAUSE_REASONING}</think>` }));

    await expect(complete(vllmConfig)).rejects.toThrow(
      REASONING_WITHOUT_ANSWER_ERROR,
    );
  });

  test("a block it opened and never closed, with nothing cut off", async () => {
    mockJson(openAIBody({ content: `<think>${ROOT_CAUSE_REASONING}` }));

    await expect(complete(vllmConfig)).rejects.toThrow(
      REASONING_WITHOUT_ANSWER_ERROR,
    );
  });

  test("its reasoning in a field of its own, and no content", async () => {
    mockJson(
      openAIBody({ content: null, reasoning_content: ROOT_CAUSE_REASONING }),
    );

    await expect(complete(vllmConfig)).rejects.toThrow(
      REASONING_WITHOUT_ANSWER_ERROR,
    );
  });

  test("Ollama's thinking and no content", async () => {
    mockJson({
      model: "deepseek-r1:14b",
      message: { role: "assistant", content: "", thinking: "Hmm." },
      done: true,
      done_reason: "stop",
    });

    await expect(complete(ollamaConfig)).rejects.toThrow(
      REASONING_WITHOUT_ANSWER_ERROR,
    );
  });

  test("cut off by the output limit while it thought: an empty, cut-off answer", async () => {
    mockJson(
      openAIBody({ content: `<think>${ROOT_CAUSE_REASONING}` }, "length"),
    );

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe("");
    expect(response.stopReason).toBe("length");
  });

  test("with a tool call: the call is the reply", async () => {
    mockJson(
      openAIBody(
        {
          content: "<think>I need the incident.</think>",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: { name: "query_incidents", arguments: "{}" },
            },
          ],
        },
        "tool_calls",
      ),
    );

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe("");
    expect(response.stopReason).toBe("tool_use");
  });

  test("an empty reply with no reasoning is as it always was", async () => {
    mockJson(openAIBody({ content: "" }));

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe("");
    expect(response.reasoning).toBeUndefined();
  });
});

describe("an answer that is not the model's reasoning reaches its caller as written", () => {
  const ANSWERS: ReadonlyArray<string> = [
    "I think the root cause is the connection pool.",
    "To strip a model's reasoning, remove `</think>` and everything before it.",
    "Your app's model printed:\n\n```\nOkay.</think>The cause is X.\n```\n\nIts server needs a reasoning parser.",
    "Models wrap their reasoning in <think> and </think>.",
    "\n\n  Leading and trailing white space.  \n",
  ];

  test.each(ANSWERS)("on the OpenAI wire: %j", async (answer: string) => {
    mockJson(openAIBody({ content: answer }));

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe(answer);
    expect(response.reasoning).toBeUndefined();
  });

  test.each(ANSWERS)("on Ollama's wire: %j", async (answer: string) => {
    mockJson({
      model: "llama3.1",
      message: { role: "assistant", content: answer },
      done: true,
      done_reason: "stop",
    });

    expect((await complete(ollamaConfig)).content).toBe(answer);
  });

  test.each(ANSWERS)("on the Anthropic wire: %j", async (answer: string) => {
    mockJson({
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: answer }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    expect((await complete(anthropicConfig)).content).toBe(answer);
  });

  test.each(ANSWERS)("streamed: %j", async (answer: string) => {
    mockStream(
      toEventStream([
        contentChunk({ model: "m", delta: { content: answer } }),
        contentChunk({ model: "m", delta: {}, finishReason: "stop" }),
      ]),
    );

    expect((await complete(vllmConfig)).content).toBe(answer);
  });
});

describe("a streamed answer is read whole, then like any other", () => {
  test.each([
    [
      "vLLM, a template-opened block split across chunks",
      VLLM_TEMPLATE_OPENED_STREAM,
      ROOT_CAUSE_ANSWER,
    ],
    [
      "a parser's stray closing tag split across chunks",
      STRAY_CLOSING_TAG_STREAM,
      STRAY_CLOSING_TAG_ANSWER,
    ],
    [
      "Qwen3's own block split across chunks",
      QWEN3_OWN_BLOCK_STREAM,
      ROOT_CAUSE_ANSWER,
    ],
    ["DeepSeek's API", DEEPSEEK_API_STREAM, ROOT_CAUSE_ANSWER],
    ["Model Studio's QwQ", MODEL_STUDIO_QWQ_STREAM, MODEL_STUDIO_QWQ_ANSWER],
    [
      "Ollama's OpenAI-compatible endpoint",
      OLLAMA_OPENAI_COMPATIBLE_STREAM,
      "The deploy is the cause.",
    ],
    ["Magistral", MAGISTRAL_STREAM, "The deploy is the cause."],
  ])("%s", async (_stream: string, stream: string, answer: string) => {
    mockStream(stream);

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe(answer);
    expect(response.stopReason).toBe("stop");
    expect(response.reasoning).toBeDefined();
  });

  test("its usage is counted from the stream's last chunk", async () => {
    mockStream(DEEPSEEK_API_STREAM);

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.usage).toEqual({
      promptTokens: 1840,
      completionTokens: 120,
      totalTokens: 1960,
      cachedInputTokens: undefined,
      cacheCreationTokens: undefined,
    });
  });

  test("its tool calls are read from their pieces", async () => {
    mockStream(TOOL_CALL_STREAM);

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe("");
    expect(response.stopReason).toBe("tool_use");
    expect(response.toolCalls).toEqual([
      {
        id: "chatcmpl-tool-7f",
        name: "query_incidents",
        arguments: { incidentId: "abc" },
        argumentsParseError: undefined,
      },
      {
        id: "chatcmpl-tool-8a",
        name: "query_logs",
        arguments: { limit: 5 },
        argumentsParseError: undefined,
      },
    ]);
  });

  test("one cut off inside its reasoning is an empty, cut-off answer", async () => {
    mockStream(CUT_OFF_INSIDE_REASONING_STREAM);

    const response: LLMCompletionResponse = await complete(vllmConfig);

    expect(response.content).toBe("");
    expect(response.stopReason).toBe("length");
  });

  test("one that sent an error is that error, the provider's words where they may be kept", async () => {
    mockStream(ERROR_EVENT_STREAM);

    await expect(complete(vllmConfig)).rejects.toThrow(
      "OpenAICompatible sent an error in its streamed answer. The model is overloaded. Please try again later.",
    );
  });

  test("and without them where they may not", async () => {
    mockStream(ERROR_EVENT_STREAM);

    const failure: Promise<LLMCompletionResponse> = complete(vllmConfig, {
      includeProviderErrorDetails: false,
    });

    await expect(failure).rejects.toThrow(
      "OpenAICompatible sent an error in its streamed answer.",
    );
    await expect(
      complete(vllmConfig, { includeProviderErrorDetails: false }),
    ).rejects.not.toThrow("overloaded");
  });

  test("on Azure too", async () => {
    mockStream(VLLM_TEMPLATE_OPENED_STREAM);

    expect((await complete(azureConfig)).content).toBe(ROOT_CAUSE_ANSWER);
  });

  test("a body that is text but no stream is no answer, as before", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          "<html>Bad gateway</html>" as unknown as JSONObject,
          {},
        ),
      );

    await expect(complete(vllmConfig)).rejects.toThrow(
      "No response from OpenAICompatible",
    );
  });

  test("cut into two chunks at every place, the answer is the same", async () => {
    const text: string = `${ROOT_CAUSE_REASONING}\n</think>\n\n${ROOT_CAUSE_ANSWER}`;

    for (let cut: number = 0; cut <= text.length; cut++) {
      jest.restoreAllMocks();
      stubLLMEgressGuard();
      mockStream(
        toEventStream([
          contentChunk({ model: "m", delta: { content: text.slice(0, cut) } }),
          contentChunk({ model: "m", delta: { content: text.slice(cut) } }),
          contentChunk({ model: "m", delta: {}, finishReason: "stop" }),
        ]),
      );

      expect((await complete(vllmConfig)).content).toBe(ROOT_CAUSE_ANSWER);
    }
  });
});

describe("a request the operator streams", () => {
  test("asks the stream to end with what it used, so its tokens are counted", async () => {
    const post: PostSpy = mockStream(DEEPSEEK_API_STREAM);

    await complete(vllmConfig, { additionalParams: { stream: true } });

    expect(sentBody(post)["stream"]).toBe(true);
    expect(sentBody(post)["stream_options"]).toEqual(OPENAI_STREAM_OPTIONS);
  });

  test("keeps the operator's own stream options", async () => {
    const post: PostSpy = mockStream(DEEPSEEK_API_STREAM);

    await complete(vllmConfig, {
      additionalParams: {
        stream: true,
        stream_options: { include_usage: false },
      },
    });

    expect(sentBody(post)["stream_options"]).toEqual({ include_usage: false });
  });

  test("a protected request streams when the operator asked, and is read whole", async () => {
    const post: PostSpy = mockStream(MODEL_STUDIO_QWQ_STREAM);

    const response: LLMCompletionResponse = await complete(vllmConfig, {
      protectRequestParameters: true,
      additionalParams: { stream: true, tools: [{ type: "web_search" }] },
    });

    expect(sentBody(post)["stream"]).toBe(true);
    expect(sentBody(post)["stream_options"]).toEqual(OPENAI_STREAM_OPTIONS);
    // Capability fields still fail closed.
    expect(sentBody(post)["tools"]).toBeUndefined();
    expect(response.content).toBe(MODEL_STUDIO_QWQ_ANSWER);
  });

  test("a protected request is not streamed unless asked, nor by anything but true", async () => {
    const post: PostSpy = mockJson(openAIBody({ content: "OK" }));

    await complete(vllmConfig, { protectRequestParameters: true });
    await complete(vllmConfig, {
      protectRequestParameters: true,
      additionalParams: { stream: "yes" },
    });

    expect(sentBody(post, 0)["stream"]).toBe(false);
    expect(sentBody(post, 1)["stream"]).toBe(false);
    expect(sentBody(post, 0)["stream_options"]).toBeUndefined();
    expect(sentBody(post, 1)["stream_options"]).toBeUndefined();
  });

  test("a request nobody streams carries no stream options", async () => {
    const post: PostSpy = mockJson(openAIBody({ content: "OK" }));

    await complete(vllmConfig);

    expect(sentBody(post)["stream"]).toBeUndefined();
    expect(sentBody(post)["stream_options"]).toBeUndefined();
  });

  test("a server that refuses stream_options is asked again without it", async () => {
    const post: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          400,
          {
            error: {
              message: "Unrecognized request argument supplied: stream_options",
              type: "invalid_request_error",
            },
          },
          {},
        ),
      )
      .mockResolvedValueOnce(streamedResponse(VLLM_TEMPLATE_OPENED_STREAM));

    const response: LLMCompletionResponse = await complete(vllmConfig, {
      additionalParams: { stream: true },
    });

    expect(post).toHaveBeenCalledTimes(2);
    expect(sentBody(post, 0)["stream_options"]).toEqual(OPENAI_STREAM_OPTIONS);
    expect(sentBody(post, 1)["stream_options"]).toBeUndefined();
    expect(sentBody(post, 1)["stream"]).toBe(true);
    expect(response.content).toBe(ROOT_CAUSE_ANSWER);
  });
});
