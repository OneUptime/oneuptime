import API from "../../../../Utils/API";
import logger from "../../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type PostSpy = ReturnType<typeof jest.spyOn>;

const SUCCESS_BODY: JSONObject = {
  choices: [{ message: { content: "OK" } }],
  usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
};

function successResponse(): HTTPResponse<JSONObject> {
  return { jsonData: SUCCESS_BODY } as unknown as HTTPResponse<JSONObject>;
}

/** The verbatim 400 an o-series / gpt-5 deployment returns for max_tokens. */
function maxTokensUnsupportedResponse(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    400,
    {
      error: {
        message:
          "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
        type: "invalid_request_error",
        param: "max_tokens",
        code: "unsupported_parameter",
      },
    },
    {},
  );
}

/** Older models / Azure api-versions before 2024-08-01-preview. param and code are null. */
function maxCompletionTokensUnrecognizedResponse(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    400,
    {
      error: {
        message:
          "Unrecognized request argument supplied: max_completion_tokens",
        type: "invalid_request_error",
        param: null,
        code: null,
      },
    },
    {},
  );
}

function temperatureUnsupportedResponse(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    400,
    {
      error: {
        message:
          "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) value is supported.",
        type: "invalid_request_error",
        param: "temperature",
        code: "unsupported_value",
      },
    },
    {},
  );
}

const AZURE_CONFIG: LLMProviderConfig = {
  llmType: LlmType.AzureOpenAI,
  apiKey: "azure-key",
  baseUrl: "https://example.openai.azure.com/openai/deployments/my-deployment",
  // Azure sends the *deployment* name, which need not resemble the model.
  modelName: "my-deployment",
};

function bodyOf(spy: PostSpy, callIndex: number): JSONObject {
  return (spy.mock.calls[callIndex]![0] as { data: JSONObject }).data;
}

beforeEach(() => {
  LLMService.clearRequestAdaptationCache();
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LLMService — Azure OpenAI max_tokens compatibility", () => {
  test("retries with max_completion_tokens when the deployment rejects max_tokens", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxTokensUnsupportedResponse())
      .mockResolvedValueOnce(successResponse()) as PostSpy;

    const response: { content: string } = await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "Reply with the word: OK" }],
      maxTokens: 16,
    });

    expect(response.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(2);

    // First attempt used the legacy spelling...
    expect(bodyOf(spy, 0)["max_tokens"]).toBe(16);
    expect(bodyOf(spy, 0)["max_completion_tokens"]).toBeUndefined();

    // ...the retry swapped it, preserving the cap and dropping the legacy key.
    expect(bodyOf(spy, 1)["max_completion_tokens"]).toBe(16);
    expect(bodyOf(spy, 1)["max_tokens"]).toBeUndefined();
  });

  test("drops temperature when the deployment rejects it, after the token swap", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxTokensUnsupportedResponse())
      .mockResolvedValueOnce(temperatureUnsupportedResponse())
      .mockResolvedValueOnce(successResponse()) as PostSpy;

    const response: { content: string } = await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0,
      maxTokens: 16,
    });

    expect(response.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(3);

    // Errors arrive one param at a time, so the fixes accumulate.
    expect(bodyOf(spy, 1)["max_completion_tokens"]).toBe(16);
    expect(bodyOf(spy, 1)["temperature"]).toBe(0);

    expect(bodyOf(spy, 2)["max_completion_tokens"]).toBe(16);
    expect(bodyOf(spy, 2)["temperature"]).toBeUndefined();
  });

  test("remembers what the deployment accepted so later calls do not re-probe", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxTokensUnsupportedResponse())
      .mockResolvedValue(successResponse()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });
    expect(spy).toHaveBeenCalledTimes(2);

    await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "hi again" }],
      maxTokens: 32,
    });

    // One extra call only: the second completion got the shape right first try.
    expect(spy).toHaveBeenCalledTimes(3);
    expect(bodyOf(spy, 2)["max_completion_tokens"]).toBe(32);
    expect(bodyOf(spy, 2)["max_tokens"]).toBeUndefined();
  });

  test("re-probes when the model name changes", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxTokensUnsupportedResponse())
      .mockResolvedValue(successResponse()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });
    expect(spy).toHaveBeenCalledTimes(2);

    await LLMService.getCompletion({
      llmProviderConfig: { ...AZURE_CONFIG, modelName: "other-deployment" },
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });

    // A different deployment is a different model: back to the legacy default.
    expect(bodyOf(spy, 2)["max_tokens"]).toBe(16);
  });
});

