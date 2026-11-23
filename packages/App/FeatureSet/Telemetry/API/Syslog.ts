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
import SyslogIngestService from "../Services/SyslogIngestService";
import RequestBodyAfterAuthentication from "Common/Server/Middleware/RequestBodyAfterAuthentication";
import { LARGE_REQUEST_BODY_LIMIT } from "Common/Server/Utils/RequestBodyLimit";

const router: ExpressRouter = Express.getRouter();

const setSyslogProductType: RequestHandler = (
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void => {
  (req as TelemetryRequest).productType = ProductType.Logs;
  next();
};

/*
 * The messages, read once the ingest key is right (#10702): StartServer
 * leaves the body unread (RequestBodyLimit), and nothing of it is read,
 * inflated or parsed for a request without the right key. rsyslog's omhttp
 * and syslog-ng's HTTP destination send the key in a header
 * (x-oneuptime-token). Read between the key and the ingestion budget, which
 * measures it (TelemetryIngest), with StartServer's own parsers, as before:
 * JSON parsed, and a gzip body - rsyslog's batches - kept as its inflated
 * lines, whatever its type, held to 50 MB.
 */
const readSyslogBody: RequestHandler = RequestBodyAfterAuthentication.readBody(
  LARGE_REQUEST_BODY_LIMIT,
);

router.post(
  "/syslog/v1/logs",
  TelemetryIngestionDisabled.middleware,
  setSyslogProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Syslog, readSyslogBody),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return SyslogIngestService.ingestSyslog(req, res, next);
  },
);

export default router;
