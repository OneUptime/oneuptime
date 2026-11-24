import crypto from "crypto";
import http, { IncomingMessage, ServerResponse } from "http";
import net from "net";
import tls from "tls";
import { Duplex } from "stream";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import DataSourceEgressGuard, {
  EgressGuardOptions,
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import OutboundProxy from "Common/Server/Utils/OutboundProxy";
import EgressGuardException, {
  EgressFailureReason,
} from "Common/Types/Exception/EgressGuardException";
import MonitorEgressGuardOptions, {
  MONITOR_TARGET_LABEL,
  MonitorEgressPolicy,
  PUBLIC_ONLY_MONITOR_EGRESS_POLICY,
} from "../MonitorEgressGuardOptions";
import { MAX_SANDBOX_LOG_BYTES, MAX_SANDBOX_LOG_MESSAGES } from "./RpcProtocol";
import { SyntheticMonitorWorkerProxy } from "./SyntheticMonitorWorkerTypes";

/*
 * THE ONLY WAY A SYNTHETIC MONITOR'S REQUESTS LEAVE THE PROBE
 * (GHSA-9rx7-vwfj-whp7).
 *
 * A synthetic monitor's script is chosen by a project member and runs on a
 * probe that may be shared by every project (a global probe). Everything it
 * can make the probe send comes back to it: its axios bridge returns the
 * response, and its browser renders what it loaded for the script to read.
 * Neither was held to the egress policy the probe holds API, Website and
 * External Status Page monitors to, so a script could read the cloud
 * metadata endpoint, loopback services and - on a probe that refuses private
 * addresses - the network the probe runs in.
 *
 * Every request now goes through this proxy, which listens on loopback for
 * the length of one check:
 *
 *   - the browser is launched with it as its only proxy (SyntheticBrowser),
 *     loopback included, so every navigation, subresource, iframe, fetch,
 *     XHR, WebSocket, worker, service worker, beacon and redirect hop is
 *     handed to it rather than connected by the browser itself;
 *   - the script's axios bridge sends through it too
 *     (PlaywrightCapabilityBroker), with agents that can dial nothing else,
 *     so axios's redirects come here hop by hop as well.
 *
 * For each connection it is asked for - a CONNECT tunnel for https and wss,
 * an absolute-form request for http, an Upgrade for ws - it asks the egress
 * guard about the host, with the same options HTTP monitors use
 * (MonitorEgressGuardOptions), and connects to an address that check
 * approved and no other: the browser never resolves a name itself, and a
 * name is looked up once, so DNS rebinding finds nothing to rebind. IPv6
 * spellings of IPv4 addresses, decimal, octal and other forms are judged by
 * the address they reach, as the guard always judges them.
 *
 * Behind the operator's outbound proxy (the one the browser always used:
 * HTTPS_PROXY_URL, else HTTP_PROXY_URL, apart from NO_PROXY's hosts), the
 * approved address is what the proxy is asked for - a CONNECT to the
 * address, an absolute URI naming it, a Host header naming what was checked
 * - as HttpMonitorRequest asks it, so the proxy cannot resolve the name, or
 * route on a header, somewhere else. The proxy's own address is the
 * operator's and is not checked.
 *
 * A refused request is answered by this proxy - 403 for an address the
 * policy refuses, 502 for a host that cannot be reached, which for a host
 * name also covers one that resolves to a refused address, so the answer
 * never tells a script which internal names exist - and nothing is sent to
 * the target.
 */

// What a proxy asked for, as the guard's refusals name it.
export interface SyntheticEgressRefusal {
  // "host:port" as the browser asked for it.
  target: string;
  // The guard's sentence, safe to show the project.
  message: string;
}

// An http and an https agent that send one axios request through this proxy.
export interface SyntheticEgressRequestAgents {
  /*
   * Both dial this proxy and nothing else: an absolute-form request for
   * http, a CONNECT for https. Neither depends on the runtime honouring a
   * proxy option (Node 24 ignored http.Agent's proxyEnv and went direct).
   */
  httpAgent: http.Agent;
  httpsAgent: http.Agent;
  /*
   * The first refusal or connection failure this proxy answered the request
   * (and its redirects) with, or undefined: what the script should be told
   * instead of the proxy's own answer.
   */
  takeFailure: () => string | undefined;
  /*
   * How many requests of these agents - the first, and each redirect hop -
   * reached this proxy. A response the caller cannot account for here did
   * not come through the egress checks, and must not be handed back.
   */
  requestsSeen: () => number;
  // Lets the agents and the record go. Call once the request has settled.
  release: () => void;
}

export interface SyntheticEgressProxyOptions {
  // Where requests may go. Absent: public addresses only.
  policy?: MonitorEgressPolicy | undefined;
  /*
   * The operator's outbound proxy, as the supervisor read it (config.proxy).
   * One this proxy cannot read is a fault, never "no proxy": going direct
   * would route around the operator's proxy.
   */
  upstreamProxy?: SyntheticMonitorWorkerProxy | undefined;
  /*
   * How long one connection may take, and how long the outbound proxy may
   * take to answer a CONNECT. SYNTHETIC_EGRESS_CONNECT_TIMEOUT_IN_MS unless
   * a test shortens it.
   */
  connectTimeoutInMs?: number | undefined;
}

// How long one connection - to the target or to the outbound proxy - may take.
export const SYNTHETIC_EGRESS_CONNECT_TIMEOUT_IN_MS: number = 30_000;

/*
 * The header on this proxy's own answer to a browser request it did not
 * send: a token of this proxy's, then the refusal's place in the record.
 *
 * The page can read it: after a refused navigation it sits at the refused
 * origin, and a fetch of its own address is answered by this proxy again,
 * header and all. So a marker proves nothing on its own. It is believed
 * only for the response it was written on (readRefusalMarker): one for the
 * target the refusal was recorded for, recorded during the navigation that
 * asks. A site echoing a marker it was shown names another target, or one
 * recorded before.
 */
export const SYNTHETIC_EGRESS_REFUSAL_HEADER: string =
  "x-oneuptime-egress-refusal";

/*
 * How long an approved host's addresses are reused. Pages open many
 * connections to one host; a browser caches DNS for about a minute itself.
 * A reused answer is an approved answer, so this only spares the resolver.
 */
const APPROVAL_CACHE_TTL_IN_MS: number = 30_000;
const MAX_CACHED_APPROVALS: number = 500;

// Refusals of the browser's requests a check keeps for its report.
export const MAX_RECORDED_BROWSER_REFUSALS: number = 10;

/*
 * Browser requests this proxy did not send, kept so a navigation that
 * failed on one can say why (PlaywrightCapabilityBroker).
 */
const MAX_RECORDED_BROWSER_FAILURES: number = 256;

/*
 * Approved addresses asked of the outbound proxy in turn, when it says it
 * could not reach the one before.
 */
const MAX_UPSTREAM_ADDRESS_ATTEMPTS: number = 4;

// Connections open at once, both sides counted: far above what a browser opens.
const MAX_OPEN_SOCKETS: number = 1_024;

// Browsers send up to 256 KiB of headers; Node's default is 16 KiB.
const MAX_HEADER_BYTES: number = 256 * 1024;
const MAX_UPSTREAM_CONNECT_RESPONSE_BYTES: number = 16 * 1024;

// "host:port" of a CONNECT: a name or IPv4 address, or an IPv6 one in brackets.
const CONNECT_AUTHORITY_PATTERN: RegExp =
  /^(\[[0-9a-fA-F:.]+\]|[^\s/?#@[\]:]+):(\d{1,5})$/;
// An HTTP/1.x status line, its code captured.
const HTTP_STATUS_LINE_PATTERN: RegExp = /^HTTP\/1\.[01] (\d{3})/;
// Basic credentials, as a Proxy-Authorization header carries them.
const BASIC_CREDENTIALS_PATTERN: RegExp = /^Basic\s+([A-Za-z0-9+/=]+)$/i;
// What Node refuses in a reason phrase (its checkInvalidHeaderChar).
const INVALID_REASON_CHARACTERS: RegExp = /[^\t\x20-\x7e\x80-\xff]/g;
// The marker on a refusal: this proxy's token, then the refusal's sequence.
const REFUSAL_MARKER_PATTERN: RegExp = /^([0-9a-f]+)\.(\d{1,15})$/;

const HOP_BY_HOP_HEADERS: ReadonlySet<string> = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/*
 * Through the outbound proxy the Host header goes too: it is set to what the
 * guard checked, never what the client wrote (a proxy may route on it).
 */
const HOP_BY_HOP_AND_HOST_HEADERS: ReadonlySet<string> = new Set([
  ...HOP_BY_HOP_HEADERS,
  "host",
]);

// Headers an Upgrade request keeps: the handshake is relayed as it is.
const UPGRADE_DROPPED_HEADERS: ReadonlySet<string> = new Set([
  "proxy-authorization",
  "proxy-connection",
]);

const DEFAULT_PORTS: Readonly<Record<string, number>> = {
  "http:": 80,
  "ws:": 80,
  "https:": 443,
  "wss:": 443,
};

type Refusal = {
  status: number;
  reason: string;
  message: string;
  // On an answer to the browser: SYNTHETIC_EGRESS_REFUSAL_HEADER's value.
  marker?: string | undefined;
};

// How a request reached this proxy: what a failure of it can be matched to.
export type SyntheticEgressRequestKind = "tunnel" | "request" | "upgrade";

interface BrowserFailure {
  sequence: number;
  target: string;
  kind: SyntheticEgressRequestKind;
  message: string;
}

// A target whose answer the probe could not read (or relay) as HTTP.
class UnreadableResponseError extends Error {}

/*
 * A request this proxy will not send as it was asked: one it cannot read,
 * or one whose Host header would point the outbound proxy elsewhere. Its
 * message is the request's own error.
 */
class RefusedRequestError extends Error {}

/*
 * The outbound proxy answered a CONNECT with a status other than 200: it
 * could not reach that address, or would not. Another approved address may
 * do. A proxy that does not answer at all is not this: it is not asked
 * again, for any address.
 */
class UpstreamTunnelRefusal extends Error {}

type HttpProxyRequest = Parameters<
  HttpProxyAgent<string>["setRequestProps"]
>[0];
type HttpProxyConnectOptions = Parameters<
  HttpProxyAgent<string>["setRequestProps"]
>[1];
type HttpsProxyRequest = Parameters<HttpsProxyAgent<string>["connect"]>[0];
type HttpsProxyConnectOptions = Parameters<
  HttpsProxyAgent<string>["connect"]
>[1];

/*
 * The axios bridge's http agent: each request goes to the egress proxy in
 * absolute form, naming the host and port it was made for.
 *
 * http-proxy-agent builds that URI from the Host header and resolves the
 * path against it as a URL. A path that starts "//" ("//v1/health", the
 * doubled slash of URLs joined from strings) is then a new host, and a Host
 * header the script set sends the request to that host. Here the URI is
 * written out - the request's own host and port, then its path as it is -
 * as Node's own proxy support and HttpMonitorRequest's PinnedHttpProxyAgent
 * write it. A Host header stays a header; the egress proxy decides what
 * becomes of it (forwardRequest).
 */
class EgressHttpProxyAgent extends HttpProxyAgent<string> {
  private readonly proxyAuthorization: string;

  public constructor(proxyUrl: string, tag: string) {
    super(proxyUrl);
    this.proxyAuthorization = `Basic ${Buffer.from(`${tag}:`, "utf8").toString("base64")}`;
  }

  public override setRequestProps(
    request: HttpProxyRequest,
    options: HttpProxyConnectOptions,
  ): void {
    const host: string = String(options.host || "");
    const port: number = Number(options.port) || 80;
    const authority: string = net.isIPv6(host) ? `[${host}]` : host;
    const path: string = request.path.startsWith("/")
      ? request.path
      : `/${request.path}`;

    request.path = `http://${authority}${port === 80 ? "" : `:${port}`}${path}`;
    request.setHeader("Proxy-Authorization", this.proxyAuthorization);
    request.setHeader("Proxy-Connection", "close");
  }
}

/*
 * The axios bridge's https agent: a CONNECT to the egress proxy, then TLS
 * with the target, its certificate checked against the target's own host.
 *
 * Inside a tunnel tls.connect has no host of its own: with no servername it
 * checks the certificate against the name the socket was opened with - the
 * proxy - or "localhost". An IP target sets no servername (SNI names hosts,
 * never addresses), so https://93.184.215.14/ failed against a certificate
 * that names 93.184.215.14. As HttpMonitorRequest's PinnedHttpsProxyAgent
 * does, the certificate is checked against the target, name or address.
 */
class EgressHttpsProxyAgent extends HttpsProxyAgent<string> {
  public override connect(
    request: HttpsProxyRequest,
    options: HttpsProxyConnectOptions,
  ): ReturnType<HttpsProxyAgent<string>["connect"]> {
    const targetHost: string = String(options.host || "");

    return super.connect(request, {
      ...options,
      // An empty servername sends no SNI, and stops one being filled in.
      servername: net.isIP(targetHost) === 0 ? targetHost : "",
      checkServerIdentity: (
        _hostname: string,
        certificate: tls.PeerCertificate,
      ): Error | undefined => {
        return tls.checkServerIdentity(targetHost, certificate);
      },
    } as HttpsProxyConnectOptions);
  }
}

export default class SyntheticEgressProxy {
  private readonly policy: MonitorEgressPolicy;
  private readonly guardOptions: EgressGuardOptions;
  private readonly upstream: URL | null;
  private readonly upstreamAuthorization: string | null;
  private readonly upstreamNoProxy: string;
  private readonly connectTimeoutInMs: number;
  private readonly refusalMarkerToken: string = crypto
    .randomBytes(12)
    .toString("hex");
  private server: http.Server | null = null;
  private port: number = 0;
  private isClosed: boolean = false;
  private readonly sockets: Set<Duplex> = new Set<Duplex>();
  private readonly approvals: Map<
    string,
    { addresses: Promise<Array<ResolvedAddress>>; expiresAtInMs: number }
  > = new Map();
  // Each axios request's tag, and how many of its requests came here.
  private readonly requestTags: Map<string, number> = new Map<string, number>();
  private readonly requestFailures: Map<string, string> = new Map<
    string,
    string
  >();
  private readonly browserRefusals: Array<SyntheticEgressRefusal> = [];
  private readonly browserFailures: Array<BrowserFailure> = [];
  private browserFailureSequence: number = 0;

  public constructor(options: SyntheticEgressProxyOptions = {}) {
    this.policy = options.policy || PUBLIC_ONLY_MONITOR_EGRESS_POLICY;
    this.guardOptions = MonitorEgressGuardOptions.forPolicy(this.policy);

    const upstream: SyntheticMonitorWorkerProxy | undefined =
      options.upstreamProxy;
    this.upstream = upstream
      ? SyntheticEgressProxy.readUpstream(upstream)
      : null;
    this.upstreamAuthorization = upstream
      ? SyntheticEgressProxy.readUpstreamAuthorization(upstream)
      : null;
    this.upstreamNoProxy = upstream?.bypass || "";
    this.connectTimeoutInMs =
      options.connectTimeoutInMs || SYNTHETIC_EGRESS_CONNECT_TIMEOUT_IN_MS;
  }

  public getPolicy(): MonitorEgressPolicy {
    return { ...this.policy };
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    if (this.isClosed) {
      throw new Error("The synthetic egress proxy has been closed.");
    }

    const server: http.Server = http.createServer(
      { maxHeaderSize: MAX_HEADER_BYTES },
      (request: IncomingMessage, response: ServerResponse): void => {
        void this.forwardRequest(request, response);
      },
    );

    server.on("connection", (socket: net.Socket): void => {
      if (!this.track(socket)) {
        socket.destroy();
      }
    });
    server.on(
      "connect",
      (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
        void this.forwardTunnel(request, socket, head);
      },
    );
    server.on(
      "upgrade",
      (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
        void this.forwardUpgrade(request, socket, head);
      },
    );
    server.on("clientError", (_error: Error, socket: Duplex): void => {
      socket.destroy();
    });

    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void): void => {
        server.once("error", reject);
        // Loopback only: nothing off this machine may use it.
        server.listen(0, "127.0.0.1", (): void => {
          server.removeListener("error", reject);
          resolve();
        });
      },
    );

    // Never what keeps a worker process alive.
    server.unref();
    this.server = server;
    this.port = (server.address() as net.AddressInfo).port;
  }

  // The proxy's URL, for the browser: http://127.0.0.1:<port>.
  public getProxyServer(): string {
    return `http://127.0.0.1:${this.getPort()}`;
  }

  public getPort(): number {
    if (!this.server) {
      throw new Error("The synthetic egress proxy has not been started.");
    }

    return this.port;
  }

  /*
   * Agents that send one axios request - and every redirect it follows -
   * through this proxy, tagged so its refusals can be told back to the
   * script as an error of its own rather than as the proxy's answer.
   */
  public createRequestAgents(): SyntheticEgressRequestAgents {
    const port: number = this.getPort();
    const tag: string = crypto.randomBytes(16).toString("hex");
    // The tag travels as the proxy user name (Proxy-Authorization).
    const proxyUrl: string = `http://${tag}:@127.0.0.1:${port}`;
    const httpAgent: HttpProxyAgent<string> = new EgressHttpProxyAgent(
      proxyUrl,
      tag,
    );
    const httpsAgent: HttpsProxyAgent<string> = new EgressHttpsProxyAgent(
      proxyUrl,
    );

    this.requestTags.set(tag, 0);

    return {
      httpAgent,
      httpsAgent,
      takeFailure: (): string | undefined => {
        return this.requestFailures.get(tag);
      },
      requestsSeen: (): number => {
        return this.requestTags.get(tag) || 0;
      },
      release: (): void => {
        httpAgent.destroy();
        httpsAgent.destroy();
        this.requestTags.delete(tag);
        this.requestFailures.delete(tag);
      },
    };
  }

  // The browser's requests this proxy refused, first ones first.
  public getBrowserRefusals(): Array<SyntheticEgressRefusal> {
    return this.browserRefusals.map(
      (refusal: SyntheticEgressRefusal): SyntheticEgressRefusal => {
        return { ...refusal };
      },
    );
  }

  /*
   * Where the record of the browser's requests this proxy did not send
   * stands now: what a navigation started after can be told apart by.
   */
  public getBrowserFailureSequence(): number {
    return this.browserFailureSequence;
  }

  /*
   * Why this proxy did not send the browser's latest request of `kind` to
   * `target` ("host:port", as targetOfUrl writes it) since `afterSequence`,
   * or undefined when it sent every one.
   */
  public findBrowserFailure(data: {
    afterSequence: number;
    target: string;
    kind: SyntheticEgressRequestKind;
  }): string | undefined {
    for (
      let index: number = this.browserFailures.length - 1;
      index >= 0;
      index--
    ) {
      const failure: BrowserFailure = this.browserFailures[index]!;
      if (failure.sequence <= data.afterSequence) {
        return undefined;
      }
      if (failure.target === data.target && failure.kind === data.kind) {
        return failure.message;
      }
    }
    return undefined;
  }

  /*
   * Why this proxy answered a browser request itself, read from the
   * SYNTHETIC_EGRESS_REFUSAL_HEADER on the response to `url`, or undefined
   * unless this proxy wrote that marker on that response: for the target
   * `url` names, since `afterSequence`. A marker a page read and a site
   * echoed back is not believed (see SYNTHETIC_EGRESS_REFUSAL_HEADER).
   */
  public readRefusalMarker(data: {
    value: string | undefined;
    url: string;
    afterSequence: number;
  }): string | undefined {
    const match: RegExpExecArray | null = REFUSAL_MARKER_PATTERN.exec(
      (data.value || "").trim(),
    );

    if (!match || match[1] !== this.refusalMarkerToken) {
      return undefined;
    }

    const sequence: number = Number.parseInt(match[2]!, 10);
    const target: string | null = SyntheticEgressProxy.targetOfUrl(data.url);

    if (sequence <= data.afterSequence || target === null) {
      return undefined;
    }

    return this.browserFailures.find((failure: BrowserFailure) => {
      return failure.sequence === sequence && failure.target === target;
    })?.message;
  }

  /*
   * The "host:port" this proxy files a request to `url` under, or null for a
   * URL it would never be asked for.
   */
  public static targetOfUrl(value: string): string | null {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      return null;
    }

    const port: number =
      url.port === ""
        ? DEFAULT_PORTS[url.protocol] || 0
        : Number.parseInt(url.port, 10);

    if (!url.hostname || !(port >= 1)) {
      return null;
    }

    return SyntheticEgressProxy.formatAuthority(
      SyntheticEgressProxy.bareHost(url.hostname),
      port,
    );
  }

  /*
   * A run's log with a line for each request of the browser this proxy
   * refused, as far as the log's limits leave room. The browser reports a
   * refused https request only as a failed tunnel, so without these lines
   * a check that used to reach a private site would fail without saying
   * why, or which setting would let it.
   */
  public static withRefusalNotes(
    logMessages: Array<string>,
    refusals: Array<SyntheticEgressRefusal>,
  ): Array<string> {
    const result: Array<string> = [...logMessages];
    let bytes: number = result.reduce((total: number, message: string) => {
      return total + Buffer.byteLength(message, "utf8");
    }, 0);

    for (const refusal of refusals) {
      const note: string = `The probe did not send the browser's request to ${refusal.target}: ${refusal.message}`;
      const noteBytes: number = Buffer.byteLength(note, "utf8");

      if (
        result.length >= MAX_SANDBOX_LOG_MESSAGES ||
        bytes + noteBytes > MAX_SANDBOX_LOG_BYTES
      ) {
        break;
      }

      result.push(note);
      bytes += noteBytes;
    }

    return result;
  }

  public async close(): Promise<void> {
    this.isClosed = true;
    const server: http.Server | null = this.server;
    this.server = null;

    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    if (!server) {
      return;
    }

    server.closeAllConnections();
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
    });
  }

  /*
   * A CONNECT: an https or wss connection, or a ws one, as browsers send
   * those through a proxy. The bytes inside the tunnel are the browser's
   * TLS with the host it named, so the certificate is still checked against
   * that name.
   */
  private async forwardTunnel(
    request: IncomingMessage,
    clientSocket: Duplex,
    head: Buffer,
  ): Promise<void> {
    clientSocket.on("error", (): void => {
      // The browser went away; the tunnel, if any, follows below.
    });
    const tag: string | null = this.readTag(request);
    const target: { hostname: string; port: number } | null =
      SyntheticEgressProxy.parseAuthority(request.url || "");

    if (!target) {
      this.writeRefusal(
        clientSocket,
        this.refuse({
          tag,
          kind: "tunnel",
          target: SyntheticEgressProxy.unreadableTarget(request.url),
          hostname: "",
          error: new RefusedRequestError(
            "The probe could not read the host and port this request was sent to.",
          ),
        }),
      );
      return;
    }

    const targetName: string = SyntheticEgressProxy.formatAuthority(
      target.hostname,
      target.port,
    );
    let upstreamSocket: net.Socket;

    try {
      const addresses: Array<ResolvedAddress> = await this.approve(
        target.hostname,
      );
      upstreamSocket = await this.connect({
        hostname: target.hostname,
        port: target.port,
        addresses,
        url: new URL(`https://${targetName}/`),
      });
    } catch (error: unknown) {
      this.writeRefusal(
        clientSocket,
        this.refuse({
          tag,
          kind: "tunnel",
          target: targetName,
          hostname: target.hostname,
          error,
        }),
      );
      return;
    }

    if (clientSocket.destroyed || this.isClosed) {
      upstreamSocket.destroy();
      return;
    }

    if (!this.track(upstreamSocket)) {
      upstreamSocket.destroy();
      clientSocket.destroy();
      return;
    }

    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

    if (head.length > 0) {
      upstreamSocket.write(head);
    }

    SyntheticEgressProxy.splice(clientSocket, upstreamSocket);
  }

  /*
   * An absolute-form http request ("GET http://host/path"), which a browser
   * sends a proxy for a plain-http URL. Each one is checked and sent on a
   * connection of its own: a browser reuses one connection to its proxy for
   * many hosts.
   */
  private async forwardRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const tag: string | null = this.readTag(request);
    const target: URL | null = SyntheticEgressProxy.parseAbsoluteUrl(
      request.url || "",
      ["http:"],
    );

    if (!target) {
      SyntheticEgressProxy.respondWithRefusal(
        response,
        this.refuse({
          tag,
          kind: "request",
          target: SyntheticEgressProxy.unreadableTarget(request.url),
          hostname: "",
          error: new RefusedRequestError(
            "The probe could not read the address this request was sent to.",
          ),
        }),
      );
      request.resume();
      return;
    }

    const hostname: string = SyntheticEgressProxy.bareHost(target.hostname);
    const port: number = Number.parseInt(target.port, 10) || 80;
    const targetName: string = SyntheticEgressProxy.formatAuthority(
      hostname,
      port,
    );
    let addresses: Array<ResolvedAddress>;

    try {
      addresses = await this.approve(hostname);
    } catch (error: unknown) {
      SyntheticEgressProxy.respondWithRefusal(
        response,
        this.refuse({
          tag,
          kind: "request",
          target: targetName,
          hostname,
          error,
        }),
      );
      request.resume();
      return;
    }

    const upstream: URL | null = this.getUpstreamFor(target);
    const hostHeader: string | undefined = SyntheticEgressProxy.readHostHeader(
      request.rawHeaders,
    );

    /*
     * Directly, a Host header the client set is sent as it is, to the
     * address its URL names, as main sent axios's. Through the outbound
     * proxy one that names another host is refused, as Node's own proxy
     * support refuses it: a proxy may route on Host, and would then be
     * pointed somewhere the guard never checked.
     */
    if (
      upstream &&
      hostHeader !== undefined &&
      !SyntheticEgressProxy.namesSameAuthority(hostHeader, target)
    ) {
      SyntheticEgressProxy.respondWithRefusal(
        response,
        this.refuse({
          tag,
          kind: "request",
          target: targetName,
          hostname,
          error: new RefusedRequestError(
            `The probe did not send this request: through its outbound proxy, the Host header must name the host the URL names (${target.host}).`,
          ),
        }),
      );
      request.resume();
      return;
    }

    const pathAndQuery: string = `${target.pathname}${target.search}`;
    const headers: Array<string> = SyntheticEgressProxy.forwardableHeaders(
      request.rawHeaders,
      upstream ? HOP_BY_HOP_AND_HOST_HEADERS : HOP_BY_HOP_HEADERS,
    );

    if (
      upstream ||
      (!SyntheticEgressProxy.hasHeader(headers, "host") &&
        target.host.length > 0)
    ) {
      /*
       * Through the outbound proxy, always the authority the guard checked:
       * a proxy that routes on Host must not be pointed elsewhere by it.
       */
      headers.push("Host", target.host);
    }

    if (upstream && this.upstreamAuthorization) {
      headers.push("Proxy-Authorization", this.upstreamAuthorization);
    }

    /*
     * Once this proxy has answered the request itself, nothing that follows
     * - a late error from the target's side - answers it again.
     */
    let answeredByProxy: boolean = false;
    const answerByProxy: (error: unknown) => void = (error: unknown): void => {
      if (answeredByProxy) {
        return;
      }
      answeredByProxy = true;

      if (response.headersSent) {
        // The target's answer had begun: it is cut short, not replaced.
        response.destroy();
        return;
      }

      SyntheticEgressProxy.respondWithRefusal(
        response,
        this.refuse({
          tag,
          kind: "request",
          target: targetName,
          hostname,
          error,
        }),
      );
    };

    let outgoing: http.ClientRequest;

    try {
      outgoing = http.request({
        method: request.method,
        /*
         * Through the outbound proxy, the absolute URI names the approved
         * address, so the proxy is never asked to resolve the name.
         */
        path: upstream
          ? `http://${SyntheticEgressProxy.formatAuthority(SyntheticEgressProxy.inUpstreamOrder(addresses)[0]!.address, port)}${pathAndQuery}`
          : pathAndQuery,
        headers,
        setHost: false,
        maxHeaderSize: MAX_HEADER_BYTES,
        createConnection: (
          _options: unknown,
          onCreate: (error: Error | null, socket: Duplex) => void,
        ): undefined => {
          const connecting: Promise<net.Socket> = upstream
            ? this.connectToUpstream(upstream)
            : this.connectDirectly({ hostname, port, addresses });

          connecting.then(
            (socket: net.Socket): void => {
              if (!this.track(socket)) {
                socket.destroy();
                onCreate(new Error("Too many open connections."), socket);
                return;
              }
              onCreate(null, socket);
            },
            (error: Error): void => {
              onCreate(error, undefined as unknown as Duplex);
            },
          );

          return undefined;
        },
      } as http.RequestOptions);
    } catch (error: unknown) {
      answerByProxy(error);
      request.resume();
      return;
    }

    outgoing.on("response", (incoming: IncomingMessage): void => {
      if (answeredByProxy) {
        incoming.resume();
        return;
      }

      const status: number | undefined = incoming.statusCode;

      /*
       * A status or reason phrase Node will not write again must never be
       * what ends the worker: it is the target's fault, answered 502.
       */
      if (
        status === undefined ||
        !Number.isInteger(status) ||
        status < 100 ||
        status > 999
      ) {
        answerByProxy(new UnreadableResponseError());
        outgoing.destroy();
        return;
      }

      const responseHeaders: Array<string> =
        SyntheticEgressProxy.forwardableHeaders(
          incoming.rawHeaders,
          HOP_BY_HOP_HEADERS,
        );

      try {
        response.writeHead(
          status,
          SyntheticEgressProxy.readableReason(incoming.statusMessage),
          responseHeaders,
        );
      } catch {
        answerByProxy(new UnreadableResponseError());
        outgoing.destroy();
        return;
      }

      incoming.on("error", (): void => {
        response.destroy();
      });
      incoming.pipe(response);
    });

    outgoing.on("error", (error: Error): void => {
      answerByProxy(error);
    });

    response.on("close", (): void => {
      if (!response.writableFinished) {
        outgoing.destroy();
      }
    });

    request.pipe(outgoing);
  }

  /*
   * An absolute-form Upgrade request (a ws:// WebSocket), for a client that
   * sends one to a proxy rather than a CONNECT. The handshake and everything
   * after it are relayed as they are once the target is approved.
   */
  private async forwardUpgrade(
    request: IncomingMessage,
    clientSocket: Duplex,
    head: Buffer,
  ): Promise<void> {
    clientSocket.on("error", (): void => {
      // The client went away; the upstream side follows below.
    });
    const tag: string | null = this.readTag(request);
    const target: URL | null = SyntheticEgressProxy.parseAbsoluteUrl(
      request.url || "",
      ["http:", "ws:"],
    );

    if (!target) {
      this.writeRefusal(
        clientSocket,
        this.refuse({
          tag,
          kind: "upgrade",
          target: SyntheticEgressProxy.unreadableTarget(request.url),
          hostname: "",
          error: new RefusedRequestError(
            "The probe could not read the address this request was sent to.",
          ),
        }),
      );
      return;
    }

    const hostname: string = SyntheticEgressProxy.bareHost(target.hostname);
    const port: number = Number.parseInt(target.port, 10) || 80;
    const targetName: string = SyntheticEgressProxy.formatAuthority(
      hostname,
      port,
    );
    let upstreamSocket: net.Socket;

    try {
      const addresses: Array<ResolvedAddress> = await this.approve(hostname);
      upstreamSocket = await this.connect({
        hostname,
        port,
        addresses,
        url: new URL(`http://${targetName}/`),
      });
    } catch (error: unknown) {
      this.writeRefusal(
        clientSocket,
        this.refuse({
          tag,
          kind: "upgrade",
          target: targetName,
          hostname,
          error,
        }),
      );
      return;
    }

    if (clientSocket.destroyed || !this.track(upstreamSocket)) {
      upstreamSocket.destroy();
      clientSocket.destroy();
      return;
    }

    const headers: Array<string> = SyntheticEgressProxy.forwardableHeaders(
      request.rawHeaders,
      UPGRADE_DROPPED_HEADERS,
    );
    let handshake: string = `${request.method || "GET"} ${target.pathname}${target.search} HTTP/1.1\r\n`;

    for (let index: number = 0; index + 1 < headers.length; index += 2) {
      handshake += `${headers[index]}: ${headers[index + 1]}\r\n`;
    }

    upstreamSocket.write(`${handshake}\r\n`);

    if (head.length > 0) {
      upstreamSocket.write(head);
    }

    SyntheticEgressProxy.splice(clientSocket, upstreamSocket);
  }

  /*
   * The addresses the egress guard approves for `hostname` under this
   * check's policy. Throws the guard's refusal. An approval is reused for a
   * short while, so a host's connections share one lookup.
   */
  private async approve(hostname: string): Promise<Array<ResolvedAddress>> {
    const key: string = hostname.toLowerCase();
    const nowInMs: number = Date.now();
    const cached:
      | { addresses: Promise<Array<ResolvedAddress>>; expiresAtInMs: number }
      | undefined = this.approvals.get(key);

    if (cached && cached.expiresAtInMs > nowInMs) {
      return await cached.addresses;
    }

    const pending: Promise<Array<ResolvedAddress>> =
      DataSourceEgressGuard.assertHostnameAllowed(hostname, this.guardOptions);

    if (this.approvals.size >= MAX_CACHED_APPROVALS) {
      const oldest: string | undefined = this.approvals.keys().next().value;
      if (oldest !== undefined) {
        this.approvals.delete(oldest);
      }
    }

    this.approvals.set(key, {
      addresses: pending,
      expiresAtInMs: nowInMs + APPROVAL_CACHE_TTL_IN_MS,
    });

    try {
      return await pending;
    } catch (error: unknown) {
      if (this.approvals.get(key)?.addresses === pending) {
        this.approvals.delete(key);
      }
      throw error;
    }
  }

  // A connection to an approved target: directly, or through the outbound proxy.
  private async connect(data: {
    hostname: string;
    port: number;
    addresses: Array<ResolvedAddress>;
    url: URL;
  }): Promise<net.Socket> {
    const upstream: URL | null = this.getUpstreamFor(data.url);

    if (!upstream) {
      return await this.connectDirectly(data);
    }

    return await this.tunnelThroughUpstreamToAny({
      upstream,
      addresses: data.addresses,
      port: data.port,
    });
  }

  /*
   * Dials the approved addresses and nothing else. A name is answered from
   * the approval (a pinned lookup), never looked up again; an IP address is
   * dialled as written, which is what was approved. Every approved address
   * of a name is tried in turn (autoSelectFamily, RFC 8305), so an IPv6
   * answer first on a network with no IPv6 route still connects over IPv4.
   */
  private async connectDirectly(data: {
    hostname: string;
    port: number;
    addresses: Array<ResolvedAddress>;
  }): Promise<net.Socket> {
    const socket: net.Socket = net.connect({
      host: data.hostname,
      port: data.port,
      lookup: DataSourceEgressGuard.createPinnedLookup(
        data.addresses,
      ) as unknown as net.LookupFunction,
      autoSelectFamily: true,
    });

    return await SyntheticEgressProxy.whenConnected(
      socket,
      "connect",
      this.connectTimeoutInMs,
    );
  }

  // A connection to the outbound proxy itself, the operator's to trust.
  private async connectToUpstream(upstream: URL): Promise<net.Socket> {
    const host: string = SyntheticEgressProxy.bareHost(upstream.hostname);
    const isTls: boolean = upstream.protocol === "https:";
    const port: number =
      Number.parseInt(upstream.port, 10) || (isTls ? 443 : 80);
    const socket: net.Socket = isTls
      ? tls.connect({
          host,
          port,
          ...(net.isIP(host) === 0 ? { servername: host } : {}),
        })
      : net.connect({ host, port });

    return await SyntheticEgressProxy.whenConnected(
      socket,
      isTls ? "secureConnect" : "connect",
      this.connectTimeoutInMs,
    );
  }

  /*
   * A tunnel through the outbound proxy to one of the approved addresses,
   * IPv4 first, the next one asked for when the proxy answers that it could
   * not open the last (a status other than 200). A proxy that cannot itself
   * be reached, closes the CONNECT or does not answer it in time is not
   * asked again, for any address: a hung proxy holds a tunnel for one
   * timeout, not one per address.
   */
  private async tunnelThroughUpstreamToAny(data: {
    upstream: URL;
    addresses: Array<ResolvedAddress>;
    port: number;
  }): Promise<net.Socket> {
    const candidates: Array<ResolvedAddress> =
      SyntheticEgressProxy.inUpstreamOrder(data.addresses).slice(
        0,
        MAX_UPSTREAM_ADDRESS_ATTEMPTS,
      );
    let lastError: unknown = new Error("No approved address to connect to.");

    for (const address of candidates) {
      try {
        return await this.tunnelThroughUpstream({
          upstream: data.upstream,
          address,
          port: data.port,
        });
      } catch (error: unknown) {
        lastError = error;

        if (!(error instanceof UpstreamTunnelRefusal)) {
          break;
        }
      }
    }

    throw lastError;
  }

  // A CONNECT tunnel through the outbound proxy to the approved address.
  private async tunnelThroughUpstream(data: {
    upstream: URL;
    address: ResolvedAddress;
    port: number;
  }): Promise<net.Socket> {
    const socket: net.Socket = await this.connectToUpstream(data.upstream);
    const authority: string = SyntheticEgressProxy.formatAuthority(
      data.address.address,
      data.port,
    );

    return await new Promise<net.Socket>(
      (
        resolve: (socket: net.Socket) => void,
        reject: (error: Error) => void,
      ): void => {
        let received: Buffer = Buffer.alloc(0);
        const timer: NodeJS.Timeout = setTimeout((): void => {
          fail(new Error("The outbound proxy did not answer the CONNECT."));
        }, this.connectTimeoutInMs);
        timer.unref?.();

        const cleanUp: () => void = (): void => {
          clearTimeout(timer);
          socket.removeListener("data", onData);
          socket.removeListener("error", fail);
          socket.removeListener("close", onClose);
        };
        const fail: (error: Error) => void = (error: Error): void => {
          cleanUp();
          socket.destroy();
          reject(error);
        };
        const onClose: () => void = (): void => {
          fail(new Error("The outbound proxy closed the CONNECT."));
        };
        const onData: (chunk: Buffer) => void = (chunk: Buffer): void => {
          received = Buffer.concat([received, chunk]);
          const end: number = received.indexOf("\r\n\r\n");

          if (end === -1) {
            if (received.byteLength > MAX_UPSTREAM_CONNECT_RESPONSE_BYTES) {
              fail(new Error("The outbound proxy's answer was too long."));
            }
            return;
          }

          const statusLine: string = received
            .subarray(0, received.indexOf("\r\n"))
            .toString("latin1");
          const status: RegExpExecArray | null =
            HTTP_STATUS_LINE_PATTERN.exec(statusLine);

          if (!status) {
            fail(new Error("The outbound proxy's answer was not HTTP."));
            return;
          }

          if (status[1] !== "200") {
            fail(
              new UpstreamTunnelRefusal(
                `The outbound proxy refused the CONNECT (${status[1]}).`,
              ),
            );
            return;
          }

          cleanUp();
          socket.pause();
          const rest: Buffer = received.subarray(end + 4);
          if (rest.byteLength > 0) {
            socket.unshift(rest);
          }
          resolve(socket);
        };

        socket.on("data", onData);
        socket.once("error", fail);
        socket.once("close", onClose);
        socket.write(
          `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${
            this.upstreamAuthorization
              ? `Proxy-Authorization: ${this.upstreamAuthorization}\r\n`
              : ""
          }\r\n`,
        );
      },
    );
  }

  /*
   * The outbound proxy a request to `url` goes through, or null to go
   * directly: no proxy is set, or NO_PROXY names the host.
   */
  private getUpstreamFor(url: URL): URL | null {
    if (!this.upstream) {
      return null;
    }

    if (OutboundProxy.isNamedByNoProxy(url, this.upstreamNoProxy)) {
      return null;
    }

    return this.upstream;
  }

  /*
   * The answer to a request that will not be sent - the guard refused its
   * host, or it could not be reached - recorded for whoever asked: an axios
   * request by its tag, the browser in its lists.
   */
  private refuse(data: {
    tag: string | null;
    kind: SyntheticEgressRequestKind;
    target: string;
    hostname: string;
    error: unknown;
  }): Refusal {
    const isGuardRefusal: boolean = data.error instanceof EgressGuardException;
    let message: string = `${MONITOR_TARGET_LABEL} host ${data.hostname} could not be reached.`;
    let status: number = 502;
    let reason: string = "Bad Gateway";

    if (isGuardRefusal) {
      const guardError: EgressGuardException =
        data.error as EgressGuardException;
      message = guardError.message;

      if (guardError.reason === EgressFailureReason.InvalidTarget) {
        status = 400;
        reason = "Bad Request";
      } else if (guardError.reason === EgressFailureReason.AddressBlocked) {
        status = 403;
        reason = "Forbidden";
      }
    } else if (data.error instanceof UnreadableResponseError) {
      message = `${MONITOR_TARGET_LABEL} host ${data.hostname} sent a response the probe could not read.`;
    } else if (data.error instanceof RefusedRequestError) {
      message = data.error.message;
      status = 400;
      reason = "Bad Request";
    }

    if (data.tag) {
      if (!this.requestFailures.has(data.tag)) {
        this.requestFailures.set(data.tag, message);
      }
      return { status, reason, message };
    }

    if (
      isGuardRefusal &&
      this.browserRefusals.length < MAX_RECORDED_BROWSER_REFUSALS &&
      !this.browserRefusals.some((refusal: SyntheticEgressRefusal) => {
        return refusal.target === data.target;
      })
    ) {
      this.browserRefusals.push({ target: data.target, message });
    }

    return {
      status,
      reason,
      message,
      marker: this.recordBrowserFailure(data.kind, data.target, message),
    };
  }

  // Files a browser request this proxy did not send; returns its marker.
  private recordBrowserFailure(
    kind: SyntheticEgressRequestKind,
    target: string,
    message: string,
  ): string {
    this.browserFailureSequence += 1;
    this.browserFailures.push({
      sequence: this.browserFailureSequence,
      target,
      kind,
      message,
    });

    if (this.browserFailures.length > MAX_RECORDED_BROWSER_FAILURES) {
      this.browserFailures.shift();
    }

    return `${this.refusalMarkerToken}.${this.browserFailureSequence}`;
  }

  /*
   * The tag of an axios request (its proxy user name), or null: the browser.
   * Every request a tag is seen on is counted for it.
   */
  private readTag(request: IncomingMessage): string | null {
    const header: string | undefined = request.headers["proxy-authorization"];
    const basic: RegExpExecArray | null = BASIC_CREDENTIALS_PATTERN.exec(
      header || "",
    );

    if (!basic) {
      return null;
    }

    const credentials: string = Buffer.from(basic[1]!, "base64").toString(
      "utf8",
    );
    const separator: number = credentials.indexOf(":");
    const tag: string =
      separator === -1 ? credentials : credentials.slice(0, separator);
    const seen: number | undefined = this.requestTags.get(tag);

    if (seen === undefined) {
      return null;
    }

    this.requestTags.set(tag, seen + 1);
    return tag;
  }

  private track(socket: Duplex): boolean {
    if (this.isClosed || this.sockets.size >= MAX_OPEN_SOCKETS) {
      return false;
    }

    this.sockets.add(socket);
    socket.once("close", (): void => {
      this.sockets.delete(socket);
    });
    return true;
  }

  private writeRefusal(socket: Duplex, refusal: Refusal): void {
    if (socket.destroyed) {
      return;
    }

    const body: Buffer = Buffer.from(refusal.message, "utf8");
    socket.end(
      Buffer.concat([
        Buffer.from(
          `HTTP/1.1 ${refusal.status} ${refusal.reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.byteLength}\r\n${
            refusal.marker
              ? `${SYNTHETIC_EGRESS_REFUSAL_HEADER}: ${refusal.marker}\r\n`
              : ""
          }Connection: close\r\n\r\n`,
          "latin1",
        ),
        body,
      ]),
    );
  }

  private static respondWithRefusal(
    response: ServerResponse,
    refusal: Refusal,
  ): void {
    if (response.headersSent) {
      response.destroy();
      return;
    }

    response.writeHead(refusal.status, refusal.reason, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(refusal.message, "utf8"),
      ...(refusal.marker
        ? { [SYNTHETIC_EGRESS_REFUSAL_HEADER]: refusal.marker }
        : {}),
      Connection: "close",
    });
    response.end(refusal.message);
  }

  private static async whenConnected(
    socket: net.Socket,
    event: "connect" | "secureConnect",
    timeoutInMs: number,
  ): Promise<net.Socket> {
    return await new Promise<net.Socket>(
      (
        resolve: (socket: net.Socket) => void,
        reject: (error: Error) => void,
      ): void => {
        const timer: NodeJS.Timeout = setTimeout((): void => {
          onError(new Error("The connection timed out."));
        }, timeoutInMs);
        timer.unref?.();

        const onConnect: () => void = (): void => {
          clearTimeout(timer);
          socket.removeListener("error", onError);
          resolve(socket);
        };
        const onError: (error: Error) => void = (error: Error): void => {
          clearTimeout(timer);
          socket.removeListener(event, onConnect);
          socket.destroy();
          reject(error);
        };

        socket.once(event, onConnect);
        socket.once("error", onError);
      },
    );
  }

  /*
   * Relays two connections into each other until either ends; an error or a
   * close on one side takes the other down.
   */
  private static splice(first: Duplex, second: Duplex): void {
    first.on("error", (): void => {
      second.destroy();
    });
    second.on("error", (): void => {
      first.destroy();
    });
    first.once("close", (): void => {
      second.destroy();
    });
    second.once("close", (): void => {
      first.destroy();
    });
    first.pipe(second);
    second.pipe(first);
  }

  // "host:port" from a CONNECT request, or null when it names no such thing.
  private static parseAuthority(
    authority: string,
  ): { hostname: string; port: number } | null {
    const match: RegExpExecArray | null =
      CONNECT_AUTHORITY_PATTERN.exec(authority);

    if (!match) {
      return null;
    }

    const port: number = Number.parseInt(match[2]!, 10);

    if (port < 1 || port > 65535) {
      return null;
    }

    let hostname: string;

    try {
      // WHATWG's reading, as the browser's: shorthand IPv4 forms are canonical.
      hostname = new URL(`http://${match[1]}/`).hostname;
    } catch {
      return null;
    }

    hostname = SyntheticEgressProxy.bareHost(hostname);

    return hostname ? { hostname, port } : null;
  }

  private static parseAbsoluteUrl(
    value: string,
    protocols: Array<string>,
  ): URL | null {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      return null;
    }

    if (
      !protocols.includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password ||
      // Port 0 reaches nothing; it is never read as the default.
      url.port === "0"
    ) {
      return null;
    }

    return url;
  }

  private static bareHost(hostname: string): string {
    return hostname.replace(/^\[|\]$/g, "");
  }

  // "host:port", an IPv6 address in brackets.
  private static formatAuthority(host: string, port: number): string {
    return net.isIPv6(host) ? `[${host}]:${port}` : `${host}:${port}`;
  }

  /*
   * The approved addresses in the order the outbound proxy is asked for
   * them: IPv4 first, as an operator's proxy often has no IPv6 route.
   */
  private static inUpstreamOrder(
    addresses: Array<ResolvedAddress>,
  ): Array<ResolvedAddress> {
    return [
      ...addresses.filter((address: ResolvedAddress) => {
        return address.family === 4;
      }),
      ...addresses.filter((address: ResolvedAddress) => {
        return address.family !== 4;
      }),
    ];
  }

  // A reason phrase Node will write: what the target sent, less what it refuses.
  private static readableReason(reason: string | undefined): string {
    return (reason || "").replace(INVALID_REASON_CHARACTERS, "");
  }

  /*
   * A message's raw headers ([name, value, name, value, ...]) without the
   * ones `dropped` names, the ones its Connection header names, and any
   * Node would refuse to send on.
   */
  private static forwardableHeaders(
    rawHeaders: Array<string>,
    dropped: ReadonlySet<string>,
  ): Array<string> {
    const connectionTokens: Set<string> = new Set<string>();

    if (dropped.has("connection")) {
      for (let index: number = 0; index + 1 < rawHeaders.length; index += 2) {
        if (rawHeaders[index]!.toLowerCase() === "connection") {
          for (const token of rawHeaders[index + 1]!.split(",")) {
            connectionTokens.add(token.trim().toLowerCase());
          }
        }
      }
    }

    const result: Array<string> = [];

    for (let index: number = 0; index + 1 < rawHeaders.length; index += 2) {
      const name: string = rawHeaders[index]!;
      const value: string = rawHeaders[index + 1]!;
      const lowerName: string = name.toLowerCase();

      if (dropped.has(lowerName) || connectionTokens.has(lowerName)) {
        continue;
      }

      try {
        http.validateHeaderName(name);
        http.validateHeaderValue(name, value);
      } catch {
        continue;
      }

      result.push(name, value);
    }

    return result;
  }

  // The Host header a request carries, or undefined when it has none.
  private static readHostHeader(rawHeaders: Array<string>): string | undefined {
    for (let index: number = 0; index + 1 < rawHeaders.length; index += 2) {
      if (rawHeaders[index]!.toLowerCase() === "host") {
        return rawHeaders[index + 1]!;
      }
    }
    return undefined;
  }

  /*
   * Whether a Host header names the host and port `url` names, written as
   * a URL would write them: "Example.com:80" names http://example.com/.
   */
  private static namesSameAuthority(hostHeader: string, url: URL): boolean {
    let named: URL;

    try {
      named = new URL(`${url.protocol}//${hostHeader.trim()}/`);
    } catch {
      return false;
    }

    return (
      named.host === url.host &&
      !named.username &&
      !named.password &&
      named.pathname === "/"
    );
  }

  // What a request this proxy could not read is filed under: its target as sent, cut short.
  private static unreadableTarget(value: string | undefined): string {
    return (value || "").slice(0, 200);
  }

  private static hasHeader(headers: Array<string>, wanted: string): boolean {
    for (let index: number = 0; index < headers.length; index += 2) {
      if (headers[index]!.toLowerCase() === wanted) {
        return true;
      }
    }
    return false;
  }

  /*
   * The operator's outbound proxy, or a throw: one that cannot be read as
   * an http:// or https:// URL is a fault, never "no proxy", because going
   * direct would route around it.
   */
  private static readUpstream(proxy: SyntheticMonitorWorkerProxy): URL {
    let url: URL;

    try {
      url = new URL(proxy.server);
    } catch {
      // The value itself is not repeated: it may hold the proxy's password.
      throw new Error("The probe's outbound proxy URL could not be read.");
    }

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname
    ) {
      throw new Error(
        "The probe's outbound proxy URL must be an http:// or https:// URL with a host.",
      );
    }

    url.username = "";
    url.password = "";
    return url;
  }

  /*
   * Basic credentials for the outbound proxy, decoded from the URL form they
   * were written in (#10442): the proxy checks the real user name and
   * password, not their percent-encoding.
   */
  private static readUpstreamAuthorization(
    proxy: SyntheticMonitorWorkerProxy,
  ): string | null {
    let username: string | undefined = proxy.username;
    let password: string | undefined = proxy.password;

    if (username === undefined && password === undefined) {
      const url: URL = new URL(proxy.server);
      username = url.username || undefined;
      password = url.password || undefined;
    }

    if (!username && !password) {
      return null;
    }

    const credentials: string = `${SyntheticEgressProxy.decode(username || "")}:${SyntheticEgressProxy.decode(password || "")}`;

    return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
  }

  private static decode(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
}
