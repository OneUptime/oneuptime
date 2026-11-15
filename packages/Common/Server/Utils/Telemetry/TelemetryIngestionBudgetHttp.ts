import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
  headerValueToString,
} from "../Express";
import {
  encodeGoogleRpcStatus,
  GRPC_RESOURCE_EXHAUSTED_CODE,
} from "./GoogleRpcStatus";
import {
  measureParsedTelemetryIngestBody,
  measureRawTelemetryIngestBody,
  TelemetryIngestBodySize,
} from "./TelemetryIngestBodySize";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import {
  TelemetryIngestionBudgetRefusal,
  TelemetryIngestionBudgetRefusalKind,
  TelemetryIngestionBudgetSignal,
} from "../../../Types/Telemetry/TelemetryIngestionBudget";
import TelemetryIngestSurface from "../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * Telemetry ingestion budgets on the HTTP ingest surfaces: which signal a
 * surface sends, how big its body is, and how a refusal is answered.
 *
 * THE ANSWERS, AND WHY (OTLP/HTTP specification, "Failures" and
 * "Throttling"): an exporter retries only 429, 502, 503 and 504, and must
 * not retry any other 4xx or 5xx.
 *
 *   - Over a per-second rate: 429 with Retry-After. The sender is told to
 *     come back when the rate allows it, and retries the same batch then -
 *     the per-key requests-per-minute limit answers the same way.
 *   - Over a used-up daily budget: 403. Not 429: a budget that resets at
 *     midnight cannot be met by retrying, and exporters that retry for hours
 *     would only add load. 403 is permanent for an exporter, which logs the
 *     refusal and drops the batch - the same way Google's APIs answer a
 *     spent daily quota. Not a 200 with partial_success either: that needs
 *     the number of spans, logs or points refused, which only decoding the
 *     batch would tell - and keeping the decode off this path is the point.
 *
 * The body is a google.rpc.Status on the OTLP routes, as the specification
 * asks of every OTLP/HTTP error - protobuf for a protobuf request, JSON for
 * a JSON one - so a collector's own log says why its telemetry was refused.
 * Every other surface answers with the JSON its other refusals use.
 */

const SURFACE_SIGNALS: Partial<
  Record<TelemetryIngestSurface, TelemetryIngestionBudgetSignal>
> = {
  [TelemetryIngestSurface.OtelTraces]: ProductType.Traces,
  [TelemetryIngestSurface.OtelLogs]: ProductType.Logs,
  [TelemetryIngestSurface.OtelMetrics]: ProductType.Metrics,
  [TelemetryIngestSurface.OtelProfiles]: ProductType.Profiles,
  [TelemetryIngestSurface.Fluent]: ProductType.Logs,
  [TelemetryIngestSurface.Syslog]: ProductType.Logs,
  [TelemetryIngestSurface.VercelLogDrain]: ProductType.Logs,
  [TelemetryIngestSurface.Pyroscope]: ProductType.Profiles,
  [TelemetryIngestSurface.SecurityEvents]: ProductType.SecurityEvents,
  /*
   * The compatible endpoints that only ever carry one signal. Splunk HEC
   * (logs and metric events), Datadog (logs and metrics) and Sentry
   * (traces and logs) are not here: a request to one may carry several,
   * so each part is counted against its own signal's budget as it is
   * queued (CompatibleIngestService), never against another's here.
   */
  [TelemetryIngestSurface.PrometheusRemoteWrite]: ProductType.Metrics,
  [TelemetryIngestSurface.Loki]: ProductType.Logs,
};

// The OTLP/HTTP routes, whose refusals carry a google.rpc.Status body.
export const OTLP_HTTP_SURFACES: ReadonlySet<TelemetryIngestSurface> =
  new Set<TelemetryIngestSurface>([
    TelemetryIngestSurface.OtelTraces,
    TelemetryIngestSurface.OtelLogs,
    TelemetryIngestSurface.OtelMetrics,
    TelemetryIngestSurface.OtelProfiles,
  ]);

/*
 * Surfaces whose body reaches the key check still as sent - OtelRequest-
 * Middleware reads it raw, and the Vercel drain's signature check inflates
 * it and drops the content coding - so its size comes from its coding.
 */
export const RAW_BODY_SURFACES: ReadonlySet<TelemetryIngestSurface> =
  new Set<TelemetryIngestSurface>([
    ...Array.from(OTLP_HTTP_SURFACES),
    TelemetryIngestSurface.VercelLogDrain,
  ]);

/*
 * Surfaces whose body is read only after the key is checked: Pyroscope
 * parses its upload behind the key check, so the check can refuse a used-up
 * budget but not size the upload - the enqueue counts it
 * (TelemetryIngestionBudget.chargePending).
 */
