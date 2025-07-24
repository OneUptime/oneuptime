import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import OpenTelemetryRequestMiddleware from "../Middleware/OtelRequestMiddleware";
import OtelQueueWorker, { OtelIngestJobData } from "../Services/OtelQueueWorker";
import Response from "Common/Server/Utils/Response";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

/**
 *
 *  Otel Middleware
 *
 */

router.post(
  "/otlp/v1/traces",
  OpenTelemetryRequestMiddleware.getProductType,
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

      const reqBody = req.body.toJSON ? req.body.toJSON() : req.body;

      // Add job to queue
      const jobData: OtelIngestJobData = {
        body: reqBody,
        projectId: (req as TelemetryRequest).projectId.toString(),
        headers: req.headers,
      };

      await OtelQueueWorker.addTracesJob(jobData);

      logger.debug(`Traces job added to queue for project ${jobData.projectId}`);

      // Return response immediately
      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/otlp/v1/metrics",
  OpenTelemetryRequestMiddleware.getProductType,
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

      const reqBody = req.body.toJSON ? req.body.toJSON() : req.body;

      // Add job to queue
      const jobData: OtelIngestJobData = {
        body: reqBody,
        projectId: (req as TelemetryRequest).projectId.toString(),
        headers: req.headers,
      };

      await OtelQueueWorker.addMetricsJob(jobData);


      logger.debug(`Metrics job added to queue for project ${jobData.projectId}`);

      // Return response immediately
      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/otlp/v1/logs",
  OpenTelemetryRequestMiddleware.getProductType,
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

      const reqBody = req.body.toJSON ? req.body.toJSON() : req.body;

      // Add job to queue
      const jobData: OtelIngestJobData = {
        body: reqBody,
        projectId: (req as TelemetryRequest).projectId.toString(),
        headers: req.headers,
      };

      await OtelQueueWorker.addLogsJob(jobData);

      logger.debug(`Logs job added to queue for project ${jobData.projectId}`);

      // Return response immediately
      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
