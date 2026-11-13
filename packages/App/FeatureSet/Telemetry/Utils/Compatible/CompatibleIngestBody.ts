import zlib from "zlib";
import { promisify } from "util";
import { ExpressRequest } from "Common/Server/Utils/Express";
import OtelPayloadDecoder, {
  MAX_DECOMPRESSED_OTLP_BODY_BYTES,
  OtelPayloadEncoding,
} from "../OtelPayloadDecoder";
import { MAX_OTLP_REQUEST_BYTES } from "../../Middleware/OtelRequestMiddleware";
import {
  CloudStreamBodyTooLarge,
  drainCloudStreamBody,
  readCloudStreamBody,
} from "../CloudStreamBody";
import SnappyBlock, { SnappyTooLargeError } from "./SnappyBlock";

/*
 * A COMPATIBLE ENDPOINT'S BODY: READ RAW, BOUNDED, AND DECODED.
 *
 * StartServer leaves the compatible endpoints' paths to them
 * (isCompatibleIngestPath), because what they are sent is nothing a body
 * parser reads: snappy-compressed protobuf from Prometheus and Loki,
 * Splunk's concatenated JSON objects, Sentry's newline-delimited envelopes.
 * Each reads its body here, AFTER its ingestion key has been checked, so a
 * request without a key is answered before a byte of its body is held.
 *
 * The body may be at most MAX_OTLP_REQUEST_BYTES as sent (the OTLP routes'
 * ceiling; the shipped nginx cuts /telemetry to 4 MiB) and at most
 * MAX_DECOMPRESSED_OTLP_BODY_BYTES once its coding is undone. The codings
 * are the ones these tools send: gzip, deflate (zlib or raw), zstd, brotli
 * (Sentry's Python SDK) and snappy (Prometheus remote write).
 */

export type CompatibleBodyEncoding = OtelPayloadEncoding | "snappy" | "br";

export const SUPPORTED_COMPATIBLE_CONTENT_ENCODINGS: ReadonlyArray<string> = [
  "gzip",
  "deflate",
  "zstd",
  "br",
  "snappy",
];

export class CompatibleBodyError extends Error {
  public readonly statusCode: number;

  public constructor(statusCode: number, message: string) {
    super(message);
    this.name = "CompatibleBodyError";
    this.statusCode = statusCode;
  }
}

const brotliDecompressAsync: (
  buffer: Buffer | Uint8Array,
  options?: zlib.BrotliOptions,
) => Promise<Buffer> = promisify(zlib.brotliDecompress) as unknown as (
  buffer: Buffer | Uint8Array,
  options?: zlib.BrotliOptions,
) => Promise<Buffer>;

export default class CompatibleIngestBody {
  /*
   * The request's Content-Encoding in this module's vocabulary, or null for
   * a coding none of these endpoints can undo (or two codings stacked).
   */
  public static encodingOf(
    contentEncoding: string | Array<string> | undefined,
  ): CompatibleBodyEncoding | null {
    const headerValue: string = Array.isArray(contentEncoding)
      ? contentEncoding.join(",")
      : contentEncoding ?? "";

    const codings: Array<string> = headerValue
      .split(",")
      .map((coding: string): string => {
        return coding.trim().toLowerCase();
      })
      .filter((coding: string): boolean => {
        return coding.length > 0 && coding !== "identity";
      });

    if (codings.length === 1 && codings[0] === "snappy") {
      return "snappy";
    }

    if (codings.length === 1 && codings[0] === "br") {
      return "br";
    }

    return OtelPayloadDecoder.encodingFromContentEncoding(headerValue);
  }

  /*
   * The body as sent, at most MAX_OTLP_REQUEST_BYTES. A body a parser read
   * first (a JSON one some middleware reached before this route) is given
   * back as the bytes it was, so a route still works behind a stack that
   * did not leave its path alone.
   */
  public static async readRaw(req: ExpressRequest): Promise<Buffer> {
    const body: unknown = req.body;

    if (Buffer.isBuffer(body)) {
      if (body.length > MAX_OTLP_REQUEST_BYTES) {
        throw CompatibleIngestBody.tooLarge();
      }

      return body;
    }

    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }

    if (typeof body === "string") {
      return Buffer.from(body, "utf8");
    }

    if (
      body &&
      typeof body === "object" &&
      Object.keys(body as Record<string, unknown>).length > 0
    ) {
      return Buffer.from(JSON.stringify(body), "utf8");
    }

    try {
      return await readCloudStreamBody(req, MAX_OTLP_REQUEST_BYTES);
    } catch (error) {
      if (error instanceof CloudStreamBodyTooLarge) {
        throw CompatibleIngestBody.tooLarge();
      }

      throw error;
    }
  }

  /*
   * The body with its Content-Encoding undone. `assumeEncoding` is what a
   * protocol sends without saying so: Prometheus remote write is always
   * snappy, whether or not a sender sets the header.
   */
  public static async read(
    req: ExpressRequest,
    options?: { assumeEncoding?: CompatibleBodyEncoding | undefined },
  ): Promise<Buffer> {
    const encoding: CompatibleBodyEncoding | null =
      CompatibleIngestBody.encodingOf(req.headers["content-encoding"]);

    if (encoding === null) {
      drainCloudStreamBody(req);
      throw new CompatibleBodyError(
        415,
        `Unsupported Content-Encoding "${String(
          req.headers["content-encoding"],
        ).slice(
          0,
          100,
        )}". Send the body uncompressed or compressed with one of: ${SUPPORTED_COMPATIBLE_CONTENT_ENCODINGS.join(", ")}.`,
      );
    }

    const raw: Buffer = await CompatibleIngestBody.readRaw(req);

    const effective: CompatibleBodyEncoding =
      encoding === "none" && options?.assumeEncoding
        ? options.assumeEncoding
        : encoding;

    return await CompatibleIngestBody.decode(raw, effective);
  }

  public static async decode(
    raw: Buffer,
    encoding: CompatibleBodyEncoding,
  ): Promise<Buffer> {
    try {
      if (encoding === "snappy") {
        return SnappyBlock.decompress(raw, MAX_DECOMPRESSED_OTLP_BODY_BYTES);
      }

      if (encoding === "br") {
        return await brotliDecompressAsync(raw, {
          maxOutputLength: MAX_DECOMPRESSED_OTLP_BODY_BYTES,
        });
      }

      return await OtelPayloadDecoder.decompress(raw, encoding);
    } catch (error) {
      if (
        error instanceof SnappyTooLargeError ||
        (error as { code?: string } | null)?.code === "ERR_BUFFER_TOO_LARGE"
      ) {
        throw new CompatibleBodyError(
          413,
          `The request body may not decompress to more than ${MAX_DECOMPRESSED_OTLP_BODY_BYTES} bytes.`,
        );
      }

      throw new CompatibleBodyError(
        400,
        `The request body is not valid ${encoding} data.`,
      );
    }
  }

  private static tooLarge(): CompatibleBodyError {
    return new CompatibleBodyError(
      413,
      `The request body may not exceed ${MAX_OTLP_REQUEST_BYTES} bytes.`,
    );
  }
}
