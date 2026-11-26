import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import ProbeSchedulingFleetMetrics, {
  ProbeSchedulingFleetView,
} from "Common/Server/Utils/Probe/ProbeSchedulingFleetMetrics";
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

/*
 * How the App replicas hand work to the probes, all of them together, for
 * KEDA's metrics-api scaler and for an operator (issue #10819,
 * ProbeSchedulingFleetMetrics): the requests waiting for a slot of the probe
 * scheduling limit now (queueDepth), how long they waited, how many were
 * answered busy, how late monitors were handed out past when they were due
 * (dispatch lag), and how long Test Monitor runs waited for a probe - each
 * over the last minute. Unauthenticated, as /metrics/queue-size is: counts
 * and durations only, and no replica is named.
 */
router.get(
  "/metrics/probe-scheduling",
  async (_req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const view: ProbeSchedulingFleetView =
      await ProbeSchedulingFleetMetrics.read();

    res.setHeader("Content-Type", "application/json");
    res.status(200).json(view);
  },
);

export default router;
