import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import FluentLogsIngestService from "../Services/FluentLogsIngestService";

const router: ExpressRouter = Express.getRouter();

const setFluentProductType: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  (req as TelemetryRequest).productType = ProductType.Logs;
  next();
};

router.post(
  "/fluentd/v1/logs",
  setFluentProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return FluentLogsIngestService.ingestFluentLogs(req, res, next);
  },
);

export default router;
