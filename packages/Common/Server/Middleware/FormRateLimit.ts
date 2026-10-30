import Redis, { ClientType } from "../Infrastructure/Redis";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import logger, { getLogAttributesFromRequest } from "../Utils/Logger";
import resolveTrustedClientIp, { ClientIpRequestLike } from "../Utils/ClientIp";
import ClientRateLimitCounter, {
  ClientRateLimitRefusal,
} from "../Utils/RateLimit/ClientRateLimitCounter";
import Response from "../Utils/Response";
import ObjectID from "../../Types/ObjectID";
import ServiceUnavailableException from "../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../Types/Exception/TooManyRequestsException";

/*
 * Rate limiting for the public form routes:
 *
 *   GET  /api/form/public/:shareKey          (the form's questions)
 *   POST /api/form/public/:shareKey/submit   (create from a submission)
 *
 * Both are anonymous: anyone holding a form's link can call them, from any
 * network, with no session and no API key. A sibling of
 * PublicDashboardRateLimit rather than a reuse of it, because the two routes
 * here need budgets that differ in kind, not only in size:
 *
 *  - reading a form is load control, like reading a public dashboard;
 *
 *  - submitting one creates an incident or a maintenance event, and an
 *    incident pages on-call. The counter there is not protecting a database
 *    from load, it is the only thing standing between a leaked link and a
 *    night of pages. So the submit budget is sized for people rather than
 *    for load, adds a ceiling per form that no number of addresses gets
 *    around, and refuses to serve at all when it cannot count (see
 *    getMiddleware).
 *
 * The per-address counters are middleware, so a flood is refused before it
 * costs a session lookup, a Postgres read or a captcha round trip. Only the
 * routes' own-page checks come before them (FormAPI): a request another
 * site's page had a browser send, a read without the header the form's page
 * sends, or a submission that is not JSON, is refused without being
 * counted, so such a page cannot use up the budget its visitors' addresses
 * share. The per-form ceiling is not middleware at all: FormService spends
 * it (reserveFormSubmission) only for a submission that has passed every
 * other check - the form, its plan, its IP allowlist, the captcha, the
 * answers - right before the record is created. It bounds what submissions
 * create, so only a submission about to create something may count against
 * it; were every attempt to count, anyone holding the link - even from
 * outside the allowlist, or without solving the captcha - could use it up
 * with requests that are refused, and lock the form for everybody.
 *
 * The limits are read from FORM_* environment variables. Each one still
 * falls back to the INCIDENT_FORM_* variable of the same name that incident
 * forms read before Forms replaced them, so an install tuned for those keeps
 * its limits.
 */

/*
 * Which counter rejected a request. Every request that reaches the
 * middleware consumes the first two; a submission about to create its
 * record consumes the third:
 *
 *  - FormAndIp, keyed on the form + client address: the budget one submitter
 *    (or one office behind one NAT) gets on one form.
 *
 *  - Ip, keyed on the client address alone. Without it the first counter is
 *    bypassed by rotating the share key on every request, landing in a
 *    fresh bucket each time while still costing a Postgres lookup, 404 or
 *    not.
 *
 *  - Form, keyed on the form alone, across every address (submissions that
 *    passed every check only). The ceiling that survives address rotation:
 *    a botnet holding the link gets no more pages out of it than one
 *    determined person does.
 *
 * Every counter is incremented on each request that reaches it, including
 * one it rejects, so a client that keeps hammering keeps its window pinned
 * rather than being handed a fresh allowance for free.
 *
 * For an IPv6 client the first two are kept for its /64 as well, with room
 * for ten addresses (ClientRateLimitCounter): one host can send from every
 * address of its /64, and would otherwise take a fresh allowance from each.
 * The /64 counters count only the requests the address counters let
 * through, so one address over its own limit never spends the allowance of
 * the people beside it, and a /64 already over its limit is refused before
 * anything is counted.
 */
export enum FormRateLimitScope {
  FormAndIp = "form-and-ip",
  Ip = "ip",
  Form = "form",
}

export enum FormRateLimitBucket {
  // GET /form/public/:shareKey. Fails open.
  Read = "read",

  // POST /form/public/:shareKey/submit. Fails closed.
  Submit = "submit",
}

