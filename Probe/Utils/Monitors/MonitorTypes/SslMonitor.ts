import OnlineCheck from "../../OnlineCheck";
import ProxyConfig from "../../ProxyConfig";
import URL from "Common/Types/API/URL";
import type { HttpsProxyAgent } from "https-proxy-agent";
import type { HttpProxyAgent } from "http-proxy-agent";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import SslMonitorResponse from "Common/Types/Monitor/SSLMonitor/SslMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import ObjectUtil from "Common/Utils/ObjectUtil";
import logger from "Common/Server/Utils/Logger";
import { ClientRequest, IncomingMessage } from "http";
import https, { RequestOptions } from "https";
import tls, { TLSSocket } from "tls";

export interface SslResponse extends SslMonitorResponse {
  isOnline: boolean;
  failureCause: string;
  isTimeout?: boolean | undefined;
}

export interface SSLMonitorOptions {
  timeout?: PositiveNumber;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
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

    logger.debug(
      `Pinging host: ${pingOptions?.monitorId?.toString()} ${url.toString()} - Retry: ${
        pingOptions?.currentRetryCount
      }`,
    );

    try {
      const res: SslResponse = await this.getSslMonitorResponse(
        url.hostname.hostname,
        url.hostname.port?.toNumber() || 443,
      );

      logger.debug(
        `Pinging host ${pingOptions?.monitorId?.toString()} ${url.toString()} success: `,
      );
      logger.debug(res);

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

      if (pingOptions.currentRetryCount < (pingOptions.retry || 5)) {
        pingOptions.currentRetryCount++;
        await Sleep.sleep(1000);
        return await this.ping(url, pingOptions);
      }

      // check if the probe is online.
      if (!pingOptions.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `PingMonitor Monitor - Probe is not online. Cannot ping ${pingOptions?.monitorId?.toString()} ${url.toString()} - ERROR: ${err}`,
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
          `Ping Monitor - Timeout exceeded ${pingOptions.monitorId?.toString()} ${url.toString()} - ERROR: ${err}`,
        );

        return {
          isOnline: true,
          isTimeout: true,
          failureCause:
            "Request was tried " +
            pingOptions.currentRetryCount +
            " times and it timed out.",
        };
      }

      // if AggregateError is thrown, it means that the request failed
      if (
        API.getFriendlyErrorMessage(err as Error).includes("AggregateError")
      ) {
        return null;
      }

      return {
        isOnline: false,
        isTimeout: false,
        failureCause: API.getFriendlyErrorMessage(err as Error),
      };
    }
  }

  public static async getSslMonitorResponse(
    host: string,
    port = 443,
  ): Promise<SslResponse> {
    let isSelfSigned: boolean = false;
    let certificate: tls.PeerCertificate | null = null;

    try {
      certificate = await this.getCertificate({
        host,
        port,
        rejectUnauthorized: true,
      });
    } catch {
      try {
        certificate = await this.getCertificate({
          host,
          port,
          rejectUnauthorized: false,
        });

        isSelfSigned = true;
      } catch (err) {
        return {
          isOnline: false,
          failureCause: API.getFriendlyErrorMessage(err as Error),
        };
      }
    }

    if (!certificate) {
      return {
        isOnline: false,
        failureCause: "No certificate found",
      };
    }

    const res: SslResponse = {
      isOnline: true,
      isSelfSigned: isSelfSigned,
      createdAt: OneUptimeDate.fromString(certificate.valid_from),
      expiresAt: OneUptimeDate.fromString(certificate.valid_to),
      commonName: certificate.subject.CN,
      organizationalUnit: certificate.subject.OU,
      organization: certificate.subject.O,
      locality: certificate.subject.L,
      state: certificate.subject.ST,
      country: certificate.subject.C,
      serialNumber: certificate.serialNumber,
      fingerprint: certificate.fingerprint,
      fingerprint256: certificate.fingerprint256,
      failureCause: "",
    };

    return res;
  }

  public static async getCertificate(data: {
    host: string;
    port: number;
    rejectUnauthorized: boolean;
    retry?: number;
    currentRetryCount?: number;
  }): Promise<tls.PeerCertificate> {
    const { host, rejectUnauthorized } = data;

    let { port } = data;
    const retry: number = data.retry || 3;
    const currentRetryCount: number = data.currentRetryCount || 1;

    if (!port) {
      port = 443;
    }

    const sslPromise: Promise<tls.PeerCertificate> = new Promise(
      (
        resolve: (value: tls.PeerCertificate) => void,
        reject: (err: Error) => void,
      ) => {
        const requestOptions: https.RequestOptions = this.getOptions(
          host,
          port,
          rejectUnauthorized,
        );

        let isResolvedOrRejected: boolean = false;

        const req: ClientRequest = https.get(
          requestOptions,
          (res: IncomingMessage) => {
            const certificate: tls.PeerCertificate = (
              res.socket as TLSSocket
            ).getPeerCertificate();
            if (ObjectUtil.isEmpty(certificate) || certificate === null) {
              isResolvedOrRejected = true;
              return reject(new BadDataException("No certificate found"));
            }
            isResolvedOrRejected = true;
            return resolve(certificate);
          },
        );

        req.end();

        req.on("error", (err: Error) => {
          if (!isResolvedOrRejected) {
            isResolvedOrRejected = true;
            return reject(err);
          }
        });
      },
    );

    try {
      const certificate: tls.PeerCertificate = await sslPromise;
      return certificate;
    } catch (err: unknown) {
      logger.debug(
        `getCertificate failed for host ${host}:${port} - Retry: ${currentRetryCount} - Error: ${err}`,
      );

      if (currentRetryCount < retry) {
        await Sleep.sleep(1000);
        return await this.getCertificate({
          host,
          port,
          rejectUnauthorized,
          retry,
          currentRetryCount: currentRetryCount + 1,
        });
      }
      throw err;
    }
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
        ProxyConfig.getHttpsProxyAgent();
      const httpProxyAgent: HttpProxyAgent<string> | null =
        ProxyConfig.getHttpProxyAgent();

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
