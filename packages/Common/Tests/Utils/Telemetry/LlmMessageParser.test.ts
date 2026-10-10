import { describe, expect, test } from "@jest/globals";
import LlmMessageParser, {
  LLM_ANSWER_MAX_JSON_LENGTH,
  LlmAnswerReading,
  LlmCallContent,
  LlmMessage,
  LlmMessagePart,
  LlmMessagePartType,
} from "../../../Utils/Telemetry/LlmMessageParser";

/*
 * Customers see their AI conversations only if this parser understands how
 * their instrumentation wrote them down. Every shape below is one a real
 * library emits; each test names the library so a regression names the
 * customers it breaks.
 */

type Attributes = Record<string, unknown>;

function read(attributes: Attributes, events?: Array<unknown>): LlmCallContent {
  return LlmMessageParser.readCallContent({
    attributes: attributes,
    events: events,
  });
}

function textOf(message: LlmMessage | undefined): string {
  return message ? LlmMessageParser.getText(message) : "";
}

function partsOf(
  message: LlmMessage | undefined,
  type: LlmMessagePartType,
): Array<LlmMessagePart> {
  return (message?.parts || []).filter((part: LlmMessagePart): boolean => {
    return part.type === type;
  });
}

function event(name: string, attributes: Attributes): Record<string, unknown> {
  return {
    name: name,
    time: "2026-10-10T10:00:00.000Z",
    timeUnixNano: 1,
    attributes: attributes,
  };
}

describe("the current GenAI conventions (gen_ai.*.messages with parts)", () => {
  const input: string = JSON.stringify([
    { role: "user", parts: [{ type: "text", content: "Weather in Paris?" }] },
    {
      role: "assistant",
      parts: [
        {
          type: "tool_call",
          id: "call_1",
          name: "get_weather",
          arguments: { location: "Paris" },
        },
      ],
    },
    {
      role: "tool",
      parts: [
        { type: "tool_call_response", id: "call_1", response: "rainy, 57°F" },
      ],
    },
  ]);

  const output: string = JSON.stringify([
    {
      role: "assistant",
      parts: [
        { type: "reasoning", content: "The tool said rainy." },
        { type: "text", content: "It is rainy and 57°F in Paris." },
      ],
      finish_reason: "stop",
    },
  ]);

  const content: LlmCallContent = read({
    "gen_ai.system_instructions": JSON.stringify([
      { type: "text", content: "You are a weather bot." },
      { type: "text", content: "Answer in one sentence." },
    ]),
    "gen_ai.input.messages": input,
    "gen_ai.output.messages": output,
    "gen_ai.response.finish_reasons": '["stop"]',
  });

  test("the system instructions are read apart from the history", () => {
    expect(content.systemInstructions).toBe(
      "You are a weather bot.\n\nAnswer in one sentence.",
    );
  });

  test("the history keeps its order and roles", () => {
    expect(
      content.input.map((message: LlmMessage) => {
        return message.role;
      }),
    ).toEqual(["user", "assistant", "tool"]);
    expect(textOf(content.input[0])).toBe("Weather in Paris?");
  });

  test("a tool call keeps its id, name and arguments", () => {
    const call: LlmMessagePart | undefined = partsOf(
      content.input[1],
      LlmMessagePartType.ToolCall,
    )[0];

    expect(call?.toolCallId).toBe("call_1");
    expect(call?.toolName).toBe("get_weather");
    expect(JSON.parse(call?.arguments || "{}")).toEqual({ location: "Paris" });
  });

  test("a tool result keeps the id of the call it answers", () => {
    const result: LlmMessagePart | undefined = partsOf(
      content.input[2],
      LlmMessagePartType.ToolResult,
    )[0];

    expect(result?.toolCallId).toBe("call_1");
    expect(result?.text).toBe("rainy, 57°F");
  });

  test("the answer separates reasoning from text", () => {
    expect(textOf(content.output[0])).toBe("It is rainy and 57°F in Paris.");
    expect(
      partsOf(content.output[0], LlmMessagePartType.Reasoning)[0]?.text,
    ).toBe("The tool said rainy.");
  });

  test("finish reasons are read once, lower-cased", () => {
    expect(content.finishReasons).toEqual(["stop"]);
  });
});

