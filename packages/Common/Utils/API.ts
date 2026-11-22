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
import BadDataException from "../Types/Exception/BadDataException";
import ReauthenticationRequiredException from "../Types/Exception/ReauthenticationRequiredException";
import { JSONArray, JSONObject } from "../Types/JSON";
import axios, {
  AxiosError,
  AxiosProgressEvent,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import Sleep from "../Types/Sleep";
import HTTPResponseBodyReader, {
  HTTPResponseBodyBudget,
} from "./HTTPResponseBodyReader";
import { getSameServerRedirectCheck } from "./SameServerRedirect";
import OutboundRequestRouting from "./OutboundRequestRouting";
import ProxyTunnelRefusal from "./ProxyTunnelRefusal";
import ResponseTooLarge from "./ResponseTooLarge";
import RetryAfter from "./RetryAfter";
import type { Agent as HttpAgent } from "http";
import type { Agent as HttpsAgent } from "https";

/*
 * What a request sends: JSON (an object or an array), or bytes sent as they
 * are, with whatever Content-Type the caller names - how a probe passes on a
 * text body it relays (Probe/API/IncomingRequestIngress).
 */
export type APIRequestBody = JSONObject | JSONArray | Buffer;

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
  /*
   * For a request that carries a key OneUptime's own components present -
   * the cluster key, a probe's key, a Runner's key: a redirect is followed
   * only while it stays on the server the request was sent to (the same
   * address, or that address moved from http to https), and anywhere else
   * the request fails instead (SameServerRedirect). An HTTP client sends a
   * redirected request's headers, and a 307 or 308's body, to wherever the
   * redirect points.
   */
  sameServerRedirectsOnly?: boolean | undefined;
  /*
   * Explicit byte ceilings for callers that return tenant-selected remote
   * content. Axios otherwise accepts an unlimited response/request body.
   */
  maxContentLength?: number | undefined;
  maxBodyLength?: number | undefined;
  /*
   * On a server, a request goes through the outbound proxy the environment
   * names (HTTPS_PROXY, HTTP_PROXY, ALL_PROXY, apart from NO_PROXY's hosts),
   * or directly, as OutboundRequestRouting decides for its URL; axios never
   * reads the proxy from the environment itself (#10442). true: never
   * through a proxy, on the agents given, or else directly.
   */
  disableProxy?: boolean | undefined;
  /* Abort active sockets when a caller-owned end-to-end deadline expires. */
  signal?: AbortSignal | undefined;
  /*
   * Opt-in streaming mode used by monitor requests. All responses that share
   * this object draw from one decompressed-byte budget.
   */
  responseBodyBudget?: HTTPResponseBodyBudget | undefined;
  limitRedirectResponseBody?: boolean | undefined;
  maximumResponseBytes?: number | undefined;
  /**
   * @internal Already-validated wire URL used by guarded callers when the
   * reporting URL type cannot represent an href without normalization.
   */
  dispatchUrl?: string | undefined;
  /*
   * Agents of the request's own: a pinned agent pair, or a probe's proxy
   * agents. They are its route: no proxy of axios's is added on top.
   */
  httpAgent?: HttpAgent | undefined;
  httpsAgent?: HttpsAgent | undefined;
  /*
   * Send with Node's http adapter, whichever adapter axios would pick on its
   * own. It is the only one that uses httpAgent / httpsAgent, so a caller
   * whose agents dial only the address it validated (SafeWebhookRequest)
   * asks for it: any other adapter would dial whatever the name resolves to
   * by then.
   */
  useNodeHttpAdapter?: boolean | undefined;
  skipAuthRefresh?: boolean | undefined;
  hasAttemptedAuthRefresh?: boolean | undefined;
  /*
   * A change to how a person signs in, refused until their session confirms
   * it's theirs (#10155, ReauthenticationRequiredException), is sent again
   * once a client that can ask for the confirmation has it
   * (tryReauthenticate) - once. The prompt's own requests skip it.
   */
  skipReauthentication?: boolean | undefined;
  hasAttemptedReauthentication?: boolean | undefined;
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
  data?: APIRequestBody;
  headers?: Headers;
  params?: Dictionary<string>;
  options?: RequestOptions;
}

