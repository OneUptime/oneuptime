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
import PrometheusRemoteWriteIngestService from "../Services/PrometheusRemoteWriteIngestService";

/*
 * Prometheus remote write: POST /prometheus/api/v1/write (and
 * /telemetry/prometheus/api/v1/write). The body is read raw - snappy
 * protobuf - after the key is checked: StartServer leaves this path to it
 * (isCompatibleIngestPath).
 */

const router: ExpressRouter = Express.getRouter();

// PROMETHEUS_REMOTE_WRITE_PATH (Types/Telemetry/CompatibleIngest).
router.post(
  "/prometheus/api/v1/write",
  TelemetryIngestionDisabled.middleware,
  CompatibleIngestCredential.middleware([
    CompatibleCredentialScheme.Bearer,
    CompatibleCredentialScheme.Basic,
  ]),
  PrometheusRemoteWriteIngestService.setProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.PrometheusRemoteWrite),
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return PrometheusRemoteWriteIngestService.ingest(req, res, next);
  },
);

export default router;
