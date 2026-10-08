import API from "../../../../Utils/API";
import logger from "../../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMMessage,
  LLMProviderConfig,
} from "../../../../Server/Utils/LLM/LLMService";
import { isPermanentInvestigationFailure } from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A request that does not fit in the model's context window.
 *
 * Ollama fits a chat into num_ctx by dropping its oldest messages, putting
 * the system prompt back in front. In an agent conversation the question is
 * among the first to go, and Qwen 3.8's chat template then refuses the rest
 * with "no user query found in messages" — which reads as though OneUptime
 * had sent no question. These hold LLMService to naming the real problem and
 * the setting that fixes it, and to leaving every other error as it was.
 */

const OLLAMA: LLMProviderConfig = {
  llmType: LlmType.Ollama,
  baseUrl: "http://ollama.internal:11434",
  modelName: "qwen3.8",
};

// Ollama behind its OpenAI-compatible /v1 API.
const OLLAMA_OPENAI_COMPATIBLE: LLMProviderConfig = {
  llmType: LlmType.OpenAICompatible,
  baseUrl: "http://ollama.internal:11434/v1",
  modelName: "qwen3.8",
};

const OPENAI: LLMProviderConfig = {
  llmType: LlmType.OpenAI,
  apiKey: "test-key",
  modelName: "gpt-test",
};

const ANTHROPIC: LLMProviderConfig = {
  llmType: LlmType.Anthropic,
  apiKey: "test-key",
  modelName: "claude-test",
};

// The shape of an investigation by its second call: question, tool round.
const AGENT_CONVERSATION: Array<LLMMessage> = [
  { role: "system", content: "You are OneUptime AI." },
  {
    role: "user",
    content: "Investigate the incident.\n\n# Incident: checkout is down",
  },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "query_logs", arguments: {} }],
  },
  { role: "tool", toolCallId: "call_1", content: "x".repeat(5000) },
];

// Ollama's native /api/chat error body.
const OLLAMA_NO_USER_QUERY: JSONObject = {
  error: "no user query found in messages",
};

// The same refusal through Ollama's OpenAI-compatible API.
const OPENAI_STYLE_NO_USER_QUERY: JSONObject = {
  error: {
    message: "no user query found in messages",
    type: "api_error",
    param: null,
    code: null,
  },
};

// What Ollama says when not even the newest message fits.
const PROMPT_LONGER_THAN_CONTEXT: string =
  "the prompt is longer than the context length currently available to the model; shorten the prompt, adjust the context length in settings, or use a model with a longer context";

// ChatAgentRunner keeps the first 480 characters of a turn's error.
const DISPLAYED_ERROR_LENGTH: number = 480;

function mockProviderError(status: number, body: JSONObject): void {
  jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPErrorResponse(status, body, {}));
}

async function completionError(data: {
  config: LLMProviderConfig;
  messages?: Array<LLMMessage> | undefined;
  additionalParams?: JSONObject | undefined;
  includeProviderErrorDetails?: boolean | undefined;
}): Promise<string> {
  try {
    await LLMService.getCompletion({
      llmProviderConfig: data.config,
      messages: data.messages ?? AGENT_CONVERSATION,
      requestRetries: 0,
      ...(data.additionalParams
        ? { additionalParams: data.additionalParams }
        : {}),
      ...(data.includeProviderErrorDetails !== undefined
        ? { includeProviderErrorDetails: data.includeProviderErrorDetails }
        : {}),
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected the completion to fail.");
}

beforeEach(() => {
  stubLLMEgressGuard();
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Ollama drops the question to fit the context window", () => {
  test("names the context window and the setting that raises it", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({ config: OLLAMA });

    expect(message).toBe(
      `Ollama API error: the request is larger than the model's context window, so Ollama dropped the oldest messages, the question among them, and the model rejected the rest ("no user query found in messages"). Raise the context window: set "num_ctx" under "options" in this LLM provider's Additional Parameters to 65536 or more, or set OLLAMA_CONTEXT_LENGTH on the Ollama server.`,
    );
  });

  test("starts with the stable phrase the investigation queue matches", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({ config: OLLAMA });

    expect(message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
    expect(message).toContain(String(LLMService.RECOMMENDED_OLLAMA_NUM_CTX));
  });

  test("replaces the raw provider body rather than appending to it", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({ config: OLLAMA });

    expect(message).not.toContain(JSON.stringify(OLLAMA_NO_USER_QUERY));
    expect(message).not.toContain("{");
  });

  test("never names the provider's address", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({ config: OLLAMA });

    expect(message).not.toContain("ollama.internal");
    expect(message).not.toContain("11434");
  });

  test("is recognized in the Qwen chat template's own capitalization", async () => {
    mockProviderError(500, { error: "No user query found in messages." });

    const message: string = await completionError({ config: OLLAMA });

    expect(message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
  });

  test("is recognized when the error is a bare string body", async () => {
    mockProviderError(500, "no user query found in messages" as never);

    const message: string = await completionError({ config: OLLAMA });

    expect(message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
  });

  test("is recognized on the first call too, when the question is the newest message", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      messages: AGENT_CONVERSATION.slice(0, 2),
    });

    expect(message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
  });
});

