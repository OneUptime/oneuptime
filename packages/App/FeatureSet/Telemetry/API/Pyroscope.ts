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

router.post(
  "/pyroscope/ingest",
  TelemetryIngestionDisabled.middleware,
  MultipartFormDataMiddleware,
  mapAuthorizationTokenMiddleware,
  setProfilesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Pyroscope),
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
  TelemetryIngestionDisabled.middleware,
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
