import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import { binaryToBase64Replacer } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";

/*
 * The Queue module (imported by TelemetryQueueService) pulls in BullMQ /
 * bull-board at import time; only the replacer is under test here, so the
 * module is replaced with an inert stub.
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
 * Verbatim copy of the replacer as it existed BEFORE the pre-toJSON
 * optimization: it let Buffer.prototype.toJSON reshape every Buffer into
 * { type: "Buffer", data: [per-byte numbers] } and then re-materialized a
 * second Buffer from that number array to emit base64. The new replacer
 * must produce BYTE-IDENTICAL serialized output while skipping the
 * number-array round trip — every test below compares against this
 * reference implementation.
 */
function legacyBinaryToBase64Replacer(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    (value as JSONObject)["type"] === "Buffer" &&
    Array.isArray((value as JSONObject)["data"])
  ) {
    return Buffer.from((value as { data: Array<number> }).data).toString(
      "base64",
    );
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }

  return value;
}

type Replacer = (this: unknown, key: string, value: unknown) => unknown;

const serializeBoth: (value: unknown) => { legacy: string; current: string } = (
  value: unknown,
): { legacy: string; current: string } => {
  return {
    legacy: JSON.stringify(value, legacyBinaryToBase64Replacer as Replacer),
    current: JSON.stringify(value, binaryToBase64Replacer as Replacer),
  };
};

describe("binaryToBase64Replacer output byte-identity with the legacy implementation", () => {
  test("decoded-OTLP-shaped object with Buffers, nested arrays, and plain values serializes byte-identically", () => {
    /*
     * Shaped like proto-loader output for an OTLP trace export: bytes
     * fields (traceId / spanId / parentSpanId) as Buffers, nested
     * resource/scope/span arrays, attribute key-value lists with plain
     * strings and numbers, and stringified longs.
     */
    const decodedExport: Record<string, unknown> = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              {
                key: "service.name",
                value: { stringValue: "checkout-service" },
              },
              { key: "process.pid", value: { intValue: "4242" } },
            ],
            droppedAttributesCount: 0,
          },
          scopeSpans: [
            {
              scope: { name: "manual-instrumentation", version: "1.0.0" },
              spans: [
                {
                  traceId: Buffer.from(
                    "0123456789abcdef0123456789abcdef",
                    "hex",
                  ),
                  spanId: Buffer.from("0123456789abcdef", "hex"),
                  parentSpanId: Buffer.alloc(0),
                  name: "GET /checkout",
                  kind: "SPAN_KIND_SERVER",
                  startTimeUnixNano: "1754784000000000000",
                  endTimeUnixNano: "1754784000123000000",
                  attributes: [
                    { key: "http.status_code", value: { intValue: "200" } },
                  ],
                  events: [],
                  links: [],
                  status: {},
                  flags: 0,
                },
              ],
            },
          ],
        },
      ],
    };

    const { legacy, current } = serializeBoth(decodedExport);

    expect(current).toBe(legacy);
    // Sanity: the bytes really did become base64 strings, not number arrays.
    expect(current).toContain(
      Buffer.from("0123456789abcdef0123456789abcdef", "hex").toString("base64"),
    );
    expect(current).not.toContain('"type":"Buffer"');
  });

  test("Buffer at the top level serializes to a bare base64 string", () => {
    const buffer: Buffer = Buffer.from([1, 2, 3, 4, 5]);

    const { legacy, current } = serializeBoth(buffer);

    expect(current).toBe(legacy);
    expect(current).toBe(JSON.stringify(buffer.toString("base64")));
  });

  test("Buffers nested inside arrays (including arrays of arrays) serialize byte-identically", () => {
    const value: unknown = [
      Buffer.from("first"),
      [Buffer.from("second"), "plain", 7],
      { inner: [Buffer.from("third"), null] },
    ];

    const { legacy, current } = serializeBoth(value);

    expect(current).toBe(legacy);
    expect(current).toBe(
      JSON.stringify([
        Buffer.from("first").toString("base64"),
        [Buffer.from("second").toString("base64"), "plain", 7],
        { inner: [Buffer.from("third").toString("base64"), null] },
      ]),
    );
  });

  test("null, undefined properties, booleans, and already-base64 strings pass through untouched", () => {
    const alreadyBase64: string =
      Buffer.from("not-a-buffer").toString("base64");

    const value: Record<string, unknown> = {
      nothing: null,
      missing: undefined,
      flag: true,
      count: 0,
      alreadyEncoded: alreadyBase64,
      emptyString: "",
    };

    const { legacy, current } = serializeBoth(value);

    expect(current).toBe(legacy);
    expect(JSON.parse(current)).toEqual({
      nothing: null,
      flag: true,
      count: 0,
      alreadyEncoded: alreadyBase64,
      emptyString: "",
    });
  });

  test("plain Uint8Array (no toJSON) becomes base64, identically to legacy", () => {
    const value: Record<string, unknown> = {
      raw: new Uint8Array([9, 8, 7, 6]),
    };

    const { legacy, current } = serializeBoth(value);

    expect(current).toBe(legacy);
    expect(JSON.parse(current)).toEqual({
      raw: Buffer.from([9, 8, 7, 6]).toString("base64"),
    });
  });

  test("Uint8Array VIEW with a non-zero byteOffset encodes only its own window", () => {
    /*
     * The current implementation wraps the Uint8Array's underlying
     * ArrayBuffer as a zero-copy Buffer view — byteOffset/byteLength
     * must be honored or neighboring bytes would leak into the base64.
     */
    const backing: Uint8Array = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const window: Uint8Array = new Uint8Array(backing.buffer, 2, 4);

    const { legacy, current } = serializeBoth({ raw: window });

    expect(current).toBe(legacy);
    expect(JSON.parse(current)).toEqual({
      raw: Buffer.from([2, 3, 4, 5]).toString("base64"),
    });
  });

  test("Buffer carved out of Node's internal pool (non-zero byteOffset) round-trips correctly", () => {
    /*
     * Small Buffer.from(...) allocations share a pooled ArrayBuffer, so
     * their byteOffset is usually non-zero — the fast path must encode
     * the Buffer's own window, not its backing pool.
     */
    const pooled: Buffer = Buffer.from("pooled-allocation-bytes");
    const { legacy, current } = serializeBoth({ raw: pooled });

    expect(current).toBe(legacy);
    expect(JSON.parse(current)).toEqual({
      raw: pooled.toString("base64"),
    });
  });

  test("empty Buffer serializes to an empty base64 string in both implementations", () => {
    const { legacy, current } = serializeBoth({ empty: Buffer.alloc(0) });

    expect(current).toBe(legacy);
    expect(JSON.parse(current)).toEqual({ empty: "" });
  });

  test("legacy parity: a custom toJSON returning a Uint8Array still converts to base64", () => {
    /*
     * JSON.stringify calls toJSON once and does not re-invoke it on the
     * result, so the replacer sees a Uint8Array whose HOLDER never held
     * one — the pre-toJSON checks miss it and the tail fallback must
     * convert it, exactly as the legacy implementation did.
     */
    const value: Record<string, unknown> = {
      custom: {
        toJSON: (): Uint8Array => {
          return new Uint8Array([42, 43, 44]);
        },
      },
    };

    const { legacy, current } = serializeBoth(value);

    expect(current).toBe(legacy);
    expect(JSON.parse(current)).toEqual({
      custom: Buffer.from([42, 43, 44]).toString("base64"),
    });
  });

  test("legacy parity: a custom toJSON returning a Buffer still converts to base64", () => {
    const value: Record<string, unknown> = {
      custom: {
        toJSON: (): Buffer => {
          return Buffer.from([7, 8, 9]);
        },
      },
    };

    const { legacy, current } = serializeBoth(value);

    expect(current).toBe(legacy);
    expect(JSON.parse(current)).toEqual({
      custom: Buffer.from([7, 8, 9]).toString("base64"),
    });
  });

  test("legacy parity: a producer-supplied PLAIN object shaped like Buffer JSON still converts to base64", () => {
    /*
     * Not a real Buffer — just an object that happens to look like
     * Buffer.prototype.toJSON output. The legacy replacer converted it,
     * so the current one must too (exact behavior parity).
     */
    const value: Record<string, unknown> = {
      fake: { type: "Buffer", data: [10, 20, 30] },
    };

    const { legacy, current } = serializeBoth(value);

    expect(current).toBe(legacy);
    expect(JSON.parse(current)).toEqual({
      fake: Buffer.from([10, 20, 30]).toString("base64"),
    });
  });
});

