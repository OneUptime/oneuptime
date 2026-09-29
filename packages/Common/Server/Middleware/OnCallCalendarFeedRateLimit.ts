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
import {
  OnCallCalendarFeedRateLimitPerIpPerWindow,
  OnCallCalendarFeedRateLimitPerTokenPerWindow,
  OnCallCalendarFeedRateLimitWindowSeconds,
} from "../EnvironmentConfig";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import { createHash } from "crypto";

/*
 * Rate limiting for the public on-call calendar feed routes:
 *
 *   GET /api/on-call-calendar/user/:token/shifts.ics
 *   GET /api/on-call-calendar/schedule/:token/schedule.ics
 *   GET /api/on-call-calendar/project/:token/project.ics
 *
 * These are polled by calendar clients (Google, Outlook, Apple) with no session
 * and no API key -- the token in the path is the whole credential -- so there
 * is nothing else in front of them that bounds request volume. Rendering a
 * feed expands every layer of every candidate schedule across up to 180 days,
 * which is exactly the kind of work an unbounded anonymous route must not be
 * allowed to drive in a loop.
 *
 * A sibling of PublicDashboardRateLimit rather than a reuse of it: that class
 * derives its key from dashboard ids and domains, and the one thing that must
 * be different here is that the key is derived from a SECRET. It is never used
 * raw -- not in a Redis key, not in a log line -- see resolveTokenKey.
 */

/*
 * Every request consumes TWO counters, and either one can reject it:
 *
 *  - the token counter, keyed on a hash of the token + client address. This is
 *    the budget one subscribed calendar gets. Default 60 per minute: Apple
 *    Calendar's most eager setting is one poll every five minutes, so a real
 *    client never comes near it, and a whole office of clients behind one NAT
 *    all polling the same shared team link still has headroom.
 *
 *  - the address counter, keyed on client address alone. Without it the token
 *    counter is trivially bypassed by rotating tokens: every guess lands in a
 *    fresh bucket and still costs a Postgres lookup even though it is a 404.
 *    Default 3000 per minute is the ceiling that survives rotation.
 *
 * Both are incremented on every request including a rejected one, so a client
 * that keeps hammering keeps its window pinned rather than being handed a
 * fresh allowance for free.
 */
export enum OnCallCalendarFeedRateLimitScope {
  Token = "token",
  Ip = "ip",
}

export enum OnCallCalendarFeedRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  /* Redis is unreachable, so no limit can be honoured either way. */
  CounterUnavailable = "counter-unavailable",
}

export interface OnCallCalendarFeedRateLimitDecision {
  outcome: OnCallCalendarFeedRateLimitOutcome;
  retryAfterSeconds?: number | undefined;

  /* Which of the two counters rejected, for logs. Unset unless rejected. */
  scope?: OnCallCalendarFeedRateLimitScope | undefined;

  /*
   * True only on the request that first crossed the line in this window, so
   * the middleware logs one line per key per window rather than turning a
   * flood into a second flood in the log pipeline.
   */
  isFirstRejectionInWindow?: boolean | undefined;
}

export interface OnCallCalendarFeedRateLimitConfig {
  windowSeconds: number;
  perTokenLimit: number;
  perIpLimit: number;
}

/*
 * The token shape the feed routes accept: 32 random bytes as base64url, which
 * is always exactly 43 characters. Anything else is not a token that could
 * exist and shares one small "invalid" bucket (see resolveTokenKey).
 */
export const ON_CALL_CALENDAR_FEED_TOKEN_PATTERN: RegExp =
  /^[A-Za-z0-9_-]{43}$/;

const KEY_PREFIX: string = "oncal:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

/* Bounds a Redis key built from attacker-supplied path segments. */
const MAX_KEY_SEGMENT_LENGTH: number = 64;

/*
 * How much of the token hash goes into the Redis key. 16 hex characters is 64
 * bits -- far more than enough to keep distinct tokens in distinct buckets --
 * and short enough that a KEYS/SCAN listing stays readable.
 */
const TOKEN_KEY_HASH_LENGTH: number = 16;

