import API from "../../../../Utils/API";
import stubLLMEgressGuard from "./StubLLMEgressGuard";
import logger from "../../../../Server/Utils/Logger";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import LlmType from "../../../../Types/LLM/LlmType";
import LLMService, {
  LLMCompletionRequest,
  LLMCompletionResponse,
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

/*
 * Issue #4583: the Anthropic provider always sent `temperature` (0.7 by
 * default, 0.2 for incident and alert notes, 0 for the provider test), and
 * every Claude model since Opus 4.7 answers that with a 400:
 *
 *   {"type":"error","error":{"type":"invalid_request_error",
 *    "message":"`temperature` is deprecated for this model."}}
 *
 * so on the default setup (Model Name blank, then claude-sonnet-5) Test LLM
 * Provider, AI investigations and AI notes all failed. Additional Parameters
 * were not sent to Anthropic at all, so there was no workaround either.
 *
 * What this file holds the Anthropic wire to:
 *  - a current model gets no sampling parameter it would refuse, from the
 *    first request on; an older model still gets the caller's temperature;
 *  - any other model that refuses one gets the request again without it, and
 *    the provider/model pair remembers that, as on the OpenAI wire;
 *  - errors that are not that are surfaced as they were, without a retry;
 *  - Additional Parameters are sent, minus the fields OneUptime owns;
 *  - a model that thinks before answering gets room for it in max_tokens;
 *  - a reply that is all thinking, or a refusal, is reported for what it is;
 *  - and OpenAI-compatible gateways in front of Claude get the same care.
 */

type PostSpy = ReturnType<typeof jest.spyOn>;

// The 400 from the issue, verbatim.
const TEMPERATURE_DEPRECATED: string =
  "`temperature` is deprecated for this model.";

const THINKING_ROOM: number = LLMService.ANTHROPIC_THINKING_ROOM_TOKENS;

const CURRENT_MODELS: Array<string> = [
  "claude-sonnet-5-5",
  "claude-opus-5-5",
  "claude-haiku-5-5",
  "claude-fable-5-1",
  "claude-sonnet-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-mythos-5-1",
];

const OLDER_MODELS: Array<string> = [
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5",
  "claude-haiku-4-5-20251001",
  "claude-sonnet-4-5-20250929",
];

// A name only the provider's own answer can say anything about.
const GATEWAY_MODEL: string = "prod-claude";

function anthropic(
  modelName?: string,
  extra?: Partial<LLMProviderConfig>,
): LLMProviderConfig {
  return {
    llmType: LlmType.Anthropic,
    apiKey: "sk-ant-test",
    ...(modelName ? { modelName: modelName } : {}),
    ...(extra || {}),
  };
}

function reply(
  content: Array<JSONObject>,
  stopReason: string = "end_turn",
  extra?: JSONObject,
): HTTPResponse<JSONObject> {
  return {
    jsonData: {
      content: content,
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 2 },
      ...(extra || {}),
    },
  } as unknown as HTTPResponse<JSONObject>;
}

function textReply(text: string = "OK"): HTTPResponse<JSONObject> {
  return reply([{ type: "text", text: text }]);
}

// An Anthropic error body, in the shape the API sends.
function anthropicError(
  statusCode: number,
  message: string,
  type: string = "invalid_request_error",
): HTTPErrorResponse {
  return new HTTPErrorResponse(
    statusCode,
    {
      type: "error",
      error: { type: type, message: message },
      request_id: "req_test",
    },
    {},
  );
}

function mockPost(): PostSpy {
  return jest.spyOn(API, "post") as PostSpy;
}

function bodyOf(spy: PostSpy, callIndex: number): JSONObject {
  return (spy.mock.calls[callIndex]![0] as { data: JSONObject }).data;
}

function sampling(body: JSONObject): JSONObject {
  return {
    temperature: body["temperature"],
    top_p: body["top_p"],
    top_k: body["top_k"],
  };
}

const NO_SAMPLING: JSONObject = {
  temperature: undefined,
  top_p: undefined,
  top_k: undefined,
};

