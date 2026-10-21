import {
  OBI_NODEJS_INSPECTOR_PORT,
  collectObiNodeInspectorRequestSpans,
  isObiNodeInspectorRequestSpan,
  isObiNodeInspectorSpan,
  obiNodeInspectorSpanKey,
} from "../../FeatureSet/Telemetry/Utils/ObiNodeInspectorSpan";
import { SpanKind } from "Common/Models/AnalyticsModels/Span";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import fs from "fs";
import path from "path";
import protobuf from "protobufjs";
import { describe, expect, test } from "@jest/globals";

/*
 * OBI v0.14 injects its Node.js agent through the app's inspector AFTER the
 * process is in its PID filter (OBI #3363), so its own GET /json/version,
 * GET /json/list and WebSocket upgrade on 127.0.0.1:9229 come back as the
 * app's SERVER spans, with "in queue" / "processing" children. These pin
 * which spans the ingest service drops: exactly those, and nothing that
 * differs from them in any one condition.
 *
 * Span attributes are the maps the ingest service builds: span keys bare,
 * as OBI v0.14.0 wrote them on the captured spans (int64 values as
 * OTLP/JSON strings), resource keys `resource.`-prefixed.
 */

type Attributes = Record<string, unknown>;

const OBI_DISTRO: string = "opentelemetry-ebpf-instrumentation";

const OBI_RESOURCE: Attributes = {
  "resource.service.name": "downstream",
  "resource.service.namespace": "shop",
  "resource.telemetry.sdk.language": "nodejs",
  "resource.telemetry.distro.name": OBI_DISTRO,
  "resource.telemetry.distro.version": "v0.14.0",
  "resource.k8s.namespace.name": "shop",
};

const TARGET_PATH: string = "/06aa0bc1-f07e-4016-b228-7d687ac99626";

// OBI v0.14.0's GET /json/list, as captured on KinD (see the fixture).
function jsonList(overrides: Attributes = {}): Attributes {
  return {
    ...OBI_RESOURCE,
    "server.port": "9229",
    "client.address": "127.0.0.1",
    "server.address": "downstream",
    "http.response.status_code": "200",
    "http.request.method": "GET",
    "url.path": "/json/list",
    "url.scheme": "http",
    "http.route": "/json/list",
    "network.peer.address": "127.0.0.1",
    "network.peer.port": "48486",
    "network.protocol.version": "1.1",
    "span.metrics.skip": true,
    ...overrides,
  };
}

// The WebSocket upgrade that follows it on the same connection.
function upgrade(overrides: Attributes = {}): Attributes {
  return jsonList({
    "http.response.status_code": "101",
    "url.path": TARGET_PATH,
    "http.route": "/*",
    ...overrides,
  });
}

