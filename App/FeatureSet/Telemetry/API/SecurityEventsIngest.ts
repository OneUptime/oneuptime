import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import SecurityEventsIngestService from "../Services/SecurityEventsIngestService";

const router: ExpressRouter = Express.getRouter();

const setSecurityEventsProductType: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  (req as TelemetryRequest).productType = ProductType.SecurityEvents;
  next();
};

/*
 * Security events ingest. Accepts OCSF, Google SecOps UDM, SecOps
 * detection alerts, or generic security JSON — dialect named via
 * ?format=... / x-oneuptime-security-event-format, sniffed per event
 * otherwise. Same ingestion-key auth as the rest of telemetry.
 */
router.post(
  "/security-events/v1/ingest",
  TelemetryIngestionDisabled.middleware,
  setSecurityEventsProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.SecurityEvents),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return SecurityEventsIngestService.ingestSecurityEvents(req, res, next);
  },
);

export default router;
