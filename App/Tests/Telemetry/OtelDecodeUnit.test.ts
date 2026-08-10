import { describe, expect, test, beforeAll } from "@jest/globals";
import path from "path";
import protobuf from "protobufjs";
import zlib from "zlib";
import OtelDecode, {
  OtelPayloadFormat,
  gunzipAsync,
} from "../../FeatureSet/Telemetry/Utils/OtelDecode";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";

/*
 * Unit tests for the pure decode module (OtelDecode.decodeBody), which
 * is the ONE decode implementation shared by the inline path
 * (OtelPayloadDecoder.decodeFromQueue) and the worker-thread path
 * (DecodeWorkerThread). The matrix here — every product × format ×
 * encoding — is the same one DecodeWorkerThreadEquivalence.test.ts
 * replays through a real thread; together they pin "one
 * implementation, two call sites" to identical observable behavior.
 *
 * Fixtures are real OTel protobuf messages encoded with the actual
 * proto files shipped in ProtoFiles/OTel/v1 — no hand-rolled bytes
 * (same approach as OtelPayloadDecoderBufferPassthrough.test.ts).
 */

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

const LogsDataType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "logs.proto"))
  .lookupType("LogsData");
const TracesDataType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "traces.proto"))
  .lookupType("TracesData");
const MetricsDataType: protobuf.Type = protobuf
  .loadSync(path.join(PROTO_DIR, "metrics.proto"))
  .lookupType("MetricsData");

/*
 * Fixture payloads in protobufjs `toJSON()` canonical form (longs as
 * strings, enums as names, bytes as base64) so a full fromObject ->
 * encode -> decode -> toJSON round-trip reproduces them verbatim.
 */
const TRACE_ID_BASE64: string = Buffer.from([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]).toString("base64");
const SPAN_ID_BASE64: string = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]).toString(
  "base64",
);

const logsPayload: JSONObject = {
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "checkout-service" } },
        ],
      },
      scopeLogs: [
        {
          scope: { name: "manual-instrumentation", version: "1.2.3" },
          logRecords: [
            {
              timeUnixNano: "1700000000000000000",
              severityNumber: "SEVERITY_NUMBER_INFO",
              severityText: "INFO",
              body: { stringValue: "payment accepted — naïve check ✓" },
              traceId: TRACE_ID_BASE64,
              spanId: SPAN_ID_BASE64,
            },
          ],
        },
      ],
    },
  ],
};

