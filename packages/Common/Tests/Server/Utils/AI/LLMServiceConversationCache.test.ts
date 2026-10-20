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
  LLMMessage,
  LLMProviderConfig,
  LLMToolCall,
  LLMToolDefinition,
} from "../../../../Server/Utils/LLM/LLMService";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Issue #5073: every call of an investigation or an Ask AI turn sends the
 * whole conversation again - the question, every earlier answer and every
 * earlier tool result - and only the system prompt and the tools were marked
 * for Anthropic's prompt cache, so the conversation was paid for in full on
 * every call: in the issue, the cached part of five calls stayed at the size
 * of the system prompt and the tools (20,654 tokens) while the call grew from
 * 24,117 to 40,411 tokens.
 *
 * What this file holds the Anthropic wire to (Anthropic's API, Claude in
 * Microsoft Foundry, and the gateways in front of Claude):
 *  - a call with tools - a call of an agent loop - marks the end of its
 *    conversation, and the block where the previous call ended, besides the
 *    system prompt and the last tool: never more than the API's four markers;
 *  - the marker moves forward with every call, while every byte before it
 *    stays as the previous call sent it, so the cache matches;
 *  - a call without tools, asked once, is not marked (writing its prompt to
 *    the cache costs a quarter more and nothing would read it);
 *  - an operator's own top-level cache_control is left to do its job;
 *  - an endpoint that refuses a marker gets fewer, remembered per endpoint;
 *  - no other wire is ever sent a cache_control field;
 *  - and the usage Anthropic reports counts the cached tokens as input.
 *
 * Never a real provider: API.post is mocked, and the egress guard stubbed.
 */

type PostSpy = ReturnType<typeof jest.spyOn>;

interface Marker {
  // Where the marker sits: "tools[3]", "system[0]", "messages[2].content[1]", "".
  path: string;
  block: JSONObject;
}

const EPHEMERAL: JSONObject = { type: "ephemeral" };

const SYSTEM_PROMPT: string =
  "You are OneUptime AI, an SRE assistant. Cite every fact as [C#].";
const QUESTION: string = "Why is checkout returning 500 errors?";

const TOOLS: Array<LLMToolDefinition> = [
  {
    name: "query_logs",
    description: "Search the project's logs.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "query_traces",
    description: "Search the project's traces.",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "run_kubectl",
    description: "Run a read-only kubectl command.",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" } },
    },
  },
];

function anthropic(modelName: string = "claude-sonnet-5-5"): LLMProviderConfig {
  return {
    llmType: LlmType.Anthropic,
    apiKey: "sk-ant-test",
    modelName: modelName,
  };
}

