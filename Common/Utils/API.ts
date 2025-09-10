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
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
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

  public async get<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(
    path: Route,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.get<T>(
      new URL(this.protocol, this.hostname, this.baseRoute.addRoute(path)),
      data,
      headers,
      options,
    );
  }

  public async delete<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(
    path: Route,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.delete<T>(
      new URL(this.protocol, this.hostname, this.baseRoute.addRoute(path)),
      data,
      headers,
      options,
    );
  }

  public async head<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(
    path: Route,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.head<T>(
      new URL(this.protocol, this.hostname, this.baseRoute.addRoute(path)),
      data,
      headers,
      options,
    );
  }

  public async put<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(
    path: Route,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.put<T>(
      new URL(this.protocol, this.hostname, this.baseRoute.addRoute(path)),
      data,
      headers,
      options,
    );
  }

  public async patch<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(
    path: Route,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.patch<T>(
      new URL(this.protocol, this.hostname, this.baseRoute.addRoute(path)),
      data,
      headers,
      options,
    );
  }

  public async post<
    T extends JSONObject | JSONArray | BaseModel | Array<BaseModel>,
  >(
    path: Route,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await API.post<T>(
      new URL(this.protocol, this.hostname, this.baseRoute.addRoute(path)),
      data,
      headers,
      options,
    );
  }

  protected static handleError(
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
  >(
    url: URL,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.fetch<T>(
      HTTPMethod.GET,
      url,
      data,
      headers,
      undefined,
      options,
    );
  }

  public static async delete<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(
    url: URL,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.fetch(
      HTTPMethod.DELETE,
      url,
      data,
      headers,
      undefined,
      options,
    );
  }

  public static async head<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(
    url: URL,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.fetch(
      HTTPMethod.HEAD,
      url,
      data,
      headers,
      undefined,
      options,
    );
  }

  public static async put<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(
    url: URL,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.fetch(
      HTTPMethod.PUT,
      url,
      data,
      headers,
      undefined,
      options,
    );
  }

  public static async patch<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(
    url: URL,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.fetch(
      HTTPMethod.PATCH,
      url,
      data,
      headers,
      undefined,
      options,
    );
  }

  public static async post<
    T extends
      | JSONObject
      | JSONArray
      | BaseModel
      | Array<BaseModel>
      | AnalyticsBaseModel
      | Array<AnalyticsBaseModel>,
  >(
    url: URL,
    data?: JSONObject | JSONArray,
    headers?: Headers,
    options?: RequestOptions,
  ): Promise<HTTPResponse<T> | HTTPErrorResponse> {
    return await this.fetch(
      HTTPMethod.POST,
      url,
      data,
      headers,
      undefined,
      options,
    );
  }

  public static async fetch<
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
      let errorResponse: HTTPErrorResponse;
      if (axios.isAxiosError(error)) {
        // Do whatever you want with native error
        errorResponse = this.getErrorResponse(error);
      } else {
        throw new APIException(error.message);
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

    const errorMessage: string = error.message || error.toString();

    throw new APIException(`Request failed to ${url}. ${errorMessage}`, error);
  }

  public static getFriendlyErrorMessage(error: AxiosError | Error): string {
    let errorString: string = error.message || error.toString();

    if (error instanceof APIException) {
      errorString = `${error.message?.toString()} ${error.error?.message || error.error?.toString() || ""}`;
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

    if (errorString.toLocaleLowerCase().includes("network error")) {
      return "Network Error.";
    }

    if (errorString.toLocaleLowerCase().includes("timeout")) {
      return "Timeout Error.";
    }

    if (errorString.toLocaleLowerCase().includes("request aborted")) {
      return "Request Aborted.";
    }

    if (errorString.toLocaleLowerCase().includes("canceled")) {
      return "Request Canceled.";
    }

    if (errorString.toLocaleLowerCase().includes("connection refused")) {
      return "Connection Refused.";
    }

    if (errorString.toLocaleLowerCase().includes("connection reset")) {
      return "Connection Reset.";
    }

    if (errorString.toLocaleLowerCase().includes("connection closed")) {
      return "Connection Closed.";
    }

    if (errorString.toLocaleLowerCase().includes("connection failed")) {
      return "Connection Failed.";
    }

    if (errorString.toLocaleLowerCase().includes("enotfound")) {
      return "Cannot Find Host.";
    }

    if (errorString.toLocaleLowerCase().includes("econnreset")) {
      return "Connection Reset.";
    }

    if (errorString.toLocaleLowerCase().includes("econnrefused")) {
      return "Connection Refused.";
    }

    if (errorString.toLocaleLowerCase().includes("econnaborted")) {
      return "Connection Aborted.";
    }

    if (errorString.toLocaleLowerCase().includes("certificate has expired")) {
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
