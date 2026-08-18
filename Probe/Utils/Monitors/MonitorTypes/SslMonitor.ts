import OnlineCheck from "../../OnlineCheck";
import ProxyConfig from "../../ProxyConfig";
import URL from "Common/Types/API/URL";
import type { HttpsProxyAgent } from "https-proxy-agent";
import type { HttpProxyAgent } from "http-proxy-agent";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import UnableToReachServer from "Common/Types/Exception/UnableToReachServer";
import SslMonitorResponse from "Common/Types/Monitor/SSLMonitor/SslMonitorResponse";
import { DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS } from "Common/Types/Monitor/MonitorStep";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import ObjectUtil from "Common/Utils/ObjectUtil";
import logger from "Common/Server/Utils/Logger";
import { ClientRequest, IncomingMessage } from "http";
import https, { RequestOptions } from "https";
import tls, { TLSSocket } from "tls";

/*
 * Floor for a handshake deadline. Node treats a socket timeout of 0 as "no
 * timeout at all", which is precisely the unbounded wait this budget exists
 * to prevent, so a spent budget still gets a small positive deadline rather
 * than an infinite one.
 */
const MIN_SSL_HANDSHAKE_TIMEOUT_IN_MS: number = 1000;

export interface SslResponse extends SslMonitorResponse {
  isOnline: boolean;
  failureCause: string;
  isTimeout?: boolean | undefined;
  /*
   * Wall-clock time for the certificate fetch. SSL was the only probe monitor
   * type that never reported one, so MonitorType.doesMonitorTypeHaveGraphs
   * offered a response-time graph that could never have a point on it.
   */
  responseTimeInMs?: number | undefined;
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

    logger.debug(
      `Pinging host: ${pingOptions?.monitorId?.toString()} ${url.toString()} - Retry: ${
        pingOptions?.currentRetryCount
      }`,
    );

    const { host, port } = SSLMonitor.getHostAndPort(url);