function complete(
  config: LLMProviderConfig,
  extra?: Partial<LLMCompletionRequest>,
): Promise<LLMCompletionResponse> {
  return LLMService.getCompletion({
    llmProviderConfig: config,
    messages: [
      { role: "system", content: "You are a connection test." },
      { role: "user", content: "Reply with the word: OK" },
    ],
    ...(extra || {}),
  });
}

async function completionError(
  config: LLMProviderConfig,
  extra?: Partial<LLMCompletionRequest>,
): Promise<string> {
  try {
    await complete(config, extra);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected the completion to fail.");
}

let debugLog: PostSpy;
let errorLog: PostSpy;

beforeEach(() => {
  // These hosts are placeholders; the SSRF guard is covered elsewhere.
  stubLLMEgressGuard();
  LLMService.clearRequestAdaptationCache();
  debugLog = jest
    .spyOn(logger, "debug")
    .mockImplementation((): void => {}) as PostSpy;
  errorLog = jest
    .spyOn(logger, "error")
    .mockImplementation((): void => {}) as PostSpy;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("issue #4583 — the default Anthropic setup works", () => {
  test("Model Name left blank asks for the current Sonnet, without a temperature, in one request", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    // The provider test sends temperature 0: what failed in the issue.
    const response: LLMCompletionResponse = await complete(anthropic(), {
      temperature: 0,
      maxTokens: 4096,
    });

    expect(response.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(bodyOf(spy, 0)["model"]).toBe("claude-sonnet-5-5");
    expect(bodyOf(spy, 0)["model"]).toBe(LLMService.ANTHROPIC_DEFAULT_MODEL);
    expect(sampling(bodyOf(spy, 0))).toEqual(NO_SAMPLING);
  });

  test.each(CURRENT_MODELS)(
    "%s gets no temperature, top_p or top_k, from the first request",
    async (modelName: string) => {
      const spy: PostSpy = mockPost().mockResolvedValue(textReply());

      await complete(anthropic(modelName), {
        temperature: 0.2,
        additionalParams: { top_p: 0.9, top_k: 40 },
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(bodyOf(spy, 0)["model"]).toBe(modelName);
      expect(sampling(bodyOf(spy, 0))).toEqual(NO_SAMPLING);
    },
  );

  test.each(CURRENT_MODELS)(
    "%s gets none for a caller that protects its request either",
    async (modelName: string) => {
      const spy: PostSpy = mockPost().mockResolvedValue(textReply());

      await complete(anthropic(modelName), {
        temperature: 0,
        maxTokens: 20,
        protectRequestParameters: true,
        additionalParams: { top_p: 0.5 },
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(sampling(bodyOf(spy, 0))).toEqual(NO_SAMPLING);
    },
  );

  test("a Bedrock-style id of a current model is recognized too", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("us.anthropic.claude-opus-4-7"), {
      temperature: 0.2,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(bodyOf(spy, 0)["temperature"]).toBeUndefined();
  });
});

describe("older Claude models keep the caller's temperature", () => {
  test.each(OLDER_MODELS)(
    "%s gets the temperature the caller asked for",
    async (modelName: string) => {
      const spy: PostSpy = mockPost().mockResolvedValue(textReply());

      await complete(anthropic(modelName), { temperature: 0.2 });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(bodyOf(spy, 0)["temperature"]).toBe(0.2);
    },
  );

  test("a temperature of 0 is sent as 0, not dropped as falsy", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-4-6"), { temperature: 0 });

    expect(bodyOf(spy, 0)["temperature"]).toBe(0);
  });

  test("with no temperature from the caller, the long-standing 0.7 is sent", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-haiku-4-5"));

    expect(bodyOf(spy, 0)["temperature"]).toBe(0.7);
  });
});

describe("a model the hints do not know — the provider's 400 decides", () => {
  test("the issue's exact 400 is answered by the same request without temperature", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, TEMPERATURE_DEPRECATED))
      .mockResolvedValueOnce(textReply());

    const response: LLMCompletionResponse = await complete(
      anthropic(GATEWAY_MODEL),
      {
        temperature: 0.2,
        maxTokens: 512,
        tools: [
          {
            name: "query_incidents",
            description: "query incidents",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
    );

    expect(response.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(bodyOf(spy, 0)["temperature"]).toBe(0.2);

    // Only the refused parameter changed; the request is otherwise the same.
    const retried: JSONObject = { ...bodyOf(spy, 1) };
    const original: JSONObject = { ...bodyOf(spy, 0) };
    delete original["temperature"];

    expect(retried["temperature"]).toBeUndefined();
    expect(retried).toEqual(original);
    expect(retried["max_tokens"]).toBe(512);
    expect(retried["tools"]).toHaveLength(1);
    expect(retried["system"]).toBeDefined();
  });

  test("parameters refused one per response are dropped one at a time", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, TEMPERATURE_DEPRECATED))
      .mockResolvedValueOnce(
        anthropicError(400, "`top_k` is deprecated for this model."),
      )
      .mockResolvedValueOnce(textReply());

    const response: LLMCompletionResponse = await complete(
      anthropic(GATEWAY_MODEL),
      {
        temperature: 0.2,
        additionalParams: { top_k: 40, metadata: { user_id: "u-1" } },
      },
    );

    expect(response.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(3);
    expect(bodyOf(spy, 1)["temperature"]).toBeUndefined();
    expect(bodyOf(spy, 1)["top_k"]).toBe(40);
    expect(sampling(bodyOf(spy, 2))).toEqual(NO_SAMPLING);
    // What the model did not refuse is still sent.
    expect(bodyOf(spy, 2)["metadata"]).toEqual({ user_id: "u-1" });
  });

  test("a gateway's own wording of the refusal is understood as well", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          400,
          {
            error_code: "BAD_REQUEST",
            message:
              "Model us.anthropic.claude-opus-4-7 does not support the temperature parameter.",
          },
          {},
        ),
      )
      .mockResolvedValueOnce(textReply());

    await complete(anthropic(GATEWAY_MODEL), { temperature: 0.2 });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(bodyOf(spy, 1)["temperature"]).toBeUndefined();
  });

  test("what the model accepted is remembered, so the next completion goes right the first time", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, TEMPERATURE_DEPRECATED))
      .mockResolvedValue(textReply());

    await complete(anthropic(GATEWAY_MODEL), { temperature: 0.2 });
    expect(spy).toHaveBeenCalledTimes(2);

    await complete(anthropic(GATEWAY_MODEL), { temperature: 0.2 });

    // One request, already without temperature.
    expect(spy).toHaveBeenCalledTimes(3);
    expect(bodyOf(spy, 2)["temperature"]).toBeUndefined();
  });

  test("another model name re-probes", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, TEMPERATURE_DEPRECATED))
      .mockResolvedValue(textReply());

    await complete(anthropic(GATEWAY_MODEL), { temperature: 0.2 });
    await complete(anthropic("prod-claude-2"), { temperature: 0.2 });

    expect(bodyOf(spy, 2)["temperature"]).toBe(0.2);
  });

  test("the same model name behind another base URL re-probes", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, TEMPERATURE_DEPRECATED))
      .mockResolvedValue(textReply());

    await complete(
      anthropic(GATEWAY_MODEL, { baseUrl: "https://gateway-a.example.com/v1" }),
      { temperature: 0.2 },
    );
    await complete(
      anthropic(GATEWAY_MODEL, { baseUrl: "https://gateway-b.example.com/v1" }),
      { temperature: 0.2 },
    );

    expect(bodyOf(spy, 2)["temperature"]).toBe(0.2);
  });

  test("what an Anthropic model refused is not applied to an OpenAI-compatible provider of the same name", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, TEMPERATURE_DEPRECATED))
      .mockResolvedValueOnce(textReply())
      .mockResolvedValueOnce({
        jsonData: { choices: [{ message: { content: "OK" } }] },
      } as unknown as HTTPResponse<JSONObject>);

    await complete(
      anthropic(GATEWAY_MODEL, { baseUrl: "https://gateway.example.com/v1" }),
      { temperature: 0.2 },
    );
    await complete(
      {
        llmType: LlmType.OpenAICompatible,
        baseUrl: "https://gateway.example.com/v1",
        modelName: GATEWAY_MODEL,
      },
      { temperature: 0.2 },
    );

    expect(bodyOf(spy, 2)["temperature"]).toBe(0.2);
  });

  test("a request that still fails after the drop is not remembered as a working shape", async () => {
    mockPost()
      .mockResolvedValueOnce(anthropicError(400, TEMPERATURE_DEPRECATED))
      .mockResolvedValueOnce(
        anthropicError(529, "Overloaded", "overloaded_error"),
      );

    await expect(
      complete(anthropic(GATEWAY_MODEL), { temperature: 0.2 }),
    ).rejects.toThrow("Anthropic API error");

    jest.restoreAllMocks();
    stubLLMEgressGuard();
    jest.spyOn(logger, "debug").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});

    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic(GATEWAY_MODEL), { temperature: 0.2 });

    expect(bodyOf(spy, 0)["temperature"]).toBe(0.2);
  });

  test("the loop ends when the model keeps refusing after the drop", async () => {
    /*
     * A misbehaving endpoint that keeps naming a parameter the request no
     * longer carries. Only a parameter that was sent can be dropped, so the
     * second refusal is surfaced instead of looping.
     */
    const spy: PostSpy = mockPost().mockResolvedValue(
      anthropicError(400, TEMPERATURE_DEPRECATED),
    );

    const message: string = await completionError(anthropic(GATEWAY_MODEL), {
      temperature: 0.2,
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(message).toContain(TEMPERATURE_DEPRECATED);
  });

  test("the debug log says which parameter was left out, in OneUptime's words", async () => {
    mockPost()
      .mockResolvedValueOnce(anthropicError(400, TEMPERATURE_DEPRECATED))
      .mockResolvedValueOnce(textReply());

    await complete(anthropic(GATEWAY_MODEL), { temperature: 0.2 });

    const logged: string = debugLog.mock.calls.flat().map(String).join("\n");

    expect(logged).toContain("leaving out temperature");
    expect(logged).toContain(GATEWAY_MODEL);
    // The provider's own sentence is not repeated in the log.
    expect(logged).not.toContain("deprecated");
  });

  test("where provider error details are withheld, the request still adapts and nothing of the error is logged", async () => {
    const privateEcho: string =
      "`temperature` is deprecated for this model. prompt echo: SECRET-123";
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, privateEcho))
      .mockResolvedValueOnce(textReply());

    const response: LLMCompletionResponse = await complete(
      anthropic(GATEWAY_MODEL),
      { temperature: 0.2, includeProviderErrorDetails: false },
    );

    expect(response.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(2);

    const logged: string = [...debugLog.mock.calls, ...errorLog.mock.calls]
      .flat()
      .map((value: unknown): string => {
        return typeof value === "string" ? value : JSON.stringify(value);
      })
      .join("\n");

    expect(logged).not.toContain("SECRET-123");
  });
});

