import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  COMPATIBLE_JSON_MAX_VALUES,
  DATADOG_PROTOBUF_MAX_ELEMENTS,
} from "Common/Types/Telemetry/CompatibleIngest";
import { DatadogIntakeError } from "../../../FeatureSet/Telemetry/Utils/Compatible/DatadogIntake";
import DatadogTraces, {
  AGENT_PAYLOAD_MAX_DEPTH,
  DatadogAgentPayloadAsRead,
  DatadogTracesTranslation,
  MAX_DATADOG_SPANS_PER_REQUEST,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/DatadogTraces";
import Msgpack from "../../../FeatureSet/Telemetry/Utils/Compatible/Msgpack";
import {
  IDX_TRACE_ID,
  PYTHON_TRACEBACK,
  START,
  TRACE_ID_HIGH_HEX,
  TRACE_ID_LOW,
  encodeAgentPayload,
  idxAgentPayloadObject,
  lengthDelimited,
  pythonAgentPayloadObject,
} from "./DatadogTraceFixtures";
import { Encodable, Int64, encodeMsgpack } from "./MsgpackTestEncoder";

/*
 * Datadog APM traces as OpenTelemetry spans: the Agent's AgentPayload (both
 * the tracers' classic payloads and v1's string-table ones) and a tracer's
 * own /v0.3, /v0.4 and /v0.5 bodies, built in each sender's real format.
 * What each span's IDs, name, kind, times, status, attributes, events and
 * links become, and what its resource is - and that every body is counted
 * before it is decoded.
 */

const NOW_MS: number = Date.UTC(2023, 10, 14, 22, 13, 20);

interface FlatSpan {
  resource: Record<string, unknown>;
  scope: JSONObject;
  span: JSONObject;
  attributes: Record<string, unknown>;
}

// An OTLP attribute's value as the JS value it holds: an int64 as its decimal string.
const valueOf: (value: JSONObject) => unknown = (
  value: JSONObject,
): unknown => {
  if ("stringValue" in value) {
    return value["stringValue"];
  }

  if ("intValue" in value) {
    return { int: value["intValue"] };
  }

  if ("doubleValue" in value) {
    return value["doubleValue"];
  }

  return value["boolValue"];
};

const attributeMap: (attributes: unknown) => Record<string, unknown> = (
  attributes: unknown,
): Record<string, unknown> => {
  const map: Record<string, unknown> = {};

  for (const attribute of (attributes as Array<JSONObject>) || []) {
    map[attribute["key"] as string] = valueOf(attribute["value"] as JSONObject);
  }

  return map;
};

const spansOf: (translation: DatadogTracesTranslation) => Array<FlatSpan> = (
  translation: DatadogTracesTranslation,
): Array<FlatSpan> => {
  const flat: Array<FlatSpan> = [];

  for (const resourceSpan of (translation.traces?.["resourceSpans"] ||
    []) as Array<JSONObject>) {
    const resource: Record<string, unknown> = attributeMap(
      (resourceSpan["resource"] as JSONObject)["attributes"],
    );

    for (const scopeSpan of resourceSpan["scopeSpans"] as Array<JSONObject>) {
      for (const span of scopeSpan["spans"] as Array<JSONObject>) {
        flat.push({
          resource: resource,
          scope: scopeSpan["scope"] as JSONObject,
          span: span,
          attributes: attributeMap(span["attributes"]),
        });
      }
    }
  }

  return flat;
};

const bySpanId: (spans: Array<FlatSpan>, id: string) => FlatSpan = (
  spans: Array<FlatSpan>,
  id: string,
): FlatSpan => {
  const found: FlatSpan | undefined = spans.find((flat: FlatSpan): boolean => {
    return flat.span["spanId"] === id;
  });

  if (!found) {
    throw new Error(`No span ${id}`);
  }

  return found;
};

const hex16: (decimal: string) => string = (decimal: string): string => {
  return BigInt(decimal).toString(16).padStart(16, "0");
};

const expectRefusal: (
  run: () => unknown,
  statusCode: number,
  message?: string,
) => void = (
  run: () => unknown,
  statusCode: number,
  message?: string,
): void => {
  let thrown: unknown = null;

  try {
    run();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(DatadogIntakeError);
  expect((thrown as DatadogIntakeError).statusCode).toBe(statusCode);

  if (message) {
    expect((thrown as DatadogIntakeError).message).toContain(message);
  }
};

describe("DatadogTraces.agentPayloadToOtlp: the Agent's AgentPayload", () => {
  const translate: () => DatadogTracesTranslation =
    (): DatadogTracesTranslation => {
      return DatadogTraces.agentPayloadToOtlp(
        encodeAgentPayload(pythonAgentPayloadObject()),
        { nowInMs: NOW_MS },
      );
    };

  test("every span of a 128-bit trace gets the high half only its first span carries", () => {
    const translation: DatadogTracesTranslation = translate();
    const spans: Array<FlatSpan> = spansOf(translation);
    const traceId: string = `${TRACE_ID_HIGH_HEX}${hex16(TRACE_ID_LOW)}`;

    expect(translation.spanCount).toBe(3);
    expect(translation.droppedSpanCount).toBe(0);
    expect(
      spans.map((flat: FlatSpan) => {
        return flat.span["traceId"];
      }),
    ).toEqual([traceId, traceId, traceId]);
    expect(bySpanId(spans, hex16("1")).span["parentSpanId"]).toBeUndefined();
    expect(bySpanId(spans, hex16("2")).span["parentSpanId"]).toBe(hex16("1"));
  });

  test("a request span: its resource names it, it is a server span, its tags are attributes", () => {
    const root: FlatSpan = bySpanId(spansOf(translate()), hex16("1"));

    expect(root.span["name"]).toBe("GET /users/<int:user_id>");
    expect(root.span["kind"]).toBe(2);
    expect(root.span["startTimeUnixNano"]).toBe(START);
    expect(root.span["endTimeUnixNano"]).toBe(
      (BigInt(START) + BigInt(25000000)).toString(),
    );
    expect(root.span["status"]).toEqual({ code: 0 });
    expect(root.scope).toEqual({ name: "datadog", version: "2.14.2" });

    expect(root.attributes).toEqual({
      "datadog.operation_name": "flask.request",
      "datadog.span_type": "web",
      "datadog.trace_id": TRACE_ID_LOW,
      "datadog.span_id": "1",
      "http.method": "GET",
      "http.request.method": "GET",
      "http.route": "/users/<int:user_id>",
      "http.status_code": "200",
      "http.response.status_code": { int: "200" },
      "http.url": "http://shop.example/users/7",
      "url.full": "http://shop.example/users/7",
      component: "flask",
      process_id: { int: "4242" },
      "process.pid": { int: "4242" },
    });
  });

  test("an integration's span belongs to the service that made the call, its own name kept", () => {
    const query: FlatSpan = bySpanId(spansOf(translate()), hex16("2"));

    expect(query.resource["service.name"]).toBe("checkout");
    expect(query.span["name"]).toBe("SELECT * FROM users WHERE id = %s");
    expect(query.span["kind"]).toBe(3);
    expect(query.attributes).toMatchObject({
      "datadog.service": "checkout-postgres",
      "db.type": "postgresql",
      "db.system.name": "postgresql",
      "db.instance": "shop",
      "db.namespace": "shop",
      "out.host": "db-1.internal",
      "server.address": "db-1.internal",
      "out.port": { int: "5432" },
      "server.port": { int: "5432" },
      "db.row_count": { int: "1" },
    });
    expect(query.attributes["_dd.base_service"]).toBeUndefined();
  });

  test("a failed span is an ERROR with an exception event of its type, message and stack trace", () => {
    const charge: FlatSpan = bySpanId(spansOf(translate()), hex16("3"));
    const end: string = (
      BigInt("1700000000130000000") + BigInt(5000000)
    ).toString();

    expect(charge.span["status"]).toEqual({
      code: 2,
      message: "card declined",
    });
    expect(charge.span["kind"]).toBe(1);
    expect(charge.span["events"]).toEqual([
      {
        timeUnixNano: end,
        name: "exception",
        attributes: [
          {
            key: "exception.type",
            value: { stringValue: "builtins.ValueError" },
          },
          { key: "exception.message", value: { stringValue: "card declined" } },
          {
            key: "exception.stacktrace",
            value: { stringValue: PYTHON_TRACEBACK },
          },
        ],
      },
    ]);
    // The event carries the error; error.type stays, as OpenTelemetry's.
    expect(charge.attributes["error.message"]).toBeUndefined();
    expect(charge.attributes["error.stack"]).toBeUndefined();
    expect(charge.attributes["error.type"]).toBe("builtins.ValueError");
  });

  test("the resource: the tracer, its service, environment and version, and the container's Kubernetes tags", () => {
    const translation: DatadogTracesTranslation = translate();
    const resourceSpans: Array<JSONObject> = translation.traces![
      "resourceSpans"
    ] as Array<JSONObject>;

    // The integration's span is the same service: one resource.
    expect(resourceSpans).toHaveLength(1);
    expect(spansOf(translation)[0]!.resource).toEqual({
      "service.name": "checkout",
      "service.version": "1.4.2",
      "deployment.environment.name": "prod",
      "host.name": "web-1",
      "container.id": "3f9e1b7c2a",
      "service.instance.id": "7c9ea8c8-31f5-4a5f-9c3b-0d2a61e1c111",
      "telemetry.sdk.name": "datadog",
      "telemetry.sdk.language": "python",
      "telemetry.sdk.version": "2.14.2",
      "process.runtime.version": "3.11.4",
      "k8s.namespace.name": "shop",
      "k8s.pod.name": "checkout-7d9f8",
      "k8s.deployment.name": "checkout",
      "container.image.tag": "1.4.2",
    });
  });

  test("the x-oneuptime-service-name header names every span's service", () => {
    const translation: DatadogTracesTranslation =
      DatadogTraces.agentPayloadToOtlp(
        encodeAgentPayload(pythonAgentPayloadObject()),
        { nowInMs: NOW_MS, serviceName: "pinned" },
      );

    for (const flat of spansOf(translation)) {
      expect(flat.resource["service.name"]).toBe("pinned");
    }
  });

  test("spans of several services are a resource each", () => {
    const object: JSONObject = pythonAgentPayloadObject();
    const tracerPayload: JSONObject = (
      object["tracerPayloads"] as Array<JSONObject>
    )[0]!;
    const spans: Array<JSONObject> = (
      tracerPayload["chunks"] as Array<JSONObject>
    )[0]!["spans"] as Array<JSONObject>;
    spans[2]!["service"] = "billing";

    const translation: DatadogTracesTranslation =
      DatadogTraces.agentPayloadToOtlp(encodeAgentPayload(object), {
        nowInMs: NOW_MS,
      });

    expect(
      (translation.traces!["resourceSpans"] as Array<JSONObject>).length,
    ).toBe(2);
    expect(
      bySpanId(spansOf(translation), hex16("3")).resource["service.name"],
    ).toBe("billing");
  });

  test("a v1 payload: strings by reference, 128-bit IDs from the chunk, typed attributes, links and events", () => {
    const translation: DatadogTracesTranslation =
      DatadogTraces.agentPayloadToOtlp(
        encodeAgentPayload(idxAgentPayloadObject()),
        { nowInMs: NOW_MS },
      );
    const [flat] = spansOf(translation) as [FlatSpan];

    expect(translation.spanCount).toBe(1);
    expect(flat.span["traceId"]).toBe(IDX_TRACE_ID.toString("hex"));
    expect(flat.span["spanId"]).toBe(hex16("12345678901234567890"));
    expect(flat.span["name"]).toBe("POST /pay");
    expect(flat.span["kind"]).toBe(2);
    expect(flat.span["status"]).toEqual({
      code: 2,
      message: "payment refused",
    });

    expect(flat.resource).toMatchObject({
      "service.name": "payments",
      "service.version": "2.0.1",
      "deployment.environment.name": "staging",
      "host.name": "agent-host",
      "telemetry.sdk.language": "go",
      "telemetry.sdk.version": "v2.0.0",
      "process.runtime.version": "go1.22.5",
      "service.instance.id": "runtime-x",
    });

    expect(flat.attributes).toMatchObject({
      "datadog.operation_name": "http.request",
      "datadog.span_type": "web",
      "http.method": "POST",
      "http.request.method": "POST",
      "http.status_code": { int: "500" },
      "http.response.status_code": { int: "500" },
      retry: true,
      ratio: 0.25,
      tags: '["a","b"]',
      headers: '{"content-type":"application/json"}',
      component: "net/http",
    });
    // The chunk's origin is Datadog's bookkeeping.
    expect(flat.attributes["_dd.origin"]).toBeUndefined();

    expect(flat.span["links"]).toEqual([
      {
        traceId: "ffeeddccbbaa99887766554433221100",
        spanId: hex16("42"),
        flags: 2147483649,
        attributes: [{ key: "link.kind", value: { stringValue: "follows" } }],
      },
    ]);

    const events: Array<JSONObject> = flat.span["events"] as Array<JSONObject>;

    expect(events[0]).toEqual({
      timeUnixNano: "1700000000125000000",
      name: "cache.hit",
      attributes: [{ key: "retry", value: { boolValue: false } }],
    });
    expect(events[1]!["name"]).toBe("exception");
    expect(attributeMap(events[1]!["attributes"])).toEqual({
      "exception.type": "*errors.errorString",
      "exception.message": "payment refused",
    });
  });

  test("classic and v1 tracer payloads of one AgentPayload are both read", () => {
    const object: JSONObject = {
      ...pythonAgentPayloadObject(),
      idxTracerPayloads: idxAgentPayloadObject()["idxTracerPayloads"],
    };

    expect(
      DatadogTraces.agentPayloadToOtlp(encodeAgentPayload(object), {
        nowInMs: NOW_MS,
      }).spanCount,
    ).toBe(4);
  });

  test("native span links and events, and the JSON tags of a tracer that could not send them natively", () => {
    const object: JSONObject = pythonAgentPayloadObject();
    const spans: Array<JSONObject> = (
      (object["tracerPayloads"] as Array<JSONObject>)[0]![
        "chunks"
      ] as Array<JSONObject>
    )[0]!["spans"] as Array<JSONObject>;

    spans[0]!["spanLinks"] = [
      {
        traceID: "99",
        traceID_high: "1",
        spanID: "7",
        attributes: { reason: "retry" },
        tracestate: "dd=s:1",
        flags: 1,
      },
    ];
    spans[0]!["spanEvents"] = [
      {
        time_unix_nano: "1700000000124000001",
        name: "cache.miss",
        attributes: {
          key: { type: 0, string_value: "user:7" },
          hit: { type: 1, bool_value: false },
          size: { type: 2, int_value: "42" },
          ratio: { type: 3, double_value: 0.5 },
          ids: {
            type: 4,
            array_value: {
              values: [
                { type: 2, int_value: "1" },
                { type: 0, string_value: "two" },
              ],
            },
          },
        },
      },
    ];
    // As dd-trace writes it: 64-bit IDs as bare JSON numbers, past what a double holds.
    (spans[1]!["meta"] as JSONObject)["_dd.span_links"] =
      '[{"trace_id":"0af7651916cd43dd8448eb211c80319c","span_id":"b7ad6b7169203331","attributes":{"link.name":"otel"}},{"trace_id":12345678901234567890,"trace_id_high":1,"span_id":5}]';
    (spans[1]!["meta"] as JSONObject)["events"] = JSON.stringify([
      {
        name: "retry",
        time_unix_nano: 1700000000124500000,
        attributes: { attempt: 2 },
      },
    ]);

    const translated: Array<FlatSpan> = spansOf(
      DatadogTraces.agentPayloadToOtlp(encodeAgentPayload(object), {
        nowInMs: NOW_MS,
      }),
    );
    const root: FlatSpan = bySpanId(translated, hex16("1"));
    const query: FlatSpan = bySpanId(translated, hex16("2"));

    expect(root.span["links"]).toEqual([
      {
        traceId: `${hex16("1")}${hex16("99")}`,
        spanId: hex16("7"),
        traceState: "dd=s:1",
        flags: 1,
        attributes: [{ key: "reason", value: { stringValue: "retry" } }],
      },
    ]);
    expect(root.span["events"]).toEqual([
      {
        timeUnixNano: "1700000000124000001",
        name: "cache.miss",
        attributes: [
          { key: "key", value: { stringValue: "user:7" } },
          { key: "hit", value: { boolValue: false } },
          { key: "size", value: { intValue: "42" } },
          { key: "ratio", value: { doubleValue: 0.5 } },
          { key: "ids", value: { stringValue: '["1","two"]' } },
        ],
      },
    ]);

    expect(query.span["links"]).toEqual([
      {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        attributes: [{ key: "link.name", value: { stringValue: "otel" } }],
      },
      {
        traceId: `${hex16("1")}${hex16("12345678901234567890")}`,
        spanId: hex16("5"),
        attributes: [],
      },
    ]);
    expect(query.span["events"]).toEqual([
      {
        timeUnixNano: "1700000000124500000",
        name: "retry",
        attributes: [{ key: "attempt", value: { intValue: "2" } }],
      },
    ]);
    // The JSON tags became links and events, not attributes.
    expect(query.attributes["events"]).toBeUndefined();
    expect(query.attributes["_dd.span_links"]).toBeUndefined();
  });

  test("a span with no trace ID or span ID is dropped and counted", () => {
    const object: JSONObject = pythonAgentPayloadObject();
    const spans: Array<JSONObject> = (
      (object["tracerPayloads"] as Array<JSONObject>)[0]![
        "chunks"
      ] as Array<JSONObject>
    )[0]!["spans"] as Array<JSONObject>;
    spans[1]!["spanID"] = "0";
    spans[2]!["traceID"] = "0";

    const translation: DatadogTracesTranslation =
      DatadogTraces.agentPayloadToOtlp(encodeAgentPayload(object), {
        nowInMs: NOW_MS,
      });

    expect(translation.spanCount).toBe(1);
    expect(translation.droppedSpanCount).toBe(2);
  });

  test("an empty payload is no spans, and no export", () => {
    expect(
      DatadogTraces.agentPayloadToOtlp(Buffer.alloc(0), { nowInMs: NOW_MS }),
    ).toEqual({ traces: null, spanCount: 0, droppedSpanCount: 0 });
  });

  test("a span's meta_struct (AppSec's binary data) and the container debug data are never decoded", () => {
    const decoded: JSONObject = DatadogAgentPayloadAsRead.toObject(
      DatadogAgentPayloadAsRead.decode(
        encodeAgentPayload(pythonAgentPayloadObject()),
      ),
    ) as JSONObject;
    const tracerPayload: JSONObject = (
      decoded["tracerPayloads"] as Array<JSONObject>
    )[0]!;
    const span: JSONObject = (
      (tracerPayload["chunks"] as Array<JSONObject>)[0]![
        "spans"
      ] as Array<JSONObject>
    )[0]!;

    expect(span["meta_struct"]).toBeUndefined();
    expect(tracerPayload["containerDebug"]).toBeUndefined();
  });

  test("a body that is not an AgentPayload is a 400", () => {
    expectRefusal(
      () => {
        return DatadogTraces.agentPayloadToOtlp(Buffer.from("not protobuf"));
      },
      400,
      "AgentPayload",
    );
  });

  test("more spans, tags, links and events than the limit is a 413, counted before anything is decoded", () => {
    // One span with half a million and one empty meta entries: two bytes each.
    const span: Buffer = Buffer.alloc((DATADOG_PROTOBUF_MAX_ELEMENTS + 1) * 2);

    for (let index: number = 0; index < span.length; index += 2) {
      span[index] = 0x52; // field 10 (meta), length-delimited
      span[index + 1] = 0x00;
    }

    const body: Buffer = lengthDelimited(
      5,
      lengthDelimited(6, lengthDelimited(3, span)),
    );
    const decode: jest.SpyInstance = jest.spyOn(
      DatadogAgentPayloadAsRead,
      "decode",
    );

    try {
      expectRefusal(
        () => {
          return DatadogTraces.agentPayloadToOtlp(body);
        },
        413,
        "AgentPayload holds more than",
      );
      expect(decode).not.toHaveBeenCalled();
    } finally {
      decode.mockRestore();
    }
  });

  test("a v1 attribute nested past the limit is a 400, not a stack overflow", () => {
    // An AnyValue holding an array holding an AnyValue ..., 40 deep.
    let anyValue: Buffer = Buffer.from([0x08, 0x00]);

    for (let depth: number = 0; depth < AGENT_PAYLOAD_MAX_DEPTH; depth++) {
      anyValue = lengthDelimited(6, lengthDelimited(1, anyValue));
    }

    const entry: Buffer = Buffer.concat([
      Buffer.from([0x08, 0x01]),
      lengthDelimited(2, anyValue),
    ]);
    const body: Buffer = lengthDelimited(11, lengthDelimited(10, entry));

    expectRefusal(() => {
      return DatadogTraces.agentPayloadToOtlp(body);
    }, 400);
  });

  test("spans past the cap of a request are dropped and counted", () => {
    const spans: Array<Encodable> = [];

    for (
      let index: number = 0;
      index < MAX_DATADOG_SPANS_PER_REQUEST + 5;
      index++
    ) {
      spans.push([1, 1, 1, 9, index + 1, 0, 1, 1, 0, new Map(), new Map(), 0]);
    }

    const translation: DatadogTracesTranslation =
      DatadogTraces.tracerTracesToOtlp(encodeMsgpack([["", "svc"], [spans]]), {
        protocol: "v0.5",
        nowInMs: NOW_MS,
      });

    expect(translation.spanCount).toBe(MAX_DATADOG_SPANS_PER_REQUEST);
    expect(translation.droppedSpanCount).toBe(5);
  });
});

describe("DatadogTraces.tracerTracesToOtlp: a tracer's own endpoints", () => {
  const goSpan: (overrides?: Record<string, Encodable>) => Encodable = (
    overrides?: Record<string, Encodable>,
  ): Encodable => {
    return {
      service: "orders",
      name: "http.request",
      resource: "GET /orders",
      trace_id: BigInt("4611686018427387904"),
      span_id: 1234,
      parent_id: 0,
      start: BigInt(START),
      duration: 4000000,
      error: 0,
      meta: {
        "span.kind": "server",
        "http.method": "GET",
        "http.status_code": "200",
        "_dd.p.tid": "6553f10000000000",
        env: "prod",
        version: "3.1.0",
        language: "go",
        "runtime-id": "go-runtime-1",
      },
      metrics: { _sampling_priority_v1: 1, "_dd.top_level": 1 },
      type: "web",
      ...overrides,
    };
  };

  test("v0.4 MessagePack, as dd-trace-go writes it: integers in their smallest form", () => {
    const body: Buffer = encodeMsgpack([
      [goSpan(), goSpan({ span_id: 1235, parent_id: 1234, resource: "" })],
    ]);
    const translation: DatadogTracesTranslation =
      DatadogTraces.tracerTracesToOtlp(body, {
        protocol: "v0.4",
        nowInMs: NOW_MS,
        tracer: {
          language: "go",
          languageVersion: "go1.22.5",
          tracerVersion: "v1.70.1",
          containerId: "c0ffee",
        },
      });
    const spans: Array<FlatSpan> = spansOf(translation);
    const root: FlatSpan = bySpanId(spans, hex16("1234"));
    const child: FlatSpan = bySpanId(spans, hex16("1235"));

    expect(root.span["traceId"]).toBe(
      `6553f10000000000${hex16("4611686018427387904")}`,
    );
    expect(child.span["traceId"]).toBe(root.span["traceId"]);
    expect(child.span["parentSpanId"]).toBe(hex16("1234"));
    // A span with no resource is named by its operation.
    expect(child.span["name"]).toBe("http.request");
    expect(root.span["name"]).toBe("GET /orders");
    expect(root.span["startTimeUnixNano"]).toBe(START);

    expect(root.resource).toEqual({
      "service.name": "orders",
      "service.version": "3.1.0",
      "deployment.environment.name": "prod",
      "container.id": "c0ffee",
      "service.instance.id": "go-runtime-1",
      "telemetry.sdk.name": "datadog",
      "telemetry.sdk.language": "go",
      "telemetry.sdk.version": "v1.70.1",
      "process.runtime.version": "go1.22.5",
    });
    expect(root.attributes["env"]).toBeUndefined();
    expect(root.attributes["_sampling_priority_v1"]).toBeUndefined();
  });

  test("an ID a JVM tracer wrote as a negative int64 is the unsigned ID it stands for", () => {
    const body: Buffer = encodeMsgpack([
      [
        goSpan({
          trace_id: new Int64(BigInt(-2)),
          span_id: new Int64(BigInt(-1)),
          meta: {},
        }),
      ],
    ]);
    const [flat] = spansOf(
      DatadogTraces.tracerTracesToOtlp(body, {
        protocol: "v0.4",
        nowInMs: NOW_MS,
      }),
    ) as [FlatSpan];

    expect(flat.span["traceId"]).toBe(`0000000000000000fffffffffffffffe`);
    expect(flat.span["spanId"]).toBe("ffffffffffffffff");
    expect(flat.attributes["datadog.span_id"]).toBe("18446744073709551615");
  });

  test("v0.4 native span links and events, as MessagePack maps", () => {
    const body: Buffer = encodeMsgpack([
      [
        goSpan({
          span_links: [
            {
              trace_id: 99,
              trace_id_high: 1,
              span_id: 7,
              attributes: { reason: "retry" },
              flags: 2147483649,
            },
          ],
          span_events: [
            {
              time_unix_nano: BigInt("1700000000124000001"),
              name: "cache.miss",
              attributes: {
                key: { type: 0, string_value: "user:7" },
                n: { type: 2, int_value: 3 },
              },
            },
          ],
        }),
      ],
    ]);
    const [flat] = spansOf(
      DatadogTraces.tracerTracesToOtlp(body, {
        protocol: "v0.4",
        nowInMs: NOW_MS,
      }),
    ) as [FlatSpan];

    expect(flat.span["links"]).toEqual([
      {
        traceId: `${hex16("1")}${hex16("99")}`,
        spanId: hex16("7"),
        flags: 2147483649,
        attributes: [{ key: "reason", value: { stringValue: "retry" } }],
      },
    ]);
    expect(flat.span["events"]).toEqual([
      {
        timeUnixNano: "1700000000124000001",
        name: "cache.miss",
        attributes: [
          { key: "key", value: { stringValue: "user:7" } },
          { key: "n", value: { intValue: "3" } },
        ],
      },
    ]);
  });

  test("v0.3 and v0.4 JSON, as Datadog's API docs send it: big IDs kept to the last digit", () => {
    const body: string = `[[{"duration": 12345, "name": "span_name", "resource": "/home", "service": "service_name", "span_id": 18446744073709551615, "start": 1700000000123456789, "trace_id": 12345678901234567891, "type": "web", "meta": {"http.status_code": 500, "error.message": "boom"}, "error": 1}]]`;

    for (const protocol of ["v0.3", "v0.4"] as const) {
      const [flat] = spansOf(
        DatadogTraces.tracerTracesToOtlp(Buffer.from(body), {
          protocol: protocol,
          isJson: true,
          nowInMs: NOW_MS,
        }),
      ) as [FlatSpan];

      expect(flat.span["spanId"]).toBe("ffffffffffffffff");
      expect(flat.span["traceId"]).toBe(
        `0000000000000000${hex16("12345678901234567891")}`,
      );
      expect(flat.span["startTimeUnixNano"]).toBe("1700000000123456789");
      expect(flat.span["status"]).toEqual({ code: 2, message: "boom" });
      expect(flat.attributes["http.status_code"]).toBe("500");
      expect(flat.attributes["http.response.status_code"]).toEqual({
        int: "500",
      });
      // An error that says only its message still reaches Exceptions.
      expect(
        attributeMap(
          (flat.span["events"] as Array<JSONObject>)[0]!["attributes"],
        ),
      ).toEqual({ "exception.message": "boom" });
    }
  });

  test("v0.5, as dd-trace-py writes it: strings in a dictionary, each span its 12 fields", () => {
    const strings: Array<string> = [
      "",
      "checkout",
      "flask.request",
      "GET /",
      "web",
      "http.method",
      "GET",
      "_dd.p.tid",
      "6553f10000000000",
      "env",
      "prod",
      "_sampling_priority_v1",
      "db.row_count",
    ];
    const span: Array<Encodable> = [
      1,
      2,
      3,
      BigInt("16045690984833335023"),
      BigInt("9876543210987654321"),
      0,
      BigInt(START),
      1500000,
      0,
      new Map<Encodable, Encodable>([
        [5, 6],
        [7, 8],
        [9, 10],
      ]),
      new Map<Encodable, Encodable>([
        [11, 1],
        [12, 3],
      ]),
      4,
    ];
    const [flat] = spansOf(
      DatadogTraces.tracerTracesToOtlp(encodeMsgpack([strings, [[span]]]), {
        protocol: "v0.5",
        nowInMs: NOW_MS,
        tracer: { language: "python", tracerVersion: "2.14.2" },
      }),
    ) as [FlatSpan];

    expect(flat.span["traceId"]).toBe(
      `6553f10000000000${hex16("16045690984833335023")}`,
    );
    expect(flat.span["spanId"]).toBe(hex16("9876543210987654321"));
    expect(flat.span["name"]).toBe("GET /");
    expect(flat.span["kind"]).toBe(2);
    expect(flat.resource["deployment.environment.name"]).toBe("prod");
    expect(flat.resource["telemetry.sdk.language"]).toBe("python");
    expect(flat.attributes).toMatchObject({
      "http.method": "GET",
      "http.request.method": "GET",
      "db.row_count": { int: "3" },
    });
  });

  test("a v0.5 span that names a string the dictionary lacks is a 400, as the trace-agent refuses it", () => {
    const span: Array<Encodable> = [
      1,
      1,
      99,
      1,
      1,
      0,
      1,
      1,
      0,
      new Map(),
      new Map(),
      0,
    ];

    expectRefusal(
      () => {
        return DatadogTraces.tracerTracesToOtlp(
          encodeMsgpack([["", "svc"], [[span]]]),
          { protocol: "v0.5" },
        );
      },
      400,
      "v0.5",
    );
  });

  test("a body that is no traces is a 400; an empty array is no spans", () => {
    expectRefusal(() => {
      return DatadogTraces.tracerTracesToOtlp(encodeMsgpack({ a: 1 }), {
        protocol: "v0.4",
      });
    }, 400);
    expectRefusal(
      () => {
        return DatadogTraces.tracerTracesToOtlp(Buffer.from([0xc1]), {
          protocol: "v0.4",
        });
      },
      400,
      "MessagePack",
    );
    expectRefusal(
      () => {
        return DatadogTraces.tracerTracesToOtlp(Buffer.from("[[{"), {
          protocol: "v0.4",
          isJson: true,
        });
      },
      400,
      "JSON",
    );
    expect(
      DatadogTraces.tracerTracesToOtlp(encodeMsgpack([]), {
        protocol: "v0.4",
      }).traces,
    ).toBeNull();
  });

  test("a MessagePack or JSON body of more values than the limit is a 413, never decoded", () => {
    // An array of a million and ten empty arrays: a byte each.
    const header: Buffer = Buffer.from([0xdd, 0, 0, 0, 0]);
    header.writeUInt32BE(COMPATIBLE_JSON_MAX_VALUES + 10, 1);
    const msgpackBomb: Buffer = Buffer.concat([
      header,
      Buffer.alloc(COMPATIBLE_JSON_MAX_VALUES + 10, 0x90),
    ]);
    const decode: jest.SpyInstance = jest.spyOn(Msgpack, "decode");

    try {
      expectRefusal(
        () => {
          return DatadogTraces.tracerTracesToOtlp(msgpackBomb, {
            protocol: "v0.4",
          });
        },
        413,
        "JSON values",
      );
      expect(decode).not.toHaveBeenCalled();
    } finally {
      decode.mockRestore();
    }

    const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");

    try {
      expectRefusal(() => {
        return DatadogTraces.tracerTracesToOtlp(
          Buffer.from(`[${"[],".repeat(COMPATIBLE_JSON_MAX_VALUES)}[]]`),
          { protocol: "v0.4", isJson: true },
        );
      }, 413);
      expect(parse).not.toHaveBeenCalled();
    } finally {
      parse.mockRestore();
    }
  });
});
