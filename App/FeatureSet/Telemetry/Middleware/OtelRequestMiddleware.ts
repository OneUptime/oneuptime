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
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";

export default class OpenTelemetryRequestMiddleware {
  /*
   * Read the OTel HTTP request body into a raw Buffer. We deliberately
   * do NOT gunzip or decode protobuf here. Both operations are CPU-
   * bound and used to block the Express event loop on every ingest
   * request (large batches spent 50-150ms decoding before the 200 was
   * sent). The handler now base64-encodes this raw buffer and queues
   * it; the BullMQ worker performs gunzip + protobuf decode off the
   * HTTP path.
   */
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
              new Uint8Array(
                Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf-8"),
              ),
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

      req.body = requestBuffer;

      next();
    } catch (err) {
      return next(err);
    }
  }

  /*
   * Identify the OTel signal type from the URL and stash format /
   * encoding metadata on the request so the handler can forward it to
   * the queue. No payload decoding happens here — that has moved to
   * the worker.
   */
  @CaptureSpan()
  public static async getProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      let productType: ProductType;

      if (req.url.includes("/otlp/v1/traces")) {
        productType = ProductType.Traces;
      } else if (req.url.includes("/otlp/v1/logs")) {
        productType = ProductType.Logs;
      } else if (req.url.includes("/otlp/v1/metrics")) {
        productType = ProductType.Metrics;
      } else if (req.url.includes("/otlp/v1/profiles")) {
        productType = ProductType.Profiles;
      } else {
        throw new BadRequestException("Invalid URL: " + req.baseUrl);
      }

      (req as TelemetryRequest).productType = productType;

      const contentType: string | undefined = headerValueToString(
        req.headers["content-type"],
      );
      const isProtobuf: boolean =
        !contentType ||
        contentType.includes("application/x-protobuf") ||
        contentType.includes("application/protobuf");

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