function anthropicReply(extra?: JSONObject): HTTPResponse<JSONObject> {
  return {
    jsonData: {
      content: [{ type: "text", text: "OK" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 2 },
      ...(extra || {}),
    },
  } as unknown as HTTPResponse<JSONObject>;
}

function anthropicError(statusCode: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(
    statusCode,
    {
      type: "error",
      error: { type: "invalid_request_error", message: message },
      request_id: "req_test",
    },
    {},
  );
}

// How a FastAPI gateway (LiteLLM, vLLM) answers a field its model forbids.
function fastApiError(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    422,
    {
      detail: [
        {
          type: "extra_forbidden",
          loc: ["body", "messages", 2, "content", 0, "cache_control"],
          msg: "Extra inputs are not permitted",
          input: { type: "ephemeral" },
        },
      ],
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

function lastBody(spy: PostSpy): JSONObject {
  return bodyOf(spy, spy.mock.calls.length - 1);
}

// Every cache_control in a request body, wherever it sits.
function markersOf(value: unknown, path: string = ""): Array<Marker> {
  const markers: Array<Marker> = [];

  if (Array.isArray(value)) {
    value.forEach((item: unknown, index: number) => {
      markers.push(...markersOf(item, `${path}[${index}]`));
    });
    return markers;
  }

  if (value && typeof value === "object") {
    const object: JSONObject = value as JSONObject;

    if (object["cache_control"] !== undefined) {
      markers.push({ path: path, block: object });
    }

    for (const key of Object.keys(object)) {
      if (key === "cache_control") {
        continue;
      }

      markers.push(
        ...markersOf(object[key], path ? `${path}.${key}` : key),
      );
    }
  }

  return markers;
}

function markerPaths(body: JSONObject): Array<string> {
  return markersOf(body)
    .map((marker: Marker): string => {
      return marker.path;
    })
    .sort();
}

/*
 * A conversation as the API reads it: no markers, and a string content as
 * the one text block it stands for. What one call sent must be, read so, the
 * start of what the next call sends - that is what the cache matches.
 */
function readAsTheApiDoes(messages: unknown): Array<JSONObject> {
  const strip: (value: unknown) => unknown = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(strip);
    }

    if (value && typeof value === "object") {
      const copy: JSONObject = {};

      for (const [key, inner] of Object.entries(value as JSONObject)) {
        if (key !== "cache_control") {
          copy[key] = strip(inner) as JSONObject;
        }
      }

      return copy;
    }

    return value;
  };

  return (messages as Array<JSONObject>).map((message: JSONObject) => {
    const stripped: JSONObject = strip(message) as JSONObject;

    if (typeof stripped["content"] === "string") {
      stripped["content"] = [{ type: "text", text: stripped["content"] }];
    }

    return stripped;
  });
}

function toolCall(id: string, name: string, query: string): LLMToolCall {
  return { id: id, name: name, arguments: { query: query } };
}

/*
 * An investigation's history after `rounds` rounds of tool calls, each
 * round asking for `parallel` tools at once - the shape ObservabilityAssistant
 * and ChatAgentRunner build: an assistant message with the calls, then one
 * tool message per result.
 */
function investigation(rounds: number, parallel: number = 1): Array<LLMMessage> {
  const messages: Array<LLMMessage> = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: QUESTION },
  ];

  for (let round: number = 1; round <= rounds; round++) {
    const calls: Array<LLMToolCall> = [];

    for (let index: number = 1; index <= parallel; index++) {
      calls.push(
        toolCall(
          `toolu_${round}_${index}`,
          index % 2 === 0 ? "query_traces" : "query_logs",
          `checkout errors, round ${round}, query ${index}`,
        ),
      );
    }

    messages.push({
      role: "assistant",
      content: round % 2 === 0 ? `Round ${round}: checking more.` : "",
      toolCalls: calls,
    });

    for (const call of calls) {
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: `<tool_result citation="C${call.id}">rows for ${call.id}</tool_result>`,
      });
    }
  }

  return messages;
}

async function complete(
  config: LLMProviderConfig,
  extra?: Partial<LLMCompletionRequest>,
): Promise<LLMCompletionResponse> {
  return LLMService.getCompletion({
    llmProviderConfig: config,
    messages: investigation(0),
    tools: TOOLS,
    ...(extra || {}),
  });
}

let debugLog: PostSpy;

