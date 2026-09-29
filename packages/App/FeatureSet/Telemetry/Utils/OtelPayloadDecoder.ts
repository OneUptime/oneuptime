import protobuf from "protobufjs";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import InventoryItem, {
  ResourceEntityRef,
} from "Common/Server/Utils/Telemetry/TelemetryEntity";
import TelemetryBodyStore from "./TelemetryBodyStore";

/*
 * Shared OTel protobuf decoders. We previously decoded payloads inside
 * the Express request middleware before responding to the client,
 * which blocked the event loop on every ingest call (large batches
 * spent 50-150ms of unbroken sync CPU on protobuf decode + toJSON).
 * Decoding now happens in the BullMQ worker — both sides import this
 * module so the proto definitions only load once per process.
 */

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "ProtoFiles",
  "OTel",
  "v1",
);

const LogsProto: protobuf.Root = protobuf.loadSync(
  path.join(PROTO_DIR, "logs.proto"),
);
const TracesProto: protobuf.Root = protobuf.loadSync(
  path.join(PROTO_DIR, "traces.proto"),
);
const MetricsProto: protobuf.Root = protobuf.loadSync(
  path.join(PROTO_DIR, "metrics.proto"),
);
const ProfilesProto: protobuf.Root = protobuf.loadSync(
  path.join(PROTO_DIR, "profiles.proto"),
);

const LogsData: protobuf.Type = LogsProto.lookupType("LogsData");
const TracesData: protobuf.Type = TracesProto.lookupType("TracesData");
const MetricsData: protobuf.Type = MetricsProto.lookupType("MetricsData");
const ProfilesData: protobuf.Type = ProfilesProto.lookupType("ProfilesData");

/*
 * `zlib.gunzip` accepts a Node Buffer directly (Buffer IS a Uint8Array
 * subclass at runtime), so the raw payload Buffer read from Redis is passed
 * straight through — wrapping it in `new Uint8Array(raw)` first would
 * allocate and memcpy the entire payload (tens of MB for large batches)
 * per job for no behavioural difference. The `as unknown as` cast is
 * forced by TypeScript 5.7+ generic typed arrays: our pinned @types/node
 * declares `Buffer.slice()` in a way that no longer structurally matches
 * the lib `Uint8Array`, so `Buffer` fails to assign to `zlib.InputType`
 * at the type level even though it is valid at runtime (same workaround
 * as the promisified gunzip in SessionReplayIngestService).
 */
export const gunzipAsync: (
  buffer: Buffer | Uint8Array,
  options?: zlib.ZlibOptions,
) => Promise<Buffer> = promisify(zlib.gunzip) as unknown as (
  buffer: Buffer | Uint8Array,
  options?: zlib.ZlibOptions,
) => Promise<Buffer>;

// Same Buffer pass-through and cast as gunzipAsync above.
const inflateAsync: (
  buffer: Buffer | Uint8Array,
  options?: zlib.ZlibOptions,
) => Promise<Buffer> = promisify(zlib.inflate) as unknown as (
  buffer: Buffer | Uint8Array,
  options?: zlib.ZlibOptions,
) => Promise<Buffer>;

const inflateRawAsync: (
  buffer: Buffer | Uint8Array,
  options?: zlib.ZlibOptions,
) => Promise<Buffer> = promisify(zlib.inflateRaw) as unknown as (
  buffer: Buffer | Uint8Array,
  options?: zlib.ZlibOptions,
) => Promise<Buffer>;

/*
 * zstd only exists in zlib from Node 23.8 / 22.15. The App image runs Node
 * 26, but promisify(undefined) throws at import, which would take the whole
 * telemetry worker down on an older runtime - so probe for it, and let
 * encodingFromContentEncoding refuse zstd at admission when it is missing
 * rather than accept bodies this process could never decode.
 */
const zstdDecompressAsync:
  | ((
      buffer: Buffer | Uint8Array,
      options?: zlib.ZstdOptions,
    ) => Promise<Buffer>)
  | null =
  typeof zlib.zstdDecompress === "function"
    ? (promisify(zlib.zstdDecompress) as unknown as (
        buffer: Buffer | Uint8Array,
        options?: zlib.ZstdOptions,
      ) => Promise<Buffer>)
    : null;

