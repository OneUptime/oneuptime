import zlib from "zlib";
import { Readable } from "stream";
import { describe, expect, test } from "@jest/globals";
import { ExpressRequest } from "Common/Server/Utils/Express";
import CompatibleIngestBody, {
  CompatibleBodyError,
} from "../../../FeatureSet/Telemetry/Utils/Compatible/CompatibleIngestBody";
import { MAX_OTLP_REQUEST_BYTES } from "../../../FeatureSet/Telemetry/Middleware/OtelRequestMiddleware";
import { snappyCompress } from "./SnappyTestCompressor";

/*
 * A compatible endpoint's body, read raw from the socket and bounded, with
 * whichever coding its tool sends undone - gzip, deflate (zlib or raw),
 * zstd, brotli, snappy - and refused, with the status its client
 * understands, when the coding is unknown, the body too large, or the
 * bytes not what they claim.
 */

const PAYLOAD: Buffer = Buffer.from(
  JSON.stringify({ hello: "world", items: Array(200).fill("x") }),
);

const streamRequest: (
  body: Buffer,
  headers?: Record<string, string>,
) => ExpressRequest = (
  body: Buffer,
  headers: Record<string, string> = {},
): ExpressRequest => {
  const stream: Readable = Readable.from([body]);

  return Object.assign(stream, {
    headers: { ...headers },
    body: undefined,
  }) as unknown as ExpressRequest;
};

const statusOf: (promise: Promise<unknown>) => Promise<number | null> = async (
  promise: Promise<unknown>,
): Promise<number | null> => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof CompatibleBodyError ? error.statusCode : -1;
  }
};

describe("CompatibleIngestBody.encodingOf", () => {
  test.each<[string | undefined, string | null]>([
    [undefined, "none"],
    ["", "none"],
    ["identity", "none"],
    ["gzip", "gzip"],
    ["x-gzip", "gzip"],
    ["GZIP", "gzip"],
    ["deflate", "deflate"],
    ["zlib", "deflate"],
    ["zstd", "zstd"],
    ["snappy", "snappy"],
    ["br", "br"],
    [" Snappy ", "snappy"],
    ["gzip, br", null],
    ["lz4", null],
  ])("%s is %s", (header: string | undefined, expected: string | null) => {
    expect(CompatibleIngestBody.encodingOf(header)).toBe(expected);
  });
});

describe("CompatibleIngestBody.read", () => {
  test.each<[string, Buffer, Record<string, string>]>([
    ["an uncompressed body", PAYLOAD, {}],
    ["gzip", zlib.gzipSync(PAYLOAD), { "content-encoding": "gzip" }],
    [
      "zlib deflate",
      zlib.deflateSync(PAYLOAD),
      { "content-encoding": "deflate" },
    ],
    [
      "raw deflate",
      zlib.deflateRawSync(PAYLOAD),
      { "content-encoding": "deflate" },
    ],
    ["brotli", zlib.brotliCompressSync(PAYLOAD), { "content-encoding": "br" }],
    ["snappy", snappyCompress(PAYLOAD), { "content-encoding": "snappy" }],
  ])(
    "undoes %s",
    async (_name: string, body: Buffer, headers: Record<string, string>) => {
      const read: Buffer = await CompatibleIngestBody.read(
        streamRequest(body, headers),
      );

      expect(read.equals(PAYLOAD)).toBe(true);
    },
  );

  test("undoes zstd when this Node has it", async () => {
    const zstd: ((input: Buffer) => Buffer) | undefined = (
      zlib as unknown as { zstdCompressSync?: (input: Buffer) => Buffer }
    ).zstdCompressSync;

    if (!zstd) {
      return;
    }

    const read: Buffer = await CompatibleIngestBody.read(
      streamRequest(zstd(PAYLOAD), { "content-encoding": "zstd" }),
    );

    expect(read.equals(PAYLOAD)).toBe(true);
  });

  test("assumes a coding a protocol always uses when none is stated", async () => {
    const read: Buffer = await CompatibleIngestBody.read(
      streamRequest(snappyCompress(PAYLOAD)),
      { assumeEncoding: "snappy" },
    );

    expect(read.equals(PAYLOAD)).toBe(true);
  });

  test("a stated coding wins over the assumed one", async () => {
    const read: Buffer = await CompatibleIngestBody.read(
      streamRequest(zlib.gzipSync(PAYLOAD), { "content-encoding": "gzip" }),
      { assumeEncoding: "snappy" },
    );

    expect(read.equals(PAYLOAD)).toBe(true);
  });

  test("an unknown coding is a 415, before the body is read", async () => {
    expect(
      await statusOf(
        CompatibleIngestBody.read(
          streamRequest(PAYLOAD, { "content-encoding": "lz4" }),
        ),
      ),
    ).toBe(415);
  });

  test("bytes that are not what their coding says are a 400", async () => {
    expect(
      await statusOf(
        CompatibleIngestBody.read(
          streamRequest(PAYLOAD, { "content-encoding": "gzip" }),
        ),
      ),
    ).toBe(400);
    expect(
      await statusOf(
        CompatibleIngestBody.read(
          streamRequest(Buffer.from([0x05, 0x00, 0x61]), {
            "content-encoding": "snappy",
          }),
        ),
      ),
    ).toBe(400);
  });

  test("a declared length past the ceiling is a 413, before a byte is read", async () => {
    expect(
      await statusOf(
        CompatibleIngestBody.read(
          streamRequest(PAYLOAD, {
            "content-length": String(MAX_OTLP_REQUEST_BYTES + 1),
          }),
        ),
      ),
    ).toBe(413);
  });

  test("a snappy block that declares more than the decompressed ceiling is a 413", async () => {
    expect(
      await statusOf(
        CompatibleIngestBody.read(
          streamRequest(Buffer.from([0xff, 0xff, 0xff, 0xff, 0x0f]), {
            "content-encoding": "snappy",
          }),
        ),
      ),
    ).toBe(413);
  });

  test("a gzip bomb past the decompressed ceiling is a 413", async () => {
    const bomb: Buffer = zlib.gzipSync(Buffer.alloc(65 * 1024 * 1024));

    expect(
      await statusOf(
        CompatibleIngestBody.read(
          streamRequest(bomb, { "content-encoding": "gzip" }),
        ),
      ),
    ).toBe(413);
  });

  test("a body a parser already read is given back as its bytes", async () => {
    const req: ExpressRequest = {
      headers: {},
      body: { streams: [] },
    } as unknown as ExpressRequest;

    expect((await CompatibleIngestBody.read(req)).toString()).toBe(
      '{"streams":[]}',
    );

    const buffered: ExpressRequest = {
      headers: {},
      body: PAYLOAD,
    } as unknown as ExpressRequest;

    expect((await CompatibleIngestBody.read(buffered)).equals(PAYLOAD)).toBe(
      true,
    );
  });
});