describe("the num_ctx the provider already sends", () => {
  test("is quoted when it is below the recommendation", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      additionalParams: { options: { num_ctx: 32768 } },
    });

    expect(message).toContain(
      `Additional Parameters to 65536 or more (it is 32768 now), or set OLLAMA_CONTEXT_LENGTH`,
    );
  });

  test("is the floor when it already meets the recommendation", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      additionalParams: { options: { num_ctx: 65536 } },
    });

    expect(message).toContain(
      `Additional Parameters above 65536, or set OLLAMA_CONTEXT_LENGTH`,
    );
    expect(message).not.toContain("65536 or more");
  });

  test("is the floor when it is already above the recommendation", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      additionalParams: { options: { num_ctx: 131072 } },
    });

    expect(message).toContain(`Additional Parameters above 131072,`);
  });

  test("is left out when it is not a number", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      additionalParams: { options: { num_ctx: "lots" } },
    });

    expect(message).toContain("to 65536 or more, or set");
    expect(message).not.toContain("lots");
    expect(message).not.toContain("now)");
  });

  test("is left out when options is not an object", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      additionalParams: { options: [32768] as never },
    });

    expect(message).toContain("to 65536 or more, or set");
  });

  test("is left out when only other settings are configured", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      additionalParams: { options: { top_k: 20 }, keep_alive: "10m" },
    });

    expect(message).toContain("to 65536 or more, or set");
  });
});

describe("a request that never had a question", () => {
  test("keeps the server's own words: nothing was dropped to cause it", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      messages: [
        { role: "system", content: "You are OneUptime AI." },
        { role: "assistant", content: "Earlier answer." },
      ],
    });

    expect(message).toBe(
      `Ollama API error: ${JSON.stringify(OLLAMA_NO_USER_QUERY)}`,
    );
  });

  test("counts a user message that only wraps a tool response as no question, as Qwen does", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      messages: [
        { role: "system", content: "You are OneUptime AI." },
        {
          role: "user",
          content: "  <tool_response>\n{}\n</tool_response>\n",
        },
      ],
    });

    expect(message).not.toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
  });

  test("counts a user message that merely mentions a tool response as a question", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      messages: [
        { role: "system", content: "You are OneUptime AI." },
        {
          role: "user",
          content: "<tool_response> looks odd — what does it mean?",
        },
      ],
    });

    expect(message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
  });
});

