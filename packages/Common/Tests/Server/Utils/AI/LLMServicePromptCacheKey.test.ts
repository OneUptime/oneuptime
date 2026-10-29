import API from "../../../../Utils/API";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import logger from "../../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMCompletionResponse,
  LLMProviderConfig,
  OPENAI_PROMPT_CACHE_KEY_PARAMETER,
} from "../../../../Server/Utils/LLM/LLMService";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * OpenAI's prompt_cache_key (the follow-up of #5111 that #5273 listed).
 * OpenAI caches a repeated prompt on its own; the key says which requests
 * belong together - one cache per key, and on models before GPT-5.6 a route
 * to where the earlier ones were cached. OneUptime sends its key
 * (LLMPromptCacheKey) to the OpenAI provider type only, and an endpoint that
 * refuses the field gets the request again without it, remembered like every
 * other refused parameter. And OpenAI's report of what a call wrote to the
 * cache (cache_write_tokens, charged from GPT-5.6) is read beside its reads.
 */

type PostSpy = ReturnType<typeof jest.spyOn>;

const KEY: string = "0123456789abcdef0123456789abcdef";

const OPENAI: LLMProviderConfig = {
  llmType: LlmType.OpenAI,
  apiKey: "sk-test",
  modelName: "gpt-5.1",
};

function reply(usage?: JSONObject): HTTPResponse<JSONObject> {
  return {
    jsonData: {
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      ...(usage ? { usage } : {}),
    },
  } as unknown as HTTPResponse<JSONObject>;
}

function bodyOf(spy: PostSpy, index: number): JSONObject {
  return (spy.mock.calls[index]![0] as { data: JSONObject }).data;
}

function refusal(status: number, data: JSONObject): HTTPErrorResponse {
  return new HTTPErrorResponse(status, data, {});
}

beforeEach(() => {
  stubLLMEgressGuard();
  LLMService.clearRequestAdaptationCache();
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the key goes to OpenAI", () => {
  test("the field's name is OpenAI's", () => {
    expect(OPENAI_PROMPT_CACHE_KEY_PARAMETER).toBe("prompt_cache_key");
  });

  test("a request with a key carries it", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI,
      messages: [{ role: "user", content: "hi" }],
      promptCacheKey: KEY,
    });

    expect(bodyOf(spy, 0)["prompt_cache_key"]).toBe(KEY);
  });

  test("a request without one carries none", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(bodyOf(spy, 0)).not.toHaveProperty("prompt_cache_key");
  });

  test("an OpenAI provider with a Base URL of its own carries it too", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: {
        ...OPENAI,
        baseUrl: "https://openai-proxy.example.com/v1",
      },
      messages: [{ role: "user", content: "hi" }],
      promptCacheKey: KEY,
    });

    expect(bodyOf(spy, 0)["prompt_cache_key"]).toBe(KEY);
  });

  test("an agent loop's call with tools carries it beside the tools", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI,
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
      promptCacheKey: KEY,
      protectRequestParameters: true,
    });

    expect(bodyOf(spy, 0)["prompt_cache_key"]).toBe(KEY);
    expect(bodyOf(spy, 0)["tools"]).toBeDefined();
  });
});

