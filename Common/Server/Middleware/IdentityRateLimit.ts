import Redis, { ClientType } from "../Infrastructure/Redis";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../Utils/ClientIp";
import Response from "../Utils/Response";
import ServiceUnavailableException from "../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";

/*
 * Attempt limiting for the anonymous identity routes that accept a
 * credential: POST /login, POST /verify-totp-auth, POST /verify-webauthn-auth
 * and POST /verify-totp-enrolment
 * (App/FeatureSet/Identity/API/Authentication.ts).
 *
 * WHY THESE ROUTES NEED IT
 *
 * All three are unauthenticated by definition -- they are how a session is
 * obtained -- so nothing upstream of them counts anything. Until this
 * middleware existed a caller could submit credentials to them as fast as the
 * process would answer.
 *
 * /verify-totp-auth is the sharpest case. It is reached with a valid password
 * already in hand, and the only thing left to produce is a six digit code, so
 * unthrottled it is an online guessing oracle against a 10^6 space. The space
 * is not even 10^6 wide at any given instant: Common/Server/Utils/TotpAuth.ts
 * accepts TotpValidationWindow = 3 steps either side of now (seven 30 second
 * steps, +/- 90 seconds) across both entries in SupportedTotpAlgorithms, so
 * fourteen distinct six digit strings are live at once and a single guess
 * lands with probability ~1.4e-5. At a few thousand requests a second that is
 * a bypassed second factor in minutes. Bounded to the budgets below it is
 * years, and the account owner sees the failures.
 *
 * /login is the same shape one step earlier, against a password rather than a
 * code.
 *
 * /verify-webauthn-auth and /verify-totp-enrolment are covered for a reason
 * that holds whatever their own factor is worth. All four routes share one
 * `login()` function and all of them run the same `verifyHashedColumnValue`
 * before they reach their factor, so each is a password oracle in its own
 * right. Leaving any one of them unlimited would not be an unguarded route so
 * much as a hole in the fence: an attacker refused at /login points the same
 * guesses at whichever sibling still answers. The enrolment route makes that
 * concrete -- guessing its CODE is pointless, because /login hands the user
 * the secret it is derived from, but guessing the PASSWORD it demands first is
 * exactly as useful there as anywhere else.
 *
 * CAPTCHA IS NOT THIS
 *
 * /login already calls CaptchaUtil.verifyCaptcha, but that is not a
 * substitute on either axis. CAPTCHA_ENABLED is off by default, so a
 * self-hosted instance has nothing there at all; and an hCaptcha token is
 * single use, which is exactly why the second step of a login cannot demand
 * one -- /verify-totp-auth deliberately does not, and could not.
 *
 * THIS FAILS CLOSED
 *
 * With Redis unreachable these routes answer 503 rather than running
 * unthrottled. That is the choice PublicDashboardRateLimit makes for
 * /master-password and the opposite of the one VerificationCodeRateLimit
 * makes, and the deciding question is the same in all three: is there another
 * control still standing? Here there is not. Nothing in Postgres counts login
 * attempts, so serving the route without the counter means serving the
 * unlimited guessing oracle this middleware exists to close.
 *
 * It also costs nothing in availability that was not already lost. A
 * successful login goes through AccessTokenService.refreshUserAllPermissions,
 * which writes the user's permissions to GlobalCache, which throws
 * DatabaseNotConnectedException when Redis is down. Logging in is already
 * impossible in that state; the difference this makes is a 503 that says to
 * come back shortly instead of a 500.
 */

