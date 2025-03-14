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

// Lookup the message type
const LogsData: protobuf.Type = LogsProto.lookupType("LogsData");
const TracesData: protobuf.Type = TracesProto.lookupType("TracesData");
const MetricsData: protobuf.Type = MetricsProto.lookupType("MetricsData");

export default class OpenTelemetryRequestMiddleware {
  @CaptureSpan()
  public static async getProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      let productType: ProductType;

      const isProtobuf: boolean = req.body instanceof Uint8Array;

      if (req.url.includes("/otlp/v1/traces")) {
        if (isProtobuf) {
          req.body = TracesData.decode(req.body);
        }
        productType = ProductType.Traces;
      } else if (req.url.includes("/otlp/v1/logs")) {
        if (isProtobuf) {
          req.body = LogsData.decode(req.body);
        }

        productType = ProductType.Logs;
      } else if (req.url.includes("/otlp/v1/metrics")) {
        if (isProtobuf) {
          req.body = MetricsData.decode(req.body);
        }
        productType = ProductType.Metrics;
      } else {
        throw new BadRequestException("Invalid URL: " + req.baseUrl);
      }

      (req as TelemetryRequest).productType = productType;

      logger.debug("Product Type: " + productType);
      logger.debug("Is Protobuf: " + isProtobuf);
      logger.debug("Request Body: " + JSON.stringify(req.body, null, 2));

      next();
    } catch (err) {
      return next(err);
    }
  }
}
