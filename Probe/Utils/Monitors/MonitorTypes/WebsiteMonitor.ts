import OnlineCheck from "../../OnlineCheck";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import Headers from "Common/Types/API/Headers";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import HTML from "Common/Types/Html";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import RequestFailedDetails from "Common/Types/Probe/RequestFailedDetails";
import Sleep from "Common/Types/Sleep";
import WebsiteRequest, { WebsiteResponse } from "Common/Types/WebsiteRequest";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import { AxiosError } from "axios";
import ProxyConfig from "../../ProxyConfig";

export interface ProbeWebsiteResponse {
  url: URL;
  requestHeaders: Headers;
  isSecure: boolean;
  responseTimeInMS: PositiveNumber;
  statusCode: number | undefined;
  responseBody: HTML | string | undefined;
  responseHeaders: Headers | undefined;
  isOnline: boolean;
  failureCause: string;
  requestFailedDetails?: RequestFailedDetails | undefined;
  isTimeout?: boolean;
}

export default class WebsiteMonitor {
  public static async ping(
    url: URL,
    options: {
      retry?: number | undefined;
      isHeadRequest?: boolean | undefined;
      currentRetryCount?: number | undefined;
      monitorId?: ObjectID | undefined;
      isOnlineCheckRequest?: boolean | undefined;
      timeout?: PositiveNumber; // timeout in milliseconds
      doNotFollowRedirects?: boolean | undefined;
    },
  ): Promise<ProbeWebsiteResponse | null> {
    if (!options) {
      options = {};
    }

    if (options?.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    let requestType: HTTPMethod = HTTPMethod.GET;

    if (options.isHeadRequest) {
      requestType = HTTPMethod.HEAD;
    }

    try {
      logger.debug(
        `Website Monitor - Pinging ${options.monitorId?.toString()} ${requestType} ${url.toString()} - Retry: ${
          options.currentRetryCount
        }`,
      );

      let startTime: [number, number] = process.hrtime();
      let result: WebsiteResponse = await WebsiteRequest.fetch(url, {
        isHeadRequest: options.isHeadRequest,
        timeout: options.timeout?.toNumber() || 5000,
        doNotFollowRedirects: options.doNotFollowRedirects || false,
        ...ProxyConfig.getRequestProxyAgents(url),
      });

      if (
        result.responseStatusCode >= 400 &&
        result.responseStatusCode < 600 &&
        requestType === HTTPMethod.HEAD
      ) {
        startTime = process.hrtime();
        result = await WebsiteRequest.fetch(url, {
          isHeadRequest: false,
          timeout: options.timeout?.toNumber() || 5000,
          doNotFollowRedirects: options.doNotFollowRedirects || false,
          ...ProxyConfig.getRequestProxyAgents(url),
        });
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

      const probeWebsiteResponse: ProbeWebsiteResponse = {
        url: url,
        requestHeaders: {},
        isOnline: true,
        isSecure: url.protocol === Protocol.HTTPS,
        responseTimeInMS: responseTimeInMS,
        statusCode: result.responseStatusCode,
        responseBody: result.responseBody,
        responseHeaders: result.responseHeaders,
        failureCause: "",
        isTimeout: false,
      };

      logger.debug(
        `Website Monitor - Pinging ${options.monitorId?.toString()} ${requestType} ${url.toString()} Success - Response: ${JSON.stringify(
          probeWebsiteResponse,
        )}`,
      );

      return probeWebsiteResponse;
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

      let probeWebsiteResponse: ProbeWebsiteResponse | undefined = undefined;

      let responsebody: string | undefined = undefined;
      if ((err as any)?.response?.data) {
        responsebody = (err as any).response.data;
      }

      if (typeof responsebody === "object") {
        responsebody = JSON.stringify(responsebody);
      }

      // Get detailed error information
      const requestFailedDetails: RequestFailedDetails =
        API.getRequestFailedDetails(err);

      if (err instanceof AxiosError) {
        probeWebsiteResponse = {
          url: url,
          isOnline: Boolean(err.response),
          requestHeaders: {},
          isSecure: url.protocol === Protocol.HTTPS,
          responseTimeInMS: new PositiveNumber(0),
          statusCode: err.response?.status,
          responseBody: responsebody,
          isTimeout: false,
          responseHeaders: (err.response?.headers as Headers) || {},
          failureCause: API.getFriendlyErrorMessage(err),
          requestFailedDetails: requestFailedDetails,
        };
      } else {
        probeWebsiteResponse = {
          url: url,
          isOnline: false,

          requestHeaders: {},
          isSecure: url.protocol === Protocol.HTTPS,
          responseTimeInMS: new PositiveNumber(0),
          statusCode: (err as any)?.response?.status,
          responseBody: responsebody,
          responseHeaders: ((err as any)?.response?.headers as Headers) || {},
          isTimeout: false,
          failureCause: API.getFriendlyErrorMessage(err as Error),
          requestFailedDetails: requestFailedDetails,
        };
      }

      if (!options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `Website Monitor - Probe is not online. Cannot ping ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${err}`,
          );
          return null;
        }
      }

      // check if timeout exceeded and if yes, return null
      if (
        (err as any).toString().includes("timeout") &&
        (err as any).toString().includes("exceeded")
      ) {
        logger.debug(
          `Website Monitor - Timeout exceeded ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${err}`,
        );

        probeWebsiteResponse.failureCause =
          "Request was tried " +
          options.currentRetryCount +
          " times and it timed out.";
        probeWebsiteResponse.isOnline = false;
        probeWebsiteResponse.isTimeout = true;

        return probeWebsiteResponse;
      }

      // if AggregateError is thrown, it means that the request failed
      if (
        API.getFriendlyErrorMessage(err as Error).includes("AggregateError")
      ) {
        return null;
      }

      logger.error(
        `Website Monitor - Pinging ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${err} Response: ${JSON.stringify(
          probeWebsiteResponse,
        )}`,
      );

      return probeWebsiteResponse;
    }
  }
}
