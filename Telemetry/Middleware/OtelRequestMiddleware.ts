import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import protobuf from "protobufjs";
import logger from "Common/Server/Utils/Logger";

// Load proto file for OTel

// Create a root namespace
const LogsProto: protobuf.Root = protobuf.loadSync(
  "/usr/src/app/ProtoFiles/OTel/v1/logs.proto",
);

const TracesProto: protobuf.Root = protobuf.loadSync(
  "/usr/src/app/ProtoFiles/OTel/v1/traces.proto",
);

const MetricsProto: protobuf.Root = protobuf.loadSync(
  "/usr/src/app/ProtoFiles/OTel/v1/metrics.proto",
);

const ProfilesProto: protobuf.Root = protobuf.loadSync(
  "/usr/src/app/ProtoFiles/OTel/v1/profiles.proto",
);

// Lookup the message type
const LogsData: protobuf.Type = LogsProto.lookupType("LogsData");
const TracesData: protobuf.Type = TracesProto.lookupType("TracesData");
const MetricsData: protobuf.Type = MetricsProto.lookupType("MetricsData");
const ProfilesData: protobuf.Type = ProfilesProto.lookupType("ProfilesData");

export default class OpenTelemetryRequestMiddleware {
  @CaptureSpan()
  public static async getProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      let productType: ProductType;

      const contentType: string | undefined = req.headers["content-type"];
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

      logger.debug("Product Type: " + productType);
      logger.debug("Is Protobuf: " + isProtobuf);

      next();
    } catch (err) {
      return next(err);
    }
  }
}
