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
import { getMultipartFormDataMiddleware } from "Common/Server/Middleware/MultipartFormData";
import { SourceMapMaxFilesPerRequest } from "Common/Server/EnvironmentConfig";
import DsymIngestService from "../Services/DsymIngestService";

const router: ExpressRouter = Express.getRouter();

/*
 * The same multipart parse the source map upload has, built once: dSYMs
 * sent as they are arrive as file parts, under the same per-file and
 * per-request ceilings the shared middleware holds every upload to.
 */
const dsymMultipartMiddleware: RequestHandler = getMultipartFormDataMiddleware({
  maxFiles: SourceMapMaxFilesPerRequest,
});

// Authorization: Bearer <key> as x-oneuptime-token, for CI tools that speak only Bearer.
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
 * An iOS app's dSYMs (#9922): the CLI's symbol tables as JSON, or the
 * dSYMs themselves as multipart file parts (DsymIngestService). Mounted on
 * TELEMETRY_PREFIXES, so it answers at both /dsyms/v1/upload and
 * /telemetry/dsyms/v1/upload; the root path is the documented one, which
 * nginx gives the same 50M body cap as /source-maps.
 */
router.post(
  "/dsyms/v1/upload",
  TelemetryIngestionDisabled.middleware,
  dsymMultipartMiddleware,
  mapBearerTokenMiddleware,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Dsym),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return DsymIngestService.uploadDsyms(req, res, next);
  },
);

export default router;
