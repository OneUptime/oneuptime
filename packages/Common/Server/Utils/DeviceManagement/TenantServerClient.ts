import Dictionary from "../../../Types/Dictionary";
import EgressGuardException from "../../../Types/Exception/EgressGuardException";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import RetryAfter from "../../../Utils/RetryAfter";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";
import LlmProviderError from "../LlmObservability/LlmProviderError";
import DeviceManagementRequestPacer from "./DeviceManagementRequestPacer";
import { DeviceManagementTransport } from "./DeviceManagementTypes";

/*
 * ONE DEVICE MANAGER'S API, AT A SERVER THE CUSTOMER NAMES (#10086, #10087).
 *
 * Workspace ONE UEM and SOTI MobiControl answer at the tenant's own server
 * (readServerAddress in DeviceManagementConnectionSettings): where
 * OneUptime connects, with the connection's credentials, is something a
 * person typed. Every request to it goes through this client, which:
 *
 *   - sends it through the transport: DataSourceHttpFetch in production,
 *     whose egress guard refuses a loopback, link-local or cloud metadata
 *     address always, and a private one on OneUptime Cloud. The first
 *     request, each page, each redirect and each retry is a request of its
 *     own, so each is checked, at the address it resolves to then;
 *   - sends the credentials to the configured server alone: HTTPS, its host
 *     and port, under the API's path, with no user or password in the URL.
 *     A redirect or a next page anywhere else is refused before anything
 *     is sent there; one on the server is followed, up to MAX_REDIRECTS;
 *   - is paced and counted against the read's budget by the shared pacer,
 *     the sign-in's requests too;
 *   - honours a 429: waits what Retry-After says (capped), or backs off with
 *     jitter, halves its pace for the rest of the read, and tries again, up
 *     to MAX_RATE_LIMIT_RETRIES times;
 *   - asks for a new sign-in once when the server says the token it had is
 *     no longer good;
 *   - retries a server error or a dropped connection a little - never an
 *     address the egress guard refused, which no retry changes;
 *   - turns every other answer into an LlmProviderError that names the
 *     call, says what the server answered and never carries a credential.
 */

export const MAX_RATE_LIMIT_RETRIES: number = 4;
export const MAX_RETRY_AFTER_SECONDS: number = 60;
export const MAX_BACKOFF_SECONDS: number = 30;
export const MAX_SERVER_ERROR_RETRIES: number = 2;
export const MAX_REDIRECTS: number = 3;
export const TENANT_SERVER_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;
export const DEFAULT_MIN_REQUESTS_PER_SECOND: number = 0.25;
const MAX_ERROR_TEXT_LENGTH: number = 400;

/*
 * What a refusal of a private address adds, when the egress guard may say
 * so: a server on a private network is read by a self-hosted OneUptime.
 */
export const PRIVATE_SERVER_HINT: string =
  " OneUptime Cloud reads servers on the public internet only. A server on a private network can be read by a self-hosted OneUptime.";

// How OneUptime signs in to the server: a token it asks for, or a fixed header.
export interface TenantServerSignIn {
  /*
   * The headers that authorize a request to the API, asking the server (or
   * the service's token service) for a token when there is none yet.
   * Throws LlmProviderError naming what the sign-in refused.
   */
  authorize(client: TenantServerClient): Promise<Dictionary<string>>;
  /*
   * The API refused what authorize gave (401): forget a token. True when
   * signing in again may help - false for credentials that do not change.
   */
  forget(): boolean;
  // Every secret the sign-in holds, its token too, to redact out of any text.
  secretValues(): Array<string>;
}

export interface TenantServerRefusal {
  kind?: LlmConnectionFailureKind | undefined;
  // What to do, in a sentence, for a person who set the connection up.
  hint?: string | undefined;
}

