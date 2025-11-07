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
import FluentLogsQueueService from "../Services/Queue/FluentLogsQueueService";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import BadRequestException from "Common/Types/Exception/BadRequestException";

export class FluentLogsRequestMiddleware {
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
  FluentLogsRequestMiddleware.getProductType,
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

      req.body = req.body?.toJSON ? req.body.toJSON() : req.body;

      Response.sendEmptySuccessResponse(req, res);

      await FluentLogsQueueService.addFluentLogsJob(
        req as TelemetryRequest,
      );

      return;
    } catch (err) {
      return next(err);
    }
  },
);

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
      } = await FluentLogsQueueService.getQueueStats();
      return Response.sendJsonObjectResponse(req, res, stats);
    } catch (err) {
      return next(err);
    }
  },
);

router.get(
  "/fluent/queue/size",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const size: number = await FluentLogsQueueService.getQueueSize();
      return Response.sendJsonObjectResponse(req, res, { size });
    } catch (err) {
      return next(err);
    }
  },
);

router.get(
  "/fluent/queue/failed",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
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
      }> = await FluentLogsQueueService.getFailedJobs({
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
