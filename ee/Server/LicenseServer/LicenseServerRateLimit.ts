import crypto from "crypto";
import Redis, { ClientType } from "Common/Server/Infrastructure/Redis";
import resolveTrustedClientIp, {
  ClientIpRequestLike,
} from "Common/Server/Utils/ClientIp";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import TooManyRequestsException from "Common/Types/Exception/TooManyRequestsException";

/*
 * Request limiting for the two license-server routes self-hosted installations
 * call without signing in: POST /enterprise-license/validate (activation and
 * refresh) and POST /enterprise-license/report-user-count (the daily usage
 * report).
 *
 * Both routes answer anyone who holds - or guesses - a license key, and both
 * cost a Redis lock plus several database reads per call. Unlimited, they are
 * a free way to probe keys and to load the license server. The same
 * fixed-window shape as Common/Server/Middleware/IdentityRateLimit.ts:
 *
 *   - one counter per (license key, client address) and one per client
 *     address, both incremented on every request;
 *   - the license key is HASHED before it becomes part of a Redis key, so no
 *     key ever lands in Redis or a log;
 *   - the client address comes from the trusted end of X-Forwarded-For
 *     (Common/Server/Utils/ClientIp), so a forged header buys no fresh budget.
 *
 * Unlike the sign-in limiter this one FAILS OPEN when Redis is unavailable.
 * The limit protects the license server's capacity, not a secret: a license
 * key has 256 bits (122 for keys issued before server-side generation), so
 * guessing is not what the limit stops, and refusing every customer's daily
 * report during a Redis blip would do more harm than the burst it prevents.
 *
 * The budgets are generous on purpose: a customer can run many instances (and
 * many pods refreshing at boot) behind one egress address. Each can be tuned
 * with the environment variables below, read when the limit is checked.
 */

export enum LicenseServerRateLimitBucket {
  // POST /enterprise-license/validate
  Validate = "validate",
  // POST /enterprise-license/report-user-count
  ReportUserCount = "report-user-count",
}

export enum LicenseServerRateLimitScope {
  // One license key, from one client address.
  LicenseKey = "license-key",
  // One client address, across every license key.
  Ip = "ip",
}

export enum LicenseServerRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",
  // Redis is unreachable; the request is let through.
  CounterUnavailable = "counter-unavailable",
}

export interface LicenseServerRateLimitDecision {
  outcome: LicenseServerRateLimitOutcome;
  retryAfterSeconds?: number | undefined;
  // Which counter rejected. Unset unless rejected.
  scope?: LicenseServerRateLimitScope | undefined;
  // True only on the request that first crossed the limit in this window.
  isFirstRejectionInWindow?: boolean | undefined;
}

export interface LicenseServerRateLimitBucketConfig {
  windowSeconds: number;
  perLicenseKeyLimit: number;
  perIpLimit: number;
}

interface BucketDefaults {
  envPrefix: string;
  windowSeconds: number;
  perLicenseKeyLimit: number;
  perIpLimit: number;
}

const BUCKET_DEFAULTS: Record<LicenseServerRateLimitBucket, BucketDefaults> = {
  /*
   * Activation, the "refresh license" button, and a refresh at boot when the
   * stored token is unverified - so a rolling restart of a large install can
   * validate once per pod.
   */
  [LicenseServerRateLimitBucket.Validate]: {
    envPrefix: "ENTERPRISE_LICENSE_VALIDATE_RATE_LIMIT",
    windowSeconds: 15 * 60,
    perLicenseKeyLimit: 30,
    perIpLimit: 120,
  },
  /*
   * One report per installation per day. The ceiling covers up to a hundred
   * instances of one license (EnterpriseLicenseAPI's MAX_INSTANCES_PER_LICENSE)
   * reporting in the same window, plus retries.
   */
  [LicenseServerRateLimitBucket.ReportUserCount]: {
    envPrefix: "ENTERPRISE_LICENSE_REPORT_USER_COUNT_RATE_LIMIT",
    windowSeconds: 15 * 60,
    perLicenseKeyLimit: 150,
    perIpLimit: 300,
  },
};

const KEY_PREFIX: string = "license-server:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

// Bounds a Redis key built from caller-supplied values.
const MAX_KEY_SEGMENT_LENGTH: number = 64;

// Hex characters of the license key's SHA-256 kept in the counter key.
const LICENSE_KEY_HASH_LENGTH: number = 32;

const UNSAFE_KEY_SEGMENT_CHARACTERS: RegExp = /[^a-zA-Z0-9._:%\-[\]]/g;

