import Redis, { ClientType } from "../Infrastructure/Redis";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import ClientRateLimitCounter, {
  ClientRateLimitRefusal,
} from "../Utils/RateLimit/ClientRateLimitCounter";
import Response from "../Utils/Response";
import ObjectID from "../../Types/ObjectID";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";
import {
  getRemediationRoundTryAgainRefusal,
  REMEDIATION_ROUND_READ_TOO_OFTEN,
  RemediationRoundTryAgainRefusal,
} from "../../Types/AutoRemediation/RemediationRound";

/*
 * RATE LIMITS FOR AN AI FIX'S ROUND, AND FOR TRY AGAIN (issue #6525).
 *
 * The Remediation step of an incident's or alert's OneUptime AI card reads
 * each fix's round (POST /auto-remediation/round): once a fix has a run,
 * again whenever its run or its status changes, and every 15 seconds while
 * its round is at work. Try again starts OneUptime AI working again: on a
 * fix whose round stopped (POST /auto-remediation/round-try-again), or on
 * the record, which decides again how to fix it (POST
 * /auto-remediation/try-again). Nothing bounded how often either was asked:
 * the kind of route CodeQL's js/missing-rate-limiting reports.
 *
 * One counter per signed-in user and bucket, in fixed windows
 * (ClientRateLimitCounter.countFixed): the routes are for a person who is
 * signed in, so the person is what is counted, never their address - a
 * team behind one office address reads its incidents as many people. A
 * request that names nobody is not counted at all: the route refuses it
 * before it reads anything.
 *
 *   - Read: 1,800 reads in 15 minutes. A round at work is read every 15
 *     seconds, 60 times in 15 minutes, so the limit holds 30 rounds at
 *     work in view at once - ten fixes at work in three tabs, say - with
 *     room for the reads on each change. A refused read is answered 429
 *     with Retry-After, and the step waits that long before it reads the
 *     rounds again (useRemediationRounds): it never shows an error for it.
 *
 *   - Try again: 30 presses in 15 minutes, of both Try agains together. A
 *     person presses it a few times in an incident; a script or a key held
 *     down presses it hundreds. Each press that is let through is still
 *     held to everything else: who may change the record, the AI switch,
 *     AI credits, the daily limits, the record's own 30 seconds between
 *     decisions and the conditional write that lets one press of two win.
 *     A refused press is answered 429 with a sentence the step says in the
 *     reader's language, under the button, where Try again's other
 *     refusals show.
 *
 * Every request is counted, a refused one included, so a client that keeps
 * asking keeps its window pinned rather than being handed a fresh
 * allowance.
 *
 * THIS FAILS OPEN
 *
 * When Valkey cannot be reached, both are let through with a throttled
 * warning. A round's read changes nothing, and Try again is bounded by all
 * of the above, which live in Postgres and stay in force: refusing every
 * read and every Try again during a blip would cost far more than the
 * limit saves.
 *
 * Approve, Dismiss, Dry run, Save as Runbook and a fix that lasts
 * (declared-code-*) are not limited here: each is a person's decision on
 * one fix - held to its permissions and to a conditional write that
 * refuses a fix that moved on, or answering the task already on its way -
 * and a limit could only stand between a person and a fix during an
 * incident.
 */

export enum AutoRemediationRoundRateLimitBucket {
  // Reading what a fix's round did: polled by the Remediation step.
  Read = "read",

  // Try again, on a fix whose round stopped or on the record.
  TryAgain = "try-again",
}

export enum AutoRemediationRoundRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  // Valkey cannot be reached, so no limit can be honoured either way.
  CounterUnavailable = "counter-unavailable",

  // The request names nobody: not counted, and refused by its route.
  NotCounted = "not-counted",
}

export interface AutoRemediationRoundRateLimitDecision {
  outcome: AutoRemediationRoundRateLimitOutcome;
  retryAfterSeconds?: number | undefined;

  /*
   * True only on the request that first went over the limit in its window,
   * so a flood is one log line per user per window.
   */
  isFirstRejectionInWindow?: boolean | undefined;
}

export interface AutoRemediationRoundRateLimitConfig {
  windowSeconds: number;
  perUserLimit: number;
}

const WINDOW_SECONDS: number = 15 * 60;

