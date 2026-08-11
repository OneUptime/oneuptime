import { describe, expect, test, beforeAll, beforeEach } from "@jest/globals";
import path from "path";
import protobuf from "protobufjs";
import zlib from "zlib";

/*
 * OtelPayloadDecoder.decodeFromQueue hot-path tests.
 *
 * The decoder used to copy the entire payload Buffer twice per job:
 * once into `new Uint8Array(raw)` before gunzip and once before
 * `protoType.decode(...)`. Node's Buffer IS a Uint8Array subclass —
 * `zlib.gunzip` accepts it directly and protobufjs' `Reader.create`
 * even has a dedicated Buffer fast path (BufferReader) — so both
 * copies were pure waste (two extra full-payload allocations + memcpys
 * per job; tens of MB each for large batches).
 *
 * These tests prove two things:
 *  1. Passthrough: the EXACT Buffer read from the body store (object
 *     identity, not a copy) reaches zlib.gunzip and protobufjs, and
 *     protobufjs takes its BufferReader fast path.
 *  2. Behavioural equivalence: the decoded output is deep-equal to
 *     what the legacy copy-first path produced, for every combination
 *     of format (protobuf/json) and encoding (gzip/none), plus the
 *     missing-body and error edges.
 *
 * The fixtures are real OTel protobuf messages encoded with the actual
 * proto files shipped in ProtoFiles/OTel/v1 — no hand-rolled bytes.
 */

/*
 * Pass-through zlib mock: `gunzip` records exactly what it receives
 * (so we can assert object identity with the stored Buffer) and then
 * delegates to the real implementation. Everything else (gzipSync,
 * gunzipSync, constants, ...) is the real zlib via spread. The mock is
 * registered before OtelPayloadDecoder is imported, so the module-load
 * `promisify(zlib.gunzip)` picks up the recording wrapper.
 */
const mockGunzipReceivedInputs: Array<unknown> = [];

jest.mock("zlib", () => {
  const actualZlib: typeof import("zlib") = jest.requireActual("zlib");
  return {
    ...actualZlib,
    gunzip: (
      buffer: unknown,
      callback: (error: Error | null, result: Buffer) => void,
    ): void => {
      mockGunzipReceivedInputs.push(buffer);
      actualZlib.gunzip(buffer as never, callback);
    },
  };
});

/*
 * In-memory TelemetryBodyStore: `readBody` returns the EXACT Buffer
 * object that was stored (no defensive copy), which is what the real
 * store does (ioredis `getBuffer` hands back a fresh Buffer) and what
 * the identity assertions below rely on. The store itself has its own
 * suite (TelemetryBodyStore.test.ts) — this file only tests decoding.
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

import OtelPayloadDecoder, {
  OtelPayloadFormat,
  gunzipAsync,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";

type SpyLike = {
  mock: {
    calls: Array<Array<unknown>>;
    results: Array<{ type: string; value: unknown }>;
  };
  mockRestore: () => void;
};

/*
 * Load the same proto definitions the decoder itself loads, so the
 * fixtures are encoded with the exact schema the decoder decodes with.
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
 * Fixture payloads are written in protobufjs `toJSON()` canonical form
 * (longs as strings, enums as names, bytes as base64) so a full
 * fromObject -> encode -> decode -> toJSON round-trip reproduces them
 * verbatim — which is exactly what decodeFromQueue emits downstream.
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
          {
            key: "deployment.environment",
            value: { stringValue: "production" },
          },
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
 * The legacy (pre-passthrough) decode path, byte for byte: copy the
 * Buffer into a fresh Uint8Array before handing it to protobufjs.
 * Used as the behaviour-equivalence oracle for the new path.
 */
function legacyCopyDecode(
  protoType: protobuf.Type,
  buffer: Buffer,
): JSONObject {
  return protoType.decode(new Uint8Array(buffer)).toJSON() as JSONObject;
}

/*
 * The legacy gunzip path: copy into a fresh Uint8Array, then inflate.
 * gunzipSync comes from the real zlib (spread through the mock).
 */
function legacyCopyGunzip(gzippedBuffer: Buffer): Buffer {
  return zlib.gunzipSync(new Uint8Array(gzippedBuffer));
}

/*
 * gzip a fixture Buffer. The `as unknown as` cast is type-level only:
 * with TypeScript 5.7+ generic typed arrays, the pinned @types/node's
 * `Buffer` no longer structurally satisfies `zlib.InputType`, even
 * though a Buffer is a perfectly valid zlib input at runtime (same
 * workaround the decoder itself documents).
 */
