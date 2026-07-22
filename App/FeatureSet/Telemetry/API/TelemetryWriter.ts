import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "Common/Server/Utils/Express";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import TelemetryFanInWriter, {
  FanInInsertTarget,
  FanInSubmitResult,
  type ClickHouseSettings,
} from "Common/Server/Utils/Telemetry/TelemetryFanInWriter";
import { isTelemetryWriterForwardingEnabled } from "Common/Server/Utils/Telemetry/TelemetryWriterClient";
import {
  InflightGate,
  TableTargetResolver,
  WriterInsertOutcome,
  createTableTargetResolver,
  handleWriterInsert,
  readWriterMaxInflightRequestsFromEnv,
} from "Common/Server/Utils/Telemetry/TelemetryWriterServer";
import { JSONObject } from "Common/Types/JSON";
import { AnalyticsServices } from "Common/Server/Services/Index";
import logger from "Common/Server/Utils/Logger";

/*
 * Internal (cluster-key protected) insert endpoint served by the
 * telemetry-writer tier. Worker pods with TELEMETRY_WRITER_URL set deliver
 * every fan-in token group here instead of opening ClickHouse connections,
 * so ClickHouse concurrency is (writerReplicas × per-pod insert cap) — a
 * constant — no matter how far the worker fleet scales out. The response
 * is the durability ack: 200 is only sent after rows landed in ClickHouse.
 */

const router: ExpressRouter = Express.getRouter();

const inflightGate: InflightGate = new InflightGate(
  readWriterMaxInflightRequestsFromEnv(),
);

const resolveTarget: TableTargetResolver =
  createTableTargetResolver(AnalyticsServices);

router.post(
  "/telemetry-writer/insert",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    /*
     * Load-shed before touching the fan-in writer: parked submissions hold
     * their request bodies in memory, so admission — not maxPendingRows —
     * bounds this pod's memory when the worker fleet is much larger than
     * the writer tier. 429 tells the worker-side transport to retry with
     * the same dedup token after backoff.
     */
    if (!inflightGate.tryAcquire()) {
      res.status(429).json({
        message:
          "Telemetry writer is at its inflight-request cap; retry with backoff.",
      });
      return;
    }

    try {
      const outcome: WriterInsertOutcome = await handleWriterInsert(req.body, {
        resolveTarget: resolveTarget,
        submit: (
          target: FanInInsertTarget,
          rows: Array<JSONObject>,
          options: {
            dedupToken: string;
            clickhouseSettings?: ClickHouseSettings | undefined;
          },
        ): Promise<FanInSubmitResult> => {
          return TelemetryFanInWriter.submit(target, rows, options);
        },
        forwardingEnabled: isTelemetryWriterForwardingEnabled(),
      });
      res.status(outcome.statusCode).json(outcome.body);
    } catch (err) {
      logger.error("TelemetryWriter: unexpected insert handler failure:");
      logger.error(err as Error);
      res.status(500).json({
        message: err instanceof Error ? err.message : "Internal error",
      });
    } finally {
      inflightGate.release();
    }
  },
);

export default router;