describe("Ollama says not even the newest message fits", () => {
  test("names the context window and the setting that raises it", async () => {
    mockProviderError(400, { error: PROMPT_LONGER_THAN_CONTEXT });

    const message: string = await completionError({ config: OLLAMA });

    expect(message).toBe(
      `Ollama API error: the request is larger than the model's context window ("the prompt is longer than the context length currently available to the model"). Raise the context window: set "num_ctx" under "options" in this LLM provider's Additional Parameters to 65536 or more, or set OLLAMA_CONTEXT_LENGTH on the Ollama server.`,
    );
  });

  test("is recognized whether or not the request had a question", async () => {
    mockProviderError(400, { error: PROMPT_LONGER_THAN_CONTEXT });

    const message: string = await completionError({
      config: OLLAMA,
      messages: [{ role: "system", content: "x".repeat(10_000) }],
    });

    expect(message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
  });
});

describe("Ollama behind an OpenAI-compatible provider", () => {
  test("points at OLLAMA_CONTEXT_LENGTH, because that API has no num_ctx", async () => {
    mockProviderError(500, OPENAI_STYLE_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA_OPENAI_COMPATIBLE,
    });

    expect(message).toBe(
      `OpenAICompatible API error: the request is larger than the model's context window, so the server dropped the oldest messages, the question among them, and the model rejected the rest ("no user query found in messages"). If Ollama serves this model, set OLLAMA_CONTEXT_LENGTH on the Ollama server (its OpenAI-compatible API ignores num_ctx), or switch this provider to Ollama and set num_ctx in its Additional Parameters.`,
    );
  });

  test("does not offer an Additional Parameters fix that API would ignore", async () => {
    mockProviderError(500, OPENAI_STYLE_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA_OPENAI_COMPATIBLE,
      additionalParams: { options: { num_ctx: 32768 } },
    });

    expect(message).not.toContain('"num_ctx" under "options"');
    expect(message).not.toContain("32768");
  });

  test("recognizes Ollama's own too-long refusal", async () => {
    mockProviderError(400, {
      error: {
        message: PROMPT_LONGER_THAN_CONTEXT,
        type: "invalid_request_error",
        param: null,
        code: null,
      },
    });

    const message: string = await completionError({
      config: OLLAMA_OPENAI_COMPATIBLE,
    });

    expect(message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
    expect(message).toContain("OLLAMA_CONTEXT_LENGTH");
  });
});

