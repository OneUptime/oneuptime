import TelemetryIngest, {
  TelemetryRequest,
} from "Common/Server/Middleware/TelemetryIngest";
import ProductType from "Common/Types/MeteredPlan/ProductType";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import FluentIngestQueueService from "../Services/Queue/FluentIngestQueueService";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import BadRequestException from "Common/Types/Exception/BadRequestException";

export class FluentRequestMiddleware {
  public static async getProductType(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      (req as TelemetryRequest).productType = ProductType.Logs;
      return next();
    } catch (err) {
      return next(err);
    }
  }
}

const router: ExpressRouter = Express.getRouter();

router.post(
  "/fluentd/v1/logs",
  FluentRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!(req as TelemetryRequest).projectId) {
        throw new BadRequestException(
          "Invalid request - projectId not found in request.",
        );
      }

      req.body = req.body.toJSON ? req.body.toJSON() : req.body;

      // Return response immediately
      Response.sendEmptySuccessResponse(req, res);

      // Add to queue for asynchronous processing
      await FluentIngestQueueService.addFluentIngestJob(
        req as TelemetryRequest,
      );

      return;
    } catch (err) {
      return next(err);
    }
  },
);

// Queue stats endpoint
router.get(
  "/fluent/queue/stats",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const stats: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        total: number;
      } = await FluentIngestQueueService.getQueueStats();
      return Response.sendJsonObjectResponse(req, res, stats);
    } catch (err) {
      return next(err);
    }
  },
);

// Queue size endpoint
router.get(
  "/fluent/queue/size",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const size: number = await FluentIngestQueueService.getQueueSize();
      return Response.sendJsonObjectResponse(req, res, { size });
    } catch (err) {
      return next(err);
    }
  },
);

// Queue failed jobs endpoint
router.get(
  "/fluent/queue/failed",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Parse pagination parameters from query string
      const start: number = parseInt(req.query["start"] as string) || 0;
      const end: number = parseInt(req.query["end"] as string) || 100;

      const failedJobs: Array<{
        id: string;
        name: string;
        data: any;
        failedReason: string;
        stackTrace?: string;
        processedOn: Date | null;
        finishedOn: Date | null;
        attemptsMade: number;
      }> = await FluentIngestQueueService.getFailedJobs({
        start,
        end,
      });

      return Response.sendJsonObjectResponse(req, res, {
        failedJobs,
        pagination: {
          start,
          end,
          count: failedJobs.length,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
