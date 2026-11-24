import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios, { AxiosResponse } from "axios";
import dns from "dns";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import net, { AddressInfo } from "net";
import SyntheticEgressProxy, {
  MAX_RECORDED_BROWSER_REFUSALS,
  SyntheticEgressRefusal,
  SyntheticEgressRequestAgents,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticEgressProxy";
import { MAX_SANDBOX_LOG_MESSAGES } from "../../../../Utils/Monitors/SyntheticRuntime/RpcProtocol";
import MonitorEgressGuardOptions, {
  MONITOR_DNS_RESOLVE_BUDGET_IN_MS,
  MonitorEgressPolicy,
} from "../../../../Utils/Monitors/MonitorEgressGuardOptions";
import PrivateNetworkMonitorPolicy, {
  ResolvedPrivateNetworkMonitorPolicy,
} from "../../../../Utils/PrivateNetworkMonitorPolicy";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import { approveOnLoopback } from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import FakeInternet, { FakeInternetRequest } from "./Fixtures/FakeInternet";

/*
 * GHSA-9rx7-vwfj-whp7: a synthetic monitor's browser and its script's axios
 * sent requests wherever the script said - the cloud metadata endpoint,
 * loopback, the network a shared probe runs in - and handed the responses
 * back. Every one of those requests now goes through SyntheticEgressProxy.
 *
 * These tests drive the real proxy with real clients, as the browser and
 * the axios bridge drive it: CONNECT tunnels, absolute-form requests,
 * Upgrades, and Node agents. The egress guard is the real one with the real
 * policy, held to what PrivateNetworkMonitorPolicy decides for each kind of
 * probe. Only two things stand in:
 *
 *   - DNS, for names this machine cannot resolve (dns.promises.lookup), and
 *   - the internet: an outbound proxy (FakeInternet) relays made-up public
 *     and private addresses to local servers, the way an operator's network
 *     often reaches them. The egress proxy checks every target before it
 *     asks that proxy for anything, so what the fake internet records is
 *     exactly what the guard let through.
 *
 * Loopback servers stand for the sensitive targets: every refusal below is
 * also checked to have left them untouched.
 */

jest.setTimeout(30_000);

const PUBLIC_IPV4: string = "93.184.215.14";
const SECOND_PUBLIC_IPV4: string = "93.184.215.34";
const PRIVATE_IPV4: string = "10.23.45.67";

interface ProbeKind {
  label: string;
  configuredValue: string | undefined;
  isAutoRegisteredGlobalProbe: boolean;
  isBillingEnabled: boolean;
  allowsPrivate: boolean;
}

// Every kind of probe, and what its operator set.
const PROBE_KINDS: Array<ProbeKind> = [
  {
    label: "a global probe of a BILLING_ENABLED instance, opted in",
    configuredValue: "true",
    isAutoRegisteredGlobalProbe: true,
    isBillingEnabled: true,
    allowsPrivate: false,
  },
  {
    label: "a self-hosted global probe without the opt-in",
    configuredValue: undefined,
    isAutoRegisteredGlobalProbe: true,
    isBillingEnabled: false,
    allowsPrivate: false,
  },
  {
    label: "a self-hosted global probe with the opt-in",
    configuredValue: "true",
    isAutoRegisteredGlobalProbe: true,
    isBillingEnabled: false,
    allowsPrivate: true,
  },
  {
    label: "a custom probe without the opt-in",
    configuredValue: undefined,
    isAutoRegisteredGlobalProbe: false,
    isBillingEnabled: false,
    allowsPrivate: false,
  },
  {
    label: "a custom probe with the opt-in",
    configuredValue: "true",
    isAutoRegisteredGlobalProbe: false,
    isBillingEnabled: true,
    allowsPrivate: true,
  },
];

// The policy a probe of `kind` hands its synthetic checks (SyntheticMonitor).
function policyFor(kind: ProbeKind): MonitorEgressPolicy {
  const resolved: ResolvedPrivateNetworkMonitorPolicy =
    PrivateNetworkMonitorPolicy.resolve({
      configuredValue: kind.configuredValue,
      isAutoRegisteredGlobalProbe: kind.isAutoRegisteredGlobalProbe,
      isBillingEnabled: kind.isBillingEnabled,
    });

  return {
    allowPrivateNetworkAddresses: resolved.allowed,
    privateNetworkHint: resolved.refusalHint,
  };
}

const PUBLIC_ONLY: MonitorEgressPolicy = policyFor(PROBE_KINDS[3]!);
const PRIVATE_ALLOWED: MonitorEgressPolicy = policyFor(PROBE_KINDS[4]!);

interface TunnelAnswer {
  status: number;
  head: string;
  body: string;
  socket: net.Socket;
}

interface HttpAnswer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/*
 * A CONNECT through the proxy, as a browser sends one. Resolves with the
 * proxy's answer; on 200, the socket is the tunnel.
 */
async function sendConnect(
  proxyPort: number,
  authority: string,
  extraHeaders: string = "",
): Promise<TunnelAnswer> {
  return await new Promise<TunnelAnswer>(
    (
      resolve: (answer: TunnelAnswer) => void,
      reject: (error: Error) => void,
    ): void => {
      const socket: net.Socket = net.connect({
        host: "127.0.0.1",
        port: proxyPort,
      });
      let received: Buffer = Buffer.alloc(0);
      let settled: boolean = false;

      const finish: (status: number, head: string, body: string) => void = (
        status: number,
        head: string,
        body: string,
      ): void => {
        if (!settled) {
          settled = true;
          resolve({ status, head, body, socket });
        }
      };

      socket.on("data", (chunk: Buffer): void => {
        received = Buffer.concat([received, chunk]);
        const end: number = received.indexOf("\r\n\r\n");
        if (end === -1) {
          return;
        }
        const head: string = received.subarray(0, end).toString("latin1");
        const status: number = Number.parseInt(head.split(" ")[1] || "0", 10);
        if (status === 200) {
          socket.removeAllListeners("data");
          finish(status, head, "");
        }
      });
      socket.on("close", (): void => {
        const end: number = received.indexOf("\r\n\r\n");
        const head: string =
          end === -1 ? "" : received.subarray(0, end).toString("latin1");
        finish(
          Number.parseInt(head.split(" ")[1] || "0", 10),
          head,
          end === -1 ? "" : received.subarray(end + 4).toString("utf8"),
        );
      });
      socket.on("error", (error: Error): void => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      socket.write(
        `CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${extraHeaders}\r\n`,
      );
    },
  );
}

// An absolute-form request through the proxy, as a browser sends one for http://.
async function sendThroughProxy(
  proxyPort: number,
  absoluteUrl: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<HttpAnswer> {
  return await new Promise<HttpAnswer>(
    (
      resolve: (answer: HttpAnswer) => void,
      reject: (error: Error) => void,
    ): void => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: proxyPort,
          method: options.method || "GET",
          path: absoluteUrl,
          headers: {
            Host: new URL(absoluteUrl).host,
            ...(options.headers || {}),
          },
          agent: false,
        },
        (response: IncomingMessage): void => {
          let body: string = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string): void => {
            body += chunk;
          });
          response.on("end", (): void => {
            resolve({
              status: response.statusCode || 0,
              headers: response.headers,
              body,
            });
          });
        },
      );
      request.on("error", reject);
      request.end(options.body);
    },
  );
}