describe("errors that are not a refused parameter are surfaced as they were", () => {
  test.each([
    [401, "invalid x-api-key", "authentication_error"],
    [404, "model: claude-sonnet-9-9", "not_found_error"],
    [
      400,
      "temperature: Input should be less than or equal to 1",
      "invalid_request_error",
    ],
    [
      400,
      "`temperature` and `top_p` cannot both be specified for this model. Please use only one.",
      "invalid_request_error",
    ],
    [
      400,
      'tool_choice: type "tool" and "any" are not supported for this model.',
      "invalid_request_error",
    ],
    [
      400,
      "prompt is too long: 250000 tokens > 200000 maximum",
      "invalid_request_error",
    ],
  ])(
    "%p %p: one request, and the provider's words in the error",
    async (statusCode: number, message: string, type: string) => {
      const spy: PostSpy = mockPost().mockResolvedValue(
        anthropicError(statusCode, message, type),
      );

      const thrown: string = await completionError(anthropic(GATEWAY_MODEL), {
        temperature: 0.2,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(thrown).toContain("Anthropic API error");
      // The error quotes the provider's body as JSON.
      expect(thrown).toContain(JSON.stringify(message).slice(1, -1));
    },
  );

  test("a refusal of a parameter the request did not carry is surfaced", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(
      anthropicError(400, "`top_k` is deprecated for this model."),
    );

    await completionError(anthropic(GATEWAY_MODEL), { temperature: 0.2 });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("a refusal of something that is not a sampling parameter is surfaced", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(
      anthropicError(
        400,
        '"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.',
      ),
    );

    await completionError(anthropic(GATEWAY_MODEL), {
      additionalParams: { thinking: { type: "disabled" } },
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("Additional Parameters reach Anthropic requests", () => {
  test("they are sent with the request, overriding OneUptime's defaults", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-4-6"), {
      temperature: 0.2,
      maxTokens: 1024,
      additionalParams: {
        temperature: 0.9,
        top_k: 40,
        stop_sequences: ["END"],
        metadata: { user_id: "oneuptime-project" },
        service_tier: "standard_only",
        output_config: { effort: "low" },
      },
    });

    expect(bodyOf(spy, 0)).toMatchObject({
      temperature: 0.9,
      top_k: 40,
      stop_sequences: ["END"],
      metadata: { user_id: "oneuptime-project" },
      service_tier: "standard_only",
      output_config: { effort: "low" },
      max_tokens: 1024,
    });
  });

  test("they cannot replace the model, the conversation, the system prompt or the tools, or stream", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-4-6"), {
      tools: [
        {
          name: "query_incidents",
          description: "query incidents",
          inputSchema: { type: "object", properties: {} },
        },
      ],
      additionalParams: {
        model: "attacker-model",
        messages: [{ role: "user", content: "overridden prompt" }],
        system: "overridden system prompt",
        tools: [],
        tool_choice: { type: "none" },
        stream: true,
      },
    });

    const body: JSONObject = bodyOf(spy, 0);

    expect(body["model"]).toBe("claude-sonnet-4-6");
    expect(body["messages"]).toEqual([
      { role: "user", content: "Reply with the word: OK" },
    ]);
    expect(body["system"]).toEqual([
      {
        type: "text",
        text: "You are a connection test.",
        cache_control: { type: "ephemeral" },
      },
    ]);
    expect(body["tools"]).toHaveLength(1);
    expect(body["tool_choice"]).toBeUndefined();
    expect(body["stream"]).toBeUndefined();
  });

  test("an operator's max_tokens is the whole cap, as written", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-5-5"), {
      maxTokens: 512,
      additionalParams: { max_tokens: 30000 },
    });

    expect(bodyOf(spy, 0)["max_tokens"]).toBe(30000);
  });

  test("a protected caller keeps only generation tuning, and its own temperature and cap", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-4-6"), {
      temperature: 0,
      maxTokens: 64,
      protectRequestParameters: true,
      additionalParams: {
        // Generation tuning, on the allowlist under Anthropic's own names.
        top_k: 40,
        stop_sequences: ["END"],
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        // Not the operator's to change for this caller.
        temperature: 1,
        max_tokens: 99_999,
        metadata: { user_id: "retained-by-provider" },
        service_tier: "auto",
        container: { id: "container_1" },
        mcp_servers: [{ type: "url", url: "https://mcp.example.com" }],
      },
    });

    const body: JSONObject = bodyOf(spy, 0);

    expect(body).toMatchObject({
      temperature: 0,
      max_tokens: 64,
      top_k: 40,
      stop_sequences: ["END"],
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
    });
    expect(body["metadata"]).toBeUndefined();
    expect(body["service_tier"]).toBeUndefined();
    expect(body["container"]).toBeUndefined();
    expect(body["mcp_servers"]).toBeUndefined();
  });

  test("on a current model, sampling parameters in them are left out and the rest is sent", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-opus-5-5"), {
      additionalParams: {
        temperature: 0.2,
        top_p: 0.9,
        top_k: 40,
        output_config: { effort: "low" },
      },
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(sampling(bodyOf(spy, 0))).toEqual(NO_SAMPLING);
    expect(bodyOf(spy, 0)["output_config"]).toEqual({ effort: "low" });
  });
});

