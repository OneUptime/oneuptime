import API from "../../../../Utils/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService from "../../../../Server/Utils/LLM/LLMService";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * OpenAI-compatible providers (vLLM, LocalAI, etc.) are configured with a base
 * URL. Users enter that base URL inconsistently — with or without /v1, with or
 * without a trailing slash — and the request must still land on
 * ".../v1/chat/completions" instead of 404-ing. These tests capture the string
 * we hand to URL.fromString for a range of configured base URLs.
 */

function mockPostSuccess(): void {
  jest.spyOn(API, "post").mockResolvedValue({
    jsonData: {
      choices: [{ message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    },
  } as unknown as HTTPResponse<JSONObject>);
}

async function chatCompletionsUrlFor(
  baseUrl: string | undefined,
  llmType: LlmType = LlmType.OpenAICompatible,
): Promise<string> {
  mockPostSuccess();
  const fromStringSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
    URL,
    "fromString",
  );

  await LLMService.getCompletion({
    llmProviderConfig: {
      llmType,
      apiKey: "test-key",
      modelName: "Qwen/Qwen2.5-1.5B-Instruct",
      ...(baseUrl ? { baseUrl } : {}),
    },
    messages: [{ role: "user", content: "hi" }],
  });

  /*
   * Use the MOST RECENT chat/completions call: jest.spyOn on an already-spied
   * method shares one call history, so if a test invokes this helper more than
   * once the earlier calls are still present — the last match is this call's.
   */
  const matches: Array<Array<unknown>> = fromStringSpy.mock.calls.filter(
    (c: Array<unknown>) => {
      return String(c[0]).includes("chat/completions");
    },
  );

  return String(matches[matches.length - 1]![0]);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LLMService OpenAI-compatible base URL normalization", () => {
  test("bare server root gets /v1/chat/completions (the vLLM 404 case)", async () => {
    expect(await chatCompletionsUrlFor("http://130.211.213.119:8000")).toBe(
      "http://130.211.213.119:8000/v1/chat/completions",
    );
  });

  test("trailing slash on the root does not double up", async () => {
    expect(await chatCompletionsUrlFor("http://host:8000/")).toBe(
      "http://host:8000/v1/chat/completions",
    );
  });

  test("explicit /v1 is respected", async () => {
    expect(await chatCompletionsUrlFor("http://host:8000/v1")).toBe(
      "http://host:8000/v1/chat/completions",
    );
  });

  test("trailing slash after /v1 does not double up", async () => {
    expect(await chatCompletionsUrlFor("http://host:8000/v1/")).toBe(
      "http://host:8000/v1/chat/completions",
    );
  });

  test("a full endpoint is left as-is", async () => {
    expect(
      await chatCompletionsUrlFor("http://host:8000/v1/chat/completions"),
    ).toBe("http://host:8000/v1/chat/completions");
  });

  test("a custom proxy path is trusted, not prefixed with /v1", async () => {
    expect(
      await chatCompletionsUrlFor("https://gateway.example.com/openai/v1"),
    ).toBe("https://gateway.example.com/openai/v1/chat/completions");
  });

  test("hosted OpenAI default (no base URL) resolves under /v1", async () => {
    expect(await chatCompletionsUrlFor(undefined, LlmType.OpenAI)).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
  });

  test("an uppercase/mixed-case scheme is lower-cased", async () => {
    expect(await chatCompletionsUrlFor("HTTP://host:8000")).toBe(
      "http://host:8000/v1/chat/completions",
    );
    expect(await chatCompletionsUrlFor("Https://host:8000/v1")).toBe(
      "https://host:8000/v1/chat/completions",
    );
  });

  test("a query string is preserved and stays after the endpoint path", async () => {
    expect(await chatCompletionsUrlFor("http://host:8000/v1?token=abc")).toBe(
      "http://host:8000/v1/chat/completions?token=abc",
    );
  });

  test("a query string on a bare root is preserved (no doubling)", async () => {
    expect(await chatCompletionsUrlFor("http://host:8000?foo=bar")).toBe(
      "http://host:8000/v1/chat/completions?foo=bar",
    );
  });

  test("a fragment is preserved and stays after the endpoint path", async () => {
    expect(await chatCompletionsUrlFor("http://host:8000/v1#frag")).toBe(
      "http://host:8000/v1/chat/completions#frag",
    );
  });

  test("leading/trailing whitespace is trimmed", async () => {
    expect(await chatCompletionsUrlFor("  http://host:8000/v1  ")).toBe(
      "http://host:8000/v1/chat/completions",
    );
  });
});
