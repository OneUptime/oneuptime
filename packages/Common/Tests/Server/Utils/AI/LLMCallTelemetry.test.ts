import { afterEach, describe, expect, test } from "@jest/globals";
import { Attributes } from "@opentelemetry/api";
import LLMCallTelemetry, {
  CAPTURE_MESSAGE_CONTENT_ENV_VAR,
  GenAiMessage,
  GenAiPart,
  LLM_CALL_CONTENT_LIMITS,
  cutText,
} from "../../../../Server/Utils/LLM/LLMCallTelemetry";
import LLMProviderHTTPException from "../../../../Server/Utils/LLM/LLMProviderHTTPException";
import {
  LLMCompletionResponse,
  LLMMessage,
  LLMUsage,
} from "../../../../Server/Utils/LLM/LLMService";
import LlmSpanUtil, {
  LlmSpanFields,
} from "../../../../Server/Utils/Telemetry/LlmSpan";
import BadDataException from "../../../../Types/Exception/BadDataException";
import TimeoutException from "../../../../Types/Exception/TimeoutException";
import LlmType from "../../../../Types/LLM/LlmType";
import { LlmCostCatalogUtil } from "../../../../Types/Telemetry/LlmCostCatalog";
import { LlmAnswerIssue } from "../../../../Types/Telemetry/LlmAnswerIssue";
import { LlmCallKind } from "../../../../Types/Telemetry/LlmCallKind";
import LlmConversationTranscriptUtil, {
  LlmConversationCall,
  LlmTranscript,
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "../../../../Utils/Telemetry/LlmConversationTranscript";
import LlmMessageParser, {
  LlmCallContent,
  LlmMessage,
  LlmMessagePart,
  LlmMessagePartType,
} from "../../../../Utils/Telemetry/LlmMessageParser";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";

/*
 * OneUptime dogfoods its AI / LLM observability: its own AI calls go to a
 * OneUptime project, where every one of them read "The AI answered. What it
 * said was not recorded." - the calls' spans carried the model and the
 * tokens, never the prompt or the answer. These tests hold the attributes
 * the calls now carry to the GenAI conventions, to what OneUptime's own
 * readers (the message parser, ingest, the conversation view) make of them,
 * and to the size an export can carry.
 */

const MODEL: string = "nvidia/nemotron-3-super-120b-a12b:free";
const FEATURE: string = "AI Incident Investigation";
const SYSTEM: string = "You are OneUptime AI, an SRE assistant.";
const QUESTION: string = "Why is checkout returning 500 errors?";
const TOOL_RESULT: string = "3 errors: connection refused to payments-db";
const ANSWER: string =
  "Checkout fails because payments-db refuses connections.";
const MARKER: string = "more characters not recorded]";

const USAGE: LLMUsage = {
  promptTokens: 17044,
  completionTokens: 389,
  totalTokens: 17433,
};

type Response = Pick<
  LLMCompletionResponse,
  "content" | "toolCalls" | "stopReason"
>;

// An investigation's agent loop: the first call asks for a tool ...
const FIRST_CALL: Array<LLMMessage> = [
  { role: "system", content: SYSTEM },
  { role: "user", content: QUESTION },
];

const FIRST_ANSWER: Response = {
  content: "",
  toolCalls: [
    {
      id: "call_1",
      name: "query_logs",
      arguments: { service: "checkout", severity: "error" },
    },
  ],
  stopReason: "tool_use",
};

// ... and the second carries its result back and answers.
const SECOND_CALL: Array<LLMMessage> = [
  ...FIRST_CALL,
  { role: "assistant", content: "", toolCalls: FIRST_ANSWER.toolCalls },
  { role: "tool", toolCallId: "call_1", content: TOOL_RESULT },
];

const SECOND_ANSWER: Response = { content: ANSWER, stopReason: "stop" };

function requestAttributes(
  messages: Array<LLMMessage>,
  recordContent: boolean,
): Attributes {
  return LLMCallTelemetry.getRequestAttributes({
    llmType: LlmType.OpenAI,
    modelName: MODEL,
    feature: FEATURE,
    conversationId: "run-1",
    maxTokens: 4096,
    temperature: 0.2,
    messages: messages,
    recordContent: recordContent,
  });
}

function responseAttributes(
  response: Response,
  recordContent: boolean,
): Attributes {
  return LLMCallTelemetry.getResponseAttributes({
    modelName: MODEL,
    response: response,
    usage: USAGE,
    recordContent: recordContent,
  });
}

// What ingest stores: the span's attributes once the call has finished.
function storedCall(
  messages: Array<LLMMessage>,
  response: Response,
  recordContent: boolean = true,
): Attributes {
  return {
    ...requestAttributes(messages, recordContent),
    ...responseAttributes(response, recordContent),
  };
}

function parsed(attributes: Attributes, key: string): unknown {
  return JSON.parse(attributes[key] as string);
}

function readContent(attributes: Attributes): LlmCallContent {
  return LlmMessageParser.readCallContent({ attributes: attributes });
}

function extract(attributes: Attributes): LlmSpanFields {
  return LlmSpanUtil.extract(
    attributes as Parameters<typeof LlmSpanUtil.extract>[0],
  );
}

function textOf(message: LlmMessage): string {
  return LlmMessageParser.getText(message);
}

const CONTENT_KEYS: Array<string> = [
  "gen_ai.system_instructions",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
];

describe("whether prompts and answers are recorded", () => {
  const originalValue: string | undefined =
    process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR];

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR];
    } else {
      process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR] = originalValue;
    }
  });

  test("the switch is OpenTelemetry's own", () => {
    expect(CAPTURE_MESSAGE_CONTENT_ENV_VAR).toBe(
      "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT",
    );
  });

  test("they are not recorded when the switch is not set", () => {
    expect(LLMCallTelemetry.isContentRecordingOn({})).toBe(false);
  });

  test.each([
    "",
    " ",
    "false",
    "FALSE",
    "0",
    "no",
    "off",
    "NO_CONTENT",
    "ture",
    "enabled please",
  ])("they are not recorded when it is %p", (value: string) => {
    expect(
      LLMCallTelemetry.isContentRecordingOn({
        [CAPTURE_MESSAGE_CONTENT_ENV_VAR]: value,
      }),
    ).toBe(false);
  });

  test.each([
    "true",
    "TRUE",
    " true ",
    "True",
    "1",
    "yes",
    "on",
    "SPAN_ONLY",
    "span_and_event",
    "EVENT_ONLY",
  ])("they are recorded when it is %p", (value: string) => {
    expect(
      LLMCallTelemetry.isContentRecordingOn({
        [CAPTURE_MESSAGE_CONTENT_ENV_VAR]: value,
      }),
    ).toBe(true);
  });

  test("the process environment is read when no other is given", () => {
    process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR] = "true";
    expect(LLMCallTelemetry.isContentRecordingOn()).toBe(true);

    process.env[CAPTURE_MESSAGE_CONTENT_ENV_VAR] = "false";
    expect(LLMCallTelemetry.isContentRecordingOn()).toBe(false);
  });
});

