import Redis, { ClientType } from "../Infrastructure/Redis";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../Utils/ClientIp";
import ClientRateLimitCounter, {
  ClientRateLimitRefusal,
} from "../Utils/RateLimit/ClientRateLimitCounter";
import Response from "../Utils/Response";
import ObjectID from "../../Types/ObjectID";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";

/*
 * Request limiting for the notification-channel verification routes:
 * /user-email/verify, /user-sms/verify, /user-call/verify,
 * /user-whats-app/verify, /user-incoming-call-number/verify and each of their
 * resend siblings - and for adding a method of one of those channels, which
 * sends its first code at once (checkAddAllowed).
 *
 * WHAT THIS IS FOR, GIVEN THE DATABASE ALREADY COUNTS ATTEMPTS
 *
 * The durable controls in ChannelVerification bound guessing against ONE
 * issued code: five attempts, then the code is burned. This middleware bounds
 * the things a per-row counter cannot see.
 *
 *   ROW ROTATION. Nothing stops a caller creating a hundred channel rows —
 *   that is the ordinary "add my phone" flow — and each new row is a fresh
 *   code with a fresh attempt budget. Five guesses per row multiplied by
 *   however many rows the caller cares to create is not bounded by anything
 *   on the row. The per-user and per-address counters are.
 *
 *   MESSAGE VOLUME. Every issued code is a real email, SMS, voice call or
 *   WhatsApp message to somebody who did not ask for it, billed to the
 *   project. The resend bucket bounds that independently of whether any
 *   individual row is inside its own cooldown, and the add bucket bounds the
 *   first codes: adding a number, removing it and adding it again sends a
 *   code each time, from a new row with no cooldown of its own.
 *
 *   COST BEFORE THE CHECK. A verify request costs a session lookup and a row
 *   read before the attempt counter is even consulted. This runs first.
 *
 * THIS FAILS OPEN, DELIBERATELY
 *
 * If Redis is unreachable, requests are allowed through with a throttled
 * warning. That is the opposite of the choice PublicDashboardRateLimit makes
 * for /master-password, and the difference is that there the counter IS the
 * only thing bounding guesses, whereas here the expiry, the attempt counter,
 * the rotation and the resend cooldown all live in Postgres and are all still
 * in force. Failing closed would mean nobody can verify a new phone number
 * during a Redis blip, in exchange for a control that is at that moment
 * redundant with four others.
 */

export enum VerificationCodeRateLimitBucket {
  /* Submitting a code. The guessing surface. */
  Verify = "verify",

  /* Asking for a new code. The spending-somebody-else's-attention surface. */
  Resend = "resend",

  /*
   * Adding a method, which sends its first code: the same message a resend
   * sends, from a fresh row each time.
   */
  Add = "add",
}

export enum VerificationCodeRateLimitScope {
  /* One channel row, for one user. */
  Item = "item",

  /* One signed-in user, across every row they own. Survives row rotation. */
  User = "user",

  /*
   * One client address, across every account. Survives account rotation.
   * For an IPv6 client its /64 is counted as well, with room for ten
   * addresses (ClientRateLimitCounter), so it survives address rotation too.
   */
  Ip = "ip",
}

export enum VerificationCodeRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  /* Redis is unreachable, so no limit can be honoured either way. */
  CounterUnavailable = "counter-unavailable",
}

export interface VerificationCodeRateLimitDecision {
  outcome: VerificationCodeRateLimitOutcome;
  retryAfterSeconds?: number | undefined;

  /* Which counter rejected, for logs. Unset unless rejected. */
  scope?: VerificationCodeRateLimitScope | undefined;

  /*
   * The client's IPv6 /64 when the addresses of that /64 together went over
   * the per-address limit, rather than the client's own address. For logs.
   */
  ipv6Network64?: string | undefined;

