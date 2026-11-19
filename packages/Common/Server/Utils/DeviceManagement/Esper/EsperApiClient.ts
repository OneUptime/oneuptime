import Dictionary from "../../../../Types/Dictionary";
import {
  getEsperApiBaseUrl,
  getEsperApiHost,
} from "../../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import RetryAfter from "../../../../Utils/RetryAfter";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  DeviceManagementBudgetSpent,
  DeviceManagementTransport,
} from "../DeviceManagementTypes";

/*
 * THE ONE WAY ONEUPTIME TALKS TO ESPER'S API.
 *
 * Esper's API lives at https://<tenant>-api.esper.cloud/api and takes the
 * key as "Authorization: Bearer <key>" (Esper's API reference,
 * api.esper.io). Every request:
 *
 *   - goes to the tenant's API host only, over HTTPS, on the API's path. A
 *     page link or a redirect elsewhere is refused, so the key never leaves
 *     the tenant's API. The tenant itself is one DNS label
 *     (readEsperTenant), never a host someone typed.
 *   - is paced: one at a time, at most ESPER_REQUESTS_PER_SECOND. Esper
 *     publishes no limit; its guidance for a 429 is to start at "about 20
 *     requests at a time" and build up, so OneUptime stays well under that
 *     and never crowds out the tenant's own tools.
 *   - honours a 429: waits what Retry-After says (capped), or backs off
 *     exponentially with jitter when Esper says nothing, halves its own pace
 *     for the rest of the read, and tries again - up to
 *     MAX_RATE_LIMIT_RETRIES times before it gives up and says so.
 *   - retries a server error or a dropped connection a little, and turns
 *     every other answer into an LlmProviderError that names the call, says
 *     what Esper answered and never carries the key.
 *   - is counted against the read's budget (DeviceManagementBudgetSpent
 *     when spent).
 *
 * Esper wraps some answers in an envelope - the v2 device list and the
 * heartbeats answer {"code", "message", "content": {...}} - and answers the
 * older enterprise routes bare. unwrapContent reads both.
 */

export const ESPER_REQUESTS_PER_SECOND: number = 5;
// After a 429 the pace halves, down to this.
export const ESPER_MIN_REQUESTS_PER_SECOND: number = 0.5;
export const MAX_RATE_LIMIT_RETRIES: number = 4;
// The longest a Retry-After is waited; a longer one ends the read.
export const MAX_RETRY_AFTER_SECONDS: number = 60;
// The longest a back-off waits when Esper names no wait.
export const MAX_BACKOFF_SECONDS: number = 30;
export const MAX_SERVER_ERROR_RETRIES: number = 2;
export const MAX_REDIRECTS: number = 3;
export const ESPER_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;
// Longest error text kept from Esper's answer.
const MAX_ERROR_BODY_LENGTH: number = 500;

export interface EsperApiClientOptions {
  apiKey: string;
  tenant: string;
  transport: DeviceManagementTransport;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
  requestsPerSecond?: number | undefined;
  // The read's budget: requests, and until when (epoch ms).
  maxRequests?: number | undefined;
  deadlineMs?: number | undefined;
  requestTimeoutInMs?: number | undefined;
}

export interface EsperPage {
  status: number;
  // The body with Esper's envelope taken off.
  body: unknown;
}

// An answer, with the address that gave it (after any redirect).
interface EsperAnswer {
  response: DataSourceHttpResponse;
  url: string;
}

export interface EsperList {
  items: Array<unknown>;
  // Esper's count of every item, when it gave one.
  count?: number | undefined;
  // True when maxPages, or the read's budget, was reached with more pages left.
  isTruncated: boolean;
  // True when it was the read's budget that cut the list short.
  isBudgetSpent?: boolean | undefined;
}

export const DEFAULT_SLEEP: (milliseconds: number) => Promise<void> = (
  milliseconds: number,
): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, Math.max(0, milliseconds));
  });
};

// A query string from the given parameters, in order. Empty values are left out.
export function buildEsperQuery(
  params: Array<[string, string | number | undefined | null]>,
): string {
  const parts: Array<string> = [];

  for (const [key, value] of params) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    );
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/*
 * Esper's answer without its envelope: the v2 routes and the heartbeats
 * answer {"code", "message", "content": {...}}, the enterprise routes the
 * object itself.
 */
