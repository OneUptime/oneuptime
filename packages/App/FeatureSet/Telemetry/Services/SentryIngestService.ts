import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  headerValueToString,
} from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { JSONObject } from "Common/Types/JSON";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import { COMPATIBLE_JSON_MAX_VALUES } from "Common/Types/Telemetry/CompatibleIngest";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import CompatibleIngestBody from "../Utils/Compatible/CompatibleIngestBody";
import CompatibleIngestFailureMapper, {
  CompatibleIngestFailure,
} from "../Utils/Compatible/CompatibleIngestFailure";
import JsonElementCounter, {
  JsonElementCount,
  JsonElementCountOutcome,
  JsonValueBudget,
} from "../Utils/Compatible/JsonElementCount";
import SentryEnvelope, {
  ParsedSentryEnvelope,
  SentryEnvelopeError,
  SentryTranslation,
} from "../Utils/Compatible/SentryEnvelope";
import CompatibleIngestService, {
  CompatibleIngestBytes,
} from "./CompatibleIngestService";

/*
 * Sentry's ingest API: POST /sentry/api/<n>/envelope/ and
 * /sentry/api/<n>/store/ (and under /telemetry), where a DSN of
 * https://<key>@<host>/telemetry/sentry/<n> makes every Sentry SDK send.
 * See SentryEnvelope for what an error, a transaction, a log, a cron
 * check-in, feedback or a profile becomes.
 *
 * Answered as Sentry answers: 200 with the event's {"id"}, 400 with a
 * {"detail"} for a body that is not an envelope or an event, 413 for one
 * whose JSON holds more than COMPATIBLE_JSON_MAX_VALUES values (counted
 * before it is parsed) - the SDK drops either - and 503 when the queue
 * cannot take it. An envelope's spans, logs and profiles are queued as
 * separate jobs, each counted against its own signal's ingestion budget
 * (CompatibleIngestService) at the size of the items it came from,
 * decompressed: its profiles against the profiles budget, its check-ins
 * and feedback against the logs one, and its attachments, replays and
 * sessions, which are not kept, against none.
 *
 * The key is the DSN's public key: server SDKs send it in X-Sentry-Auth,
 * browser SDKs as ?sentry_key= (a simple request, so no CORS preflight),
 * and a browser app's DSN carries a Browser ingestion key - this is the
 * one compatible surface a browser key may write to.
 */
export default class SentryIngestService {
  public static setProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): void {
    (req as TelemetryRequest).productType = ProductType.Traces;
    next();
  }

  @CaptureSpan()
  public static async ingestEnvelope(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);
      // One limit for the envelope's header lines and items together.
      const jsonValues: JsonValueBudget = new JsonValueBudget(
        COMPATIBLE_JSON_MAX_VALUES,
      );
      const envelope: ParsedSentryEnvelope = SentryEnvelope.parseEnvelope(
        body,
        jsonValues,
      );
      const translation: SentryTranslation = SentryEnvelope.fromEnvelope(
        envelope,
        {
          serviceName: SentryIngestService.serviceNameOf(req),
          jsonValues: jsonValues,
        },
      );

      await SentryIngestService.enqueue(req, translation, {
        traces: translation.ingestBytes.traces,
        logs: translation.ingestBytes.logs,
        profiles: translation.ingestBytes.profiles,
      });
      SentryIngestService.answer(res, translation);
    } catch (error) {
      SentryIngestService.fail(error, res, next);
    }
  }

  @CaptureSpan()
  public static async ingestStoreEvent(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);
      const text: string = body.toString("utf8");
      const values: JsonElementCount = JsonElementCounter.count(
        text,
        COMPATIBLE_JSON_MAX_VALUES,
      );

      if (values.outcome === JsonElementCountOutcome.OverLimit) {
        throw SentryEnvelope.tooManyValues(COMPATIBLE_JSON_MAX_VALUES);
      }

      let event: unknown;

      try {
        event = JSON.parse(text);
      } catch {
        throw new SentryEnvelopeError("The body is not a JSON event.");
      }

      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new SentryEnvelopeError("The body is not a JSON event.");
      }

      const translation: SentryTranslation = SentryEnvelope.fromStoreEvent(
        event as JSONObject,
        { serviceName: SentryIngestService.serviceNameOf(req) },
      );

      // One event, which becomes a span or a log record: all of the body.
      await SentryIngestService.enqueue(req, translation, body.length);
      SentryIngestService.answer(res, translation);
    } catch (error) {
      SentryIngestService.fail(error, res, next);
    }
  }

  private static async enqueue(
    req: ExpressRequest,
    translation: SentryTranslation,
    ingestBytes: CompatibleIngestBytes,
  ): Promise<void> {
    await CompatibleIngestService.enqueue({
      req: req as TelemetryRequest,
      surface: TelemetryIngestSurface.Sentry,
      batch: {
        traces: translation.traces,
        logs: translation.logs,
        profiles: translation.profiles,
      },
      ingestBytes: ingestBytes,
    });
  }

  private static answer(
    res: ExpressResponse,
    translation: SentryTranslation,
  ): void {
    if (res.headersSent) {
      return;
    }

    res
      .status(200)
      .json(translation.eventId ? { id: translation.eventId } : {});
  }

  private static serviceNameOf(req: ExpressRequest): string | undefined {
    return headerValueToString(req.headers["x-oneuptime-service-name"]);
  }

  private static fail(
    error: unknown,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    const failure: CompatibleIngestFailure | null =
      CompatibleIngestFailureMapper.fromError(error, [SentryEnvelopeError]);

    if (!failure) {
      next(error);
      return;
    }

    if (!res.headersSent) {
      res.status(failure.statusCode).json({ detail: failure.message });
    }
  }
}
