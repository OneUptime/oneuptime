import API from "../../../../Utils/API";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import DataSourceEgressGuard from "../../../../Server/Utils/DataSource/EgressGuard";
import logger from "../../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import LlmProviderEndpoint from "../../../../Utils/LLM/LlmProviderEndpoint";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #4476: Microsoft Foundry (Azure AI Foundry) as OneUptime's LLM
 * provider, end to end on the wire.
 *
 *  - Azure OpenAI providers: the request goes where LlmProviderEndpoint says
 *    (the resource's v1 API for an endpoint, a deployment URL with its
 *    api-version as before), with the key in `api-key` and never in an
 *    Authorization header, and the deployment in `model`. The egress guard
 *    checks the URL that is actually sent to, and every adapted retry goes
 *    to that same URL.
 *  - Claude in Foundry, on the Anthropic wire: the Base URL Foundry shows,
 *    its Target URI or the resource's endpoint all reach
 *    /anthropic/v1/messages, with x-api-key and anthropic-version.
 *  - Azure's refusals while a resource is set up lead the error with what to
 *    change, in OneUptime's own words, whether or not the provider's body
 *    may be shown.
 */

type PostSpy = ReturnType<typeof jest.spyOn>;

interface SentRequest {
  url: string;
  data: JSONObject;
  headers: Record<string, string>;
}

const AZURE_KEY: string = "azure-key-1";

// A reply in the shape Azure's v1 chat completions reference documents.
const AZURE_SUCCESS_BODY: JSONObject = {
  id: "chatcmpl-7R1nGnsXO8n4oi9UPz2f3UHdgAYMn",
  created: 1686676106,
  model: "gpt-5.1",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      message: { role: "assistant", content: "Two incidents are active." },
    },
  ],
  usage: {
    completion_tokens: 7,
    prompt_tokens: 33,
    total_tokens: 40,
    prompt_tokens_details: { cached_tokens: 12 },
  },
};

const ANTHROPIC_SUCCESS_BODY: JSONObject = {
  id: "msg_01",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Two incidents are active." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 30, output_tokens: 7 },
};

function azureConfig(
  baseUrl: string,
  modelName?: string | undefined,
): LLMProviderConfig {
  return {
    llmType: LlmType.AzureOpenAI,
    apiKey: AZURE_KEY,
    baseUrl: baseUrl,
    ...(modelName !== undefined ? { modelName } : {}),
  };
}

function mockReplies(
  ...replies: Array<HTTPResponse<JSONObject> | HTTPErrorResponse>
): PostSpy {
  const spy: PostSpy = jest.spyOn(API, "post") as PostSpy;

  for (const reply of replies) {
    spy.mockResolvedValueOnce(reply as never);
  }

  return spy;
}

function success(body: JSONObject): HTTPResponse<JSONObject> {
  return { jsonData: body } as unknown as HTTPResponse<JSONObject>;
}

function azureError(
  statusCode: number,
  error: JSONObject,
): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, { error: error }, {});
}

function sent(spy: PostSpy, callIndex: number = 0): SentRequest {
  const call: {
    url: URL;
    data: JSONObject;
    headers: Record<string, string>;
  } = spy.mock.calls[callIndex]![0] as {
    url: URL;
    data: JSONObject;
    headers: Record<string, string>;
  };

  return {
    url: call.url.toString(),
    data: call.data,
    headers: call.headers,
  };
}

async function complete(
  config: LLMProviderConfig,
  request: Partial<LLMCompletionRequest> = {},
): Promise<LLMCompletionResponse> {
  return LLMService.getCompletion({
    llmProviderConfig: config,
    messages: [
      { role: "system", content: "You are OneUptime's AI SRE." },
      { role: "user", content: "Which incidents are active?" },
    ],
    ...request,
  });
}

