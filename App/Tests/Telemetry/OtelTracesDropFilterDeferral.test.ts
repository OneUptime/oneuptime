/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it — including all full-loop telemetry suites. Nothing in
 * this suite touches password hashing; stub the module before the service
 * import graph drags it into compilation.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService, {
  LoadedTraceDropFilter,
} from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import TraceDropFilterAction from "Common/Types/Trace/TraceDropFilterAction";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONObject } from "Common/Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The span hot loop was restructured so the drop filter evaluates a row
 * that omits ONLY the three ingest-generated stamps (_id, createdAt,
 * retentionDate); finalizeSpanRow adds those after the keep/drop decision,
 * so a dropped span never pays for ObjectID generation, the ingestion
 * stamp or retention resolution. Everything else — names, ids, timings,
 * status, attributes, events, links, LLM fields — is present at
 * evaluation time exactly as before.
 *
 * Separately, the per-span attribute map is now assembled with a single
 * ordered Object.assign over (resource attrs, span attrs, once-per-scope
 * prefixed scope attrs), which must preserve the historical collision
 * precedence and key insertion order.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "traces-deferral-test";

const TRACE_ID_HEX: string = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID_HEX: string = "b7ad6b7169203331";

const START_MS: number = Date.UTC(2026, 7, 10, 10, 0, 0, 0);
const END_MS: number = START_MS + 1500;
const START_NANO: string = `${START_MS}000000`;
const END_NANO: string = `${END_MS}000000`;
const DURATION_NANO: string = `${1500 * 1_000_000}`;

/*
 * The exact field order of a completed span row. The evaluation-row +
 * stamp-spread reconstruction must keep this byte-identical to the
 * pre-restructure one-shot literal.
 */
const EXPECTED_SPAN_ROW_KEY_ORDER: Array<string> = [
  "_id",
  "createdAt",
  "projectId",
  "primaryEntityId",
  "primaryEntityType",
  "entityKeys",
  "serviceEntityKey",
  "hostEntityKey",
  "k8sPodEntityKey",
  "k8sNodeEntityKey",
  "k8sClusterEntityKey",
  "containerEntityKey",
  "startTime",
  "endTime",
  "startTimeUnixNano",
  "endTimeUnixNano",
  "durationUnixNano",
  "traceId",
  "spanId",
  "sessionId",
  "parentSpanId",
  "traceState",
  "attributes",
  "attributeKeys",
  "statusCode",
  "statusMessage",
  "name",
  "kind",
  "events",
  "links",
  "hasException",
  "isRootSpan",
  "isLlmSpan",
  "llmSystem",
  "llmOperation",
  "llmRequestModel",
  "llmResponseModel",
  "llmAgentName",
  "llmToolName",
  "llmInputTokens",
  "llmOutputTokens",
  "llmTotalTokens",
  "llmCost",
  "llmConversationId",
  "retentionDate",
];

const AUTO_DISCOVERY_MOCKS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
];

type OtlpAttribute = { key: string; value: { stringValue: string } };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

function dropFilter(filterQuery: string): LoadedTraceDropFilter {
  /*
   * No id on the model on purpose: recordDrop() short-circuits without one,
   * keeping the drop-recorder (and its Redis surface) out of this suite.
   */
  const filter: TraceDropFilter = new TraceDropFilter();
  filter.action = TraceDropFilterAction.Drop;

  return {
    filter: filter,
    compiledFilter: compileFilter(filterQuery, { emptyQueryMatches: false }),
    projectId: PROJECT_ID,
  };
}

type SpanInput = {
  name?: string;
  attributes?: Array<OtlpAttribute>;
};

