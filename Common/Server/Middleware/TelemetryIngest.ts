import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ProductType from "../../Types/MeteredPlan/ProductType";
import ObjectID from "../../Types/ObjectID";
import TelemetryIngestionKeyPolicy, {
  DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE,
} from "../../Types/Telemetry/TelemetryIngestionKeyPolicy";
import TelemetryIngestionKeyType from "../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
  getIngestSurfaceReadableName,
} from "../../Types/Telemetry/TelemetryIngestSurface";
import OriginAllowList from "../../Utils/Telemetry/OriginAllowList";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  headerValueToString,
} from "../../Server/Utils/Express";
import TelemetryIngestionKeyService from "../../Server/Services/TelemetryIngestionKeyService";
import Response from "../Utils/Response";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SpanUtil from "../Utils/Telemetry/SpanUtil";
import TelemetryIngestionKeyRateLimiter, {
  TelemetryIngestionKeyLimitDecision,
  TelemetryIngestionKeyLimitOutcome,
} from "../Utils/Telemetry/TelemetryIngestionKeyRateLimiter";

export interface TelemetryRequest extends ExpressRequest {
  projectId: ObjectID; // Project ID
  productType: ProductType; // what is the product type of the request - logs, metrics or traces.

  /*
   * The resolved key policy that admitted this request. Downstream handlers
   * and queue workers need it - the pinned service name is applied when the
   * payload is processed, not here - and having it on the request means they
   * never have to re-resolve the token, which would mean carrying the secret
   * further into the system than it needs to go.
   */
  ingestionKeyPolicy: TelemetryIngestionKeyPolicy;
}

/*
 * A Redis outage puts EVERY ingest request on the counter-unavailable path,
 * so an unguarded log line there is one line per ingested request for as long
 * as the outage lasts. The ingest path is the highest-volume surface in the
 * product, so that buries the very incident it is reporting. Same throttle as
 * PublicDashboardRateLimit and the limiter itself.
 */
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

/*
 * Readable name used when a legacy call site did not name its surface. See
 * isAuthorizedServiceMiddleware for why such call sites are treated as
 * server-only.
 */
const UNNAMED_SURFACE_READABLE_NAME: string = "this ingest endpoint";

type GetEffectiveRequestsPerMinuteLimitFunction = (
  policy: TelemetryIngestionKeyPolicy,
) => number | null;

/*
 * How many requests per minute this key may make, or null for "no limit".
 *
 * Exported so the branches can be pinned directly in tests without standing
 * up an Express request, a Redis client and a mocked service just to observe
 * an arithmetic decision.
 *
 * The asymmetry in the fallback is the whole backwards-compatibility story of
 * this feature: an existing Server key has requestsPerMinuteLimit NULL and
 * must keep behaving exactly as it did before this shipped, which means no
 * limit and - see the call site - not even a Redis round trip. A Browser key
 * with NULL falls back to the shipped default instead, because a public key
 * with no ceiling is the thing we are trying to stop shipping: "the customer
 * did not configure a limit" cannot be allowed to mean "unlimited" there.
 */
export const getEffectiveRequestsPerMinuteLimit: GetEffectiveRequestsPerMinuteLimitFunction =
  (policy: TelemetryIngestionKeyPolicy): number | null => {
    /*
     * An explicit limit wins for both key types, including a Server key: a
     * customer who deliberately set a ceiling on a server key asked for one
     * and should get it.
     */
    if (
      typeof policy.requestsPerMinuteLimit === "number" &&
      Number.isFinite(policy.requestsPerMinuteLimit) &&
      policy.requestsPerMinuteLimit > 0
    ) {
      return policy.requestsPerMinuteLimit;
    }

    if (policy.keyType === TelemetryIngestionKeyType.Browser) {
      return DEFAULT_BROWSER_KEY_REQUESTS_PER_MINUTE;
    }

    return null;
  };

type TelemetryIngestMiddlewareFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

export default class TelemetryIngest {
  /*
   * Build the ingest guard for one named surface.
   *
   * Every ingest route says which surface it is, and the guard answers
   * "may this key write here?" against BROWSER_ALLOWED_INGEST_SURFACES. That
   * is what stops a key scraped off a public page from being replayed into
   * profile / syslog / Fluent / Pyroscope / source-map / Kubernetes-cost /
   * change-event / security-event ingest, none of which any browser has
   * business calling.
   *
   * This returns a thin closure around a single @CaptureSpan-decorated
   * method rather than being decorated itself: a decorator on a factory would
   * open a span when the route table is built at boot, once, and never again
   * per request. Passing the surface as an argument keeps exactly one
   * decorated frame, on the function that actually handles a request.
   */
  public static forSurface(
    surface: TelemetryIngestSurface,
  ): TelemetryIngestMiddlewareFunction {
    return (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      return TelemetryIngest.authorizeIngestRequest(surface, req, res, next);
    };
  }