  /*
   * True only on the request that first crossed the line in this window, so a
   * flood produces one log line per key per window rather than one per
   * request.
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
  perItemLimit: number;
  perUserLimit: number;
  perIpLimit: number;
}

/*
 * Verify budget, over a window matching the code's own lifetime.
 *
 * Per item is 10 against a per-code attempt limit of 5, so it never fires
 * before the durable counter does for a single honest code — it is there to
 * bound the requests that arrive after the row is already locked out.
 *
 * Per user is the one that closes row rotation: 50 submissions per quarter
 * hour across every channel row the account owns. A person adding a phone
 * number and mistyping the code a few times is nowhere near it; a script
 * creating rows to farm attempt budgets hits it after ten rows.
 *
 * Per address is higher than per user because a corporate NAT can put a whole
 * office behind one address, and several colleagues onboarding at once is a
 * real thing that must not be refused.
 */
const VERIFY_BUCKET: BucketConfig = {
  windowSeconds: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_RATE_LIMIT_WINDOW_SECONDS",
    15 * 60,
  ),
  perItemLimit: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_RATE_LIMIT_PER_ITEM_PER_WINDOW",
    10,
  ),
  perUserLimit: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_RATE_LIMIT_PER_USER_PER_WINDOW",
    50,
  ),
  perIpLimit: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_RATE_LIMIT_PER_IP_PER_WINDOW",
    150,
  ),
};

/*
 * Resend budget. Tighter than verify, because each one of these is a message
 * that arrives on somebody's phone and a line on somebody's bill. The
 * per-item figure sits just above what the 60-second per-row cooldown allows
 * in the window, so an honest user pressing "resend" whenever the cooldown
 * lets them is never refused by this.
 */
const RESEND_BUCKET: BucketConfig = {
  windowSeconds: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_RESEND_RATE_LIMIT_WINDOW_SECONDS",
    15 * 60,
  ),
  perItemLimit: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_RESEND_RATE_LIMIT_PER_ITEM_PER_WINDOW",
    5,
  ),
  perUserLimit: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_RESEND_RATE_LIMIT_PER_USER_PER_WINDOW",
    15,
  ),
  perIpLimit: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_RESEND_RATE_LIMIT_PER_IP_PER_WINDOW",
    45,
  ),
};

/*
 * Add budget: the first codes. Adding an email address, an SMS, call or
 * WhatsApp number or an incoming call number sends its code at once - a
 * message on somebody's phone and a line on the project's bill, like a
 * resend, but from a new row, which has no cooldown of its own. An add's
 * "item" is the kind of method a person adds in one project (the channel
 * and the project): five numbers of one kind in a quarter of an hour is
 * more than anyone sets up, and lets a person mistype one several times.
 * Per person, twenty covers setting up every kind in several projects at
 * once - somebody on call for a handful of teams; per address it is the
 * verify budget's, because a whole office behind one NAT sets up its phones
 * together.
 */
const ADD_BUCKET: BucketConfig = {
  windowSeconds: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_ADD_RATE_LIMIT_WINDOW_SECONDS",
    15 * 60,
  ),
  perItemLimit: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_ADD_RATE_LIMIT_PER_CHANNEL_PER_WINDOW",
    5,
  ),
  perUserLimit: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_ADD_RATE_LIMIT_PER_USER_PER_WINDOW",
    20,
  ),
  perIpLimit: parsePositiveIntFromEnv(
    "NOTIFICATION_VERIFICATION_ADD_RATE_LIMIT_PER_IP_PER_WINDOW",
    150,
  ),
};

/*
 * What a refused request is told, by bucket. The same words whichever
 * counter refused it.
 */
const REFUSAL_MESSAGES: Record<VerificationCodeRateLimitBucket, string> = {
  [VerificationCodeRateLimitBucket.Verify]:
    "Too many verification attempts. Please try again later.",
  [VerificationCodeRateLimitBucket.Resend]:
    "Too many verification codes requested. Please try again later.",
  [VerificationCodeRateLimitBucket.Add]:
    "Too many notification methods added. Please try again later.",
};

const KEY_PREFIX: string = "notifverify:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

/* Bounds a Redis key built from caller-supplied values. */
const MAX_KEY_SEGMENT_LENGTH: number = 64;

