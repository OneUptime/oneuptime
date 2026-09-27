import Redis, { ClientType } from "../Infrastructure/Redis";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import Response from "../Utils/Response";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import SubscriberNotificationTestSendRateLimit from "./SubscriberNotificationTestSendRateLimit";

/*
 * Request limiting for "Preview notification" (POST /preview on the
 * subscriber notification preview router).
 *
 * A preview sends nothing, but it is not free: it renders the incident's
 * description and custom fields once, then an email for every status page
 * the caller can read, and returns all of that HTML in one answer. Any
 * project member holding one of the audience roles may call it, as often as
 * they like, so this bounds how much rendering one person can ask the App
 * server for. The request itself is bounded too
 * (SubscriberNotificationPreviewBuilder.parseRequest caps the text and the
 * custom field values).
 *
 * The limit is loose: someone writing an incident or a note and previewing
 * it after each change is nowhere near it. The counter is per user, across
 * every project and incident, like the test email's
 * (SubscriberNotificationTestSendRateLimit, whose user key this shares).
 *
 * THIS FAILS OPEN
 *
 * If Redis is unreachable the preview is served. That is the opposite of the
 * test email's choice, and the difference is what is at stake: a test email
 * is real mail, and this counter would be the only bound on it; a preview
 * sends nothing, its request is size-capped, and refusing it would take the
 * preview away from everyone for as long as Redis is down.
 */

export enum SubscriberNotificationPreviewRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  // Redis is unreachable: served, since this fails open.
  CounterUnavailable = "counter-unavailable",
}

export interface SubscriberNotificationPreviewRateLimitDecision {
  outcome: SubscriberNotificationPreviewRateLimitOutcome;
  retryAfterSeconds?: number | undefined;
  // True only on the request that first crossed the line in this window.
  isFirstRejectionInWindow?: boolean | undefined;
}

export interface SubscriberNotificationPreviewRateLimitConfig {
  windowSeconds: number;
  perUserLimit: number;
}

const KEY_PREFIX: string = "subnotifpreview:rl:";

// Counter keys outlive their window by one full window.
const TTL_MULTIPLIER: number = 2;

// How often the "counter unavailable" condition may be logged.
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export default class SubscriberNotificationPreviewRateLimit {
  // Sixty previews every ten minutes: one every ten seconds, sustained.
  private static readonly config: SubscriberNotificationPreviewRateLimitConfig =
    {
      windowSeconds: 10 * 60,
      perUserLimit: 60,
    };

  private static counterUnavailableLastLoggedAt: number = 0;

  // The limit in force, for tests and for operators' diagnostics.
  public static getConfig(): SubscriberNotificationPreviewRateLimitConfig {
    return { ...SubscriberNotificationPreviewRateLimit.config };
  }

  /*
   * Count this request against the user and decide. A rejected request is
   * counted too, so a caller who keeps trying keeps their window pinned.
   */
  public static async consume(data: {
    userKey: string;
  }): Promise<SubscriberNotificationPreviewRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return {
        outcome:
          SubscriberNotificationPreviewRateLimitOutcome.CounterUnavailable,
      };
    }

    const config: SubscriberNotificationPreviewRateLimitConfig =
      SubscriberNotificationPreviewRateLimit.config;
    const windowMs: number = config.windowSeconds * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);
    const counterKey: string = `${KEY_PREFIX}u:${data.userKey}:${windowIndex}`;

    try {
      const count: number = await client.incr(counterKey);

      if (typeof count !== "number") {
        throw new Error("Rate limit counter returned a non-numeric value");
      }

      // Set only by the request that created the key, so the window is fixed.
      if (count === 1) {
        await client.expire(counterKey, config.windowSeconds * TTL_MULTIPLIER);
      }

      if (count > config.perUserLimit) {
        const msIntoWindow: number = Date.now() % windowMs;

        return {
          outcome: SubscriberNotificationPreviewRateLimitOutcome.RateLimited,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((windowMs - msIntoWindow) / 1000),
          ),
          isFirstRejectionInWindow: count === config.perUserLimit + 1,
        };
      }

      return {
        outcome: SubscriberNotificationPreviewRateLimitOutcome.Allowed,
      };
    } catch (err) {
      if (
        SubscriberNotificationPreviewRateLimit.shouldLogCounterUnavailable()
      ) {
        logger.warn(
          `SubscriberNotificationPreviewRateLimit: counter failed for user ${data.userKey}`,
        );
        logger.warn(err);
      }

      return {
        outcome:
          SubscriberNotificationPreviewRateLimitOutcome.CounterUnavailable,
      };
    }
  }

  /*
   * Express middleware. Register after UserMiddleware (the counter is per
   * user) and before the handler, so a flood is refused before it renders
   * anything.
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

      const decision: SubscriberNotificationPreviewRateLimitDecision =
        await SubscriberNotificationPreviewRateLimit.consume({
          userKey: userKey,
        });

      if (
        decision.outcome ===
        SubscriberNotificationPreviewRateLimitOutcome.RateLimited
      ) {
        if (decision.retryAfterSeconds) {
          const setHeader: unknown = (
            res as unknown as Record<string, unknown>
          )["setHeader"];

          if (typeof setHeader === "function") {
            (setHeader as (name: string, value: string) => void).call(
              res,
              "Retry-After",
              String(decision.retryAfterSeconds),
            );
          }
        }

        if (decision.isFirstRejectionInWindow) {
          logger.warn(
            `SubscriberNotificationPreviewRateLimit: rejected previews from user ${userKey} for the rest of this window`,
          );
        }

        return Response.sendErrorResponse(
          req,
          res,
          new TooManyRequestsException(
            "You have previewed notifications too many times in a short while. Please try again in a few minutes.",
          ),
        );
      }

      if (
        decision.outcome ===
          SubscriberNotificationPreviewRateLimitOutcome.CounterUnavailable &&
        SubscriberNotificationPreviewRateLimit.shouldLogCounterUnavailable()
      ) {
        // Fails open: see the note at the top of this file.
        logger.warn(
          "SubscriberNotificationPreviewRateLimit: rate limit counter unavailable, serving previews without a limit",
        );
      }

      return next();
    };
  }

  /*
   * A Redis outage means every request takes the unavailable path; one log
   * line per interval makes the condition visible without burying the rest.
   */
  private static shouldLogCounterUnavailable(): boolean {
    const now: number = Date.now();

    if (
      now -
        SubscriberNotificationPreviewRateLimit.counterUnavailableLastLoggedAt <
      COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
    ) {
      return false;
    }

    SubscriberNotificationPreviewRateLimit.counterUnavailableLastLoggedAt = now;

    return true;
  }
}
