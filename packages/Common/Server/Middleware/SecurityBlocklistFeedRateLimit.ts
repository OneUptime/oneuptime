import Redis, { ClientType } from "../Infrastructure/Redis";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../Utils/ClientIp";
import ClientRateLimitCounter, {
  ClientRateLimitRefusal,
} from "../Utils/RateLimit/ClientRateLimitCounter";
import Response from "../Utils/Response";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../Types/ObjectID";

/*
 * Rate limiting for the blocklist feed routes (#10345):
 *
 *   GET /api/blocklist-feed/:feedId/:file
 *   GET /api/blocklist-feed/:feedId/:secret/:file
 *
 * A firewall reads a feed with no session and no API key - a secret is the
 * whole credential - so nothing else in front of these routes bounds how
 * often they are asked, and each answer reads the project's blocklist and
 * what it protects. A sibling of OnCallCalendarFeedRateLimit, on the same
 * counters (ClientRateLimitCounter: an IPv6 client's /64 counted as well).
 *
 * Every request consumes two counters, either of which refuses it:
 *
 *   - the feed's, per address: what one firewall gets. 60 a minute: the
 *     fastest firewall reads a feed every minute (FortiGate's shortest
 *     refresh, a host's script), and a few readers behind one address
 *     (the list and its MD5, a retry) still have room;
 *   - the address's own, across feeds: 600 a minute, so stepping through
 *     feed IDs never buys a fresh allowance. Each guess still costs a read.
 *
 * Keyed by the feed's ID, which is in every feed URL and is no secret, and
 * never by a secret: a key ends up in KEYS/SCAN output and Redis's slow log.
 * A path that names no feed shares one small bucket.
 *
 * FAILS OPEN: when Redis cannot be reached, every request goes on, and the
 * secret still guards the feed. Firewalls that get 503s keep their last
 * list, but a blocklist no firewall can refresh during an attack is the
 * worse outcome.
 */

export enum SecurityBlocklistFeedRateLimitScope {
  Feed = "feed",
  Ip = "ip",
}

export enum SecurityBlocklistFeedRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",
  // Redis is unreachable, so no limit can be honoured either way.
  CounterUnavailable = "counter-unavailable",
}

export interface SecurityBlocklistFeedRateLimitDecision {
  outcome: SecurityBlocklistFeedRateLimitOutcome;
  retryAfterSeconds?: number | undefined;
  scope?: SecurityBlocklistFeedRateLimitScope | undefined;
  ipv6Network64?: string | undefined;
  isFirstRejectionInWindow?: boolean | undefined;
}

export const SECURITY_BLOCKLIST_FEED_RATE_LIMIT_WINDOW_SECONDS: number = 60;
export const SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_FEED: number = 60;
export const SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_IP: number = 600;

const KEY_PREFIX: string = "blfeed:rl:";

// Keys outlive their window by one, so a request on a boundary never reads a reclaimed key.
const TTL_MULTIPLIER: number = 2;

const MAX_KEY_SEGMENT_LENGTH: number = 64;

const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export const RATE_LIMITED_MESSAGE: string =
  "This feed was fetched too often from your address. Fetch it at most once a minute; the firewall keeps the list it has until then.";

export default class SecurityBlocklistFeedRateLimit {
  private static counterUnavailableLastLoggedAt: number = 0;

  // The address to bill the request to, read from the trusted end of X-Forwarded-For.
  public static resolveClientIp(req: ExpressRequest): string {
    const clientIp: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (clientIp) {
      return SecurityBlocklistFeedRateLimit.sanitizeKeySegment(clientIp);
    }

    // An address that cannot be told shares one bucket: no private allowance.
    return "unknown";
  }

  // The feed the request names, as a key segment: its ID, or one bucket for a path that names none.
  public static resolveFeedKey(req: ExpressRequest): string {
    const raw: unknown = req.params?.["feedId"];

    if (typeof raw !== "string" || !ObjectID.isValidUUID(raw.trim())) {
      return "invalid";
    }

    return raw.trim().toLowerCase();
  }

  public static sanitizeKeySegment(value: string): string {
    return value
      .slice(0, MAX_KEY_SEGMENT_LENGTH)
      .replace(/[^a-zA-Z0-9._:%\-[\]]/g, "_");
  }

