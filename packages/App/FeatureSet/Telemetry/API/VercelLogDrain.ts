import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
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

router.post(
  "/vercel/v1/logs",
  TelemetryIngestionDisabled.middleware,
  OpenTelemetryRequestMiddleware.parseBody,
  VercelLogDrainIngestService.verifySignature,
  VercelLogDrainIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.VercelLogDrain),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return VercelLogDrainIngestService.ingest(req, res, next);
  },
);

export default router;
