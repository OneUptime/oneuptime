import protobuf from "protobufjs";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";

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

export const gunzipAsync: (buffer: Uint8Array) => Promise<Buffer> = promisify(
  zlib.gunzip,
);

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
   * / resourceMetrics / resourceProfiles). `bufferBase64` is the raw
   * request body — gzipped if `encoding === "gzip"`, protobuf or JSON
   * depending on `format`.
   */
  public static async decodeFromQueue(input: {
    productType: ProductType;
    format: OtelPayloadFormat;
    encoding: OtelPayloadEncoding;
    bufferBase64: string;
  }): Promise<JSONObject> {
    let raw: Buffer = Buffer.from(input.bufferBase64, "base64");

    if (input.encoding === "gzip") {
      raw = await gunzipAsync(new Uint8Array(raw));
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
     */
    const message: protobuf.Message<{}> = protoType.decode(new Uint8Array(raw));
    return message.toJSON() as JSONObject;
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
