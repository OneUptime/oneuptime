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
import type * as ConfigModule from "../../../../Config";
import type * as ProxyConfigModule from "../../../../Utils/ProxyConfig";
import type * as OnlineCheckModule from "../../../../Utils/OnlineCheck";
import type * as HttpMonitorRequestModule from "../../../../Utils/Monitors/HttpMonitorRequest";
import type * as WebsiteMonitorModule from "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import type * as ApiMonitorModule from "../../../../Utils/Monitors/MonitorTypes/ApiMonitor";
import type * as ExternalStatusPageMonitorModule from "../../../../Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor";
import PrivateNetworkMonitorPolicy from "../../../../Utils/PrivateNetworkMonitorPolicy";
import SelfSignedCertificate from "./SslTestCertificates";
import type * as EgressGuardModule from "Common/Server/Utils/DataSource/EgressGuard";
import type * as URLModule from "Common/Types/API/URL";
import type * as SleepModule from "Common/Types/Sleep";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import ExternalStatusPageProviderType from "Common/Types/Monitor/ExternalStatusPageProviderType";
import type ExternalStatusPageMonitorResponse from "Common/Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import { Duplex } from "stream";

/*
 * Monitor-level regression tests for OneUptime issue #3879: a Website, API or
 * External Status Page monitor running on a SELF-HOSTED GLOBAL probe - the
 * probe the Helm chart and Docker Compose bundle - with
 * PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true must actually SUCCEED against a
 * private target, through the real egress guard, end to end.
 *
 * Before the fix such a probe resolved the opt-in to false because it
 * registers with REGISTER_PROBE_KEY, so these monitors reported a refusal
 * instead of the target's status after upgrading to 13.0.0.
 *
 * A test cannot own a 10.x host, so the target is reached the way an
 * operator's network often reaches it anyway: through the probe's configured
 * HTTP(S) proxy (HTTP_PROXY_URL / HTTPS_PROXY_URL). The proxy here is a local
 * server on 127.0.0.1 that answers for the private target. Nothing about the
 * policy is mocked: the monitor calls HttpMonitorRequest.prepare, which asks
 * the real DataSourceEgressGuard whether 10.23.45.67 may be reached, and only
 * if it may does the request leave for the proxy - pinned to the validated
 * address. The proxy's request log is therefore the evidence: under the
 * opt-in it sees the private target, and wherever the policy refuses it sees
 * nothing at all.
 *
 * The proxy only ever sees requests the guard approved; it does not widen
 * anything. The forbidden tier (loopback, link-local, metadata) is refused
 * before the proxy is consulted, which the last group of tests pins: an
 * operator proxy is exactly the thing that WOULD happily forward
 * 169.254.169.254 if the guard let it through.
 *
 * No real network is used. DNS answers are injected at dns.promises.lookup,
 * and net.Socket#connect is wrapped so that dialing anything other than the
 * loopback test servers throws instead of leaving the machine.
 */

jest.setTimeout(30_000);

type ProbeWebsiteResponse = WebsiteMonitorModule.ProbeWebsiteResponse;
type APIResponse = ApiMonitorModule.APIResponse;

interface LoadedMonitors {
  config: typeof ConfigModule;
  WebsiteMonitor: typeof WebsiteMonitorModule.default;
  ApiMonitor: typeof ApiMonitorModule.default;
  ExternalStatusPageMonitor: typeof ExternalStatusPageMonitorModule.default;
  HttpMonitorRequest: typeof HttpMonitorRequestModule.default;
  EgressGuard: typeof EgressGuardModule.default;
  OnlineCheck: typeof OnlineCheckModule.default;
  Sleep: typeof SleepModule.default;
  URL: typeof URLModule.default;
}

interface ProbeDeployment {
  registerProbeKey: string | undefined;
  billingEnabled: string | undefined;
}

interface ObservedRequest {
  method: string | undefined;
  // Absolute-form URI for a proxied HTTP request, authority for CONNECT.
  url: string | undefined;
  host: string | undefined;
  body?: string | undefined;
}