describe("structured attributes flattened by OTLP ingest", () => {
  /*
   * When an SDK sends gen_ai.output.messages as a structured value (an
   * array of key/value lists), ingest flattens it with the attribute's key
   * in front of every nested key, and that is how it comes back.
   */
  test("prefixed keys are rebuilt into messages", () => {
    const content: LlmCallContent = read({
      "gen_ai.output.messages": [
        {
          "gen_ai.output.messages.role": "assistant",
          "gen_ai.output.messages.parts": [
            {
              "gen_ai.output.messages.parts.type": "text",
              "gen_ai.output.messages.parts.content": "Hello there",
            },
            {
              "gen_ai.output.messages.parts.type": "tool_call",
              "gen_ai.output.messages.parts.name": "lookup",
              "gen_ai.output.messages.parts.arguments.order": "A-1",
            },
          ],
        },
      ],
    });

    expect(content.output[0]?.role).toBe("assistant");
    expect(textOf(content.output[0])).toBe("Hello there");

    const call: LlmMessagePart | undefined = partsOf(
      content.output[0],
      LlmMessagePartType.ToolCall,
    )[0];
    expect(call?.toolName).toBe("lookup");
    expect(JSON.parse(call?.arguments || "{}")).toEqual({ order: "A-1" });
  });

  test("the same, read back as JSON text from the attribute map", () => {
    const content: LlmCallContent = read({
      "gen_ai.input.messages": JSON.stringify([
        {
          "gen_ai.input.messages.role": "user",
          "gen_ai.input.messages.parts": [
            {
              "gen_ai.input.messages.parts.type": "text",
              "gen_ai.input.messages.parts.content": "Hi",
            },
          ],
        },
      ]),
    });

    expect(content.input[0]?.role).toBe("user");
    expect(textOf(content.input[0])).toBe("Hi");
  });

  test("plain JSON keeps the dots in its own keys", () => {
    const content: LlmCallContent = read({
      "gen_ai.output.messages": JSON.stringify([
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              name: "set",
              arguments: { "feature.flag": true },
            },
          ],
        },
      ]),
    });

    const call: LlmMessagePart | undefined = partsOf(
      content.output[0],
      LlmMessagePartType.ToolCall,
    )[0];
    expect(JSON.parse(call?.arguments || "{}")).toEqual({
      "feature.flag": true,
    });
  });
});

describe("gen_ai.client.inference.operation.details (content on an event)", () => {
  test("input, output, instructions and finish reasons come from the event", () => {
    const content: LlmCallContent = read({ "gen_ai.operation.name": "chat" }, [
      event("gen_ai.client.inference.operation.details", {
        "gen_ai.system_instructions": JSON.stringify([
          { type: "text", content: "Be brief." },
        ]),
        "gen_ai.input.messages": JSON.stringify([
          { role: "user", parts: [{ type: "text", content: "Ping?" }] },
        ]),
        "gen_ai.output.messages": JSON.stringify([
          { role: "assistant", parts: [{ type: "text", content: "Pong." }] },
        ]),
        "gen_ai.response.finish_reasons": ["stop"],
      }),
    ]);

    expect(content.systemInstructions).toBe("Be brief.");
    expect(textOf(content.input[0])).toBe("Ping?");
    expect(textOf(content.output[0])).toBe("Pong.");
    expect(content.finishReasons).toEqual(["stop"]);
  });

  test("span attributes win over the event when both are present", () => {
    const content: LlmCallContent = read(
      {
        "gen_ai.output.messages": JSON.stringify([
          { role: "assistant", parts: [{ type: "text", content: "From span" }] },
        ]),
      },
      [
        event("gen_ai.client.inference.operation.details", {
          "gen_ai.output.messages": JSON.stringify([
            {
              role: "assistant",
              parts: [{ type: "text", content: "From event" }],
            },
          ]),
        }),
      ],
    );

    expect(textOf(content.output[0])).toBe("From span");
  });
});