describe("what every call says about itself, recorded or not", () => {
  test("the model, the feature, the conversation and the request's limits", () => {
    expect(requestAttributes(SECOND_CALL, false)).toEqual({
      "gen_ai.operation.name": "chat",
      "gen_ai.system": "OpenAI",
      "gen_ai.provider.name": "OpenAI",
      "gen_ai.request.model": MODEL,
      "gen_ai.agent.name": FEATURE,
      "gen_ai.conversation.id": "run-1",
      "gen_ai.request.max_tokens": 4096,
      "gen_ai.request.temperature": 0.2,
    });
  });

  test("what the caller did not say is left out rather than made up", () => {
    expect(
      LLMCallTelemetry.getRequestAttributes({
        llmType: LlmType.Anthropic,
        maxTokens: NaN,
        messages: FIRST_CALL,
        recordContent: false,
      }),
    ).toEqual({
      "gen_ai.operation.name": "chat",
      "gen_ai.system": "Anthropic",
      "gen_ai.provider.name": "Anthropic",
    });
  });

  test("a temperature of 0 is a temperature", () => {
    expect(
      LLMCallTelemetry.getRequestAttributes({
        llmType: LlmType.Ollama,
        temperature: 0,
        messages: FIRST_CALL,
        recordContent: false,
      })["gen_ai.request.temperature"],
    ).toBe(0);
  });

  test("the answer's tokens, model and why it stopped", () => {
    expect(responseAttributes(SECOND_ANSWER, false)).toEqual({
      "gen_ai.response.model": MODEL,
      "gen_ai.usage.input_tokens": 17044,
      "gen_ai.usage.output_tokens": 389,
      "gen_ai.usage.total_tokens": 17433,
      "gen_ai.response.finish_reasons": ["stop"],
    });
  });

  test.each([
    ["stop", ["stop"]],
    ["tool_use", ["tool_call"]],
    ["length", ["length"]],
  ] as Array<[LLMCompletionResponse["stopReason"], Array<string>]>)(
    "a provider stop reason of %p is the finish reason %p",
    (
      stopReason: LLMCompletionResponse["stopReason"],
      finishReasons: Array<string>,
    ) => {
      expect(
        responseAttributes({ content: "x", stopReason }, false)[
          "gen_ai.response.finish_reasons"
        ],
      ).toEqual(finishReasons);
    },
  );

  test("an unknown stop reason is not reported as one", () => {
    expect(
      responseAttributes({ content: "x" }, false)[
        "gen_ai.response.finish_reasons"
      ],
    ).toBeUndefined();
  });

  test("the cost OneUptime billed is reported in dollars, and only when billed", () => {
    const billed: Attributes = LLMCallTelemetry.getResponseAttributes({
      response: SECOND_ANSWER,
      costInUSDCents: 250,
      recordContent: false,
    });
    const free: Attributes = LLMCallTelemetry.getResponseAttributes({
      response: SECOND_ANSWER,
      costInUSDCents: 0,
      recordContent: false,
    });

    expect(billed["gen_ai.usage.cost_usd"]).toBe(2.5);
    expect(free["gen_ai.usage.cost_usd"]).toBeUndefined();
  });

  test("a provider that reports no usage reports no token counts", () => {
    const attributes: Attributes = LLMCallTelemetry.getResponseAttributes({
      response: SECOND_ANSWER,
      recordContent: false,
    });

    expect(attributes["gen_ai.usage.input_tokens"]).toBeUndefined();
    expect(attributes["gen_ai.usage.output_tokens"]).toBeUndefined();
    expect(attributes["gen_ai.usage.total_tokens"]).toBeUndefined();
  });

  test("nothing the call said is on it unless recording is on", () => {
    const attributes: Attributes = storedCall(
      SECOND_CALL,
      SECOND_ANSWER,
      false,
    );

    for (const key of CONTENT_KEYS) {
      expect(attributes[key]).toBeUndefined();
    }

    expect(JSON.stringify(attributes)).not.toContain(QUESTION);
    expect(JSON.stringify(attributes)).not.toContain(SYSTEM);
    expect(JSON.stringify(attributes)).not.toContain(ANSWER);
    expect(JSON.stringify(attributes)).not.toContain(TOOL_RESULT);
  });
});

