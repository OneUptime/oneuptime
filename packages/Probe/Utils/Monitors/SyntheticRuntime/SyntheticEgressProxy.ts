import crypto from "crypto";
import http, { IncomingMessage, ServerResponse } from "http";
import https from "https";
import net from "net";
import tls from "tls";
import { Duplex } from "stream";
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
 *     (PlaywrightCapabilityBroker), so axios's redirects come here hop by
 *     hop as well.
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
 * address, an absolute URI naming it - as HttpMonitorRequest asks it, so the
 * proxy cannot resolve the name somewhere else. The proxy's own address is
 * the operator's and is not checked.
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
  httpAgent: http.Agent;
  httpsAgent: https.Agent;
  /*
   * The first refusal or connection failure this proxy answered the request
   * (and its redirects) with, or undefined: what the script should be told
   * instead of the proxy's own answer.
   */
  takeFailure: () => string | undefined;
  // Lets the agents and the record go. Call once the request has settled.
  release: () => void;
}

export interface SyntheticEgressProxyOptions {
  // Where requests may go. Absent: public addresses only.
  policy?: MonitorEgressPolicy | undefined;
  // The operator's outbound proxy, as the supervisor read it (config.proxy).
  upstreamProxy?: SyntheticMonitorWorkerProxy | undefined;
}

// How long one connection - to the target or to the outbound proxy - may take.
export const SYNTHETIC_EGRESS_CONNECT_TIMEOUT_IN_MS: number = 30_000;

/*
 * How long an approved host's addresses are reused. Pages open many
 * connections to one host; a browser caches DNS for about a minute itself.
 * A reused answer is an approved answer, so this only spares the resolver.
 */
const APPROVAL_CACHE_TTL_IN_MS: number = 30_000;
const MAX_CACHED_APPROVALS: number = 500;

// Refusals of the browser's requests a check keeps for its report.
export const MAX_RECORDED_BROWSER_REFUSALS: number = 10;

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

// Headers an Upgrade request keeps: the handshake is relayed as it is.
const UPGRADE_DROPPED_HEADERS: ReadonlySet<string> = new Set([
  "proxy-authorization",
  "proxy-connection",
]);

type Refusal = { status: number; reason: string; message: string };

export default class SyntheticEgressProxy {
  private readonly policy: MonitorEgressPolicy;
  private readonly guardOptions: EgressGuardOptions;
  private readonly upstream: URL | null;
  private readonly upstreamAuthorization: string | null;
  private readonly upstreamNoProxy: string;
  private server: http.Server | null = null;
  private port: number = 0;
  private isClosed: boolean = false;
  private readonly sockets: Set<Duplex> = new Set<Duplex>();
  private readonly approvals: Map<
    string,
    { addresses: Promise<Array<ResolvedAddress>>; expiresAtInMs: number }
  > = new Map();
  private readonly requestTags: Set<string> = new Set<string>();
  private readonly requestFailures: Map<string, string> = new Map<
    string,
    string
  >();
  private readonly browserRefusals: Array<SyntheticEgressRefusal> = [];

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
    const httpAgent: http.Agent = new http.Agent({
      proxyEnv: { http_proxy: proxyUrl },
    });
    const httpsAgent: https.Agent = new https.Agent({
      proxyEnv: { https_proxy: proxyUrl },
    });

    this.requestTags.add(tag);

    return {
      httpAgent,
      httpsAgent,
      takeFailure: (): string | undefined => {
        return this.requestFailures.get(tag);
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
      this.writeRefusal(clientSocket, {
        status: 400,
        reason: "Bad Request",
        message: "A CONNECT request names a host and a port.",
      });
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
      SyntheticEgressProxy.respondWithRefusal(response, {
        status: 400,
        reason: "Bad Request",
        message: "A proxy request names an absolute http URL.",
      });
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
        this.refuse({ tag, target: targetName, hostname, error }),
      );
      request.resume();
      return;
    }

    const upstream: URL | null = this.getUpstreamFor(target);
    const pathAndQuery: string = `${target.pathname}${target.search}`;
    const headers: Array<string> = SyntheticEgressProxy.forwardableHeaders(
      request.rawHeaders,
      HOP_BY_HOP_HEADERS,
    );

    if (
      !SyntheticEgressProxy.hasHeader(headers, "host") &&
      target.host.length > 0
    ) {
      headers.push("Host", target.host);
    }

    if (upstream && this.upstreamAuthorization) {
      headers.push("Proxy-Authorization", this.upstreamAuthorization);
    }

