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
import FluentLogsIngestService from "../Services/FluentLogsIngestService";
import RequestBodyAfterAuthentication from "Common/Server/Middleware/RequestBodyAfterAuthentication";
import { LARGE_REQUEST_BODY_LIMIT } from "Common/Server/Utils/RequestBodyLimit";

const router: ExpressRouter = Express.getRouter();

const setFluentProductType: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  (req as TelemetryRequest).productType = ProductType.Logs;
  next();
};

/*
 * The batch, read once its ingest key is right (#10702): StartServer leaves
 * the body unread (RequestBodyLimit), and nothing of it is read, inflated or
 * parsed for a request without the right key. Fluentd's HTTP output and
 * Fluent Bit's send the key in a header (x-oneuptime-token). Read between
 * the key and the ingestion budget, which measures it (TelemetryIngest),
 * with StartServer's own parsers: JSON parsed, held to 50 MB and 1,000,000
 * values. A gzip JSON body - Fluentd's json_array, or Fluent Bit's json,
 * compressed - is parsed as the same body uncompressed is.
 */
const readFluentBody: RequestHandler = RequestBodyAfterAuthentication.readBody(
  LARGE_REQUEST_BODY_LIMIT,
  { parseGzipJson: true },
);

router.post(
  "/fluentd/v1/logs",
  TelemetryIngestionDisabled.middleware,
  setFluentProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Fluent, readFluentBody),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return FluentLogsIngestService.ingestFluentLogs(req, res, next);
  },
);

export default router;
