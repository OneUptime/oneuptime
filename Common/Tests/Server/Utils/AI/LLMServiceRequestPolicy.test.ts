import API from "../../../../Utils/API";
import logger from "../../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import fs from "fs/promises";
import { afterEach, describe, expect, test } from "@jest/globals";

type PostSpy = ReturnType<typeof jest.spyOn>;

interface ProviderCase {
  name: string;
  config: LLMProviderConfig;
  response: JSONObject;
  defaultTimeoutInMs: number;
}

const providerCases: Array<ProviderCase> = [
  {
    name: "OpenAI-compatible",
    config: {
      llmType: LlmType.OpenAI,
      apiKey: "test-key",
      modelName: "gpt-test",
    },
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
      modelName: "gpt-test",
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
      modelName: "claude-test",
    },
    response: {
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    },
    defaultTimeoutInMs: 120_000,
  },
  {
    name: "AWS Bedrock",
    config: {
      llmType: LlmType.Bedrock,
      apiKey: "AKIATEST:secret",
      baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
      modelName: "anthropic.claude-3-5-sonnet-20240620-v1:0",
    },
    response: {
      output: { message: { content: [{ text: "ok" }] } },
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    },
    defaultTimeoutInMs: 120_000,
  },
  {
    name: "Ollama",
    config: {
      llmType: LlmType.Ollama,
      baseUrl: "http://localhost:11434",
      modelName: "llama-test",
    },
    response: {
      message: { role: "assistant", content: "ok" },
      prompt_eval_count: 1,
      eval_count: 1,
    },
    defaultTimeoutInMs: 300_000,
  },
];