export enum FormRateLimitOutcome {
  Allowed = "allowed",
  RateLimited = "rate-limited",

  // Redis is unreachable, so no limit can be honoured either way.
  CounterUnavailable = "counter-unavailable",
}

export interface FormRateLimitDecision {
  outcome: FormRateLimitOutcome;
  retryAfterSeconds?: number | undefined;

  // Which counter rejected, for logs and the message. Unset unless rejected.
  scope?: FormRateLimitScope | undefined;

  /*
   * The client's IPv6 /64 when the addresses of that /64 together went over
   * the counter's limit, rather than the client's own address. For logs.
   */
  ipv6Network64?: string | undefined;

  /*
   * True only on the request that first crossed the line in this window.
   * The caller keeps knocking - that is why there is a limiter - so logging
   * every refusal would turn a flood into a second flood in the log
   * pipeline. Logging only the crossing gives one line per key per window.
   */
  isFirstRejectionInWindow?: boolean | undefined;
}

// The ceiling on one form across every address, per window.
export interface FormRateLimitFormCeiling {
  windowSeconds: number;
  limit: number;
}

export interface FormRateLimitBucketConfig {
  windowSeconds: number;
  perFormAndIpLimit: number;
  perIpLimit: number;

  // Submit only. Its own window, since it bounds pages per hour.
  perForm?: FormRateLimitFormCeiling | undefined;

  /*
   * Refuse with 503 when the counter is unavailable, rather than letting the
   * request through uncounted. See getMiddleware for why the two buckets
   * differ.
   */
  failsClosed: boolean;
}

/*
 * What a refused caller is told. None of them names a number: the limits are
 * for the operator to tune, not for a caller to pace itself against.
 */
export const FORM_READ_RATE_LIMIT_MESSAGE: string =
  "Too many requests. Please try again later.";

export const FORM_SUBMIT_RATE_LIMIT_MESSAGE: string =
  "Too many submissions from your network. Please wait a few minutes and try again.";

/*
 * The per-form ceiling is not about the caller's network at all, so it gets
 * its own words: telling someone whose first report this is that "your
 * network" sent too many would send them hunting for a problem they do not
 * have.
 */
export const FORM_TOTAL_RATE_LIMIT_MESSAGE: string =
  "This form is receiving too many submissions right now. Please try again later.";

export const FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE: string =
  "Submissions cannot be accepted right now. Please try again in a few minutes.";

/*
 * The form's hourly allowance of files is used up (reserveFormFileBytes): a
 * submission with no file still goes through, so it says what is too much.
 */
export const FORM_FILES_RATE_LIMIT_MESSAGE: string =
  "This form is receiving too many files right now. Please try again later.";

/*
 * A submission the per-form ceiling refused. Thrown from inside
 * FormService (reserveFormSubmission), where there is no response to
 * write a header on, so it carries when to come back; the submit route
 * writes that as Retry-After (setRetryAfterFor) before the error handler
 * answers 429.
 */
export class FormCeilingException extends TooManyRequestsException {
  public readonly retryAfterSeconds: number;