describe("the prompt, in the GenAI conventions' shape", () => {
  test("the system messages the conversation starts with are its system instructions", () => {
    const attributes: Attributes = requestAttributes(
      [
        { role: "system", content: SYSTEM },
        { role: "system", content: "Today's incident: #42." },
        { role: "user", content: QUESTION },
      ],
      true,
    );

    expect(parsed(attributes, "gen_ai.system_instructions")).toEqual([
      { type: "text", content: SYSTEM },
      { type: "text", content: "Today's incident: #42." },
    ]);
    expect(parsed(attributes, "gen_ai.input.messages")).toEqual([
      { role: "user", parts: [{ type: "text", content: QUESTION }] },
    ]);
  });

  test("a tool call and its result keep the id that pairs them", () => {
    expect(
      parsed(requestAttributes(SECOND_CALL, true), "gen_ai.input.messages"),
    ).toEqual([
      { role: "user", parts: [{ type: "text", content: QUESTION }] },
      {
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "call_1",
            name: "query_logs",
            arguments: { service: "checkout", severity: "error" },
          },
        ],
      },
      {
        role: "tool",
        parts: [
          { type: "tool_call_response", id: "call_1", response: TOOL_RESULT },
        ],
      },
    ]);
  });

  test("an assistant turn that says something and asks for tools keeps both, in order", () => {
    const attributes: Attributes = requestAttributes(
      [
        { role: "user", content: QUESTION },
        {
          role: "assistant",
          content: "Let me look at the logs and the deploys.",
          toolCalls: [
            { id: "a", name: "query_logs", arguments: {} },
            { id: "b", name: "list_deployments", arguments: { hours: 2 } },
          ],
        },
      ],
      true,
    );

    expect(
      (parsed(attributes, "gen_ai.input.messages") as Array<GenAiMessage>)[1],
    ).toEqual({
      role: "assistant",
      parts: [
        { type: "text", content: "Let me look at the logs and the deploys." },
        { type: "tool_call", id: "a", name: "query_logs", arguments: {} },
        {
          type: "tool_call",
          id: "b",
          name: "list_deployments",
          arguments: { hours: 2 },
        },
      ],
    });
  });

  test("a system message later in the conversation stays where it was sent", () => {
    const attributes: Attributes = requestAttributes(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: QUESTION },
        { role: "system", content: "Wrap up now." },
      ],
      true,
    );

    expect(parsed(attributes, "gen_ai.system_instructions")).toEqual([
      { type: "text", content: SYSTEM },
    ]);
    expect(parsed(attributes, "gen_ai.input.messages")).toEqual([
      { role: "user", parts: [{ type: "text", content: QUESTION }] },
      { role: "system", parts: [{ type: "text", content: "Wrap up now." }] },
    ]);
  });

  test("a conversation without a system prompt has no system instructions", () => {
    const attributes: Attributes = requestAttributes(
      [{ role: "user", content: QUESTION }],
      true,
    );

    expect(attributes["gen_ai.system_instructions"]).toBeUndefined();
  });

  test("messages with nothing in them are left out", () => {
    const attributes: Attributes = requestAttributes(
      [
        { role: "system", content: "" },
        { role: "user", content: "" },
        { role: "assistant", content: "", toolCalls: [] },
        { role: "user", content: QUESTION },
      ],
      true,
    );

    expect(attributes["gen_ai.system_instructions"]).toBeUndefined();
    expect(parsed(attributes, "gen_ai.input.messages")).toEqual([
      { role: "user", parts: [{ type: "text", content: QUESTION }] },
    ]);
  });

  test("a tool's empty result is still the tool's answer", () => {
    expect(
      parsed(
        requestAttributes([{ role: "tool", content: "" }], true),
        "gen_ai.input.messages",
      ),
    ).toEqual([
      {
        role: "tool",
        parts: [{ type: "tool_call_response", id: "", response: "" }],
      },
    ]);
  });
});

describe("the answer, in the GenAI conventions' shape", () => {
  test("a text answer and why the model stopped", () => {
    expect(
      parsed(responseAttributes(SECOND_ANSWER, true), "gen_ai.output.messages"),
    ).toEqual([
      {
        role: "assistant",
        parts: [{ type: "text", content: ANSWER }],
        finish_reason: "stop",
      },
    ]);
  });

  test("an answer that asks for a tool", () => {
    expect(
      parsed(responseAttributes(FIRST_ANSWER, true), "gen_ai.output.messages"),
    ).toEqual([
      {
        role: "assistant",
        parts: [
          {
            type: "tool_call",
            id: "call_1",
            name: "query_logs",
            arguments: { service: "checkout", severity: "error" },
          },
        ],
        finish_reason: "tool_call",
      },
    ]);
  });

  test("an answer with nothing in it is recorded as exactly that", () => {
    expect(
      parsed(
        responseAttributes({ content: "", stopReason: "stop" }, true),
        "gen_ai.output.messages",
      ),
    ).toEqual([{ role: "assistant", parts: [], finish_reason: "stop" }]);
  });
});

