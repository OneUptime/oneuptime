import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import OpenTelemetryRequestMiddleware from "../Middleware/OtelRequestMiddleware";
import OtelIngestService from "../Services/OtelIngest";
import OtelQueueWorker, { OtelIngestJobData } from "../Services/OtelQueueWorker";
import Response from "Common/Server/Utils/Response";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";

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

      // Check if queue processing is enabled for traces
      if (OtelQueueWorker.isQueueEnabled('traces')) {
        // Add job to queue
        const jobData: OtelIngestJobData = {
          body: reqBody,
          projectId: (req as TelemetryRequest).projectId.toString(),
          headers: req.headers,
        };

        await OtelQueueWorker.addTracesJob(jobData);

        // Return response immediately
        return Response.sendEmptySuccessResponse(req, res);
      } else {
        // Fall back to synchronous processing
        req.body = reqBody;
        return OtelIngestService.ingestTraces(req, res, next);
      }
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

      // Check if queue processing is enabled for metrics
      if (OtelQueueWorker.isQueueEnabled('metrics')) {
        // Add job to queue
        const jobData: OtelIngestJobData = {
          body: reqBody,
          projectId: (req as TelemetryRequest).projectId.toString(),
          headers: req.headers,
        };

        await OtelQueueWorker.addMetricsJob(jobData);

        // Return response immediately
        return Response.sendEmptySuccessResponse(req, res);
      } else {
        // Fall back to synchronous processing
        req.body = reqBody;
        return OtelIngestService.ingestMetrics(req, res, next);
      }
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

      // Check if queue processing is enabled for logs
      if (OtelQueueWorker.isQueueEnabled('logs')) {
        // Add job to queue
        const jobData: OtelIngestJobData = {
          body: reqBody,
          projectId: (req as TelemetryRequest).projectId.toString(),
          headers: req.headers,
        };

        await OtelQueueWorker.addLogsJob(jobData);

        // Return response immediately
        return Response.sendEmptySuccessResponse(req, res);
      } else {
        // Fall back to synchronous processing
        req.body = reqBody;
        return OtelIngestService.ingestLogs(req, res, next);
      }
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
