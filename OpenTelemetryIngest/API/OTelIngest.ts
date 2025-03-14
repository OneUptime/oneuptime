import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import OpenTelemetryRequestMiddleware from "../Middleware/OtelRequestMiddleware";
import OtelIngestService from "../Services/OtelIngest";

const router: ExpressRouter = Express.getRouter();

/**
 *
 *  Otel Middleware
 *
 */

router.post(
  "/otlp/v1/traces",
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return OtelIngestService.ingestTraces(req, res, next);
  },
);

router.post(
  "/otlp/v1/metrics",
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return OtelIngestService.ingestMetrics(req, res, next);
  },
);

router.post(
  "/otlp/v1/logs",
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return OtelIngestService.ingestLogs(req, res, next);
  },
);

export default router;