describe("LLMService — reasoning model detection by name", () => {
  test.each([
    ["gpt-5", true],
    ["gpt-5-mini", true],
    ["gpt5-mini", true],
    ["o1", true],
    ["o1-mini", true],
    ["o3-mini", true],
    ["o4-mini", true],
    ["codex-mini", true],
    ["gpt-4o", false],
    ["gpt-4o-mini", false],
    ["gpt-4.1", false],
    ["gpt-4-turbo", false],
    ["gpt-35-turbo", false],
  ])(
    "%s sends max_completion_tokens up front: %s",
    async (modelName: string, expectsMaxCompletionTokens: boolean) => {
      const spy: PostSpy = jest
        .spyOn(API, "post")
        .mockResolvedValue(successResponse()) as PostSpy;

      await LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.OpenAI,
          apiKey: "test-key",
          modelName: modelName,
        },
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 16,
      });

      // Known reasoning models skip the wasted round trip entirely.
      expect(spy).toHaveBeenCalledTimes(1);
      const body: JSONObject = bodyOf(spy, 0);

      if (expectsMaxCompletionTokens) {
        expect(body["max_completion_tokens"]).toBe(16);
        expect(body["max_tokens"]).toBeUndefined();
      } else {
        expect(body["max_tokens"]).toBe(16);
        expect(body["max_completion_tokens"]).toBeUndefined();
      }
    },
  );
});

describe("LLMService — legacy models that reject max_completion_tokens", () => {
  test("falls back to max_tokens when the endpoint does not recognize max_completion_tokens", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxCompletionTokensUnrecognizedResponse())
      .mockResolvedValueOnce(successResponse()) as PostSpy;

    // A gpt-5-named deployment behind an endpoint that only knows max_tokens.
    const response: { content: string } = await LLMService.getCompletion({
      llmProviderConfig: { ...AZURE_CONFIG, modelName: "gpt-5-mini" },
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });

    expect(response.content).toBe("OK");
    expect(bodyOf(spy, 0)["max_completion_tokens"]).toBe(16);
    expect(bodyOf(spy, 1)["max_tokens"]).toBe(16);
    expect(bodyOf(spy, 1)["max_completion_tokens"]).toBeUndefined();
  });

  test("does not flip-flop when the endpoint rejects both spellings", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxCompletionTokensUnrecognizedResponse())
      .mockResolvedValue(maxTokensUnsupportedResponse()) as PostSpy;

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: { ...AZURE_CONFIG, modelName: "gpt-5-mini" },
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 16,
      }),
    ).rejects.toThrow("Azure OpenAI API error");

    // Each spelling is tried exactly once, then the provider error surfaces.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  test("does not flip-flop when the name heuristic misses and additionalParams chose the new spelling", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxCompletionTokensUnrecognizedResponse())
      .mockResolvedValue(maxTokensUnsupportedResponse()) as PostSpy;

    /*
     * modelName does not match the heuristic, so the adaptation starts at the
     * Default sentinel while additionalParams puts max_completion_tokens on
     * the wire. Both spellings must still be tried at most once each.
     */
    await expect(
      LLMService.getCompletion({
        llmProviderConfig: { ...AZURE_CONFIG, modelName: "prod" },
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 16,
        additionalParams: { max_completion_tokens: 4000 },
      }),
    ).rejects.toThrow("Azure OpenAI API error");

    expect(spy).toHaveBeenCalledTimes(2);
    expect(bodyOf(spy, 0)["max_completion_tokens"]).toBeDefined();
    expect(bodyOf(spy, 1)["max_tokens"]).toBeDefined();
  });

  test("adapts a chain longer than four params rather than giving up short", async () => {
    const reject: (param: string) => HTTPErrorResponse = (
      param: string,
    ): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        400,
        {
          error: {
            message: `Unsupported parameter: '${param}' is not supported with this model.`,
            type: "invalid_request_error",
            param: param,
            code: "unsupported_parameter",
          },
        },
        {},
      );
    };

    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxTokensUnsupportedResponse())
      .mockResolvedValueOnce(reject("temperature"))
      .mockResolvedValueOnce(reject("top_p"))
      .mockResolvedValueOnce(reject("frequency_penalty"))
      .mockResolvedValueOnce(reject("presence_penalty"))
      .mockResolvedValueOnce(successResponse()) as PostSpy;

    // Five reshapes are needed; the attempt cap must not cut this short.
    const response: { content: string } = await LLMService.getCompletion({
      llmProviderConfig: { ...AZURE_CONFIG, modelName: "prod" },
      messages: [{ role: "user", content: "hi" }],
      temperature: 0,
      maxTokens: 16,
      additionalParams: {
        top_p: 0.9,
        frequency_penalty: 0.2,
        presence_penalty: 0.2,
      },
    });

    expect(response.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(6);

    const finalBody: JSONObject = bodyOf(spy, 5);
    expect(finalBody["max_completion_tokens"]).toBe(16);
    expect(finalBody["temperature"]).toBeUndefined();
    expect(finalBody["top_p"]).toBeUndefined();
    expect(finalBody["frequency_penalty"]).toBeUndefined();
    expect(finalBody["presence_penalty"]).toBeUndefined();
  });

  test("remembers dropped params, not just the token spelling", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxTokensUnsupportedResponse())
      .mockResolvedValueOnce(temperatureUnsupportedResponse())
      .mockResolvedValue(successResponse()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "hi" }],
      temperature: 0,
      maxTokens: 16,
    });
    expect(spy).toHaveBeenCalledTimes(3);

    await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "again" }],
      temperature: 0,
      maxTokens: 16,
    });

    // Both halves of what was learned must survive: the spelling and the drop.
    expect(spy).toHaveBeenCalledTimes(4);
    expect(bodyOf(spy, 3)["max_completion_tokens"]).toBe(16);
    expect(bodyOf(spy, 3)["temperature"]).toBeUndefined();
  });

  test("keeps two Azure resources that share a deployment name apart", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxTokensUnsupportedResponse())
      .mockResolvedValue(successResponse()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });
    expect(spy).toHaveBeenCalledTimes(2);

    await LLMService.getCompletion({
      llmProviderConfig: {
        ...AZURE_CONFIG,
        baseUrl:
          "https://other.openai.azure.com/openai/deployments/my-deployment",
      },
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });

    /*
     * Same deployment name, different resource: what one accepts says nothing
     * about the other, so it must re-probe.
     */
    expect(bodyOf(spy, 2)["max_tokens"]).toBe(16);
  });
});

