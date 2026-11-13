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
import DatadogIngestService from "../Services/DatadogIngestService";

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
 *     request goes on to OneUptime's own API.
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

type DatadogIngestHandlerName =
  | "ingestLogs"
  | "ingestSeriesV1"
  | "ingestSeriesV2"
  | "ingestSketches"
  | "ingestCheckRuns";

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

// Under /datadog, where dd_url points.

// Logs: the Agent (logs_dd_url), and Datadog's log libraries and forwarders.
router.post(
  "/datadog/api/v2/logs",
  TelemetryIngestionDisabled.middleware,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestLogs"),
);

// Metrics, Datadog's v1 JSON series.
router.post(
  "/datadog/api/v1/series",
  TelemetryIngestionDisabled.middleware,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestSeriesV1"),
);

// Metrics: the Agent's protobuf MetricPayload, or v2 JSON series.
router.post(
  "/datadog/api/v2/series",
  TelemetryIngestionDisabled.middleware,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestSeriesV2"),
);

// Distributions, as the Agent's sketches.
router.post(
  "/datadog/api/beta/sketches",
  TelemetryIngestionDisabled.middleware,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestSketches"),
);

// Service checks.
router.post(
  "/datadog/api/v1/check_run",
  TelemetryIngestionDisabled.middleware,
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

// At the root, for a request with a DD-API-KEY header only: the Agent's logs.

// Logs: the Agent (logs_dd_url), and Datadog's log libraries and forwarders.
router.post(
  "/api/v2/logs",
  DatadogIngestService.onlyWithApiKey,
  TelemetryIngestionDisabled.middleware,
  credentials,
  DatadogIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Datadog),
  ingest("ingestLogs"),
);

export default router;
