import TelemetryIngest from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionDisabled from "Common/Server/Middleware/TelemetryIngestionDisabled";
import TelemetryIngestSurface from "Common/Types/Telemetry/TelemetryIngestSurface";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  RequestHandler,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import OpenTelemetryRequestMiddleware from "../Middleware/OtelRequestMiddleware";
/*
 * OneUptime's own ingest metrics (telemetry.ingest.request.*), shared with
 * the compatible endpoints. Stacked before the ingestion-key guard, so auth
 * failures still get counted as "rejected"; the payload size is recorded
 * once the guard has read the body (readOtlpBody).
 */
import { ingestMetricsMiddleware } from "../Middleware/IngestRequestMetrics";
import OtelTracesIngestService from "../Services/OtelTracesIngestService";
import OtelMetricsIngestService from "../Services/OtelMetricsIngestService";
import OtelLogsIngestService from "../Services/OtelLogsIngestService";
import OtelProfilesIngestService from "../Services/OtelProfilesIngestService";
import { JSONObject } from "Common/Types/JSON";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import StatusCode from "Common/Types/API/StatusCode";
import TelemetryIngestionKeyPolicy from "Common/Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";

const router: ExpressRouter = Express.getRouter();

/**
 *
 *  Otel Middleware
 *
 */

/*
 * An export's body, read once its ingest key is right (#10814), as the rest
 * of telemetry's batches are (#10702): nothing of it is read for a request
 * without the right key, where up to 50 MiB of it was buffered, for anyone.
 * Read between the key and the ingestion budget, which measures it in
 * Refuse mode, as it was read before: raw, held to its cap, a coding the
 * worker cannot undo refused 415 (OpenTelemetryRequestMiddleware
 * .readBodyAfterKey).
 */
const readOtlpBody: RequestHandler =
  OpenTelemetryRequestMiddleware.readBodyAfterKey;

router.post(
  "/otlp/v1/traces",
  TelemetryIngestionDisabled.middleware,
  ingestMetricsMiddleware("traces"),
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.OtelTraces, readOtlpBody),
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
  ingestMetricsMiddleware("metrics"),
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.OtelMetrics, readOtlpBody),
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
  ingestMetricsMiddleware("logs"),
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.OtelLogs, readOtlpBody),
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
  ingestMetricsMiddleware("profiles"),
  OpenTelemetryRequestMiddleware.getProductType,
  TelemetryIngest.forSurface(TelemetryIngestSurface.OtelProfiles, readOtlpBody),
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
              "This ingestion token is unknown or has been revoked. Create or copy a live key from Project Settings > Telemetry & APM > Ingestion Keys, then re-deploy the agent with it.",
          },
          { statusCode: new StatusCode(401) },
        );
      }

      const isExpired: boolean = Boolean(
        policy.expiresAt && policy.expiresAt.getTime() <= Date.now(),
      );

      const isBrowserKey: boolean =
        policy.keyType === TelemetryIngestionKeyType.Browser;
      const isMobileKey: boolean =
        policy.keyType === TelemetryIngestionKeyType.Mobile;

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
                ? "This ingestion key has been disabled. Re-enable it, or create a new key, in Project Settings > Telemetry & APM > Ingestion Keys."
                : "This ingestion key has expired. Extend its expiry, or create a new key, in Project Settings > Telemetry & APM > Ingestion Keys.",
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
          ? "Ingestion token is valid, but it is a BROWSER ingestion key. It is accepted only from a browser, only from one of its allowed origins, and only for OTLP traces, logs and metrics, session replays, and events from a Sentry browser SDK. Use a server ingestion key in a collector, an agent, or any backend service."
          : isMobileKey
            ? /*
               * The mobile counterpart (issue #6457): valid in the app it
               * was made for, and nowhere a collector or a page would use
               * it. Its pinned app is not named: that is the shape of the
               * project's defences, as the browser message keeps its origins.
               */
              "Ingestion token is valid. It is a MOBILE ingestion key: it is accepted only from a mobile app, without an Origin header, and only for OTLP traces, logs and metrics over HTTP and the app's session replays, all filed under the app it is pinned to. Use a server ingestion key in a collector, an agent, or any backend service, and a browser ingestion key in a web page."
            : "Ingestion token is valid.",
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