interface SeenRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

class LoopbackServer {
  public readonly seen: Array<SeenRequest> = [];
  public port: number = 0;
  public respond: (request: IncomingMessage, response: ServerResponse) => void =
    (request: IncomingMessage, response: ServerResponse): void => {
      response.writeHead(200, {
        "Content-Type": "text/plain",
        "X-Secret": "loopback-header-sentinel",
      });
      response.end(`loopback-body-sentinel ${request.url}`);
    };
  private readonly server: Server;
  private readonly sockets: Set<net.Socket> = new Set<net.Socket>();

  public constructor() {
    this.server = http.createServer(
      (request: IncomingMessage, response: ServerResponse): void => {
        let body: string = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string): void => {
          body += chunk;
        });
        request.on("end", (): void => {
          this.seen.push({
            method: request.method || "",
            url: request.url || "",
            headers: request.headers,
            body,
          });
          this.respond(request, response);
        });
      },
    );
    this.server.on("connection", (socket: net.Socket): void => {
      this.sockets.add(socket);
      socket.once("close", (): void => {
        this.sockets.delete(socket);
      });
    });
  }

  public get rawServer(): Server {
    return this.server;
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
    await new Promise<void>((resolve: () => void): void => {
      this.server.close((): void => {
        resolve();
      });
    });
  }
}

/*
 * DNS answers for made-up names, each answer list used in turn (the last
 * one from then on); anything else does not resolve. Returns how often each
 * name was asked.
 */
function answerDns(
  answers: Record<string, Array<Array<string>>>,
): Map<string, number> {
  const asked: Map<string, number> = new Map<string, number>();

  jest.spyOn(dns.promises, "lookup").mockImplementation((async (
    hostname: string,
  ) => {
    const count: number = asked.get(hostname) || 0;
    asked.set(hostname, count + 1);
    const turns: Array<Array<string>> | undefined = answers[hostname];

    if (!turns) {
      const error: NodeJS.ErrnoException = new Error(
        `getaddrinfo ENOTFOUND ${hostname}`,
      );
      error.code = "ENOTFOUND";
      throw error;
    }

    const addresses: Array<string> = turns[Math.min(count, turns.length - 1)]!;
    return addresses.map((address: string) => {
      return { address, family: net.isIP(address) };
    });
  }) as never);

  return asked;
}

