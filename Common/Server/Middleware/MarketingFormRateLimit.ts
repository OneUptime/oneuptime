import Redis, { ClientType } from "../Infrastructure/Redis";
import { ExpressRequest } from "../Utils/Express";
import logger from "../Utils/Logger";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../Utils/ClientIp";
import Attribution from "../Utils/Attribution";

/*
 * Request limiting for the public marketing forms — today only the enterprise
 * licence request (App/API/EnterpriseLicenseRequest.ts).
 *
 * WHAT IS BEING PROTECTED
 *
 * The endpoint is anonymous by construction: it exists so a stranger who has
 * not signed up can ask to talk to sales. Each accepted submission spends two
 * things that are not free — a row in the conversion ledger that ad platforms
 * are later told about, and an email into the sales inbox. Neither is
 * catastrophic on its own, which is why this is a throttle and not a CAPTCHA,
 * but unbounded it is a way to fill a mailbox and to feed noise into bidding.
 *
 * Two counters, and either one rejects:
 *
 *   - per email address. One person filing the same request in a loop. The
 *     endpoint is already idempotent per address, so a repeat costs no extra
 *     ledger row — the counter is what stops it costing an extra email.
 *   - per client address. One script rotating addresses. Set well above the
 *     email limit, because a company behind one NAT can legitimately produce
 *     several requests in a day.
 *
 * THIS FAILS OPEN, DELIBERATELY
 *
 * With Redis unreachable the submission is accepted. The thing on the other
 * side of this limiter is a sales lead, and refusing real leads for the
 * duration of a Redis incident costs more than the spam a short unthrottled
 * window admits. That is the opposite of the call IdentityRateLimit makes,
 * and correctly so: there the counter is the only thing standing between an
 * attacker and an account.
 */

export enum MarketingFormRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  // Redis is unreachable, so no limit can be honoured either way.
  CounterUnavailable = "counter-unavailable",
}

export enum MarketingFormRateLimitScope {
  Email = "email",
  Ip = "ip",
}

export interface MarketingFormRateLimitDecision {
  outcome: MarketingFormRateLimitOutcome;
  retryAfterSeconds?: number | undefined;
  scope?: MarketingFormRateLimitScope | undefined;
}

type ParsePositiveIntFromEnvFunction = (
  envKey: string,
  fallback: number,
) => number;