describe("OpenLLMetry (indexed gen_ai.prompt / gen_ai.completion)", () => {
  const content: LlmCallContent = read({
    "gen_ai.prompt.0.role": "system",
    "gen_ai.prompt.0.content": "You are helpful.",
    "gen_ai.prompt.1.role": "user",
    "gen_ai.prompt.1.content": "Order status?",
    "gen_ai.prompt.2.role": "assistant",
    "gen_ai.prompt.2.tool_calls.0.id": "call_9",
    "gen_ai.prompt.2.tool_calls.0.name": "lookup_order",
    "gen_ai.prompt.2.tool_calls.0.arguments": '{"id":"A-1"}',
    "gen_ai.prompt.3.role": "tool",
    "gen_ai.prompt.3.tool_call_id": "call_9",
    "gen_ai.prompt.3.content": "Shipped",
    "gen_ai.prompt.10.role": "user",
    "gen_ai.prompt.10.content": "Thanks!",
    "gen_ai.completion.0.role": "assistant",
    "gen_ai.completion.0.content": "Your order shipped.",
    "gen_ai.completion.0.finish_reason": "stop",
  });

  test("messages are ordered numerically, not as text (10 after 3)", () => {
    expect(
      content.input.map((message: LlmMessage) => {
        return message.role;
      }),
    ).toEqual(["system", "user", "assistant", "tool", "user"]);
    expect(textOf(content.input[4])).toBe("Thanks!");
  });

  test("an assistant's tool calls are read from tool_calls.<j>.*", () => {
    const call: LlmMessagePart | undefined = partsOf(
      content.input[2],
      LlmMessagePartType.ToolCall,
    )[0];

    expect(call).toMatchObject({
      toolCallId: "call_9",
      toolName: "lookup_order",
      arguments: '{"id":"A-1"}',
    });
  });

  test("a tool message is the result of the call it names", () => {
    const result: LlmMessagePart | undefined = partsOf(
      content.input[3],
      LlmMessagePartType.ToolResult,
    )[0];

    expect(result).toMatchObject({ toolCallId: "call_9", text: "Shipped" });
  });

  test("the completion and its finish reason", () => {
    expect(textOf(content.output[0])).toBe("Your order shipped.");
    expect(content.finishReasons).toEqual(["stop"]);
  });

  test("a multimodal prompt written as the JSON text of a parts list", () => {
    const multimodal: LlmCallContent = read({
      "gen_ai.prompt.0.role": "user",
      "gen_ai.prompt.0.content": JSON.stringify([
        { type: "text", text: "What is in this picture?" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,AAAA" },
        },
      ]),
    });

    expect(textOf(multimodal.input[0])).toBe("What is in this picture?");

    const media: LlmMessagePart | undefined = partsOf(
      multimodal.input[0],
      LlmMessagePartType.Media,
    )[0];
    expect(media?.modality).toBe("image");
    // Inline bytes are never kept.
    expect(media?.uri).toBeUndefined();
  });

  test("a text that merely starts with [ is text", () => {
    const literal: LlmCallContent = read({
      "gen_ai.prompt.0.role": "user",
      "gen_ai.prompt.0.content": "[1, 2, 3] - sum these",
    });

    expect(textOf(literal.input[0])).toBe("[1, 2, 3] - sum these");
  });
});