export function unwrapContent(body: unknown): unknown {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const content: unknown = (body as JSONObject)["content"];

    if (content && typeof content === "object") {
      return content;
    }
  }

  return body;
}

/*
 * What Esper said went wrong: its `message`, its `errors` list, or its
 * `detail`, else the start of the body.
 */
export function readEsperError(response: DataSourceHttpResponse): string {
  const json: unknown = response.bodyJson;
  const parts: Array<string> = [];

  if (json && typeof json === "object" && !Array.isArray(json)) {
    const body: JSONObject = json as JSONObject;

    for (const key of ["message", "detail", "error"]) {
      const value: unknown = body[key];

      if (typeof value === "string" && value.trim()) {
        parts.push(value.trim());
      }
    }

    const errors: unknown = body["errors"];

    if (Array.isArray(errors)) {
      for (const error of errors) {
        if (typeof error === "string" && error.trim()) {
          parts.push(error.trim());
        }
      }
    }
  }

  const text: string =
    parts.length > 0
      ? Array.from(new Set<string>(parts)).join(" ")
      : (response.bodyText || "").trim();

  return text.substring(0, MAX_ERROR_BODY_LENGTH);
}

/*
 * Seconds a Retry-After asks for, as RFC 9110 writes it; null when it says
 * nothing that can be read.
 */
export function readRetryAfterSeconds(
  value: string | undefined,
  now: Date,
): number | null {
  return RetryAfter.parseSeconds(value, { nowMs: now.getTime() }) ?? null;
}

export default class EsperApiClient {
  private readonly apiKey: string;
  private readonly tenant: string;
  private readonly transport: DeviceManagementTransport;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRequests: number;
  private readonly deadlineMs: number;
  private readonly requestTimeoutInMs: number;
  private requestsPerSecond: number;
  private lastRequestStartedAt: number | null = null;
  private used: number = 0;
  private rateLimited: boolean = false;

  public constructor(options: EsperApiClientOptions) {
    this.apiKey = options.apiKey;
    this.tenant = options.tenant;
    this.transport = options.transport;
    this.now =
      options.now ||
      ((): Date => {
        return new Date();
      });
    this.sleep = options.sleep || DEFAULT_SLEEP;
    this.random = options.random || Math.random;
    this.requestsPerSecond = Math.max(
      ESPER_MIN_REQUESTS_PER_SECOND,
      options.requestsPerSecond || ESPER_REQUESTS_PER_SECOND,
    );
    this.maxRequests =
      options.maxRequests !== undefined && options.maxRequests >= 0
        ? options.maxRequests
        : Number.POSITIVE_INFINITY;
    this.deadlineMs =
      options.deadlineMs !== undefined
        ? options.deadlineMs
        : Number.POSITIVE_INFINITY;
    this.requestTimeoutInMs =
      options.requestTimeoutInMs || ESPER_REQUEST_TIMEOUT_IN_MS;
  }

  // Requests made so far: what the read cost the tenant's budget.
  public getRequestCount(): number {
    return this.used;
  }

  // Whether Esper answered 429 at least once.
  public wasRateLimited(): boolean {
    return this.rateLimited;
  }

  public getRequestsPerSecond(): number {
    return this.requestsPerSecond;
  }

  // Whether the read's budget has room for this many more requests.
  public hasBudgetFor(requests: number): boolean {
    return (
      this.used + requests <= this.maxRequests &&
      this.now().getTime() < this.deadlineMs
    );
  }

  // "https://acme-api.esper.cloud/api/v2/devices/?limit=1000"
  public urlOf(path: string, query: string = ""): string {
    return `${getEsperApiBaseUrl(this.tenant)}${path}${query}`;
  }

