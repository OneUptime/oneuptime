import { describe, expect, test } from "@jest/globals";
import LlmSpanUtil, {
  LlmSpanFields,
} from "../../../../Server/Utils/Telemetry/LlmSpan";
import LlmMessageParser, {
  LlmCallContent,
  LlmMessage,
  LlmMessagePartType,
} from "../../../../Utils/Telemetry/LlmMessageParser";
import { LlmCostCatalogUtil } from "../../../../Types/Telemetry/LlmCostCatalog";
import { LlmCallKind } from "../../../../Types/Telemetry/LlmCallKind";
import { LlmAnswerIssue } from "../../../../Types/Telemetry/LlmAnswerIssue";
import { SpanStatus } from "../../../../Models/AnalyticsModels/Span";
import LlmConversationService from "../../../../Server/Services/LlmConversationService";
import { LlmConversationCall } from "../../../../Utils/Telemetry/LlmConversationTranscript";
import { JSONObject } from "../../../../Types/JSON";

/*
 * AN APP'S OPENAI AND AZURE OPENAI / MICROSOFT FOUNDRY CALLS, AS EACH SDK
 * SENDS THEM (#5776).
 *
 * One span per common instrumentation, with the attributes and events its
 * project documents - the OpenTelemetry instrumentations for Python (the
 * current genai-openai and the older openai-v2), JavaScript and Java's
 * conventions, the OpenAI .NET library, Microsoft.Extensions.AI, Azure's AI
 * Inference SDK, Semantic Kernel and OpenLLMetry - each landing as an AI
 * call with the right provider (one name per provider, Azure recognized
 * where the SDK says "openai"), the model, its tokens, its cost (priced by
 * the model that SERVED it: an Azure deployment's name prices nothing), its
 * person and conversation, its problems, and what was said where the SDK
 * recorded it.
 *
 * Names here are neutral examples: "contoso" resources, a "support-chat"
 * deployment.
 */

type Attrs = Record<string, unknown>;

interface Fixture {
  sdk: string;
  attributes: Attrs;
  events?: Array<Record<string, unknown>> | undefined;
  statusCode?: number | undefined;
  expected: {
    system: string;
    requestModel: string;
    responseModel: string;
    pricedModel: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number | undefined;
    issues: Array<LlmAnswerIssue>;
    userId?: string | undefined;
    userEmail?: string | undefined;
    conversationId?: string | undefined;
    // Text the person sent, and the answer, when recorded.
    asked?: string | undefined;
    answered?: string | undefined;
  };
}

function event(
  name: string,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return {
    time: "2026-11-04T09:00:00.000Z",
    timeUnixNano: 1793869200000000000,
    name: name,
    attributes: attributes,
  };
}

function messages(value: Array<JSONObject>): string {
  return JSON.stringify(value);
}