    const outgoing: http.ClientRequest = http.request({
      method: request.method,
      /*
       * Through the outbound proxy, the absolute URI names the approved
       * address, so the proxy is never asked to resolve the name; the Host
       * header still carries it, for virtual hosting.
       */
      path: upstream
        ? `http://${SyntheticEgressProxy.formatAuthority(addresses[0]!.address, port)}${pathAndQuery}`
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

    outgoing.on("response", (incoming: IncomingMessage): void => {
      const responseHeaders: Array<string> =
        SyntheticEgressProxy.forwardableHeaders(
          incoming.rawHeaders,
          HOP_BY_HOP_HEADERS,
        );

      try {
        response.writeHead(
          incoming.statusCode || 502,
          incoming.statusMessage || "",
          responseHeaders,
        );
      } catch {
        response.writeHead(incoming.statusCode || 502, responseHeaders);
      }

      incoming.on("error", (): void => {
        response.destroy();
      });
      incoming.pipe(response);
    });

    outgoing.on("error", (error: Error): void => {
      if (response.headersSent) {
        response.destroy();
        return;
      }

      SyntheticEgressProxy.respondWithRefusal(
        response,
        this.refuse({ tag, target: targetName, hostname, error }),
      );
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
      this.writeRefusal(clientSocket, {
        status: 400,
        reason: "Bad Request",
        message: "A proxy request names an absolute http or ws URL.",
      });
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
        this.refuse({ tag, target: targetName, hostname, error }),
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

    return await this.tunnelThroughUpstream({
      upstream,
      address: data.addresses[0]!,
      port: data.port,
    });
  }

  /*
   * Dials the approved addresses and nothing else. A name is answered from
   * the approval (a pinned lookup), never looked up again; an IP address is
   * dialled as written, which is what was approved.
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

    return await SyntheticEgressProxy.whenConnected(socket, "connect");
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
    );
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
        }, SYNTHETIC_EGRESS_CONNECT_TIMEOUT_IN_MS);
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

          if (!status || status[1] !== "200") {
            fail(
              new Error(
                `The outbound proxy refused the CONNECT (${status ? status[1] : "no status"}).`,
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
   * request by its tag, the browser in its list.
   */
  private refuse(data: {
    tag: string | null;
    target: string;
    hostname: string;
    error: unknown;
  }): Refusal {
    const isGuardRefusal: boolean = data.error instanceof EgressGuardException;
    const message: string = isGuardRefusal
      ? (data.error as EgressGuardException).message
      : `${MONITOR_TARGET_LABEL} host ${data.hostname} could not be reached.`;
    let status: number = 502;
    let reason: string = "Bad Gateway";

    if (isGuardRefusal) {
      const guardReason: EgressFailureReason = (
        data.error as EgressGuardException
      ).reason;

      if (guardReason === EgressFailureReason.InvalidTarget) {
        status = 400;
        reason = "Bad Request";
      } else if (guardReason === EgressFailureReason.AddressBlocked) {
        status = 403;
        reason = "Forbidden";
      }
    }

    if (data.tag) {
      if (!this.requestFailures.has(data.tag)) {
        this.requestFailures.set(data.tag, message);
      }
    } else if (
      isGuardRefusal &&
      this.browserRefusals.length < MAX_RECORDED_BROWSER_REFUSALS &&
      !this.browserRefusals.some((refusal: SyntheticEgressRefusal) => {
        return refusal.target === data.target;
      })
    ) {
      this.browserRefusals.push({ target: data.target, message });
    }

    return { status, reason, message };
  }

  // The tag of an axios request (its proxy user name), or null: the browser.
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

    return this.requestTags.has(tag) ? tag : null;
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
          `HTTP/1.1 ${refusal.status} ${refusal.reason}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${body.byteLength}\r\nConnection: close\r\n\r\n`,
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
      Connection: "close",
    });
    response.end(refusal.message);
  }

  private static async whenConnected(
    socket: net.Socket,
    event: "connect" | "secureConnect",
  ): Promise<net.Socket> {
    return await new Promise<net.Socket>(
      (
        resolve: (socket: net.Socket) => void,
        reject: (error: Error) => void,
      ): void => {
        const timer: NodeJS.Timeout = setTimeout((): void => {
          onError(new Error("The connection timed out."));
        }, SYNTHETIC_EGRESS_CONNECT_TIMEOUT_IN_MS);
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
      url.password
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

  private static hasHeader(headers: Array<string>, wanted: string): boolean {
    for (let index: number = 0; index < headers.length; index += 2) {
      if (headers[index]!.toLowerCase() === wanted) {
        return true;
      }
    }
    return false;
  }

  private static readUpstream(proxy: SyntheticMonitorWorkerProxy): URL | null {
    try {
      const url: URL = new URL(proxy.server);
      url.username = "";
      url.password = "";
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
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
      try {
        const url: URL = new URL(proxy.server);
        username = url.username || undefined;
        password = url.password || undefined;
      } catch {
        return null;
      }
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