describe("binaryToBase64Replacer skips the number-array re-materialization", () => {
  test("serializing Buffers no longer calls Buffer.from at all", () => {
    /*
     * The legacy implementation re-materialized every Buffer from its
     * toJSON number array via Buffer.from; the current one reads the
     * pre-toJSON Buffer off the holder and emits base64 directly. Count
     * Buffer.from calls strictly around each stringify to prove the
     * expensive intermediate is gone.
     */
    const value: Record<string, unknown> = {
      spans: [
        { traceId: Buffer.alloc(16, 1), spanId: Buffer.alloc(8, 2) },
        { traceId: Buffer.alloc(16, 3), spanId: Buffer.alloc(8, 4) },
      ],
    };

    const bufferFromSpy: jest.SpiedFunction<typeof Buffer.from> = jest.spyOn(
      Buffer,
      "from",
    );

    try {
      bufferFromSpy.mockClear();
      JSON.stringify(value, legacyBinaryToBase64Replacer as Replacer);
      const legacyCallCount: number = bufferFromSpy.mock.calls.length;

      bufferFromSpy.mockClear();
      JSON.stringify(value, binaryToBase64Replacer as Replacer);
      const currentCallCount: number = bufferFromSpy.mock.calls.length;

      // One re-materialization per Buffer before; none now.
      expect(legacyCallCount).toBe(4);
      expect(currentCallCount).toBe(0);
    } finally {
      bufferFromSpy.mockRestore();
    }
  });
});
