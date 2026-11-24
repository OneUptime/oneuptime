import Dictionary from "../../../../Types/Dictionary";
import {
  getIntuneCloudHosts,
  getIntuneTokenUrl,
} from "../../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import RetryAfter from "../../../../Utils/RetryAfter";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import DeviceManagementRequestPacer from "../DeviceManagementRequestPacer";
import {
  DeviceManagementBudgetSpent,
  DeviceManagementTransport,
} from "../DeviceManagementTypes";

/*
 * THE ONE WAY ONEUPTIME TALKS TO MICROSOFT INTUNE (#9837).
 *
 * Intune's API is Microsoft Graph. OneUptime signs in as the tenant's own
 * app registration, with the client credentials grant
 * (POST {login}/{tenant}/oauth2/v2.0/token, scope {graph}/.default), and
 * reads with the token it gets: the app registration needs one application
 * permission, DeviceManagementManagedDevices.Read.All, with admin consent.
 * Every request:
 *
 *   - goes to the cloud's sign-in host (the token) or its Graph host (the
 *     rest), over HTTPS, on Graph's /v1.0/ or /beta/ paths. A next page or
 *     a redirect elsewhere is refused, so the token never leaves Graph.
 *     Both hosts are Microsoft's own, fixed per cloud: nothing anyone typed
 *     becomes a host, and the tenant is one path segment, checked
 *     (readIntuneTenant) and encoded.
 *   - goes through the transport, the egress-guarded DataSourceHttpFetch in
 *     production.
 *   - is paced: one at a time, at most INTUNE_REQUESTS_PER_SECOND. Graph's
 *     Intune devices service allows an app 2,000 requests per 20 seconds
 *     in a tenant; OneUptime stays far under it.
 *   - honours a 429: waits what Retry-After says (capped), or backs off
 *     with jitter, halves its pace for the rest of the read, and tries
 *     again, up to MAX_RATE_LIMIT_RETRIES times.
 *   - asks for a new token once when Graph says the one it has expired.
 *   - retries a server error or a dropped connection a little, and turns
 *     every other answer into an LlmProviderError that names the call,
 *     says what Microsoft answered and never carries the client secret or
 *     the token.
 *   - is counted against the read's budget, the token's request too.
 */

export const INTUNE_REQUESTS_PER_SECOND: number = 5;
export const INTUNE_MIN_REQUESTS_PER_SECOND: number = 0.5;
export const MAX_RATE_LIMIT_RETRIES: number = 4;
export const MAX_RETRY_AFTER_SECONDS: number = 60;
export const MAX_BACKOFF_SECONDS: number = 30;
export const MAX_SERVER_ERROR_RETRIES: number = 2;
export const MAX_REDIRECTS: number = 3;
export const INTUNE_REQUEST_TIMEOUT_IN_MS: number = 60 * 1000;
// A token is asked for again this long before Microsoft says it expires.
export const TOKEN_EXPIRY_MARGIN_IN_MS: number = 5 * 60 * 1000;
// How the egress guard names where a request went.
export const INTUNE_EGRESS_LABEL: string = "Microsoft Intune";
const MAX_ERROR_TEXT_LENGTH: number = 400;
const GRAPH_PATH_PREFIXES: ReadonlyArray<string> = ["/v1.0/", "/beta/"];

// The permission every call reads with.
export const INTUNE_READ_PERMISSION: string =
  "DeviceManagementManagedDevices.Read.All";

export interface IntuneGraphClientOptions {
  tenant: string;
  clientId: string;
  clientSecret: string;
  cloud: string | undefined;
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

export interface IntunePage {
  status: number;
  body: unknown;
}

export interface IntuneList {
  items: Array<unknown>;
  // Graph's count of every item (@odata.count), when it gave one.
  count?: number | undefined;
  // True when maxPages, or the read's budget, was reached with pages left.
  isTruncated: boolean;
  // True when it was the read's budget that cut the list short.
  isBudgetSpent?: boolean | undefined;
}

interface GraphAnswer {
  response: DataSourceHttpResponse;
  url: string;
}

const DEFAULT_SLEEP: (milliseconds: number) => Promise<void> = (
  milliseconds: number,
): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, Math.max(0, milliseconds));
  });
};

function asObject(value: unknown): JSONObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : undefined;
}

// Text Microsoft wrote, on one line, without its trace and correlation IDs.
function firstLines(text: string): string {
  const cut: number = text.search(/\r?\n|\s+Trace ID:/);

  return (cut >= 0 ? text.substring(0, cut) : text)
    .trim()
    .substring(0, MAX_ERROR_TEXT_LENGTH);
}

/*
 * What Graph said went wrong: its {"error": {"code", "message"}}, else the
 * start of the body.
 */