beforeEach(() => {
  // These hosts are placeholders; the SSRF guard is covered elsewhere.
  stubLLMEgressGuard();
  LLMService.clearRequestAdaptationCache();
  debugLog = jest
    .spyOn(logger, "debug")
    .mockImplementation((): void => {}) as PostSpy;
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("issue #5073 — an agent loop's call marks its conversation for the prompt cache", () => {
  test("the first call marks the last tool, the system prompt and the question: three markers", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    await complete(anthropic());

    const body: JSONObject = bodyOf(spy, 0);

    expect(markerPaths(body)).toEqual(
      ["messages[0].content[0]", "system[0]", "tools[2]"].sort(),
    );

    // The question becomes the one text block it stands for, marked.
    expect(body["messages"]).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: QUESTION, cache_control: EPHEMERAL }],
      },
    ]);

    // Only the last tool is marked: it caches every tool before it.
    const tools: Array<JSONObject> = body["tools"] as Array<JSONObject>;
    expect(tools[0]!["cache_control"]).toBeUndefined();
    expect(tools[1]!["cache_control"]).toBeUndefined();
    expect(tools[2]!["cache_control"]).toEqual(EPHEMERAL);
  });

  test("the second call marks its newest tool result, and the question the first call ended on", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    await complete(anthropic(), { messages: investigation(1) });

    const messages: Array<JSONObject> = bodyOf(spy, 0)[
      "messages"
    ] as Array<JSONObject>;

    expect(messages.map((message: JSONObject) => message["role"])).toEqual([
      "user",
      "assistant",
      "user",
    ]);

    // The end: the newest tool result.
    expect((messages[2]!["content"] as Array<JSONObject>)[0]).toEqual({
      type: "tool_result",
      tool_use_id: "toolu_1_1",
      content: '<tool_result citation="Ctoolu_1_1">rows for toolu_1_1</tool_result>',
      cache_control: EPHEMERAL,
    });

    // Where the first call ended - and wrote its cache entry.
    expect(messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: QUESTION, cache_control: EPHEMERAL }],
    });

    // The assistant turn in between carries no marker.
    expect(markersOf(messages[1])).toEqual([]);
    expect(markersOf(bodyOf(spy, 0))).toHaveLength(4);
  });

  test("a round of parallel tool calls marks only the last result of the round", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    await complete(anthropic(), { messages: investigation(2, 3) });

    const messages: Array<JSONObject> = bodyOf(spy, 0)[
      "messages"
    ] as Array<JSONObject>;

    // The three results of each round ride in one user message.
    expect(messages).toHaveLength(5);

    const newest: Array<JSONObject> = messages[4]!["content"] as Array<JSONObject>;
    const previous: Array<JSONObject> = messages[2]![
      "content"
    ] as Array<JSONObject>;

    expect(
      newest.map((block: JSONObject) => block["cache_control"]),
    ).toEqual([undefined, undefined, EPHEMERAL]);
    expect(
      previous.map((block: JSONObject) => block["cache_control"]),
    ).toEqual([undefined, undefined, EPHEMERAL]);
    expect(markersOf(bodyOf(spy, 0))).toHaveLength(4);
  });

  test("a wrap-up instruction after the results is the end, so it carries the marker", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());
    const messages: Array<LLMMessage> = investigation(1);

    messages.push({
      role: "user",
      content: "You have made a very large number of calls. Answer now.",
    });

    await complete(anthropic(), { messages: messages });

    const sent: Array<JSONObject> = bodyOf(spy, 0)[
      "messages"
    ] as Array<JSONObject>;
    const lastContent: Array<JSONObject> = sent[2]![
      "content"
    ] as Array<JSONObject>;

    // Merged into the results' user message, as the API needs.
    expect(lastContent.map((block: JSONObject) => block["type"])).toEqual([
      "tool_result",
      "text",
    ]);
    expect(lastContent[0]!["cache_control"]).toBeUndefined();
    expect(lastContent[1]!["cache_control"]).toEqual(EPHEMERAL);
  });

  test("without a system prompt it places three markers: the last tool and two in the conversation", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    await complete(anthropic(), {
      messages: investigation(2).filter((message: LLMMessage) => {
        return message.role !== "system";
      }),
    });

    expect(bodyOf(spy, 0)["system"]).toBeUndefined();
    expect(markerPaths(bodyOf(spy, 0))).toEqual(
      ["messages[2].content[0]", "messages[4].content[0]", "tools[2]"].sort(),
    );
  });

  test("Claude in Microsoft Foundry gets the same markers", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    await complete(
      {
        llmType: LlmType.AzureOpenAI,
        apiKey: "azure-key",
        baseUrl: "https://contoso.services.ai.azure.com/anthropic/v1",
        modelName: "claude-sonnet-5-5",
      },
      { messages: investigation(1) },
    );

    expect(
      (spy.mock.calls[0]![0] as { url: { toString: () => string } }).url.toString(),
    ).toBe("https://contoso.services.ai.azure.com/anthropic/v1/messages");
    expect(markerPaths(bodyOf(spy, 0))).toEqual(
      [
        "messages[0].content[0]",
        "messages[2].content[0]",
        "system[0]",
        "tools[2]",
      ].sort(),
    );
  });

  test("an empty result is passed over for the block before it", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());
    const messages: Array<LLMMessage> = investigation(0);

    messages.push({
      role: "assistant",
      content: "",
      toolCalls: [
        toolCall("toolu_a", "query_logs", "a"),
        toolCall("toolu_b", "query_logs", "b"),
      ],
    });
    messages.push({ role: "tool", toolCallId: "toolu_a", content: "3 rows" });
    messages.push({ role: "tool", toolCallId: "toolu_b", content: "   " });

    await complete(anthropic(), { messages: messages });

    const results: Array<JSONObject> = (
      bodyOf(spy, 0)["messages"] as Array<JSONObject>
    )[2]!["content"] as Array<JSONObject>;

    expect(results[0]!["cache_control"]).toEqual(EPHEMERAL);
    expect(results[1]!["cache_control"]).toBeUndefined();
  });

  test("a message with nothing a marker may go on gets none, and the rest still goes", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());
    const messages: Array<LLMMessage> = investigation(0);

    messages.push({
      role: "assistant",
      content: "",
      toolCalls: [toolCall("toolu_a", "query_logs", "a")],
    });
    messages.push({ role: "tool", toolCallId: "toolu_a", content: "" });

    await complete(anthropic(), { messages: messages });

    // The empty result is not marked; the previous end - the question - is.
    expect(markerPaths(bodyOf(spy, 0))).toEqual(
      ["messages[0].content[0]", "system[0]", "tools[2]"].sort(),
    );
  });
});

