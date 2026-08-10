import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import WorkerQueueService from "../Services/Queue/WorkerQueueService";

const router: ExpressRouter = Express.getRouter();

/**
 * JSON metrics endpoint for KEDA autoscaling.
 * Returns the combined queue BACKLOG (waiting + delayed jobs) as JSON for
 * the KEDA metrics-api scaler. Active jobs are excluded on purpose: they
 * are capacity being served, not demand — see Queue.getQueueBacklogSize.
 */
router.get(
  "/metrics/queue-size",
  async (
    _req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const queueSize: number = await WorkerQueueService.getQueueBacklogSize();

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
