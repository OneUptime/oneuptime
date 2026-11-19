import RetryAfter from "../../../Utils/RetryAfter";
import logger from "../Logger";
import { DataSourceHttpRequest, DataSourceHttpResponse } from "./HttpFetch";
import {
  DataSourceBusy,
  DataSourceStatusException,
  DataSourceUnreachedError,
} from "./HttpFailure";

/*
 * ASKING A DATA SOURCE AGAIN WHEN IT FAILS FOR A MOMENT, WITHIN A BUDGET.
 *
 * Every Data Observability collector that talks HTTP sends its requests
 * through one of these, one per collection, first written for Dataverse
 * (#9506) and shared by Snowflake, Databricks, BigQuery, Athena and Glue,
 * and ClickHouse since (#9540). An answer that may pass is asked again,
 * twice at most, after the Retry-After it gives, else a wait the answer
 * names in its body, else a backoff of two then four seconds:
 *
 *  - which answers may pass is each provider's own, read from its docs: a
 *    classifier says whether an answer is a throttle (the service turned the
 *    request away before doing it: a 429, Athena's ThrottlingException,
 *    ClickHouse's TOO_MANY_SIMULTANEOUS_QUERIES) or a failure for now (a
 *    503, BigQuery's backendError, Databricks' TEMPORARILY_UNAVAILABLE);
 *  - a request is asked again only when that is safe: a read, or a request
 *    the provider tells apart from its first sending (Snowflake's request
 *    ID with retry=true, Athena's ClientRequestToken, BigQuery's requestId).
 *    One that may have done its work is asked again only after a throttle,
 *    or an answer saying it did nothing (isUndone);
 *  - a throttle holds back every request of the collection that shares it,
 *    not only its own: the limit is the account's, so the next request
 *    would meet it too;
 *  - one wait longer than thirty seconds, or past a minute of waiting in
 *    the collection, is not waited out: the answer is the collection's to
 *    say, and the next collection asks again;
 *  - an outage is not asked again: once two requests in a row have failed
 *    every try for a reason that may pass, with no answer between them, the
 *    service is down rather than blipping, and the rest of the collection's
 *    requests are sent once. The first answer that is no such failure lifts
 *    it. So an outage costs a collection at most four more requests, never
 *    three times its reads.
 *
 * Only answers are asked again. A request that got none - a network that
 * failed, a timeout - is the caller's: a timeout has used up most of its
 * time already, and asking again would add to the load of a service that
 * cannot answer. It is thrown as a DataSourceUnreachedError, which keeps
 * the transport's words, so a collector can say what was being read and
 * tell it apart from a failure of the request's own making, such as a
 * sign-in refused while the request was built.
 */

export type DataSourceTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

// The most times one request is sent: once, and twice more for an answer that may pass.
export const HTTP_RETRY_MAX_ATTEMPTS: number = 3;

// The longest one wait between tries: a longer one is left to the next collection.
export const HTTP_RETRY_MAX_WAIT_IN_MS: number = 30_000;

// The most one collection waits between tries in all, so a struggling service cannot hold it up.
export const HTTP_RETRY_BUDGET_IN_MS: number = 60_000;

// The first backoff when the answer names no wait, doubled at each try after it.
export const HTTP_RETRY_FIRST_BACKOFF_IN_MS: number = 2_000;

// After this many requests in a row fail every try for a reason that may pass, the rest are sent once.
export const HTTP_RETRY_OUTAGE_AFTER_FAILED_REQUESTS: number = 2;

export enum HttpRetryReason {
  // The service turned the request away for now, before doing it: a rate or concurrency limit.
  Throttled = "Throttled",
  // The service failed the request for now: it may have done some of it.
  Unavailable = "Unavailable",
}

export interface HttpRetryVerdict {
  reason: HttpRetryReason;
  /*
   * The service says it did not do the request: safe to send again even
   * when the request is not. A throttle never did it.
   */
  isUndone?: boolean | undefined;
  /*
   * A wait the answer names other than in Retry-After (Databricks'
   * RetryInfo, AWS's x-amz-retry-after), in milliseconds: never waited
   * less than the backoff.
   */
  waitInMs?: number | undefined;
}

// Whether an answer may pass, and why; null for an answer to keep (a success, or a failure asking again would repeat).
export type HttpRetryClassifier = (
  response: DataSourceHttpResponse,
  request: DataSourceHttpRequest,
) => HttpRetryVerdict | null;