describe("no other provider type gets it", () => {
  test.each([
    [
      "Azure OpenAI",
      {
        llmType: LlmType.AzureOpenAI,
        apiKey: "azure-key",
        baseUrl: "https://contoso.openai.azure.com/openai/v1",
        modelName: "gpt-5.1",
      },
    ],
    ["Groq", { llmType: LlmType.Groq, apiKey: "gsk-test" }],
    ["Mistral", { llmType: LlmType.Mistral, apiKey: "mistral-test" }],
    [
      "an OpenAI-compatible server",
      {
        llmType: LlmType.OpenAICompatible,
        baseUrl: "http://vllm.example.com:8000/v1",
        modelName: "qwen",
      },
    ],
  ])("%s", async (_name: string, config: LLMProviderConfig) => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: config,
      messages: [{ role: "user", content: "hi" }],
      promptCacheKey: KEY,
    });

    expect(JSON.stringify(bodyOf(spy, 0))).not.toContain("prompt_cache_key");
  });

  test("Anthropic", async () => {
    const spy: PostSpy = jest.spyOn(API, "post").mockResolvedValue({
      jsonData: {
        content: [{ type: "text", text: "OK" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 2 },
      },
    } as unknown as HTTPResponse<JSONObject>) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.Anthropic,
        apiKey: "sk-ant-test",
        modelName: "claude-sonnet-5-5",
      },
      messages: [{ role: "user", content: "hi" }],
      promptCacheKey: KEY,
    });

    expect(JSON.stringify(bodyOf(spy, 0))).not.toContain("prompt_cache_key");
  });

  test("Ollama", async () => {
    const spy: PostSpy = jest.spyOn(API, "post").mockResolvedValue({
      jsonData: {
        message: { role: "assistant", content: "OK" },
        done: true,
        prompt_eval_count: 5,
        eval_count: 1,
      },
    } as unknown as HTTPResponse<JSONObject>) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.Ollama,
        baseUrl: "http://ollama.example.com:11434",
        modelName: "llama3.2",
      },
      messages: [{ role: "user", content: "hi" }],
      promptCacheKey: KEY,
    });

    expect(JSON.stringify(bodyOf(spy, 0))).not.toContain("prompt_cache_key");
  });
});

describe("an operator's own key", () => {
  test("in Additional Parameters, it stands", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI,
      messages: [{ role: "user", content: "hi" }],
      additionalParams: { prompt_cache_key: "team-a" },
      promptCacheKey: KEY,
    });

    expect(bodyOf(spy, 0)["prompt_cache_key"]).toBe("team-a");
  });

  test("a protected request keeps only the generation-safe parameters, so it carries OneUptime's", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(reply()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI,
      messages: [{ role: "user", content: "hi" }],
      additionalParams: { prompt_cache_key: "team-a", seed: 7 },
      protectRequestParameters: true,
      promptCacheKey: KEY,
    });

    expect(bodyOf(spy, 0)["prompt_cache_key"]).toBe(KEY);
    expect(bodyOf(spy, 0)["seed"]).toBe(7);
  });
});

