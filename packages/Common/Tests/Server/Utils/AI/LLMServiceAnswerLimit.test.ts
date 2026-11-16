/**
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */

import LLMProviderAnswerTooLargeException from "../../../../Server/Utils/LLM/LLMProviderAnswerTooLargeException";
import LLMService, {
  LLM_PROVIDER_MAX_ANSWER_BYTES,
  LLMCompletionResponse,
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import LlmProviderTestFailure from "../../../../Server/Utils/LLM/LlmProviderTestFailure";
import APIException from "../../../../Types/Exception/ApiException";
import LlmType from "../../../../Types/LLM/LlmType";
import {
  LocalHttpServer,
  approveOnLoopback,
  clearOutboundProxyEnvironmentForEachTest,
  useLocalHttpServers,
} from "../../TestingUtils/OutboundProxyFixture";
import { startEachTestOnSelfHostedEgressPolicy } from "../EgressPolicyEnvironment";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import http from "http";
import zlib from "zlib";

jest.mock("../../../../Server/Utils/Logger");

/*
 * AN LLM PROVIDER'S ANSWER IS READ UP TO A LIMIT (issue #8931).
 *
 * LLMService read a provider's answer whatever its size: the options its
 * requests were sent with set no maxContentLength, so axios buffered all a
 * provider sent. Base URL is any project member's to change and Test LLM
 * Provider sends a request on demand, so a provider pointed at an endpoint
 * that answers without end filled the memory of the app or the worker that
 * asked. Now every request reads at most LLM_PROVIDER_MAX_ANSWER_BYTES (the
 * models list keeps its own 8 MB), counted as the answer arrives and once
 * it is decompressed, and a larger answer fails, once, with a sentence that
 * names no address.
 *
 * Every provider here is a real local server; the egress guard is real too,
 * apart from the loopback it refuses on every install (approveOnLoopback).
 */

clearOutboundProxyEnvironmentForEachTest();
startEachTestOnSelfHostedEgressPolicy();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

afterEach(() => {
  jest.restoreAllMocks();
});

const PROVIDER_HOST: string = "llm.example.test";

const SIXTEEN_MB: number = 16 * 1024 * 1024;

const TOO_LARGE_SENTENCE: string =
  "the answer was larger than 16\u00A0MB, so it was not read.";

// An OpenAI chat completion whose body is exactly `size` bytes long.
function openAiCompletionOfSize(size: number): string {
  const head: string =
    '{"id":"c","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"';
  const tail: string =
    '"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}';

  return `${head}${"a".repeat(size - head.length - tail.length)}${tail}`;
}

// A handler that answers every request with `body`, its length given.
function answerWith(body: string | Buffer, headers?: http.OutgoingHttpHeaders) {
  return (
    _request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    response.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(body)),
      ...(headers || {}),
    });
    response.end(body);
  };
}

interface Stream {
  bytesWritten: number;
  closed: Promise<void>;
}

/*
 * A handler that answers in chunks, with no length, and never ends: it writes
 * as fast as the connection takes it until the connection closes.
 */
function answerWithoutEnd(stream: Stream) {
  let markClosed: () => void = (): void => {};
  stream.closed = new Promise<void>((resolve: () => void) => {
    markClosed = resolve;
  });

  return (
    _request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.write('{"choices":[{"message":{"content":"');

    const chunk: Buffer = Buffer.alloc(64 * 1024, "a");

    const write: () => void = (): void => {
      while (!response.destroyed && !response.writableEnded) {
        stream.bytesWritten += chunk.length;

        if (!response.write(chunk)) {
          response.once("drain", write);
          return;
        }
      }
    };

    response.on("close", () => {
      markClosed();
    });

    write();
  };
}

interface ProviderCase {
  name: string;
  providerName: string;
  config: (origin: string) => LLMProviderConfig;
  path: string;
}

