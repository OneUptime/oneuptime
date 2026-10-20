/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it. Nothing here touches password hashing.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import LLMCallTelemetry from "Common/Server/Utils/LLM/LLMCallTelemetry";
import LLMProviderHTTPException from "Common/Server/Utils/LLM/LLMProviderHTTPException";
import {
  LLMCompletionResponse,
  LLMMessage,
} from "Common/Server/Utils/LLM/LLMService";
import LlmConversationService from "Common/Server/Services/LlmConversationService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import LlmType from "Common/Types/LLM/LlmType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import LlmConversationTranscriptUtil, {
  LlmConversationCall,
  LlmTranscript,
  LlmTranscriptStep,
  LlmTranscriptStepType,
} from "Common/Utils/Telemetry/LlmConversationTranscript";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ONEUPTIME'S OWN AI CALLS, FROM EXPORT TO TRANSCRIPT.
 *
 * OneUptime sends its own telemetry to a OneUptime project, and its AI /
 * LLM conversation view showed every one of OneUptime AI's answers as "The
 * AI answered. What it said was not recorded.", with two investigations that
 * ran at once merged into one "request". These tests put the attributes
 * AIService.executeWithLogging sets (LLMCallTelemetry) on spans the way the
 * OTLP exporter writes them, run them through the REAL span ingest loop, and
 * read the stored rows back the way the conversation view does
 * (LlmConversationService.toCall, then the transcript).
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "api";
// The one trace the worker's jobs used to share.
const TRACE_ID: string = "6ad603677b80a6aa83711c076a7d3945";
const START_MS: number = Date.UTC(2026, 9, 20, 0, 0, 17, 0);

const MODEL: string = "nvidia/nemotron-3-super-120b-a12b:free";
const FEATURE: string = "AI Incident Investigation";
const SYSTEM: string = "You are OneUptime AI, investigating an incident.";
const QUESTION: string = "Investigate incident #42: checkout returns 500s.";
const TOOL_RESULT: string = "3 errors: connection refused to payments-db";
const ANSWER: string =
  "Checkout fails because payments-db refuses connections.";

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type OtlpValue =
  | { stringValue: string }
  | { intValue: number }
  | { doubleValue: number }
  | { boolValue: boolean }
  | { arrayValue: { values: Array<OtlpValue> } };

type OtlpAttribute = { key: string; value: OtlpValue };

// A span attribute as the OTLP exporter writes it.
function otlpValue(value: unknown): OtlpValue {
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item: unknown) => {
          return otlpValue(item);
        }),
      },
    };
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: value }
      : { doubleValue: value };
  }

  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  return { stringValue: String(value) };
}

function otlpAttributes(
  attributes: Record<string, unknown>,
): Array<OtlpAttribute> {
  return Object.entries(attributes).map(([key, value]: [string, unknown]) => {
    return { key: key, value: otlpValue(value) };
  });
}

interface ExportedCall {
  spanId: string;
  startMs: number;
  endMs: number;
  attributes: Record<string, unknown>;
  // Span status: 0 unset, 1 ok, 2 error.
  statusCode?: number;
}

function request(calls: Array<ExportedCall>): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: SERVICE_NAME } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "default" },
              spans: calls.map((call: ExportedCall) => {
                return {
                  traceId: TRACE_ID,
                  spanId: call.spanId,
                  parentSpanId: "",
                  name: "Service.executeWithLogging",
                  kind: 1,
                  startTimeUnixNano: `${call.startMs}000000`,
                  endTimeUnixNano: `${call.endMs}000000`,
                  status: { code: call.statusCode ?? 1, message: "" },
                  attributes: otlpAttributes(call.attributes),
                  events: [],
                  links: [],
                };
              }),
            },
          ],
        },
      ],
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

// What AIService.executeWithLogging puts on the span of one AI call.
function aiCall(data: {
  messages: Array<LLMMessage>;
  response: Pick<LLMCompletionResponse, "content" | "toolCalls" | "stopReason">;
  conversationId: string;
  recordContent: boolean;
}): Record<string, unknown> {
  return {
    ...LLMCallTelemetry.getRequestAttributes({
      llmType: LlmType.OpenAI,
      modelName: MODEL,
      feature: FEATURE,
      conversationId: data.conversationId,
      maxTokens: 4096,
      temperature: 0.2,
      messages: data.messages,
      recordContent: data.recordContent,
    }),
    ...LLMCallTelemetry.getResponseAttributes({
      modelName: MODEL,
      response: data.response,
      usage: { promptTokens: 17044, completionTokens: 389, totalTokens: 17433 },
      recordContent: data.recordContent,
    }),
  };
}

