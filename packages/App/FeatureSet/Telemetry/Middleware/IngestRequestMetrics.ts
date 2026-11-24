import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";

/*
 * ONEUPTIME'S OWN INGEST METRICS, FOR EVERY ROUTE TELEMETRY ARRIVES BY.
 *
 * telemetry.ingest.request.count and telemetry.ingest.request.duration, by
 * telemetry.signal, telemetry.surface and outcome, and
 * telemetry.ingest.request.payload.size, by signal and surface - recorded
 * alike for the OTLP/HTTP routes and for the compatible endpoints
 * (Prometheus remote write, Loki, Splunk HEC, Datadog, Sentry), so an
 * operator sees every sender's traffic and refusals, and tells remote write
 * apart from OTLP metrics by its surface (TelemetryIngestSurface's wire
 * form: "otel-metrics", "prometheus-remote-write", "loki", ...).
 *
 * Mounted after the ingestion-disabled check and before the key check - and
 * before a compatible endpoint's credential mapping - so a request refused
 * for its key is counted as rejected too.
 *
 * The outcome is the status the route answered with, read on "finish" or
 * "close": 2xx accepted, 4xx rejected (a remote write partial write's 400
 * among them), anything else an error. A request whose client left before
 * any answer was sent reaches "close" holding Node's default of 200, which
 * is not an answer: it is an error - its sender saw no success, and will
 * retry it.
 *
 * The payload size is the body as received, before its coding is undone.
 * The OTLP routes and the compatible endpoints read their bodies after the
 * key check (#10814), so the size is recorded once the body is read
 * (OtelRequestMiddleware.readBodyAfterKey, CompatibleIngestBody), and a
 * request refused before that has none. A body something read before this
 * is mounted is recorded here.
 *
 * Cheap on the hot path: two small attribute objects and two listeners a
 * request, and a WeakMap entry while a compatible endpoint's body is unread.
 */

export type IngestMetricsSignal = "traces" | "metrics" | "logs" | "profiles";

// Where each OTLP/HTTP signal arrives: what an OTLP route records.
const OTLP_SURFACES: Record<IngestMetricsSignal, TelemetryIngestSurface> = {
  traces: TelemetryIngestSurface.OtelTraces,
  metrics: TelemetryIngestSurface.OtelMetrics,
  logs: TelemetryIngestSurface.OtelLogs,
  profiles: TelemetryIngestSurface.OtelProfiles,
};

// A request whose payload is recorded once its body is read, and with what.
const PENDING_PAYLOADS: WeakMap<
  ExpressRequest,
  Record<string, string>
> = new WeakMap<ExpressRequest, Record<string, string>>();

const bodyBytesOf: (body: unknown) => number = (body: unknown): number => {
  if (body instanceof Uint8Array) {
    return body.byteLength;
  }

  if (typeof body === "string") {
    return Buffer.byteLength(body);
  }

  return 0;
};

/*
 * The metrics of one route: its signal, and the surface it is (an OTLP
 * route's by default).
 */
export const ingestMetricsMiddleware: (
  signal: IngestMetricsSignal,
  surface?: TelemetryIngestSurface | undefined,
) => RequestHandler = (
  signal: IngestMetricsSignal,
  surface?: TelemetryIngestSurface | undefined,
): RequestHandler => {
  const surfaceName: string = surface ?? OTLP_SURFACES[signal];

  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    const startNs: bigint = process.hrtime.bigint();

    const payloadAttributes: Record<string, string> = {
      "telemetry.signal": signal,
      "telemetry.surface": surfaceName,
    };

    const payloadBytes: number = bodyBytesOf((req as { body?: unknown }).body);

    if (payloadBytes > 0) {
      AppMetrics.getIngestPayloadBytes().record(
        payloadBytes,
        payloadAttributes,
      );
    } else {
      PENDING_PAYLOADS.set(req, payloadAttributes);
    }

    let recorded: boolean = false;
    const recordOnce: () => void = (): void => {
      if (recorded) {
        return;
      }
      recorded = true;
      PENDING_PAYLOADS.delete(req);

      const elapsedNs: bigint = process.hrtime.bigint() - startNs;
      const durationMs: number = Number(elapsedNs) / 1e6;
      const statusCode: number = res.headersSent ? res.statusCode || 0 : 0;
      const outcome: string =
        statusCode >= 200 && statusCode < 300
          ? "accepted"
          : statusCode >= 400 && statusCode < 500
            ? "rejected"
            : "error";

      const attributes: Record<string, string> = {
        "telemetry.signal": signal,
        "telemetry.surface": surfaceName,
        outcome,
      };

      AppMetrics.getIngestCounter().add(1, attributes);
      AppMetrics.getIngestDuration().record(durationMs, attributes);
    };

    res.on("finish", recordOnce);
    res.on("close", recordOnce);

    next();
  };
};

export default class IngestRequestMetrics {
  /*
   * A body read after the metrics were mounted (a compatible endpoint's),
   * as received: recorded once, for a request the metrics middleware is
   * mounted on, and ignored for any other.
   */
  public static recordPayloadSize(req: ExpressRequest, bytes: number): void {
    const attributes: Record<string, string> | undefined =
      PENDING_PAYLOADS.get(req);

    if (!attributes) {
      return;
    }

    PENDING_PAYLOADS.delete(req);

    if (bytes > 0) {
      AppMetrics.getIngestPayloadBytes().record(bytes, attributes);
    }
  }
}