  // Counts this request on both counters, and decides.
  public static async consume(data: {
    feedKey: string;
    clientIp: string;
  }): Promise<SecurityBlocklistFeedRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return {
        outcome: SecurityBlocklistFeedRateLimitOutcome.CounterUnavailable,
      };
    }

    const windowSeconds: number =
      SECURITY_BLOCKLIST_FEED_RATE_LIMIT_WINDOW_SECONDS;
    const windowIndex: number = Math.floor(Date.now() / (windowSeconds * 1000));

    try {
      const refusal: ClientRateLimitRefusal<SecurityBlocklistFeedRateLimitScope> | null =
        await ClientRateLimitCounter.count<SecurityBlocklistFeedRateLimitScope>(
          {
            redis: client,
            clientIp: data.clientIp,
            ttlSeconds: windowSeconds * TTL_MULTIPLIER,
            counters: [
              {
                scope: SecurityBlocklistFeedRateLimitScope.Feed,
                keyFor: (clientKey: string): string => {
                  return `${KEY_PREFIX}f:${data.feedKey}:${clientKey}:${windowIndex}`;
                },
                limit: SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_FEED,
              },
              {
                scope: SecurityBlocklistFeedRateLimitScope.Ip,
                keyFor: (clientKey: string): string => {
                  return `${KEY_PREFIX}i:${clientKey}:${windowIndex}`;
                },
                limit: SECURITY_BLOCKLIST_FEED_RATE_LIMIT_PER_IP,
              },
            ],
          },
        );

      if (!refusal) {
        return { outcome: SecurityBlocklistFeedRateLimitOutcome.Allowed };
      }

      const windowMs: number = windowSeconds * 1000;

      return {
        outcome: SecurityBlocklistFeedRateLimitOutcome.RateLimited,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((windowMs - (Date.now() % windowMs)) / 1000),
        ),
        scope: refusal.scope,
        ipv6Network64: refusal.ipv6Network64,
        isFirstRejectionInWindow: refusal.isFirstRefusalInWindow,
      };
    } catch (error) {
      if (SecurityBlocklistFeedRateLimit.shouldLogCounterUnavailable()) {
        logger.warn(
          `SecurityBlocklistFeedRateLimit: the counter failed for a request from ${data.clientIp}.`,
        );
        logger.warn(error);
      }

      return {
        outcome: SecurityBlocklistFeedRateLimitOutcome.CounterUnavailable,
      };
    }
  }

  /*
   * Express middleware, on each feed route ahead of anything that reads the
   * database, so a flood is refused before it costs a read.
   */
  public static async middleware(
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    const feedKey: string = SecurityBlocklistFeedRateLimit.resolveFeedKey(req);
    const clientIp: string =
      SecurityBlocklistFeedRateLimit.resolveClientIp(req);

    const decision: SecurityBlocklistFeedRateLimitDecision =
      await SecurityBlocklistFeedRateLimit.consume({ feedKey, clientIp });

    if (
      decision.outcome === SecurityBlocklistFeedRateLimitOutcome.RateLimited
    ) {
      if (decision.retryAfterSeconds) {
        res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      }

      // The crossing request only, and never a secret: which address, against which counter.
      if (decision.isFirstRejectionInWindow) {
        logger.warn(
          `SecurityBlocklistFeedRateLimit: refused blocklist feed requests from ${clientIp} (${ClientRateLimitCounter.describeLimit(
            String(decision.scope),
            decision.ipv6Network64,
          )})`,
        );
      }

      return Response.sendErrorResponse(
        req,
        res,
        new TooManyRequestsException(RATE_LIMITED_MESSAGE),
      );
    }

    if (
      decision.outcome ===
        SecurityBlocklistFeedRateLimitOutcome.CounterUnavailable &&
      SecurityBlocklistFeedRateLimit.shouldLogCounterUnavailable()
    ) {
      logger.warn(
        "SecurityBlocklistFeedRateLimit: the rate limit counter is unavailable; blocklist feed requests go on unthrottled.",
      );
    }

    return next();
  }

  private static shouldLogCounterUnavailable(): boolean {
    const now: number = Date.now();

    if (
      now - SecurityBlocklistFeedRateLimit.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return false;
    }

    SecurityBlocklistFeedRateLimit.counterUnavailableLastLoggedAt = now;

    return true;
  }
}
