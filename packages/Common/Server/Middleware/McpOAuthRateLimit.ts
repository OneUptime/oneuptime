import Redis, { ClientType } from "../Infrastructure/Redis";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../Utils/ClientIp";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";

/*
 * Rate limiting for the MCP authorization server's endpoints
 * (/mcp/oauth/...).
 *
 * All of them answer callers nobody has identified yet, and each can be made
 * to do something on request: registration writes a row, authorization can
 * trigger an outbound fetch of a client metadata document, the token and
 * revocation endpoints look a secret up, the consent endpoints read a
 * member's projects. None of the secrets involved can be guessed - they are
 * 256 bits - so this is load control, not the thing standing between an
 * attacker and a token.
 *
 * One fixed-window counter per bucket per client address, the shape the
 * on-call calendar feed limiter uses. The budgets are fixed rather than
 * configurable: they are sized so that no real client comes near them even
 * with a whole office behind one address (a connected client exchanges a
 * token about once an hour), and an operator who has to tune them has a
 * problem a number will not fix.
 */

export enum McpOAuthRateLimitBucket {
  // Opening the consent flow. May fetch a client metadata document.
  Authorize = "authorize",

  // Code exchange and refresh.
  Token = "token",

  // Dynamic client registration: an anonymous database write.
  Register = "register",

  Revoke = "revoke",

  // The consent screen's own calls, made with a member's session.
  Consent = "consent",
}

export enum McpOAuthRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  /* Redis is unreachable, so no limit can be honoured either way. */
  CounterUnavailable = "counter-unavailable",
}

export interface McpOAuthRateLimitDecision {
  outcome: McpOAuthRateLimitOutcome;
  retryAfterSeconds?: number | undefined;

  /* True only on the request that first crossed the line in this window. */
  isFirstRejectionInWindow?: boolean | undefined;
}

interface BucketConfig {
  windowSeconds: number;
  limit: number;

  /*
   * What to do when Redis cannot be reached. Registration is the one
   * endpoint that writes for an anonymous caller, so without a counter it is
   * refused rather than left unbounded. Everything else is let through: a
   * Redis blip must not sign every connected client out.
   */
  failClosed: boolean;
}

const WINDOW_SECONDS: number = 15 * 60;

const BUCKET_CONFIG: Record<McpOAuthRateLimitBucket, BucketConfig> = {
  [McpOAuthRateLimitBucket.Authorize]: {
    windowSeconds: WINDOW_SECONDS,
    limit: 300,
    failClosed: false,
  },
  [McpOAuthRateLimitBucket.Token]: {
    windowSeconds: WINDOW_SECONDS,
    limit: 1200,
    failClosed: false,
  },
  [McpOAuthRateLimitBucket.Register]: {
    windowSeconds: WINDOW_SECONDS,
    limit: 60,
    failClosed: true,
  },
  [McpOAuthRateLimitBucket.Revoke]: {
    windowSeconds: WINDOW_SECONDS,
    limit: 600,
    failClosed: false,
  },
  [McpOAuthRateLimitBucket.Consent]: {
    windowSeconds: WINDOW_SECONDS,
    limit: 600,
    failClosed: false,
  },
};

const KEY_PREFIX: string = "mcpoauth:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

/* Bounds a Redis key built from a caller-influenced address. */
const MAX_KEY_SEGMENT_LENGTH: number = 64;

/* How often the "counter unavailable" condition may be logged. */
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export type McpOAuthRateLimitRejectionHandler = (data: {
  req: ExpressRequest;
  res: ExpressResponse;
  statusCode: number;
  retryAfterSeconds?: number | undefined;
}) => void;

export default class McpOAuthRateLimit {
  private static counterUnavailableLastLoggedAt: number = 0;

  public static getLimit(bucket: McpOAuthRateLimitBucket): number {
    return BUCKET_CONFIG[bucket].limit;
  }

