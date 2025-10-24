import {
  HTTP_PROXY_URL,
  HTTPS_PROXY_URL,
  NO_PROXY,
} from "../Config";
import { HttpsProxyAgent } from "https-proxy-agent";
import { HttpProxyAgent } from "http-proxy-agent";
import logger from "Common/Server/Utils/Logger";
import type OneUptimeURL from "Common/Types/API/URL";
import { URL as NodeURL } from "url";

// Exported interface for proxy agents
export interface ProxyAgents {
  httpAgent?: HttpProxyAgent<string>;
  httpsAgent?: HttpsProxyAgent<string>;
}

type TargetUrl = OneUptimeURL | string;

export default class ProxyConfig {
  private static isConfigured: boolean = false;
  private static httpProxyAgent: HttpProxyAgent<string> | null = null;
  private static httpsProxyAgent: HttpsProxyAgent<string> | null = null;

  public static configure(): void {
    if (this.isConfigured) {
      return; // Already configured
    }

    if (!HTTP_PROXY_URL && !HTTPS_PROXY_URL) {
      logger.debug("No proxy URLs configured. Skipping proxy setup.");
      return;
    }

    try {
      logger.info("Configuring proxy settings:");
      if (HTTP_PROXY_URL) {
        logger.info(`  HTTP proxy: ${HTTP_PROXY_URL}`);
      }
      if (HTTPS_PROXY_URL) {
        logger.info(`  HTTPS proxy: ${HTTPS_PROXY_URL}`);
      }
      if (NO_PROXY.length > 0) {
        logger.info(`  NO_PROXY: ${NO_PROXY.join(", ")}`);
      }

      // Create proxy agents for HTTP and HTTPS
      if (HTTP_PROXY_URL) {
        this.httpProxyAgent = new HttpProxyAgent(HTTP_PROXY_URL);
      }

      if (HTTPS_PROXY_URL) {
        this.httpsProxyAgent = new HttpsProxyAgent(HTTPS_PROXY_URL);
      }

      this.isConfigured = true;
    } catch (error) {
      logger.error("Failed to configure proxy:");
      logger.error(error);
      throw new Error(`Failed to configure proxy: ${error}`);
    }
  }

  public static isProxyConfigured(): boolean {
    return (
      this.isConfigured && (Boolean(HTTP_PROXY_URL) || Boolean(HTTPS_PROXY_URL))
    );
  }

  public static getHttpProxyUrl(): string | null {
    return HTTP_PROXY_URL;
  }

  public static getHttpsProxyUrl(): string | null {
    return HTTPS_PROXY_URL;
  }

  public static getHttpProxyAgent(targetUrl?: TargetUrl): HttpProxyAgent<string> | null {
    if (this.shouldBypassProxy(targetUrl)) {
      return null;
    }

    return this.httpProxyAgent;
  }

  public static getHttpsProxyAgent(targetUrl?: TargetUrl): HttpsProxyAgent<string> | null {
    if (this.shouldBypassProxy(targetUrl)) {
      return null;
    }

    return this.httpsProxyAgent;
  }

  public static getRequestProxyAgents(targetUrl: TargetUrl): Readonly<ProxyAgents> {
    if (this.shouldBypassProxy(targetUrl)) {
      return {};
    }

    if (!this.isProxyConfigured()) {
      return {};
    }

    return {
      ...(this.httpProxyAgent ? { httpAgent: this.httpProxyAgent } : {}),
      ...(this.httpsProxyAgent ? { httpsAgent: this.httpsProxyAgent } : {}),
    } as const;
  }

  private static shouldBypassProxy(targetUrl?: TargetUrl): boolean {
    if (!targetUrl) {
      return false;
    }

    if (!this.isProxyConfigured()) {
      return false;
    }

    if (NO_PROXY.length === 0) {
      return false;
    }

    const { hostname, port } = this.extractHostnameAndPort(targetUrl);

    if (!hostname) {
      return false;
    }

    const normalizedHost: string = this.normalizeHost(hostname);
    const normalizedPort: string | undefined = port
      ? port.trim().toLowerCase()
      : undefined;

    for (const pattern of NO_PROXY) {
      if (this.matchesNoProxyPattern(normalizedHost, normalizedPort, pattern)) {
        logger.debug(
          `Bypassing proxy for ${hostname}${normalizedPort ? `:${normalizedPort}` : ""} because it matches NO_PROXY entry '${pattern}'.`,
        );
        return true;
      }
    }

    return false;
  }

