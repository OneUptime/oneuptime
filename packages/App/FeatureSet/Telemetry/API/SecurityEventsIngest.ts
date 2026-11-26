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
import RequestBodyAfterAuthentication from "Common/Server/Middleware/RequestBodyAfterAuthentication";
import { LARGE_REQUEST_BODY_LIMIT } from "Common/Server/Utils/RequestBodyLimit";

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
 * The batch, read once its ingest key is right (#10795), as the rest of
 * telemetry's batches are (#10702): StartServer leaves the body unread
 * (RequestBodyLimit), and nothing of it is read, inflated or parsed for a
 * request without the right key. Every sender the docs and the Setup Guide
 * show - curl, Fluent Bit's http output, a Google SecOps SOAR playbook's
 * HTTP request - sends the key in a header (x-oneuptime-token). Read between
 * the key and the ingestion budget, which measures it in Refuse mode
 * (TelemetryIngest), with StartServer's own parsers: JSON parsed, held to
 * 50 MB and 1,000,000 values, its text kept for the budget; a form parsed.
 * A gzip JSON body is parsed as the same body uncompressed is: it was
 * handed on as its bytes, and stored as one event of them.
 */
const readSecurityEventsBody: RequestHandler =
  RequestBodyAfterAuthentication.readBody(LARGE_REQUEST_BODY_LIMIT, {
    parseGzipJson: true,
  });

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
  TelemetryIngest.forSurface(
    TelemetryIngestSurface.SecurityEvents,
    readSecurityEventsBody,
  ),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return SecurityEventsIngestService.ingestSecurityEvents(req, res, next);
  },
);

export default router;
