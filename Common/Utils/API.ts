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
import axios, {
  AxiosError,
  AxiosProgressEvent,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import Sleep from "../Types/Sleep";
import type { Agent as HttpAgent } from "http";
import type { Agent as HttpsAgent } from "https";

export interface RequestOptions {
  retries?: number | undefined;
  exponentialBackoff?: boolean | undefined;
  timeout?: number | undefined;
  doNotFollowRedirects?: boolean | undefined;
  // Per-request proxy agent support (Probe supplies these instead of mutating global axios defaults)
  httpAgent?: HttpAgent | undefined;
  httpsAgent?: HttpsAgent | undefined;
  skipAuthRefresh?: boolean | undefined;
  hasAttemptedAuthRefresh?: boolean | undefined;
  onUploadProgress?: ((event: AxiosProgressEvent) => void) | undefined;
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
    const defaultHeaders: Headers = {
      "Access-Control-Allow-Origin": "*",
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

      let currentRetry: number = 0;
      const maxRetries: number = options?.retries || 0;
      const exponentialBackoff: boolean = options?.exponentialBackoff || false;

      let result: AxiosResponse | null = null;

      while (currentRetry <= maxRetries) {
        currentRetry++;
        try {
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
            (axiosOptions as AxiosRequestConfig).httpAgent = options.httpAgent;
          }
          if (options?.httpsAgent) {
            (axiosOptions as AxiosRequestConfig).httpsAgent =
              options.httpsAgent;
          }

          if (options?.onUploadProgress) {
            axiosOptions.onUploadProgress = options.onUploadProgress;
          }

          result = await axios(axiosOptions);

          break;
        } catch (e) {
          if (currentRetry <= maxRetries) {
            if (exponentialBackoff) {
              await Sleep.sleep(2 ** currentRetry * 1000);
            }

            continue;
          } else {
            throw e;
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

      return response;
    } catch (e) {
      const error: Error | AxiosError = e as Error | AxiosError;

      if (!axios.isAxiosError(error)) {
        throw new APIException(error.message);
      }

      const errorResponse: HTTPErrorResponse = this.getErrorResponse(error);

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
      return errorResponse;
    }
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
        if (errMsg && errMsg.trim().toLowerCase() !== "error" && errMsg.trim() !== "") {
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
