import Redis, { ClientType } from "../Infrastructure/Redis";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../Utils/ClientIp";
import Response from "../Utils/Response";
import ObjectID from "../../Types/ObjectID";
import ServiceUnavailableException from "../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";

/*
 * Rate limiting for the anonymous public dashboard surface — every route
 * Nginx exposes under /public-dashboard-api (rewritten to /api/dashboard
 * before it reaches this process, so the prefix is not visible here; the
 * routes themselves are the surface).
 *
 * Why this exists: holding a public dashboard id was previously enough to
 * drive unbounded ClickHouse and Postgres work — a 400-day SLO-style
 * aggregation, or a metrics aggregation at the finest bucket interval,
 * issued in a loop. /master-password was worse still: it verifies a bcrypt
 * hash per request, so with no attempt limit it is an online
 * password-guessing oracle that also burns a CPU-bound hash per guess.
 *
 * One limiter covers the whole surface rather than per-route budgets. The
 * routes differ enormously in cost, but the thing being bounded is request
 * volume from a single origin, and a uniform ceiling is the one an operator
 * can reason about. Only /master-password gets its own, much tighter bucket,
 * because it is the one route where the abuse is guessing rather than load.
 */

/*
 * Every request consumes TWO counters, and either one can reject it:
 *
 *  - the dashboard counter, keyed on dashboard id + client IP. This is the
 *    budget an individual viewer of an individual dashboard gets.
 *
 *  - the IP counter, keyed on client IP alone. Without this the dashboard
 *    counter is trivially bypassed: an attacker rotates the dashboard id on
 *    every request, lands in a fresh bucket every time, and still costs us a
 *    Postgres lookup per request even when every id is a 404. The IP counter
 *    is the ceiling that survives id rotation.
 *
 * Both are incremented on every request including a rejected one. That is
 * standard fixed-window behaviour and it is deliberate: a client that keeps
 * hammering keeps its window pinned rather than being handed a fresh
 * allowance for free.
 */
export enum PublicDashboardRateLimitScope {
  Dashboard = "dashboard",
  Ip = "ip",
}

export enum PublicDashboardRateLimitBucket {
  /* Every public dashboard read route. */
  Read = "read",

  /* /master-password only. Tighter, because each request costs a bcrypt. */
  MasterPassword = "master-password",
}

export enum PublicDashboardRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  /* Redis is unreachable, so no limit can be honoured either way. */
  CounterUnavailable = "counter-unavailable",
}

export interface PublicDashboardRateLimitDecision {
  outcome: PublicDashboardRateLimitOutcome;
  retryAfterSeconds?: number | undefined;

  /* Which of the two counters rejected, for logs. Unset unless rejected. */
  scope?: PublicDashboardRateLimitScope | undefined;

  /*
   * True only on the request that first crossed the line in this window.
   *
   * The point of a limiter is that the caller keeps knocking, so logging
   * every refusal turns a flood into a second flood in the log pipeline —
   * the tool an operator needs to see the first one. Logging only the
   * crossing gives exactly one line per key per window.
   */
  isFirstRejectionInWindow?: boolean | undefined;
}

const parsePositiveIntFromEnv: (envKey: string, fallback: number) => number = (
  envKey: string,
  fallback: number,
): number => {
  const rawValue: string | undefined = process.env[envKey];

  if (!rawValue) {
    return fallback;
  }

  const parsedValue: number = parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return fallback;
  }

  return parsedValue;
};

interface BucketConfig {
  windowSeconds: number;
  perDashboardLimit: number;
  perIpLimit: number;
}

/*
 * Read budget.
 *
 * Sized against the worst LEGITIMATE case rather than the typical one,
 * because the key is dashboard + address and a great many viewers share one
 * address. A public dashboard is often left open on office wall displays that
 * auto-refresh: 40 widgets refreshing every 30s is ~80 requests/minute per
 * display, and several displays plus ordinary viewers behind one corporate
 * NAT all land in the same bucket. 600/minute covers roughly seven such
 * displays at once.
 *
 * A limiter that fires on real viewers is worse than a slightly generous one,
 * because the operator's fix is to turn it off. The number that matters is
 * that "as fast as the attacker's loop runs" becomes a fixed ceiling at all —
 * 600 versus the tens of thousands a loop manages — and operators who want it
 * tighter have the environment variables below.
 */
const READ_BUCKET: BucketConfig = {
  windowSeconds: parsePositiveIntFromEnv(
    "PUBLIC_DASHBOARD_RATE_LIMIT_WINDOW_SECONDS",
    60,
  ),
  perDashboardLimit: parsePositiveIntFromEnv(
    "PUBLIC_DASHBOARD_RATE_LIMIT_PER_DASHBOARD_PER_WINDOW",
    600,
  ),
  perIpLimit: parsePositiveIntFromEnv(
    "PUBLIC_DASHBOARD_RATE_LIMIT_PER_IP_PER_WINDOW",
    1800,
  ),
};