export interface HttpRetryRequest {
  // The request for a try, the first being 1: built again for each, so a token or a resubmission mark is fresh.
  build: (
    attempt: number,
  ) => DataSourceHttpRequest | Promise<DataSourceHttpRequest>;
  // Whether sending it again cannot do its work twice: a read, or a request the service tells apart.
  isSafeToRepeat: boolean;
  /*
   * Whether it shares the collection's throttle: it waits out a throttle
   * another request met, and a throttle it meets holds the others back.
   * True unless said; a sign-in, whose limits are another service's, is not.
   */
  sharesThrottle?: boolean | undefined;
}

export interface HttpRetryExchange {
  // The last answer, whatever it is.
  response: DataSourceHttpResponse;
  attempts: number;
  // Why the last answer might have passed, when it might; null for one to keep.
  verdict: HttpRetryVerdict | null;
}

export interface HttpRetryOptions {
  transport: DataSourceTransport;
  classify: HttpRetryClassifier;
  // Who is asked, for the debug log and the failure asTransport throws: "Snowflake".
  provider: string;
  now?: (() => number) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  maxAttempts?: number | undefined;
  maxWaitInMs?: number | undefined;
  budgetInMs?: number | undefined;
  firstBackoffInMs?: number | undefined;
}

// A count of milliseconds an answer names, when it is one worth waiting for.
export function readWaitInMs(value: unknown): number | undefined {
  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) && number > 0 ? number : undefined;
}

/*
 * Why a request whose tries ran out may still pass (#9679): its last answer
 * was one the provider's docs call passing - a throttle, or a failure for
 * now - with the provider's own code and the wait it asked for. Null for an
 * answer to keep. A data check that met one is started again once
 * (DataCheckRestart).
 */
export function busyOfExchange(
  exchange: HttpRetryExchange,
  data: { code: string | null; nowMs?: number | undefined },
): DataSourceBusy | null {
  if (!exchange.verdict) {
    return null;
  }

  const waitInMs: number | undefined =
    RetryAfter.msFromHeaders(exchange.response.headers, {
      nowMs: data.nowMs ?? Date.now(),
    }) ?? readWaitInMs(exchange.verdict.waitInMs);

  return { code: data.code, ...(waitInMs ? { waitInMs } : {}) };
}

export default class DataSourceHttpRetry {
  private readonly transport: DataSourceTransport;
  private readonly classify: HttpRetryClassifier;
  private readonly provider: string;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxAttempts: number;
  private readonly maxWaitInMs: number;
  private readonly budgetInMs: number;
  private readonly firstBackoffInMs: number;
  // Until when every request that shares the throttle waits, as a throttle asked.
  private throttledUntil: number = 0;
  // How long this client has waited between tries, held to the budget.
  private waitedInMs: number = 0;
  // Requests in a row that failed every try for a reason that may pass.
  private failedRequestsInARow: number = 0;

  // How a client waits between tries; replaced in tests.
  public static sleep(ms: number): Promise<void> {
    return new Promise((resolve: () => void) => {
      setTimeout(resolve, ms);
    });
  }

  public constructor(options: HttpRetryOptions) {
    this.transport = options.transport;
    this.classify = options.classify;
    this.provider = options.provider;
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
    this.sleep =
      options.sleep ||
      ((ms: number): Promise<void> => {
        return DataSourceHttpRetry.sleep(ms);
      });
    this.maxAttempts = options.maxAttempts ?? HTTP_RETRY_MAX_ATTEMPTS;
    this.maxWaitInMs = options.maxWaitInMs ?? HTTP_RETRY_MAX_WAIT_IN_MS;
    this.budgetInMs = options.budgetInMs ?? HTTP_RETRY_BUDGET_IN_MS;
    this.firstBackoffInMs =
      options.firstBackoffInMs ?? HTTP_RETRY_FIRST_BACKOFF_IN_MS;
  }

  // How long this client has waited between tries so far.
  public get totalWaitInMs(): number {
    return this.waitedInMs;
  }

  // Whether the service looks down: nothing that may pass is asked again until something answers.
  public get isInOutage(): boolean {
    return this.failedRequestsInARow >= HTTP_RETRY_OUTAGE_AFTER_FAILED_REQUESTS;
  }