const parsePositiveIntFromEnv: ParsePositiveIntFromEnvFunction = (
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

/*
 * An hour-long window. A person who genuinely needs to correct something they
 * typed gets several attempts; a loop gets one an hour.
 */
const WINDOW_SECONDS: number = parsePositiveIntFromEnv(
  "MARKETING_FORM_RATE_LIMIT_WINDOW_SECONDS",
  60 * 60,
);

const PER_EMAIL_LIMIT: number = parsePositiveIntFromEnv(
  "MARKETING_FORM_RATE_LIMIT_PER_EMAIL_PER_WINDOW",
  5,
);

const PER_IP_LIMIT: number = parsePositiveIntFromEnv(
  "MARKETING_FORM_RATE_LIMIT_PER_IP_PER_WINDOW",
  20,
);

const KEY_PREFIX: string = "marketingform:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

// Bounds a Redis key built from caller-supplied values.
const MAX_KEY_SEGMENT_LENGTH: number = 64;

// How often the "counter unavailable" condition may be logged.
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

let lastCounterUnavailableLogAt: number = 0;

export default class MarketingFormRateLimit {
  /*
   * The client address to bill this request to.
   *
   * Uses the shared ClientIp helper, which reads X-Forwarded-For from the
   * trusted right-hand end. Express.getClientIp takes the LEFTMOST entry,
   * which the caller sets themselves — for a rate limiter that is fatal,
   * because a fresh spoofed value per request is a fresh bucket per request
   * and therefore no limit at all.
   */
  public static resolveClientIp(req: ExpressRequest): string {
    const clientIp: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (clientIp) {
      return this.sanitizeKeySegment(clientIp);
    }

    /*
     * Everything with no resolvable address shares one bucket. That is the
     * conservative direction: an unidentifiable caller should not be handed a
     * private allowance.
     */
    return "unknown";
  }

  /*
   * The email bucket key.
   *
   * Hashed rather than stored in the clear: Redis keys turn up in slow logs,
   * monitoring and SCAN output, and none of those are places a prospect's
   * address belongs. Hashing through Attribution also means "the same address"
   * means the same thing here as it does everywhere else in the ledger.
   */
  public static resolveEmailKey(email: string | undefined): string {
    const hashed: string | null = Attribution.hashEmail(email);

    if (!hashed) {
      return "none";
    }

    return hashed.slice(0, MAX_KEY_SEGMENT_LENGTH);
  }

  private static sanitizeKeySegment(value: string): string {
    return (
      value
        .slice(0, MAX_KEY_SEGMENT_LENGTH)
        /*
         * Redis keys are binary safe, but a predictable charset keeps
         * operational tooling (SCAN patterns, dashboards) sane.
         */
        .replace(/[^a-zA-Z0-9._:%\-[\]]/g, "_")
    );
  }

  public static getLimits(): {
    windowSeconds: number;
    perEmailLimit: number;
    perIpLimit: number;
  } {
    return {
      windowSeconds: WINDOW_SECONDS,
      perEmailLimit: PER_EMAIL_LIMIT,
      perIpLimit: PER_IP_LIMIT,
    };
  }

  /*
   * Increment both counters and decide.
   *
   * Both are incremented on every request, INCLUDING a rejected one. That is
   * standard fixed-window behaviour and it is deliberate: a caller who keeps
   * hammering keeps their window pinned rather than being handed a fresh
   * allowance for free.
   */
  public static async consume(data: {
    emailKey: string;
    clientIp: string;
  }): Promise<MarketingFormRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: MarketingFormRateLimitOutcome.CounterUnavailable };
    }

    const windowMs: number = WINDOW_SECONDS * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);

    const emailCounterKey: string = `${KEY_PREFIX}e:${data.emailKey}:${windowIndex}`;
    const ipCounterKey: string = `${KEY_PREFIX}i:${data.clientIp}:${windowIndex}`;

    try {
      const pipelineResults: Array<[Error | null, unknown]> | null =
        (await client
          .pipeline()
          .incr(emailCounterKey)
          .incr(ipCounterKey)
          .exec()) as Array<[Error | null, unknown]> | null;

      if (!pipelineResults || pipelineResults.length < 2) {
        throw new Error("Rate limit pipeline returned no result");
      }

      const emailCount: number = this.readCounterResult(pipelineResults[0]);
      const ipCount: number = this.readCounterResult(pipelineResults[1]);

      /*
       * Set the expiry only on the write that created the key. Re-issuing
       * EXPIRE on every increment would slide the window forward for as long
       * as the load continues, so a caller who tripped the limit once could
       * never recover.
       */
      const keysToExpire: Array<string> = [];

      if (emailCount === 1) {
        keysToExpire.push(emailCounterKey);
      }

      if (ipCount === 1) {
        keysToExpire.push(ipCounterKey);
      }

      if (keysToExpire.length > 0) {
        const expirePipeline: ReturnType<ClientType["pipeline"]> =
          client.pipeline();

        for (const key of keysToExpire) {
          expirePipeline.expire(key, WINDOW_SECONDS * TTL_MULTIPLIER);
        }

        await expirePipeline.exec();
      }

      const retryAfterSeconds: number = this.getSecondsUntilWindowEnd();

      if (emailCount > PER_EMAIL_LIMIT) {
        return {
          outcome: MarketingFormRateLimitOutcome.RateLimited,
          retryAfterSeconds: retryAfterSeconds,
          scope: MarketingFormRateLimitScope.Email,
        };
      }

      if (ipCount > PER_IP_LIMIT) {
        return {
          outcome: MarketingFormRateLimitOutcome.RateLimited,
          retryAfterSeconds: retryAfterSeconds,
          scope: MarketingFormRateLimitScope.Ip,
        };
      }

      return { outcome: MarketingFormRateLimitOutcome.Allowed };
    } catch (err) {
      /*
       * Throttled: whatever broke Redis is unlikely to have broken it for one
       * request only, and a per-request log line buries the incident it is
       * reporting.
       */
      const now: number = Date.now();

      if (
        now - lastCounterUnavailableLogAt >=
        COUNTER_UNAVAILABLE_LOG_INTERVAL_MS
      ) {
        lastCounterUnavailableLogAt = now;
        logger.warn("MarketingFormRateLimit: counter failed");
        logger.warn(err);
      }

      return { outcome: MarketingFormRateLimitOutcome.CounterUnavailable };
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
  private static getSecondsUntilWindowEnd(): number {
    const windowMs: number = WINDOW_SECONDS * 1000;
    const msIntoWindow: number = Date.now() % windowMs;

    return Math.max(1, Math.ceil((windowMs - msIntoWindow) / 1000));
  }
}