interface CannedResponse {
  contentType: string;
  body: string;
}

interface MonitorSpies {
  prepare: ReturnType<typeof jest.spyOn>;
  guard: ReturnType<typeof jest.spyOn>;
  sleep: ReturnType<typeof jest.spyOn>;
  onlineCheck: ReturnType<typeof jest.spyOn>;
}

const OPT_IN_ENV_VAR: string = "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS";

const PROBE_ENVIRONMENT_KEYS: Array<string> = [
  "ONEUPTIME_URL",
  "PROBE_INGEST_URL",
  "PROBE_KEY",
  "PROBE_ID",
  "REGISTER_PROBE_KEY",
  OPT_IN_ENV_VAR,
  "BILLING_ENABLED",
  "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES",
  "HTTP_PROXY_URL",
  "http_proxy",
  "HTTP_PROXY",
  "HTTPS_PROXY_URL",
  "https_proxy",
  "HTTPS_PROXY",
  "NO_PROXY",
  "no_proxy",
];

const PRIVATE_PROBE: ProbeDeployment = {
  registerProbeKey: undefined,
  billingEnabled: undefined,
};

// What the Helm chart and Docker Compose deploy: global, billing off.
const SELF_HOSTED_GLOBAL_PROBE: ProbeDeployment = {
  registerProbeKey: "register-probe-key-from-the-helm-chart",
  billingEnabled: undefined,
};

// The hosted product: global probes shared by every sign-up.
const HOSTED_GLOBAL_PROBE: ProbeDeployment = {
  registerProbeKey: "register-probe-key-on-the-hosted-product",
  billingEnabled: "true",
};

const SELF_HOSTED_GLOBAL_PROBE_HINT: string =
  PrivateNetworkMonitorPolicy.getRefusalHint({
    isAutoRegisteredGlobalProbe: true,
    isBillingEnabled: false,
  });

const HOSTED_GLOBAL_PROBE_HINT: string =
  " Global probes cannot monitor private network addresses. Deploy and select a private probe for this target.";

const PRIVATE_ADDRESS: string = "10.23.45.67";
const PRIVATE_HOSTNAME: string = "intranet.corp.example";

const WEBSITE_TARGET: string = `http://${PRIVATE_ADDRESS}/health`;
const API_TARGET: string = `http://${PRIVATE_ADDRESS}/api/v1/status`;
const STATUS_PAGE_TARGET: string = `http://${PRIVATE_ADDRESS}/status`;

const WEBSITE_BODY_MARKER: string = "internal-health-ok";
const TLS_BODY_MARKER: string = "internal-tls-health-ok";

// What the operator's proxy answers on behalf of the private target.
const PRIVATE_TARGET_RESPONSES: Record<string, CannedResponse> = {
  "/health": {
    contentType: "text/html",
    body: `<html>${WEBSITE_BODY_MARKER}</html>`,
  },
  "/api/v1/status": {
    contentType: "application/json",
    body: JSON.stringify({ status: "ok", service: "internal-api" }),
  },
  "/status/api/v2/status.json": {
    contentType: "application/json",
    body: JSON.stringify({
      status: {
        indicator: "none",
        description: "All Systems Operational",
      },
    }),
  },
  "/status/api/v2/components.json": {
    contentType: "application/json",
    body: JSON.stringify({
      components: [
        { id: "internal-api", name: "Internal API", status: "operational" },
      ],
    }),
  },
  "/status/api/v2/incidents/unresolved.json": {
    contentType: "application/json",
    body: JSON.stringify({ incidents: [] }),
  },
};

const DNS_ANSWERS: Record<
  string,
  Array<{ address: string; family: number }>
> = {
  [PRIVATE_HOSTNAME]: [{ address: PRIVATE_ADDRESS, family: 4 }],
  "metadata.google.internal": [{ address: "169.254.169.254", family: 4 }],
};

