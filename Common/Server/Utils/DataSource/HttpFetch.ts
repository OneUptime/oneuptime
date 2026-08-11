import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import API from "../../../Utils/API";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES,
  DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
} from "../../../Types/DataSource/DataSourceLimits";
import DataSourceEgressGuard, { EgressGuardOptions } from "./EgressGuard";
import { DataSourceConnectionSettings } from "./Types";

/*
 * SSRF-hardened HTTP client for HTTP-based Data Source connectors
 * (Prometheus, Loki, Elasticsearch, REST API).
 *
 * Every request:
 *  - validates the URL through DataSourceEgressGuard and PINS the resolved,
 *    validated addresses into the socket lookup — the address that was
 *    checked is the address that gets dialed, closing the DNS-rebind
 *    window while TLS still verifies against the original hostname;
 *  - refuses redirects (maxRedirects: 0) — a 3xx from the target could
 *    otherwise bounce the request to an unvalidated host;
 *  - caps response size and wall-clock time.
 *
 * Uses axios directly (not Common/Utils/API.fetch) because the shared
 * wrapper does not expose maxContentLength, and the response-size cap is a
 * hard requirement here.
 */

export interface DataSourceHttpRequest {
  method: "GET" | "POST";
  url: string;
  headers?: Dictionary<string> | undefined;
  /*
   * POST body. Strings are sent as-is; objects are JSON-encoded unless
   * formUrlEncoded is set (Prometheus' query endpoints take form bodies).
   */
  body?: string | Dictionary<string> | undefined;
  formUrlEncoded?: boolean | undefined;
  timeoutInMs?: number | undefined;
  // Test seam — forwarded to the egress guard.
  egressOptions?: EgressGuardOptions | undefined;
}

export interface DataSourceHttpResponse {
  statusCode: number;
  bodyText: string;
  // Parsed JSON body, or undefined when the body is not valid JSON.
  bodyJson: unknown;
}

export default class DataSourceHttpFetch {
  /*
   * Standard auth headers for a data source: Bearer token wins, else HTTP
   * basic from username/password; custom headers are applied last so an
   * explicit Authorization header in customHeaders takes precedence.
   */
  public static buildAuthHeaders(
    settings: DataSourceConnectionSettings,
  ): Dictionary<string> {
    const headers: Dictionary<string> = {};

    if (settings.apiToken) {
      headers["Authorization"] = `Bearer ${settings.apiToken}`;
    } else if (settings.username || settings.password) {
      const encoded: string = Buffer.from(
        `${settings.username || ""}:${settings.password || ""}`,
      ).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
    }

    if (settings.customHeaders) {
      for (const key of Object.keys(settings.customHeaders)) {
        headers[key] = settings.customHeaders[key] as string;
      }
    }

    return headers;
  }

  public static async fetch(
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> {
    /*
     * Pin the validated addresses: whatever getaddrinfo said at validation
     * time is what the socket dials, even if DNS answers differently a
     * millisecond later.
     */
    const { url, httpAgent, httpsAgent } =
      await DataSourceEgressGuard.assertUrlAllowedAndPin(
        request.url,
        request.egressOptions,
      );

    const headers: Dictionary<string> = { ...(request.headers || {}) };

    let data: string | URLSearchParams | undefined = undefined;
    if (request.method === "POST" && request.body !== undefined) {
      if (typeof request.body === "string") {
        data = request.body;
        if (!headers["Content-Type"]) {
          headers["Content-Type"] = "application/json";
        }
      } else if (request.formUrlEncoded) {
        data = new URLSearchParams(request.body);
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      } else {
        data = JSON.stringify(request.body);
        headers["Content-Type"] = "application/json";
      }
    }

    const axiosOptions: AxiosRequestConfig = {
      method: request.method,
      url: url.toString(),
      headers: headers,
      data: data,
      timeout: request.timeoutInMs || DATA_SOURCE_QUERY_TIMEOUT_IN_MS,
      maxRedirects: 0,
      maxContentLength: DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES,
      maxBodyLength: DATA_SOURCE_MAX_RESPONSE_SIZE_IN_BYTES,
      /*
       * Keep the raw body so connectors can produce useful errors for
       * non-JSON responses; status handling is ours, not axios'.
       */
      responseType: "text",
      transformResponse: [
        (body: string): string => {
          return body;
        },
      ],
      validateStatus: (status: number): boolean => {
        // 3xx must throw — redirects are refused by policy, not followed.
        return status < 300;
      },
      httpAgent: httpAgent,
      httpsAgent: httpsAgent,
    };

    try {
      const response: AxiosResponse<string> = await axios(axiosOptions);
      const bodyText: string = response.data || "";

      let bodyJson: unknown = undefined;
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        bodyJson = undefined;
      }

      return {
        statusCode: response.status,
        bodyText: bodyText,
        bodyJson: bodyJson,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response) {
        /*
         * The server answered with an error status. Surface status + a
         * trimmed body excerpt — Prometheus/Elasticsearch put the real
         * reason ("parse error at char 5") in the body.
         */
        const responseBody: string =
          typeof error.response.data === "string"
            ? error.response.data
            : JSON.stringify(error.response.data ?? "");
        throw new BadDataException(
          `Data source responded with HTTP ${error.response.status}: ${responseBody.substring(0, 500)}`,
        );
      }

      throw new BadDataException(
        `Could not reach data source: ${API.getFriendlyErrorMessage(
          error as Error,
        )}`,
      );
    } finally {
      httpAgent.destroy();
      httpsAgent.destroy();
    }
  }
}
