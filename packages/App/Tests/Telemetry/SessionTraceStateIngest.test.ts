/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under
 * ts-jest (Buffer vs BinaryLike) that breaks every suite whose import
 * graph reaches it. The gRPC server import below drags the service layer
 * in; nothing here touches password hashing, so the module is replaced
 * with a factory before the import graph compiles it.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

/*
 * The Queue infrastructure module loads BullMQ at import time through the
 * per-signal queue services. Nothing queue-side is under test, so it is
 * replaced with an inert stub - same idiom as OtelIdDecoding.test.ts.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * In-memory TelemetryBodyStore for the HTTP protobuf case: the decoder
 * reads the queued body by key, exactly as the worker does. Same stub as
 * OtelPayloadDecoderBufferPassthrough.test.ts.
 */
const mockBodyStoreBackingMap: Map<string, Buffer> = new Map();

jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: {
      readBody: (bodyKey: string): Promise<Buffer | null> => {
        return Promise.resolve(mockBodyStoreBackingMap.get(bodyKey) || null);
      },
    },
  };
});

import OtelTracesIngestService from "../../FeatureSet/Telemetry/Services/OtelTracesIngestService";
import TraceDropFilterService, {
  LoadedTraceDropFilter,
} from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import { binaryToBase64Replacer } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import OtelPayloadDecoder, {
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import { OTLP_PROTO_LOADER_OPTIONS } from "../../FeatureSet/Telemetry/GrpcServer";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import SpanService from "Common/Server/Services/SpanService";
import ExceptionInstanceService from "Common/Server/Services/ExceptionInstanceService";
import TelemetryFanInWriter from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TraceDropFilter from "Common/Models/DatabaseModels/TraceDropFilter";
import TraceDropFilterAction from "Common/Types/Trace/TraceDropFilterAction";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { buildSessionTraceStateMember } from "Common/Utils/Rum/SessionTraceState";
import * as protoLoader from "@grpc/proto-loader";
import protobuf from "protobufjs";
import path from "path";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Span ingest reading the browser recorder's W3C trace-state member
 * (Common/Utils/Rum/SessionTraceState), end to end through the real OTLP
 * walk, row builders and TelemetryFanInWriter, with ClickHouse's
 * insertJsonRows mocked so the actual rows can be read back. Same harness
 * as SessionIdExceptionPath.test.ts.
 *
 * What is pinned, and why it matters:
 *
 * 1. The member stamps Span.sessionId, and through the span row the
 *    span-event ExceptionInstance.sessionId. It outranks a `session.id`
 *    attribute, which is also an LLM conversation key.
 * 2. The member is removed from the stored traceState, so a session id
 *    lives only in the sessionId column that erasure deletes by.
 * 3. The entry span of a trace the recorder started points at a parent
 *    that is never exported. When its parent is exactly the member's `p`,
 *    it is stored as the root it really is, before drop filters run.
 * 4. The three OTLP producers (JSON, HTTP protobuf, gRPC) all carry the
 *    trace state to the same place.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const SERVICE_ID: ObjectID = ObjectID.generate();
const SERVICE_NAME: string = "session-trace-state-test-service";

const TRACE_ID: string = "0af7651916cd43dd8448eb211c80319c";
const ENTRY_SPAN_ID: string = "b7ad6b7169203331";
const CHILD_SPAN_ID: string = "00f067aa0ba902b7";
const GRANDCHILD_SPAN_ID: string = "a3ce929d0e0e4736";

// What the recorder mints: a 32-hex session id and a 16-hex parent id.
const SESSION_ID: string = "5f2c9e1a7b3d4c6e8f0a1b2c3d4e5f60";
const OTHER_SESSION_ID: string = "11112222333344445555666677778888";
const SYNTHETIC_PARENT_ID: string = "e457b5a2e4d86bd1";
const REAL_PARENT_ID: string = "53995c3f42cd8ad8";

const ATTRIBUTE_SESSION_ID: string = "attr-session-1";
const RESOURCE_SESSION_ID: string = "resource-session-1";

const OTHER_VENDORS_TRACE_STATE: string = "rojo=00f067aa0ba902b7,congo=t61rcWk";

const AUTO_DISCOVERY_METHODS_RETURNING_NULL: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverProxmoxCluster",
  "autoDiscoverVMwareVCenter",
  "autoDiscoverCephCluster",
  "autoDiscoverDockerSwarmCluster",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
];

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Telemetry",
  "ProtoFiles",
  "OTel",
  "v1",
);

