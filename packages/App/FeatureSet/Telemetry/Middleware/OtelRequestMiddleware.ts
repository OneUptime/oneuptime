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

/*
 * Byte ceiling for one OTLP ingest request, measured on the wire (so on
 * the COMPRESSED body when the client sends gzip).
 *
 * This middleware reads the socket itself, which means none of the global
 * body-parser limits in StartServer apply to it - before this constant
 * existed the only bound was whatever nginx happened to allow, and a
 * deployment fronted by something else, or reached directly, had none at
 * all. 50 MiB is the same number body-parser is given everywhere else in
 * the app, and nginx cuts it to 1-4 MiB in the shipped config, so no
 * legitimate exporter is affected.
 */
export const MAX_OTLP_REQUEST_BYTES: number = 50 * 1024 * 1024;

export default class OpenTelemetryRequestMiddleware {
  /*
   * Read the OTel HTTP request body into a raw Buffer. We deliberately
   * do NOT gunzip or decode protobuf here. Both operations are CPU-
   * bound and used to block the Express event loop on every ingest
   * request (large batches spent 50-150ms decoding before the 200 was
   * sent). The handler now base64-encodes this raw buffer and queues
   * it; the BullMQ worker performs gunzip + protobuf decode off the
   * HTTP path.
   *
   * It does enforce a byte cap. The worker's inflate has its own ceiling
   * (MAX_DECOMPRESSED_OTLP_BODY_BYTES), but that one only fires after the
   * body has already been read into this process and written to Redis, so
   * both ends need bounding.
   */
  @CaptureSpan()
  public static async parseBody(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (req.body !== undefined && req.body !== null) {
        return next();
      }

      /*
       * Cheap pre-check before a byte is read. Content-Length is advisory
       * - a chunked request carries none - but when it is present and
       * already over the cap there is no reason to accept the body.
       */
      const contentLengthHeader: string | undefined = headerValueToString(
        req.headers["content-length"],
      );

      if (contentLengthHeader) {
        const declaredLength: number = parseInt(contentLengthHeader, 10);

        if (!isNaN(declaredLength) && declaredLength > MAX_OTLP_REQUEST_BYTES) {
          OpenTelemetryRequestMiddleware.rejectTooLarge(res, declaredLength);
          return;
        }
      }

      const requestBuffer: Buffer | null = await new Promise<Buffer | null>(
        (
          resolve: (value: Buffer | null) => void,
          reject: (err: Error) => void,
        ) => {
          const chunks: Array<Uint8Array> = [];
          let receivedBytes: number = 0;
          let rejected: boolean = false;

          const onData: (chunk: Buffer | string) => void = (
            chunk: Buffer | string,
          ): void => {
            if (rejected) {
              return;
            }

            const asBuffer: Buffer = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk, "utf-8");

            receivedBytes += asBuffer.length;

            if (receivedBytes > MAX_OTLP_REQUEST_BYTES) {
              rejected = true;

              /*
               * Answer FIRST, then stop accumulating. The OTel spec tells
               * exporters to treat 4xx as non-retryable, so a 413 makes a
               * misconfigured batch size stop rather than loop; tearing
               * the socket down instead would read as a network error and
               * be retried forever.
               */
              OpenTelemetryRequestMiddleware.rejectTooLarge(res, receivedBytes);

              chunks.length = 0;

              req.removeListener("data", onData);
              req.resume();

              resolve(null);
              return;
            }

            chunks.push(new Uint8Array(asBuffer));
          };

          req.on("data", onData);

          req.on("end", () => {
            if (rejected) {
              return;
            }

            resolve(Buffer.concat(chunks));
          });

          req.on("error", (err: Error) => {
            if (rejected) {
              return;
            }

            reject(err);
          });
        },
      );

      if (requestBuffer === null) {
        // Already answered with 413. Do not continue down the stack.
        return;
      }

      req.body = requestBuffer;

      next();
    } catch (err) {
      return next(err);
    }
  }

  private static rejectTooLarge(res: ExpressResponse, bytes: number): void {
    if (res.headersSent) {
      return;
    }

    res.status(413).json({
      error: "payload-too-large",
      message: `An OTLP ingest request may not exceed ${MAX_OTLP_REQUEST_BYTES} bytes. Received at least ${bytes}.`,
    });
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