export function readGraphError(response: DataSourceHttpResponse): {
  code: string;
  message: string;
} {
  const error: JSONObject | undefined = asObject(
    asObject(response.bodyJson)?.["error"],
  );
  const code: unknown = error?.["code"];
  const message: unknown = error?.["message"];

  return {
    code: typeof code === "string" ? code.substring(0, 100) : "",
    message:
      typeof message === "string" && message.trim()
        ? firstLines(message)
        : firstLines(response.bodyText || ""),
  };
}

/*
 * What Microsoft Entra's token endpoint said went wrong, and what it means:
 * its `error`, its AADSTS codes and the first line of its description.
 */
export function readTokenError(response: DataSourceHttpResponse): {
  kind: LlmConnectionFailureKind;
  hint: string;
  description: string;
} {
  const body: JSONObject | undefined = asObject(response.bodyJson);
  const error: string =
    typeof body?.["error"] === "string" ? body["error"] : "";
  const codes: Array<number> = Array.isArray(body?.["error_codes"])
    ? (body!["error_codes"] as Array<unknown>).map((code: unknown): number => {
        return Number(code);
      })
    : [];
  const description: string =
    typeof body?.["error_description"] === "string"
      ? firstLines(body["error_description"])
      : firstLines(response.bodyText || "");

  if (codes.includes(7000215) || codes.includes(7000222)) {
    return {
      kind: LlmConnectionFailureKind.Authentication,
      hint: "Microsoft Entra refused the client secret: it is wrong, has expired, or is another app registration's.",
      description,
    };
  }

  if (codes.includes(700016)) {
    return {
      kind: LlmConnectionFailureKind.Settings,
      hint: "Microsoft Entra has no app registration with this Application (client) ID in the tenant.",
      description,
    };
  }

  if (codes.includes(90002) || codes.includes(900023)) {
    return {
      kind: LlmConnectionFailureKind.Settings,
      hint: "Microsoft Entra has no such tenant in this cloud.",
      description,
    };
  }

  if (error === "invalid_client" || error === "unauthorized_client") {
    return {
      kind: LlmConnectionFailureKind.Authentication,
      hint: "Microsoft Entra refused the app registration's credentials.",
      description,
    };
  }

  if (response.statusCode === 429) {
    return {
      kind: LlmConnectionFailureKind.RateLimited,
      hint: "Microsoft Entra asked OneUptime to slow down.",
      description,
    };
  }

  return {
    kind: LlmProviderError.kindFromStatus(response.statusCode),
    hint: "",
    description,
  };
}

export default class IntuneGraphClient {
  private readonly options: IntuneGraphClientOptions;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly requestTimeoutInMs: number;
  private readonly graphHost: string;
  private readonly tokenUrl: string;
  // The read's pace and budget (DeviceManagementRequestPacer).
  private readonly pacer: DeviceManagementRequestPacer;
  private rateLimited: boolean = false;
  private token: { value: string; expiresAtMs: number } | null = null;

