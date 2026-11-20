import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import CompatibleIngestCredential, {
  CompatibleCredentialScheme,
} from "../Utils/Compatible/CompatibleIngestCredential";
import { ingestMetricsMiddleware } from "../Middleware/IngestRequestMetrics";
import DatadogIngestService from "../Services/DatadogIngestService";
import { DatadogTracerProtocol } from "../Utils/Compatible/DatadogTraces";

/*
 * The Datadog Agent's and Datadog HTTP API's intake (DATADOG_* in
 * Types/Telemetry/CompatibleIngest), at Datadog's own paths:
 *
 *   - under /datadog (and /telemetry/datadog), where the Agent's dd_url
 *     points: dd_url = https://<host>/telemetry/datadog, and the Agent adds
 *     /api/v2/series and the rest itself;
 *   - /api/v2/logs at the root too, for a request that carries a
 *     DD-API-KEY header only: the Agent posts logs there, on the host:port
 *     its logs_dd_url names, which takes no path. Without the header, the
 *     route steps aside (DatadogIngestService.onlyWithApiKey) and the
 *     request goes on to OneUptime's own API;
 *   - APM traces under /datadog too: the Agent's apm_dd_url is the same
 *     <host>/telemetry/datadog, and it adds /api/v0.2/traces and
 *     /api/v0.2/stats; and a tracing library's own /v0.3, /v0.4 and /v0.5
 *     trace endpoints, for a tracer sending with no Agent in between, with
 *     the key as its URL's password (basic auth) or a DD-API-KEY header.
 *
 * Bodies are read raw after the key is checked: StartServer leaves these
 * paths to them (isCompatibleIngestPath). Every route is registered with
 * its own surface call, next to its path, so TelemetryIngestSurfaceWiring
 * can read which surface each one is.
 */

const router: ExpressRouter = Express.getRouter();

const credentials: RequestHandler = CompatibleIngestCredential.middleware([
  CompatibleCredentialScheme.DatadogApiKey,
]);

/*
 * A tracer has no API key of its own to send: its key is its agent URL's
 * password (https://<user>:<key>@<host>/telemetry/datadog, which
 * dd-trace-go sends as basic auth), or a header a proxy in front adds.
 */
const tracerCredentials: RequestHandler =
  CompatibleIngestCredential.middleware([
    CompatibleCredentialScheme.DatadogApiKey,
    CompatibleCredentialScheme.Basic,
    CompatibleCredentialScheme.Bearer,
  ]);

/*
 * OneUptime's own ingest metrics, by what each route carries. The Agent's
 * key check and its host metadata carry no telemetry, and are not counted.
 */
const logsIngestMetrics: RequestHandler = ingestMetricsMiddleware(
  "logs",
  TelemetryIngestSurface.Datadog,
);
const metricsIngestMetrics: RequestHandler = ingestMetricsMiddleware(
  "metrics",
  TelemetryIngestSurface.Datadog,
);
const tracesIngestMetrics: RequestHandler = ingestMetricsMiddleware(
  "traces",
  TelemetryIngestSurface.Datadog,
);

type DatadogIngestHandlerName =
  | "ingestLogs"
  | "ingestSeriesV1"
  | "ingestSeriesV2"
  | "ingestSketches"
  | "ingestCheckRuns"
  | "ingestTraces";

const ingest: (name: DatadogIngestHandlerName) => RequestHandler = (
  name: DatadogIngestHandlerName,
): RequestHandler => {
  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return DatadogIngestService[name](req, res, next);
  };
};

const validate: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
): void => {
  DatadogIngestService.validate(req, res);
};

const acceptMetadata: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
): void => {
  DatadogIngestService.acceptMetadata(req, res);
};

const acceptTraceStats: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
): void => {
  DatadogIngestService.acceptTraceStats(req, res);
};

const tracerTraces: (protocol: DatadogTracerProtocol) => RequestHandler = (
  protocol: DatadogTracerProtocol,
): RequestHandler => {
  return DatadogIngestService.ingestTracerTraces(protocol);
};

// Under /datadog, where dd_url points.

