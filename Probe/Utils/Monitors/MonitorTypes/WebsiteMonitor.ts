import OnlineCheck from "../../OnlineCheck";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import Headers from "Common/Types/API/Headers";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import HTML from "Common/Types/Html";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import RequestFailedDetails from "Common/Types/Probe/RequestFailedDetails";
import WebsiteRequest, { WebsiteResponse } from "Common/Types/WebsiteRequest";
import HttpPhaseTimings from "Common/Types/Monitor/HttpPhaseTimings";
import API from "Common/Utils/API";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import { AxiosError } from "axios";
import BadDataException from "Common/Types/Exception/BadDataException";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import { HttpTimingCollector } from "../../HttpTimingAgents";
import HttpMonitorRequest, {
  HttpMonitorExecutionContext,
  PreparedHttpMonitorRequest,
  RedirectRequest,
} from "../HttpMonitorRequest";

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
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
  httpTimings?: HttpPhaseTimings | undefined;
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
      allowSelfSignedCertificates?: boolean | undefined;
      tlsClientCertificate?: string | undefined;
      tlsClientKey?: string | undefined;
      tlsClientKeyPassphrase?: string | undefined;
      attempts?: Array<ProbeAttempt> | undefined;
      executionContext?: HttpMonitorExecutionContext | undefined;
    },
  ): Promise<ProbeWebsiteResponse | null> {
    if (!options) {
      options = {};
    }

    if (options?.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    if (!options.attempts) {
      options.attempts = [];
    }

    const ownsExecutionContext: boolean = !options.executionContext;
    if (!options.executionContext) {
      options.executionContext = new HttpMonitorExecutionContext(
        options.timeout?.toNumber() || 5000,
      );
    }
    const executionContext: HttpMonitorExecutionContext =
      options.executionContext;

    let requestType: HTTPMethod = HTTPMethod.GET;

    if (options.isHeadRequest) {
      requestType = HTTPMethod.HEAD;
    }

    const timingCollector: HttpTimingCollector = new HttpTimingCollector();

    const attemptedAt: Date = new Date();
    try {
      logger.debug(
        `Website Monitor - Pinging ${options.monitorId?.toString()} ${requestType} ${url.toString()} - Retry: ${
          options.currentRetryCount
        }`,
      );

      const executeRequest: (
        initialUrl: string,
        initialMethod: HTTPMethod,
      ) => Promise<WebsiteResponse> = async (
        initialUrl: string,
        initialMethod: HTTPMethod,
      ): Promise<WebsiteResponse> => {
        const prepareRequest: (
          requestUrl: string,
          requestHeaders: Headers,
          includeTlsIdentity: boolean,
        ) => Promise<PreparedHttpMonitorRequest> = async (
          requestUrl: string,
          requestHeaders: Headers,
          includeTlsIdentity: boolean,
        ): Promise<PreparedHttpMonitorRequest> => {
          return await executionContext.run(async () => {
            return await HttpMonitorRequest.prepare(requestUrl, {
              headers: requestHeaders,
              tls: includeTlsIdentity
                ? {
                    allowSelfSignedCertificates:
                      options.allowSelfSignedCertificates,
                    tlsClientCertificate: options.tlsClientCertificate,
                    tlsClientKey: options.tlsClientKey,
                    tlsClientKeyPassphrase: options.tlsClientKeyPassphrase,
                  }
                : undefined,
              timingCollector: timingCollector,
            });
          });
        };

        const fetchRequest: (
          preparedRequest: PreparedHttpMonitorRequest,
          method: HTTPMethod,
        ) => Promise<WebsiteResponse> = async (
          preparedRequest: PreparedHttpMonitorRequest,
          method: HTTPMethod,
        ): Promise<WebsiteResponse> => {
          return await executionContext.run(async () => {
            return await WebsiteRequest.fetch(preparedRequest.url, {
              dispatchUrl: preparedRequest.dispatchUrl,
              headers: preparedRequest.headers,
              isHeadRequest: method === HTTPMethod.HEAD,
              timeout: executionContext.remainingTimeoutInMs(),
              doNotFollowRedirects: preparedRequest.doNotFollowRedirects,
              doNotFallbackFromHead: true,
              acceptRedirectResponses: true,
              disableProxy: preparedRequest.disableProxy,
              maxContentLength: Math.min(
                preparedRequest.maxContentLength,
                executionContext.responseBodyBudget.remainingBytes,
              ),
              maxBodyLength: preparedRequest.maxBodyLength,
              httpAgent: preparedRequest.httpAgent,
              httpsAgent: preparedRequest.httpsAgent,
              signal: executionContext.signal,
              responseBodyBudget: executionContext.responseBodyBudget,
              limitRedirectResponseBody: !options.doNotFollowRedirects,
            });
          });
        };

        let currentUrl: string = initialUrl;
        let currentMethod: HTTPMethod = initialMethod;
        let currentHeaders: Headers = {};
        let redirectsFollowed: number = 0;
        let includeTlsIdentity: boolean = true;

        while (true) {
          const prepared: PreparedHttpMonitorRequest = await prepareRequest(
            currentUrl,
            currentHeaders,
            includeTlsIdentity,
          );

          let result: WebsiteResponse;
          try {
            result = await fetchRequest(prepared, currentMethod);
          } catch (error) {
            /*
             * Some servers reject HEAD but serve GET. Re-entering the loop
             * deliberately prepares a fresh, validated/pinned connection for
             * the fallback instead of reusing an agent behind the guard.
             */
            if (currentMethod === HTTPMethod.HEAD) {
              currentMethod = HTTPMethod.GET;
              continue;
            }
            throw error;
          }

          if (options.doNotFollowRedirects) {
            return result;
          }

          const redirect: RedirectRequest | null =
            HttpMonitorRequest.getRedirectRequest({
              currentUrl: currentUrl,
              statusCode: result.responseStatusCode,
              responseHeaders: result.responseHeaders,
              currentMethod: currentMethod,
              requestHeaders: currentHeaders,
              redirectsFollowed: redirectsFollowed,
            });

          if (!redirect) {
            return result;
          }

          currentUrl = redirect.url;
          currentMethod = redirect.method;
          currentHeaders = redirect.headers;
          if (redirect.crossesOrigin) {
            includeTlsIdentity = false;
          }
          redirectsFollowed++;
        }
      };

      const startTime: [number, number] = process.hrtime();
      timingCollector.reset();
      const result: WebsiteResponse = await executeRequest(
        url.toString(),
        requestType,
      );

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMS: PositiveNumber = new PositiveNumber(
        Math.ceil((endTime[0] * 1000000000 + endTime[1]) / 1000000),
      );
      const responseReceivedAt: Date = new Date();

      options.attempts!.push({
        attemptNumber: options.currentRetryCount,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: responseTimeInMS.toNumber(),
        responseCode: result.responseStatusCode,
        isOnline: true,
      });

      // if response time is greater than 10 seconds then give it one more try

      if (
        responseTimeInMS.toNumber() > 10000 &&
        options.currentRetryCount < (options.retry ?? 5) &&
        executionContext.canWait(1000)
      ) {
        options.currentRetryCount++;
        await executionContext.sleep(1000);
        return await this.ping(url, options);
      }

      const httpTimings: HttpPhaseTimings = timingCollector.getTimings(
        responseTimeInMS.toNumber(),
      );

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
        probeAttempts: options.attempts,
        totalAttempts: options.attempts!.length,
        httpTimings:
          Object.keys(httpTimings).length > 0 ? httpTimings : undefined,
      };

      logger.debug(
        `Website Monitor - Pinging ${options.monitorId?.toString()} ${requestType} ${url.toString()} succeeded with status ${probeWebsiteResponse.statusCode}`,
      );

      return probeWebsiteResponse;
    } catch (err: unknown) {
      if (!options) {
        options = {};
      }

      if (!options.currentRetryCount) {
        options.currentRetryCount = 0; // default value
      }

      if (!options.attempts) {
        options.attempts = [];
      }

      const responseReceivedAt: Date = new Date();
      const failureCauseForAttempt: string = API.getFriendlyErrorMessage(
        err as Error,
      );
      const statusCodeForAttempt: number | undefined =
        err instanceof AxiosError ? err.response?.status : undefined;

      options.attempts.push({
        attemptNumber: options.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: responseReceivedAt.getTime() - attemptedAt.getTime(),
        responseCode: statusCodeForAttempt,
        isOnline: false,
        failureCause: failureCauseForAttempt,
      });

      if (
        !(err instanceof BadDataException) &&
        !(err instanceof TimeoutException) &&
        options.currentRetryCount < (options.retry ?? 5) &&
        executionContext.canWait(1000)
      ) {
        options.currentRetryCount++;
        await executionContext.sleep(1000);
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
          probeAttempts: options.attempts,
          totalAttempts: options.attempts.length,
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
          probeAttempts: options.attempts,
          totalAttempts: options.attempts.length,
        };
      }

      if (
        !(err instanceof BadDataException) &&
        !(err instanceof TimeoutException) &&
        !options.isOnlineCheckRequest
      ) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `Website Monitor - Probe is not online. Cannot ping ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${err}`,
          );
          return null;
        }
      }

      // check if timeout exceeded and if yes, return null
      if (
        err instanceof TimeoutException ||
        ((err as any).toString().includes("timeout") &&
          (err as any).toString().includes("exceeded"))
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
        probeWebsiteResponse.failureCause =
          "Request failed with AggregateError (all connection attempts failed). " +
          probeWebsiteResponse.failureCause;
        probeWebsiteResponse.isOnline = false;
        return probeWebsiteResponse;
      }

      /*
       * The tenant's own URL refused to answer. That failure is the ANSWER
       * this check exists to produce — it is returned right below as an
       * offline response - so it must never open an Issue against OneUptime.
       */
      logger.error(
        `Website Monitor - Pinging ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${err} Response: ${JSON.stringify(
          probeWebsiteResponse,
        )}`,
        EXTERNAL_FAULT,
      );

      return probeWebsiteResponse;
    } finally {
      if (ownsExecutionContext) {
        executionContext.dispose();
        delete options.executionContext;
      }
    }
  }
}
