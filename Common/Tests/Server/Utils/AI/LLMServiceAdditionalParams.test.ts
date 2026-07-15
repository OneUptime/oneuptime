import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import { afterEach, describe, expect, test } from "@jest/globals";

type PostSpy = ReturnType<typeof jest.spyOn>;

const OPENAI_CONFIG: LLMProviderConfig = {
  llmType: LlmType.OpenAI,
  apiKey: "test-key",
  modelName: "gpt-test",
};

const AZURE_CONFIG: LLMProviderConfig = {
  llmType: LlmType.AzureOpenAI,
  apiKey: "test-key",
  baseUrl: "https://example.openai.azure.com/openai/deployments/test-deployment",
  modelName: "gpt-test",
};

const OK_RESPONSE: JSONObject = {
  choices: [{ message: { content: "ok" } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

function mockPost(): PostSpy {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData: OK_RESPONSE,
  } as unknown as HTTPResponse<JSONObject>) as PostSpy;
}

function requestBodyOf(postSpy: PostSpy): JSONObject {
  return (postSpy.mock.calls[0]![0] as { data: JSONObject }).data;
}

function requestUrlOf(postSpy: PostSpy): string {
  return (
    postSpy.mock.calls[0]![0] as { url: { toString(): string } }
  ).url.toString();
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LLMService additionalParams coercion", () => {
  test("parses a JSON string (the UI stores the JSON field verbatim) instead of spreading its characters", async () => {
    const postSpy: PostSpy = mockPost();

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI_CONFIG,
      messages: [{ role: "user", content: "hello" }],
      // The Additional Parameters code editor persists a raw string, not an object.
      additionalParams: '{"max_completion_tokens": "2048"}' as unknown as JSONObject,
    });

    const body: JSONObject = requestBodyOf(postSpy);
    // The numeric string is coerced, and no stray "0"/"1"/... keys leak in.
    expect(body["max_completion_tokens"]).toBe(2048);
    expect(body["0"]).toBeUndefined();
    expect(body["1"]).toBeUndefined();
  });

  test("coerces numeric and boolean strings but leaves string-valued params alone", async () => {
    const postSpy: PostSpy = mockPost();

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI_CONFIG,
      messages: [{ role: "user", content: "hello" }],
      additionalParams: {
        top_p: "0.5",
        logprobs: "true",
        stop: "999",
      },
    });

    const body: JSONObject = requestBodyOf(postSpy);
    expect(body["top_p"]).toBe(0.5);
    expect(body["logprobs"]).toBe(true);
    // "stop" is semantically a string sequence — must not become the number 999.
    expect(body["stop"]).toBe("999");
  });

  test("ignores an array additionalParams instead of injecting index keys", async () => {
    const postSpy: PostSpy = mockPost();

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI_CONFIG,
      messages: [{ role: "user", content: "hello" }],
      additionalParams: ["oops"] as unknown as JSONObject,
    });

    const body: JSONObject = requestBodyOf(postSpy);
    expect(body["0"]).toBeUndefined();
    expect(body["model"]).toBe("gpt-test");
  });

  test("ignores an unparseable string additionalParams", async () => {
    const postSpy: PostSpy = mockPost();

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI_CONFIG,
      messages: [{ role: "user", content: "hello" }],
      additionalParams: "not json at all" as unknown as JSONObject,
    });

    const body: JSONObject = requestBodyOf(postSpy);
    expect(body["0"]).toBeUndefined();
    expect(body["model"]).toBe("gpt-test");
  });
});

describe("LLMService reasoning model handling", () => {
  test("omits sampling params and routes maxTokens to max_completion_tokens for o-series models", async () => {
    const postSpy: PostSpy = mockPost();

    await LLMService.getCompletion({
      llmProviderConfig: { ...OPENAI_CONFIG, modelName: "o3-mini" },
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2,
      maxTokens: 256,
    });

    const body: JSONObject = requestBodyOf(postSpy);
    expect(body["temperature"]).toBeUndefined();
    expect(body["max_completion_tokens"]).toBe(256);
    expect(body["max_tokens"]).toBeUndefined();
  });

  test("strips reasoning-unsupported params even when supplied via additionalParams", async () => {
    const postSpy: PostSpy = mockPost();

    await LLMService.getCompletion({
      llmProviderConfig: { ...OPENAI_CONFIG, modelName: "o1" },
      messages: [{ role: "user", content: "hello" }],
      additionalParams: { temperature: 0.9, top_p: 0.3, reasoning_effort: "high" },
    });

    const body: JSONObject = requestBodyOf(postSpy);
    expect(body["temperature"]).toBeUndefined();
    expect(body["top_p"]).toBeUndefined();
    // Reasoning-specific tuning is still allowed through.
    expect(body["reasoning_effort"]).toBe("high");
  });

  test("keeps temperature and max_tokens for standard (non-reasoning) models", async () => {
    const postSpy: PostSpy = mockPost();

    await LLMService.getCompletion({
      llmProviderConfig: OPENAI_CONFIG,
      messages: [{ role: "user", content: "hello" }],
      temperature: 0.2,
      maxTokens: 256,
    });

    const body: JSONObject = requestBodyOf(postSpy);
    expect(body["temperature"]).toBe(0.2);
    expect(body["max_tokens"]).toBe(256);
    expect(body["max_completion_tokens"]).toBeUndefined();
  });
});

describe("LLMService Azure OpenAI URL and api-version handling", () => {
  test("uses the default api-version and appends the endpoint", async () => {
    const postSpy: PostSpy = mockPost();

    await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "hello" }],
    });

    const url: string = requestUrlOf(postSpy);
    expect(url).toContain(
      "/openai/deployments/test-deployment/chat/completions",
    );
    expect(url).toContain("api-version=");
  });

  test("api_version in additionalParams moves to the URL, not the request body", async () => {
    const postSpy: PostSpy = mockPost();

    await LLMService.getCompletion({
      llmProviderConfig: AZURE_CONFIG,
      messages: [{ role: "user", content: "hello" }],
      additionalParams: { api_version: "2099-01-01-preview", top_p: 0.5 },
    });

    const url: string = requestUrlOf(postSpy);
    const body: JSONObject = requestBodyOf(postSpy);
    expect(url).toContain("api-version=2099-01-01-preview");
    expect(body["api_version"]).toBeUndefined();
    expect(body["api-version"]).toBeUndefined();
    // Other params still flow to the body.
    expect(body["top_p"]).toBe(0.5);
  });

  test("does not double the /chat/completions suffix when the base URL already has it", async () => {
    const postSpy: PostSpy = mockPost();

    await LLMService.getCompletion({
      llmProviderConfig: {
        ...AZURE_CONFIG,
        baseUrl:
          "https://example.openai.azure.com/openai/deployments/test-deployment/chat/completions",
      },
      messages: [{ role: "user", content: "hello" }],
    });

    const url: string = requestUrlOf(postSpy);
    expect(url).not.toContain("/chat/completions/chat/completions");
  });
});
