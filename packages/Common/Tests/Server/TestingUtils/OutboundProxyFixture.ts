import DataSourceEgressGuard, {
  AddressVerdict,
  EgressGuardOptions,
  OUTBOUND_PROXY_ENVIRONMENT_VARIABLES,
} from "../../../Server/Utils/DataSource/EgressGuard";
import { afterEach, beforeEach, jest } from "@jest/globals";
import dns from "dns";
import http from "http";
import net, { AddressInfo } from "net";

/*
 * AN OUTBOUND PROXY, AND THE SERVERS BEHIND IT, ON THIS MACHINE (issue
 * #8873).
 *
 * The suites that hold OneUptime's pinned requests to an outbound proxy run
 * real requests to real servers here:
 *
 *   - LocalHttpServer records every request it is sent - a whole URL when
 *     it is asked as a forward proxy - and every CONNECT it is asked to
 *     tunnel, which it refuses with 403, so a test reads where an https
 *     request was headed without a certificate of its own.
 *   - clearOutboundProxyEnvironmentForEachTest() starts each test with no
 *     proxy configured, and puts the process's settings back after it.
 *   - approveOnLoopback() stands in for the two things the egress guard
 *     cannot be asked about here, and nothing else: what DNS answers for
 *     a made-up name (a name only the check knows, which this machine's
 *     resolver does not - so only a request dialled at the approved address
 *     reaches a server at all), and its refusal of loopback, which it holds
 *     on every install. Every other address it still judges itself, and the
 *     agents it builds are the real ones.
 *
 * The proxy is named "localhost", which this machine's resolver answers
 * itself: the agents look a proxy's own name up as any request's would be.
 * A target is approved at 127.0.0.2 where it can be (Linux answers every
 * 127/8 address on loopback), so an agent that answered the proxy's name
 * with the target's address - the bug - dials 127.0.0.2 on the proxy's port
 * and never reaches the proxy on 127.0.0.1.
 *
 * Each server also records the user name and password every request and
 * every CONNECT signed in to it with (Proxy-Authorization), as a proxy reads
 * them, so a test sees what a proxy that checks them is given (#10442):
 * proxyUrlWithCredentials writes them into a proxy's URL percent-encoded,
 * as a URL must write a character it reserves.
 */

export const PROXY_HOST_NAME: string = "localhost";

export interface ProxyCredentials {
  user: string;
  password: string;
}

/*
 * A user name and password with the characters a URL reserves: "@", ":" and
 * "%". The user name holds no ":", which Basic authentication cannot carry
 * in a user name.
 */
export const RESERVED_CHARACTER_CREDENTIALS: ProxyCredentials = {
  user: "ops@oneuptime.test",
  password: "p@ss:w%rd",
};

// A user name and password a URL writes as they are.
export const PLAIN_CREDENTIALS: ProxyCredentials = {
  user: "oneuptime",
  password: "s3cret",
};

/*
 * An outbound proxy's URL with a user name and password, written as an
 * operator writes them in HTTPS_PROXY: percent-encoded, as a URL must.
 */
export function proxyUrlWithCredentials(
  port: number,
  credentials: ProxyCredentials,
  scheme: string = "http",
): string {
  return `${scheme}://${encodeURIComponent(credentials.user)}:${encodeURIComponent(credentials.password)}@${PROXY_HOST_NAME}:${port}`;
}

// "user:password", as a proxy reads them, that `credentials` sign in with.
export function signedInAs(credentials: ProxyCredentials): string {
  return `${credentials.user}:${credentials.password}`;
}

// A Proxy-Authorization header of Basic authentication, and its credentials.
const BASIC_AUTHORIZATION: RegExp = /^Basic\s+(\S+)$/i;

/*
 * The user name and password a Proxy-Authorization header carries, as the
 * proxy reads them: "user:password", or "" when there is none.
 */
export function readProxyCredentials(header: string | undefined): string {
  const basic: RegExpExecArray | null = BASIC_AUTHORIZATION.exec(header || "");

  return basic ? Buffer.from(basic[1]!, "base64").toString("utf8") : "";
}

export const NO_PROXY_ENVIRONMENT_VARIABLES: ReadonlyArray<string> = [
  "NO_PROXY",
  "no_proxy",
];

export interface SeenRequest {
  method: string;
  // As it arrived: a path, or a whole URL at a forward proxy.
  url: string;
  host: string;
  body: string;
}

export type LocalHttpHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
  body: string,
) => void;

