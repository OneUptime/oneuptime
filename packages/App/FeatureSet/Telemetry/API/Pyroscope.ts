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
import RequestBodyAfterAuthentication from "Common/Server/Middleware/RequestBodyAfterAuthentication";
import { LARGE_REQUEST_BODY_LIMIT } from "Common/Server/Utils/RequestBodyLimit";
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
 * A profile posted to /ingest, read once the ingest key is checked (#10673):
 * StartServer leaves the body unread (RequestBodyLimit), and nothing of it is
 * read for a request without the right key - its 401 is sent, and the
 * connection closed under the rest (UnreadRequestBody), which the client
 * still reads. The key is in a header from every SDK (Authorization, mapped
 * above, or x-oneuptime-token), never in the body.
 *
 * Then the profile, in the forms the SDKs send it, held to 50 MB as sent and
 * once inflated, and refused past it with the rest unread:
 *
 *   - a multipart form, its profile a file part: pyroscope-go,
 *     pyroscope-dotnet up to 0.13, pyroscope-nodejs up to 0.6.1
 *     (MultipartFormData);
 *   - the profile itself, as its bytes: pyroscope-nodejs 0.6.2 and later as
 *     application/octet-stream, the pyroscope-rs SDKs (Python up to 0.8,
 *     Ruby up to 0.6.0; later ones push) as binary/octet-stream,
 *     gzip-encoded or not. Any other type is read as the bytes it is too:
 *     the handler finds pprof or folded text in it, or says it found
 *     neither.
 *
 * A gzip body, multipart or not, is inflated first, as StartServer inflated
 * it before.
 */
const readProfileBody: RequestHandler =
  RequestBodyAfterAuthentication.readUpload({
    limit: LARGE_REQUEST_BODY_LIMIT,
    multipart: MultipartFormDataMiddleware,
    bytes: true,
  });

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
  mapAuthorizationTokenMiddleware,
  setProfilesProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Pyroscope),
  readProfileBody,
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