async function failureOf(
  config: LLMProviderConfig,
  reply: HTTPErrorResponse,
  request: Partial<LLMCompletionRequest> = {},
): Promise<string> {
  mockReplies(reply);

  try {
    await complete(config, request);
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error("The completion was expected to fail.");
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

describe("an Azure OpenAI provider whose Base URL is the resource's endpoint", () => {
  test("posts to the resource's v1 API, with the deployment in `model`", async () => {
    const spy: PostSpy = mockReplies(success(AZURE_SUCCESS_BODY));

    await complete(azureConfig("https://contoso.openai.azure.com", "gpt-5.1"));

    const request: SentRequest = sent(spy);

    expect(request.url).toBe(
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    );
    expect(request.data["model"]).toBe("gpt-5.1");
  });

  test("sends no dated api-version to the v1 API", async () => {
    const spy: PostSpy = mockReplies(success(AZURE_SUCCESS_BODY));

    await complete(
      azureConfig("https://contoso.services.ai.azure.com/openai/v1", "grok-4"),
    );

    expect(sent(spy).url).toBe(
      "https://contoso.services.ai.azure.com/openai/v1/chat/completions",
    );
    expect(sent(spy).url).not.toContain("api-version");
  });

  test("sends the key in api-key, and no Authorization header", async () => {
    const spy: PostSpy = mockReplies(success(AZURE_SUCCESS_BODY));

    await complete(azureConfig("https://contoso.openai.azure.com", "gpt-5.1"));

    expect(sent(spy).headers).toEqual({
      "api-key": AZURE_KEY,
      "Content-Type": "application/json",
    });
  });

  test("asks for the long-standing default deployment when Model Name is blank", async () => {
    const spy: PostSpy = mockReplies(success(AZURE_SUCCESS_BODY));

    await complete(azureConfig("https://contoso.openai.azure.com"));

    expect(LLMService.AZURE_OPENAI_DEFAULT_DEPLOYMENT).toBe("gpt-4o");
    expect(sent(spy).data["model"]).toBe("gpt-4o");
  });

  test("a deployment name with a dot, as the Foundry portal fills in, is sent as it is", async () => {
    const spy: PostSpy = mockReplies(success(AZURE_SUCCESS_BODY));

    await complete(
      azureConfig("https://contoso.openai.azure.com", "gpt-4.1-mini"),
    );

    expect(sent(spy).data["model"]).toBe("gpt-4.1-mini");
  });

  test("reads the answer, its finish reason and its usage, cached input included", async () => {
    mockReplies(success(AZURE_SUCCESS_BODY));

    const response: LLMCompletionResponse = await complete(
      azureConfig("https://contoso.openai.azure.com", "gpt-5.1"),
    );

    expect(response).toEqual({
      content: "Two incidents are active.",
      toolCalls: undefined,
      stopReason: "stop",
      usage: {
        promptTokens: 33,
        completionTokens: 7,
        totalTokens: 40,
        cachedInputTokens: 12,
      },
    });
  });

  test("the egress guard checks the URL the request is sent to", async () => {
    mockReplies(success(AZURE_SUCCESS_BODY));

    await complete(azureConfig("https://contoso.openai.azure.com", "gpt-5.1"));

    expect(DataSourceEgressGuard.assertUrlAllowedAndPin).toHaveBeenCalledWith(
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
      expect.objectContaining({ targetLabel: "LLM provider" }),
    );
  });

  test("a request reshaped for a reasoning model goes to the same v1 URL", async () => {
    const spy: PostSpy = mockReplies(
      azureError(400, {
        message:
          "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported.",
        type: "invalid_request_error",
        param: "temperature",
        code: "unsupported_value",
      }),
      success(AZURE_SUCCESS_BODY),
    );

    await complete(
      azureConfig("https://contoso.openai.azure.com", "prod-reasoning"),
    );

    expect(spy).toHaveBeenCalledTimes(2);
    expect(sent(spy, 1).url).toBe(
      "https://contoso.openai.azure.com/openai/v1/chat/completions",
    );
    expect(sent(spy, 1).data["temperature"]).toBeUndefined();
  });

  test("tools go out on the OpenAI wire, and tool calls come back", async () => {
    const spy: PostSpy = mockReplies(
      success({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "list_incidents",
                    arguments: '{"state":"active"}',
                  },
                },
              ],
            },
          },
        ],
      } as unknown as JSONObject),
    );

    const response: LLMCompletionResponse = await complete(
      azureConfig("https://contoso.openai.azure.com", "gpt-5.1"),
      {
        tools: [
          {
            name: "list_incidents",
            description: "Lists incidents.",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    );

    expect((sent(spy).data["tools"] as Array<JSONObject>)[0]).toEqual({
      type: "function",
      function: {
        name: "list_incidents",
        description: "Lists incidents.",
        parameters: { type: "object", properties: {} },
      },
    });
    expect(response.stopReason).toBe("tool_use");
    expect(response.toolCalls).toEqual([
      {
        id: "call_1",
        name: "list_incidents",
        arguments: { state: "active" },
        argumentsParseError: undefined,
      },
    ]);
  });
});

