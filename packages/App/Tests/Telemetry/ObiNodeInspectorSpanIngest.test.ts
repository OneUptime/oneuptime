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
import TraceDropFilterService from "../../FeatureSet/Telemetry/Services/TraceDropFilterService";
import TraceScrubRuleService from "../../FeatureSet/Telemetry/Services/TraceScrubRuleService";
import TracePipelineService from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import LlmModelPriceService from "../../FeatureSet/Telemetry/Services/LlmModelPriceService";
import ExceptionUtil from "../../FeatureSet/Telemetry/Utils/Exception";
import OtelPayloadDecoder, {
  OtelPayloadFormat,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import TelemetryBodyStore from "../../FeatureSet/Telemetry/Utils/TelemetryBodyStore";
import { TelemetryServiceMetadata } from "Common/Server/Services/OpenTelemetryIngestService";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import LlmSpanUtil from "Common/Server/Utils/Telemetry/LlmSpan";
import logger from "Common/Server/Utils/Logger";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import ObjectID from "Common/Types/ObjectID";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import fs from "fs";
import path from "path";
import protobuf from "protobufjs";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * OBI v0.14 records its own Node.js agent injection — GET /json/version,
 * GET /json/list and the WebSocket upgrade to 127.0.0.1:9229 — as SERVER
 * spans of every Node.js app it instruments, the /json requests with
 * "in queue" / "processing" children written ahead of them. Through the real
 * ingest service, pinned here:
 *
 *   - exactly those spans are dropped, from OTLP/JSON and protobuf bodies,
 *     wherever in the request the children sit relative to their parent;
 *   - everything else in the same export is stored as it was: the apps'
 *     requests, their own "in queue" / "processing" sub-spans, the database
 *     calls under them, a database server's span, and an SDK's spans of the
 *     very same shape;
 *   - they are dropped before the evaluation row, so drop filters, scrub
 *     rules, pipelines and LLM extraction never see them;
 *   - a request that held nothing else is not reported as invalid.
 *
 * Fixtures/ObiV014NodeInspectorSpans.json is a real OBI v0.14.0 export, cut
 * down from the first OTLP request two KinD runs of the agent chart
 * received: spans verbatim, resource attributes trimmed to the ones that
 * name the workload. It holds three apps' injections (downstream and app26:
 * /json/list with its two children and the 101 upgrade; appinspect,
 * started with --inspect: /json/version with its children, then /json/list
 * and the upgrade), the requests OBI recorded alongside them, and a
 * postgres server span.
 *
 * The harness is ObiReceivingSideMessagingSpanIngest.test.ts's.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();

const FIXTURE: JSONObject = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "Fixtures", "ObiV014NodeInspectorSpans.json"),
    "utf8",
  ),
) as JSONObject;

// What must be dropped: spanId -> what it is.
const INSPECTOR_SPANS: Record<string, string> = {
  "6b6a5b09dec2b99b": "downstream: in queue under GET /json/list",
  "7d8cb605e2f119ee": "downstream: processing under GET /json/list",
  cc59a1b46d9e2713: "downstream: GET /json/list",
  "20d56ee82e630d20": "downstream: GET /* (101)",
  db3126cec00ff59f: "app26: in queue under GET /json/list",
  "1916a58444e213f0": "app26: processing under GET /json/list",
  "9a7c4d6c34e013c9": "app26: GET /json/list",
  "4741b135c6e4952b": "app26: GET /* (101)",
  "28e3d14ee1528b14": "appinspect: in queue under GET /json/version",
  aeac0b7cffdf88ff: "appinspect: processing under GET /json/version",
  "26cd5ddbe79fdc2f": "appinspect: GET /json/version",
  "25092c30e2b7a499": "appinspect: GET /json/list",
  "69db4226c5f5c0f2": "appinspect: GET /* (101)",
};

