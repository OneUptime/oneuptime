import RetryAfter from "../../../../Utils/RetryAfter";
import Dictionary from "../../../../Types/Dictionary";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import { HttpRetryReason, HttpRetryVerdict } from "../../DataSource/HttpRetry";
import { CloudReadBudget } from "../CloudConnectorTypes";

/*
 * ASKING AWS AGAIN, AS THE AWS SDKS' STANDARD RETRY MODE DOES.
 *
 * Every AWS call of a cloud connection (AwsApi's sendAwsRequest and
 * sendAwsRestRequest: the reads, the inventory, the costs, what changed,
 * Data Security's reads and its response actions) is asked again the way
 * the AWS SDKs' standard retry mode asks ("Retry behavior", AWS SDKs and
 * Tools Reference Guide, docs.aws.amazon.com/sdkref/latest/guide/
 * feature-retry-behavior.html):
 *
 *  - what is asked again is read from the answer (AwsApi's
 *    classifyAwsAnswer: its error code first, then its status): a throttle,
 *    which the service turned away before doing it, or a failure for now -
 *    an InternalError, a RequestTimeout, any 500, 502, 503 or 504. Never a
 *    refusal, a request AWS will not take or a resource that is not there;
 *  - three tries at most, four for DynamoDB, as its SDK clients try;
 *  - each wait with full jitter: random(0, 1) x min(20 s, base x 2^retry),
 *    from a base of 1 s after a throttle and 50 ms after a failure for now
 *    (25 ms for DynamoDB). A throttle waits longer: the service needs time
 *    to have room again, while a failure for now is mostly over at once;
 *  - a wait the answer names is waited instead: AWS's x-amz-retry-after,
 *    in milliseconds, held between the backoff and 5 s more, as the SDKs
 *    hold it; a Retry-After, in seconds or as a date, when it is within the
 *    longest wait (25 s). A longer one is not waited out: the call fails as
 *    it answered, and the next read asks again;
 *  - a retry quota for each read (AwsRetryQuota), the SDKs' token bucket:
 *    500 tokens, a retry after a failure for now costs 14 and after a
 *    throttle 5, a retry that works gives its own back and a request that
 *    works first time gives one. Once spent - most requests failing for a
 *    while, an outage rather than a blip - nothing is asked again until
 *    requests work again, so an outage costs a read its requests once,
 *    not three times;
 *  - only what is safe to send again: a request that may have done its
 *    work - one that writes, unless its caller says sending it again
 *    changes nothing more - is asked again after a throttle only, which
 *    did nothing. A read is always safe (isAwsReadAction);
 *  - only answers: a request that got none - the network failed, or it
 *    timed out after most of its time - is not sent again, as no cloud call
 *    of a connection is (CloudRetry): the read says so, and the next one
 *    asks again.
 *
 * Each try takes one request of the read's budget (CloudReadBudget) and is
 * signed again (AwsApi), so a retry is never refused as too old. The words
 * the call fails with are AwsApi's, with how many times it was asked.
 */

// The most tries of one request: the SDKs' default max attempts.
export const AWS_RETRY_MAX_ATTEMPTS: number = 3;
// DynamoDB's and DynamoDB Streams' SDK clients try once more, from a shorter base.
export const AWS_DYNAMODB_RETRY_MAX_ATTEMPTS: number = 4;

// The first backoff's ceiling after a failure for now, and after a throttle.
export const AWS_TRANSIENT_RETRY_BASE_MS: number = 50;
export const AWS_DYNAMODB_TRANSIENT_RETRY_BASE_MS: number = 25;
export const AWS_THROTTLING_RETRY_BASE_MS: number = 1000;

// No backoff is longer, however many tries.
export const AWS_RETRY_MAX_BACKOFF_MS: number = 20_000;

// How much longer than the backoff a wait AWS names (x-amz-retry-after) may be.
export const AWS_RETRY_HINT_MAX_EXTRA_MS: number = 5_000;

// The longest wait of one retry: a Retry-After asking longer is not waited out.
export const AWS_RETRY_MAX_WAIT_MS: number =
  AWS_RETRY_MAX_BACKOFF_MS + AWS_RETRY_HINT_MAX_EXTRA_MS;

// The header AWS names its wait in, in milliseconds.
export const AWS_RETRY_AFTER_HEADER: string = "x-amz-retry-after";

// A count of milliseconds, as x-amz-retry-after writes one: digits and nothing else.
const WHOLE_MILLISECONDS: RegExp = /^\s*\d+\s*$/;

