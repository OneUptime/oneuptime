import http, { IncomingMessage, ServerResponse } from "http";
import net, { AddressInfo } from "net";
import { Duplex } from "stream";

const BASIC_CREDENTIALS_PATTERN: RegExp = /^Basic\s+(\S+)$/i;

/*
 * THE INTERNET, AS A SYNTHETIC CHECK'S EGRESS PROXY SEES IT IN A TEST.
 *
 * The egress proxy (SyntheticEgressProxy) refuses loopback on every probe, so
 * a test cannot point a check at a server on 127.0.0.1 and call it a public
 * site. It can do what an operator's network does instead: configure an
 * outbound proxy. This is one. It answers for addresses a test names - made-
 * up public addresses (93.184.215.14), or private ones (10.23.45.67) - by
 * relaying to servers on loopback, so a check reaches "a public site"
 * through the real egress guard without a packet leaving the machine.
 *
 * The egress proxy is not asked to trust it with anything: it checks every
 * target against the policy first and names the approved address in what it
 * asks for. So everything recorded here is what the guard let through, and
 * an address it refused is never seen here at all.
 */

export interface FakeInternetRequest {
  method: string;
  // The absolute URI the egress proxy sent.
  url: string;
  host: string;
  // Who signed in (Proxy-Authorization, decoded): "user:password" or "".
  credentials: string;
}

export default class FakeInternet {
  public readonly requests: Array<FakeInternetRequest> = [];
  // "host:port" of every CONNECT, as asked.
  public readonly connects: Array<string> = [];
  public readonly connectCredentials: Array<string> = [];

  private readonly routes: Map<string, number> = new Map<string, number>();
  private readonly sockets: Set<Duplex> = new Set<Duplex>();
  private readonly server: http.Server;
  private port: number = 0;

  public constructor() {
    this.server = http.createServer(
      (request: IncomingMessage, response: ServerResponse): void => {
        this.relayRequest(request, response);
      },
    );
    this.server.on("connection", (socket: net.Socket): void => {
      this.track(socket);
    });
    this.server.on(
      "connect",
      (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
        this.relayTunnel(request, socket, head);
      },
    );
  }

  // Answers for `address:port` (an address as written in a URL) with a local server.
  public route(address: string, port: number, localPort: number): void {
    this.routes.set(FakeInternet.key(address, port), localPort);
  }

  public get isUntouched(): boolean {
    return this.requests.length === 0 && this.connects.length === 0;
  }

  // The proxy's URL, as an operator writes it, with credentials if given.
  public url(credentials?: { user: string; password: string }): string {
    const auth: string = credentials
      ? `${encodeURIComponent(credentials.user)}:${encodeURIComponent(credentials.password)}@`
      : "";
    return `http://${auth}127.0.0.1:${this.port}`;
  }

  public async start(): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
      this.server.listen(0, "127.0.0.1", resolve);
    });
    this.port = (this.server.address() as AddressInfo).port;
  }

  public async stop(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.server.closeAllConnections();
    await new Promise<void>((resolve: () => void): void => {
      this.server.close((): void => {
        resolve();
      });
    });
  }

  private relayRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    let target: URL;

    try {
      target = new URL(request.url || "");
    } catch {
      response.writeHead(400, { Connection: "close" });
      response.end("not a proxy request");
      return;
    }

    this.requests.push({
      method: request.method || "",
      url: request.url || "",
      host: request.headers.host || "",
      credentials: FakeInternet.readCredentials(
        request.headers["proxy-authorization"],
      ),
    });

    const localPort: number | undefined = this.routes.get(
      FakeInternet.key(target.hostname, Number.parseInt(target.port, 10) || 80),
    );

    if (localPort === undefined) {
      response.writeHead(502, { Connection: "close" });
      response.end("no such host on the fake internet");
      request.resume();
      return;
    }

    const headers: Record<string, string | Array<string> | undefined> = {
      ...request.headers,
    };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];

    const outgoing: http.ClientRequest = http.request(
      {
        host: "127.0.0.1",
        port: localPort,
        method: request.method,
        path: `${target.pathname}${target.search}`,
        headers: headers as http.OutgoingHttpHeaders,
      },
      (incoming: IncomingMessage): void => {
        response.writeHead(incoming.statusCode || 502, incoming.headers);
        incoming.pipe(response);
      },
    );
    outgoing.on("error", (): void => {
      if (!response.headersSent) {
        response.writeHead(502, { Connection: "close" });
      }
      response.end();
    });
    request.pipe(outgoing);
  }

  private relayTunnel(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void {
    const authority: string = request.url || "";
    this.connects.push(authority);
    this.connectCredentials.push(
      FakeInternet.readCredentials(request.headers["proxy-authorization"]),
    );
    socket.on("error", (): void => {
      // The client went away.
    });

    let localPort: number | undefined;

    try {
      const parsed: URL = new URL(`http://${authority}/`);
      localPort = this.routes.get(
        FakeInternet.key(
          parsed.hostname,
          Number.parseInt(authority.slice(authority.lastIndexOf(":") + 1), 10),
        ),
      );
    } catch {
      localPort = undefined;
    }

    if (localPort === undefined) {
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
      return;
    }

    const upstream: net.Socket = net.connect({
      host: "127.0.0.1",
      port: localPort,
    });
    this.track(upstream);
    upstream.once("connect", (): void => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        upstream.write(head);
      }
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    upstream.on("error", (): void => {
      socket.destroy();
    });
    socket.on("close", (): void => {
      upstream.destroy();
    });
  }

  private track(socket: Duplex): void {
    this.sockets.add(socket);
    socket.once("close", (): void => {
      this.sockets.delete(socket);
    });
  }

  // "address:port", the address as a URL's hostname writes it.
  private static key(address: string, port: number): string {
    const hostname: string = address.startsWith("[")
      ? address
      : net.isIPv6(address)
        ? `[${address}]`
        : address;
    return `${new URL(`http://${hostname}/`).hostname}:${port}`;
  }

  private static readCredentials(header: string | undefined): string {
    const basic: RegExpExecArray | null = BASIC_CREDENTIALS_PATTERN.exec(
      header || "",
    );
    return basic ? Buffer.from(basic[1]!, "base64").toString("utf8") : "";
  }
}
