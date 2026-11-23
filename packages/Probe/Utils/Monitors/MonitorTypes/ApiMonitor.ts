import OnlineCheck from "../../OnlineCheck";
import MonitorRetry from "../MonitorRetry";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Headers from "Common/Types/API/Headers";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Sleep from "Common/Types/Sleep";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import RequestFailedDetails from "Common/Types/Probe/RequestFailedDetails";
import API, { APIRequestBody } from "Common/Utils/API";
import MonitorRequestBody, {
  MonitorRequestBodyReading,
} from "Common/Utils/Monitor/MonitorRequestBody";
import RequestFailedDetailsUtil from "Common/Utils/RequestFailedDetailsUtil";
import HttpPhaseTimings from "Common/Types/Monitor/HttpPhaseTimings";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import TotpCodeIssuer from "Common/Utils/Monitor/MonitorSecretTotp";
import EgressGuardException from "Common/Types/Exception/EgressGuardException";
import TimeoutException from "Common/Types/Exception/TimeoutException";
import { HttpTimingCollector } from "../../HttpTimingAgents";
import HttpMonitorRequest, {
  HttpMonitorExecutionContext,
  PreparedHttpMonitorRequest,
  RedirectRequest,
} from "../HttpMonitorRequest";
import CertificateRevocationChecker from "../CertificateRevocation/CertificateRevocationChecker";
import { TlsPeerCertificateRecorder } from "../CertificateRevocation/TlsPeerCertificates";
import { writeProbeTimeoutFailureCause } from "Common/Utils/Monitor/ProbeFailureReading";
import {
  ProbeFailureCause,
  writeProbeFailureCause,
} from "Common/Utils/Monitor/ProbeFailureCauses";

// Five attempts, the same as before retries were counted after the first attempt.
const DEFAULT_RETRIES_WHEN_UNSET: number = 4;

export interface APIResponse {
  url: URL;
  requestHeaders: Headers;
  // The body as configured, before its one-time codes are filled in.
  requestBody?: string | undefined;
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

// What one attempt sends: the configured request, its one-time codes filled in.
interface ApiMonitorRequest {
  url: string;
  headers: Headers;
  // JSON text, as written (MonitorRequestBody).
  body: string | undefined;
}

// What one attempt sends as its body, or where its body stops being JSON.
type ApiMonitorBody =
  | { canSend: true; data: APIRequestBody | undefined }
  | { canSend: false; line: number | null; column: number | null };

export default class ApiMonitor {
  /*
   * The request of one attempt. The {{monitorSecrets.NAME}} of a one-time
   * code (TOTP) secret in the URL, a header or the body is filled in here,
   * at the moment the attempt is sent - all at one moment, and never with a
   * code about to expire (TotpCodeIssuer).
   */
  private static async getRequest(
    url: URL,
    options: {
      requestHeaders?: Headers | undefined;
      requestBody?: string | undefined;
      totpCodes?: TotpCodeIssuer | undefined;
    },
  ): Promise<ApiMonitorRequest> {
    const configured: ApiMonitorRequest = {
      url: url.toString(),
      headers: options.requestHeaders || {},
      body: options.requestBody,
    };

    if (!options.totpCodes || !options.totpCodes.hasSecrets()) {
      return configured;
    }

    return await options.totpCodes.fill(configured);
  }

  /*
   * What an attempt's request carries as its body, its one-time codes
   * filled in (#9737): the JSON as written, byte for byte, under the
   * request's Content-Type - or, when that Content-Type is a form, an
   * object's fields, as such a body has always been sent. A body that is
   * not JSON cannot be sent at all (MonitorRequestBody).
   */
  private static getBody(request: ApiMonitorRequest): ApiMonitorBody {
    const text: string | undefined = MonitorRequestBody.getText(request.body);

    if (text === undefined) {
      return { canSend: true, data: undefined };
    }

    const reading: MonitorRequestBodyReading = MonitorRequestBody.read(text);

    if (!reading.isJson) {
      return { canSend: false, line: reading.line, column: reading.column };
    }

    if (
      MonitorRequestBody.isObject(reading.value) &&
      MonitorRequestBody.isSentAsForm(request.headers)
    ) {
      return { canSend: true, data: reading.value as JSONObject };
    }

    return { canSend: true, data: Buffer.from(reading.json, "utf8") };
  }