// The retry quota: its tokens, what each retry costs, and what a request that worked gives back.
export const AWS_RETRY_QUOTA_TOKENS: number = 500;
export const AWS_TRANSIENT_RETRY_COST: number = 14;
export const AWS_THROTTLING_RETRY_COST: number = 5;
export const AWS_NO_RETRY_INCREMENT: number = 1;

/*
 * The verbs of AWS actions that only read: sending one again changes
 * nothing (DescribeInstances, GetMetricData, ListResources, LookupEvents,
 * FilterLogEvents, BatchGetItem).
 */
export const AWS_READ_ACTION_PREFIXES: ReadonlyArray<string> = [
  "Describe",
  "Get",
  "List",
  "BatchGet",
  "Lookup",
  "Search",
  "Filter",
];

/*
 * Whether an action only reads, by its verb: "DescribeInstances", or a
 * JSON target's last part ("GraniteServiceVersion20100801.GetMetricData").
 * The verb must be followed by the thing read, so "Getaway" is no read.
 */
export function isAwsReadAction(action: string): boolean {
  const name: string = (action || "").trim().split(".").pop() || "";

  return AWS_READ_ACTION_PREFIXES.some((prefix: string): boolean => {
    const next: string = name.charAt(prefix.length);

    return (
      name.startsWith(prefix) && next !== "" && next === next.toUpperCase()
    );
  });
}

/*
 * A read's retry quota: the SDKs' token bucket, one for each read of a
 * connection - the read is the client here - so one read's outage never
 * stops another's retries.
 */
export class AwsRetryQuota {
  private tokens: number = AWS_RETRY_QUOTA_TOKENS;

  // The tokens left.
  public get available(): number {
    return this.tokens;
  }

  // Takes what a retry costs; false, and nothing taken, when it is not there.
  public acquire(cost: number): boolean {
    if (this.tokens < cost) {
      return false;
    }

    this.tokens -= cost;

    return true;
  }

  // Gives tokens back after a request that worked, never past the quota.
  public release(amount: number): void {
    this.tokens = Math.min(AWS_RETRY_QUOTA_TOKENS, this.tokens + amount);
  }
}

const QUOTAS_OF_READS: WeakMap<CloudReadBudget, AwsRetryQuota> = new WeakMap<
  CloudReadBudget,
  AwsRetryQuota
>();

/*
 * The retry quota of the read a budget is for: one per read, kept as long
 * as the read's budget is. A call made outside a read (no budget) is a
 * client of its own, with a full quota.
 */
export function getAwsRetryQuota(budget?: CloudReadBudget): AwsRetryQuota {
  if (!budget) {
    return new AwsRetryQuota();
  }

  let quota: AwsRetryQuota | undefined = QUOTAS_OF_READS.get(budget);

  if (!quota) {
    quota = new AwsRetryQuota();
    QUOTAS_OF_READS.set(budget, quota);
  }

  return quota;
}

export default class AwsRetry {
  // The jitter's random(0, 1): replaced in tests, so a wait is known.
  public static random(): number {
    return Math.random();
  }
}

/*
 * The backoff before retry number `retry` (0 for the first), with full
 * jitter: random(0, 1) x min(20 s, base x 2^retry).
 */
export function getAwsBackoffMs(data: {
  reason: HttpRetryReason;
  retry: number;
  isDynamoDb?: boolean | undefined;
  random?: (() => number) | undefined;
}): number {
  const base: number =
    data.reason === HttpRetryReason.Throttled
      ? AWS_THROTTLING_RETRY_BASE_MS
      : data.isDynamoDb
        ? AWS_DYNAMODB_TRANSIENT_RETRY_BASE_MS
        : AWS_TRANSIENT_RETRY_BASE_MS;
  const random: number = Math.min(
    1,
    Math.max(0, (data.random || AwsRetry.random)()),
  );

  return (
    random *
    Math.min(
      AWS_RETRY_MAX_BACKOFF_MS,
      base * Math.pow(2, Math.max(0, data.retry)),
    )
  );
}

// A header of an answer, whatever its case.
function readHeader(
  headers: Dictionary<string> | undefined,
  name: string,
): string | undefined {
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === name) {
      return headers![key];
    }
  }

  return undefined;
}

/*
 * How long to wait before asking again, from the backoff and what the
 * answer names; null when the answer asks for longer than a retry waits
 * (AWS_RETRY_MAX_WAIT_MS), which is not waited out.
 *
 *  - x-amz-retry-after, in milliseconds: as AWS names it, held between the
 *    backoff and AWS_RETRY_HINT_MAX_EXTRA_MS more (the service jitters it,
 *    so it is not jittered again);
 *  - Retry-After, in seconds or as an HTTP-date (RetryAfter): never sooner
 *    than the backoff, and not waited out past AWS_RETRY_MAX_WAIT_MS;
 *  - else the backoff.
 */
