import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import Sleep from "../../../../Types/Sleep";
import API, { RequestOptions } from "../../../../Utils/API";
import LLMService, {
  LLMProviderConfig,
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

/*
 * An LLM provider's own response timeout (LlmProvider.requestTimeoutInSeconds,
 * issue #6438). The customer's triage failed because a self-hosted model
 * took longer than the 120 seconds every OpenAI-compatible provider waited;
 * nothing could change that. A provider can now wait longer (or shorter):
 * every model call to it waits that long, and LLMService's retry deadline
 * grows with it, so a slow model still gets three full attempts.
 */

interface ProviderCase {
  name: string;
  config: LLMProviderConfig;
  response: JSONObject;
  defaultTimeoutInMs: number;
}

const providerCases: Array<ProviderCase> = [
  {
    name: "OpenAI-compatible",
    config: { llmType: LlmType.OpenAI, apiKey: "test-key", modelName: "gpt-x" },
    response: {
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
    defaultTimeoutInMs: 120_000,
  },
  {
    name: "Azure OpenAI",
    config: {
      llmType: LlmType.AzureOpenAI,
      apiKey: "test-key",
      baseUrl:
        "https://example.openai.azure.com/openai/deployments/test-deployment",
      modelName: "gpt-x",
    },
    response: {
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
    defaultTimeoutInMs: 120_000,
  },
  {
    name: "Anthropic",
    config: {
      llmType: LlmType.Anthropic,
      apiKey: "test-key",
      modelName: "claude-x",
    },
    response: {
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    defaultTimeoutInMs: 120_000,
  },
  {
    name: "Ollama",
    config: {
      llmType: LlmType.Ollama,
      baseUrl: "http://localhost:11434",
      modelName: "llama-x",
    },
    response: {
      message: { role: "assistant", content: "ok" },
      prompt_eval_count: 1,
      eval_count: 1,
    },
    defaultTimeoutInMs: 300_000,
  },
];

type PostSpy = ReturnType<typeof jest.spyOn>;

function mockPost(response: JSONObject): PostSpy {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData: response,
  } as unknown as HTTPResponse<JSONObject>) as PostSpy;
}

function getPolicy(postSpy: PostSpy): RequestOptions {
  return (postSpy.mock.calls[0]![0] as { options: RequestOptions }).options;
}

beforeEach(() => {
  stubLLMEgressGuard();
  LLMService.clearRequestAdaptationCache();
  jest.spyOn(Sleep, "sleep").mockImplementation(async () => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an LLM provider's response timeout", () => {
  test.each(providerCases)(
    "$name waits as long as its provider says, and its retries keep three full attempts",
    async ({ config, response }: ProviderCase) => {
      const postSpy: PostSpy = mockPost(response);

      await LLMService.getCompletion({
        llmProviderConfig: { ...config, requestTimeoutInSeconds: 600 },
        messages: [{ role: "user", content: "hello" }],
      });

      expect(getPolicy(postSpy).timeout).toBe(600_000);
      // max(5 minutes, 3 x 600 s)
      expect(getPolicy(postSpy).totalTimeoutInMs).toBe(1_800_000);
    },
  );

  test.each(providerCases)(
    "$name without one waits its type's default, as before",
    async ({ config, response, defaultTimeoutInMs }: ProviderCase) => {
      const postSpy: PostSpy = mockPost(response);

      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: [{ role: "user", content: "hello" }],
      });

      expect(getPolicy(postSpy).timeout).toBe(defaultTimeoutInMs);
    },
  );

  test.each(providerCases)(
    "$name: a caller's own timeout still wins over the provider's",
    async ({ config, response }: ProviderCase) => {
      const postSpy: PostSpy = mockPost(response);

      await LLMService.getCompletion({
        llmProviderConfig: { ...config, requestTimeoutInSeconds: 600 },
        messages: [{ role: "user", content: "hello" }],
        requestTimeoutInMs: 15_000,
      });

      expect(getPolicy(postSpy).timeout).toBe(15_000);
    },
  );

  test("a shorter timeout is honoured too, with the five-minute retry deadline", async () => {
    const postSpy: PostSpy = mockPost(providerCases[0]!.response);

    await LLMService.getCompletion({
      llmProviderConfig: {
        ...providerCases[0]!.config,
        requestTimeoutInSeconds: 30,
      },
      messages: [{ role: "user", content: "hello" }],
    });

    expect(getPolicy(postSpy).timeout).toBe(30_000);
    expect(getPolicy(postSpy).totalTimeoutInMs).toBe(300_000);
  });
});

describe("LLMService.getProviderTimeoutInMs", () => {
  test.each([
    [120, 120_000],
    [600, 600_000],
    // Held to what the provider form allows.
    [3, 10_000],
    [10, 10_000],
    [3600, 3_600_000],
    [86400, 3_600_000],
    // Whole seconds.
    [90.4, 90_000],
  ])("%d seconds is %d ms", (seconds: number, expected: number) => {
    expect(LLMService.getProviderTimeoutInMs(seconds)).toBe(expected);
  });

  test.each([[undefined], [0], [-5], [NaN], [Infinity]])(
    "%s is no timeout of its own: the type's default holds",
    (seconds: number | undefined) => {
      expect(LLMService.getProviderTimeoutInMs(seconds)).toBeUndefined();
    },
  );

  test("a value that is no number (a stored string) is ignored", () => {
    expect(
      LLMService.getProviderTimeoutInMs("600" as unknown as number),
    ).toBeUndefined();
  });

  test("the bounds are the form's", () => {
    expect(LLMService.MIN_PROVIDER_TIMEOUT_IN_SECONDS).toBe(10);
    expect(LLMService.MAX_PROVIDER_TIMEOUT_IN_SECONDS).toBe(3600);
  });
});