export class LocalHttpServer {
  public readonly host: string;
  public port: number = 0;
  public requests: Array<SeenRequest> = [];
  // What it was asked to tunnel to, as "host:port".
  public connects: Array<string> = [];
  /*
   * Who each request, and each CONNECT, signed in as (Proxy-Authorization,
   * read by readProxyCredentials): "user:password", or "" for no one.
   */
  public requestCredentials: Array<string> = [];
  public connectCredentials: Array<string> = [];
  // What it answers every CONNECT with: it opens no tunnel.
  public connectStatusLine: string = "HTTP/1.1 403 Forbidden";
  public handler: LocalHttpHandler = (
    _request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ answeredBy: this.name }));
  };

  // What it answers as, so a test can tell a proxy's answer from a target's.
  public name: string;

  private readonly server: http.Server;

  public constructor(host: string, name: string) {
    this.host = host;
    this.name = name;
    this.server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        let body: string = "";

        request.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });

        request.on("end", () => {
          this.requests.push({
            method: request.method || "",
            url: request.url || "",
            host: request.headers["host"] || "",
            body: body,
          });
          this.requestCredentials.push(
            readProxyCredentials(request.headers["proxy-authorization"]),
          );

          this.handler(request, response, body);
        });
      },
    );

    this.server.on(
      "connect",
      (request: http.IncomingMessage, socket: net.Socket) => {
        this.connects.push(request.url || "");
        this.connectCredentials.push(
          readProxyCredentials(request.headers["proxy-authorization"]),
        );
        socket.end(`${this.connectStatusLine}\r\nContent-Length: 0\r\n\r\n`);
      },
    );
  }

  public get isUntouched(): boolean {
    return this.requests.length === 0 && this.connects.length === 0;
  }

  // A URL on this server, under the name a test chooses.
  public url(path: string, hostname?: string): string {
    return `http://${hostname || this.host}:${this.port}${path}`;
  }

  public async listen(port: number = 0): Promise<void> {
    await new Promise<void>(
      (resolve: () => void, reject: (error: Error) => void) => {
        this.server.once("error", reject);
        this.server.listen(port, this.host, () => {
          this.server.removeListener("error", reject);
          resolve();
        });
      },
    );

    this.port = (this.server.address() as AddressInfo).port;
  }

  public async stop(): Promise<void> {
    this.server.closeAllConnections();

    await new Promise<void>((resolve: () => void) => {
      this.server.close(() => {
        resolve();
      });
    });
  }
}

/*
 * Servers a suite starts, each stopped after the test that started it.
 * Call from the top of a test file.
 */
export function useLocalHttpServers(): (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> {
  const started: Array<LocalHttpServer> = [];

  afterEach(async () => {
    while (started.length > 0) {
      await started.pop()!.stop();
    }
  });

  return async (options?: {
    host?: string | undefined;
    port?: number | undefined;
    name?: string | undefined;
  }): Promise<LocalHttpServer> => {
    const server: LocalHttpServer = new LocalHttpServer(
      options?.host || "127.0.0.1",
      options?.name || "target",
    );

    await server.listen(options?.port || 0);
    started.push(server);

    return server;
  };
}

/*
 * Every test starts with no outbound proxy and no NO_PROXY, and the
 * process's own settings are put back after it. Call from the top of a test
 * file.
 */
export function clearOutboundProxyEnvironmentForEachTest(): void {
  const names: Array<string> = [
    ...OUTBOUND_PROXY_ENVIRONMENT_VARIABLES,
    ...NO_PROXY_ENVIRONMENT_VARIABLES,
  ];
  const saved: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();

  beforeEach(() => {
    for (const name of names) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of names) {
      const value: string | undefined = saved.get(name);

      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });
}

/*
 * What the egress guard's DNS answers, by name, with loopback let through.
 * A name not given does not resolve; an address that is not loopback is
 * judged by the guard as ever. Stood in until jest.restoreAllMocks().
 */
export function approveOnLoopback(
  answers: Record<string, Array<string>>,
): void {
  jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    hostname: string,
  ) => {
    const addresses: Array<string> | undefined = answers[hostname];

    if (!addresses) {
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    return addresses.map((address: string) => {
      return { address: address, family: net.isIP(address) };
    });
  }) as never);

  const realCheckAddress: (
    address: string,
    options?: EgressGuardOptions,
  ) => AddressVerdict = DataSourceEgressGuard.checkAddress.bind(
    DataSourceEgressGuard,
  );

  jest
    .spyOn(DataSourceEgressGuard, "checkAddress")
    .mockImplementation(
      (address: string, options?: EgressGuardOptions): AddressVerdict => {
        if (net.isIPv4(address) && address.startsWith("127.")) {
          return { blocked: false };
        }

        return realCheckAddress(address, options);
      },
    );
}

/*
 * The host names this process looks up from here on, each one in `refused`
 * answered at once as a name DNS does not know (ENOTFOUND). A request sent
 * directly looks its own host up; one sent through a proxy looks up the
 * proxy's alone, and the proxy the target's. So the names a request looked
 * up say which way it went - for a sender whose host is fixed
 * (api.resend.com, api.twilio.com), without it leaving this machine.
 * Stood in until jest.restoreAllMocks().
 */
export function watchLookups(refused: Array<string>): Array<string> {
  const asked: Array<string> = [];
  const realLookup: typeof dns.lookup = dns.lookup;

  jest.spyOn(dns, "lookup").mockImplementation(((
    hostname: string,
    options: unknown,
    callback?: unknown,
  ): void => {
    asked.push(hostname);

    if (!refused.includes(hostname)) {
      (realLookup as (...args: Array<unknown>) => void).call(
        dns,
        hostname,
        options,
        callback,
      );
      return;
    }

    const done: (error: NodeJS.ErrnoException) => void = (
      typeof options === "function" ? options : callback
    ) as (error: NodeJS.ErrnoException) => void;
    const error: NodeJS.ErrnoException = new Error(
      `getaddrinfo ENOTFOUND ${hostname}`,
    );

    error.code = "ENOTFOUND";
    process.nextTick(() => {
      done(error);
    });
  }) as never);

  return asked;
}

// Whether this machine answers 127.0.0.2 on loopback, as Linux does.
export async function canListenOn(host: string): Promise<boolean> {
  return await new Promise<boolean>((resolve: (value: boolean) => void) => {
    const probe: http.Server = http.createServer();

    probe.once("error", () => {
      resolve(false);
    });
    probe.listen(0, host, () => {
      probe.close(() => {
        resolve(true);
      });
    });
  });
}
