import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import Sleep from "../../../Types/Sleep";
import {
  TOOL_IMPORT_MAX_RESPONSE_BYTES,
  TOOL_IMPORT_REQUEST_TIMEOUT_MS,
} from "../../../Types/ToolImport/ToolImportLimits";
import { redactLogString } from "../LogRedaction";
import OutboundUserAgent from "../OutboundUserAgent";
import axios, { AxiosResponse } from "axios";

/*
 * THE ONLY WAY AN IMPORT TALKS TO ANOTHER TOOL.
 *
 * Every request an adapter makes goes through one of these, and this is
 * where the rules every tool shares are kept:
 *
 *  - It only calls the tool's own hosts, fixed in ToolImportCatalog: the URL
 *    is built from that host and a path, never taken from a person or from
 *    a response, and anything else is refused before a socket is opened.
 *    Redirects are refused too. So an import cannot be pointed anywhere
 *    else (no SSRF).
 *  - It backs off when the tool says to slow down. A 429 waits for the
 *    tool's Retry-After (seconds or a date), or its rate-limit reset time,
 *    or doubling waits from two seconds up to a minute - and gives up with a
 *    plain message once waiting would run past the read's deadline. A
 *    server error or a dropped connection is tried again a few times.
 *  - It counts. A read makes at most so many requests, and stops at its
 *    deadline, so a huge account or a misbehaving API cannot keep a worker
 *    busy forever.
 *  - It never lets the key out. The key travels in a header only; a
 *    message built from a response has the key cut out of it, and goes
 *    through the log redaction, before it is thrown, logged or stored.
 *
 * The transport is injected: the real one below in production, a fixture in
 * every test, so no test ever calls a real tool.
 */

export interface ToolImportHttpRequest {
  method: "GET";
  url: string;
  headers: Dictionary<string>;
  timeoutInMs: number;
}

export interface ToolImportHttpResponse {
  statusCode: number;
  bodyText: string;
  // Parsed JSON, or undefined when the body is not JSON.
  bodyJson: unknown;
  // Lowercased header names.
  headers: Dictionary<string>;
}

export type ToolImportTransport = (
  request: ToolImportHttpRequest,
) => Promise<ToolImportHttpResponse>;

export type ToolImportSleep = (ms: number) => Promise<void>;

export enum ToolImportHttpErrorKind {
  // The key was refused.
  Unauthorized = "Unauthorized",
  // The key may not read this.
  Forbidden = "Forbidden",
  NotFound = "NotFound",
  // The tool kept saying to slow down.
  RateLimited = "RateLimited",
  // The tool kept failing (5xx) or could not be reached.
  Unavailable = "Unavailable",
  // The tool refused the request for another reason (4xx).
  Rejected = "Rejected",
  // The answer was not what its documentation says.
  BadResponse = "BadResponse",
  // The read used all its requests or its time.
  BudgetExhausted = "BudgetExhausted",
}

export class ToolImportHttpError extends BadDataException {
  public kind: ToolImportHttpErrorKind;
  public statusCode: number | null;

  public constructor(data: {
    kind: ToolImportHttpErrorKind;
    message: string;
    statusCode?: number | null | undefined;
  }) {
    super(data.message);
    this.kind = data.kind;
    this.statusCode = data.statusCode ?? null;
  }
}

export interface ToolImportHttpClientOptions {
  // The tool's name, for messages ("Opsgenie answered ...").
  toolName: string;
  // https://<host>, where <host> is one of allowedHosts.
  baseUrl: string;
  allowedHosts: Array<string>;
  // Sent with every request: the key's header.
  headers: Dictionary<string>;
  // Values cut out of any message: the key, and the header carrying it.
  secrets: Array<string>;
  transport: ToolImportTransport;
  sleep?: ToolImportSleep | undefined;
  now?: (() => number) | undefined;
  maxRequests: number;
  // Epoch ms the read must finish by.
  deadlineAt: number;
  requestTimeoutInMs?: number | undefined;
}

export type ToolImportQuery = Dictionary<
  string | number | boolean | Array<string> | undefined
>;

// Tries for one request: answers saying "slow down", and other failures.
export const TOOL_IMPORT_MAX_RATE_LIMIT_RETRIES: number = 8;
export const TOOL_IMPORT_MAX_FAILURE_RETRIES: number = 3;