  public constructor(
    retryAfterSeconds: number,
    message: string = FORM_TOTAL_RATE_LIMIT_MESSAGE,
  ) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/*
 * How many megabytes of files one form may take in, every address together,
 * per window: what a leaked link can make the database hold, however many
 * submissions the per-form ceiling lets through. 200 MB an hour is twenty
 * submissions with the most a submission carries (FormFileAnswer), far past
 * what people reporting a problem attach.
 */
export interface FormFileCeiling {
  windowSeconds: number;
  limitInBytes: number;
}

const parsePositiveInt: (rawValue: string | undefined) => number | null = (
  rawValue: string | undefined,
): number | null => {
  if (!rawValue) {
    return null;
  }

  const parsedValue: number = parseInt(rawValue, 10);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
};

/*
 * A limit from the environment: FORM_<name>, else the INCIDENT_FORM_<name>
 * incident forms read (see the note at the top), else the default.
 */
const parsePositiveIntFromEnv: (name: string, fallback: number) => number = (
  name: string,
  fallback: number,
): number => {
  return (
    parsePositiveInt(process.env[`FORM_${name}`]) ??
    parsePositiveInt(process.env[`INCIDENT_FORM_${name}`]) ??
    fallback
  );
};

/*
 * Read budget: 120 per minute per form + address, 600 per minute per
 * address.
 *
 * The page asks for the form once when it opens, so a real submitter uses one
 * or two of these. The headroom is for a whole office behind one NAT opening
 * the same link during an outage - which is exactly when a form gets used -
 * and the per-address ceiling for that office opening several forms. What
 * matters is that "as fast as a loop runs" becomes a fixed ceiling at all;
 * operators who want it tighter have the environment variables.
 */
const READ_BUCKET: FormRateLimitBucketConfig = {
  windowSeconds: parsePositiveIntFromEnv("RATE_LIMIT_WINDOW_SECONDS", 60),
  perFormAndIpLimit: parsePositiveIntFromEnv(
    "RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW",
    120,
  ),
  perIpLimit: parsePositiveIntFromEnv("RATE_LIMIT_PER_IP_PER_WINDOW", 600),
  failsClosed: false,
};

/*
 * Submit budget: 10 per 15 minutes per form + address, 30 per 15 minutes
 * per address, and 60 records created per hour per form across every
 * address.
 *
 * Sized for people. Ten submissions to one form from one network in a quarter
 * of an hour already covers a team that all saw the same outage, plus a few
 * attempts that failed validation (those count against the address budgets
 * - the middleware runs before the form is checked). The per-form ceiling
 * is the one that bounds pages: only a submission about to create its
 * incident (or event) counts against it, so an hour of it is sixty, far past
 * the point where more reports add information, and no number of addresses
 * raises it.
 *
 * The per-form ceiling is keyed on the share key, like everything here, so
 * resetting a form's link in the dashboard - the remedy for a link that went
 * somewhere it should not have - also starts the new link with a fresh
 * allowance.
 */
const SUBMIT_BUCKET: FormRateLimitBucketConfig = {
  windowSeconds: parsePositiveIntFromEnv(
    "SUBMIT_RATE_LIMIT_WINDOW_SECONDS",
    15 * 60,
  ),
  perFormAndIpLimit: parsePositiveIntFromEnv(
    "SUBMIT_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW",
    10,
  ),
  perIpLimit: parsePositiveIntFromEnv(
    "SUBMIT_RATE_LIMIT_PER_IP_PER_WINDOW",
    30,
  ),
  perForm: {
    windowSeconds: parsePositiveIntFromEnv(
      "SUBMIT_RATE_LIMIT_PER_FORM_WINDOW_SECONDS",
      60 * 60,
    ),
    limit: parsePositiveIntFromEnv("SUBMIT_RATE_LIMIT_PER_FORM_PER_WINDOW", 60),
  },
  failsClosed: true,
};

const FILE_CEILING: FormFileCeiling = {
  windowSeconds: parsePositiveIntFromEnv(
    "SUBMIT_FILE_RATE_LIMIT_WINDOW_SECONDS",
    60 * 60,
  ),
  limitInBytes:
    parsePositiveIntFromEnv(
      "SUBMIT_FILE_RATE_LIMIT_MEGABYTES_PER_FORM_PER_WINDOW",
      200,
    ) *
    1024 *
    1024,
};

/*
 * Redis namespace for every counter here, so a SCAN for form keys
 * never shows another surface's, and the two surfaces never share a count.
 */
const KEY_PREFIX: string = "form:rl:";

/*
 * Counter keys outlive their window by one full window, so a request landing
 * on a boundary cannot read a key that was reclaimed mid-window.
 */
const TTL_MULTIPLIER: number = 2;

// Bounds a Redis key built from attacker-supplied request data.
const MAX_KEY_SEGMENT_LENGTH: number = 64;

// How often the "counter unavailable" condition may be logged, per bucket.
const COUNTER_UNAVAILABLE_LOG_INTERVAL_MS: number = 60 * 1000;

export default class FormRateLimit {
  // The limits in force for a bucket, for tests and operators' diagnostics.
  public static getBucketConfig(
    bucket: FormRateLimitBucket,
  ): FormRateLimitBucketConfig {
    const config: FormRateLimitBucketConfig = FormRateLimit.getConfig(bucket);

    return {
      ...config,
      perForm: config.perForm ? { ...config.perForm } : undefined,
    };
  }

