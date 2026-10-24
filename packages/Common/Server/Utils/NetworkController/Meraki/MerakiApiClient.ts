import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import {
  MERAKI_API_BASE_PATH,
  MerakiRegionDefinition,
  getMerakiApiBaseUrl,
  isMerakiApiHost,
} from "../../../../Types/NetworkController/MerakiRegion";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import { NetworkControllerTransport } from "../NetworkControllerTypes";
import { parseMerakiLinkHeader } from "./MerakiLinkHeader";

/*
 * THE ONE WAY ONEUPTIME TALKS TO THE MERAKI DASHBOARD API.
 *
 * Every request:
 *
 *   - goes to the connection's region's API host only (MerakiRegion), over
 *     HTTPS, with the key in the Authorization header Meraki asks for
 *     ("Bearer <key>"). A redirect is followed only to a host under the
 *     region's own domain - an organization's shard - and a page link only
 *     there too; anything else is refused, so the key never leaves Meraki.
 *   - is paced: at most MERAKI_REQUESTS_PER_SECOND, started evenly. Meraki
 *     gives each organization 10 requests a second for EVERY application
 *     that reads it (developer.cisco.com/meraki/api-v1/rate-limit), so
 *     OneUptime keeps to a share of that and never crowds out the
 *     customer's own tools.
 *   - honours a 429: waits what Retry-After says (capped), halves its own
 *     pace for the rest of the read, and tries again - up to
 *     MAX_RATE_LIMIT_RETRIES times before it gives up and says so.
 *   - retries a server error or a dropped connection a little, and turns
 *     every other answer into an LlmProviderError that names the call, says
 *     what Meraki answered and never carries the key.
 *   - is counted against the read's budget (MerakiBudgetSpent when spent).
 */

// OneUptime's share of an organization's 10 requests a second.
export const MERAKI_REQUESTS_PER_SECOND: number = 3;
// After a 429 the pace halves, down to this.
export const MERAKI_MIN_REQUESTS_PER_SECOND: number = 1;
export const MAX_RATE_LIMIT_RETRIES: number = 3;
// The longest a Retry-After is waited; a longer one ends the read.
export const MAX_RETRY_AFTER_SECONDS: number = 60;
export const MAX_SERVER_ERROR_RETRIES: number = 2;
export const MAX_REDIRECTS: number = 3;
export const MERAKI_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;
// Longest error text kept from Meraki's answer.
const MAX_ERROR_BODY_LENGTH: number = 500;

// The read's budget ran out: the read stops where it is.
export class MerakiBudgetSpent extends Error {
  public constructor() {
    super("The read reached its limit for this run.");
    this.name = "MerakiBudgetSpent";
  }
}

export interface MerakiApiClientOptions {
  apiKey: string;
  region: MerakiRegionDefinition;
  transport: NetworkControllerTransport;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  requestsPerSecond?: number | undefined;
  // The read's budget: requests, and until when (epoch ms).
  maxRequests?: number | undefined;
  deadlineMs?: number | undefined;
  requestTimeoutInMs?: number | undefined;
}

export interface MerakiPage {
  status: number;
  body: unknown;
  // The page's `next` link, vetted: a URL of the region's API, or null.
  nextUrl: string | null;
}

export interface MerakiList {
  items: Array<unknown>;
  // True when maxPages was reached with more pages left.
  isTruncated: boolean;
}

export const DEFAULT_SLEEP: (milliseconds: number) => Promise<void> = (
  milliseconds: number,
): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, Math.max(0, milliseconds));
  });
};

/*
 * A query string with repeated keys, in the order given - Meraki takes
 * lists as `productTypes[]=appliance&productTypes[]=switch`. Empty values
 * are left out.
 */
