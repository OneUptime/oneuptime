import HTTPMethod from "./API/HTTPMethod";
import Headers from "./API/Headers";
import URL from "./API/URL";
import Protocol from "./API/Protocol";
import Dictionary from "./Dictionary";
import HTML from "./Html";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

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
      proxyUrl?: URL | undefined;
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

    if (options.proxyUrl) {
      axiosOptions.proxy = {
        host: options.proxyUrl.hostname.hostname,
        port: options.proxyUrl.hostname.port?.toNumber() || 80,
        protocol: options.proxyUrl.protocol === Protocol.HTTPS ? 'https' : 'http',
      };

      // Handle auth if present in URL
      const username = options.proxyUrl.getUsername();
      const password = options.proxyUrl.getPassword();
      if (username && password) {
        axiosOptions.proxy.auth = {
          username: decodeURIComponent(username),
          password: decodeURIComponent(password),
        };
      }
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