function tracesRequest(data: {
  spans: Array<SpanInput>;
  resourceAttributes?: Array<OtlpAttribute>;
  scope?: JSONObject;
}): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: {
      resourceSpans: [
        {
          resource: {
            attributes: [
              stringAttribute("service.name", SERVICE_NAME),
              ...(data.resourceAttributes || []),
            ],
          },
          scopeSpans: [
            {
              scope: data.scope ?? { name: "otel-lib", version: "7.7.7" },
              spans: data.spans.map((span: SpanInput) => {
                return {
                  traceId: TRACE_ID_HEX,
                  spanId: SPAN_ID_HEX,
                  parentSpanId: "",
                  name: span.name ?? "GET /checkout",
                  kind: 2,
                  startTimeUnixNano: START_NANO,
                  endTimeUnixNano: END_NANO,
                  status: { code: 2, message: "boom" },
                  attributes: span.attributes ?? [],
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

function setupIngestMocks(
  dropFilters: Array<LoadedTraceDropFilter>,
): Array<JSONObject> {
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
      // Drain like the real fan-in submit path (it splices the shared buffer).
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

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    .mockResolvedValue(dropFilters);
  jest
    .spyOn(TraceScrubRuleService, "loadScrubRules")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(TracePipelineService, "loadPipelines")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  /*
   * Ingest loads project LLM price overrides alongside the drop/scrub/pipeline
   * rules in the same Promise.all. Without this mock the real loader hits the
   * database, the Promise.all rejects, and the catch resets EVERY rule set
   * (drop filters included) to empty — silently disabling the drop filters
   * this suite is asserting on.
   */
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

describe("span row golden equivalence (kept rows)", () => {
  test("a kept row carries the historical field order, stamps, values and ids", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([]);

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          {
            attributes: [stringAttribute("http.method", "GET")],
          },
        ],
        resourceAttributes: [stringAttribute("session.id", "sess-1")],
      }),
    );

    expect(rows).toHaveLength(1);
    const row: JSONObject = rows[0]!;

    expect(Object.keys(row)).toEqual(EXPECTED_SPAN_ROW_KEY_ORDER);

    // Generated stamps: shape only, they are ingest-time values.
    expect(typeof row["_id"]).toBe("string");
    expect((row["_id"] as string).length).toBeGreaterThan(0);
    expect(typeof row["createdAt"]).toBe("string");
    expect(typeof row["retentionDate"]).toBe("string");

    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(row["primaryEntityId"]).toBe(SERVICE_ID.toString());
    expect(row["primaryEntityType"]).toBe(ServiceType.OpenTelemetry);
    expect(row["entityKeys"]).toEqual([]);
    expect(row["serviceEntityKey"]).toBe("");

    expect(row["startTime"]).toBe(
      OneUptimeDate.toClickhouseDateTime(new Date(START_MS)),
    );
    expect(row["endTime"]).toBe(
      OneUptimeDate.toClickhouseDateTime(new Date(END_MS)),
    );
    expect(row["startTimeUnixNano"]).toBe(START_NANO);
    expect(row["endTimeUnixNano"]).toBe(END_NANO);
    expect(row["durationUnixNano"]).toBe(DURATION_NANO);
    expect(row["traceId"]).toBe(TRACE_ID_HEX);
    expect(row["spanId"]).toBe(SPAN_ID_HEX);
    // Resource-level session.id arrives prefixed and still resolves.
    expect(row["sessionId"]).toBe("sess-1");
    expect(row["parentSpanId"]).toBe("");
    expect(row["traceState"]).toBe("");
    expect(row["statusCode"]).toBe(2);
    expect(row["statusMessage"]).toBe("boom");
    expect(row["name"]).toBe("GET /checkout");
    expect(row["kind"]).toBe(SpanKind.Server);
    expect(row["events"]).toEqual([]);
    expect(row["links"]).toEqual([]);
    expect(row["hasException"]).toBe(false);
    expect(row["isRootSpan"]).toBe(true);
    expect(row["isLlmSpan"]).toBe(false);

    const attributes: JSONObject = row["attributes"] as JSONObject;
    expect(attributes["http.method"]).toBe("GET");
    expect(attributes["resource.service.name"]).toBe(SERVICE_NAME);
    expect(attributes["oneuptime.service.id"]).toBe(SERVICE_ID.toString());
  });

  test("attribute precedence: resource < span attributes < scope.*, with unchanged key order", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([]);

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          {
            attributes: [
              stringAttribute("resource.collide", "from-span"),
              stringAttribute("scope.name", "span-tries-to-be-scope"),
            ],
          },
        ],
        resourceAttributes: [stringAttribute("collide", "from-resource")],
        scope: { name: "otel-lib", version: "7.7.7" },
      }),
    );

    expect(rows).toHaveLength(1);
    const attributes: JSONObject = rows[0]!["attributes"] as JSONObject;

    // Span attribute beats the (prefixed) resource attribute on collision.
    expect(attributes["resource.collide"]).toBe("from-span");
    // The scope envelope beats a span attribute that spoofs its key.
    expect(attributes["scope.name"]).toBe("otel-lib");
    expect(attributes["scope.version"]).toBe("7.7.7");

    /*
     * attributeKeys for spans is deliberately UNSORTED (PR #3113): it must
     * be exactly the map's own key order — resource keys first, then new
     * span keys, then new scope keys.
     */
    expect(rows[0]!["attributeKeys"]).toEqual(Object.keys(attributes));
  });

  test("spans in one scope own independent attribute maps", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([]);

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          {
            name: "span-one",
            attributes: [stringAttribute("span.index", "one")],
          },
          {
            name: "span-two",
            attributes: [stringAttribute("span.index", "two")],
          },
        ],
      }),
    );

    expect(rows).toHaveLength(2);
    const first: JSONObject = rows[0]!;
    const second: JSONObject = rows[1]!;

    expect(first["attributes"]).not.toBe(second["attributes"]);
    expect(first["attributeKeys"]).not.toBe(second["attributeKeys"]);

    (first["attributes"] as JSONObject)["mutated.key"] = "mutated";
    expect((second["attributes"] as JSONObject)["mutated.key"]).toBeUndefined();

    expect((first["attributes"] as JSONObject)["span.index"]).toBe("one");
    expect((second["attributes"] as JSONObject)["span.index"]).toBe("two");
    // Both still share the scope stamp the once-per-scope hoist provides.
    expect((first["attributes"] as JSONObject)["scope.name"]).toBe("otel-lib");
    expect((second["attributes"] as JSONObject)["scope.name"]).toBe("otel-lib");
  });
});

