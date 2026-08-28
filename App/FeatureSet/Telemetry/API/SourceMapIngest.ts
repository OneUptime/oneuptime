import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import MultipartFormDataMiddleware from "Common/Server/Middleware/MultipartFormData";
import SourceMapIngestService from "../Services/SourceMapIngestService";

const router: ExpressRouter = Express.getRouter();

/*
 * Map Authorization: Bearer <token> to x-oneuptime-token so CI tools that
 * only speak Bearer auth (and the sentry-cli style of configuration) work
 * without a custom header.
 */
const mapBearerTokenMiddleware: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  if (!req.headers["x-oneuptime-token"]) {
    const authHeader: string | undefined = req.headers[
      "authorization"
    ] as string;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      req.headers["x-oneuptime-token"] = authHeader.substring(7);
    }
  }
  next();
};

/*
 * Authenticated source map upload for unminifying browser exception stack
 * traces. Mounted on TELEMETRY_PREFIXES, so it answers at both
 * /source-maps/v1/upload and /telemetry/source-maps/v1/upload.
 */
router.post(
  "/source-maps/v1/upload",
  TelemetryIngestionDisabled.middleware,
  MultipartFormDataMiddleware,
  mapBearerTokenMiddleware,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return SourceMapIngestService.uploadSourceMaps(req, res, next);
  },
);

export default router;