function gzipCompress(buffer: Buffer): Buffer {
  return zlib.gzipSync(buffer as unknown as Uint8Array);
}

let bodyKeyCounter: number = 0;

function storeBody(buffer: Buffer): string {
  bodyKeyCounter += 1;
  const bodyKey: string = `telemetry:body:test-${bodyKeyCounter}`;
  mockBodyStoreBackingMap.set(bodyKey, buffer);
  return bodyKey;
}

let logsProtoBuffer: Buffer;
let tracesProtoBuffer: Buffer;
let metricsProtoBuffer: Buffer;
let expectedLogsJson: JSONObject;
let expectedTracesJson: JSONObject;
let expectedMetricsJson: JSONObject;

beforeAll(() => {
  logsProtoBuffer = encodeProtoFixture(LogsDataType, logsPayload);
  tracesProtoBuffer = encodeProtoFixture(TracesDataType, tracesPayload);
  metricsProtoBuffer = encodeProtoFixture(MetricsDataType, metricsPayload);

  /*
   * Expected outputs are computed via the legacy copy path — asserting
   * the new passthrough path deep-equals them IS the equivalence proof.
   * These decode calls double as a warm-up: protobufjs compiles each
   * Type's decoder on first use and `Reader.create` replaces itself
   * with its Buffer-aware fast-path variant on first call, so any spy
   * installed later observes the steady-state functions.
   */
  expectedLogsJson = legacyCopyDecode(LogsDataType, logsProtoBuffer);
  expectedTracesJson = legacyCopyDecode(TracesDataType, tracesProtoBuffer);
  expectedMetricsJson = legacyCopyDecode(MetricsDataType, metricsProtoBuffer);
  protobuf.Reader.create(Buffer.alloc(0) as unknown as Uint8Array);
});

beforeEach(() => {
  mockBodyStoreBackingMap.clear();
  mockGunzipReceivedInputs.length = 0;
});

describe("OtelPayloadDecoder.decodeFromQueue — decoding correctness per format/encoding", () => {
  test("protobuf + none: decodes LogsData to the exact OTel JSON shape", async () => {
    const bodyKey: string = storeBody(logsProtoBuffer);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      bodyKey: bodyKey,
    });

    /*
     * The canonical fixture round-trips verbatim (longs/enums/bytes as
     * strings) — this is the shape downstream consumers rely on.
     */
    expect(decoded).toEqual(logsPayload);
    expect(decoded).toEqual(expectedLogsJson);
    // No gzip encoding — the inflate path must not run at all.
    expect(mockGunzipReceivedInputs.length).toBe(0);
  });

  test("protobuf + gzip: inflates then decodes LogsData identically", async () => {
    const gzippedBuffer: Buffer = gzipCompress(logsProtoBuffer);
    const bodyKey: string = storeBody(gzippedBuffer);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "gzip",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(expectedLogsJson);
    expect(mockGunzipReceivedInputs.length).toBe(1);
  });

  test("protobuf + gzip: decodes TracesData (second proto root) identically", async () => {
    const gzippedBuffer: Buffer = gzipCompress(tracesProtoBuffer);
    const bodyKey: string = storeBody(gzippedBuffer);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Traces,
      format: OtelPayloadFormat.Protobuf,
      encoding: "gzip",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(tracesPayload);
    expect(decoded).toEqual(expectedTracesJson);
  });

  test("protobuf + none: decodes MetricsData (sfixed64 asInt long) identically", async () => {
    const bodyKey: string = storeBody(metricsProtoBuffer);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Metrics,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(metricsPayload);
    expect(decoded).toEqual(expectedMetricsJson);
  });

  test("protobuf + none: Profiles empty message decodes to {}", async () => {
    /*
     * An empty ProfilesData encodes to zero bytes — covers the Profiles
     * branch of the proto-type switch without a full profiles fixture.
     */
    const bodyKey: string = storeBody(Buffer.alloc(0));

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Profiles,
      format: OtelPayloadFormat.Protobuf,
      encoding: "none",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual({});
  });

  test("json + none: parses the raw UTF-8 body (multibyte characters intact)", async () => {
    const bodyKey: string = storeBody(
      Buffer.from(JSON.stringify(logsPayload), "utf-8"),
    );

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(logsPayload);
    expect(mockGunzipReceivedInputs.length).toBe(0);
  });

  test("json + gzip: inflates then parses identically", async () => {
    const gzippedBuffer: Buffer = gzipCompress(
      Buffer.from(JSON.stringify(tracesPayload), "utf-8"),
    );
    const bodyKey: string = storeBody(gzippedBuffer);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Traces,
      format: OtelPayloadFormat.Json,
      encoding: "gzip",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(tracesPayload);
    expect(mockGunzipReceivedInputs.length).toBe(1);
  });
});

