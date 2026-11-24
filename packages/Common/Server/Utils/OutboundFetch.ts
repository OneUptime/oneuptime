import http from "http";
import { Agent, Dispatcher, ProxyAgent } from "undici";
import ProxyTunnelRefusal, {
  PROXY_TUNNEL_ERROR_CODE,
} from "../../Utils/ProxyTunnelRefusal";
import OutboundProxyAgents, { TargetTlsOptions } from "./OutboundProxyAgents";

/*
 * THE ROUTE A SERVER REQUEST SENT WITH NODE'S FETCH GOES OUT ON (issue
 * #10720).
 *
 * Node's fetch reads no HTTPS_PROXY, HTTP_PROXY or ALL_PROXY unless the
 * process runs with NODE_USE_ENV_PROXY. So on a server that reaches the
 * internet only through an outbound proxy, every request sent with it went
 * directly, and failed: the HTTP mail providers (Amazon SES, Mailgun,
 * Postmark, Resend), Microsoft Graph mail, the cloud marketplaces, AWS STS
 * for the server's own role, Google SecOps and the meeting providers.
 *
 * OutboundFetch.fetch is Node's fetch, routed as every other request of the
 * server is (OutboundProxyAgents): each request, and each redirect it
 * follows, goes out on the route OutboundProxyAgents.getProxyFor decides
 * for its URL - HTTPS_PROXY, HTTP_PROXY or ALL_PROXY, apart from the hosts
 * NO_PROXY names, CIDR ranges included - through an undici ProxyAgent, or
 * directly on an undici Agent:
 *
 *   - through a proxy, an http request is forwarded (the whole URL to the
 *     proxy) and an https one tunnelled (CONNECT), as axios and Node's own
 *     agents send them, signed in with the user name and password decoded,
 *     as the proxy checks them;
 *   - a request's own certificate settings (TargetTlsOptions) go on the
 *     connection to its target only, inside the tunnel: the connection to
 *     an https:// proxy keeps the CAs the process trusts;
 *   - a tunnel the proxy refuses, and a 407 it answers a forwarded request
 *     with, fail as an OutboundProxyRefusal, worded by ProxyTunnelRefusal:
 *     where the request was going and what the proxy answered, never the
 *     proxy's address, and a 407 as the proxy not taking OneUptime's user
 *     name and password;
 *   - with no proxy set at all, every request goes directly, as it did.
 *
 * Why not Node's own proxy support for fetch (NODE_USE_ENV_PROXY, or
 * http.setGlobalProxyFromEnv() at start-up, as the Kubernetes AI agent
 * does): it replaces the process's global agents and dispatcher, so every
 * request that brings no agent of its own, service-to-service calls in the
 * cluster among them, would go through the proxy too. It also reads
 * NO_PROXY its own way, not axios's: no CIDR ranges.
 *
 * The fetch is the global one, given a dispatcher: undici's agents, from
 * the undici package, carry the route. undici's own fetch would not do: it
 * does not take the FormData of Node's fetch as a body, and sends the text
 * "[object FormData]" instead (Mailgun's upload is one). A dispatcher must
 * speak the dispatcher interface of the undici inside Node, so the package
 * is kept at Node's major version: OutboundFetchRoutingGuard checks it, and
 * holds every server file to this one way of sending with fetch.
 */

// What a request's route depends on, besides its URL.
export interface OutboundFetchOptions {
  /*
   * How the target's certificate is checked: on the connection to the
   * target only, inside a proxy's tunnel too. Unset, as every request's is.
   */
  tls?: TargetTlsOptions | undefined;
  /*
   * true: never through a proxy, whatever the environment says - for a
   * service only this machine answers (AWS's instance metadata).
   */
  direct?: boolean | undefined;
}

/*
 * undici's words for a refusal (undici 8): a tunnel the proxy did not open,
 * and a forwarded request it answered 407.
 */
const REFUSED_TUNNEL: RegExp =
  /^Proxy response \((\d{3})\) !== 200 when HTTP Tunneling$/;