/*
 * Every request consumes TWO counters, and either one can reject it:
 *
 *  - the account counter, keyed on the submitted email address AND the client
 *    address. This is the budget one person gets for one account.
 *
 *  - the address counter, keyed on the client address alone. Without it the
 *    account counter is trivially bypassed: the email address is a field in
 *    the request body, so a caller who changes it on every request lands in a
 *    fresh bucket every time. Against /verify-totp-auth that matters
 *    enormously -- a code guessed against ANY account is a bypassed second
 *    factor, the attacker does not care whose. The address counter is the
 *    ceiling that survives email rotation.
 *
 * Deliberately NOT keyed on the email address alone. A bare per-account
 * counter is a lockout weapon: anyone who knows a victim's email address
 * could burn that account's whole budget from anywhere and keep the real
 * owner out for as long as they cared to keep sending. Pairing the address
 * in means an attacker can only spend their own bucket.
 *
 * The cost of that pairing, stated plainly: an attacker with many source
 * addresses gets a fresh per-account budget from each one, so a distributed
 * attack on a single account is bounded only by how many addresses they have.
 * That is the standard trade and it is the right way round -- the alternative
 * hands every user a remote lockout button, and the distributed case is what
 * the account owner's own failed-login visibility and the network layer are
 * for.
 *
 * Both counters are incremented on every request including a rejected one.
 * That is standard fixed-window behaviour and it is deliberate: a caller who
 * keeps hammering keeps their window pinned rather than being handed a fresh
 * allowance for free.
 */
export enum IdentityRateLimitBucket {
  /* POST /login. Password guessing. */
  Login = "login",

  /*
   * POST /verify-totp-auth, POST /verify-webauthn-auth and
   * POST /verify-totp-enrolment -- the second step, reached with a valid
   * password already accepted.
   */
  TwoFactor = "two-factor",

  /*
   * POST /verify-backup-code -- the recovery step. Its own counter, because
   * every caller of it has just failed at the factor above and must not find
   * the recovery route already spent. See BACKUP_CODE_BUCKET.
   */
  BackupCode = "backup-code",
}

export enum IdentityRateLimitScope {
  /* One email address, from one client address. */
  Account = "account",

  /* One client address, across every account. Survives email rotation. */
  Ip = "ip",
}

export enum IdentityRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  /* Redis is unreachable, so no limit can be honoured either way. */
  CounterUnavailable = "counter-unavailable",
}

export interface IdentityRateLimitDecision {
  outcome: IdentityRateLimitOutcome;
  retryAfterSeconds?: number | undefined;

  /* Which counter rejected, for logs. Unset unless rejected. */
  scope?: IdentityRateLimitScope | undefined;