/*
 * Captured before any spy is installed, so the tripwire below can hand an
 * allowed dial to the real implementation.
 */
const realSocketConnect: (...args: Array<unknown>) => net.Socket = net.Socket
  .prototype.connect as unknown as (...args: Array<unknown>) => net.Socket;

let proxyServer: http.Server;
let tlsTargetServer: https.Server;
let proxyUrl: string;
let proxyPort: number;
let tlsTargetPort: number;
const openSockets: Set<Duplex> = new Set<Duplex>();
const proxiedRequests: Array<ObservedRequest> = [];
const tlsTargetRequests: Array<ObservedRequest> = [];
const dialedHosts: Array<string> = [];

function trackSocket(socket: Duplex): void {
  openSockets.add(socket);
  socket.once("close", (): void => {
    openSockets.delete(socket);
  });
}

function setEnvironmentValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

/*
 * Boot the probe's module graph as a probe process does: environment first,
 * then Config.ts (read once, at import), then ProxyConfig.configure() as
 * Index.ts calls it at startup. The environment is restored straight
 * afterwards; everything under test was decided at import. The returned
 * module copies are this graph's own, so spies go on them.
 */
function loadMonitors(
  deployment: ProbeDeployment,
  optInValue: string | undefined,
): LoadedMonitors {
  const saved: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();
  for (const key of PROBE_ENVIRONMENT_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    process.env["ONEUPTIME_URL"] = "https://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
    process.env["HTTP_PROXY_URL"] = proxyUrl;
    process.env["HTTPS_PROXY_URL"] = proxyUrl;
    setEnvironmentValue("REGISTER_PROBE_KEY", deployment.registerProbeKey);
    setEnvironmentValue("BILLING_ENABLED", deployment.billingEnabled);
    setEnvironmentValue(OPT_IN_ENV_VAR, optInValue);

    jest.resetModules();

    const config: typeof ConfigModule = jest.requireActual(
      "../../../../Config",
    ) as typeof ConfigModule;
    const proxyConfig: typeof ProxyConfigModule.default = (
      jest.requireActual(
        "../../../../Utils/ProxyConfig",
      ) as typeof ProxyConfigModule
    ).default;
    proxyConfig.configure();

    return {
      config: config,
      WebsiteMonitor: (
        jest.requireActual(
          "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor",
        ) as typeof WebsiteMonitorModule
      ).default,
      ApiMonitor: (
        jest.requireActual(
          "../../../../Utils/Monitors/MonitorTypes/ApiMonitor",
        ) as typeof ApiMonitorModule
      ).default,
      ExternalStatusPageMonitor: (
        jest.requireActual(
          "../../../../Utils/Monitors/MonitorTypes/ExternalStatusPageMonitor",
        ) as typeof ExternalStatusPageMonitorModule
      ).default,
      HttpMonitorRequest: (
        jest.requireActual(
          "../../../../Utils/Monitors/HttpMonitorRequest",
        ) as typeof HttpMonitorRequestModule
      ).default,
      EgressGuard: (
        jest.requireActual(
          "Common/Server/Utils/DataSource/EgressGuard",
        ) as typeof EgressGuardModule
      ).default,
      OnlineCheck: (
        jest.requireActual(
          "../../../../Utils/OnlineCheck",
        ) as typeof OnlineCheckModule
      ).default,
      Sleep: (jest.requireActual("Common/Types/Sleep") as typeof SleepModule)
        .default,
      URL: (jest.requireActual("Common/Types/API/URL") as typeof URLModule)
        .default,
    };
  } finally {
    for (const [key, value] of saved) {
      setEnvironmentValue(key, value);
    }
  }
}

/*
 * Where a net.Socket#connect call is headed. Node passes either (port, host),
 * an options object, or its own already-normalized [options, callback].
 */