const REFUSED_FORWARD: RegExp = /^Proxy Authentication Required \((407)\)$/;
const UNDICI_ABORTED: string = "UND_ERR_ABORTED";
const UNDICI_INVALID_ARGUMENT: string = "UND_ERR_INVALID_ARG";

/*
 * A request the outbound proxy refused: a tunnel it did not open, or a
 * forwarded request it answered 407. The message names where the request
 * was going and what the proxy answered, never the proxy.
 */
export class OutboundProxyRefusal extends Error {
  public readonly code: string = PROXY_TUNNEL_ERROR_CODE;
  // "host:port", where the request was going.
  public readonly destination: string;
  // The status the proxy answered with.
  public readonly statusCode: number;
  // Its reason phrase ("Forbidden"), when the status has one.
  public readonly reason: string | undefined;

  public constructor(data: { destination: string; statusCode: number }) {
    const reason: string | undefined = http.STATUS_CODES[data.statusCode];

    super(
      ProxyTunnelRefusal.wordStatus({
        destination: data.destination,
        statusCode: data.statusCode,
        reason: reason,
      }),
    );

    this.name = "OutboundProxyRefusal";
    this.destination = data.destination;
    this.statusCode = data.statusCode;
    this.reason = reason;
  }

  /*
   * Whether the same request could go through on another try: a proxy that
   * failed itself (5xx), not one that refused it (403, 407).
   */
  public get isRetryable(): boolean {
    return this.statusCode >= 500;
  }

