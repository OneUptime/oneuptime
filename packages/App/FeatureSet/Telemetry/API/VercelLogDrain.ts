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
import OpenTelemetryRequestMiddleware from "../Middleware/OtelRequestMiddleware";
import VercelLogDrainIngestService from "../Services/VercelLogDrainIngestService";

/*
 * The Vercel log drain endpoint: POST /vercel/v1/logs (and
 * /telemetry/vercel/v1/logs). See VercelLogDrainIngestService for who may
 * send to it and what becomes of what they send.
 *
 * The body is read raw (OpenTelemetryRequestMiddleware.parseBody, which
 * bounds it and refuses a coding it cannot undo), because the signature is
 * over the bytes as sent: StartServer leaves this path to it, as it does
 * the OTLP routes.
 */

const router: ExpressRouter = Express.getRouter();

/*
 * A delivery, read once its ingest key is right (#10814), as the rest of
 * telemetry's batches are (#10702): every drain sends the key in
 * x-oneuptime-token, so a request without the right key has nothing of its
 * body read - where up to 50 MiB of it was read, and a compressed one
 * inflated to check its signature, for anyone. Read between the key and the
 * ingestion budget, which measures it in Refuse mode, as it was read
 * before: raw, then checked for Vercel's signature over it. Each answers
 * its own refusal (413, 415, 403), which ends the request.
 */
const readVercelDrainBody: RequestHandler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void> => {
  return OpenTelemetryRequestMiddleware.parseBody(req, res, ((
    err?: unknown,
  ): void => {
    if (err) {
      return next(err);
    }

    VercelLogDrainIngestService.verifySignature(req, res, next);
  }) as NextFunction);
};

router.post(
  "/vercel/v1/logs",
  TelemetryIngestionDisabled.middleware,
  VercelLogDrainIngestService.setProductType,
  TelemetryIngest.forSurface(
    TelemetryIngestSurface.VercelLogDrain,
    readVercelDrainBody,
  ),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return VercelLogDrainIngestService.ingest(req, res, next);
  },
);

export default router;
