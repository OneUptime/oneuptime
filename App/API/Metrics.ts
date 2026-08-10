import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import AppQueueService from "../Services/Queue/AppQueueService";

const router: ExpressRouter = Express.getRouter();

/**
 * JSON metrics endpoint for KEDA autoscaling.
 * Returns the combined queue BACKLOG (waiting + delayed jobs across
 * worker + workflow + telemetry + runbook) as JSON for the KEDA
 * metrics-api scaler. Active jobs are excluded on purpose: they are
 * capacity being served, not demand — see Queue.getQueueBacklogSize.
 */
router.get(
  "/metrics/queue-size",
  async (
    _req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const queueSize: number = await AppQueueService.getQueueBacklogSize();

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
