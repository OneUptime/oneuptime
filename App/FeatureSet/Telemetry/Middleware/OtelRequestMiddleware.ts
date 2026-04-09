import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  headerValueToString,
} from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import protobuf from "protobufjs";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";

// Load proto file for OTel

const PROTO_DIR: string = path.resolve(
  __dirname,
  "..",
  "ProtoFiles",
  "OTel",
  "v1",
);

// Create a root namespace
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

// Lookup the message type
const LogsData: protobuf.Type = LogsProto.lookupType("LogsData");
const TracesData: protobuf.Type = TracesProto.lookupType("TracesData");
const MetricsData: protobuf.Type = MetricsProto.lookupType("MetricsData");
const ProfilesData: protobuf.Type = ProfilesProto.lookupType("ProfilesData");
const gunzipAsync: (buffer: Uint8Array) => Promise<Buffer> = promisify(
  zlib.gunzip,
);

export default class OpenTelemetryRequestMiddleware {
  @CaptureSpan()
  public static async parseBody(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (req.body !== undefined && req.body !== null) {
        return next();
      }

      const requestBuffer: Buffer = await new Promise<Buffer>(
        (resolve: (value: Buffer) => void, reject: (err: Error) => void) => {
          const chunks: Array<Uint8Array> = [];

          req.on("data", (chunk: Buffer | string) => {
            chunks.push(
              new Uint8Array(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8")),
            );
          });

          req.on("end", () => {
            resolve(Buffer.concat(chunks));
          });

          req.on("error", (err: Error) => {
            reject(err);
          });
        },
      );

      const contentEncoding: string | undefined = headerValueToString(
        req.headers["content-encoding"],
      );

      req.body = contentEncoding?.includes("gzip")
        ? await gunzipAsync(new Uint8Array(requestBuffer))
        : requestBuffer;

      next();
    } catch (err) {
      return next(err);
    }
  }

  @CaptureSpan()
  public static async getProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      let productType: ProductType;

      const contentType: string | undefined = headerValueToString(
        req.headers["content-type"],
      );
      const isProtobuf: boolean =
        req.body instanceof Uint8Array &&
        (!contentType ||
          contentType.includes("application/x-protobuf") ||
          contentType.includes("application/protobuf"));

      if (req.url.includes("/otlp/v1/traces")) {
        if (isProtobuf) {
          req.body = TracesData.decode(req.body);
        } else if (req.body instanceof Uint8Array) {
          req.body = JSON.parse(Buffer.from(req.body).toString("utf-8"));
        }
        productType = ProductType.Traces;
      } else if (req.url.includes("/otlp/v1/logs")) {
        if (isProtobuf) {
          req.body = LogsData.decode(req.body);
        } else if (req.body instanceof Uint8Array) {
          req.body = JSON.parse(Buffer.from(req.body).toString("utf-8"));
        }

        productType = ProductType.Logs;
      } else if (req.url.includes("/otlp/v1/metrics")) {
        if (isProtobuf) {
          req.body = MetricsData.decode(req.body);
        } else if (req.body instanceof Uint8Array) {
          req.body = JSON.parse(Buffer.from(req.body).toString("utf-8"));
        }
        productType = ProductType.Metrics;
      } else if (req.url.includes("/otlp/v1/profiles")) {
        if (isProtobuf) {
          req.body = ProfilesData.decode(req.body);
        } else if (req.body instanceof Uint8Array) {
          req.body = JSON.parse(Buffer.from(req.body).toString("utf-8"));
        }
        productType = ProductType.Profiles;
      } else {
        throw new BadRequestException("Invalid URL: " + req.baseUrl);
      }

      (req as TelemetryRequest).productType = productType;

      logger.debug(
        "Product Type: " + productType,
        getLogAttributesFromRequest(req as any),
      );
      logger.debug(
        "Is Protobuf: " + isProtobuf,
        getLogAttributesFromRequest(req as any),
      );

      next();
    } catch (err) {
      return next(err);
    }
  }
}
