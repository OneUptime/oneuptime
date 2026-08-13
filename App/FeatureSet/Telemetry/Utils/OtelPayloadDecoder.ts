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
export const gunzipAsync: (buffer: Buffer | Uint8Array) => Promise<Buffer> =
  promisify(zlib.gunzip) as unknown as (
    buffer: Buffer | Uint8Array,
  ) => Promise<Buffer>;

export enum OtelPayloadFormat {
  Protobuf = "protobuf",
  Json = "json",
}

export type OtelPayloadEncoding = "gzip" | "none";

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

    let raw: Buffer | null = await TelemetryBodyStore.readBody(input.bodyKey);
    if (!raw) {
      // Body expired (TTL) before the worker got to it — nothing to decode.
      return {} as JSONObject;
    }

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