  private static extractHostnameAndPort(target: TargetUrl): {
    hostname: string | null;
    port?: string;
  } {
    const value: string =
      typeof target === "string" ? target.trim() : target.toString().trim();

    if (!value) {
      return {
        hostname: null,
      };
    }

    try {
      const valueForParsing: string = value.includes("://")
        ? value
        : `http://${value}`;
      const parsedUrl: NodeURL = new NodeURL(valueForParsing);

      return {
        hostname: parsedUrl.hostname || null,
        port: parsedUrl.port || undefined,
      };
    } catch {
      if (value.startsWith("[") && value.includes("]")) {
        const closingIndex: number = value.indexOf("]");
        const hostPart: string = value.substring(1, closingIndex);
        const remainder: string = value.substring(closingIndex + 1).trim();
        const port: string | undefined = remainder.startsWith(":")
          ? remainder.substring(1).trim() || undefined
          : undefined;

        return {
          hostname: hostPart,
          port,
        };
      }

      const parts: Array<string> = value.split(":");
      if (parts.length === 2) {
        return {
          hostname: parts[0],
          port: parts[1],
        };
      }

      return {
        hostname: value,
      };
    }
  }

  private static normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  }

  private static splitHostAndPort(value: string): {
    host: string;
    port?: string;
  } {
    const trimmedValue: string = value.trim();

    if (!trimmedValue) {
      return {
        host: "",
      };
    }

    if (trimmedValue.startsWith("[") && trimmedValue.includes("]")) {
      const closingIndex: number = trimmedValue.indexOf("]");
      const hostPart: string = trimmedValue.substring(0, closingIndex + 1);
      const remainder: string = trimmedValue.substring(closingIndex + 1).trim();
      const port: string | undefined = remainder.startsWith(":")
        ? remainder.substring(1).trim() || undefined
        : undefined;

      return {
        host: hostPart,
        port,
      };
    }

    const segments: Array<string> = trimmedValue.split(":");
    if (segments.length === 2) {
      return {
        host: segments[0],
        port: segments[1].trim() || undefined,
      };
    }

    return {
      host: trimmedValue,
    };
  }

  private static matchesNoProxyPattern(
    hostname: string,
    port: string | undefined,
    rawPattern: string,
  ): boolean {
    const trimmedPattern: string = rawPattern.trim().toLowerCase();

    if (!trimmedPattern) {
      return false;
    }

    if (trimmedPattern === "*") {
      return true;
    }

    let pattern: string = trimmedPattern;

    if (pattern.includes("://")) {
      try {
        const parsedPattern: NodeURL = new NodeURL(pattern);
        const hostnamePart: string = parsedPattern.hostname.includes(":")
          ? `[${parsedPattern.hostname}]`
          : parsedPattern.hostname;

        pattern = `${hostnamePart}${
          parsedPattern.port ? `:${parsedPattern.port}` : ""
        }`;
      } catch {
        // Ignore parsing errors and fall back to raw pattern handling.
      }
    }

    let matchSubdomains: boolean = false;

    if (pattern.startsWith("*.")) {
      matchSubdomains = true;
      pattern = pattern.substring(2);
    } else if (pattern.startsWith(".")) {
      matchSubdomains = true;
      pattern = pattern.substring(1);
    }

    const { host, port: patternPort } = this.splitHostAndPort(pattern);
    const normalizedPatternHost: string = this.normalizeHost(host);

    if (!normalizedPatternHost) {
      return false;
    }

    const normalizedPatternPort: string | undefined = patternPort
      ? patternPort.trim().toLowerCase()
      : undefined;

    if (
      normalizedPatternPort !== undefined &&
      normalizedPatternPort !== (port || "")
    ) {
      return false;
    }

    if (matchSubdomains) {
      return (
        hostname === normalizedPatternHost ||
        hostname.endsWith(`.${normalizedPatternHost}`)
      );
    }

    return hostname === normalizedPatternHost;
  }
}
