import http from "http";
import https from "https";
import net from "net";
import type { AxiosRequestConfig } from "axios";
import BadDataException from "../../Types/Exception/BadDataException";
import OutboundProxy from "./OutboundProxy";

/*
 * THE AGENTS A SERVER REQUEST GOES OUT ON: THROUGH THE OUTBOUND PROXY, OR
 * DIRECTLY (issue #10442).
 *
 * A proxy's user name and password are percent-encoded in its URL when they
 * hold a character a URL reserves: a password p@ss is written
 * HTTPS_PROXY=http://user:p%40ss@proxy:3128. Axios, left to read the proxy
 * from the environment itself, sent Proxy-Authorization with them as
 * written - user:p%40ss - for a forwarded http request and an https CONNECT
 * alike, so a proxy that checks the real password refused every such request
 * with 407: webhooks, workflow API steps, LLM providers, sign-in and every
 * other request of the server.
 *
 * No server request leaves the proxy to axios now. Each is sent with axios's
 * own proxy off (`proxy: false`), on agents that carry its route, decided
 * for its URL as axios decides one (OutboundProxy.getProxyFor: HTTPS_PROXY,
 * HTTP_PROXY or ALL_PROXY, apart from the hosts NO_PROXY names):
 *
 *   - through a proxy, Node's own proxy support (an agent's proxyEnv) sends
 *     it: the whole URL to the proxy for http, a CONNECT tunnel for https,
 *     with the user name and password decoded, as the proxy checks them. A
 *     request's own certificate settings (TargetTlsOptions) stay on the
 *     connection to its target, inside the tunnel, never on the connection
 *     to an https:// proxy, which keeps the CAs the process trusts - axios's
 *     own tunnel copies them onto it (#10277);
 *   - directly, on agents whose proxyEnv is empty: such an agent also tells
 *     axios not to look for a proxy itself, as axios reads the environment
 *     only for an agent with no proxyEnv.
 *
 * A request that follows redirects is routed again at each one, for the URL
 * it goes to next, as axios routed it: a redirect from a host in NO_PROXY to
 * one outside it, or from http to https, goes as it always went.
 *
 * Who takes which route:
 *   - every request of the shared API client (Utils/API) that brings no
 *     agents of its own (Utils/OutboundRequestRouting is its Node half);
 *   - every pinned request: the egress guard's agents
 *     (DataSourceEgressGuard.createPinnedAgents) are built here, webhooks'
 *     (SafeWebhookRequest) included;
 *   - the server's other axios requests, and the libraries that send with
 *     axios: routeAxiosRequest, on a request's config or as an interceptor
 *     (acme-client's certificate orders, SendGrid's mail);
 *   - Twilio's SMS and calls: an interceptor on the client each one is
 *     handed (Notification/Utils/TwilioHttpClient, issue #10721);
 *   - the libraries that send on an agent they are handed: web push, and
 *     Expo's push to the mobile app (PushNotificationService).
 *
 * A request sent with Node's fetch takes the same route, decided here, on
 * undici's agents (OutboundFetch, issue #10720).
 *
 * OutboundAxiosRoutingGuard holds every server file that sends with axios
 * to one of them, and OutboundFetchRoutingGuard every one that sends with
 * fetch. With no proxy set at all, a request is sent exactly as it always
 * was.
 */

// What a request's certificate check is, for one request (see createAgents).
export interface TargetTlsOptions {
  // false: the target's certificate is not checked at all.
  rejectUnauthorized?: boolean | undefined;
  // The certificates (PEM) the target's chain must end at, and no others.
  ca?: string | Array<string> | undefined;
}

/*
 * The proxy settings one Node agent reads (http.AgentOptions' proxyEnv):
 * here only http_proxy or https_proxy, the one proxy chosen for the URL, or
 * nothing at all to go directly.
 */
export type NodeProxyEnv = NonNullable<http.AgentOptions["proxyEnv"]>;

export interface OutboundAgents {
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
}

export interface OutboundAgentOptions {
  /*
   * How the target's certificate is checked: on the https agent only, so on
   * the TLS connection to the target only, inside a proxy's tunnel too.
   * Unset, it is checked as every request's is.
   */
  tls?: TargetTlsOptions | undefined;
  // How the agents look a host name up (a pinned lookup, for the egress guard).
  lookup?: net.LookupFunction | undefined;
  /*
   * true: never through a proxy, whatever the environment says - for a
   * request whose target is checked and must be the one dialled.
   */
  direct?: boolean | undefined;
}

/*
 * The environment variables an outbound proxy is read from, by axios
 * (proxy-from-env) and by OutboundProxy, in either case.
 */
export const OUTBOUND_PROXY_VARIABLES: ReadonlyArray<string> = [
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
];

/*
 * The shared agents keep connections open between requests, as Node's own
 * global agents do: the most recently freed connection is used first, and
 * an idle one is closed after five seconds.
 */
const SHARED_AGENT_OPTIONS: http.AgentOptions = {
  keepAlive: true,
  scheduling: "lifo",
  timeout: 5000,
};