  /*
   * The client address to bill this request to.
   *
   * The shared ClientIp helper reads X-Forwarded-For from the trusted
   * (right-hand) end under the instance-wide TRUSTED_PROXY_HOPS setting -
   * never the leftmost entry, which any caller can set, and which would hand
   * a caller a fresh bucket per request. It is also what FormService
   * checks the form's IP allowlist against, so the limiter and the allowlist
   * always agree on who is calling.
   */
  public static resolveClientIp(req: ExpressRequest): string {
    const clientIp: string | undefined = resolveTrustedClientIp(
      req as unknown as ClientIpRequestLike,
    );

    if (clientIp) {
      return FormRateLimit.sanitizeKeySegment(clientIp);
    }

    /*
     * No address at all. Everything in this state shares one bucket, which
     * is the conservative direction: an unidentifiable caller should not get
     * a private allowance of its own.
     */
    return "unknown";
  }

  /*
   * The form this request is about, as a key segment.
   *
   * A share key is a UUID, so anything else cannot name a form and every
   * such request shares one "invalid" bucket. That bounds Redis memory
   * against a caller feeding junk path segments, and it is the right grouping
   * anyway: none of them can reach a form. Case and surrounding whitespace do
   * not split a bucket, or varying them would be a way around the limit.
   *
   * The key is used as it is rather than hashed: a share key sits in an
   * address bar and in access logs by design (see Form.shareKey), so
   * it is a link identifier like a public dashboard id, not a secret.
   */
  public static resolveFormKey(req: ExpressRequest): string {
    return FormRateLimit.getFormKey(req.params?.["shareKey"]);
  }

  /*
   * The key segment for a share key, however it was read: from the path by
   * the middleware, or handed over by FormService when it spends the
   * form's ceiling - so both always count the same form under one key.
   */
  public static getFormKey(shareKey: unknown): string {
    if (typeof shareKey !== "string" || shareKey.trim().length === 0) {
      return "none";
    }

    const value: string = shareKey.trim();

    if (ObjectID.isValidUUID(value)) {
      return `k:${value.toLowerCase()}`;
    }

    return "invalid";
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

  private static getConfig(
    bucket: FormRateLimitBucket,
  ): FormRateLimitBucketConfig {
    if (bucket === FormRateLimitBucket.Submit) {
      return SUBMIT_BUCKET;
    }

    return READ_BUCKET;
  }

  /*
   * Count this request against the two per-address counters and decide.
   *
   * Both go out in one pipeline, so a request costs a single round trip. The
   * form's own ceiling is not counted here, for either bucket: that is
   * spent by a submission that has passed every check (consumeFormCeiling),
   * so a request that is refused - by these counters or by anything after
   * them - never uses up the allowance everybody else shares.
   */
  public static async consume(data: {
    // From resolveFormKey.
    formKey: string;
    // From resolveClientIp.
    clientIp: string;
    bucket: FormRateLimitBucket;
  }): Promise<FormRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: FormRateLimitOutcome.CounterUnavailable };
    }

    const config: FormRateLimitBucketConfig = FormRateLimit.getConfig(
      data.bucket,
    );

    const keyPrefix: string = `${KEY_PREFIX}${data.bucket}:`;
    const windowIndex: number = FormRateLimit.getWindowIndex(
      config.windowSeconds,
    );

