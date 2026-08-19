import AnalyticsBaseModel from "../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../Types/API/HTTPErrorResponse";
import HTTPMethod from "../Types/API/HTTPMethod";
import HTTPResponse from "../Types/API/HTTPResponse";
import Headers from "../Types/API/Headers";
import Hostname from "../Types/API/Hostname";
import Protocol from "../Types/API/Protocol";
import Route from "../Types/API/Route";
import URL from "../Types/API/URL";
import Dictionary from "../Types/Dictionary";
import APIException from "../Types/Exception/ApiException";
import { JSONArray, JSONObject } from "../Types/JSON";
import RequestFailedDetails, {
  RequestFailedPhase,
} from "../Types/Probe/RequestFailedDetails";
import axios, {
  AxiosError,
  AxiosProgressEvent,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import Sleep from "../Types/Sleep";
import type { Agent as HttpAgent } from "http";
import type { Agent as HttpsAgent } from "https";

/*
 * Diagnostic summary of one settled fetch() call, retries included. Handed
 * to RequestOptions.onRequestComplete so a caller can log WHERE a request
 * went wrong without having to wrap every one of its call sites.
 */
export interface RequestOutcome {
  method: HTTPMethod;
  url: string;
  elapsedInMs: number;
  attempts: number;
  timeoutInMs?: number | undefined;
  // Set whenever the server answered at all — including 4xx/5xx.
  statusCode?: number | undefined;
  // Set when the request failed without a usable response.
  error?: Error | undefined;
  /*
   * The raw axios error, when there was one. It carries the ClientRequest
   * and its socket, which is what tells "we never got a socket" apart from
   * "we connected and the server never replied" — the difference between a
   * client-side and a server-side timeout.
   */
  axiosError?: AxiosError | undefined;
}

export interface RequestOptions {
  retries?: number | undefined;
  exponentialBackoff?: boolean | undefined;
  /*
   * Ceiling on any single backoff sleep. Doubling is unbounded by
   * definition, so without a cap a double-digit retry budget spends nearly
   * all of its wall clock asleep — the tenth wait alone is over seventeen
   * minutes. Defaults to DEFAULT_MAX_BACKOFF_IN_MS, which is far above what
   * a handful of retries can reach, so short retry budgets are unaffected.
   */
  maxBackoffInMs?: number | undefined;
  /*
   * Spend retries only on failures that repeating could plausibly fix —
   * see isRetryableError. Off by default: callers that have always retried
   * every error keep doing so until they opt in.
   */
  retryOnlyOnRetryableErrors?: boolean | undefined;
  /*
   * Wall-clock budget for the whole call, every attempt and backoff
   * included. No attempt is started that the budget cannot pay for, so N
   * retries of a request that times out can no longer take N x timeout and
   * outlive whatever is waiting on the answer. It does not abort an attempt
   * already in flight — the per-attempt `timeout` is what bounds that.
   */
  totalTimeoutInMs?: number | undefined;
  timeout?: number | undefined;
  doNotFollowRedirects?: boolean | undefined;
  // Per-request proxy agent support (Probe supplies these instead of mutating global axios defaults)
  httpAgent?: HttpAgent | undefined;
  httpsAgent?: HttpsAgent | undefined;
  skipAuthRefresh?: boolean | undefined;
  hasAttemptedAuthRefresh?: boolean | undefined;
  onUploadProgress?: ((event: AxiosProgressEvent) => void) | undefined;
  /*
   * Purely diagnostic observer, called once after the request settles. It
   * cannot change the result and anything it throws is swallowed, so a
   * broken logger can never break a request.
   */
  onRequestComplete?: ((outcome: RequestOutcome) => void) | undefined;
}

export interface APIRequestOptions {
  url: URL;
  data?: JSONObject | JSONArray;
  headers?: Headers;
  params?: Dictionary<string>;
  options?: RequestOptions;
}

export interface APIFetchOptions {
  method: HTTPMethod;
  url: URL;
  data?: JSONObject | JSONArray;
  headers?: Headers;
  params?: Dictionary<string>;
  options?: RequestOptions;
}

export interface AuthRetryContext {
  error: HTTPErrorResponse;
  request: {
    method: HTTPMethod;
    url: URL;
    data?: JSONObject | JSONArray;
    headers?: Headers;
    params?: Dictionary<string>;
    options?: RequestOptions;
  };
}

export default class API {
  /*
   * Backstop ceiling for a single backoff sleep when the caller names none.
   * Set well above what a small retry budget can reach (three retries top out
   * at eight seconds), so it only ever bites on the long budgets that need it.
   */
  public static readonly DEFAULT_MAX_BACKOFF_IN_MS: number = 60 * 1000;

  /*
   * 4xx responses are the server saying the request itself is wrong, and
   * resending it byte-for-byte gets the same answer — except for these three,
   * which say "not now" rather than "not ever".
   */
  private static readonly RETRYABLE_CLIENT_ERROR_STATUS_CODES: Set<number> =
    new Set([
      408, // Request Timeout
      425, // Too Early
      429, // Too Many Requests
    ]);

  private _protocol: Protocol = Protocol.HTTPS;
  public get protocol(): Protocol {
    return this._protocol;
  }
  public set protocol(v: Protocol) {
    this._protocol = v;
  }

  private _hostname!: Hostname;
  public get hostname(): Hostname {
    return this._hostname;
  }
  public set hostname(v: Hostname) {
    this._hostname = v;
  }

  private _baseRoute!: Route;
  public get baseRoute(): Route {
    return this._baseRoute;
  }
  public set baseRoute(v: Route) {
    this._baseRoute = v;
  }

  public constructor(
    protocol: Protocol,
    hostname: Hostname,
    baseRoute?: Route,
  ) {
    this.protocol = protocol;
    this.hostname = hostname;

    if (baseRoute) {
      this.baseRoute = baseRoute;
    } else {
      this.baseRoute = new Route("/");
    }
  }

  protected static async tryRefreshAuth(
    _context: AuthRetryContext,
  ): Promise<boolean> {
    return false;
  }

  public async get<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.get<T>(options);
  }

  public async delete<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.delete<T>(options);
  }

  public async head<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.head<T>(options);
  }

  public async put<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.put<T>(options);
  }

  public async patch<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.patch<T>(options);
  }

  public static handleError(
    error: HTTPErrorResponse | APIException,
  ): HTTPErrorResponse | APIException {
    return error;
  }

  protected static async onResponseSuccessHeaders(
    headers: Dictionary<string>,
  ): Promise<Dictionary<string>> {
    return Promise.resolve(headers);
  }

  public static getDefaultHeaders(_props?: any): Headers {
    /*
     * NOTE: no "Access-Control-Allow-Origin" here - that is a RESPONSE-only
     * header. Sending it as a request header forces a CORS preflight on every
     * cross-origin call (self-hosted setups where the API is on a different
     * origin), doubling the request count for zero benefit.
     */
    const defaultHeaders: Headers = {
      Accept: "application/json",
      "Content-Type": "application/json;charset=UTF-8",
    };

    return defaultHeaders;
  }

  protected static getHeaders(headers?: Headers): Headers {
    let defaultHeaders: Headers = this.getDefaultHeaders();

    if (headers) {
      defaultHeaders = {
        ...defaultHeaders,
        ...headers,
      };
    }

    return defaultHeaders;
  }

  public static async get<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const { url, data, headers, params, options: newOptions } = options;
    if (!url) {
      throw new APIException("URL is required for static method");
    }
    const fetchOptions: APIFetchOptions = {
      method: HTTPMethod.GET,
      url,
      ...(data && { data }),
      ...(headers && { headers }),
      ...(params && { params }),
      ...(newOptions && { options: newOptions }),
    };
    return await this.fetch<T>(fetchOptions);
  }

  public static async delete<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const { url, data, headers, params, options: newOptions } = options;
    if (!url) {
      throw new APIException("URL is required for static method");
    }
    const fetchOptions: APIFetchOptions = {
      method: HTTPMethod.DELETE,
      url,
      ...(data && { data }),
      ...(headers && { headers }),
      ...(params && { params }),
      ...(newOptions && { options: newOptions }),
    };
    return await this.fetch<T>(fetchOptions);
  }

  public static async head<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const { url, data, headers, params, options: newOptions } = options;
    if (!url) {
      throw new APIException("URL is required for static method");
    }
    const fetchOptions: APIFetchOptions = {
      method: HTTPMethod.HEAD,
      url,
      ...(data && { data }),
      ...(headers && { headers }),
      ...(params && { params }),
      ...(newOptions && { options: newOptions }),
    };
    return await this.fetch<T>(fetchOptions);
  }

  public static async put<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const { url, data, headers, params, options: newOptions } = options;
    if (!url) {
      throw new APIException("URL is required for static method");
    }
    const fetchOptions: APIFetchOptions = {
      method: HTTPMethod.PUT,
      url,
      ...(data && { data }),
      ...(headers && { headers }),
      ...(params && { params }),
      ...(newOptions && { options: newOptions }),
    };
    return await this.fetch<T>(fetchOptions);
  }

  public static async patch<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const { url, data, headers, params, options: newOptions } = options;
    if (!url) {
      throw new APIException("URL is required for static method");
    }
    const fetchOptions: APIFetchOptions = {
      method: HTTPMethod.PATCH,
      url,
      ...(data && { data }),
      ...(headers && { headers }),
      ...(params && { params }),
      ...(newOptions && { options: newOptions }),
    };
    return await this.fetch<T>(fetchOptions);
  }

  public static async post<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const { url, data, headers, params, options: newOptions } = options;
    if (!url) {
      throw new APIException("URL is required for static method");
    }
    const fetchOptions: APIFetchOptions = {
      method: HTTPMethod.POST,
      url,
      ...(data && { data }),
      ...(headers && { headers }),
      ...(params && { params }),
      ...(newOptions && { options: newOptions }),
    };
    return await this.fetch<T>(fetchOptions);
  }

  public static async fetch<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(options: APIFetchOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const { method, url, data, headers, params, options: newOptions } = options;
    if (!url) {
      throw new APIException("URL is required for static method");
    }
    return await this.fetchInternal<T>(
      method,
      url,
      data,
      headers,
      params,
      newOptions,
    );
  }

  private static async fetchInternal<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(
    method: HTTPMethod,
    url: URL,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    params?: Dictionary<string>,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const apiHeaders: Headers = this.getHeaders(headers);

    if (params) {
      url.addQueryParams(params);
    }

    const requestStartedAtInMs: number = Date.now();
    let attempts: number = 0;

    try {
      const finalHeaders: Dictionary<string> = {
        ...apiHeaders,
        ...headers,
      };

      let finalBody: JSONObject | JSONArray | URLSearchParams | undefined =
        data;

      // if content-type is form-url-encoded, then stringify the data

      if (
        finalHeaders["Content-Type"] === "application/x-www-form-urlencoded" &&
        data
      ) {
        finalBody = new URLSearchParams(data as Dictionary<string>);
      }

      /*
       * Negative budgets are clamped rather than trusted: `while (0 <= -1)`
       * used to skip the request entirely and report the misleading "No
       * response received from server" for a request never sent.
       */
      const maxRetries: number = Math.max(0, options?.retries || 0);
      const exponentialBackoff: boolean = options?.exponentialBackoff || false;

      // Identical on every attempt, so build it once.
      const axiosOptions: AxiosRequestConfig = {
        method: method,
        url: url.toString(),
        headers: finalHeaders,
        data: finalBody,
      };

      if (options?.timeout) {
        axiosOptions.timeout = options.timeout;
      }

      if (options?.doNotFollowRedirects) {
        axiosOptions.maxRedirects = 0;
      }

      // Attach proxy agents per request if provided (avoids global side-effects)
      if (options?.httpAgent) {
        axiosOptions.httpAgent = options.httpAgent;
      }
      if (options?.httpsAgent) {
        axiosOptions.httpsAgent = options.httpsAgent;
      }

      if (options?.onUploadProgress) {
        axiosOptions.onUploadProgress = options.onUploadProgress;
      }

      let result: AxiosResponse | null = null;

      for (let attempt: number = 0; attempt <= maxRetries; attempt++) {
        attempts++;

        try {
          result = await axios(axiosOptions);

          break;
        } catch (e) {
          if (attempt >= maxRetries) {
            throw e;
          }

          /*
           * A rejected request stays rejected. Failing now surfaces the
           * provider's own explanation immediately instead of after a full
           * ladder of backoffs that cannot change the answer.
           */
          if (options?.retryOnlyOnRetryableErrors && !API.isRetryableError(e)) {
            throw e;
          }

          const delayInMs: number = API.getRetryDelayInMs({
            attempt: attempt,
            error: e,
            exponentialBackoff: exponentialBackoff,
            maxBackoffInMs: options?.maxBackoffInMs,
          });

          /*
           * Check the budget against the point the next attempt would START,
           * not the point we are at now: sleeping out the remainder and then
           * giving up would waste the wait for nothing.
           */
          if (
            options?.totalTimeoutInMs !== undefined &&
            Date.now() - requestStartedAtInMs + delayInMs >=
              options.totalTimeoutInMs
          ) {
            throw e;
          }

          if (delayInMs > 0) {
            await Sleep.sleep(delayInMs);
          }
        }
      }

      if (!result) {
        throw new APIException("No response received from server.");
      }

      result.headers = await this.onResponseSuccessHeaders(
        result.headers as Dictionary<string>,
      );

      const response: HTTPResponse<T> = new HTTPResponse<T>(
        result.status,
        result.data,
        result.headers as Dictionary<string>,
      );

      this.notifyRequestComplete(options, {
        method: method,
        url: url.toString(),
        elapsedInMs: Date.now() - requestStartedAtInMs,
        attempts: attempts,
        ...(options?.timeout === undefined
          ? {}
          : { timeoutInMs: options.timeout }),
        statusCode: result.status,
      });

      return response;
    } catch (e) {
      const error: Error | AxiosError = e as Error | AxiosError;

      const elapsedInMs: number = Date.now() - requestStartedAtInMs;

      const baseOutcome: RequestOutcome = {
        method: method,
        url: url.toString(),
        elapsedInMs: elapsedInMs,
        attempts: attempts,
        ...(options?.timeout === undefined
          ? {}
          : { timeoutInMs: options.timeout }),
      };

      if (!axios.isAxiosError(error)) {
        const apiException: APIException = new APIException(error.message);

        this.notifyRequestComplete(options, {
          ...baseOutcome,
          error: apiException,
        });

        throw apiException;
      }

      let errorResponse: HTTPErrorResponse;

      /*
       * getErrorResponse THROWS for a request that never produced a
       * response (timeout, DNS failure, connection refused) — which is
       * precisely the case worth reporting, so it has to be observed here
       * rather than on the return path below.
       */
      try {
        errorResponse = this.getErrorResponse(error);
      } catch (thrownError) {
        this.notifyRequestComplete(options, {
          ...baseOutcome,
          error: thrownError as Error,
          axiosError: error,
        });

        throw thrownError;
      }

      if (
        error.response?.status === 401 &&
        !options?.skipAuthRefresh &&
        !options?.hasAttemptedAuthRefresh
      ) {
        const retryUrl: URL = URL.fromString(url.toString());

        const requestContext: AuthRetryContext["request"] = {
          method,
          url: retryUrl,
        };

        if (data) {
          requestContext.data = data;
        }

        if (headers) {
          requestContext.headers = headers;
        }

        if (params) {
          requestContext.params = params;
        }

        if (options) {
          requestContext.options = options;
        }

        const refreshed: boolean = await this.tryRefreshAuth({
          error: errorResponse,
          request: requestContext,
        });

        if (refreshed) {
          const nextOptions: RequestOptions = {
            ...(options || {}),
            hasAttemptedAuthRefresh: true,
          };

          return await this.fetchInternal(
            method,
            retryUrl,
            data,
            headers,
            params,
            nextOptions,
          );
        }
      }

      this.handleError(errorResponse);

      this.notifyRequestComplete(options, {
        ...baseOutcome,
        statusCode: errorResponse.statusCode,
        axiosError: error,
      });

      return errorResponse;
    }
  }

  private static notifyRequestComplete(
    options: RequestOptions | undefined,
    outcome: RequestOutcome,
  ): void {
    if (!options?.onRequestComplete) {
      return;
    }

    try {
      options.onRequestComplete(outcome);
    } catch {
      // Diagnostics must never change the fate of the request they describe.
    }
  }

  /**
   * Is repeating this request worth an attempt?
   *
   * Retries exist for failures the network or the server may not repeat: a
   * dropped connection, a timeout, an overloaded backend, a rate limit that
   * lapses. Everything else — a malformed body, a bad key, an unknown route —
   * fails identically every time, and retrying it only delays the error the
   * operator needs to read.
   */
  public static isRetryableError(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
      /*
       * Not a transport failure at all: the request could not even be built,
       * or an interceptor threw. Nothing about resending changes that.
       */
      return false;
    }

    const axiosError: AxiosError = error;

    // The caller pulled the plug on purpose.
    if (axiosError.code === "ERR_CANCELED") {
      return false;
    }

    const statusCode: number | undefined = axiosError.response?.status;

    /*
     * No response at all — timeout, DNS failure, refused or reset connection.
     * These are exactly what a retry is for.
     */
    if (statusCode === undefined) {
      return true;
    }

    // The server broke, not the request.
    if (statusCode >= 500) {
      return true;
    }

    return API.RETRYABLE_CLIENT_ERROR_STATUS_CODES.has(statusCode);
  }

  /**
   * How long to wait before the attempt that follows `attempt` (0-based).
   */
  private static getRetryDelayInMs(data: {
    attempt: number;
    error: unknown;
    exponentialBackoff: boolean;
    maxBackoffInMs?: number | undefined;
  }): number {
    const ceilingInMs: number =
      data.maxBackoffInMs ?? API.DEFAULT_MAX_BACKOFF_IN_MS;

    /*
     * A server that says when to come back knows better than any formula we
     * could pick — coming back early just spends another attempt on the same
     * 429. Still capped: the caller's budget is what bounds the total wait,
     * and an unbounded Retry-After would hand that control to the server.
     */
    const retryAfterInMs: number | undefined = API.getRetryAfterInMs(
      data.error,
    );

    if (retryAfterInMs !== undefined) {
      return Math.min(retryAfterInMs, ceilingInMs);
    }

    if (!data.exponentialBackoff) {
      return 0;
    }

    const backoffInMs: number = Math.min(
      2 ** (data.attempt + 1) * 1000,
      ceilingInMs,
    );

    /*
     * Equal jitter. Everything that failed together — every chat turn behind
     * one provider outage, every probe behind one flapping host — otherwise
     * comes back at the very same millisecond and knocks the recovering
     * server straight back over. Half the delay stays fixed so a retry is
     * never effectively immediate, and half is spread at random.
     */
    return Math.round(backoffInMs / 2 + Math.random() * (backoffInMs / 2));
  }

  /**
   * Read a Retry-After header off a failed response. Returns undefined unless
   * the header is present and names a sane, non-negative wait.
   */
  private static getRetryAfterInMs(error: unknown): number | undefined {
    if (!axios.isAxiosError(error)) {
      return undefined;
    }

    const headers: unknown = error.response?.headers;

    if (!headers || typeof headers !== "object") {
      return undefined;
    }

    const rawHeader: unknown =
      (headers as Dictionary<unknown>)["retry-after"] ??
      (headers as Dictionary<unknown>)["Retry-After"];

    if (rawHeader === undefined || rawHeader === null) {
      return undefined;
    }

    const headerValue: string = String(rawHeader).trim();

    if (!headerValue) {
      return undefined;
    }

    // Form 1: delta-seconds.
    const deltaSecondsRegex: RegExp = /^\d+$/;

    if (deltaSecondsRegex.test(headerValue)) {
      return Number(headerValue) * 1000;
    }

    // Form 2: an HTTP-date to wait until.
    const retryAtInMs: number = Date.parse(headerValue);

    if (Number.isNaN(retryAtInMs)) {
      return undefined;
    }

    // A date already in the past means "retry now", not "retry in the past".
    return Math.max(0, retryAtInMs - Date.now());
  }

  private static getErrorResponse(error: AxiosError): HTTPErrorResponse {
    if (error.response) {
      return new HTTPErrorResponse(
        error.response.status,
        error.response.data as JSONObject | JSONArray,
        error.response.headers as Dictionary<string>,
      );
    }

    // get url from error
    const url: string = error?.config?.url || "";

    // Get a meaningful error message, avoiding generic "Error" strings
    let errorMessage: string = error.message || "";

    // If error message is empty or just "Error", try to get more details from the error
    if (
      !errorMessage ||
      errorMessage.toLowerCase() === "error" ||
      errorMessage.trim() === ""
    ) {
      // Check for common axios error codes
      if (error.code) {
        switch (error.code) {
          case "ECONNREFUSED":
            errorMessage = "Connection refused";
            break;
          case "ECONNRESET":
            errorMessage = "Connection reset";
            break;
          case "ETIMEDOUT":
            errorMessage = "Connection timed out";
            break;
          case "ENOTFOUND":
            errorMessage = "Host not found";
            break;
          case "ECONNABORTED":
            errorMessage = "Connection aborted";
            break;
          case "ERR_NETWORK":
            errorMessage = "Network error";
            break;
          case "ERR_BAD_REQUEST":
            errorMessage = "Bad request";
            break;
          case "ERR_BAD_RESPONSE":
            errorMessage = "Bad response from server";
            break;
          default:
            errorMessage = error.code || "Unknown error";
        }
      } else {
        errorMessage = "Request failed";
      }
    }

    throw new APIException(`Request failed to ${url}. ${errorMessage}`, error);
  }

  public static getFriendlyErrorMessage(error: AxiosError | Error): string {
    let errorString: string = error.message || error.toString();

    if (error instanceof APIException) {
      // Get the nested error message, but avoid duplicating or adding empty/generic messages
      let nestedErrorMessage: string = "";
      if (error.error) {
        // Get the error message, avoiding generic "Error" or empty strings
        const errMsg: string = error.error.message || "";
        const errStr: string = error.error.toString() || "";

        // Check if the error message is meaningful (not just "Error" or empty)
        if (
          errMsg &&
          errMsg.trim().toLowerCase() !== "error" &&
          errMsg.trim() !== ""
        ) {
          nestedErrorMessage = errMsg;
        } else if (
          errStr &&
          errStr.trim().toLowerCase() !== "error" &&
          errStr.trim().toLowerCase() !== "error:" &&
          errStr.trim() !== "" &&
          !errStr.toLowerCase().startsWith("error:")
        ) {
          nestedErrorMessage = errStr;
        }
      }

      // Only append nested error if it's meaningful and not already in the main message
      if (nestedErrorMessage && !error.message?.includes(nestedErrorMessage)) {
        errorString = `${error.message?.toString()} ${nestedErrorMessage}`;
      } else {
        errorString = error.message?.toString() || "";
      }
    }

    // Handle AggregateError by extracting the underlying error messages
    if (
      error &&
      (error as any).name === "AggregateError" &&
      (error as any).errors
    ) {
      const aggregateErrors: Error[] = (error as any).errors as Error[];
      const errorMessages: string[] = aggregateErrors
        .map((err: Error) => {
          return err.message || err.toString();
        })
        .filter((msg: string) => {
          return msg && msg.trim().length > 0;
        });

      if (errorMessages.length > 0) {
        errorString = errorMessages.join("; ");
      }
    }

    const status: number | undefined = (error as AxiosError)?.response?.status;
    const lowerErr: string = errorString.toLocaleLowerCase();

    if (status !== 400 && lowerErr.includes("network error")) {
      return "Network Error.";
    }

    if (status !== 400 && lowerErr.includes("timeout")) {
      return "Timeout Error.";
    }

    if (status !== 400 && lowerErr.includes("request aborted")) {
      return "Request Aborted.";
    }

    if (status !== 400 && lowerErr.includes("canceled")) {
      return "Request Canceled.";
    }

    if (status !== 400 && lowerErr.includes("connection refused")) {
      return "Connection Refused.";
    }

    if (status !== 400 && lowerErr.includes("connection reset")) {
      return "Connection Reset.";
    }

    if (status !== 400 && lowerErr.includes("connection closed")) {
      return "Connection Closed.";
    }

    if (status !== 400 && lowerErr.includes("connection failed")) {
      return "Connection Failed.";
    }

    if (status !== 400 && lowerErr.includes("enotfound")) {
      return "Cannot Find Host.";
    }

    if (status !== 400 && lowerErr.includes("econnreset")) {
      return "Connection Reset.";
    }

    if (status !== 400 && lowerErr.includes("econnrefused")) {
      return "Connection Refused.";
    }

    if (status !== 400 && lowerErr.includes("econnaborted")) {
      return "Connection Aborted.";
    }

    if (status !== 400 && lowerErr.includes("certificate has expired")) {
      return "SSL Certificate Expired.";
    }

    if (
      errorString
        .toLocaleLowerCase()
        .includes("certificate signed by unknown authority")
    ) {
      return "SSL Certificate Signed By Unknown Authority.";
    }

    if (errorString.toLocaleLowerCase().includes("self-signed certificate")) {
      return "Self Signed Certificate.";
    }

    return errorString;
  }

  /**
   * Extracts detailed error information from an axios error or generic error.
   * This provides more context about where and why a request failed.
   */
  public static getRequestFailedDetails(
    error: AxiosError | Error | unknown,
  ): RequestFailedDetails {
    const axiosError: AxiosError | null = axios.isAxiosError(error)
      ? (error as AxiosError)
      : null;
    const errorCode: string | undefined = axiosError?.code;
    const rawErrorMessage: string =
      (error as Error)?.message || String(error) || "Unknown error";

    // Helper to determine the phase and description based on error code/message
    const lowerMessage: string = rawErrorMessage.toLowerCase();

    // DNS resolution failures
    if (errorCode === "ENOTFOUND" || lowerMessage.includes("enotfound")) {
      return {
        failedPhase: RequestFailedPhase.DNSResolution,
        errorCode: errorCode || "ENOTFOUND",
        errorDescription:
          "DNS resolution failed. The hostname could not be resolved to an IP address. Please verify the hostname is correct and that DNS is working properly.",
        rawErrorMessage,
      };
    }

    // Connection refused
    if (errorCode === "ECONNREFUSED" || lowerMessage.includes("econnrefused")) {
      return {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: errorCode || "ECONNREFUSED",
        errorDescription:
          "Connection refused. The server actively refused the connection. This usually means no service is listening on the specified port, or a firewall is blocking the connection.",
        rawErrorMessage,
      };
    }

    // Connection reset
    if (
      errorCode === "ECONNRESET" ||
      lowerMessage.includes("econnreset") ||
      lowerMessage.includes("connection reset")
    ) {
      return {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: errorCode || "ECONNRESET",
        errorDescription:
          "Connection reset. The connection was forcibly closed by the server or a network device. This can happen due to server restarts, load balancer timeouts, or network issues.",
        rawErrorMessage,
      };
    }

    // Connection aborted
    if (
      errorCode === "ECONNABORTED" ||
      lowerMessage.includes("econnaborted") ||
      lowerMessage.includes("connection aborted")
    ) {
      return {
        failedPhase: RequestFailedPhase.RequestAborted,
        errorCode: errorCode || "ECONNABORTED",
        errorDescription:
          "Connection aborted. The request was aborted, possibly due to a timeout or the connection being closed unexpectedly.",
        rawErrorMessage,
      };
    }

    // Timeout errors
    if (
      errorCode === "ETIMEDOUT" ||
      errorCode === "ESOCKETTIMEDOUT" ||
      lowerMessage.includes("timeout") ||
      lowerMessage.includes("exceeded")
    ) {
      return {
        failedPhase: RequestFailedPhase.RequestTimeout,
        errorCode: errorCode || "TIMEOUT",
        errorDescription:
          "Request timed out. The server did not respond within the allowed time. This could be due to network latency, server overload, or the server being unresponsive.",
        rawErrorMessage,
      };
    }

    // SSL/TLS Certificate errors
    if (
      lowerMessage.includes("certificate has expired") ||
      lowerMessage.includes("cert_has_expired")
    ) {
      return {
        failedPhase: RequestFailedPhase.CertificateError,
        errorCode: "CERT_HAS_EXPIRED",
        errorDescription:
          "SSL certificate has expired. The server's SSL certificate is no longer valid. The certificate needs to be renewed.",
        rawErrorMessage,
      };
    }

    if (
      lowerMessage.includes("self-signed certificate") ||
      lowerMessage.includes("self signed certificate") ||
      lowerMessage.includes("depth_zero_self_signed_cert")
    ) {
      return {
        failedPhase: RequestFailedPhase.CertificateError,
        errorCode: "SELF_SIGNED_CERT",
        errorDescription:
          "Self-signed certificate detected. The server is using a self-signed SSL certificate that is not trusted by default. Consider using a certificate from a trusted Certificate Authority.",
        rawErrorMessage,
      };
    }

    if (
      lowerMessage.includes("certificate signed by unknown authority") ||
      lowerMessage.includes("unable_to_verify_leaf_signature") ||
      lowerMessage.includes("unable to verify")
    ) {
      return {
        failedPhase: RequestFailedPhase.CertificateError,
        errorCode: "CERT_UNKNOWN_AUTHORITY",
        errorDescription:
          "SSL certificate signed by unknown authority. The certificate chain could not be verified against known Certificate Authorities.",
        rawErrorMessage,
      };
    }

    if (
      lowerMessage.includes("ssl") ||
      lowerMessage.includes("tls") ||
      lowerMessage.includes("certificate") ||
      lowerMessage.includes("handshake")
    ) {
      return {
        failedPhase: RequestFailedPhase.TLSHandshake,
        errorCode: errorCode || "TLS_ERROR",
        errorDescription:
          "TLS/SSL handshake failed. There was an error establishing a secure connection to the server. This could be due to certificate issues, protocol mismatches, or the server not supporting HTTPS.",
        rawErrorMessage,
      };
    }

    // Network errors
    if (lowerMessage.includes("network error") || errorCode === "ERR_NETWORK") {
      return {
        failedPhase: RequestFailedPhase.NetworkError,
        errorCode: errorCode || "NETWORK_ERROR",
        errorDescription:
          "Network error occurred. Unable to reach the server due to network connectivity issues. Please check your network connection and ensure the server is accessible.",
        rawErrorMessage,
      };
    }

    // Host unreachable
    if (
      errorCode === "EHOSTUNREACH" ||
      lowerMessage.includes("host unreachable")
    ) {
      return {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: errorCode || "EHOSTUNREACH",
        errorDescription:
          "Host unreachable. The network path to the server could not be found. This may be due to routing issues or the host being offline.",
        rawErrorMessage,
      };
    }

    // Network unreachable
    if (
      errorCode === "ENETUNREACH" ||
      lowerMessage.includes("network unreachable")
    ) {
      return {
        failedPhase: RequestFailedPhase.TCPConnection,
        errorCode: errorCode || "ENETUNREACH",
        errorDescription:
          "Network unreachable. There is no route to the network where the server resides. This is typically a routing or connectivity issue.",
        rawErrorMessage,
      };
    }

    // Server responded with error status
    if (axiosError?.response) {
      const status: number = axiosError.response.status;
      let description: string = `Server responded with HTTP status ${status}.`;

      if (status >= 500) {
        description += " This indicates a server-side error.";
      } else if (status === 404) {
        description += " The requested resource was not found.";
      } else if (status === 403) {
        description += " Access to the resource is forbidden.";
      } else if (status === 401) {
        description += " Authentication is required or has failed.";
      } else if (status === 400) {
        description += " The request was malformed or invalid.";
      } else if (status >= 400) {
        description += " This indicates a client-side error.";
      }

      return {
        failedPhase: RequestFailedPhase.ServerResponse,
        errorCode: `HTTP_${status}`,
        errorDescription: description,
        rawErrorMessage,
      };
    }

    // Request was made but no response received
    if (axiosError?.request && !axiosError?.response) {
      return {
        failedPhase: RequestFailedPhase.NetworkError,
        errorCode: errorCode || "NO_RESPONSE",
        errorDescription:
          "No response received from the server. The request was sent but no response was returned. This could indicate the server is down, unreachable, or the request timed out.",
        rawErrorMessage,
      };
    }

    // Default/Unknown error
    return {
      failedPhase: RequestFailedPhase.Unknown,
      errorCode: errorCode,
      errorDescription: `Request failed: ${API.getFriendlyErrorMessage(error as Error)}`,
      rawErrorMessage,
    };
  }
}