describe("drop filter behavior on the evaluation row", () => {
  test("a name drop filter still drops matching spans", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([
      dropFilter("name = 'GET /health'"),
    ]);

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [{ name: "GET /health" }, { name: "GET /checkout" }],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!["name"]).toBe("GET /checkout");
  });

  test("filters on attributes see their values at evaluation time", async () => {
    const rows: Array<JSONObject> = setupIngestMocks([
      dropFilter("http.method = 'OPTIONS'"),
    ]);

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          {
            name: "preflight",
            attributes: [stringAttribute("http.method", "OPTIONS")],
          },
          {
            name: "real",
            attributes: [stringAttribute("http.method", "POST")],
          },
        ],
      }),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!["name"]).toBe("real");
  });
});

describe("deferral proof: dropped spans skip the ingest-generated stamps", () => {
  test("all spans dropped: ObjectID generation never runs", async () => {
    setupIngestMocks([dropFilter("name LIKE 'GET %'")]);

    const generateSpy: jest.SpyInstance = jest.spyOn(
      ObjectID,
      "generateTimeOrdered",
    );

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [{ name: "GET /health" }, { name: "GET /metrics" }],
      }),
    );

    expect(generateSpy).not.toHaveBeenCalled();
  });

  test("mixed keep/drop: exactly one id per kept span", async () => {
    setupIngestMocks([dropFilter("name = 'GET /health'")]);

    const generateSpy: jest.SpyInstance = jest.spyOn(
      ObjectID,
      "generateTimeOrdered",
    );

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [
          { name: "GET /health" },
          { name: "GET /checkout" },
          { name: "POST /pay" },
        ],
      }),
    );

    expect(generateSpy).toHaveBeenCalledTimes(2);
  });

  test("without filters, exactly one id per span is generated", async () => {
    setupIngestMocks([]);

    const generateSpy: jest.SpyInstance = jest.spyOn(
      ObjectID,
      "generateTimeOrdered",
    );

    await OtelTracesIngestService.processTracesFromQueue(
      tracesRequest({
        spans: [{ name: "one" }, { name: "two" }],
      }),
    );

    expect(generateSpy).toHaveBeenCalledTimes(2);
  });
});