  public constructor(options: IntuneGraphClientOptions) {
    this.options = options;
    this.now =
      options.now ||
      ((): Date => {
        return new Date();
      });
    this.sleep = options.sleep || DEFAULT_SLEEP;
    this.pacer = new DeviceManagementRequestPacer({
      now: this.now,
      sleep: this.sleep,
      random: options.random || Math.random,
      requestsPerSecond:
        options.requestsPerSecond || INTUNE_REQUESTS_PER_SECOND,
      minRequestsPerSecond: INTUNE_MIN_REQUESTS_PER_SECOND,
      maxBackoffSeconds: MAX_BACKOFF_SECONDS,
      maxRequests: options.maxRequests,
      deadlineMs: options.deadlineMs,
    });
    this.requestTimeoutInMs =
      options.requestTimeoutInMs || INTUNE_REQUEST_TIMEOUT_IN_MS;
    this.graphHost = getIntuneCloudHosts(options.cloud).graphHost;
    this.tokenUrl = getIntuneTokenUrl({
      cloud: options.cloud,
      tenant: options.tenant,
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

  // "https://graph.microsoft.com/v1.0/deviceManagement/managedDevices"
  public urlOf(path: string, query: string = ""): string {
    return `${this.graphHost}${path}${query}`;
  }

  /*
   * Whether a URL is one this client may send its token to: HTTPS on the
   * cloud's Graph host, on Graph's versioned paths, with no credentials of
   * its own in it. Parsed, never matched as a substring.
   */
  public isAllowedGraphUrl(value: string): boolean {
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
      url.hostname.toLowerCase() === new URL(this.graphHost).hostname &&
      GRAPH_PATH_PREFIXES.some((prefix: string): boolean => {
        return url.pathname.startsWith(prefix);
      })
    );
  }

  /*
   * A token for Graph, asked for once and kept until shortly before it
   * expires. Throws LlmProviderError naming what Microsoft Entra refused.
   */
  public async getToken(): Promise<string> {
    if (this.token && this.now().getTime() < this.token.expiresAtMs) {
      return this.token.value;
    }

    const response: DataSourceHttpResponse = await this.send(
      "token request",
      (): Promise<DataSourceHttpResponse> => {
        return this.options.transport({
          method: "POST",
          url: this.tokenUrl,
          headers: { Accept: "application/json" },
          body: {
            client_id: this.options.clientId,
            client_secret: this.options.clientSecret,
            scope: `${this.graphHost}/.default`,
            grant_type: "client_credentials",
          },
          formUrlEncoded: true,
          timeoutInMs: this.requestTimeoutInMs,
          egressOptions: { targetLabel: INTUNE_EGRESS_LABEL },
          acceptAnyStatus: true,
        });
      },
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const failure: {
        kind: LlmConnectionFailureKind;
        hint: string;
        description: string;
      } = readTokenError(response);

      throw new LlmProviderError({
        message: this.redact(
          `Microsoft Entra refused OneUptime's sign-in (HTTP ${response.statusCode}).${failure.hint ? ` ${failure.hint}` : ""}${failure.description ? ` ${failure.description}` : ""}`,
        ),
        kind: failure.kind,
        statusCode: response.statusCode,
      });
    }

    const body: JSONObject | undefined = asObject(response.bodyJson);
    const accessToken: unknown = body?.["access_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      throw new LlmProviderError({
        message:
          "Microsoft Entra answered OneUptime's sign-in without a token.",
        kind: LlmConnectionFailureKind.Other,
        statusCode: response.statusCode,
      });
    }

    const expiresIn: number = Number(body?.["expires_in"]);
    const lifetimeMs: number =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? expiresIn * 1000
        : 10 * 60 * 1000;

    this.token = {
      value: accessToken,
      expiresAtMs:
        this.now().getTime() +
        Math.max(60 * 1000, lifetimeMs - TOKEN_EXPIRY_MARGIN_IN_MS),
    };

    return accessToken;
  }

  // One GET of Graph. Throws LlmProviderError, or DeviceManagementBudgetSpent.
  public async get(
    path: string,
    query: string,
    step: string,
  ): Promise<IntunePage> {
    const answer: GraphAnswer = await this.getUrl(
      this.urlOf(path, query),
      step,
    );

    return {
      status: answer.response.statusCode,
      body: answer.response.bodyJson,
    };
  }

  /*
   * Every page of a list: {"value": [...], "@odata.nextLink"}, each next
   * link vetted like any URL, up to maxPages. Anything that is not a list
   * is a failure naming the call.
   */
  public async getAll(
    path: string,
    query: string,
    step: string,
    maxPages: number,
    options: { stopWhenBudgetSpent?: boolean | undefined } = {},
  ): Promise<IntuneList> {
    const items: Array<unknown> = [];
    let url: string | null = this.urlOf(path, query);
    let pages: number = 0;
    let count: number | undefined = undefined;

    while (url) {
      if (pages >= maxPages) {
        return { items, count, isTruncated: true };
      }

      let answer: GraphAnswer;

      try {
        answer = await this.getUrl(url, step);
      } catch (error) {
        if (
          options.stopWhenBudgetSpent &&
          error instanceof DeviceManagementBudgetSpent
        ) {
          return { items, count, isTruncated: true, isBudgetSpent: true };
        }

        throw error;
      }

      pages++;

      const body: JSONObject | undefined = asObject(answer.response.bodyJson);
      const value: unknown = body?.["value"];

      if (!Array.isArray(value)) {
        throw new LlmProviderError({
          message: `Microsoft Graph answered the ${step} with something that is not a list (HTTP ${answer.response.statusCode}).`,
          kind: LlmConnectionFailureKind.Other,
          statusCode: answer.response.statusCode,
        });
      }

      items.push(...(value as Array<unknown>));

      const pageCount: unknown = body?.["@odata.count"];

      if (count === undefined && typeof pageCount === "number") {
        count = pageCount;
      }

      const next: unknown = body?.["@odata.nextLink"];
      url = null;

      if (typeof next === "string" && next.trim()) {
        const nextUrl: string = this.resolveAgainst(next.trim(), answer.url);

        if (!this.isAllowedGraphUrl(nextUrl)) {
          throw new LlmProviderError({
            message: `Microsoft Graph's ${step} gave a next page outside Graph (${new URL(this.graphHost).hostname}); it was not read.`,
            kind: LlmConnectionFailureKind.Other,
          });
        }

        url = nextUrl;
      }
    }

    return { items, count, isTruncated: false };
  }

