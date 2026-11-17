import protobuf from "protobufjs";
import path from "path";
import { JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * OTLP batches of every shape ingest reads - logs, spans and metric points,
 * with each kind of attribute value, body, event, link, status, data point,
 * temporality and time - as protobufjs `fromObject` takes them. They are
 * sent the two ways an exporter sends OTLP/HTTP:
 *
 *   - as protobuf (`toProtobuf`), the bytes an SDK or a Collector writes;
 *   - as OTLP/JSON (`toOtlpJson`), the JSON an SDK's JSON exporter writes:
 *     64-bit integers as decimal strings, enums as numbers, trace and span
 *     ids as hex and other bytes as base64.
 *
 * Used where ingest has to be shown to store exactly the same rows after a
 * change as before it (IngestRowsByteForByte) and where a decoder has to be
 * shown to read exactly what protobufjs reads (OtlpWireDecoder).
 */

export type OtlpSignal = "logs" | "traces" | "metrics";

const PROTO_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Telemetry/ProtoFiles/OTel/v1",
);

const ROOT_TYPES: Record<OtlpSignal, { file: string; type: string }> = {
  logs: { file: "logs.proto", type: "LogsData" },
  traces: { file: "traces.proto", type: "TracesData" },
  metrics: { file: "metrics.proto", type: "MetricsData" },
};

const types: Map<OtlpSignal, protobuf.Type> = new Map();

export function otlpRootType(signal: OtlpSignal): protobuf.Type {
  let type: protobuf.Type | undefined = types.get(signal);

  if (!type) {
    type = protobuf
      .loadSync(path.join(PROTO_DIR, ROOT_TYPES[signal].file))
      .lookupType(ROOT_TYPES[signal].type);
    types.set(signal, type);
  }

  return type;
}

// 2026-10-17T10:11:12.345678901Z in unix nanoseconds, and times around it.
export const BASE_TIME_NANO: bigint = BigInt("1792231872345678901");

export function nanoAt(offsetNanos: number): string {
  return (BASE_TIME_NANO + BigInt(offsetNanos)).toString();
}

// Deterministic ids: `length` bytes from a seed.
export function idBytes(seed: number, length: number): Buffer {
  const bytes: Buffer = Buffer.alloc(length);

  for (let i: number = 0; i < length; i++) {
    bytes[i] = (seed * 37 + i * 19 + 11) % 256;
  }

  return bytes;
}

type AnyValueInput =
  | string
  | number
  | boolean
  | Buffer
  | null
  | { int: string | number }
  | { double: number }
  | { array: Array<AnyValueInput> }
  | { kvlist: Array<[string, AnyValueInput]> };

export function anyValue(value: AnyValueInput): JSONObject {
  if (value === null) {
    return {};
  }

  if (typeof value === "string") {
    return { stringValue: value };
  }

  if (typeof value === "boolean") {
    return { boolValue: value };
  }

  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: value }
      : { doubleValue: value };
  }

  if (Buffer.isBuffer(value)) {
    return { bytesValue: value as unknown as JSONValue };
  }

  if ("int" in value) {
    return { intValue: value.int };
  }

  if ("double" in value) {
    return { doubleValue: value.double };
  }

  if ("array" in value) {
    return {
      arrayValue: {
        values: value.array.map((item: AnyValueInput) => {
          return anyValue(item);
        }),
      },
    };
  }

  return {
    kvlistValue: {
      values: value.kvlist.map(([key, item]: [string, AnyValueInput]) => {
        return { key: key, value: anyValue(item) };
      }),
    },
  };
}

export function kv(key: string, value: AnyValueInput): JSONObject {
  return { key: key, value: anyValue(value) };
}

/*
 * Accents, a dash, CJK, an emoji (a surrogate pair), the line separator
 * U+2028, quotes and a backslash.
 */
const UNICODE_TEXT: string = [
  "naïve café – 日本語 🚀 ",
  String.fromCharCode(0x2028),
  ' "quoted" \\ back',
].join("");