const FIXTURES: Array<Fixture> = [
  {
    // opentelemetry-instrumentation-genai-openai, content captured span_only.
    sdk: "Python OpenTelemetry genai-openai, OpenAI",
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "gpt-4o-mini",
      "gen_ai.response.model": "gpt-4o-mini-2024-07-18",
      "gen_ai.response.id": "chatcmpl-B9x1",
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.usage.input_tokens": 52,
      "gen_ai.usage.output_tokens": 18,
      "server.address": "api.openai.com",
      "server.port": 443,
      "gen_ai.input.messages": messages([
        {
          role: "user",
          parts: [{ type: "text", content: "What is the refund window?" }],
        },
      ]),
      "gen_ai.output.messages": messages([
        {
          role: "assistant",
          parts: [{ type: "text", content: "Thirty days from delivery." }],
          finish_reason: "stop",
        },
      ]),
    },
    expected: {
      system: "openai",
      requestModel: "gpt-4o-mini",
      responseModel: "gpt-4o-mini-2024-07-18",
      pricedModel: "gpt-4o-mini-2024-07-18",
      inputTokens: 52,
      outputTokens: 18,
      issues: [],
      asked: "What is the refund window?",
      answered: "Thirty days from delivery.",
    },
  },
  {
    sdk: "Python OpenTelemetry genai-openai, Azure OpenAI deployment",
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "azure.ai.openai",
      "gen_ai.request.model": "support-chat",
      "gen_ai.response.model": "gpt-4o-2024-11-20",
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.usage.input_tokens": 120,
      "gen_ai.usage.output_tokens": 40,
      "server.address": "contoso.openai.azure.com",
    },
    expected: {
      system: "azure.ai.openai",
      requestModel: "support-chat",
      responseModel: "gpt-4o-2024-11-20",
      pricedModel: "gpt-4o-2024-11-20",
      inputTokens: 120,
      outputTokens: 40,
      issues: [],
    },
  },
  {
    // opentelemetry-instrumentation-openai-v2 on the 1.30 conventions; its
    // content goes to log events, so the span holds none.
    sdk: "Python OpenTelemetry openai-v2 (1.30 conventions)",
    attributes: {
      "gen_ai.system": "openai",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.response.model": "gpt-4o-2024-08-06",
      "gen_ai.response.id": "chatcmpl-C1",
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.usage.input_tokens": 30,
      "gen_ai.usage.output_tokens": 12,
      "gen_ai.openai.response.service_tier": "default",
      "server.address": "api.openai.com",
    },
    expected: {
      system: "openai",
      requestModel: "gpt-4o",
      responseModel: "gpt-4o-2024-08-06",
      pricedModel: "gpt-4o-2024-08-06",
      inputTokens: 30,
      outputTokens: 12,
      issues: [],
    },
  },
  {
    // @opentelemetry/instrumentation-openai: always "openai", the Azure host
    // in server.address.
    sdk: "OpenTelemetry JavaScript instrumentation-openai, Azure OpenAI",
    attributes: {
      "gen_ai.system": "openai",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "support-chat",
      "gen_ai.response.model": "gpt-4o-2024-08-06",
      "gen_ai.response.id": "chatcmpl-D2",
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.usage.input_tokens": 200,
      "gen_ai.usage.output_tokens": 50,
      "server.address": "contoso.openai.azure.com",
      "server.port": 443,
    },
    expected: {
      system: "azure.ai.openai",
      requestModel: "support-chat",
      responseModel: "gpt-4o-2024-08-06",
      pricedModel: "gpt-4o-2024-08-06",
      inputTokens: 200,
      outputTokens: 50,
      issues: [],
    },
  },
  {
    // The OpenAI .NET library (OpenAI and Azure.AI.OpenAI), 1.27 conventions.
    sdk: "OpenAI .NET library, Azure OpenAI",
    attributes: {
      "gen_ai.system": "openai",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "support-chat",
      "gen_ai.response.model": "gpt-4o-2024-08-06",
      "gen_ai.response.id": "chatcmpl-E3",
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.usage.input_tokens": 310,
      "gen_ai.usage.output_tokens": 95,
      "server.address": "contoso.openai.azure.com",
      "server.port": 443,
    },
    expected: {
      system: "azure.ai.openai",
      requestModel: "support-chat",
      responseModel: "gpt-4o-2024-08-06",
      pricedModel: "gpt-4o-2024-08-06",
      inputTokens: 310,
      outputTokens: 95,
      issues: [],
    },
  },
  {
    sdk: "OpenAI .NET library, a failed Azure OpenAI call",
    attributes: {
      "gen_ai.system": "openai",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "support-chat",
      "error.type": "429",
      "server.address": "contoso.openai.azure.com",
    },
    statusCode: SpanStatus.Error,
    expected: {
      system: "azure.ai.openai",
      requestModel: "support-chat",
      responseModel: "",
      pricedModel: "support-chat",
      inputTokens: 0,
      outputTokens: 0,
      issues: [LlmAnswerIssue.Failed],
    },
  },
  {
    // Microsoft.Extensions.AI's OpenTelemetryChatClient, EnableSensitiveData.
    sdk: "Microsoft.Extensions.AI, Microsoft Foundry",
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "support-chat",
      "gen_ai.response.model": "gpt-4.1-2025-04-14",
      "gen_ai.usage.input_tokens": 1500,
      "gen_ai.usage.output_tokens": 210,
      "gen_ai.usage.cache_read.input_tokens": 1024,
      "gen_ai.conversation.id": "thread-42",
      "server.address": "contoso.cognitiveservices.azure.com",
      "enduser.id": "agent-7",
      "gen_ai.input.messages": messages([
        {
          role: "user",
          parts: [{ type: "text", content: "Summarize ticket 812" }],
        },
      ]),
      "gen_ai.output.messages": messages([
        {
          role: "assistant",
          parts: [{ type: "text", content: "The order arrived damaged." }],
          finish_reason: "stop",
        },
      ]),
    },
    expected: {
      system: "azure.ai.openai",
      requestModel: "support-chat",
      responseModel: "gpt-4.1-2025-04-14",
      pricedModel: "gpt-4.1-2025-04-14",
      inputTokens: 1500,
      outputTokens: 210,
      cacheReadTokens: 1024,
      issues: [],
      userId: "agent-7",
      conversationId: "thread-42",
      asked: "Summarize ticket 812",
      answered: "The order arrived damaged.",
    },
  },
  {
    // azure-ai-inference with AZURE_TRACING_GEN_AI_CONTENT_RECORDING_ENABLED.
    sdk: "Azure AI Inference SDK, content recorded",
    attributes: {
      "gen_ai.system": "az.ai.inference",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "support-chat",
      "gen_ai.response.model": "gpt-4o-2024-08-06",
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.usage.input_tokens": 64,
      "gen_ai.usage.output_tokens": 128,
      "server.address": "contoso.openai.azure.com",
    },
    events: [
      event("gen_ai.user.message", {
        "gen_ai.system": "az.ai.inference",
        "gen_ai.event.content": JSON.stringify({
          role: "user",
          content: "Translate this note into French",
        }),
      }),
      event("gen_ai.choice", {
        "gen_ai.system": "az.ai.inference",
        "gen_ai.event.content": JSON.stringify({
          message: { content: "Voici la note en français." },
          finish_reason: "stop",
          index: 0,
        }),
      }),
    ],
    expected: {
      system: "azure.ai.inference",
      requestModel: "support-chat",
      responseModel: "gpt-4o-2024-08-06",
      pricedModel: "gpt-4o-2024-08-06",
      inputTokens: 64,
      outputTokens: 128,
      issues: [],
      asked: "Translate this note into French",
      answered: "Voici la note en français.",
    },
  },
  {
    // The same SDK with content recording off: its choice event carries
    // only the finish reason and index, and the answer is not "empty".
    sdk: "Azure AI Inference SDK, content not recorded",
    attributes: {
      "gen_ai.system": "az.ai.inference",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "support-chat",
      "gen_ai.response.model": "gpt-4o-2024-08-06",
      "gen_ai.usage.input_tokens": 64,
      "gen_ai.usage.output_tokens": 128,
      "server.address": "contoso.openai.azure.com",
    },
    events: [
      event("gen_ai.choice", {
        "gen_ai.system": "az.ai.inference",
        "gen_ai.event.content": JSON.stringify({
          finish_reason: "stop",
          index: 0,
        }),
      }),
    ],
    expected: {
      system: "azure.ai.inference",
      requestModel: "support-chat",
      responseModel: "gpt-4o-2024-08-06",
      pricedModel: "gpt-4o-2024-08-06",
      inputTokens: 64,
      outputTokens: 128,
      issues: [],
    },
  },
  {
    // Semantic Kernel's model diagnostics with sensitive data on.
    sdk: "Semantic Kernel, OpenAI connector",
    attributes: {
      "gen_ai.system": "openai",
      "gen_ai.operation.name": "chat.completions",
      "gen_ai.request.model": "gpt-4o-mini",
      "gen_ai.response.id": "chatcmpl-F4",
      "gen_ai.usage.input_tokens": 80,
      "gen_ai.usage.output_tokens": 20,
      "gen_ai.response.finish_reason": "Stop",
    },
    events: [
      event("gen_ai.system.message", {
        "gen_ai.event.content": JSON.stringify({
          role: "system",
          content: "You are a booking assistant.",
        }),
      }),
      event("gen_ai.user.message", {
        "gen_ai.event.content": JSON.stringify({
          role: "user",
          content: "Book room 101 for today",
        }),
      }),
      event("gen_ai.choice", {
        "gen_ai.event.content": JSON.stringify({
          index: 0,
          message: { role: "Assistant", content: "Room 101 is booked." },
          finish_reason: "Stop",
        }),
      }),
    ],
    expected: {
      system: "openai",
      requestModel: "gpt-4o-mini",
      responseModel: "",
      pricedModel: "gpt-4o-mini",
      inputTokens: 80,
      outputTokens: 20,
      issues: [],
      asked: "Book room 101 for today",
      answered: "Room 101 is booked.",
    },
  },
  {
    // OpenLLMetry (Python): a Foundry endpoint it names "openai", the base
    // URL in gen_ai.openai.api_base.
    sdk: "OpenLLMetry, Microsoft Foundry endpoint",
    attributes: {
      "gen_ai.provider.name": "openai",
      "gen_ai.openai.api_base": "https://contoso.services.ai.azure.com/openai/v1/",
      "llm.request.type": "chat",
      "gen_ai.request.model": "gpt-4.1-mini",
      "gen_ai.response.model": "gpt-4.1-mini-2025-04-14",
      "gen_ai.usage.input_tokens": 400,
      "gen_ai.usage.output_tokens": 80,
      "llm.usage.total_tokens": 480,
      "gen_ai.prompt.0.role": "user",
      "gen_ai.prompt.0.content": "Where is my order?",
      "gen_ai.completion.0.role": "assistant",
      "gen_ai.completion.0.content": "It ships tomorrow.",
      "gen_ai.completion.0.finish_reason": "stop",
      "traceloop.association.properties.session_id": "chat-9",
      "traceloop.association.properties.user_email": "ana@example.com",
    },
    expected: {
      system: "azure.ai.openai",
      requestModel: "gpt-4.1-mini",
      responseModel: "gpt-4.1-mini-2025-04-14",
      pricedModel: "gpt-4.1-mini-2025-04-14",
      inputTokens: 400,
      outputTokens: 80,
      issues: [],
      userEmail: "ana@example.com",
      conversationId: "chat-9",
      asked: "Where is my order?",
      answered: "It ships tomorrow.",
    },
  },
  {
    // OpenLLMetry before its conventions moved: "OpenAI", prompt_tokens.
    sdk: "OpenLLMetry, older spelling",
    attributes: {
      "gen_ai.system": "OpenAI",
      "llm.request.type": "chat",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.prompt_tokens": 10,
      "gen_ai.usage.completion_tokens": 5,
    },
    expected: {
      system: "openai",
      requestModel: "gpt-4o",
      responseModel: "",
      pricedModel: "gpt-4o",
      inputTokens: 10,
      outputTokens: 5,
      issues: [],
    },
  },
  {
    // OpenLLMetry (JavaScript): gen_ai.provider.name and the current
    // conventions' message attributes.
    sdk: "OpenLLMetry JavaScript, Azure OpenAI",
    attributes: {
      "gen_ai.provider.name": "azure.ai.openai",
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "support-chat",
      "gen_ai.response.model": "gpt-4o-mini-2024-07-18",
      "gen_ai.usage.input_tokens": 90,
      "gen_ai.usage.output_tokens": 30,
      "gen_ai.input.messages": messages([
        { role: "user", parts: [{ type: "text", content: "Reset my password" }] },
      ]),
      "gen_ai.output.messages": messages([
        {
          role: "assistant",
          parts: [{ type: "text", content: "Here is the reset link." }],
          finish_reason: "stop",
        },
      ]),
    },
    expected: {
      system: "azure.ai.openai",
      requestModel: "support-chat",
      responseModel: "gpt-4o-mini-2024-07-18",
      pricedModel: "gpt-4o-mini-2024-07-18",
      inputTokens: 90,
      outputTokens: 30,
      issues: [],
      asked: "Reset my password",
      answered: "Here is the reset link.",
    },
  },
];

