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
import SentryIngestService from "../Services/SentryIngestService";

/*
 * Sentry's ingest API under /sentry (SENTRY_BASE_PATH in
 * Types/Telemetry/CompatibleIngest): a DSN of
 * https://<key>@<host>/telemetry/sentry/1 makes an SDK post to
 * /telemetry/sentry/api/1/envelope/ - the 1 is any number, which Sentry's
 * SDKs require and nothing reads. Bodies are read raw after the key is
 * checked: StartServer leaves these paths to them (isCompatibleIngestPath).
 */

const router: ExpressRouter = Express.getRouter();

const credentials: RequestHandler = CompatibleIngestCredential.middleware([
  CompatibleCredentialScheme.SentryKey,
]);

/*
 * OneUptime's own ingest metrics: an envelope is counted as traces, as its
 * errors and transactions are, whatever logs it carries too.
 */
const ingestMetrics: RequestHandler = ingestMetricsMiddleware(
  "traces",
  TelemetryIngestSurface.Sentry,
);

// Envelopes: every current SDK, errors, transactions and logs together.
router.post(
  "/sentry/api/:sentryProjectId/envelope",
  TelemetryIngestionDisabled.middleware,
  ingestMetrics,
  credentials,
  SentryIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Sentry),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return SentryIngestService.ingestEnvelope(req, res, next);
  },
);

// One event as JSON: older SDKs, and anything posting to Sentry's store API.
router.post(
  "/sentry/api/:sentryProjectId/store",
  TelemetryIngestionDisabled.middleware,
  ingestMetrics,
  credentials,
  SentryIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Sentry),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return SentryIngestService.ingestStoreEvent(req, res, next);
  },
);

export default router;