// Every kind of attribute value OTLP has, on one list.
export function everyAttributeKind(prefix: string): Array<JSONObject> {
  return [
    kv(`${prefix}.string`, "plain text"),
    kv(`${prefix}.unicode`, UNICODE_TEXT),
    kv(`${prefix}.empty_string`, ""),
    kv(`${prefix}.bool_true`, true),
    kv(`${prefix}.bool_false`, false),
    kv(`${prefix}.int`, 200),
    kv(`${prefix}.int_negative`, { int: -42 }),
    kv(`${prefix}.int_zero`, { int: 0 }),
    kv(`${prefix}.int_big`, { int: "9007199254740993" }),
    kv(`${prefix}.int_min`, { int: "-9223372036854775808" }),
    kv(`${prefix}.double`, 3.25),
    kv(`${prefix}.double_whole`, { double: 2 }),
    kv(`${prefix}.double_negative`, { double: -0.001 }),
    kv(`${prefix}.bytes`, Buffer.from([0, 1, 2, 250, 251, 252, 253])),
    kv(`${prefix}.empty_value`, null),
    kv(`${prefix}.array`, {
      array: ["a", 1, true, { double: 1.5 }, { array: ["nested"] }],
    }),
    kv(`${prefix}.empty_array`, { array: [] }),
    kv(`${prefix}.map`, {
      kvlist: [
        ["inner", "value"],
        ["count", 7],
        ["deeper", { kvlist: [["leaf", false]] }],
        ["list", { array: [1, 2] }],
      ],
    }),
    kv(`${prefix}.empty_map`, { kvlist: [] }),
  ];
}

export function resource(
  serviceName: string,
  extra: Array<JSONObject> = [],
): JSONObject {
  return {
    attributes: [
      kv("service.name", serviceName),
      kv("service.version", "1.4.2"),
      kv("deployment.environment", "production"),
      kv("telemetry.sdk.language", "nodejs"),
      ...extra,
    ],
    droppedAttributesCount: 1,
  };
}

export function scope(name: string, withAttributes: boolean): JSONObject {
  return {
    name: name,
    version: "0.98.0",
    ...(withAttributes
      ? { attributes: [kv("scope.attr", "on the scope")] }
      : {}),
  };
}

const STACK_TRACE: string =
  "TypeError: Cannot read properties of undefined (reading 'id')\n" +
  "    at handler (/app/orders.js:12:5)\n" +
  "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)";

