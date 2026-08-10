import protobuf from "protobufjs";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";

/*
 * Pure OTel payload decoding: gunzip + protobuf decode + `.toJSON()`
 * (or JSON.parse for OTLP/JSON), with zero infrastructure attached.
 *
 * This module is extracted from OtelPayloadDecoder so that the SAME
 * decode implementation has exactly two call sites:
 *
 *   1. Inline on the main thread (OtelPayloadDecoder.decodeFromQueue,
 *      the default path — byte-for-byte the pre-extraction behavior), and
 *   2. Inside a worker thread (DecodeWorkerThread), where the decode
 *      pool moves the sync CPU burn (gunzip inflate + protobuf decode
 *      + toJSON of multi-MB batches) off the worker process's main
 *      event loop.
 *
 * CRITICAL CONSTRAINT: every worker thread imports this module
 * standalone, so this module (and everything it transitively imports)
 * must NOT import TelemetryBodyStore, Redis, Postgres, Config, the
 * exporter-wired logger, or any other infrastructure — a thread must
 * never open datastore connections or start telemetry just to decode
 * bytes. The import closure here is intentionally only:
 *
 *   - protobufjs (pure JS),
 *   - node builtins (path / zlib / util),
 *   - Common/Types/MeteredPlan/ProductType (a dependency-free enum),
 *   - Common/Types/JSON (type-only — elided at emit).
 *
 * Keep it that way when editing.
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
 *
 * Async (callback-based) gunzip is deliberately kept even for the
 * worker-thread call site: a worker thread has its own event loop, so
 * the async form costs nothing there, and sharing one implementation
 * keeps the two call sites byte-identical.
 */
export const gunzipAsync: (buffer: Buffer | Uint8Array) => Promise<Buffer> =
  promisify(zlib.gunzip) as unknown as (
    buffer: Buffer | Uint8Array,
  ) => Promise<Buffer>;

export enum OtelPayloadFormat {
  Protobuf = "protobuf",
  Json = "json",
}

export type OtelPayloadEncoding = "gzip" | "none";

export interface OtelDecodeInput {
  productType: ProductType;
  format: OtelPayloadFormat;
  encoding: OtelPayloadEncoding;
  body: Buffer;
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

export default class OtelDecode {
  /*
   * Decode a raw OTel payload Buffer into a plain JS object matching
   * the OTel data model (resourceSpans / resourceLogs / resourceMetrics
   * / resourceProfiles). This is the whole CPU-bound part of the job:
   * gunzip-if-needed, then JSON.parse or protobuf decode + toJSON.
   *
   * Behavior (including thrown error messages) is preserved verbatim
   * from the pre-extraction OtelPayloadDecoder.decodeFromQueue — the
   * queue layer's failure text and retry semantics must not change
   * just because the code moved. That is why the "no proto type" error
   * below still says "OtelPayloadDecoder:".
   */
  public static async decodeBody(input: OtelDecodeInput): Promise<JSONObject> {
    let raw: Buffer = input.body;

    if (input.encoding === "gzip") {
      raw = await gunzipAsync(raw);
    }

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
}
