import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios, { AxiosResponse } from "axios";
import dns from "dns";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import https from "https";
import net, { AddressInfo } from "net";
import { HttpProxyAgent } from "http-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import SyntheticEgressProxy, {
  MAX_RECORDED_BROWSER_REFUSALS,
  SYNTHETIC_EGRESS_REFUSAL_HEADER,
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
import TestCertificateAuthority from "./Fixtures/TestCertificateAuthority";

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
      // Port 0 reaches nothing: it is never read as the default port.
      { label: "a URL with port 0", path: `http://${PUBLIC_IPV4}:0/` },
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
        // Both requests - the first and the redirect hop - came through here.
        expect(agents.requestsSeen()).toBe(2);
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

  /*
   * Why a navigation failed, for the script (PlaywrightCapabilityBroker): the
   * browser reports an https request this proxy did not send as a failed
   * tunnel, and an http one as the proxy's own 403 or 502.
   */
  describe("the browser's requests it did not send", () => {
    test("are found by their target and the kind of request, from a point in the record on", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      const before: number = proxy.getBrowserFailureSequence();

      await sendThroughProxy(proxy.getPort(), "http://127.0.0.1:81/a");
      const tunnel: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        "missing.example.test:443",
      );
      tunnel.socket.destroy();
      const after: number = proxy.getBrowserFailureSequence();

      expect(after).toBe(before + 2);
      expect(
        proxy.findBrowserFailure({
          afterSequence: before,
          target: "127.0.0.1:81",
          kind: "request",
        }),
      ).toBe("Monitor target host 127.0.0.1 is not allowed: loopback address.");
      // A host that cannot be reached is a failure the browser reports too.
      expect(
        proxy.findBrowserFailure({
          afterSequence: before,
          target: "missing.example.test:443",
          kind: "tunnel",
        }),
      ).toBe("Monitor target host missing.example.test could not be reached.");
      // Not one that came before the navigation that asks, another target, or another kind.
      expect(
        proxy.findBrowserFailure({
          afterSequence: after,
          target: "127.0.0.1:81",
          kind: "request",
        }),
      ).toBeUndefined();
      expect(
        proxy.findBrowserFailure({
          afterSequence: before,
          target: "127.0.0.1:82",
          kind: "request",
        }),
      ).toBeUndefined();
      expect(
        proxy.findBrowserFailure({
          afterSequence: before,
          target: "127.0.0.1:81",
          kind: "tunnel",
        }),
      ).toBeUndefined();
    });

    /*
     * The page can read the mark - after a refused navigation it sits at the
     * refused origin, and the proxy answers its own fetch there - so a mark
     * is believed only for the response it was written on.
     */
    test("carry the proxy's mark, believed only on the response it was written for", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      const other: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      const refusedUrl: string = "http://169.254.169.254/latest/meta-data/";
      const before: number = proxy.getBrowserFailureSequence();

      const answer: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        refusedUrl,
      );
      const marker: string = String(
        answer.headers[SYNTHETIC_EGRESS_REFUSAL_HEADER],
      );
      const read: (
        value: string | undefined,
        url?: string,
        since?: number,
      ) => string | undefined = (
        value: string | undefined,
        url: string = refusedUrl,
        since: number = before,
      ): string | undefined => {
        return proxy.readRefusalMarker({ value, url, afterSequence: since });
      };

      expect(answer.status).toBe(403);
      expect(read(marker)).toBe(
        "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
      );
      // The same host and port, however the URL writes it.
      expect(read(marker, "http://169.254.169.254:80/other?x=1")).toBe(
        "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
      );
      // Echoed by a site on another host, or read after the navigation began, it is not believed.
      expect(read(marker, `http://${PUBLIC_IPV4}/echo`)).toBeUndefined();
      expect(
        read(marker, "https://169.254.169.254/latest/meta-data/"),
      ).toBeUndefined();
      expect(
        read(marker, refusedUrl, proxy.getBrowserFailureSequence()),
      ).toBeUndefined();
      // Nor another check's, nor one this proxy did not write.
      expect(
        other.readRefusalMarker({
          value: marker,
          url: refusedUrl,
          afterSequence: 0,
        }),
      ).toBeUndefined();
      expect(read(`${"0".repeat(24)}.${marker.split(".")[1]}`)).toBeUndefined();
      expect(read(`${marker.split(".")[0]}.999`)).toBeUndefined();
      expect(read("not a marker")).toBeUndefined();
      expect(read(undefined)).toBeUndefined();
    });

    test("leave an axios request's refusals out: those are the request's own error", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      const before: number = proxy.getBrowserFailureSequence();
      const agents: SyntheticEgressRequestAgents = proxy.createRequestAgents();

      try {
        await expect(
          axios.get("http://127.0.0.1:81/", {
            proxy: false,
            httpAgent: agents.httpAgent,
            httpsAgent: agents.httpsAgent,
          }),
        ).rejects.toThrow();
      } finally {
        agents.release();
      }

      expect(proxy.getBrowserFailureSequence()).toBe(before);
      expect(proxy.getBrowserRefusals()).toEqual([]);
    });

    test("are filed under the target a URL names, as the proxy is asked for it", () => {
      expect(SyntheticEgressProxy.targetOfUrl("http://Example.COM/x")).toBe(
        "example.com:80",
      );
      expect(SyntheticEgressProxy.targetOfUrl("https://[::1]/")).toBe(
        "[::1]:443",
      );
      expect(
        SyntheticEgressProxy.targetOfUrl("ws://h.example.test:8080/s"),
      ).toBe("h.example.test:8080");
      expect(SyntheticEgressProxy.targetOfUrl("wss://h.example.test/s")).toBe(
        "h.example.test:443",
      );
      expect(SyntheticEgressProxy.targetOfUrl("http://0x7f.1/")).toBe(
        "127.0.0.1:80",
      );
      expect(SyntheticEgressProxy.targetOfUrl("http://h.example.test:0/")).toBe(
        null,
      );
      expect(SyntheticEgressProxy.targetOfUrl("file:///etc/passwd")).toBe(null);
      expect(SyntheticEgressProxy.targetOfUrl("not a url")).toBe(null);
    });
  });

  describe("the axios bridge's agents, whatever the runtime", () => {
    /*
     * They dial the proxy themselves. On Node 24, http.Agent's proxyEnv
     * option was silently ignored and the requests went direct, loopback
     * answered and nothing recorded.
     */
    test("are an http proxy agent and a CONNECT agent for this proxy and nothing else", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      const agents: SyntheticEgressRequestAgents = proxy.createRequestAgents();

      try {
        expect(agents.httpAgent).toBeInstanceOf(HttpProxyAgent);
        expect(agents.httpsAgent).toBeInstanceOf(HttpsProxyAgent);
        for (const agent of [agents.httpAgent, agents.httpsAgent]) {
          const proxyUrl: URL = (
            agent as HttpProxyAgent<string> | HttpsProxyAgent<string>
          ).proxy;
          expect(proxyUrl.host).toBe(`127.0.0.1:${proxy.getPort()}`);
          expect(proxyUrl.protocol).toBe("http:");
        }
        expect(agents.requestsSeen()).toBe(0);
      } finally {
        agents.release();
      }
    });

    test("count only their own requests", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);
      const first: SyntheticEgressRequestAgents = proxy.createRequestAgents();
      const second: SyntheticEgressRequestAgents = proxy.createRequestAgents();

      try {
        await axios.get(`http://${PUBLIC_IPV4}/one`, {
          proxy: false,
          httpAgent: first.httpAgent,
          httpsAgent: first.httpsAgent,
        });
        // The browser's request, which carries no tag, is no one's.
        await sendThroughProxy(proxy.getPort(), `http://${PUBLIC_IPV4}/two`);

        expect(first.requestsSeen()).toBe(1);
        expect(second.requestsSeen()).toBe(0);
      } finally {
        first.release();
        second.release();
      }

      expect(first.requestsSeen()).toBe(0);
    });
  });

  /*
   * A target's answer that Node will not write again used to throw inside
   * the HTTP parser's callback, uncaught, and end the check's worker.
   */
  describe("an answer it cannot relay as it came", () => {
    // An outbound proxy that answers every request with `reply`, verbatim.
    async function rawUpstream(
      reply: string,
    ): Promise<{ url: string; close: () => Promise<void> }> {
      const sockets: Set<net.Socket> = new Set<net.Socket>();
      const server: net.Server = net.createServer(
        (socket: net.Socket): void => {
          sockets.add(socket);
          socket.on("error", (): void => {
            // The proxy went away.
          });
          let received: string = "";
          socket.on("data", (chunk: Buffer): void => {
            received += chunk.toString("latin1");
            if (received.includes("\r\n\r\n")) {
              received = "";
              socket.write(reply, "latin1");
            }
          });
        },
      );
      await new Promise<void>((resolve: () => void): void => {
        server.listen(0, "127.0.0.1", resolve);
      });

      return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        close: async (): Promise<void> => {
          for (const socket of sockets) {
            socket.destroy();
          }
          await new Promise<void>((resolve: () => void): void => {
            server.close((): void => {
              resolve();
            });
          });
        },
      };
    }

    async function proxyBehind(
      upstreamUrl: string,
    ): Promise<SyntheticEgressProxy> {
      const proxy: SyntheticEgressProxy = new SyntheticEgressProxy({
        policy: PUBLIC_ONLY,
        upstreamProxy: { server: upstreamUrl },
      });
      await proxy.start();
      proxies.push(proxy);
      return proxy;
    }

    test.each([
      { label: "a status below 100", statusLine: "HTTP/1.1 099 OK" },
      { label: "a status of 0", statusLine: "HTTP/1.1 000 Nothing" },
    ])(
      "answers $label with 502, and keeps serving",
      async ({ statusLine }: { label: string; statusLine: string }) => {
        const upstream: { url: string; close: () => Promise<void> } =
          await rawUpstream(`${statusLine}\r\nContent-Length: 2\r\n\r\nhi`);

        try {
          const proxy: SyntheticEgressProxy = await proxyBehind(upstream.url);

          const answer: HttpAnswer = await sendThroughProxy(
            proxy.getPort(),
            `http://${PUBLIC_IPV4}/`,
          );

          expect(answer.status).toBe(502);
          // Read and refused, or refused by the parser first: either way, 502.
          expect([
            `Monitor target host ${PUBLIC_IPV4} sent a response the probe could not read.`,
            `Monitor target host ${PUBLIC_IPV4} could not be reached.`,
          ]).toContain(answer.body);
          // Still serving: the next request is answered.
          const next: TunnelAnswer = await sendConnect(
            proxy.getPort(),
            "127.0.0.1:443",
          );
          expect(next.status).toBe(403);
        } finally {
          await upstream.close();
        }
      },
    );

    test.each([
      { label: "DEL (0x7f)", reason: "O\x7fK" },
      { label: "SOH (0x01)", reason: "O\x01K" },
      { label: "a vertical tab (0x0b)", reason: "O\x0bK" },
    ])(
      "relays a reason phrase holding $label without it",
      async ({ reason }: { label: string; reason: string }) => {
        const upstream: { url: string; close: () => Promise<void> } =
          await rawUpstream(
            `HTTP/1.1 200 ${reason}\r\nContent-Length: 2\r\n\r\nhi`,
          );

        try {
          const proxy: SyntheticEgressProxy = await proxyBehind(upstream.url);

          const answer: { status: number; reason: string; body: string } =
            await new Promise<{ status: number; reason: string; body: string }>(
              (
                resolve: (value: {
                  status: number;
                  reason: string;
                  body: string;
                }) => void,
                reject: (error: Error) => void,
              ): void => {
                const request: http.ClientRequest = http.request(
                  {
                    host: "127.0.0.1",
                    port: proxy.getPort(),
                    path: `http://${PUBLIC_IPV4}/`,
                    headers: { Host: PUBLIC_IPV4 },
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
                        reason: response.statusMessage || "",
                        body,
                      });
                    });
                  },
                );
                request.on("error", reject);
                request.end();
              },
            );

          expect(answer).toEqual({ status: 200, reason: "OK", body: "hi" });
        } finally {
          await upstream.close();
        }
      },
    );
  });

  describe("what it asks the operator's outbound proxy for", () => {
    /*
     * A proxy that routes on Host rather than on the absolute URI would
     * have fetched the metadata endpoint from its own network.
     */
    test("never shows it a Host header that names another host than the one checked", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);

      const answer: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://${PUBLIC_IPV4}/latest/meta-data/`,
        { headers: { Host: "169.254.169.254" } },
      );

      expect(answer.status).toBe(400);
      expect(answer.body).toBe(
        `The probe did not send this request: through its outbound proxy, the Host header must name the host the URL names (${PUBLIC_IPV4}).`,
      );
      expect(fakeInternet.isUntouched).toBe(true);
      expect(siteServer.seen).toEqual([]);
    });

    test("names a name's host and port in the Host header it sends", async () => {
      answerDns({ "site.example.test": [[PUBLIC_IPV4]] });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 8080, siteServer.port);

      await sendThroughProxy(
        proxy.getPort(),
        "http://site.example.test:8080/page",
        { headers: { Host: "Site.Example.Test:8080" } },
      );

      expect(fakeInternet.requests[0]).toMatchObject({
        url: `http://${PUBLIC_IPV4}:8080/page`,
        host: "site.example.test:8080",
      });
    });

    test("asks for the next approved address when the proxy cannot open a tunnel to the first", async () => {
      // The first is not on the fake internet: the outbound proxy refuses it.
      answerDns({ "multi.example.test": [["93.184.215.99", PUBLIC_IPV4]] });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 443, siteServer.port);

      const answer: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        "multi.example.test:443",
      );
      answer.socket.destroy();

      expect(answer.status).toBe(200);
      expect(fakeInternet.connects).toEqual([
        "93.184.215.99:443",
        `${PUBLIC_IPV4}:443`,
      ]);
    });

    test("asks for an approved IPv4 address before an IPv6 one", async () => {
      answerDns({
        "dual.example.test": [
          ["2606:2800:21f:cb07:6820:80da:af6b:8b2c", PUBLIC_IPV4],
        ],
      });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);
      fakeInternet.route(PUBLIC_IPV4, 443, siteServer.port);

      const plain: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        "http://dual.example.test/",
      );
      const tunnel: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        "dual.example.test:443",
      );
      tunnel.socket.destroy();

      expect(plain.status).toBe(200);
      expect(fakeInternet.requests[0]!.url).toBe(`http://${PUBLIC_IPV4}:80/`);
      expect(fakeInternet.connects).toEqual([`${PUBLIC_IPV4}:443`]);
    });

    test("does not ask an outbound proxy it cannot reach about other addresses", async () => {
      answerDns({ "multi.example.test": [["93.184.215.99", PUBLIC_IPV4]] });
      const closed: LoopbackServer = new LoopbackServer();
      await closed.start();
      const closedPort: number = closed.port;
      await closed.stop();
      const proxy: SyntheticEgressProxy = new SyntheticEgressProxy({
        policy: PUBLIC_ONLY,
        upstreamProxy: { server: `http://127.0.0.1:${closedPort}` },
      });
      await proxy.start();
      proxies.push(proxy);
      const connect: ReturnType<typeof jest.spyOn> = jest.spyOn(net, "connect");

      const answer: TunnelAnswer = await sendConnect(
        proxy.getPort(),
        "multi.example.test:443",
      );

      expect(answer.status).toBe(502);
      expect(
        connect.mock.calls.filter((call: Array<unknown>) => {
          return (call[0] as { port?: number }).port === closedPort;
        }),
      ).toHaveLength(1);
    });
  });

  describe("approved addresses, dialled directly", () => {
    test("connect over the next one when the first is not answered", async () => {
      // A name with an IPv6 answer first, where nothing listens on IPv6.
      jest.spyOn(dns.promises, "lookup").mockImplementation((async (
        hostname: string,
      ) => {
        if (hostname !== "dual-stack.example.test") {
          throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), {
            code: "ENOTFOUND",
          });
        }
        return [
          { address: "::1", family: 6 },
          { address: "127.0.0.1", family: 4 },
        ];
      }) as never);
      // Loopback stands in for two public addresses here; the guard's own tests cover loopback.
      jest.spyOn(DataSourceEgressGuard, "checkAddress").mockReturnValue({
        blocked: false,
      } as never);
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY, {
        upstream: false,
      });

      const answer: HttpAnswer = await sendThroughProxy(
        proxy.getPort(),
        `http://dual-stack.example.test:${siteServer.port}/both`,
      );

      expect(answer.status).toBe(200);
      expect(answer.body).toBe("public site GET /both");
    });
  });

  describe("the operator's outbound proxy setting", () => {
    test.each([
      "http://[not-an-address/",
      "http://proxy.internal:99999",
      "http://probe:s3cret@proxy internal:3128",
    ])(
      "is a fault, never no proxy at all, when %s cannot be read",
      (server: string) => {
        let thrown: unknown;
        try {
          new SyntheticEgressProxy({ upstreamProxy: { server } });
        } catch (error: unknown) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as Error).message).toBe(
          "The probe's outbound proxy URL could not be read.",
        );
        expect((thrown as Error).message).not.toContain("s3cret");
      },
    );

    test.each(["socks5://proxy.internal:1080", "ftp://proxy.internal/"])(
      "is a fault when %s is not a proxy it can use",
      (server: string) => {
        expect(() => {
          return new SyntheticEgressProxy({ upstreamProxy: { server } });
        }).toThrow(
          "The probe's outbound proxy URL must be an http:// or https:// URL with a host.",
        );
      },
    );
  });

  /*
   * The axios bridge's requests go where their URL says, as main sent them.
   * http-proxy-agent built the absolute URI it asks a proxy for from the
   * Host header and resolved the path as a URL: "//v1/health" became a
   * host named "v1", "//93.184.215.34/whoami" a request to 93.184.215.34,
   * and a Host header the script set sent the request to that host.
   */
  describe("the axios bridge's requests, where their URL says", () => {
    async function get(
      proxy: SyntheticEgressProxy,
      url: string,
      headers: Record<string, string> = {},
    ): Promise<{
      status?: number;
      data?: unknown;
      error?: string;
      failure: string | undefined;
      seen: number;
    }> {
      const agents: SyntheticEgressRequestAgents = proxy.createRequestAgents();

      try {
        const response: AxiosResponse = await axios.get(url, {
          proxy: false,
          httpAgent: agents.httpAgent,
          httpsAgent: agents.httpsAgent,
          headers,
          responseType: "text",
          validateStatus: (): boolean => {
            return true;
          },
        });
        return {
          status: response.status,
          data: response.data,
          failure: agents.takeFailure(),
          seen: agents.requestsSeen(),
        };
      } catch (error: unknown) {
        return {
          error: (error as Error).message,
          failure: agents.takeFailure(),
          seen: agents.requestsSeen(),
        };
      } finally {
        agents.release();
      }
    }

    test.each([
      { path: `//${SECOND_PUBLIC_IPV4}/whoami` },
      { path: "//v1/health" },
      { path: "//u@x/" },
    ])(
      "asks the outbound proxy for $path on the URL's own host",
      async ({ path }: { path: string }) => {
        const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
        fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);
        fakeInternet.route(SECOND_PUBLIC_IPV4, 80, loopback.port);

        const answer: Awaited<ReturnType<typeof get>> = await get(
          proxy,
          `http://${PUBLIC_IPV4}${path}`,
        );

        expect(answer).toEqual({
          status: 200,
          data: `public site GET ${path}`,
          failure: undefined,
          seen: 1,
        });
        expect(fakeInternet.requests).toEqual([
          {
            method: "GET",
            url: `http://${PUBLIC_IPV4}:80${path}`,
            host: PUBLIC_IPV4,
            credentials: "",
          },
        ]);
        expect(loopback.seen).toEqual([]);
      },
    );

    test("sends a Host header the script set as a header, to the URL's own address, when it goes directly", async () => {
      approveOnLoopback({ "site.example.test": ["127.0.0.1"] });
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY, {
        upstream: false,
      });

      const answer: Awaited<ReturnType<typeof get>> = await get(
        proxy,
        `http://site.example.test:${siteServer.port}/whoami`,
        { Host: SECOND_PUBLIC_IPV4 },
      );

      expect(answer.status).toBe(200);
      expect(answer.data).toBe("public site GET /whoami");
      // As main sent it: to the URL's address, the script's Host as a header.
      expect(siteServer.seen[0]!.headers.host).toBe(SECOND_PUBLIC_IPV4);
    });

    test.each([
      { label: "another host", host: SECOND_PUBLIC_IPV4 },
      { label: "user information", host: `u@${SECOND_PUBLIC_IPV4}` },
      { label: "another port", host: `${PUBLIC_IPV4}:8080` },
    ])(
      "refuses, as the request's own error, a Host header naming $label through the outbound proxy",
      async ({ host }: { label: string; host: string }) => {
        const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
        fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);
        fakeInternet.route(SECOND_PUBLIC_IPV4, 80, siteServer.port);

        const answer: Awaited<ReturnType<typeof get>> = await get(
          proxy,
          `http://${PUBLIC_IPV4}/whoami`,
          { Host: host },
        );

        // A proxy routing on Host is never shown one the guard did not check.
        expect(answer.failure).toBe(
          `The probe did not send this request: through its outbound proxy, the Host header must name the host the URL names (${PUBLIC_IPV4}).`,
        );
        expect(answer.status).toBe(400);
        expect(fakeInternet.isUntouched).toBe(true);
        expect(siteServer.seen).toEqual([]);
      },
    );

    test.each([`${PUBLIC_IPV4}`, `${PUBLIC_IPV4}:80`])(
      "sends a Host header of %s, which names the URL's own host, through the outbound proxy",
      async (host: string) => {
        const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
        fakeInternet.route(PUBLIC_IPV4, 80, siteServer.port);

        const answer: Awaited<ReturnType<typeof get>> = await get(
          proxy,
          `http://${PUBLIC_IPV4}/whoami`,
          { Host: host },
        );

        expect(answer.status).toBe(200);
        expect(fakeInternet.requests[0]!.host).toBe(PUBLIC_IPV4);
      },
    );

    describe("over https", () => {
      let authority: TestCertificateAuthority;
      let distrust: () => void;
      const servers: Array<https.Server> = [];

      beforeAll(() => {
        authority = TestCertificateAuthority.create();
        distrust = authority.trustInThisProcess();
      });

      afterAll(() => {
        distrust();
        authority.remove();
      });

      afterEach(async () => {
        while (servers.length > 0) {
          const server: https.Server = servers.pop()!;
          server.closeAllConnections();
          await new Promise<void>((resolve: () => void): void => {
            server.close((): void => {
              resolve();
            });
          });
        }
      });

      async function secureSite(certificate: {
        names?: Array<string>;
        addresses?: Array<string>;
      }): Promise<number> {
        const server: https.Server = https.createServer(
          authority.issue(certificate),
          (_request: IncomingMessage, response: ServerResponse): void => {
            response.end("tls-ok");
          },
        );
        servers.push(server);
        await new Promise<void>((resolve: () => void): void => {
          server.listen(0, "127.0.0.1", resolve);
        });
        return (server.address() as AddressInfo).port;
      }

      /*
       * Inside a tunnel the certificate was checked against "localhost":
       * https://93.184.215.14/ failed against a certificate naming
       * 93.184.215.14 ("Host: localhost. is not in the cert's altnames").
       */
      test("checks an address's certificate against that address", async () => {
        const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
        fakeInternet.route(
          PUBLIC_IPV4,
          443,
          await secureSite({ addresses: [PUBLIC_IPV4] }),
        );

        const answer: Awaited<ReturnType<typeof get>> = await get(
          proxy,
          `https://${PUBLIC_IPV4}/`,
        );

        expect(answer).toEqual({
          status: 200,
          data: "tls-ok",
          failure: undefined,
          seen: 1,
        });
      });

      test("checks a name's certificate against that name", async () => {
        answerDns({ "secure.example.test": [[SECOND_PUBLIC_IPV4]] });
        const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
        fakeInternet.route(
          SECOND_PUBLIC_IPV4,
          443,
          await secureSite({ names: ["secure.example.test"] }),
        );

        const answer: Awaited<ReturnType<typeof get>> = await get(
          proxy,
          "https://secure.example.test/",
        );

        expect(answer.status).toBe(200);
        expect(answer.data).toBe("tls-ok");
      });

      test.each([
        {
          label: "an address the certificate does not name",
          url: `https://${PUBLIC_IPV4}/`,
          certificate: { addresses: [SECOND_PUBLIC_IPV4] },
        },
        {
          label: "a name the certificate does not name",
          url: "https://secure.example.test/",
          certificate: { names: ["other.example.test"] },
        },
        {
          label: "an address, with a certificate for localhost",
          url: `https://${PUBLIC_IPV4}/`,
          certificate: { names: ["localhost"], addresses: ["127.0.0.1"] },
        },
      ])(
        "still refuses $label",
        async ({
          url,
          certificate,
        }: {
          label: string;
          url: string;
          certificate: { names?: Array<string>; addresses?: Array<string> };
        }) => {
          answerDns({ "secure.example.test": [[PUBLIC_IPV4]] });
          const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
          fakeInternet.route(PUBLIC_IPV4, 443, await secureSite(certificate));

          const answer: Awaited<ReturnType<typeof get>> = await get(proxy, url);

          expect(answer.status).toBeUndefined();
          expect(answer.error).toMatch(/altnames/);
        },
      );
    });
  });

  /*
   * A request this proxy cannot read is answered for the request that sent
   * it: an axios request is told so as its own error, rather than handed
   * the proxy's 400 as though the site had sent it.
   */
  describe("a request it cannot read", () => {
    // A raw request through the proxy, signed in with an axios request's tag.
    async function sendRaw(proxyPort: number, head: string): Promise<string> {
      return await new Promise<string>(
        (resolve: (value: string) => void): void => {
          const socket: net.Socket = net.connect({
            host: "127.0.0.1",
            port: proxyPort,
          });
          let received: string = "";
          socket.on("data", (chunk: Buffer): void => {
            received += chunk.toString("utf8");
          });
          socket.on("close", (): void => {
            resolve(received);
          });
          socket.on("error", (): void => {
            resolve(received);
          });
          socket.write(head);
        },
      );
    }

    function tagOf(agents: SyntheticEgressRequestAgents): string {
      return (agents.httpAgent as HttpProxyAgent<string>).proxy.username;
    }

    test.each([
      {
        label: "a CONNECT naming no port",
        head: (tag: string): string => {
          return `CONNECT ${PUBLIC_IPV4} HTTP/1.1\r\nHost: ${PUBLIC_IPV4}\r\nProxy-Authorization: Basic ${Buffer.from(`${tag}:`).toString("base64")}\r\n\r\n`;
        },
        failure:
          "The probe could not read the host and port this request was sent to.",
      },
      {
        label: "an absolute URL with user information",
        head: (tag: string): string => {
          return `GET http://u@${PUBLIC_IPV4}/ HTTP/1.1\r\nHost: ${PUBLIC_IPV4}\r\nProxy-Authorization: Basic ${Buffer.from(`${tag}:`).toString("base64")}\r\nConnection: close\r\n\r\n`;
        },
        failure:
          "The probe could not read the address this request was sent to.",
      },
      {
        label: "an origin-form request",
        head: (tag: string): string => {
          return `GET /not-a-proxy-request HTTP/1.1\r\nHost: ${PUBLIC_IPV4}\r\nProxy-Authorization: Basic ${Buffer.from(`${tag}:`).toString("base64")}\r\nConnection: close\r\n\r\n`;
        },
        failure:
          "The probe could not read the address this request was sent to.",
      },
    ])(
      "refuses $label as the request's own error",
      async ({
        head,
        failure,
      }: {
        label: string;
        head: (tag: string) => string;
        failure: string;
      }) => {
        const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
        const agents: SyntheticEgressRequestAgents =
          proxy.createRequestAgents();

        try {
          const answer: string = await sendRaw(
            proxy.getPort(),
            head(tagOf(agents)),
          );

          expect(answer).toContain("400 Bad Request");
          expect(agents.takeFailure()).toBe(failure);
          expect(fakeInternet.isUntouched).toBe(true);
        } finally {
          agents.release();
        }
      },
    );

    test("files the browser's as a request it did not send", async () => {
      const proxy: SyntheticEgressProxy = await startProxy(PUBLIC_ONLY);
      const before: number = proxy.getBrowserFailureSequence();

      const answer: string = await sendRaw(
        proxy.getPort(),
        `CONNECT ${PUBLIC_IPV4} HTTP/1.1\r\nHost: ${PUBLIC_IPV4}\r\n\r\n`,
      );

      expect(answer).toContain("400 Bad Request");
      expect(proxy.getBrowserFailureSequence()).toBe(before + 1);
    });
  });

  /*
   * Only an outbound proxy's explicit "no" to one address is worth asking
   * about the next. One that does not answer the CONNECT, or closes it,
   * held a tunnel for a timeout per approved address: up to 120 s.
   */
  describe("an outbound proxy that does not answer", () => {
    async function hungProxy(behaviour: "silent" | "closes"): Promise<{
      url: string;
      connections: () => number;
      stop: () => Promise<void>;
    }> {
      let connections: number = 0;
      const sockets: Set<net.Socket> = new Set<net.Socket>();
      const server: net.Server = net.createServer(
        (socket: net.Socket): void => {
          connections++;
          sockets.add(socket);
          socket.on("error", (): void => {
            // The egress proxy gave up.
          });
          if (behaviour === "closes") {
            socket.on("data", (): void => {
              socket.destroy();
            });
          }
        },
      );
      await new Promise<void>((resolve: () => void): void => {
        server.listen(0, "127.0.0.1", resolve);
      });

      return {
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        connections: (): number => {
          return connections;
        },
        stop: async (): Promise<void> => {
          for (const socket of sockets) {
            socket.destroy();
          }
          await new Promise<void>((resolve: () => void): void => {
            server.close((): void => {
              resolve();
            });
          });
        },
      };
    }

    test.each(["silent", "closes"] as const)(
      "is asked once, for one address, when it is %s",
      async (behaviour: "silent" | "closes") => {
        answerDns({
          "multi.example.test": [
            [PUBLIC_IPV4, SECOND_PUBLIC_IPV4, "93.184.215.99"],
          ],
        });
        const upstream: Awaited<ReturnType<typeof hungProxy>> =
          await hungProxy(behaviour);

        try {
          const proxy: SyntheticEgressProxy = new SyntheticEgressProxy({
            policy: PUBLIC_ONLY,
            upstreamProxy: { server: upstream.url },
            connectTimeoutInMs: 300,
          });
          await proxy.start();
          proxies.push(proxy);
          const startedAt: number = Date.now();

          const answer: TunnelAnswer = await sendConnect(
            proxy.getPort(),
            "multi.example.test:443",
          );

          expect(answer.status).toBe(502);
          expect(answer.body).toBe(
            "Monitor target host multi.example.test could not be reached.",
          );
          expect(upstream.connections()).toBe(1);
          // One timeout at most, not one per address.
          expect(Date.now() - startedAt).toBeLessThan(3_000);
        } finally {
          await upstream.stop();
        }
      },
    );
  });
});
