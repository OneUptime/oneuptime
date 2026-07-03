import { createHash } from "crypto";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import TelemetryIngestionKeyService from "Common/Server/Services/TelemetryIngestionKeyService";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import InMemoryTTLCache from "Common/Server/Infrastructure/InMemoryTTLCache";
import ForbiddenException from "Common/Types/Exception/ForbiddenException";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  RequestHandler,
  headerValueToString,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import OtelPayloadDecoder, {
  OtelPayloadFormat,
} from "../Utils/OtelPayloadDecoder";
import {
  IotFleetScopeCarrier,
  IotFleetScopeViolation,
  findIotFleetScopeViolation,
  getResourceEnvelopesFromOtelBody,
  isFleetScoped,
  normalizeIotFleetNames,
} from "../Utils/IotFleetScope";

/*
 * Enforcement entry points for IoT-fleet-scoped telemetry ingestion
 * keys (see Utils/IotFleetScope.ts for the pure check logic).
 *
 * The project-wide auth middleware
 * (Common/Server/Middleware/TelemetryIngest.ts) resolves the token to a
 * projectId only; resource attributes for the HTTP OTLP path are not
 * decoded until the queue worker runs. For scoped keys we therefore
 * decode the payload here — at request time, BEFORE anything is
 * buffered or enqueued — so violating requests get a real 403 and no
 * data for the offending resource ever lands anywhere. Unscoped keys
 * (the default) skip the decode entirely and behave exactly as before.
 */

/*
 * Same worst-case staleness as TelemetryIngestionKeyService's
 * projectId cache: a scope change made in the dashboard is picked up by
 * every process within 60s.
 */
const SCOPE_CACHE_TTL_MS: number = 60 * 1000;

const fleetScopeCache: InMemoryTTLCache<Array<string>> = new InMemoryTTLCache(
  10_000,
);

/**
 * Extract the ingestion token using the same header precedence as
 * TelemetryIngest.isAuthorizedServiceMiddleware. Returns undefined when
 * absent (auth middleware will already have rejected the request).
 */
export function getIngestionTokenFromHeaders(
  headers: Record<string, unknown>,
): string | undefined {
  return (
    (headers["x-oneuptime-token"] as string | undefined) ||
    (headers["x-oneuptime-service-token"] as string | undefined) ||
    (headers["x-oneuptime-ingestion-key"] as string | undefined)
  );
}

/**
 * Resolve the allowed IoT fleet names for an ingestion token.
 * Returns [] (unscoped) for keys without a fleet scope. Cached
 * in-process; the cache key is a SHA-256 of the token so the raw
 * secret never sits in the cache map — and it is NEVER logged.
 */
export async function getAllowedIotFleetNamesForToken(
  token: string,
): Promise<Array<string>> {
  const cacheKey: string = createHash("sha256").update(token).digest("hex");

  const cached: Array<string> | undefined = fleetScopeCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  let secretKey: ObjectID;
  try {
    secretKey = new ObjectID(token);
  } catch {
    // Malformed token — auth already rejected it; nothing to scope.
    fleetScopeCache.set(cacheKey, [], SCOPE_CACHE_TTL_MS);
    return [];
  }

  const key: TelemetryIngestionKey | null =
    await TelemetryIngestionKeyService.findOneBy({
      query: { secretKey: secretKey },
      select: { iotFleetNames: true },
      props: { isRoot: true },
    });

  /*
   * A missing row means the key was revoked between auth and this
   * lookup — the auth layer's own cache expires within the same 60s
   * window, so treat it like an unscoped (already-authenticated) key
   * rather than inventing a second revocation path here.
   */
  const allowed: Array<string> = normalizeIotFleetNames(key?.iotFleetNames);

  fleetScopeCache.set(cacheKey, allowed, SCOPE_CACHE_TTL_MS);
  return allowed;
}

/** Test-only: reset the in-process scope cache. */
export function clearFleetScopeCache(): void {
  fleetScopeCache.clear();
}