describe("the marker moves with every call, and what came before stays as the cache holds it", () => {
  test.each([
    [1, "one tool call a round"],
    [4, "four parallel tool calls a round"],
  ])(
    "a ten-call investigation with %i (%s)",
    async (parallel: number) => {
      const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

      for (let round: number = 0; round < 10; round++) {
        await complete(anthropic(), {
          messages: investigation(round, parallel),
        });
      }

      expect(spy).toHaveBeenCalledTimes(10);

      for (let call: number = 0; call < 10; call++) {
        const body: JSONObject = bodyOf(spy, call);
        const messages: Array<JSONObject> = body[
          "messages"
        ] as Array<JSONObject>;
        const paths: Array<string> = markerPaths(body);

        // Never more than the four the API takes.
        expect(paths.length).toBeLessThanOrEqual(4);
        expect(paths).toContain("system[0]");
        expect(paths).toContain("tools[2]");

        // The end of this call's conversation is marked...
        const lastMessage: JSONObject = messages[messages.length - 1]!;
        const lastBlocks: Array<JSONObject> = lastMessage[
          "content"
        ] as Array<JSONObject>;
        expect(lastBlocks[lastBlocks.length - 1]!["cache_control"]).toEqual(
          EPHEMERAL,
        );

        if (call === 0) {
          expect(paths).toHaveLength(3);
          continue;
        }

        // ... and so is where the previous call's ended, read back directly.
        const previousMessages: Array<JSONObject> = bodyOf(spy, call - 1)[
          "messages"
        ] as Array<JSONObject>;
        const previousEnd: number = previousMessages.length - 1;
        const previousBlocks: Array<JSONObject> = messages[previousEnd]![
          "content"
        ] as Array<JSONObject>;

        expect(paths).toHaveLength(4);
        expect(
          previousBlocks[previousBlocks.length - 1]!["cache_control"],
        ).toEqual(EPHEMERAL);

        // Everything the previous call sent is, byte for byte, where it was.
        expect(
          readAsTheApiDoes(messages).slice(0, previousMessages.length),
        ).toEqual(readAsTheApiDoes(previousMessages));
      }
    },
  );

  test("the system prompt and the tools are sent the same on every call", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    for (let round: number = 0; round < 4; round++) {
      await complete(anthropic(), { messages: investigation(round) });
    }

    for (let call: number = 1; call < 4; call++) {
      expect(bodyOf(spy, call)["system"]).toEqual(bodyOf(spy, 0)["system"]);
      expect(bodyOf(spy, call)["tools"]).toEqual(bodyOf(spy, 0)["tools"]);
    }
  });

  test("the caller's messages are never changed: the markers go on the request's own copies", async () => {
    mockPost().mockResolvedValue(anthropicReply());
    const messages: Array<LLMMessage> = investigation(2);
    const before: string = JSON.stringify(messages);

    await complete(anthropic(), { messages: messages });

    expect(JSON.stringify(messages)).toBe(before);
  });
});