describe("temperature and top_p are never sent together to a Claude 4 model", () => {
  test("an operator's top_p wins over the caller's temperature", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    // The provider form suggests exactly this preset.
    await complete(anthropic("claude-sonnet-4-6"), {
      temperature: 0.2,
      additionalParams: { top_p: 0.9 },
    });

    expect(bodyOf(spy, 0)["top_p"]).toBe(0.9);
    expect(bodyOf(spy, 0)["temperature"]).toBeUndefined();
  });

  test("a protected caller's temperature wins over the operator's top_p", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-4-6"), {
      temperature: 0,
      protectRequestParameters: true,
      additionalParams: { top_p: 0.9 },
    });

    expect(bodyOf(spy, 0)["temperature"]).toBe(0);
    expect(bodyOf(spy, 0)["top_p"]).toBeUndefined();
  });

  test("an operator who set both gets both, and the provider's own explanation", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-4-6"), {
      temperature: 0.2,
      additionalParams: { temperature: 0.5, top_p: 0.9 },
    });

    expect(bodyOf(spy, 0)["temperature"]).toBe(0.5);
    expect(bodyOf(spy, 0)["top_p"]).toBe(0.9);
  });
});

describe("a model that thinks before answering gets room for it", () => {
  test.each(["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"])(
    "%s: a one-word classification's 20 tokens get room for thinking on top",
    async (modelName: string) => {
      const spy: PostSpy = mockPost().mockResolvedValue(textReply());

      await complete(anthropic(modelName), { maxTokens: 20 });

      expect(bodyOf(spy, 0)["max_tokens"]).toBe(20 + THINKING_ROOM);
    },
  );

  test("the default cap gets the room too", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-5-5"));

    expect(bodyOf(spy, 0)["max_tokens"]).toBe(4096 + THINKING_ROOM);
  });

  test.each(["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6"])(
    "%s does not think unless asked, so the cap is the caller's",
    async (modelName: string) => {
      const spy: PostSpy = mockPost().mockResolvedValue(textReply());

      await complete(anthropic(modelName), { maxTokens: 20 });

      expect(bodyOf(spy, 0)["max_tokens"]).toBe(20);
    },
  );

  test("an operator who turned thinking off gets no room", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-5"), {
      maxTokens: 20,
      additionalParams: { thinking: { type: "disabled" } },
    });
    await complete(anthropic("claude-sonnet-5-5"), {
      maxTokens: 20,
      additionalParams: { thinking: { type: "between_tools" } },
    });

    expect(bodyOf(spy, 0)["max_tokens"]).toBe(20);
    expect(bodyOf(spy, 1)["max_tokens"]).toBe(20);
  });

  test("an operator who turned thinking on gets room on any model", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-4-6"), {
      maxTokens: 20,
      additionalParams: { thinking: { type: "adaptive" } },
    });

    expect(bodyOf(spy, 0)["max_tokens"]).toBe(20 + THINKING_ROOM);
  });

  test("a fixed thinking budget larger than the room is kept whole, so it fits under max_tokens", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-haiku-4-5"), {
      maxTokens: 20,
      additionalParams: {
        thinking: { type: "enabled", budget_tokens: 10000 },
      },
    });
    await complete(anthropic("claude-haiku-4-5"), {
      maxTokens: 20,
      additionalParams: {
        thinking: { type: "enabled", budget_tokens: 2048 },
      },
    });

    expect(bodyOf(spy, 0)["max_tokens"]).toBe(20 + 10000);
    expect(bodyOf(spy, 1)["max_tokens"]).toBe(20 + THINKING_ROOM);
  });

  test("a protected caller's cap gets the room, whatever the operator's max_tokens", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic("claude-sonnet-5-5"), {
      maxTokens: 20,
      protectRequestParameters: true,
      additionalParams: { max_tokens: 50 },
    });

    expect(bodyOf(spy, 0)["max_tokens"]).toBe(20 + THINKING_ROOM);
  });

  test("a model that turns out to think is remembered as one, whatever it is called", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(
        reply([
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: "INCONCLUSIVE" },
        ]),
      )
      .mockResolvedValue(textReply());

    await complete(anthropic(GATEWAY_MODEL), { maxTokens: 20 });
    await complete(anthropic(GATEWAY_MODEL), { maxTokens: 20 });

    expect(bodyOf(spy, 0)["max_tokens"]).toBe(20);
    expect(bodyOf(spy, 1)["max_tokens"]).toBe(20 + THINKING_ROOM);
  });

  test("a model whose replies carry no thinking is not given the room", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await complete(anthropic(GATEWAY_MODEL), { maxTokens: 20 });
    await complete(anthropic(GATEWAY_MODEL), { maxTokens: 20 });

    expect(bodyOf(spy, 1)["max_tokens"]).toBe(20);
  });
});