describe("an Azure OpenAI provider whose Base URL names a deployment works as it did", () => {
  test("a deployment URL gets the default api-version", async () => {
    const spy: PostSpy = mockReplies(success(AZURE_SUCCESS_BODY));

    await complete(
      azureConfig(
        "https://contoso.openai.azure.com/openai/deployments/gpt-4o",
        "gpt-4o",
      ),
    );

    expect(sent(spy).url).toBe(
      `https://contoso.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=${LlmProviderEndpoint.AZURE_OPENAI_DEFAULT_API_VERSION}`,
    );
    expect(sent(spy).headers["api-key"]).toBe(AZURE_KEY);
  });

  test("a Target URI pasted whole is posted to as it is", async () => {
    const targetUri: string =
      "https://contoso.cognitiveservices.azure.com/openai/deployments/gpt-4.1-mini/chat/completions?api-version=2025-01-01-preview";
    const spy: PostSpy = mockReplies(success(AZURE_SUCCESS_BODY));

    await complete(azureConfig(targetUri, "gpt-4.1-mini"));

    expect(sent(spy).url).toBe(targetUri);
  });
});

describe("an Azure OpenAI provider says what it needs before it sends anything", () => {
  test("an API key", async () => {
    const spy: PostSpy = jest.spyOn(API, "post") as PostSpy;

    await expect(
      complete({
        llmType: LlmType.AzureOpenAI,
        baseUrl: "https://contoso.openai.azure.com",
      }),
    ).rejects.toThrow(
      "Azure OpenAI API key is required: KEY 1 or KEY 2 from the resource's Keys and Endpoint page in the Azure portal.",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  test("a Base URL, with an example of the endpoint to use", async () => {
    const spy: PostSpy = jest.spyOn(API, "post") as PostSpy;

    await expect(
      complete({ llmType: LlmType.AzureOpenAI, apiKey: AZURE_KEY }),
    ).rejects.toThrow(
      "Azure OpenAI Base URL is required: your Microsoft Foundry or Azure OpenAI resource's endpoint (e.g. https://<resource>.openai.azure.com/openai/v1).",
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Azure's refusals lead the error with what to change", () => {
  const V1: LLMProviderConfig = azureConfig(
    "https://contoso.openai.azure.com/openai/v1",
    "gpt-5-1-prod",
  );
  const DEPLOYMENT_URL: LLMProviderConfig = azureConfig(
    "https://contoso.openai.azure.com/openai/deployments/o3-mini",
    "o3-mini",
  );

  test("a key Azure does not accept", async () => {
    const message: string = await failureOf(
      V1,
      azureError(401, {
        code: "401",
        message:
          "Access denied due to invalid subscription key or wrong API endpoint. Make sure to provide a valid key for an active subscription and use a correct regional API endpoint for your resource.",
      }),
    );

    expect(message).toMatch(
      /^Azure OpenAI API error: Azure did not accept the API key\. Copy KEY 1 or KEY 2 from the Keys and Endpoint page of the same resource the Base URL points to\. Details: \{"error":/,
    );
  });

  test("key access turned off for the resource", async () => {
    const message: string = await failureOf(
      V1,
      azureError(403, {
        code: "AuthenticationTypeDisabled",
        message: "Key based authentication is disabled for this resource.",
      }),
    );

    expect(message).toContain(
      "Key-based authentication is turned off for this resource, and OneUptime signs in with the resource's API key. Turn key access back on for the resource (disableLocalAuth set to false).",
    );
  });

  test("key access turned off, told only in words", async () => {
    const message: string = await failureOf(
      V1,
      azureError(403, {
        code: "403",
        message: "Key based authentication is disabled for this resource.",
      }),
    );

    expect(message).toContain("Key-based authentication is turned off");
  });

  test("a network rule that keeps OneUptime out", async () => {
    const message: string = await failureOf(
      V1,
      azureError(403, {
        code: "403",
        message: "Access denied due to Virtual Network/Firewall rules.",
      }),
    );

    expect(message).toContain(
      "Azure refused the request. If the resource's Networking settings allow only selected networks or private endpoints, OneUptime has to reach it from one of them.",
    );
  });

  test("no deployment of that name, on the v1 API: names the Model Name it asked for", async () => {
    const message: string = await failureOf(
      V1,
      azureError(404, {
        code: "DeploymentNotFound",
        message:
          "The API deployment for this resource does not exist. If you created the deployment within the last 5 minutes, please wait a moment and try again.",
      }),
    );

    expect(message).toContain(
      'This resource has no deployment named "gpt-5-1-prod". Set Model Name to the deployment\'s name exactly as the Foundry portal shows it.',
    );
  });

  test("no deployment of that name, told only in words", async () => {
    const message: string = await failureOf(
      V1,
      azureError(404, {
        code: "404",
        message:
          "The API deployment for this resource does not exist. If you created the deployment within the last 5 minutes, please wait a moment and try again.",
      }),
    );

    expect(message).toContain('no deployment named "gpt-5-1-prod"');
  });

  test("no deployment of that name, on a deployment URL: points at the name in the Base URL", async () => {
    const message: string = await failureOf(
      DEPLOYMENT_URL,
      azureError(404, {
        code: "DeploymentNotFound",
        message: "The API deployment for this resource does not exist.",
      }),
    );

    expect(message).toContain(
      "This resource has no deployment with the name in the Base URL (after /openai/deployments/).",
    );
    expect(message).not.toContain("o3-mini");
  });

  test("nothing at that address", async () => {
    const message: string = await failureOf(
      V1,
      azureError(404, { code: "404", message: "Resource not found" }),
    );

    expect(message).toContain(
      "Azure found nothing at this address. Set the Base URL to the resource's endpoint, such as https://<resource>.openai.azure.com/openai/v1.",
    );
  });

  test("a model newer than the api-version a deployment URL asks for: names the version it needs", async () => {
    const message: string = await failureOf(
      DEPLOYMENT_URL,
      azureError(400, {
        code: "BadRequest",
        message:
          "Model {modelName} is enabled only for api versions 2024-12-01-preview and later",
      }),
    );

    expect(message).toContain(
      "This model needs api-version 2024-12-01-preview or later. Use the resource's v1 API, which takes no api-version: set the Base URL to https://<resource>.openai.azure.com/openai/v1 and Model Name to the deployment's name. Or add ?api-version=2024-12-01-preview to the Base URL.",
    );
  });

  test("the version is read only when it is a dated api-version", async () => {
    const message: string = await failureOf(
      DEPLOYMENT_URL,
      azureError(400, {
        code: "BadRequest",
        message:
          "Model x is enabled only for api versions <img src=x> and later",
      }),
    );

    expect(message).not.toContain("This model needs api-version");
  });

  test("a dated api-version on the v1 API", async () => {
    const message: string = await failureOf(
      azureConfig(
        "https://contoso.openai.azure.com/openai/v1?api-version=2024-10-21",
        "gpt-5-1-prod",
      ),
      azureError(400, { code: "BadRequest", message: "API version not supported" }),
    );

    expect(message).toContain(
      "Azure's v1 API takes no dated api-version: remove api-version from the Base URL.",
    );
  });

  test("an api-version a deployment URL does not take", async () => {
    const message: string = await failureOf(
      azureConfig(
        "https://contoso.openai.azure.com/openai/deployments/gpt-4o?api-version=2019-01-01",
        "gpt-4o",
      ),
      azureError(404, {
        code: "404",
        message: "Unsupported api-version '2019-01-01'.",
      }),
    );

    expect(message).toContain(
      "Azure does not take the api-version this request asked for",
    );
  });

  test("any other error is left as it was", async () => {
    const message: string = await failureOf(
      V1,
      azureError(400, {
        code: "content_filter",
        message: "The response was filtered due to the prompt triggering Azure OpenAI's content management policy.",
      }),
    );

    expect(message).toBe(
      `Azure OpenAI API error: ${JSON.stringify({
        error: {
          code: "content_filter",
          message:
            "The response was filtered due to the prompt triggering Azure OpenAI's content management policy.",
        },
      })}`,
    );
  });

  test("where the provider's body may not be shown, the hint still is, and the body is not", async () => {
    const message: string = await failureOf(
      V1,
      azureError(404, {
        code: "DeploymentNotFound",
        message:
          "The API deployment for this resource does not exist. Prompt: secret incident notes",
      }),
      { includeProviderErrorDetails: false },
    );

    expect(message).toBe(
      'Azure OpenAI API request failed. This resource has no deployment named "gpt-5-1-prod". Set Model Name to the deployment\'s name exactly as the Foundry portal shows it. A deployment created in the last few minutes may not be ready yet.',
    );
  });

  test("without a hint, the withheld message stays the generic one", async () => {
    const message: string = await failureOf(
      V1,
      azureError(500, { code: "InternalServerError", message: "Oops" }),
      { includeProviderErrorDetails: false },
    );

    expect(message).toBe(
      "Azure OpenAI API request failed. Review the provider configuration and try again.",
    );
  });

  test("the hint comes first, so a long body cut short in the LLM log keeps it", async () => {
    const message: string = await failureOf(
      V1,
      azureError(401, { code: "401", message: "x".repeat(5000) }),
    );

    // AIService keeps the first 490 characters of an error in the LLM log.
    expect(message.substring(0, 490)).toContain(
      "Azure did not accept the API key.",
    );
  });
});

describe("Claude in Microsoft Foundry, on the Anthropic wire", () => {
  function claudeConfig(baseUrl: string): LLMProviderConfig {
    return {
      llmType: LlmType.Anthropic,
      apiKey: AZURE_KEY,
      baseUrl: baseUrl,
      modelName: "claude-sonnet-5-5",
    };
  }

  test.each([
    "https://contoso.services.ai.azure.com/anthropic",
    "https://contoso.services.ai.azure.com/anthropic/v1",
    "https://contoso.services.ai.azure.com/anthropic/v1/messages",
    "https://contoso.services.ai.azure.com",
  ])(
    "%s reaches the deployment's Target URI",
    async (baseUrl: string) => {
      const spy: PostSpy = mockReplies(success(ANTHROPIC_SUCCESS_BODY));

      const response: LLMCompletionResponse = await complete(
        claudeConfig(baseUrl),
      );

      expect(sent(spy).url).toBe(
        "https://contoso.services.ai.azure.com/anthropic/v1/messages",
      );
      expect(response.content).toBe("Two incidents are active.");
    },
  );

  test("sends the key in x-api-key with anthropic-version 2023-06-01, as Foundry takes them", async () => {
    const spy: PostSpy = mockReplies(success(ANTHROPIC_SUCCESS_BODY));

    await complete(
      claudeConfig("https://contoso.services.ai.azure.com/anthropic/v1"),
    );

    expect(sent(spy).headers).toEqual({
      "x-api-key": AZURE_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    });
  });

  test("the deployment name is the model, and the system prompt is hoisted", async () => {
    const spy: PostSpy = mockReplies(success(ANTHROPIC_SUCCESS_BODY));

    await complete(
      claudeConfig("https://contoso.services.ai.azure.com/anthropic/v1"),
    );

    const body: JSONObject = sent(spy).data;

    expect(body["model"]).toBe("claude-sonnet-5-5");
    expect(body["system"]).toEqual([
      {
        type: "text",
        text: "You are OneUptime's AI SRE.",
        cache_control: { type: "ephemeral" },
      },
    ]);
    expect(body["messages"]).toEqual([
      { role: "user", content: "Which incidents are active?" },
    ]);
  });

  test("an Anthropic provider with no Base URL still goes to Anthropic's own API", async () => {
    const spy: PostSpy = mockReplies(success(ANTHROPIC_SUCCESS_BODY));

    await complete({
      llmType: LlmType.Anthropic,
      apiKey: "sk-ant-test",
    });

    expect(sent(spy).url).toBe("https://api.anthropic.com/v1/messages");
  });
});
