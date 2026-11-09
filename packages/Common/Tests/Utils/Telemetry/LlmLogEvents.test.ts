import { describe, expect, test } from "@jest/globals";
import {
  GenAiLogEventFixture,
  GenAiLogEventFixtureFile,
  StoredGenAiSpan,
  loadGenAiLogEventFixture,
  toStoredLogRecords,
  toStoredSpans,
} from "../../Helpers/GenAiLogEventFixtures";
import LlmLogEventsUtil, {
  LlmEventLike,
  LlmLogEventCall,
  LlmLogEventRecord,
} from "../../../Utils/Telemetry/LlmLogEvents";
import LlmMessageParser, {
  LLM_MESSAGE_MAX_JSON_LENGTH,
  LlmCallContent,
  LlmMessage,
  LlmMessagePart,
  LlmMessagePartType,
} from "../../../Utils/Telemetry/LlmMessageParser";
import LlmConversationTranscriptUtil, {
  LlmConversationCall,
  LlmTranscript,
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "../../../Utils/Telemetry/LlmConversationTranscript";
import { LlmCallKind } from "../../../Types/Telemetry/LlmCallKind";
import {
  LlmContentEventNames,
  LlmInferenceDetailsEventName,
} from "../../../Types/Telemetry/LlmConventions";

/*
 * Prompts and answers that arrive as GenAI log events, read the way the
 * conversation view and the span panel read them - first on what the
 * OpenAI instrumentations for JavaScript, Python and Java really sent
 * (Tests/Fixtures/GenAiLogEvents), then shape by shape.
 */

// When a record that sends no time of its own arrived (after every call).
const ARRIVED_AT_NANO: string = "1794199999000000000";

interface CallReading {
  span: StoredGenAiSpan;
  records: Array<LlmLogEventRecord>;
  spanContent: LlmCallContent;
  logContent: LlmCallContent;
  merged: LlmCallContent;
}

function toCall(span: StoredGenAiSpan): LlmLogEventCall {
  return {
    spanId: span.spanId,
    traceId: span.traceId,
    startMs: span.startMs,
    endMs: span.endMs,
    isModelCall: true,
  };
}

function readFixture(
  fixture: GenAiLogEventFixture,
  options?: { stampEventName?: boolean },
): Array<CallReading> {
  const file: GenAiLogEventFixtureFile = loadGenAiLogEventFixture(fixture);
  const spans: Array<StoredGenAiSpan> = toStoredSpans(file);
  const assigned: Map<
    string,
    Array<LlmLogEventRecord>
  > = LlmLogEventsUtil.assignToCalls(
    spans.map(toCall),
    toStoredLogRecords(file, {
      arrivedAtNano: ARRIVED_AT_NANO,
      stampEventName: options?.stampEventName,
    }),
  );

  return spans.map((span: StoredGenAiSpan): CallReading => {
    const records: Array<LlmLogEventRecord> = assigned.get(span.spanId) || [];
    const spanContent: LlmCallContent = LlmMessageParser.readCallContent({
      attributes: span.attributes,
      events: span.events,
    });
    const logContent: LlmCallContent = LlmLogEventsUtil.readContent(records);

    return {
      span: span,
      records: records,
      spanContent: spanContent,
      logContent: logContent,
      merged: LlmLogEventsUtil.mergeContent(spanContent, logContent),
    };
  });
}

// "role: text" for each message, the way a reader would sum one up.
function lines(messages: Array<LlmMessage>): Array<string> {
  return messages.map((message: LlmMessage): string => {
    return `${message.role}: ${LlmMessageParser.toDisplayText(message)}`;
  });
}

function partsOf(
  message: LlmMessage | undefined,
  type: LlmMessagePartType,
): Array<LlmMessagePart> {
  return (message?.parts || []).filter((part: LlmMessagePart): boolean => {
    return part.type === type;
  });
}

function toConversationCall(
  reading: CallReading,
  content: LlmCallContent,
): LlmConversationCall {
  return {
    spanId: reading.span.spanId,
    traceId: reading.span.traceId,
    parentSpanId: "",
    name: reading.span.name,
    startMs: reading.span.startMs,
    endMs: reading.span.endMs,
    statusIsError: false,
    statusMessage: "",
    kind: LlmCallKind.Answer,
    model: "gpt-4o-mini",
    provider: "openai",
    agentName: "",
    toolName: "",
    inputTokens: 31,
    outputTokens: 12,
    costUsd: 0,
    issues: [],
    userLabel: "",
    serviceId: "",
    content: content,
  };
}

function stepTexts(
  transcript: LlmTranscript,
  type: LlmTranscriptStepType,
): Array<string> {
  return transcript.steps
    .filter((step: LlmTranscriptStep): boolean => {
      return step.type === type;
    })
    .map((step: LlmTranscriptStep): string => {
      return step.text;
    });
}

const FAKE_ANSWER: string =
  "This is a test answer from the fake OpenAI server.";
const WEATHER_QUESTION: string = "What is the weather in Paris?";
const WEATHER_ANSWER: string = "It is 18 degrees and sunny in Paris.";

/*
 * What the app's four Chat Completions calls said, as each instrumentation
 * recorded them: a chat with a system prompt, the question that asks for a
 * tool, the same question with the tool's answer, two choices, a stream.
 */
function expectChatCalls(readings: Array<CallReading>): void {
  const [chat, toolAsk, toolAnswer, twoChoices, stream] = readings;

  expect(lines(chat!.merged.input)).toEqual([
    "system: You are a helpful assistant.",
    "user: Say this is a test.",
  ]);
  expect(lines(chat!.merged.output)).toEqual([`assistant: ${FAKE_ANSWER}`]);
  expect(chat!.merged.finishReasons).toEqual(["stop"]);

  // The model asks for the tool: a tool call with its id, name and arguments.
  expect(lines(toolAsk!.merged.input)).toEqual([`user: ${WEATHER_QUESTION}`]);
  const askedCall: LlmMessagePart | undefined = partsOf(
    toolAsk!.merged.output[0],
    LlmMessagePartType.ToolCall,
  )[0];
  expect(askedCall?.toolCallId).toBe("call_weather_paris");
  expect(askedCall?.toolName).toBe("get_weather");
  expect(JSON.parse(askedCall?.arguments || "{}")).toEqual({ city: "Paris" });

  // The app sends the history back with the tool's result.
  expect(
    toolAnswer!.merged.input.map((message: LlmMessage) => {
      return message.role;
    }),
  ).toEqual(["user", "assistant", "tool"]);
  const result: LlmMessagePart | undefined = partsOf(
    toolAnswer!.merged.input[2],
    LlmMessagePartType.ToolResult,
  )[0];
  expect(result?.toolCallId).toBe("call_weather_paris");
  expect(JSON.parse(result?.text || "{}")).toEqual({
    temperature: 18,
    sky: "sunny",
  });
  expect(lines(toolAnswer!.merged.output)).toEqual([
    `assistant: ${WEATHER_ANSWER}`,
  ]);

  // Several choices: every one, in the order of its index.
  expect(lines(twoChoices!.merged.output)).toEqual([
    "assistant: Answer number 1: a haiku about logs.",
    "assistant: Answer number 2: a haiku about logs.",
  ]);

  // A streamed answer arrives whole.
  expect(lines(stream!.merged.input)).toEqual(["user: Stream me an answer."]);
  expect(lines(stream!.merged.output)).toEqual([`assistant: ${FAKE_ANSWER}`]);

  for (const reading of readings) {
    // The span itself carries no prompt and no answer.
    expect(reading.spanContent.input).toEqual([]);
    expect(reading.spanContent.output).toEqual([]);
  }
}

describe("what the OpenAI instrumentations send as log events", () => {
  test("JavaScript (@opentelemetry/instrumentation-openai 0.23.0) over OTLP/protobuf", () => {
    const readings: Array<CallReading> = readFixture(
      GenAiLogEventFixture.JavaScriptContent,
    );

    expect(readings).toHaveLength(6);
    expectChatCalls(readings);

    /*
     * The Responses API: one details event split over two records, the
     * input on one and the answer on the other, read as one.
     */
    const responses: CallReading = readings[5]!;
    expect(responses.records).toHaveLength(2);
    expect(lines(responses.merged.input)).toEqual([
      "system: Answer in one sentence.",
      "user: What does the Responses API return?",
    ]);
    expect(lines(responses.merged.output)).toEqual([
      "assistant: A Responses API answer.",
    ]);
    // Its instructions are on the span, and win there.
    expect(responses.merged.systemInstructions).toBe("Answer in one sentence.");
  });

  test("JavaScript over OTLP/JSON (hex ids, numeric severity) reads the same", () => {
    const readings: Array<CallReading> = readFixture(
      GenAiLogEventFixture.JavaScriptContentOtlpJson,
    );

    expect(readings).toHaveLength(6);
    expectChatCalls(readings);
    expect(lines(readings[5]!.merged.output)).toEqual([
      "assistant: A Responses API answer.",
    ]);
  });

  test("Python (opentelemetry-instrumentation-openai-v2 2.4b0) with true: named in the record's event name field", () => {
    const readings: Array<CallReading> = readFixture(
      GenAiLogEventFixture.PythonOpenAiV2True,
    );

    expect(readings).toHaveLength(5);
    expectChatCalls(readings);
  });

  test("Python 2.1b0 on an SDK with the Events API: named in the event.name attribute", () => {
    const readings: Array<CallReading> = readFixture(
      GenAiLogEventFixture.PythonOpenAiV2EventsApi,
    );

    expect(readings).toHaveLength(5);
    expectChatCalls(readings);
  });

  test("Java (the OpenTelemetry Java agent 2.33.1, openai-java)", () => {
    const readings: Array<CallReading> = readFixture(
      GenAiLogEventFixture.JavaContent,
    );

    expect(readings).toHaveLength(5);
    expectChatCalls(readings);
  });

  test("Python with event_only: one gen_ai.client.inference.operation.details record per call", () => {
    for (const fixture of [
      GenAiLogEventFixture.PythonOpenAiV2EventOnly,
      GenAiLogEventFixture.PythonGenAiOpenAiEventOnly,
    ]) {
      const readings: Array<CallReading> = readFixture(fixture);

      expect(readings).toHaveLength(5);

      for (const reading of readings) {
        expect(reading.records).toHaveLength(1);
      }

      expectChatCalls(readings);
    }
  });

  test("Python with span_and_event: the span's copy wins and each message shows once", () => {
    const readings: Array<CallReading> = readFixture(
      GenAiLogEventFixture.PythonOpenAiV2SpanAndEvent,
    );

    expect(readings).toHaveLength(5);

    for (const reading of readings) {
      // Both carry the call's content...
      expect(reading.spanContent.input.length).toBeGreaterThan(0);
      expect(reading.logContent.input.length).toBeGreaterThan(0);
      // ...and the span's is the one read.
      expect(reading.merged.input).toBe(reading.spanContent.input);
      expect(reading.merged.output).toBe(reading.spanContent.output);
    }

    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build(
      readings.map((reading: CallReading): LlmConversationCall => {
        return toConversationCall(reading, reading.merged);
      }),
    );

    expect(stepTexts(transcript, LlmTranscriptStepType.UserMessage)).toEqual([
      "Say this is a test.",
      WEATHER_QUESTION,
      "Write a haiku about logs.",
      "Stream me an answer.",
    ]);
    expect(
      stepTexts(transcript, LlmTranscriptStepType.AssistantMessage),
    ).toEqual([
      FAKE_ANSWER,
      WEATHER_ANSWER,
      "Answer number 1: a haiku about logs.",
      FAKE_ANSWER,
    ]);
    expect(transcript.instructions).toBe("You are a helpful assistant.");
  });

  test("a conversation of log-event calls reads like one recorded on its spans", () => {
    const fromLogs: Array<CallReading> = readFixture(
      GenAiLogEventFixture.JavaContent,
    );
    const transcript: LlmTranscript = LlmConversationTranscriptUtil.build(
      fromLogs.map((reading: CallReading): LlmConversationCall => {
        return toConversationCall(reading, reading.merged);
      }),
    );

    expect(transcript.contentRecorded).toBe(true);
    expect(transcript.title).toBe("Say this is a test.");
    expect(transcript.instructions).toBe("You are a helpful assistant.");
    // The question the tool round trip repeats shows once, as does its tool.
    expect(stepTexts(transcript, LlmTranscriptStepType.UserMessage)).toEqual([
      "Say this is a test.",
      WEATHER_QUESTION,
      "Write a haiku about logs.",
      "Stream me an answer.",
    ]);
    expect(
      transcript.steps.filter((step: LlmTranscriptStep): boolean => {
        return step.type === LlmTranscriptStepType.ToolCall;
      }),
    ).toHaveLength(1);
    expect(
      transcript.steps
        .filter((step: LlmTranscriptStep): boolean => {
          return step.type === LlmTranscriptStepType.ToolResult;
        })
        .map((step: LlmTranscriptStep): string => {
          return step.toolName;
        }),
    ).toEqual(["get_weather"]);
  });

  test("content capture off: the events still arrive, and say nothing of what was said", () => {
    for (const fixture of [
      GenAiLogEventFixture.JavaScriptNoContent,
      GenAiLogEventFixture.PythonOpenAiV2NoContent,
      GenAiLogEventFixture.JavaNoContent,
    ]) {
      const readings: Array<CallReading> = readFixture(fixture);

      expect(readings.length).toBeGreaterThan(0);

      for (const reading of readings) {
        expect(reading.records.length).toBeGreaterThan(0);
        /*
         * Every call reads as not recorded - never as an empty answer, nor
         * as a bare "get_weather()" with no arguments.
         */
        expect(reading.logContent.input).toEqual([]);
        expect(reading.logContent.output).toEqual([]);
        expect(reading.merged.input).toEqual([]);
        expect(reading.merged.output).toEqual([]);
        expect(LlmLogEventsUtil.lacksContent(reading.merged)).toBe(true);
      }

      // The tool round trip's events name the tool, and only the tool.
      const asked: string = JSON.stringify(
        LlmLogEventsUtil.toEvents(readings[1]!.records),
      );
      expect(asked).toContain("get_weather");
      expect(asked).not.toContain("Paris");
    }

    // The Responses API's details parts name only their type.
    const responses: CallReading = readFixture(
      GenAiLogEventFixture.JavaScriptNoContent,
    )[5]!;
    expect(responses.logContent.input).toEqual([]);
    expect(responses.logContent.output).toEqual([]);
  });

  test("a part says something when it has text, arguments, a result or an address", () => {
    const part: (fields: Partial<LlmMessagePart>) => LlmMessagePart = (
      fields: Partial<LlmMessagePart>,
    ): LlmMessagePart => {
      return { type: LlmMessagePartType.Text, text: "", ...fields };
    };

    expect(LlmLogEventsUtil.partSaysSomething(part({ text: "hi" }))).toBe(true);
    expect(LlmLogEventsUtil.partSaysSomething(part({ text: "  " }))).toBe(
      false,
    );
    expect(
      LlmLogEventsUtil.partSaysSomething(
        part({ type: LlmMessagePartType.ToolCall, toolName: "get_weather" }),
      ),
    ).toBe(false);
    expect(
      LlmLogEventsUtil.partSaysSomething(
        part({
          type: LlmMessagePartType.ToolCall,
          toolName: "get_time",
          arguments: "{}",
        }),
      ),
    ).toBe(true);
    expect(
      LlmLogEventsUtil.partSaysSomething(
        part({ type: LlmMessagePartType.ToolResult, toolCallId: "c1" }),
      ),
    ).toBe(false);
    expect(
      LlmLogEventsUtil.partSaysSomething(
        part({ type: LlmMessagePartType.ToolResult, text: "18" }),
      ),
    ).toBe(true);
    expect(
      LlmLogEventsUtil.partSaysSomething(
        part({
          type: LlmMessagePartType.Media,
          modality: "image",
          uri: "https://example.com/cat.png",
        }),
      ),
    ).toBe(true);
    expect(
      LlmLogEventsUtil.partSaysSomething(
        part({ type: LlmMessagePartType.Media, modality: "image" }),
      ),
    ).toBe(false);
  });

  test("before ingest read the event name field, Python's per-message events had no name to read", () => {
    const unnamed: Array<CallReading> = readFixture(
      GenAiLogEventFixture.PythonOpenAiV2True,
      { stampEventName: false },
    );

    for (const reading of unnamed) {
      expect(reading.records).toEqual([]);
    }

    // The instrumentations that name them in an attribute read either way.
    expectChatCalls(
      readFixture(GenAiLogEventFixture.JavaContent, { stampEventName: false }),
    );
    expectChatCalls(
      readFixture(GenAiLogEventFixture.PythonOpenAiV2EventsApi, {
        stampEventName: false,
      }),
    );

    // A details record is known by its attributes, name or not.
    expectChatCalls(
      readFixture(GenAiLogEventFixture.PythonOpenAiV2EventOnly, {
        stampEventName: false,
      }),
    );
  });

  test("every record of a capture goes to a call of its trace", () => {
    for (const fixture of Object.values(GenAiLogEventFixture)) {
      const file: GenAiLogEventFixtureFile = loadGenAiLogEventFixture(fixture);
      const records: Array<LlmLogEventRecord> = toStoredLogRecords(file, {
        arrivedAtNano: ARRIVED_AT_NANO,
      });
      const assigned: Map<
        string,
        Array<LlmLogEventRecord>
      > = LlmLogEventsUtil.assignToCalls(
        toStoredSpans(file).map(toCall),
        records,
      );
      let count: number = 0;

      for (const callRecords of assigned.values()) {
        count += callRecords.length;
      }

      expect({ fixture, count }).toEqual({ fixture, count: records.length });
    }
  });
});

describe("OTLP values as log ingest stores them", () => {
  test("every AnyValue spelling: OTLP/JSON, protobufjs and the gRPC loader", () => {
    expect(LlmLogEventsUtil.readAnyValue({ stringValue: "hi" })).toBe("hi");
    expect(LlmLogEventsUtil.readAnyValue({ string_value: "hi" })).toBe("hi");
    expect(
      LlmLogEventsUtil.readAnyValue({
        stringValue: "hi",
        value: "stringValue",
      }),
    ).toBe("hi");
    expect(LlmLogEventsUtil.readAnyValue({ intValue: "31" })).toBe(31);
    expect(LlmLogEventsUtil.readAnyValue({ int_value: 7 })).toBe(7);
    expect(LlmLogEventsUtil.readAnyValue({ doubleValue: 0.5 })).toBe(0.5);
    expect(LlmLogEventsUtil.readAnyValue({ boolValue: true })).toBe(true);
    expect(LlmLogEventsUtil.readAnyValue({ bool_value: false })).toBe(false);
    expect(LlmLogEventsUtil.readAnyValue({ bytesValue: "AAEC" })).toBe("AAEC");
    expect(
      LlmLogEventsUtil.readAnyValue({
        kvlistValue: {
          values: [
            { key: "content", value: { stringValue: "hello" } },
            {
              key: "tool_calls",
              value: {
                arrayValue: {
                  values: [
                    {
                      kvlistValue: {
                        values: [{ key: "id", value: { stringValue: "c1" } }],
                      },
                      value: "kvlistValue",
                    },
                  ],
                },
                value: "arrayValue",
              },
            },
          ],
        },
        value: "kvlistValue",
      }),
    ).toEqual({ content: "hello", tool_calls: [{ id: "c1" }] });
  });

  test("a whole number past 2^53 keeps its digits", () => {
    expect(
      LlmLogEventsUtil.readAnyValue({ intValue: "9007199254740993" }),
    ).toBe("9007199254740993");
  });

  test("an empty value, an empty list and a key without a name", () => {
    expect(LlmLogEventsUtil.readAnyValue({})).toBeUndefined();
    expect(LlmLogEventsUtil.readAnyValue({ kvlistValue: {} })).toEqual({});
    expect(LlmLogEventsUtil.readAnyValue({ arrayValue: {} })).toEqual([]);
    expect(
      LlmLogEventsUtil.readAnyValue({
        kvlistValue: {
          values: [
            { key: "", value: { stringValue: "x" } },
            { value: { stringValue: "y" } },
            { key: "kept", value: { stringValue: "z" } },
            { key: "empty", value: {} },
          ],
        },
      }),
    ).toEqual({ kept: "z" });
  });

  test("a value nested past the depth limit is left out, not followed", () => {
    let value: Record<string, unknown> = { stringValue: "deep" };

    for (let depth: number = 0; depth < 200; depth++) {
      value = { arrayValue: { values: [value] } };
    }

    expect(() => {
      return LlmLogEventsUtil.readAnyValue(value);
    }).not.toThrow();
    expect(JSON.stringify(LlmLogEventsUtil.readAnyValue(value))).not.toContain(
      "deep",
    );
  });

  test("bodies: missing, empty, a key/value list, text and JSON text", () => {
    // A missing body is stored as "" or as the two characters "".
    expect(LlmLogEventsUtil.readBody("")).toBeUndefined();
    expect(LlmLogEventsUtil.readBody('""')).toBeUndefined();
    expect(LlmLogEventsUtil.readBody(null)).toBeUndefined();
    expect(LlmLogEventsUtil.readBody("{}")).toBeUndefined();
    expect(LlmLogEventsUtil.readBody('{"kvlistValue":{}}')).toEqual({});
    expect(
      LlmLogEventsUtil.readBody(
        '{"kvlistValue":{"values":[{"key":"content","value":{"stringValue":"hi"}}]}}',
      ),
    ).toEqual({ content: "hi" });
    // A text body is stored as the text.
    expect(LlmLogEventsUtil.readBody("Say this is a test.")).toBe(
      "Say this is a test.",
    );
    // Text that only looks like JSON stays text.
    expect(LlmLogEventsUtil.readBody("{not json")).toBe("{not json");
    // A text body that is a message's JSON.
    expect(LlmLogEventsUtil.readBody('{"content":"hi","role":"user"}')).toEqual(
      { content: "hi", role: "user" },
    );
    expect(LlmLogEventsUtil.readBody('"quoted"')).toBe("quoted");
  });

  test("a body longer than the parser reads is left out", () => {
    const tooLong: string = "x".repeat(LLM_MESSAGE_MAX_JSON_LENGTH + 1);

    expect(LlmLogEventsUtil.readBody(tooLong)).toBeUndefined();
    expect(LlmLogEventsUtil.readBody(tooLong, tooLong.length)).toBe(tooLong);
  });
});

function record(
  name: string,
  body: unknown,
  extra?: Partial<LlmLogEventRecord>,
): LlmLogEventRecord {
  return {
    traceId: "aaaa",
    spanId: "bbbb",
    timeUnixNano: "1000000000",
    observedTimeUnixNano: "1000000000",
    attributes: name ? { "event.name": name, "gen_ai.system": "openai" } : {},
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...extra,
  };
}

function kv(fields: Record<string, unknown>): Record<string, unknown> {
  const toAny: (value: unknown) => unknown = (value: unknown): unknown => {
    if (typeof value === "string") {
      return { stringValue: value };
    }

    if (typeof value === "number") {
      return { intValue: String(value) };
    }

    if (Array.isArray(value)) {
      return { arrayValue: { values: value.map(toAny) } };
    }

    return kv(value as Record<string, unknown>);
  };

  return {
    kvlistValue: {
      values: Object.keys(fields).map((key: string) => {
        return { key: key, value: toAny(fields[key]) };
      }),
    },
  };
}

describe("which records say what was said", () => {
  test("the GenAI message, choice and details events, by name", () => {
    for (const name of LlmContentEventNames) {
      expect(LlmLogEventsUtil.getContentEventName(record(name, {}))).toBe(name);
    }

    for (const name of [
      "gen_ai.evaluation.result",
      "browser.page_view",
      "interface.down",
      "",
    ]) {
      expect(LlmLogEventsUtil.getContentEventName(record(name, {}))).toBe("");
    }
  });

  test("a details record with no name is known by its attributes", () => {
    expect(
      LlmLogEventsUtil.getContentEventName({
        attributes: { "gen_ai.output.messages": "[]", "gen_ai.system": "x" },
      }),
    ).toBe("");
    expect(
      LlmLogEventsUtil.getContentEventName({
        attributes: { "gen_ai.output.messages": '[{"role":"assistant"}]' },
      }),
    ).toBe(LlmInferenceDetailsEventName);
    expect(
      LlmLogEventsUtil.getContentEventName({
        attributes: { "gen_ai.system_instructions": "Be brief." },
      }),
    ).toBe(LlmInferenceDetailsEventName);
    // A name that is not a content event's wins over the attributes.
    expect(
      LlmLogEventsUtil.getContentEventName({
        attributes: {
          "event.name": "my.app.event",
          "gen_ai.input.messages": '[{"role":"user"}]',
        },
      }),
    ).toBe("");
  });

  test("records of any shape never throw", () => {
    const strange: Array<LlmLogEventRecord> = [
      {},
      { attributes: null, body: null },
      { attributes: "text", body: 42 },
      { attributes: [], body: [] },
      { attributes: { "event.name": 7 }, body: true },
      { attributes: { "event.name": "gen_ai.choice" }, body: "[1, 2" },
      { attributes: { "event.name": "gen_ai.choice" }, body: "[1, 2]" },
      {
        attributes: { "event.name": LlmInferenceDetailsEventName },
        body: "{}",
      },
    ];

    expect(() => {
      LlmLogEventsUtil.readContent(strange);
      LlmLogEventsUtil.assignToCalls(
        [
          {
            spanId: "bbbb",
            traceId: "aaaa",
            startMs: 0,
            endMs: 1,
            isModelCall: true,
          },
        ],
        strange,
      );
    }).not.toThrow();
  });
});

describe("a call's records as span events", () => {
  test("messages in the order they were sent, then the answers by choice index", () => {
    const events: Array<LlmEventLike> = LlmLogEventsUtil.toEvents([
      record(
        "gen_ai.choice",
        kv({ index: 1, finish_reason: "stop", message: { content: "B" } }),
        { timeUnixNano: "5000" },
      ),
      record("gen_ai.user.message", kv({ content: "Second question" }), {
        timeUnixNano: "3000",
      }),
      record(
        "gen_ai.choice",
        kv({ index: 0, finish_reason: "stop", message: { content: "A" } }),
        { timeUnixNano: "6000" },
      ),
      record("gen_ai.system.message", kv({ content: "Be brief." }), {
        timeUnixNano: "1000",
      }),
    ]);

    expect(
      events.map((event: LlmEventLike): string => {
        return event.name;
      }),
    ).toEqual([
      "gen_ai.system.message",
      "gen_ai.user.message",
      "gen_ai.choice",
      "gen_ai.choice",
    ]);

    const content: LlmCallContent = LlmMessageParser.readCallContent({
      attributes: {},
      events: events,
    });

    expect(lines(content.input)).toEqual([
      "system: Be brief.",
      "user: Second question",
    ]);
    expect(lines(content.output)).toEqual(["assistant: A", "assistant: B"]);
  });

  test("a record with no time of its own is ordered by when it was observed", () => {
    /*
     * Stored at the time it arrived (all three at once), observed in the
     * order they were sent.
     */
    const sorted: Array<LlmLogEventRecord> = LlmLogEventsUtil.sortRecords([
      record("gen_ai.choice", kv({ index: 0, message: { content: "A" } }), {
        timeUnixNano: "9000000",
        observedTimeUnixNano: "3000",
      }),
      record("gen_ai.user.message", kv({ content: "Q" }), {
        timeUnixNano: "9000000",
        observedTimeUnixNano: "2000",
      }),
      record("gen_ai.system.message", kv({ content: "S" }), {
        timeUnixNano: "9000000",
        observedTimeUnixNano: "1000",
      }),
    ]);

    expect(
      sorted.map((entry: LlmLogEventRecord): string => {
        return LlmLogEventsUtil.getEventName(entry);
      }),
    ).toEqual([
      "gen_ai.system.message",
      "gen_ai.user.message",
      "gen_ai.choice",
    ]);
    expect(LlmLogEventsUtil.getTimeMs(sorted[0]!)).toBe(0);
  });

  test("records of the same nanosecond keep the order they were stored in", () => {
    const sorted: Array<LlmLogEventRecord> = LlmLogEventsUtil.sortRecords([
      record("gen_ai.tool.message", kv({ id: "c1", content: "18" }), {
        rowOffset: "12",
      }),
      record("gen_ai.user.message", kv({ content: "Q" }), { rowOffset: "10" }),
      record(
        "gen_ai.assistant.message",
        kv({ tool_calls: [{ id: "c1", function: { name: "get_weather" } }] }),
        { rowOffset: "11" },
      ),
    ]);

    expect(
      sorted.map((entry: LlmLogEventRecord): string => {
        return LlmLogEventsUtil.getEventName(entry);
      }),
    ).toEqual([
      "gen_ai.user.message",
      "gen_ai.assistant.message",
      "gen_ai.tool.message",
    ]);
  });

  test("times past 2^53 nanoseconds are compared digit by digit", () => {
    const sorted: Array<LlmLogEventRecord> = LlmLogEventsUtil.sortRecords([
      record("gen_ai.user.message", kv({ content: "later" }), {
        timeUnixNano: "1794198568695000001",
        observedTimeUnixNano: "0",
      }),
      record("gen_ai.user.message", kv({ content: "earlier" }), {
        timeUnixNano: "1794198568695000000",
        observedTimeUnixNano: "0",
      }),
    ]);

    expect(
      sorted.map((entry: LlmLogEventRecord): string => {
        return String(entry.timeUnixNano);
      }),
    ).toEqual(["1794198568695000000", "1794198568695000001"]);
    expect(LlmLogEventsUtil.getTimeMs(sorted[0]!)).toBe(1794198568695);
  });

  test("details split over records read as one, the first to say a thing saying it", () => {
    const content: LlmCallContent = LlmLogEventsUtil.readContent([
      {
        attributes: {
          "event.name": LlmInferenceDetailsEventName,
          "gen_ai.input.messages": JSON.stringify([
            { role: "user", parts: [{ type: "text", content: "Q" }] },
          ]),
        },
        body: '""',
        timeUnixNano: "1",
      },
      {
        attributes: {
          "event.name": LlmInferenceDetailsEventName,
          "gen_ai.input.messages": JSON.stringify([
            { role: "user", parts: [{ type: "text", content: "ignored" }] },
          ]),
          "gen_ai.output.messages": JSON.stringify([
            {
              role: "assistant",
              parts: [{ type: "text", content: "A" }],
              finish_reason: "stop",
            },
          ]),
        },
        body: '""',
        timeUnixNano: "2",
      },
    ]);

    expect(lines(content.input)).toEqual(["user: Q"]);
    expect(lines(content.output)).toEqual(["assistant: A"]);
    expect(content.finishReasons).toEqual(["stop"]);
  });

  test("details an instrumentation put in the body are read too", () => {
    const content: LlmCallContent = LlmLogEventsUtil.readContent([
      record(
        LlmInferenceDetailsEventName,
        kv({
          "gen_ai.system_instructions": "Be brief.",
        }),
      ),
    ]);

    expect(content.systemInstructions).toBe("Be brief.");
  });

  test("a text body is the message's content", () => {
    const content: LlmCallContent = LlmLogEventsUtil.readContent([
      record("gen_ai.user.message", "What is OneUptime?"),
      record("gen_ai.choice", '{"index":0,"message":{"content":"A tool."}}'),
    ]);

    expect(lines(content.input)).toEqual(["user: What is OneUptime?"]);
    expect(lines(content.output)).toEqual(["assistant: A tool."]);
  });

  test("a message with nothing in it is left out", () => {
    const content: LlmCallContent = LlmLogEventsUtil.readContent([
      record("gen_ai.user.message", '{"kvlistValue":{}}'),
      record("gen_ai.choice", kv({ index: 0, finish_reason: "stop" })),
    ]);

    expect(content.input).toEqual([]);
    expect(content.output).toEqual([]);
    expect(content.finishReasons).toEqual(["stop"]);
  });

  test("a very long message is read whole", () => {
    const longQuestion: string = `${"Explain logs. ".repeat(30_000)}Thanks.`;
    const content: LlmCallContent = LlmLogEventsUtil.readContent([
      record("gen_ai.user.message", kv({ content: longQuestion })),
      record("gen_ai.choice", kv({ index: 0, message: { content: "Done." } })),
    ]);

    expect(longQuestion.length).toBeGreaterThan(400_000);
    expect(LlmMessageParser.getText(content.input[0]!)).toBe(longQuestion);
    expect(lines(content.output)).toEqual(["assistant: Done."]);
  });

  test("a body longer than the parser reads leaves that message out, and the rest in", () => {
    const content: LlmCallContent = LlmLogEventsUtil.readContent(
      [
        record("gen_ai.user.message", kv({ content: "x".repeat(2_000) })),
        record("gen_ai.choice", kv({ index: 0, message: { content: "ok" } })),
      ],
      { maxJsonLength: 1_000 },
    );

    expect(content.input).toEqual([]);
    expect(lines(content.output)).toEqual(["assistant: ok"]);
  });
});

function readContentWith(
  input: Array<string>,
  output: Array<string>,
  extra?: Partial<LlmCallContent>,
): LlmCallContent {
  const message: (role: string, text: string) => LlmMessage = (
    role: string,
    text: string,
  ): LlmMessage => {
    return {
      role: role,
      name: "",
      parts: [{ type: LlmMessagePartType.Text, text: text }],
      finishReason: "",
    };
  };

  return {
    systemInstructions: "",
    input: input.map((text: string): LlmMessage => {
      return message("user", text);
    }),
    output: output.map((text: string): LlmMessage => {
      return message("assistant", text);
    }),
    finishReasons: [],
    tool: null,
    evaluations: [],
    errorType: "",
    ...extra,
  };
}

describe("a call's content from its span and its records", () => {
  test("each part the span records wins; the records fill the parts it leaves out", () => {
    const span: LlmCallContent = readContentWith(["span question"], [], {
      finishReasons: ["length"],
      errorType: "",
    });
    const logs: LlmCallContent = readContentWith(
      ["log question"],
      ["log answer"],
      {
        systemInstructions: "log instructions",
        finishReasons: ["stop"],
        errorType: "timeout",
      },
    );
    const merged: LlmCallContent = LlmLogEventsUtil.mergeContent(span, logs);

    expect(lines(merged.input)).toEqual(["user: span question"]);
    expect(lines(merged.output)).toEqual(["assistant: log answer"]);
    expect(merged.systemInstructions).toBe("log instructions");
    expect(merged.finishReasons).toEqual(["length"]);
    expect(merged.errorType).toBe("timeout");
  });

  test("a span with all of it reads only its own", () => {
    const span: LlmCallContent = readContentWith(["Q"], ["A"], {
      systemInstructions: "S",
    });
    const merged: LlmCallContent = LlmLogEventsUtil.mergeContent(
      span,
      readContentWith(["other"], ["other"], { systemInstructions: "other" }),
    );

    expect(merged.input).toBe(span.input);
    expect(merged.output).toBe(span.output);
    expect(merged.systemInstructions).toBe("S");
    expect(LlmLogEventsUtil.lacksContent(span)).toBe(false);
    expect(LlmLogEventsUtil.lacksContent(readContentWith(["Q"], []))).toBe(
      true,
    );
  });

  test("whether content says anything", () => {
    expect(LlmLogEventsUtil.hasContent(readContentWith([], []))).toBe(false);
    expect(LlmLogEventsUtil.hasContent(readContentWith(["Q"], []))).toBe(true);
    expect(
      LlmLogEventsUtil.hasContent(
        readContentWith([], [], { systemInstructions: "S" }),
      ),
    ).toBe(true);
  });
});

describe("which call a record belongs to", () => {
  const first: LlmLogEventCall = {
    spanId: "1111111111111111",
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    startMs: 1_000,
    endMs: 2_000,
    isModelCall: true,
  };
  const second: LlmLogEventCall = {
    spanId: "2222222222222222",
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    startMs: 3_000,
    endMs: 4_000,
    isModelCall: true,
  };
  const tool: LlmLogEventCall = {
    spanId: "3333333333333333",
    traceId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    startMs: 2_000,
    endMs: 3_000,
    isModelCall: false,
  };
  const elsewhere: LlmLogEventCall = {
    spanId: "4444444444444444",
    traceId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    startMs: 1_000,
    endMs: 9_000,
    isModelCall: true,
  };

  function at(spanId: string, traceId: string, ms: number): LlmLogEventRecord {
    return record("gen_ai.user.message", kv({ content: `at ${ms}` }), {
      spanId: spanId,
      traceId: traceId,
      timeUnixNano: `${ms}000000`,
      observedTimeUnixNano: `${ms}000000`,
    });
  }

  function owners(
    calls: Array<LlmLogEventCall>,
    records: Array<LlmLogEventRecord>,
  ): Record<string, number> {
    const assigned: Map<
      string,
      Array<LlmLogEventRecord>
    > = LlmLogEventsUtil.assignToCalls(calls, records);
    const counts: Record<string, number> = {};

    for (const [spanId, callRecords] of assigned) {
      counts[spanId] = callRecords.length;
    }

    return counts;
  }

  test("by its span id, in its trace, whatever their case", () => {
    expect(
      owners(
        [first, second],
        [
          at(first.spanId, first.traceId, 1_500),
          at(second.spanId.toUpperCase(), second.traceId.toUpperCase(), 1),
          // The same span id in another trace is another span.
          at(first.spanId, elsewhere.traceId, 1_500),
        ],
      ),
    ).toEqual({ [first.spanId]: 1, [second.spanId]: 1 });
  });

  test("with no span id: the trace's only model call", () => {
    expect(owners([first, tool], [at("", first.traceId, 99_000)])).toEqual({
      [first.spanId]: 1,
    });
  });

  test("with no span id among several model calls: the one it happened during", () => {
    expect(
      owners(
        [first, second, tool],
        [
          at("", first.traceId, 1_500),
          at("", first.traceId, 3_500),
          // Between the two calls: neither, left out.
          at("", first.traceId, 2_500),
        ],
      ),
    ).toEqual({ [first.spanId]: 1, [second.spanId]: 1 });
  });

  test("calls that overlap leave a record without a span id out", () => {
    const overlapping: LlmLogEventCall = {
      ...second,
      startMs: 1_200,
      endMs: 1_800,
    };

    expect(
      owners([first, overlapping], [at("", first.traceId, 1_500)]),
    ).toEqual({});
  });

  test("a record without either id, or of another span, belongs to no call", () => {
    expect(
      owners(
        [first],
        [
          at("", "", 1_500),
          at("5555555555555555", first.traceId, 1_500),
          at("", elsewhere.traceId, 1_500),
        ],
      ),
    ).toEqual({});
  });

  test("records that are not GenAI content events are never given to a call", () => {
    expect(
      owners(
        [first],
        [
          {
            ...at(first.spanId, first.traceId, 1_500),
            attributes: { "event.name": "gen_ai.evaluation.result" },
          },
          {
            ...at(first.spanId, first.traceId, 1_500),
            attributes: { "log.file": "app.log" },
          },
        ],
      ),
    ).toEqual({});
  });
});

/*
 * At ingest, a details record's messages arrive as an OTLP list, which the
 * attribute flattening leaves a structured value and the scrub rules (they
 * mask text) pass over. They are held as their JSON text, as the Log table
 * stores them anyway and as a span holds them.
 */
describe("a details record's messages held as text at ingest", () => {
  test("each structured content value becomes its JSON text, nothing else changes", () => {
    const messages: Array<unknown> = [
      {
        role: "user",
        parts: [{ type: "text", content: "Mail me at ada@example.com" }],
      },
    ];
    const attributes: Record<string, unknown> = {
      "event.name": LlmInferenceDetailsEventName,
      "gen_ai.input.messages": messages,
      "gen_ai.output.messages": [
        { role: "assistant", parts: [{ type: "text", content: "Sent." }] },
      ],
      "gen_ai.system_instructions": [
        { type: "text", content: "You are a mail bot." },
      ],
      "gen_ai.response.finish_reasons": ["stop"],
      "gen_ai.usage.input_tokens": 31,
    };

    expect(LlmLogEventsUtil.holdContentAsText(attributes)).toBe(3);
    expect(attributes["gen_ai.input.messages"]).toBe(JSON.stringify(messages));
    expect(typeof attributes["gen_ai.output.messages"]).toBe("string");
    expect(typeof attributes["gen_ai.system_instructions"]).toBe("string");
    // Only what was said: other structured values stay as they came.
    expect(attributes["gen_ai.response.finish_reasons"]).toEqual(["stop"]);
    expect(attributes["gen_ai.usage.input_tokens"]).toBe(31);
  });

  test("text stays as it came, and a record without them is untouched", () => {
    const text: string = JSON.stringify([{ role: "user", content: "Hi" }]);
    const attributes: Record<string, unknown> = {
      "gen_ai.input.messages": text,
      "gen_ai.output.messages": null,
    };

    expect(LlmLogEventsUtil.holdContentAsText(attributes)).toBe(0);
    expect(attributes).toEqual({
      "gen_ai.input.messages": text,
      "gen_ai.output.messages": null,
    });

    const plain: Record<string, unknown> = { "http.route": "/orders" };

    expect(LlmLogEventsUtil.holdContentAsText(plain)).toBe(0);
    expect(plain).toEqual({ "http.route": "/orders" });
  });

  test("a value JSON cannot write stays as it came", () => {
    const circular: Record<string, unknown> = { role: "user" };
    circular["self"] = circular;
    const attributes: Record<string, unknown> = {
      "gen_ai.input.messages": [circular],
    };

    expect(LlmLogEventsUtil.holdContentAsText(attributes)).toBe(0);
    expect(Array.isArray(attributes["gen_ai.input.messages"])).toBe(true);
  });

  test("held as text, it reads as the same messages", () => {
    const structured: Record<string, unknown> = {
      "event.name": LlmInferenceDetailsEventName,
      "gen_ai.input.messages": [
        {
          role: "user",
          parts: [{ type: "text", content: "What is the weather in Paris?" }],
        },
      ],
      "gen_ai.output.messages": [
        {
          role: "assistant",
          parts: [
            {
              type: "tool_call",
              id: "call_1",
              name: "get_weather",
              arguments: { city: "Paris" },
            },
          ],
          finish_reason: "tool_calls",
        },
      ],
    };
    const held: Record<string, unknown> = JSON.parse(
      JSON.stringify(structured),
    ) as Record<string, unknown>;

    LlmLogEventsUtil.holdContentAsText(held);

    const read: (attributes: Record<string, unknown>) => LlmCallContent = (
      attributes: Record<string, unknown>,
    ): LlmCallContent => {
      return LlmLogEventsUtil.readContent([
        {
          traceId: "0af7651916cd43dd8448eb211c80319c",
          spanId: "b7ad6b7169203331",
          timeUnixNano: "1794198736616355140",
          attributes: attributes,
          body: "",
        },
      ]);
    };

    const content: LlmCallContent = read(held);

    expect(content).toEqual(read(structured));
    expect(content.input[0]!.parts[0]!.text).toBe(
      "What is the weather in Paris?",
    );
    expect(content.output[0]!.parts[0]!.type).toBe(LlmMessagePartType.ToolCall);
  });
});