function textOf(messageList: Array<LlmMessage>): string {
  return messageList
    .map((message: LlmMessage): string => {
      return message.parts
        .filter((part: { type: LlmMessagePartType }): boolean => {
          return part.type === LlmMessagePartType.Text;
        })
        .map((part: { text: string }): string => {
          return part.text;
        })
        .join(" ");
    })
    .join(" ");
}

describe.each(FIXTURES)("$sdk", (fixture: Fixture) => {
  const fields: LlmSpanFields = LlmSpanUtil.extract(
    fixture.attributes as never,
    undefined,
    {
      statusCode: fixture.statusCode ?? SpanStatus.Unset,
      events: fixture.events,
    },
  );

  test("lands as an AI answer", () => {
    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmCallKind).toBe(LlmCallKind.Answer);
  });

  test("names its provider as the conventions do", () => {
    expect(fields.llmSystem).toBe(fixture.expected.system);
  });

  test("keeps the model asked for and the model that served it", () => {
    expect(fields.llmRequestModel).toBe(fixture.expected.requestModel);
    expect(fields.llmResponseModel).toBe(fixture.expected.responseModel);
  });

  test("counts its tokens", () => {
    expect(fields.llmInputTokens).toBe(fixture.expected.inputTokens);
    expect(fields.llmOutputTokens).toBe(fixture.expected.outputTokens);
  });

  test("is priced by the model that served it", () => {
    const expectedCost: number | null = LlmCostCatalogUtil.computeCostInUSD({
      model: fixture.expected.pricedModel,
      inputTokens: fixture.expected.inputTokens,
      outputTokens: fixture.expected.outputTokens,
      cacheReadTokens: fixture.expected.cacheReadTokens,
    });

    expect(fields.llmCost).toBe(expectedCost ?? 0);

    if (fixture.expected.inputTokens + fixture.expected.outputTokens > 0) {
      // Every served model here is on the price list.
      expect(fields.llmCost).toBeGreaterThan(0);
    }
  });

  test("its problems", () => {
    expect(fields.llmIssues).toEqual(fixture.expected.issues);
  });

  test("its person and conversation, where the app sent them", () => {
    expect(fields.llmUserId).toBe(fixture.expected.userId ?? "");
    expect(fields.llmUserEmail).toBe(fixture.expected.userEmail ?? "");
    expect(fields.llmConversationId).toBe(
      fixture.expected.conversationId ?? "",
    );
  });

  test("what was said, where the SDK recorded it", () => {
    const content: LlmCallContent = LlmMessageParser.readCallContent({
      attributes: fixture.attributes,
      events: fixture.events,
    });

    if (fixture.expected.asked) {
      expect(textOf(content.input)).toContain(fixture.expected.asked);
    } else {
      expect(textOf(content.input)).toBe("");
    }

    if (fixture.expected.answered) {
      expect(textOf(content.output)).toContain(fixture.expected.answered);
    } else {
      expect(textOf(content.output).trim()).toBe("");
    }
  });
});