// Logs: the Agent (logs_dd_url), and Datadog's log libraries and forwarders.
router.post(
  "/datadog/api/v2/logs",
  TelemetryIngestionDisabled.middleware,
  logsIngestMetrics,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestLogs"),
);

// Metrics, Datadog's v1 JSON series.
router.post(
  "/datadog/api/v1/series",
  TelemetryIngestionDisabled.middleware,
  metricsIngestMetrics,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestSeriesV1"),
);

// Metrics: the Agent's protobuf MetricPayload, or v2 JSON series.
router.post(
  "/datadog/api/v2/series",
  TelemetryIngestionDisabled.middleware,
  metricsIngestMetrics,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestSeriesV2"),
);

// Distributions, as the Agent's sketches.
router.post(
  "/datadog/api/beta/sketches",
  TelemetryIngestionDisabled.middleware,
  metricsIngestMetrics,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestSketches"),
);

// Service checks.
router.post(
  "/datadog/api/v1/check_run",
  TelemetryIngestionDisabled.middleware,
  metricsIngestMetrics,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestCheckRuns"),
);

// The Agent checks its API key here, at start and now and then.
router.get(
  "/datadog/api/v1/validate",
  TelemetryIngestionDisabled.middleware,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  validate,
);

// The Agent's host metadata: accepted, not kept.
router.post(
  "/datadog/intake",
  TelemetryIngestionDisabled.middleware,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  acceptMetadata,
);

// The Agent's inventory metadata: accepted, not kept.
router.post(
  "/datadog/api/v1/metadata",
  TelemetryIngestionDisabled.middleware,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  acceptMetadata,
);

// APM: the Agent's traces, at apm_dd_url + /api/v0.2/traces.
router.post(
  "/datadog/api/v0.2/traces",
  TelemetryIngestionDisabled.middleware,
  tracesIngestMetrics,
  credentials,
  DatadogIngestService.setTracesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestTraces"),
);

// The Agent's APM stats: accepted, not kept.
router.post(
  "/datadog/api/v0.2/stats",
  TelemetryIngestionDisabled.middleware,
  credentials,
  DatadogIngestService.setTracesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  acceptTraceStats,
);

/*
 * A tracing library's own trace endpoints, with no Agent in between. The
 * tracers PUT (Python, Node.js, Java, Ruby) or POST (Go) them.
 */
router.put(
  "/datadog/v0.3/traces",
  TelemetryIngestionDisabled.middleware,
  tracesIngestMetrics,
  tracerCredentials,
  DatadogIngestService.setTracesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  tracerTraces("v0.3"),
);

router.post(
  "/datadog/v0.3/traces",
  TelemetryIngestionDisabled.middleware,
  tracesIngestMetrics,
  tracerCredentials,
  DatadogIngestService.setTracesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  tracerTraces("v0.3"),
);

router.put(
  "/datadog/v0.4/traces",
  TelemetryIngestionDisabled.middleware,
  tracesIngestMetrics,
  tracerCredentials,
  DatadogIngestService.setTracesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  tracerTraces("v0.4"),
);

router.post(
  "/datadog/v0.4/traces",
  TelemetryIngestionDisabled.middleware,
  tracesIngestMetrics,
  tracerCredentials,
  DatadogIngestService.setTracesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  tracerTraces("v0.4"),
);

router.put(
  "/datadog/v0.5/traces",
  TelemetryIngestionDisabled.middleware,
  tracesIngestMetrics,
  tracerCredentials,
  DatadogIngestService.setTracesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  tracerTraces("v0.5"),
);

router.post(
  "/datadog/v0.5/traces",
  TelemetryIngestionDisabled.middleware,
  tracesIngestMetrics,
  tracerCredentials,
  DatadogIngestService.setTracesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  tracerTraces("v0.5"),
);

// At the root, for a request with a DD-API-KEY header only: the Agent's logs.

// Logs: the Agent (logs_dd_url), and Datadog's log libraries and forwarders.
router.post(
  "/api/v2/logs",
  DatadogIngestService.onlyWithApiKey,
  TelemetryIngestionDisabled.middleware,
  logsIngestMetrics,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestLogs"),
);

export default router;