// A URL with a scheme ("https://..."), as axios tells one from a path.
const ABSOLUTE_URL: RegExp = /^([a-z][a-z\d+\-.]*:)?\/\//i;

type BeforeRedirect = NonNullable<AxiosRequestConfig["beforeRedirect"]>;

export default class OutboundProxyAgents {
  private static readonly sharedAgents: Map<string, http.Agent> = new Map<
    string,
    http.Agent
  >();

  // Whether the environment names an outbound proxy at all.
  public static isProxyConfigured(): boolean {
    return OUTBOUND_PROXY_VARIABLES.some((name: string): boolean => {
      return Boolean((process.env[name] || "").trim());
    });
  }

  /*
   * The outbound proxy a request to `url` goes through, as axios decides
   * (OutboundProxy.getProxyFor), or null to connect directly. Node's proxy
   * support speaks to an http or https proxy only, and would go direct past
   * any other, so another is refused, as axios fails a request to one. The
   * refusal names no proxy: its URL may hold its password.
   *
   * A user name or password the URL does not percent-encode as a URL must
   * (a "%" not written "%25") is refused too, before anything is sent:
   * Node's agents and undici, which Node's fetch goes through, both decode
   * them, and would fail every request with a bare "URI malformed".
   */
  public static getProxyFor(url: URL): URL | null {
    let proxy: URL | null;

    try {
      proxy = OutboundProxy.getProxyFor(url);
    } catch {
      throw new BadDataException(
        "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not a URL.",
      );
    }

    if (proxy && proxy.protocol !== "http:" && proxy.protocol !== "https:") {
      throw new BadDataException(
        "The outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not an http or https proxy.",
      );
    }

    if (proxy && !OutboundProxyAgents.hasDecodableCredentials(proxy)) {
      throw new BadDataException(
        "The user name or password of the outbound proxy set in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY is not written as a URL writes it: write each @, : and % in them as %40, %3A and %25.",
      );
    }

    return proxy;
  }

