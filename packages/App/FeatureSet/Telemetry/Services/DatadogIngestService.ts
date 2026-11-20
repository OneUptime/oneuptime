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
import { drainCloudStreamBody } from "../Utils/CloudStreamBody";
import CompatibleIngestBody from "../Utils/Compatible/CompatibleIngestBody";
import CompatibleIngestFailureMapper, {
  CompatibleIngestFailure,
} from "../Utils/Compatible/CompatibleIngestFailure";
import DatadogIntake, {
  DatadogIntakeError,
  DatadogLogQuery,
  DatadogLogsTranslation,
  DatadogMetricsTranslation,
} from "../Utils/Compatible/DatadogIntake";
import DatadogTraces, {
  DatadogTracerProtocol,
  DatadogTracesTranslation,
} from "../Utils/Compatible/DatadogTraces";
import CompatibleIngestService, {
  CompatibleOtlpBatch,
} from "./CompatibleIngestService";

/*
 * The Datadog Agent's and Datadog HTTP API's intake, under /datadog (the
 * Agent's dd_url is <host>/telemetry/datadog), and logs at the root too,
 * for a request carrying a DD-API-KEY header - the Agent posts logs to
 * /api/v2/logs on the host:port logs_dd_url names. See DatadogIntake for
 * what each payload becomes.
 *
 * Answered as Datadog's intake answers: 202 with {} for logs, sketches,
 * APM traces and stats and the Agent's metadata, {"status": "ok"} for v1
 * series and check runs, {"errors": []} for v2 series, {"valid": true} for
 * a key it validates; and as the Agent answers a tracer: {"rate_by_service":
 * {}} for /v0.4 and /v0.5 traces (no rates: the tracer keeps its own), "OK"
 * for /v0.3. A body it cannot read is a 400 with {"errors": ["<why>"]},
 * and one over the limits (DatadogIntake, DatadogTraces) a 413 - the Agent
 * and the tracers drop either payload and log why - and a queue that cannot
 * take it a 503 (they retry).
 *
 * Logs, metrics and traces are counted against their own signals'
 * ingestion budgets as they are queued (CompatibleIngestService), never
 * refused at the door: the Agent reports a 403 as an invalid API key. Each
 * is counted at the size of its body decompressed, as an OTLP export is.
 */