/*
 * Master password budget. This is an authentication attempt counter, not a
 * load control, so it is sized for humans rather than for load: 15 tries per
 * 15 minutes covers a team behind one office address each mistyping a shared
 * password, and still takes guessing from roughly 600 attempts a minute (what
 * a bcrypt verify allows unthrottled) down to one a minute.
 */
const MASTER_PASSWORD_BUCKET: BucketConfig = {
  windowSeconds: parsePositiveIntFromEnv(
    "PUBLIC_DASHBOARD_MASTER_PASSWORD_RATE_LIMIT_WINDOW_SECONDS",
    15 * 60,
  ),
  perDashboardLimit: parsePositiveIntFromEnv(
    "PUBLIC_DASHBOARD_MASTER_PASSWORD_RATE_LIMIT_PER_DASHBOARD_PER_WINDOW",
    15,
  ),
  perIpLimit: parsePositiveIntFromEnv(
    "PUBLIC_DASHBOARD_MASTER_PASSWORD_RATE_LIMIT_PER_IP_PER_WINDOW",
    45,
  ),
};

const KEY_PREFIX: string = "pdash:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

/* Bounds a Redis key built from attacker-supplied path segments. */
const MAX_KEY_SEGMENT_LENGTH: number = 64;

/* How often the "counter unavailable" condition may be logged, per bucket. */
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

const DOMAIN_PATTERN: RegExp =
  /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const MAX_DOMAIN_LENGTH: number = 253;

export default class PublicDashboardRateLimit {
  /*
   * The client address to bill this request to.
   *
   * Delegates to the shared ClientIp helper, which reads X-Forwarded-For from
   * the trusted (right-hand) end under the instance-wide TRUSTED_PROXY_HOPS
   * setting. Deliberately NOT Express.getClientIp: that one takes the LEFTMOST
   * entry, which any caller can set by sending its own X-Forwarded-For header,
   * and for a rate limiter that is fatal — a fresh spoofed value per request
   * means a fresh bucket per request and no limit at all.
   *
   * Sharing the helper matters beyond deduplication. This limiter and the
   * dashboard/status page IP allowlists must agree on who the caller is: a
   * deployment behind an extra load balancer sets TRUSTED_PROXY_HOPS once, and
   * if this middleware kept its own knob an operator who set the shared one
   * would silently leave the limiter reading the balancer's address instead of
   * the viewer's — collapsing every viewer behind that balancer into a single
   * bucket and refusing them all.
   *
   * The helper also normalizes ports, brackets and IPv4-mapped IPv6, so the
   * same viewer cannot land in two different buckets depending on the form
   * their address arrives in.
   */
  public static resolveClientIp(req: ExpressRequest): string {
    const clientIp: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (clientIp) {
      return PublicDashboardRateLimit.sanitizeKeySegment(clientIp);
    }

    /*
     * No address at all. Everything in this state shares one bucket, which
     * is the conservative direction — an unidentifiable caller should not
     * get its own private allowance.
     */
    return "unknown";
  }

  /*
   * The dashboard this request is about, as a key segment.
   *
   * Routes name the parameter differently (:dashboardId on most,
   * :dashboardIdOrDomain on /overview and /seo) and /domain carries it in the
   * body instead, so all three are checked.
   *
   * Anything that is neither a valid id nor a plausible domain collapses to
   * a single "invalid" bucket. That bounds Redis memory against a caller
   * feeding junk path segments, and it is the right grouping anyway: those
   * requests cannot correspond to a real dashboard, so sharing one small
   * allowance between all of them is exactly what we want.
   *
   * Known and accepted: a dashboard reachable both by id and by custom domain
   * has two keys, so a caller alternating the two forms gets twice the
   * per-dashboard allowance. Resolving the domain to its id here would mean a
   * database lookup on every request — the exact cost this middleware exists
   * to avoid paying before the limit is checked — and the per-address ceiling
   * below already bounds the total either way.
   */
  public static resolveDashboardKey(req: ExpressRequest): string {
    const candidates: Array<unknown> = [
      req.params?.["dashboardId"],
      req.params?.["dashboardIdOrDomain"],
      (req.body as Record<string, unknown> | undefined)?.["domain"],
    ];

    const raw: string | undefined = candidates.find(
      (candidate: unknown): candidate is string => {
        return typeof candidate === "string" && candidate.trim().length > 0;
      },
    );

    if (!raw) {
      return "none";
    }

    const value: string = raw.trim();

    if (ObjectID.isValidUUID(value)) {
      return `id:${value.toLowerCase()}`;
    }

    if (value.length <= MAX_DOMAIN_LENGTH && DOMAIN_PATTERN.test(value)) {
      return `dom:${value.toLowerCase()}`;
    }

    return "invalid";
  }

