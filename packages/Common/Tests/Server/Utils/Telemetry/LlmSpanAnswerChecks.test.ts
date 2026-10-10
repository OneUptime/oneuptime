import { describe, expect, test } from "@jest/globals";
import LlmSpanUtil, {
  LLM_USER_MESSAGE_PREVIEW_LENGTH,
  LlmSpanFields,
} from "../../../../Server/Utils/Telemetry/LlmSpan";
import { AttributeType } from "../../../../Server/Utils/Telemetry/Telemetry";
import Dictionary from "../../../../Types/Dictionary";
import { SpanStatus } from "../../../../Models/AnalyticsModels/Span";
import { LlmAnswerIssue } from "../../../../Types/Telemetry/LlmAnswerIssue";
import { LlmCallKind } from "../../../../Types/Telemetry/LlmCallKind";

/*
 * What ingest stores about each AI call's answer: the call kind
 * (llmCallKind), what went wrong (llmIssues) and a preview of the person's
 * message (llmUserMessagePreview). Attributes arrive here the way
 * TelemetryUtil.getAttributes builds them - arrays stay arrays - and events
 * the way getSpanEvents builds them.
 */

type Attrs = Dictionary<AttributeType | Array<AttributeType>>;

function chat(extra: Attrs = {}): Attrs {
  return {
    "gen_ai.operation.name": "chat",
    "gen_ai.system": "openai",
    "gen_ai.request.model": "gpt-4o",
    "gen_ai.usage.input_tokens": 12,
    "gen_ai.usage.output_tokens": 30,
    ...extra,
  };
}

function spanEvent(
  name: string,
  attributes: Record<string, unknown>,
): Record<string, unknown> {
  return {
    time: "2026-10-10T09:00:00.000Z",
    timeUnixNano: 1760086800000000000,
    name: name,
    attributes: attributes,
  };
}

describe("llmCallKind at ingest", () => {
  test.each([
    ["chat", LlmCallKind.Answer],
    ["execute_tool", LlmCallKind.Tool],
    ["invoke_agent", LlmCallKind.Agent],
    ["embeddings", LlmCallKind.Embedding],
  ])("%s spans are stored as %s", (operation: string, kind: LlmCallKind) => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      chat({ "gen_ai.operation.name": operation }),
    );

    expect(fields.llmCallKind).toBe(kind);
  });

  test("a span that is not an AI call gets no kind and no issues", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      { "http.method": "GET" },
      undefined,
      { statusCode: SpanStatus.Error },
    );

    expect(fields.isLlmSpan).toBe(false);
    expect(fields.llmCallKind).toBe("");
    expect(fields.llmIssues).toEqual([]);
  });

  test("the Vercel AI SDK's tool span is now an AI call of kind tool", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract({
      "ai.toolCall.name": "lookupOrder",
      "ai.toolCall.id": "tc_1",
    });

    expect(fields.isLlmSpan).toBe(true);
    expect(fields.llmCallKind).toBe(LlmCallKind.Tool);
  });
});