// What must be kept: spanId -> what it is.
const APPLICATION_SPANS: Record<string, string> = {
  b7dd1dcf6b063790: "downstream: in queue under GET /ping",
  "61e19edfbf8a99ef": "downstream: processing under GET /ping",
  "71eb8ebd06cb4bc5": "downstream: GET /ping",
  "251a9ce8849e4d98": "agent-e2e: in queue under GET /status/ready",
  f21a5a10304641f8: "agent-e2e: processing under GET /status/ready",
  "4aedf16fb6137266": "agent-e2e: GET /status/ready (kubelet probe)",
  e2bdff91eca85046: "appinspect: redis set under processing",
  "7a9e89a5609978a7": "appinspect: redis get under processing",
  "149c495e3e3bbe60": "appinspect: SELECT under processing",
  f58c7e1f02cf0279: "appinspect: in queue under GET /api/items/:id",
  "260da8f4695dc4fb": "appinspect: processing under GET /api/items/:id",
  "70d5850d44b83102": "appinspect: GET /api/items/:id",
  b758a704172a499a: "postgres: SELECT (server)",
};

const DOWNSTREAM_JSON_LIST_SPAN_ID: string = "cc59a1b46d9e2713";
const DOWNSTREAM_JSON_LIST_CHILDREN: Array<string> = [
  "6b6a5b09dec2b99b",
  "7d8cb605e2f119ee",
];

const OBI_DISTRO: string = "opentelemetry-ebpf-instrumentation";

const TRACE_AUTO_DISCOVERY_METHODS: Array<string> = [
  "autoDiscoverKubernetesCluster",
  "autoDiscoverDockerHost",
  "autoDiscoverPodmanHost",
  "autoDiscoverHost",
  "autoDiscoverServerless",
  "autoDiscoverCloudResource",
  "autoDiscoverRum",
  "autoDiscoverDatabaseServer",
];

type CapturedTraceRows = {
  spans: Array<JSONObject>;
};

function metadataFor(serviceName: string): TelemetryServiceMetadata {
  return {
    serviceName: serviceName,
    primaryEntityId: ObjectID.generate(),
    primaryEntityType: ServiceType.OpenTelemetry,
    entityKeys: ["0123456789abcdef"],
    dataRententionInDays: 15,
    serviceRetentionConfig: null,
    serviceRetentionInDays: null,
    projectRetentionConfig: null,
    projectRetentionInDays: 15,
  };
}

function setupTraceMocks(): CapturedTraceRows {
  const captured: CapturedTraceRows = { spans: [] };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service: Record<string, any> = OtelTracesIngestService as unknown as {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };

  for (const method of TRACE_AUTO_DISCOVERY_METHODS) {
    jest.spyOn(service, method).mockResolvedValue(null);
  }

  // One Service per resource, named by its service.name.
  jest
    .spyOn(service, "resolveTelemetryResource")
    .mockImplementation(
      async (...args: Array<unknown>): Promise<TelemetryServiceMetadata> => {
        const attributes: JSONArray = (args[0] as { attributes: JSONArray })
          .attributes;
        const serviceName: JSONObject | undefined = attributes.find(
          (attribute: JSONObject): boolean => {
            return attribute["key"] === "service.name";
          },
        );
        return metadataFor(
          String(
            (serviceName?.["value"] as JSONObject | undefined)?.[
              "stringValue"
            ] || "",
          ),
        );
      },
    );

  jest
    .spyOn(service, "submitSpansBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      const rows: Array<JSONObject> = args[0] as Array<JSONObject>;
      captured.spans.push(...rows.splice(0, rows.length));
      return Promise.resolve();
    });
  jest
    .spyOn(service, "submitExceptionsBuffer")
    .mockImplementation((...args: Array<unknown>): Promise<void> => {
      (args[0] as Array<JSONObject>).splice(0);
      return Promise.resolve();
    });

  jest
    .spyOn(TraceDropFilterService, "loadDropFilters")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockResolvedValue([] as any);
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

  return captured;
}

afterEach(() => {
  jest.restoreAllMocks();
});

function fixtureCopy(): JSONObject {
  return JSON.parse(JSON.stringify(FIXTURE)) as JSONObject;
}

function resourceSpansOf(body: JSONObject): Array<JSONObject> {
  return body["resourceSpans"] as Array<JSONObject>;
}

function scopeSpansOf(resourceSpan: JSONObject): Array<JSONObject> {
  return resourceSpan["scopeSpans"] as Array<JSONObject>;
}