export function getAwsRetryWaitMs(data: {
  backoffMs: number;
  headers?: Dictionary<string> | undefined;
  nowMs?: number | undefined;
}): number | null {
  const named: string | undefined = readHeader(
    data.headers,
    AWS_RETRY_AFTER_HEADER,
  );
  const namedMs: number =
    named !== undefined && WHOLE_MILLISECONDS.test(named) ? Number(named) : NaN;

  if (Number.isFinite(namedMs)) {
    return Math.min(
      Math.max(namedMs, data.backoffMs),
      data.backoffMs + AWS_RETRY_HINT_MAX_EXTRA_MS,
    );
  }

  const retryAfterMs: number | undefined = RetryAfter.msFromHeaders(
    data.headers,
    data.nowMs === undefined ? {} : { nowMs: data.nowMs },
  );

  if (retryAfterMs === undefined) {
    return data.backoffMs;
  }

  if (retryAfterMs > AWS_RETRY_MAX_WAIT_MS) {
    return null;
  }

  return Math.max(retryAfterMs, data.backoffMs);
}

export interface AwsRetryExchange {
  // The last answer, whatever its status.
  response: DataSourceHttpResponse;
  // How many times the request was sent.
  attempts: number;
  // Why the last answer might have passed; null for a success, or a failure asking again would repeat.
  verdict: HttpRetryVerdict | null;
}

export interface AwsRetryOptions {
  /*
   * One try, the first being 1: takes its request of the read's budget,
   * signs the request again and sends it, and hands back the answer
   * whatever its status. Throws when no answer came, which is not asked
   * again.
   */
  send: (attempt: number) => Promise<DataSourceHttpResponse>;
  // Whether an answer that is no success may pass (AwsApi's classifyAwsAnswer).
  classify: (response: DataSourceHttpResponse) => HttpRetryVerdict | null;
  // Whether sending it again cannot do its work twice: a read, or a write its caller says changes nothing more.
  isSafeToRepeat: boolean;
  // DynamoDB: four tries, from a 25 ms base.
  isDynamoDb?: boolean | undefined;
  // The read's quota (getAwsRetryQuota).
  quota: AwsRetryQuota;
  sleep: (milliseconds: number) => Promise<void>;
  now?: (() => number) | undefined;
  random?: (() => number) | undefined;
}

function isSuccess(response: DataSourceHttpResponse): boolean {
  return response.statusCode >= 200 && response.statusCode < 300;
}

/*
 * One AWS request, asked again while its answer may pass, as the standard
 * retry mode asks (the top of this file). The last answer is handed back,
 * whatever it is, with how many times it was sent.
 */
export async function exchangeWithAwsRetries(
  options: AwsRetryOptions,
): Promise<AwsRetryExchange> {
  const maxAttempts: number = options.isDynamoDb
    ? AWS_DYNAMODB_RETRY_MAX_ATTEMPTS
    : AWS_RETRY_MAX_ATTEMPTS;
  // What the last retry cost, given back when it works.
  let lastRetryCost: number = 0;

  for (let attempt: number = 1; ; attempt++) {
    const response: DataSourceHttpResponse = await options.send(attempt);

    if (isSuccess(response)) {
      options.quota.release(
        attempt > 1 ? lastRetryCost : AWS_NO_RETRY_INCREMENT,
      );

      return { response, attempts: attempt, verdict: null };
    }

    const verdict: HttpRetryVerdict | null = options.classify(response);

    if (!verdict || attempt >= maxAttempts) {
      return { response, attempts: attempt, verdict };
    }

    const isThrottle: boolean = verdict.reason === HttpRetryReason.Throttled;

    // A request that may have done its work is sent again only after a throttle, which did nothing.
    if (!isThrottle && !options.isSafeToRepeat && verdict.isUndone !== true) {
      return { response, attempts: attempt, verdict };
    }

    const waitMs: number | null = getAwsRetryWaitMs({
      backoffMs: getAwsBackoffMs({
        reason: verdict.reason,
        retry: attempt - 1,
        isDynamoDb: options.isDynamoDb,
        random: options.random,
      }),
      headers: response.headers,
      nowMs: options.now ? options.now() : undefined,
    });

    if (waitMs === null) {
      return { response, attempts: attempt, verdict };
    }

    const cost: number = isThrottle
      ? AWS_THROTTLING_RETRY_COST
      : AWS_TRANSIENT_RETRY_COST;

    // An outage, not a blip: the quota is spent, and the answer stands.
    if (!options.quota.acquire(cost)) {
      return { response, attempts: attempt, verdict };
    }

    lastRetryCost = cost;
    await options.sleep(waitMs);
  }
}