export interface APIFetchOptions {
  method: HTTPMethod;
  url: URL;
  data?: APIRequestBody;
  headers?: Headers;
  params?: Dictionary<string>;
  options?: RequestOptions;
}

/** One logical outgoing request, as seen by an OutgoingRequestTracer. */
export interface OutgoingRequest {
  method: HTTPMethod;
  url: string;
  /*
   * Extra headers to send. The tracer may add to this object (e.g. a W3C
   * `traceparent`) before calling `send`; nothing else reads it.
   */
  headers: Dictionary<string>;
}

/*
 * Server-only seam for distributed tracing. The shared client stays free of
 * any tracing SDK (it also runs in the browser, where the fetch/XHR
 * instrumentations own propagation); a server process installs a tracer that
 * wraps each request — every retry included — in a span and decides whether
 * trace context may be sent to that destination at all.
 */
export interface OutgoingRequestTracer {
  trace<T>(request: OutgoingRequest, send: () => Promise<T>): Promise<T>;
}

export interface AuthRetryContext {
  error: HTTPErrorResponse;
  request: {
    method: HTTPMethod;
    url: URL;
    data?: APIRequestBody;
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

  private static outgoingRequestTracer: OutgoingRequestTracer | null = null;

  public static setOutgoingRequestTracer(
    tracer: OutgoingRequestTracer | null,
  ): void {
    API.outgoingRequestTracer = tracer;
  }

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

  /*
   * A request refused until the session confirms it's its person's (#10155):
   * whether the session has confirmed now, so the request is sent again. A
   * client with a person to ask (the Dashboard's, Common/UI/Utils/API/API)
   * asks them; every other client answers no, and the refusal is its answer.
   */
  protected static async tryReauthenticate(
    _context: AuthRetryContext,
  ): Promise<boolean> {
    return false;
  }

  /*
   * The class this instance was built from, so `new BaseAPI(...).get()` gets
   * BaseAPI's session refresh, error handling and headers rather than the
   * base class's no-op versions.
   */
  private getStaticClient(): typeof API {
    return this.constructor as typeof API;
  }

  public async get<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.getStaticClient().get<T>(options);
  }

