import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import CompatibleIngestCredential, {
  CompatibleCredentialScheme,
} from "../Utils/Compatible/CompatibleIngestCredential";
import LokiIngestService from "../Services/LokiIngestService";

/*
 * Loki's push API: POST /loki/api/v1/push (and
 * /telemetry/loki/api/v1/push), at Loki's own path so a client that only
 * takes a host - Fluent Bit's loki output - needs nothing else changed.
 * The body is read raw after the key is checked: StartServer leaves this
 * path to it (isCompatibleIngestPath).
 */

const router: ExpressRouter = Express.getRouter();

// LOKI_PUSH_PATH (Types/Telemetry/CompatibleIngest).
router.post(
  "/loki/api/v1/push",
  TelemetryIngestionDisabled.middleware,
  CompatibleIngestCredential.middleware([
    CompatibleCredentialScheme.Basic,
    CompatibleCredentialScheme.Bearer,
  ]),
  LokiIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.Loki),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return LokiIngestService.ingest(req, res, next);
  },
);

export default router;