describe("a call without tools is asked once, and keeps the markers it always had", () => {
  test("a summary call marks the system prompt only, and sends the question as written", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    await complete(anthropic(), { tools: undefined });

    const body: JSONObject = bodyOf(spy, 0);

    expect(markerPaths(body)).toEqual(["system[0]"]);
    expect(body["messages"]).toEqual([{ role: "user", content: QUESTION }]);
  });

  test("an empty tool list is no agent loop either", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    await complete(anthropic(), { tools: [], messages: investigation(1) });

    expect(markerPaths(bodyOf(spy, 0))).toEqual(["system[0]"]);
  });

  test("an answer cut off and continued without tools adds no marker", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());
    const messages: Array<LLMMessage> = investigation(2);

    messages.push({ role: "assistant", content: "The checkout service" });
    messages.push({
      role: "user",
      content: "Your previous message was cut off. Continue it.",
    });

    await complete(anthropic(), { tools: undefined, messages: messages });

    expect(markerPaths(bodyOf(spy, 0))).toEqual(["system[0]"]);
  });
});

describe("an operator's own prompt caching", () => {
  test("a top-level cache_control in Additional Parameters is sent, and OneUptime adds none to the conversation", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    await complete(anthropic(), {
      messages: investigation(3),
      additionalParams: { cache_control: { type: "ephemeral" } },
    });

    const body: JSONObject = bodyOf(spy, 0);

    expect(body["cache_control"]).toEqual(EPHEMERAL);
    // The automatic marker takes the end; the explicit ones stay at two.
    expect(markerPaths(body)).toEqual(["", "system[0]", "tools[2]"].sort());
  });

  test("a caller that protects its request never takes it, and marks its conversation itself", async () => {
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    await complete(anthropic(), {
      messages: investigation(1),
      protectRequestParameters: true,
      additionalParams: { cache_control: { type: "ephemeral", ttl: "1h" } },
    });

    const body: JSONObject = bodyOf(spy, 0);

    expect(body["cache_control"]).toBeUndefined();
    expect(markerPaths(body)).toEqual(
      [
        "messages[0].content[0]",
        "messages[2].content[0]",
        "system[0]",
        "tools[2]",
      ].sort(),
    );
  });
});