describe("OpenInference (llm.input_messages, input.value, output.value)", () => {
  test("indexed messages with contents and tool calls", () => {
    const content: LlmCallContent = read({
      "llm.input_messages.0.message.role": "user",
      "llm.input_messages.0.message.contents.0.message_content.type": "text",
      "llm.input_messages.0.message.contents.0.message_content.text":
        "Describe this",
      "llm.input_messages.0.message.contents.1.message_content.type": "image",
      "llm.input_messages.0.message.contents.1.message_content.image.image.url":
        "https://example.com/cat.png",
      "llm.output_messages.0.message.role": "assistant",
      "llm.output_messages.0.message.tool_calls.0.tool_call.id": "t1",
      "llm.output_messages.0.message.tool_calls.0.tool_call.function.name":
        "classify",
      "llm.output_messages.0.message.tool_calls.0.tool_call.function.arguments":
        '{"label":"cat"}',
    });

    expect(textOf(content.input[0])).toBe("Describe this");
    expect(
      partsOf(content.input[0], LlmMessagePartType.Media)[0]?.uri,
    ).toBe("https://example.com/cat.png");
    expect(
      partsOf(content.output[0], LlmMessagePartType.ToolCall)[0],
    ).toMatchObject({ toolCallId: "t1", toolName: "classify" });
  });

  test("an input.value holding the whole request is read for its messages", () => {
    const content: LlmCallContent = read({
      "openinference.span.kind": "LLM",
      "input.value": JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello" }],
      }),
      "output.value": JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: "Hi!" },
            finish_reason: "stop",
          },
        ],
      }),
    });

    expect(textOf(content.input[0])).toBe("Hello");
    expect(textOf(content.output[0])).toBe("Hi!");
    expect(content.finishReasons).toEqual(["stop"]);
  });

  test("a chain's plain-text input and output", () => {
    const content: LlmCallContent = read({
      "input.value": "What is OneUptime?",
      "output.value": "An observability platform.",
    });

    expect(content.input[0]?.role).toBe("user");
    expect(textOf(content.input[0])).toBe("What is OneUptime?");
    expect(content.output[0]?.role).toBe("assistant");
    expect(textOf(content.output[0])).toBe("An observability platform.");
  });

  test("a chain's object input is read from its first text field", () => {
    const content: LlmCallContent = read({
      "input.value": JSON.stringify({ question: "Why is it slow?", k: 4 }),
    });

    expect(textOf(content.input[0])).toBe("Why is it slow?");
  });
});

describe("the Vercel AI SDK", () => {
  test("ai.prompt.messages, ai.response.text, ai.response.toolCalls and the finish reason", () => {
    const content: LlmCallContent = read({
      "gen_ai.system": "openai",
      "ai.prompt.messages": JSON.stringify([
        { role: "system", content: "You help with orders." },
        { role: "user", content: [{ type: "text", text: "Where is A-1?" }] },
      ]),
      "ai.response.text": "Let me check.",
      "ai.response.toolCalls": JSON.stringify([
        {
          toolCallType: "function",
          toolCallId: "tc_1",
          toolName: "lookupOrder",
          args: '{"id":"A-1"}',
        },
      ]),
      "ai.response.finishReason": "tool-calls",
    });

    expect(content.input[0]?.role).toBe("system");
    expect(textOf(content.input[1])).toBe("Where is A-1?");
    expect(textOf(content.output[0])).toBe("Let me check.");
    expect(
      partsOf(content.output[0], LlmMessagePartType.ToolCall)[0],
    ).toMatchObject({
      toolCallId: "tc_1",
      toolName: "lookupOrder",
      arguments: '{"id":"A-1"}',
    });
    expect(content.finishReasons).toEqual(["tool-calls"]);
  });

  test("tool calls with no text still make an answer", () => {
    const content: LlmCallContent = read({
      "ai.response.toolCalls": JSON.stringify([
        { toolCallId: "tc_2", toolName: "search", args: "{}" },
      ]),
    });

    expect(content.output).toHaveLength(1);
    expect(content.output[0]?.role).toBe("assistant");
    expect(
      partsOf(content.output[0], LlmMessagePartType.ToolCall),
    ).toHaveLength(1);
  });

  test("the tool span (ai.toolCall.*) is a tool run", () => {
    const content: LlmCallContent = read({
      "ai.toolCall.name": "search",
      "ai.toolCall.id": "tc_2",
      "ai.toolCall.args": '{"q":"refund policy"}',
      "ai.toolCall.result": '{"hits":3}',
    });

    expect(content.tool).toEqual({
      id: "tc_2",
      name: "search",
      arguments: '{"q":"refund policy"}',
      result: '{"hits":3}',
    });
  });
});