/*
 * Decompressed-payload ceiling for ONE queued OTLP body.
 *
 * The inflate runs in the BullMQ worker, where TELEMETRY_CONCURRENCY (100
 * by default) jobs can be in flight on one pod, so an unbounded inflate is
 * unbounded a hundred times over. Only OTLP/HTTP bodies are ever compressed
 * here: nginx caps them, as sent, at 4 MiB on /otlp and /telemetry (and
 * OtelRequestMiddleware at MAX_OTLP_REQUEST_BYTES without nginx in front),
 * and gzip on OTLP protobuf runs about 5-15x, so a legitimate batch fits
 * under this. A hostile one reaches four figures of amplification and would
 * otherwise take the pod out. OTLP/gRPC exports never reach this inflate:
 * grpc-js decodes those messages itself, bounded by the server's 50 MB
 * `grpc.max_receive_message_length`, and TelemetryQueueService stores the
 * decoded object as uncompressed JSON.
 *
 * The same ceiling bounds the OUTPUT of every content coding the decoder
 * accepts (gzip, deflate, zstd). `maxOutputLength` is honoured because these
 * are zlib's CONVENIENCE apis - `gunzip`, `inflate`, `inflateRaw` and
 * `zstdDecompress` all reject with ERR_BUFFER_TOO_LARGE past it (asserted per
 * coding in OtlpContentEncoding.test.ts). On a `createGunzip`-style stream it
 * is accepted and silently ignored. It does not bound the decoder's own
 * history window: deflate's is fixed at 32 KiB, but zstd's is whatever the
 * frame declares, so that one is capped separately by
 * MAX_ZSTD_WINDOW_LOG below.
 */
export const MAX_DECOMPRESSED_OTLP_BODY_BYTES: number = 64 * 1024 * 1024;

/*
 * Largest zstd window (2^24 = 16 MiB) the worker will allocate for one body.
 * A zstd frame names its own window size, and libzstd's default limit is
 * 2^27 = 128 MiB. The decoder fills that window alongside the output, so a
 * ~2 KB frame declaring a 128 MiB window roughly doubled what a job could
 * hold before maxOutputLength tripped, times TELEMETRY_CONCURRENCY. (With
 * ten such frames in flight, peak RSS measured 1.3 GiB, against 0.7 GiB for
 * ten gzip bombs.) Past this limit the decode fails straight away with
 * ZSTD_error_frameParameter_windowTooLarge.
 *
 * Nothing legitimate needs more. RFC 9659 says encoders MUST NOT use a
 * window over 8 MB for the "zstd" HTTP content coding. The Collector's
 * encoder (klauspost/compress, GH#3978's exporter) tops out at 8 MiB. So does
 * libzstd at levels 1-19, whether its window is declared or implied by a
 * single-segment frame's content size. That leaves 2x headroom for
 * non-conforming senders. Only an encoder deliberately configured past it
 * (zstd's --ultra levels, or --long) is refused - in the worker, after the
 * 200, like a gzip batch over the output ceiling.
 */
export const MAX_ZSTD_WINDOW_LOG: number = 24;

export enum OtelPayloadFormat {
  Protobuf = "protobuf",
  Json = "json",
}

/*
 * How a queued OTLP body is compressed - the decode vocabulary shared by
 * the HTTP enqueue (TelemetryQueueService) and the worker (decodeFromQueue).
 * "deflate" covers both the zlib-wrapped (RFC 1950) and the raw (RFC 1951)
 * framing; decompress() tells them apart from the first two bytes.
 */
export type OtelPayloadEncoding = "gzip" | "deflate" | "zstd" | "none";

/*
 * HTTP content codings the OTLP/HTTP endpoints accept, keyed by the
 * lowercased coding name. GH#3978: Datadog's recommended Collector config
 * (the exporter a migrating customer re-points at us) sets
 * `compression: zstd`, and before this every such batch was answered 200,
 * stored as if uncompressed and then failed to decode in the worker.
 *
 *   - "x-gzip" is gzip (RFC 9110 section 8.4.1.3).
 *   - "deflate" and "zlib" are both what the OpenTelemetry Collector's
 *     confighttp sends for `compression: deflate` / `compression: zlib`: it
 *     writes the configured name verbatim as the Content-Encoding and
 *     compresses both with Go's compress/zlib, i.e. RFC 1950 zlib-wrapped
 *     deflate. Some HTTP clients send raw RFC 1951 deflate under "deflate"
 *     instead - a long-standing ambiguity of that coding - so the decoder
 *     accepts either framing.
 */
const CONTENT_CODINGS: ReadonlyMap<string, OtelPayloadEncoding> = new Map<
  string,
  OtelPayloadEncoding
