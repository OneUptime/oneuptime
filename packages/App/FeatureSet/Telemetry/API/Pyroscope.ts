import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import Express, {
  ExpressRaw,
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import PyroscopeIngestService from "../Services/PyroscopeIngestService";
import MultipartFormDataMiddleware from "Common/Server/Middleware/MultipartFormData";
import { mapAuthorizationToIngestToken } from "../Utils/PyroscopeAuthorization";

const router: ExpressRouter = Express.getRouter();

// Set product type to Profiles for metering
const setProfilesProductType: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  (req as TelemetryRequest).productType = ProductType.Profiles;
  next();
};

/*
 * Map the ingestion key a Pyroscope client sends in its Authorization
 * header (Bearer, or Basic on newer SDKs) to x-oneuptime-token, where
 * TelemetryIngest looks for it. See Utils/PyroscopeAuthorization.
 */
const mapAuthorizationTokenMiddleware: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  mapAuthorizationToIngestToken(req);
  next();
};

/*
 * pyroscope-nodejs 0.6.2+ posts /ingest as the gzipped pprof itself, raw,
 * as Content-Type application/octet-stream - no multipart, no
 * Content-Encoding. No global parser reads that type, so the body reached
 * the handler as {} and every upload was answered 400.
 *
 * Mounted AFTER the ingest-key check, so an unauthenticated caller cannot
 * make the App buffer anything through it. A body the global gzip reader
 * (Content-Encoding: gzip) has already consumed is left alone: the stream
 * is gone, and reading it again would fail the request.
 */
const rawProfileBodyParser: RequestHandler = ExpressRaw({
  type: ["application/octet-stream", "binary/octet-stream"],
  limit: "50mb",
}) as RequestHandler;

const parseRawProfileBody: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if (Buffer.isBuffer(req.body)) {
    return next();
  }

  rawProfileBodyParser(req, res, next);
};

/*
 * DISABLE_TELEMETRY_INGESTION answers every push with a success so clients
 * stop sending. For a Connect client (Alloy) that success has to be in the
 * Connect shape, or connect-go reads it as an error and retries each push
 * ten times - exactly when an operator is trying to shed load.
 */
const pushIngestionDisabledMiddleware: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): void => {
  if (TelemetryIngestionDisabled.isDisabled()) {
    return PyroscopeIngestService.sendPushSuccessResponse(req, res);
  }

  next();
};

router.post(
  "/pyroscope/ingest",
  TelemetryIngestionDisabled.middleware,
  MultipartFormDataMiddleware,
  mapAuthorizationTokenMiddleware,
  setProfilesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Pyroscope),
  parseRawProfileBody,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return PyroscopeIngestService.ingestPyroscopeProfile(req, res, next);
  },
);

/*
 * The Pyroscope push protocol: a protobuf-encoded push.v1.PushRequest posted
 * to /pyroscope/push.v1.PusherService/Push. Grafana Alloy's pyroscope.write,
 * pyroscope-dotnet v0.14+ and pyroscope-rs based SDKs use it, most of them
 * as Content-Type application/proto (see StartServer's protobuf parser).
 */
router.post(
  "/pyroscope/push.v1.PusherService/Push",
  pushIngestionDisabledMiddleware,
  mapAuthorizationTokenMiddleware,
  setProfilesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Pyroscope),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return PyroscopeIngestService.ingestPyroscopePush(req, res, next);
  },
);

export default router;