  /*
   * The user name and password a proxy's URL holds, decoded, as a proxy
   * reads them ("user:password"), or null when it holds neither. Node's
   * agents sign in so, a user name alone included ("user:") and a password
   * alone too (":password"), and so does OutboundFetch.
   */
  public static getProxyCredentials(proxy: URL): string | null {
    if (!proxy.username && !proxy.password) {
      return null;
    }

    return `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
  }

  /*
   * The proxyEnv of the agent a request to `url` goes out on, for the URL's
   * scheme: the proxy getProxyFor chose, or none at all.
   */
  public static getProxyEnvFor(url: URL): NodeProxyEnv {
    const proxy: URL | null = this.getProxyFor(url);

    if (!proxy) {
      return {};
    }

    return url.protocol === "https:"
      ? { https_proxy: proxy.href }
      : { http_proxy: proxy.href };
  }

  /*
   * An http and an https agent for one request to `url`, for a request that
   * needs agents of its own: a pinned lookup, or certificate settings. The
   * agent of the URL's scheme goes through the proxy getProxyFor chose, or
   * directly; the other goes directly. Both carry a proxyEnv, so axios never
   * adds a proxy of its own on top. Destroy both once the request is over.
   */
  public static createAgents(
    url: URL,
    options?: OutboundAgentOptions | undefined,
  ): OutboundAgents {
    const isHttps: boolean = url.protocol === "https:";
    const proxyEnv: NodeProxyEnv = options?.direct
      ? {}
      : this.getProxyEnvFor(url);
    const lookup: http.AgentOptions = options?.lookup
      ? { lookup: options.lookup }
      : {};

    return {
      httpAgent: new http.Agent({
        ...lookup,
        proxyEnv: isHttps ? {} : proxyEnv,
      }),
      httpsAgent: new https.Agent({
        ...lookup,
        ...this.getTlsAgentOptions(options?.tls),
        proxyEnv: isHttps ? proxyEnv : {},
      }),
    };
  }

  /*
   * The agent a request to `url` with no agents of its own goes out on, of
   * the URL's scheme: kept for the life of the process and shared, one for
   * each proxy and one for going directly.
   */
  public static getSharedAgentFor(url: URL): http.Agent {
    const isHttps: boolean = url.protocol === "https:";
    const proxy: URL | null = this.getProxyFor(url);
    const key: string = `${isHttps ? "https" : "http"} ${proxy ? proxy.href : "direct"}`;
    let agent: http.Agent | undefined = this.sharedAgents.get(key);

    if (!agent) {
      const proxyEnv: NodeProxyEnv = !proxy
        ? {}
        : isHttps
          ? { https_proxy: proxy.href }
          : { http_proxy: proxy.href };

      agent = isHttps
        ? new https.Agent({ ...SHARED_AGENT_OPTIONS, proxyEnv })
        : new http.Agent({ ...SHARED_AGENT_OPTIONS, proxyEnv });

      this.sharedAgents.set(key, agent);
    }

    return agent;
  }

  /*
   * An axios request's config, with its route set when it names none of its
   * own: axios's proxy off, and the shared agent for its URL. Usable as an
   * axios request interceptor as it is
   * (`instance.interceptors.request.use(OutboundProxyAgents.routeAxiosRequest)`).
   *
   *   - a config that sets `proxy` keeps it: false is a request sent
   *     directly, or on agents that route it themselves;
   *   - a config with agents of its own is routed by them: axios's proxy is
   *     turned off, so no proxy of axios's is added on top, and the scheme
   *     it brings no agent for is routed here;
   *   - with no proxy set at all, the config is left as it is.
   *
   * A request that follows redirects is routed again at each, for the URL it
   * goes to next.
   */
  public static routeAxiosRequest<T extends AxiosRequestConfig>(config: T): T {
    if (config.proxy !== undefined) {
      return config;
    }

    const hasOwnAgents: boolean = Boolean(
      config.httpAgent || config.httpsAgent,
    );

    if (!hasOwnAgents && !OutboundProxyAgents.isProxyConfigured()) {
      return config;
    }

    const url: URL | null = OutboundProxyAgents.getRequestUrl(config);

    /*
     * With no URL to decide for (none given, or none an http request can
     * go to), the request is left to axios, which still sends it through
     * the proxy: turning axios's proxy off with no agent to take its place
     * would send it around the proxy, directly.
     */
    if (!url && !hasOwnAgents) {
      return config;
    }

    config.proxy = false;

    if (!url || !OutboundProxyAgents.isProxyConfigured()) {
      return config;
    }

    if (url.protocol === "https:" && !config.httpsAgent) {
      config.httpsAgent = OutboundProxyAgents.getSharedAgentFor(url);
    } else if (url.protocol === "http:" && !config.httpAgent) {
      config.httpAgent = OutboundProxyAgents.getSharedAgentFor(url);
    }

    if (!hasOwnAgents) {
      const ownBeforeRedirect: BeforeRedirect | undefined =
        config.beforeRedirect;

      config.beforeRedirect = (
        options: Record<string, unknown>,
        responseDetails: Parameters<BeforeRedirect>[1],
        requestDetails: Parameters<BeforeRedirect>[2],
      ): void => {
        if (ownBeforeRedirect) {
          ownBeforeRedirect(options, responseDetails, requestDetails);
        }

        OutboundProxyAgents.routeRedirect(options);
      };
    }

    return config;
  }

  // Closes the shared agents' connections and forgets them: for tests.
  public static destroySharedAgents(): void {
    for (const agent of this.sharedAgents.values()) {
      agent.destroy();
    }

    this.sharedAgents.clear();
  }

  /*
   * A redirect's request options, as follow-redirects hands them to
   * beforeRedirect: the agent of the scheme it goes to is the one routed for
   * where it goes (follow-redirects takes options.agents[scheme] next).
   */
  private static routeRedirect(options: Record<string, unknown>): void {
    const href: unknown = options["href"];

    if (typeof href !== "string") {
      return;
    }

    let hop: URL;

    try {
      hop = new URL(href);
    } catch {
      return;
    }

    if (hop.protocol !== "http:" && hop.protocol !== "https:") {
      return;
    }

    const agents: Record<string, unknown> =
      options["agents"] && typeof options["agents"] === "object"
        ? { ...(options["agents"] as Record<string, unknown>) }
        : {};

    agents[hop.protocol === "https:" ? "https" : "http"] =
      this.getSharedAgentFor(hop);
    options["agents"] = agents;
  }

  /*
   * The URL an axios config is sent to, as axios builds it (baseURL and
   * url), or null for one that is not http or https.
   */
  private static getRequestUrl(config: AxiosRequestConfig): URL | null {
    const requested: string = typeof config.url === "string" ? config.url : "";
    const base: string =
      typeof config.baseURL === "string" ? config.baseURL : "";
    let full: string = requested;

    if (
      base &&
      (!ABSOLUTE_URL.test(requested) || config.allowAbsoluteUrls === false)
    ) {
      full = requested
        ? `${base.replace(/\/?\/$/, "")}/${requested.replace(/^\/+/, "")}`
        : base;
    }

    try {
      const url: URL = new URL(full);

      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }

  // Whether a proxy's user name and password can be decoded at all.
  private static hasDecodableCredentials(proxy: URL): boolean {
    try {
      OutboundProxyAgents.getProxyCredentials(proxy);
      return true;
    } catch {
      return false;
    }
  }

  /*
   * The TLS options of the connection to a request's target for `tls`: only
   * what it sets, so an unset TargetTlsOptions leaves the connection as
   * every other request's. OutboundFetch puts them on the target's
   * connection too, never the proxy's.
   */
  public static getTlsAgentOptions(
    tls: TargetTlsOptions | undefined,
  ): https.AgentOptions {
    const options: https.AgentOptions = {};

    if (tls?.rejectUnauthorized === false) {
      options.rejectUnauthorized = false;
    }

    if (
      tls?.ca !== undefined &&
      (Array.isArray(tls.ca) ? tls.ca.length > 0 : tls.ca.trim() !== "")
    ) {
      options.ca = tls.ca;
    }

    return options;
  }
}