  /*
   * Whether a URL is one this client may send the key to: HTTPS on the
   * tenant's API host, on the API's path, with no credentials of its own in
   * it. Parsed, never matched as a substring.
   */
  public isAllowedUrl(value: string): boolean {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      return false;
    }

    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.port === "" || url.port === "443") &&
      url.hostname.toLowerCase() === getEsperApiHost(this.tenant) &&
      url.pathname.startsWith("/api/")
    );
  }

  // One GET of the API. Throws LlmProviderError, or DeviceManagementBudgetSpent.
  public async get(
    path: string,
    query: string,
    step: string,
  ): Promise<EsperPage> {
    const answer: EsperAnswer = await this.getUrl(
      this.urlOf(path, query),
      step,
    );

    return {
      status: answer.response.statusCode,
      body: unwrapContent(answer.response.bodyJson),
    };
  }

  /*
   * Every page of a list: the first page, then each `next` link Esper gives
   * (vetted like any URL), up to maxPages. Each page must be a list -
   * {"count", "next", "results": [...]}, in its envelope or bare - and
   * anything else is a failure naming the call.
   */
  public async getAll(
    path: string,
    query: string,
    step: string,
    maxPages: number,
    options: { stopWhenBudgetSpent?: boolean | undefined } = {},
  ): Promise<EsperList> {
    const items: Array<unknown> = [];
    let url: string | null = this.urlOf(path, query);
    let pages: number = 0;
    let count: number | undefined = undefined;

    while (url) {
      if (pages >= maxPages) {
        return { items, count, isTruncated: true };
      }

      let answer: EsperAnswer;

      try {
        answer = await this.getUrl(url, step);
      } catch (error) {
        /*
         * The read's budget ran out part way: what was read so far, said
         * to be cut short, when the caller can use a list cut short.
         */
        if (
          options.stopWhenBudgetSpent &&
          error instanceof DeviceManagementBudgetSpent
        ) {
          return { items, count, isTruncated: true, isBudgetSpent: true };
        }

        throw error;
      }

      const response: DataSourceHttpResponse = answer.response;
      pages++;

      const body: unknown = unwrapContent(response.bodyJson);
      const results: unknown =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as JSONObject)["results"]
          : Array.isArray(body)
            ? body
            : undefined;

      if (!Array.isArray(results)) {
        throw new LlmProviderError({
          message: this.redact(
            `Esper answered the ${step} with something that is not a list (HTTP ${response.statusCode}).`,
          ),
          kind: LlmConnectionFailureKind.Other,
          statusCode: response.statusCode,
        });
      }

      items.push(...(results as Array<unknown>));

      const pageCount: unknown =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as JSONObject)["count"]
          : undefined;

      if (count === undefined && typeof pageCount === "number") {
        count = pageCount;
      }

      const next: unknown =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as JSONObject)["next"]
          : undefined;

      url = null;

      /*
       * An empty page ends the list whatever it says next: a list that
       * keeps answering "next" with nothing on it would otherwise be read
       * to maxPages.
       */
      if (typeof next === "string" && next.trim() && results.length > 0) {
        const nextUrl: string = this.resolveAgainst(next.trim(), answer.url);

        if (!this.isAllowedUrl(nextUrl)) {
          throw new LlmProviderError({
            message: `Esper's ${step} gave a next page outside the tenant's API (${getEsperApiHost(this.tenant)}); it was not read.`,
            kind: LlmConnectionFailureKind.Other,
          });
        }

        url = nextUrl;
      }
    }

    return { items, count, isTruncated: false };
  }

  private async getUrl(firstUrl: string, step: string): Promise<EsperAnswer> {
    let url: string = firstUrl;
    let redirects: number = 0;
    let rateLimitRetries: number = 0;
    let serverErrorRetries: number = 0;

    for (;;) {
      if (!this.isAllowedUrl(url)) {
        throw new LlmProviderError({
          message: `Esper's ${step} pointed OneUptime to an address outside the tenant's API (${getEsperApiHost(this.tenant)}); nothing was sent there.`,
          kind: LlmConnectionFailureKind.Other,
        });
      }

      const response: DataSourceHttpResponse = await this.send(url, step);
      const status: number = response.statusCode;
      const headers: Dictionary<string> = response.headers || {};

      if (status >= 200 && status < 300) {
        return { response, url };
      }

      if (status >= 300 && status < 400) {
        const location: string | undefined = headers["location"];

        if (!location || redirects >= MAX_REDIRECTS) {
          throw new LlmProviderError({
            message: `Esper answered the ${step} with a redirect OneUptime could not follow (HTTP ${status}).`,
            kind: LlmConnectionFailureKind.Other,
            statusCode: status,
          });
        }

        redirects++;
        // Vetted at the top of the loop before anything is sent there.
        url = this.resolveAgainst(location, url);
        continue;
      }

      if (status === 429) {
        this.rateLimited = true;
        this.requestsPerSecond = Math.max(
          ESPER_MIN_REQUESTS_PER_SECOND,
          this.requestsPerSecond / 2,
        );

        const retryAfter: number | null = readRetryAfterSeconds(
          headers["retry-after"],
          this.now(),
        );

        if (
          rateLimitRetries >= MAX_RATE_LIMIT_RETRIES ||
          (retryAfter !== null && retryAfter > MAX_RETRY_AFTER_SECONDS)
        ) {
          throw new LlmProviderError({
            message: this.redact(
              `Esper asked OneUptime to slow down (HTTP 429) on the ${step}: the tenant's API is busy with other requests too. ${readEsperError(response)}`.trim(),
            ),
            kind: LlmConnectionFailureKind.RateLimited,
            statusCode: status,
            ...(retryAfter !== null ? { retryAfterSeconds: retryAfter } : {}),
          });
        }

        rateLimitRetries++;
        await this.sleep(
          retryAfter !== null
            ? retryAfter * 1000
            : this.backoffMs(rateLimitRetries),
        );
        continue;
      }

      if (status >= 500 && serverErrorRetries < MAX_SERVER_ERROR_RETRIES) {
        serverErrorRetries++;
        await this.sleep(this.backoffMs(serverErrorRetries));
        continue;
      }

      throw new LlmProviderError({
        message: this.redact(
          `Esper answered the ${step} with HTTP ${status}: ${readEsperError(response) || "no reason given"}`,
        ),
        kind: LlmProviderError.kindFromStatus(status),
        statusCode: status,
        responseBody: this.redact(readEsperError(response)),
      });
    }
  }

  /*
   * How long the n-th retry waits when Esper names no wait: 2^n seconds,
   * capped, with up to half of it added or taken at random, so the readers
   * of many connections that were refused together do not all come back in
   * the same second.
   */
  public backoffMs(attempt: number): number {
    const base: number = Math.min(
      MAX_BACKOFF_SECONDS,
      Math.pow(2, Math.max(0, attempt)),
    );
    const jitter: number = 0.5 + Math.min(1, Math.max(0, this.random()));

    return Math.round(base * jitter * 1000);
  }

  // One request, paced and counted; a dropped connection is tried once more.
  private async send(
    url: string,
    step: string,
  ): Promise<DataSourceHttpResponse> {
    let attempts: number = 0;

    for (;;) {
      await this.takeTurn();
      attempts++;

      try {
        return await this.transport({
          method: "GET",
          url: url,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
          },
          timeoutInMs: this.requestTimeoutInMs,
          acceptAnyStatus: true,
        });
      } catch (error) {
        if (attempts <= 1) {
          await this.sleep(this.backoffMs(0));
          continue;
        }

        throw LlmProviderError.from({
          error,
          step: step,
          providerTitle: "Esper",
          secretValues: [this.apiKey],
        });
      }
    }
  }

  /*
   * Waits for this request's turn: the budget first (spent: stop), then the
   * pace - requests start 1/requestsPerSecond apart.
   */
  private async takeTurn(): Promise<void> {
    const nowMs: number = this.now().getTime();

    if (this.used >= this.maxRequests || nowMs >= this.deadlineMs) {
      throw new DeviceManagementBudgetSpent();
    }

    if (this.lastRequestStartedAt !== null) {
      const spacingMs: number = 1000 / this.requestsPerSecond;
      const waitMs: number = this.lastRequestStartedAt + spacingMs - nowMs;

      if (waitMs > 0) {
        await this.sleep(waitMs);
      }
    }

    this.lastRequestStartedAt = Math.max(
      this.now().getTime(),
      (this.lastRequestStartedAt || 0) + 1000 / this.requestsPerSecond,
    );
    this.used++;
  }

  // A link, resolved against the address of the answer it came in.
  private resolveAgainst(location: string, base: string): string {
    try {
      return new URL(location, base).toString();
    } catch {
      return "";
    }
  }

  private redact(text: string): string {
    return LlmProviderError.redact(text, [this.apiKey]);
  }
}