  public async delete<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.getStaticClient().delete<T>(options);
  }

  public async head<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.getStaticClient().head<T>(options);
  }

  public async put<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.getStaticClient().put<T>(options);
  }

  public async patch<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(options: APIRequestOptions): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.getStaticClient().patch<T>(options);
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
    data?: APIRequestBody,
    headers?: Headers,
    params?: Dictionary<string>,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const tracer: OutgoingRequestTracer | null = API.outgoingRequestTracer;

    if (!tracer) {
      return await this.fetchUntraced<T>(
        method,
        url,
        data,
        headers,
        params,
        options,
      );
    }

    const tracingHeaders: Dictionary<string> = {};

    return await tracer.trace<HTTPResponse<T> | HTTPErrorResponse>(
      {
        method,
        url: options?.dispatchUrl ?? url.toString(),
        headers: tracingHeaders,
      },
      () => {
        return this.fetchUntraced<T>(
          method,
          url,
          data,
          Object.keys(tracingHeaders).length > 0
            ? { ...(headers || {}), ...tracingHeaders }
            : headers,
          params,
          options,
        );
      },
    );
  }

  private static async fetchUntraced<
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
    data?: APIRequestBody,
    headers?: Headers,
    params?: Dictionary<string>,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    const apiHeaders: Headers = this.getHeaders(headers);

    if (params) {
      url.addQueryParams(params);
    }

    /*
     * The query parameters go on the URL that is sent. A dispatch URL used to
     * leave them on the reporting URL alone, so a guarded caller's parameters
     * never reached the server.
     */
    const dispatchUrl: string | undefined =
      options?.dispatchUrl === undefined
        ? undefined
        : API.addQueryParamsToDispatchUrl(options.dispatchUrl, params);

    const requestStartedAtInMs: number = Date.now();
    let attempts: number = 0;

    try {
      const finalHeaders: Dictionary<string> = {
        ...apiHeaders,
        ...headers,
      };

      let finalBody: APIRequestBody | URLSearchParams | undefined = data;

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
        url: dispatchUrl ?? url.toString(),
        headers: finalHeaders,
        data: finalBody,
      };

      if (options?.timeout) {
        axiosOptions.timeout = options.timeout;
      }

      if (options?.doNotFollowRedirects) {
        axiosOptions.maxRedirects = 0;
      }

      if (options?.sameServerRedirectsOnly) {
        axiosOptions.beforeRedirect = getSameServerRedirectCheck(
          dispatchUrl ?? url.toString(),
        );
      }

      if (options?.maxContentLength !== undefined) {
        axiosOptions.maxContentLength = options.maxContentLength;
      }

      if (options?.maxBodyLength !== undefined) {
        axiosOptions.maxBodyLength = options.maxBodyLength;
      }

      if (options?.disableProxy) {
        axiosOptions.proxy = false;
      }

      if (options?.signal) {
        axiosOptions.signal = options.signal;
      }

      if (options?.responseBodyBudget) {
        axiosOptions.responseType = "stream";
        /*
         * Axios's Node adapter enforces maxContentLength in an async
         * generator before yielding the chunk that crosses the limit. That
         * would hide already-received bytes from the shared budget and let a
         * retry reclaim them. The streamed reader below is the sole response
         * cap in this mode; it charges every decompressed chunk before
         * rejecting and destroys the stream immediately.
         */
        axiosOptions.maxContentLength = -1;
      }

      // Attach proxy agents per request if provided (avoids global side-effects)
      if (options?.httpAgent) {
        axiosOptions.httpAgent = options.httpAgent;
      }
      if (options?.httpsAgent) {
        axiosOptions.httpsAgent = options.httpsAgent;
      }

      if (options?.useNodeHttpAdapter) {
        axiosOptions.adapter = "http";
      }

      if (options?.onUploadProgress) {
        axiosOptions.onUploadProgress = options.onUploadProgress;
      }

      /*
       * On a server: through the outbound proxy, or directly, decided for
       * the URL (and again at each redirect) - never through a proxy axios
       * reads from the environment itself, which sent the proxy's password
       * percent-encoded (#10442). In a browser: as it is.
       */
      OutboundRequestRouting.route(axiosOptions);

      let result: AxiosResponse | null = null;

      for (let attempt: number = 0; attempt <= maxRetries; attempt++) {
        attempts++;

        try {
          const axiosResult: AxiosResponse = await axios(axiosOptions);

          if (options?.responseBodyBudget) {
            axiosResult.data = await API.readBudgetedResponseBody(
              axiosResult,
              options.responseBodyBudget,
              options.limitRedirectResponseBody || false,
              method === HTTPMethod.HEAD,
              options.maximumResponseBytes,
              options.signal,
            );
          }

          result = axiosResult;

          break;
        } catch (e) {
          if (e instanceof BadDataException) {
            throw e;
          }

          if (
            options?.responseBodyBudget &&
            axios.isAxiosError(e) &&
            e.response
          ) {
            e.response.data = await API.readBudgetedResponseBody(
              e.response,
              options.responseBodyBudget,
              options.limitRedirectResponseBody || false,
              method === HTTPMethod.HEAD,
              options.maximumResponseBytes,
              options.signal,
            );
          }

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
        if (error instanceof BadDataException) {
          this.notifyRequestComplete(options, {
            ...baseOutcome,
            error: error,
          });
          throw error;
        }

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
        const retryUrl: URL = URL.fromStringLenient(url.toString());

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

      /*
       * A change to how the person signs in, refused - before anything was
       * written - until their session confirms it's theirs (#10155): sent
       * again, once, when it has.
       */
      if (
        error.response?.status === 400 &&
        !options?.skipReauthentication &&
        !options?.hasAttemptedReauthentication &&
        ReauthenticationRequiredException.isRefusal(errorResponse.data)
      ) {
        const retryUrl: URL = URL.fromStringLenient(url.toString());

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

        const reauthenticated: boolean = await this.tryReauthenticate({
          error: errorResponse,
          request: requestContext,
        });

        if (reauthenticated) {
          return await this.fetchInternal(
            method,
            retryUrl,
            data,
            headers,
            params,
            {
              ...(options || {}),
              hasAttemptedReauthentication: true,
            },
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

  /*
   * A dispatch URL with the request's query parameters set on it, each one
   * replacing a parameter of the same name, as URL.addQueryParams does. The
   * rest of the URL - its host above all - is the one the caller validated.
   */
  private static addQueryParamsToDispatchUrl(
    dispatchUrl: string,
    params: Dictionary<string> | undefined,
  ): string {
    const names: Array<string> = Object.keys(params || {});

    if (!params || names.length === 0) {
      return dispatchUrl;
    }

    const withParams: globalThis.URL = new globalThis.URL(dispatchUrl);

    for (const name of names) {
      withParams.searchParams.set(name, params[name] ?? "");
    }

    return withParams.href;
  }

  private static async readBudgetedResponseBody(
    response: AxiosResponse,
    budget: HTTPResponseBodyBudget,
    limitRedirectResponseBody: boolean,
    isHeadResponse: boolean,
    maximumResponseBytes?: number | undefined,
    signal?: AbortSignal | undefined,
  ): Promise<unknown> {
    const body: Buffer = await HTTPResponseBodyReader.read(response.data, {
      budget: budget,
      statusCode: response.status,
      headers: response.headers,
      limitRedirectResponseBody: limitRedirectResponseBody,
      isHeadResponse: isHeadResponse,
      maximumResponseBytes: maximumResponseBytes,
      signal: signal,
    });
    const text: string = HTTPResponseBodyReader.decodeUtf8(body);

    if (!text) {
      return "";
    }

    try {
      return JSON.parse(text) as JSONObject | JSONArray;
    } catch {
      return text;
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

    /*
     * The answer was larger than the request reads: the server answered,
     * and asking again only reads as much of the same answer again.
     */
    if (ResponseTooLarge.isError(axiosError)) {
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
     * And never less than a second (RetryAfter's floor): "0" or a date gone
     * by would otherwise spend every retry at once.
     */
    const retryAfterInMs: number | undefined = API.getRetryAfterInMs(
      data.error,
      ceilingInMs,
    );

    if (retryAfterInMs !== undefined) {
      return retryAfterInMs;
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

  /*
   * The Retry-After of a failed response, as RFC 9110 writes it (see
   * RetryAfter), held between a second and `ceilingInMs`. Undefined unless
   * the header is there and is delay-seconds or an HTTP-date: "1.5", "-5"
   * or "5 seconds" are none (Date.parse took them for days in 2001, a wait
   * long over, and every retry went at once - issue #8928), so the backoff
   * applies.
   */
  private static getRetryAfterInMs(
    error: unknown,
    ceilingInMs: number,
  ): number | undefined {
    if (!axios.isAxiosError(error)) {
      return undefined;
    }

    return RetryAfter.msFromHeaders(error.response?.headers, {
      maxMs: ceilingInMs,
    });
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

    /*
     * A tunnel the outbound proxy refused is the proxy's answer, said
     * without the proxy's address (ProxyTunnelRefusal).
     */
    const tunnelRefusal: string | null = ProxyTunnelRefusal.describe(error);

    if (tunnelRefusal) {
      errorMessage = tunnelRefusal;
    }

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

  /*
   * HTTPErrorResponse is accepted because it is what gets caught: ModelAPI and
   * the Dashboard's request helpers throw the error response itself, and its
   * `message` getter reads the server's error body.
   */
  public static getFriendlyErrorMessage(
    error: AxiosError | Error | HTTPErrorResponse,
  ): string {
    // The proxy's refusal, never its address (ProxyTunnelRefusal).
    const tunnelRefusal: string | null = ProxyTunnelRefusal.describe(error);

    if (tunnelRefusal) {
      return tunnelRefusal;
    }

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
}