    const attemptedAt: Date = new Date();
    try {
      const res: SslResponse = await this.getSslMonitorResponse(
        host,
        port,
        pingOptions.timeout?.toNumber() ||
          DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS,
      );

      logger.debug(
        `Pinging host ${pingOptions?.monitorId?.toString()} ${url.toString()} success: `,
      );
      logger.debug(res);

      const responseReceivedAt: Date = new Date();
      const responseTimeInMs: number =
        responseReceivedAt.getTime() - attemptedAt.getTime();

      pingOptions.attempts.push({
        attemptNumber: pingOptions.currentRetryCount,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs: responseTimeInMs,
        isOnline: res.isOnline,
        failureCause: res.isOnline ? undefined : res.failureCause,
      });

      res.responseTimeInMs = responseTimeInMs;
      res.probeAttempts = pingOptions.attempts;
      res.totalAttempts = pingOptions.attempts.length;
      return res;
    } catch (err: unknown) {
      logger.debug(
        `Pinging host ${pingOptions?.monitorId?.toString()} ${url.toString()} error: `,
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

      /*
       * Nullish rather than "|| 5": clampMonitorRetryCount lets a user save a
       * retry count of 0, and this ladder was dead code until
       * getSslMonitorResponse started throwing - so "|| 5" would newly turn
       * "do not retry" into five attempts against the same host.
       */
      const maxAttempts: number = pingOptions.retry ?? 5;

      if (pingOptions.currentRetryCount < maxAttempts) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(url, pingOptions);
      }

      // check if the probe is online.
      if (!pingOptions.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `SSL Monitor - Probe is not online. Cannot ping ${pingOptions?.monitorId?.toString()} ${url.toString()} - ERROR: ${err}`,
          );
          return null;
        }
      }

      // check if timeout exceeded and if yes, report the check as offline.
      if (
        (err as any).toString().includes("timeout") &&
        (err as any).toString().includes("exceeded")
      ) {
        logger.debug(
          `SSL Monitor - Timeout exceeded ${pingOptions.monitorId?.toString()} ${url.toString()} - ERROR: ${err}`,
        );

        /*
         * This used to report isOnline: true. The branch was unreachable
         * while getSslMonitorResponse swallowed its own errors, so nobody
         * noticed; now that the timeout is actually wired up and this path is
         * live, a host that never completes a handshake would otherwise keep
         * an "Is Online = True" criteria matching forever. A handshake that
         * never completed is not a reachable endpoint.
         */
        return {
          isOnline: false,
          isTimeout: true,
          failureCause:
            "Request was tried " +
            pingOptions.currentRetryCount +
            " times and it timed out.",
          responseTimeInMs:
            responseReceivedAt.getTime() - attemptedAt.getTime(),
          probeAttempts: pingOptions.attempts,
          totalAttempts: pingOptions.attempts.length,
        };
      }

      /*
       * Every resolved address failed to connect - happy-eyeballs exhausted,
       * typically a dual-stack host with a dead IPv6 route. This used to
       * return null, and a null step result is never POSTed to the ingest API
       * at all (see Probe/Utils/Monitors/Monitor.ts), so the monitor would sit
       * at its creation status forever: no criteria evaluation, no timeline
       * event, no monitor log, nothing to grep for. It is a definite offline
       * answer and must be reported like one.
       *
       * Detected by the error's own name rather than by the friendly message,
       * because getFriendlyErrorMessage rewrites an AggregateError into its
       * joined child messages and strips the name. The name check is also
       * what works across realms, where instanceof does not - and the global
       * AggregateError type is not in this project's es2017 lib.
       */
      if ((err as Error)?.name === "AggregateError") {
        return {
          isOnline: false,
          isTimeout: false,
          failureCause:
            "Request failed with AggregateError (all connection attempts failed). " +
            API.getFriendlyErrorMessage(err as Error),
          responseTimeInMs:
            responseReceivedAt.getTime() - attemptedAt.getTime(),
          probeAttempts: pingOptions.attempts,
          totalAttempts: pingOptions.attempts.length,
        };
      }

      return {
        isOnline: false,
        isTimeout: false,
        failureCause: API.getFriendlyErrorMessage(err as Error),
        responseTimeInMs: responseReceivedAt.getTime() - attemptedAt.getTime(),
        probeAttempts: pingOptions.attempts,
        totalAttempts: pingOptions.attempts.length,
      };
    }
  }

  /*
   * Hostname.hostname is the whole authority, not a bare host: URL.fromString
   * hands the Hostname constructor the full "example.com:8443" string and
   * leaves Hostname.port unset (Hostname.fromString would split it, but
   * URL.fromString does not use it). Reading the two fields naively therefore
   * dialled the literal name "example.com:8443" on port 443, so every SSL
   * Certificate monitor pointed at a non-443 port failed to resolve on every
   * single check - silently, because a check that only ever fails looks
   * identical to one that never runs.
   *
   * The WHATWG parser is what the HTTP client itself uses to read a URL, so
   * agreeing with it here is what keeps the host and port from disagreeing
   * with the connection actually made.
   */
  public static getHostAndPort(url: URL): { host: string; port: number } {
    try {
      const parsed: globalThis.URL = new globalThis.URL(url.toString());

      /*
       * WHATWG keeps an IPv6 literal bracketed; tls.connect wants it bare.
       */
      const host: string =
        parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
          ? parsed.hostname.slice(1, -1)
          : parsed.hostname;

      if (host) {
        return {
          host: host,
          port: parsed.port ? Number(parsed.port) : 443,
        };
      }
    } catch {
      // Fall back to this project's own parse below.
    }

    return {
      host: url.hostname.hostname,
      port: url.hostname.port?.toNumber() || 443,
    };
  }

  /*
   * `timeoutInMs` is the budget for the whole certificate fetch, not for one
   * connection. Two handshakes can happen here - a strict one, then a
   * permissive one whose only job is to identify an untrusted chain - and they
   * share the deadline. Giving each the full timeout would make the monitor's
   * Timeout setting quietly mean twice what the user asked for, and ping()'s
   * retry ladder would then multiply that again.
   */
  public static async getSslMonitorResponse(
    host: string,
    port: number = 443,
    timeoutInMs: number = DEFAULT_MONITOR_REQUEST_TIMEOUT_IN_MS,
  ): Promise<SslResponse> {
    const deadlineAt: number =
      OneUptimeDate.getCurrentDate().getTime() + timeoutInMs;

    let isSelfSigned: boolean = false;
    let certificate: tls.PeerCertificate | null = null;

    try {
      certificate = await this.getCertificate({
        host,
        port,
        rejectUnauthorized: true,
        timeoutInMs: SSLMonitor.getRemainingTimeInMs(deadlineAt),
      });
    } catch {
      /*
       * A failed strict handshake is the only signal available that the chain
       * is untrusted, so the permissive retry is what identifies a self-signed
       * certificate. Keep it unconditional - narrowing it to a list of OpenSSL
       * verify codes would silently change which certificates are reported as
       * self signed.
       *
       * This used to return { isOnline: false, failureCause } instead of
       * letting the failure propagate, which made every error path in ping()
       * dead code: the user's retry count was never applied, probeAttempts was
       * always 1, and an "Is Timeout" criteria on an SSL monitor could never
       * fire. Throwing is what makes those live.
       */
      certificate = await this.getCertificate({
        host,
        port,
        rejectUnauthorized: false,
        timeoutInMs: SSLMonitor.getRemainingTimeInMs(deadlineAt),
      });

      isSelfSigned = true;
    }

    if (!certificate) {
      throw new BadDataException("No certificate found");
    }

    const res: SslResponse = {
      isOnline: true,
      isSelfSigned: isSelfSigned,
      createdAt: OneUptimeDate.fromString(certificate.valid_from),
      expiresAt: OneUptimeDate.fromString(certificate.valid_to),
      commonName: SSLMonitor.certificateField(certificate.subject.CN),
      organizationalUnit: SSLMonitor.certificateField(certificate.subject.OU),
      organization: SSLMonitor.certificateField(certificate.subject.O),
      locality: SSLMonitor.certificateField(certificate.subject.L),
      state: SSLMonitor.certificateField(certificate.subject.ST),
      country: SSLMonitor.certificateField(certificate.subject.C),
      serialNumber: certificate.serialNumber,
      fingerprint: certificate.fingerprint,
      fingerprint256: certificate.fingerprint256,
      failureCause: "",
    };

    return res;
  }

  private static getRemainingTimeInMs(deadlineAt: number): number {
    return Math.max(
      deadlineAt - OneUptimeDate.getCurrentDate().getTime(),
      MIN_SSL_HANDSHAKE_TIMEOUT_IN_MS,
    );
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
    timeoutInMs: number;
  }): Promise<tls.PeerCertificate> {
    const { host, rejectUnauthorized, timeoutInMs } = data;

    let { port } = data;

    if (!port) {
      port = 443;
    }

    /*
     * Retries used to live here as well as in ping(), which nested three
     * ladders - ping retry x strict/permissive pass x this one - into up to 18
     * sequential connection attempts, each of them unbounded. Retrying is
     * ping()'s job: it owns the user's configured retry count and it is the
     * layer that records probeAttempts. This one attempt is bounded and always
     * settles.
     */
    return new Promise(
      (
        resolve: (value: tls.PeerCertificate) => void,
        reject: (err: Error) => void,
      ): void => {
        const requestOptions: https.RequestOptions = this.getOptions(
          host,
          port,
          rejectUnauthorized,
        );

        /*
         * Socket-level timeout: covers a peer that completes the TCP
         * connection and then stalls the TLS handshake. https.get on its own
         * sets no socket timeout and will wait on that forever.
         */
        requestOptions.timeout = timeoutInMs;

        let hasSettled: boolean = false;
        let deadlineTimer: NodeJS.Timeout | undefined = undefined;
        let request: ClientRequest | undefined = undefined;

        const finish: () => void = (): void => {
          if (deadlineTimer) {
            clearTimeout(deadlineTimer);
            deadlineTimer = undefined;
          }

          request?.destroy();
        };

        const resolveOnce: (certificate: tls.PeerCertificate) => void = (
          certificate: tls.PeerCertificate,
        ): void => {
          if (hasSettled) {
            return;
          }

          hasSettled = true;
          finish();
          resolve(certificate);
        };

        const rejectOnce: (err: Error) => void = (err: Error): void => {
          if (hasSettled) {
            return;
          }

          hasSettled = true;
          finish();
          reject(err);
        };

        const onDeadline: () => void = (): void => {
          /*
           * The message is string-matched by ping() ("timeout" + "exceeded")
           * to set isTimeout on the reported response - keep both words.
           */
          rejectOnce(
            new UnableToReachServer(
              `SSL handshake with ${host}:${port} timeout exceeded`,
            ),
          );
        };

        /*
         * Absolute attempt deadline. requestOptions.timeout only arms once a
         * socket exists, so it does not cover hostname resolution or a connect
         * that never completes; this does.
         */
        deadlineTimer = setTimeout(onDeadline, timeoutInMs);

        request = https.get(requestOptions, (res: IncomingMessage): void => {
          const certificate: tls.PeerCertificate = (
            res.socket as TLSSocket
          ).getPeerCertificate();

          /*
           * The certificate is on the socket the moment the response headers
           * arrive and the body is never read. Without destroying the response
           * the one-off agent (agent: false) holds the socket open until the
           * body drains - which never happens while nothing reads it - leaking
           * one TLS socket and fd per check. Small pages fit the stream buffer
           * and self-close, which is why this only ever bit real sites.
           */
          res.destroy();

          if (ObjectUtil.isEmpty(certificate) || certificate === null) {
            return rejectOnce(new BadDataException("No certificate found"));
          }

          return resolveOnce(certificate);
        });

        request.on("timeout", onDeadline);

        request.on("error", (err: Error): void => {
          rejectOnce(err);
        });
      },
    );
  }

  private static getOptions(
    url: string,
    port: number,
    rejectUnauthorized: boolean,
  ): RequestOptions {
    const options: RequestOptions = {
      hostname: url,
      agent: false,
      rejectUnauthorized: rejectUnauthorized,
      ciphers: "ALL",
      port,
      protocol: "https:",
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
          `SSL Monitor using proxy: ${proxyUrl} (HTTPS: ${Boolean(httpsProxyUrl)}, HTTP: ${Boolean(httpProxyUrl)})`,
        );
      }
    }

    return options;
  }
}
