import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
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
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import StatusCode from "Common/Types/API/StatusCode";
import ObjectID from "Common/Types/ObjectID";

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
  TelemetryIngestionDisabled.middleware,
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
  TelemetryIngestionDisabled.middleware,
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
  TelemetryIngestionDisabled.middleware,
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
  TelemetryIngestionDisabled.middleware,
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

/**
 * Ingestion-key validation endpoint.
 *
 * The /otlp/v1/{traces,metrics,logs,profiles} ingest endpoints above
 * deliberately answer HTTP 200 even for a missing/invalid token — returning an
 * error would make a misconfigured OpenTelemetry collector retry-storm the
 * server. The cost is that a wrong or revoked token is invisible from the
 * agent side: the collector reports success while every byte is silently
 * dropped, and the cluster never shows as connected.
 *
 * This endpoint exists so an agent, install script, or human can ask "is my
 * token actually accepted?" and get a REAL answer:
 *   200 { valid: true,  projectId }  — token resolves to a project
 *   401 { valid: false }             — token missing / malformed / unknown / revoked
 *
 * It performs no ingestion and writes nothing. The token is read only from a
 * header (never a query string) so it can't leak into access logs. Ingestion
 * tokens are 122-bit random UUIDs, so this is not a useful brute-force oracle;
 * unknown tokens are additionally negative-cached by the service below.
 */
router.get(
  "/otlp/v1/validate",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const token: string | undefined =
        (req.headers["x-oneuptime-token"] as string | undefined) ||
        (req.headers["x-oneuptime-service-token"] as string | undefined) ||
        (req.headers["x-oneuptime-ingestion-key"] as string | undefined);

      if (!token) {
        return Response.sendJsonObjectResponse(
          req,
          res,
          {
            tokenProvided: false,
            valid: false,
            message:
              "No ingestion token provided. Send it in the x-oneuptime-token header.",
          },
          { statusCode: new StatusCode(401) },
        );
      }

      const projectId: ObjectID | null =
        await TelemetryIngestionKeyService.getProjectIdFromSecretKey(
          token.toString(),
        );

      if (!projectId) {
        return Response.sendJsonObjectResponse(
          req,
          res,
          {
            tokenProvided: true,
            valid: false,
            message:
              "This ingestion token is unknown or has been revoked. Create or copy a live key from Project Settings > Telemetry Ingestion Keys, then re-deploy the agent with it.",
          },
          { statusCode: new StatusCode(401) },
        );
      }

      return Response.sendJsonObjectResponse(req, res, {
        tokenProvided: true,
        valid: true,
        projectId: projectId.toString(),
        message: "Ingestion token is valid.",
      });
    } catch (err) {
      return next(err);
    }
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