describe("what OneUptime reads back from a recorded call", () => {
  test("the conversation view reads the system prompt, every message and the answer", () => {
    const content: LlmCallContent = readContent(
      storedCall(SECOND_CALL, SECOND_ANSWER),
    );

    expect(content.systemInstructions).toBe(SYSTEM);
    expect(
      content.input.map((message: LlmMessage) => {
        return message.role;
      }),
    ).toEqual(["user", "assistant", "tool"]);
    expect(textOf(content.input[0]!)).toBe(QUESTION);

    const toolCall: LlmMessagePart = content.input[1]!.parts[0]!;
    expect(toolCall.type).toBe(LlmMessagePartType.ToolCall);
    expect(toolCall.toolCallId).toBe("call_1");
    expect(toolCall.toolName).toBe("query_logs");
    expect(JSON.parse(toolCall.arguments!)).toEqual({
      service: "checkout",
      severity: "error",
    });

    const toolResult: LlmMessagePart = content.input[2]!.parts[0]!;
    expect(toolResult.type).toBe(LlmMessagePartType.ToolResult);
    expect(toolResult.toolCallId).toBe("call_1");
    expect(toolResult.text).toBe(TOOL_RESULT);

    expect(content.output).toHaveLength(1);
    expect(textOf(content.output[0]!)).toBe(ANSWER);
    expect(content.finishReasons).toEqual(["stop"]);
    expect(content.errorType).toBe("");
  });

  test("ingest reads it as an AI answer of the feature's conversation", () => {
    const fields: LlmSpanFields = extract(
      storedCall(SECOND_CALL, SECOND_ANSWER),
    );

    expect(fields).toMatchObject({
      isLlmSpan: true,
      llmSystem: "OpenAI",
      llmOperation: "chat",
      llmRequestModel: MODEL,
      llmResponseModel: MODEL,
      llmInputTokens: 17044,
      llmOutputTokens: 389,
      llmTotalTokens: 17433,
      llmAgentName: FEATURE,
      llmConversationId: "run-1",
      llmCallKind: LlmCallKind.Answer,
      llmIssues: [],
    });
  });

  test("the conversation list reads the newest question", () => {
    expect(
      LlmSpanUtil.getUserMessagePreview({
        attributes: storedCall(
          [
            ...SECOND_CALL,
            { role: "assistant", content: ANSWER },
            { role: "user", content: "And how do I fix it?" },
          ],
          SECOND_ANSWER,
        ),
      }),
    ).toBe("And how do I fix it?");
  });

  test("without recording there is no question to list", () => {
    expect(
      LlmSpanUtil.getUserMessagePreview({
        attributes: storedCall(SECOND_CALL, SECOND_ANSWER, false),
      }),
    ).toBe("");
  });

  test("an answer cut off at the token limit is flagged cut off", () => {
    expect(
      extract(
        storedCall(SECOND_CALL, {
          content: "Checkout fails be",
          stopReason: "length",
        }),
      ).llmIssues,
    ).toEqual([LlmAnswerIssue.CutOff]);
  });

  test("an answer cut off is flagged even when its text was not recorded", () => {
    expect(
      extract(
        storedCall(
          SECOND_CALL,
          { content: "Checkout fails be", stopReason: "length" },
          false,
        ),
      ).llmIssues,
    ).toEqual([LlmAnswerIssue.CutOff]);
  });

  test("an empty answer is flagged empty", () => {
    expect(
      extract(storedCall(SECOND_CALL, { content: "", stopReason: "stop" }))
        .llmIssues,
    ).toEqual([LlmAnswerIssue.Empty]);
  });

  test("an answer that only asks for a tool is not empty", () => {
    expect(extract(storedCall(FIRST_CALL, FIRST_ANSWER)).llmIssues).toEqual([]);
  });

  test("a failed call is flagged failed, even with its span status left alone", () => {
    const fields: LlmSpanFields = extract({
      ...requestAttributes(SECOND_CALL, true),
      ...LLMCallTelemetry.getFailureAttributes(
        new LLMProviderHTTPException({
          message: "OpenAI API error: Rate limit reached",
          statusCode: 429,
          llmType: LlmType.OpenAI,
          providerMessage: "Rate limit reached",
        }),
      ),
    });

    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmIssues).toEqual([LlmAnswerIssue.Failed]);
  });
});