// The wait after the first 429 with no hint, doubled each time up to the cap.
export const TOOL_IMPORT_FIRST_BACKOFF_MS: number = 2000;
export const TOOL_IMPORT_MAX_BACKOFF_MS: number = 60 * 1000;

const MAX_MESSAGE_EXCERPT_LENGTH: number = 300;

const WHITESPACE_RUN: RegExp = /\s+/g;

/*
 * A path on the tool's API: from the root, of the characters a path and an
 * escaped id are made of, with no empty or ".." segment that could make it
 * mean anything but itself.
 */
const API_PATH: RegExp = /^\/[A-Za-z0-9\-._~%/]*$/;

export default class ToolImportHttpClient {
  private options: ToolImportHttpClientOptions;
  private sleep: ToolImportSleep;
  private now: () => number;
  private requestCount: number = 0;
  private waitedForRateLimitMs: number = 0;

  public constructor(options: ToolImportHttpClientOptions) {
    const host: string = ToolImportHttpClient.getHost(options.baseUrl);

    if (!options.allowedHosts.includes(host)) {
      throw new BadDataException(
        `${options.toolName} can only be read from its own address.`,
      );
    }

    this.options = options;
    this.sleep = options.sleep || Sleep.sleep;
    this.now =
      options.now ||
      ((): number => {
        return Date.now();
      });
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  // How long this client waited because the tool said to slow down.
  public getRateLimitWaitMs(): number {
    return this.waitedForRateLimitMs;
  }

  /*
   * GET `path` (relative to the tool's base URL) with `query`, and return
   * the parsed JSON body. Throws ToolImportHttpError.
   */
  public async getJson(path: string, query?: ToolImportQuery): Promise<unknown> {
    const url: string = this.buildUrl(path, query);
    let rateLimitRetries: number = 0;
    let failureRetries: number = 0;

    for (;;) {
      this.assertWithinBudget();

      this.requestCount++;

      let response: ToolImportHttpResponse;

      try {
        response = await this.options.transport({
          method: "GET",
          url: url,
          headers: {
            Accept: "application/json",
            ...this.options.headers,
          },
          timeoutInMs:
            this.options.requestTimeoutInMs || TOOL_IMPORT_REQUEST_TIMEOUT_MS,
        });
      } catch (error) {
        if (error instanceof ToolImportHttpError) {
          throw error;
        }

        if (failureRetries >= TOOL_IMPORT_MAX_FAILURE_RETRIES) {
          throw new ToolImportHttpError({
            kind: ToolImportHttpErrorKind.Unavailable,
            message: `${this.options.toolName} could not be reached: ${this.clean(
              error instanceof Error ? error.message : String(error),
            )}`,
          });
        }

        await this.wait(this.getFailureBackoffMs(failureRetries), false);
        failureRetries++;
        continue;
      }

      const status: number = response.statusCode;

      if (status >= 200 && status < 300) {
        if (response.bodyJson === undefined) {
          throw new ToolImportHttpError({
            kind: ToolImportHttpErrorKind.BadResponse,
            statusCode: status,
            message: `${this.options.toolName} answered with something that is not JSON.`,
          });
        }

        return response.bodyJson;
      }

      if (status === 429) {
        if (rateLimitRetries >= TOOL_IMPORT_MAX_RATE_LIMIT_RETRIES) {
          throw this.rateLimitedError();
        }

        const waitMs: number = this.getRateLimitWaitMs429(
          response,
          rateLimitRetries,
        );

        if (this.now() + waitMs > this.options.deadlineAt) {
          throw this.rateLimitedError();
        }

        await this.wait(waitMs, true);
        rateLimitRetries++;
        continue;
      }

      if (status >= 500) {
        if (failureRetries >= TOOL_IMPORT_MAX_FAILURE_RETRIES) {
          throw new ToolImportHttpError({
            kind: ToolImportHttpErrorKind.Unavailable,
            statusCode: status,
            message: `${this.options.toolName} kept failing (HTTP ${status}). Try again later.`,
          });
        }

        const hinted: number | null = this.getRetryAfterMs(response);
        await this.wait(
          hinted !== null
            ? Math.min(hinted, TOOL_IMPORT_MAX_BACKOFF_MS)
            : this.getFailureBackoffMs(failureRetries),
          false,
        );
        failureRetries++;
        continue;
      }

      throw this.toClientError(response);
    }
  }

  private assertWithinBudget(): void {
    if (this.requestCount >= this.options.maxRequests) {
      throw new ToolImportHttpError({
        kind: ToolImportHttpErrorKind.BudgetExhausted,
        message: `Reading ${this.options.toolName} took more than ${this.options.maxRequests} requests, so it was stopped.`,
      });
    }

    if (this.now() >= this.options.deadlineAt) {
      throw new ToolImportHttpError({
        kind: ToolImportHttpErrorKind.BudgetExhausted,
        message: `Reading ${this.options.toolName} took too long, so it was stopped.`,
      });
    }
  }

  private async wait(ms: number, isRateLimit: boolean): Promise<void> {
    const remaining: number = Math.max(0, this.options.deadlineAt - this.now());
    const waitMs: number = Math.max(0, Math.min(ms, remaining));

    if (isRateLimit) {
      this.waitedForRateLimitMs += waitMs;
    }

    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
  }

  private rateLimitedError(): ToolImportHttpError {
    return new ToolImportHttpError({
      kind: ToolImportHttpErrorKind.RateLimited,
      statusCode: 429,
      message: `${this.options.toolName} kept asking OneUptime to slow down, so the read was stopped. Try again in a few minutes.`,
    });
  }

  private getFailureBackoffMs(retry: number): number {
    return Math.min(1000 * Math.pow(2, retry), TOOL_IMPORT_MAX_BACKOFF_MS);
  }

  /*
   * How long to wait after a 429: what the tool asked for (Retry-After, or
   * the time its rate-limit window resets), else a doubling wait. Never
   * more than a minute at a time.
   */
  private getRateLimitWaitMs429(
    response: ToolImportHttpResponse,
    retry: number,
  ): number {
    const hinted: number | null =
      this.getRetryAfterMs(response) ?? this.getResetWaitMs(response);

    if (hinted !== null) {
      return Math.min(Math.max(hinted, 250), TOOL_IMPORT_MAX_BACKOFF_MS);
    }

    return Math.min(
      TOOL_IMPORT_FIRST_BACKOFF_MS * Math.pow(2, retry),
      TOOL_IMPORT_MAX_BACKOFF_MS,
    );
  }

  // Retry-After as seconds or as an HTTP date.
  private getRetryAfterMs(response: ToolImportHttpResponse): number | null {
    const value: string | undefined = response.headers?.["retry-after"];

    if (!value) {
      return null;
    }

    const seconds: number = Number(value.trim());

    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const date: number = Date.parse(value);

    if (Number.isFinite(date)) {
      return Math.max(0, date - this.now());
    }

    return null;
  }

  /*
   * X-RateLimit-Reset: the epoch second the window resets (incident.io), or
   * a number of seconds when it is too small to be an epoch.
   */
  private getResetWaitMs(response: ToolImportHttpResponse): number | null {
    const value: string | undefined =
      response.headers?.["x-ratelimit-reset"] ||
      response.headers?.["x-ratelimit-period-in-sec"];

    if (!value) {
      return null;
    }

    const number: number = Number(value.trim());

    if (!Number.isFinite(number) || number < 0) {
      return null;
    }

    // Anything below a billion seconds is a duration, not a date.
    if (number < 1_000_000_000) {
      return number * 1000;
    }

    return Math.max(0, number * 1000 - this.now());
  }

  private toClientError(response: ToolImportHttpResponse): ToolImportHttpError {
    const status: number = response.statusCode;
    const detail: string = this.getErrorDetail(response);
    const suffix: string = detail ? ` (${detail})` : "";

    if (status === 401) {
      return new ToolImportHttpError({
        kind: ToolImportHttpErrorKind.Unauthorized,
        statusCode: status,
        message: `${this.options.toolName} did not accept the API key${suffix}.`,
      });
    }

    if (status === 403) {
      return new ToolImportHttpError({
        kind: ToolImportHttpErrorKind.Forbidden,
        statusCode: status,
        message: `The API key may not read this from ${this.options.toolName}${suffix}.`,
      });
    }

    if (status === 404) {
      return new ToolImportHttpError({
        kind: ToolImportHttpErrorKind.NotFound,
        statusCode: status,
        message: `${this.options.toolName} could not find this${suffix}.`,
      });
    }

    return new ToolImportHttpError({
      kind: ToolImportHttpErrorKind.Rejected,
      statusCode: status,
      message: `${this.options.toolName} refused the request (HTTP ${status})${suffix}.`,
    });
  }

  /*
   * The tool's own words for a failure, from the error shapes their APIs
   * document: Opsgenie's { message }, incident.io's { errors: [{ message }] }.
   * Cut short, and with the key cut out.
   */
  private getErrorDetail(response: ToolImportHttpResponse): string {
    const body: unknown = response.bodyJson;
    let detail: string = "";

    if (body && typeof body === "object" && !Array.isArray(body)) {
      const record: Record<string, unknown> = body as Record<string, unknown>;
      const errors: unknown = record["errors"];

      if (Array.isArray(errors) && errors.length > 0) {
        const first: unknown = errors[0];

        if (first && typeof first === "object") {
          const message: unknown = (first as Record<string, unknown>)[
            "message"
          ];

          if (typeof message === "string") {
            detail = message;
          }
        }
      }

      if (!detail && typeof record["message"] === "string") {
        detail = record["message"] as string;
      }
    }

    return this.clean(detail);
  }

  // A message with every secret cut out, redacted for logs, and short.
  public clean(text: string): string {
    let cleaned: string = String(text || "");

    for (const secret of this.options.secrets) {
      if (secret && secret.length >= 4) {
        cleaned = cleaned.split(secret).join("[REDACTED]");
      }
    }

    cleaned = redactLogString(cleaned).replace(WHITESPACE_RUN, " ").trim();

    return cleaned.length > MAX_MESSAGE_EXCERPT_LENGTH
      ? `${cleaned.slice(0, MAX_MESSAGE_EXCERPT_LENGTH)}…`
      : cleaned;
  }

  private buildUrl(path: string, query?: ToolImportQuery): string {
    if (
      !API_PATH.test(path) ||
      path.includes("//") ||
      path.split("/").includes("..")
    ) {
      throw new BadDataException("A request path must stay on the tool's API.");
    }

    const url: URL = new URL(this.options.baseUrl);
    url.pathname = path;

    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          url.searchParams.append(key, item);
        }
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    // Built from a fixed host, so this can only fail on a broken base URL.
    if (!this.options.allowedHosts.includes(url.hostname)) {
      throw new BadDataException(
        `${this.options.toolName} can only be read from its own address.`,
      );
    }

    return url.toString();
  }

