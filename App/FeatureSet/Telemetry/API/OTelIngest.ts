import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import OpenTelemetryRequestMiddleware from "../Middleware/OtelRequestMiddleware";
import OtelTracesIngestService from "../Services/OtelTracesIngestService";
import OtelMetricsIngestService from "../Services/OtelMetricsIngestService";
import OtelLogsIngestService from "../Services/OtelLogsIngestService";
import OtelProfilesIngestService from "../Services/OtelProfilesIngestService";
import TelemetryQueueService from "../Services/Queue/TelemetryQueueService";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import AppMetrics from "Common/Server/Utils/Telemetry/AppMetrics";
import { JSONObject } from "Common/Types/JSON";

const router: ExpressRouter = Express.getRouter();

/**
 * Records a signal-tagged ingest metric (count + duration + payload bytes).
 * Stacks below the parseBody/getProductType middlewares so payload size is
 * available, and runs before isAuthorizedServiceMiddleware so that auth
 * failures still get counted as "rejected".
 */
const ingestMetricsMiddleware: (
  signal: "traces" | "metrics" | "logs" | "profiles",
) => (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => void = (
  signal: "traces" | "metrics" | "logs" | "profiles",
) => {
  return (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): void => {
    const startNs: bigint = process.hrtime.bigint();

    // Best-effort payload size (parseBody has already populated req.body).
    const body: unknown = (req as { body?: unknown }).body;
    let payloadBytes: number = 0;
    if (body instanceof Uint8Array) {
      payloadBytes = body.byteLength;
    } else if (Buffer.isBuffer(body)) {
      payloadBytes = body.length;
    } else if (typeof body === "string") {
      payloadBytes = Buffer.byteLength(body);
    }

    if (payloadBytes > 0) {
      AppMetrics.getIngestPayloadBytes().record(payloadBytes, {
        "telemetry.signal": signal,
      });
    }

    let recorded: boolean = false;
    const recordOnce: () => void = (): void => {
      if (recorded) {
        return;
      }
      recorded = true;

      const elapsedNs: bigint = process.hrtime.bigint() - startNs;
      const durationMs: number = Number(elapsedNs) / 1e6;
      const statusCode: number = res.statusCode || 0;
      const outcome: string =
        statusCode >= 200 && statusCode < 300
          ? "accepted"
          : statusCode >= 400 && statusCode < 500
            ? "rejected"
            : "error";

      const attributes: Record<string, string> = {
        "telemetry.signal": signal,
        outcome,
      };

      AppMetrics.getIngestCounter().add(1, attributes);
      AppMetrics.getIngestDuration().record(durationMs, attributes);
    };

    res.on("finish", recordOnce);
    res.on("close", recordOnce);

    next();
  };
};

/**
 *
 *  Otel Middleware
 *
 */

router.post(
  "/otlp/v1/traces",
  OpenTelemetryRequestMiddleware.parseBody,
  ingestMetricsMiddleware("traces"),
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return OtelTracesIngestService.ingestTraces(req, res, next);
  },
);

router.post(
  "/otlp/v1/metrics",
  OpenTelemetryRequestMiddleware.parseBody,
  ingestMetricsMiddleware("metrics"),
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return OtelMetricsIngestService.ingestMetrics(req, res, next);
  },
);

router.post(
  "/otlp/v1/logs",
  OpenTelemetryRequestMiddleware.parseBody,
  ingestMetricsMiddleware("logs"),
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return OtelLogsIngestService.ingestLogs(req, res, next);
  },
);

router.post(
  "/otlp/v1/profiles",
  OpenTelemetryRequestMiddleware.parseBody,
  ingestMetricsMiddleware("profiles"),
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return OtelProfilesIngestService.ingestProfiles(req, res, next);
  },
);

// Queue stats endpoint
router.get(
  "/otlp/queue/stats",
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
      } = await TelemetryQueueService.getQueueStats();
      return Response.sendJsonObjectResponse(req, res, stats);
    } catch (err) {
      return next(err);
    }
  },
);

// Queue size endpoint
router.get(
  "/otlp/queue/size",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const size: number = await TelemetryQueueService.getQueueSize();
      return Response.sendJsonObjectResponse(req, res, { size });
    } catch (err) {
      return next(err);
    }
  },
);

// Queue failed jobs endpoint
router.get(
  "/otlp/queue/failed",
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
        data: JSONObject;
        failedReason: string;
        stackTrace?: string;
        processedOn: Date | null;
        finishedOn: Date | null;
        attemptsMade: number;
      }> = await TelemetryQueueService.getFailedJobs({
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