  /*
   * True only on the request that first crossed the line in this window.
   *
   * The point of a limiter is that the caller keeps knocking, so logging
   * every refusal turns a flood into a second flood in the log pipeline --
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
  perAccountLimit: number;
  perIpLimit: number;
}

/*
 * Password budget.
 *
 * Ten attempts per quarter hour for one account from one address. A person
 * who has forgotten which of their passwords this is tries three or four and
 * then uses the reset link; ten is comfortably past that and still turns
 * "as fast as the process answers" into forty an hour.
 *
 * The per-address ceiling is set for the honest worst case rather than the
 * typical one, because a corporate NAT puts a whole office behind a single
 * address and a morning sign-in surge must not be refused. 150 a quarter hour
 * covers that while still bounding a caller who rotates email addresses to
 * fifteen accounts' worth of attempts -- and it is the number an operator
 * most likely wants to lower, which is what the environment variable is for.
 * A limiter that fires on real users gets switched off, and a switched-off
 * limiter bounds nothing.
 */
const LOGIN_BUCKET: BucketConfig = {
  windowSeconds: parsePositiveIntFromEnv(
    "IDENTITY_LOGIN_RATE_LIMIT_WINDOW_SECONDS",
    15 * 60,
  ),
  perAccountLimit: parsePositiveIntFromEnv(
    "IDENTITY_LOGIN_RATE_LIMIT_PER_ACCOUNT_PER_WINDOW",
    10,
  ),
  perIpLimit: parsePositiveIntFromEnv(
    "IDENTITY_LOGIN_RATE_LIMIT_PER_IP_PER_WINDOW",
    150,
  ),
};

/*
 * Second step budget.
 *
 * Same shape as the password bucket, and the same numbers, for a different
 * reason: the code is read off a screen rather than recalled, so ten wrong
 * ones in a quarter hour is already well past anything a real user does --
 * a phone whose clock has drifted past the +/- 90 second window fails every
 * time, and no number of retries fixes that.
 *
 * Kept as a SEPARATE bucket from the password one rather than a shared pool,
 * which does mean a caller gets both budgets in a window. That is the price of
 * the property that matters more: a burst of /login noise must not be able to
 * refuse a user who is midway through finishing a two factor login, and a user
 * being marched through a mandated enrolment must not be locked out of it by
 * the /login attempt that sent them there.
 *
 * What ten buys against guessing: fourteen of the 10^6 codes are live at any
 * instant, so forty guesses an hour is a ~0.06% chance of landing one in a
 * day and about a year to reach even odds -- against an attacker who holds
 * the account's password for that entire year and generates a visible failed
 * attempt every ninety seconds throughout.
 */
const TWO_FACTOR_BUCKET: BucketConfig = {
  windowSeconds: parsePositiveIntFromEnv(
    "IDENTITY_TWO_FACTOR_RATE_LIMIT_WINDOW_SECONDS",
    15 * 60,
  ),
  perAccountLimit: parsePositiveIntFromEnv(
    "IDENTITY_TWO_FACTOR_RATE_LIMIT_PER_ACCOUNT_PER_WINDOW",
    10,
  ),
  perIpLimit: parsePositiveIntFromEnv(
    "IDENTITY_TWO_FACTOR_RATE_LIMIT_PER_IP_PER_WINDOW",
    150,
  ),
};

/*
 * Recovery budget.
 *
 * The same numbers again, and a SEPARATE counter again -- and this one is the
 * separation that matters most, because of who is standing in front of it.
 *
 * Everybody who reaches /verify-backup-code has already failed at the factor
 * they normally use. That is the entire premise of the route. Sharing the
 * second-step counter therefore inverted its purpose exactly: a user whose
 * authenticator app was showing codes from a drifted clock would burn all ten
 * attempts on it, and the recovery route -- the one thing that could still let
 * them in -- would answer "too many attempts" before it ever looked at the
 * code they were holding. The recovery path cannot be spent by failures on the
 * path it exists to recover from.
 *
 * The limit is not what stops guessing here; the code is. Ten characters over
 * a 32 symbol alphabet is 2^50, so a caller holding the password guesses one
 * of a user's ten live codes with probability around 1e-14 per attempt. Ten
 * per quarter hour is a backstop against the route being used as a password
 * oracle -- it re-verifies email and password like its siblings -- rather than
 * a defence of the codes themselves.
 */
const BACKUP_CODE_BUCKET: BucketConfig = {
  windowSeconds: parsePositiveIntFromEnv(
    "IDENTITY_BACKUP_CODE_RATE_LIMIT_WINDOW_SECONDS",
    15 * 60,
  ),
  perAccountLimit: parsePositiveIntFromEnv(
    "IDENTITY_BACKUP_CODE_RATE_LIMIT_PER_ACCOUNT_PER_WINDOW",
    10,
  ),
  perIpLimit: parsePositiveIntFromEnv(
    "IDENTITY_BACKUP_CODE_RATE_LIMIT_PER_IP_PER_WINDOW",
    150,
  ),
};

const KEY_PREFIX: string = "identity:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

/* Bounds a Redis key built from caller-supplied values. */
const MAX_KEY_SEGMENT_LENGTH: number = 64;

/* How often the "counter unavailable" condition may be logged, per bucket. */
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export default class IdentityRateLimit {
  /*
   * The client address to bill this request to.
   *
   * Delegates to the shared ClientIp helper, which reads X-Forwarded-For from
   * the trusted (right-hand) end under the instance-wide TRUSTED_PROXY_HOPS
   * setting. Deliberately NOT Express.getClientIp: that one takes the LEFTMOST
   * entry, which any caller can set by sending its own X-Forwarded-For header,
   * and for a rate limiter that is fatal -- a fresh spoofed value per request
   * is a fresh bucket per request and therefore no limit at all.
   *
   * The helper also normalizes ports, brackets and IPv4-mapped IPv6, so one
   * caller cannot land in two different buckets depending on the form their
   * address arrives in.
   */
  public static resolveClientIp(req: ExpressRequest): string {
    const clientIp: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (clientIp) {
      return IdentityRateLimit.sanitizeKeySegment(clientIp);
    }

    /*
     * Everything with no resolvable address shares one bucket. That is the
     * conservative direction: an unidentifiable caller should not be handed a
     * private allowance.
     */
    return "unknown";
  }

  /*
   * The account this request is trying to authenticate as, as a key segment.
   *
   * The login page posts everything nested under `data` (see
   * App/FeatureSet/Accounts/src/Pages/Login.tsx), which is where all four
   * routes read the credentials from; the top level is checked too so that a
   * caller posting the flatter shape is still counted rather than silently
   * sharing the "none" bucket with everybody else.
   *
   * `email` ARRIVES IN TWO SHAPES, AND BOTH ARE FIRST-PARTY
   *
   * A bare string, and the serialized SerializableObject envelope
   * `{ _type: "Email", value: "..." }` that Email.toJSON produces. Which one
   * turns up depends on how the caller was written, and the shipped clients
   * disagree with each other on the very routes limited here:
   *
   *   - POST /login from the dashboard goes through ModelForm, which hands the
   *     model to ModelAPI.createOrUpdate, which sends
   *     JSONFunctions.serialize(BaseModel.toJSON(...)) -- the ENVELOPE.
   *   - POST /login from the mobile app hand-builds the same envelope
   *     (MobileApp/src/api/auth.ts).
   *   - POST /verify-totp-auth, /verify-totp-enrolment and
   *     /verify-webauthn-auth from the dashboard spread the raw form values
   *     (`...initialValues`), so there `email` is a bare STRING.
   *
   * The handler does not care, because BaseModel.fromJSON resolves both to the
   * same address -- so this must not care either. Reading only the string form
   * would put every /login from every shipped client into the shared "none"
   * bucket, which is not a small mistake in either direction: the per-account
   * counter would degenerate into a SECOND per-address counter at the much
   * tighter per-account limit, refusing a whole office (or a carrier NAT) after
   * ten sign-ins rather than the hundred and fifty the per-address ceiling is
   * deliberately sized for; and, because the two shapes would key differently,
   * an attacker could take the per-account budget twice by alternating them.
   *
   * The unwrap is deliberately not gated on `_type` being exactly Email. Any
   * object carrying a string `value` is keyed by that value, which is the safe
   * direction: the worst case is counting a request the handler will reject
   * anyway against the bucket it names, whereas gating narrowly leaves another
   * shape sitting in "none" for someone to spend.
   *
   * Lower-cased, because otherwise Bob@example.com and bob@example.com are
   * two buckets for one account and case alone buys a fresh allowance. No
   * attempt is made to validate the address: a well-formed one that belongs
   * to nobody is worth exactly as much to an attacker as a malformed one, so
   * there is nothing for a format check to separate. Normalizing is the part
   * that matters.
   */
  public static resolveAccountKey(req: ExpressRequest): string {
    const body: Record<string, unknown> | undefined = req.body as
      | Record<string, unknown>
      | undefined;

    const data: Record<string, unknown> | undefined =
      body && typeof body["data"] === "object" && body["data"] !== null
        ? (body["data"] as Record<string, unknown>)
        : undefined;

    const field: unknown = data?.["email"] ?? body?.["email"];

    /*
     * Arrays are typeof "object" too, and indexing one by "value" is
     * undefined rather than a throw -- but excluding them keeps the intent
     * legible and stops a caller smuggling anything odd through.
     */
    const raw: unknown =
      field && typeof field === "object" && !Array.isArray(field)
        ? (field as Record<string, unknown>)["value"]
        : field;

    /*
     * `email` is whatever JSON the caller sent, so it is only a string
     * because they chose to make it one. A number, a nested object or a
     * missing field must land in a bucket rather than throw.
     */
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return "none";
    }

    return IdentityRateLimit.sanitizeKeySegment(raw.trim().toLowerCase());
  }

