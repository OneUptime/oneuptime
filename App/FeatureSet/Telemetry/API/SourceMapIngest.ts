import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import { getMultipartFormDataMiddleware } from "Common/Server/Middleware/MultipartFormData";
import { SourceMapMaxFilesPerRequest } from "Common/Server/EnvironmentConfig";
import SourceMapIngestService from "../Services/SourceMapIngestService";

const router: ExpressRouter = Express.getRouter();

/*
 * Built once at module scope, not per request — each call constructs a multer
 * instance. SOURCE_MAP_MAX_FILES_PER_REQUEST can only narrow the shared
 * default, so this never widens the pre-auth parse that every route mounting
 * the multipart middleware shares.
 */
const sourceMapMultipartMiddleware: RequestHandler =
  getMultipartFormDataMiddleware({
    maxFiles: SourceMapMaxFilesPerRequest,
  });

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
 * /source-maps/v1/upload and /telemetry/source-maps/v1/upload. The root
 * path is the documented one: nginx gives /source-maps a 50M body cap,
 * while the /telemetry alias inherits that location's 4M cap and will
 * 413 on realistically sized maps.
 */
router.post(
  "/source-maps/v1/upload",
  TelemetryIngestionDisabled.middleware,
  sourceMapMultipartMiddleware,
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