export interface TenantServerClientOptions {
  // What an error names: "Workspace ONE UEM", "SOTI MobiControl".
  serviceTitle: string;
  // How the egress guard names the server: "Workspace ONE UEM server".
  egressLabel: string;
  /*
   * The API's base address: https://as1234.awmdm.com/api. Its origin is the
   * one server the credentials go to, and its path the one they go under.
   */
  apiBaseUrl: string;
  signIn: TenantServerSignIn;
  // Headers every API request carries, such as an Accept naming a version.
  headers?: Dictionary<string> | undefined;
  // What the server said went wrong, from an answer that is not a success: one line, or "".
  readError: (response: DataSourceHttpResponse) => string;
  // What an answer that is not a success means for the service, where it says more than its status.
  describeRefusal?:
    | ((status: number, said: string) => TenantServerRefusal | undefined)
    | undefined;
  /*
   * Whether a 429 says no wait of seconds helps - a daily quota used up -
   * so it is not tried again this read.
   */
  isRateLimitFinal?: ((said: string) => boolean) | undefined;
  transport: DeviceManagementTransport;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
  requestsPerSecond: number;
  minRequestsPerSecond?: number | undefined;
  // The read's budget: requests, and until when (epoch ms).
  maxRequests?: number | undefined;
  deadlineMs?: number | undefined;
  requestTimeoutInMs?: number | undefined;
}

export interface TenantServerAnswer {
  status: number;
  // The parsed JSON body; undefined for none (204) or a body that is not JSON.
  body: unknown;
  headers: Dictionary<string>;
}

const DEFAULT_SLEEP: (milliseconds: number) => Promise<void> = (
  milliseconds: number,
): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, Math.max(0, milliseconds));
  });
};

// Text a server wrote, on one line, cut to a sentence's length.
export function firstLineOf(text: string): string {
  const cut: number = text.search(/\r?\n/);

  return (cut >= 0 ? text.substring(0, cut) : text)
    .trim()
    .substring(0, MAX_ERROR_TEXT_LENGTH);
}

// Whether a text ends as a sentence does: a full stop, a question or an exclamation mark.
function endsSentence(text: string): boolean {
  return text.endsWith(".") || text.endsWith("?") || text.endsWith("!");
}

// A URL's path, lowercased and with one slash at its end, for comparing as a prefix.
function asPathPrefix(path: string): string {
  const lower: string = path.toLowerCase();

  return lower.endsWith("/") ? lower : `${lower}/`;
}

export default class TenantServerClient {
  private readonly options: TenantServerClientOptions;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly requestTimeoutInMs: number;
  private readonly apiBase: URL;
  private readonly apiPathPrefix: string;
  private readonly pacer: DeviceManagementRequestPacer;
  private rateLimited: boolean = false;

  public constructor(options: TenantServerClientOptions) {
    this.options = options;
    this.now =
      options.now ||
      ((): Date => {
        return new Date();
      });
    this.sleep = options.sleep || DEFAULT_SLEEP;
    this.requestTimeoutInMs =
      options.requestTimeoutInMs || TENANT_SERVER_REQUEST_TIMEOUT_IN_MS;
    this.apiBase = new URL(options.apiBaseUrl);
    this.apiPathPrefix = asPathPrefix(this.apiBase.pathname);
    this.pacer = new DeviceManagementRequestPacer({
      now: this.now,
      sleep: this.sleep,
      random: options.random || Math.random,
      requestsPerSecond: options.requestsPerSecond,
      minRequestsPerSecond:
        options.minRequestsPerSecond || DEFAULT_MIN_REQUESTS_PER_SECOND,
      maxBackoffSeconds: MAX_BACKOFF_SECONDS,
      maxRequests: options.maxRequests,
      deadlineMs: options.deadlineMs,
    });
  }

  public getRequestCount(): number {
    return this.pacer.getRequestCount();
  }

  public wasRateLimited(): boolean {
    return this.rateLimited;
  }

  public getRequestsPerSecond(): number {
    return this.pacer.getRequestsPerSecond();
  }

  public hasBudgetFor(requests: number): boolean {
    return this.pacer.hasBudgetFor(requests);
  }

  // How long the n-th retry waits when the server names no wait.
  public backoffMs(attempt: number): number {
    return this.pacer.backoffMs(attempt);
  }

  // The server's host as an error names it: as1234.awmdm.com.
  public getServerHost(): string {
    return this.apiBase.host;
  }

