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
import PyroscopeIngestService from "../Services/PyroscopeIngestService";
import MultipartFormDataMiddleware from "Common/Server/Middleware/MultipartFormData";

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

// Map Authorization: Bearer <token> to x-oneuptime-token header
// Pyroscope SDKs use authToken which sends Authorization: Bearer
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

router.post(
  "/pyroscope/ingest",
  MultipartFormDataMiddleware,
  mapBearerTokenMiddleware,
  setProfilesProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return PyroscopeIngestService.ingestPyroscopeProfile(req, res, next);
  },
);

// Also mount at /ingest for Pyroscope SDKs that use serverAddress without a subpath
router.post(
  "/ingest",
  MultipartFormDataMiddleware,
  mapBearerTokenMiddleware,
  setProfilesProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return PyroscopeIngestService.ingestPyroscopeProfile(req, res, next);
  },
);

export default router;