export default class IotFleetScopeEnforcement {
  /**
   * Express middleware for the four HTTP OTLP ingest routes. Must run
   * AFTER TelemetryIngest.isAuthorizedServiceMiddleware (token already
   * validated) and BEFORE the ingest handler (which responds 200 and
   * enqueues the raw body).
   *
   * For unscoped keys this is a single cache lookup and a next() —
   * ingest behavior is unchanged. For fleet-scoped keys the raw body
   * is decoded here and every OTLP resource must carry an in-scope
   * `iot.fleet.name` resource attribute; otherwise the whole request
   * is rejected with 403 before anything is buffered or enqueued.
   */
  @CaptureSpan()
  public static async enforceOtlpFleetScope(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const token: string | undefined = getIngestionTokenFromHeaders(
        req.headers as Record<string, unknown>,
      );

      if (!token) {
        // Auth middleware rejects token-less requests before us.
        return next();
      }

      const allowedIotFleetNames: Array<string> =
        await getAllowedIotFleetNamesForToken(token.toString());

      if (!isFleetScoped(allowedIotFleetNames)) {
        // Unscoped key — byte-identical to today's behavior.
        return next();
      }

      /*
       * Stash the scope on the request so the queue producer forwards
       * it to the worker, which re-checks at its resource loop
       * (defense in depth).
       */
      (req as ExpressRequest & IotFleetScopeCarrier).allowedIotFleetNames =
        allowedIotFleetNames;

      /*
       * Scoped keys are expected on small IoT device payloads, so the
       * synchronous decode cost here is deliberate and opt-in — it only
       * runs for scoped keys. Unscoped traffic keeps the deferred
       * worker-side decode.
       */
      let body: JSONObject;

      if (Buffer.isBuffer(req.body) || req.body instanceof Uint8Array) {
        const buffer: Buffer = Buffer.isBuffer(req.body)
          ? (req.body as Buffer)
          : Buffer.from(req.body as Uint8Array);

        const contentType: string | undefined = headerValueToString(
          req.headers["content-type"],
        );
        const contentEncoding: string | undefined = headerValueToString(
          req.headers["content-encoding"],
        );

        // Same format detection as TelemetryQueueService.addTelemetryIngestJob.
        const isProtobuf: boolean =
          !contentType ||
          contentType.includes("application/x-protobuf") ||
          contentType.includes("application/protobuf");

        body = await OtelPayloadDecoder.decodeRawBody({
          productType: (req as TelemetryRequest).productType,
          format: isProtobuf
            ? OtelPayloadFormat.Protobuf
            : OtelPayloadFormat.Json,
          encoding: contentEncoding?.includes("gzip") ? "gzip" : "none",
          raw: buffer,
        });
      } else {
        // Already-parsed producers hand us the decoded object directly.
        body = (req.body || {}) as JSONObject;
      }

      const resourceEnvelopes: JSONArray = getResourceEnvelopesFromOtelBody(
        body,
        (req as TelemetryRequest).productType,
      );

      const violation: IotFleetScopeViolation | null =
        findIotFleetScopeViolation({
          allowedIotFleetNames,
          resourceEnvelopes,
        });

      if (violation) {
        /*
         * 403: the key is valid but not allowed to push this data. The
         * message names the offending fleet and the allowed scope; it
         * never contains the key itself. Nothing has been buffered or
         * enqueued at this point.
         */
        logger.warn(
          "Rejected fleet-scoped telemetry ingest (HTTP OTLP): " +
            violation.message,
        );
        return Response.sendErrorResponse(
          req,
          res,
          new ForbiddenException(violation.message),
        );
      }

      return next();
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Middleware factory for ingest paths that carry no OTLP resource
   * attributes (syslog, fluentd, pyroscope profiles). A fleet-scoped
   * key cannot attribute this data to a fleet, so scoped keys are
   * rejected outright (fail closed). Unscoped keys pass untouched.
   */
  public static rejectFleetScopedKeys(pathLabel: string): RequestHandler {
    return async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      try {
        const token: string | undefined = getIngestionTokenFromHeaders(
          req.headers as Record<string, unknown>,
        );

        if (!token) {
          return next();
        }

        const allowedIotFleetNames: Array<string> =
          await getAllowedIotFleetNamesForToken(token.toString());

        if (!isFleetScoped(allowedIotFleetNames)) {
          return next();
        }

        const message: string =
          `This telemetry ingestion key is scoped to specific IoT fleets and can only be used ` +
          `for OTLP ingestion of resources that carry an in-scope iot.fleet.name resource attribute. ` +
          `The ${pathLabel} ingest path cannot be fleet-attributed, so fleet-scoped keys are not accepted here. ` +
          `Use an unscoped telemetry ingestion key instead.`;

        logger.warn(
          `Rejected fleet-scoped telemetry ingest (${pathLabel}): scoped keys are not accepted on this path.`,
        );

        return Response.sendErrorResponse(
          req,
          res,
          new ForbiddenException(message),
        );
      } catch (err) {
        return next(err);
      }
    };
  }
}
