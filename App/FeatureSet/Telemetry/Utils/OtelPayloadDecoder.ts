import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import InventoryItem, {
  ResourceEntityRef,
} from "Common/Server/Utils/Telemetry/TelemetryEntity";
import TelemetryBodyStore from "./TelemetryBodyStore";
import OtelDecode, {
  OtelPayloadEncoding,
  OtelPayloadFormat,
  gunzipAsync,
} from "./OtelDecode";
import DecodeThreadPool from "./DecodeThreadPool";
import { TELEMETRY_DECODE_MIN_PAYLOAD_BYTES } from "../Config";

/*
 * Shared OTel protobuf decoders. We previously decoded payloads inside
 * the Express request middleware before responding to the client,
 * which blocked the event loop on every ingest call (large batches
 * spent 50-150ms of unbroken sync CPU on protobuf decode + toJSON).
 * Decoding now happens in the BullMQ worker — both sides import this
 * module so the proto definitions only load once per process.
 *
 * The decode implementation itself (proto roots, gunzip, decode +
 * toJSON) lives in OtelDecode.ts so the decode worker threads can
 * import it without dragging in TelemetryBodyStore/Redis; this module
 * keeps the queue-facing orchestration (body fetch + pool-vs-inline
 * routing) and re-exports the decode module's public surface so
 * existing importers are unaffected.
 */

export { gunzipAsync, OtelPayloadFormat };
export type { OtelPayloadEncoding };

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
   *
   * The Redis read stays HERE on the main thread (the ioredis client
   * is not shareable across threads); only the CPU-bound decode is
   * routed. Routing: when the decode thread pool is enabled AND
   * accepting AND the raw payload is at least
   * TELEMETRY_DECODE_MIN_PAYLOAD_BYTES, the decode runs on a pool
   * thread; otherwise it runs inline via OtelDecode.decodeBody — the
   * SAME implementation the threads execute, so the two paths cannot
   * drift. The pool is enabled by default with an adaptive, cgroup-
   * aware thread count (see Config.ts); when TELEMETRY_DECODE_THREADS
   * resolves to 0 (a 1-effective-CPU pod, or an explicit 0) every
   * payload takes the inline path, which is byte-for-byte the pre-pool
   * behavior.
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

    const raw: Buffer | null = await TelemetryBodyStore.readBody(input.bodyKey);
    if (!raw) {
      // Body expired (TTL) before the worker got to it — nothing to decode.
      return {} as JSONObject;
    }

    if (
      DecodeThreadPool.isAvailable() &&
      raw.length >= TELEMETRY_DECODE_MIN_PAYLOAD_BYTES
    ) {
      /*
       * Pool path. A pool rejection (thread death, shutdown races) is
       * deliberately NOT caught here: the pool's errors are retryable
       * by the BullMQ job layer, and the retry re-evaluates
       * isAvailable() — a pool that marked itself unhealthy in the
       * meantime routes the retry inline.
       */
      return DecodeThreadPool.decode({
        productType: input.productType,
        format: input.format,
        encoding: input.encoding,
        body: raw,
      });
    }

    return OtelDecode.decodeBody({
      productType: input.productType,
      format: input.format,
      encoding: input.encoding,
      body: raw,
    });
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