describe("OtelPayloadDecoder.decodeFromQueue — Buffer passthrough (no copies)", () => {
  test("gzip path: zlib.gunzip receives the EXACT stored Buffer, not a Uint8Array copy", async () => {
    const gzippedBuffer: Buffer = gzipCompress(logsProtoBuffer);
    const bodyKey: string = storeBody(gzippedBuffer);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "gzip",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(expectedLogsJson);
    expect(mockGunzipReceivedInputs.length).toBe(1);
    /*
     * Object identity — the legacy code passed `new Uint8Array(raw)`
     * here, which is a different object AND not a Buffer. Both
     * assertions below would fail against the copy-first code.
     */
    expect(mockGunzipReceivedInputs[0]).toBe(gzippedBuffer);
    expect(Buffer.isBuffer(mockGunzipReceivedInputs[0])).toBe(true);
  });

  test("json + gzip path: zlib.gunzip also receives the EXACT stored Buffer", async () => {
    const gzippedBuffer: Buffer = gzipCompress(
      Buffer.from(JSON.stringify(metricsPayload), "utf-8"),
    );
    const bodyKey: string = storeBody(gzippedBuffer);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Metrics,
      format: OtelPayloadFormat.Json,
      encoding: "gzip",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(metricsPayload);
    expect(mockGunzipReceivedInputs.length).toBe(1);
    expect(mockGunzipReceivedInputs[0]).toBe(gzippedBuffer);
  });

  test("protobuf decode receives the EXACT stored Buffer and takes the BufferReader fast path", async () => {
    const bodyKey: string = storeBody(tracesProtoBuffer);

    /*
     * protobufjs' compiled decoders call `Reader.create(input)` when
     * handed raw bytes; `Reader.create` returns a BufferReader for
     * Buffer inputs (the zero-copy fast path) and a plain Reader for
     * anything else. Spying on it shows exactly what decode received.
     * (Safe to install here: beforeAll already collapsed the
     * self-replacing `create_buffer_setup` bootstrap.)
     */
    const readerCreateSpy: SpyLike = jest.spyOn(
      protobuf.Reader,
      "create",
    ) as unknown as SpyLike;

    try {
      const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
        productType: ProductType.Traces,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        bodyKey: bodyKey,
      });

      expect(decoded).toEqual(expectedTracesJson);

      const matchingCallIndexes: Array<number> = readerCreateSpy.mock.calls
        .map((callArguments: Array<unknown>, index: number) => {
          return callArguments[0] === tracesProtoBuffer ? index : -1;
        })
        .filter((index: number) => {
          return index >= 0;
        });

      /*
       * Exactly one Reader was created from the stored Buffer itself —
       * the legacy code created it from `new Uint8Array(raw)` instead,
       * so no call would match on object identity.
       */
      expect(matchingCallIndexes.length).toBe(1);
      expect(
        readerCreateSpy.mock.results[matchingCallIndexes[0] as number]?.value,
      ).toBeInstanceOf(protobuf.BufferReader);
    } finally {
      readerCreateSpy.mockRestore();
    }
  });

  test("gzip + protobuf: the inflated Buffer flows into decode without a copy either", async () => {
    const gzippedBuffer: Buffer = gzipCompress(metricsProtoBuffer);
    const bodyKey: string = storeBody(gzippedBuffer);

    const readerCreateSpy: SpyLike = jest.spyOn(
      protobuf.Reader,
      "create",
    ) as unknown as SpyLike;

    try {
      const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
        productType: ProductType.Metrics,
        format: OtelPayloadFormat.Protobuf,
        encoding: "gzip",
        bodyKey: bodyKey,
      });

      expect(decoded).toEqual(expectedMetricsJson);

      /*
       * zlib always resolves with a Buffer, so the decode input after
       * inflation must still hit the BufferReader fast path (it would
       * be a plain Reader if the code re-wrapped it in a Uint8Array).
       */
      const lastCallIndex: number = readerCreateSpy.mock.calls.length - 1;
      expect(lastCallIndex).toBeGreaterThanOrEqual(0);
      expect(
        Buffer.isBuffer(readerCreateSpy.mock.calls[lastCallIndex]?.[0]),
      ).toBe(true);
      expect(readerCreateSpy.mock.results[lastCallIndex]?.value).toBeInstanceOf(
        protobuf.BufferReader,
      );
    } finally {
      readerCreateSpy.mockRestore();
    }
  });
});

