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
 * held to 50 MB and 1,000,000 values, gzip-compressed or not, the same:
 *
 *   - a JSON array of records, or one record: Fluentd's HTTP output with
 *     json_array, Fluent Bit's http output with format json;
 *   - newline-delimited JSON, one record a line (#10769): Fluentd's HTTP
 *     output without json_array, its default (application/x-ndjson), and
 *     Fluent Bit's with format json_lines. A line that is no JSON is a line
 *     of text;
 *   - lines of text (text/*): Fluentd's single_value, csv or ltsv formats.
 */
const readFluentBody: RequestHandler = RequestBodyAfterAuthentication.readBody(
  LARGE_REQUEST_BODY_LIMIT,
  { parseGzipJson: true, readLines: true },
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
