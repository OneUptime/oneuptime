import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
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
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

const router: ExpressRouter = Express.getRouter();

/**
 * Records a signal-tagged ingest metric (count + duration + payload bytes).
 * Stacks below the parseBody/getProductType middlewares so payload size is
 * available, and runs before the ingestion-key guard so that auth failures
 * still get counted as "rejected".
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
  TelemetryIngest.forSurface(TelemetryIngestSurface.OtelTraces),
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
  TelemetryIngest.forSurface(TelemetryIngestSurface.OtelMetrics),
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
  TelemetryIngest.forSurface(TelemetryIngestSurface.OtelLogs),
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
  TelemetryIngest.forSurface(TelemetryIngestSurface.OtelProfiles),
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
 * The /otlp/v1/{traces,metrics,logs,profiles} ingest endpoints above answer
 * 401 for a missing/invalid token (non-retryable per the OTLP spec, so
 * compliant collectors log it instead of retry-storming), but that error is
 * easy to miss in collector logs and impossible to see from an install
 * script.
 *
 * This endpoint exists so an agent, install script, or human can ask "is my
 * token actually accepted?" and get a REAL answer:
 *   200 { valid: true,  projectId, keyType, isEnabled, isExpired }
 *        — the token resolves to a project AND ingest would accept it
 *   401 { valid: false, keyType?, isEnabled?, isExpired? }
 *        — missing / malformed / unknown / revoked / switched off / expired
 *
 * `valid` answers the question the caller actually asked - "will my telemetry
 * land?" - so a key that resolves but is disabled or expired is reported
 * false, not true. Reporting it true would send an install script away
 * satisfied and leave the customer wondering why every export 401s. Nothing
 * changes for keys that exist today: they are all enabled and none has an
 * expiry, so they keep answering exactly as before.
 *
 * The three added fields are the minimum needed to turn "invalid" into an
 * actionable sentence, and the ONLY key configuration disclosed. In
 * particular allowedOrigins, pinnedServiceName, requestsPerMinuteLimit and
 * the expiry timestamp are deliberately withheld: this endpoint is
 * unauthenticated apart from possession of the token, and possession is
 * exactly the condition of an attacker holding a scraped key. Those four are
 * the shape of a project's defences - the origin list in particular tells a
 * thief where a stolen browser key still works - and none of them is needed
 * to diagnose the failures this endpoint is asked about. They are one click
 * away in the dashboard for the people entitled to see them.
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

      const policy: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(
          token.toString(),
        );

      if (!policy) {
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

      const isExpired: boolean = Boolean(
        policy.expiresAt && policy.expiresAt.getTime() <= Date.now(),
      );

      const isBrowserKey: boolean =
        policy.keyType === TelemetryIngestionKeyType.Browser;

      /*
       * Reported on every resolved token, valid or not, because "which of
       * these three is wrong?" is the entire diagnostic value of the
       * endpoint. A script can branch on them without parsing prose.
       */
      const keyDiagnostics: JSONObject = {
        keyType: policy.keyType,
        isEnabled: policy.isEnabled,
        isExpired: isExpired,
      };

      if (policy.isEnabled === false || isExpired) {
        /*
         * projectId is deliberately NOT echoed on this branch, unlike the
         * success one. A key gets switched off precisely because it leaked,
         * so the caller of a disabled key is as likely to be the thief as
         * the owner - and the owner already knows which project the key they
         * just created belongs to. There is no diagnostic loss and one less
         * identifier handed to whoever is holding a dead credential.
         */
        return Response.sendJsonObjectResponse(
          req,
          res,
          {
            tokenProvided: true,
            valid: false,
            ...keyDiagnostics,
            message:
              policy.isEnabled === false
                ? "This ingestion key has been disabled. Re-enable it, or create a new key, in Project Settings > Telemetry Ingestion Keys."
                : "This ingestion key has expired. Extend its expiry, or create a new key, in Project Settings > Telemetry Ingestion Keys.",
          },
          { statusCode: new StatusCode(401) },
        );
      }

      return Response.sendJsonObjectResponse(req, res, {
        tokenProvided: true,
        valid: true,
        projectId: policy.projectId.toString(),
        ...keyDiagnostics,
        /*
         * A browser key IS valid - it just is not valid for the caller who
         * most often runs this check. An install script pointing a collector
         * or an agent at OneUptime gets told, in one sentence, that it has
         * been handed the public page credential instead of the server one,
         * which is otherwise a silent 403 per export batch much later on.
         */
        message: isBrowserKey
          ? "Ingestion token is valid, but it is a BROWSER ingestion key. It is accepted only from a browser, only from one of its allowed origins, and only for OTLP traces, logs and metrics and session replay. Use a server ingestion key in a collector, an agent, or any backend service."
          : "Ingestion token is valid.",
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
