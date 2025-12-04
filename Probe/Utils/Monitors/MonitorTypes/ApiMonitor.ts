import OnlineCheck from "../../OnlineCheck";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Headers from "Common/Types/API/Headers";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import RequestFailedDetails from "Common/Types/Probe/RequestFailedDetails";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import ProxyConfig from "../../ProxyConfig";

export interface APIResponse {
  url: URL;
  requestHeaders: Headers;
  requestBody: JSONObject;
  isSecure: boolean;
  responseTimeInMS: PositiveNumber;
  statusCode: number | undefined;
  responseBody: string;
  responseHeaders: Headers;
  isOnline: boolean;
  failureCause: string;
  requestFailedDetails?: RequestFailedDetails | undefined;
  isTimeout?: boolean;
}

export default class ApiMonitor {
  public static async ping(
    url: URL,
    options: {
      requestHeaders?: Headers | undefined;
      requestBody?: JSONObject | undefined;
      requestType?: HTTPMethod | undefined;
      retry?: number | undefined;
      currentRetryCount?: number | undefined;
      monitorId?: ObjectID | undefined;
      isOnlineCheckRequest?: boolean | undefined;
      timeout?: PositiveNumber; // timeout in milliseconds
      doNotFollowRedirects?: boolean | undefined;
    },
  ): Promise<APIResponse | null> {
    if (!options) {
      options = {};
    }

    if (options?.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    const requestType: HTTPMethod = options.requestType || HTTPMethod.GET;

    try {
      logger.debug(
        `API Monitor - Pinging ${options.monitorId?.toString()} ${requestType} ${url.toString()} - Retry: ${
          options.currentRetryCount
        }`,
      );

      let startTime: [number, number] = process.hrtime();
      const fetchOptions: any = {
        method: requestType,
        url: url,
        headers: options.requestHeaders || undefined,
        options: {
          timeout: options.timeout?.toNumber() || 5000,
          doNotFollowRedirects: options.doNotFollowRedirects || false,
          ...ProxyConfig.getRequestProxyAgents(url),
        },
      };

      if (options.requestBody) {
        fetchOptions.data = options.requestBody;
      }

      let result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch(fetchOptions);

      if (
        result.statusCode >= 400 &&
        result.statusCode < 600 &&
        requestType === HTTPMethod.HEAD
      ) {
        startTime = process.hrtime();
        const fetchOptions: any = {
          method: HTTPMethod.GET,
          url: url,
          headers: options.requestHeaders || undefined,
          options: {
            timeout: options.timeout?.toNumber() || 5000,
            doNotFollowRedirects: options.doNotFollowRedirects || false,
            ...ProxyConfig.getRequestProxyAgents(url),
          },
        };

        if (options.requestBody) {
          fetchOptions.data = options.requestBody;
        }

        result = await API.fetch(fetchOptions);
      }

      if (result.statusCode >= 500 && result.statusCode < 600) {
        // implement retry, just to be sure server is down.
        if (!options) {
          options = {};
        }

        if (!options.currentRetryCount) {
          options.currentRetryCount = 0; // default value
        }

        if (options.currentRetryCount < (options.retry || 5)) {
          options.currentRetryCount++;
          await Sleep.sleep(1000);
          return await this.ping(url, options);
        }
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMS: PositiveNumber = new PositiveNumber(
        Math.ceil((endTime[0] * 1000000000 + endTime[1]) / 1000000),
      );

      // if response time is greater than 10 seconds then give it one more try

      if (
        responseTimeInMS.toNumber() > 10000 &&
        options.currentRetryCount < (options.retry || 5)
      ) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(url, options);
      }

      const apiResponse: APIResponse = {
        url: url,
        requestHeaders: options.requestHeaders || {},
        // if server is responding, it is online.
        isOnline: true,
        isSecure: url.protocol === Protocol.HTTPS,
        responseTimeInMS: responseTimeInMS,
        statusCode: result.statusCode,
        responseBody: JSON.stringify(result.data || {}),
        responseHeaders: result.headers,
        requestBody: options.requestBody || {},
        failureCause: "",
        isTimeout: false,
      };

      logger.debug(
        `API Monitor - Pinging  ${options.monitorId?.toString()} ${requestType} ${url.toString()} Success - Response: ${JSON.stringify(
          apiResponse,
        )}`,
      );

      return apiResponse;
    } catch (err: unknown) {
      if (!options) {
        options = {};
      }

      if (!options.currentRetryCount) {
        options.currentRetryCount = 0; // default value
      }

      if (options.currentRetryCount < (options.retry || 5)) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(url, options);
      }

      if (!options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `API Monitor - Probe is not online. Cannot ping  ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${err}`,
          );
          return null;
        }
      }

      // Get detailed error information
      const requestFailedDetails: RequestFailedDetails =
        API.getRequestFailedDetails(err);

      const apiResponse: APIResponse = {
        url: url,
        isOnline: false,
        requestBody: options.requestBody || {},
        requestHeaders: options.requestHeaders || {},
        isSecure: url.protocol === Protocol.HTTPS,
        responseTimeInMS: new PositiveNumber(0),
        statusCode: undefined,
        isTimeout: false,
        responseBody: "",
        responseHeaders: {},
        failureCause: API.getFriendlyErrorMessage(err as Error),
        requestFailedDetails: requestFailedDetails,
      };

      // check if timeout exceeded and if yes, return null
      if (
        (err as any).toString().includes("timeout") &&
        (err as any).toString().includes("exceeded")
      ) {
        logger.debug(
          `API Monitor - Timeout exceeded ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${err}`,
        );

        apiResponse.failureCause =
          "Request was tried " +
          options.currentRetryCount +
          " times and it timed out.";
        apiResponse.isOnline = false;
        apiResponse.isTimeout = true;
      }

      // if AggregateError is thrown, it means that the request failed
      if (
        API.getFriendlyErrorMessage(err as Error).includes("AggregateError")
      ) {
        return null;
      }

      logger.error(
        `API Monitor - Pinging  ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${err} Response: ${JSON.stringify(
          apiResponse,
        )}`,
      );

      return apiResponse;
    }
  }
}