export default class DatadogIngestService {
  public static setProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): void {
    (req as TelemetryRequest).productType = ProductType.Metrics;
    next();
  }

  // The APM routes carry traces.
  public static setTracesProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): void {
    (req as TelemetryRequest).productType = ProductType.Traces;
    next();
  }

  /*
   * /api/v2/logs at the root is OneUptime's API namespace: it is only
   * Datadog's for a request that says it is, with a DD-API-KEY header.
   * Anything else goes on to the routes after this one.
   */
  public static onlyWithApiKey(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): void {
    if (headerValueToString(req.headers["dd-api-key"])) {
      next();
      return;
    }

    next("route");
  }

  // GET /api/v1/validate: reached only once the key has been checked.
  public static validate(_req: ExpressRequest, res: ExpressResponse): void {
    res.status(200).json({ valid: true });
  }

  /*
   * What the Agent reports about itself and its host (/intake,
   * /api/v1/metadata): not telemetry, so not kept - but accepted, so the
   * Agent reports no error for it.
   */
  public static acceptMetadata(
    req: ExpressRequest,
    res: ExpressResponse,
  ): void {
    drainCloudStreamBody(req);
    res.status(202).json({});
  }

  /*
   * The APM stats the Agent computes from its traces (/api/v0.2/stats):
   * OneUptime computes its own from the spans, so they are not kept - but
   * accepted, so the Agent reports no error for them.
   */
  public static acceptTraceStats(
    req: ExpressRequest,
    res: ExpressResponse,
  ): void {
    drainCloudStreamBody(req);
    res.status(202).json({});
  }

  // POST /api/v0.2/traces: the Agent's AgentPayload, gzip or zstd.
  @CaptureSpan()
  public static async ingestTraces(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);
      const translation: DatadogTracesTranslation =
        DatadogTraces.agentPayloadToOtlp(body, {
          serviceName: DatadogIngestService.serviceNameOf(req),
        });

      await DatadogIngestService.enqueue(req, body, {
        traces: translation.traces,
      });

      res.status(202).json({});
    } catch (error) {
      DatadogIngestService.fail(error, res, next);
    }
  }

  /*
   * PUT or POST /v0.3/traces, /v0.4/traces, /v0.5/traces: what a tracing
   * library sends the Agent, sent here with no Agent in between.
   */
  public static ingestTracerTraces(
    protocol: DatadogTracerProtocol,
  ): (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> {
    return async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const body: Buffer = await CompatibleIngestBody.read(req);
        const translation: DatadogTracesTranslation =
          DatadogTraces.tracerTracesToOtlp(body, {
            protocol: protocol,
            isJson: protocol !== "v0.5" && DatadogIngestService.isJson(req),
            serviceName: DatadogIngestService.serviceNameOf(req),
            tracer: {
              language: headerValueToString(req.headers["datadog-meta-lang"]),
              languageVersion: headerValueToString(
                req.headers["datadog-meta-lang-version"],
              ),
              tracerVersion: headerValueToString(
                req.headers["datadog-meta-tracer-version"],
              ),
              containerId: headerValueToString(
                req.headers["datadog-container-id"],
              ),
            },
          });

        await DatadogIngestService.enqueue(req, body, {
          traces: translation.traces,
        });

        if (protocol === "v0.3") {
          res.status(200).type("text/plain").send("OK\n");
          return;
        }

        res.status(200).json({ rate_by_service: {} });
      } catch (error) {
        DatadogIngestService.fail(error, res, next);
      }
    };
  }

  @CaptureSpan()
  public static async ingestLogs(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);

      const translation: DatadogLogsTranslation = DatadogIntake.logsToOtlp(
        body,
        {
          serviceName: DatadogIngestService.serviceNameOf(req),
          query: DatadogIngestService.logQueryOf(req),
        },
      );

      await DatadogIngestService.enqueue(req, body, {
        logs: translation.logs,
      });

      res.status(202).json({});
    } catch (error) {
      DatadogIngestService.fail(error, res, next);
    }
  }

  @CaptureSpan()
  public static async ingestSeriesV1(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);
      const translation: DatadogMetricsTranslation =
        DatadogIntake.seriesV1ToOtlp(DatadogIntake.parseJson(body), {
          serviceName: DatadogIngestService.serviceNameOf(req),
        });

      await DatadogIngestService.enqueue(req, body, {
        metrics: translation.metrics,
      });

      res.status(202).json({ status: "ok" });
    } catch (error) {
      DatadogIngestService.fail(error, res, next);
    }
  }

  @CaptureSpan()
  public static async ingestSeriesV2(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);
      const serviceName: string | undefined =
        DatadogIngestService.serviceNameOf(req);

      // The Agent sends a protobuf MetricPayload; Datadog's API also takes JSON.
      const translation: DatadogMetricsTranslation =
        DatadogIngestService.isJson(req)
          ? DatadogIntake.seriesV2ToOtlp(DatadogIntake.parseJson(body), {
              serviceName: serviceName,
            })
          : DatadogIntake.seriesV2ProtobufToOtlp(body, {
              serviceName: serviceName,
            });

      await DatadogIngestService.enqueue(req, body, {
        metrics: translation.metrics,
      });

      res.status(202).json({ errors: [] });
    } catch (error) {
      DatadogIngestService.fail(error, res, next);
    }
  }

  @CaptureSpan()
  public static async ingestSketches(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);
      const translation: DatadogMetricsTranslation =
        DatadogIntake.sketchesToOtlp(body, {
          serviceName: DatadogIngestService.serviceNameOf(req),
        });

      await DatadogIngestService.enqueue(req, body, {
        metrics: translation.metrics,
      });

      res.status(202).json({});
    } catch (error) {
      DatadogIngestService.fail(error, res, next);
    }
  }

  @CaptureSpan()
  public static async ingestCheckRuns(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const body: Buffer = await CompatibleIngestBody.read(req);
      const translation: DatadogMetricsTranslation =
        DatadogIntake.checkRunsToOtlp(DatadogIntake.parseJson(body), {
          serviceName: DatadogIngestService.serviceNameOf(req),
        });

      await DatadogIngestService.enqueue(req, body, {
        metrics: translation.metrics,
      });

      res.status(202).json({ status: "ok" });
    } catch (error) {
      DatadogIngestService.fail(error, res, next);
    }
  }

  /*
   * Counted at the body decompressed, as an OTLP export is: each route
   * carries one signal, so its job is counted at all of it.
   */
  private static async enqueue(
    req: ExpressRequest,
    body: Buffer,
    batch: CompatibleOtlpBatch,
  ): Promise<void> {
    await CompatibleIngestService.enqueue({
      req: req as TelemetryRequest,
      surface: TelemetryIngestSurface.Datadog,
      batch: batch,
      ingestBytes: body.length,
    });
  }

  private static isJson(req: ExpressRequest): boolean {
    return (headerValueToString(req.headers["content-type"]) || "")
      .toLowerCase()
      .includes("json");
  }

  private static serviceNameOf(req: ExpressRequest): string | undefined {
    return headerValueToString(req.headers["x-oneuptime-service-name"]);
  }

  // ?ddsource=&ddtags=&service=&hostname=: what every log in the body gets.
  private static logQueryOf(req: ExpressRequest): DatadogLogQuery {
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
      ddsource: read("ddsource"),
      ddtags: read("ddtags"),
      service: read("service"),
      hostname: read("hostname"),
    };
  }

  private static fail(
    error: unknown,
    res: ExpressResponse,
    next: NextFunction,
  ): void {
    const failure: CompatibleIngestFailure | null =
      CompatibleIngestFailureMapper.fromError(error, [DatadogIntakeError]);

    if (!failure) {
      next(error);
      return;
    }

    if (res.headersSent) {
      return;
    }

    const body: JSONObject = { errors: [failure.message] };
    res.status(failure.statusCode).json(body);
  }
}
