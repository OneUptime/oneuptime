import Redis, { ClientType } from "../Infrastructure/Redis";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import Response from "../Utils/Response";
import ObjectID from "../../Types/ObjectID";
import ServiceUnavailableException from "../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";

/*
 * Request limiting for "Send test to me" (POST /send-test on the subscriber
 * notification preview router), which emails the signed-in user the status
 * page subscriber email they are previewing.
 *
 * The route only ever sends to the caller's own verified account email, so
 * what this bounds is volume: every allowed request is a real email, through
 * the status page's own SMTP server or the instance's mail provider, and
 * nothing else stops a script (or a held-down button) from sending hundreds.
 * The counter is per user, across every project, status page and incident:
 * a user is one inbox.
 *
 * THIS FAILS CLOSED
 *
 * If Redis is unreachable, the test is refused with "try again later". That
 * is the opposite of the choice VerificationCodeRateLimit makes, and the
 * difference is what else bounds the requests: there, the code's expiry, its
 * attempt counter and the resend cooldown all live in Postgres and stay in
 * force; here this counter is the only bound on how much mail is sent. A
 * test email is a convenience, and a Redis blip costs nothing but a retry.
 */

export enum SubscriberNotificationTestSendRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  // Redis is unreachable, so the limit cannot be honoured.
  CounterUnavailable = "counter-unavailable",
}

export interface SubscriberNotificationTestSendRateLimitDecision {
  outcome: SubscriberNotificationTestSendRateLimitOutcome;
  retryAfterSeconds?: number | undefined;
  /*
   * True only on the request that first crossed the line in this window, so
   * a flood produces one log line per user per window.
   */
  isFirstRejectionInWindow?: boolean | undefined;
}

export interface SubscriberNotificationTestSendRateLimitConfig {
  windowSeconds: number;
  perUserLimit: number;
}

const KEY_PREFIX: string = "subnotiftest:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