describe("an endpoint that refuses the markers gets fewer, and keeps getting fewer", () => {
  const REFUSED_IN_MESSAGE: string =
    "messages.2.content.0.cache_control: Extra inputs are not permitted";

  test("a refused marker in the conversation: the request goes again with the system and tool markers only", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, REFUSED_IN_MESSAGE))
      .mockResolvedValue(anthropicReply());

    const response: LLMCompletionResponse = await complete(anthropic(), {
      messages: investigation(1),
    });

    expect(response.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(markersOf(bodyOf(spy, 0)["messages"])).toHaveLength(2);
    expect(markerPaths(bodyOf(spy, 1))).toEqual(
      ["system[0]", "tools[2]"].sort(),
    );

    // The retry is the same request, less the conversation's markers.
    expect(readAsTheApiDoes(bodyOf(spy, 1)["messages"])).toEqual(
      readAsTheApiDoes(bodyOf(spy, 0)["messages"]),
    );

    expect(debugLog).toHaveBeenCalledWith(
      expect.stringContaining(
        "leaving out the cache_control markers in the conversation",
      ),
    );
  });

  test("the step down is remembered: the endpoint's next call goes without them from the start", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, REFUSED_IN_MESSAGE))
      .mockResolvedValue(anthropicReply());

    await complete(anthropic(), { messages: investigation(1) });
    await complete(anthropic(), { messages: investigation(2) });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(markerPaths(bodyOf(spy, 2))).toEqual(
      ["system[0]", "tools[2]"].sort(),
    );
  });

  test("another model on the same endpoint is asked afresh", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, REFUSED_IN_MESSAGE))
      .mockResolvedValue(anthropicReply());

    await complete(anthropic("claude-sonnet-5-5"), {
      messages: investigation(1),
    });
    await complete(anthropic("claude-opus-5-5"), {
      messages: investigation(1),
    });

    expect(spy).toHaveBeenCalledTimes(3);
    expect(markersOf(bodyOf(spy, 2)["messages"])).toHaveLength(2);
  });

  test("a FastAPI gateway's 422 says the same thing in its own shape", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(fastApiError())
      .mockResolvedValue(anthropicReply());

    await complete(anthropic(), { messages: investigation(1) });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(markerPaths(bodyOf(spy, 1))).toEqual(
      ["system[0]", "tools[2]"].sort(),
    );
  });

  test("an endpoint that refuses cache_control everywhere ends up with none, and works", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(anthropicError(400, REFUSED_IN_MESSAGE))
      .mockResolvedValueOnce(
        anthropicError(400, "system.0.cache_control: Extra inputs are not permitted"),
      )
      .mockResolvedValue(anthropicReply());

    const response: LLMCompletionResponse = await complete(anthropic(), {
      messages: investigation(1),
    });

    expect(response.content).toBe("OK");
    expect(spy).toHaveBeenCalledTimes(3);
    expect(markersOf(bodyOf(spy, 2))).toEqual([]);
    // Nothing else of the request changed.
    expect(bodyOf(spy, 2)["system"]).toEqual([
      { type: "text", text: SYSTEM_PROMPT },
    ]);
    expect(bodyOf(spy, 2)["tools"]).toHaveLength(3);
    expect(debugLog).toHaveBeenCalledWith(
      expect.stringContaining("leaving out every cache_control marker"),
    );
  });

  test("a call without tools that is refused goes straight to none", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(
        anthropicError(400, "system.0.cache_control: Extra inputs are not permitted"),
      )
      .mockResolvedValue(anthropicReply());

    await complete(anthropic(), { tools: undefined });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(markersOf(bodyOf(spy, 1))).toEqual([]);
  });

  test("an operator's top-level cache_control goes too, once the endpoint refuses cache_control", async () => {
    const spy: PostSpy = mockPost()
      .mockResolvedValueOnce(
        anthropicError(400, "cache_control: Extra inputs are not permitted"),
      )
      .mockResolvedValue(anthropicReply());

    await complete(anthropic(), {
      messages: investigation(1),
      additionalParams: { cache_control: { type: "ephemeral" } },
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(markersOf(lastBody(spy))).toEqual([]);
  });

  test.each([
    [
      "Anthropic's limit of four",
      "A maximum of 4 blocks with cache_control may be provided. Found 5.",
    ],
    [
      "a marker on an empty text block",
      "messages.0.content.0.text: cache_control cannot be set for empty text blocks",
    ],
    ["a refusal about something else", "max_tokens: Field required"],
    [
      "another parameter not supported",
      "stop_sequences: Extra inputs are not permitted",
    ],
  ])(
    "an error that does not refuse a marker the request carried (%s) is reported as it is, not retried",
    async (_name: string, message: string) => {
      const spy: PostSpy = mockPost().mockResolvedValue(
        anthropicError(400, message),
      );

      await expect(
        complete(anthropic(), { messages: investigation(1) }),
      ).rejects.toThrow(message);

      expect(spy).toHaveBeenCalledTimes(1);
    },
  );

  test.each([429, 500, 529])(
    "a %i is not a refusal of the markers",
    async (statusCode: number) => {
      const spy: PostSpy = mockPost().mockResolvedValue(
        anthropicError(statusCode, "cache_control is not supported right now"),
      );

      await expect(
        complete(anthropic(), {
          messages: investigation(1),
          requestRetries: 0,
        }),
      ).rejects.toThrow();

      expect(spy).toHaveBeenCalledTimes(1);
    },
  );
});