type OtlpAttribute = { key: string; value: { stringValue: string } };

function stringAttribute(key: string, value: string): OtlpAttribute {
  return { key: key, value: { stringValue: value } };
}

type SpanInput = {
  spanId?: string;
  parentSpanId?: string;
  /*
   * Omitted from the OTLP span when undefined, as exporters omit an empty
   * trace state. `unknown` so hostile shapes can be sent too.
   */
  traceState?: unknown;
  name?: string;
  attributes?: Array<OtlpAttribute>;
  withException?: boolean;
  links?: Array<JSONObject>;
};

function exceptionEvent(): JSONObject {
  return {
    name: "exception",
    timeUnixNano: `${Date.now()}000000`,
    attributes: [
      stringAttribute("exception.message", "Something broke"),
      stringAttribute("exception.type", "Error"),
      stringAttribute(
        "exception.stacktrace",
        "Error: Something broke\n    at handler (app.js:10:5)",
      ),
    ],
  };
}

function otlpSpan(input: SpanInput): JSONObject {
  const nowNano: string = `${Date.now()}000000`;
  const span: JSONObject = {
    traceId: TRACE_ID,
    spanId: input.spanId ?? ENTRY_SPAN_ID,
    parentSpanId: input.parentSpanId ?? "",
    name: input.name ?? "GET /api/cart",
    kind: 2,
    startTimeUnixNano: nowNano,
    endTimeUnixNano: nowNano,
    status: { code: 2 },
    attributes: input.attributes ?? [],
    events: input.withException ? [exceptionEvent()] : [],
    links: input.links ?? [],
  };

  if (input.traceState !== undefined) {
    span["traceState"] = input.traceState as string;
  }

  return span;
}

function telemetryRequest(body: JSONObject): TelemetryRequest {
  return {
    projectId: PROJECT_ID,
    body: body,
    headers: {},
  } as unknown as TelemetryRequest;
}

function tracesRequest(data: {
  spans: Array<SpanInput>;
  resourceAttributes?: Array<OtlpAttribute>;
}): TelemetryRequest {
  return telemetryRequest({
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
            scope: {},
            spans: data.spans.map(otlpSpan),
          },
        ],
      },
    ],
  });
}

function dropFilter(filterQuery: string): LoadedTraceDropFilter {
  /*
   * No id on the model on purpose: recordDrop() short-circuits without
   * one, keeping the drop recorder (and its Redis surface) out of this
   * suite.
   */
  const filter: TraceDropFilter = new TraceDropFilter();
  filter.action = TraceDropFilterAction.Drop;

  return {
    filter: filter,
    compiledFilter: compileFilter(filterQuery, { emptyQueryMatches: false }),
    projectId: PROJECT_ID,
  };
}

function setupIngestMocks(dropFilters: Array<LoadedTraceDropFilter>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelTracesIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of AUTO_DISCOVERY_METHODS_RETURNING_NULL) {
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
   * Loaded in the same Promise.all as the drop filters. Left unmocked it
   * hits the database, the Promise.all rejects, and the catch resets every
   * rule set to empty - silently disabling the drop filters asserted on
   * below.
   */
  jest
    .spyOn(LlmModelPriceService, "loadModelPrices")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
  jest
    .spyOn(ExceptionUtil, "saveOrUpdateTelemetryExceptionsBatch")
    .mockResolvedValue(undefined);
}

