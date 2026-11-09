/*
 * How many decompressed bytes an ingest request carries, as an ingestion
 * budget counts them - measured without decompressing anything.
 *
 * Budgets count decompressed bytes because that is what a batch costs once
 * it is stored: the same spans gzipped five to fifteen times smaller are not
 * five to fifteen times cheaper to keep. But the OTLP/HTTP routes never
 * decompress on the request path - the raw body is staged in Redis and the
 * telemetry worker inflates it (OtelRequestMiddleware, OtelPayloadDecoder) -
 * and that is a property this must not undo. So:
 *
 *   - an uncompressed body is its own length, exactly;
 *   - a gzip body records its decompressed size in its last four bytes
 *     (ISIZE, RFC 1952 section 2.3.1), which zlib checks when the worker
 *     inflates it - a member whose ISIZE lies does not decode, so is never
 *     stored;
 *   - a zstd frame may declare its content size in its header (RFC 8878
 *     section 3.1.1.1.4); a streaming encoder often does not;
 *   - deflate records nothing.
 *
 * Every size that is not exact is marked so (isExact false), and the worker,
 * once it has inflated the body, adds the difference to the counters
 * (TelemetryIngestionBudget.reconcile). gzip's honest ISIZE needs nothing
 * more; a zstd or deflate body is counted at its compressed size on arrival
 * and topped up within a second or two.
 */

/*
 * The most a counted body can be: the worker's decompressed-body ceiling
 * (MAX_DECOMPRESSED_OTLP_BODY_BYTES in App's OtelPayloadDecoder, 64 MiB),
 * past which it refuses to inflate a body at all - so a size above it is
 * never stored and never needs counting. An App test pins the two together.
 */
export const MAX_COUNTED_INGEST_BODY_BYTES: number = 64 * 1024 * 1024;

export interface TelemetryIngestBodySize {
  bytes: number;
  /*
   * Whether `bytes` is the decompressed size itself. false for a compressed
   * body measured from its own header or its compressed length, which the
   * worker settles once it has inflated it.
   */
  isExact: boolean;
}

export type TelemetryIngestBodyEncoding = "gzip" | "deflate" | "zstd" | "none";

/*
 * The content coding of an OTLP/HTTP body, as OtelPayloadDecoder reads it -
 * or null for anything it cannot decode, which OtelRequestMiddleware has
 * already refused with a 415 by the time anything here runs.
 */
export const getTelemetryIngestBodyEncoding: (
  contentEncoding: string | Array<string> | undefined,
) => TelemetryIngestBodyEncoding | null = (
  contentEncoding: string | Array<string> | undefined,
): TelemetryIngestBodyEncoding | null => {
  const header: string = (
    Array.isArray(contentEncoding)
      ? contentEncoding.join(",")
      : contentEncoding || ""
  )
    .trim()
    .toLowerCase();

  if (!header || header === "identity") {
    return "none";
  }

  const codings: Array<string> = header
    .split(",")
    .map((coding: string): string => {
      return coding.trim();
    })
    .filter((coding: string): boolean => {
      return coding.length > 0 && coding !== "identity";
    });

  if (codings.length === 0) {
    return "none";
  }

  if (codings.length > 1) {
    return null;
  }

  switch (codings[0]) {
    case "gzip":
    case "x-gzip":
      return "gzip";
    case "deflate":
    case "zlib":
      return "deflate";
    case "zstd":
      return "zstd";
    default:
      return null;
  }
};

const toBuffer: (body: Buffer | Uint8Array) => Buffer = (
  body: Buffer | Uint8Array,
): Buffer => {
  return Buffer.isBuffer(body)
    ? body
    : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
};

const capped: (bytes: number) => number = (bytes: number): number => {
  return Math.min(
    Math.max(0, Math.floor(bytes)),
    MAX_COUNTED_INGEST_BODY_BYTES,
  );
};

/*
 * gzip's ISIZE: the decompressed size modulo 2^32, little-endian, in the last
 * four bytes - of the last member, when there are several. null for anything
 * that is not a gzip stream (shorter than its minimum, or without the magic).
 */
export const readGzipDeclaredSize: (body: Buffer) => number | null = (
  body: Buffer,
): number | null => {
  // A 10-byte header and an 8-byte trailer are the least a member can be.
  if (body.length < 18 || body[0] !== 0x1f || body[1] !== 0x8b) {
    return null;
  }

  return body.readUInt32LE(body.length - 4);
};