describe("reading a reply from a current model", () => {
  test("thinking blocks are skipped; the text and tool calls are the answer", async () => {
    mockPost().mockResolvedValue(
      reply(
        [
          { type: "thinking", thinking: "", signature: "sig-1" },
          { type: "redacted_thinking", data: "opaque" },
          { type: "text", text: "Checking incidents." },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "query_incidents",
            input: { state: "active" },
          },
        ],
        "tool_use",
      ),
    );

    const response: LLMCompletionResponse = await complete(
      anthropic("claude-sonnet-5-5"),
    );

    expect(response.content).toBe("Checking incidents.");
    expect(response.stopReason).toBe("tool_use");
    expect(response.toolCalls).toEqual([
      {
        id: "toolu_1",
        name: "query_incidents",
        arguments: { state: "active" },
      },
    ]);
  });

  test("a reply that ran out of tokens while thinking is a truncated answer, not an error", async () => {
    mockPost().mockResolvedValue(
      reply(
        [{ type: "thinking", thinking: "", signature: "sig" }],
        "max_tokens",
        { usage: { input_tokens: 300, output_tokens: 20 } },
      ),
    );

    const response: LLMCompletionResponse = await complete(
      anthropic("claude-sonnet-5-5"),
      { maxTokens: 20 },
    );

    expect(response.content).toBe("");
    expect(response.toolCalls).toBeUndefined();
    expect(response.stopReason).toBe("length");
    // The tokens were spent and billed, so they are reported.
    expect(response.usage?.completionTokens).toBe(20);
  });

  test("a reply cut off when the context window filled up is truncated too", async () => {
    mockPost().mockResolvedValue(
      reply(
        [{ type: "text", text: "The root cause is" }],
        "model_context_window_exceeded",
      ),
    );

    const response: LLMCompletionResponse = await complete(
      anthropic("claude-sonnet-5-5"),
    );

    expect(response.content).toBe("The root cause is");
    expect(response.stopReason).toBe("length");
  });

  test("a refusal says the model declined, and names the category", async () => {
    mockPost().mockResolvedValue(
      reply([], "refusal", {
        stop_details: {
          type: "refusal",
          category: "cyber",
          explanation: "free text from the provider",
        },
      }),
    );

    const message: string = await completionError(
      anthropic("claude-sonnet-5-5"),
    );

    expect(message).toContain("Anthropic declined this request");
    expect(message).toContain("(cyber)");
    expect(message).not.toContain("No text content");
    // The provider's free text is not repeated.
    expect(message).not.toContain("free text from the provider");
  });

  test("a refusal category that is not a plain identifier is not repeated", async () => {
    mockPost().mockResolvedValue(
      reply([], "refusal", {
        stop_details: { type: "refusal", category: "<b>SECRET prompt</b>" },
      }),
    );

    const message: string = await completionError(
      anthropic("claude-sonnet-5-5"),
    );

    expect(message).toContain("Anthropic declined this request");
    expect(message).not.toContain("SECRET");
  });

  test("a refusal without details still says what happened", async () => {
    mockPost().mockResolvedValue(reply([], "refusal"));

    expect(await completionError(anthropic("claude-opus-5-5"))).toBe(
      "Anthropic declined this request: the model's safety classifiers stopped it. Rephrase the request, or choose a different Claude model for this provider.",
    );
  });

  test("a finished reply with nothing but thinking in it is still an error", async () => {
    mockPost().mockResolvedValue(
      reply([{ type: "thinking", thinking: "", signature: "sig" }]),
    );

    expect(await completionError(anthropic("claude-sonnet-5-5"))).toBe(
      "No text content in Anthropic response",
    );
  });

  test("a finished reply with no content at all is still an error", async () => {
    mockPost().mockResolvedValue(reply([]));

    expect(await completionError(anthropic("claude-sonnet-5-5"))).toBe(
      "No response from Anthropic",
    );
  });
});