function insertedRows(spy: jest.SpyInstance): Array<JSONObject> {
  const rows: Array<JSONObject> = [];
  for (const call of spy.mock.calls) {
    for (const row of call[0] as Array<JSONObject>) {
      rows.push(row);
    }
  }
  return rows;
}

function onlyRow(spy: jest.SpyInstance): JSONObject {
  const rows: Array<JSONObject> = insertedRows(spy);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

function rowBySpanId(spy: jest.SpyInstance, spanId: string): JSONObject {
  const rows: Array<JSONObject> = insertedRows(spy).filter(
    (row: JSONObject): boolean => {
      return row["spanId"] === spanId;
    },
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe("Span ingest: the recorder's session member of the trace state", () => {
  let spanInsertSpy: jest.SpyInstance;
  let exceptionInsertSpy: jest.SpyInstance;

  beforeAll(() => {
    // Tiny flush window so buffered rows land in ~10ms, as in the fan-in suite.
    TelemetryFanInWriter.configure({
      maxWaitMs: 10,
      maxBatchRows: 50,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
    });
  });

  beforeEach(() => {
    mockBodyStoreBackingMap.clear();
    setupIngestMocks([]);
    spanInsertSpy = jest
      .spyOn(SpanService, "insertJsonRows")
      .mockResolvedValue(undefined);
    exceptionInsertSpy = jest
      .spyOn(ExceptionInstanceService, "insertJsonRows")
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await TelemetryFanInWriter.flushAll();
    jest.restoreAllMocks();
  });

  describe("sessionId", () => {
    test("a lone member stamps the span row and its span-event exception row", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              traceState: buildSessionTraceStateMember(SESSION_ID),
              withException: true,
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);
      expect(spanRow["traceState"]).toBe("");

      const exceptionRow: JSONObject = onlyRow(exceptionInsertSpy);
      expect(exceptionRow["sessionId"]).toBe(SESSION_ID);
      expect(exceptionRow["spanId"]).toBe(ENTRY_SPAN_ID);
      expect(exceptionRow["traceId"]).toBe(TRACE_ID);
    });

    test("a member among other vendors' members is found and only it is removed", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              traceState: `rojo=00f067aa0ba902b7,${buildSessionTraceStateMember(
                SESSION_ID,
                SYNTHETIC_PARENT_ID,
              )},congo=t61rcWk`,
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);
      // Other vendors' members survive verbatim and in order.
      expect(spanRow["traceState"]).toBe(OTHER_VENDORS_TRACE_STATE);
    });

    test("optional whitespace around members is tolerated", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              traceState: `rojo=00f067aa0ba902b7 , ${buildSessionTraceStateMember(
                SESSION_ID,
              )}\t,congo=t61rcWk`,
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);
      expect(spanRow["traceState"]).toBe(OTHER_VENDORS_TRACE_STATE);
    });

    test("uppercase hex in the member is stored lowercase, and still repairs the root", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              parentSpanId: SYNTHETIC_PARENT_ID,
              traceState: buildSessionTraceStateMember(
                SESSION_ID.toUpperCase(),
                SYNTHETIC_PARENT_ID.toUpperCase(),
              ),
              withException: true,
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);
      expect(spanRow["parentSpanId"]).toBe("");
      expect(spanRow["isRootSpan"]).toBe(true);
      expect(onlyRow(exceptionInsertSpy)["sessionId"]).toBe(SESSION_ID);
    });

    test("the member beats a span session.id and a resource session.id together", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              traceState: buildSessionTraceStateMember(SESSION_ID),
              attributes: [stringAttribute("session.id", ATTRIBUTE_SESSION_ID)],
              withException: true,
            },
          ],
          resourceAttributes: [
            stringAttribute("session.id", RESOURCE_SESSION_ID),
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);
      expect(onlyRow(exceptionInsertSpy)["sessionId"]).toBe(SESSION_ID);

      // The attributes themselves are stored untouched.
      const attributes: JSONObject = spanRow["attributes"] as JSONObject;
      expect(attributes["session.id"]).toBe(ATTRIBUTE_SESSION_ID);
      expect(attributes["resource.session.id"]).toBe(RESOURCE_SESSION_ID);
    });

    test("the member beats a resource session.id on its own", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [{ traceState: buildSessionTraceStateMember(SESSION_ID) }],
          resourceAttributes: [
            stringAttribute("session.id", RESOURCE_SESSION_ID),
          ],
        }),
      );

      expect(onlyRow(spanInsertSpy)["sessionId"]).toBe(SESSION_ID);
    });

    test("every span of a browser-started trace is stamped, not only the entry span", async () => {
      const member: string = buildSessionTraceStateMember(
        SESSION_ID,
        SYNTHETIC_PARENT_ID,
      );

      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              spanId: ENTRY_SPAN_ID,
              parentSpanId: SYNTHETIC_PARENT_ID,
              traceState: member,
            },
            {
              spanId: CHILD_SPAN_ID,
              parentSpanId: ENTRY_SPAN_ID,
              traceState: member,
              name: "SELECT cart",
            },
            {
              spanId: GRANDCHILD_SPAN_ID,
              parentSpanId: CHILD_SPAN_ID,
              traceState: member,
              name: "pg.connect",
              withException: true,
            },
          ],
        }),
      );

      for (const spanId of [ENTRY_SPAN_ID, CHILD_SPAN_ID, GRANDCHILD_SPAN_ID]) {
        const row: JSONObject = rowBySpanId(spanInsertSpy, spanId);
        expect(row["sessionId"]).toBe(SESSION_ID);
        expect(row["traceState"]).toBe("");
      }

      expect(onlyRow(exceptionInsertSpy)["sessionId"]).toBe(SESSION_ID);
    });

    test("with two members of ours, the first wins and both are removed", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              traceState: `${buildSessionTraceStateMember(
                SESSION_ID,
              )},rojo=00f067aa0ba902b7,${buildSessionTraceStateMember(
                OTHER_SESSION_ID,
              )}`,
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);
      expect(spanRow["traceState"]).toBe("rojo=00f067aa0ba902b7");
    });
  });

  describe("a malformed member", () => {
    // [case name, the malformed member]
    const malformedMembers: Array<[string, string]> = [
      ["a non-hex session id", "oneuptime=sid:not-a-session"],
      ["a 31-character session id", `oneuptime=sid:${SESSION_ID.slice(1)}`],
      ["a 33-character session id", `oneuptime=sid:${SESSION_ID}0`],
      ["an all-zero session id", `oneuptime=sid:${"0".repeat(32)}`],
      ["no sid field at all", `oneuptime=p:${SYNTHETIC_PARENT_ID}`],
      ["a key with no value", "oneuptime"],
      ["an empty value", "oneuptime="],
    ];

    test.each(malformedMembers)(
      "%s: falls back to the attributes and is still stripped",
      async (_name: string, member: string) => {
        await OtelTracesIngestService.processTracesFromQueue(
          tracesRequest({
            spans: [
              {
                traceState: `rojo=00f067aa0ba902b7,${member},congo=t61rcWk`,
                attributes: [
                  stringAttribute("session.id", ATTRIBUTE_SESSION_ID),
                ],
                withException: true,
              },
            ],
          }),
        );

        const spanRow: JSONObject = onlyRow(spanInsertSpy);
        expect(spanRow["sessionId"]).toBe(ATTRIBUTE_SESSION_ID);
        expect(spanRow["traceState"]).toBe(OTHER_VENDORS_TRACE_STATE);
        expect(onlyRow(exceptionInsertSpy)["sessionId"]).toBe(
          ATTRIBUTE_SESSION_ID,
        );
      },
    );

    test.each(malformedMembers)(
      "%s: with no attribute either, sessionId is ''",
      async (_name: string, member: string) => {
        await OtelTracesIngestService.processTracesFromQueue(
          tracesRequest({
            spans: [{ traceState: member }],
          }),
        );

        const spanRow: JSONObject = onlyRow(spanInsertSpy);
        expect(spanRow["sessionId"]).toBe("");
        expect(spanRow["traceState"]).toBe("");
      },
    );

    test("a resource session.id is the fallback when the span has none", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [{ traceState: "oneuptime=sid:not-a-session" }],
          resourceAttributes: [
            stringAttribute("session.id", RESOURCE_SESSION_ID),
          ],
        }),
      );

      expect(onlyRow(spanInsertSpy)["sessionId"]).toBe(RESOURCE_SESSION_ID);
    });

    test("a malformed session id costs the root repair too, even with a valid p", async () => {
      /*
       * The repair is only trusted from a member that parsed. The span
       * keeps its wire parent, as it would have before this feature.
       */
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              parentSpanId: SYNTHETIC_PARENT_ID,
              traceState: `oneuptime=sid:not-a-session;p:${SYNTHETIC_PARENT_ID}`,
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["parentSpanId"]).toBe(SYNTHETIC_PARENT_ID);
      expect(spanRow["isRootSpan"]).toBe(false);
      expect(spanRow["traceState"]).toBe("");
    });

    test("a malformed p costs only the root repair, never the session", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              parentSpanId: SYNTHETIC_PARENT_ID,
              traceState: `oneuptime=sid:${SESSION_ID};p:not-a-parent`,
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);
      expect(spanRow["parentSpanId"]).toBe(SYNTHETIC_PARENT_ID);
      expect(spanRow["isRootSpan"]).toBe(false);
    });
  });

  describe("spans without a member are untouched", () => {
    test("another vendor's trace state is stored verbatim and attributes still decide the session", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              parentSpanId: REAL_PARENT_ID,
              traceState: OTHER_VENDORS_TRACE_STATE,
              attributes: [stringAttribute("session.id", ATTRIBUTE_SESSION_ID)],
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["traceState"]).toBe(OTHER_VENDORS_TRACE_STATE);
      expect(spanRow["sessionId"]).toBe(ATTRIBUTE_SESSION_ID);
      expect(spanRow["parentSpanId"]).toBe(REAL_PARENT_ID);
      expect(spanRow["isRootSpan"]).toBe(false);
    });

    test("a vendor key that merely contains 'oneuptime' is not ours", async () => {
      const traceState: string = `acme@oneuptime=sid:${SESSION_ID},oneuptimex=sid:${SESSION_ID}`;

      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [{ traceState: traceState }],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["sessionId"]).toBe("");
      expect(spanRow["traceState"]).toBe(traceState);
    });

    test("an absent trace state stores '' and the span stays a root", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({ spans: [{}] }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["traceState"]).toBe("");
      expect(spanRow["sessionId"]).toBe("");
      expect(spanRow["parentSpanId"]).toBe("");
      expect(spanRow["isRootSpan"]).toBe(true);
    });

    test("a non-string trace state from a hostile body stores '' and the span still lands", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            { spanId: ENTRY_SPAN_ID, traceState: 42 },
            {
              spanId: CHILD_SPAN_ID,
              traceState: { oneuptime: `sid:${SESSION_ID}` },
            },
            {
              spanId: GRANDCHILD_SPAN_ID,
              traceState: [buildSessionTraceStateMember(SESSION_ID)],
            },
          ],
        }),
      );

      expect(insertedRows(spanInsertSpy)).toHaveLength(3);
      for (const spanId of [ENTRY_SPAN_ID, CHILD_SPAN_ID, GRANDCHILD_SPAN_ID]) {
        const row: JSONObject = rowBySpanId(spanInsertSpy, spanId);
        expect(row["traceState"]).toBe("");
        expect(row["sessionId"]).toBe("");
      }
    });
  });

  describe("the session id is stored in the sessionId column only", () => {
    test("no other field of the span row carries it, links included", async () => {
      /*
       * Erasure deletes by the sessionId column. A copy anywhere else in
       * the row (traceState, a link's trace state) would outlive it.
       */
      const linkedTraceId: string = "4bf92f3577b34da6a3ce929d0e0e4736";

      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              parentSpanId: SYNTHETIC_PARENT_ID,
              traceState: `rojo=00f067aa0ba902b7,${buildSessionTraceStateMember(
                SESSION_ID,
                SYNTHETIC_PARENT_ID,
              )}`,
              links: [
                {
                  traceId: linkedTraceId,
                  spanId: CHILD_SPAN_ID,
                  traceState: buildSessionTraceStateMember(
                    SESSION_ID,
                    SYNTHETIC_PARENT_ID,
                  ),
                  attributes: [stringAttribute("link.kind", "follows")],
                },
              ],
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);

      const everythingElse: JSONObject = { ...spanRow };
      delete everythingElse["sessionId"];
      const serialized: string = JSON.stringify(everythingElse);
      expect(serialized).not.toContain(SESSION_ID);
      expect(serialized).not.toContain("oneuptime=");
      expect(serialized).not.toContain(SYNTHETIC_PARENT_ID);

      // The link itself is kept, minus any trace state.
      expect(spanRow["links"]).toEqual([
        {
          traceId: linkedTraceId,
          spanId: CHILD_SPAN_ID,
          attributes: { "link.kind": "follows" },
        },
      ]);
    });
  });

  describe("root-span repair from the member's p", () => {
    test("a span whose parent is exactly p is stored as a root", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              parentSpanId: SYNTHETIC_PARENT_ID,
              traceState: buildSessionTraceStateMember(
                SESSION_ID,
                SYNTHETIC_PARENT_ID,
              ),
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["parentSpanId"]).toBe("");
      expect(spanRow["isRootSpan"]).toBe(true);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);
    });

    test("a child of the entry span keeps its real parent", async () => {
      const member: string = buildSessionTraceStateMember(
        SESSION_ID,
        SYNTHETIC_PARENT_ID,
      );

      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              spanId: ENTRY_SPAN_ID,
              parentSpanId: SYNTHETIC_PARENT_ID,
              traceState: member,
            },
            {
              spanId: CHILD_SPAN_ID,
              parentSpanId: ENTRY_SPAN_ID,
              traceState: member,
            },
          ],
        }),
      );

      const entryRow: JSONObject = rowBySpanId(spanInsertSpy, ENTRY_SPAN_ID);
      expect(entryRow["parentSpanId"]).toBe("");
      expect(entryRow["isRootSpan"]).toBe(true);

      const childRow: JSONObject = rowBySpanId(spanInsertSpy, CHILD_SPAN_ID);
      expect(childRow["parentSpanId"]).toBe(ENTRY_SPAN_ID);
      expect(childRow["isRootSpan"]).toBe(false);
      expect(childRow["sessionId"]).toBe(SESSION_ID);
    });

    test("a p that does not match the span's parent is ignored", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              parentSpanId: REAL_PARENT_ID,
              traceState: buildSessionTraceStateMember(
                SESSION_ID,
                SYNTHETIC_PARENT_ID,
              ),
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["parentSpanId"]).toBe(REAL_PARENT_ID);
      expect(spanRow["isRootSpan"]).toBe(false);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);
    });

    test("a member without p (the page set the traceparent) never repairs", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              parentSpanId: SYNTHETIC_PARENT_ID,
              traceState: buildSessionTraceStateMember(SESSION_ID),
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["parentSpanId"]).toBe(SYNTHETIC_PARENT_ID);
      expect(spanRow["isRootSpan"]).toBe(false);
      expect(spanRow["sessionId"]).toBe(SESSION_ID);
    });

    test("a span that already has no parent stays a root", async () => {
      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              parentSpanId: "",
              traceState: buildSessionTraceStateMember(
                SESSION_ID,
                SYNTHETIC_PARENT_ID,
              ),
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["parentSpanId"]).toBe("");
      expect(spanRow["isRootSpan"]).toBe(true);
    });
  });

  describe("drop filters evaluate the trace-state-derived row", () => {
    test("a sessionId drop filter sees the id from the member and drops the span and its exception", async () => {
      setupIngestMocks([dropFilter(`sessionId = '${SESSION_ID}'`)]);

      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              spanId: ENTRY_SPAN_ID,
              traceState: buildSessionTraceStateMember(SESSION_ID),
              withException: true,
            },
            {
              spanId: CHILD_SPAN_ID,
              traceState: buildSessionTraceStateMember(OTHER_SESSION_ID),
            },
          ],
        }),
      );

      const keptRow: JSONObject = onlyRow(spanInsertSpy);
      expect(keptRow["spanId"]).toBe(CHILD_SPAN_ID);
      expect(keptRow["sessionId"]).toBe(OTHER_SESSION_ID);
      expect(insertedRows(exceptionInsertSpy)).toHaveLength(0);
    });

    test("an isRootSpan drop filter sees the repaired entry span", async () => {
      setupIngestMocks([dropFilter("isRootSpan = 'true'")]);
      const member: string = buildSessionTraceStateMember(
        SESSION_ID,
        SYNTHETIC_PARENT_ID,
      );

      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              spanId: ENTRY_SPAN_ID,
              parentSpanId: SYNTHETIC_PARENT_ID,
              traceState: member,
            },
            {
              spanId: CHILD_SPAN_ID,
              parentSpanId: ENTRY_SPAN_ID,
              traceState: member,
            },
          ],
        }),
      );

      expect(onlyRow(spanInsertSpy)["spanId"]).toBe(CHILD_SPAN_ID);
    });

    test("a filter on the raw member no longer matches: traceState is evaluated stripped", async () => {
      setupIngestMocks([dropFilter("traceState LIKE 'oneuptime'")]);

      await OtelTracesIngestService.processTracesFromQueue(
        tracesRequest({
          spans: [
            {
              traceState: `rojo=00f067aa0ba902b7,${buildSessionTraceStateMember(
                SESSION_ID,
              )}`,
            },
          ],
        }),
      );

      const spanRow: JSONObject = onlyRow(spanInsertSpy);
      expect(spanRow["traceState"]).toBe("rojo=00f067aa0ba902b7");
    });
  });

  describe("binary OTLP producers carry the trace state to the same place", () => {
    /*
     * Both binary producers send ids as bytes. The member's p is hex, so
     * the root repair only works if the wire parent id is converted to the
     * same lowercase hex before the comparison.
     */
    function base64Id(hex: string): string {
      return Buffer.from(hex, "hex").toString("base64");
    }

    function protobufSpanPayload(): JSONObject {
      return {
        resourceSpans: [
          {
            resource: {
              attributes: [
                {
                  key: "service.name",
                  value: { stringValue: SERVICE_NAME },
                },
              ],
            },
            scopeSpans: [
              {
                scope: { name: "http-server-instrumentation" },
                spans: [
                  {
                    traceId: base64Id(TRACE_ID),
                    spanId: base64Id(ENTRY_SPAN_ID),
                    parentSpanId: base64Id(SYNTHETIC_PARENT_ID),
                    traceState: `rojo=00f067aa0ba902b7,${buildSessionTraceStateMember(
                      SESSION_ID,
                      SYNTHETIC_PARENT_ID,
                    )},congo=t61rcWk`,
                    name: "GET /api/cart",
                    kind: "SPAN_KIND_SERVER",
                    startTimeUnixNano: "1700000000000000000",
                    endTimeUnixNano: "1700000001000000000",
                  },
                  {
                    traceId: base64Id(TRACE_ID),
                    spanId: base64Id(CHILD_SPAN_ID),
                    parentSpanId: base64Id(ENTRY_SPAN_ID),
                    traceState: buildSessionTraceStateMember(
                      SESSION_ID,
                      SYNTHETIC_PARENT_ID,
                    ),
                    name: "SELECT cart",
                    kind: "SPAN_KIND_CLIENT",
                    startTimeUnixNano: "1700000000100000000",
                    endTimeUnixNano: "1700000000900000000",
                  },
                ],
              },
            ],
          },
        ],
      };
    }

    function expectRepairedTrace(): void {
      const entryRow: JSONObject = rowBySpanId(spanInsertSpy, ENTRY_SPAN_ID);
      expect(entryRow["traceId"]).toBe(TRACE_ID);
      expect(entryRow["sessionId"]).toBe(SESSION_ID);
      expect(entryRow["parentSpanId"]).toBe("");
      expect(entryRow["isRootSpan"]).toBe(true);
      expect(entryRow["traceState"]).toBe(OTHER_VENDORS_TRACE_STATE);

      const childRow: JSONObject = rowBySpanId(spanInsertSpy, CHILD_SPAN_ID);
      expect(childRow["sessionId"]).toBe(SESSION_ID);
      expect(childRow["parentSpanId"]).toBe(ENTRY_SPAN_ID);
      expect(childRow["isRootSpan"]).toBe(false);
      expect(childRow["traceState"]).toBe("");
    }

    test("HTTP protobuf: trace_state survives OtelPayloadDecoder and stamps the rows", async () => {
      const tracesDataType: protobuf.Type = protobuf
        .loadSync(path.join(PROTO_DIR, "traces.proto"))
        .lookupType("TracesData");
      const encoded: Buffer = Buffer.from(
        tracesDataType
          .encode(tracesDataType.fromObject(protobufSpanPayload()))
          .finish(),
      );
      const bodyKey: string = "telemetry:body:session-trace-state";
      mockBodyStoreBackingMap.set(bodyKey, encoded);

      const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
        productType: ProductType.Traces,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        bodyKey: bodyKey,
      });

      await OtelTracesIngestService.processTracesFromQueue(
        telemetryRequest(decoded),
      );

      expectRepairedTrace();
    });

    test("gRPC: trace_state survives the production proto-loader options and the queue's JSON hop", async () => {
      const serviceProtoPath: string = path.join(
        PROTO_DIR,
        "trace_service.proto",
      );
      const requestType: protobuf.Type = protobuf
        .loadSync(serviceProtoPath)
        .lookupType("ExportTraceServiceRequest");
      const encoded: Buffer = Buffer.from(
        requestType
          .encode(requestType.fromObject(protobufSpanPayload()))
          .finish(),
      );

      /*
       * The same deserializer the gRPC server hands to its Export handler,
       * built with the server's own options (keepCase false: trace_state
       * arrives as traceState).
       */
      const packageDefinition: protoLoader.PackageDefinition =
        protoLoader.loadSync(serviceProtoPath, OTLP_PROTO_LOADER_OPTIONS);
      const exportMethod: protoLoader.MethodDefinition<JSONObject, JSONObject> =
        (
          packageDefinition[
            "opentelemetry.proto.collector.trace.v1.TraceService"
          ] as protoLoader.ServiceDefinition
        )["Export"] as protoLoader.MethodDefinition<JSONObject, JSONObject>;
      const grpcBody: JSONObject = exportMethod.requestDeserialize(encoded);

      /*
       * The queue stores a gRPC body as JSON with Buffers rewritten to
       * base64 (TelemetryQueueService), and the worker parses it back.
       */
      const queuedBody: JSONObject = JSON.parse(
        JSON.stringify(grpcBody, binaryToBase64Replacer),
      ) as JSONObject;

      await OtelTracesIngestService.processTracesFromQueue(
        telemetryRequest(queuedBody),
      );

      expectRepairedTrace();
    });
  });
});