const tracesPayload: JSONObject = {
  resourceSpans: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "api-gateway" } },
        ],
      },
      scopeSpans: [
        {
          scope: { name: "http-server-instrumentation" },
          spans: [
            {
              traceId: TRACE_ID_BASE64,
              spanId: SPAN_ID_BASE64,
              name: "GET /status",
              kind: "SPAN_KIND_SERVER",
              startTimeUnixNano: "1700000000000000000",
              endTimeUnixNano: "1700000001000000000",
              attributes: [
                { key: "http.status_code", value: { intValue: "200" } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const metricsPayload: JSONObject = {
  resourceMetrics: [
    {
      resource: {
        attributes: [
          { key: "service.name", value: { stringValue: "telemetry-worker" } },
        ],
      },
      scopeMetrics: [
        {
          scope: { name: "queue-metrics" },
          metrics: [
            {
              name: "queue.size",
              unit: "1",
              gauge: {
                dataPoints: [
                  { timeUnixNano: "1700000000000000000", asInt: "42" },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

function encodeProtoFixture(
  protoType: protobuf.Type,
  plainPayload: JSONObject,
): Buffer {
  const message: protobuf.Message<Record<string, unknown>> =
    protoType.fromObject(plainPayload);
  return Buffer.from(protoType.encode(message).finish());
}

/*
 * The `as unknown as` cast is type-level only: with TypeScript 5.7+
 * generic typed arrays, the pinned @types/node's `Buffer` no longer
 * structurally satisfies `zlib.InputType` even though a Buffer is a
 * valid zlib input at runtime (same workaround OtelDecode documents).
 */
function gzipCompress(buffer: Buffer): Buffer {
  return zlib.gzipSync(buffer as unknown as Uint8Array);
}

interface MatrixFixture {
  label: string;
  productType: ProductType;
  protoBuffer: Buffer;
  jsonPayload: JSONObject;
}

let matrixFixtures: Array<MatrixFixture> = [];

beforeAll(() => {
  matrixFixtures = [
    {
      label: "logs",
      productType: ProductType.Logs,
      protoBuffer: encodeProtoFixture(LogsDataType, logsPayload),
      jsonPayload: logsPayload,
    },
    {
      label: "traces",
      productType: ProductType.Traces,
      protoBuffer: encodeProtoFixture(TracesDataType, tracesPayload),
      jsonPayload: tracesPayload,
    },
    {
      label: "metrics",
      productType: ProductType.Metrics,
      protoBuffer: encodeProtoFixture(MetricsDataType, metricsPayload),
      jsonPayload: metricsPayload,
    },
  ];
});

describe("OtelDecode.decodeBody — fixture matrix (product × format × encoding)", () => {
  test("protobuf + none: every product decodes to its canonical OTel JSON", async () => {
    for (const fixture of matrixFixtures) {
      const decoded: JSONObject = await OtelDecode.decodeBody({
        productType: fixture.productType,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        body: fixture.protoBuffer,
      });
      expect(decoded).toEqual(fixture.jsonPayload);
    }
  });

  test("protobuf + gzip: every product inflates then decodes identically", async () => {
    for (const fixture of matrixFixtures) {
      const decoded: JSONObject = await OtelDecode.decodeBody({
        productType: fixture.productType,
        format: OtelPayloadFormat.Protobuf,
        encoding: "gzip",
        body: gzipCompress(fixture.protoBuffer),
      });
      expect(decoded).toEqual(fixture.jsonPayload);
    }
  });

  test("json + none: every product parses the raw UTF-8 body", async () => {
    for (const fixture of matrixFixtures) {
      const decoded: JSONObject = await OtelDecode.decodeBody({
        productType: fixture.productType,
        format: OtelPayloadFormat.Json,
        encoding: "none",
        body: Buffer.from(JSON.stringify(fixture.jsonPayload), "utf-8"),
      });
      expect(decoded).toEqual(fixture.jsonPayload);
    }
  });

  test("json + gzip: every product inflates then parses identically", async () => {
    for (const fixture of matrixFixtures) {
      const decoded: JSONObject = await OtelDecode.decodeBody({
        productType: fixture.productType,
        format: OtelPayloadFormat.Json,
        encoding: "gzip",
        body: gzipCompress(
          Buffer.from(JSON.stringify(fixture.jsonPayload), "utf-8"),
        ),
      });
      expect(decoded).toEqual(fixture.jsonPayload);
    }
  });
});

describe("OtelDecode.decodeBody — error and edge cases", () => {
  test("malformed protobuf throws", async () => {
    /*
     * 0x08 declares "field 1, varint" and then the payload ends —
     * protobufjs' reader runs off the end of the buffer.
     */
    await expect(
      OtelDecode.decodeBody({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        body: Buffer.from([0x08]),
      }),
    ).rejects.toThrow();
  });

  test("malformed gzip throws", async () => {
    await expect(
      OtelDecode.decodeBody({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "gzip",
        body: Buffer.from("definitely not a gzip stream", "utf-8"),
      }),
    ).rejects.toThrow(/incorrect header check|unknown compression method/);
  });

  test("malformed JSON throws", async () => {
    await expect(
      OtelDecode.decodeBody({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Json,
        encoding: "none",
        body: Buffer.from("{not json", "utf-8"),
      }),
    ).rejects.toThrow();
  });

  test("empty protobuf body decodes to {} (an empty message is valid)", async () => {
    const decoded: JSONObject = await OtelDecode.decodeBody({
      productType: ProductType.Profiles,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      body: Buffer.alloc(0),
    });
    expect(decoded).toEqual({});
  });

  test("empty JSON body throws (empty string is not valid JSON)", async () => {
    await expect(
      OtelDecode.decodeBody({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Json,
        encoding: "none",
        body: Buffer.alloc(0),
      }),
    ).rejects.toThrow();
  });

  test("protobuf format with a product that has no proto type throws the preserved message", async () => {
    await expect(
      OtelDecode.decodeBody({
        productType: ProductType.SessionReplay,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        body: Buffer.from([]),
      }),
    ).rejects.toThrow(/OtelPayloadDecoder: no proto type/);
  });

  test("json format ignores productType entirely (no proto lookup, no throw)", async () => {
    const decoded: JSONObject = await OtelDecode.decodeBody({
      productType: ProductType.SessionReplay,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      body: Buffer.from(JSON.stringify({ events: [] }), "utf-8"),
    });
    expect(decoded).toEqual({ events: [] });
  });

  test("exported gunzipAsync round-trips (export preserved for existing importers)", async () => {
    const original: Buffer = Buffer.from("hello otel decode", "utf-8");
    const inflated: Buffer = await gunzipAsync(gzipCompress(original));
    expect(inflated.toString("utf-8")).toBe("hello otel decode");
  });
});
