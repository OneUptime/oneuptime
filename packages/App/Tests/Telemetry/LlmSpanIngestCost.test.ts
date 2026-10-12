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
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { LlmModelPrice } from "Common/Types/Telemetry/LlmCostCatalog";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * AI spend through the REAL span ingest loop: what a stored AI call row
 * carries in llmInputTokens, llmOutputTokens, llmTotalTokens and llmCost -
 * the columns the Usage tab adds up and the daily budgets charge.
 *
 *  - A Claude Code traces beta span (claude_code.llm_request) is stored
 *    with its tokens and a cost, not 0 and $0.
 *  - Claude Opus 4.5 and later are charged their own rate, not Opus 4's.
 *  - A project's own price still wins.
 *
 * The cost is computed once, as the span arrives: a stored row keeps the
 * cost it was stored with.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "claude-code";

const START_MS: number = Date.UTC(2026, 9, 12, 9, 0, 0, 0);

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

/*
 * A claude_code.llm_request span's attributes as Claude Code exports them
 * (code.claude.com/docs/en/monitoring-usage): the usage block under bare
 * keys, the model under gen_ai.system / gen_ai.request.model, and no
 * gen_ai.usage.* key at all.
 */
function claudeCodeLlmRequest(
  model: string,
  extra: Array<OtlpAttribute> = [],
): Array<OtlpAttribute> {
  return [
    str("span.type", "llm_request"),
    str("session.id", "7d3f2a1c-claude-code-session"),
    str("user.email", "jdoe@example.com"),
    str("model", model),
    str("gen_ai.system", "anthropic"),
    str("gen_ai.request.model", model),
    str("speed", "normal"),
    int("input_tokens", 12),
    int("output_tokens", 640),
    int("cache_read_tokens", 48_000),
    int("cache_creation_tokens", 2_100),
    str("gen_ai.response.id", "req_011CVzexample"),
    str("stop_reason", "tool_use"),
    strings("gen_ai.response.finish_reasons", ["tool_use"]),
    ...extra,
  ];
}