describe("no other wire is ever sent a cache_control field", () => {
  const OPENAI_REPLY: HTTPResponse<JSONObject> = {
    jsonData: {
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 30, completion_tokens: 2, total_tokens: 32 },
    },
  } as unknown as HTTPResponse<JSONObject>;

  const OLLAMA_REPLY: HTTPResponse<JSONObject> = {
    jsonData: {
      message: { role: "assistant", content: "OK" },
      done_reason: "stop",
      prompt_eval_count: 30,
      eval_count: 2,
    },
  } as unknown as HTTPResponse<JSONObject>;

  test.each([
    [
      "OpenAI",
      { llmType: LlmType.OpenAI, apiKey: "sk-test", modelName: "gpt-5.1" },
      OPENAI_REPLY,
    ],
    [
      "Groq",
      { llmType: LlmType.Groq, apiKey: "gsk-test" },
      OPENAI_REPLY,
    ],
    [
      "Mistral",
      { llmType: LlmType.Mistral, apiKey: "mistral-test" },
      OPENAI_REPLY,
    ],
    [
      "an OpenAI-compatible server",
      {
        llmType: LlmType.OpenAICompatible,
        baseUrl: "http://vllm.local:8000/v1",
        modelName: "qwen3",
      },
      OPENAI_REPLY,
    ],
    [
      "an OpenAI-compatible gateway serving Claude",
      {
        llmType: LlmType.OpenAICompatible,
        baseUrl: "https://gateway.example.com/v1",
        modelName: "anthropic/claude-sonnet-5-5",
        apiKey: "gw-test",
      },
      OPENAI_REPLY,
    ],
    [
      "Azure OpenAI",
      {
        llmType: LlmType.AzureOpenAI,
        apiKey: "azure-key",
        baseUrl: "https://contoso.openai.azure.com/openai/v1",
        modelName: "gpt-5.1",
      },
      OPENAI_REPLY,
    ],
    [
      "Ollama",
      {
        llmType: LlmType.Ollama,
        baseUrl: "http://ollama.local:11434",
        modelName: "qwen3",
      },
      OLLAMA_REPLY,
    ],
  ])(
    "%s, on an agent loop's call",
    async (
      _name: string,
      config: LLMProviderConfig,
      reply: HTTPResponse<JSONObject>,
    ) => {
      const spy: PostSpy = mockPost().mockResolvedValue(reply);

      await complete(config, { messages: investigation(3, 2) });

      expect(spy).toHaveBeenCalledTimes(1);
      expect(markersOf(bodyOf(spy, 0))).toEqual([]);
      expect(JSON.stringify(bodyOf(spy, 0))).not.toContain("cache_control");
    },
  );
});