  /*
   * The result of an attempt whose body is not JSON: nothing was sent, so
   * nothing answered, and it is not tried again - every retry would send
   * the same body. Its cause says so, in the reader's language on the
   * monitor's summary (ProbeFailureCause.RequestBodyNotJson). The log says
   * where the body stops being JSON, never what it holds: the server has
   * filled the monitor's secrets into it.
   */
  private static getBodyNotSentResponse(data: {
    url: URL;
    requestType: HTTPMethod;
    body: { line: number | null; column: number | null };
    options: {
      requestHeaders?: Headers | undefined;
      requestBody?: string | undefined;
      currentRetryCount?: number | undefined;
      monitorId?: ObjectID | undefined;
      attempts?: Array<ProbeAttempt> | undefined;
    };
  }): APIResponse {
    const failureCause: string = writeProbeFailureCause(
      ProbeFailureCause.RequestBodyNotJson,
    );
    const attempts: Array<ProbeAttempt> = data.options.attempts || [];
    const at: Date = new Date();

    attempts.push({
      attemptNumber: data.options.currentRetryCount || 1,
      attemptedAt: at,
      responseReceivedAt: at,
      responseTimeInMs: 0,
      responseCode: undefined,
      isOnline: false,
      failureCause: failureCause,
    });

    const position: string =
      data.body.line !== null && data.body.column !== null
        ? ` at line ${data.body.line}, column ${data.body.column}`
        : "";

    // The monitor's own configuration, not a fault of OneUptime's.
    logger.error(
      `API Monitor - ${data.options.monitorId?.toString()} ${data.requestType} ${data.url.toString()}: the request body is not valid JSON${position}, so the request was not sent.`,
      EXTERNAL_FAULT,
    );

    return {
      url: data.url,
      isOnline: false,
      isTimeout: false,
      requestBody: data.options.requestBody,
      requestHeaders: data.options.requestHeaders || {},
      isSecure: data.url.protocol === Protocol.HTTPS,
      responseTimeInMS: new PositiveNumber(0),
      statusCode: undefined,
      responseBody: "",
      responseHeaders: {},
      failureCause: failureCause,
      probeAttempts: attempts,
      totalAttempts: attempts.length,
    };
  }