  /*
   * The address of an API path: urlOf("/mdm/devices/search", { page: 0 })
   * is https://as1234.awmdm.com/api/mdm/devices/search?page=0. The path is
   * the API's own, never anything a server answered.
   */
  public urlOf(path: string, query: Dictionary<string | number> = {}): string {
    const url: URL = new URL(this.apiBase.toString());

    url.pathname = `${this.apiBase.pathname.replace(/\/+$/, "")}${path}`;

    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }

  /*
   * Whether a URL is one the credentials may go to: HTTPS, on the
   * configured server's host and port, under the API's path, with no user
   * or password of its own. Parsed, never matched as a substring.
   */
  public isAllowedServerUrl(value: string): boolean {
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
      url.hostname.toLowerCase() === this.apiBase.hostname.toLowerCase() &&
      url.port === this.apiBase.port &&
      asPathPrefix(url.pathname).startsWith(this.apiPathPrefix)
    );
  }

  /*
   * One GET of the API, authorized, with the redirects, retries and
   * renewals above. Answers any 2xx, 204 included. Throws LlmProviderError,
   * or DeviceManagementBudgetSpent once the read's budget is spent.
   */
  public async get(
    path: string,
    query: Dictionary<string | number>,
    step: string,
  ): Promise<TenantServerAnswer> {
    return this.requestUrl({
      method: "GET",
      url: this.urlOf(path, query),
      step,
    });
  }

  /*
   * One POST of a JSON body to the API: a read that takes its question as
   * a body (SOTI's device summary). A redirect is never followed with it.
   */
  public async postJson(
    path: string,
    body: unknown,
    step: string,
  ): Promise<TenantServerAnswer> {
    return this.requestUrl({
      method: "POST",
      url: this.urlOf(path),
      body: JSON.stringify(body),
      step,
    });
  }

  /*
   * One GET of a URL the server named - a next page - vetted like any
   * other before anything is sent there.
   */
  public async getUrl(
    firstUrl: string,
    step: string,
  ): Promise<TenantServerAnswer> {
    return this.requestUrl({ method: "GET", url: firstUrl, step });
  }

  private async requestUrl(data: {
    method: "GET" | "POST";
    url: string;
    body?: string | undefined;
    step: string;
  }): Promise<TenantServerAnswer> {
    const step: string = data.step;
    let url: string = data.url;
    let redirects: number = 0;
    let rateLimitRetries: number = 0;
    let serverErrorRetries: number = 0;
    let isSignInRenewed: boolean = false;

    for (;;) {
      if (!this.isAllowedServerUrl(url)) {
        throw new LlmProviderError({
          message: `The ${this.options.serviceTitle} server's ${step} pointed OneUptime to an address outside the server (${this.getServerHost()}); nothing was sent there.`,
          kind: LlmConnectionFailureKind.Other,
        });
      }

      const authorization: Dictionary<string> =
        await this.options.signIn.authorize(this);
      const target: string = url;
      const response: DataSourceHttpResponse = await this.send(
        step,
        (): Promise<DataSourceHttpResponse> => {
          return this.options.transport({
            method: data.method,
            url: target,
            headers: {
              Accept: "application/json",
              ...(this.options.headers || {}),
              ...(data.body !== undefined
                ? { "Content-Type": "application/json" }
                : {}),
              ...authorization,
            },
            ...(data.body !== undefined ? { body: data.body } : {}),
            timeoutInMs: this.requestTimeoutInMs,
            egressOptions: this.egressOptions(),
            acceptAnyStatus: true,
          });
        },
      );
      const status: number = response.statusCode;
      const headers: Dictionary<string> = response.headers || {};

      if (status >= 200 && status < 300) {
        return {
          status,
          body: status === 204 ? undefined : response.bodyJson,
          headers,
        };
      }

      if (status >= 300 && status < 400) {
        const location: string | undefined = headers["location"];

        if (!location || redirects >= MAX_REDIRECTS || data.method !== "GET") {
          throw new LlmProviderError({
            message: `The ${this.options.serviceTitle} server answered the ${step} with a redirect OneUptime could not follow (HTTP ${status}).`,
            kind: LlmConnectionFailureKind.Other,
            statusCode: status,
          });
        }

        redirects++;
        // Vetted at the top of the loop before anything is sent there.
        url = this.resolveAgainst(location, url);
        continue;
      }

      // A token the server no longer takes: one new sign-in, then the answer stands.
      if (status === 401 && !isSignInRenewed && this.options.signIn.forget()) {
        isSignInRenewed = true;
        continue;
      }

      if (status === 429) {
        this.rateLimited = true;
        this.pacer.slowDown();

        const retryAfter: number | null =
          RetryAfter.parseSeconds(headers["retry-after"], {
            nowMs: this.now().getTime(),
          }) ?? null;

        const said: string = this.options.readError(response);

        if (
          rateLimitRetries >= MAX_RATE_LIMIT_RETRIES ||
          (retryAfter !== null && retryAfter > MAX_RETRY_AFTER_SECONDS) ||
          this.options.isRateLimitFinal?.(said) === true
        ) {
          throw new LlmProviderError({
            message: this.redact(
              `The ${this.options.serviceTitle} server asked OneUptime to slow down (HTTP 429) on the ${step}.${said ? ` ${said}` : ""}`,
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

      throw this.failure(response, step);
    }
  }

  /*
   * A sign-in's own request (a token): paced, counted, sent through the
   * transport with the egress guard, and tried once more on a dropped
   * connection. Its answer is the sign-in's to read, whatever its status;
   * a redirect is never followed.
   */
  public async sendSignInRequest(
    request: DataSourceHttpRequest,
    step: string,
  ): Promise<DataSourceHttpResponse> {
    return this.send(step, (): Promise<DataSourceHttpResponse> => {
      return this.options.transport({
        ...request,
        timeoutInMs: this.requestTimeoutInMs,
        egressOptions: this.egressOptions(),
        acceptAnyStatus: true,
      });
    });
  }

  // What an answer that is not a success means, as an error to show.
  public failure(
    response: DataSourceHttpResponse,
    step: string,
  ): LlmProviderError {
    const status: number = response.statusCode;
    const said: string = this.options.readError(response);
    const refusal: TenantServerRefusal | undefined =
      this.options.describeRefusal?.(status, said);
    const kind: LlmConnectionFailureKind =
      refusal?.kind || LlmProviderError.kindFromStatus(status);

    return new LlmProviderError({
      message: this.redact(
        `The ${this.options.serviceTitle} server answered the ${step} with HTTP ${status}${said ? `: ${said}` : ""}${endsSentence(said) ? "" : "."}${refusal?.hint ? ` ${refusal.hint}` : ""}`,
      ),
      kind,
      statusCode: status,
      responseBody: this.redact(said),
    });
  }

  // A text safe to show: every credential the sign-in holds removed.
  public redact(text: string): string {
    return LlmProviderError.redact(text, this.options.signIn.secretValues());
  }

  private egressOptions(): DataSourceHttpRequest["egressOptions"] {
    return {
      targetLabel: this.options.egressLabel,
      privateNetworkHint: PRIVATE_SERVER_HINT,
    };
  }

  // One request, paced and counted; a dropped connection is tried once more.
  private async send(
    step: string,
    request: () => Promise<DataSourceHttpResponse>,
  ): Promise<DataSourceHttpResponse> {
    let attempts: number = 0;

    for (;;) {
      await this.pacer.takeTurn();
      attempts++;

      try {
        return await request();
      } catch (error) {
        // An address the guard refused stays refused: never retried.
        if (error instanceof EgressGuardException) {
          throw new LlmProviderError({
            message: this.redact(
              `OneUptime did not connect to the ${this.options.serviceTitle} server for the ${step}: ${error.message}`,
            ),
            kind: LlmConnectionFailureKind.Settings,
          });
        }

        if (attempts <= 1) {
          await this.sleep(this.backoffMs(0));
          continue;
        }

        throw LlmProviderError.from({
          error,
          step: step,
          providerTitle: this.options.serviceTitle,
          secretValues: this.options.signIn.secretValues(),
        });
      }
    }
  }

  private resolveAgainst(location: string, base: string): string {
    try {
      return new URL(location, base).toString();
    } catch {
      return "";
    }
  }
}
