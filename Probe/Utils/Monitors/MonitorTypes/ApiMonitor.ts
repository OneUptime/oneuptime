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
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import RequestFailedDetails from "Common/Types/Probe/RequestFailedDetails";
import API from "Common/Utils/API";
import HttpPhaseTimings from "Common/Types/Monitor/HttpPhaseTimings";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import { HttpTimingCollector } from "../../HttpTimingAgents";
import HttpMonitorRequest, {
  HttpMonitorExecutionContext,
  PreparedHttpMonitorRequest,
  RedirectRequest,
} from "../HttpMonitorRequest";

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
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
  httpTimings?: HttpPhaseTimings | undefined;
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
      allowSelfSignedCertificates?: boolean | undefined;
      tlsClientCertificate?: string | undefined;
      tlsClientKey?: string | undefined;
      tlsClientKeyPassphrase?: string | undefined;
      attempts?: Array<ProbeAttempt> | undefined;
      executionContext?: HttpMonitorExecutionContext | undefined;
    },
  ): Promise<APIResponse | null> {
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

    const requestType: HTTPMethod = options.requestType || HTTPMethod.GET;

    const timingCollector: HttpTimingCollector = new HttpTimingCollector();

    const attemptedAt: Date = new Date();
    try {
      logger.debug(
        `API Monitor - Pinging ${options.monitorId?.toString()} ${requestType} ${url.toString()} - Retry: ${
          options.currentRetryCount
        }`,
      );

      const executeRequest: (
        initialUrl: string,
        initialMethod: HTTPMethod,
        initialHeaders: Headers,
        initialBody?: JSONObject | undefined,
      ) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> = async (
        initialUrl: string,
        initialMethod: HTTPMethod,
        initialHeaders: Headers,
        initialBody?: JSONObject | undefined,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
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

        let currentUrl: string = initialUrl;
        let currentMethod: HTTPMethod = initialMethod;
        let currentHeaders: Headers = { ...initialHeaders };
        let currentBody: JSONObject | undefined = initialBody;
        let redirectsFollowed: number = 0;
        let includeTlsIdentity: boolean = true;

        while (true) {
          const prepared: PreparedHttpMonitorRequest = await prepareRequest(
            currentUrl,
            currentHeaders,
            includeTlsIdentity,
          );

          const fetchOptions: any = {
            method: currentMethod,
            url: prepared.url,
            headers: prepared.headers,
            options: {
              dispatchUrl: prepared.dispatchUrl,
              timeout: executionContext.remainingTimeoutInMs(),
              doNotFollowRedirects: prepared.doNotFollowRedirects,
              disableProxy: prepared.disableProxy,
              maxContentLength: Math.min(
                prepared.maxContentLength,
                executionContext.responseBodyBudget.remainingBytes,
              ),
              maxBodyLength: prepared.maxBodyLength,
              httpAgent: prepared.httpAgent,
              httpsAgent: prepared.httpsAgent,
              signal: executionContext.signal,
              responseBodyBudget: executionContext.responseBodyBudget,
              limitRedirectResponseBody: !options.doNotFollowRedirects,
            },
          };

          if (currentBody) {
            fetchOptions.data = currentBody;
          }

          const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await executionContext.run(async () => {
              return await API.fetch(fetchOptions);
            });

          if (options.doNotFollowRedirects) {
            return result;
          }

          const redirect: RedirectRequest | null =
            HttpMonitorRequest.getRedirectRequest({
              currentUrl: currentUrl,
              statusCode: result.statusCode,
              responseHeaders: result.headers,
              currentMethod: currentMethod,
              requestHeaders: currentHeaders,
              requestBody: currentBody,
              redirectsFollowed: redirectsFollowed,
            });

          if (!redirect) {
            return result;
          }

          currentUrl = redirect.url;
          currentMethod = redirect.method;
          currentHeaders = redirect.headers;
          currentBody = redirect.body;
          if (redirect.crossesOrigin) {
            includeTlsIdentity = false;
          }
          redirectsFollowed++;
        }
      };

      let startTime: [number, number] = process.hrtime();
      timingCollector.reset();
      let result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await executeRequest(
          url.toString(),
          requestType,
          options.requestHeaders || {},
          options.requestBody,
        );

      if (
        result.statusCode >= 400 &&
        result.statusCode < 600 &&
        requestType === HTTPMethod.HEAD
      ) {
        /*
         * Preserve the whole-check execution context/deadline, but report
         * response time and phase timings for the GET that produced the
         * caller-visible result (the established HEAD fallback behavior).
         */
        startTime = process.hrtime();
        timingCollector.reset();
        result = await executeRequest(
          url.toString(),
          HTTPMethod.GET,
          options.requestHeaders || {},
          options.requestBody,
        );
      }

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
        responseCode: result.statusCode,
        isOnline: true,
        failureCause:
          result.statusCode >= 500 && result.statusCode < 600
            ? `Server returned ${result.statusCode}`
            : undefined,
      });

      if (result.statusCode >= 500 && result.statusCode < 600) {
        // implement retry, just to be sure server is down.
        if (!options) {
          options = {};
        }

        if (!options.currentRetryCount) {
          options.currentRetryCount = 0; // default value
        }

        if (
          options.currentRetryCount < (options.retry ?? 5) &&
          executionContext.canWait(1000)
        ) {
          options.currentRetryCount++;
          await executionContext.sleep(1000);
          return await this.ping(url, options);
        }
      }

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
        probeAttempts: options.attempts,
        totalAttempts: options.attempts!.length,
        httpTimings:
          Object.keys(httpTimings).length > 0 ? httpTimings : undefined,
      };

      logger.debug(
        `API Monitor - Pinging ${options.monitorId?.toString()} ${requestType} ${url.toString()} succeeded with status ${apiResponse.statusCode}`,
      );

      return apiResponse;
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
      options.attempts.push({
        attemptNumber: options.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: responseReceivedAt.getTime() - attemptedAt.getTime(),
        responseCode: undefined,
        isOnline: false,
        failureCause: API.getFriendlyErrorMessage(err as Error),
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

      if (
        !(err instanceof BadDataException) &&
        !(err instanceof TimeoutException) &&
        !options.isOnlineCheckRequest
      ) {
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
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };

      // check if timeout exceeded and if yes, return null
      if (
        err instanceof TimeoutException ||
        ((err as any).toString().includes("timeout") &&
          (err as any).toString().includes("exceeded"))
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
        apiResponse.failureCause =
          "Request failed with AggregateError (all connection attempts failed). " +
          apiResponse.failureCause;
        apiResponse.isOnline = false;
        return apiResponse;
      }

      /*
       * The tenant's own API refused to answer. That failure is the ANSWER
       * this check exists to produce — it is returned right below as an
       * offline response - so it must never open an Issue against OneUptime.
       */
      logger.error(
        `API Monitor - Pinging  ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${err} Response: ${JSON.stringify(
          apiResponse,
        )}`,
        EXTERNAL_FAULT,
      );

      return apiResponse;
    } finally {
      if (ownsExecutionContext) {
        executionContext.dispose();
        delete options.executionContext;
      }
    }
  }
}