const PROVIDERS: Array<ProviderCase> = [
  {
    name: "an OpenAI-compatible server",
    providerName: "OpenAICompatible",
    config: (origin: string): LLMProviderConfig => {
      return {
        llmType: LlmType.OpenAICompatible,
        baseUrl: `${origin}/v1`,
        modelName: "some-model",
      };
    },
    path: "/v1/chat/completions",
  },
  {
    name: "Anthropic, at a gateway",
    providerName: "Anthropic",
    config: (origin: string): LLMProviderConfig => {
      return {
        llmType: LlmType.Anthropic,
        apiKey: "anthropic-key",
        baseUrl: `${origin}/v1`,
        modelName: "claude-x",
      };
    },
    path: "/v1/messages",
  },
  {
    name: "Ollama",
    providerName: "Ollama",
    config: (origin: string): LLMProviderConfig => {
      return {
        llmType: LlmType.Ollama,
        baseUrl: origin,
        modelName: "llama-x",
      };
    },
    path: "/api/chat",
  },
];

async function startProvider(): Promise<{
  server: LocalHttpServer;
  origin: string;
}> {
  const server: LocalHttpServer = await serve({ name: "provider" });
  approveOnLoopback({ [PROVIDER_HOST]: [server.host] });

  return { server, origin: `http://${PROVIDER_HOST}:${server.port}` };
}

async function completionError(
  config: LLMProviderConfig,
  retries: number = 2,
): Promise<Error> {
  try {
    await LLMService.getCompletion({
      llmProviderConfig: config,
      messages: [{ role: "user", content: "hi" }],
      requestRetries: retries,
      requestTimeoutInMs: 20000,
    });
  } catch (error) {
    return error as Error;
  }

  throw new Error("The completion succeeded.");
}

function expectNoAddress(message: string, server: LocalHttpServer): void {
  for (const part of [
    PROVIDER_HOST,
    server.host,
    String(server.port),
    "http://",
    "maxContentLength",
  ]) {
    expect({ message, names: part, said: message.includes(part) }).toEqual({
      message,
      names: part,
      said: false,
    });
  }
}

test("the limit is 16 MB", () => {
  expect(LLM_PROVIDER_MAX_ANSWER_BYTES).toBe(SIXTEEN_MB);
});

describe.each(PROVIDERS)("$name", (provider: ProviderCase) => {
  test("an answer over the limit fails with a sentence, after one request, with retries left", async () => {
    const { server, origin } = await startProvider();
    server.handler = answerWith(openAiCompletionOfSize(SIXTEEN_MB + 1));

    const error: Error = await completionError(provider.config(origin), 2);

    expect(error).toBeInstanceOf(LLMProviderAnswerTooLargeException);
    expect(error).toBeInstanceOf(APIException);
    expect(error.message).toBe(
      `${provider.providerName} API request failed: ${TOO_LARGE_SENTENCE}`,
    );
    expect(
      server.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual([provider.path]);
    expectNoAddress(error.message, server);
  });

  test("an answer that streams without end is cut off at the limit, and its connection closed", async () => {
    const { server, origin } = await startProvider();
    const stream: Stream = { bytesWritten: 0, closed: Promise.resolve() };
    server.handler = answerWithoutEnd(stream);

    const error: Error = await completionError(provider.config(origin), 1);

    expect(error.message).toBe(
      `${provider.providerName} API request failed: ${TOO_LARGE_SENTENCE}`,
    );
    await stream.closed;
    // Read up to the limit, not to the end the server never reaches.
    expect(stream.bytesWritten).toBeGreaterThan(SIXTEEN_MB / 2);
    expect(stream.bytesWritten).toBeLessThan(SIXTEEN_MB * 3);
    expect(server.requests).toHaveLength(1);
  });

  test("a small compressed answer that unpacks past the limit fails too", async () => {
    const { server, origin } = await startProvider();
    const unpacked: string = openAiCompletionOfSize(SIXTEEN_MB + 1024);
    const packed: Buffer = zlib.gzipSync(unpacked);
    expect(packed.length).toBeLessThan(1024 * 1024);
    server.handler = answerWith(packed, { "Content-Encoding": "gzip" });

    const error: Error = await completionError(provider.config(origin), 0);

    expect(error.message).toBe(
      `${provider.providerName} API request failed: ${TOO_LARGE_SENTENCE}`,
    );
  });

  test("an error answer over the limit is not read either", async () => {
    const { server, origin } = await startProvider();
    server.handler = (
      _request: http.IncomingMessage,
      response: http.ServerResponse,
    ): void => {
      const body: string = JSON.stringify({
        error: { message: "x".repeat(SIXTEEN_MB + 10) },
      });
      response.writeHead(500, {
        "Content-Type": "application/json",
        "Content-Length": String(Buffer.byteLength(body)),
      });
      response.end(body);
    };

    const error: Error = await completionError(provider.config(origin), 2);

    expect(error).toBeInstanceOf(LLMProviderAnswerTooLargeException);
    expect(server.requests).toHaveLength(1);
  });
});

describe("an answer at the limit", () => {
  test("is read whole, and the completion is what it says", async () => {
    const { server, origin } = await startProvider();
    const body: string = openAiCompletionOfSize(SIXTEEN_MB);
    expect(Buffer.byteLength(body)).toBe(SIXTEEN_MB);
    server.handler = answerWith(body);

    const completion: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: PROVIDERS[0]!.config(origin),
      messages: [{ role: "user", content: "hi" }],
      requestRetries: 0,
      requestTimeoutInMs: 20000,
    });

    expect(completion.content.length).toBeGreaterThan(SIXTEEN_MB - 200);
    expect(completion.content.startsWith("aaaa")).toBe(true);
  });

  test("an ordinary answer is unchanged", async () => {
    const { server, origin } = await startProvider();
    server.handler = answerWith(openAiCompletionOfSize(512));

    const completion: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: PROVIDERS[0]!.config(origin),
      messages: [{ role: "user", content: "hi" }],
      requestRetries: 0,
      requestTimeoutInMs: 20000,
    });

    expect(completion.content).toMatch(/^a+$/);
  });
});