/* How often the "counter unavailable" condition may be logged, per bucket. */
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export default class VerificationCodeRateLimit {
  /*
   * The client address to bill this request to.
   *
   * Uses the shared ClientIp helper, which reads X-Forwarded-For from the
   * trusted right-hand end. Express.getClientIp takes the LEFTMOST entry,
   * which the caller can set themselves — for a rate limiter that is fatal,
   * because a fresh spoofed value per request is a fresh bucket per request
   * and therefore no limit at all.
   */
  public static resolveClientIp(req: ExpressRequest): string {
    const clientIp: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (clientIp) {
      return VerificationCodeRateLimit.sanitizeKeySegment(clientIp);
    }

    /*
     * Everything with no resolvable address shares one bucket. That is the
     * conservative direction: an unidentifiable caller should not be handed a
     * private allowance.
     */
    return "unknown";
  }

  /*
   * The signed-in user this request belongs to.
   *
   * These routes all sit behind UserMiddleware, so in practice this is always
   * present. If it somehow is not, everything anonymous shares one bucket
   * rather than each getting its own.
   */
  public static resolveUserKey(req: ExpressRequest): string {
    const userId: ObjectID | undefined = (req as OneUptimeRequest)
      ?.userAuthorization?.userId;

    if (!userId) {
      return "anonymous";
    }

    return VerificationCodeRateLimit.sanitizeKeySegment(userId.toString());
  }

  /*
   * The channel row this request is about.
   *
   * Anything that is not a valid id collapses into one shared "invalid"
   * bucket. That bounds Redis memory against a caller feeding junk ids, and
   * it is the right grouping anyway: those requests cannot name a real row,
   * so one small shared allowance between all of them is what we want.
   */
  public static resolveItemKey(req: ExpressRequest): string {
    const raw: unknown = (req.body as Record<string, unknown> | undefined)?.[
      "itemId"
    ];

    if (typeof raw !== "string" || raw.trim().length === 0) {
      return "none";
    }

    const value: string = raw.trim();

    if (!ObjectID.isValidUUID(value)) {
      return "invalid";
    }

    return value.toLowerCase();
  }

  /*
   * The key an add is counted under: the channel's own path ("/user-sms")
   * and the project the request is made in, so each kind of method has its
   * own allowance in each project. Each part is bounded on its own, so a
   * long path never cuts the project id short.
   */
  public static resolveChannelKey(
    channel: string,
    projectId?: ObjectID | string | null | undefined,
  ): string {
    const project: string = projectId?.toString().trim().toLowerCase() || "";

    return `${VerificationCodeRateLimit.sanitizeKeySegment(
      `add${channel.trim().toLowerCase()}`,
    )}:${VerificationCodeRateLimit.sanitizeKeySegment(project || "none")}`;
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

  public static getBucketConfig(
    bucket: VerificationCodeRateLimitBucket,
  ): BucketConfig {
    if (bucket === VerificationCodeRateLimitBucket.Resend) {
      return RESEND_BUCKET;
    }

    if (bucket === VerificationCodeRateLimitBucket.Add) {
      return ADD_BUCKET;
    }

    return VERIFY_BUCKET;
  }

  /*
   * Increment all three counters for this request and decide.
   *
   * All three INCRs go out in one pipeline so the common path is a single
   * round trip; the EXPIRE follow-ups only happen on the request that created
   * a key.
   *
   * Every counter is incremented on every request, INCLUDING a rejected one.
   * That is standard fixed-window behaviour and it is deliberate: a caller
   * who keeps hammering keeps their window pinned rather than being handed a
   * fresh allowance for free. The one exception is an IPv6 client's /64
   * counter: it counts only the requests the other three let through, and a
   * /64 already over its limit is refused before anything is counted
   * (ClientRateLimitCounter).
   */
  public static async consume(data: {
    itemKey: string;
    userKey: string;
    clientIp: string;
    bucket: VerificationCodeRateLimitBucket;
  }): Promise<VerificationCodeRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: VerificationCodeRateLimitOutcome.CounterUnavailable };
    }

    const config: BucketConfig = VerificationCodeRateLimit.getBucketConfig(
      data.bucket,
    );

    const windowMs: number = config.windowSeconds * 1000;
    const windowIndex: number = Math.floor(Date.now() / windowMs);

    try {
      /*
       * Counted by ClientRateLimitCounter, all three in one round trip: the
       * item and the user as they are, and the client under its address -
       * and for an IPv6 client under its /64 as well, so rotating through
       * the addresses of one /64 does not buy a fresh per-address allowance
       * each time. Each key's expiry is set only by the request that
       * created it, so a window never slides forward under load.
       *
       * The item counter is keyed on item AND user. Two users cannot own the
       * same row, so this changes nothing about correctness — but it means a
       * caller cannot deny a row's real owner their allowance by burning it
       * against an id they do not own.
       *
       * Reported most specific first, because that is the most useful thing
       * to see in a log line when more than one is over.
       */
      const refusal: ClientRateLimitRefusal<VerificationCodeRateLimitScope> | null =
        await ClientRateLimitCounter.count<VerificationCodeRateLimitScope>({
          redis: client,
          clientIp: data.clientIp,
          ttlSeconds: config.windowSeconds * TTL_MULTIPLIER,
          fixedCounters: [
            {
              scope: VerificationCodeRateLimitScope.Item,
              key: `${KEY_PREFIX}${data.bucket}:t:${data.userKey}:${data.itemKey}:${windowIndex}`,
              limit: config.perItemLimit,
            },
            {
              scope: VerificationCodeRateLimitScope.User,
              key: `${KEY_PREFIX}${data.bucket}:u:${data.userKey}:${windowIndex}`,
              limit: config.perUserLimit,
            },
          ],
          counters: [
            {
              scope: VerificationCodeRateLimitScope.Ip,
              keyFor: (clientKey: string): string => {
                return `${KEY_PREFIX}${data.bucket}:i:${clientKey}:${windowIndex}`;
              },
              limit: config.perIpLimit,
            },
          ],
        });

      if (!refusal) {
        return { outcome: VerificationCodeRateLimitOutcome.Allowed };
      }

      return {
        outcome: VerificationCodeRateLimitOutcome.RateLimited,
        retryAfterSeconds: VerificationCodeRateLimit.getSecondsUntilWindowEnd(
          config.windowSeconds,
        ),
        scope: refusal.scope,
        ipv6Network64: refusal.ipv6Network64,
        isFirstRejectionInWindow: refusal.isFirstRefusalInWindow,
      };
    } catch (err) {
      /*
       * Throttled: whatever broke Redis is unlikely to have broken it for one
       * request only, and a per-request log line buries the incident it is
       * reporting.
       */
      if (VerificationCodeRateLimit.shouldLogCounterUnavailable(data.bucket)) {
        logger.warn(
          `VerificationCodeRateLimit: counter failed for ${data.bucket} request from user ${data.userKey}`,
        );
        logger.warn(err);
      }

      return { outcome: VerificationCodeRateLimitOutcome.CounterUnavailable };
    }
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
   * Express middleware. Register AFTER UserMiddleware — the user counter is
   * the one that closes row rotation, and it needs the session — but before
   * the route handler, so a flood is refused before it costs a row read.
   */
  public static getMiddleware(
    bucket: VerificationCodeRateLimitBucket,
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
      const refusal: TooManyRequestsException | null =
        await VerificationCodeRateLimit.countRequest({
          req: req,
          res: res,
          bucket: bucket,
          itemKey: VerificationCodeRateLimit.resolveItemKey(req),
        });

      if (refusal) {
        return Response.sendErrorResponse(req, res, refusal);
      }

      return next();
    };
  }

  /*
   * For adding a method of a channel that sends a code - the create route
   * of the email, SMS, call, WhatsApp and incoming call number APIs, through
   * their BaseAPI.onBeforeCreate: counts the add in the add bucket, under
   * the person, the channel in the request's project (resolveChannelKey) and
   * the client address, and throws a TooManyRequestsException over the
   * limit, with Retry-After set.
   *
   * The create route has no requireUserAuthentication of its own, so a
   * request that names no person is not counted at all: its create is
   * refused before anything is sent - an expired session with a 401 the
   * browser refreshes on, anything else by the create's own permission
   * check - and counting it would spend the shared budgets of everybody
   * without a session, or behind the same address, for a request that sends
   * nothing.
   */
  public static async checkAddAllowed(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    // The channel's CRUD path: "/user-sms".
    channel: string;
  }): Promise<void> {
    if (!(data.req as OneUptimeRequest)?.userAuthorization?.userId) {
      return;
    }

    const refusal: TooManyRequestsException | null =
      await VerificationCodeRateLimit.countRequest({
        req: data.req,
        res: data.res,
        bucket: VerificationCodeRateLimitBucket.Add,
        itemKey: VerificationCodeRateLimit.resolveChannelKey(
          data.channel,
          (data.req as OneUptimeRequest).tenantId,
        ),
      });

    if (refusal) {
      throw refusal;
    }
  }

  /*
   * Counts one request in a bucket (consume) and answers with the refusal to
   * send when it is over the limit - Retry-After set, the first refusal of a
   * window logged - or null when it may go on. A counter that cannot be
   * read lets it go on (see the note at the top of this file).
   */
  private static async countRequest(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    bucket: VerificationCodeRateLimitBucket;
    itemKey: string;
  }): Promise<TooManyRequestsException | null> {
    const { req, res, bucket, itemKey } = data;
    const userKey: string = VerificationCodeRateLimit.resolveUserKey(req);
    const clientIp: string = VerificationCodeRateLimit.resolveClientIp(req);

    const decision: VerificationCodeRateLimitDecision =
      await VerificationCodeRateLimit.consume({
        itemKey,
        userKey,
        clientIp,
        bucket,
      });

    if (decision.outcome === VerificationCodeRateLimitOutcome.RateLimited) {
      if (decision.retryAfterSeconds) {
        VerificationCodeRateLimit.setRetryAfterHeader(
          res,
          decision.retryAfterSeconds,
        );
      }

      if (decision.isFirstRejectionInWindow) {
        logger.warn(
          `VerificationCodeRateLimit: rejected ${bucket} request for item ${itemKey} from user ${userKey} at ${clientIp} (${ClientRateLimitCounter.describeLimit(
            String(decision.scope),
            decision.ipv6Network64,
          )})`,
        );
      }

      return new TooManyRequestsException(REFUSAL_MESSAGES[bucket]);
    }

    if (
      decision.outcome === VerificationCodeRateLimitOutcome.CounterUnavailable
    ) {
      /*
       * Fails open. See the note at the top of this file: the expiry, the
       * attempt counter, the rotation and the resend cooldown are all in
       * Postgres and all still in force, so allowing the request through
       * costs a bounded amount of extra attempt budget rather than an
       * unlimited guessing oracle.
       */
      if (VerificationCodeRateLimit.shouldLogCounterUnavailable(bucket)) {
        logger.warn(
          `VerificationCodeRateLimit: rate limit counter unavailable, allowing ${bucket} requests unthrottled`,
        );
      }
    }

    return null;
  }

  /*
   * A Redis outage means EVERY request takes the unavailable path, so an
   * unguarded log line there is one per request for as long as the outage
   * lasts. One line per bucket per interval makes the condition visible
   * without burying everything else.
   */
  private static shouldLogCounterUnavailable(
    bucket: VerificationCodeRateLimitBucket,
  ): boolean {
    const now: number = Date.now();
    const lastLoggedAt: number =
      VerificationCodeRateLimit.counterUnavailableLastLoggedAt.get(bucket) || 0;

    if (now - lastLoggedAt < COUNTER_UNAVAILABLE_LOG_INTERVAL_MS) {
      return false;
    }

    VerificationCodeRateLimit.counterUnavailableLastLoggedAt.set(bucket, now);

    return true;
  }

  private static counterUnavailableLastLoggedAt: Map<
    VerificationCodeRateLimitBucket,
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