describe("the conversation view shows a call by the model that served it", () => {
  test("an Azure deployment's call reads its model, its provider by name, its cost", () => {
    const fixture: Fixture = FIXTURES.find((item: Fixture): boolean => {
      return item.sdk === "OpenAI .NET library, Azure OpenAI";
    })!;
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      fixture.attributes as never,
    );

    const call: LlmConversationCall = LlmConversationService.toCall({
      spanId: "a1",
      traceId: "t1",
      parentSpanId: "",
      name: "chat support-chat",
      startMs: 1000,
      endMs: 3300,
      statusCode: SpanStatus.Ok,
      statusMessage: "",
      llmCallKind: fields.llmCallKind,
      llmOperation: fields.llmOperation,
      llmRequestModel: fields.llmRequestModel,
      llmResponseModel: fields.llmResponseModel,
      llmSystem: fields.llmSystem,
      llmAgentName: "",
      llmToolName: "",
      llmInputTokens: fields.llmInputTokens,
      llmOutputTokens: fields.llmOutputTokens,
      llmCost: fields.llmCost,
      llmIssues: fields.llmIssues,
      llmUserEmail: "",
      llmUserId: "",
      primaryEntityId: "9900000000000000000000b1",
      attributes: fixture.attributes as JSONObject,
      events: "[]",
    });

    expect(call.model).toBe("gpt-4o-2024-08-06");
    expect(call.provider).toBe("azure.ai.openai");
    expect(call.costUsd).toBeGreaterThan(0);
    expect(call.endMs - call.startMs).toBe(2300);
  });
});