// How often the "counter unavailable" condition may be logged.
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export default class SubscriberNotificationTestSendRateLimit {
  /*
   * Ten test emails a quarter of an hour: someone checking each status
   * page's email in turn, or trying a template change a few times, is
   * nowhere near it.
   */
  private static readonly config: SubscriberNotificationTestSendRateLimitConfig =
    {
      windowSeconds: 15 * 60,
      perUserLimit: 10,
    };

  private static counterUnavailableLastLoggedAt: number = 0;

  // The limit in force, for tests and for operators' diagnostics.
  public static getConfig(): SubscriberNotificationTestSendRateLimitConfig {
    return { ...SubscriberNotificationTestSendRateLimit.config };
  }

  /*
   * The signed-in user the request is billed to. The route sits behind
   * UserMiddleware.requireUserAuthentication, so there always is one; if
   * somehow there is not, every such request shares one bucket rather than
   * each getting its own.
   */
  public static resolveUserKey(req: ExpressRequest): string {
    const userId: ObjectID | undefined = (req as OneUptimeRequest)
      ?.userAuthorization?.userId;

    if (!userId) {
      return "anonymous";
    }

    const key: string = userId.toString().toLowerCase();

    return ObjectID.isValidUUID(key) ? key : "invalid";
  }

  /*
   * Count this request against the user and decide. The counter is
   * incremented on every request, a rejected one included, so a caller who
   * keeps trying keeps their window pinned rather than getting a fresh
   * allowance for free.
   */
  public static async consume(data: {
    userKey: string;
  }): Promise<SubscriberNotificationTestSendRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return {
        outcome:
          SubscriberNotificationTestSendRateLimitOutcome.CounterUnavailable,
      };
    }

    const config: SubscriberNotificationTestSendRateLimitConfig =
      SubscriberNotificationTestSendRateLimit.config;
    const windowMs: number = config.windowSeconds * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);
    const counterKey: string = `${KEY_PREFIX}u:${data.userKey}:${windowIndex}`;

    try {
      const count: number = await client.incr(counterKey);

      if (typeof count !== "number") {
        throw new Error("Rate limit counter returned a non-numeric value");
      }

      /*
       * The expiry is set only by the request that created the key: setting
       * it on every increment would slide the window for as long as the
       * requests keep coming.
       */
      if (count === 1) {
        await client.expire(counterKey, config.windowSeconds * TTL_MULTIPLIER);
      }

      if (count > config.perUserLimit) {
        return {
          outcome: SubscriberNotificationTestSendRateLimitOutcome.RateLimited,
          retryAfterSeconds:
            SubscriberNotificationTestSendRateLimit.getSecondsUntilWindowEnd(
              config.windowSeconds,
            ),
          isFirstRejectionInWindow: count === config.perUserLimit + 1,
        };
      }

      return {
        outcome: SubscriberNotificationTestSendRateLimitOutcome.Allowed,
      };
    } catch (err) {
      if (
        SubscriberNotificationTestSendRateLimit.shouldLogCounterUnavailable()
      ) {
        logger.warn(
          `SubscriberNotificationTestSendRateLimit: counter failed for user ${data.userKey}`,
        );
        logger.warn(err);
      }

      return {
        outcome:
          SubscriberNotificationTestSendRateLimitOutcome.CounterUnavailable,
      };
    }
  }

  /*
   * Express middleware. Register after UserMiddleware (the counter is per
   * user) and before the handler, so a flood is refused before it reads a
   * single row.
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
      const userKey: string =
        SubscriberNotificationTestSendRateLimit.resolveUserKey(req);

      const decision: SubscriberNotificationTestSendRateLimitDecision =
        await SubscriberNotificationTestSendRateLimit.consume({
          userKey: userKey,
        });

      if (
        decision.outcome ===
        SubscriberNotificationTestSendRateLimitOutcome.RateLimited
      ) {
        if (decision.retryAfterSeconds) {
          SubscriberNotificationTestSendRateLimit.setRetryAfterHeader(
            res,
            decision.retryAfterSeconds,
          );
        }

        if (decision.isFirstRejectionInWindow) {
          logger.warn(
            `SubscriberNotificationTestSendRateLimit: rejected test emails from user ${userKey} for the rest of this window`,
          );
        }

        return Response.sendErrorResponse(
          req,
          res,
          new TooManyRequestsException(
            "You have sent yourself too many test emails. Please try again later.",
          ),
        );
      }

      if (
        decision.outcome ===
        SubscriberNotificationTestSendRateLimitOutcome.CounterUnavailable
      ) {
        // Fails closed: see the note at the top of this file.
        if (
          SubscriberNotificationTestSendRateLimit.shouldLogCounterUnavailable()
        ) {
          logger.warn(
            "SubscriberNotificationTestSendRateLimit: rate limit counter unavailable, refusing test emails",
          );
        }

        return Response.sendErrorResponse(
          req,
          res,
          new ServiceUnavailableException(
            "Test emails cannot be sent right now. Please try again in a few minutes.",
          ),
        );
      }

      return next();
    };
  }

  /*
   * Remaining seconds in the current fixed window, so a refused caller is
   * told to come back when the window actually rolls.
   */
  private static getSecondsUntilWindowEnd(windowSeconds: number): number {
    const windowMs: number = windowSeconds * 1000;
    const msIntoWindow: number = Date.now() % windowMs;

    return Math.max(1, Math.ceil((windowMs - msIntoWindow) / 1000));
  }

  /*
   * A Redis outage means every request takes the unavailable path; one log
   * line per interval makes the condition visible without burying the rest.
   */
  private static shouldLogCounterUnavailable(): boolean {
    const now: number = Date.now();

    if (
      now -
        SubscriberNotificationTestSendRateLimit.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return false;
    }

    SubscriberNotificationTestSendRateLimit.counterUnavailableLastLoggedAt =
      now;

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