describe("the conversation sent to Anthropic stays valid", () => {
  test("an empty assistant turn is left out, and the user turns around it merge", async () => {
    /*
     * The agent loop replays a reply that came back empty at the output cap
     * and asks the model to go on. Anthropic refuses an empty message.
     */
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await LLMService.getCompletion({
      llmProviderConfig: anthropic("claude-sonnet-5-5"),
      messages: [
        { role: "user", content: "Which incidents are active?" },
        { role: "assistant", content: "" },
        { role: "user", content: "Continue your answer." },
        { role: "assistant", content: "   " },
      ],
    });

    expect(bodyOf(spy, 0)["messages"]).toEqual([
      {
        role: "user",
        content: "Which incidents are active?\n\nContinue your answer.",
      },
    ]);
  });

  test("an assistant turn with tool calls and no text is kept", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(textReply());

    await LLMService.getCompletion({
      llmProviderConfig: anthropic("claude-sonnet-5-5"),
      messages: [
        { role: "user", content: "Which incidents are active?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "t1", name: "query_incidents", arguments: {} }],
        },
        { role: "tool", toolCallId: "t1", content: "none" },
      ],
    });

    const messages: Array<JSONObject> = bodyOf(spy, 0)[
      "messages"
    ] as Array<JSONObject>;

    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "tool_use", id: "t1", name: "query_incidents", input: {} },
      ],
    });
  });
});