const ZSTD_FRAME_MAGIC: number = 0xfd2fb528;

/*
 * The content size a zstd frame's header declares, or null when it declares
 * none (or the body is not a zstd frame). RFC 8878 section 3.1.1.1.
 */
export const readZstdDeclaredSize: (body: Buffer) => number | null = (
  body: Buffer,
): number | null => {
  if (body.length < 5 || body.readUInt32LE(0) !== ZSTD_FRAME_MAGIC) {
    return null;
  }

  const descriptor: number = body[4]!;
  const contentSizeFlag: number = descriptor >> 6;
  const isSingleSegment: boolean = (descriptor & 0x20) !== 0;
  const dictionaryIdFlag: number = descriptor & 0x03;

  const contentSizeFieldBytes: number =
    contentSizeFlag === 0
      ? isSingleSegment
        ? 1
        : 0
      : [0, 2, 4, 8][contentSizeFlag]!;

  if (contentSizeFieldBytes === 0) {
    return null;
  }

  const dictionaryIdBytes: number = [0, 1, 2, 4][dictionaryIdFlag]!;
  const offset: number = 5 + (isSingleSegment ? 0 : 1) + dictionaryIdBytes;

  if (body.length < offset + contentSizeFieldBytes) {
    return null;
  }

  switch (contentSizeFieldBytes) {
    case 1:
      return body.readUInt8(offset);
    case 2:
      // The 2-byte field is stored minus 256.
      return body.readUInt16LE(offset) + 256;
    case 4:
      return body.readUInt32LE(offset);
    default: {
      const size: bigint = body.readBigUInt64LE(offset);

      return size > BigInt(MAX_COUNTED_INGEST_BODY_BYTES)
        ? MAX_COUNTED_INGEST_BODY_BYTES
        : Number(size);
    }
  }
};

/*
 * The decompressed size of a raw OTLP/HTTP body (or a Vercel drain's), from
 * its content coding. Never decompresses: see the top of the file.
 */
export const measureRawTelemetryIngestBody: (data: {
  body: Buffer | Uint8Array;
  contentEncoding: string | Array<string> | undefined;
}) => TelemetryIngestBodySize = (data: {
  body: Buffer | Uint8Array;
  contentEncoding: string | Array<string> | undefined;
}): TelemetryIngestBodySize => {
  const body: Buffer = toBuffer(data.body);
  const encoding: TelemetryIngestBodyEncoding | null =
    getTelemetryIngestBodyEncoding(data.contentEncoding);

  if (encoding === "none") {
    return { bytes: body.length, isExact: true };
  }

  if (encoding === "gzip") {
    const declared: number | null = readGzipDeclaredSize(body);

    return {
      bytes: capped(declared === null ? body.length : declared),
      isExact: false,
    };
  }

  if (encoding === "zstd") {
    const declared: number | null = readZstdDeclaredSize(body);

    return {
      bytes: capped(declared === null ? body.length : declared),
      isExact: false,
    };
  }

  // deflate records no size, and anything else does not decode at all.
  return { bytes: capped(body.length), isExact: false };
};

/*
 * The size of a body the global parsers already read (StartServer: JSON,
 * urlencoded, protobuf and gzip all decompress before a route runs): the raw
 * text the JSON parser kept when there is one, else the body itself. Exact.
 */
export const measureParsedTelemetryIngestBody: (data: {
  body: unknown;
  rawBody?: string | undefined;
}) => TelemetryIngestBodySize = (data: {
  body: unknown;
  rawBody?: string | undefined;
}): TelemetryIngestBodySize => {
  if (Buffer.isBuffer(data.body) || data.body instanceof Uint8Array) {
    return { bytes: (data.body as Uint8Array).byteLength, isExact: true };
  }

  if (typeof data.rawBody === "string" && data.rawBody.length > 0) {
    return { bytes: Buffer.byteLength(data.rawBody, "utf8"), isExact: true };
  }

  if (typeof data.body === "string") {
    return { bytes: Buffer.byteLength(data.body, "utf8"), isExact: true };
  }

  if (data.body === undefined || data.body === null) {
    return { bytes: 0, isExact: true };
  }

  try {
    return {
      bytes: Buffer.byteLength(JSON.stringify(data.body) || "", "utf8"),
      isExact: true,
    };
  } catch {
    return { bytes: 0, isExact: true };
  }
};