function dialTarget(args: Array<unknown>): string {
  let first: unknown = args[0];
  if (Array.isArray(first)) {
    first = first[0];
  }

  if (typeof first === "object" && first !== null) {
    const options: { host?: unknown; path?: unknown } = first as {
      host?: unknown;
      path?: unknown;
    };
    if (typeof options.path === "string") {
      return `ipc:${options.path}`;
    }
    return typeof options.host === "string" ? options.host : "localhost";
  }

  return typeof args[1] === "string" ? args[1] : "localhost";
}

async function fakeDnsLookup(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  const answer: Array<{ address: string; family: number }> | undefined =
    DNS_ANSWERS[hostname];

  if (!answer) {
    const error: NodeJS.ErrnoException = new Error(
      `getaddrinfo ENOTFOUND ${hostname}`,
    );
    error.code = "ENOTFOUND";
    throw error;
  }

  return answer;
}

function instrument(monitors: LoadedMonitors): MonitorSpies {
  return {
    prepare: jest.spyOn(monitors.HttpMonitorRequest, "prepare"),
    guard: jest.spyOn(monitors.EgressGuard, "assertUrlAllowed"),
    // A retry would sleep first; none of these checks should retry.
    sleep: jest.spyOn(monitors.Sleep, "sleep").mockResolvedValue(undefined),
    /*
     * A refusal is a reachability failure, so the monitor first asks whether
     * the probe itself is online; answer yes without touching the internet.
     */
    onlineCheck: jest
      .spyOn(monitors.OnlineCheck, "canProbeMonitorWebsiteMonitors")
      .mockResolvedValue(true),
  };
}

function blockPrivateAddressesPassedToGuard(
  spies: MonitorSpies,
): Array<unknown> {
  return spies.guard.mock.calls.map((call: Array<unknown>) => {
    return (call[1] as EgressGuardModule.EgressGuardOptions)
      .blockPrivateAddresses;
  });
}

async function pingWebsite(
  monitors: LoadedMonitors,
  url: string,
  options: { allowSelfSignedCertificates?: boolean | undefined } = {},
): Promise<ProbeWebsiteResponse> {
  const response: ProbeWebsiteResponse | null =
    await monitors.WebsiteMonitor.ping(monitors.URL.fromString(url), {
      retry: 3,
      isOnlineCheckRequest: false,
      allowSelfSignedCertificates: options.allowSelfSignedCertificates,
    });

  expect(response).not.toBeNull();
  return response!;
}

async function pingApi(
  monitors: LoadedMonitors,
  url: string,
): Promise<APIResponse> {
  const response: APIResponse | null = await monitors.ApiMonitor.ping(
    monitors.URL.fromString(url),
    {
      requestType: HTTPMethod.POST,
      requestHeaders: { "Content-Type": "application/json" },
      requestBody: { check: "deep" },
      retry: 3,
      isOnlineCheckRequest: false,
    },
  );

  expect(response).not.toBeNull();
  return response!;
}

async function fetchStatusPage(
  monitors: LoadedMonitors,
  statusPageUrl: string,
): Promise<ExternalStatusPageMonitorResponse> {
  const response: ExternalStatusPageMonitorResponse | null =
    await monitors.ExternalStatusPageMonitor.fetch(
      {
        statusPageUrl: statusPageUrl,
        provider: ExternalStatusPageProviderType.AtlassianStatuspage,
        timeout: 5000,
        retries: 3,
      },
      { isOnlineCheckRequest: false },
    );

  expect(response).not.toBeNull();
  return response!;
}

// Refused before any byte left the probe, and not retried.
function expectRefusedBeforeAnyRequest(spies: MonitorSpies): void {
  expect(proxiedRequests).toEqual([]);
  expect(tlsTargetRequests).toEqual([]);
  expect(dialedHosts).toEqual([]);
  expect(spies.prepare).toHaveBeenCalledTimes(1);
  expect(spies.sleep).not.toHaveBeenCalled();
}

