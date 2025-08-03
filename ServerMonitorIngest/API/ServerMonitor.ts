import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import MonitorService from "Common/Server/Services/MonitorService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import ProjectService from "Common/Server/Services/ProjectService";
import ServerMonitorIngestQueueService from "../Services/Queue/ServerMonitorIngestQueueService";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";

const router: ExpressRouter = Express.getRouter();

// an api to see if secret key is valid
router.get(
  "/server-monitor/secret-key/verify/:secretkey",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const monitorSecretKeyAsString: string | undefined =
        req.params["secretkey"];

      if (!monitorSecretKeyAsString) {
        throw new BadDataException("Invalid Secret Key");
      }

      const monitor: Monitor | null = await MonitorService.findOneBy({
        query: {
          serverMonitorSecretKey: new ObjectID(monitorSecretKeyAsString),
          monitorType: MonitorType.Server,
          project: {
            ...ProjectService.getActiveProjectStatusQuery(),
          },
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!monitor) {
        throw new BadDataException("Monitor not found");
      }

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/server-monitor/response/ingest/:secretkey",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const monitorSecretKeyAsString: string | undefined =
        req.params["secretkey"];

      if (!monitorSecretKeyAsString) {
        throw new BadDataException("Invalid Secret Key");
      }

      // return the response early.
      Response.sendEmptySuccessResponse(req, res);

      // Add to queue for asynchronous processing
      await ServerMonitorIngestQueueService.addServerMonitorIngestJob({
        secretKey: monitorSecretKeyAsString,
        serverMonitorResponse: req.body as JSONObject,
      });

      return;
    } catch (err) {
      return next(err);
    }
  },
);

// Queue stats endpoint
router.get(
  "/server-monitor/queue/stats",
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
      } = await ServerMonitorIngestQueueService.getQueueStats();
      return Response.sendJsonObjectResponse(req, res, stats);
    } catch (err) {
      return next(err);
    }
  },
);

// Queue size endpoint
router.get(
  "/server-monitor/queue/size",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const size: number = await ServerMonitorIngestQueueService.getQueueSize();
      return Response.sendJsonObjectResponse(req, res, { size });
    } catch (err) {
      return next(err);
    }
  },
);

// Queue failed jobs endpoint
router.get(
  "/server-monitor/queue/failed",
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
      }> = await ServerMonitorIngestQueueService.getFailedJobs({
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