function without(attributes: Attributes, ...keys: Array<string>): Attributes {
  const copy: Attributes = { ...attributes };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

type RequestSpan = {
  kind: SpanKind;
  parentSpanId: string;
  attributes: Attributes | null | undefined;
};

function server(
  attributes: Attributes | null | undefined,
  parentSpanId: string = "",
): RequestSpan {
  return {
    kind: SpanKind.Server,
    parentSpanId: parentSpanId,
    attributes: attributes,
  };
}

function long(value: number): protobuf.Long {
  return protobuf.util.LongBits.fromNumber(value).toLong();
}

describe("isObiNodeInspectorRequestSpan: OBI's inspector requests are matched", () => {
  test("OBI v0.14.0's GET /json/list and WebSocket upgrade, as captured", () => {
    expect(isObiNodeInspectorRequestSpan(server(jsonList()))).toBe(true);
    expect(isObiNodeInspectorRequestSpan(server(upgrade()))).toBe(true);
  });

  test("the inspector port is 9229", () => {
    expect(OBI_NODEJS_INSPECTOR_PORT).toBe(9229);
  });

  test("GET /json/version and GET /json/list whatever answered them, or nothing", () => {
    for (const urlPath of ["/json/version", "/json/list"]) {
      for (const status of ["200", "404", "400", "500", 200, undefined]) {
        const attributes: Attributes =
          status === undefined
            ? without(
                jsonList({ "url.path": urlPath }),
                "http.response.status_code",
              )
            : jsonList({
                "url.path": urlPath,
                "http.response.status_code": status,
              });
        expect({
          urlPath: urlPath,
          status: status,
          matched: isObiNodeInspectorRequestSpan(server(attributes)),
        }).toEqual({ urlPath: urlPath, status: status, matched: true });
      }
    }
  });

  test("server.port as an OTLP/JSON string, a number, a bigint or a protobufjs Long", () => {
    for (const port of [
      "9229",
      9229,
      BigInt(9229),
      long(9229),
    ] as Array<unknown>) {
      expect(
        isObiNodeInspectorRequestSpan(
          server(jsonList({ "server.port": port })),
        ),
      ).toBe(true);
    }
  });

  test("the upgrade's status as a string, a number, a bigint or a Long", () => {
    for (const status of [
      "101",
      101,
      BigInt(101),
      long(101),
    ] as Array<unknown>) {
      expect(
        isObiNodeInspectorRequestSpan(
          server(upgrade({ "http.response.status_code": status })),
        ),
      ).toBe(true);
    }
  });

  test("a loopback client in every form: 127.0.0.0/8, ::1, IPv4-mapped in either case", () => {
    for (const client of [
      "127.0.0.1",
      "127.0.0.2",
      "127.255.255.254",
      "::1",
      "::ffff:127.0.0.1",
      "::FFFF:127.0.0.1",
      "::ffff:127.1.2.3",
    ]) {
      expect({
        client: client,
        matched: isObiNodeInspectorRequestSpan(
          server(upgrade({ "client.address": client })),
        ),
      }).toEqual({ client: client, matched: true });
    }
  });

  test("network.peer.address stands in for an absent client.address", () => {
    expect(
      isObiNodeInspectorRequestSpan(
        server(without(jsonList(), "client.address")),
      ),
    ).toBe(true);
    expect(
      isObiNodeInspectorRequestSpan(
        server(
          without(
            jsonList({ "network.peer.address": "::ffff:127.0.0.1" }),
            "client.address",
          ),
        ),
      ),
    ).toBe(true);
    expect(
      isObiNodeInspectorRequestSpan(
        server(
          without(
            jsonList({ "network.peer.address": "10.244.0.9" }),
            "client.address",
          ),
        ),
      ),
    ).toBe(false);
  });

  test("the target UUID in upper case", () => {
    expect(
      isObiNodeInspectorRequestSpan(
        server(upgrade({ "url.path": TARGET_PATH.toUpperCase() })),
      ),
    ).toBe(true);
  });

  test("whatever http.route and the span name say (they follow the routes settings, url.path does not)", () => {
    expect(
      isObiNodeInspectorRequestSpan(server(jsonList({ "http.route": "/**" }))),
    ).toBe(true);
    expect(
      isObiNodeInspectorRequestSpan(server(without(upgrade(), "http.route"))),
    ).toBe(true);
  });
});

describe("isObiNodeInspectorRequestSpan: one condition off and the span is kept", () => {
  const kept: Array<[string, RequestSpan]> = [
    // Not OBI's.
    [
      "an SDK span of the same shape",
      server(
        jsonList({
          "resource.telemetry.distro.name": "opentelemetry-js-instrumentation",
        }),
      ),
    ],
    [
      "a resource with no distro",
      server(without(jsonList(), "resource.telemetry.distro.name")),
    ],
    [
      "the distro name in another case",
      server(
        jsonList({
          "resource.telemetry.distro.name":
            "OpenTelemetry-eBPF-Instrumentation",
        }),
      ),
    ],
    [
      "Beyla, which sets its own distro name",
      server(jsonList({ "resource.telemetry.distro.name": "beyla" })),
    ],
    [
      "the distro on the span instead of the resource",
      server({
        ...without(jsonList(), "resource.telemetry.distro.name"),
        "telemetry.distro.name": OBI_DISTRO,
      }),
    ],

    // Not a parentless SERVER span.
    [
      "a CLIENT span (an app calling some :9229)",
      {
        ...server(jsonList()),
        kind: SpanKind.Client,
      },
    ],
    ["an INTERNAL span", { ...server(jsonList()), kind: SpanKind.Internal }],
    ["a PRODUCER span", { ...server(jsonList()), kind: SpanKind.Producer }],
    ["a CONSUMER span", { ...server(jsonList()), kind: SpanKind.Consumer }],
    ["a span with a parent", server(jsonList(), "cc59a1b46d9e2713")],
    ["an upgrade with a parent", server(upgrade(), "cc59a1b46d9e2713")],

    // Not port 9229.
    [
      "Chrome's DevTools port 9222",
      server(jsonList({ "server.port": "9222" })),
    ],
    [
      "an app's own inspector port 9230 (OBI never dials it)",
      server(jsonList({ "server.port": 9230 })),
    ],
    ["port 0", server(jsonList({ "server.port": "0" }))],
    ["a Long 9230", server(jsonList({ "server.port": long(9230) }))],
    ["no server.port", server(without(jsonList(), "server.port"))],
    ["a non-numeric port", server(jsonList({ "server.port": "http" }))],
    ["a port with a fraction", server(jsonList({ "server.port": 9229.5 }))],
    [
      "a port written as a decimal",
      server(jsonList({ "server.port": "9229.0" })),
    ],
    ["a port with spaces", server(jsonList({ "server.port": " 9229" }))],
    ["a port in an array", server(jsonList({ "server.port": [9229] }))],
    ["a null port", server(jsonList({ "server.port": null }))],

    // Not a loopback client.
    [
      "a client in another pod",
      server(jsonList({ "client.address": "10.244.1.7" })),
    ],
    [
      "a client on the node IP",
      server(jsonList({ "client.address": "172.18.0.2" })),
    ],
    [
      "an IPv6 client that is not ::1",
      server(jsonList({ "client.address": "fd00::7" })),
    ],
    [
      "an IPv4-mapped client that is not loopback",
      server(jsonList({ "client.address": "::ffff:10.0.0.1" })),
    ],
    ["128.0.0.1", server(jsonList({ "client.address": "128.0.0.1" }))],
    [
      "a loopback-looking address with a four-digit octet",
      server(jsonList({ "client.address": "127.0.0.1000" })),
    ],
    [
      "a name, even localhost",
      server(jsonList({ "client.address": "localhost" })),
    ],
    [
      "an address with a suffix",
      server(jsonList({ "client.address": "127.0.0.1.nip.io" })),
    ],
    [
      "an address with a port",
      server(jsonList({ "client.address": "127.0.0.1:48486" })),
    ],
    ["an empty client.address", server(jsonList({ "client.address": "" }))],
    [
      "a numeric client.address",
      server(jsonList({ "client.address": 2130706433 })),
    ],
    [
      "a remote client.address with a loopback network.peer.address",
      server(jsonList({ "client.address": "10.244.1.7" })),
    ],
    [
      "no client address of either kind",
      server(without(jsonList(), "client.address", "network.peer.address")),
    ],

    // Not GET.
    ["POST", server(jsonList({ "http.request.method": "POST" }))],
    ["get in lower case", server(jsonList({ "http.request.method": "get" }))],
    ["no method", server(without(jsonList(), "http.request.method"))],

    // Not one of the inspector's paths.
    [
      "an application path on 9229",
      server(jsonList({ "url.path": "/api/items/1" })),
    ],
    [
      "/json, an alias OBI does not use",
      server(jsonList({ "url.path": "/json" })),
    ],
    ["/json/protocol", server(jsonList({ "url.path": "/json/protocol" }))],
    [
      "/json/list with a suffix",
      server(jsonList({ "url.path": "/json/list/extra" })),
    ],
    [
      "/json/list with a trailing slash",
      server(jsonList({ "url.path": "/json/list/" })),
    ],
    ["/JSON/LIST", server(jsonList({ "url.path": "/JSON/LIST" }))],
    ["no url.path", server(without(jsonList(), "url.path"))],
    ["a url.path that is not a string", server(jsonList({ "url.path": 1 }))],

    // Not the upgrade.
    [
      "the target path answered 200",
      server(upgrade({ "http.response.status_code": "200" })),
    ],
    [
      "the target path answered 400",
      server(upgrade({ "http.response.status_code": 400 })),
    ],
    [
      "the target path answered 100, another 1xx",
      server(upgrade({ "http.response.status_code": "100" })),
    ],
    [
      "the target path answered 102, another 1xx",
      server(upgrade({ "http.response.status_code": 102 })),
    ],
    [
      "the target path with no status",
      server(without(upgrade(), "http.response.status_code")),
    ],
    [
      "the target path with a status that is not a number",
      server(upgrade({ "http.response.status_code": "101 Switching" })),
    ],
    [
      "a path that is not a UUID, upgraded",
      server(upgrade({ "url.path": "/socket" })),
    ],
    [
      "a UUID under another segment, upgraded",
      server(upgrade({ "url.path": `/ws${TARGET_PATH}` })),
    ],
    [
      "a UUID with a trailing slash, upgraded",
      server(upgrade({ "url.path": `${TARGET_PATH}/` })),
    ],
    [
      "a UUID without its leading slash, upgraded",
      server(upgrade({ "url.path": TARGET_PATH.slice(1) })),
    ],
    [
      "a UUID one character short, upgraded",
      server(upgrade({ "url.path": TARGET_PATH.slice(0, -1) })),
    ],
    [
      "a UUID-shaped path with a non-hex character, upgraded",
      server(upgrade({ "url.path": `${TARGET_PATH.slice(0, -1)}g` })),
    ],
    ["an upgrade on POST", server(upgrade({ "http.request.method": "POST" }))],
    ["an upgrade on another port", server(upgrade({ "server.port": "3000" }))],
    [
      "an upgrade from another pod",
      server(upgrade({ "client.address": "10.244.1.7" })),
    ],

    // No attributes.
    ["null attributes", server(null)],
    ["undefined attributes", server(undefined)],
    ["empty attributes", server({})],
  ];

  for (const [name, span] of kept) {
    test(`keeps ${name}`, () => {
      expect(isObiNodeInspectorRequestSpan(span)).toBe(false);
    });
  }
});

describe("isObiNodeInspectorSpan: the request spans and their sub-spans", () => {
  const TRACE_ID: string = "d700d4a8ee9e942236077cf53aabf5bb";
  const ROOT_ID: string = "cc59a1b46d9e2713";
  const DROPPED: ReadonlySet<string> = new Set<string>([
    obiNodeInspectorSpanKey(TRACE_ID, ROOT_ID),
  ]);

  type SpanData = Parameters<typeof isObiNodeInspectorSpan>[0];

  function child(overrides: Partial<SpanData> = {}): SpanData {
    return {
      kind: SpanKind.Internal,
      name: "in queue",
      traceId: TRACE_ID,
      spanId: "6b6a5b09dec2b99b",
      parentSpanId: ROOT_ID,
      attributes: { ...OBI_RESOURCE },
      ...overrides,
    };
  }

  test("the request span itself, by its key", () => {
    expect(
      isObiNodeInspectorSpan(
        {
          kind: SpanKind.Server,
          name: "GET /json/list",
          traceId: TRACE_ID,
          spanId: ROOT_ID,
          parentSpanId: "",
          attributes: jsonList(),
        },
        DROPPED,
      ),
    ).toBe(true);
  });

  test('both children OBI writes under it: "in queue" and "processing"', () => {
    expect(isObiNodeInspectorSpan(child(), DROPPED)).toBe(true);
    expect(
      isObiNodeInspectorSpan(
        child({ name: "processing", spanId: "7d8cb605e2f119ee" }),
        DROPPED,
      ),
    ).toBe(true);
  });

  test("nothing at all while the request has no inspector request span", () => {
    expect(isObiNodeInspectorSpan(child(), new Set<string>())).toBe(false);
    expect(
      isObiNodeInspectorSpan(
        {
          kind: SpanKind.Server,
          name: "GET /json/list",
          traceId: TRACE_ID,
          spanId: ROOT_ID,
          parentSpanId: "",
          attributes: jsonList(),
        },
        new Set<string>(),
      ),
    ).toBe(false);
  });

  const kept: Array<[string, Partial<SpanData>]> = [
    ["another parent", { parentSpanId: "71eb8ebd06cb4bc5" }],
    [
      "the same parent span id in another trace",
      { traceId: "112c1d8ede34354a2770f4fa5d3f5660" },
    ],
    ["no parent", { parentSpanId: "" }],
    [
      "another name (the app's own INTERNAL span)",
      { name: "middleware - query" },
    ],
    ['"In queue" in another case', { name: "In queue" }],
    ['"processing " with a trailing space', { name: "processing " }],
    ["SERVER kind", { kind: SpanKind.Server }],
    ["CLIENT kind", { kind: SpanKind.Client }],
    [
      "a resource that is not OBI's",
      {
        attributes: {
          ...OBI_RESOURCE,
          "resource.telemetry.distro.name": "opentelemetry-js-instrumentation",
        },
      },
    ],
    ["no attributes", { attributes: null }],
  ];

  for (const [name, overrides] of kept) {
    test(`keeps a sub-span with ${name}`, () => {
      expect(isObiNodeInspectorSpan(child(overrides), DROPPED)).toBe(false);
    });
  }

  test("keys are trace-scoped: a request span's id in another trace is kept", () => {
    expect(
      isObiNodeInspectorSpan(
        {
          kind: SpanKind.Server,
          name: "GET /ping",
          traceId: "112c1d8ede34354a2770f4fa5d3f5660",
          spanId: ROOT_ID,
          parentSpanId: "",
          attributes: jsonList({ "url.path": "/ping" }),
        },
        DROPPED,
      ),
    ).toBe(false);
  });
});

/*
 * The request-level pre-pass, over OTLP request bodies. The fixture is a
 * real OBI v0.14.0 export: see ObiNodeInspectorSpanIngest.test.ts.
 */
describe("collectObiNodeInspectorRequestSpans", () => {
  const FIXTURE: JSONObject = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "Fixtures", "ObiV014NodeInspectorSpans.json"),
      "utf8",
    ),
  ) as JSONObject;

  // The inspector request spans in the fixture, as `${traceId}/${spanId}`.
  const FIXTURE_REQUEST_SPANS: Array<string> = [
    // downstream: GET /json/list, GET /* (101)
    "d700d4a8ee9e942236077cf53aabf5bb/cc59a1b46d9e2713",
    "c2b9e5adff3ccaa86f7cad5a90a0bb5f/20d56ee82e630d20",
    // app26: GET /json/list, GET /* (101)
    "13a77dcd7cef71ea2b66e868985873c6/9a7c4d6c34e013c9",
    "102945535f227d803fbc0c57452b1c35/4741b135c6e4952b",
    // appinspect (--inspect): GET /json/version, GET /json/list, GET /* (101)
    "eba7a5c6497d229e70f62591e7b1f0af/26cd5ddbe79fdc2f",
    "60c431d69a80c8b460c39555e6d9c38e/25092c30e2b7a499",
    "30615c1d932154884d23fcf6ec082242/69db4226c5f5c0f2",
  ];

  function fixtureCopy(): JSONObject {
    return JSON.parse(JSON.stringify(FIXTURE)) as JSONObject;
  }

  function resourceSpansOf(request: JSONObject): JSONArray {
    return request["resourceSpans"] as JSONArray;
  }

  function spansOf(request: JSONObject): Array<JSONObject> {
    const spans: Array<JSONObject> = [];
    for (const resourceSpan of resourceSpansOf(request)) {
      for (const scopeSpan of resourceSpan["scopeSpans"] as JSONArray) {
        spans.push(...(scopeSpan["spans"] as JSONArray));
      }
    }
    return spans;
  }

  function setDistro(request: JSONObject, distro: string): void {
    for (const resourceSpan of resourceSpansOf(request)) {
      for (const attribute of (resourceSpan["resource"] as JSONObject)[
        "attributes"
      ] as JSONArray) {
        if (attribute["key"] === "telemetry.distro.name") {
          attribute["value"] = { stringValue: distro };
        }
      }
    }
  }

  // The span of a request with this `${traceId}/${spanId}` key.
  function spanIn(request: JSONObject, key: string): JSONObject {
    const span: JSONObject | undefined = spansOf(request).find(
      (candidate: JSONObject): boolean => {
        return (
          `${candidate["traceId"] as string}/${candidate["spanId"] as string}` ===
          key
        );
      },
    );
    expect(span).toBeDefined();
    return span!;
  }

  function attributesOf(span: JSONObject): JSONArray {
    return (span["attributes"] as JSONArray) || [];
  }

  // Calls visit with every attribute of every span of the request.
  function forEachSpanAttribute(
    request: JSONObject,
    visit: (attribute: JSONObject) => void,
  ): void {
    for (const span of spansOf(request)) {
      for (const attribute of attributesOf(span)) {
        visit(attribute);
      }
    }
  }

  test("finds every inspector request span in OBI v0.14.0's export, and nothing else", () => {
    expect(
      [...collectObiNodeInspectorRequestSpans(resourceSpansOf(FIXTURE))].sort(),
    ).toEqual([...FIXTURE_REQUEST_SPANS].sort());
  });

  test("protobuf / gRPC shape: base64 ids, enum names, snake_case int64s", () => {
    const request: JSONObject = fixtureCopy();
    for (const span of spansOf(request)) {
      for (const idKey of ["traceId", "spanId", "parentSpanId"]) {
        if (span[idKey]) {
          span[idKey] = Buffer.from(span[idKey] as string, "hex").toString(
            "base64",
          );
        }
      }
      span["kind"] =
        span["kind"] === 2 ? "SPAN_KIND_SERVER" : "SPAN_KIND_INTERNAL";
      for (const attribute of (span["attributes"] as JSONArray) || []) {
        const value: JSONObject = attribute["value"] as JSONObject;
        if (value["intValue"] !== undefined) {
          attribute["value"] = { int_value: Number(value["intValue"]) };
        }
      }
    }

    expect(
      [...collectObiNodeInspectorRequestSpans(resourceSpansOf(request))].sort(),
    ).toEqual([...FIXTURE_REQUEST_SPANS].sort());
  });

  test("the kind as the string '2'", () => {
    const request: JSONObject = fixtureCopy();
    for (const span of spansOf(request)) {
      span["kind"] = String(span["kind"]);
    }
    expect(
      collectObiNodeInspectorRequestSpans(resourceSpansOf(request)).size,
    ).toBe(FIXTURE_REQUEST_SPANS.length);
  });

  test("the same spans from a resource that is not OBI's are not collected", () => {
    for (const distro of [
      "opentelemetry-js-instrumentation",
      "OpenTelemetry-eBPF-Instrumentation",
      "beyla",
      "",
    ]) {
      const request: JSONObject = fixtureCopy();
      setDistro(request, distro);
      expect({
        distro: distro,
        collected: collectObiNodeInspectorRequestSpans(resourceSpansOf(request))
          .size,
      }).toEqual({ distro: distro, collected: 0 });
    }
  });

  test("OBI's distro name on the spans instead of their resource is not OBI's resource", () => {
    const request: JSONObject = fixtureCopy();
    for (const resourceSpan of resourceSpansOf(request)) {
      const resource: JSONObject = resourceSpan["resource"] as JSONObject;
      resource["attributes"] = (resource["attributes"] as JSONArray).filter(
        (attribute: JSONObject): boolean => {
          return attribute["key"] !== "telemetry.distro.name";
        },
      );
    }
    for (const span of spansOf(request)) {
      span["attributes"] = [
        ...attributesOf(span),
        { key: "telemetry.distro.name", value: { stringValue: OBI_DISTRO } },
      ];
    }

    expect(
      collectObiNodeInspectorRequestSpans(resourceSpansOf(request)).size,
    ).toBe(0);
  });

  test("network.peer.address stands in for an absent client.address, and only then", () => {
    // downstream's GET /json/list carries both, each 127.0.0.1.
    const key: string = FIXTURE_REQUEST_SPANS[0]!;
    function setAddress(
      request: JSONObject,
      attributeKey: string,
      address: string | null,
    ): void {
      const span: JSONObject = spanIn(request, key);
      span["attributes"] = attributesOf(span).filter(
        (attribute: JSONObject): boolean => {
          return attribute["key"] !== attributeKey;
        },
      );
      if (address !== null) {
        (span["attributes"] as JSONArray).push({
          key: attributeKey,
          value: { stringValue: address },
        });
      }
    }

    const peerOnly: JSONObject = fixtureCopy();
    setAddress(peerOnly, "client.address", null);
    expect(
      [
        ...collectObiNodeInspectorRequestSpans(resourceSpansOf(peerOnly)),
      ].sort(),
    ).toEqual([...FIXTURE_REQUEST_SPANS].sort());

    const remotePeerOnly: JSONObject = fixtureCopy();
    setAddress(remotePeerOnly, "client.address", null);
    setAddress(remotePeerOnly, "network.peer.address", "10.244.0.9");
    const remotePeerCollected: Set<string> =
      collectObiNodeInspectorRequestSpans(resourceSpansOf(remotePeerOnly));
    expect(remotePeerCollected.has(key)).toBe(false);
    expect(remotePeerCollected.size).toBe(FIXTURE_REQUEST_SPANS.length - 1);

    // A client in another pod, whatever network.peer.address says.
    const remoteClient: JSONObject = fixtureCopy();
    setAddress(remoteClient, "client.address", "10.244.1.7");
    const remoteClientCollected: Set<string> =
      collectObiNodeInspectorRequestSpans(resourceSpansOf(remoteClient));
    expect(remoteClientCollected.has(key)).toBe(false);
    expect(remoteClientCollected.size).toBe(FIXTURE_REQUEST_SPANS.length - 1);
  });

  test("every scalar AnyValue form TelemetryUtil reads: snake_case strings, and doubles in either case", () => {
    /*
     * Every string as string_value: the resource's distro, and the spans'
     * addresses, method and path.
     */
    const snakeCase: JSONObject = fixtureCopy();
    function toSnakeCase(attribute: JSONObject): void {
      const value: JSONObject = attribute["value"] as JSONObject;
      if (value["stringValue"] !== undefined) {
        attribute["value"] = { string_value: value["stringValue"] };
      }
    }
    for (const resourceSpan of resourceSpansOf(snakeCase)) {
      for (const attribute of (resourceSpan["resource"] as JSONObject)[
        "attributes"
      ] as JSONArray) {
        toSnakeCase(attribute);
      }
    }
    forEachSpanAttribute(snakeCase, toSnakeCase);
    expect(
      [
        ...collectObiNodeInspectorRequestSpans(resourceSpansOf(snakeCase)),
      ].sort(),
    ).toEqual([...FIXTURE_REQUEST_SPANS].sort());

    // server.port and the status as doubles.
    for (const doubleKey of ["doubleValue", "double_value"]) {
      const doubles: JSONObject = fixtureCopy();
      forEachSpanAttribute(doubles, (attribute: JSONObject): void => {
        const value: JSONObject = attribute["value"] as JSONObject;
        if (value["intValue"] !== undefined) {
          attribute["value"] = { [doubleKey]: Number(value["intValue"]) };
        }
      });
      expect({
        doubleKey: doubleKey,
        collected: [
          ...collectObiNodeInspectorRequestSpans(resourceSpansOf(doubles)),
        ].sort(),
      }).toEqual({
        doubleKey: doubleKey,
        collected: [...FIXTURE_REQUEST_SPANS].sort(),
      });
    }

    // A double with a fraction is no port.
    const fraction: JSONObject = fixtureCopy();
    forEachSpanAttribute(fraction, (attribute: JSONObject): void => {
      if (attribute["key"] === "server.port") {
        attribute["value"] = { doubleValue: 9229.5 };
      }
    });
    expect(
      collectObiNodeInspectorRequestSpans(resourceSpansOf(fraction)).size,
    ).toBe(0);
  });

  test("only OBI's resources count when a request mixes them", () => {
    const sdk: JSONObject = fixtureCopy();
    setDistro(sdk, "opentelemetry-js-instrumentation");
    const sdkResourceSpans: JSONArray = resourceSpansOf(sdk).map(
      (resourceSpan: JSONObject): JSONObject => {
        // Other trace ids, so a key collision cannot hide a wrong match.
        for (const scopeSpan of resourceSpan["scopeSpans"] as JSONArray) {
          for (const span of scopeSpan["spans"] as JSONArray) {
            span["traceId"] = "0".repeat(31) + "1";
          }
        }
        return resourceSpan;
      },
    );
    const mixed: JSONArray = [];
    resourceSpansOf(FIXTURE).forEach(
      (resourceSpan: JSONObject, index: number) => {
        mixed.push(sdkResourceSpans[index]!, resourceSpan);
      },
    );

    expect([...collectObiNodeInspectorRequestSpans(mixed)].sort()).toEqual(
      [...FIXTURE_REQUEST_SPANS].sort(),
    );
  });

  test("a request without them collects nothing", () => {
    const request: JSONObject = fixtureCopy();
    const resourceSpans: JSONArray = resourceSpansOf(request).filter(
      (resourceSpan: JSONObject): boolean => {
        return !JSON.stringify(resourceSpan).includes('"9229"');
      },
    );
    expect(resourceSpans.length).toBeGreaterThan(0);
    expect(collectObiNodeInspectorRequestSpans(resourceSpans).size).toBe(0);
  });

  test("a parented, non-SERVER or kind-less span of the same shape is not collected", () => {
    const request: JSONObject = fixtureCopy();
    const spans: Array<JSONObject> = spansOf(request).filter(
      (span: JSONObject): boolean => {
        return FIXTURE_REQUEST_SPANS.includes(
          `${span["traceId"] as string}/${span["spanId"] as string}`,
        );
      },
    );
    expect(spans).toHaveLength(FIXTURE_REQUEST_SPANS.length);
    spans[0]!["parentSpanId"] = "71eb8ebd06cb4bc5";
    spans[1]!["kind"] = 3;
    spans[2]!["kind"] = "SPAN_KIND_CLIENT";
    delete spans[3]!["kind"];
    spans[4]!["kind"] = 0;
    spans[5]!["kind"] = "SPAN_KIND_UNSPECIFIED";

    expect(
      collectObiNodeInspectorRequestSpans(resourceSpansOf(request)).size,
    ).toBe(FIXTURE_REQUEST_SPANS.length - 6);
  });

  test("reads one attribute of a resource that is not OBI's, and no attribute of a span that is not a parentless SERVER span", () => {
    let reads: number = 0;
    function trap(value: JSONObject): JSONObject {
      return new Proxy(value, {
        get: (target: JSONObject, property: string | symbol): unknown => {
          reads++;
          return Reflect.get(target, property);
        },
      });
    }
    const untouchable: () => never = (): never => {
      throw new Error("read a span it had no reason to read");
    };

    const sdkResource: JSONObject = {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "checkout" } },
          {
            key: "telemetry.distro.name",
            value: { stringValue: "opentelemetry-java-instrumentation" },
          },
        ],
      },
    };
    Object.defineProperty(sdkResource, "scopeSpans", { get: untouchable });

    const clientSpan: JSONObject = { kind: 3, parentSpanId: "" };
    Object.defineProperty(clientSpan, "attributes", { get: untouchable });
    const childSpan: JSONObject = { kind: 2, parentSpanId: "cc59a1b46d9e2713" };
    Object.defineProperty(childSpan, "attributes", { get: untouchable });
    const obiResource: JSONObject = {
      resource: {
        attributes: [
          { key: "telemetry.distro.name", value: { stringValue: OBI_DISTRO } },
        ],
      },
      scopeSpans: [{ spans: [clientSpan, childSpan] }],
    };

    expect(
      collectObiNodeInspectorRequestSpans([trap(sdkResource), obiResource])
        .size,
    ).toBe(0);
    // resource, and nothing past the distro check.
    expect(reads).toBe(1);
  });

  test("never throws on a malformed request, and collects what it can read", () => {
    // An OBI resource, so the pre-pass goes on to read what it holds.
    function obi(rest: Record<string, unknown>): Array<unknown> {
      return [
        {
          resource: {
            attributes: [
              {
                key: "telemetry.distro.name",
                value: { stringValue: OBI_DISTRO },
              },
            ],
          },
          ...rest,
        },
      ];
    }
    function obiSpans(spans: Array<unknown>): Array<unknown> {
      return obi({ scopeSpans: [{ spans: spans }] });
    }

    const malformed: Array<unknown> = [
      undefined,
      null,
      {},
      7,
      "resourceSpans",
      [null],
      [1],
      ["x"],
      [{}],
      [{ resource: null }],
      [{ resource: {} }],
      [{ resource: { attributes: "x" } }],
      [{ resource: { attributes: 7 } }],
      [{ resource: { attributes: {} } }],
      [{ resource: { attributes: [null, 1, { key: 1 }, { value: {} }] } }],
      [
        {
          resource: {
            attributes: [{ key: "telemetry.distro.name", value: null }],
          },
        },
      ],
      obi({}),
      obi({ scopeSpans: null }),
      obi({ scopeSpans: 7 }),
      obi({ scopeSpans: {} }),
      obi({ scopeSpans: "x" }),
      obi({
        scopeSpans: [
          null,
          1,
          {},
          { spans: null },
          { spans: 7 },
          { spans: {} },
          { spans: "x" },
          { spans: [null, 1, "x", {}] },
        ],
      }),
      obiSpans([
        { kind: 2, attributes: "x" },
        { kind: 2, attributes: 7 },
        { kind: 2, attributes: {} },
        { kind: 2, attributes: null },
        { kind: 2, attributes: [null, 1, { key: 1 }, { key: "url.path" }] },
        { kind: 2, parentSpanId: 7, attributes: [] },
        { kind: 2, traceId: 7, spanId: {}, attributes: [] },
      ]),
    ];
    for (const resourceSpans of malformed) {
      expect(
        collectObiNodeInspectorRequestSpans(resourceSpans as JSONArray).size,
      ).toBe(0);
    }

    // A readable request span next to unreadable ones is still collected.
    const request: JSONObject = fixtureCopy();
    const firstScope: JSONObject = (
      resourceSpansOf(request)[0]!["scopeSpans"] as JSONArray
    )[0]!;
    (firstScope["spans"] as Array<unknown>).unshift(null, 1, { kind: 2 });
    resourceSpansOf(request).unshift(null as unknown as JSONObject);
    expect(
      collectObiNodeInspectorRequestSpans(resourceSpansOf(request)).size,
    ).toBe(FIXTURE_REQUEST_SPANS.length);
  });

  /*
   * The pre-pass runs over every request before the span loop, without
   * yielding, and reads the attributes of every parentless SERVER span OBI
   * sends. Timed here on a request of 10,000 of an app's requests and their
   * 10,000 "in queue" sub-spans, none of them OBI's own: 50-120 ms in Jest
   * on a development machine (the agent's collector sends at most 200 spans
   * a request). The bound leaves over 15x headroom, so a slow CI machine
   * does not flake; a bound that trips means the pre-pass went from one
   * pass over the request to a pass per span. (process.hrtime, as
   * InfrastructureTopologyScale.test.ts does: monotonic, no wall clock.)
   */
  test("is one pass over the request: 20,000 OBI spans in under 2 s, none of them an inspector request", () => {
    const REQUESTS: number = 10_000;
    const BOUND_MS: number = 2_000;

    const spans: JSONArray = [];
    for (let index: number = 0; index < REQUESTS; index++) {
      const traceId: string = (index + 1).toString(16).padStart(32, "0");
      const requestSpanId: string = (2 * index + 1)
        .toString(16)
        .padStart(16, "0");
      // OBI writes the sub-span ahead of its parent.
      spans.push({
        traceId: traceId,
        spanId: (2 * index + 2).toString(16).padStart(16, "0"),
        parentSpanId: requestSpanId,
        kind: 1,
        name: "in queue",
      });
      spans.push({
        traceId: traceId,
        spanId: requestSpanId,
        kind: 2,
        name: "GET /api/items/:id",
        attributes: [
          { key: "server.port", value: { intValue: "3000" } },
          { key: "client.address", value: { stringValue: "loadgen" } },
          { key: "server.address", value: { stringValue: "app" } },
          { key: "http.response.status_code", value: { intValue: "200" } },
          { key: "http.request.method", value: { stringValue: "GET" } },
          { key: "url.path", value: { stringValue: `/api/items/${index}` } },
          { key: "url.scheme", value: { stringValue: "http" } },
          { key: "http.route", value: { stringValue: "/api/items/:id" } },
          {
            key: "network.peer.address",
            value: { stringValue: "10.244.0.25" },
          },
          { key: "network.peer.port", value: { intValue: "48486" } },
          { key: "network.protocol.version", value: { stringValue: "1.1" } },
        ],
      });
    }
    const resourceSpans: JSONArray = [
      {
        resource: {
          attributes: [
            { key: "service.name", value: { stringValue: "app" } },
            {
              key: "telemetry.distro.name",
              value: { stringValue: OBI_DISTRO },
            },
          ],
        },
        scopeSpans: [{ scope: {}, spans: spans }],
      },
    ];

    const start: bigint = process.hrtime.bigint();
    const collected: Set<string> =
      collectObiNodeInspectorRequestSpans(resourceSpans);
    const elapsedMs: number = Number(process.hrtime.bigint() - start) / 1e6;

    expect(collected.size).toBe(0);
    expect(elapsedMs).toBeLessThan(BOUND_MS);
  });
});
