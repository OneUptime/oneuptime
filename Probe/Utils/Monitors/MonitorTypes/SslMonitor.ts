import OnlineCheck from "../../OnlineCheck";
import ProxyConfig from "../../ProxyConfig";
import URL from "Common/Types/API/URL";
import Hostname from "Common/Types/API/Hostname";
import type { HttpsProxyAgent } from "https-proxy-agent";
import type { HttpProxyAgent } from "http-proxy-agent";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import SslMonitorResponse from "Common/Types/Monitor/SSLMonitor/SslMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import ObjectUtil from "Common/Utils/ObjectUtil";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import { ClientRequest, IncomingMessage } from "http";
import { Socket } from "net";
import https, { RequestOptions } from "https";
import tls, { TLSSocket } from "tls";

export interface SslResponse extends SslMonitorResponse {
  isOnline: boolean;
  failureCause: string;
  isTimeout?: boolean | undefined;
  probeAttempts?: Array<ProbeAttempt> | undefined;
  totalAttempts?: number | undefined;
}

export interface SSLMonitorOptions {
  timeout?: PositiveNumber;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
}

/*
 * Node's TLS validation error codes. A strict handshake that fails with one
 * of these has produced a VERDICT about the certificate - the peer is
 * reachable and served a chain, it just is not trustworthy. Anything else
 * (ECONNREFUSED, ENOTFOUND, ETIMEDOUT, ...) is a connection failure and says
 * nothing about the certificate, which is the distinction the old code lost
 * when it treated every strict-pass failure as evidence of self-signing.
 */
const TLS_VALIDATION_ERROR_CODES: Set<string> = new Set<string>([
  "CERT_CHAIN_TOO_LONG",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REJECTED",
  "CERT_REVOKED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "INVALID_CA",
  "INVALID_PURPOSE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNSUPPORTED_CERTIFICATE_PURPOSE",
]);

/*
 * The two codes that actually mean "self-signed". Every other validation
 * failure leaves isSelfSigned false and is described by the error code.
 */
const SELF_SIGNED_ERROR_CODES: Set<string> = new Set<string>([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
]);

// Matches WebsiteMonitor / PortMonitor when the caller supplies no timeout.
export const DEFAULT_SSL_MONITOR_TIMEOUT_IN_MS: number = 5000;

const LOG_PREFIX: string = "SSL Certificate Monitor";

export default class SSLMonitor {
  // burn domain names into the code to see if this probe is online.

  public static async ping(
    url: URL,
    pingOptions?: SSLMonitorOptions,
  ): Promise<SslResponse | null> {
    if (!pingOptions) {
      pingOptions = {};
    }

    if (pingOptions?.currentRetryCount === undefined) {
      pingOptions.currentRetryCount = 1;
    }

    if (!pingOptions.attempts) {
      pingOptions.attempts = [];
    }

    const timeoutInMs: number =
      pingOptions.timeout?.toNumber() || DEFAULT_SSL_MONITOR_TIMEOUT_IN_MS;

    /*
     * The URL's authority carries the port ("example.com:8443"), and
     * URL.fromString does not split it off - it hands the whole authority to
     * Hostname. Re-parsing it here is what keeps an SSL monitor on a
     * non-443 port from trying to resolve a host literally named
     * "example.com:8443".
     */
    const target: Hostname = Hostname.fromAuthority(url.hostname.toString());
    const host: string = target.hostname;
    const port: number = target.port?.toNumber() || 443;

    logger.debug(
      `${LOG_PREFIX} - Pinging ${pingOptions?.monitorId?.toString()} ${host}:${port} - Retry: ${
        pingOptions?.currentRetryCount
      }`,
    );

    const attemptedAt: Date = new Date();
    try {
      const res: SslResponse = await this.getSslMonitorResponse(
        host,
        port,
        timeoutInMs,
      );

      logger.debug(
        `${LOG_PREFIX} - Pinging ${pingOptions?.monitorId?.toString()} ${host}:${port} success: `,
      );
      logger.debug(res);

      const responseReceivedAt: Date = new Date();
      const responseTimeInMs: number =
        responseReceivedAt.getTime() - attemptedAt.getTime();

      pingOptions.attempts.push({
        attemptNumber: pingOptions.currentRetryCount,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs,
        isOnline: res.isOnline,
        failureCause: res.isOnline ? undefined : res.failureCause,
      });

      /*
       * A transient connection failure is worth retrying. A certificate
       * that failed validation is a deterministic verdict, and a timeout
       * has already consumed a full deadline - retrying either only burns
       * the monitor's time budget.
       */
      if (
        !res.isOnline &&
        !res.certificateValidationErrorCode &&
        !res.isTimeout &&
        pingOptions.currentRetryCount < (pingOptions.retry ?? 5)
      ) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(url, pingOptions);
      }

      /*
       * Recorded so SSL monitors produce a ResponseTime metric like every
       * other probe monitor type. Only meaningful when we actually spoke to
       * the peer.
       */
      if (res.isOnline) {
        res.responseTimeInMs = responseTimeInMs;
      }

      res.probeAttempts = pingOptions.attempts;
      res.totalAttempts = pingOptions.attempts.length;
      return res;
    } catch (err: unknown) {
      logger.debug(
        `${LOG_PREFIX} - Pinging ${pingOptions?.monitorId?.toString()} ${host}:${port} error: `,
      );
      logger.debug(err);

      if (!pingOptions) {
        pingOptions = {};
      }

      if (!pingOptions.currentRetryCount) {
        pingOptions.currentRetryCount = 0;
      }

      if (!pingOptions.attempts) {
        pingOptions.attempts = [];
      }

      const responseReceivedAt: Date = new Date();
      pingOptions.attempts.push({
        attemptNumber: pingOptions.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: responseReceivedAt.getTime() - attemptedAt.getTime(),
        isOnline: false,
        failureCause: API.getFriendlyErrorMessage(err as Error),
      });

      if (pingOptions.currentRetryCount < (pingOptions.retry || 5)) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(url, pingOptions);
      }