describe("llmIssues at ingest", () => {
  test("a good answer has none", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      chat({
        "gen_ai.response.finish_reasons": ["stop"],
        "gen_ai.output.messages": JSON.stringify([
          { role: "assistant", parts: [{ type: "text", content: "Hi!" }] },
        ]),
      }),
      undefined,
      { statusCode: SpanStatus.Ok, events: [] },
    );

    expect(fields.llmIssues).toEqual([]);
    expect(fields.llmFailedWithoutStatus).toBe(false);
  });

  test("a span with status Error is a failed call", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(chat(), undefined, {
      statusCode: SpanStatus.Error,
    });

    expect(fields.llmIssues).toEqual([LlmAnswerIssue.Failed]);
    // Only the status said so.
    expect(fields.llmFailedWithoutStatus).toBe(false);
  });

  test("error.type fails a call on its own account", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      chat({ "error.type": "rate_limit_exceeded" }),
      undefined,
      { statusCode: SpanStatus.Error },
    );

    expect(fields.llmIssues).toEqual([LlmAnswerIssue.Failed]);
    expect(fields.llmFailedWithoutStatus).toBe(true);
  });

  test("a finish reason array as ingest builds it (content_filter) is a refusal", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      chat({ "gen_ai.response.finish_reasons": ["content_filter"] }),
    );

    expect(fields.llmIssues).toEqual([LlmAnswerIssue.Refused]);
  });

  test("an OpenLLMetry completion that opens with a stock refusal", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      chat({
        "gen_ai.completion.0.role": "assistant",
        "gen_ai.completion.0.content":
          "I'm sorry, but I can't help with that request.",
        "gen_ai.completion.0.finish_reason": "stop",
      }),
    );

    expect(fields.llmIssues).toEqual([LlmAnswerIssue.Refused]);
  });

  test("Gemini's MAX_TOKENS is a cut-off answer", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      chat({ "gen_ai.response.finish_reasons": ["MAX_TOKENS"] }),
    );

    expect(fields.llmIssues).toEqual([LlmAnswerIssue.CutOff]);
  });

  test("0 output tokens with no content recorded is an empty answer", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      chat({ "gen_ai.usage.output_tokens": 0 }),
    );

    expect(fields.llmIssues).toEqual([LlmAnswerIssue.Empty]);
  });

  test("no output token count at all proves nothing", () => {
    const attributes: Attrs = chat();
    delete attributes["gen_ai.usage.output_tokens"];

    expect(LlmSpanUtil.extract(attributes).llmIssues).toEqual([]);
  });

  test("an embedding reporting 0 output tokens is not an empty answer", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      chat({
        "gen_ai.operation.name": "embeddings",
        "gen_ai.usage.output_tokens": 0,
      }),
    );

    expect(fields.llmIssues).toEqual([]);
  });

  test("a failing evaluation event on the span flags it", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(chat(), undefined, {
      statusCode: SpanStatus.Ok,
      events: [
        spanEvent("gen_ai.evaluation.result", {
          "gen_ai.evaluation.name": "Relevance",
          "gen_ai.evaluation.score.label": "not_relevant",
        }),
      ],
    });

    expect(fields.llmIssues).toEqual([LlmAnswerIssue.Flagged]);
  });

  test("a deprecated gen_ai.choice event with finish_reason length", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(chat(), undefined, {
      events: [
        spanEvent("gen_ai.choice", {
          index: 0,
          finish_reason: "length",
          "message.content": "Partial answer that stops mid-",
        }),
      ],
    });

    expect(fields.llmIssues).toEqual([LlmAnswerIssue.CutOff]);
  });

  test("a structured gen_ai.output.messages, flattened by ingest, is read", () => {
    const fields: LlmSpanFields = LlmSpanUtil.extract(
      chat({
        "gen_ai.output.messages": [
          {
            "gen_ai.output.messages.role": "assistant",
            "gen_ai.output.messages.parts": [
              {
                "gen_ai.output.messages.parts.type": "text",
                "gen_ai.output.messages.parts.content": "   ",
              },
            ],
          },
        ] as unknown as Array<AttributeType>,
      }),
    );

    expect(fields.llmIssues).toEqual([LlmAnswerIssue.Empty]);
  });

  test("an unreadable answer never fails the batch", () => {
    expect(() => {
      LlmSpanUtil.extract(
        chat({ "gen_ai.output.messages": "[{broken" }),
        undefined,
        { events: [null, 3, "x"] as unknown as Array<unknown> },
      );
    }).not.toThrow();
  });
});

