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
import ChangeEventsIngestService from "../Services/ChangeEventsIngestService";
import RequestBodyAfterAuthentication from "Common/Server/Middleware/RequestBodyAfterAuthentication";
import { LARGE_REQUEST_BODY_LIMIT } from "Common/Server/Utils/RequestBodyLimit";

const router: ExpressRouter = Express.getRouter();

const setChangeEventsProductType: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  /*
   * Change events are a tiny annotation stream, not a metered firehose —
   * they ride the Logs product type for the ingestion middleware's
   * bookkeeping.
   */
  (req as TelemetryRequest).productType = ProductType.Logs;
  next();
};

/*
 * Deploy/config-change markers posted by CI/CD. Same ingestion-key auth
 * as the rest of telemetry; synchronous 2xx/4xx so pipeline steps get a
 * definitive answer.
 *
 * The body is read once the key is right (#10702): StartServer leaves it
 * unread (RequestBodyLimit), and nothing of it is read or parsed for a
 * request without the right key, which CI sends in a header. JSON, held to
 * 50 MB and 1,000,000 values, gzip-compressed or not.
 */
const readChangeEventsBody: RequestHandler =
  RequestBodyAfterAuthentication.readBody(LARGE_REQUEST_BODY_LIMIT, {
    parseGzipJson: true,
  });

router.post(
  "/change-events/v1/ingest",
  TelemetryIngestionDisabled.middleware,
  setChangeEventsProductType,
  TelemetryIngest.forSurface(
    TelemetryIngestSurface.ChangeEvents,
    readChangeEventsBody,
  ),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return ChangeEventsIngestService.ingestChangeEvents(req, res, next);
  },
);

export default router;