function mockPost(response: JSONObject): PostSpy {
  return jest.spyOn(API, "post").mockResolvedValue({
    jsonData: response,
  } as unknown as HTTPResponse<JSONObject>) as PostSpy;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LLMService request timeout and retry policy", () => {
  test.each(providerCases)(
    "$name forwards an explicit per-request policy",
    async ({ config, response }: ProviderCase) => {
      const postSpy: PostSpy = mockPost(response);

      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: [{ role: "user", content: "hello" }],
        requestRetries: 0,
        requestTimeoutInMs: 12_345,
      });

      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(postSpy.mock.calls[0]![0]).toEqual(
        expect.objectContaining({
          options: {
            retries: 0,
            exponentialBackoff: true,
            timeout: 12_345,
          },
        }),
      );
    },
  );

  test.each(providerCases)(
    "$name retains its existing default policy when no override is supplied",
    async ({ config, response, defaultTimeoutInMs }: ProviderCase) => {
      const postSpy: PostSpy = mockPost(response);

      await LLMService.getCompletion({
        llmProviderConfig: config,
        messages: [{ role: "user", content: "hello" }],
      });

      expect(postSpy.mock.calls[0]![0]).toEqual(
        expect.objectContaining({
          options: {
            retries: 2,
            exponentialBackoff: true,
            timeout: defaultTimeoutInMs,
          },
        }),
      );
    },
  );

  test("AWS Bedrock uses IRSA web identity credentials when no static key is configured", async () => {
    const savedEnv: Record<string, string | undefined> = {
      AWS_ACCESS_KEY_ID: process.env["AWS_ACCESS_KEY_ID"],
      AWS_SECRET_ACCESS_KEY: process.env["AWS_SECRET_ACCESS_KEY"],
      AWS_SESSION_TOKEN: process.env["AWS_SESSION_TOKEN"],
      AWS_ROLE_ARN: process.env["AWS_ROLE_ARN"],
      AWS_WEB_IDENTITY_TOKEN_FILE: process.env["AWS_WEB_IDENTITY_TOKEN_FILE"],
      AWS_ROLE_SESSION_NAME: process.env["AWS_ROLE_SESSION_NAME"],
    };

    delete process.env["AWS_ACCESS_KEY_ID"];
    delete process.env["AWS_SECRET_ACCESS_KEY"];
    delete process.env["AWS_SESSION_TOKEN"];
    process.env["AWS_ROLE_ARN"] =
      "arn:aws:iam::123456789012:role/OneUptimeBedrockServiceAccount";
    process.env["AWS_WEB_IDENTITY_TOKEN_FILE"] =
      "/var/run/secrets/eks.amazonaws.com/serviceaccount/token";
    process.env["AWS_ROLE_SESSION_NAME"] = "oneuptime-test";

    jest.spyOn(fs, "readFile").mockResolvedValue("web-identity-token");

    const postSpy: PostSpy = jest
      .spyOn(API, "post")
      .mockResolvedValueOnce({
        jsonData: `
          <AssumeRoleWithWebIdentityResponse>
            <AssumeRoleWithWebIdentityResult>
              <Credentials>
                <AccessKeyId>ASIATEMP</AccessKeyId>
                <SecretAccessKey>temp-secret</SecretAccessKey>
                <SessionToken>temp-token</SessionToken>
                <Expiration>2099-01-01T00:00:00Z</Expiration>
              </Credentials>
            </AssumeRoleWithWebIdentityResult>
          </AssumeRoleWithWebIdentityResponse>
        `,
      } as unknown as HTTPResponse<JSONObject>)
      .mockResolvedValueOnce({
        jsonData: providerCases[3]!.response,
      } as unknown as HTTPResponse<JSONObject>) as PostSpy;

    try {
      await LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.Bedrock,
          baseUrl: "https://bedrock-runtime.ap-northeast-2.amazonaws.com",
          modelName: "anthropic.claude-3-5-sonnet-20240620-v1:0",
        },
        messages: [{ role: "user", content: "hello" }],
      });

      expect(postSpy).toHaveBeenCalledTimes(2);
      expect(postSpy.mock.calls[0]![0]).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            Action: "AssumeRoleWithWebIdentity",
            RoleArn:
              "arn:aws:iam::123456789012:role/OneUptimeBedrockServiceAccount",
            RoleSessionName: "oneuptime-test",
            WebIdentityToken: "web-identity-token",
          }),
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        }),
      );
      expect(postSpy.mock.calls[1]![0]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-Amz-Security-Token": "temp-token",
            Authorization: expect.stringContaining("Credential=ASIATEMP/"),
          }),
        }),
      );
    } finally {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  test("protected OpenAI-compatible requests cannot have workflow-owned fields overridden", async () => {
    const postSpy: PostSpy = mockPost(providerCases[0]!.response);

    await LLMService.getCompletion({
      llmProviderConfig: providerCases[0]!.config,
      messages: [{ role: "user", content: "private workflow prompt" }],
      temperature: 0.2,
      maxTokens: 256,
      protectRequestParameters: true,
      additionalParams: {
        model: "overridden-model",
        messages: [{ role: "user", content: "overridden prompt" }],
        temperature: 1,
        max_tokens: 99_999,
        n: 50,
        stream: true,
        tools: [{ type: "function", function: { name: "unsafe_tool" } }],
        tool_choice: "required",
        best_of: 10,
        web_search_options: { search_context_size: "high" },
        data_sources: [{ type: "azure_search" }],
        modalities: ["text", "audio"],
        audio: { format: "wav", voice: "alloy" },
        store: true,
        metadata: { private: "provider-retained" },
        future_agent_capability: { enabled: true },
        top_p: 0.9,
      },
    });

    const requestBody: JSONObject = (
      postSpy.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(requestBody).toMatchObject({
      model: "gpt-test",
      messages: [{ role: "user", content: "private workflow prompt" }],
      temperature: 0.2,
      max_tokens: 256,
      n: 1,
      stream: false,
      top_p: 0.9,
    });
    expect(requestBody["tools"]).toBeUndefined();
    expect(requestBody["tool_choice"]).toBeUndefined();
    expect(requestBody["best_of"]).toBeUndefined();
    expect(requestBody["web_search_options"]).toBeUndefined();
    expect(requestBody["data_sources"]).toBeUndefined();
    expect(requestBody["modalities"]).toBeUndefined();
    expect(requestBody["audio"]).toBeUndefined();
    expect(requestBody["store"]).toBeUndefined();
    expect(requestBody["metadata"]).toBeUndefined();
    expect(requestBody["future_agent_capability"]).toBeUndefined();
  });

  test("protected requests retain allowlisted generation-only tuning", async () => {
    const postSpy: PostSpy = mockPost(providerCases[0]!.response);

    await LLMService.getCompletion({
      llmProviderConfig: providerCases[0]!.config,
      messages: [{ role: "user", content: "hello" }],
      protectRequestParameters: true,
      additionalParams: {
        top_p: 0.8,
        frequency_penalty: 0.1,
        presence_penalty: 0.2,
        seed: 42,
        stop: ["END"],
        response_format: { type: "json_object" },
      },
    });

    const requestBody: JSONObject = (
      postSpy.mock.calls[0]![0] as { data: JSONObject }
    ).data;

    expect(requestBody).toMatchObject({
      top_p: 0.8,
      frequency_penalty: 0.1,
      presence_penalty: 0.2,
      seed: 42,
      stop: ["END"],
      response_format: { type: "json_object" },
    });
  });

  test("protected requests retain max_completion_tokens compatibility without losing the cap", async () => {
    const postSpy: PostSpy = mockPost(providerCases[0]!.response);

    await LLMService.getCompletion({
      llmProviderConfig: providerCases[0]!.config,
      messages: [{ role: "user", content: "hello" }],
      maxTokens: 512,
      protectRequestParameters: true,
      additionalParams: { max_completion_tokens: 40_000 },
    });

    const requestBody: JSONObject = (
      postSpy.mock.calls[0]![0] as { data: JSONObject }
    ).data;
    expect(requestBody["max_completion_tokens"]).toBe(512);
    expect(requestBody["max_tokens"]).toBeUndefined();
  });

  test.each(providerCases)(
    "$name excludes echoed private content from logs and captured exceptions when provider details are disabled",
    async ({ config }: ProviderCase) => {
      const privateProviderDetail: string =
        "provider echoed private workflow prompt SECRET-123";
      jest
        .spyOn(API, "post")
        .mockResolvedValue(
          new HTTPErrorResponse(
            400,
            { error: { message: privateProviderDetail } },
            {},
          ),
        );
      const errorLog: jest.SpyInstance = jest
        .spyOn(logger, "error")
        .mockImplementation((): void => {});

      let thrownMessage: string = "";

      try {
        await LLMService.getCompletion({
          llmProviderConfig: config,
          messages: [{ role: "user", content: "SECRET-123" }],
          includeProviderErrorDetails: false,
        });
      } catch (error) {
        thrownMessage = error instanceof Error ? error.message : String(error);
      }

      const loggedContent: string = errorLog.mock.calls
        .flat()
        .map((value: unknown) => {
          if (value instanceof Error) {
            return value.message;
          }

          return typeof value === "string" ? value : JSON.stringify(value);
        })
        .join("\n");

      expect(thrownMessage).toMatch(/provider|API|request failed/i);
      expect(thrownMessage).not.toContain(privateProviderDetail);
      expect(thrownMessage).not.toContain("SECRET-123");
      expect(loggedContent).not.toContain(privateProviderDetail);
      expect(loggedContent).not.toContain("SECRET-123");
    },
  );

  test("preserves detailed provider HTTP errors by default for existing callers", async () => {
    const privateProviderDetail: string = "existing detailed provider error";
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(400, { error: privateProviderDetail }, {}),
      );
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    await expect(
      LLMService.getCompletion({
        llmProviderConfig: providerCases[0]!.config,
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toThrow(privateProviderDetail);
  });
});
