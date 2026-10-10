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
import TraceScrubRule from "Common/Models/DatabaseModels/TraceScrubRule";
import TraceScrubAction from "Common/Types/Trace/TraceScrubAction";
import TraceScrubField from "Common/Types/Trace/TraceScrubField";
import TraceScrubPatternType from "Common/Types/Trace/TraceScrubPatternType";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The AI call columns through the REAL span ingest loop: the call kind and
 * the answer issues on the stored row, the issues following a status a
 * pipeline remapped, and the person's message preview carrying the scrub
 * rules' redactions - the preview is content, so it must never be the one
 * column that skipped a project's privacy rules.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "support-bot";

const START_MS: number = Date.UTC(2026, 9, 10, 9, 0, 0, 0);

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
  | { arrayValue: { values: Array<{ stringValue: string }> } };

type OtlpAttribute = { key: string; value: OtlpValue };

function str(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function int(key: string, value: number): OtlpAttribute {
  return { key: key, value: { intValue: value } };
}

function strings(key: string, values: Array<string>): OtlpAttribute {
  return {
    key: key,
    value: {
      arrayValue: {
        values: values.map((value: string) => {
          return { stringValue: value };
        }),
      },
    },
  };
}

function chatAttributes(extra: Array<OtlpAttribute> = []): Array<OtlpAttribute> {
  return [
    str("gen_ai.operation.name", "chat"),
    str("gen_ai.system", "openai"),
    str("gen_ai.request.model", "gpt-4o"),
    int("gen_ai.usage.input_tokens", 20),
    int("gen_ai.usage.output_tokens", 15),
    ...extra,
  ];
}

function request(data: {
  attributes: Array<OtlpAttribute>;
  statusCode?: number;
  events?: Array<JSONObject>;
}): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceSpans: [
        {
          resource: {
            attributes: [str("service.name", SERVICE_NAME)],
          },
          scopeSpans: [
            {
              scope: { name: "openai-instrumentation", version: "1.0.0" },
              spans: [
                {
                  traceId: "0af7651916cd43dd8448eb211c80319c",
                  spanId: "b7ad6b7169203331",
                  parentSpanId: "",
                  name: "chat gpt-4o",
                  kind: 3,
                  startTimeUnixNano: `${START_MS}000000`,
                  endTimeUnixNano: `${START_MS + 2500}000000`,
                  status: { code: data.statusCode ?? 1, message: "" },
                  attributes: data.attributes,
                  events: data.events || [],
                  links: [],
                },
              ],
            },
          ],
        },
      ],
    },
    headers: {},
  } as unknown as TelemetryRequest;
}

type CompiledRule = { rule: TraceScrubRule; regex: RegExp };

function emailRule(): Array<CompiledRule> {
  const rule: TraceScrubRule = new TraceScrubRule();
  rule.name = "redact emails";
  rule.patternType = TraceScrubPatternType.Email;
  rule.fieldsToScrub = TraceScrubField.Attributes;
  rule.scrubAction = TraceScrubAction.Redact;

  const regex: RegExp | null = (
    TraceScrubRuleService as unknown as {
      getRegexForPattern: (patternType: string) => RegExp | null;
    }
  ).getRegexForPattern(TraceScrubPatternType.Email as string);

  return [{ rule: rule, regex: regex as RegExp }];
}