describe("OpenAI-compatible gateways serving a current Claude model", () => {
  function openAIReply(): HTTPResponse<JSONObject> {
    return {
      jsonData: {
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      },
    } as unknown as HTTPResponse<JSONObject>;
  }

  test.each([
    // LiteLLM model group named after the model.
    "claude-opus-4-7",
    // OpenRouter's id.
    "anthropic/claude-sonnet-5.5",
    "bedrock/anthropic.claude-haiku-5-5",
  ])(
    "%s gets no temperature or top_p, in one request",
    async (modelName: string) => {
      const spy: PostSpy = mockPost().mockResolvedValue(openAIReply());

      await LLMService.getCompletion({
        llmProviderConfig: {
          llmType: LlmType.OpenAICompatible,
          baseUrl: "https://gateway.example.com/v1",
          modelName: modelName,
        },
        messages: [{ role: "user", content: "hi" }],
        temperature: 0.2,
        additionalParams: { top_p: 0.9 },
      });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(bodyOf(spy, 0)["temperature"]).toBeUndefined();
      expect(bodyOf(spy, 0)["top_p"]).toBeUndefined();
    },
  );

  test("a gateway's refusal in words, with no param field, is answered without the parameter", async () => {
    // LiteLLM passes Anthropic's 400 on inside its own error.
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          400,
          {
            error: {
              message:
                'litellm.BadRequestError: AnthropicException - {"type":"error","error":{"type":"invalid_request_error","message":"`temperature` is deprecated for this model."}}. Received Model Group=team-claude',
              type: null,
              param: null,
              code: "400",
            },
          },
          {},
        ),
      )
      .mockResolvedValueOnce(openAIReply());

    const response: LLMCompletionResponse = await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.OpenAICompatible,
        baseUrl: "https://litellm.example.com/v1",
        modelName: "team-claude",
      },
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
    });

    expect(response.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(bodyOf(spy, 0)["temperature"]).toBe(0.2);
    expect(bodyOf(spy, 1)["temperature"]).toBeUndefined();
  });

  test("OpenAI's own models are untouched: gpt-4o still gets its temperature", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(openAIReply());

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.OpenAI,
        apiKey: "sk-test",
        modelName: "gpt-4o",
      },
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
    });

    expect(bodyOf(spy, 0)["temperature"]).toBe(0.2);
  });

  test("top_k refused through OpenAI's param field is now dropped as well", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(
        new HTTPErrorResponse(
          400,
          {
            error: {
              message:
                "Unsupported parameter: 'top_k' is not supported with this model.",
              type: "invalid_request_error",
              param: "top_k",
              code: "unsupported_parameter",
            },
          },
          {},
        ),
      )
      .mockResolvedValueOnce(openAIReply());

    await LLMService.getCompletion({
      llmProviderConfig: {
        llmType: LlmType.OpenAI,
        apiKey: "sk-test",
        modelName: "gpt-4o",
      },
      messages: [{ role: "user", content: "hi" }],
      additionalParams: { top_k: 40 },
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(bodyOf(spy, 1)["top_k"]).toBeUndefined();
  });
});
