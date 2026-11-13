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
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import CompatibleIngestBody from "../Utils/Compatible/CompatibleIngestBody";
import CompatibleIngestFailureMapper, {
  CompatibleIngestFailure,
} from "../Utils/Compatible/CompatibleIngestFailure";
import SplunkHec, {
  HEC_HTTP_STATUS,
  HEC_RESPONSES,
  SplunkHecDefaults,
  SplunkHecEventsOtlp,
  SplunkHecParseResult,
  SplunkHecRawOtlp,
  SplunkHecResponseName,
} from "../Utils/Compatible/SplunkHec";
import CompatibleIngestService from "./CompatibleIngestService";

/*
 * Splunk's HTTP Event Collector: POST /services/collector[/event][/1.0]
 * and /services/collector/raw[/1.0], GET /services/collector/health (each
 * also under /telemetry). See SplunkHec for what an event becomes.
 *
 * Answered as HEC answers - {"text": "Success", "code": 0}, and HEC's own
 * codes and statuses for a body it refuses (no data, invalid data format
 * with the invalid-event-number, a missing or blank event field) - so a
 * client that reads HEC's answers reads these. A batch of logs and metric
 * events is queued as two jobs, each counted against its own signal's
 * ingestion budget (CompatibleIngestService). Indexer acknowledgement is
 * not offered: a client that asks for it gets no ackId.
 *
 * The token travels as HEC's own `Authorization: Splunk <token>`, as basic
 * auth (any username, the key as the password), as a bearer token or as an
 * x-oneuptime-token header.
 */
export default class SplunkHecIngestService {
  public static setProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): void {
    (req as TelemetryRequest).productType = ProductType.Logs;
    next();
  }

  // HEC's health check: no token needed, as in Splunk.
  public static health(_req: ExpressRequest, res: ExpressResponse): void {
    SplunkHecIngestService.answer(res, "healthy");
  }

  @CaptureSpan()
  public static async ingestEvents(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);
      const parsed: SplunkHecParseResult = SplunkHec.parseEvents(body);

      if ("error" in parsed) {
        const refusal: { httpStatus: number; body: JSONObject } =
          SplunkHec.refusalFor(parsed);

        res.status(refusal.httpStatus).json(refusal.body);
        return;
      }

      const translation: SplunkHecEventsOtlp = SplunkHec.eventsToOtlp(
        parsed.events,
        {
          defaults: SplunkHecIngestService.defaultsOf(req),
          serviceName: headerValueToString(
            req.headers["x-oneuptime-service-name"],
          ),
        },
      );

      await CompatibleIngestService.enqueue({
        req: req as TelemetryRequest,
        surface: TelemetryIngestSurface.SplunkHec,
        batch: { logs: translation.logs, metrics: translation.metrics },
      });

      SplunkHecIngestService.answer(res, "success");
    } catch (error) {
      SplunkHecIngestService.fail(error, res, next);
    }
  }

  @CaptureSpan()
  public static async ingestRaw(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);

      const translation: SplunkHecRawOtlp = SplunkHec.rawToOtlp(body, {
        defaults: SplunkHecIngestService.defaultsOf(req),
        serviceName: headerValueToString(
          req.headers["x-oneuptime-service-name"],
        ),
      });

      if (translation.logCount === 0) {
        SplunkHecIngestService.answer(res, "noData");
        return;
      }

      await CompatibleIngestService.enqueue({
        req: req as TelemetryRequest,
        surface: TelemetryIngestSurface.SplunkHec,
        batch: { logs: translation.logs },
      });

      SplunkHecIngestService.answer(res, "success");
    } catch (error) {
      SplunkHecIngestService.fail(error, res, next);
    }
  }

  // ?host=&source=&sourcetype=&index=&time=: what an event leaves out.
  public static defaultsOf(req: ExpressRequest): SplunkHecDefaults {
    const query: Record<string, unknown> = (req.query || {}) as Record<
      string,
      unknown
    >;

    const read: (name: string) => string | undefined = (
      name: string,
    ): string | undefined => {
      const value: unknown = query[name];

      if (typeof value === "string") {
        return value;
      }

      if (Array.isArray(value) && typeof value[0] === "string") {
        return value[0];
      }

      return undefined;
    };

    return {
      host: read("host"),
      source: read("source"),
      sourcetype: read("sourcetype"),
      index: read("index"),
      time: read("time"),
    };
  }

  private static fail(
    error: unknown,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    const failure: CompatibleIngestFailure | null =
      CompatibleIngestFailureMapper.fromError(error, []);

    if (!failure) {
      next(error);
      return;
    }

    if (res.headersSent) {
      return;
    }

    if (failure.statusCode === 503) {
      SplunkHecIngestService.answer(res, "serverBusy");
      return;
    }

    // A body it cannot read: HEC's "Invalid data format", with why.
    res.status(failure.statusCode).json({
      text: failure.message,
      code: HEC_RESPONSES.invalidDataFormat.code,
    });
  }

  private static answer(
    res: ExpressResponse,
    name: SplunkHecResponseName,
  ): void {
    if (res.headersSent) {
      return;
    }

    res.status(HEC_HTTP_STATUS[name]).json({
      text: HEC_RESPONSES[name].text,
      code: HEC_RESPONSES[name].code,
    });
  }
}