describe("where the provider's error details are withheld", () => {
  test("the overflow is still explained: the explanation is OneUptime's own words", async () => {
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    const message: string = await completionError({
      config: OLLAMA,
      includeProviderErrorDetails: false,
    });

    expect(message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
    expect(message).toContain("OLLAMA_CONTEXT_LENGTH");
  });

  test("a provider that echoes the prompt beside the phrase does not leak it", async () => {
    mockProviderError(400, {
      error: `${PROMPT_LONGER_THAN_CONTEXT}: SECRET-123`,
    });

    const message: string = await completionError({
      config: OLLAMA,
      messages: [{ role: "user", content: "SECRET-123" }],
      includeProviderErrorDetails: false,
    });

    expect(message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
    expect(message).not.toContain("SECRET-123");
  });

  test("the provider's body is not logged", async () => {
    const errorLog: jest.SpyInstance = jest.spyOn(logger, "error");
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    await completionError({
      config: OLLAMA,
      includeProviderErrorDetails: false,
    });

    for (const call of errorLog.mock.calls) {
      expect(call[0]).not.toBeInstanceOf(HTTPErrorResponse);
    }
  });

  test("where they are allowed, the provider's body is still logged for the operator", async () => {
    const errorLog: jest.SpyInstance = jest.spyOn(logger, "error");
    mockProviderError(500, OLLAMA_NO_USER_QUERY);

    await completionError({ config: OLLAMA });

    expect(
      errorLog.mock.calls.some((call: Array<unknown>) => {
        return call[0] instanceof HTTPErrorResponse;
      }),
    ).toBe(true);
  });
});

describe("every other error is left as it was", () => {
  test("an unrelated Ollama error keeps the provider's body", async () => {
    const body: JSONObject = { error: "model 'qwen3.8' not found" };
    mockProviderError(404, body);

    const message: string = await completionError({ config: OLLAMA });

    expect(message).toBe(`Ollama API error: ${JSON.stringify(body)}`);
  });

  test("an unrelated Ollama error stays generic when details are withheld", async () => {
    mockProviderError(404, { error: "model 'qwen3.8' not found" });

    const message: string = await completionError({
      config: OLLAMA,
      includeProviderErrorDetails: false,
    });

    expect(message).toBe(
      "Ollama API request failed. Review the provider configuration and try again.",
    );
  });

  test("OpenAI's context-length refusal is not mistaken for Ollama's", async () => {
    const body: JSONObject = {
      error: {
        message:
          "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
        type: "invalid_request_error",
        param: "messages",
        code: "context_length_exceeded",
      },
    };
    mockProviderError(400, body);

    const message: string = await completionError({ config: OPENAI });

    expect(message).toBe(`OpenAI API error: ${JSON.stringify(body)}`);
    expect(message).not.toContain("OLLAMA_CONTEXT_LENGTH");
  });

  test("Anthropic's prompt-too-long refusal is not mistaken for Ollama's", async () => {
    const body: JSONObject = {
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "prompt is too long: 210000 tokens > 200000 maximum",
      },
    };
    mockProviderError(400, body);

    const message: string = await completionError({ config: ANTHROPIC });

    expect(message).toBe(`Anthropic API error: ${JSON.stringify(body)}`);
  });

  test("an error body without a message is left alone", async () => {
    const body: JSONObject = { error: { code: 500 } };
    mockProviderError(500, body);

    const message: string = await completionError({ config: OLLAMA });

    expect(message).toBe(`Ollama API error: ${JSON.stringify(body)}`);
  });
});

describe("the explanation is short enough to be shown whole", () => {
  test.each([
    {
      name: "Ollama, no question left, num_ctx configured",
      config: OLLAMA,
      body: OLLAMA_NO_USER_QUERY,
      additionalParams: { options: { num_ctx: 32768 } },
    },
    {
      name: "Ollama, newest message too long",
      config: OLLAMA,
      body: { error: PROMPT_LONGER_THAN_CONTEXT },
      additionalParams: { options: { num_ctx: 1_048_576 } },
    },
    {
      name: "OpenAI-compatible, no question left",
      config: OLLAMA_OPENAI_COMPATIBLE,
      body: OPENAI_STYLE_NO_USER_QUERY,
      additionalParams: undefined,
    },
  ])(
    "$name",
    async (data: {
      config: LLMProviderConfig;
      body: JSONObject;
      additionalParams: JSONObject | undefined;
    }) => {
      mockProviderError(500, data.body);

      const message: string = await completionError({
        config: data.config,
        additionalParams: data.additionalParams,
      });

      expect(message).toContain(LLMService.CONTEXT_WINDOW_OVERFLOW_ERROR);
      expect(message.length).toBeLessThanOrEqual(DISPLAYED_ERROR_LENGTH);
    },
  );
});

describe("an investigation that overflows is not re-run", () => {
  test.each([
    { config: OLLAMA, body: OLLAMA_NO_USER_QUERY },
    { config: OLLAMA, body: { error: PROMPT_LONGER_THAN_CONTEXT } },
    { config: OLLAMA_OPENAI_COMPATIBLE, body: OPENAI_STYLE_NO_USER_QUERY },
  ])(
    "$config.llmType: re-running sends it into the same window",
    async (data: { config: LLMProviderConfig; body: JSONObject }) => {
      mockProviderError(500, data.body);

      const message: string = await completionError({ config: data.config });

      expect(isPermanentInvestigationFailure(message)).toBe(true);
    },
  );

  test("a provider's transient failure is still retried", async () => {
    mockProviderError(500, { error: "model runner has unexpectedly stopped" });

    const message: string = await completionError({ config: OLLAMA });

    expect(isPermanentInvestigationFailure(message)).toBe(false);
  });

  test("a raw no-user-query refusal, with nothing dropped to cause it, is not classified", () => {
    expect(
      isPermanentInvestigationFailure(
        `Ollama API error: ${JSON.stringify(OLLAMA_NO_USER_QUERY)}`,
      ),
    ).toBe(false);
  });
});

describe("a request that fits is untouched", () => {
  test("a successful Ollama reply comes back as before", async () => {
    jest.spyOn(API, "post").mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          message: { role: "assistant", content: "The root cause is X." },
          done_reason: "stop",
          prompt_eval_count: 10,
          eval_count: 5,
        },
        {},
      ),
    );

    const response: { content: string } = await LLMService.getCompletion({
      llmProviderConfig: OLLAMA,
      messages: AGENT_CONVERSATION,
      requestRetries: 0,
    });

    expect(response.content).toBe("The root cause is X.");
  });
});
