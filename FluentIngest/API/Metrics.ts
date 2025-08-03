import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import FluentIngestQueueService from "../Services/Queue/FluentIngestQueueService";
// import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";

const router: ExpressRouter = Express.getRouter();

/**
 * JSON metrics endpoint for KEDA autoscaling
 * Returns queue size as JSON for KEDA metrics-api scaler
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
      const queueSize: number = await FluentIngestQueueService.getQueueSize();

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