>([
  ["gzip", "gzip"],
  ["x-gzip", "gzip"],
  ["deflate", "deflate"],
  ["zlib", "deflate"],
  ...(zstdDecompressAsync
    ? ([["zstd", "zstd"]] as Array<[string, OtelPayloadEncoding]>)
    : []),
]);

/*
 * The canonical content-coding names, for the 415 message and its
 * Accept-Encoding header (RFC 9110 section 15.5.16). The aliases above are
 * accepted but not advertised.
 */
export const SUPPORTED_OTLP_CONTENT_ENCODINGS: ReadonlyArray<string> = [
  "gzip",
  "deflate",
  ...(zstdDecompressAsync ? ["zstd"] : []),
];

/*
 * RFC 1950 zlib header check: CM (low nibble of CMF) is 8 = deflate, CINFO
 * (high nibble) is a window of at most 32 KiB, and CMF*256 + FLG is a
 * multiple of 31. A raw deflate stream from a conforming encoder never
 * passes it: a low nibble of 8 there means a non-final STORED block whose
 * padding bit 3 is set, and encoders write that padding as zeros.
 */
function isZlibWrapped(raw: Buffer): boolean {
  if (raw.length < 2) {
    return false;
  }

  const cmf: number = raw[0]!;
  const flg: number = raw[1]!;

  return (cmf & 0x0f) === 8 && cmf >> 4 <= 7 && (cmf * 256 + flg) % 31 === 0;
}

function protoTypeForProduct(productType: ProductType): protobuf.Type | null {
  switch (productType) {
    case ProductType.Traces:
      return TracesData;
    case ProductType.Logs:
      return LogsData;
    case ProductType.Metrics:
      return MetricsData;
    case ProductType.Profiles:
      return ProfilesData;
    default:
      return null;
  }
}

export default class OtelPayloadDecoder {
  /*
   * Decode a previously-enqueued raw OTel payload into a plain JS
   * object matching the OTel data model (resourceSpans / resourceLogs
   * / resourceMetrics / resourceProfiles).
   *
   * The body is fetched from Redis via TelemetryBodyStore using the
   * `bodyKey` written at enqueue time — see TelemetryQueueService
   * for the producer side. We READ but do NOT delete here; the worker
   * deletes the body only after the job succeeds (so a transient-failure
   * retry can re-read it). If the body is missing (the TTL elapsed before
   * the worker got to it) we return an empty object: the downstream
   * consumer treats an empty `resourceLogs` / `resourceSpans`
   * / `resourceMetrics` as "nothing to ingest" and skips the
   * batch, which is the correct behaviour for a lost body.
   */
  public static async decodeFromQueue(input: {
    productType: ProductType;
    format: OtelPayloadFormat;
    encoding: OtelPayloadEncoding;
    bodyKey: string;
  }): Promise<JSONObject> {
    if (!input.bodyKey) {
      throw new Error("OtelPayloadDecoder: bodyKey is required");
    }

    const stored: Buffer | null = await TelemetryBodyStore.readBody(
      input.bodyKey,
    );
    if (!stored) {
      // Body expired (TTL) before the worker got to it — nothing to decode.
      return {} as JSONObject;
    }

    const raw: Buffer = await OtelPayloadDecoder.decompress(
      stored,
      input.encoding,
    );

    if (input.format === OtelPayloadFormat.Json) {
      return JSON.parse(raw.toString("utf-8")) as JSONObject;
    }

    const protoType: protobuf.Type | null = protoTypeForProduct(
      input.productType,
    );
    if (!protoType) {
      throw new Error(
        `OtelPayloadDecoder: no proto type for product ${input.productType}`,
      );
    }

    /*
     * Mirror the previous middleware behavior: decode the protobuf
     * message and then `.toJSON()` it into a plain JS object that
     * downstream code already consumes (resourceSpans / resourceLogs
     * / resourceMetrics / resourceProfiles).
     *
     * The Buffer is handed to `decode` as-is: protobufjs' `Reader.create`
     * has a dedicated Buffer fast path (BufferReader), so copying the
     * payload into a fresh Uint8Array first would only add an extra
     * full-payload allocation + memcpy per job. The `as unknown as`
     * cast is type-level only — Buffer IS a Uint8Array at runtime, but
     * our pinned @types/node predates TypeScript 5.7's generic typed
     * arrays and no longer structurally satisfies the lib `Uint8Array`.
     */
    const message: protobuf.Message<Record<string, unknown>> = protoType.decode(
      raw as unknown as Uint8Array,
    );
    return message.toJSON() as JSONObject;
  }