describe("provider message shapes inside any convention", () => {
  test("Anthropic content blocks: thinking, tool_use and tool_result", () => {
    const content: LlmCallContent = read({
      "gen_ai.input.messages": JSON.stringify([
        { role: "user", content: "Refund order A-1" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Need the order first." },
            { type: "tool_use", id: "tu_1", name: "get_order", input: { id: "A-1" } },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu_1",
              content: [{ type: "text", text: "Order A-1: $20" }],
            },
          ],
        },
      ]),
      "gen_ai.output.messages": JSON.stringify({
        role: "assistant",
        content: [{ type: "text", text: "Refunded $20." }],
        stop_reason: "end_turn",
      }),
    });

    expect(
      partsOf(content.input[1], LlmMessagePartType.Reasoning)[0]?.text,
    ).toBe("Need the order first.");
    expect(
      partsOf(content.input[1], LlmMessagePartType.ToolCall)[0],
    ).toMatchObject({ toolCallId: "tu_1", toolName: "get_order" });
    expect(
      partsOf(content.input[2], LlmMessagePartType.ToolResult)[0],
    ).toMatchObject({ toolCallId: "tu_1", text: "Order A-1: $20" });
    expect(textOf(content.output[0])).toBe("Refunded $20.");
    expect(content.finishReasons).toEqual(["end_turn"]);
  });

  test("OpenAI chat: tool_calls, a refusal and the legacy function_call", () => {
    const content: LlmCallContent = read({
      "gen_ai.input.messages": JSON.stringify([
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "c1",
              type: "function",
              function: { name: "search", arguments: '{"q":"x"}' },
            },
          ],
        },
        {
          role: "assistant",
          function_call: { name: "legacy", arguments: "{}" },
        },
      ]),
      "gen_ai.output.messages": JSON.stringify([
        { role: "assistant", content: null, refusal: "I can't help with that." },
      ]),
    });

    expect(
      partsOf(content.input[0], LlmMessagePartType.ToolCall)[0],
    ).toMatchObject({ toolCallId: "c1", toolName: "search", arguments: '{"q":"x"}' });
    expect(
      partsOf(content.input[1], LlmMessagePartType.ToolCall)[0]?.toolName,
    ).toBe("legacy");
    expect(
      partsOf(content.output[0], LlmMessagePartType.Refusal)[0]?.text,
    ).toBe("I can't help with that.");
  });

  test("Gemini: role model, parts with functionCall / functionResponse", () => {
    const content: LlmCallContent = read({
      "gen_ai.input.messages": JSON.stringify([
        { role: "user", parts: [{ text: "Weather?" }] },
        {
          role: "model",
          parts: [{ functionCall: { name: "weather", args: { city: "Oslo" } } }],
        },
        {
          role: "function",
          parts: [
            { functionResponse: { name: "weather", response: { temp: 3 } } },
          ],
        },
      ]),
      "gen_ai.output.messages": JSON.stringify({
        candidates: [
          {
            content: { role: "model", parts: [{ text: "3 degrees." }] },
            finishReason: "STOP",
          },
        ],
      }),
    });

    expect(
      content.input.map((message: LlmMessage) => {
        return message.role;
      }),
    ).toEqual(["user", "assistant", "tool"]);
    expect(
      partsOf(content.input[1], LlmMessagePartType.ToolCall)[0]?.toolName,
    ).toBe("weather");
    expect(
      partsOf(content.input[2], LlmMessagePartType.ToolResult)[0]?.toolName,
    ).toBe("weather");
    expect(textOf(content.output[0])).toBe("3 degrees.");
    expect(content.finishReasons).toEqual(["stop"]);
  });

  test("an OpenAI Responses API answer is one message: reasoning, text and tool calls", () => {
    const content: LlmCallContent = read({
      "output.value": JSON.stringify({
        output: [
          { type: "reasoning", summary: [{ type: "summary_text", text: "Plan" }] },
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Working on it." }],
          },
          { type: "function_call", name: "do_it", arguments: "{}", call_id: "f1" },
        ],
      }),
    });

    expect(content.output).toHaveLength(1);
    expect(textOf(content.output[0])).toBe("Working on it.");
    expect(
      partsOf(content.output[0], LlmMessagePartType.ToolCall)[0],
    ).toMatchObject({ toolName: "do_it", toolCallId: "f1" });
    expect(
      partsOf(content.output[0], LlmMessagePartType.Reasoning),
    ).toHaveLength(1);
  });

  test("a developer message is a system message", () => {
    const content: LlmCallContent = read({
      "gen_ai.input.messages": JSON.stringify([
        { role: "developer", content: "Rules" },
      ]),
    });

    expect(content.input[0]?.role).toBe("system");
  });
});