  /*
   * The client address to bill this request to: read from the trusted end of
   * X-Forwarded-For under TRUSTED_PROXY_HOPS, never the leftmost entry, which
   * the caller writes themselves - a spoofed value per request would be a
   * fresh bucket per request and no limit at all.
   */
  public static resolveClientIp(req: ExpressRequest): string {
    const clientIp: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (!clientIp) {
      // Unidentifiable callers share one bucket: the conservative direction.
      return "unknown";
    }

    return clientIp
      .slice(0, MAX_KEY_SEGMENT_LENGTH)
      .replace(/[^a-zA-Z0-9._:%\-[\]]/g, "_");
  }

  public static async consume(data: {
    bucket: McpOAuthRateLimitBucket;
    clientIp: string;
  }): Promise<McpOAuthRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: McpOAuthRateLimitOutcome.CounterUnavailable };
    }

    const config: BucketConfig = BUCKET_CONFIG[data.bucket];
    const windowMs: number = config.windowSeconds * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);
    const counterKey: string = `${KEY_PREFIX}${data.bucket}:${data.clientIp}:${windowIndex}`;

    try {
      const count: unknown = await client.incr(counterKey);

      if (typeof count !== "number") {
        throw new Error("Rate limit counter returned a non-numeric value");
      }

      /*
       * The expiry is set only by the write that created the key. Re-issuing
       * it on every increment would slide the window for as long as the load
       * continued, and a caller that tripped the limit once could never
       * recover.
       */
      if (count === 1) {
        await client.expire(counterKey, config.windowSeconds * TTL_MULTIPLIER);
      }

      if (count > config.limit) {
        return {
          outcome: McpOAuthRateLimitOutcome.RateLimited,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((windowMs - (Date.now() % windowMs)) / 1000),
          ),
          isFirstRejectionInWindow: count === config.limit + 1,
        };
      }

      return { outcome: McpOAuthRateLimitOutcome.Allowed };
    } catch (err) {
      if (McpOAuthRateLimit.shouldLogCounterUnavailable()) {
        logger.warn(
          `McpOAuthRateLimit: counter failed for a ${data.bucket} request from ${data.clientIp}`,
        );
        logger.warn(err);
      }

      return { outcome: McpOAuthRateLimitOutcome.CounterUnavailable };
    }
  }

  /*
   * Express middleware for one bucket. `onRejected` writes the refusal,
   * because the endpoints do not share a body format: the OAuth ones answer
   * `{ error, error_description }`, the consent ones the API's `{ message }`.
   */
  public static getMiddleware(
    bucket: McpOAuthRateLimitBucket,
    onRejected: McpOAuthRateLimitRejectionHandler,
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
      const clientIp: string = McpOAuthRateLimit.resolveClientIp(req);

      const decision: McpOAuthRateLimitDecision =
        await McpOAuthRateLimit.consume({ bucket, clientIp });

      if (decision.outcome === McpOAuthRateLimitOutcome.RateLimited) {
        if (decision.retryAfterSeconds) {
          res.setHeader("Retry-After", String(decision.retryAfterSeconds));
        }

        // One line per address per window, not one per refused request.
        if (decision.isFirstRejectionInWindow) {
          logger.warn(
            `McpOAuthRateLimit: rejected ${bucket} requests from ${clientIp}`,
          );
        }

        return onRejected({
          req,
          res,
          statusCode: 429,
          retryAfterSeconds: decision.retryAfterSeconds,
        });
      }

      if (decision.outcome === McpOAuthRateLimitOutcome.CounterUnavailable) {
        if (BUCKET_CONFIG[bucket].failClosed) {
          return onRejected({ req, res, statusCode: 503 });
        }

        if (McpOAuthRateLimit.shouldLogCounterUnavailable()) {
          logger.warn(
            `McpOAuthRateLimit: rate limit counter unavailable, allowing ${bucket} requests unthrottled`,
          );
        }
      }

      return next();
    };
  }

  /*
   * A Redis outage sends EVERY request down the unavailable path, so an
   * unguarded log line there is one per request for as long as it lasts.
   */
  private static shouldLogCounterUnavailable(): boolean {
    const now: number = Date.now();

    if (
      now - McpOAuthRateLimit.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return false;
    }

    McpOAuthRateLimit.counterUnavailableLastLoggedAt = now;

    return true;
  }
}