beforeAll(async () => {
  tlsTargetServer = https.createServer(
    { key: SelfSignedCertificate.key, cert: SelfSignedCertificate.cert },
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      tlsTargetRequests.push({
        method: request.method,
        url: request.url,
        host: request.headers.host,
      });
      response.writeHead(200, {
        "Content-Type": "text/html",
        Connection: "close",
      });
      response.end(`<html>${TLS_BODY_MARKER}</html>`);
    },
  );
  tlsTargetServer.on("connection", trackSocket);

  proxyServer = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      const chunks: Array<Buffer> = [];
      request.on("data", (chunk: Buffer): void => {
        chunks.push(chunk);
      });
      request.on("end", (): void => {
        const body: string = Buffer.concat(chunks).toString("utf8");
        proxiedRequests.push({
          method: request.method,
          url: request.url,
          host: request.headers.host,
          ...(body ? { body: body } : {}),
        });

        let pathname: string = "";
        try {
          pathname = new globalThis.URL(request.url || "").pathname;
        } catch {
          pathname = "";
        }

        const canned: CannedResponse | undefined =
          PRIVATE_TARGET_RESPONSES[pathname];
        if (!canned) {
          response.writeHead(404, { Connection: "close" });
          response.end("not found");
          return;
        }

        response.writeHead(200, {
          "Content-Type": canned.contentType,
          Connection: "close",
        });
        response.end(canned.body);
      });
    },
  );
  proxyServer.on("connection", trackSocket);

  /*
   * HTTPS goes through CONNECT. The proxy tunnels every CONNECT to the local
   * TLS server, whatever authority it names; the test asserts on the
   * authority it was asked for.
   */
  proxyServer.on(
    "connect",
    (request: http.IncomingMessage, clientSocket: Duplex, head: Buffer) => {
      proxiedRequests.push({
        method: request.method,
        url: request.url,
        host: request.headers.host,
      });
      trackSocket(clientSocket);

      const upstream: net.Socket = net.connect(
        tlsTargetPort,
        "127.0.0.1",
        (): void => {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length > 0) {
            upstream.write(head);
          }
          upstream.pipe(clientSocket);
          clientSocket.pipe(upstream);
        },
      );
      trackSocket(upstream);

      const closeBoth: () => void = (): void => {
        upstream.destroy();
        clientSocket.destroy();
      };
      upstream.on("error", closeBoth);
      clientSocket.on("error", closeBoth);
    },
  );

  tlsTargetPort = await listenOnLoopback(tlsTargetServer);
  proxyPort = await listenOnLoopback(proxyServer);
  proxyUrl = `http://127.0.0.1:${proxyPort}`;
});