// An investigation's agent loop: a call that asks for a tool, then one that answers.
function investigation(data: {
  runId: string;
  startMs: number;
  spanIdPrefix: string;
  recordContent: boolean;
}): Array<ExportedCall> {
  const firstMessages: Array<LLMMessage> = [
    { role: "system", content: SYSTEM },
    { role: "user", content: QUESTION },
  ];
  const toolCall: LLMCompletionResponse["toolCalls"] = [
    { id: "call_1", name: "query_logs", arguments: { service: "checkout" } },
  ];

  return [
    {
      spanId: `${data.spanIdPrefix}00000001`,
      startMs: data.startMs,
      endMs: data.startMs + 19_000,
      attributes: aiCall({
        messages: firstMessages,
        response: { content: "", toolCalls: toolCall, stopReason: "tool_use" },
        conversationId: data.runId,
        recordContent: data.recordContent,
      }),
    },
    {
      spanId: `${data.spanIdPrefix}00000002`,
      startMs: data.startMs + 19_100,
      endMs: data.startMs + 30_000,
      attributes: aiCall({
        messages: [
          ...firstMessages,
          { role: "assistant", content: "", toolCalls: toolCall },
          { role: "tool", toolCallId: "call_1", content: TOOL_RESULT },
        ],
        response: { content: ANSWER, stopReason: "stop" },
        conversationId: data.runId,
        recordContent: data.recordContent,
      }),
    },
  ];
}

function setup(): Array<JSONObject> {
  const capturedRows: Array<JSONObject> = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelTracesIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of AUTO_DISCOVERY_MOCKS_RETURNING_NULL) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  jest.spyOn(service, "resolveTelemetryResource").mockResolvedValue({
    serviceName: SERVICE_NAME,
    primaryEntityId: SERVICE_ID,
    primaryEntityType: ServiceType.OpenTelemetry,
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  });

  jest
    .spyOn(service, "submitSpansBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      capturedRows.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });
  jest
    .spyOn(service, "submitExceptionsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      rows.splice(0, rows.length);
      return Promise.resolve();
    });

  jest.spyOn(TraceDropFilterService, "loadDropFilters").mockResolvedValue([]);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);

  return capturedRows;
}

function transcriptOf(rows: Array<JSONObject>): LlmTranscript {
  return LlmConversationTranscriptUtil.build(
    rows.map((row: JSONObject): LlmConversationCall => {
      return LlmConversationService.toCall(row);
    }),
  );
}