describe("the deprecated per-role events", () => {
  test("message events are history and gen_ai.choice is the answer", () => {
    const content: LlmCallContent = read({ "gen_ai.system": "openai" }, [
      event("gen_ai.system.message", { content: "Be nice." }),
      event("gen_ai.user.message", { content: "Hi" }),
      event("gen_ai.assistant.message", { content: "Hello! How can I help?" }),
      event("gen_ai.user.message", { content: "Tell a joke" }),
      event("gen_ai.choice", {
        index: 0,
        finish_reason: "stop",
        "message.role": "assistant",
        "message.content": "Why did the span cross the trace?",
      }),
    ]);

    expect(
      content.input.map((message: LlmMessage) => {
        return `${message.role}:${textOf(message)}`;
      }),
    ).toEqual([
      "system:Be nice.",
      "user:Hi",
      "assistant:Hello! How can I help?",
      "user:Tell a joke",
    ]);
    expect(textOf(content.output[0])).toBe("Why did the span cross the trace?");
    expect(content.finishReasons).toEqual(["stop"]);
  });

  test("a tool message event carries the id of its call", () => {
    const content: LlmCallContent = read({}, [
      event("gen_ai.tool.message", { content: "42", id: "call_7" }),
    ]);

    expect(
      partsOf(content.input[0], LlmMessagePartType.ToolResult)[0],
    ).toMatchObject({ toolCallId: "call_7", text: "42" });
  });
});

describe("finish reasons, errors and evaluations", () => {
  test("finish reasons from an array, JSON text and a comma list are merged once", () => {
    const content: LlmCallContent = read({
      "gen_ai.response.finish_reasons": ["stop", "LENGTH"],
      "gen_ai.response.finish_reason": '["length"]',
      "llm.response.finish_reason": "stop, content_filter",
    });

    expect(content.finishReasons).toEqual(["stop", "length", "content_filter"]);
  });

  test("error.type is read", () => {
    expect(read({ "error.type": "timeout" }).errorType).toBe("timeout");
  });

  test("evaluation results are read off gen_ai.evaluation.result events", () => {
    const content: LlmCallContent = read({}, [
      event("gen_ai.evaluation.result", {
        "gen_ai.evaluation.name": "Relevance",
        "gen_ai.evaluation.score.label": "not_relevant",
        "gen_ai.evaluation.score.value": "0.2",
        "gen_ai.evaluation.explanation": "Talks about the wrong order.",
      }),
      event("gen_ai.evaluation.result", {
        "gen_ai.evaluation.name": "Thumbs",
        "gen_ai.evaluation.score.label": "thumbs_down",
      }),
      event("exception", { "exception.message": "not an evaluation" }),
    ]);

    expect(content.evaluations).toEqual([
      {
        name: "Relevance",
        label: "not_relevant",
        score: 0.2,
        explanation: "Talks about the wrong order.",
      },
      { name: "Thumbs", label: "thumbs_down", score: null, explanation: "" },
    ]);
  });
});