describe("an investigation, read as a conversation", () => {
  const T0: number = Date.UTC(2026, 9, 20, 0, 0, 17);

  function conversationCall(data: {
    spanId: string;
    startMs: number;
    endMs: number;
    attributes: Attributes;
  }): LlmConversationCall {
    const fields: LlmSpanFields = extract(data.attributes);

    return {
      spanId: data.spanId,
      traceId: "trace-1",
      parentSpanId: "",
      name: "Service.executeWithLogging",
      startMs: data.startMs,
      endMs: data.endMs,
      statusIsError: false,
      statusMessage: "",
      kind: fields.llmCallKind as LlmCallKind,
      model: fields.llmRequestModel,
      provider: fields.llmSystem,
      agentName: fields.llmAgentName,
      toolName: "",
      inputTokens: fields.llmInputTokens,
      outputTokens: fields.llmOutputTokens,
      costUsd: 0,
      issues: fields.llmIssues as Array<LlmAnswerIssue>,
      userLabel: "",
      serviceId: "api",
      content: readContent(data.attributes),
    };
  }

  function transcriptOf(recordContent: boolean): LlmTranscript {
    return LlmConversationTranscriptUtil.build([
      conversationCall({
        spanId: "first",
        startMs: T0,
        endMs: T0 + 19_000,
        attributes: storedCall(FIRST_CALL, FIRST_ANSWER, recordContent),
      }),
      conversationCall({
        spanId: "second",
        startMs: T0 + 19_100,
        endMs: T0 + 30_000,
        attributes: storedCall(SECOND_CALL, SECOND_ANSWER, recordContent),
      }),
    ]);
  }

  function summary(transcript: LlmTranscript): Array<string> {
    return transcript.steps.map((step: LlmTranscriptStep): string => {
      switch (step.type) {
        case LlmTranscriptStepType.ToolCall:
          return `tool_call:${step.toolName}`;
        case LlmTranscriptStepType.ToolResult:
          return `tool_result:${step.text}`;
        default:
          return `${step.type}:${step.text}`;
      }
    });
  }

  test("every message shows once, in the order it happened", () => {
    const transcript: LlmTranscript = transcriptOf(true);

    expect(summary(transcript)).toEqual([
      `user:${QUESTION}`,
      "tool_call:query_logs",
      `tool_result:${TOOL_RESULT}`,
      `assistant:${ANSWER}`,
    ]);
    expect(transcript.instructions).toBe(SYSTEM);
    expect(transcript.title).toBe(QUESTION);
  });

  test("no step says what the AI said was not recorded", () => {
    expect(
      transcriptOf(true).steps.filter((step: LlmTranscriptStep) => {
        return step.type === LlmTranscriptStepType.SilentAnswer;
      }),
    ).toEqual([]);
  });

  test("every answer names the feature that made it", () => {
    const answer: LlmTranscriptStep = transcriptOf(true).steps.find(
      (step: LlmTranscriptStep) => {
        return step.type === LlmTranscriptStepType.AssistantMessage;
      },
    )!;

    expect(answer.call.agentName).toBe(FEATURE);
    expect(answer.call.finishReasons).toEqual(["stop"]);
  });

  test("with recording off, each call still shows with its timing and tokens", () => {
    const transcript: LlmTranscript = transcriptOf(false);

    expect(
      transcript.steps.map((step: LlmTranscriptStep) => {
        return step.type;
      }),
    ).toEqual([
      LlmTranscriptStepType.SilentAnswer,
      LlmTranscriptStepType.SilentAnswer,
    ]);
    expect(transcript.steps[0]!.call.inputTokens).toBe(17044);
    expect(transcript.steps[1]!.call.finishReasons).toEqual(["stop"]);
  });
});

describe("a failure is named without the provider's words", () => {
  test("a provider's HTTP error is its status", () => {
    const error: LLMProviderHTTPException = new LLMProviderHTTPException({
      message: `OpenAI API error: your prompt "${QUESTION}" was refused`,
      statusCode: 429,
      llmType: LlmType.OpenAI,
      providerMessage: `your prompt "${QUESTION}" was refused`,
    });
    const attributes: Attributes = LLMCallTelemetry.getFailureAttributes(error);

    expect(attributes).toEqual({ "error.type": "429" });
    expect(JSON.stringify(attributes)).not.toContain(QUESTION);
  });

  test.each([
    [new TimeoutException("Request timed out"), "TimeoutException"],
    [new BadDataException("No LLM provider configured."), "BadDataException"],
    [new TypeError("fetch failed"), "TypeError"],
    [new Error("something broke"), "_OTHER"],
    ["a thrown string", "_OTHER"],
    [null, "_OTHER"],
    [undefined, "_OTHER"],
  ] as Array<[unknown, string]>)(
    "%p is named %p",
    (error: unknown, errorType: string) => {
      expect(LLMCallTelemetry.getErrorType(error)).toBe(errorType);
    },
  );

  test("an error of a class of its own is named by its class", () => {
    class PaymentsDbUnreachableError extends Error {}

    expect(
      LLMCallTelemetry.getErrorType(new PaymentsDbUnreachableError("x")),
    ).toBe("PaymentsDbUnreachableError");
  });

  test("a plain error with a name of its own is named by it", () => {
    const error: Error = new Error("x");
    error.name = "AbortError";

    expect(LLMCallTelemetry.getErrorType(error)).toBe("AbortError");
  });

  test("a thrown value that throws when read is named _OTHER", () => {
    const hostile: Error = new Proxy(new Error("x"), {
      get: (): never => {
        throw new Error("no reading me");
      },
    });

    expect(LLMCallTelemetry.getErrorType(hostile)).toBe("_OTHER");
  });
});

describe("cutting a text", () => {
  test("a text that fits is left alone", () => {
    expect(cutText("hello", 5)).toBe("hello");
    expect(cutText("", 0)).toBe("");
  });

  test("a longer text keeps its start and says how much was left out", () => {
    expect(cutText("abcdefghij", 4)).toBe(
      "abcd… [6 more characters not recorded]",
    );
  });

  test("a character made of two UTF-16 units is never split", () => {
    // "a", the two halves of 😀, "b": cutting after 2 would split the emoji.
    expect(cutText("a😀b", 2)).toBe("a… [3 more characters not recorded]");
    expect(cutText("a😀b", 3)).toBe("a😀… [1 more characters not recorded]");
  });

  test("cut to nothing, only the count is left", () => {
    expect(cutText("abc", 0)).toBe("… [3 more characters not recorded]");
  });
});