describe("never more than four markers, whatever the conversation", () => {
  /*
   * Conversations an agent loop can build, drawn from a seeded stream: with
   * or without a system prompt and tools, rounds of one to fifteen parallel
   * tool calls, empty assistant turns (a reply cut off while thinking),
   * empty and blank results, wrap-up and continue instructions, answers.
   */
  function drawConversation(random: SeededRandom): {
    messages: Array<LLMMessage>;
    tools: Array<LLMToolDefinition> | undefined;
  } {
    const messages: Array<LLMMessage> = [];

    if (random(4) > 0) {
      messages.push({ role: "system", content: SYSTEM_PROMPT });
    }

    messages.push({ role: "user", content: QUESTION });

    const rounds: number = random(8);

    for (let round: number = 0; round < rounds; round++) {
      const shape: number = random(10);

      if (shape === 0) {
        // A reply cut off before any text: an empty assistant turn.
        messages.push({ role: "assistant", content: "" });
        messages.push({ role: "user", content: "Continue." });
        continue;
      }

      if (shape === 1) {
        messages.push({ role: "assistant", content: "An answer so far." });
        messages.push({ role: "user", content: "And the database?" });
        continue;
      }

      const parallel: number = 1 + random(15);
      const calls: Array<LLMToolCall> = [];

      for (let index: number = 0; index < parallel; index++) {
        calls.push(toolCall(`toolu_${round}_${index}`, "query_logs", "q"));
      }

      messages.push({
        role: "assistant",
        content: random(2) === 0 ? "" : "Looking.",
        toolCalls: calls,
      });

      for (const call of calls) {
        const result: number = random(8);

        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: result === 0 ? "" : result === 1 ? "  " : "rows",
        });
      }

      if (random(5) === 0) {
        messages.push({ role: "user", content: "Answer now." });
      }
    }

    const toolCount: number = random(4);

    return {
      messages: messages,
      tools: toolCount === 0 ? undefined : TOOLS.slice(0, toolCount),
    };
  }

  test("over 400 drawn conversations: at most four markers, never on an empty block, the end marked when it can be", async () => {
    const random: SeededRandom = seededRandom(5073);
    const spy: PostSpy = mockPost().mockResolvedValue(anthropicReply());

    for (let draw: number = 0; draw < 400; draw++) {
      const conversation: {
        messages: Array<LLMMessage>;
        tools: Array<LLMToolDefinition> | undefined;
      } = drawConversation(random);

      await LLMService.getCompletion({
        llmProviderConfig: anthropic(),
        messages: conversation.messages,
        tools: conversation.tools,
      });

      const body: JSONObject = lastBody(spy);
      const markers: Array<Marker> = markersOf(body);

      expect({ draw, count: markers.length <= 4 }).toEqual({
        draw,
        count: true,
      });

      for (const marker of markers) {
        const block: JSONObject = marker.block;

        expect(block["cache_control"]).toEqual(EPHEMERAL);

        if (block["type"] === "text") {
          expect({ draw, text: String(block["text"]).trim() !== "" }).toEqual({
            draw,
            text: true,
          });
        }

        if (block["type"] === "tool_result") {
          expect({
            draw,
            content: String(block["content"]).trim() !== "",
          }).toEqual({ draw, content: true });
        }
      }

      const messages: Array<JSONObject> = body["messages"] as Array<JSONObject>;
      const conversationMarkers: number = markersOf(messages).length;

      if (!conversation.tools) {
        expect({ draw, conversationMarkers }).toEqual({
          draw,
          conversationMarkers: 0,
        });
        continue;
      }

      expect({ draw, atMostTwo: conversationMarkers <= 2 }).toEqual({
        draw,
        atMostTwo: true,
      });

      // The end is marked whenever its message has a block that can carry one.
      const lastMessage: JSONObject = messages[messages.length - 1]!;
      const lastContent: unknown = lastMessage["content"];
      const hasCacheableBlock: boolean = Array.isArray(lastContent)
        ? (lastContent as Array<JSONObject>).some((block: JSONObject) => {
            return block["type"] === "tool_result"
              ? String(block["content"]).trim() !== ""
              : block["type"] === "tool_use" ||
                  String(block["text"] || "").trim() !== "";
          })
        : String(lastContent).trim() !== "";

      expect({ draw, endMarked: markersOf(lastMessage).length > 0 }).toEqual({
        draw,
        endMarked: hasCacheableBlock,
      });
    }
  });
});

describe("Anthropic's usage counts the cached tokens as input", () => {
  test("cache reads and writes are input tokens: promptTokens holds them, and the cache counts say how many", async () => {
    mockPost().mockResolvedValue(
      anthropicReply({
        usage: {
          input_tokens: 3_271,
          cache_read_input_tokens: 20_654,
          cache_creation_input_tokens: 4_216,
          output_tokens: 1_571,
        },
      }),
    );

    const response: LLMCompletionResponse = await complete(anthropic(), {
      messages: investigation(2),
    });

    expect(response.usage).toEqual({
      promptTokens: 3_271 + 20_654 + 4_216,
      completionTokens: 1_571,
      totalTokens: 3_271 + 20_654 + 4_216 + 1_571,
      cachedInputTokens: 20_654,
      cacheCreationTokens: 4_216,
    });
  });

  test("a call that used no cache reports none", async () => {
    mockPost().mockResolvedValue(
      anthropicReply({
        usage: {
          input_tokens: 900,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 40,
        },
      }),
    );

    const response: LLMCompletionResponse = await complete(anthropic());

    expect(response.usage).toEqual({
      promptTokens: 900,
      completionTokens: 40,
      totalTokens: 940,
      cachedInputTokens: undefined,
      cacheCreationTokens: undefined,
    });
  });

  test("a usage block without cache fields at all (an older gateway) still adds up", async () => {
    mockPost().mockResolvedValue(
      anthropicReply({ usage: { input_tokens: 12, output_tokens: 3 } }),
    );

    const response: LLMCompletionResponse = await complete(anthropic());

    expect(response.usage!.promptTokens).toBe(12);
    expect(response.usage!.totalTokens).toBe(15);
    expect(response.usage!.cachedInputTokens).toBeUndefined();
  });
});