      // check if the probe is online.
      if (!pingOptions.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `${LOG_PREFIX} - Probe is not online. Cannot ping ${pingOptions?.monitorId?.toString()} ${host}:${port} - ERROR: ${err}`,
          );
          return null;
        }
      }

      // check if timeout exceeded and if yes, report it as offline.
      if (SSLMonitor.isTimeoutError(err)) {
        /*
         * The tenant's TLS peer never completed a handshake inside the
         * budget, after every retry. Detecting that is the check working, so
         * it is reported as an offline result and not as our defect.
         */
        logger.error(
          `${LOG_PREFIX} - Timeout exceeded ${pingOptions.monitorId?.toString()} ${host}:${port} - ERROR: ${err}`,
          EXTERNAL_FAULT,
        );

        return {
          /*
           * A check that never completed is NOT evidence the endpoint is
           * healthy. This used to return isOnline: true, which made a
           * permanently stalled TLS peer read as an operational monitor and
           * left every "Is Online = False" criterion dead.
           */
          isOnline: false,
          isTimeout: true,
          isValidCertificate: false,
          failureCause:
            "Request was tried " +
            pingOptions.currentRetryCount +
            " times and it timed out.",
          probeAttempts: pingOptions.attempts,
          totalAttempts: pingOptions.attempts.length,
        };
      }

      // if AggregateError is thrown, it means that the request failed
      if (
        API.getFriendlyErrorMessage(err as Error).includes("AggregateError")
      ) {
        return null;
      }

      /*
       * The connection to the tenant's host failed outright. Same as the
       * timeout branch above: the failure is the answer, returned below as an
       * offline result with the cause attached.
       */
      logger.error(
        `${LOG_PREFIX} - Failed to check ${pingOptions.monitorId?.toString()} ${host}:${port} - ERROR: ${err}`,
        EXTERNAL_FAULT,
      );

      return {
        isOnline: false,
        isTimeout: false,
        isValidCertificate: false,
        failureCause: API.getFriendlyErrorMessage(err as Error),
        probeAttempts: pingOptions.attempts,
        totalAttempts: pingOptions.attempts.length,
      };
    }
  }

  public static async getSslMonitorResponse(
    host: string,
    port = 443,
    timeoutInMs: number = DEFAULT_SSL_MONITOR_TIMEOUT_IN_MS,
  ): Promise<SslResponse> {
    let certificate: tls.PeerCertificate | null = null;

    let validationErrorCode: string = "";
    let validationErrorMessage: string = "";

    /*
     * Two passes, and the FIRST one is the one that produces the verdict.
     * The strict pass answers "would a browser trust this?"; the lenient
     * pass exists only to fetch the certificate's contents so the monitor
     * can still report expiry, issuer and fingerprints for a chain that
     * failed validation.
     */
    try {
      certificate = await this.getCertificate({
        host,
        port,
        rejectUnauthorized: true,
        timeoutInMs,
      });
    } catch (strictError) {
      validationErrorCode = SSLMonitor.getErrorCode(strictError);
      validationErrorMessage = API.getFriendlyErrorMessage(
        strictError as Error,
      );

      const isValidationFailure: boolean =
        TLS_VALIDATION_ERROR_CODES.has(validationErrorCode);

      /*
       * A strict failure that is NOT a TLS validation code is a connection
       * problem (refused, DNS, timeout). Retrying it without verification
       * would not tell us anything new about the certificate, and reporting
       * it as a certificate verdict is exactly the bug this replaces.
       */
      if (!isValidationFailure) {
        const isTimeout: boolean = SSLMonitor.isTimeoutError(strictError);

        return {
          isOnline: false,
          /*
           * Carried explicitly: this method resolves rather than throws, so
           * ping()'s own timeout branch never sees the error. Without this
           * a timed-out check reached criteria with isTimeout undefined and
           * "Is Request Timeout" could never fire.
           */
          isTimeout: isTimeout,
          isValidCertificate: false,
          isSelfSigned: false,
          /*
           * Deliberately NOT populated. We never got far enough to inspect
           * a certificate, and putting a connection error (ECONNREFUSED,
           * ETIMEDOUT) in a certificate-validation field is how the
           * original bug described a network problem as a certificate
           * verdict.
           */
          certificateValidationError: "",
          certificateValidationErrorCode: "",
          failureCause: isTimeout
            ? `${LOG_PREFIX} - the connection timed out after ${timeoutInMs}ms.`
            : validationErrorMessage,
        };
      }

      try {
        certificate = await this.getCertificate({
          host,
          port,
          rejectUnauthorized: false,
          timeoutInMs,
        });
      } catch (lenientError) {
        return {
          isOnline: false,
          isValidCertificate: false,
          isSelfSigned: SELF_SIGNED_ERROR_CODES.has(validationErrorCode),
          certificateValidationError: validationErrorMessage,
          certificateValidationErrorCode: validationErrorCode,
          failureCause: API.getFriendlyErrorMessage(lenientError as Error),
        };
      }
    }

    if (!certificate || ObjectUtil.isEmpty(certificate)) {
      return {
        isOnline: false,
        isValidCertificate: false,
        failureCause: "No certificate found",
        certificateValidationError: validationErrorMessage,
        certificateValidationErrorCode: validationErrorCode,
      };
    }

    const isValidCertificate: boolean = !validationErrorCode;

    const issuer: string | undefined = SSLMonitor.distinguishedName(
      certificate.issuer,
    );
    const subject: string | undefined = SSLMonitor.distinguishedName(
      certificate.subject,
    );

    /*
     * Self-signed is now a fact about the chain, not a leftover of control
     * flow: either Node named it, or the leaf issued itself.
     */
    const isSelfSigned: boolean =
      SELF_SIGNED_ERROR_CODES.has(validationErrorCode) ||
      Boolean(issuer && subject && issuer === subject);

    const res: SslResponse = {
      /*
       * isOnline describes reachability: we completed a TLS handshake and
       * read a certificate. Whether that certificate is TRUSTWORTHY is
       * isValidCertificate's job - keeping the two apart is what lets a
       * criterion distinguish "host is down" from "host is up with a bad
       * certificate".
       */
      isOnline: true,
      isValidCertificate: isValidCertificate,
      isSelfSigned: isSelfSigned,
      certificateValidationError: validationErrorMessage,
      certificateValidationErrorCode: validationErrorCode,
      createdAt: OneUptimeDate.fromString(certificate.valid_from),
      expiresAt: OneUptimeDate.fromString(certificate.valid_to),
      commonName: SSLMonitor.certificateField(certificate.subject?.CN),
      organizationalUnit: SSLMonitor.certificateField(certificate.subject?.OU),
      organization: SSLMonitor.certificateField(certificate.subject?.O),
      locality: SSLMonitor.certificateField(certificate.subject?.L),
      state: SSLMonitor.certificateField(certificate.subject?.ST),
      country: SSLMonitor.certificateField(certificate.subject?.C),
      issuer: issuer,
      serialNumber: certificate.serialNumber,
      fingerprint: certificate.fingerprint,
      fingerprint256: certificate.fingerprint256,
      /*
       * failureCause carries the validation problem so it reaches whoever
       * gets paged, instead of being discarded as it was when every failure
       * collapsed into isSelfSigned.
       */
      failureCause: validationErrorMessage,
    };

    return res;
  }

  /*
   * Node reports TLS validation failures through `code` on the error, but
   * hostname mismatches arrive as ERR_TLS_CERT_ALTNAME_INVALID on `code`
   * while some paths only set `reason`. Read both.
   */
  private static getErrorCode(err: unknown): string {
    const candidate: NodeJS.ErrnoException = err as NodeJS.ErrnoException;

    if (candidate?.code) {
      return String(candidate.code);
    }

    const reason: unknown = (err as { reason?: unknown })?.reason;

    if (typeof reason === "string" && TLS_VALIDATION_ERROR_CODES.has(reason)) {
      return reason;
    }

    return "";
  }

  private static isTimeoutError(err: unknown): boolean {
    const code: string = SSLMonitor.getErrorCode(err);

    if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
      return true;
    }

    const message: string = String(err);

    return message.includes("timeout") && message.includes("exceeded");
  }

  /*
   * Renders a certificate's subject/issuer into a stable, comparable string.
   * Comparing issuer to subject is how a self-signed leaf is recognised when
   * Node did not hand us a code for it (the lenient pass succeeds silently).
   */
  private static distinguishedName(
    name: tls.PeerCertificate["issuer"] | undefined,
  ): string | undefined {
    if (!name || typeof name !== "object") {
      return undefined;
    }

    const parts: Array<string> = Object.keys(name)
      .sort()
      .map((key: string) => {
        const value: string | undefined = SSLMonitor.certificateField(
          (name as unknown as Record<string, string | Array<string>>)[key],
        );

        return value ? `${key}=${value}` : "";
      })
      .filter((part: string) => {
        return Boolean(part);
      });

    return parts.length > 0 ? parts.join(", ") : undefined;
  }

  /*
   * A relative distinguished name may legitimately repeat — a certificate
   * carrying two OU values hands Node an array rather than a string, which is
   * why tls types these fields as string | string[].
   *
   * Older @types/node declared them as plain strings, so the array case was
   * assigned straight into a string field and surfaced to the user as
   * "[object Object]"-grade noise. Joining keeps every value visible and
   * restores the string contract SslMonitorResponse declares.
   */
  private static certificateField(
    value: string | Array<string> | undefined,
  ): string | undefined {
    if (Array.isArray(value)) {
      return value.join(", ") || undefined;
    }

    return value;
  }

  public static async getCertificate(data: {
    host: string;
    port: number;
    rejectUnauthorized: boolean;
    timeoutInMs?: number;
    retry?: number;
    currentRetryCount?: number;
  }): Promise<tls.PeerCertificate> {
    const { host, rejectUnauthorized } = data;

    let { port } = data;
    const retry: number = data.retry || 3;
    const currentRetryCount: number = data.currentRetryCount || 1;
    const timeoutInMs: number =
      data.timeoutInMs || DEFAULT_SSL_MONITOR_TIMEOUT_IN_MS;

    if (!port) {
      port = 443;
    }

    let request: ClientRequest | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

    /*
     * Held separately from the request. During a TLS handshake that never
     * completes, the ClientRequest has no socket attached yet, so
     * req.destroy() closes nothing and the TCP connection is leaked - one
     * stuck socket per check, forever. Destroying the socket we were handed
     * is what actually hangs up.
     */
    let requestSocket: Socket | null = null;

    const abortRequest: (err: Error) => void = (err: Error): void => {
      request?.destroy(err);

      if (requestSocket && !requestSocket.destroyed) {
        requestSocket.destroy(err);
      }
    };

    const sslPromise: Promise<tls.PeerCertificate> = new Promise(
      (
        resolve: (value: tls.PeerCertificate) => void,
        reject: (err: Error) => void,
      ) => {
        const requestOptions: https.RequestOptions = this.getOptions(
          host,
          port,
          rejectUnauthorized,
          timeoutInMs,
        );

        let isResolvedOrRejected: boolean = false;

        const settleWithError: (err: Error) => void = (err: Error): void => {
          if (isResolvedOrRejected) {
            return;
          }
          isResolvedOrRejected = true;
          reject(err);
        };

        const req: ClientRequest = https.get(
          requestOptions,
          (res: IncomingMessage) => {
            const certificate: tls.PeerCertificate = (
              res.socket as TLSSocket
            ).getPeerCertificate();

            /*
             * Null-check FIRST. ObjectUtil.isEmpty(null) would throw a
             * TypeError inside this callback - where nothing catches it -
             * so the old ordering made the guard it was written for dead.
             */
            if (certificate === null || ObjectUtil.isEmpty(certificate)) {
              return settleWithError(
                new BadDataException("No certificate found"),
              );
            }

            if (isResolvedOrRejected) {
              return;
            }
            isResolvedOrRejected = true;
            return resolve(certificate);
          },
        );

        request = req;

        req.end();

        // Captured so a timeout can close the connection itself.
        req.on("socket", (socket: Socket) => {
          requestSocket = socket;
        });

        req.on("error", (err: Error) => {
          settleWithError(err);
        });

        /*
         * Arms once a socket is assigned and covers a peer that accepts the
         * connection and then goes silent. It does NOT cover a stall before
         * socket assignment (DNS, proxy CONNECT), which is what the
         * Promise.race deadline below is for.
         */
        req.setTimeout(timeoutInMs, () => {
          const timeoutError: NodeJS.ErrnoException = new Error(
            `${LOG_PREFIX} - timeout of ${timeoutInMs}ms exceeded`,
          );
          timeoutError.code = "ETIMEDOUT";
          abortRequest(timeoutError);
          settleWithError(timeoutError);
        });
      },
    );

    const deadlinePromise: Promise<never> = new Promise<never>(
      (_resolve: (value: never) => void, reject: (err: Error) => void) => {
        deadlineTimer = setTimeout(() => {
          const timeoutError: NodeJS.ErrnoException = new Error(
            `${LOG_PREFIX} - timeout of ${timeoutInMs}ms exceeded`,
          );
          timeoutError.code = "ETIMEDOUT";

          /*
           * Destroy the request as well as rejecting: an abandoned
           * ClientRequest keeps its socket - and the event loop - alive.
           */
          abortRequest(timeoutError);
          reject(timeoutError);
        }, timeoutInMs);
      },
    );

    try {
      const certificate: tls.PeerCertificate = await Promise.race([
        sslPromise,
        deadlinePromise,
      ]);
      return certificate;
    } catch (err: unknown) {
      logger.debug(
        `${LOG_PREFIX} - getCertificate failed for host ${host}:${port} - Retry: ${currentRetryCount} - Error: ${err}`,
      );

      /*
       * A validation verdict is deterministic - the same chain fails the
       * same way every time - so retrying it only multiplies the monitor's
       * wall clock. Retry connection problems only.
       */
      const code: string = SSLMonitor.getErrorCode(err);

      if (
        currentRetryCount < retry &&
        !TLS_VALIDATION_ERROR_CODES.has(code) &&
        !SSLMonitor.isTimeoutError(err)
      ) {
        await Sleep.sleep(1000);
        return await this.getCertificate({
          host,
          port,
          rejectUnauthorized,
          timeoutInMs,
          retry,
          currentRetryCount: currentRetryCount + 1,
        });
      }
      throw err;
    } finally {
      /*
       * Always clear the deadline: an un-cleared timer keeps the process
       * (and jest --detectOpenHandles) alive after a successful check.
       */
      if (deadlineTimer) {
        clearTimeout(deadlineTimer);
      }
    }
  }

  private static getOptions(
    url: string,
    port: number,
    rejectUnauthorized: boolean,
    timeoutInMs: number = DEFAULT_SSL_MONITOR_TIMEOUT_IN_MS,
  ): RequestOptions {
    const options: RequestOptions = {
      hostname: url,
      agent: false,
      rejectUnauthorized: rejectUnauthorized,
      ciphers: "ALL",
      port,
      protocol: "https:",
      /*
       * Node's ClientRequest default is 0 (wait forever). Without this an
       * endpoint that completes TCP and then stalls hangs the check - and
       * therefore the monitor - permanently.
       */
      timeout: timeoutInMs,
    };

    // Use proxy agent if proxy is configured
    if (ProxyConfig.isProxyConfigured()) {
      const httpsProxyAgent: HttpsProxyAgent<string> | null =
        ProxyConfig.getHttpsProxyAgent(url);
      const httpProxyAgent: HttpProxyAgent<string> | null =
        ProxyConfig.getHttpProxyAgent(url);

      // Prefer HTTPS proxy agent, fall back to HTTP proxy agent
      const proxyAgent:
        | (HttpsProxyAgent<string> | HttpProxyAgent<string>)
        | null = httpsProxyAgent || httpProxyAgent;

      if (proxyAgent) {
        options.agent = proxyAgent;

        const httpsProxyUrl: string | null = ProxyConfig.getHttpsProxyUrl();
        const httpProxyUrl: string | null = ProxyConfig.getHttpProxyUrl();
        const proxyUrl: string | null = httpsProxyUrl || httpProxyUrl;

        logger.debug(
          `${LOG_PREFIX} - using proxy: ${proxyUrl} (HTTPS: ${Boolean(httpsProxyUrl)}, HTTP: ${Boolean(httpProxyUrl)})`,
        );
      }
    }

    return options;
  }
}
