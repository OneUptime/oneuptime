import { HTTP_PROXY_URL, HTTPS_PROXY_URL } from "../Config";
import { HttpsProxyAgent } from "https-proxy-agent";
import { HttpProxyAgent } from "http-proxy-agent";
import logger from "Common/Server/Utils/Logger";

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

  /**
   * Get the HTTP proxy agent for HTTP requests
   */
  public static getHttpProxyAgent(): HttpProxyAgent<string> | null {
    return this.httpProxyAgent;
  }

  /**
   * Get the HTTPS proxy agent for HTTPS requests
   */
  public static getHttpsProxyAgent(): HttpsProxyAgent<string> | null {
    return this.httpsProxyAgent;
  }

}
