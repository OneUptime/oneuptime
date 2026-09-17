import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import TelemetryQueueService from "../Services/Queue/TelemetryQueueService";
// import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";

const router: ExpressRouter = Express.getRouter();

/**
 * JSON metrics endpoint for KEDA autoscaling.
 * Returns the Telemetry queue BACKLOG (waiting + delayed jobs) as JSON for
 * the KEDA metrics-api scaler. Active jobs are excluded on purpose: they
 * are capacity being served, not demand — see Queue.getQueueBacklogSize.
 */
router.get(
  "/metrics/queue-size",
  // ClusterKeyAuthorization.isAuthorizedServiceMiddleware, // Temporarily disabled for KEDA debugging
  async (
    _req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const queueSize: number =
        await TelemetryQueueService.getQueueBacklogSize();

      res.setHeader("Content-Type", "application/json");
      res.status(200).json({
        queueSize: queueSize,
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