function request(data: {
  name: string;
  attributes: Array<OtlpAttribute>;
}): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              str("service.name", SERVICE_NAME),
              str("team.id", "platform"),
            ],
          },
          scopeSpans: [
            {
              scope: { name: "com.anthropic.claude_code", version: "2.1.280" },
              spans: [
                {
                  traceId: "5b8efff798038103d269b633813fc60c",
                  spanId: "eee19b7ec3c1b174",
                  parentSpanId: "",
                  name: data.name,
                  kind: 3,
                  startTimeUnixNano: `${START_MS}000000`,
                  endTimeUnixNano: `${START_MS + 8400}000000`,
                  status: { code: 0, message: "" },
                  attributes: data.attributes,
                  events: [],
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

function setup(data?: {
  modelPrices?: Array<LlmModelPrice>;
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
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    .mockResolvedValue(data?.modelPrices || []);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);

  return capturedRows;
}

async function ingestOne(data: {
  name: string;
  attributes: Array<OtlpAttribute>;
  modelPrices?: Array<LlmModelPrice>;
}): Promise<JSONObject> {
  const rows: Array<JSONObject> = setup({ modelPrices: data.modelPrices });

  await OtelTracesIngestService.processTracesFromQueue(
    request({ name: data.name, attributes: data.attributes }),
  );

  expect(rows).toHaveLength(1);

  return rows[0] as JSONObject;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a Claude Code traces beta span is stored with its tokens and its cost", () => {
  test("Claude Opus 4.8: 50,112 input tokens (48,000 of them cache reads), $0.053185", async () => {
    const row: JSONObject = await ingestOne({
      name: "claude_code.llm_request",
      attributes: claudeCodeLlmRequest("claude-opus-4-8"),
    });

    expect(row["isLlmSpan"]).toBe(true);
    expect(row["llmSystem"]).toBe("anthropic");
    expect(row["llmRequestModel"]).toBe("claude-opus-4-8");
    expect(row["llmInputTokens"]).toBe(50_112);
    expect(row["llmOutputTokens"]).toBe(640);
    expect(row["llmTotalTokens"]).toBe(50_752);
    /*
     * 12 x $5 + 48,000 x $0.50 + 2,100 x $6.25 + 640 x $25, per million:
     * the uncached input, the cache reads and writes, and the output.
     */
    expect(row["llmCost"]).toBe(0.053185);
  });

  test("the employee and the team are the call's, as on any AI call", async () => {
    const row: JSONObject = await ingestOne({
      name: "claude_code.llm_request",
      attributes: claudeCodeLlmRequest("claude-opus-4-8"),
    });

    expect(row["llmUserEmail"]).toBe("jdoe@example.com");
    expect(row["llmTeam"]).toBe("platform");
  });

  test("on Amazon Bedrock, through a cross-region inference profile", async () => {
    const row: JSONObject = await ingestOne({
      name: "claude_code.llm_request",
      attributes: claudeCodeLlmRequest(
        "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
      ),
    });

    // 12 x $3 + 48,000 x $0.30 + 2,100 x $3.75 + 640 x $15, per million.
    expect(row["llmCost"]).toBe(0.031911);
  });

  test("a project's own price wins, charged for every input token", async () => {
    const row: JSONObject = await ingestOne({
      name: "claude_code.llm_request",
      attributes: claudeCodeLlmRequest("claude-opus-4-8"),
      modelPrices: [
        {
          modelPrefix: "claude-opus-4-8",
          inputPricePerMillionTokensInUSD: 4,
          outputPricePerMillionTokensInUSD: 20,
        },
      ],
    });

    // 50,112 x $4 + 640 x $20, per million.
    expect(row["llmCost"]).toBe(0.213248);
  });

  test("a model nobody has priced yet keeps its tokens at a cost of 0", async () => {
    const row: JSONObject = await ingestOne({
      name: "claude_code.llm_request",
      attributes: claudeCodeLlmRequest("claude-opus-4-9"),
    });

    expect(row["llmInputTokens"]).toBe(50_112);
    expect(row["llmCost"]).toBe(0);
  });
});

describe("current Claude models are charged their own rate", () => {
  function conventionsCall(model: string): Array<OtlpAttribute> {
    return [
      str("gen_ai.operation.name", "chat"),
      str("gen_ai.system", "anthropic"),
      str("gen_ai.request.model", model),
      int("gen_ai.usage.input_tokens", 1_000_000),
      int("gen_ai.usage.output_tokens", 1_000_000),
    ];
  }

  test.each([
    ["claude-opus-4-5-20251101", 30],
    ["claude-opus-4-6", 30],
    ["claude-opus-4-7", 30],
    ["claude-opus-4-8", 30],
    ["anthropic/claude-opus-4.5", 30],
    ["claude-opus-4-20250514", 90],
    ["claude-fable-5-1", 60],
    ["claude-opus-5-5", 24],
    ["claude-sonnet-5-5", 12],
    ["claude-haiku-4-5-20251001", 6],
  ])(
    "a million input and a million output tokens on %p cost $%p",
    async (model: string, cost: number) => {
      const row: JSONObject = await ingestOne({
        name: `chat ${model}`,
        attributes: conventionsCall(model),
      });

      expect(row["llmCost"]).toBe(cost);
    },
  );

  test("a span that reports gen_ai.usage.* keeps its own counts", async () => {
    const row: JSONObject = await ingestOne({
      name: "chat claude-sonnet-4-6",
      attributes: [
        str("gen_ai.system", "anthropic"),
        str("gen_ai.request.model", "claude-sonnet-4-6"),
        int("gen_ai.usage.input_tokens", 1_200),
        int("gen_ai.usage.output_tokens", 350),
      ],
    });

    expect([
      row["llmInputTokens"],
      row["llmOutputTokens"],
      row["llmTotalTokens"],
    ]).toEqual([1_200, 350, 1_550]);
    // 1,200 x $3 + 350 x $15, per million.
    expect(row["llmCost"]).toBe(0.00885);
  });

  test("a reported cost is stored as reported", async () => {
    const row: JSONObject = await ingestOne({
      name: "chat claude-opus-4-8",
      attributes: [
        ...conventionsCall("claude-opus-4-8"),
        { key: "gen_ai.usage.cost", value: { doubleValue: 12.5 } },
      ],
    });

    expect(row["llmCost"]).toBe(12.5);
  });
});