function setup(data?: {
  scrubRules?: Array<CompiledRule>;
  remapStatusTo?: number;
}): Array<JSONObject> {
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
    .mockResolvedValue((data?.scrubRules || []) as any);

  if (data?.remapStatusTo !== undefined) {
    const remapTo: number = data.remapStatusTo;
    jest
      .spyOn(TracePipelineService, "loadPipelines")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TracePipelineService, "processSpan")
      .mockImplementation((row: JSONObject): JSONObject => {
        // What a StatusRemapper processor does to the row.
        return { ...row, statusCode: remapTo };
      });
  } else {
    jest
      .spyOn(TracePipelineService, "loadPipelines")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([] as any);
  }

  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);

  return capturedRows;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the AI call columns on a stored span", () => {
  test("a good answer: kind answer, no issues, the person's question as the preview", async () => {
    const rows: Array<JSONObject> = setup();

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        attributes: chatAttributes([
          str(
            "gen_ai.input.messages",
            JSON.stringify([
              { role: "system", content: "You are a support bot." },
              { role: "user", content: "Where is my   order?" },
            ]),
          ),
          str(
            "gen_ai.output.messages",
            JSON.stringify([
              {
                role: "assistant",
                parts: [{ type: "text", content: "It ships tomorrow." }],
              },
            ]),
          ),
          strings("gen_ai.response.finish_reasons", ["stop"]),
        ]),
      }),
    );

    expect(rows).toHaveLength(1);
    const row: JSONObject = rows[0]!;

    expect(row["isLlmSpan"]).toBe(true);
    expect(row["llmCallKind"]).toBe("answer");
    expect(row["llmIssues"]).toEqual([]);
    expect(row["llmUserMessagePreview"]).toBe("Where is my order?");
  });

  test("a refused answer and a failed call are stored as such", async () => {
    const rows: Array<JSONObject> = setup();

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        attributes: chatAttributes([
          strings("gen_ai.response.finish_reasons", ["content_filter"]),
        ]),
      }),
    );
    await OtelTracesIngestService.processTracesFromQueue(
      request({ attributes: chatAttributes(), statusCode: 2 }),
    );

    expect(rows.map((row: JSONObject) => {
      return row["llmIssues"];
    })).toEqual([["refused"], ["failed"]]);
  });

  test("an evaluation event on the span flags the answer", async () => {
    const rows: Array<JSONObject> = setup();

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        attributes: chatAttributes(),
        events: [
          {
            timeUnixNano: `${START_MS + 2400}000000`,
            name: "gen_ai.evaluation.result",
            attributes: [
              str("gen_ai.evaluation.name", "user_feedback"),
              str("gen_ai.evaluation.score.label", "thumbs_down"),
            ],
          },
        ],
      }),
    );

    expect(rows[0]!["llmIssues"]).toEqual(["flagged"]);
  });

  test("a span that is not an AI call gets no preview and no issues", async () => {
    const rows: Array<JSONObject> = setup();

    await OtelTracesIngestService.processTracesFromQueue(
      request({ attributes: [str("http.method", "GET")], statusCode: 2 }),
    );

    expect(rows[0]!["isLlmSpan"]).toBe(false);
    expect(rows[0]!["llmIssues"]).toEqual([]);
    expect(rows[0]!["llmCallKind"]).toBe("");
    expect(rows[0]).not.toHaveProperty("llmUserMessagePreview");
  });
});

describe("the preview is read AFTER the scrub rules", () => {
  test("an email in the question is redacted in the preview exactly as in the prompt", async () => {
    const rows: Array<JSONObject> = setup({ scrubRules: emailRule() });

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        attributes: chatAttributes([
          str(
            "gen_ai.input.messages",
            JSON.stringify([
              { role: "user", content: "Please email ada@example.com the invoice" },
            ]),
          ),
        ]),
      }),
    );

    const row: JSONObject = rows[0]!;
    const preview: string = row["llmUserMessagePreview"] as string;

    expect(preview).toContain("[REDACTED]");
    expect(JSON.stringify(row)).not.toContain("ada@example.com");
  });
});

describe("the answer issues follow the status the span is stored with", () => {
  test("a pipeline that remaps Error to Ok clears 'failed'", async () => {
    const rows: Array<JSONObject> = setup({ remapStatusTo: 1 });

    await OtelTracesIngestService.processTracesFromQueue(
      request({ attributes: chatAttributes(), statusCode: 2 }),
    );

    expect(rows[0]!["statusCode"]).toBe(1);
    expect(rows[0]!["llmIssues"]).toEqual([]);
  });

  test("a pipeline that remaps to Error marks the call failed", async () => {
    const rows: Array<JSONObject> = setup({ remapStatusTo: 2 });

    await OtelTracesIngestService.processTracesFromQueue(
      request({ attributes: chatAttributes(), statusCode: 1 }),
    );

    expect(rows[0]!["llmIssues"]).toEqual(["failed"]);
  });

  test("a call that failed on its own account stays failed through a remap", async () => {
    const rows: Array<JSONObject> = setup({ remapStatusTo: 1 });

    await OtelTracesIngestService.processTracesFromQueue(
      request({
        attributes: chatAttributes([str("error.type", "timeout")]),
        statusCode: 2,
      }),
    );

    expect(rows[0]!["llmIssues"]).toEqual(["failed"]);
  });
});