describe("the models list keeps its own limit", () => {
  test("a list over 8 MB fails with a sentence that says 8 MB", async () => {
    const { server, origin } = await startProvider();
    const list: string = JSON.stringify({
      data: [{ id: "m".repeat(8 * 1024 * 1024 + 16) }],
    });
    server.handler = answerWith(list);

    const error: Error = await completionError(
      {
        llmType: LlmType.OpenAICompatible,
        baseUrl: `${origin}/v1`,
        // No model: the server is asked which models it serves.
      },
      1,
    );

    expect(error.message).toBe(
      "OpenAICompatible API request failed: the answer was larger than 8\u00A0MB, so it was not read.",
    );
    expect(
      server.requests.map((request: { url: string }) => {
        return request.url;
      }),
    ).toEqual(["/v1/models"]);
  });
});

describe("Test LLM Provider says what happened", () => {
  test("whose answer it was, its limit, and to check the Base URL - not that it could not be reached", async () => {
    const { server, origin } = await startProvider();
    server.handler = answerWith(openAiCompletionOfSize(SIXTEEN_MB + 1));

    const error: Error = await completionError(PROVIDERS[0]!.config(origin), 0);
    const text: string = LlmProviderTestFailure.describe(
      error,
      LlmType.OpenAICompatible,
    );

    expect(text).toBe(
      "The OpenAI-compatible server's answer was larger than 16\u00A0MB, so it was not read. Check the Base URL: it should be the provider's API.",
    );
    expect(text).not.toContain("could not reach");
    expectNoAddress(text, server);
  });

  test.each([
    [LlmType.OpenAI, "OpenAI's answer"],
    [LlmType.Anthropic, "Anthropic's answer"],
    [LlmType.Ollama, "Ollama's answer"],
    [LlmType.AzureOpenAI, "Azure's answer"],
  ])("for %s, it names %s", (llmType: LlmType, subject: string) => {
    const text: string = LlmProviderTestFailure.describe(
      new LLMProviderAnswerTooLargeException({
        providerName: "Some",
        maxContentLength: SIXTEEN_MB,
      }),
      llmType,
    );

    expect(text.startsWith(`${subject} was larger than 16\u00A0MB`)).toBe(true);
  });
});