  private static sanitizeKeySegment(value: string): string {
    return (
      value
        .slice(0, MAX_KEY_SEGMENT_LENGTH)
        /*
         * Redis keys are binary safe, but a predictable charset keeps
         * operational tooling (SCAN patterns, dashboards) sane.
         */
        .replace(/[^a-zA-Z0-9._:%\-[\]@]/g, "_")
    );
  }

  public static getBucketConfig(bucket: IdentityRateLimitBucket): BucketConfig {
    if (bucket === IdentityRateLimitBucket.TwoFactor) {
      return TWO_FACTOR_BUCKET;
    }

    if (bucket === IdentityRateLimitBucket.BackupCode) {
      return BACKUP_CODE_BUCKET;
    }

    return LOGIN_BUCKET;
  }

  /*
   * Increment both counters for this request and decide.
   *
   * Both INCRs go out in one pipeline so the common path costs a single round
   * trip; the EXPIRE follow-ups only happen on the request that created a key.
   */
  public static async consume(data: {
    accountKey: string;
    clientIp: string;
    bucket: IdentityRateLimitBucket;
  }): Promise<IdentityRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: IdentityRateLimitOutcome.CounterUnavailable };
    }

    const config: BucketConfig = IdentityRateLimit.getBucketConfig(data.bucket);

    const windowMs: number = config.windowSeconds * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);

    const accountCounterKey: string = `${KEY_PREFIX}${data.bucket}:a:${data.accountKey}:${data.clientIp}:${windowIndex}`;
    const ipCounterKey: string = `${KEY_PREFIX}${data.bucket}:i:${data.clientIp}:${windowIndex}`;

    try {
      const pipelineResults: Array<[Error | null, unknown]> | null =
        (await client
          .pipeline()
          .incr(accountCounterKey)
          .incr(ipCounterKey)
          .exec()) as Array<[Error | null, unknown]> | null;

      if (!pipelineResults || pipelineResults.length < 2) {
        throw new Error("Rate limit pipeline returned no result");
      }

      const accountCount: number = IdentityRateLimit.readCounterResult(
        pipelineResults[0],
      );
      const ipCount: number = IdentityRateLimit.readCounterResult(
        pipelineResults[1],
      );

      /*
       * Set the expiry only on the write that created the key. Re-issuing
       * EXPIRE on every increment would slide the window forward for as long
       * as the attempts continue, so the counter would never reset and a
       * caller who tripped the limit once could never recover -- which on a
       * login route is a permanent lockout, not a slowdown.
       */
      const ttlSeconds: number = config.windowSeconds * TTL_MULTIPLIER;
      const keysToExpire: Array<string> = [];

      if (accountCount === 1) {
        keysToExpire.push(accountCounterKey);
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
        IdentityRateLimit.getSecondsUntilWindowEnd(config.windowSeconds);

      /*
       * The account counter is reported first when both are over, because it
       * is the more specific of the two and the more useful thing to see in a
       * log line.
       */
      if (accountCount > config.perAccountLimit) {
        return {
          outcome: IdentityRateLimitOutcome.RateLimited,
          retryAfterSeconds,
          scope: IdentityRateLimitScope.Account,
          isFirstRejectionInWindow: accountCount === config.perAccountLimit + 1,
        };
      }

      if (ipCount > config.perIpLimit) {
        return {
          outcome: IdentityRateLimitOutcome.RateLimited,
          retryAfterSeconds,
          scope: IdentityRateLimitScope.Ip,
          isFirstRejectionInWindow: ipCount === config.perIpLimit + 1,
        };
      }

      return { outcome: IdentityRateLimitOutcome.Allowed };
    } catch (err) {
      /*
       * Throttled: whatever broke Redis is unlikely to have broken it for one
       * request only, and a per-request log line buries the incident it is
       * reporting.
       */
      if (IdentityRateLimit.shouldLogCounterUnavailable(data.bucket)) {
        logger.warn(
          `IdentityRateLimit: counter failed for ${data.bucket} request from ${data.clientIp}`,
        );
        logger.warn(err);
      }

      return { outcome: IdentityRateLimitOutcome.CounterUnavailable };
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
   * Express middleware. Registered as the first handler on each credential
   * route, so a flood is refused before it costs a user lookup -- and, on the
   * password routes, before it costs the bcrypt verify that makes each guess
   * expensive for us as well as for the attacker.
   */
  public static getMiddleware(
    bucket: IdentityRateLimitBucket,
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
      const accountKey: string = IdentityRateLimit.resolveAccountKey(req);
      const clientIp: string = IdentityRateLimit.resolveClientIp(req);

      const decision: IdentityRateLimitDecision =
        await IdentityRateLimit.consume({
          accountKey,
          clientIp,
          bucket,
        });

      if (decision.outcome === IdentityRateLimitOutcome.RateLimited) {
        if (decision.retryAfterSeconds) {
          IdentityRateLimit.setRetryAfterHeader(
            res,
            decision.retryAfterSeconds,
          );
        }

        if (decision.isFirstRejectionInWindow) {
          logger.warn(
            `IdentityRateLimit: rejected ${bucket} attempt for ${accountKey} from ${clientIp} (${decision.scope} limit)`,
          );
        }

        /*
         * The same message whichever counter fired, and whether or not the
         * account exists. These routes are careful not to say which half of a
         * credential was wrong; a limiter that answered differently for a real
         * address than for an invented one would hand back the account
         * enumeration the handlers withhold.
         */
        return Response.sendErrorResponse(
          req,
          res,
          new TooManyRequestsException(
            "Too many sign-in attempts. Please try again later.",
          ),
        );
      }

      if (decision.outcome === IdentityRateLimitOutcome.CounterUnavailable) {
        /*
         * Fails closed. See the note at the top of this file: the counter is
         * the only thing bounding guesses on these routes, and a login cannot
         * complete without Redis anyway.
         */
        if (IdentityRateLimit.shouldLogCounterUnavailable(bucket)) {
          logger.error(
            `IdentityRateLimit: rate limit counter unavailable, refusing ${bucket} attempts`,
          );
        }

        return Response.sendErrorResponse(
          req,
          res,
          new ServiceUnavailableException(
            "Unable to sign you in right now. Please try again shortly.",
          ),
        );
      }

      return next();
    };
  }

  /*
   * A Redis outage means EVERY request takes the unavailable path, so an
   * unguarded log line there is one per request for as long as the outage
   * lasts -- the same log-flooding problem the crossing-only rejection log
   * avoids, but continuous. One line per bucket per interval is enough to
   * make the condition visible without burying everything else.
   */
  private static shouldLogCounterUnavailable(
    bucket: IdentityRateLimitBucket,
  ): boolean {
    const now: number = Date.now();
    const lastLoggedAt: number =
      IdentityRateLimit.counterUnavailableLastLoggedAt.get(bucket) || 0;

    if (now - lastLoggedAt < COUNTER_UNAVAILABLE_LOG_INTERVAL_MS) {
      return false;
    }

    IdentityRateLimit.counterUnavailableLastLoggedAt.set(bucket, now);

    return true;
  }

  private static counterUnavailableLastLoggedAt: Map<
    IdentityRateLimitBucket,
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