describe("Azure's AI Inference message events", () => {
  test("a choice event with only a finish reason is not a recorded answer", () => {
    const content: LlmCallContent = LlmMessageParser.readCallContent({
      attributes: { "gen_ai.operation.name": "chat" },
      events: [
        event("gen_ai.choice", {
          "gen_ai.event.content": JSON.stringify({
            finish_reason: "length",
            index: 0,
          }),
        }),
      ],
    });

    // The finish reason still counts: a cut-off shows without the text.
    expect(content.finishReasons).toEqual(["length"]);
  });

  test("a choice event's tool calls are read", () => {
    const content: LlmCallContent = LlmMessageParser.readCallContent({
      attributes: { "gen_ai.operation.name": "chat" },
      events: [
        event("gen_ai.choice", {
          "gen_ai.event.content": JSON.stringify({
            message: {
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: '{"city":"Paris"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
            index: 0,
          }),
        }),
      ],
    });

    const parts: Array<{ type: LlmMessagePartType; toolName?: string }> = (
      content.output[0]?.parts || []
    ) as Array<{ type: LlmMessagePartType; toolName?: string }>;

    expect(
      parts.some((part: { type: LlmMessagePartType }): boolean => {
        return part.type === LlmMessagePartType.ToolCall;
      }),
    ).toBe(true);
  });

  test("an event's own attributes win over its content JSON", () => {
    const content: LlmCallContent = LlmMessageParser.readCallContent({
      attributes: {},
      events: [
        event("gen_ai.user.message", {
          content: "From the attribute",
          "gen_ai.event.content": JSON.stringify({ content: "From the JSON" }),
        }),
      ],
    });

    expect(textOf(content.input)).toBe("From the attribute");
  });

  test("content JSON that is not JSON is read as nothing, never thrown", () => {
    expect(() => {
      LlmMessageParser.readCallContent({
        attributes: {},
        events: [
          event("gen_ai.user.message", {
            "gen_ai.event.content": "{not json",
          }),
        ],
      });
    }).not.toThrow();
  });

  test("an answer with no recorded content and an explicit 0 output tokens is empty", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      {
        "gen_ai.system": "az.ai.inference",
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": "support-chat",
        "gen_ai.usage.input_tokens": 12,
        "gen_ai.usage.output_tokens": 0,
      } as never,
      undefined,
      {
        events: [
          event("gen_ai.choice", {
            "gen_ai.event.content": JSON.stringify({
              finish_reason: "stop",
              index: 0,
            }),
          }),
        ],
      },
    );

    expect(fields.llmIssues).toEqual([LlmAnswerIssue.Empty]);
  });
});
