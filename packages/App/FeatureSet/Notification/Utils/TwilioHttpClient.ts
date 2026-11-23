import logger from "Common/Server/Utils/Logger";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import type { InternalAxiosRequestConfig } from "axios";
import fs from "fs";
import http from "http";
import https from "https";
import RequestClient from "twilio/lib/base/RequestClient";

/*
 * TWILIO'S SMS AND CALLS GO THROUGH THE OUTBOUND PROXY AS EVERY OTHER
 * REQUEST OF THE SERVER DOES (issue #10721).
 *
 * Twilio's helper library routes its requests itself. Its RequestClient
 * sends with axios's proxy off, on an https agent of its own: an
 * https-proxy-agent for HTTP_PROXY when that is set, and nothing else. So
 * it ignored HTTPS_PROXY and ALL_PROXY - a server whose environment names
 * its proxy in HTTPS_PROXY alone, the usual way for an https-only egress,
 * sent its SMS and calls directly, which fails where the internet is
 * reachable only through the proxy - ignored NO_PROXY, and decided once,
 * when the client was made, for every Twilio host. Through HTTP_PROXY it
 * also dropped TWILIO_CA_BUNDLE and its socket timeout.
 *
 * Every Twilio client OneUptime makes is handed a RequestClient of its own
 * (create()), whose axios instance routes each request: its agent goes
 * through the proxy OutboundProxyAgents decides for the request's URL
 * (HTTPS_PROXY, then ALL_PROXY, apart from the hosts NO_PROXY names), or
 * directly, with Twilio's own timeout and CA bundle on the connection to
 * Twilio, never on the proxy's.
 *
 * An install that set HTTP_PROXY alone sent its SMS and calls through it,
 * the one variable Twilio read, and keeps doing so: when no proxy is chosen
 * for a Twilio host and NO_PROXY does not name it, HTTP_PROXY carries its
 * requests - the proxy an http request to that host and port would take -
 * and the server says so once in its log.
 *
 * OutboundAxiosRoutingGuard holds every Twilio client of the server to it.
 */

export const TWILIO_HTTP_PROXY_FALLBACK_MESSAGE: string =
  "Twilio's SMS and calls go through the outbound proxy set in HTTP_PROXY, because neither HTTPS_PROXY nor ALL_PROXY is set: Twilio's own client read HTTP_PROXY alone, so they keep going where they went. Every other HTTPS request of this server goes directly. To send them all through a proxy, set HTTPS_PROXY to it too.";

// The variable Twilio's own client read its proxy from, alone.
const TWILIO_OWN_PROXY_VARIABLE: string = "HTTP_PROXY";

// The default port of an https URL, which its http twin names (getProxyFor).
const HTTPS_DEFAULT_PORT: string = "443";

export default class TwilioHttpClient {
  // Whether the HTTP_PROXY fallback was logged: once a process.
  private static fallbackLogged: boolean = false;

  /*
   * The http client a Twilio client is handed:
   * Twilio(accountSid, authToken, { httpClient: TwilioHttpClient.create() }).
   * Its requests are Twilio's own - the same authentication, form encoding,
   * timeout and retries - each on the route decided for its URL.
   */
  public static create(): RequestClient {
    const client: RequestClient = new RequestClient();
    const agentOptions: https.AgentOptions =
      TwilioHttpClient.getAgentOptions(client);
    // One agent for each route this client has taken.
    const agents: Map<string, http.Agent> = new Map<string, http.Agent>();

    client.axios.interceptors.request.use(
      (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
        return TwilioHttpClient.route({
          config: config,
          agentOptions: agentOptions,
          agents: agents,
        });
      },
    );

    return client;
  }

  /*
   * The proxy a Twilio request to `url` goes through, or null to go
   * directly: the one every request of the server takes (HTTPS_PROXY, then
   * ALL_PROXY, apart from NO_PROXY's hosts), else HTTP_PROXY, when the
   * environment sets it, for an https host NO_PROXY does not name.
   */
  public static getProxyFor(url: URL): URL | null {
    const proxy: URL | null = OutboundProxyAgents.getProxyFor(url);

    if (
      proxy ||
      url.protocol !== "https:" ||
      !(process.env[TWILIO_OWN_PROXY_VARIABLE] || "").trim()
    ) {
      return proxy;
    }

    /*
     * The proxy an http request to the same host and port would take:
     * HTTP_PROXY, read as every request reads it, unless NO_PROXY names
     * that host and port.
     */
    const twin: URL = new URL(url.href);

    twin.protocol = "http:";
    twin.port = url.port || HTTPS_DEFAULT_PORT;

    const fallback: URL | null = OutboundProxyAgents.getProxyFor(twin);

    if (fallback && !TwilioHttpClient.fallbackLogged) {
      TwilioHttpClient.fallbackLogged = true;
      logger.warn(TWILIO_HTTP_PROXY_FALLBACK_MESSAGE);
    }

    return fallback;
  }

  // Forgets that the fallback was logged: for tests.
  public static resetFallbackLog(): void {
    TwilioHttpClient.fallbackLogged = false;
  }

  /*
   * A request's config, on the agent of the route decided for its URL, with
   * axios's proxy off (Twilio sets it off itself). A request whose URL
   * cannot be read - Twilio sends none - is left on Twilio's own agent.
   */
  private static route(data: {
    config: InternalAxiosRequestConfig;
    agentOptions: https.AgentOptions;
    agents: Map<string, http.Agent>;
  }): InternalAxiosRequestConfig {
    const url: URL | null = TwilioHttpClient.readUrl(data.config.url);

    if (!url) {
      return data.config;
    }

    const isHttps: boolean = url.protocol === "https:";
    const proxy: URL | null = TwilioHttpClient.getProxyFor(url);
    const key: string = `${isHttps ? "https" : "http"} ${proxy ? proxy.href : "direct"}`;
    let agent: http.Agent | undefined = data.agents.get(key);

    if (!agent) {
      const proxyEnv: http.AgentOptions["proxyEnv"] =
        OutboundProxyAgents.getProxyEnvThrough(url, proxy);

      agent = isHttps
        ? new https.Agent({ ...data.agentOptions, proxyEnv: proxyEnv })
        : new http.Agent({
            timeout: data.agentOptions.timeout,
            proxyEnv: proxyEnv,
          });
      data.agents.set(key, agent);
    }

    if (isHttps) {
      data.config.httpsAgent = agent;
    } else {
      data.config.httpAgent = agent;
    }

    data.config.proxy = false;

    return data.config;
  }

  /*
   * Twilio's own agent options: its socket timeout, and the CA bundle
   * TWILIO_CA_BUNDLE names, read as Twilio reads it, once for the client.
   */
  private static getAgentOptions(client: RequestClient): https.AgentOptions {
    const options: https.AgentOptions = { timeout: client.defaultTimeout };
    const caBundle: string | undefined = process.env["TWILIO_CA_BUNDLE"];

    if (caBundle !== undefined) {
      options.ca = fs.readFileSync(caBundle);
    }

    return options;
  }

  // An http or https URL, or null.
  private static readUrl(value: string | undefined): URL | null {
    if (!value) {
      return null;
    }

    try {
      const url: URL = new URL(value);

      return url.protocol === "https:" || url.protocol === "http:"
        ? url
        : null;
    } catch {
      return null;
    }
  }
}