export function logsShapes(): JSONObject {
  const severities: Array<[number, string]> = [
    [0, ""],
    [1, "TRACE"],
    [5, "DEBUG"],
    [9, "INFO"],
    [10, "INFO2"],
    [13, "WARN"],
    [17, "ERROR"],
    [21, "FATAL"],
    [0, "warning"],
    [0, "Error"],
  ];

  const records: Array<JSONObject> = [];

  severities.forEach(([number, text]: [number, string], i: number) => {
    records.push({
      timeUnixNano: nanoAt(i * 333_333_333),
      observedTimeUnixNano: nanoAt(i * 333_333_333 + 7),
      severityNumber: number,
      severityText: text,
      body: anyValue(
        `request ${i} served in ${i * 3} ms for ada.lovelace@example.com`,
      ),
      attributes: [
        kv("logger", "orders"),
        kv("thread", `worker-${i % 4}`),
        kv("password", `hunter${i}`),
      ],
      traceId: i % 2 === 0 ? idBytes(200 + i, 16) : Buffer.alloc(0),
      spanId: i % 2 === 0 ? idBytes(300 + i, 8) : Buffer.alloc(0),
      flags: i % 2,
      droppedAttributesCount: i % 3,
    });
  });

  // Bodies of every kind.
  const bodies: Array<AnyValueInput> = [
    {
      kvlist: [
        ["msg", "a map body"],
        [
          "user",
          {
            kvlist: [
              ["email", "x@y.io"],
              ["token", "abc"],
            ],
          },
        ],
      ],
    },
    { array: ["a list body", 1, { kvlist: [["k", "v"]] }] },
    42,
    { double: 0.5 },
    true,
    Buffer.from("raw bytes body"),
    null,
    "",
    '{"json":"line","password":"p@ss","n":5}',
    "multi\nline\tbody with \u0000 a nul",
  ];

  bodies.forEach((body: AnyValueInput, i: number) => {
    records.push({
      timeUnixNano: nanoAt(10_000_000_000 + i),
      severityNumber: 9,
      severityText: "INFO",
      body: anyValue(body),
      attributes: everyAttributeKind(`body${i}`).slice(0, 4 + (i % 5)),
    });
  });

  // Times: only an observed time, neither, zero, and one past 2^53.
  records.push({
    observedTimeUnixNano: nanoAt(20_000_000_000),
    severityNumber: 13,
    body: anyValue("only an observed time"),
  });
  records.push({
    severityNumber: 9,
    body: anyValue("no time at all"),
  });
  records.push({
    timeUnixNano: "0",
    observedTimeUnixNano: nanoAt(21_000_000_000),
    body: anyValue("a zero time and an observed time"),
  });
  records.push({
    timeUnixNano: "1",
    body: anyValue("one nanosecond after the epoch"),
  });

  // Every attribute kind on one record, and an event name.
  records.push({
    timeUnixNano: nanoAt(30_000_000_000),
    severityNumber: 9,
    body: anyValue("every attribute kind"),
    attributes: everyAttributeKind("attr"),
    eventName: "browser.page_view",
  });

  // Exceptions: explicit exception.* attributes, and a stack in an error body.
  records.push({
    timeUnixNano: nanoAt(40_000_000_000),
    severityNumber: 17,
    severityText: "ERROR",
    body: anyValue("payment failed"),
    attributes: [
      kv("exception.type", "PaymentDeclinedError"),
      kv("exception.message", "card 4111 1111 1111 1111 declined"),
      kv("exception.stacktrace", STACK_TRACE),
      kv("exception.escaped", true),
      kv("session.id", "sess-123"),
    ],
    traceId: idBytes(901, 16),
    spanId: idBytes(902, 8),
  });
  records.push({
    timeUnixNano: nanoAt(41_000_000_000),
    severityNumber: 21,
    body: anyValue(`Unhandled rejection\n${STACK_TRACE}`),
  });

  return {
    resourceLogs: [
      {
        resource: resource("checkout", [kv("host.name", "Web-01")]),
        scopeLogs: [
          { scope: scope("filelog", true), logRecords: records.slice(0, 12) },
          {
            scope: scope("app.logger", false),
            logRecords: records.slice(12),
            schemaUrl: "https://opentelemetry.io/schemas/1.21.0",
          },
        ],
        schemaUrl: "https://opentelemetry.io/schemas/1.21.0",
      },
      {
        resource: resource("payments", everyAttributeKind("res")),
        scopeLogs: [{ logRecords: records.slice(0, 3) }],
      },
      {
        // No resource at all, and a scope with nothing in it.
        scopeLogs: [{ scope: {}, logRecords: records.slice(3, 5) }],
      },
    ],
  };
}