describe("LLMService — errors that are not parameter-compatibility problems", () => {
  test("a max_tokens value error surfaces as-is instead of triggering a rename", async () => {
    const spy: PostSpy = jest.spyOn(API, "post").mockResolvedValue(
      new HTTPErrorResponse(
        400,
        {
          error: {
            message:
              "max_tokens is too large: 200000. This model supports at most 16384 completion tokens.",
            type: "invalid_request_error",
            param: "max_tokens",
            code: null,
          },
        },
        {},
      ),
    ) as PostSpy;

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.OpenAI,
          apiKey: "test-key",
          modelName: "gpt-4o",
        },
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 200000,
      }),
      /*
       * Renaming the param would not fix a too-large value; it would only
       * bury the real complaint under one about a param the caller never set.
       */
    ).rejects.toThrow("max_tokens is too large");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("the plural unrecognized-argument wording still triggers the fallback", async () => {
    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          400,
          {
            error: {
              message:
                "Unrecognized request arguments supplied: max_completion_tokens, reasoning_effort",
              type: "invalid_request_error",
              param: null,
              code: null,
            },
          },
          {},
        ),
      )
      .mockResolvedValueOnce(successResponse()) as PostSpy;

    const response: { content: string } = await LLMService.getCompletion({
      llmProviderConfig: { ...AZURE_CONFIG, modelName: "gpt-5-mini" },
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });

    expect(response.content).toBe("OK");
    expect(bodyOf(spy, 1)["max_tokens"]).toBe(16);
  });

  test("an auth failure is surfaced without any retry", async () => {
    const spy: PostSpy = jest.spyOn(API, "post").mockResolvedValue(
      new HTTPErrorResponse(
        401,
        {
          error: {
            message: "Incorrect API key provided.",
            type: "invalid_request_error",
            param: null,
            code: "invalid_api_key",
          },
        },
        {},
      ),
    ) as PostSpy;

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: AZURE_CONFIG,
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 16,
      }),
    ).rejects.toThrow("Azure OpenAI API error");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("a failed request is not cached as a working shape", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValueOnce(maxTokensUnsupportedResponse())
      .mockResolvedValueOnce(
        new HTTPErrorResponse(500, { error: { message: "upstream boom" } }, {}),
      );

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: AZURE_CONFIG,
        messages: [{ role: "user", content: "hi" }],
        maxTokens: 16,
      }),
    ).rejects.toThrow("Azure OpenAI API error");

    jest.restoreAllMocks();
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const spy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValue(successResponse()) as PostSpy;

    await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 16,
    });

    // The swap was never confirmed to work, so it must not be remembered.
    expect(bodyOf(spy, 0)["max_tokens"]).toBe(16);
  });
});