  /**
   * Backwards-compatible alias for call sites that have not been moved to
   * forSurface().
   *
   * It authorizes with NO named surface, which is treated as SERVER-ONLY: a
   * Browser key is refused here. That direction is deliberate. Routes are
   * being migrated to forSurface() one by one, and a route that is missed
   * must fail CLOSED - a missed browser-capable route is a public credential
   * reaching an endpoint nobody decided it should reach, whereas a missed
   * server-only route is a customer seeing "use a server ingestion key" and
   * filing a bug we can fix in a line. The default must never be the
   * permissive one.
   */
  public static async isAuthorizedServiceMiddleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    return TelemetryIngest.authorizeIngestRequest(null, req, res, next);
  }

  /*
   * The single decorated frame that does the work.
   *
   * `surface` is null only for the legacy alias above, and null means
   * "server-only, unnamed".
   */
  @CaptureSpan()
  private static async authorizeIngestRequest(
    surface: TelemetryIngestSurface | null,
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      // check header.

      let oneuptimeToken: string | undefined = req.headers[
        "x-oneuptime-token"
      ] as string | undefined;

      // if x-oneuptime-service-token header is present then use that as token.
      if (!oneuptimeToken) {
        oneuptimeToken = req.headers["x-oneuptime-service-token"] as
          | string
          | undefined;
      }

      // if x-oneuptime-ingestion-key header is present then use that as token.
      if (!oneuptimeToken) {
        oneuptimeToken = req.headers["x-oneuptime-ingestion-key"] as
          | string
          | undefined;
      }

      if (!oneuptimeToken) {
        logger.error(
          "Missing header: x-oneuptime-token",
          getLogAttributesFromRequest(req as any),
        );

        /*
         * 401 is deliberate: the OTLP spec classifies it as
         * non-retryable, so compliant SDKs / collectors surface the
         * error in their own logs instead of retry-storming. A silent
         * 200 here would make the client believe the data landed and
         * leave the user staring at empty dashboards with no clue why.
         */
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "Missing ingestion token. Send your OneUptime telemetry ingestion key in the x-oneuptime-token header.",
          ),
        );
      }

      /*
       * One lookup resolves everything the guard needs. The policy is NOT a
       * decision - a disabled or expired key still resolves - so that each
       * refusal below can say precisely why, rather than every failure mode
       * collapsing into an indistinguishable "invalid token".
       */
      const policy: TelemetryIngestionKeyPolicy | null =
        await TelemetryIngestionKeyService.getPolicyFromSecretKey(
          oneuptimeToken.toString(),
        );

      if (!policy) {
        /*
         * The token value itself is deliberately NOT logged: ingestion
         * keys are secrets, and a mistyped-but-nearly-valid token in a
         * log line is a credential leak. The request attributes give
         * operators enough to correlate with the sender.
         */
        logger.error(
          "Invalid service token.",
          getLogAttributesFromRequest(req as any),
        );

        /*
         * 401 is deliberate (see the missing-token branch above): a
         * silent 200 drops the payload while the client believes the
         * export succeeded.
         */
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "Invalid ingestion token. Send a valid OneUptime telemetry ingestion key in the x-oneuptime-token header.",
          ),
        );
      }

      /*
       * Kill switch, checked before anything else about the key, so that
       * turning a leaked key off is the one action guaranteed to stop it
       * regardless of which surface it is hitting or what its allowlist says.
       *
       * 403 rather than 401: the credential was recognised, it is simply not
       * permitted to write. That distinction is what lets a customer tell
       * "I pasted the wrong key" apart from "someone switched my key off",
       * which are very different Tuesday afternoons.
       */
      if (policy.isEnabled === false) {
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthorizedException(
            "This telemetry ingestion key has been disabled.",
          ),
        );
      }

      /*
       * Expiry. 401 here rather than 403 for the same reason as the branches
       * above: OTLP treats 401 as non-retryable, so a collector holding an
       * expired key logs the failure once instead of retry-storming an
       * endpoint that will never accept it again.
       *
       * The exact expiry timestamp is deliberately kept out of the response.
       * The caller has failed to authenticate; the key's configuration is
       * visible in the dashboard to the people actually entitled to it, and
       * there is no reason to hand details of a project's credentials to
       * whoever happens to be holding a dead one.
       */
      if (policy.expiresAt && policy.expiresAt.getTime() <= Date.now()) {
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "This telemetry ingestion key expired.",
          ),
        );
      }

      const isBrowserKey: boolean =
        policy.keyType === TelemetryIngestionKeyType.Browser;

      if (isBrowserKey) {
        /*
         * Surface allowlist. `surface === null` (the legacy alias) is not in
         * the set by construction, so an un-migrated route refuses browser
         * keys - see isAuthorizedServiceMiddleware for why that is the safe
         * direction.
         */
        const isSurfaceAllowedForBrowserKey: boolean =
          surface !== null && BROWSER_ALLOWED_INGEST_SURFACES.has(surface);

        if (!isSurfaceAllowedForBrowserKey) {
          const readableSurfaceName: string = surface
            ? getIngestSurfaceReadableName(surface)
            : UNNAMED_SURFACE_READABLE_NAME;

          return Response.sendErrorResponse(
            req,
            res,
            new NotAuthorizedException(
              `A browser ingestion key cannot be used for ${readableSurfaceName}. Use a server ingestion key.`,
            ),
          );
        }

        const originRefusalMessage: string | null =
          TelemetryIngest.getOriginRefusalMessage(req, policy);

        if (originRefusalMessage) {
          return Response.sendErrorResponse(
            req,
            res,
            new NotAuthorizedException(originRefusalMessage),
          );
        }
      }

      /*
       * Rate limit.
       *
       * A null effective limit means "no limit", and it short-circuits BEFORE
       * Redis is touched. That is why the limit is computed here rather than
       * left to the limiter: the overwhelmingly common case is an existing
       * Server key with no configured limit, and that path must pay literally
       * nothing - no client lookup, no round trip, no added latency on every
       * OTLP payload the product accepts. This feature is not allowed to make
       * today's ingest slower.
       */
      const effectiveLimitPerMinute: number | null =
        getEffectiveRequestsPerMinuteLimit(policy);

      if (effectiveLimitPerMinute !== null) {
        const decision: TelemetryIngestionKeyLimitDecision =
          await TelemetryIngestionKeyRateLimiter.consume({
            ingestionKeyId: policy.ingestionKeyId,
            limitPerMinute: effectiveLimitPerMinute,
          });

        if (
          decision.outcome === TelemetryIngestionKeyLimitOutcome.RateLimited
        ) {
          if (decision.retryAfterSeconds) {
            TelemetryIngest.setRetryAfterHeader(
              res,
              decision.retryAfterSeconds,
            );
          }

          /*
           * Log only the request that crossed the line. A rejected client
           * keeps knocking by definition, so logging every refusal turns an
           * ingest flood into a second flood in the log pipeline - which is
           * exactly what an operator does not need while trying to work out
           * WHICH key is being abused.
           */
          if (decision.isFirstRejectionInWindow) {
            logger.warn(
              `TelemetryIngest: ingestion key ${policy.ingestionKeyId.toString()} exceeded its limit of ${effectiveLimitPerMinute} requests per minute`,
            );
          }

          return Response.sendErrorResponse(
            req,
            res,
            new TooManyRequestsException(
              "Too many telemetry requests for this ingestion key. Please retry later.",
            ),
          );
        }

        if (
          decision.outcome ===
          TelemetryIngestionKeyLimitOutcome.CounterUnavailable
        ) {
          /*
           * FAIL OPEN. Redis is unreachable, so no ceiling can be honoured
           * either way, and we admit the request.
           *
           * This limit bounds ABUSE of a key that leaked; it is not a privacy
           * control and not a hard billing quota. Failing closed would stop
           * every paying customer's production telemetry for the length of a
           * Redis blip, and the gap is permanent because dropped spans are
           * never replayed - an infrastructure hiccup would become
           * customer-visible data loss, with the operator's incident
           * dashboards dark at exactly the wrong moment. Failing open hands
           * an attacker who already holds a scraped key an unbounded window
           * for the duration of the blip, while the origin allowlist, the
           * surface allowlist and the kill switch all still apply (they
           * resolve from Postgres, not Redis) and Redis being down is itself
           * alarmed on.
           *
           * SessionReplayRateLimiter makes the opposite call for the opposite
           * reason: a recording is a video of a real person, and accepting an
           * unbounded volume of that is not a recoverable mistake.
           */
          if (TelemetryIngest.shouldLogCounterUnavailable()) {
            logger.warn(
              "TelemetryIngest: ingestion key rate limit counter unavailable, admitting telemetry unthrottled",
            );
          }
        }
      }

      (req as TelemetryRequest).projectId = policy.projectId;
      (req as TelemetryRequest).ingestionKeyPolicy = policy;

      /*
       * Tag span with project context for telemetry ingestion observability.
       * Key type and surface are here because they are the two dimensions
       * this feature is judged on: "are browser keys actually being used, and
       * where" is unanswerable without them, and they turn "refusal rate by
       * key type" into a one-line query.
       */
      SpanUtil.addAttributesToCurrentSpan({
        projectId: policy.projectId.toString(),
        telemetryIngestionKeyType: policy.keyType,
        telemetryIngestSurface: surface ? surface.toString() : "unspecified",
      });

      /*
       * Fire and forget: lastUsedAt is bookkeeping for the dashboard, and the
       * service already throttles the write and swallows its own errors.
       * Awaiting it would put a database write on the hot path of every
       * ingested payload for a column nobody reads in real time. The .catch
       * is belt and braces so a rejection can never surface as an unhandled
       * rejection.
       */
      TelemetryIngestionKeyService.markUsed(policy.ingestionKeyId).catch(
        (err: unknown) => {
          logger.warn(
            `TelemetryIngest: failed to record last used for ingestion key ${policy.ingestionKeyId.toString()}`,
          );
          logger.warn(err);
        },
      );

      next();
    } catch (err) {
      /*
       * Record on THIS middleware's own @CaptureSpan span before handing the
       * error to Express. The decorator sees a normal return (we call
       * next(err) rather than rethrowing — Express 4 does not catch a
       * rejection from an async middleware), so its recorder never runs and
       * without this the error is invisible on the span it actually belongs
       * to. Goes through SpanUtil so the event is typed by class name rather
       * than by HTTP status, and so a rejected credential produces a `fault`
       * event instead of an Issue.
       */
      SpanUtil.recordExceptionOnCurrentSpan(err);
      return next(err);
    }
  }

  /*
   * Origin enforcement for a Browser key. Returns the refusal message, or
   * null when the request may proceed.
   *
   * NOTE THE DELIBERATE ASYMMETRY WITH SessionReplayGateCache: there an empty
   * allowlist means "any origin", because session replay shipped that way and
   * tightening it would break live installations. Here an empty allowlist
   * REFUSES. A browser key is only safe to publish in a page because the
   * allowlist exists - it is the one thing standing between "a credential
   * anyone can read" and "a credential anyone can use" - so reading "no
   * allowlist" as "any origin" would hand out precisely the unbounded public
   * write key this whole feature exists to eliminate. Empty must fail closed.
   *
   * TelemetryIngestionKeyService refuses to create or update a Browser key
   * with an empty allowlist, so for keys created after this ships the branch
   * is unreachable; it is here for rows that predate it and for anything that
   * writes the table without going through the service.
   *
   * AND BE HONEST ABOUT WHAT THIS BUYS: Origin is a browser-enforced header.
   * A browser will not let page JavaScript forge it, which is what makes it
   * meaningful against the actual threat here - someone lifting a key out of
   * one site's page source and using it from another site. A non-browser
   * client (curl, a script, a proxy) sets any Origin it likes, so this stops
   * casual key reuse and nothing more. What actually contains a determined
   * attacker is the rest of the set: the per-key rate limit bounds the
   * volume, the pinned service.name stops forged data masquerading as backend
   * telemetry, and the kill switch ends it outright.
   */
  private static getOriginRefusalMessage(
    req: ExpressRequest,
    policy: TelemetryIngestionKeyPolicy,
  ): string | null {
    const origin: string | undefined = headerValueToString(
      req.headers["origin"],
    );

    if (!origin) {
      /*
       * Say the header is missing rather than echoing an empty string into
       * the message - "Origin  is not allowed" reads like a bug and tells the
       * customer nothing about what to fix.
       */
      return "This request did not send an Origin header, so it cannot be checked against the allowed origins of this browser ingestion key. Use a server ingestion key for requests that are not sent by a browser.";
    }

    if (
      policy.allowedOrigins.length === 0 ||
      !OriginAllowList.matches(origin, policy.allowedOrigins)
    ) {
      /*
       * The origin is echoed back on purpose. It is the caller's own value,
       * never a secret, and it is the single most useful thing a customer can
       * be told while debugging an allowlist - the usual cause is a scheme,
       * port or trailing-slash mismatch that stays invisible until the two
       * strings are put side by side.
       */
      return `Origin ${origin} is not allowed for this browser ingestion key.`;
    }

    return null;
  }

  private static counterUnavailableLastLoggedAt: number = 0;

  private static shouldLogCounterUnavailable(): boolean {
    const now: number = Date.now();

    if (
      now - TelemetryIngest.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return false;
    }

    TelemetryIngest.counterUnavailableLastLoggedAt = now;

    return true;
  }

  /*
   * Reached through a runtime check because the response object is not always
   * a real Express response - unit tests hand this middleware a bare object -
   * and a missing header on a 429 is a far better outcome than a TypeError
   * that turns a deliberate refusal into a 500. Same helper as
   * PublicDashboardRateLimit.
   */
  private static setRetryAfterHeader(
    res: ExpressResponse,
    retryAfterSeconds: number,
  ): void {
    const setHeader: unknown = (res as unknown as Record<string, unknown>)[
      "setHeader"
    ];

    if (typeof setHeader === "function") {
      (setHeader as (name: string, value: string) => void).call(
        res,
        "Retry-After",
        String(retryAfterSeconds),
      );
    }
  }
}
