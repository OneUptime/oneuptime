import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import Sleep from "../../../../Types/Sleep";
import API, { RequestOptions } from "../../../../Utils/API";
import LLMService, {
  LLMCompletionResponse,
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import logger from "../../../../Server/Utils/Logger";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios, {
  AxiosError,
  AxiosHeaders,
  AxiosResponse,
  AxiosStatic,
} from "axios";

jest.mock("axios", () => {
  return Object.assign(jest.fn(), jest.requireActual("axios"));
});

const mockedAxios: jest.MockedFunction<AxiosStatic> =
  axios as unknown as jest.MockedFunction<AxiosStatic>;

interface ProviderCase {
  name: string;
  config: LLMProviderConfig;
  response: JSONObject;
  defaultTimeoutInMs: number;
  expectedRetryDeadlineInMs: number;
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
    // max(5 minutes, 3 x 120s)
    expectedRetryDeadlineInMs: 360_000,
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
    expectedRetryDeadlineInMs: 360_000,
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
    expectedRetryDeadlineInMs: 360_000,
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
    /*
     * A slow provider keeps room for three full-timeout attempts — the same
     * as the two-retry policy this replaced, so nothing regressed for it.
     */
    expectedRetryDeadlineInMs: 900_000,
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

function createAxiosError(data: {
  status?: number | undefined;
  code?: string | undefined;
  message?: string | undefined;
}): AxiosError {
  const error: AxiosError = new Error(
    data.message ?? "request failed",
  ) as AxiosError;

  error.isAxiosError = true;
  error.name = "AxiosError";
  error.config = { headers: new AxiosHeaders() };
  error.toJSON = () => {
    return {};
  };

  if (data.code) {
    error.code = data.code;
  }

  if (data.status !== undefined) {
    error.response = {
      status: data.status,
      statusText: "",
      data: { error: { message: "provider said no" } },
      headers: {},
      config: { headers: new AxiosHeaders() },
    } as unknown as AxiosResponse;
  }

  return error;
}

function createAxiosSuccess(data: JSONObject): AxiosResponse {
  return {
    data: data,
    status: 200,
    statusText: "OK",
    headers: {},
    config: { headers: new AxiosHeaders() },
  } as unknown as AxiosResponse;
}

beforeEach(() => {
  stubLLMEgressGuard();
  LLMService.clearRequestAdaptationCache();

  // Never actually sleep through a backoff ladder in a unit test.
  jest.spyOn(Sleep, "sleep").mockImplementation(async () => {});
});

afterEach(() => {
  mockedAxios.mockReset();
  jest.restoreAllMocks();
});

describe("LLMService default retry policy", () => {
  test.each(providerCases)(
    "$name attempts a provider call ten times with capped, jittered backoff",
    async ({ config, response, expectedRetryDeadlineInMs }: ProviderCase) => {
      const postSpy: PostSpy = mockPost(response);

      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: [{ role: "user", content: "hello" }],
      });

      expect(getPolicy(postSpy)).toEqual(
        expect.objectContaining({
          retries: 9,
          exponentialBackoff: true,
          maxBackoffInMs: LLMService.MAX_BACKOFF_IN_MS,
          retryOnlyOnRetryableErrors: true,
          totalTimeoutInMs: expectedRetryDeadlineInMs,
          // The SSRF guard's settings must survive the policy merge.
          doNotFollowRedirects: true,
        }),
      );
    },
  );

  test("ten attempts means nine retries after the initial request", () => {
    expect(LLMService.DEFAULT_REQUEST_ATTEMPTS).toBe(10);
  });

  test.each(providerCases)(
    "$name still honours a caller that opts out of retries entirely",
    async ({ config, response }: ProviderCase) => {
      const postSpy: PostSpy = mockPost(response);

      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: [{ role: "user", content: "hello" }],
        requestRetries: 0,
      });

      expect(getPolicy(postSpy).retries).toBe(0);
      // The rest of the policy is unchanged by the opt-out.
      expect(getPolicy(postSpy).retryOnlyOnRetryableErrors).toBe(true);
      expect(getPolicy(postSpy).exponentialBackoff).toBe(true);
    },
  );

  test.each(providerCases)(
    "$name honours an explicit retry count between the extremes",
    async ({ config, response }: ProviderCase) => {
      const postSpy: PostSpy = mockPost(response);

      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: [{ role: "user", content: "hello" }],
        requestRetries: 4,
      });

      expect(getPolicy(postSpy).retries).toBe(4);
    },
  );

  test("the capped ladder costs about a minute of sleep, not seventeen", () => {
    let totalInMs: number = 0;

    for (let attempt: number = 0; attempt < 9; attempt++) {
      totalInMs += Math.min(
        2 ** (attempt + 1) * 1000,
        LLMService.MAX_BACKOFF_IN_MS,
      );
    }

    expect(totalInMs).toBeLessThan(90_000);
  });
});