  /*
   * One request, asked again while its answer may pass and asking again is
   * safe, within the tries and the collection's budget. The last answer is
   * handed back, whatever it is, with how many times it was asked.
   */
  public async exchange(request: HttpRetryRequest): Promise<HttpRetryExchange> {
    const sharesThrottle: boolean = request.sharesThrottle !== false;

    for (let attempts: number = 1; ; attempts++) {
      if (sharesThrottle) {
        await this.waitOutThrottle();
      }

      const built: DataSourceHttpRequest = await request.build(attempts);
      let response: DataSourceHttpResponse;

      try {
        response = await this.transport(built);
      } catch (error) {
        // No answer: the caller's to say, never asked again (see the top of this file).
        throw new DataSourceUnreachedError(error);
      }

      const verdict: HttpRetryVerdict | null = this.classify(response, built);
      const waitInMs: number | null =
        verdict && attempts < this.maxAttempts
          ? this.reserveWait(verdict, response, attempts, request)
          : null;

      if (waitInMs === null) {
        this.noteEnd(verdict);

        return { response, attempts, verdict };
      }

      logger.debug(
        `${this.provider}: ${built.method} ${built.url.split("?")[0]} answered ${response.statusCode}; asking again in ${Math.ceil(waitInMs / 1000)} seconds (try ${attempts + 1} of ${this.maxAttempts}).`,
      );

      if (sharesThrottle && verdict!.reason === HttpRetryReason.Throttled) {
        this.throttledUntil = Math.max(
          this.throttledUntil,
          this.now() + waitInMs,
        );
      } else {
        await this.sleep(waitInMs);
      }
    }
  }

  /*
   * A transport that asks again as exchange does, for a caller that takes a
   * transport and reads its answers itself (Google's sign-in). It answers
   * every status to the caller as the plain transport would: one outside
   * 2xx is thrown as a BadDataException, as DataSourceHttpFetch throws one,
   * unless the request asked for every status. Its message says who answered
   * which request (its address without the query, which can hold a key) with
   * what status, then the provider's words; the status and the words are kept
   * on it too (DataSourceStatusException).
   */
  public asTransport(options: {
    isSafeToRepeat: (request: DataSourceHttpRequest) => boolean;
    sharesThrottle?: boolean | undefined;
  }): DataSourceTransport {
    return async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      const { response } = await this.exchange({
        build: (): DataSourceHttpRequest => {
          return { ...request, acceptAnyStatus: true };
        },
        isSafeToRepeat: options.isSafeToRepeat(request),
        sharesThrottle: options.sharesThrottle,
      });

      if (
        !request.acceptAnyStatus &&
        (response.statusCode < 200 || response.statusCode >= 300)
      ) {
        const said: string = (response.bodyText || "").substring(0, 500).trim();

        throw new DataSourceStatusException(
          `${this.provider} answered HTTP ${response.statusCode} to ${request.method} ${request.url.split("?")[0]}. ${said || "It gave no error message."}`,
          { statusCode: response.statusCode, bodyText: said },
        );
      }

      return response;
    };
  }

  /*
   * How long to wait before asking again, taken from the collection's
   * budget; null when asking again is not safe, the service looks down, or
   * the wait is longer than a collection waits.
   */
  private reserveWait(
    verdict: HttpRetryVerdict,
    response: DataSourceHttpResponse,
    attempts: number,
    request: HttpRetryRequest,
  ): number | null {
    const isThrottle: boolean = verdict.reason === HttpRetryReason.Throttled;

    if (!isThrottle && !request.isSafeToRepeat && verdict.isUndone !== true) {
      return null;
    }

    if (!isThrottle && this.isInOutage) {
      return null;
    }

    const backoffInMs: number = this.firstBackoffInMs * 2 ** (attempts - 1);
    const waitInMs: number =
      RetryAfter.msFromHeaders(response.headers, { nowMs: this.now() }) ??
      Math.max(readWaitInMs(verdict.waitInMs) ?? 0, backoffInMs);

    if (
      waitInMs > this.maxWaitInMs ||
      this.waitedInMs + waitInMs > this.budgetInMs
    ) {
      return null;
    }

    this.waitedInMs += waitInMs;

    return waitInMs;
  }

  // Counts a request that ended failing for a reason that may pass; anything else that answered ends the count.
  private noteEnd(verdict: HttpRetryVerdict | null): void {
    if (!verdict) {
      this.failedRequestsInARow = 0;
    } else if (verdict.reason === HttpRetryReason.Unavailable) {
      this.failedRequestsInARow++;
    }
  }

  // Waits until a throttle said the collection may ask again.
  private async waitOutThrottle(): Promise<void> {
    const waitInMs: number = this.throttledUntil - this.now();

    if (waitInMs > 0) {
      await this.sleep(waitInMs);
    }
  }
}