// How often the "counter unavailable" condition may be logged, per bucket.
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

const readPositiveIntFromEnv: (envKey: string, fallback: number) => number = (
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

type RateLimitMiddleware = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

export default class LicenseServerRateLimit {
  private static middlewares: Map<
    LicenseServerRateLimitBucket,
    RateLimitMiddleware
  > = new Map();

  private static counterUnavailableLastLoggedAt: Map<
    LicenseServerRateLimitBucket,
    number
  > = new Map();

  public static getBucketConfig(
    bucket: LicenseServerRateLimitBucket,
  ): LicenseServerRateLimitBucketConfig {
    const defaults: BucketDefaults = BUCKET_DEFAULTS[bucket];

    return {
      windowSeconds: readPositiveIntFromEnv(
        `${defaults.envPrefix}_WINDOW_SECONDS`,
        defaults.windowSeconds,
      ),
      perLicenseKeyLimit: readPositiveIntFromEnv(
        `${defaults.envPrefix}_PER_LICENSE_KEY_PER_WINDOW`,
        defaults.perLicenseKeyLimit,
      ),
      perIpLimit: readPositiveIntFromEnv(
        `${defaults.envPrefix}_PER_IP_PER_WINDOW`,
        defaults.perIpLimit,
      ),
    };
  }

  /*
   * The client address to bill this request to, from the trusted end of
   * X-Forwarded-For. Everything with no resolvable address shares one bucket.
   */
  public static resolveClientIp(req: ExpressRequest): string {
    const clientIp: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (!clientIp) {
      return "unknown";
    }

    return clientIp
      .slice(0, MAX_KEY_SEGMENT_LENGTH)
      .replace(UNSAFE_KEY_SEGMENT_CHARACTERS, "_");
  }

  /*
   * The license key the request names, as a hash. The license key is a
   * credential: it is never written to Redis or a log in the clear. A body
   * with no usable key shares the "none" bucket (the handler rejects it).
   */
  public static resolveLicenseKeyHash(req: ExpressRequest): string {
    const body: Record<string, unknown> | undefined = req.body as
      | Record<string, unknown>
      | undefined;
    const licenseKey: unknown = body?.["licenseKey"];

    if (typeof licenseKey !== "string" || licenseKey.trim().length === 0) {
      return "none";
    }

    return crypto
      .createHash("sha256")
      .update(licenseKey.trim(), "utf8")
      .digest("hex")
      .substring(0, LICENSE_KEY_HASH_LENGTH);
  }

  /*
   * Increments both counters and decides. Both INCRs go out in one pipeline;
   * the EXPIRE follow-up is sent only by the request that created a key, so
   * the window never slides forward under sustained load.
   */
  public static async consume(data: {
    bucket: LicenseServerRateLimitBucket;
    licenseKeyHash: string;
    clientIp: string;
  }): Promise<LicenseServerRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: LicenseServerRateLimitOutcome.CounterUnavailable };
    }

    const config: LicenseServerRateLimitBucketConfig =
      LicenseServerRateLimit.getBucketConfig(data.bucket);
    const windowMs: number = config.windowSeconds * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);

    const licenseKeyCounterKey: string = `${KEY_PREFIX}${data.bucket}:k:${data.licenseKeyHash}:${data.clientIp}:${windowIndex}`;
    const ipCounterKey: string = `${KEY_PREFIX}${data.bucket}:i:${data.clientIp}:${windowIndex}`;

    try {
      const pipelineResults: Array<[Error | null, unknown]> | null =
        (await client
          .pipeline()
          .incr(licenseKeyCounterKey)
          .incr(ipCounterKey)
          .exec()) as Array<[Error | null, unknown]> | null;

      if (!pipelineResults || pipelineResults.length < 2) {
        throw new Error("Rate limit pipeline returned no result");
      }

      const licenseKeyCount: number = LicenseServerRateLimit.readCounterResult(
        pipelineResults[0],
      );
      const ipCount: number = LicenseServerRateLimit.readCounterResult(
        pipelineResults[1],
      );

      const keysToExpire: Array<string> = [];

      if (licenseKeyCount === 1) {
        keysToExpire.push(licenseKeyCounterKey);
      }

      if (ipCount === 1) {
        keysToExpire.push(ipCounterKey);
      }

      if (keysToExpire.length > 0) {
        const expirePipeline: ReturnType<ClientType["pipeline"]> =
          client.pipeline();

        for (const key of keysToExpire) {
          expirePipeline.expire(key, config.windowSeconds * TTL_MULTIPLIER);
        }

        await expirePipeline.exec();
      }

      const retryAfterSeconds: number =
        LicenseServerRateLimit.getSecondsUntilWindowEnd(config.windowSeconds);

      if (licenseKeyCount > config.perLicenseKeyLimit) {
        return {
          outcome: LicenseServerRateLimitOutcome.RateLimited,
          retryAfterSeconds,
          scope: LicenseServerRateLimitScope.LicenseKey,
          isFirstRejectionInWindow:
            licenseKeyCount === config.perLicenseKeyLimit + 1,
        };
      }

      if (ipCount > config.perIpLimit) {
        return {
          outcome: LicenseServerRateLimitOutcome.RateLimited,
          retryAfterSeconds,
          scope: LicenseServerRateLimitScope.Ip,
          isFirstRejectionInWindow: ipCount === config.perIpLimit + 1,
        };
      }

      return { outcome: LicenseServerRateLimitOutcome.Allowed };
    } catch (err) {
      if (LicenseServerRateLimit.shouldLogCounterUnavailable(data.bucket)) {
        logger.warn(
          `LicenseServerRateLimit: counter failed for ${data.bucket} request from ${data.clientIp}; letting it through.`,
        );
        logger.warn(err);
      }

      return { outcome: LicenseServerRateLimitOutcome.CounterUnavailable };
    }
  }

  /*
   * Express middleware for one bucket. The same function is returned for
   * every call with the same bucket, so a route's middleware list is stable.
   * Registered per route, first: a flood is refused before it costs a lock or
   * a database read.
   */
  public static getMiddleware(
    bucket: LicenseServerRateLimitBucket,
  ): RateLimitMiddleware {
    const existing: RateLimitMiddleware | undefined =
      LicenseServerRateLimit.middlewares.get(bucket);

    if (existing) {
      return existing;
    }

    const middleware: RateLimitMiddleware = async (
      req: ExpressRequest,
      res: ExpressResponse,
      next: NextFunction,
    ): Promise<void> => {
      const clientIp: string = LicenseServerRateLimit.resolveClientIp(req);

      const decision: LicenseServerRateLimitDecision =
        await LicenseServerRateLimit.consume({
          bucket,
          licenseKeyHash: LicenseServerRateLimit.resolveLicenseKeyHash(req),
          clientIp,
        });

      if (decision.outcome === LicenseServerRateLimitOutcome.RateLimited) {
        if (decision.retryAfterSeconds) {
          LicenseServerRateLimit.setRetryAfterHeader(
            res,
            decision.retryAfterSeconds,
          );
        }

        if (decision.isFirstRejectionInWindow) {
          logger.warn(
            `LicenseServerRateLimit: rejecting ${bucket} requests from ${clientIp} (${decision.scope} limit).`,
          );
        }

        return Response.sendErrorResponse(
          req,
          res,
          new TooManyRequestsException(
            "Too many license requests from this address. Please try again later.",
          ),
        );
      }

      if (
        decision.outcome === LicenseServerRateLimitOutcome.CounterUnavailable &&
        LicenseServerRateLimit.shouldLogCounterUnavailable(bucket)
      ) {
        logger.warn(
          `LicenseServerRateLimit: the rate limit counter is unavailable; ${bucket} requests are not being limited.`,
        );
      }

      return next();
    };

    LicenseServerRateLimit.middlewares.set(bucket, middleware);

    return middleware;
  }

  // Test suites only: reset the log throttle.
  public static resetForTests(): void {
    LicenseServerRateLimit.counterUnavailableLastLoggedAt.clear();
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

  private static getSecondsUntilWindowEnd(windowSeconds: number): number {
    const windowMs: number = windowSeconds * 1000;
    const msIntoWindow: number = Date.now() % windowMs;

    return Math.max(1, Math.ceil((windowMs - msIntoWindow) / 1000));
  }

  private static shouldLogCounterUnavailable(
    bucket: LicenseServerRateLimitBucket,
  ): boolean {
    const now: number = Date.now();
    const lastLoggedAt: number =
      LicenseServerRateLimit.counterUnavailableLastLoggedAt.get(bucket) || 0;

    if (now - lastLoggedAt < COUNTER_UNAVAILABLE_LOG_INTERVAL_MS) {
      return false;
    }

    LicenseServerRateLimit.counterUnavailableLastLoggedAt.set(bucket, now);

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