export function tracesShapes(): JSONObject {
  const spans: Array<JSONObject> = [];

  for (let i: number = 0; i < 24; i++) {
    const isError: boolean = i % 5 === 0;
    spans.push({
      traceId: idBytes(10 + Math.floor(i / 4), 16),
      spanId: idBytes(100 + i, 8),
      parentSpanId: i % 4 === 0 ? Buffer.alloc(0) : idBytes(100 + i - 1, 8),
      traceState: i % 6 === 0 ? "vendor=value,other=x" : "",
      flags: i % 3 === 0 ? 257 : 1,
      name:
        i % 4 === 0
          ? "GET /api/orders/{id}"
          : `SELECT orders WHERE email = 'ada${i}@example.com'`,
      // Every kind, and one this release does not know (7).
      kind: [0, 1, 2, 3, 4, 5, 7][i % 7],
      startTimeUnixNano: nanoAt(i * 1_000_000_000),
      endTimeUnixNano: nanoAt(i * 1_000_000_000 + 2_345_678 + i),
      attributes: [
        kv("http.method", "GET"),
        kv("http.status_code", isError ? 500 : 200),
        kv("db.system", "postgresql"),
        kv("retry", i % 2 === 0),
        kv("authorization", `Bearer secret-${i}`),
        ...(i === 3 ? everyAttributeKind("span") : []),
      ],
      droppedAttributesCount: i % 2,
      events:
        i % 4 === 0
          ? [
              {
                timeUnixNano: nanoAt(i * 1_000_000_000 + 1_000),
                name: "exception",
                attributes: [
                  kv("exception.type", i % 8 === 0 ? "TypeError" : "Error"),
                  kv(
                    "exception.message",
                    `Cannot read properties of undefined (reading 'id') #${i} for ada@example.com`,
                  ),
                  kv("exception.stacktrace", STACK_TRACE),
                  kv("exception.escaped", i % 8 === 0),
                ],
              },
              {
                timeUnixNano: nanoAt(i * 1_000_000_000 + 2_000),
                name: "cache.miss",
                attributes: [kv("key", "orders:1")],
                droppedAttributesCount: 2,
              },
            ]
          : i % 4 === 1
            ? [{ timeUnixNano: nanoAt(i * 1_000_000_000 + 5), name: "tick" }]
            : [],
      droppedEventsCount: i % 4 === 1 ? 3 : 0,
      links:
        i % 3 === 0
          ? [
              {
                traceId: idBytes(99, 16),
                spanId: idBytes(98, 8),
                traceState: "linked=1",
                attributes: [
                  kv("link.reason", "follows from ada@example.com"),
                  kv("token", "abc"),
                ],
                flags: 1,
                droppedAttributesCount: 1,
              },
              { traceId: idBytes(97, 16), spanId: idBytes(96, 8) },
            ]
          : [],
      droppedLinksCount: i % 3 === 0 ? 1 : 0,
      status: isError
        ? { code: 2, message: `failed for ada${i}@example.com` }
        : i % 5 === 1
          ? { code: 1 }
          : i % 5 === 2
            ? {}
            : { code: 0, message: "unset with a message" },
    });
  }

  return {
    resourceSpans: [
      {
        resource: resource("checkout", [kv("k8s.namespace.name", "shop")]),
        scopeSpans: [
          {
            scope: scope("@opentelemetry/instrumentation-http", true),
            spans: spans.slice(0, 16),
          },
          { scope: scope("pg", false), spans: spans.slice(16), schemaUrl: "s" },
        ],
        schemaUrl: "https://opentelemetry.io/schemas/1.21.0",
      },
      {
        resource: resource("cart", everyAttributeKind("res")),
        scopeSpans: [{ spans: spans.slice(0, 2) }],
      },
    ],
  };
}

