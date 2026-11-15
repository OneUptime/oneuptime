import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  headerValueToString,
} from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import { MAX_DECOMPRESSED_OTLP_BODY_BYTES } from "../Utils/OtelPayloadDecoder";
import CompatibleIngestBody, {
  CompatibleBodyError,
} from "../Utils/Compatible/CompatibleIngestBody";
import CompatibleIngestFailureMapper, {
  CompatibleIngestFailure,
} from "../Utils/Compatible/CompatibleIngestFailure";
import LokiPush, {
  LokiPushError,
  LokiStream,
  LokiTranslation,
} from "../Utils/Compatible/LokiPush";
import SnappyBlock, {
  SnappyTooLargeError,
} from "../Utils/Compatible/SnappyBlock";
import CompatibleIngestService from "./CompatibleIngestService";

/*
 * Loki's push API: POST /loki/api/v1/push (and under /telemetry). See
 * LokiPush for what a stream becomes.
 *
 * A protobuf push (Content-Type application/x-protobuf) is snappy-
 * compressed whether or not it says so, as Loki reads it; anything else is
 * read as JSON, gzip or deflate undone. Answered as Loki answers: 204 once
 * the entries are queued, 400 with the reason as plain text for a body
 * that cannot be read (Promtail and Alloy drop it rather than retry), 503
 * when the queue cannot take it (they retry).
 *
 * The key travels as the client's basic_auth (any username, the key as the
 * password) or bearer_token, or as an x-oneuptime-token header.
 */
export default class LokiIngestService {
  public static setProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): void {
    (req as TelemetryRequest).productType = ProductType.Logs;
    next();
  }

  public static isProtobuf(contentType: string | undefined): boolean {
    const mediaType: string = (contentType || "")
      .split(";")[0]!
      .trim()
      .toLowerCase();

    return (
      mediaType === "application/x-protobuf" ||
      mediaType === "application/protobuf"
    );
  }

  @CaptureSpan()
  public static async ingest(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);

      const streams: Array<LokiStream> = LokiIngestService.isProtobuf(
        headerValueToString(req.headers["content-type"]),
      )
        ? LokiPush.parseProtobuf(LokiIngestService.unsnappy(body))
        : LokiPush.parseJson(body);

      const translation: LokiTranslation = LokiPush.toOtlp(streams, {
        serviceName: headerValueToString(
          req.headers["x-oneuptime-service-name"],
        ),
      });

      await CompatibleIngestService.enqueue({
        req: req as TelemetryRequest,
        surface: TelemetryIngestSurface.Loki,
        batch: { logs: translation.logs },
      });

      res.status(204).end();
    } catch (error) {
      const failure: CompatibleIngestFailure | null =
        CompatibleIngestFailureMapper.fromError(error, [LokiPushError]);

      if (failure) {
        if (!res.headersSent) {
          res
            .status(failure.statusCode)
            .type("text/plain")
            .send(failure.message);
        }

        return;
      }

      next(error);
    }
  }

  private static unsnappy(body: Buffer): Buffer {
    try {
      return SnappyBlock.decompress(body, MAX_DECOMPRESSED_OTLP_BODY_BYTES);
    } catch (error) {
      if (error instanceof SnappyTooLargeError) {
        throw new CompatibleBodyError(413, error.message);
      }

      throw new LokiPushError(
        "A protobuf push must be snappy-compressed, as Loki's clients send it.",
      );
    }
  }
}
