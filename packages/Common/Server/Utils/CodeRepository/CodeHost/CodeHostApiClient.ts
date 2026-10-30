import Dictionary from "../../../../Types/Dictionary";
import CodeHostHttp, {
  CODE_HOST_MAX_FAILURE_RETRIES,
  CODE_HOST_REQUEST_TIMEOUT_MS,
  CodeHostHttpError,
  CodeHostHttpErrorKind,
  CodeHostHttpMethod,
  CodeHostHttpResponse,
  CodeHostTransport,
} from "./CodeHostHttp";

/*
 * A JSON API of a Git server - GitLab's v4, Forgejo's and Gitea's v1 - read
 * through a CodeHostTransport, with the rules both clients share:
 *
 *  - paths are built by the clients from encoded parts, and a path that
 *    could leave the API (".." or "//") is refused before a request;
 *  - the server's answer decides the error, in words a person can act on:
 *    a refused token says so and what to do, a token without the scope it
 *    needs says which scope, and an answer that is not JSON says the
 *    address is not the server's API;
 *  - a server error or no answer is tried again a few times; a 429 is not
 *    (nothing here is urgent enough to keep a server busy);
 *  - nothing it throws or returns carries the token.
 */

export interface CodeHostApiClientOptions {
  // The server's name for messages: "GitLab", "Forgejo", "Gitea".
  providerName: string;
  // The API's root: https://gitlab.com/api/v4.
  apiBaseUrl: string;
  // Sent with every request: the token's header.
  headers: Dictionary<string>;
  // Values cut out of every message: the token.
  secrets: Array<string>;
  transport: CodeHostTransport;
  // What the token needs, said when the server refuses it a request.
  scopeHint?: string | undefined;
  timeoutInMs?: number | undefined;
  // Test seam: waits between retries.
  backOff?: ((retry: number) => Promise<void>) | undefined;
}

export type CodeHostQuery = Dictionary<string | number | boolean | undefined>;

export interface CodeHostApiAnswer {
  json: unknown;
  // The answer as the server wrote it: what getText reads.
  text: string;
  headers: Dictionary<string>;
  statusCode: number;
}

