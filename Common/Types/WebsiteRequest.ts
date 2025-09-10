import HTTPMethod from "./API/HTTPMethod";
import Headers from "./API/Headers";
import URL from "./API/URL";
import Dictionary from "./Dictionary";
import HTML from "./Html";
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

    if (options.httpAgent) {
      (axiosOptions as AxiosRequestConfig).httpAgent = options.httpAgent;
    }
    if (options.httpsAgent) {
      (axiosOptions as AxiosRequestConfig).httpsAgent = options.httpsAgent;
    }

    // use axios to fetch an HTML page
    let response: AxiosResponse | null = null;

    try {
      response = await axios(url.toString(), axiosOptions);
    } catch (err: unknown) {
      if (err && options.isHeadRequest) {
        // 404 because of HEAD request. Retry with GET request.
        response = await axios(url.toString(), {
          ...axiosOptions,
          method: HTTPMethod.GET,
        });
      } else {
        throw err;
      }
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
