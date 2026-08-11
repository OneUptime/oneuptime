import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * decodeFromQueue routing: pool-vs-inline decision making, with
 * TelemetryBodyStore mocked (in-memory) and the REAL DecodeThreadPool
 * module spied on — no actual threads are spawned here: every test
 * that could reach the pool either stubs decode() with an inline
 * delegate or mocks isAvailable() to false. (That mocking is REQUIRED
 * now, not a convenience: the pool is ENABLED BY DEFAULT with an
 * adaptive thread count, so on a multi-CPU test machine an unmocked
 * isAvailable() is true and a call-through decode() would spawn real
 * threads.)
 *
 * What is pinned:
 *   - the DEFAULT contract: with no decode env vars set, TELEMETRY_
 *     DECODE_THREADS resolves adaptively (clamp(effectiveCpus-1, 0, 4),
 *     cgroup-aware) and isEnabled() follows it — enabled whenever the
 *     adaptive count is > 0;
 *   - pool unavailable (resolved to 0 threads / unhealthy / cooldown)
 *     => inline decode, pool's decode never touched;
 *   - pool available but payload below TELEMETRY_DECODE_MIN_PAYLOAD_
 *     BYTES => inline;
 *   - pool available and payload at/above the threshold => pool;
 *   - pool unavailable (unhealthy/cooldown) => inline fallback with a
 *     result identical to the pool path;
 *   - missing body (TTL expired) => {} without consulting the pool.
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
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import OtelDecode from "../../FeatureSet/Telemetry/Utils/OtelDecode";
import DecodeThreadPool, {
  DecodeInput,
} from "../../FeatureSet/Telemetry/Utils/DecodeThreadPool";
import {
  TELEMETRY_DECODE_MIN_PAYLOAD_BYTES,
  TELEMETRY_DECODE_THREADS,
} from "../../FeatureSet/Telemetry/Config";
import CpuCount from "Common/Server/Utils/CpuCount";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";

/*
 * Minimal structural spy type — the pinned jest 28 typings fight
 * jest.spyOn on static methods, so tests here follow the SpyLike
 * pattern used by OtelPayloadDecoderBufferPassthrough.test.ts.
 */
type SpyLike = {
  mock: {
    calls: Array<Array<unknown>>;
  };
  mockImplementation: (
    implementation: (...args: Array<never>) => unknown,
  ) => SpyLike;
  mockReturnValue: (value: unknown) => SpyLike;
  mockRestore: () => void;
};

let activeSpies: Array<SpyLike> = [];

function spyOnStatic(target: unknown, methodName: string): SpyLike {
  const spy: SpyLike = jest.spyOn(
    target as never,
    methodName as never,
  ) as unknown as SpyLike;
  activeSpies.push(spy);
  return spy;
}

afterEach(() => {
  for (const spy of activeSpies) {
    spy.mockRestore();
  }
  activeSpies = [];
  mockBodyStoreBackingMap.clear();
});

let bodyKeyCounter: number = 0;

function storeBody(buffer: Buffer): string {
  bodyKeyCounter += 1;
  const bodyKey: string = `telemetry:body:routing-${bodyKeyCounter}`;
  mockBodyStoreBackingMap.set(bodyKey, buffer);
  return bodyKey;
}

/*
 * JSON payloads sized around the routing threshold. The routing
 * comparison is on the RAW stored length, so the fixtures are built to
 * exact byte sizes: `{"pad":"aa...a"}` with a computed pad length.
 */
function makeJsonBodyOfExactSize(totalBytes: number): Buffer {
  const envelopeOverhead: number = Buffer.byteLength('{"pad":""}', "utf-8");
  const padLength: number = totalBytes - envelopeOverhead;
  if (padLength < 0) {
    throw new Error(
      `cannot build a JSON body smaller than ${envelopeOverhead} bytes`,
    );
  }
  const body: Buffer = Buffer.from(
    JSON.stringify({ pad: "a".repeat(padLength) }),
    "utf-8",
  );
  if (body.length !== totalBytes) {
    throw new Error(
      `fixture bug: built ${body.length} bytes, wanted ${totalBytes}`,
    );
  }
  return body;
}

