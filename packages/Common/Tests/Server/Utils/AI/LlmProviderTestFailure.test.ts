import API from "../../../../Utils/API";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import LLMProviderHTTPException from "../../../../Server/Utils/LLM/LLMProviderHTTPException";
import LLMService, {
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import LlmProviderTestFailure, {
  LLM_PROVIDER_TEST_FAILURE_MAX_LENGTH,
  LLM_PROVIDER_TEST_UNKNOWN_FAILURE,
} from "../../../../Server/Utils/LLM/LlmProviderTestFailure";
import logger from "../../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import EgressGuardException, {
  EgressFailureReason,
} from "../../../../Types/Exception/EgressGuardException";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import Sleep from "../../../../Types/Sleep";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What Test LLM Provider says when a provider did not answer
 * (LlmProviderTestFailure), and the answer in parts LLMService hands it
 * (LLMProviderHTTPException): what went wrong and what to check in
 * OneUptime's words, then what the provider said in its own - never its
 * error body as JSON, never the key, never the address. The route, provider
 * by provider, is LlmProviderTestProviders.test.ts.
 */

function httpError(data: {
  statusCode: number;
  llmType?: LlmType;
  providerMessage?: string;
  hint?: string;
}): LLMProviderHTTPException {
  return new LLMProviderHTTPException({
    message: "OpenAI API error: {}",
    statusCode: data.statusCode,
    llmType: data.llmType || LlmType.OpenAI,
    providerMessage: data.providerMessage || "",
    hint: data.hint,
  });
}

describe("an answer with an HTTP error: a sentence for its status, what to check, then the provider's words", () => {
  test.each([
    [
      401,
      "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key.",
    ],
    [
      403,
      "OpenAI refused this API key (HTTP 403). Check that the key may use this model, and any network rules on the account.",
    ],
    [
      404,
      "OpenAI found no such model, or nothing at the Base URL (HTTP 404). Check the Model Name and the Base URL.",
    ],
    [
      429,
      "OpenAI is limiting requests from this API key, or its quota or credits ran out (HTTP 429). Check the account's limits and billing, then test again.",
    ],
    [408, "OpenAI did not answer in time (HTTP 408). Test again in a minute."],
    [504, "OpenAI did not answer in time (HTTP 504). Test again in a minute."],
    [
      500,
      "OpenAI could not answer the request (HTTP 500). Test again in a few minutes.",
    ],
    [
      503,
      "OpenAI could not answer the request (HTTP 503). Test again in a few minutes.",
    ],
    [
      400,
      "OpenAI refused the test request (HTTP 400). Check the Model Name and the Additional Parameters.",
    ],
    [
      422,
      "OpenAI refused the test request (HTTP 422). Check the Model Name and the Additional Parameters.",
    ],
  ])("HTTP %d", (statusCode: number, expected: string) => {
    expect(
      LlmProviderTestFailure.describe(
        httpError({ statusCode }),
        LlmType.OpenAI,
      ),
    ).toBe(expected);
    expect(LlmProviderTestFailure.describeStatus(statusCode, "OpenAI")).toBe(
      expected,
    );
  });

  test("the provider's own words follow, as it said them", () => {
    expect(
      LlmProviderTestFailure.describe(
        httpError({
          statusCode: 401,
          providerMessage: "  Incorrect API key provided: sk-****.  ",
        }),
        LlmType.OpenAI,
      ),
    ).toBe(
      "OpenAI did not accept the API key (HTTP 401). Check the provider's API Key. OpenAI answered: Incorrect API key provided: sk-****.",
    );
  });

  test("OneUptime's own advice for the provider leads instead of the status sentence", () => {
    expect(
      LlmProviderTestFailure.describe(
        httpError({
          statusCode: 401,
          llmType: LlmType.AzureOpenAI,
          hint: "Azure did not accept the API key. Copy KEY 1.",
          providerMessage: "Access denied.",
        }),
        LlmType.AzureOpenAI,
      ),
    ).toBe(
      "Azure did not accept the API key. Copy KEY 1. Azure answered: Access denied.",
    );
  });

  test("every provider is named as a person would name it", () => {
    const expected: Record<LlmType, string> = {
      [LlmType.OpenAI]: "OpenAI",
      [LlmType.AzureOpenAI]: "Azure",
      [LlmType.Anthropic]: "Anthropic",
      [LlmType.Groq]: "Groq",
      [LlmType.Mistral]: "Mistral",
      [LlmType.Ollama]: "Ollama",
      [LlmType.OpenAICompatible]: "The OpenAI-compatible server",
    };

    for (const llmType of Object.values(LlmType)) {
      expect(
        LlmProviderTestFailure.describe(
          httpError({ statusCode: 401, providerMessage: "no" }),
          llmType,
        ),
      ).toBe(
        `${expected[llmType]} did not accept the API key (HTTP 401). Check the provider's API Key. ${expected[llmType]} answered: no`,
      );
    }
  });
});

describe("no answer at all: OneUptime could not reach the provider, why, and to check the Base URL", () => {
  test("a refused connection", () => {
    expect(
      LlmProviderTestFailure.describe(
        new APIException(
          "OpenAI API request failed: the LLM provider refused the connection.",
        ),
        LlmType.OpenAI,
      ),
    ).toBe(
      "OneUptime could not reach OpenAI: the LLM provider refused the connection. Check the Base URL, and that the OneUptime server can reach it.",
    );
  });

  test("an address OneUptime may not connect to", () => {
    expect(
      LlmProviderTestFailure.describe(
        new EgressGuardException(
          "OpenAICompatible API request failed: the LLM provider base URL points to an address OneUptime is not allowed to connect to.",
          EgressFailureReason.AddressBlocked,
        ),
        LlmType.OpenAICompatible,
      ),
    ).toBe(
      "OneUptime could not reach the OpenAI-compatible server: the LLM provider base URL points to an address OneUptime is not allowed to connect to. Check the Base URL, and that the OneUptime server can reach it.",
    );
  });

  test("a failure LLMService words some other way keeps its words, with the advice", () => {
    expect(
      LlmProviderTestFailure.describe(
        new APIException("Something else went wrong."),
        LlmType.Ollama,
      ),
    ).toBe(
      "Something else went wrong. Check the Base URL, and that the OneUptime server can reach it.",
    );
  });
});