describe("withFinalStatus: a pipeline that remaps the status", () => {
  test("a span turned from Error to Ok stops being a failed call", () => {
    expect(
      LlmSpanUtil.withFinalStatus({
        issues: [LlmAnswerIssue.Failed, LlmAnswerIssue.Flagged],
        failedWithoutStatus: false,
        statusCode: SpanStatus.Ok,
      }),
    ).toEqual([LlmAnswerIssue.Flagged]);
  });

  test("a span turned to Error becomes a failed call, first in the list", () => {
    expect(
      LlmSpanUtil.withFinalStatus({
        issues: [LlmAnswerIssue.CutOff],
        failedWithoutStatus: false,
        statusCode: SpanStatus.Error,
      }),
    ).toEqual([LlmAnswerIssue.Failed, LlmAnswerIssue.CutOff]);
  });

  test("a call that failed on its own account stays failed whatever the status", () => {
    expect(
      LlmSpanUtil.withFinalStatus({
        issues: [LlmAnswerIssue.Failed],
        failedWithoutStatus: true,
        statusCode: SpanStatus.Ok,
      }),
    ).toEqual([LlmAnswerIssue.Failed]);
  });

  test("an unchanged status changes nothing", () => {
    expect(
      LlmSpanUtil.withFinalStatus({
        issues: [LlmAnswerIssue.Refused],
        failedWithoutStatus: false,
        statusCode: SpanStatus.Unset,
      }),
    ).toEqual([LlmAnswerIssue.Refused]);
  });
});

describe("getUserMessagePreview", () => {
  test("the NEWEST message the person sent, not the first or the system prompt", () => {
    expect(
      LlmSpanUtil.getUserMessagePreview({
        attributes: {
          "gen_ai.input.messages": JSON.stringify([
            { role: "system", content: "You are a bank bot." },
            { role: "user", content: "Hi" },
            { role: "assistant", content: "Hello!" },
            { role: "user", content: "What is my balance?" },
          ]),
        },
      }),
    ).toBe("What is my balance?");
  });

  test("OpenLLMetry indexed prompts", () => {
    expect(
      LlmSpanUtil.getUserMessagePreview({
        attributes: {
          "gen_ai.prompt.0.role": "user",
          "gen_ai.prompt.0.content": "Reset my\n\n   password",
        },
      }),
    ).toBe("Reset my password");
  });

  test("a tool result after the question does not hide the question", () => {
    expect(
      LlmSpanUtil.getUserMessagePreview({
        attributes: {
          "gen_ai.input.messages": JSON.stringify([
            { role: "user", content: "Weather?" },
            {
              role: "assistant",
              tool_calls: [
                { id: "t", function: { name: "w", arguments: "{}" } },
              ],
            },
            { role: "tool", tool_call_id: "t", content: "sunny" },
          ]),
        },
      }),
    ).toBe("Weather?");
  });

  test("a long message is cut to the preview length", () => {
    const preview: string = LlmSpanUtil.getUserMessagePreview({
      attributes: {
        "gen_ai.input.messages": JSON.stringify([
          { role: "user", content: "x".repeat(5000) },
        ]),
      },
    });

    expect(preview.length).toBe(LLM_USER_MESSAGE_PREVIEW_LENGTH);
  });

  test("no prompt recorded, an image-only question and garbage all have no preview", () => {
    expect(
      LlmSpanUtil.getUserMessagePreview({ attributes: chat() }),
    ).toBe("");
    expect(
      LlmSpanUtil.getUserMessagePreview({
        attributes: {
          "gen_ai.input.messages": JSON.stringify([
            {
              role: "user",
              content: [{ type: "image_url", image_url: { url: "https://x/y.png" } }],
            },
          ]),
        },
      }),
    ).toBe("");
    expect(
      LlmSpanUtil.getUserMessagePreview({ attributes: "nope", events: 7 }),
    ).toBe("");
  });

  test("a prompt history too long to parse on the ingest path is skipped, quickly", () => {
    const history: string = JSON.stringify([
      { role: "user", content: "q".repeat(600 * 1024) },
    ]);
    const started: number = Date.now();

    expect(
      LlmSpanUtil.getUserMessagePreview({
        attributes: { "gen_ai.input.messages": history },
      }),
    ).toBe("");
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("toPreview collapses whitespace and trims", () => {
    expect(LlmSpanUtil.toPreview("  a\t\tb\r\nc  ")).toBe("a b c");
    expect(LlmSpanUtil.toPreview("")).toBe("");
  });
});