describe("OtelPayloadDecoder.decodeFromQueue — pool/inline routing", () => {
  test("DEFAULT contract: unset env resolves adaptively (clamp(effectiveCpus-1, 0, 4)) and isEnabled() follows it", () => {
    /*
     * This suite imports the REAL Config (no isolated reload), so the
     * adaptive-equality half only holds when the machine running the
     * tests has not exported an explicit TELEMETRY_DECODE_THREADS —
     * which is the case for `npm test` (config.env sets none). The
     * isEnabled()-follows-the-resolved-value half holds either way.
     */
    if (process.env["TELEMETRY_DECODE_THREADS"] === undefined) {
      const adaptiveExpected: number = Math.min(
        4,
        Math.max(0, CpuCount.getEffectiveCpuCount() - 1),
      );
      expect(TELEMETRY_DECODE_THREADS).toBe(adaptiveExpected);
    }
    expect(DecodeThreadPool.isEnabled()).toBe(TELEMETRY_DECODE_THREADS > 0);
  });

  test("pool unavailable (resolved to 0 threads, or unhealthy): a large payload decodes inline and the pool's decode is never touched", async () => {
    /*
     * isAvailable() is pinned false explicitly: with the default now
     * adaptive, its natural value here depends on the test machine's
     * CPU count. False is what a 1-effective-CPU pod (or an explicit
     * TELEMETRY_DECODE_THREADS=0) resolves to.
     */
    spyOnStatic(DecodeThreadPool, "isAvailable").mockReturnValue(false);
    const decodeSpy: SpyLike = spyOnStatic(DecodeThreadPool, "decode");
    const largeBody: Buffer = makeJsonBodyOfExactSize(
      TELEMETRY_DECODE_MIN_PAYLOAD_BYTES + 1000,
    );
    const bodyKey: string = storeBody(largeBody);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(JSON.parse(largeBody.toString("utf-8")));
    expect(decodeSpy.mock.calls.length).toBe(0);
  });

  test("pool available + payload below threshold: decodes inline", async () => {
    spyOnStatic(DecodeThreadPool, "isAvailable").mockReturnValue(true);
    const decodeSpy: SpyLike = spyOnStatic(DecodeThreadPool, "decode");

    const smallBody: Buffer = makeJsonBodyOfExactSize(
      TELEMETRY_DECODE_MIN_PAYLOAD_BYTES - 1,
    );
    const bodyKey: string = storeBody(smallBody);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(JSON.parse(smallBody.toString("utf-8")));
    expect(decodeSpy.mock.calls.length).toBe(0);
  });

  test("pool available + payload AT the threshold (boundary, >=): routes to the pool", async () => {
    spyOnStatic(DecodeThreadPool, "isAvailable").mockReturnValue(true);
    const decodeSpy: SpyLike = spyOnStatic(
      DecodeThreadPool,
      "decode",
    ).mockImplementation((input: DecodeInput) => {
      // Delegate to the shared implementation, as a real thread would.
      return OtelDecode.decodeBody(input);
    });

    const boundaryBody: Buffer = makeJsonBodyOfExactSize(
      TELEMETRY_DECODE_MIN_PAYLOAD_BYTES,
    );
    const bodyKey: string = storeBody(boundaryBody);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(JSON.parse(boundaryBody.toString("utf-8")));
    expect(decodeSpy.mock.calls.length).toBe(1);
  });

  test("pool available + payload above threshold: routes to the pool with the raw body", async () => {
    spyOnStatic(DecodeThreadPool, "isAvailable").mockReturnValue(true);
    const decodeSpy: SpyLike = spyOnStatic(
      DecodeThreadPool,
      "decode",
    ).mockImplementation((input: DecodeInput) => {
      return OtelDecode.decodeBody(input);
    });

    const largeBody: Buffer = makeJsonBodyOfExactSize(
      TELEMETRY_DECODE_MIN_PAYLOAD_BYTES + 5000,
    );
    const bodyKey: string = storeBody(largeBody);

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Traces,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      bodyKey: bodyKey,
    });

    expect(decoded).toEqual(JSON.parse(largeBody.toString("utf-8")));
    expect(decodeSpy.mock.calls.length).toBe(1);

    // The pool receives the EXACT Buffer read from the body store.
    const poolInput: DecodeInput = decodeSpy.mock.calls[0]?.[0] as DecodeInput;
    expect(poolInput.body).toBe(largeBody);
    expect(poolInput.productType).toBe(ProductType.Traces);
    expect(poolInput.format).toBe(OtelPayloadFormat.Json);
    expect(poolInput.encoding).toBe("none");
  });

  test("pool unavailable (unhealthy/cooldown): inline fallback returns the identical result", async () => {
    /*
     * First, what the pool path WOULD have produced (decode delegates
     * to the shared implementation)...
     */
    const largeBody: Buffer = makeJsonBodyOfExactSize(
      TELEMETRY_DECODE_MIN_PAYLOAD_BYTES + 2000,
    );

    const availableSpy: SpyLike = spyOnStatic(
      DecodeThreadPool,
      "isAvailable",
    ).mockReturnValue(true);
    const decodeSpy: SpyLike = spyOnStatic(
      DecodeThreadPool,
      "decode",
    ).mockImplementation((input: DecodeInput) => {
      return OtelDecode.decodeBody(input);
    });

    const pooledResult: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      bodyKey: storeBody(largeBody),
    });
    expect(decodeSpy.mock.calls.length).toBe(1);

    // ...then the same payload with the pool marked unavailable.
    availableSpy.mockReturnValue(false);

    const inlineResult: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      bodyKey: storeBody(largeBody),
    });

    // No second pool call, and byte-identical output.
    expect(decodeSpy.mock.calls.length).toBe(1);
    expect(inlineResult).toEqual(pooledResult);
  });

  test("missing body (TTL expired) returns {} without consulting the pool", async () => {
    const availableSpy: SpyLike = spyOnStatic(DecodeThreadPool, "isAvailable");
    const decodeSpy: SpyLike = spyOnStatic(DecodeThreadPool, "decode");

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Protobuf,
      encoding: "gzip",
      bodyKey: "telemetry:body:never-stored",
    });

    expect(decoded).toEqual({});
    expect(availableSpy.mock.calls.length).toBe(0);
    expect(decodeSpy.mock.calls.length).toBe(0);
  });

  test("empty bodyKey still throws (unchanged contract)", async () => {
    await expect(
      OtelPayloadDecoder.decodeFromQueue({
        productType: ProductType.Logs,
        format: OtelPayloadFormat.Protobuf,
        encoding: "none",
        bodyKey: "",
      }),
    ).rejects.toThrow(/bodyKey is required/);
  });
});