const BUCKET_CONFIG: Readonly<
  Record<
    AutoRemediationRoundRateLimitBucket,
    AutoRemediationRoundRateLimitConfig
  >
> = {
  [AutoRemediationRoundRateLimitBucket.Read]: {
    windowSeconds: WINDOW_SECONDS,
    perUserLimit: 1800,
  },
  [AutoRemediationRoundRateLimitBucket.TryAgain]: {
    windowSeconds: WINDOW_SECONDS,
    perUserLimit: 30,
  },
};

/*
 * What a refused request is told. Try again's is a sentence the Dashboard
 * words in every language (RemediationStepCopy); a read's is never shown
 * on the card, which waits instead, so it is the API's English.
 */
const REFUSAL_MESSAGES: Readonly<
  Record<AutoRemediationRoundRateLimitBucket, string>
> = {
  [AutoRemediationRoundRateLimitBucket.Read]: REMEDIATION_ROUND_READ_TOO_OFTEN,
  [AutoRemediationRoundRateLimitBucket.TryAgain]:
    getRemediationRoundTryAgainRefusal(
      RemediationRoundTryAgainRefusal.TooManyTries,
    ),
};

const KEY_PREFIX: string = "autoremediationround:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

// How often the "counter unavailable" condition may be logged, per bucket.
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

type RateLimitMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

/*
 * The bucket each middleware this file made counts in: a route's suite reads
 * what stands in front of its handler (bucketOf), as it reads the product
 * refusals (ServerProductRoutes.isRefusal).
 */
const MIDDLEWARE_BUCKETS: WeakMap<
  RateLimitMiddleware,
  AutoRemediationRoundRateLimitBucket
> = new WeakMap<RateLimitMiddleware, AutoRemediationRoundRateLimitBucket>();

export default class AutoRemediationRoundRateLimit {
  private static counterUnavailableLastLoggedAt: Map<
    AutoRemediationRoundRateLimitBucket,
    number
  > = new Map<AutoRemediationRoundRateLimitBucket, number>();

  // The limit in force, for tests and for operators' diagnostics.
  public static getConfig(
    bucket: AutoRemediationRoundRateLimitBucket,
  ): AutoRemediationRoundRateLimitConfig {
    return { ...BUCKET_CONFIG[bucket] };
  }

  // What a refused request of the bucket is told.
  public static getRefusalMessage(
    bucket: AutoRemediationRoundRateLimitBucket,
  ): string {
    return REFUSAL_MESSAGES[bucket];
  }

  /*
   * The signed-in user the request is counted for, or null when it names
   * nobody. Lowercased, and only ever a UUID: never a caller's text in a
   * Valkey key.
   */
  public static resolveUserKey(req: ExpressRequest): string | null {
    const userId: ObjectID | undefined = (req as OneUptimeRequest)
      ?.userAuthorization?.userId;

    if (!userId) {
      return null;
    }

    const key: string = userId.toString().toLowerCase();

    return ObjectID.isValidUUID(key) ? key : null;
  }

  // Counts one request of the user in the bucket, and decides.
  public static async consume(data: {
    bucket: AutoRemediationRoundRateLimitBucket;
    userKey: string | null;
  }): Promise<AutoRemediationRoundRateLimitDecision> {
    if (!data.userKey) {
      return { outcome: AutoRemediationRoundRateLimitOutcome.NotCounted };
    }

    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return {
        outcome: AutoRemediationRoundRateLimitOutcome.CounterUnavailable,
      };
    }