describe("an endpoint that refuses the field gets the request again without it", () => {
  test.each([
    [
      "an Azure-style unrecognized argument",
      refusal(400, {
        error: {
          message: "Unrecognized request argument supplied: prompt_cache_key",
          type: "invalid_request_error",
          param: null,
          code: null,
        },
      }),
    ],
    [
      "OpenAI's own unsupported parameter",
      refusal(400, {
        error: {
          message:
            "Unsupported parameter: 'prompt_cache_key' is not supported with this model.",
          type: "invalid_request_error",
          param: "prompt_cache_key",
          code: "unsupported_parameter",
        },
      }),
    ],
    [
      "a FastAPI gateway's 422",
      refusal(422, {
        detail: [
          {
            type: "extra_forbidden",
            loc: ["body", "prompt_cache_key"],
            msg: "Extra inputs are not permitted",
            input: KEY,
          },
        ],
      }),
    ],
    [
      "a gateway that says the property is unsupported",
      refusal(400, {
        error: {
          message: "property 'prompt_cache_key' is unsupported",
          type: "invalid_request_error",
        },
      }),
    ],
  ])("%s", async (_name: string, response: HTTPErrorResponse) => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(response)
      .mockResolvedValue(reply()) as PostSpy;

    const answer: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: OPENAI,
      messages: [{ role: "user", content: "hi" }],
      promptCacheKey: KEY,
    });

    expect(answer.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(bodyOf(spy, 0)["prompt_cache_key"]).toBe(KEY);
    expect(bodyOf(spy, 1)).not.toHaveProperty("prompt_cache_key");

    // Remembered: the next call goes out without it, at once.
    await LLMService.getCompletion({
      llmProviderConfig: OPENAI,
      messages: [{ role: "user", content: "hi again" }],
      promptCacheKey: KEY,
    });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(bodyOf(spy, 2)).not.toHaveProperty("prompt_cache_key");
  });

  test("an error that is not about the key is answered as it is, with the key left in", async () => {
    const spy: PostSpy = jest.spyOn(API, "post").mockResolvedValue(
      refusal(401, {
        error: {
          message: "Incorrect API key provided: sk-test.",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      }),
    ) as PostSpy;

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: OPENAI,
        messages: [{ role: "user", content: "hi" }],
        promptCacheKey: KEY,
        requestRetries: 0,
      }),
    ).rejects.toThrow();

    expect(spy).toHaveBeenCalledTimes(1);
    expect(bodyOf(spy, 0)["prompt_cache_key"]).toBe(KEY);
  });

  test("a value out of range for another parameter is not read as a refusal of the key", async () => {
    const spy: PostSpy = jest.spyOn(API, "post").mockResolvedValue(
      refusal(400, {
        error: {
          message:
            "Invalid 'temperature': decimal above maximum value. Expected a value <= 2, but got 9 instead.",
          type: "invalid_request_error",
          param: "temperature",
          code: "decimal_above_max_value",
        },
      }),
    ) as PostSpy;

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: OPENAI,
        messages: [{ role: "user", content: "hi" }],
        temperature: 9,
        promptCacheKey: KEY,
        requestRetries: 0,
      }),
    ).rejects.toThrow();

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("what OpenAI says a call read from and wrote to its cache", () => {
  test("reads and writes are both read, as parts of the prompt", async () => {
    jest.spyOn(API, "post").mockResolvedValue(
      reply({
        prompt_tokens: 24_117,
        completion_tokens: 900,
        total_tokens: 25_017,
        prompt_tokens_details: {
          cached_tokens: 2_000,
          cache_write_tokens: 20_654,
        },
      }),
    );

    const answer: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: { ...OPENAI, modelName: "gpt-5.6-terra" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(answer.usage).toEqual({
      promptTokens: 24_117,
      completionTokens: 900,
      totalTokens: 25_017,
      cachedInputTokens: 2_000,
      cacheCreationTokens: 20_654,
    });
  });

  test("an earlier model reports no write, and none is read", async () => {
    jest.spyOn(API, "post").mockResolvedValue(
      reply({
        prompt_tokens: 50,
        completion_tokens: 5,
        total_tokens: 55,
        prompt_tokens_details: { cached_tokens: 40 },
      }),
    );

    const answer: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: OPENAI,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(answer.usage).toEqual({
      promptTokens: 50,
      completionTokens: 5,
      totalTokens: 55,
      cachedInputTokens: 40,
      cacheCreationTokens: undefined,
    });
  });

  test.each([
    ["zero", 0],
    ["a negative count", -3],
    ["a string", "12"],
    ["null", null],
    ["NaN", Number.NaN],
  ])(
    "%s for either is none",
    async (_name: string, value: number | string | null) => {
      jest.spyOn(API, "post").mockResolvedValue(
        reply({
          prompt_tokens: 50,
          completion_tokens: 5,
          total_tokens: 55,
          prompt_tokens_details: {
            cached_tokens: value,
            cache_write_tokens: value,
          },
        }),
      );

      const answer: LLMCompletionResponse = await LLMService.getCompletion({
        llmProviderConfig: OPENAI,
        messages: [{ role: "user", content: "hi" }],
      });

      expect(answer.usage?.cachedInputTokens).toBeUndefined();
      expect(answer.usage?.cacheCreationTokens).toBeUndefined();
    },
  );

  test("details that are not an object are none", async () => {
    jest.spyOn(API, "post").mockResolvedValue(
      reply({
        prompt_tokens: 50,
        completion_tokens: 5,
        total_tokens: 55,
        prompt_tokens_details: [40],
      }),
    );

    const answer: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: OPENAI,
      messages: [{ role: "user", content: "hi" }],
    });

    expect(answer.usage?.cachedInputTokens).toBeUndefined();
    expect(answer.usage?.cacheCreationTokens).toBeUndefined();
  });
});