describe("OtelPayloadDecoder.decodeFromQueue — behaviour equivalence with the legacy copy path", () => {
  test("gzip + protobuf output is deep-equal to copy-gunzip + copy-decode for every proto root", async () => {
    const fixtures: Array<{
      productType: ProductType;
      protoType: protobuf.Type;
      buffer: Buffer;
    }> = [
      {
        productType: ProductType.Logs,
        protoType: LogsDataType,
        buffer: logsProtoBuffer,
      },
      {
        productType: ProductType.Traces,
        protoType: TracesDataType,
        buffer: tracesProtoBuffer,
      },
      {
        productType: ProductType.Metrics,
        protoType: MetricsDataType,
        buffer: metricsProtoBuffer,
      },
    ];

    for (const fixture of fixtures) {
      const gzippedBuffer: Buffer = gzipCompress(fixture.buffer);
      const bodyKey: string = storeBody(gzippedBuffer);

      const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
        productType: fixture.productType,
        format: OtelPayloadFormat.Protobuf,
        encoding: "gzip",
        bodyKey: bodyKey,
      });

      // Full legacy pipeline: copy -> gunzip -> copy -> decode.
      const legacyDecoded: JSONObject = legacyCopyDecode(
        fixture.protoType,
        legacyCopyGunzip(gzippedBuffer),
      );

      expect(decoded).toEqual(legacyDecoded);
    }
  });

  test("a Buffer and a Uint8Array copy of the same payload decode identically", async () => {
    /*
     * Sanity for the audit's core claim: passing the Buffer through is
     * not just faster, it is observably identical to copying first.
     */
    const bufferBodyKey: string = storeBody(logsProtoBuffer);
    const copyBodyKey: string = storeBody(
      Buffer.from(new Uint8Array(logsProtoBuffer)),
    );

    const decodedFromOriginal: JSONObject =
      await OtelPayloadDecoder.decodeFromQueue({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        bodyKey: bufferBodyKey,
      });
    const decodedFromCopy: JSONObject =
      await OtelPayloadDecoder.decodeFromQueue({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        bodyKey: copyBodyKey,
      });

    expect(decodedFromOriginal).toEqual(decodedFromCopy);
    expect(decodedFromOriginal).toEqual(expectedLogsJson);
  });

  test("exported gunzipAsync still accepts a plain Uint8Array (old signature compatibility)", async () => {
    const plainTextBuffer: Buffer = Buffer.from("hello otel", "utf-8");
    const gzippedBuffer: Buffer = gzipCompress(plainTextBuffer);

    const inflatedFromBuffer: Buffer = await gunzipAsync(gzippedBuffer);
    const inflatedFromUint8Array: Buffer = await gunzipAsync(
      new Uint8Array(gzippedBuffer),
    );

    expect(inflatedFromBuffer.toString("utf-8")).toBe("hello otel");
    expect(inflatedFromUint8Array.toString("utf-8")).toBe("hello otel");
  });
});

describe("OtelPayloadDecoder.decodeFromQueue — edge cases", () => {
  test("missing body (TTL expired) returns {} and never touches gunzip", async () => {
    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "gzip",
      bodyKey: "telemetry:body:does-not-exist",
    });

    expect(decoded).toEqual({});
    expect(mockGunzipReceivedInputs.length).toBe(0);
  });

  test("empty bodyKey throws", async () => {
    await expect(
      OtelPayloadDecoder.decodeFromQueue({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        bodyKey: "",
      }),
    ).rejects.toThrow(/bodyKey is required/);
  });

  test("protobuf format with a product that has no proto type throws", async () => {
    const bodyKey: string = storeBody(logsProtoBuffer);

    await expect(
      OtelPayloadDecoder.decodeFromQueue({
        productType: ProductType.SessionReplay,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        bodyKey: bodyKey,
      }),
    ).rejects.toThrow(/no proto type/);
  });

  test("json format ignores productType entirely (no proto lookup, no throw)", async () => {
    /*
     * SessionReplay has no proto type, but the JSON branch returns
     * before the proto-type switch — parity with the old behaviour.
     */
    const bodyKey: string = storeBody(
      Buffer.from(JSON.stringify({ events: [] }), "utf-8"),
    );

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.SessionReplay,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual({ events: [] });
  });
});