    const config: AutoRemediationRoundRateLimitConfig =
      BUCKET_CONFIG[data.bucket];
    const windowMs: number = config.windowSeconds * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);

    try {
      /*
       * Counted by ClientRateLimitCounter, under the user alone: the
       * expiry is set only by the request that created the key, so a
       * window never slides forward for as long as requests keep coming.
       */
      const refusal: ClientRateLimitRefusal<AutoRemediationRoundRateLimitBucket> | null =
        await ClientRateLimitCounter.countFixed<AutoRemediationRoundRateLimitBucket>(
          {
            redis: client,
            ttlSeconds: config.windowSeconds * TTL_MULTIPLIER,
            counters: [
              {
                scope: data.bucket,
                key: `${KEY_PREFIX}${data.bucket}:u:${data.userKey}:${windowIndex}`,
                limit: config.perUserLimit,
              },
            ],
          },
        );

      if (!refusal) {
        return { outcome: AutoRemediationRoundRateLimitOutcome.Allowed };
      }

      return {
        outcome: AutoRemediationRoundRateLimitOutcome.RateLimited,
        retryAfterSeconds:
          AutoRemediationRoundRateLimit.getSecondsUntilWindowEnd(
            config.windowSeconds,
          ),
        isFirstRejectionInWindow: refusal.isFirstRefusalInWindow,
      };
    } catch (err) {
      if (
        AutoRemediationRoundRateLimit.shouldLogCounterUnavailable(data.bucket)
      ) {
        logger.warn(
          `AutoRemediationRoundRateLimit: counter failed for a ${data.bucket} request from user ${data.userKey}`,
        );
        logger.warn(err);
      }

      return {
        outcome: AutoRemediationRoundRateLimitOutcome.CounterUnavailable,
      };
    }
  }

  /*
   * Express middleware for one bucket. Register after UserMiddleware (the
   * counter is the signed-in user's) and before the handler, so a flood is
   * refused before it reads a row.
   */
  public static getMiddleware(
    bucket: AutoRemediationRoundRateLimitBucket,
  ): RateLimitMiddleware {
    const middleware: RateLimitMiddleware = async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      const userKey: string | null =
        AutoRemediationRoundRateLimit.resolveUserKey(req);

      const decision: AutoRemediationRoundRateLimitDecision =
        await AutoRemediationRoundRateLimit.consume({ bucket, userKey });

      if (
        decision.outcome === AutoRemediationRoundRateLimitOutcome.RateLimited
      ) {
        if (decision.retryAfterSeconds) {
          AutoRemediationRoundRateLimit.setRetryAfterHeader(
            res,
            decision.retryAfterSeconds,
          );
        }

        if (decision.isFirstRejectionInWindow) {
          logger.warn(
            `AutoRemediationRoundRateLimit: refused ${bucket} requests from user ${userKey} for the rest of this window`,
          );
        }

        return Response.sendErrorResponse(
          req,
          res,
          new TooManyRequestsException(REFUSAL_MESSAGES[bucket]),
        );
      }

      if (
        decision.outcome ===
          AutoRemediationRoundRateLimitOutcome.CounterUnavailable &&
        AutoRemediationRoundRateLimit.shouldLogCounterUnavailable(bucket)
      ) {
        // Fails open: see the note at the top of this file.
        logger.warn(
          `AutoRemediationRoundRateLimit: rate limit counter unavailable, allowing ${bucket} requests unthrottled`,
        );
      }

      return next();
    };

    MIDDLEWARE_BUCKETS.set(middleware, bucket);

    return middleware;
  }

  // The bucket a middleware counts in, when it is one of this file's.
  public static bucketOf(
    handler: unknown,
  ): AutoRemediationRoundRateLimitBucket | undefined {
    return typeof handler === "function"
      ? MIDDLEWARE_BUCKETS.get(handler as RateLimitMiddleware)
      : undefined;
  }

  /*
   * The seconds left in the current fixed window, so a refused caller is
   * told to come back when the window actually rolls.
   */
  public static getSecondsUntilWindowEnd(windowSeconds: number): number {
    const windowMs: number = windowSeconds * 1000;
    const msIntoWindow: number = Date.now() % windowMs;

    return Math.max(1, Math.ceil((windowMs - msIntoWindow) / 1000));
  }

  /*
   * A Valkey outage sends every request down the unavailable path: one line
   * per bucket per interval makes it visible without burying the rest.
   */
  private static shouldLogCounterUnavailable(
    bucket: AutoRemediationRoundRateLimitBucket,
  ): boolean {
    const now: number = Date.now();
    const lastLoggedAt: number =
      AutoRemediationRoundRateLimit.counterUnavailableLastLoggedAt.get(
        bucket,
      ) || 0;

    if (now - lastLoggedAt < COUNTER_UNAVAILABLE_LOG_INTERVAL_MS) {
      return false;
    }

    AutoRemediationRoundRateLimit.counterUnavailableLastLoggedAt.set(
      bucket,
      now,
    );

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
