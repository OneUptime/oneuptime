import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import { VercelMarketplaceClientSecret } from "Common/Server/EnvironmentConfig";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  headerValueToString,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import VercelSignature, {
  VERCEL_SIGNATURE_HEADER,
} from "Common/Server/Utils/Marketplace/Vercel/VercelSignature";
import Response from "Common/Server/Utils/Response";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import OtelPayloadDecoder, {
  OtelPayloadEncoding,
} from "../Utils/OtelPayloadDecoder";
import VercelLogDrain from "../Utils/VercelLogDrain";
import OtelLogsIngestService from "./OtelLogsIngestService";

/*
 * The Vercel log drain endpoint (POST /vercel/v1/logs, under /telemetry and
 * /): Vercel's log records, checked and turned into OTLP logs.
 *
 * WHO MAY SEND
 *
 * A drain authenticates like every ingest route, with the project's
 * ingestion key in x-oneuptime-token (TelemetryIngest). On top of that,
 * every delivery must be signed by Vercel: x-vercel-signature is the
 * HMAC-SHA1 of the body as sent, and it must be made with either
 *
 *   - the OneUptime integration's client secret: the drains of a OneUptime
 *     resource from Vercel Marketplace, which Vercel signs with it; or
 *   - the ingestion key itself: a drain the team set up by hand (Team
 *     Settings > Drains), whose signing secret they set to the key.
 *
 * So a request with the key but not from Vercel - a leaked header replayed
 * against another body - is refused, and so is a drain whose secret was
 * never set. A compressed delivery's signature is checked over the bytes as
 * sent, and over the decompressed body if that does not match.
 *
 * WHAT IS DONE WITH IT
 *
 * The records (a JSON array or NDJSON) become an ExportLogsServiceRequest
 * (VercelLogDrain) and are queued exactly as an OTLP/HTTP logs export is
 * (OtelLogsIngestService), so drop filters, scrub rules, pipelines,
 * retention and billing apply to them as to any other logs.
 */
export default class VercelLogDrainIngestService {
  public static setProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): void {
    (req as TelemetryRequest).productType = ProductType.Logs;
    next();
  }

  @CaptureSpan()
  public static async verifySignature(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const raw: Buffer = VercelLogDrainIngestService.getRawBody(req);
      const signature: unknown = req.headers[VERCEL_SIGNATURE_HEADER];
      const secrets: Array<string> =
        VercelLogDrainIngestService.getSecrets(req);

      if (
        VercelLogDrainIngestService.isSignedWithAny(raw, signature, secrets)
      ) {
        return next();
      }

      const encoding: OtelPayloadEncoding | null =
        OtelPayloadDecoder.encodingFromContentEncoding(
          req.headers["content-encoding"],
        );

      if (encoding && encoding !== "none") {
        const decompressed: Buffer = await OtelPayloadDecoder.decompress(
          raw,
          encoding,
        );

        if (
          VercelLogDrainIngestService.isSignedWithAny(
            decompressed,
            signature,
            secrets,
          )
        ) {
          // Decompressed once, here: the handler reads it as it is.
          req.body = decompressed;
          delete req.headers["content-encoding"];
          return next();
        }
      }

      logger.warn(
        "Refused a Vercel log drain delivery: its x-vercel-signature does not match.",
        getLogAttributesFromRequest(req as RequestLike),
      );

      /*
       * 403, not 401: Vercel shows the drain as errored, with this message,
       * rather than retrying a delivery that will never be accepted.
       */
      res.status(403).json({
        message:
          "The x-vercel-signature header does not match this delivery. For a drain you set up yourself, set its signing secret to the OneUptime ingestion key you send in x-oneuptime-token.",
      });
    } catch (err) {
      next(err);
    }
  }

  @CaptureSpan()
  public static async ingest(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      let raw: Buffer = VercelLogDrainIngestService.getRawBody(req);

      const encoding: OtelPayloadEncoding | null =
        OtelPayloadDecoder.encodingFromContentEncoding(
          req.headers["content-encoding"],
        );

      if (encoding && encoding !== "none") {
        raw = await OtelPayloadDecoder.decompress(raw, encoding);
      }

      const records: Array<JSONObject> = VercelLogDrain.parseBody(raw);

      // A test delivery, or one with nothing to keep: Vercel only needs to hear it arrived.
      if (records.length === 0) {
        return Response.sendEmptySuccessResponse(req, res);
      }

      req.body = VercelLogDrain.toOtlpLogs(records);
      delete req.headers["content-encoding"];
      req.headers["content-type"] = "application/json";

      return await OtelLogsIngestService.ingestLogs(req, res, next);
    } catch (err) {
      next(err);
    }
  }

  private static getRawBody(req: ExpressRequest): Buffer {
    const body: unknown = req.body;

    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }

    if (typeof body === "string") {
      return Buffer.from(body, "utf8");
    }

    return Buffer.alloc(0);
  }

  // The integration's client secret (OneUptime Cloud), and the ingestion key the request carries.
  private static getSecrets(req: ExpressRequest): Array<string> {
    const secrets: Array<string> = [];

    if (VercelMarketplaceClientSecret) {
      secrets.push(VercelMarketplaceClientSecret);
    }

    const key: string | undefined =
      headerValueToString(req.headers["x-oneuptime-token"]) ||
      headerValueToString(req.headers["x-oneuptime-ingestion-key"]);

    if (key) {
      secrets.push(key);
    }

    return secrets;
  }

  private static isSignedWithAny(
    body: Buffer,
    signature: unknown,
    secrets: Array<string>,
  ): boolean {
    return secrets.some((secret: string): boolean => {
      return VercelSignature.isValid({
        body: body,
        signature: signature,
        secret: secret,
      });
    });
  }
}