export function buildMerakiQuery(
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
 * Seconds a Retry-After asks for: a number of seconds, or an HTTP date.
 * Null when it says neither.
 */
export function readRetryAfterSeconds(
  value: string | undefined,
  now: Date,
): number | null {
  if (!value) {
    return null;
  }

  const trimmed: string = value.trim();
  const seconds: number = Number(trimmed);

  if (trimmed !== "" && Number.isFinite(seconds)) {
    return Math.max(0, seconds);
  }

  const date: number = Date.parse(trimmed);

  if (Number.isFinite(date)) {
    return Math.max(0, Math.ceil((date - now.getTime()) / 1000));
  }

  return null;
}

/*
 * What Meraki said went wrong: its `errors` array ({"errors": ["..."]}),
 * else the start of the body.
 */
export function readMerakiErrors(response: DataSourceHttpResponse): string {
  const json: unknown = response.bodyJson;

  if (json && typeof json === "object" && !Array.isArray(json)) {
    const errors: unknown = (json as JSONObject)["errors"];

    if (Array.isArray(errors)) {
      const messages: Array<string> = errors
        .filter((error: unknown): boolean => {
          return typeof error === "string" && error.trim().length > 0;
        })
        .map((error: unknown): string => {
          return (error as string).trim();
        });

      if (messages.length > 0) {
        return messages.join(" ").substring(0, MAX_ERROR_BODY_LENGTH);
      }
    }
  }

  return (response.bodyText || "").trim().substring(0, MAX_ERROR_BODY_LENGTH);
}

export default class MerakiApiClient {
  private readonly apiKey: string;
  private readonly region: MerakiRegionDefinition;
  private readonly transport: NetworkControllerTransport;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxRequests: number;
  private readonly deadlineMs: number;
  private readonly requestTimeoutInMs: number;
  private requestsPerSecond: number;
  private lastRequestStartedAt: number | null = null;
  private used: number = 0;
  private rateLimited: boolean = false;

  public constructor(options: MerakiApiClientOptions) {
    this.apiKey = options.apiKey;
    this.region = options.region;
    this.transport = options.transport;
    this.now =
      options.now ||
      ((): Date => {
        return new Date();
      });
    this.sleep = options.sleep || DEFAULT_SLEEP;
    this.requestsPerSecond = Math.max(
      MERAKI_MIN_REQUESTS_PER_SECOND,
      options.requestsPerSecond || MERAKI_REQUESTS_PER_SECOND,
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
      options.requestTimeoutInMs || MERAKI_REQUEST_TIMEOUT_IN_MS;
  }

  // Requests made so far: what the read cost the organization's budget.
  public getRequestCount(): number {
    return this.used;
  }

  // Whether Meraki answered 429 at least once.
  public wasRateLimited(): boolean {
    return this.rateLimited;
  }

  public getRequestsPerSecond(): number {
    return this.requestsPerSecond;
  }

  // "https://api.meraki.com/api/v1/organizations/1/networks?perPage=1000"
  public urlOf(path: string, query: string = ""): string {
    return `${getMerakiApiBaseUrl(this.region)}${path}${query}`;
  }

  /*
   * Whether a URL is one this client may send the key to: HTTPS on the
   * region's API host or a host under its domain, on the API's path, with
   * no credentials of its own in it. Parsed, never matched as a substring.
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
      isMerakiApiHost(this.region, url.hostname) &&
      url.pathname.startsWith(`${MERAKI_API_BASE_PATH}/`)
    );
  }

  // One GET of the API. Throws LlmProviderError, or MerakiBudgetSpent.
  public async get(
    path: string,
    query: string,
    step: string,
  ): Promise<MerakiPage> {
    return await this.getUrl(this.urlOf(path, query), step);
  }

  /*
   * Every page of a list: the first page, then each `next` link Meraki
   * gives (vetted like any URL), up to maxPages. Each page must be an
   * array; anything else is a failure naming the call.
   */
  public async getAll(
    path: string,
    query: string,
    step: string,
    maxPages: number,
  ): Promise<MerakiList> {
    const items: Array<unknown> = [];
    let url: string | null = this.urlOf(path, query);
    let pages: number = 0;

    while (url) {
      if (pages >= maxPages) {
        return { items, isTruncated: true };
      }

      const page: MerakiPage = await this.getUrl(url, step);
      pages++;

      if (!Array.isArray(page.body)) {
        throw new LlmProviderError({
          message: this.redact(
            `Meraki answered the ${step} with something that is not a list (HTTP ${page.status}).`,
          ),
          kind: LlmConnectionFailureKind.Other,
          statusCode: page.status,
        });
      }

      items.push(...(page.body as Array<unknown>));
      url = page.nextUrl;
    }

    return { items, isTruncated: false };
  }

  private async getUrl(firstUrl: string, step: string): Promise<MerakiPage> {
    let url: string = firstUrl;
    let redirects: number = 0;
    let rateLimitRetries: number = 0;
    let serverErrorRetries: number = 0;

    for (;;) {
      if (!this.isAllowedUrl(url)) {
        throw new LlmProviderError({
          message: `Meraki's ${step} pointed OneUptime to an address outside the Meraki dashboard API (${this.region.apiHost}); nothing was sent there.`,
          kind: LlmConnectionFailureKind.Other,
        });
      }

      const response: DataSourceHttpResponse = await this.send(url, step);
      const status: number = response.statusCode;
      const headers: Dictionary<string> = response.headers || {};

      if (status >= 200 && status < 300) {
        const links: Record<string, string> = parseMerakiLinkHeader(
          headers["link"],
        );
        let nextUrl: string | null = null;

        if (links["next"]) {
          const next: string = this.resolve(links["next"], url);

          if (!this.isAllowedUrl(next)) {
            throw new LlmProviderError({
              message: `Meraki's ${step} gave a next page outside the Meraki dashboard API (${this.region.apiHost}); it was not read.`,
              kind: LlmConnectionFailureKind.Other,
            });
          }

          nextUrl = next;
        }

        return {
          status,
          body: response.bodyJson,
          nextUrl,
        };
      }

      if (status >= 300 && status < 400) {
        const location: string | undefined = headers["location"];

        if (!location || redirects >= MAX_REDIRECTS) {
          throw new LlmProviderError({
            message: `Meraki answered the ${step} with a redirect OneUptime could not follow (HTTP ${status}).`,
            kind: LlmConnectionFailureKind.Other,
            statusCode: status,
          });
        }

        redirects++;
        // Vetted at the top of the loop before anything is sent there.
        url = this.resolve(location, url);
        continue;
      }

      if (status === 429) {
        this.rateLimited = true;
        this.requestsPerSecond = Math.max(
          MERAKI_MIN_REQUESTS_PER_SECOND,
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
              `Meraki asked OneUptime to slow down (HTTP 429) on the ${step}: the organization's API budget is in use by other applications too. ${readMerakiErrors(response)}`.trim(),
            ),
            kind: LlmConnectionFailureKind.RateLimited,
            statusCode: status,
            ...(retryAfter !== null ? { retryAfterSeconds: retryAfter } : {}),
          });
        }

        rateLimitRetries++;
        await this.sleep(
          (retryAfter !== null ? retryAfter : 2 ** rateLimitRetries) * 1000,
        );
        continue;
      }

      if (status >= 500 && serverErrorRetries < MAX_SERVER_ERROR_RETRIES) {
        serverErrorRetries++;
        await this.sleep(1000 * serverErrorRetries);
        continue;
      }

      throw new LlmProviderError({
        message: this.redact(
          `Meraki answered the ${step} with HTTP ${status}: ${readMerakiErrors(response) || "no reason given"}`,
        ),
        kind: LlmProviderError.kindFromStatus(status),
        statusCode: status,
        responseBody: this.redact(readMerakiErrors(response)),
      });
    }
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
          await this.sleep(1000);
          continue;
        }

        throw LlmProviderError.from({
          error,
          step: step,
          providerTitle: "Meraki",
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
      throw new MerakiBudgetSpent();
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

  private resolve(location: string, base: string): string {
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