function spansOf(scopeSpan: JSONObject): Array<JSONObject> {
  return scopeSpan["spans"] as Array<JSONObject>;
}

function allSpans(body: JSONObject): Array<JSONObject> {
  const spans: Array<JSONObject> = [];
  for (const resourceSpan of resourceSpansOf(body)) {
    for (const scopeSpan of scopeSpansOf(resourceSpan)) {
      spans.push(...spansOf(scopeSpan));
    }
  }
  return spans;
}

/*
 * A one-resource request holding just the given spans (hex ids) of the
 * fixture, each in the scope and resource it came in, resources in the
 * fixture's order.
 */
function requestWith(spanIds: Array<string>): JSONObject {
  const body: JSONObject = fixtureCopy();
  for (const resourceSpan of resourceSpansOf(body)) {
    for (const scopeSpan of scopeSpansOf(resourceSpan)) {
      scopeSpan["spans"] = spansOf(scopeSpan).filter(
        (span: JSONObject): boolean => {
          return spanIds.includes(span["spanId"] as string);
        },
      );
    }
    resourceSpan["scopeSpans"] = scopeSpansOf(resourceSpan).filter(
      (scopeSpan: JSONObject): boolean => {
        return spansOf(scopeSpan).length > 0;
      },
    );
  }
  body["resourceSpans"] = resourceSpansOf(body).filter(
    (resourceSpan: JSONObject): boolean => {
      return scopeSpansOf(resourceSpan).length > 0;
    },
  );
  return body;
}

function setDistro(body: JSONObject, distro: string): void {
  for (const resourceSpan of resourceSpansOf(body)) {
    for (const attribute of (resourceSpan["resource"] as JSONObject)[
      "attributes"
    ] as JSONArray) {
      if (attribute["key"] === "telemetry.distro.name") {
        attribute["value"] = { stringValue: distro };
      }
    }
  }
}

async function ingest(body: JSONObject): Promise<void> {
  await OtelTracesIngestService.processTracesFromQueue({
    projectId: PROJECT_ID,
    body: body,
    headers: {},
  } as unknown as TelemetryRequest);
}

function storedSpanIds(captured: CapturedTraceRows): Array<string> {
  return captured.spans
    .map((row: JSONObject): string => {
      return row["spanId"] as string;
    })
    .sort();
}

function sortedKeys(spans: Record<string, string>): Array<string> {
  return Object.keys(spans).sort();
}

const ExportTraceServiceRequestType: protobuf.Type = protobuf
  .loadSync(
    path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Telemetry",
      "ProtoFiles",
      "OTel",
      "v1",
      "trace_service.proto",
    ),
  )
  .lookupType(
    "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest",
  );

// OTLP/JSON ids are hex; protobufjs' fromObject would read them as base64.
function withBinaryIds(value: JSONValue): unknown {
  if (Array.isArray(value)) {
    return value.map((entry: JSONValue): unknown => {
      return withBinaryIds(entry);
    });
  }

  if (value && typeof value === "object") {
    const copy: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as JSONObject)) {
      copy[key] =
        (key === "traceId" || key === "spanId" || key === "parentSpanId") &&
        typeof entry === "string"
          ? Buffer.from(entry, "hex")
          : withBinaryIds(entry as JSONValue);
    }
    return copy;
  }

  return value;
}

/*
 * The body as the worker sees an OTLP/HTTP protobuf export: encoded, stored
 * and decoded back by OtelPayloadDecoder (protobufjs' toJSON: base64 ids,
 * enum names, int64 as decimal strings).
 */
async function asDecodedProtobuf(body: JSONObject): Promise<JSONObject> {
  const bytes: Buffer = Buffer.from(
    ExportTraceServiceRequestType.encode(
      ExportTraceServiceRequestType.fromObject(
        withBinaryIds(body) as Record<string, unknown>,
      ),
    ).finish(),
  );
  jest.spyOn(TelemetryBodyStore, "readBody").mockResolvedValue(bytes);
  return OtelPayloadDecoder.decodeFromQueue({
    productType: ProductType.Traces,
    format: OtelPayloadFormat.Protobuf,
    encoding: "none",
    bodyKey: "telemetry:body:obi-node-inspector",
  });
}

