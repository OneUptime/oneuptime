import { PROXY_URL } from "../Config";
import axios, { AxiosInstance } from "axios";
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

    if (!PROXY_URL) {
      logger.debug("No PROXY_URL configured. Skipping proxy setup.");
      return;
    }

    try {
      logger.info(`Configuring global proxy: ${PROXY_URL}`);

      // Create proxy agents for HTTP and HTTPS
      this.httpProxyAgent = new HttpProxyAgent(PROXY_URL);
      this.httpsProxyAgent = new HttpsProxyAgent(PROXY_URL);

      // Configure axios defaults to use the proxy
      axios.defaults.httpAgent = this.httpProxyAgent;
      axios.defaults.httpsAgent = this.httpsProxyAgent;

      // Also configure proxy for axios instances
      axios.defaults.proxy = false; // Disable axios built-in proxy to use our agents

      // Note: We don't set global agents for http/https modules as they're read-only
      // Individual requests will need to specify the agent

      this.isConfigured = true;
      logger.info("Global proxy configuration completed successfully");
    } catch (error) {
      logger.error("Failed to configure proxy:");
      logger.error(error);
      throw new Error(`Failed to configure proxy: ${error}`);
    }
  }

  public static isProxyConfigured(): boolean {
    return this.isConfigured && !!PROXY_URL;
  }

  public static getProxyUrl(): string | null {
    return PROXY_URL;
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

  /**
   * Configure a specific axios instance to use the proxy
   * This is useful for cases where axios.create() is used
   */
  public static configureAxiosInstance(instance: AxiosInstance): void {
    if (!PROXY_URL) {
      return;
    }

    try {
      const httpProxyAgent = new HttpProxyAgent(PROXY_URL);
      const httpsProxyAgent = new HttpsProxyAgent(PROXY_URL);

      instance.defaults.httpAgent = httpProxyAgent;
      instance.defaults.httpsAgent = httpsProxyAgent;
      instance.defaults.proxy = false;

      logger.debug("Configured axios instance to use proxy");
    } catch (error) {
      logger.error("Failed to configure axios instance for proxy:");
      logger.error(error);
    }
  }
}