  public static async ping(
    url: URL,
    options: {
      requestHeaders?: Headers | undefined;
      /*
       * The body: JSON text as written - an object, an array or a single
       * value (MonitorRequestBody). Sent byte for byte, or as a form's
       * fields when the request's Content-Type is a form and the body an
       * object.
       */
      requestBody?: string | undefined;
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
      /*
       * The check's one-time codes (issue #9703). Each attempt fills the
       * {{monitorSecrets.NAME}} of a TOTP secret in its URL, headers and
       * body just before it is sent - a retry gets a fresh code - and every
       * code is taken out of what the check reports and logs. The URL,
       * headers and body as configured stay what is reported.
       */
      totpCodes?: TotpCodeIssuer | undefined;
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

    // Before the attempt's clock starts: a wait for a fresh code is not its time.
    const request: ApiMonitorRequest = await ApiMonitor.getRequest(
      url,
      options,
    );
    const totpCodes: TotpCodeIssuer | undefined = options.totpCodes;
    const redact: <T>(value: T) => T = <T>(value: T): T => {
      return totpCodes ? totpCodes.redact(value) : value;
    };

    const requestType: HTTPMethod = options.requestType || HTTPMethod.GET;

    const body: ApiMonitorBody = ApiMonitor.getBody(request);

    if (!body.canSend) {
      return ApiMonitor.getBodyNotSentResponse({
        url: url,
        requestType: requestType,
        body: body,
        options: options,
      });
    }

    const ownsExecutionContext: boolean = !options.executionContext;
    if (!options.executionContext) {
      options.executionContext = new HttpMonitorExecutionContext(
        options.timeout?.toNumber() || 5000,
      );
    }
    const executionContext: HttpMonitorExecutionContext =
      options.executionContext;

    const timingCollector: HttpTimingCollector = new HttpTimingCollector();

    /*
     * The TLS certificates of every hop that answered, checked for
     * revocation once the response time has been taken.
     */
    const answeredHops: Array<{
      url: string;
      peerCertificates?: TlsPeerCertificateRecorder | undefined;
    }> = [];
    const checkCertificateRevocation: boolean =
      CertificateRevocationChecker.isEnabled();

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
        initialBody?: APIRequestBody | undefined,
      ) => Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> = async (
        initialUrl: string,
        initialMethod: HTTPMethod,
        initialHeaders: Headers,
        initialBody?: APIRequestBody | undefined,
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const prepareRequest: (
          requestUrl: string,
          requestHeaders: Headers,
          includeTlsClientIdentity: boolean,
        ) => Promise<PreparedHttpMonitorRequest> = async (
          requestUrl: string,
          requestHeaders: Headers,
          includeTlsClientIdentity: boolean,
        ): Promise<PreparedHttpMonitorRequest> => {
          return await executionContext.run(async () => {
            return await HttpMonitorRequest.prepare(requestUrl, {
              headers: requestHeaders,
              tls: HttpMonitorRequest.getTlsOptionsForHop({
                tls: {
                  allowSelfSignedCertificates:
                    options.allowSelfSignedCertificates,
                  tlsClientCertificate: options.tlsClientCertificate,
                  tlsClientKey: options.tlsClientKey,
                  tlsClientKeyPassphrase: options.tlsClientKeyPassphrase,
                },
                monitorUrl: initialUrl,
                hopUrl: requestUrl,
                includeClientIdentity: includeTlsClientIdentity,
              }),
              timingCollector: timingCollector,
              recordPeerCertificates: checkCertificateRevocation,
            });
          });
        };

        let currentUrl: string = initialUrl;
        let currentMethod: HTTPMethod = initialMethod;
        let currentHeaders: Headers = { ...initialHeaders };
        let currentBody: APIRequestBody | undefined = initialBody;
        let redirectsFollowed: number = 0;
        let includeTlsClientIdentity: boolean = true;

        while (true) {
          const prepared: PreparedHttpMonitorRequest = await prepareRequest(
            currentUrl,
            currentHeaders,
            includeTlsClientIdentity,
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

          if (currentBody !== undefined) {
            fetchOptions.data = currentBody;
          }

          const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await executionContext.run(async () => {
              return await API.fetch(fetchOptions);
            });

          answeredHops.push({
            url: currentUrl,
            peerCertificates: prepared.peerCertificates,
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
            /*
             * Only the client certificate stops here; the self-signed
             * allowance follows the monitor's hostname. See
             * HttpMonitorRequest.getTlsOptionsForHop.
             */
            includeTlsClientIdentity = false;
          }
          redirectsFollowed++;
        }
      };

      let startTime: [number, number] = process.hrtime();
      timingCollector.reset();
      let result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await executeRequest(
          request.url,
          requestType,
          request.headers,
          body.data,
        );

      if (
        result.statusCode >= 400 &&
        result.statusCode < 600 &&
        requestType === HTTPMethod.HEAD
      ) {
        /*
         * Preserve this attempt's execution context/deadline, but report
         * response time and phase timings for the GET that produced the
         * caller-visible result (the established HEAD fallback behavior).
         */
        startTime = process.hrtime();
        timingCollector.reset();
        result = await executeRequest(
          request.url,
          HTTPMethod.GET,
          request.headers,
          body.data,
        );
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMS: PositiveNumber = new PositiveNumber(
        Math.ceil((endTime[0] * 1000000000 + endTime[1]) / 1000000),
      );

      /*
       * A revoked certificate fails the check like an expired one, which
       * Node rejects on its own. Throws CertificateRevokedError into the
       * catch below; asked after the response time is taken.
       */
      await HttpMonitorRequest.assertCertificatesNotRevoked({
        hops: answeredHops,
        remainingTimeInMs: executionContext.remainingTimeInMsOrZero(),
      });

      const responseReceivedAt: Date = new Date();

      options.attempts!.push({
        attemptNumber: options.currentRetryCount,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: responseTimeInMS.toNumber(),
        responseCode: result.statusCode,
        isOnline: true,
        failureCause:
          result.statusCode >= 400 && result.statusCode < 600
            ? writeProbeFailureCause(ProbeFailureCause.ServerReturned, {
                status: result.statusCode,
              })
            : undefined,
      });

      if (result.statusCode >= 400 && result.statusCode < 600) {
        if (!options) {
          options = {};
        }

        if (!options.currentRetryCount) {
          options.currentRetryCount = 0; // default value
        }

        if (
          MonitorRetry.canRetry({
            attemptNumber: options.currentRetryCount,
            retries: options.retry,
            defaultRetries: DEFAULT_RETRIES_WHEN_UNSET,
          })
        ) {
          options.currentRetryCount++;
          executionContext.dispose();
          delete options.executionContext;
          await Sleep.sleep(1000);
          return await this.ping(url, options);
        }
      }

      // if response time is greater than 10 seconds then give it one more try

      if (
        responseTimeInMS.toNumber() > 10000 &&
        MonitorRetry.canRetry({
          attemptNumber: options.currentRetryCount,
          retries: options.retry,
          defaultRetries: DEFAULT_RETRIES_WHEN_UNSET,
        })
      ) {
        options.currentRetryCount++;
        executionContext.dispose();
        delete options.executionContext;
        await Sleep.sleep(1000);
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
        // A response that repeats a code it was sent never reports it.
        responseBody: redact(JSON.stringify(result.data || {})),
        responseHeaders: redact(result.headers),
        requestBody: options.requestBody,
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
      /*
       * A sanitized guard refusal must not report how long it took. The two
       * branches it merges do measurably different amounts of work — a DNS
       * failure is retried inside the guard, an address-policy rejection
       * follows one successful lookup — and this number is shipped to the
       * tenant on probeAttempts. Reporting it would hand back, as a plain
       * integer, exactly the "did this hostname resolve?" bit the merged
       * message exists to withhold. Zero matches the top-level
       * responseTimeInMS these same paths already report for the same reason.
       *
       * This closes the REPORTED channel only. A determined tenant can still
       * time checks externally, as they could before any of this; equalizing
       * that would mean padding every refusal out to the full DNS budget.
       */
      const isSanitizedGuardRefusal: boolean =
        err instanceof EgressGuardException && err.isTargetUnreachable();

      /*
       * A request that failed on the probe itself (no usable IPv6, say) is
       * worded as such. A bare "connect EADDRNOTAVAIL ..." reads as the API
       * being down, and it goes on to be the incident's root cause.
       */
      const failureCause: string = redact(
        RequestFailedDetailsUtil.getProbeNetworkFailureDescription(err) ||
          API.getFriendlyErrorMessage(err as Error),
      );
      // Said in the logs below; a code the request carried is taken out.
      const errorText: string = redact(String(err));

      options.attempts.push({
        attemptNumber: options.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: isSanitizedGuardRefusal
          ? 0
          : responseReceivedAt.getTime() - attemptedAt.getTime(),
        responseCode: undefined,
        isOnline: false,
        failureCause: failureCause,
      });

      if (
        !(err instanceof BadDataException) &&
        MonitorRetry.canRetry({
          attemptNumber: options.currentRetryCount,
          retries: options.retry,
          defaultRetries: DEFAULT_RETRIES_WHEN_UNSET,
        })
      ) {
        options.currentRetryCount++;
        executionContext.dispose();
        delete options.executionContext;
        await Sleep.sleep(1000);
        return await this.ping(url, options);
      }

      /*
       * A guard refusal that is about REACHING the target (DNS, or an address
       * policy) is a network failure like any other, so it gets the same
       * probe-health sanity check every other network failure gets: a probe
       * whose own resolver has died must not be believed when it reports that
       * a monitor is down. Only a structurally invalid target skips the check,
       * because that is the tenant's configuration and has to surface as-is.
       *
       * The retry decision above is deliberately NOT changed the same way:
       * retrying only some guard refusals would make the attempt count differ
       * between a hostname that failed DNS and one blocked by policy, which is
       * the distinction the sanitized message exists to hide. Transient
       * resolver failures are retried inside the guard instead.
       */
      const shouldVerifyProbeIsOnline: boolean =
        err instanceof EgressGuardException
          ? err.isTargetUnreachable()
          : !(err instanceof BadDataException) &&
            !(err instanceof TimeoutException);

      if (shouldVerifyProbeIsOnline && !options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `API Monitor - Probe is not online. Cannot ping  ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${errorText}`,
          );
          return null;
        }
      }

      // Get detailed error information
      const requestFailedDetails: RequestFailedDetails = redact(
        RequestFailedDetailsUtil.getRequestFailedDetails(err),
      );

      const apiResponse: APIResponse = {
        url: url,
        isOnline: false,
        requestBody: options.requestBody,
        requestHeaders: options.requestHeaders || {},
        isSecure: url.protocol === Protocol.HTTPS,
        responseTimeInMS: new PositiveNumber(0),
        statusCode: undefined,
        isTimeout: false,
        responseBody: "",
        responseHeaders: {},
        failureCause: failureCause,
        requestFailedDetails: requestFailedDetails,
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };

      // Preserve timeout metadata after the configured attempts are exhausted.
      if (
        err instanceof TimeoutException ||
        requestFailedDetails.errorCode === "ETIMEDOUT" ||
        requestFailedDetails.errorCode === "ESOCKETTIMEDOUT" ||
        ((err as any).toString().includes("timeout") &&
          (err as any).toString().includes("exceeded"))
      ) {
        logger.debug(
          `API Monitor - Timeout exceeded ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${errorText}`,
        );

        apiResponse.failureCause = writeProbeTimeoutFailureCause(
          options.currentRetryCount,
        );
        apiResponse.isOnline = false;
        apiResponse.isTimeout = true;
      }

      // if AggregateError is thrown, it means that the request failed
      if (
        API.getFriendlyErrorMessage(err as Error).includes("AggregateError")
      ) {
        apiResponse.failureCause = writeProbeFailureCause(
          ProbeFailureCause.AllConnectionAttemptsFailed,
          { error: apiResponse.failureCause },
        );
        apiResponse.isOnline = false;
        return apiResponse;
      }

      /*
       * The tenant's own API refused to answer. That failure is the ANSWER
       * this check exists to produce — it is returned right below as an
       * offline response - so it must never open an Issue against OneUptime.
       */
      logger.error(
        `API Monitor - Pinging  ${options.monitorId?.toString()} ${requestType} ${url.toString()} - ERROR: ${errorText} Response: ${JSON.stringify(
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