describe("tool runs (execute_tool spans)", () => {
  test("the GenAI conventions' tool call attributes", () => {
    const content: LlmCallContent = read({
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "get_weather",
      "gen_ai.tool.call.id": "call_1",
      "gen_ai.tool.call.arguments": { location: "Paris" },
      "gen_ai.tool.call.result": "rainy",
    });

    expect(content.tool?.name).toBe("get_weather");
    expect(content.tool?.id).toBe("call_1");
    expect(JSON.parse(content.tool?.arguments || "{}")).toEqual({
      location: "Paris",
    });
    expect(content.tool?.result).toBe("rainy");
  });

  test("an OpenInference TOOL span reads input.value and output.value", () => {
    const content: LlmCallContent = read({
      "openinference.span.kind": "TOOL",
      "tool.name": "calculator",
      "input.value": '{"expression":"2+2"}',
      "output.value": "4",
    });

    expect(content.tool).toMatchObject({
      name: "calculator",
      arguments: '{"expression":"2+2"}',
      result: "4",
    });
  });

  test("a span that names no tool has no tool run", () => {
    expect(read({ "gen_ai.operation.name": "chat" }).tool).toBeNull();
  });
});

describe("readAnswer (the ingest path)", () => {
  test("reads the answer, finish reasons, evaluations and error type - never the prompt", () => {
    const reading: LlmAnswerReading = LlmMessageParser.readAnswer({
      attributes: {
        "gen_ai.input.messages": "x".repeat(10),
        "gen_ai.output.messages": JSON.stringify([
          {
            role: "assistant",
            parts: [{ type: "text", content: "I'm sorry, but I can't." }],
          },
        ]),
        "gen_ai.response.finish_reasons": ["stop"],
      },
    });

    expect(reading.summary).toEqual({
      recorded: true,
      hasText: true,
      hasToolCall: false,
      hasMedia: false,
      hasRefusal: false,
      leadingText: "I'm sorry, but I can't.",
    });
    expect(reading.finishReasons).toEqual(["stop"]);
    expect(reading).not.toHaveProperty("input");
  });

  test("an answer longer than the parse limit is not parsed, and certainly not empty", () => {
    const huge: string = JSON.stringify([
      {
        role: "assistant",
        parts: [{ type: "text", content: "y".repeat(LLM_ANSWER_MAX_JSON_LENGTH) }],
      },
    ]);

    const reading: LlmAnswerReading = LlmMessageParser.readAnswer({
      attributes: { "gen_ai.output.messages": huge },
    });

    expect(reading.output).toEqual([]);
    expect(reading.summary.recorded).toBe(true);
    expect(reading.summary.hasText).toBe(true);
    // The opening of a JSON list is not the answer's opening.
    expect(reading.summary.leadingText).toBe("");
  });

  test("a recorded answer that holds nothing", () => {
    const reading: LlmAnswerReading = LlmMessageParser.readAnswer({
      attributes: {
        "gen_ai.output.messages": JSON.stringify([
          { role: "assistant", parts: [{ type: "text", content: "   " }] },
        ]),
      },
    });

    expect(reading.summary.recorded).toBe(true);
    expect(reading.summary.hasText).toBe(false);
  });

  test("no content recorded", () => {
    const reading: LlmAnswerReading = LlmMessageParser.readAnswer({
      attributes: { "gen_ai.request.model": "gpt-4o" },
    });

    expect(reading.summary.recorded).toBe(false);
    expect(reading.output).toEqual([]);
  });
});

