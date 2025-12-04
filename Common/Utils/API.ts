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
    if (
      lowerMessage.includes("network error") ||
      errorCode === "ERR_NETWORK"
    ) {
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