describe("OBI v0.14's Node.js inspector spans at ingest", () => {
  test("of OBI v0.14.0's export, every span is stored except its inspector requests and their sub-spans", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest(fixtureCopy());

    expect(allSpans(FIXTURE)).toHaveLength(
      Object.keys(INSPECTOR_SPANS).length +
        Object.keys(APPLICATION_SPANS).length,
    );
    expect(storedSpanIds(captured)).toEqual(sortedKeys(APPLICATION_SPANS));
  });

  test("the apps' own spans are stored as they came: the request, its sub-spans and the calls under them", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest(fixtureCopy());

    const byId: Record<string, JSONObject> = {};
    for (const row of captured.spans) {
      byId[row["spanId"] as string] = row;
    }
    expect(byId["70d5850d44b83102"]!["name"]).toBe("GET /api/items/:id");
    expect(byId["70d5850d44b83102"]!["kind"]).toBe(SpanKind.Server);
    expect(byId["70d5850d44b83102"]!["parentSpanId"]).toBe("");
    for (const subSpanId of ["f58c7e1f02cf0279", "260da8f4695dc4fb"]) {
      expect(byId[subSpanId]!["kind"]).toBe(SpanKind.Internal);
      expect(byId[subSpanId]!["parentSpanId"]).toBe("70d5850d44b83102");
    }
    for (const callId of [
      "e2bdff91eca85046",
      "7a9e89a5609978a7",
      "149c495e3e3bbe60",
    ]) {
      expect(byId[callId]!["kind"]).toBe(SpanKind.Client);
      expect(byId[callId]!["parentSpanId"]).toBe("260da8f4695dc4fb");
    }
    expect(byId["b758a704172a499a"]!["kind"]).toBe(SpanKind.Server);
  });

  test("the same export as a protobuf body loses the same spans", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    const decoded: JSONObject = await asDecodedProtobuf(fixtureCopy());
    // The shape the drop has to read: base64 ids, the kind's enum name.
    const decodedSpan: JSONObject = allSpans(decoded)[2]!;
    expect(decodedSpan["spanId"]).toBe(
      Buffer.from(DOWNSTREAM_JSON_LIST_SPAN_ID, "hex").toString("base64"),
    );
    expect(decodedSpan["kind"]).toBe("SPAN_KIND_SERVER");

    await ingest(decoded);

    expect(storedSpanIds(captured)).toEqual(sortedKeys(APPLICATION_SPANS));
  });

  test("children are dropped from another ResourceSpans of the request, before or after their parent's", async () => {
    for (const childrenFirst of [true, false]) {
      const captured: CapturedTraceRows = setupTraceMocks();
      const body: JSONObject = fixtureCopy();
      const downstream: JSONObject = resourceSpansOf(body)[0]!;
      const jsonListScope: JSONObject = scopeSpansOf(downstream)[0]!;
      const children: Array<JSONObject> = spansOf(jsonListScope).filter(
        (span: JSONObject): boolean => {
          return DOWNSTREAM_JSON_LIST_CHILDREN.includes(
            span["spanId"] as string,
          );
        },
      );
      expect(children).toHaveLength(2);
      jsonListScope["spans"] = spansOf(jsonListScope).filter(
        (span: JSONObject): boolean => {
          return !children.includes(span);
        },
      );
      const childrenResource: JSONObject = {
        resource: downstream["resource"] as JSONObject,
        scopeSpans: [{ scope: {}, spans: children }],
      };
      if (childrenFirst) {
        resourceSpansOf(body).unshift(childrenResource);
      } else {
        resourceSpansOf(body).push(childrenResource);
      }

      await ingest(body);

      expect({
        childrenFirst: childrenFirst,
        stored: storedSpanIds(captured),
      }).toEqual({
        childrenFirst: childrenFirst,
        stored: sortedKeys(APPLICATION_SPANS),
      });
      jest.restoreAllMocks();
    }
  });

  test("a request with the children but not their parent keeps them: the collector split the export (the documented residual)", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest(requestWith(DOWNSTREAM_JSON_LIST_CHILDREN));

    expect(storedSpanIds(captured)).toEqual(
      [...DOWNSTREAM_JSON_LIST_CHILDREN].sort(),
    );
  });

  test("a request with the parent but not its children drops the parent", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();

    await ingest(
      requestWith([DOWNSTREAM_JSON_LIST_SPAN_ID, "71eb8ebd06cb4bc5"]),
    );

    expect(storedSpanIds(captured)).toEqual(["71eb8ebd06cb4bc5"]);
  });

  test("an SDK's spans of the very same shape are all stored", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const body: JSONObject = fixtureCopy();
    setDistro(body, "opentelemetry-js-instrumentation");

    await ingest(body);

    expect(storedSpanIds(captured)).toEqual(
      [...sortedKeys(INSPECTOR_SPANS), ...sortedKeys(APPLICATION_SPANS)].sort(),
    );
  });

  test("an inspector-shaped span from another pod, on another port, or answered 200 on the target path is stored", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const body: JSONObject = requestWith([
      DOWNSTREAM_JSON_LIST_SPAN_ID,
      ...DOWNSTREAM_JSON_LIST_CHILDREN,
      "20d56ee82e630d20",
      "9a7c4d6c34e013c9",
    ]);
    const spans: Record<string, JSONObject> = {};
    for (const span of allSpans(body)) {
      spans[span["spanId"] as string] = span;
    }
    function setAttribute(
      spanId: string,
      key: string,
      value: JSONObject,
    ): void {
      for (const attribute of spans[spanId]!["attributes"] as JSONArray) {
        if (attribute["key"] === key) {
          attribute["value"] = value;
        }
      }
    }
    setAttribute(DOWNSTREAM_JSON_LIST_SPAN_ID, "client.address", {
      stringValue: "10.244.1.7",
    });
    setAttribute("9a7c4d6c34e013c9", "server.port", { intValue: "9230" });
    setAttribute("20d56ee82e630d20", "http.response.status_code", {
      intValue: "200",
    });

    await ingest(body);

    expect(storedSpanIds(captured)).toEqual(
      [
        DOWNSTREAM_JSON_LIST_SPAN_ID,
        ...DOWNSTREAM_JSON_LIST_CHILDREN,
        "20d56ee82e630d20",
        "9a7c4d6c34e013c9",
      ].sort(),
    );
  });

  test("an inspector request without client.address is dropped by its loopback network.peer.address", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const body: JSONObject = requestWith([
      DOWNSTREAM_JSON_LIST_SPAN_ID,
      ...DOWNSTREAM_JSON_LIST_CHILDREN,
      "71eb8ebd06cb4bc5",
    ]);
    const jsonList: JSONObject = allSpans(body).find(
      (span: JSONObject): boolean => {
        return span["spanId"] === DOWNSTREAM_JSON_LIST_SPAN_ID;
      },
    )!;
    jsonList["attributes"] = (jsonList["attributes"] as JSONArray).filter(
      (attribute: JSONObject): boolean => {
        return attribute["key"] !== "client.address";
      },
    );

    await ingest(body);

    expect(storedSpanIds(captured)).toEqual(["71eb8ebd06cb4bc5"]);
  });

  test("drop filters, scrub rules, pipelines and LLM extraction never see a dropped span", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const seenBy: Record<string, Array<string>> = {
      dropFilter: [],
      scrubRule: [],
      pipeline: [],
    };
    jest
      .spyOn(TraceDropFilterService, "loadDropFilters")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TraceScrubRuleService, "loadScrubRules")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TracePipelineService, "loadPipelines")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockResolvedValue([{}] as any);
    jest
      .spyOn(TraceDropFilterService, "shouldDropSpan")
      .mockImplementation((row: JSONObject): boolean => {
        seenBy["dropFilter"]!.push(row["spanId"] as string);
        return false;
      });
    jest
      .spyOn(TraceScrubRuleService, "scrubSpan")
      .mockImplementation((row: JSONObject): JSONObject => {
        seenBy["scrubRule"]!.push(row["spanId"] as string);
        return row;
      });
    jest
      .spyOn(TracePipelineService, "processSpan")
      .mockImplementation((row: JSONObject): JSONObject => {
        seenBy["pipeline"]!.push(row["spanId"] as string);
        return row;
      });
    const extract: jest.SpyInstance = jest.spyOn(LlmSpanUtil, "extract");

    await ingest(fixtureCopy());

    expect(storedSpanIds(captured)).toEqual(sortedKeys(APPLICATION_SPANS));
    expect({
      dropFilter: [...seenBy["dropFilter"]!].sort(),
      scrubRule: [...seenBy["scrubRule"]!].sort(),
      pipeline: [...seenBy["pipeline"]!].sort(),
    }).toEqual({
      dropFilter: sortedKeys(APPLICATION_SPANS),
      scrubRule: sortedKeys(APPLICATION_SPANS),
      pipeline: sortedKeys(APPLICATION_SPANS),
    });
    expect(extract).toHaveBeenCalledTimes(
      Object.keys(APPLICATION_SPANS).length,
    );
  });

  test("a request of nothing but inspector spans logs their count, not 'No valid spans'", async () => {
    const captured: CapturedTraceRows = setupTraceMocks();
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});
    const debug: jest.SpyInstance = jest
      .spyOn(logger, "debug")
      .mockImplementation((): void => {});

    await ingest(requestWith(Object.keys(INSPECTOR_SPANS)));

    expect(captured.spans).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(
      `Dropped ${Object.keys(INSPECTOR_SPANS).length} spans of OBI's Node.js inspector requests for project: ${PROJECT_ID.toString()}`,
    );
  });

  test("a request without them logs no drop, and an empty one still warns", async () => {
    setupTraceMocks();
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});
    const debug: jest.SpyInstance = jest
      .spyOn(logger, "debug")
      .mockImplementation((): void => {});

    await ingest(requestWith(Object.keys(APPLICATION_SPANS)));
    await ingest(requestWith([]));

    for (const call of debug.mock.calls) {
      expect(String(call[0])).not.toContain("inspector");
    }
    expect(warn).toHaveBeenCalledWith(
      "No valid spans were processed from the request",
    );
  });

  test("the resource attribute the rule reads is OBI's distro name", () => {
    for (const resourceSpan of resourceSpansOf(FIXTURE)) {
      expect(
        ((resourceSpan["resource"] as JSONObject)["attributes"] as JSONArray)
          .filter((attribute: JSONObject): boolean => {
            return attribute["key"] === "telemetry.distro.name";
          })
          .map((attribute: JSONObject): JSONValue => {
            return attribute["value"] as JSONObject;
          }),
      ).toEqual([{ stringValue: OBI_DISTRO }]);
    }
  });
});

