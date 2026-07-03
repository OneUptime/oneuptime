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
import SyslogIngestService from "../Services/SyslogIngestService";
import IotFleetScopeEnforcement from "../Middleware/IotFleetScopeEnforcement";

const router: ExpressRouter = Express.getRouter();

const setSyslogProductType: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  (req as TelemetryRequest).productType = ProductType.Logs;
  next();
};

router.post(
  "/syslog/v1/logs",
  TelemetryIngestionDisabled.middleware,
  setSyslogProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  /*
   * Syslog messages carry no OTLP resource attributes, so fleet-scoped
   * ingestion keys cannot be attributed to a fleet — reject them (fail
   * closed). Unscoped keys are unaffected.
   */
  IotFleetScopeEnforcement.rejectFleetScopedKeys("syslog"),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return SyslogIngestService.ingestSyslog(req, res, next);
  },
);

export default router;