describe("LLMService retry deadline", () => {
  test.each(providerCases)(
    "$name keeps room for three full-timeout attempts",
    async ({
      config,
      response,
      defaultTimeoutInMs,
      expectedRetryDeadlineInMs,
    }: ProviderCase) => {
      const postSpy: PostSpy = mockPost(response);

      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: [{ role: "user", content: "hello" }],
      });

      expect(getPolicy(postSpy).totalTimeoutInMs).toBe(
        expectedRetryDeadlineInMs,
      );
      expect(getPolicy(postSpy).totalTimeoutInMs).toBeGreaterThanOrEqual(
        defaultTimeoutInMs * 3,
      );
    },
  );

  test("a caller that lowers its per-attempt timeout keeps the five-minute floor", async () => {
    const postSpy: PostSpy = mockPost(providerCases[0]!.response);

    await LLMService.getCompletion({
      llmProviderConfig: providerCases[0]!.config,
      messages: [{ role: "user", content: "hello" }],
      requestTimeoutInMs: 12_345,
    });

    expect(getPolicy(postSpy).timeout).toBe(12_345);
    // 3 x 12.345s is well under the floor, so the floor wins.
    expect(getPolicy(postSpy).totalTimeoutInMs).toBe(5 * 60 * 1000);
  });

  test("a caller that raises its per-attempt timeout raises the deadline with it", async () => {
    const postSpy: PostSpy = mockPost(providerCases[0]!.response);

    await LLMService.getCompletion({
      llmProviderConfig: providerCases[0]!.config,
      messages: [{ role: "user", content: "hello" }],
      requestTimeoutInMs: 600_000,
    });

    expect(getPolicy(postSpy).totalTimeoutInMs).toBe(1_800_000);
  });

  test.each(providerCases)(
    "$name lets a caller set the deadline outright",
    async ({ config, response }: ProviderCase) => {
      const postSpy: PostSpy = mockPost(response);

      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: [{ role: "user", content: "hello" }],
        requestRetryDeadlineInMs: 42_000,
      });

      expect(getPolicy(postSpy).totalTimeoutInMs).toBe(42_000);
    },
  );
});

/*
 * The suites above check the policy LLMService hands to API. These drive the
 * whole stack — LLMService through API through a mocked transport — so the
 * policy is proven to actually produce the retries, not just to be requested.
 */
describe("LLMService end to end over a failing transport", () => {
  test("a chat completion survives a rate limit, a reset socket and a 502", async () => {
    mockedAxios
      .mockRejectedValueOnce(createAxiosError({ status: 429 }))
      .mockRejectedValueOnce(
        createAxiosError({ code: "ECONNRESET", message: "socket hang up" }),
      )
      .mockRejectedValueOnce(createAxiosError({ status: 502 }))
      .mockResolvedValueOnce(
        createAxiosSuccess({
          choices: [{ message: { content: "recovered answer" } }],
          usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
        }),
      );

    const completion: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: providerCases[0]!.config,
      messages: [{ role: "user", content: "how do we optimize oneuptime?" }],
    });

    expect(mockedAxios).toHaveBeenCalledTimes(4);
    expect(completion.content).toBe("recovered answer");
    expect(completion.usage?.totalTokens).toBe(7);
  });

  test("the timeout that used to end a chat turn now recovers on a later attempt", async () => {
    const timeout: AxiosError = createAxiosError({
      code: "ECONNABORTED",
      message: "timeout of 120000ms exceeded",
    });

    for (let attempt: number = 0; attempt < 8; attempt++) {
      mockedAxios.mockRejectedValueOnce(timeout);
    }

    mockedAxios.mockResolvedValueOnce(
      createAxiosSuccess({
        choices: [{ message: { content: "answered on the ninth attempt" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    );

    const completion: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: providerCases[0]!.config,
      messages: [{ role: "user", content: "hello" }],
      // Fast attempts, so the wall-clock budget is not what stops the ladder.
      requestTimeoutInMs: 100,
    });

    expect(mockedAxios).toHaveBeenCalledTimes(9);
    expect(completion.content).toBe("answered on the ninth attempt");
  });

  test("a misconfigured provider fails on the first attempt instead of after ten", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    mockedAxios.mockRejectedValue(createAxiosError({ status: 401 }));

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: providerCases[0]!.config,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow();

    expect(mockedAxios).toHaveBeenCalledTimes(1);
  });

  test("an unrecoverable provider is reported after the full budget, not silently", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    mockedAxios.mockRejectedValue(createAxiosError({ status: 503 }));

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: providerCases[0]!.config,
        messages: [{ role: "user", content: "hello" }],
        requestTimeoutInMs: 100,
      }),
    ).rejects.toThrow();

    expect(mockedAxios).toHaveBeenCalledTimes(10);
  });

  test("parameter adaptation costs one attempt per reshape, not a whole ladder", async () => {
    /*
     * A reasoning model rejecting max_tokens is a 400: not retryable, so the
     * adaptation loop pays a single upload to learn it rather than ten.
     */
    mockedAxios.mockImplementation(async (config: unknown) => {
      const body: JSONObject = (config as { data: JSONObject }).data;

      if (body["max_tokens"] !== undefined) {
        throw createAxiosError({ status: 400 });
      }

      return createAxiosSuccess({
        choices: [{ message: { content: "adapted" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    });

    /*
     * axios errors carry the provider payload on error.response.data, which is
     * where getRequestAdaptationForError reads the offending parameter from.
     */
    mockedAxios.mockImplementationOnce(async () => {
      const error: AxiosError = createAxiosError({ status: 400 });
      (error.response as AxiosResponse).data = {
        error: {
          param: "max_tokens",
          code: "unsupported_parameter",
          message: "Use 'max_completion_tokens' instead.",
        },
      };
      throw error;
    });

    const completion: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: providerCases[0]!.config,
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 256,
    });

    expect(completion.content).toBe("adapted");
    // One rejected attempt plus the reshaped one that succeeded.
    expect(mockedAxios).toHaveBeenCalledTimes(2);
  });
});