beforeEach(() => {
  proxiedRequests.length = 0;
  tlsTargetRequests.length = 0;
  dialedHosts.length = 0;

  jest.spyOn(dns.promises, "lookup").mockImplementation(fakeDnsLookup as never);

  jest.spyOn(net.Socket.prototype, "connect").mockImplementation(function (
    this: net.Socket,
    ...args: Array<unknown>
  ): net.Socket {
    const host: string = dialTarget(args);
    dialedHosts.push(host);
    if (host !== "127.0.0.1") {
      throw new Error(
        `This suite must never dial ${host}; only the loopback test proxy.`,
      );
    }
    return realSocketConnect.apply(this, args);
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  jest.resetModules();
  for (const socket of openSockets) {
    socket.destroy();
  }
  await Promise.all([closeServer(proxyServer), closeServer(tlsTargetServer)]);
});

describe("Website, API and External Status Page monitors on private targets", () => {
  describe("on a self-hosted global probe with PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true (issue #3879)", () => {
    let monitors: LoadedMonitors;
    let spies: MonitorSpies;

    beforeAll(() => {
      monitors = loadMonitors(SELF_HOSTED_GLOBAL_PROBE, "true");
    }, 60_000);

    beforeEach(() => {
      spies = instrument(monitors);
    });

    test("loads a global probe that honors the opt-in", () => {
      expect(monitors.config.HasRegisterProbeKey).toBe(true);
      expect(monitors.config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(true);
      expect(monitors.config.HTTP_PROXY_URL).toBe(proxyUrl);
    });

    test("a Website monitor on a private IP reports the target online with its status code and body", async () => {
      const response: ProbeWebsiteResponse = await pingWebsite(
        monitors,
        WEBSITE_TARGET,
      );

      expect(response.isOnline).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(response.failureCause).toBe("");
      expect(response.responseBody?.toString()).toContain(WEBSITE_BODY_MARKER);
      expect(response.totalAttempts).toBe(1);
      expect(proxiedRequests).toEqual([
        { method: "GET", url: WEBSITE_TARGET, host: PRIVATE_ADDRESS },
      ]);
      expect(blockPrivateAddressesPassedToGuard(spies)).toEqual([false]);
      expect(new Set(dialedHosts)).toEqual(new Set(["127.0.0.1"]));
      expect(spies.sleep).not.toHaveBeenCalled();
    });

    test("an API monitor on a private IP delivers its request and reports the response", async () => {
      const response: APIResponse = await pingApi(monitors, API_TARGET);

      expect(response.isOnline).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(response.failureCause).toBe("");
      expect(JSON.parse(response.responseBody)).toEqual({
        status: "ok",
        service: "internal-api",
      });
      expect(response.totalAttempts).toBe(1);
      expect(proxiedRequests).toEqual([
        {
          method: "POST",
          url: API_TARGET,
          host: PRIVATE_ADDRESS,
          body: JSON.stringify({ check: "deep" }),
        },
      ]);
      expect(blockPrivateAddressesPassedToGuard(spies)).toEqual([false]);
      expect(new Set(dialedHosts)).toEqual(new Set(["127.0.0.1"]));
    });

    test("an External Status Page monitor on a private status page reads its status and components", async () => {
      const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
        monitors,
        STATUS_PAGE_TARGET,
      );

      expect(response.isOnline).toBe(true);
      expect(response.failureCause).toBe("");
      expect(response.overallStatus).toBe("All Systems Operational");
      expect(response.componentStatuses).toEqual([
        {
          name: "Internal API",
          status: "operational",
          description: undefined,
          groupName: undefined,
        },
      ]);
      expect(response.activeIncidentCount).toBe(0);
      expect(response.totalAttempts).toBe(1);
      expect(
        proxiedRequests.map((request: ObservedRequest) => {
          return request.url;
        }),
      ).toEqual([
        `${STATUS_PAGE_TARGET}/api/v2/status.json`,
        `${STATUS_PAGE_TARGET}/api/v2/components.json`,
        `${STATUS_PAGE_TARGET}/api/v2/incidents/unresolved.json`,
      ]);
      // Every provider subrequest went through the guard, each one opened.
      expect(blockPrivateAddressesPassedToGuard(spies)).toEqual([
        false,
        false,
        false,
      ]);
    });

    /*
     * The common real-world shape: an internal name that resolves to a
     * private address. The proxy is sent the address the guard validated
     * (no second DNS lookup to rebind), with the original Host header.
     */
    test("a Website monitor on an internal hostname is pinned to the validated private address", async () => {
      const response: ProbeWebsiteResponse = await pingWebsite(
        monitors,
        `http://${PRIVATE_HOSTNAME}/health`,
      );

      expect(response.isOnline).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(proxiedRequests).toEqual([
        { method: "GET", url: WEBSITE_TARGET, host: PRIVATE_HOSTNAME },
      ]);
    });

    test("an HTTPS Website monitor on a private IP tunnels to the validated address and completes TLS", async () => {
      const response: ProbeWebsiteResponse = await pingWebsite(
        monitors,
        `https://${PRIVATE_ADDRESS}/health`,
        { allowSelfSignedCertificates: true },
      );

      expect(response.isOnline).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(response.responseBody?.toString()).toContain(TLS_BODY_MARKER);
      expect(proxiedRequests).toEqual([
        {
          method: "CONNECT",
          url: `${PRIVATE_ADDRESS}:443`,
          host: `${PRIVATE_ADDRESS}:443`,
        },
      ]);
      expect(tlsTargetRequests).toEqual([
        { method: "GET", url: "/health", host: PRIVATE_ADDRESS },
      ]);
    });

    test("a Website monitor still cannot reach the cloud metadata endpoint through the proxy", async () => {
      const response: ProbeWebsiteResponse = await pingWebsite(
        monitors,
        "http://169.254.169.254/latest/meta-data/",
      );

      expect(response.isOnline).toBe(false);
      expect(response.statusCode).toBeUndefined();
      expect(response.failureCause).toBe(
        "Monitor target host 169.254.169.254 is not allowed: link-local address (cloud metadata range).",
      );
      expect(response.totalAttempts).toBe(1);
      expectRefusedBeforeAnyRequest(spies);
    });

    test("an API monitor still cannot reach loopback, not even the proxy itself", async () => {
      const response: APIResponse = await pingApi(
        monitors,
        `http://127.0.0.1:${proxyPort}/api/v1/status`,
      );

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toBe(
        "Monitor target host 127.0.0.1 is not allowed: loopback address.",
      );
      expect(response.totalAttempts).toBe(1);
      expectRefusedBeforeAnyRequest(spies);
    });

    test("an External Status Page monitor still cannot reach a name that resolves to the metadata endpoint", async () => {
      const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
        monitors,
        "http://metadata.google.internal/status",
      );

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toBe(
        "Monitor target host metadata.google.internal could not be reached.",
      );
      expect(response.totalAttempts).toBe(1);
      expectRefusedBeforeAnyRequest(spies);
    });
  });

  describe("on a self-hosted global probe without the opt-in", () => {
    let monitors: LoadedMonitors;
    let spies: MonitorSpies;

    const expectedRefusal: string = `Monitor target host ${PRIVATE_ADDRESS} is not allowed: private network address.${SELF_HOSTED_GLOBAL_PROBE_HINT}`;

    beforeAll(() => {
      monitors = loadMonitors(SELF_HOSTED_GLOBAL_PROBE, undefined);
    }, 60_000);

    beforeEach(() => {
      spies = instrument(monitors);
    });

    test("a Website monitor reports the refusal, how to lift it, and never reaches the proxy", async () => {
      const response: ProbeWebsiteResponse = await pingWebsite(
        monitors,
        WEBSITE_TARGET,
      );

      expect(response.isOnline).toBe(false);
      expect(response.statusCode).toBeUndefined();
      expect(response.responseBody).toBeUndefined();
      expect(response.failureCause).toBe(expectedRefusal);
      expect(response.failureCause).toContain(`${OPT_IN_ENV_VAR}=true`);
      expect(response.failureCause).toContain(
        "probes.<name>.allowPrivateNetworkMonitors",
      );
      expect(response.totalAttempts).toBe(1);
      expect(blockPrivateAddressesPassedToGuard(spies)).toEqual([true]);
      expectRefusedBeforeAnyRequest(spies);
    });

    test("an API monitor reports the refusal and never reaches the proxy", async () => {
      const response: APIResponse = await pingApi(monitors, API_TARGET);

      expect(response.isOnline).toBe(false);
      expect(response.statusCode).toBeUndefined();
      expect(response.failureCause).toBe(expectedRefusal);
      expect(response.totalAttempts).toBe(1);
      expectRefusedBeforeAnyRequest(spies);
    });

    test("an External Status Page monitor reports the refusal and never reaches the proxy", async () => {
      const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
        monitors,
        STATUS_PAGE_TARGET,
      );

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toBe(expectedRefusal);
      expect(response.totalAttempts).toBe(1);
      expectRefusedBeforeAnyRequest(spies);
    });

    test("a Website monitor on an internal hostname gets the sanitized refusal with no address in it", async () => {
      const response: ProbeWebsiteResponse = await pingWebsite(
        monitors,
        `http://${PRIVATE_HOSTNAME}/health`,
      );

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toBe(
        `Monitor target host ${PRIVATE_HOSTNAME} could not be reached.`,
      );
      expect(JSON.stringify(response)).not.toContain(PRIVATE_ADDRESS);
      expectRefusedBeforeAnyRequest(spies);
    });

    test("an HTTPS Website monitor on a private IP never sends a CONNECT", async () => {
      const response: ProbeWebsiteResponse = await pingWebsite(
        monitors,
        `https://${PRIVATE_ADDRESS}/health`,
        { allowSelfSignedCertificates: true },
      );

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toBe(expectedRefusal);
      expectRefusedBeforeAnyRequest(spies);
    });
  });

  describe("on a global probe of a BILLING_ENABLED instance with PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true", () => {
    let monitors: LoadedMonitors;
    let spies: MonitorSpies;

    const expectedRefusal: string = `Monitor target host ${PRIVATE_ADDRESS} is not allowed: private network address.${HOSTED_GLOBAL_PROBE_HINT}`;

    beforeAll(() => {
      monitors = loadMonitors(HOSTED_GLOBAL_PROBE, "true");
    }, 60_000);

    beforeEach(() => {
      spies = instrument(monitors);
    });

    test("keeps the hosted product's shared probes public-only", () => {
      expect(monitors.config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);
    });

    test("a Website monitor is refused and pointed at a private probe", async () => {
      const response: ProbeWebsiteResponse = await pingWebsite(
        monitors,
        WEBSITE_TARGET,
      );

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toBe(expectedRefusal);
      expect(response.failureCause).not.toContain(OPT_IN_ENV_VAR);
      expect(blockPrivateAddressesPassedToGuard(spies)).toEqual([true]);
      expectRefusedBeforeAnyRequest(spies);
    });

    test("an API monitor is refused and pointed at a private probe", async () => {
      const response: APIResponse = await pingApi(monitors, API_TARGET);

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toBe(expectedRefusal);
      expectRefusedBeforeAnyRequest(spies);
    });

    test("an External Status Page monitor is refused and pointed at a private probe", async () => {
      const response: ExternalStatusPageMonitorResponse = await fetchStatusPage(
        monitors,
        STATUS_PAGE_TARGET,
      );

      expect(response.isOnline).toBe(false);
      expect(response.failureCause).toBe(expectedRefusal);
      expectRefusedBeforeAnyRequest(spies);
    });
  });

  describe("on a private probe with PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true", () => {
    let monitors: LoadedMonitors;
    let spies: MonitorSpies;

    beforeAll(() => {
      monitors = loadMonitors(PRIVATE_PROBE, "true");
    }, 60_000);

    beforeEach(() => {
      spies = instrument(monitors);
    });

    test("a Website monitor on a private IP still succeeds, as before 13.0.0", async () => {
      const response: ProbeWebsiteResponse = await pingWebsite(
        monitors,
        WEBSITE_TARGET,
      );

      expect(response.isOnline).toBe(true);
      expect(response.statusCode).toBe(200);
      expect(proxiedRequests).toEqual([
        { method: "GET", url: WEBSITE_TARGET, host: PRIVATE_ADDRESS },
      ]);
      expect(blockPrivateAddressesPassedToGuard(spies)).toEqual([false]);
    });

    test("an API monitor on a private IP still succeeds", async () => {
      const response: APIResponse = await pingApi(monitors, API_TARGET);

      expect(response.isOnline).toBe(true);
      expect(response.statusCode).toBe(200);
    });
  });
});

async function listenOnLoopback(server: net.Server): Promise<number> {
  return await new Promise<number>(
    (resolve: (port: number) => void, reject: (error: Error) => void) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", (): void => {
        server.removeListener("error", reject);
        const address: net.AddressInfo | string | null = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Expected a TCP test server address."));
          return;
        }
        resolve(address.port);
      });
    },
  );
}

async function closeServer(server: http.Server | https.Server): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve: () => void) => {
    server.close((): void => {
      resolve();
    });
  });
}
