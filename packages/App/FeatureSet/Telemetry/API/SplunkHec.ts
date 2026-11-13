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
import SplunkHecIngestService from "../Services/SplunkHecIngestService";

/*
 * Splunk's HTTP Event Collector, at Splunk's own paths
 * (SPLUNK_HEC_*_PATHS in Types/Telemetry/CompatibleIngest), under
 * /telemetry and at the root: Splunk's Docker logging driver and Fluent
 * Bit's splunk output post to /services/collector/event at the root of the
 * host they are given, and the shipped ingress sends /services/collector to
 * the App for them. Bodies are read raw after the key is checked:
 * StartServer leaves these paths to them (isCompatibleIngestPath).
 *
 * Every route is registered with its own surface call, next to its path,
 * so TelemetryIngestSurfaceWiring can read which surface each one is.
 */

const router: ExpressRouter = Express.getRouter();

const credentials: RequestHandler = CompatibleIngestCredential.middleware([
  CompatibleCredentialScheme.Splunk,
  CompatibleCredentialScheme.Basic,
  CompatibleCredentialScheme.Bearer,
]);

const ingestEvents: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  return SplunkHecIngestService.ingestEvents(req, res, next);
};

const ingestRaw: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  return SplunkHecIngestService.ingestRaw(req, res, next);
};

router.post(
  "/services/collector",
  TelemetryIngestionDisabled.middleware,
  credentials,
  SplunkHecIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.SplunkHec),
  ingestEvents,
);

router.post(
  "/services/collector/event",
  TelemetryIngestionDisabled.middleware,
  credentials,
  SplunkHecIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.SplunkHec),
  ingestEvents,
);

router.post(
  "/services/collector/event/1.0",
  TelemetryIngestionDisabled.middleware,
  credentials,
  SplunkHecIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.SplunkHec),
  ingestEvents,
);

router.post(
  "/services/collector/raw",
  TelemetryIngestionDisabled.middleware,
  credentials,
  SplunkHecIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.SplunkHec),
  ingestRaw,
);

// HEC's health check, which Splunk answers without a token.
router.get(
  "/services/collector/health",
  (req: ExpressRequest, res: ExpressResponse): void => {
    SplunkHecIngestService.health(req, res);
  },
);

export default router;