  public static getHost(baseUrl: string): string {
    try {
      const url: URL = new URL(baseUrl);
      return url.protocol === "https:" ? url.hostname : "";
    } catch {
      return "";
    }
  }
}

/*
 * The transport an import uses in production: an HTTPS GET to one of the
 * allowed hosts, with no redirects, a response size cap, and every status
 * handed back (the client decides what each one means). Anything that is not
 * HTTPS to an allowed host is refused here too.
 */
export function createToolImportTransport(
  allowedHosts: Array<string>,
): ToolImportTransport {
  return async (
    request: ToolImportHttpRequest,
  ): Promise<ToolImportHttpResponse> => {
    let url: URL;

    try {
      url = new URL(request.url);
    } catch {
      throw new ToolImportHttpError({
        kind: ToolImportHttpErrorKind.Rejected,
        message: "The request address is not valid.",
      });
    }

    if (url.protocol !== "https:" || !allowedHosts.includes(url.hostname)) {
      throw new ToolImportHttpError({
        kind: ToolImportHttpErrorKind.Rejected,
        message: "An import only calls the tool's own API.",
      });
    }

    const response: AxiosResponse<string> = await axios.request<string>({
      method: request.method,
      url: url.toString(),
      headers: OutboundUserAgent.withDefault(request.headers),
      timeout: request.timeoutInMs,
      maxRedirects: 0,
      maxContentLength: TOOL_IMPORT_MAX_RESPONSE_BYTES,
      maxBodyLength: TOOL_IMPORT_MAX_RESPONSE_BYTES,
      responseType: "text",
      transformResponse: [
        (body: string): string => {
          return body;
        },
      ],
      validateStatus: (): boolean => {
        return true;
      },
    });

    const bodyText: string = response.data || "";
    let bodyJson: unknown = undefined;

    try {
      bodyJson = bodyText ? JSON.parse(bodyText) : undefined;
    } catch {
      bodyJson = undefined;
    }

    const headers: Dictionary<string> = {};

    for (const key of Object.keys(response.headers || {})) {
      const value: unknown = (response.headers as Record<string, unknown>)[key];

      if (value !== undefined && value !== null) {
        headers[key.toLowerCase()] = String(value);
      }
    }

    return {
      statusCode: response.status,
      bodyText: bodyText,
      bodyJson: bodyJson,
      headers: headers,
    };
  };
}
