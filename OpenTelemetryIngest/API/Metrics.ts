import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import TelemetryQueueService from "../Services/Queue/TelemetryQueueService";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";

const router: ExpressRouter = Express.getRouter();

/**
 * Prometheus metrics endpoint for KEDA autoscaling
 * Exposes queue metrics in Prometheus format
 */
router.get(
  "/metrics",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    _req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const [queueSize, queueStats] = await Promise.all([
        TelemetryQueueService.getQueueSize(),
        TelemetryQueueService.getQueueStats(),
      ]);

      // Generate Prometheus metrics format
      const metrics: string = [
        "# HELP oneuptime_telemetry_queue_size Current size of the telemetry queue",
        "# TYPE oneuptime_telemetry_queue_size gauge",
        `oneuptime_telemetry_queue_size ${queueSize}`,
        "",
        "# HELP oneuptime_telemetry_queue_waiting Number of waiting jobs in the telemetry queue",
        "# TYPE oneuptime_telemetry_queue_waiting gauge",
        `oneuptime_telemetry_queue_waiting ${queueStats.waiting}`,
        "",
        "# HELP oneuptime_telemetry_queue_active Number of active jobs in the telemetry queue",
        "# TYPE oneuptime_telemetry_queue_active gauge",
        `oneuptime_telemetry_queue_active ${queueStats.active}`,
        "",
        "# HELP oneuptime_telemetry_queue_completed Number of completed jobs in the telemetry queue",
        "# TYPE oneuptime_telemetry_queue_completed counter",
        `oneuptime_telemetry_queue_completed ${queueStats.completed}`,
        "",
        "# HELP oneuptime_telemetry_queue_failed Number of failed jobs in the telemetry queue",
        "# TYPE oneuptime_telemetry_queue_failed counter",
        `oneuptime_telemetry_queue_failed ${queueStats.failed}`,
        "",
        "# HELP oneuptime_telemetry_queue_delayed Number of delayed jobs in the telemetry queue",
        "# TYPE oneuptime_telemetry_queue_delayed gauge",
        `oneuptime_telemetry_queue_delayed ${queueStats.delayed}`,
        "",
        "# HELP oneuptime_telemetry_queue_total Total number of jobs in the telemetry queue",
        "# TYPE oneuptime_telemetry_queue_total gauge",
        `oneuptime_telemetry_queue_total ${queueStats.total}`,
        "",
      ].join("\n");

      res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      res.status(200).send(metrics);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
