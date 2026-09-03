import HTTPMethod from "./API/HTTPMethod";
import Headers from "./API/Headers";
import URL from "./API/URL";
import Dictionary from "./Dictionary";
import HTML from "./Html";
import HTTPResponseBodyReader, {
  HTTPResponseBodyBudget,
} from "../Utils/HTTPResponseBodyReader";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import type { Agent as HttpAgent } from "http";
import type { Agent as HttpsAgent } from "https";

export interface WebsiteResponse {
  url: URL;
  requestHeaders: Headers;
  responseHeaders: Headers;
  responseStatusCode: number;
  responseBody: HTML;
  isOnline: boolean;
}

export default class WebsiteRequest {
  public static async fetch(
    url: URL,
    options: {
      headers?: Headers | undefined;
      timeout?: number | undefined;
      isHeadRequest?: boolean | undefined;
      doNotFollowRedirects?: boolean | undefined;
      doNotFallbackFromHead?: boolean | undefined;
      acceptRedirectResponses?: boolean | undefined;
      maxContentLength?: number | undefined;
      maxBodyLength?: number | undefined;
      disableProxy?: boolean | undefined;
      signal?: AbortSignal | undefined;
      responseBodyBudget?: HTTPResponseBodyBudget | undefined;
      limitRedirectResponseBody?: boolean | undefined;
      maximumResponseBytes?: number | undefined;
      /** @internal Already-validated href used only for the Axios dispatch. */
      dispatchUrl?: string | undefined;
      httpAgent?: HttpAgent | undefined; // per-request HTTP proxy agent
      httpsAgent?: HttpsAgent | undefined; // per-request HTTPS proxy agent
    },
  ): Promise<WebsiteResponse> {
    const axiosOptions: AxiosRequestConfig = {
      timeout: options.timeout || 5000,
      method: HTTPMethod.GET,
    };

    if (options.headers) {
      axiosOptions.headers = options.headers;
    }

    if (options.isHeadRequest) {
      axiosOptions.method = HTTPMethod.HEAD;
    }

    if (options.doNotFollowRedirects) {
      axiosOptions.maxRedirects = 0;
    }

    if (options.acceptRedirectResponses) {
      axiosOptions.validateStatus = (status: number): boolean => {
        return status >= 200 && status < 400;
      };
    }

    if (options.maxContentLength !== undefined) {
      axiosOptions.maxContentLength = options.maxContentLength;
    }

    if (options.maxBodyLength !== undefined) {
      axiosOptions.maxBodyLength = options.maxBodyLength;
    }

    if (options.disableProxy) {
      axiosOptions.proxy = false;
    }

    if (options.signal) {
      axiosOptions.signal = options.signal;
    }

    if (options.responseBodyBudget) {
      axiosOptions.responseType = "stream";
      /*
       * Let the shared streamed reader own this limit. Axios otherwise throws
       * before yielding the over-limit chunk, so bytes already received on a
       * failed attempt would never be charged to the cumulative budget.
       */
      axiosOptions.maxContentLength = -1;
    }

    if (options.httpAgent) {
      (axiosOptions as AxiosRequestConfig).httpAgent = options.httpAgent;
    }
    if (options.httpsAgent) {
      (axiosOptions as AxiosRequestConfig).httpsAgent = options.httpsAgent;
    }

    // use axios to fetch an HTML page
    let response: AxiosResponse | null = null;
    let responseIsForHeadRequest: boolean = Boolean(options.isHeadRequest);

    try {
      response = await axios(
        options.dispatchUrl ?? url.toString(),
        axiosOptions,
      );
    } catch (err: unknown) {
      if (
        options.responseBodyBudget &&
        axios.isAxiosError(err) &&
        err.response
      ) {
        err.response.data = HTTPResponseBodyReader.decodeUtf8(
          await HTTPResponseBodyReader.read(err.response.data, {
            budget: options.responseBodyBudget,
            statusCode: err.response.status,
            headers: err.response.headers,
            limitRedirectResponseBody:
              options.limitRedirectResponseBody || false,
            isHeadResponse: responseIsForHeadRequest,
            maximumResponseBytes: options.maximumResponseBytes,
          }),
        );
      }

      if (err && options.isHeadRequest && !options.doNotFallbackFromHead) {
        // 404 because of HEAD request. Retry with GET request.
        responseIsForHeadRequest = false;
        response = await axios(options.dispatchUrl ?? url.toString(), {
          ...axiosOptions,
          method: HTTPMethod.GET,
        });
      } else {
        throw err;
      }
    }

    if (options.responseBodyBudget) {
      response!.data = HTTPResponseBodyReader.decodeUtf8(
        await HTTPResponseBodyReader.read(response!.data, {
          budget: options.responseBodyBudget,
          statusCode: response!.status,
          headers: response!.headers,
          limitRedirectResponseBody: options.limitRedirectResponseBody || false,
          isHeadResponse: responseIsForHeadRequest,
          maximumResponseBytes: options.maximumResponseBytes,
        }),
      );
    }

    // return the response
    return {
      url: url,
      requestHeaders: options.headers || {},
      responseHeaders: response!.headers as Dictionary<string>,
      responseStatusCode: response!.status,
      responseBody: new HTML(response!.data),
      isOnline: true,
    };
  }
}