describe("SyntheticEgressProxy", () => {
  let fakeInternet: FakeInternet;
  let loopback: LoopbackServer;
  let siteServer: LoopbackServer;
  const proxies: Array<SyntheticEgressProxy> = [];

  async function startProxy(
    policy: MonitorEgressPolicy,
    options: { upstream?: boolean; bypass?: string } = { upstream: true },
  ): Promise<SyntheticEgressProxy> {
    const proxy: SyntheticEgressProxy = new SyntheticEgressProxy({
      policy,
      ...(options.upstream === false
        ? {}
        : {
            upstreamProxy: {
              server: fakeInternet.url(),
              ...(options.bypass !== undefined
                ? { bypass: options.bypass }
                : {}),
            },
          }),
    });
    await proxy.start();
    proxies.push(proxy);
    return proxy;
  }

  beforeEach(async () => {
    fakeInternet = new FakeInternet();
    await fakeInternet.start();
    loopback = new LoopbackServer();
    await loopback.start();
    siteServer = new LoopbackServer();
    siteServer.respond = (
      request: IncomingMessage,
      response: ServerResponse,
    ): void => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end(`public site ${request.method} ${request.url}`);
    };
    await siteServer.start();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    while (proxies.length > 0) {
      await proxies.pop()!.close();
    }
    await fakeInternet.stop();
    await loopback.stop();
    await siteServer.stop();
  });

  describe("asks the egress guard what HTTP monitors ask it", () => {
    test("with the options API and Website monitors use", () => {
      for (const kind of PROBE_KINDS) {
        const policy: MonitorEgressPolicy = policyFor(kind);
        expect(MonitorEgressGuardOptions.forPolicy(policy)).toEqual({
          blockPrivateAddresses: !kind.allowsPrivate,
          targetLabel: "Monitor target",
          privateNetworkHint: policy.privateNetworkHint,
          includeResolvedAddressInError: false,
          resolveTimeoutInMs: MONITOR_DNS_RESOLVE_BUDGET_IN_MS,
        });
      }
    });

    test("for every connection, with the check's policy", async () => {
      const guard: ReturnType<typeof jest.spyOn> = jest.spyOn(
        DataSourceEgressGuard,
        "assertHostnameAllowed",
      );
      const proxy: SyntheticEgressProxy = await startProxy(PRIVATE_ALLOWED);
      fakeInternet.route(PUBLIC_IPV4, 443, siteServer.port);

      const answer: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        `${PUBLIC_IPV4}:443`,
      );
      answer.socket.destroy();

      expect(guard).toHaveBeenCalledWith(
        PUBLIC_IPV4,
        MonitorEgressGuardOptions.forPolicy(PRIVATE_ALLOWED),
      );
    });

    test("allows public addresses only when it is told nothing", async () => {
      const proxy: SyntheticEgressProxy = new SyntheticEgressProxy();
      await proxy.start();
      proxies.push(proxy);

      expect(proxy.getPolicy()).toEqual({
        allowPrivateNetworkAddresses: false,
        privateNetworkHint: "",
      });
      const answer: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://${PRIVATE_IPV4}/`,
      );
      expect(answer.status).toBe(403);
      expect(answer.body).toBe(
        `Monitor target host ${PRIVATE_IPV4} is not allowed: private network address.`,
      );
    });
  });

  describe.each(PROBE_KINDS)("on $label", (kind: ProbeKind) => {
    const forbidden: Array<{ host: string; reason: string }> = [
      { host: "127.0.0.1", reason: "loopback address" },
      { host: "127.42.0.9", reason: "loopback address" },
      { host: "[::1]", reason: "loopback address" },
      { host: "0.0.0.0", reason: "unspecified address" },
      {
        host: "169.254.169.254",
        reason: "link-local address (cloud metadata range)",
      },
      { host: "100.100.100.200", reason: "cloud metadata address" },
      { host: "168.63.129.16", reason: "cloud platform metadata address" },
      { host: "[fd00:ec2::254]", reason: "cloud metadata address" },
      { host: "[fe80::1]", reason: "link-local address" },
      // IPv4-mapped, NAT64 and IPv4-compatible spellings of the same targets.
      { host: "[::ffff:127.0.0.1]", reason: "loopback address" },
      {
        host: "[::ffff:169.254.169.254]",
        reason: "link-local address (cloud metadata range)",
      },
      {
        host: "[64:ff9b::a9fe:a9fe]",
        reason: "link-local address (cloud metadata range)",
      },
      { host: "[::7f00:1]", reason: "loopback address" },
      { host: "224.0.0.1", reason: "multicast address" },
    ];

    test.each(forbidden)(
      "refuses a CONNECT to $host ($reason), whatever the opt-in",
      async ({ host, reason }: { host: string; reason: string }) => {
        const proxy: SyntheticEgressProxy = await startProxy(policyFor(kind));

        const answer: TunnelAnswer = await sendConnect(
          proxy.getPort(),
          `${host}:443`,
        );

        expect(answer.status).toBe(403);
        expect(answer.body).toContain(`is not allowed: ${reason}.`);
        expect(answer.body).not.toContain(
          "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS",
        );
        expect(fakeInternet.isUntouched).toBe(true);
      },
    );

    test.each(forbidden)(
      "refuses an http request to $host ($reason), whatever the opt-in",
      async ({ host, reason }: { host: string; reason: string }) => {
        const proxy: SyntheticEgressProxy = await startProxy(policyFor(kind));

        const answer: HttpAnswer = await sendThroughProxy(
          proxy.getPort(),
          `http://${host}/latest/meta-data/iam/security-credentials/`,
          { headers: { "Metadata-Flavor": "Google" } },
        );

        expect(answer.status).toBe(403);
        expect(answer.body).toContain(`is not allowed: ${reason}.`);
        expect(fakeInternet.isUntouched).toBe(true);
      },
    );

    test("refuses a request to the loopback server itself, which never sees it", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(policyFor(kind), {
        upstream: false,
      });

      const plain: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://127.0.0.1:${loopback.port}/secret`,
      );
      const tunnel: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        `127.0.0.1:${loopback.port}`,
      );
      const decimal: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://2130706433:${loopback.port}/secret`,
      );
      const hex: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        `0x7f.0.0.1:${loopback.port}`,
      );

      for (const status of [
        plain.status,
        tunnel.status,
        decimal.status,
        hex.status,
      ]) {
        expect(status).toBe(403);
      }
      expect(plain.body).not.toContain("loopback-body-sentinel");
      expect(loopback.seen).toEqual([]);
    });

    test("refuses a host name that resolves to loopback, without saying where it resolves", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(policyFor(kind), {
        upstream: false,
      });

      const answer: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://localhost:${loopback.port}/secret`,
      );

      expect(answer.status).toBe(502);
      expect(answer.body).toBe(
        "Monitor target host localhost could not be reached.",
      );
      expect(loopback.seen).toEqual([]);
    });

    test("refuses a name that resolves to the metadata endpoint, whatever the opt-in", async () => {
      answerDns({ "metadata.example.test": [["169.254.169.254"]] });
      const proxy: SyntheticEgressProxy = await startProxy(policyFor(kind));

      const answer: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        "metadata.example.test:80",
      );

      expect(answer.status).toBe(502);
      expect(answer.body).toBe(
        "Monitor target host metadata.example.test could not be reached.",
      );
      expect(answer.body).not.toContain("169.254");
      expect(fakeInternet.isUntouched).toBe(true);
    });

    const privateTargets: Array<{ host: string; address: string }> = [
      { host: PRIVATE_IPV4, address: PRIVATE_IPV4 },
      { host: "172.16.5.4", address: "172.16.5.4" },
      { host: "192.168.1.10", address: "192.168.1.10" },
      { host: "100.64.0.7", address: "100.64.0.7" },
      { host: "[fd12:3456::1]", address: "[fd12:3456::1]" },
      { host: "[::ffff:10.0.0.5]", address: "[::ffff:a00:5]" },
    ];

    test.each(privateTargets)(
      kind.allowsPrivate
        ? "reaches the private address $host, and asks the outbound proxy for that address"
        : "refuses the private address $host and says how to allow it",
      async ({ host, address }: { host: string; address: string }) => {
        const policy: MonitorEgressPolicy = policyFor(kind);
        const proxy: SyntheticEgressProxy = await startProxy(policy);
        fakeInternet.route(address, 80, siteServer.port);

        const answer: HttpAnswer = await sendThroughProxy(
          proxy.getPort(),
          `http://${host}/health`,
        );

        if (kind.allowsPrivate) {
          expect(answer.status).toBe(200);
          expect(answer.body).toBe("public site GET /health");
          expect(
            fakeInternet.requests.map((seen: FakeInternetRequest) => {
              return seen.url;
            }),
          ).toEqual([`http://${address}:80/health`]);
          return;
        }

        expect(answer.status).toBe(403);
        expect(answer.body).toContain("is not allowed: ");
        expect(answer.body.endsWith(policy.privateNetworkHint)).toBe(true);
        expect(policy.privateNetworkHint.length).toBeGreaterThan(0);
        expect(fakeInternet.isUntouched).toBe(true);
      },
    );

    test(
      kind.allowsPrivate
        ? "reaches an internal name, pinned to the address it resolved to"
        : "refuses an internal name without saying what it resolves to",
      async () => {
        answerDns({ "kubernetes.default.svc": [[PRIVATE_IPV4]] });
        const proxy: SyntheticEgressProxy = await startProxy(policyFor(kind));
        fakeInternet.route(PRIVATE_IPV4, 443, siteServer.port);

        const answer: TunnelAnswer = await sendConnect(
          proxy.getPort(),
          "kubernetes.default.svc:443",
        );
        answer.socket.destroy();

        if (kind.allowsPrivate) {
          expect(answer.status).toBe(200);
          expect(fakeInternet.connects).toEqual([`${PRIVATE_IPV4}:443`]);
          return;
        }

        expect(answer.status).toBe(502);
        expect(answer.body).toBe(
          "Monitor target host kubernetes.default.svc could not be reached.",
        );
        expect(fakeInternet.isUntouched).toBe(true);
      },
    );

    test("reaches a public address, through the outbound proxy, named by the approved address", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(policyFor(kind));
      fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);

      const answer: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://${PUBLIC_IPV4}/index.html?q=1`,
      );

      expect(answer.status).toBe(200);
      expect(answer.body).toBe("public site GET /index.html?q=1");
      expect(fakeInternet.requests).toEqual([
        expect.objectContaining({
          method: "GET",
          url: `http://${PUBLIC_IPV4}:80/index.html?q=1`,
          host: PUBLIC_IPV4,
        }),
      ]);
    });
  });

  describe("names", () => {
    test("refuses a name when any address it resolves to is refused", async () => {
      answerDns({
        "mixed.example.test": [[PUBLIC_IPV4, "127.0.0.1"]],
      });
      const proxy: SyntheticEgressProxy = await startProxy(PRIVATE_ALLOWED);
      fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);

      const answer: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        "http://mixed.example.test/",
      );

      expect(answer.status).toBe(502);
      expect(fakeInternet.isUntouched).toBe(true);
    });

    test("tells a refused name and a name that does not exist apart in no way", async () => {
      answerDns({ "internal.example.test": [[PRIVATE_IPV4]] });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);

      const refused: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        "http://internal.example.test/",
      );
      const missing: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        "http://missing.example.test/",
      );

      expect(refused.status).toBe(missing.status);
      expect(refused.body.replace("internal", "missing")).toBe(missing.body);
    });

    test("connects a name to the address it was approved at, though DNS answers otherwise later (rebinding)", async () => {
      const asked: Map<string, number> = answerDns({
        "rebind.example.test": [
          [PUBLIC_IPV4],
          ["127.0.0.1"],
          ["169.254.169.254"],
        ],
      });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 443, siteServer.port);
      fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);

      const first: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        "rebind.example.test:443",
      );
      first.socket.destroy();
      const second: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        "http://rebind.example.test/again",
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      // Looked up once; both connections went to the approved address.
      expect(asked.get("rebind.example.test")).toBe(1);
      expect(fakeInternet.connects).toEqual([`${PUBLIC_IPV4}:443`]);
      expect(fakeInternet.requests).toEqual([
        expect.objectContaining({
          url: `http://${PUBLIC_IPV4}:80/again`,
          host: "rebind.example.test",
        }),
      ]);
      expect(loopback.seen).toEqual([]);
    });

    test("looks a name up again once its approval is old, and refuses what it rebinds to", async () => {
      const asked: Map<string, number> = answerDns({
        "rebind.example.test": [[PUBLIC_IPV4], ["127.0.0.1"]],
      });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 443, siteServer.port);
      const now: number = Date.now();
      const clock: ReturnType<typeof jest.spyOn> = jest.spyOn(Date, "now");
      clock.mockReturnValue(now);

      const first: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        "rebind.example.test:443",
      );
      first.socket.destroy();
      clock.mockReturnValue(now + 60_000);
      const second: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        "rebind.example.test:443",
      );

      expect(first.status).toBe(200);
      expect(second.status).toBe(502);
      expect(asked.get("rebind.example.test")).toBe(2);
      expect(fakeInternet.connects).toEqual([`${PUBLIC_IPV4}:443`]);
    });
  });

  describe("the connections it makes", () => {
    test("relays a CONNECT tunnel both ways once the target is approved", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 8443, siteServer.port);

      const answer: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        `${PUBLIC_IPV4}:8443`,
      );
      expect(answer.status).toBe(200);

      const reply: string = await new Promise<string>(
        (resolve: (value: string) => void): void => {
          let text: string = "";
          answer.socket.on("data", (chunk: Buffer): void => {
            text += chunk.toString("utf8");
            if (text.includes("public site")) {
              resolve(text);
            }
          });
          answer.socket.write(
            "GET /through-the-tunnel HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n",
          );
        },
      );

      expect(reply).toContain("public site GET /through-the-tunnel");
      answer.socket.destroy();
    });

    test("relays an http request's method, body, headers and answer, without the hop-by-hop ones", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);
      siteServer.respond = (
        _request: IncomingMessage,
        response: ServerResponse,
      ): void => {
        response.setHeader("Set-Cookie", ["a=1", "b=2"]);
        response.writeHead(201, "Made", { "X-Answer": "yes" });
        response.end("created");
      };

      const answer: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://${PUBLIC_IPV4}/items`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Proxy-Authorization": "Basic c2hvdWxkOm5vdC1sZWFr",
            "Proxy-Connection": "keep-alive",
            "X-Script": "kept",
          },
          body: '{"name":"widget"}',
        },
      );

      expect(answer.status).toBe(201);
      expect(answer.body).toBe("created");
      expect(answer.headers["x-answer"]).toBe("yes");
      expect(answer.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
      expect(siteServer.seen).toHaveLength(1);
      expect(siteServer.seen[0]!.method).toBe("POST");
      expect(siteServer.seen[0]!.body).toBe('{"name":"widget"}');
      expect(siteServer.seen[0]!.headers["x-script"]).toBe("kept");
      // The script's own Proxy-Authorization reaches neither proxy nor site.
      expect(
        siteServer.seen[0]!.headers["proxy-authorization"],
      ).toBeUndefined();
      expect(fakeInternet.requests[0]!.credentials).toBe("");
    });

    test("dials the approved address itself when no outbound proxy is set", async () => {
      approveOnLoopback({ "site.example.test": ["127.0.0.1"] });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY, {
        upstream: false,
      });

      const answer: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://site.example.test:${siteServer.port}/direct`,
      );

      expect(answer.status).toBe(200);
      expect(answer.body).toBe("public site GET /direct");
      expect(siteServer.seen[0]!.headers.host).toBe(
        `site.example.test:${siteServer.port}`,
      );
      expect(fakeInternet.isUntouched).toBe(true);
    });

    test("goes directly to a host NO_PROXY names, still held to the policy", async () => {
      approveOnLoopback({ "intranet.example.test": ["127.0.0.1"] });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY, {
        bypass: "synthetic-runtime.oneuptime.invalid,.example.test",
      });

      const allowed: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://intranet.example.test:${siteServer.port}/no-proxy`,
      );

      expect(allowed.status).toBe(200);
      expect(fakeInternet.isUntouched).toBe(true);
      jest.restoreAllMocks();

      const refused: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://127.0.0.1:${loopback.port}/no-proxy`,
      );
      expect(refused.status).toBe(403);
      expect(loopback.seen).toEqual([]);
    });

    test("relays a WebSocket Upgrade sent to it in absolute form", async () => {
      approveOnLoopback({ "ws.example.test": ["127.0.0.1"] });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY, {
        upstream: false,
      });
      siteServer.rawServer.on(
        "upgrade",
        (request: IncomingMessage, socket: net.Socket): void => {
          socket.write(
            `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Path: ${request.url}\r\n\r\n`,
          );
          socket.on("data", (chunk: Buffer): void => {
            socket.write(chunk);
          });
        },
      );

      const head: string = await new Promise<string>(
        (
          resolve: (value: string) => void,
          reject: (e: Error) => void,
        ): void => {
          const socket: net.Socket = net.connect({
            host: "127.0.0.1",
            port: proxy.getPort(),
          });
          let received: string = "";
          socket.on("data", (chunk: Buffer): void => {
            received += chunk.toString("latin1");
            if (received.includes("echo-me")) {
              socket.destroy();
              resolve(received);
            } else if (received.includes("\r\n\r\n")) {
              socket.write("echo-me");
            }
          });
          socket.on("error", reject);
          socket.write(
            `GET ws://ws.example.test:${siteServer.port}/socket HTTP/1.1\r\nHost: ws.example.test:${siteServer.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
          );
        },
      );

      expect(head).toContain("101 Switching Protocols");
      expect(head).toContain("X-Path: /socket");
      expect(head).toContain("echo-me");
    });

    test("refuses a WebSocket Upgrade to loopback", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PRIVATE_ALLOWED, {
        upstream: false,
      });
      let upgrades: number = 0;
      loopback.rawServer.on("upgrade", (): void => {
        upgrades++;
      });

      const answer: string = await new Promise<string>(
        (resolve: (value: string) => void): void => {
          const socket: net.Socket = net.connect({
            host: "127.0.0.1",
            port: proxy.getPort(),
          });
          let received: string = "";
          socket.on("data", (chunk: Buffer): void => {
            received += chunk.toString("latin1");
          });
          socket.on("close", (): void => {
            resolve(received);
          });
          socket.write(
            `GET ws://127.0.0.1:${loopback.port}/socket HTTP/1.1\r\nHost: 127.0.0.1:${loopback.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
          );
        },
      );

      expect(answer).toContain("403 Forbidden");
      expect(answer).toContain("loopback address");
      expect(upgrades).toBe(0);
    });

    test("signs in to the outbound proxy with its real user name and password (#10442)", async () => {
      const credentials: { user: string; password: string } = {
        user: "ops@oneuptime.test",
        password: "p@ss:w%rd",
      };
      const parsed: URL = new URL(fakeInternet.url(credentials));
      const proxy: SyntheticEgressProxy = new SyntheticEgressProxy({
        policy: PUBLIC_ONLY,
        // As SyntheticMonitor hands it over: credentials read off the URL.
        upstreamProxy: {
          server: fakeInternet.url(credentials),
          username: parsed.username,
          password: parsed.password,
        },
      });
      await proxy.start();
      proxies.push(proxy);
      fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);
      fakeInternet.route(PUBLIC_IPV4, 443, siteServer.port);

      await sendThroughProxy(proxy.getPort(), `http://${PUBLIC_IPV4}/`);
      const tunnel: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        `${PUBLIC_IPV4}:443`,
      );
      tunnel.socket.destroy();

      expect(fakeInternet.requests[0]!.credentials).toBe(
        "ops@oneuptime.test:p@ss:w%rd",
      );
      expect(fakeInternet.connectCredentials).toEqual([
        "ops@oneuptime.test:p@ss:w%rd",
      ]);
    });

    test("answers 502 when the outbound proxy refuses the tunnel, and sends nothing on", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);

      const answer: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        `${SECOND_PUBLIC_IPV4}:443`,
      );

      expect(answer.status).toBe(502);
      expect(answer.body).toBe(
        `Monitor target host ${SECOND_PUBLIC_IPV4} could not be reached.`,
      );
      expect(fakeInternet.connects).toEqual([`${SECOND_PUBLIC_IPV4}:443`]);
    });

    test("answers 502 for an approved target that does not accept the connection", async () => {
      approveOnLoopback({ "down.example.test": ["127.0.0.1"] });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY, {
        upstream: false,
      });
      const closed: LoopbackServer = new LoopbackServer();
      await closed.start();
      const closedPort: number = closed.port;
      await closed.stop();

      const answer: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://down.example.test:${closedPort}/`,
      );

      expect(answer.status).toBe(502);
      expect(answer.body).toBe(
        "Monitor target host down.example.test could not be reached.",
      );
    });

    test.each([
      { label: "a CONNECT with no port", authority: "example.com" },
      {
        label: "a CONNECT with a port out of range",
        authority: "example.com:70000",
      },
      {
        label: "a CONNECT with user information",
        authority: "user@example.com:443",
      },
    ])(
      "refuses $label with 400",
      async ({ authority }: { label: string; authority: string }) => {
        const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);

        const answer: TunnelAnswer = await sendConnect(
          proxy.getPort(),
          authority,
        );

        expect(answer.status).toBe(400);
        expect(fakeInternet.isUntouched).toBe(true);
      },
    );

    test.each([
      { label: "an origin-form request", path: "/not-a-proxy-request" },
      { label: "an absolute https URL", path: `https://${PUBLIC_IPV4}/` },
      {
        label: "a URL with user information",
        path: `http://user:pw@${PUBLIC_IPV4}/`,
      },
      { label: "a file URL", path: "file:///etc/passwd" },
    ])(
      "refuses $label with 400",
      async ({ path }: { label: string; path: string }) => {
        const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);

        const answer: HttpAnswer = await new Promise<HttpAnswer>(
          (resolve: (answer: HttpAnswer) => void): void => {
            const request: http.ClientRequest = http.request(
              {
                host: "127.0.0.1",
                port: proxy.getPort(),
                path,
                agent: false,
              },
              (response: IncomingMessage): void => {
                let body: string = "";
                response.on("data", (chunk: Buffer): void => {
                  body += chunk.toString("utf8");
                });
                response.on("end", (): void => {
                  resolve({
                    status: response.statusCode || 0,
                    headers: response.headers,
                    body,
                  });
                });
              },
            );
            request.end();
          },
        );

        expect(answer.status).toBe(400);
        expect(fakeInternet.isUntouched).toBe(true);
      },
    );

    test("listens on loopback only", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);

      expect(proxy.getProxyServer()).toBe(
        `http://127.0.0.1:${proxy.getPort()}`,
      );
    });

    test("cuts open tunnels when it is closed, and cannot be started again", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 443, siteServer.port);
      const answer: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        `${PUBLIC_IPV4}:443`,
      );
      const closed: Promise<void> = new Promise<void>(
        (resolve: () => void): void => {
          answer.socket.once("close", resolve);
        },
      );

      await proxy.close();
      await closed;

      await expect(proxy.start()).rejects.toThrow("has been closed");
      expect(() => {
        return proxy.getPort();
      }).toThrow("has not been started");
    });
  });

  describe("the axios bridge's agents", () => {
    test("send a request and its redirects through the proxy, each hop checked", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);
      fakeInternet.route(SECOND_PUBLIC_IPV4, 80, siteServer.port);
      siteServer.respond = (
        request: IncomingMessage,
        response: ServerResponse,
      ): void => {
        if (request.url === "/start") {
          response.writeHead(302, {
            Location: `http://${SECOND_PUBLIC_IPV4}/landed`,
          });
          response.end();
          return;
        }
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end(`landed at ${request.headers.host}${request.url}`);
      };
      const agents: SyntheticEgressRequestAgents = proxy.createRequestAgents();

      try {
        const response: AxiosResponse = await axios.get(
          `http://${PUBLIC_IPV4}/start`,
          {
            proxy: false,
            httpAgent: agents.httpAgent,
            httpsAgent: agents.httpsAgent,
            responseType: "text",
          },
        );

        expect(response.data).toBe(`landed at ${SECOND_PUBLIC_IPV4}/landed`);
        expect(agents.takeFailure()).toBeUndefined();
        expect(
          fakeInternet.requests.map((seen: FakeInternetRequest) => {
            return seen.url;
          }),
        ).toEqual([
          `http://${PUBLIC_IPV4}:80/start`,
          `http://${SECOND_PUBLIC_IPV4}:80/landed`,
        ]);
      } finally {
        agents.release();
      }
    });

    test("record a redirect to a refused target for the request alone", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);
      siteServer.respond = (
        _request: IncomingMessage,
        response: ServerResponse,
      ): void => {
        response.writeHead(302, {
          Location: `http://127.0.0.1:${loopback.port}/secret`,
        });
        response.end();
      };
      const agents: SyntheticEgressRequestAgents = proxy.createRequestAgents();

      try {
        await expect(
          axios.get(`http://${PUBLIC_IPV4}/start`, {
            proxy: false,
            httpAgent: agents.httpAgent,
            httpsAgent: agents.httpsAgent,
          }),
        ).rejects.toThrow();

        expect(agents.takeFailure()).toBe(
          "Monitor target host 127.0.0.1 is not allowed: loopback address.",
        );
        expect(proxy.getBrowserRefusals()).toEqual([]);
        expect(loopback.seen).toEqual([]);
      } finally {
        agents.release();
      }

      expect(agents.takeFailure()).toBeUndefined();
    });

    test("record an https request's refusal, which the client sees only as a failed tunnel", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      const agents: SyntheticEgressRequestAgents = proxy.createRequestAgents();

      try {
        await expect(
          axios.get("https://169.254.169.254/latest/meta-data/", {
            proxy: false,
            httpAgent: agents.httpAgent,
            httpsAgent: agents.httpsAgent,
          }),
        ).rejects.toThrow();

        expect(agents.takeFailure()).toBe(
          "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
        );
        expect(fakeInternet.isUntouched).toBe(true);
      } finally {
        agents.release();
      }
    });
  });

  describe("the browser's refusals", () => {
    test("are kept once per target, up to a limit, for the run's log", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);

      await sendThroughProxy(proxy.getPort(), "http://127.0.0.1/a");
      await sendThroughProxy(proxy.getPort(), "http://127.0.0.1/b");
      for (
        let index: number = 1;
        index <= MAX_RECORDED_BROWSER_REFUSALS + 2;
        index++
      ) {
        await sendThroughProxy(proxy.getPort(), `http://10.0.0.${index}/`);
      }

      const refusals: Array<SyntheticEgressRefusal> =
        proxy.getBrowserRefusals();
      expect(refusals).toHaveLength(MAX_RECORDED_BROWSER_REFUSALS);
      expect(refusals[0]).toEqual({
        target: "127.0.0.1:80",
        message:
          "Monitor target host 127.0.0.1 is not allowed: loopback address.",
      });
      expect(refusals[1]!.target).toBe("10.0.0.1:80");
    });

    test("become log lines within the log's limits", () => {
      const refusals: Array<SyntheticEgressRefusal> = [
        {
          target: "169.254.169.254:80",
          message:
            "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
        },
      ];

      expect(
        SyntheticEgressProxy.withRefusalNotes(["script line"], refusals),
      ).toEqual([
        "script line",
        "The probe did not send the browser's request to 169.254.169.254:80: Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
      ]);

      const full: Array<string> = new Array<string>(
        MAX_SANDBOX_LOG_MESSAGES,
      ).fill("x");
      expect(SyntheticEgressProxy.withRefusalNotes(full, refusals)).toEqual(
        full,
      );
      expect(SyntheticEgressProxy.withRefusalNotes([], [])).toEqual([]);
    });
  });
});