describe("the drop sits before the evaluation row", () => {
  /*
   * Read from the source, comments stripped and whitespace collapsed (as
   * ObiReceivingSideMessagingSpanIngest.test.ts does): the behavioural tests
   * above prove nothing downstream sees a dropped span; this pins where the
   * pre-pass and the drop are.
   */
  function readTracesService(): string {
    return fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "FeatureSet",
          "Telemetry",
          "Services",
          "OtelTracesIngestService.ts",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ")
      .replace(/\s+/g, " ");
  }

  test("the pre-pass runs once, before the resource loop; the drop after the kind is known and before the span's events, LLM extraction and the evaluation row", () => {
    const source: string = readTracesService();
    const prePass: string =
      "const obiNodeInspectorRequestSpans: Set<string> = collectObiNodeInspectorRequestSpans(resourceSpans);";
    const drop: string = "obiNodeInspectorSpansDropped++; continue;";

    expect(source.split(prePass)).toHaveLength(2);
    expect(source.split("collectObiNodeInspectorRequestSpans(")).toHaveLength(
      2,
    );
    expect(source.indexOf(prePass)).toBeLessThan(
      source.indexOf("for (const resourceSpan of resourceSpans)"),
    );
    expect(source.split(drop)).toHaveLength(2);
    expect(source.indexOf(drop)).toBeGreaterThan(
      source.indexOf("const spanKind: SpanKind ="),
    );
    expect(source.indexOf(drop)).toBeLessThan(
      source.indexOf("this.getSpanEvents("),
    );
    expect(source.indexOf(drop)).toBeLessThan(
      source.indexOf("LlmSpanUtil.extract("),
    );
    expect(source.indexOf(drop)).toBeLessThan(
      source.indexOf("this.buildSpanEvaluationRow({"),
    );
  });
});