export const DEFERRED_BODY_SURFACES: ReadonlySet<TelemetryIngestSurface> =
  new Set<TelemetryIngestSurface>([
    TelemetryIngestSurface.Pyroscope,
    /*
     * Remote write and Loki read their bodies after the key check, and a
     * snappy body's size is only known once it is undone: the enqueue
     * counts each at the size of the OTLP it becomes.
     */
    TelemetryIngestSurface.PrometheusRemoteWrite,
    TelemetryIngestSurface.Loki,
  ]);

export const getTelemetryIngestionBudgetSignalForSurface: (
  surface: TelemetryIngestSurface | null,
) => TelemetryIngestionBudgetSignal | null = (
  surface: TelemetryIngestSurface | null,
): TelemetryIngestionBudgetSignal | null => {
  if (!surface) {
    return null;
  }

  return SURFACE_SIGNALS[surface] ?? null;
};

// The decompressed size of the request's body, as a budget counts it.
export const measureTelemetryIngestRequest: (data: {
  req: ExpressRequest;
  surface: TelemetryIngestSurface;
}) => TelemetryIngestBodySize = (data: {
  req: ExpressRequest;
  surface: TelemetryIngestSurface;
}): TelemetryIngestBodySize => {
  const body: unknown = (data.req as { body?: unknown }).body;

  if (
    RAW_BODY_SURFACES.has(data.surface) &&
    (Buffer.isBuffer(body) || body instanceof Uint8Array)
  ) {
    return measureRawTelemetryIngestBody({
      body: body as Uint8Array,
      contentEncoding: data.req.headers["content-encoding"],
    });
  }

  return measureParsedTelemetryIngestBody({
    body: body,
    rawBody: (data.req as OneUptimeRequest).rawBody,
  });
};

const isProtobufRequest: (req: ExpressRequest) => boolean = (
  req: ExpressRequest,
): boolean => {
  const contentType: string | undefined = headerValueToString(
    req.headers["content-type"],
  );

  // No content type is protobuf, as OtelRequestMiddleware reads it.
  return (
    !contentType ||
    contentType.includes("application/x-protobuf") ||
    contentType.includes("application/protobuf")
  );
};

/*
 * Reached through a runtime check, as TelemetryIngest's own Retry-After is:
 * unit tests hand the middleware a bare response object.
 */
const setHeader: (res: ExpressResponse, name: string, value: string) => void = (
  res: ExpressResponse,
  name: string,
  value: string,
): void => {
  const set: unknown = (res as unknown as Record<string, unknown>)["setHeader"];

  if (typeof set === "function") {
    (set as (name: string, value: string) => void).call(res, name, value);
  }
};

export const getTelemetryIngestionBudgetHttpStatus: (
  refusal: TelemetryIngestionBudgetRefusal,
) => number = (refusal: TelemetryIngestionBudgetRefusal): number => {
  return refusal.kind === TelemetryIngestionBudgetRefusalKind.RateLimited
    ? 429
    : 403;
};

// Answer a refused request, as the top of the file describes.
export const sendTelemetryIngestionBudgetRefusal: (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  refusal: TelemetryIngestionBudgetRefusal;
  surface: TelemetryIngestSurface;
}) => void = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  refusal: TelemetryIngestionBudgetRefusal;
  surface: TelemetryIngestSurface;
}): void => {
  if (data.res.headersSent) {
    return;
  }

  const status: number = getTelemetryIngestionBudgetHttpStatus(data.refusal);

  if (data.refusal.retryAfterSeconds) {
    setHeader(data.res, "Retry-After", String(data.refusal.retryAfterSeconds));
  }

  if (OTLP_HTTP_SURFACES.has(data.surface)) {
    if (isProtobufRequest(data.req)) {
      setHeader(data.res, "Content-Type", "application/x-protobuf");
      data.res.status(status).send(
        encodeGoogleRpcStatus({
          code: GRPC_RESOURCE_EXHAUSTED_CODE,
          message: data.refusal.message,
        }),
      );
      return;
    }

    data.res.status(status).json({
      code: GRPC_RESOURCE_EXHAUSTED_CODE,
      message: data.refusal.message,
    });
    return;
  }

  data.res.status(status).json({
    error: data.refusal.kind,
    message: data.refusal.message,
    resetsAt: data.refusal.resetsAt.toISOString(),
    ...(data.refusal.retryAfterSeconds
      ? { retryAfterSeconds: data.refusal.retryAfterSeconds }
      : {}),
  });
};