  /*
   * Undo the body's content coding. Output is capped at
   * MAX_DECOMPRESSED_OTLP_BODY_BYTES whatever the coding, and zstd's window
   * at MAX_ZSTD_WINDOW_LOG. An encoding this build does not know throws
   * instead of falling through to "none": parsing compressed bytes as
   * protobuf or JSON can only fail later with a less useful error, and
   * silently treating an unknown coding as identity is how GH#3978's zstd
   * batches were lost.
   */
  public static async decompress(
    raw: Buffer,
    encoding: OtelPayloadEncoding,
  ): Promise<Buffer> {
    switch (encoding) {
      case "none":
        return raw;
      case "gzip":
        return await gunzipAsync(raw, {
          maxOutputLength: MAX_DECOMPRESSED_OTLP_BODY_BYTES,
        });
      case "deflate":
        return isZlibWrapped(raw)
          ? await inflateAsync(raw, {
              maxOutputLength: MAX_DECOMPRESSED_OTLP_BODY_BYTES,
            })
          : await inflateRawAsync(raw, {
              maxOutputLength: MAX_DECOMPRESSED_OTLP_BODY_BYTES,
            });
      case "zstd":
        if (!zstdDecompressAsync) {
          throw new Error(
            "OtelPayloadDecoder: zstd body, but this Node runtime has no zlib.zstdDecompress",
          );
        }
        return await zstdDecompressAsync(raw, {
          maxOutputLength: MAX_DECOMPRESSED_OTLP_BODY_BYTES,
          params: {
            [zlib.constants.ZSTD_d_windowLogMax]: MAX_ZSTD_WINDOW_LOG,
          },
        });
      default:
        throw new Error(
          `OtelPayloadDecoder: unknown body encoding "${String(encoding)}"`,
        );
    }
  }

  /*
   * Map an OTLP/HTTP request's Content-Encoding header to the queue's
   * decode vocabulary, or null when the body is coded in a way the worker
   * cannot undo. Null is the signal to refuse the request at admission (see
   * OtelRequestMiddleware.parseBody), before its body is stored or queued.
   *
   * Codings are case-insensitive and trimmed. Absent, empty and "identity"
   * all mean uncompressed ("identity" is also dropped from a list, since it
   * is a no-op). More than one real coding is refused even when every one of
   * them is supported: "gzip, zstd" means zstd was applied on top of gzip,
   * and the worker undoes exactly one. An array (hand-built header maps) is
   * read as the comma-joined list, which is also how Node folds a repeated
   * Content-Encoding header.
   */
  public static encodingFromContentEncoding(
    contentEncoding: string | Array<string> | undefined,
  ): OtelPayloadEncoding | null {
    const headerValue: string = Array.isArray(contentEncoding)
      ? contentEncoding.join(",")
      : contentEncoding ?? "";

    const codings: Array<string> = headerValue
      .split(",")
      .map((coding: string) => {
        return coding.trim().toLowerCase();
      })
      .filter((coding: string) => {
        return coding.length > 0 && coding !== "identity";
      });

    if (codings.length === 0) {
      return "none";
    }

    if (codings.length > 1) {
      return null;
    }

    // A Map, not an object literal: "constructor" must not resolve.
    return CONTENT_CODINGS.get(codings[0]!) ?? null;
  }

  /**
   * Surface OTLP `Resource.entity_refs` from a decoded resource envelope
   * as typed refs for `InventoryItem.extractEntities`. `decodeFromQueue`
   * already emits them — the proto defines `entity_refs` and protobufjs'
   * `.toJSON()` camelCases it to `entityRefs`; OTLP/JSON payloads carry
   * `entityRefs` natively — so this only normalizes the raw JSON shape.
   * Returns [] when the producer emitted no refs (the heuristic
   * extraction path).
   */
  public static getEntityRefsFromResource(
    resource: JSONObject | null | undefined,
  ): Array<ResourceEntityRef> {
    return InventoryItem.parseEntityRefs(
      resource ? resource["entityRefs"] : undefined,
    );
  }

  public static formatFromContentType(
    contentType: string | undefined,
  ): OtelPayloadFormat {
    if (
      contentType &&
      (contentType.includes("application/x-protobuf") ||
        contentType.includes("application/protobuf"))
    ) {
      return OtelPayloadFormat.Protobuf;
    }
    return OtelPayloadFormat.Json;
  }
}