export function metricsShapes(): JSONObject {
  const gaugePoints: Array<JSONObject> = [];

  for (let i: number = 0; i < 12; i++) {
    gaugePoints.push({
      timeUnixNano: nanoAt(i * 250_000_000),
      startTimeUnixNano: nanoAt(-60_000_000_000),
      ...(i % 3 === 0
        ? { asInt: String(i * 1000 - 3000) }
        : { asDouble: i * 1.25 }),
      attributes: [kv("cpu", String(i % 4)), kv("state", "user")],
      flags: i === 11 ? 1 : 0,
    });
  }

  const exemplar: JSONObject = {
    timeUnixNano: nanoAt(1_000),
    asDouble: 1.2,
    traceId: idBytes(1, 16),
    spanId: idBytes(2, 8),
    filteredAttributes: [kv("user.id", "u-1")],
  };

  const metrics: Array<JSONObject> = [
    {
      name: "system.cpu.utilization",
      description: "CPU in use",
      unit: "1",
      gauge: { dataPoints: gaugePoints },
    },
    {
      name: "http.server.requests",
      unit: "{request}",
      sum: {
        aggregationTemporality: 2,
        isMonotonic: true,
        dataPoints: [
          {
            timeUnixNano: nanoAt(0),
            startTimeUnixNano: "1792231800000000000",
            asInt: "1234",
            attributes: [kv("http.route", "/api/orders"), kv("code", 200)],
            exemplars: [{ ...exemplar, asInt: "3" }],
          },
          {
            timeUnixNano: nanoAt(999_999_999),
            startTimeUnixNano: "0",
            asInt: "7",
          },
        ],
      },
    },
    {
      name: "queue.depth.delta",
      sum: {
        aggregationTemporality: 1,
        isMonotonic: false,
        dataPoints: [
          { timeUnixNano: nanoAt(5), asDouble: -2.5 },
          { timeUnixNano: nanoAt(6), asDouble: 0 },
        ],
      },
    },
    {
      name: "temporality.unspecified",
      sum: { dataPoints: [{ timeUnixNano: nanoAt(7), asInt: "1" }] },
    },
    {
      name: "http.server.duration",
      unit: "s",
      histogram: {
        aggregationTemporality: 1,
        dataPoints: [
          {
            timeUnixNano: nanoAt(0),
            startTimeUnixNano: nanoAt(-10_000_000_000),
            count: "6",
            sum: 2.5,
            min: 0.01,
            max: 1.2,
            bucketCounts: ["1", "2", "3"],
            explicitBounds: [0.1, 0.5],
            exemplars: [exemplar],
            attributes: [kv("http.route", "/api/orders")],
          },
          {
            timeUnixNano: nanoAt(1),
            count: "0",
            bucketCounts: [],
            explicitBounds: [],
          },
        ],
      },
    },
    {
      name: "http.client.duration",
      histogram: {
        aggregationTemporality: 2,
        dataPoints: [
          {
            timeUnixNano: nanoAt(2),
            startTimeUnixNano: nanoAt(-1),
            count: "18446744073709551615",
            sum: 1e300,
            bucketCounts: ["18446744073709551615", "0"],
            explicitBounds: [1],
          },
        ],
      },
    },
    {
      name: "rpc.latency",
      unit: "ms",
      exponentialHistogram: {
        aggregationTemporality: 2,
        dataPoints: [
          {
            timeUnixNano: nanoAt(0),
            startTimeUnixNano: nanoAt(-5_000_000_000),
            count: "4",
            sum: 40,
            scale: 2,
            zeroCount: "1",
            zeroThreshold: 0.001,
            positive: { offset: 3, bucketCounts: ["1", "2"] },
            negative: { offset: -2, bucketCounts: ["4"] },
            min: 0.5,
            max: 30,
            exemplars: [exemplar],
          },
          {
            timeUnixNano: nanoAt(3),
            count: "0",
            scale: -1,
            positive: {},
          },
        ],
      },
    },
    {
      name: "gc.pause",
      unit: "s",
      summary: {
        dataPoints: [
          {
            timeUnixNano: nanoAt(-1),
            startTimeUnixNano: nanoAt(-2_000_000_000),
            count: "10",
            sum: 1.25,
            quantileValues: [
              { quantile: 0.5, value: 0.1 },
              { quantile: 0.99, value: 0.4 },
              { quantile: 1 },
            ],
            attributes: [kv("gc", "major")],
          },
        ],
      },
    },
    { name: "a.metric.with.no.data" },
  ];

  return {
    resourceMetrics: [
      {
        resource: resource("checkout", [kv("host.name", "web-01")]),
        scopeMetrics: [
          { scope: scope("hostmetrics", true), metrics: metrics.slice(0, 5) },
          { scope: scope("app.meter", false), metrics: metrics.slice(5) },
        ],
      },
      {
        resource: resource("cart", everyAttributeKind("res")),
        scopeMetrics: [{ metrics: metrics.slice(0, 2), schemaUrl: "s" }],
      },
    ],
  };
}

export function otlpShapes(signal: OtlpSignal): JSONObject {
  if (signal === "logs") {
    return logsShapes();
  }

  if (signal === "traces") {
    return tracesShapes();
  }

  return metricsShapes();
}

/*
 * The protobuf bytes an exporter sends for `payload`. Not verified first:
 * the fixtures send an enum number this release does not name, as a newer
 * SDK may.
 */
export function toProtobuf(signal: OtlpSignal, payload: JSONObject): Buffer {
  const type: protobuf.Type = otlpRootType(signal);

  return Buffer.from(type.encode(type.fromObject(payload)).finish());
}

const HEX_ID_KEYS: Set<string> = new Set(["traceId", "spanId", "parentSpanId"]);

/*
 * The OTLP/JSON text an exporter sends for `payload` (protojson, with OTLP's
 * one exception: trace and span ids in hex). 64-bit integers are decimal
 * strings and enums numbers; other bytes are base64.
 */
export function toOtlpJson(signal: OtlpSignal, payload: JSONObject): string {
  const type: protobuf.Type = otlpRootType(signal);
  const message: protobuf.Message = type.fromObject(payload);
  const plain: JSONObject = type.toObject(message, {
    longs: String,
    enums: Number,
    bytes: String,
    json: true,
  }) as JSONObject;

  return JSON.stringify(plain, (key: string, value: unknown): unknown => {
    if (HEX_ID_KEYS.has(key) && typeof value === "string") {
      return Buffer.from(value, "base64").toString("hex");
    }

    return value;
  });
}