describe("robustness: telemetry is untrusted input", () => {
  test.each([
    [null],
    [undefined],
    ["a string"],
    [42],
    [[1, 2, 3]],
    [{ "gen_ai.input.messages": "{not json" }],
    [{ "gen_ai.input.messages": "[{]" }],
    [{ "gen_ai.output.messages": { weird: { deeply: { nested: [null] } } } }],
    [{ "gen_ai.prompt.x.content": "no index" }],
    [{ "gen_ai.prompt.-1.content": "negative" }],
    [{ "gen_ai.prompt.01.content": "leading zero" }],
  ])("never throws on %p", (attributes: unknown) => {
    expect(() => {
      LlmMessageParser.readCallContent({
        attributes: attributes,
        events: [null, 7, "x", { name: 3 }, { name: "gen_ai.choice" }],
      });
      LlmMessageParser.readAnswer({ attributes: attributes, events: "nope" });
    }).not.toThrow();
  });

  test("broken JSON in a message attribute is shown as the text it is", () => {
    const content: LlmCallContent = read({
      "gen_ai.input.messages": "{not json",
    });

    expect(textOf(content.input[0])).toBe("{not json");
  });

  test("nested attribute objects (rows from the JSON-column era) are read", () => {
    const content: LlmCallContent = read({
      gen_ai: {
        prompt: { "0": { role: "user", content: "Nested hello" } },
      },
    });

    expect(textOf(content.input[0])).toBe("Nested hello");
  });

  test("a base64 blob is reduced to its modality, never copied", () => {
    const content: LlmCallContent = read({
      "gen_ai.input.messages": JSON.stringify([
        {
          role: "user",
          parts: [
            {
              type: "blob",
              modality: "image",
              mime_type: "image/png",
              content: "QUFBQUFBQUFBQQ==",
            },
          ],
        },
      ]),
    });

    const media: LlmMessagePart | undefined = partsOf(
      content.input[0],
      LlmMessagePartType.Media,
    )[0];
    expect(media).toMatchObject({ modality: "image", mimeType: "image/png" });
    expect(JSON.stringify(content)).not.toContain("QUFBQUFBQUFBQQ");
  });
});

describe("display helpers", () => {
  test("toDisplayText renders every part a person would want to read", () => {
    const message: LlmMessage = {
      role: "assistant",
      name: "",
      finishReason: "",
      parts: [
        { type: LlmMessagePartType.Reasoning, text: "Think" },
        { type: LlmMessagePartType.Text, text: "Answer" },
        {
          type: LlmMessagePartType.ToolCall,
          text: "",
          toolName: "search",
          arguments: '{"q":1}',
        },
        { type: LlmMessagePartType.ToolResult, text: "ok", toolName: "search" },
        { type: LlmMessagePartType.Media, text: "", modality: "image" },
      ],
    };

    expect(LlmMessageParser.toDisplayText(message)).toBe(
      '(thinking) Think\n\nAnswer\n\n→ search({"q":1})\n\n← search: ok\n\n[image]',
    );
    expect(LlmMessageParser.getText(message)).toBe("Answer");
  });

  test("summarizeAnswer sees tool calls, media and refusals", () => {
    expect(
      LlmMessageParser.summarizeAnswer(
        [
          {
            role: "assistant",
            name: "",
            finishReason: "",
            parts: [
              { type: LlmMessagePartType.Refusal, text: "No." },
              { type: LlmMessagePartType.ToolCall, text: "", toolName: "x" },
              { type: LlmMessagePartType.Media, text: "", modality: "audio" },
            ],
          },
        ],
        true,
      ),
    ).toEqual({
      recorded: true,
      hasText: false,
      hasToolCall: true,
      hasMedia: true,
      hasRefusal: true,
      leadingText: "",
    });
  });
});
