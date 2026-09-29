import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The OTLP body is inflated in the BullMQ worker, not on the HTTP path -
 * which is why an unbounded `gunzip` here was worse than it looked.
 * TELEMETRY_CONCURRENCY defaults to 100, so one pod can have a hundred of
 * these in flight; unbounded once is unbounded a hundred times over.
 *
 * The body arrives from Redis (TelemetryBodyStore), so these tests mock
 * the store and drive decodeFromQueue directly - no infrastructure, and
 * the assertion is about what the decoder does with the bytes.
 */

const storedBodies: Map<string, Buffer | null> = new Map<
  string,
  Buffer | null
>();

jest.mock("../../FeatureSet/Telemetry/Utils/TelemetryBodyStore", () => {
  return {
    __esModule: true,
    default: {
      readBody: jest.fn(async (key: unknown): Promise<Buffer | null> => {
        return storedBodies.get(key as string) ?? null;
      }),
      storeBody: jest.fn(),
      deleteBody: jest.fn(),
    },
  };
});

import OtelPayloadDecoder, {
  MAX_DECOMPRESSED_OTLP_BODY_BYTES,
  OtelPayloadFormat,
  gunzipAsync,
} from "../../FeatureSet/Telemetry/Utils/OtelPayloadDecoder";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { JSONObject } from "Common/Types/JSON";
import zlib from "zlib";

function gzip(buffer: Buffer): Buffer {
  return zlib.gzipSync(buffer as unknown as Uint8Array);
}

let keySeq: number = 0;

function store(body: Buffer): string {
  const key: string = `telemetry:body:test-${++keySeq}`;
  storedBodies.set(key, body);
  return key;
}

async function decodeJson(body: Buffer): Promise<JSONObject> {
  return await OtelPayloadDecoder.decodeFromQueue({
    productType: ProductType.Logs,
    format: OtelPayloadFormat.Json,
    encoding: "gzip",
    bodyKey: store(body),
  });
}

beforeEach(() => {
  storedBodies.clear();
});

describe("OtelPayloadDecoder - the ceiling", () => {
  test("the ceiling is 64 MiB", () => {
    expect(MAX_DECOMPRESSED_OTLP_BODY_BYTES).toBe(64 * 1024 * 1024);
  });

  test("a body over the ceiling is refused rather than inflated", async () => {
    /*
     * ~65 KB on the wire, 64 MiB + 1 once inflated. Before the ceiling
     * this allocated all of it, per job, up to a hundred at a time.
     */
    const bomb: Buffer = gzip(
      Buffer.alloc(MAX_DECOMPRESSED_OTLP_BODY_BYTES + 1),
    );

    expect(bomb.length).toBeLessThan(MAX_DECOMPRESSED_OTLP_BODY_BYTES / 500);

    await expect(decodeJson(bomb)).rejects.toMatchObject({
      code: "ERR_BUFFER_TOO_LARGE",
    });
  });

  test("a real OTLP JSON body still decodes", async () => {
    const payload: JSONObject = {
      resourceLogs: [
        {
          resource: { attributes: [] },
          scopeLogs: [{ logRecords: [{ body: { stringValue: "hello" } }] }],
        },
      ],
    };

    const decoded: JSONObject = await decodeJson(
      gzip(Buffer.from(JSON.stringify(payload))),
    );

    expect(decoded).toEqual(payload);
  });

  test("a body just under the ceiling is accepted", async () => {
    /*
     * Deliberately built as valid JSON so this exercises the whole
     * decode, not just the inflate: a 32 MiB string of one repeated
     * character.
     */
    const filler: string = "a".repeat(32 * 1024 * 1024);
    const json: string = JSON.stringify({
      resourceLogs: [{ resource: { attributes: [] }, scopeLogs: [] }],
      filler: filler,
    });

    expect(Buffer.byteLength(json)).toBeLessThan(
      MAX_DECOMPRESSED_OTLP_BODY_BYTES,
    );

    const decoded: JSONObject = await decodeJson(gzip(Buffer.from(json)));

    expect((decoded["filler"] as string).length).toBe(filler.length);
  });

  test("an identity-encoded body never touches the inflate", async () => {
    const payload: JSONObject = { resourceLogs: [] };

    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Json,
      encoding: "none",
      bodyKey: store(Buffer.from(JSON.stringify(payload))),
    });

    expect(decoded).toEqual(payload);
  });

  test("a lost body (expired TTL) is still an empty object, not an error", async () => {
    const decoded: JSONObject = await OtelPayloadDecoder.decodeFromQueue({
      productType: ProductType.Logs,
      format: OtelPayloadFormat.Json,
      encoding: "gzip",
      bodyKey: "telemetry:body:gone",
    });

    expect(decoded).toEqual({});
  });
});

describe("OtelPayloadDecoder.gunzipAsync - the exported helper", () => {
  test("still accepts a bare buffer with no options (old signature)", async () => {
    const inflated: Buffer = await gunzipAsync(gzip(Buffer.from("plain")));

    expect(inflated.toString()).toBe("plain");
  });

  test("still accepts a plain Uint8Array", async () => {
    const compressed: Buffer = gzip(Buffer.from("plain"));

    const inflated: Buffer = await gunzipAsync(new Uint8Array(compressed));

    expect(inflated.toString()).toBe("plain");
  });

  test("honours maxOutputLength when it is passed", async () => {
    const compressed: Buffer = gzip(Buffer.alloc(4 * 1024 * 1024));

    await expect(
      gunzipAsync(compressed, { maxOutputLength: 1024 }),
    ).rejects.toMatchObject({ code: "ERR_BUFFER_TOO_LARGE" });
  });

  test("a payload exactly at maxOutputLength is allowed through", async () => {
    const compressed: Buffer = gzip(Buffer.alloc(1024));

    const inflated: Buffer = await gunzipAsync(compressed, {
      maxOutputLength: 1024,
    });

    expect(inflated.length).toBe(1024);
  });
});