  // "host:port", where a request to `url` was going, as a refusal names it.
  public static destinationOf(url: URL): string {
    return `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
  }

  /*
   * Node's own refusal of a tunnel (ERR_PROXY_TUNNEL), from an agent
   * OutboundProxyAgents built, as the proxy's refusal of a request to
   * `destination` ("host:port"), for a client that sends on those agents
   * and words refusals as this does (the Teams bot's token requests and
   * replies, issue #10763). Node's words name the proxy: "Failed to
   * establish tunnel to <host>:443 via http://proxy.internal:3128/:
   * HTTP/1.1 403 Forbidden". Null for any other error, and for a tunnel
   * Node says no answer for (one that timed out, or ended), whose words
   * name no proxy.
   */
  public static fromTunnelError(
    error: unknown,
    destination: string,
  ): OutboundProxyRefusal | null {
    const value: { code?: unknown; message?: unknown } =
      error && typeof error === "object"
        ? (error as { code?: unknown; message?: unknown })
        : {};

    if (
      value.code !== PROXY_TUNNEL_ERROR_CODE ||
      typeof value.message !== "string"
    ) {
      return null;
    }

    const statusCode: number | null = ProxyTunnelRefusal.getStatusCode(
      value.message,
    );

    return statusCode === null
      ? null
      : new OutboundProxyRefusal({
          destination: destination,
          statusCode: statusCode,
        });
  }
}

/*
 * What the routing of one fetch refused, if anything: a refusal of the
 * proxy's, or a proxy setting it could not use. The fetch fails with it, as
 * it is: what the fetch would make of it ("fetch failed", or the error
 * turned to text when it is not an Error of the fetch's own realm, as in a
 * test's) says less.
 */
interface RoutingOutcome {
  failure: Error | null;
}

// The dispatcher one fetch hands Node's fetch: undici's interface, as fetch uses it.
interface FetchDispatcher {
  dispatch: (
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ) => boolean;
}

/*
 * The agents fetches go out on: for each request, and each redirect it
 * follows, the agent of the route decided for where it goes.
 */
class RoutingDispatcher {
  private readonly options: OutboundFetchOptions;
  // The agent of each route: "direct", or a proxy's URL.
  private readonly routes: Map<string, Dispatcher> = new Map<
    string,
    Dispatcher
  >();

  public constructor(options: OutboundFetchOptions) {
    this.options = options;
  }

  // The dispatcher of one fetch, which notes what its routing refused.
  public forFetch(outcome: RoutingOutcome): FetchDispatcher {
    return {
      dispatch: (
        options: Dispatcher.DispatchOptions,
        handler: Dispatcher.DispatchHandler,
      ): boolean => {
        return this.dispatch(options, handler, outcome);
      },
    };
  }

  public async close(): Promise<void> {
    await Promise.all(
      Array.from(this.routes.values()).map(
        (route: Dispatcher): Promise<void> => {
          return route.close();
        },
      ),
    );
  }

  public async destroy(): Promise<void> {
    const routes: Array<Dispatcher> = Array.from(this.routes.values());

    this.routes.clear();

    await Promise.all(
      routes.map((route: Dispatcher): Promise<void> => {
        return route.destroy();
      }),
    );
  }

  private dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
    outcome: RoutingOutcome,
  ): boolean {
    const origin: URL = new URL(String(options.origin));
    let proxy: URL | null = null;

    try {
      proxy = this.options.direct
        ? null
        : OutboundProxyAgents.getProxyFor(origin);
    } catch (error) {
      // A redirect to a scheme whose proxy cannot be used.
      outcome.failure = error as Error;
      throw error;
    }

    if (proxy) {
      RoutingDispatcher.rewordRefusals({
        handler: handler,
        destination: OutboundProxyRefusal.destinationOf(origin),
        outcome: outcome,
      });
    }

    return this.routeThrough(proxy).dispatch(options, handler);
  }

  /*
   * A refusal of the proxy's, as an OutboundProxyRefusal, noted for the
   * fetch to fail with: undici's own error names only the status, and is an
   * AbortError, which the fetch would report as a cancelled request. undici
   * decorates a handler so itself, for its proxy support; the fetch hands
   * each request, and each redirect, a handler of its own.
   */
  private static rewordRefusals(data: {
    handler: Dispatcher.DispatchHandler;
    destination: string;
    outcome: RoutingOutcome;
  }): void {
    const onResponseError: Dispatcher.DispatchHandler["onResponseError"] =
      data.handler.onResponseError;

    if (typeof onResponseError !== "function") {
      return;
    }

    data.handler.onResponseError = function (
      this: unknown,
      controller: Dispatcher.DispatchController,
      error: Error,
    ): void {
      const refusal: OutboundProxyRefusal | null = RoutingDispatcher.asRefusal(
        error,
        data.destination,
      );

      if (refusal) {
        data.outcome.failure = refusal;
      }

      onResponseError.call(this, controller, refusal || error);
    };
  }

  // undici's refusal as an OutboundProxyRefusal, or null for another error.
  private static asRefusal(
    error: unknown,
    destination: string,
  ): OutboundProxyRefusal | null {
    const value: { code?: unknown; message?: unknown } =
      error && typeof error === "object"
        ? (error as { code?: unknown; message?: unknown })
        : {};

    if (typeof value.message !== "string") {
      return null;
    }

    const status: string | undefined =
      value.code === UNDICI_ABORTED
        ? REFUSED_TUNNEL.exec(value.message)?.[1]
        : value.code === UNDICI_INVALID_ARGUMENT
          ? REFUSED_FORWARD.exec(value.message)?.[1]
          : undefined;

    return status
      ? new OutboundProxyRefusal({
          destination: destination,
          statusCode: Number(status),
        })
      : null;
  }

  // The agent of a route, made the first time it is taken.
  private routeThrough(proxy: URL | null): Dispatcher {
    const key: string = proxy ? proxy.href : "direct";
    let route: Dispatcher | undefined = this.routes.get(key);

    if (!route) {
      route = proxy
        ? RoutingDispatcher.createProxyAgent(proxy, this.options.tls)
        : RoutingDispatcher.createDirectAgent(this.options.tls);
      this.routes.set(key, route);
    }

    return route;
  }

  /*
   * An agent through `proxy`. Its user name and password are sent as the
   * proxy reads them, decoded, and as Node's agents send them - a password
   * alone included, which undici would leave out - so the URL it is given
   * carries none. An http request is forwarded, not tunnelled.
   */
  private static createProxyAgent(
    proxy: URL,
    tls: TargetTlsOptions | undefined,
  ): ProxyAgent {
    const credentials: string | null =
      OutboundProxyAgents.getProxyCredentials(proxy);
    const address: URL = new URL(proxy.href);
    const targetTls: Record<string, unknown> =
      RoutingDispatcher.getTargetTls(tls);

    address.username = "";
    address.password = "";

    return new ProxyAgent({
      uri: address.href,
      proxyTunnel: false,
      ...(credentials
        ? { token: `Basic ${Buffer.from(credentials).toString("base64")}` }
        : {}),
      ...(Object.keys(targetTls).length > 0 ? { requestTls: targetTls } : {}),
    });
  }

  private static createDirectAgent(tls: TargetTlsOptions | undefined): Agent {
    const targetTls: Record<string, unknown> =
      RoutingDispatcher.getTargetTls(tls);

    return new Agent(
      Object.keys(targetTls).length > 0 ? { connect: targetTls } : {},
    );
  }

  private static getTargetTls(
    tls: TargetTlsOptions | undefined,
  ): Record<string, unknown> {
    return { ...OutboundProxyAgents.getTlsAgentOptions(tls) };
  }
}

export default class OutboundFetch {
  // One for every request with no options of its own, one for the direct.
  private static routed: RoutingDispatcher | null = null;
  private static direct: RoutingDispatcher | null = null;

  /*
   * Node's fetch, on the route decided for the URL (and for each redirect
   * it follows). Everything else is as fetch does it: the same arguments,
   * the same Response. A proxy the environment sets that cannot be used
   * fails before anything is sent, in words that name no password; a
   * request the proxy refuses fails as an OutboundProxyRefusal.
   */
  public static async fetch(
    url: string | URL,
    init?: RequestInit | undefined,
    options?: OutboundFetchOptions | undefined,
  ): Promise<Response> {
    if (!options?.direct) {
      const target: URL | null = OutboundFetch.readUrl(url);

      if (target) {
        OutboundProxyAgents.getProxyFor(target);
      }
    }

    // A request's own certificate settings go on agents of its own.
    const ownAgents: RoutingDispatcher | null =
      Object.keys(OutboundProxyAgents.getTlsAgentOptions(options?.tls)).length >
      0
        ? new RoutingDispatcher(options || {})
        : null;
    const agents: RoutingDispatcher =
      ownAgents || OutboundFetch.getSharedAgents(options);
    const outcome: RoutingOutcome = { failure: null };

    try {
      return await globalThis.fetch(url, {
        ...init,
        dispatcher: agents.forFetch(outcome),
      } as RequestInit);
    } catch (error) {
      throw outcome.failure || error;
    } finally {
      if (ownAgents) {
        // Gracefully: the response's body is read after this returns.
        ownAgents.close().catch((): void => {
          // Its connections are gone already.
        });
      }
    }
  }

  // Closes the shared agents' connections and forgets them: for tests.
  public static async destroySharedDispatchers(): Promise<void> {
    const shared: Array<RoutingDispatcher> = [
      OutboundFetch.routed,
      OutboundFetch.direct,
    ].filter((dispatcher: RoutingDispatcher | null): boolean => {
      return dispatcher !== null;
    }) as Array<RoutingDispatcher>;

    OutboundFetch.routed = null;
    OutboundFetch.direct = null;

    await Promise.all(
      shared.map((dispatcher: RoutingDispatcher): Promise<void> => {
        return dispatcher.destroy();
      }),
    );
  }

  private static getSharedAgents(
    options: OutboundFetchOptions | undefined,
  ): RoutingDispatcher {
    if (options?.direct) {
      OutboundFetch.direct =
        OutboundFetch.direct || new RoutingDispatcher({ direct: true });

      return OutboundFetch.direct;
    }

    OutboundFetch.routed = OutboundFetch.routed || new RoutingDispatcher({});

    return OutboundFetch.routed;
  }

  // The URL a fetch goes to, or null for one it would refuse itself.
  private static readUrl(url: string | URL): URL | null {
    try {
      return new URL(String(url));
    } catch {
      return null;
    }
  }
}
