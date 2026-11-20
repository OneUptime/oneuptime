import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  headerValueToString,
} from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { LOKI_PUSH_MAX_BYTES } from "Common/Types/Telemetry/CompatibleIngest";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import CompatibleIngestBody, {
  CompatibleBodyEncoding,
  CompatibleBodyLimits,
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
 * read as JSON, gzip or deflate undone. A Content-Encoding of snappy says
 * nothing more, as in Loki (pkg/loghttp/push): Grafana Alloy and Vector
 * send it with every protobuf push, so its snappy is undone once, never
 * twice, and a JSON body that names it is read as it is.
 *
 * Answered as Loki answers, so a client retries only what it should:
 *
 *   - 204 once the entries are queued;
 *   - 400 with the reason as plain text for a body that cannot be read;
 *   - 413 for a push over LOKI_PUSH_MAX_BYTES as sent or decompressed, or
 *     one that holds more than LOKI_PUSH_MAX_ELEMENTS streams, entries,
 *     labels and structured metadata (or, in JSON, more than
 *     COMPATIBLE_JSON_MAX_VALUES values) - counted before it is decoded;
 *   - 503 when the queue cannot take it.
 *
 * Promtail, Alloy and Vector drop a batch answered 400 or 413 and log why
 * (Alloy counts a 413 as batch_too_large), and retry a 429 or a 5xx;
 * Fluent Bit drops a 400 and retries anything else. The key's own
 * refusals come from the TelemetryIngest guard before the body is read:
 * 401 for a missing or unknown key, 403 for a used-up daily budget, 429
 * for a rate.
 *
 * The key travels as the client's basic_auth (any username, the key as the
 * password) or bearer_token, or as an x-oneuptime-token header.
 *
 * INGESTION BUDGETS
 *
 * The door checked the logs budget without sizing the body (a deferred
 * surface); the push is counted at the size of its body decompressed - the
 * protobuf once its snappy is undone, or the JSON as read - as an OTLP
 * export is, and that same number is what the worker shares out over the
 * services, teams and labels of the batch.
 */

const LOKI_LIMITS: CompatibleBodyLimits = {
  maxBodyBytes: LOKI_PUSH_MAX_BYTES,
  maxDecompressedBytes: LOKI_PUSH_MAX_BYTES,
};

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
      const body: Buffer = await LokiIngestService.readBody(req);

      const isProtobuf: boolean = LokiIngestService.isProtobuf(
        headerValueToString(req.headers["content-type"]),
      );

      // The body decompressed: what the push's budget counts.
      const decompressed: Buffer = isProtobuf
        ? LokiIngestService.unsnappy(body)
        : body;

      const streams: Array<LokiStream> = isProtobuf
        ? LokiPush.parseProtobuf(decompressed)
        : LokiPush.parseJson(decompressed);

      const translation: LokiTranslation = LokiPush.toOtlp(streams, {
        serviceName: headerValueToString(
          req.headers["x-oneuptime-service-name"],
        ),
      });

      await CompatibleIngestService.enqueue({
        req: req as TelemetryRequest,
        surface: TelemetryIngestSurface.Loki,
        batch: { logs: translation.logs },
        ingestBytes: decompressed.length,
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

  /*
   * The body, its Content-Encoding undone - except snappy, which Loki reads
   * as saying nothing (a protobuf push's snappy is undone below).
   */
  private static async readBody(req: ExpressRequest): Promise<Buffer> {
    const encoding: CompatibleBodyEncoding | null =
      CompatibleIngestBody.encodingOf(req.headers["content-encoding"]);

    if (encoding === "snappy") {
      return await CompatibleIngestBody.readRaw(req, LOKI_LIMITS);
    }

    return await CompatibleIngestBody.read(req, { limits: LOKI_LIMITS });
  }

  private static unsnappy(body: Buffer): Buffer {
    const maxBytes: number =
      CompatibleIngestBody.maxDecompressedBytes(LOKI_LIMITS);

    try {
      return SnappyBlock.decompress(body, maxBytes);
    } catch (error) {
      if (error instanceof SnappyTooLargeError) {
        throw CompatibleIngestBody.decompressesTooLarge(maxBytes);
      }

      throw new LokiPushError(
        "A protobuf push must be snappy-compressed, as Loki's clients send it.",
      );
    }
  }
}
