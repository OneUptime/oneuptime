import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import ChangeEventsIngestService from "../Services/ChangeEventsIngestService";

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
 */
router.post(
  "/change-events/v1/ingest",
  TelemetryIngestionDisabled.middleware,
  setChangeEventsProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return ChangeEventsIngestService.ingestChangeEvents(req, res, next);
  },
);

export default router;