/* How often the "counter unavailable" condition may be logged. */
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export default class OnCallCalendarFeedRateLimit {
  private static readonly config: OnCallCalendarFeedRateLimitConfig = {
    windowSeconds: OnCallCalendarFeedRateLimitWindowSeconds,
    perTokenLimit: OnCallCalendarFeedRateLimitPerTokenPerWindow,
    perIpLimit: OnCallCalendarFeedRateLimitPerIpPerWindow,
  };

  private static counterUnavailableLastLoggedAt: number = 0;

  /* The limits in force, for tests and for operators' diagnostics. */
  public static getConfig(): OnCallCalendarFeedRateLimitConfig {
    return { ...OnCallCalendarFeedRateLimit.config };
  }

  /*
   * The client address to bill this request to.
   *
   * Delegates to the shared ClientIp helper, which reads X-Forwarded-For from
   * the trusted (right-hand) end under the instance-wide TRUSTED_PROXY_HOPS
   * setting. Deliberately NOT Express.getClientIp: that takes the LEFTMOST
   * entry, which any caller can set by sending its own X-Forwarded-For header,
   * and for a rate limiter that is fatal -- a fresh spoofed value per request
   * means a fresh bucket per request and no limit at all.
   */
  public static resolveClientIp(req: ExpressRequest): string {
    const clientIp: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (clientIp) {
      return OnCallCalendarFeedRateLimit.sanitizeKeySegment(clientIp);
    }

    /*
     * No address at all. Everything in this state shares one bucket, which is
     * the conservative direction -- an unidentifiable caller should not get its
     * own private allowance.
     */
    return "unknown";
  }

  /*
   * The token this request presents, as a key segment that is NOT the token.
   *
   * The token is a bearer credential. Redis keys show up in KEYS/SCAN output,
   * in monitoring dashboards and in Redis's own slow log, so a raw token in a
   * key is a token written down somewhere it was never meant to be. The key
   * therefore carries a truncated SHA-256 of it: enough bits to keep distinct
   * tokens apart, no way back to the token.
   *
   * The hash is unkeyed on purpose. This is a rate-limit bucket name, not the
   * stored lookup hash the feed row is found by (that one is a full SHA-256 and
   * lives in Postgres); 64 bits of a preimage-resistant hash of 256 bits of
   * randomness is not a useful oracle for anything.
   *
   * Anything that is not shaped like a token collapses into one shared
   * "invalid" bucket. It cannot correspond to a real feed, so a small shared
   * allowance between all such requests is the right grouping, and it bounds
   * Redis memory against a caller feeding junk path segments.
   */
  public static resolveTokenKey(req: ExpressRequest): string {
    const raw: unknown = req.params?.["token"];

    if (typeof raw !== "string") {
      return "none";
    }

    const value: string = raw.trim();

    if (!value) {
      return "none";
    }

    if (!ON_CALL_CALENDAR_FEED_TOKEN_PATTERN.test(value)) {
      return "invalid";
    }

    return OnCallCalendarFeedRateLimit.hashToken(value);
  }

  /*
   * Bucket segment for a token the caller already validated. Exposed so a
   * route that has the token in hand (or a test) can build the same key the
   * middleware does.
   */
  public static hashToken(token: string): string {
    return `t:${createHash("sha256")
      .update(token, "utf8")
      .digest("hex")
      .slice(0, TOKEN_KEY_HASH_LENGTH)}`;
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

  /*
   * Increment both counters for this request and decide.
   *
   * Both INCRs go out in one pipeline so the common path costs a single round
   * trip; the EXPIRE follow-ups only happen on the request that created a key.
   */
  public static async consume(data: {
    tokenKey: string;
    clientIp: string;
  }): Promise<OnCallCalendarFeedRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return {
        outcome: OnCallCalendarFeedRateLimitOutcome.CounterUnavailable,
      };
    }

    const config: OnCallCalendarFeedRateLimitConfig =
      OnCallCalendarFeedRateLimit.config;

    const windowMs: number = config.windowSeconds * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);

    const tokenCounterKey: string = `${KEY_PREFIX}t:${data.tokenKey}:${data.clientIp}:${windowIndex}`;
    const ipCounterKey: string = `${KEY_PREFIX}i:${data.clientIp}:${windowIndex}`;

    try {
      const pipelineResults: Array<[Error | null, unknown]> | null =
        (await client
          .pipeline()
          .incr(tokenCounterKey)
          .incr(ipCounterKey)
          .exec()) as Array<[Error | null, unknown]> | null;

      if (!pipelineResults || pipelineResults.length < 2) {
        throw new Error("Rate limit pipeline returned no result");
      }

      const tokenCount: number = OnCallCalendarFeedRateLimit.readCounterResult(
        pipelineResults[0],
      );
      const ipCount: number = OnCallCalendarFeedRateLimit.readCounterResult(
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

      if (tokenCount === 1) {
        keysToExpire.push(tokenCounterKey);
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
        OnCallCalendarFeedRateLimit.getSecondsUntilWindowEnd(
          config.windowSeconds,
        );

      /*
       * Token counter is reported first when both are over: it is the more
       * specific of the two and the more useful thing to see in a log line.
       */
      if (tokenCount > config.perTokenLimit) {
        return {
          outcome: OnCallCalendarFeedRateLimitOutcome.RateLimited,
          retryAfterSeconds,
          scope: OnCallCalendarFeedRateLimitScope.Token,
          isFirstRejectionInWindow: tokenCount === config.perTokenLimit + 1,
        };
      }

      if (ipCount > config.perIpLimit) {
        return {
          outcome: OnCallCalendarFeedRateLimitOutcome.RateLimited,
          retryAfterSeconds,
          scope: OnCallCalendarFeedRateLimitScope.Ip,
          isFirstRejectionInWindow: ipCount === config.perIpLimit + 1,
        };
      }

      return { outcome: OnCallCalendarFeedRateLimitOutcome.Allowed };
    } catch (err) {
      /*
       * Throttled: whatever broke Redis is unlikely to break it for one
       * request only, and a per-request log line buries the incident it is
       * reporting. The log names neither the token nor its hash.
       */
      if (OnCallCalendarFeedRateLimit.shouldLogCounterUnavailable()) {
        logger.warn(
          `OnCallCalendarFeedRateLimit: counter failed for a request from ${data.clientIp}`,
        );
        logger.warn(err);
      }

      return {
        outcome: OnCallCalendarFeedRateLimitOutcome.CounterUnavailable,
      };
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
   * Express middleware. Mounted on each feed route (it reads `:token` from
   * req.params, so it must sit on the route, not on the router) ahead of the
   * token lookup, so a flood is refused before it costs a Postgres read, let
   * alone a render.
   *
   * FAILS OPEN. When Redis is unreachable every request is let through and
   * the condition is logged (throttled). The limiter is load control: the
   * token is still checked by the route behind it, and blacking out every
   * subscribed calendar over a Redis blip -- clients that get a 503 keep the
   * copy they have, but one that gets it repeatedly may drop the calendar --
   * is a worse outcome than an unbounded window for the duration of the blip.
   */
  public static getMiddleware(): (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> {
    return async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      const tokenKey: string = OnCallCalendarFeedRateLimit.resolveTokenKey(req);
      const clientIp: string = OnCallCalendarFeedRateLimit.resolveClientIp(req);

      const decision: OnCallCalendarFeedRateLimitDecision =
        await OnCallCalendarFeedRateLimit.consume({ tokenKey, clientIp });

      if (decision.outcome === OnCallCalendarFeedRateLimitOutcome.RateLimited) {
        if (decision.retryAfterSeconds) {
          OnCallCalendarFeedRateLimit.setRetryAfterHeader(
            res,
            decision.retryAfterSeconds,
          );
        }

        /*
         * The crossing request only, and never the token or its hash: an
         * operator needs to know an address is hammering the feeds, not which
         * feed. The route's own attributes (requestId, no token) are enough to
         * correlate.
         */
        if (decision.isFirstRejectionInWindow) {
          logger.warn(
            `OnCallCalendarFeedRateLimit: rejected calendar feed request from ${clientIp} (${decision.scope} limit)`,
          );
        }

        return Response.sendErrorResponse(
          req,
          res,
          new TooManyRequestsException(
            "Too many requests. Please try again later.",
          ),
        );
      }

      if (
        decision.outcome ===
        OnCallCalendarFeedRateLimitOutcome.CounterUnavailable
      ) {
        if (OnCallCalendarFeedRateLimit.shouldLogCounterUnavailable()) {
          logger.warn(
            "OnCallCalendarFeedRateLimit: rate limit counter unavailable, allowing calendar feed requests unthrottled",
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
   * lasts. One line per interval is enough to make the condition visible.
   */
  private static shouldLogCounterUnavailable(): boolean {
    const now: number = Date.now();

    if (
      now - OnCallCalendarFeedRateLimit.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return false;
    }

    OnCallCalendarFeedRateLimit.counterUnavailableLastLoggedAt = now;

    return true;
  }

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