  private async getUrl(firstUrl: string, step: string): Promise<GraphAnswer> {
    let url: string = firstUrl;
    let redirects: number = 0;
    let rateLimitRetries: number = 0;
    let serverErrorRetries: number = 0;
    let isTokenRenewed: boolean = false;

    for (;;) {
      if (!this.isAllowedGraphUrl(url)) {
        throw new LlmProviderError({
          message: `Microsoft Graph's ${step} pointed OneUptime to an address outside Graph (${new URL(this.graphHost).hostname}); nothing was sent there.`,
          kind: LlmConnectionFailureKind.Other,
        });
      }

      const token: string = await this.getToken();
      const target: string = url;
      const response: DataSourceHttpResponse = await this.send(
        step,
        (): Promise<DataSourceHttpResponse> => {
          return this.options.transport({
            method: "GET",
            url: target,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
            timeoutInMs: this.requestTimeoutInMs,
            egressOptions: { targetLabel: INTUNE_EGRESS_LABEL },
            acceptAnyStatus: true,
          });
        },
      );
      const status: number = response.statusCode;
      const headers: Dictionary<string> = response.headers || {};

      if (status >= 200 && status < 300) {
        return { response, url };
      }

      if (status >= 300 && status < 400) {
        const location: string | undefined = headers["location"];

        if (!location || redirects >= MAX_REDIRECTS) {
          throw new LlmProviderError({
            message: `Microsoft Graph answered the ${step} with a redirect OneUptime could not follow (HTTP ${status}).`,
            kind: LlmConnectionFailureKind.Other,
            statusCode: status,
          });
        }

        redirects++;
        // Vetted at the top of the loop before anything is sent there.
        url = this.resolveAgainst(location, url);
        continue;
      }

      // A token Graph no longer takes: one new one, then the answer stands.
      if (status === 401 && !isTokenRenewed) {
        isTokenRenewed = true;
        this.token = null;
        continue;
      }

      if (status === 429) {
        this.rateLimited = true;
        this.pacer.slowDown();

        const retryAfter: number | null =
          RetryAfter.parseSeconds(headers["retry-after"], {
            nowMs: this.now().getTime(),
          }) ?? null;

        if (
          rateLimitRetries >= MAX_RATE_LIMIT_RETRIES ||
          (retryAfter !== null && retryAfter > MAX_RETRY_AFTER_SECONDS)
        ) {
          throw new LlmProviderError({
            message: this.redact(
              `Microsoft Graph asked OneUptime to slow down (HTTP 429) on the ${step}: the tenant's Intune API is busy with other requests too. ${readGraphError(response).message}`.trim(),
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

      throw this.graphFailure(response, step);
    }
  }

  // What a Graph answer that is not a success means, as an error to show.
  private graphFailure(
    response: DataSourceHttpResponse,
    step: string,
  ): LlmProviderError {
    const status: number = response.statusCode;
    const error: { code: string; message: string } = readGraphError(response);
    const said: string = [error.code, error.message].filter(Boolean).join(": ");
    let kind: LlmConnectionFailureKind =
      LlmProviderError.kindFromStatus(status);
    let hint: string = "";

    if (status === 403) {
      kind = LlmConnectionFailureKind.Permission;
      hint = `The app registration needs the application permission ${INTUNE_READ_PERMISSION} on Microsoft Graph, with admin consent.`;
    } else if (status === 401) {
      kind = LlmConnectionFailureKind.Authentication;
    } else if (
      status === 400 &&
      error.message.toLowerCase().includes("not applicable to target tenant")
    ) {
      // What Graph says when the tenant has no Intune license.
      kind = LlmConnectionFailureKind.Settings;
      hint = "The tenant may have no Intune license.";
    }

    return new LlmProviderError({
      message: this.redact(
        `Microsoft Graph answered the ${step} with HTTP ${status}${said ? `: ${said}` : ""}.${hint ? ` ${hint}` : ""}`,
      ),
      kind,
      statusCode: status,
      responseBody: this.redact(error.message),
    });
  }

  // How long the n-th retry waits when Microsoft names no wait.
  public backoffMs(attempt: number): number {
    return this.pacer.backoffMs(attempt);
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
        if (attempts <= 1) {
          await this.sleep(this.backoffMs(0));
          continue;
        }

        throw LlmProviderError.from({
          error,
          step: step,
          providerTitle: "Microsoft Intune",
          secretValues: this.secrets(),
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

  private secrets(): Array<string> {
    return [this.options.clientSecret, this.token?.value || ""].filter(
      (value: string): boolean => {
        return Boolean(value);
      },
    );
  }

  private redact(text: string): string {
    return LlmProviderError.redact(text, this.secrets());
  }
}