describe("recorded content stays small enough to export", () => {
  test("a prompt within the limit is recorded exactly as sent", () => {
    const attributes: Attributes = requestAttributes(SECOND_CALL, true);

    expect(attributes["gen_ai.input.messages"]).toBe(
      JSON.stringify(LLMCallTelemetry.toInput(SECOND_CALL).inputMessages),
    );
  });

  test("a tool result of megabytes is cut, and the question is kept whole", () => {
    const logs: string = "ERROR connection refused to payments-db\n".repeat(
      60_000,
    );
    const attributes: Attributes = requestAttributes(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: QUESTION },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "query_logs", arguments: {} }],
        },
        { role: "tool", toolCallId: "call_1", content: logs },
      ],
      true,
    );
    const json: string = attributes["gen_ai.input.messages"] as string;

    expect(logs.length).toBeGreaterThan(2_000_000);
    expect(json.length).toBeLessThanOrEqual(
      LLM_CALL_CONTENT_LIMITS.inputMessagesJsonLength,
    );

    const messages: Array<GenAiMessage> = JSON.parse(json);
    expect(messages[0]).toEqual({
      role: "user",
      parts: [{ type: "text", content: QUESTION }],
    });

    const result: string = (
      messages[2]!.parts[0] as { type: "tool_call_response"; response: string }
    ).response;
    const kept: number = result.indexOf("… [");

    expect(result.endsWith(MARKER)).toBe(true);
    expect(logs.startsWith(result.slice(0, kept))).toBe(true);
    expect(result).toContain(`[${logs.length - kept} ${MARKER}`);

    // And the conversation view still reads it, cut.
    const content: LlmCallContent = readContent(attributes);
    expect(textOf(content.input[0]!)).toBe(QUESTION);
    expect(content.input[2]!.parts[0]!.toolCallId).toBe("call_1");
  });

  test("the longest texts are cut to one length, and the shorter ones stay whole", () => {
    const lengths: Array<number> = [300_000, 200_000, 20_000, 1_000, 40];
    const texts: Array<string> = lengths.map(
      (length: number, index: number) => {
        return String.fromCharCode(97 + index).repeat(length);
      },
    );
    const json: string = LLMCallTelemetry.toBoundedMessagesJson(
      texts.map((text: string): GenAiMessage => {
        return { role: "user", parts: [{ type: "text", content: text }] };
      }),
      LLM_CALL_CONTENT_LIMITS.inputMessagesJsonLength,
    );

    expect(json.length).toBeLessThanOrEqual(
      LLM_CALL_CONTENT_LIMITS.inputMessagesJsonLength,
    );

    const recorded: Array<string> = (
      JSON.parse(json) as Array<GenAiMessage>
    ).map((message: GenAiMessage) => {
      return (message.parts[0] as { content: string }).content;
    });

    expect(recorded[2]).toBe(texts[2]);
    expect(recorded[3]).toBe(texts[3]);
    expect(recorded[4]).toBe(texts[4]);

    const keptOfFirst: number = recorded[0]!.indexOf("… [");
    const keptOfSecond: number = recorded[1]!.indexOf("… [");

    expect(keptOfFirst).toBeGreaterThan(20_000);
    expect(keptOfFirst).toBe(keptOfSecond);
    // As much as fits is kept: one more character each would not fit.
    expect(json.length).toBeGreaterThan(
      LLM_CALL_CONTENT_LIMITS.inputMessagesJsonLength - 8,
    );
  });

  test("a history of thousands of messages keeps the newest", () => {
    const messages: Array<LLMMessage> = [];

    for (let index: number = 0; index < 5_000; index++) {
      messages.push({
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message ${index} `.padEnd(300, "x"),
      });
    }

    const json: string = requestAttributes(messages, true)[
      "gen_ai.input.messages"
    ] as string;
    const recorded: Array<GenAiMessage> = JSON.parse(json);
    const textAt: (position: number) => string = (position: number) => {
      return (recorded[position]!.parts[0] as { content: string }).content;
    };

    expect(json.length).toBeLessThanOrEqual(
      LLM_CALL_CONTENT_LIMITS.inputMessagesJsonLength,
    );
    expect(recorded.length).toBeGreaterThan(100);
    expect(recorded.length).toBeLessThan(5_000);
    expect(textAt(recorded.length - 1).startsWith("message 4999 ")).toBe(true);
    expect(textAt(0).startsWith(`message ${5_000 - recorded.length} `)).toBe(
      true,
    );
  });

  test("a tool call's long arguments are cut as their JSON", () => {
    const file: string = "const x = 1;\n".repeat(30_000);
    const json: string = LLMCallTelemetry.toBoundedMessagesJson(
      [
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              id: "write_1",
              name: "write_file",
              arguments: { path: "src/app.ts", content: file },
            },
            {
              type: "tool_call",
              id: "read_1",
              name: "read_file",
              arguments: { path: "src/db.ts" },
            },
          ],
        },
      ],
      64 * 1024,
    );
    const parts: Array<GenAiPart> = (
      JSON.parse(json) as Array<GenAiMessage>
    )[0]!.parts;

    expect(json.length).toBeLessThanOrEqual(64 * 1024);
    expect(typeof (parts[0] as { arguments: unknown }).arguments).toBe(
      "string",
    );
    expect(
      (parts[0] as { arguments: string }).arguments.startsWith(
        '{"path":"src/app.ts","content":"const x = 1;',
      ),
    ).toBe(true);
    expect((parts[1] as { arguments: unknown }).arguments).toEqual({
      path: "src/db.ts",
    });
  });

  test("a long system prompt is held to its own limit", () => {
    const attributes: Attributes = requestAttributes(
      [
        { role: "system", content: "Follow the runbook. ".repeat(10_000) },
        { role: "user", content: QUESTION },
      ],
      true,
    );
    const json: string = attributes["gen_ai.system_instructions"] as string;

    expect(json.length).toBeLessThanOrEqual(
      LLM_CALL_CONTENT_LIMITS.systemInstructionsJsonLength,
    );
    expect(readContent(attributes).systemInstructions.endsWith(MARKER)).toBe(
      true,
    );
  });

  test("a long answer is held to its own limit and still read as an answer", () => {
    const answer: string = "The root cause is ".repeat(20_000);
    const attributes: Attributes = storedCall(SECOND_CALL, {
      content: answer,
      stopReason: "stop",
    });
    const json: string = attributes["gen_ai.output.messages"] as string;

    expect(json.length).toBeLessThanOrEqual(
      LLM_CALL_CONTENT_LIMITS.outputMessagesJsonLength,
    );
    expect(
      textOf(readContent(attributes).output[0]!).startsWith(
        "The root cause is The root cause is",
      ),
    ).toBe(true);
    expect(extract(attributes).llmIssues).toEqual([]);
  });

  test("the limits stay within what ingest reads in full", () => {
    // The conversation list reads the newest question from up to 512 KB.
    expect(LLM_CALL_CONTENT_LIMITS.inputMessagesJsonLength).toBeLessThanOrEqual(
      512 * 1024,
    );
    // The answer checks parse up to 256 KB.
    expect(
      LLM_CALL_CONTENT_LIMITS.outputMessagesJsonLength,
    ).toBeLessThanOrEqual(256 * 1024);
    // A call's content is well under the 4 MB an export may carry.
    expect(
      LLM_CALL_CONTENT_LIMITS.systemInstructionsJsonLength +
        LLM_CALL_CONTENT_LIMITS.inputMessagesJsonLength +
        LLM_CALL_CONTENT_LIMITS.outputMessagesJsonLength,
    ).toBeLessThanOrEqual(512 * 1024);
  });
});

describe("bounding holds for conversations of every shape", () => {
  /*
   * Texts of quotes, backslashes, line breaks and emoji grow when written as
   * JSON, which is what the budget counts.
   */
  const ALPHABET: ReadonlyArray<string> = [
    "a",
    "word ",
    '"',
    "\\",
    "\n",
    "😀",
    "é",
    "{}",
    "<b>",
  ];

  function randomConversation(
    random: SeededRandom,
    seed: number,
  ): Array<GenAiMessage> {
    const count: number = 1 + random(30);
    const messages: Array<GenAiMessage> = [];

    for (let index: number = 0; index < count; index++) {
      // Mostly short texts, some long ones, a few very long.
      const longest: number = [20, 200, 2_000, 8_000][random(4)]!;
      const text: string = generatedTexts(
        1,
        seed * 1_000 + index,
        ALPHABET,
        longest,
      )[0]!;
      const kind: number = random(3);

      if (kind === 0) {
        messages.push({
          role: "user",
          parts: [{ type: "text", content: text }],
        });
      } else if (kind === 1) {
        messages.push({
          role: "assistant",
          parts: [
            { type: "text", content: text },
            {
              type: "tool_call",
              id: `call_${index}`,
              name: "query_logs",
              arguments: { query: text.slice(0, random(text.length + 1)) },
            },
          ],
        });
      } else {
        messages.push({
          role: "tool",
          parts: [
            { type: "tool_call_response", id: `call_${index}`, response: text },
          ],
        });
      }
    }

    return messages;
  }

  function textsOf(message: GenAiMessage): Array<string> {
    return message.parts.map((part: GenAiPart): string => {
      if (part.type === "text") {
        return part.content;
      }

      if (part.type === "tool_call_response") {
        return part.response;
      }

      return typeof part.arguments === "string"
        ? part.arguments
        : JSON.stringify(part.arguments);
    });
  }

  test("JSON within the budget, every text whole or a cut of itself, the newest messages kept", () => {
    const random: SeededRandom = seededRandom(4587);
    // How many conversations took each way, so the sweep covers all three.
    let keptWhole: number = 0;
    let cutOnly: number = 0;
    let oldestLeftOut: number = 0;

    for (let seed: number = 1; seed <= 150; seed++) {
      const messages: Array<GenAiMessage> = randomConversation(random, seed);
      const budget: number = 512 + random(16 * 1024);
      const json: string = LLMCallTelemetry.toBoundedMessagesJson(
        messages,
        budget,
      );
      const whole: string = JSON.stringify(messages);

      expect(json.length).toBeLessThanOrEqual(Math.max(budget, 2));

      if (whole.length <= budget) {
        expect(json).toBe(whole);
        keptWhole++;
        continue;
      }

      const recorded: Array<GenAiMessage> = JSON.parse(json);
      // The newest messages are kept, in order.
      const offset: number = messages.length - recorded.length;
      let cutCount: number = 0;

      for (let index: number = 0; index < recorded.length; index++) {
        const original: Array<string> = textsOf(messages[offset + index]!);
        const kept: Array<string> = textsOf(recorded[index]!);

        expect(recorded[index]!.role).toBe(messages[offset + index]!.role);
        expect(kept.length).toBe(original.length);

        for (let part: number = 0; part < kept.length; part++) {
          if (kept[part] === original[part]) {
            continue;
          }

          cutCount++;
          const at: number = kept[part]!.lastIndexOf("… [");

          expect(kept[part]!.endsWith(MARKER)).toBe(true);
          expect(original[part]!.startsWith(kept[part]!.slice(0, at))).toBe(
            true,
          );
          expect(kept[part]).toContain(
            `[${original[part]!.length - at} ${MARKER}`,
          );
        }
      }

      /*
       * Nothing is cut more than the budget asks: one more character each
       * (two JSON characters, four for an emoji) would not have fitted.
       */
      if (offset === 0) {
        expect(json.length).toBeGreaterThan(budget - 4 * cutCount - 1);
        cutOnly++;
      } else {
        oldestLeftOut++;
      }
    }

    expect(keptWhole).toBeGreaterThan(10);
    expect(cutOnly).toBeGreaterThan(10);
    expect(oldestLeftOut).toBeGreaterThan(10);
  });
});

/*
 * Issue #5073: an Anthropic call that reads its conversation from the prompt
 * cache reports input_tokens without the cached tokens, which LLMService adds
 * back. OneUptime's own spans now say what the conventions ask - every input
 * token in gen_ai.usage.input_tokens, and how many of them the cache served
 * or took - so its AI / LLM observability prices the call at the cache rates
 * instead of seeing a fraction of the input (the cached tokens left out), or,
 * on the OpenAI wire, pricing cached input as fresh.
 */
describe("a call that used the provider's prompt cache", () => {
  const CLAUDE: string = "claude-sonnet-5-5";

  // The usage LLMService reads off Anthropic's usage block.
  const CACHED_USAGE: LLMUsage = {
    promptTokens: 3_271 + 20_654 + 4_216,
    completionTokens: 1_571,
    totalTokens: 3_271 + 20_654 + 4_216 + 1_571,
    cachedInputTokens: 20_654,
    cacheCreationTokens: 4_216,
  };

  function cachedCall(callUsage: LLMUsage): Attributes {
    return {
      ...LLMCallTelemetry.getRequestAttributes({
        llmType: LlmType.Anthropic,
        modelName: CLAUDE,
        feature: FEATURE,
        conversationId: "run-5073",
        messages: SECOND_CALL,
        recordContent: false,
      }),
      ...LLMCallTelemetry.getResponseAttributes({
        modelName: CLAUDE,
        response: SECOND_ANSWER,
        usage: callUsage,
        recordContent: false,
      }),
    };
  }

  test("says every input token, and how many the cache served and took", () => {
    const attributes: Attributes = cachedCall(CACHED_USAGE);

    expect(attributes["gen_ai.usage.input_tokens"]).toBe(28_141);
    expect(attributes["gen_ai.usage.output_tokens"]).toBe(1_571);
    expect(attributes["gen_ai.usage.total_tokens"]).toBe(29_712);
    expect(attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(20_654);
    expect(attributes["gen_ai.usage.cache_creation.input_tokens"]).toBe(4_216);
  });

  test("a call that used no cache carries no cache counts", () => {
    const attributes: Attributes = cachedCall({
      promptTokens: 900,
      completionTokens: 40,
      totalTokens: 940,
    });

    expect(attributes["gen_ai.usage.input_tokens"]).toBe(900);
    expect(attributes["gen_ai.usage.cache_read.input_tokens"]).toBeUndefined();
    expect(
      attributes["gen_ai.usage.cache_creation.input_tokens"],
    ).toBeUndefined();
  });

  test("an OpenAI-wire call says how much of its input was cached", () => {
    const attributes: Attributes = cachedCall({
      promptTokens: 50,
      completionTokens: 5,
      totalTokens: 55,
      cachedInputTokens: 40,
    });

    expect(attributes["gen_ai.usage.input_tokens"]).toBe(50);
    expect(attributes["gen_ai.usage.cache_read.input_tokens"]).toBe(40);
  });

  test("ingest stores every input token and prices the cached ones at the cache rates", () => {
    const fields: LlmSpanFields = extract(cachedCall(CACHED_USAGE));

    expect(fields).toMatchObject({
      isLlmSpan: true,
      llmRequestModel: CLAUDE,
      llmInputTokens: 28_141,
      llmOutputTokens: 1_571,
      llmTotalTokens: 29_712,
    });

    const atCacheRates: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: CLAUDE,
      inputTokens: 28_141,
      outputTokens: 1_571,
      cacheReadTokens: 20_654,
      cacheWriteTokens: 4_216,
    });
    const allFresh: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: CLAUDE,
      inputTokens: 28_141,
      outputTokens: 1_571,
    });

    expect(atCacheRates).not.toBeNull();
    expect(fields.llmCost).toBe(atCacheRates);
    // Cheaper than the same tokens read fresh: the reads cost a fraction.
    expect(fields.llmCost).toBeLessThan(allFresh as number);
  });
});