  private static sanitizeKeySegment(value: string): string {
    return (
      value
        .slice(0, MAX_KEY_SEGMENT_LENGTH)
        /*
         * Redis keys are binary safe, but a predictable charset keeps
         * operational tooling (KEYS/SCAN patterns, dashboards) sane.
         */
        .replace(/[^a-zA-Z0-9._:%\-[\]]/g, "_")
    );
  }

  private static getBucketConfig(
    bucket: PublicDashboardRateLimitBucket,
  ): BucketConfig {
    return bucket === PublicDashboardRateLimitBucket.MasterPassword
      ? MASTER_PASSWORD_BUCKET
      : READ_BUCKET;
  }

  /*
   * Increment both counters for this request and decide.
   *
   * Both INCRs go out in one pipeline so the common path costs a single
   * round trip; the EXPIRE follow-ups only happen on the request that
   * created a key.
   */
  public static async consume(data: {
    dashboardKey: string;
    clientIp: string;
    bucket: PublicDashboardRateLimitBucket;
  }): Promise<PublicDashboardRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: PublicDashboardRateLimitOutcome.CounterUnavailable };
    }

    const config: BucketConfig = PublicDashboardRateLimit.getBucketConfig(
      data.bucket,
    );

    const windowMs: number = config.windowSeconds * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);

    const dashboardCounterKey: string = `${KEY_PREFIX}${data.bucket}:d:${data.dashboardKey}:${data.clientIp}:${windowIndex}`;
    const ipCounterKey: string = `${KEY_PREFIX}${data.bucket}:i:${data.clientIp}:${windowIndex}`;

    try {
      const pipelineResults: Array<[Error | null, unknown]> | null =
        (await client
          .pipeline()
          .incr(dashboardCounterKey)
          .incr(ipCounterKey)
          .exec()) as Array<[Error | null, unknown]> | null;

      if (!pipelineResults || pipelineResults.length < 2) {
        throw new Error("Rate limit pipeline returned no result");
      }

      const dashboardCount: number = PublicDashboardRateLimit.readCounterResult(
        pipelineResults[0],
      );
      const ipCount: number = PublicDashboardRateLimit.readCounterResult(
        pipelineResults[1],
      );

      /*
       * Set the expiry only on the write that created the key. Re-issuing
       * EXPIRE on every increment would slide the window forward for as long
       * as the load continues, so the counter would never reset and a client
       * that tripped the limit once could never recover.
       */
      const ttlSeconds: number = config.windowSeconds * TTL_MULTIPLIER;
      const keysToExpire: Array<string> = [];

      if (dashboardCount === 1) {
        keysToExpire.push(dashboardCounterKey);
      }

      if (ipCount === 1) {
        keysToExpire.push(ipCounterKey);
      }

      if (keysToExpire.length > 0) {
        const expirePipeline: ReturnType<ClientType["pipeline"]> =
          client.pipeline();

        for (const key of keysToExpire) {
          expirePipeline.expire(key, ttlSeconds);
        }

        await expirePipeline.exec();
      }

      const retryAfterSeconds: number =
        PublicDashboardRateLimit.getSecondsUntilWindowEnd(config.windowSeconds);

      /*
       * Dashboard counter is reported first when both are over, because it is
       * the more specific of the two and the more useful thing to see in a log
       * line.
       */
      if (dashboardCount > config.perDashboardLimit) {
        return {
          outcome: PublicDashboardRateLimitOutcome.RateLimited,
          retryAfterSeconds,
          scope: PublicDashboardRateLimitScope.Dashboard,
          isFirstRejectionInWindow:
            dashboardCount === config.perDashboardLimit + 1,
        };
      }

      if (ipCount > config.perIpLimit) {
        return {
          outcome: PublicDashboardRateLimitOutcome.RateLimited,
          retryAfterSeconds,
          scope: PublicDashboardRateLimitScope.Ip,
          isFirstRejectionInWindow: ipCount === config.perIpLimit + 1,
        };
      }

      return { outcome: PublicDashboardRateLimitOutcome.Allowed };
    } catch (err) {
      /*
       * Throttled for the same reason as the middleware's unavailable branch:
       * whatever broke Redis is unlikely to break it for one request only, and
       * a per-request log line buries the incident it is reporting.
       */
      if (PublicDashboardRateLimit.shouldLogCounterUnavailable(data.bucket)) {
        logger.warn(
          `PublicDashboardRateLimit: counter failed for ${data.dashboardKey}`,
        );
        logger.warn(err);
      }

      return { outcome: PublicDashboardRateLimitOutcome.CounterUnavailable };
    }
  }

  private static readCounterResult(
    result: [Error | null, unknown] | undefined,
  ): number {
    if (!result) {
      throw new Error("Rate limit counter returned no result");
    }

    const [error, value] = result;

    if (error) {
      throw error;
    }

    if (typeof value !== "number") {
      throw new Error("Rate limit counter returned a non-numeric value");
    }

    return value;
  }

  /*
   * Remaining seconds in the current fixed window, so every rejected caller
   * is told to come back when the window actually rolls rather than all
   * backing off by the same constant and re-colliding.
   */
  private static getSecondsUntilWindowEnd(windowSeconds: number): number {
    const windowMs: number = windowSeconds * 1000;
    const msIntoWindow: number = Date.now() % windowMs;

    return Math.max(1, Math.ceil((windowMs - msIntoWindow) / 1000));
  }

  /*
   * Express middleware. Registered ahead of UserMiddleware on every public
   * dashboard route so a flood is rejected before it costs a session lookup,
   * let alone a database read.
   */
  public static getMiddleware(
    bucket: PublicDashboardRateLimitBucket = PublicDashboardRateLimitBucket.Read,
  ): (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> {
    return async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      const dashboardKey: string =
        PublicDashboardRateLimit.resolveDashboardKey(req);
      const clientIp: string = PublicDashboardRateLimit.resolveClientIp(req);

      const decision: PublicDashboardRateLimitDecision =
        await PublicDashboardRateLimit.consume({
          dashboardKey,
          clientIp,
          bucket,
        });

      if (decision.outcome === PublicDashboardRateLimitOutcome.RateLimited) {
        if (decision.retryAfterSeconds) {
          PublicDashboardRateLimit.setRetryAfterHeader(
            res,
            decision.retryAfterSeconds,
          );
        }

        if (decision.isFirstRejectionInWindow) {
          logger.warn(
            `PublicDashboardRateLimit: rejected ${bucket} request for ${dashboardKey} from ${clientIp} (${decision.scope} limit)`,
          );
        }

        return Response.sendErrorResponse(
          req,
          res,
          new TooManyRequestsException(
            bucket === PublicDashboardRateLimitBucket.MasterPassword
              ? "Too many password attempts. Please try again later."
              : "Too many requests. Please try again later.",
          ),
        );
      }

      if (
        decision.outcome === PublicDashboardRateLimitOutcome.CounterUnavailable
      ) {
        /*
         * The two buckets fail in opposite directions, on purpose.
         *
         * Reads fail OPEN. These are unauthenticated read-only endpoints and
         * the counter is a load control; blacking out every customer's public
         * dashboard because Redis blipped is a worse outcome than an
         * unbounded window for the duration of that blip, which is itself
         * alarmed on.
         *
         * /master-password fails CLOSED. There the counter is not a load
         * control, it is the only thing bounding password guesses. Serving
         * the endpoint without it means serving an unlimited guessing oracle,
         * so we answer 503 and let the viewer retry when Redis is back.
         */
        if (bucket === PublicDashboardRateLimitBucket.MasterPassword) {
          if (PublicDashboardRateLimit.shouldLogCounterUnavailable(bucket)) {
            logger.error(
              `PublicDashboardRateLimit: rate limit counter unavailable, refusing master password attempts for ${dashboardKey}`,
            );
          }

          return Response.sendErrorResponse(
            req,
            res,
            new ServiceUnavailableException(
              "Unable to verify the password right now. Please try again shortly.",
            ),
          );
        }

        if (PublicDashboardRateLimit.shouldLogCounterUnavailable(bucket)) {
          logger.warn(
            "PublicDashboardRateLimit: rate limit counter unavailable, allowing public dashboard reads unthrottled",
          );
          logger.warn(getLogAttributesFromRequest(req as OneUptimeRequest));
        }
      }

      return next();
    };
  }

  /*
   * A Redis outage means EVERY request takes the unavailable path, so an
   * unguarded log line there is one per request for as long as the outage
   * lasts — the same log-flooding problem the crossing-only rejection log
   * avoids, but continuous. One line per bucket per interval is enough to
   * make the condition visible without burying everything else.
   */
  private static shouldLogCounterUnavailable(
    bucket: PublicDashboardRateLimitBucket,
  ): boolean {
    const now: number = Date.now();
    const lastLoggedAt: number =
      PublicDashboardRateLimit.counterUnavailableLastLoggedAt.get(bucket) || 0;

    if (now - lastLoggedAt < COUNTER_UNAVAILABLE_LOG_INTERVAL_MS) {
      return false;
    }

    PublicDashboardRateLimit.counterUnavailableLastLoggedAt.set(bucket, now);

    return true;
  }

  private static counterUnavailableLastLoggedAt: Map<
    PublicDashboardRateLimitBucket,
    number
  > = new Map();

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
