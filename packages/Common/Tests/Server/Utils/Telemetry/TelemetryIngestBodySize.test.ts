import { describe, expect, test } from "@jest/globals";
import zlib from "zlib";
import {
  getTelemetryIngestBodyEncoding,
  MAX_COUNTED_INGEST_BODY_BYTES,
  measureParsedTelemetryIngestBody,
  measureRawTelemetryIngestBody,
  readGzipDeclaredSize,
  readZstdDeclaredSize,
  TelemetryIngestBodySize,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestBodySize";
import { seededRandom } from "../../../Helpers/SeededRandom";

/*
 * How an ingestion budget sizes a request without decompressing it (issue
 * #5917): budgets count decompressed bytes, and the OTLP/HTTP path must not
 * start inflating bodies on the event loop to count them.
 *
 * Every compressed body here is made by Node's own zlib, so the sizes read
 * from gzip's trailer and from a zstd frame header are checked against real
 * encoders - not against hand-built bytes that only agree with the reader.
 */

type Random = (limit?: number) => number;

// A payload that compresses like telemetry: repeated keys, varying values.
const telemetryLike: (lines: number, seed: number) => Buffer = (
  lines: number,
  seed: number,
): Buffer => {
  const random: Random = seededRandom(seed) as Random;
  const parts: Array<string> = [];

  for (let index: number = 0; index < lines; index++) {
    parts.push(
      `{"service.name":"checkout","severity":"INFO","traceId":"${random(1e9)}","body":"order ${random(100000)} placed in ${random(500)}ms"}`,
    );
  }

  return Buffer.from(parts.join("\n"), "utf8");
};

describe("getTelemetryIngestBodyEncoding", () => {
  test("reads the codings OtelPayloadDecoder decodes, as it names them", () => {
    expect(getTelemetryIngestBodyEncoding(undefined)).toBe("none");
    expect(getTelemetryIngestBodyEncoding("")).toBe("none");
    expect(getTelemetryIngestBodyEncoding("identity")).toBe("none");
    expect(getTelemetryIngestBodyEncoding("gzip")).toBe("gzip");
    expect(getTelemetryIngestBodyEncoding("x-gzip")).toBe("gzip");
    expect(getTelemetryIngestBodyEncoding(" GZIP ")).toBe("gzip");
    expect(getTelemetryIngestBodyEncoding("deflate")).toBe("deflate");
    expect(getTelemetryIngestBodyEncoding("zlib")).toBe("deflate");
    expect(getTelemetryIngestBodyEncoding("zstd")).toBe("zstd");
    expect(getTelemetryIngestBodyEncoding(["gzip"])).toBe("gzip");
  });

  test("reads two codings, or one it does not know, as none it can size", () => {
    expect(getTelemetryIngestBodyEncoding("gzip, zstd")).toBe(null);
    expect(getTelemetryIngestBodyEncoding(["gzip", "br"])).toBe(null);
    expect(getTelemetryIngestBodyEncoding("br")).toBe(null);
    expect(getTelemetryIngestBodyEncoding("identity, gzip")).toBe("gzip");
  });
});

describe("measureRawTelemetryIngestBody", () => {
  test("counts an uncompressed body as its own length, exactly", () => {
    const body: Buffer = telemetryLike(200, 1);
    const size: TelemetryIngestBodySize = measureRawTelemetryIngestBody({
      body: body,
      contentEncoding: undefined,
    });

    expect(size).toEqual({ bytes: body.length, isExact: true });
  });

  test("counts a gzip body at the decompressed size its trailer records", () => {
    for (const lines of [1, 50, 2000]) {
      const plain: Buffer = telemetryLike(lines, lines);
      const gzipped: Buffer = zlib.gzipSync(plain);
      const size: TelemetryIngestBodySize = measureRawTelemetryIngestBody({
        body: gzipped,
        contentEncoding: "gzip",
      });

      // One line is too short for gzip to shrink; a batch shrinks a lot.
      if (lines > 1) {
        expect(gzipped.length).toBeLessThan(plain.length);
      }

      expect(size.bytes).toBe(plain.length);
      // Exact for honest gzip, but marked for the worker to confirm.
      expect(size.isExact).toBe(false);
    }
  });

  test("reads gzip's size from a Uint8Array view as from a Buffer", () => {
    const plain: Buffer = telemetryLike(30, 7);
    const gzipped: Buffer = zlib.gzipSync(plain);
    const view: Uint8Array = new Uint8Array(
      gzipped.buffer,
      gzipped.byteOffset,
      gzipped.byteLength,
    );

    expect(
      measureRawTelemetryIngestBody({ body: view, contentEncoding: "gzip" })
        .bytes,
    ).toBe(plain.length);
  });

  test("counts a zstd frame at the content size it declares", () => {
    const plain: Buffer = telemetryLike(400, 3);
    const compressed: Buffer = zlib.zstdCompressSync(plain, {
      params: { [zlib.constants.ZSTD_c_contentSizeFlag]: 1 },
    });

    expect(readZstdDeclaredSize(compressed)).toBe(plain.length);
    expect(
      measureRawTelemetryIngestBody({ body: compressed, contentEncoding: "zstd" }),
    ).toEqual({ bytes: plain.length, isExact: false });
  });

  test("counts a zstd frame that declares no size at its compressed size, for the worker to top up", () => {
    const plain: Buffer = telemetryLike(400, 4);
    const compressed: Buffer = zlib.zstdCompressSync(plain, {
      params: { [zlib.constants.ZSTD_c_contentSizeFlag]: 0 },
    });

    expect(readZstdDeclaredSize(compressed)).toBe(null);
    expect(
      measureRawTelemetryIngestBody({ body: compressed, contentEncoding: "zstd" }),
    ).toEqual({ bytes: compressed.length, isExact: false });
  });

  test("counts a deflate body - which records no size - at its compressed size", () => {
    const plain: Buffer = telemetryLike(400, 5);

    for (const compressed of [zlib.deflateSync(plain), zlib.deflateRawSync(plain)]) {
      expect(
        measureRawTelemetryIngestBody({
          body: compressed,
          contentEncoding: "deflate",
        }),
      ).toEqual({ bytes: compressed.length, isExact: false });
    }
  });

  test("never counts more than the worker would ever inflate", () => {
    // A gzip trailer claiming 4 GiB: the worker refuses past 64 MiB.
    const forged: Buffer = Buffer.concat([
      zlib.gzipSync(Buffer.from("tiny")).subarray(0, -4),
      Buffer.from([0xff, 0xff, 0xff, 0xff]),
    ]);

    expect(
      measureRawTelemetryIngestBody({ body: forged, contentEncoding: "gzip" })
        .bytes,
    ).toBe(MAX_COUNTED_INGEST_BODY_BYTES);
    expect(MAX_COUNTED_INGEST_BODY_BYTES).toBe(64 * 1024 * 1024);
  });

  test("counts a body that is not what its coding says at its own length", () => {
    const notGzip: Buffer = Buffer.from("plainly not gzip, but labelled gzip");

    expect(readGzipDeclaredSize(notGzip)).toBe(null);
    expect(
      measureRawTelemetryIngestBody({ body: notGzip, contentEncoding: "gzip" }),
    ).toEqual({ bytes: notGzip.length, isExact: false });
    expect(readZstdDeclaredSize(notGzip)).toBe(null);
    expect(readGzipDeclaredSize(Buffer.from([0x1f, 0x8b]))).toBe(null);
  });
});

describe("measureParsedTelemetryIngestBody", () => {
  test("counts the raw text the JSON parser kept, in UTF-8 bytes", () => {
    const rawBody: string = '{"message":"café ☕"}';

    expect(
      measureParsedTelemetryIngestBody({
        body: JSON.parse(rawBody),
        rawBody: rawBody,
      }),
    ).toEqual({ bytes: Buffer.byteLength(rawBody, "utf8"), isExact: true });
  });

  test("counts a body a parser left as bytes or text as it is", () => {
    expect(
      measureParsedTelemetryIngestBody({ body: Buffer.alloc(321) }).bytes,
    ).toBe(321);
    expect(measureParsedTelemetryIngestBody({ body: "<14>hello" }).bytes).toBe(
      9,
    );
  });

  test("counts a parsed object with no raw text as its JSON", () => {
    const body: Record<string, unknown> = { entries: [{ log: "x" }] };

    expect(measureParsedTelemetryIngestBody({ body: body }).bytes).toBe(
      JSON.stringify(body).length,
    );
    expect(measureParsedTelemetryIngestBody({ body: undefined }).bytes).toBe(0);
  });

  test("counts nothing rather than throwing on a body JSON cannot write", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    expect(measureParsedTelemetryIngestBody({ body: circular })).toEqual({
      bytes: 0,
      isExact: true,
    });
  });
});