describe("anything else", () => {
  test("LLMService's own words are kept as they are", () => {
    expect(
      LlmProviderTestFailure.describe(
        new BadDataException("OpenAI API key is required"),
        LlmType.OpenAI,
      ),
    ).toBe("OpenAI API key is required");
  });

  test("something that is not an exception at all asks to check the configuration", () => {
    for (const error of ["boom", undefined, null, new Error("")]) {
      expect(LlmProviderTestFailure.describe(error, LlmType.OpenAI)).toBe(
        LLM_PROVIDER_TEST_UNKNOWN_FAILURE,
      );
    }
  });

  test("a long answer is cut at the length the route always kept", () => {
    const said: string = LlmProviderTestFailure.describe(
      httpError({ statusCode: 400, providerMessage: "x".repeat(5000) }),
      LlmType.OpenAI,
    );

    expect(said.length).toBe(LLM_PROVIDER_TEST_FAILURE_MAX_LENGTH);
    expect(said.endsWith("…")).toBe(true);
    expect(said.startsWith("OpenAI refused the test request (HTTP 400).")).toBe(
      true,
    );
  });
});

describe("LLMService hands an HTTP error over in parts, its message unchanged", () => {
  let postSpy: ReturnType<typeof jest.spyOn>;

  const OPENAI: LLMProviderConfig = {
    llmType: LlmType.OpenAI,
    apiKey: "sk-test",
    modelName: "gpt-5.1",
  };

  async function failureOf(
    config: LLMProviderConfig,
    includeProviderErrorDetails?: boolean,
  ): Promise<Error> {
    try {
      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: [{ role: "user", content: "hello" }],
        requestRetries: 0,
        ...(includeProviderErrorDetails !== undefined
          ? { includeProviderErrorDetails }
          : {}),
      });
    } catch (error) {
      return error as Error;
    }

    throw new Error("Expected the completion to fail.");
  }

  beforeEach(() => {
    LLMService.clearRequestAdaptationCache();
    stubLLMEgressGuard();
    jest.spyOn(Sleep, "sleep").mockImplementation(async () => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    postSpy = jest.spyOn(API, "post");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const BODY: JSONObject = {
    error: {
      message: "Incorrect API key provided: sk-****.",
      type: "invalid_request_error",
      code: "invalid_api_key",
    },
  };

  test("the status, the provider and its words, beside the message every caller reads", async () => {
    postSpy.mockResolvedValue(new HTTPErrorResponse(401, BODY, {}) as never);

    const error: Error = await failureOf(OPENAI);

    expect(error).toBeInstanceOf(LLMProviderHTTPException);
    // Still a BadDataException, with the message AI Logs and chats always had.
    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe(`OpenAI API error: ${JSON.stringify(BODY)}`);

    const parts: LLMProviderHTTPException = error as LLMProviderHTTPException;
    expect(parts.statusCode).toBe(401);
    expect(parts.llmType).toBe(LlmType.OpenAI);
    expect(parts.providerMessage).toBe("Incorrect API key provided: sk-****.");
    expect(parts.hint).toBeUndefined();
  });

  test("a request that leaves the provider's details out carries none of its words either", async () => {
    postSpy.mockResolvedValue(new HTTPErrorResponse(401, BODY, {}) as never);

    const error: Error = await failureOf(OPENAI, false);

    expect(error).toBeInstanceOf(LLMProviderHTTPException);
    expect(error.message).toBe(
      "OpenAI API request failed. Review the provider configuration and try again.",
    );
    expect((error as LLMProviderHTTPException).providerMessage).toBe("");
    expect(JSON.stringify(error)).not.toContain("Incorrect API key");
  });

  test("Azure's advice travels with it", async () => {
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        401,
        { error: { code: "401", message: "Access denied." } },
        {},
      ) as never,
    );

    const error: Error = await failureOf({
      llmType: LlmType.AzureOpenAI,
      apiKey: "azure-key",
      baseUrl: "https://contoso-ai.openai.azure.com/openai/v1",
      modelName: "gpt-5.1",
    });

    const parts: LLMProviderHTTPException = error as LLMProviderHTTPException;
    expect(parts.llmType).toBe(LlmType.AzureOpenAI);
    expect(parts.hint).toBe(
      "Azure did not accept the API key. Copy KEY 1 or KEY 2 from the Keys and Endpoint page of the same resource the Base URL points to.",
    );
    expect(
      error.message.startsWith(`Azure OpenAI API error: ${parts.hint}`),
    ).toBe(true);
  });

  test("a request too large for the model's context window keeps its own message, as before", async () => {
    postSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { error: "no user query found in messages" },
        {},
      ) as never,
    );

    const error: Error = await failureOf({
      llmType: LlmType.Ollama,
      baseUrl: "http://ollama.example.com:11434",
      modelName: "qwen3.8",
    });

    expect(error).toBeInstanceOf(BadDataException);
    expect(error).not.toBeInstanceOf(LLMProviderHTTPException);
    expect(error.message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
  });
});