// The characters an API path is made of: encoded parts and slashes.
const API_PATH: RegExp = /^\/[A-Za-z0-9\-._~%/:@!$&'()*+,;=]*$/;

export default class CodeHostApiClient {
  private options: CodeHostApiClientOptions;
  private requestCount: number = 0;

  public constructor(options: CodeHostApiClientOptions) {
    this.options = options;
  }

  public getProviderName(): string {
    return this.options.providerName;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  public async getJson(
    path: string,
    query?: CodeHostQuery,
  ): Promise<CodeHostApiAnswer> {
    return await this.request({ method: "GET", path, query });
  }

  public async postJson(
    path: string,
    body: unknown,
  ): Promise<CodeHostApiAnswer> {
    return await this.request({ method: "POST", path, body });
  }

  /*
   * An answer that is text rather than JSON - a pull request's diff
   * (Forgejo's and Gitea's /pulls/{index}.diff) - with the same rules.
   */
  public async getText(
    path: string,
    query?: CodeHostQuery,
  ): Promise<CodeHostApiAnswer> {
    return await this.request({ method: "GET", path, query, isText: true });
  }

  /*
   * One request to the API, and its parsed JSON answer. Throws a
   * CodeHostHttpError whose message a person can act on.
   */
  public async request(data: {
    method: CodeHostHttpMethod;
    path: string;
    query?: CodeHostQuery | undefined;
    body?: unknown;
    // The answer is text, not JSON (getText).
    isText?: boolean | undefined;
  }): Promise<CodeHostApiAnswer> {
    const url: string = this.buildUrl(data.path, data.query);
    let failureRetries: number = 0;

    for (;;) {
      let response: CodeHostHttpResponse;

      this.requestCount++;

      try {
        response = await this.options.transport({
          method: data.method,
          url,
          headers: {
            Accept: data.isText ? "text/plain" : "application/json",
            ...(data.body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
            ...this.options.headers,
          },
          ...(data.body !== undefined
            ? { body: JSON.stringify(data.body) }
            : {}),
          timeoutInMs: this.options.timeoutInMs || CODE_HOST_REQUEST_TIMEOUT_MS,
        });
      } catch (error) {
        const isRetryable: boolean =
          !(error instanceof CodeHostHttpError) ||
          error.kind === CodeHostHttpErrorKind.Unavailable;

        if (isRetryable && failureRetries < CODE_HOST_MAX_FAILURE_RETRIES) {
          await this.backOff(failureRetries);
          failureRetries++;
          continue;
        }

        if (error instanceof CodeHostHttpError) {
          throw new CodeHostHttpError({
            kind: error.kind,
            statusCode: error.statusCode,
            message: this.clean(error.message),
          });
        }

        throw new CodeHostHttpError({
          kind: CodeHostHttpErrorKind.Unavailable,
          message: `${this.options.providerName} could not be reached: ${this.clean(
            error instanceof Error ? error.message : String(error),
          )}`,
        });
      }

      const status: number = response.statusCode;

      if (status >= 200 && status < 300) {
        if (!data.isText && response.bodyJson === undefined && status !== 204) {
          throw new CodeHostHttpError({
            kind: CodeHostHttpErrorKind.BadResponse,
            statusCode: status,
            message: `${this.getHost()} did not answer as ${this.options.providerName}'s API does. Check the server's address.`,
          });
        }

        return {
          json: data.isText ? undefined : response.bodyJson,
          text: response.bodyText || "",
          headers: response.headers,
          statusCode: status,
        };
      }

      if (status >= 500 && failureRetries < CODE_HOST_MAX_FAILURE_RETRIES) {
        await this.backOff(failureRetries);
        failureRetries++;
        continue;
      }

      throw this.toError(response);
    }
  }

  // The error a non-2xx answer means, in the server's own words where useful.
  public toError(response: CodeHostHttpResponse): CodeHostHttpError {
    const status: number = response.statusCode;
    const detail: string = this.getErrorDetail(response);
    const suffix: string = detail ? ` (${detail})` : "";
    const provider: string = this.options.providerName;

    if (status >= 300 && status < 400) {
      return new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.Rejected,
        statusCode: status,
        message: `${this.getHost()} answered with a redirect, which OneUptime does not follow. Use the server's address exactly as its pages show it, with https://.`,
      });
    }

    if (status === 401) {
      return new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.Unauthorized,
        statusCode: status,
        message: `${provider} refused the access token. It may have expired or been revoked: create a new token and use it instead.`,
      });
    }

    if (status === 403) {
      return new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.Forbidden,
        statusCode: status,
        message: `${provider} did not let the access token do this${suffix}.${
          this.options.scopeHint ? ` ${this.options.scopeHint}` : ""
        }`,
      });
    }

    if (status === 404) {
      return new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.NotFound,
        statusCode: status,
        message: `${provider} found nothing there${suffix}. Check the address, and that the access token can reach the repository.`,
      });
    }

    if (status === 409) {
      return new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.Conflict,
        statusCode: status,
        message: `${provider} says it is there already${suffix}.`,
      });
    }

    if (status === 429) {
      return new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.RateLimited,
        statusCode: status,
        message: `${provider} asked OneUptime to slow down. Try again in a few minutes.`,
      });
    }

    if (status >= 500) {
      return new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.Unavailable,
        statusCode: status,
        message: `${provider} kept failing (HTTP ${status}). Try again later.`,
      });
    }

    return new CodeHostHttpError({
      kind: CodeHostHttpErrorKind.Rejected,
      statusCode: status,
      message: `${provider} refused the request (HTTP ${status})${suffix}.`,
    });
  }

  /*
   * The server's own words for a failure: GitLab's { message } (a text, or
   * an object of field errors) or { error, error_description }, Forgejo's
   * and Gitea's { message }. Cut short, and with the token cut out.
   */
  private getErrorDetail(response: CodeHostHttpResponse): string {
    const body: unknown = response.bodyJson;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return "";
    }

    const record: Record<string, unknown> = body as Record<string, unknown>;
    let detail: string = "";
    const message: unknown = record["message"];

    if (typeof message === "string") {
      detail = message;
    } else if (Array.isArray(message)) {
      detail = message
        .filter((part: unknown): boolean => {
          return typeof part === "string";
        })
        .join("; ");
    } else if (message && typeof message === "object") {
      detail = Object.entries(message as Record<string, unknown>)
        .map(([field, value]: [string, unknown]): string => {
          return `${field} ${Array.isArray(value) ? value.join(", ") : String(value)}`;
        })
        .join("; ");
    }

    if (!detail && typeof record["error_description"] === "string") {
      detail = record["error_description"] as string;
    }

    if (!detail && typeof record["error"] === "string") {
      detail = record["error"] as string;
    }

    return this.clean(detail);
  }

  public clean(text: string): string {
    return CodeHostHttp.clean(text, this.options.secrets);
  }

  private async backOff(retry: number): Promise<void> {
    if (this.options.backOff) {
      await this.options.backOff(retry);
      return;
    }

    await CodeHostHttp.backOff(retry);
  }

  private getHost(): string {
    try {
      return new URL(this.options.apiBaseUrl).host;
    } catch {
      return this.options.providerName;
    }
  }

  private buildUrl(path: string, query?: CodeHostQuery | undefined): string {
    if (
      !API_PATH.test(path) ||
      path.includes("//") ||
      path.split("/").includes("..") ||
      path.split("/").includes(".")
    ) {
      throw new CodeHostHttpError({
        kind: CodeHostHttpErrorKind.NotAllowed,
        message: "A request must stay on the Git server's API.",
      });
    }

    const base: string = this.options.apiBaseUrl.endsWith("/")
      ? this.options.apiBaseUrl.substring(0, this.options.apiBaseUrl.length - 1)
      : this.options.apiBaseUrl;

    const url: URL = new URL(`${base}${path}`);

    for (const [key, value] of Object.entries(query || {})) {
      if (value === undefined) {
        continue;
      }

      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }
}