    try {
      /*
       * Counted by ClientRateLimitCounter: under the client's address, and
       * for an IPv6 client under its /64 as well.
       *
       * The per-form + address counter is reported first when both are over:
       * it is the more specific of the two and the more useful thing to see
       * in a log line.
       */
      const refusal: ClientRateLimitRefusal<FormRateLimitScope> | null =
        await ClientRateLimitCounter.count<FormRateLimitScope>({
          redis: client,
          clientIp: data.clientIp,
          ttlSeconds: config.windowSeconds * TTL_MULTIPLIER,
          counters: [
            {
              scope: FormRateLimitScope.FormAndIp,
              keyFor: (clientKey: string): string => {
                return `${keyPrefix}fi:${data.formKey}:${clientKey}:${windowIndex}`;
              },
              limit: config.perFormAndIpLimit,
            },
            {
              scope: FormRateLimitScope.Ip,
              keyFor: (clientKey: string): string => {
                return `${keyPrefix}i:${clientKey}:${windowIndex}`;
              },
              limit: config.perIpLimit,
            },
          ],
        });

      if (!refusal) {
        return { outcome: FormRateLimitOutcome.Allowed };
      }

      return FormRateLimit.rejected({
        refusal: refusal,
        windowSeconds: config.windowSeconds,
      });
    } catch (err) {
      /*
       * Throttled for the same reason as the middleware's unavailable
       * branch: whatever broke Redis is unlikely to break it for one request
       * only, and a per-request log line buries the incident it reports.
       */
      if (FormRateLimit.shouldLogCounterUnavailable(data.bucket)) {
        logger.warn(`FormRateLimit: counter failed for form ${data.formKey}`);
        logger.warn(err);
      }

      return { outcome: FormRateLimitOutcome.CounterUnavailable };
    }
  }

  /*
   * Count one submission against the form's ceiling - across every address,
   * per clock hour - and decide. For a submission that has passed every
   * other check and is about to create its record; see
   * reserveFormSubmission, which is what the service calls.
   */
  public static async consumeFormCeiling(data: {
    // From getFormKey.
    formKey: string;
  }): Promise<FormRateLimitDecision> {
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      return { outcome: FormRateLimitOutcome.CounterUnavailable };
    }

    const ceiling: FormRateLimitFormCeiling | undefined = SUBMIT_BUCKET.perForm;

    if (!ceiling) {
      return { outcome: FormRateLimitOutcome.Allowed };
    }

    const formCounterKey: string = `${KEY_PREFIX}${FormRateLimitBucket.Submit}:f:${data.formKey}:${FormRateLimit.getWindowIndex(
      ceiling.windowSeconds,
    )}`;

    try {
      const refusal: ClientRateLimitRefusal<FormRateLimitScope> | null =
        await ClientRateLimitCounter.countFixed<FormRateLimitScope>({
          redis: client,
          ttlSeconds: ceiling.windowSeconds * TTL_MULTIPLIER,
          counters: [
            {
              scope: FormRateLimitScope.Form,
              key: formCounterKey,
              limit: ceiling.limit,
            },
          ],
        });

      if (!refusal) {
        return { outcome: FormRateLimitOutcome.Allowed };
      }

      return FormRateLimit.rejected({
        refusal: refusal,
        windowSeconds: ceiling.windowSeconds,
      });
    } catch (err) {
      if (
        FormRateLimit.shouldLogCounterUnavailable(FormRateLimitBucket.Submit)
      ) {
        logger.warn(
          `FormRateLimit: form ceiling counter failed for form ${data.formKey}`,
        );
        logger.warn(err);
      }

      return { outcome: FormRateLimitOutcome.CounterUnavailable };
    }
  }

  /*
   * Spend one of the form's hourly submissions, or refuse: 429
   * (FormCeilingException, carrying when to come back) once the
   * hour's allowance is used, and 503 when the counter cannot be reached -
   * the ceiling is what bounds the pages a link can cause, so without it the
   * submission fails closed, as the submit middleware does.
   *
   * Called by FormService.submitPublicForm right before it creates the
   * submission's record, once the form, its plan, its IP allowlist, the
   * captcha and the answers have all been checked: a refused request never
   * spends it.
   */
  public static async reserveFormSubmission(data: {
    shareKey: string | undefined;
  }): Promise<void> {
    const formKey: string = FormRateLimit.getFormKey(data.shareKey);

    const decision: FormRateLimitDecision =
      await FormRateLimit.consumeFormCeiling({ formKey });

    if (decision.outcome === FormRateLimitOutcome.RateLimited) {
      if (decision.isFirstRejectionInWindow) {
        logger.warn(
          `FormRateLimit: rejected a submission to form ${formKey} (${FormRateLimitScope.Form} limit)`,
        );
      }

      throw new FormCeilingException(decision.retryAfterSeconds || 1);
    }

    if (decision.outcome === FormRateLimitOutcome.CounterUnavailable) {
      if (
        FormRateLimit.shouldLogCounterUnavailable(FormRateLimitBucket.Submit)
      ) {
        logger.error(
          `FormRateLimit: rate limit counter unavailable, refusing form submissions (form ${formKey})`,
        );
      }

      throw new ServiceUnavailableException(
        FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      );
    }
  }

  // The files ceiling in force, for tests and operators' diagnostics.
  public static getFileCeiling(): FormFileCeiling {
    return { ...FILE_CEILING };
  }

  /*
   * Spend these bytes of the form's hourly allowance of files, or refuse:
   * 429 (FormCeilingException, with when to come back) when they would take
   * the window past it - and then they are given back, since nothing was
   * stored - and 503 when the counter cannot be reached, as the submission
   * ceiling fails closed. Called by FormService.submitPublicForm for a
   * submission with files, once it has passed every other check and spent
   * its place under the submission ceiling, right before its files are
   * stored.
   */
  public static async reserveFormFileBytes(data: {
    shareKey: string | undefined;
    bytes: number;
  }): Promise<void> {
    if (!Number.isFinite(data.bytes) || data.bytes <= 0) {
      return;
    }

    const formKey: string = FormRateLimit.getFormKey(data.shareKey);
    const client: ClientType | null = Redis.getClient();

    if (!client || !Redis.isConnected()) {
      throw new ServiceUnavailableException(
        FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      );
    }

    const key: string = `${KEY_PREFIX}${FormRateLimitBucket.Submit}:fb:${formKey}:${FormRateLimit.getWindowIndex(
      FILE_CEILING.windowSeconds,
    )}`;
    const bytes: number = Math.ceil(data.bytes);

    let total: number;

    try {
      total = Number(await client.incrby(key, bytes));

      if (total === bytes) {
        await client.expire(key, FILE_CEILING.windowSeconds * TTL_MULTIPLIER);
      }
    } catch (err) {
      if (
        FormRateLimit.shouldLogCounterUnavailable(FormRateLimitBucket.Submit)
      ) {
        logger.warn(
          `FormRateLimit: file ceiling counter failed for form ${formKey}`,
        );
        logger.warn(err);
      }

      throw new ServiceUnavailableException(
        FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      );
    }

    if (total <= FILE_CEILING.limitInBytes) {
      return;
    }

    // Nothing is stored for a refused submission: its bytes are given back.
    try {
      await client.decrby(key, bytes);
    } catch (err) {
      logger.warn(
        `FormRateLimit: could not give back the bytes of a refused submission to form ${formKey}`,
      );
      logger.warn(err);
    }

    if (total - bytes <= FILE_CEILING.limitInBytes) {
      logger.warn(
        `FormRateLimit: rejected a submission's files to form ${formKey} (file ceiling)`,
      );
    }

    throw new FormCeilingException(
      FormRateLimit.getSecondsUntilWindowEnd(FILE_CEILING.windowSeconds),
      FORM_FILES_RATE_LIMIT_MESSAGE,
    );
  }

  /*
   * For the submit route: when the service refused a submission for the
   * form's ceiling, say when to come back, as the middleware does for its
   * own refusals. Anything else is left alone.
   */
  public static setRetryAfterFor(res: ExpressResponse, error: unknown): void {
    if (error instanceof FormCeilingException) {
      FormRateLimit.setRetryAfterHeader(res, error.retryAfterSeconds);
    }
  }

  /*
   * The decision for a request a counter refused. Each counter's key expires
   * only from the request that created it (ClientRateLimitCounter), so a
   * window never slides forward under load and a client that went over once
   * recovers when it ends.
   */
  private static rejected(data: {
    refusal: ClientRateLimitRefusal<FormRateLimitScope>;
    windowSeconds: number;
  }): FormRateLimitDecision {
    return {
      outcome: FormRateLimitOutcome.RateLimited,
      retryAfterSeconds: FormRateLimit.getSecondsUntilWindowEnd(
        data.windowSeconds,
      ),
      scope: data.refusal.scope,
      ipv6Network64: data.refusal.ipv6Network64,
      isFirstRejectionInWindow: data.refusal.isFirstRefusalInWindow,
    };
  }

  private static getWindowIndex(windowSeconds: number): number {
    return Math.floor(Date.now() / (windowSeconds * 1000));
  }

  /*
   * Remaining seconds in the window of the counter that refused, so a
   * rejected caller is told to come back when that window actually rolls -
   * an hour for the per-form ceiling, a quarter of one for the per-address
   * counters - rather than every caller backing off by one constant and
   * colliding again.
   */
  private static getSecondsUntilWindowEnd(windowSeconds: number): number {
    const windowMs: number = windowSeconds * 1000;
    const msIntoWindow: number = Date.now() % windowMs;

    return Math.max(1, Math.ceil((windowMs - msIntoWindow) / 1000));
  }

  /*
   * The middleware only ever refuses on the per-address counters, so a
   * refused submission is always about the caller's network. (The form's
   * own ceiling has its own words: see FormCeilingException.)
   */
  private static getRateLimitedMessage(bucket: FormRateLimitBucket): string {
    if (bucket === FormRateLimitBucket.Read) {
      return FORM_READ_RATE_LIMIT_MESSAGE;
    }

    return FORM_SUBMIT_RATE_LIMIT_MESSAGE;
  }

  /*
   * Express middleware, mounted on each public form route ahead of
   * UserMiddleware (it reads :shareKey from req.params, so it must sit on
   * the route rather than the router), so a flood is refused before it costs
   * a session lookup, let alone a Postgres read or a captcha check.
   */
  public static getMiddleware(
    bucket: FormRateLimitBucket = FormRateLimitBucket.Read,
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
      const config: FormRateLimitBucketConfig = FormRateLimit.getConfig(bucket);
      const formKey: string = FormRateLimit.resolveFormKey(req);
      const clientIp: string = FormRateLimit.resolveClientIp(req);

      const decision: FormRateLimitDecision = await FormRateLimit.consume({
        formKey,
        clientIp,
        bucket,
      });

      if (decision.outcome === FormRateLimitOutcome.RateLimited) {
        if (decision.retryAfterSeconds) {
          FormRateLimit.setRetryAfterHeader(res, decision.retryAfterSeconds);
        }

        if (decision.isFirstRejectionInWindow) {
          logger.warn(
            `FormRateLimit: rejected ${bucket} request for form ${formKey} from ${clientIp} (${ClientRateLimitCounter.describeLimit(
              String(decision.scope),
              decision.ipv6Network64,
            )})`,
          );
        }

        return Response.sendErrorResponse(
          req,
          res,
          new TooManyRequestsException(
            FormRateLimit.getRateLimitedMessage(bucket),
          ),
        );
      }

      if (decision.outcome === FormRateLimitOutcome.CounterUnavailable) {
        /*
         * The two buckets fail in opposite directions, on purpose.
         *
         * Reads fail OPEN. Showing a form's questions is read-only, and the
         * counter there is load control: turning every company's report
         * form into an error page because Redis blipped is worse than an
         * unbounded window for the length of the blip, which is itself
         * alarmed on.
         *
         * Submits fail CLOSED. There the counter is the only bound on how
         * many incidents - and pages - a link can produce. Serving the route
         * without it would serve an unlimited pager, so the reporter gets a
         * 503 and can send the report when Redis is back.
         */
        if (config.failsClosed) {
          if (FormRateLimit.shouldLogCounterUnavailable(bucket)) {
            logger.error(
              `FormRateLimit: rate limit counter unavailable, refusing form submissions (form ${formKey})`,
            );
          }

          return Response.sendErrorResponse(
            req,
            res,
            new ServiceUnavailableException(
              FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
            ),
          );
        }

        if (FormRateLimit.shouldLogCounterUnavailable(bucket)) {
          logger.warn(
            "FormRateLimit: rate limit counter unavailable, serving forms unthrottled",
          );
          logger.warn(getLogAttributesFromRequest(req as OneUptimeRequest));
        }
      }

      return next();
    };
  }

  /*
   * A Redis outage puts EVERY request on the unavailable path, so an
   * unguarded log line there is one per request for as long as the outage
   * lasts. One line per bucket per interval is enough to make the condition
   * visible without burying everything else.
   */
  private static shouldLogCounterUnavailable(
    bucket: FormRateLimitBucket,
  ): boolean {
    const now: number = Date.now();
    const lastLoggedAt: number =
      FormRateLimit.counterUnavailableLastLoggedAt.get(bucket) || 0;

    if (now - lastLoggedAt < COUNTER_UNAVAILABLE_LOG_INTERVAL_MS) {
      return false;
    }

    FormRateLimit.counterUnavailableLastLoggedAt.set(bucket, now);

    return true;
  }

  private static counterUnavailableLastLoggedAt: Map<
    FormRateLimitBucket,
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