function stepSummary(transcript: LlmTranscript): Array<string> {
  return transcript.steps.map((step: LlmTranscriptStep): string => {
    switch (step.type) {
      case LlmTranscriptStepType.ToolCall:
        return `tool_call:${step.toolName}`;
      default:
        return `${step.type}:${step.text}`;
    }
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("OneUptime AI's own calls, stored and read back", () => {
  test("with prompts recorded, every step of the investigation reads back, none of them 'not recorded'", async () => {
    const rows: Array<JSONObject> = setup();
    const runId: string = ObjectID.generate().toString();

    await OtelTracesIngestService.processTracesFromQueue(
      request(
        investigation({
          runId: runId,
          startMs: START_MS,
          spanIdPrefix: "aaaaaaaa",
          recordContent: true,
        }),
      ),
    );

    expect(rows).toHaveLength(2);

    for (const row of rows) {
      expect(row["isLlmSpan"]).toBe(true);
      expect(row["llmCallKind"]).toBe("answer");
      expect(row["llmConversationId"]).toBe(runId);
      expect(row["llmAgentName"]).toBe(FEATURE);
      expect(row["llmRequestModel"]).toBe(MODEL);
      expect(row["llmIssues"]).toEqual([]);
      // What the conversation list shows and searches.
      expect(row["llmUserMessagePreview"]).toBe(QUESTION);
    }

    const transcript: LlmTranscript = transcriptOf(rows);

    expect(transcript.instructions).toBe(SYSTEM);
    expect(transcript.title).toBe(QUESTION);
    expect(stepSummary(transcript)).toEqual([
      `user:${QUESTION}`,
      "tool_call:query_logs",
      `tool_result:${TOOL_RESULT}`,
      `assistant:${ANSWER}`,
    ]);
  });

  test("without recording, the calls still carry their run and feature, and say nothing", async () => {
    const rows: Array<JSONObject> = setup();
    const runId: string = ObjectID.generate().toString();

    await OtelTracesIngestService.processTracesFromQueue(
      request(
        investigation({
          runId: runId,
          startMs: START_MS,
          spanIdPrefix: "bbbbbbbb",
          recordContent: false,
        }),
      ),
    );

    for (const row of rows) {
      expect(row["llmConversationId"]).toBe(runId);
      expect(row["llmAgentName"]).toBe(FEATURE);
      expect(row["llmUserMessagePreview"]).toBe("");
      expect(JSON.stringify(row)).not.toContain(QUESTION);
    }

    expect(
      transcriptOf(rows).steps.map((step: LlmTranscriptStep) => {
        return step.type;
      }),
    ).toEqual([
      LlmTranscriptStepType.SilentAnswer,
      LlmTranscriptStepType.SilentAnswer,
    ]);
  });

  test("two investigations in one trace are two conversations, not one interleaved request", async () => {
    const rows: Array<JSONObject> = setup();
    const firstRun: string = ObjectID.generate().toString();
    const secondRun: string = ObjectID.generate().toString();

    // Started 60 ms apart, their calls overlapping, in the same trace.
    await OtelTracesIngestService.processTracesFromQueue(
      request([
        ...investigation({
          runId: firstRun,
          startMs: START_MS,
          spanIdPrefix: "cccccccc",
          recordContent: true,
        }),
        ...investigation({
          runId: secondRun,
          startMs: START_MS + 60,
          spanIdPrefix: "dddddddd",
          recordContent: true,
        }),
      ]),
    );

    expect(rows).toHaveLength(4);

    const byConversation: Map<string, Array<JSONObject>> = new Map<
      string,
      Array<JSONObject>
    >();

    for (const row of rows) {
      const key: string = row["llmConversationId"] as string;
      byConversation.set(key, [...(byConversation.get(key) || []), row]);
    }

    expect(Array.from(byConversation.keys()).sort()).toEqual(
      [firstRun, secondRun].sort(),
    );

    for (const conversationRows of byConversation.values()) {
      expect(stepSummary(transcriptOf(conversationRows))).toEqual([
        `user:${QUESTION}`,
        "tool_call:query_logs",
        `tool_result:${TOOL_RESULT}`,
        `assistant:${ANSWER}`,
      ]);
    }
  });

  test("a call the provider refused is stored failed, though its span status was left alone", async () => {
    const rows: Array<JSONObject> = setup();

    await OtelTracesIngestService.processTracesFromQueue(
      request([
        {
          spanId: "eeeeeeee00000001",
          startMs: START_MS,
          endMs: START_MS + 900,
          /*
           * A refused request is a configuration error, not a bug: the
           * span is not marked Error.
           */
          statusCode: 0,
          attributes: {
            ...LLMCallTelemetry.getRequestAttributes({
              llmType: LlmType.OpenAI,
              modelName: MODEL,
              feature: FEATURE,
              conversationId: ObjectID.generate().toString(),
              messages: [{ role: "user", content: QUESTION }],
              recordContent: true,
            }),
            ...LLMCallTelemetry.getFailureAttributes(
              new LLMProviderHTTPException({
                message: "OpenAI API error: rate limited",
                statusCode: 429,
                llmType: LlmType.OpenAI,
                providerMessage: "rate limited",
              }),
            ),
          },
        },
      ]),
    );

    expect(rows[0]!["isLlmSpan"]).toBe(true);
    expect(rows[0]!["llmIssues"]).toEqual(["failed"]);
    expect(
      transcriptOf(rows).steps.map((step: LlmTranscriptStep) => {
        return step.type;
      }),
    ).toEqual([
      LlmTranscriptStepType.UserMessage,
      LlmTranscriptStepType.Failure,
    ]);
  });

  test("an answer cut off at the token limit is stored cut off", async () => {
    const rows: Array<JSONObject> = setup();

    await OtelTracesIngestService.processTracesFromQueue(
      request([
        {
          spanId: "ffffffff00000001",
          startMs: START_MS,
          endMs: START_MS + 61_000,
          attributes: aiCall({
            messages: [{ role: "user", content: QUESTION }],
            response: { content: "Checkout fails be", stopReason: "length" },
            conversationId: ObjectID.generate().toString(),
            recordContent: true,
          }),
        },
      ]),
    );

    expect(rows[0]!["llmIssues"]).toEqual(["cut_off"]);
  });
});
