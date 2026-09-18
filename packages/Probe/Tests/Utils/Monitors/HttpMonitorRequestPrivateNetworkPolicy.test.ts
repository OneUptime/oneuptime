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
import type * as ConfigModule from "../../../Config";
import type * as HttpMonitorRequestModule from "../../../Utils/Monitors/HttpMonitorRequest";
import type * as HttpTimingAgentsModule from "../../../Utils/HttpTimingAgents";
import PrivateNetworkMonitorPolicy, {
  PrivateNetworkMonitorPolicyReason,
} from "../../../Utils/PrivateNetworkMonitorPolicy";
import type * as EgressGuardModule from "Common/Server/Utils/DataSource/EgressGuard";
import type * as EgressGuardExceptionModule from "Common/Types/Exception/EgressGuardException";
import dns from "dns";
import http from "http";
import https from "https";
import net from "net";

/*
 * Regression suite for OneUptime issue #3879, run against the REAL egress
 * guard rather than a mock of it.
 *
 * From 13.0.0 until the fix, Probe/Config.ts computed
 *
 *   PROBE_ALLOW_PRIVATE_NETWORK_MONITORS = !HasRegisterProbeKey && env === "true"
 *
 * so every probe bundled with the Helm chart or Docker Compose - which
 * registers itself with REGISTER_PROBE_KEY and so becomes a GLOBAL probe -
 * silently dropped probes.<name>.allowPrivateNetworkMonitors: true. API and
 * Website monitors on RFC-1918 targets, which had no address check at all
 * before 13.0.0, started failing on upgrade with no way to opt back in.
 *
 * The unit tests for PrivateNetworkMonitorPolicy pin the decision table. What
 * they cannot show is that the decision actually REACHES the socket boundary:
 * Config.ts evaluates the environment once, at import, and
 * HttpMonitorRequest.prepare has to hand the result to
 * DataSourceEgressGuard.assertUrlAllowed for every hop. So each case here
 * builds a fresh module graph under a specific probe environment - the same
 * way a probe process boots - and drives a target through prepare() and the
 * real guard.
 *
 * Three properties are pinned:
 *
 *  - a self-hosted global probe with the opt-in now reaches private targets
 *    (the regression), while the hosted product's global probes
 *    (BILLING_ENABLED=true, open sign-up) still refuse them;
 *  - every refusal names the setting that would change it, for the kind of
 *    probe that produced it - or, on the hosted product, names none;
 *  - the opt-in never opens the forbidden tier: loopback, link-local, cloud
 *    metadata and their encodings stay refused on every probe, including the
 *    metadata addresses that sit INSIDE a range the opt-in does open.
 *
 * Nothing here touches the network. DNS answers are injected at
 * dns.promises.lookup (the resolver the guard itself calls) and
 * net.Socket#connect is replaced with a tripwire: prepare() validates and
 * builds agents, it must never dial.
 */

type LoadedConfig = typeof ConfigModule;
type HttpMonitorRequestClass = typeof HttpMonitorRequestModule.default;
type PreparedRequest = HttpMonitorRequestModule.PreparedHttpMonitorRequest;
type HttpTimingCollectorClass =
  typeof HttpTimingAgentsModule.HttpTimingCollector;
type EgressGuardClass = typeof EgressGuardModule.default;
type ResolvedAddress = EgressGuardModule.ResolvedAddress;
type EgressLookupFunction = EgressGuardModule.EgressLookupFunction;
type EgressGuardExceptionClass = typeof EgressGuardExceptionModule.default;
type EgressGuardError = InstanceType<EgressGuardExceptionClass>;
type EgressFailureReasonEnum =
  typeof EgressGuardExceptionModule.EgressFailureReason;

interface LoadedProbe {
  config: LoadedConfig;
  HttpMonitorRequest: HttpMonitorRequestClass;
  monitorDnsResolveBudgetInMs: number;
  HttpTimingCollector: HttpTimingCollectorClass;
  EgressGuard: EgressGuardClass;
  EgressGuardException: EgressGuardExceptionClass;
  EgressFailureReason: EgressFailureReasonEnum;
}

interface ProbeDeployment {
  label: string;
  registerProbeKey: string | undefined;
  billingEnabled: string | undefined;
}

interface LookupResult {
  error: NodeJS.ErrnoException | null;
  address: string | Array<{ address: string; family: number }>;
  family?: number | undefined;
}

// [url, host the guard reports, reason the guard gives]
type TargetRow = [string, string, string];

const OPT_IN_ENV_VAR: string = "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS";

/*
 * Every variable that decides what this suite loads. Each one is cleared
 * before a module graph is built, so a developer's shell (an exported
 * REGISTER_PROBE_KEY, BILLING_ENABLED or http_proxy) cannot change a result.
 */
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
  label: "a private probe",
  registerProbeKey: undefined,
  billingEnabled: undefined,
};

// What the Helm chart and Docker Compose deploy: global, billing off.
const SELF_HOSTED_GLOBAL_PROBE: ProbeDeployment = {
  label: "a self-hosted global probe",
  registerProbeKey: "register-probe-key-from-the-helm-chart",
  billingEnabled: undefined,
};

// The hosted product: global probes shared by every sign-up.
const HOSTED_GLOBAL_PROBE: ProbeDeployment = {
  label: "a global probe on a BILLING_ENABLED instance",
  registerProbeKey: "register-probe-key-on-the-hosted-product",
  billingEnabled: "true",
};

/*
 * BILLING_ENABLED only restricts GLOBAL probes. A customer's own probe that
 * happens to carry it (a copied .env) is still the customer's to open.
 */
const PRIVATE_PROBE_WITH_BILLING_ENV: ProbeDeployment = {
  label: "a private probe whose environment also sets BILLING_ENABLED=true",
  registerProbeKey: undefined,
  billingEnabled: "true",
};

// An explicit "false" must read exactly like unset.
const SELF_HOSTED_GLOBAL_PROBE_WITH_BILLING_FALSE: ProbeDeployment = {
  label: "a self-hosted global probe with BILLING_ENABLED=false",
  registerProbeKey: "register-probe-key-from-docker-compose",
  billingEnabled: "false",
};

const PRIVATE_PROBE_HINT: string =
  " Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it.";

const HOSTED_GLOBAL_PROBE_HINT: string =
  " Global probes cannot monitor private network addresses. Deploy and select a private probe for this target.";

const SELF_HOSTED_GLOBAL_PROBE_HINT: string =
  PrivateNetworkMonitorPolicy.getRefusalHint({
    isAutoRegisteredGlobalProbe: true,
    isBillingEnabled: false,
  });

const PUBLIC_ADDRESS: string = "93.184.216.34";
const PRIVATE_ADDRESS: string = "10.23.45.67";

/*
 * Literal targets in the PRIVATE tier: the ranges the opt-in exists to open.
 * The guard reports literals as WHATWG normalizes them, which is why the
 * IPv4-mapped form comes back in hex.
 */
const PRIVATE_LITERAL_TARGETS: Array<TargetRow> = [
  ["http://10.23.45.67/health", "10.23.45.67", "private network address"],
  ["http://192.168.1.10/", "192.168.1.10", "private network address"],
  ["http://172.16.0.5/", "172.16.0.5", "private network address"],
  [
    "http://172.31.255.254:8443/status",
    "172.31.255.254",
    "private network address",
  ],
  ["http://100.64.0.1/", "100.64.0.1", "carrier-grade NAT address"],
  ["http://[fd00::1]/", "fd00::1", "private network address"],
  ["http://[fec0::1]/", "fec0::1", "private network address"],
  ["http://[::ffff:10.0.0.5]/", "::ffff:a00:5", "private network address"],
];

/*
 * Literal targets in the FORBIDDEN tier. No probe setting opens these. The
 * last few are the interesting ones: the Alibaba metadata address sits inside
 * CGNAT and the AWS IPv6 metadata address inside unique-local - both ranges
 * the opt-in DOES open - and the decimal / mapped spellings are what an
 * attacker tries once the plain literal is refused.
 */
const FORBIDDEN_LITERAL_TARGETS: Array<TargetRow> = [
  ["http://127.0.0.1/", "127.0.0.1", "loopback address"],
  ["http://127.10.20.30:8080/admin", "127.10.20.30", "loopback address"],
  ["http://[::1]/", "::1", "loopback address"],
  ["http://[::ffff:127.0.0.1]/", "::ffff:7f00:1", "loopback address"],
  ["http://2130706433/", "127.0.0.1", "loopback address"],
  ["http://0.0.0.0/", "0.0.0.0", "unspecified address"],
  ["http://[::]/", "::", "unspecified address"],
  [
    "http://169.254.169.254/latest/meta-data/",
    "169.254.169.254",
    "link-local address (cloud metadata range)",
  ],
  [
    "http://[::ffff:169.254.169.254]/latest/meta-data/",
    "::ffff:a9fe:a9fe",
    "link-local address (cloud metadata range)",
  ],
  ["http://[fe80::1]/", "fe80::1", "link-local address"],
  ["http://100.100.100.200/", "100.100.100.200", "cloud metadata address"],
  ["http://[fd00:ec2::254]/", "fd00:ec2::254", "cloud metadata address"],
  ["http://168.63.129.16/", "168.63.129.16", "cloud platform metadata address"],
  ["http://224.0.0.1/", "224.0.0.1", "multicast address"],
  ["http://255.255.255.255/", "255.255.255.255", "broadcast address"],
];

/*
 * Hostnames whose DNS answer includes a forbidden address. The last one mixes
 * an allowed private address with loopback: one forbidden answer sinks the
 * whole set, or a rebinding name could smuggle loopback past the opt-in.
 */
const FORBIDDEN_HOSTNAME_TARGETS: Array<string> = [
  "http://localhost/",
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://rebinds-to-loopback.corp.example/",
];

const DNS_ANSWERS: Record<string, Array<ResolvedAddress>> = {
  "internal-api.corp.example": [{ address: PRIVATE_ADDRESS, family: 4 }],
  "dual-stack.corp.example": [
    { address: PRIVATE_ADDRESS, family: 4 },
    { address: "fd00::1", family: 6 },
  ],
  "split-horizon.corp.example": [
    { address: PUBLIC_ADDRESS, family: 4 },
    { address: PRIVATE_ADDRESS, family: 4 },
  ],
  "public-site.example": [{ address: PUBLIC_ADDRESS, family: 4 }],
  localhost: [
    { address: "127.0.0.1", family: 4 },
    { address: "::1", family: 6 },
  ],
  "metadata.google.internal": [{ address: "169.254.169.254", family: 4 }],
  "rebinds-to-loopback.corp.example": [
    { address: PRIVATE_ADDRESS, family: 4 },
    { address: "127.0.0.1", family: 4 },
  ],
};

let dnsLookupSpy: ReturnType<typeof jest.spyOn>;
let socketConnectSpy: ReturnType<typeof jest.spyOn>;

function setEnvironmentValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function snapshotEnvironment(): Map<string, string | undefined> {
  const snapshot: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();
  for (const key of PROBE_ENVIRONMENT_KEYS) {
    snapshot.set(key, process.env[key]);
  }
  return snapshot;
}

function restoreEnvironment(snapshot: Map<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    setEnvironmentValue(key, value);
  }
}

/*
 * Boot the probe's module graph the way a probe process does: environment
 * first, then Config.ts, which reads it exactly once. The environment is
 * put back straight afterwards - everything this suite exercises was decided
 * at import, which is also what makes a later env change irrelevant in
 * production.
 *
 * Each call returns its OWN copies of Common's modules too, so spies and
 * instanceof checks must use the copies returned here, not this file's
 * top-level imports.
 */
function loadProbe(
  deployment: ProbeDeployment,
  optInValue: string | undefined,
): LoadedProbe {
  const saved: Map<string, string | undefined> = snapshotEnvironment();

  try {
    for (const key of PROBE_ENVIRONMENT_KEYS) {
      delete process.env[key];
    }
    process.env["ONEUPTIME_URL"] = "https://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
    setEnvironmentValue("REGISTER_PROBE_KEY", deployment.registerProbeKey);
    setEnvironmentValue("BILLING_ENABLED", deployment.billingEnabled);
    setEnvironmentValue(OPT_IN_ENV_VAR, optInValue);

    jest.resetModules();

    const httpMonitorRequestModule: typeof HttpMonitorRequestModule =
      jest.requireActual(
        "../../../Utils/Monitors/HttpMonitorRequest",
      ) as typeof HttpMonitorRequestModule;
    const config: LoadedConfig = jest.requireActual(
      "../../../Config",
    ) as LoadedConfig;
    const timingAgentsModule: typeof HttpTimingAgentsModule =
      jest.requireActual(
        "../../../Utils/HttpTimingAgents",
      ) as typeof HttpTimingAgentsModule;
    const egressGuardModule: typeof EgressGuardModule = jest.requireActual(
      "Common/Server/Utils/DataSource/EgressGuard",
    ) as typeof EgressGuardModule;
    const exceptionModule: typeof EgressGuardExceptionModule =
      jest.requireActual(
        "Common/Types/Exception/EgressGuardException",
      ) as typeof EgressGuardExceptionModule;

    return {
      config: config,
      HttpMonitorRequest: httpMonitorRequestModule.default,
      monitorDnsResolveBudgetInMs:
        httpMonitorRequestModule.MONITOR_DNS_RESOLVE_BUDGET_IN_MS,
      HttpTimingCollector: timingAgentsModule.HttpTimingCollector,
      EgressGuard: egressGuardModule.default,
      EgressGuardException: exceptionModule.default,
      EgressFailureReason: exceptionModule.EgressFailureReason,
    };
  } finally {
    restoreEnvironment(saved);
  }
}

async function fakeDnsLookup(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  const answer: Array<ResolvedAddress> | undefined = DNS_ANSWERS[hostname];

  if (!answer) {
    const error: NodeJS.ErrnoException = new Error(
      `getaddrinfo ENOTFOUND ${hostname}`,
    );
    error.code = "ENOTFOUND";
    throw error;
  }

  return answer.map((entry: ResolvedAddress) => {
    return { address: entry.address, family: entry.family };
  });
}

function releaseAgents(prepared: PreparedRequest): void {
  prepared.httpAgent?.destroy();
  prepared.httpsAgent?.destroy();
}

function lookupFromAgent(
  agent: http.Agent | https.Agent | undefined,
): EgressLookupFunction {
  expect(agent).toBeDefined();
  return (
    agent as unknown as {
      options: { lookup: EgressLookupFunction };
    }
  ).options.lookup;
}

async function callLookup(
  lookup: EgressLookupFunction,
  options: { all?: boolean | undefined; family?: number | undefined },
): Promise<LookupResult> {
  return await new Promise<LookupResult>(
    (resolve: (value: LookupResult) => void) => {
      /*
       * The hostname is deliberately a name that would resolve somewhere
       * else: a pinned lookup must ignore it and answer with what the guard
       * validated.
       */
      lookup(
        "rebound.attacker.example",
        options,
        (
          error: NodeJS.ErrnoException | null,
          address: string | Array<{ address: string; family: number }>,
          family?: number,
        ): void => {
          resolve({ error, address, family });
        },
      );
    },
  );
}

async function expectPrepared(
  probe: LoadedProbe,
  url: string,
): Promise<PreparedRequest> {
  const prepared: PreparedRequest = await probe.HttpMonitorRequest.prepare(url);
  releaseAgents(prepared);
  return prepared;
}

async function expectRefused(
  probe: LoadedProbe,
  url: string,
): Promise<EgressGuardError> {
  let prepared: PreparedRequest | undefined = undefined;

  try {
    prepared = await probe.HttpMonitorRequest.prepare(url);
  } catch (error) {
    expect(error).toBeInstanceOf(probe.EgressGuardException);
    return error as EgressGuardError;
  }

  releaseAgents(prepared);
  throw new Error(`Expected ${url} to be refused, but it was prepared.`);
}

function guardOptionsFromSpy(
  spy: ReturnType<typeof jest.spyOn>,
): EgressGuardModule.EgressGuardOptions {
  expect(spy).toHaveBeenCalledTimes(1);
  return spy.mock.calls[0]![1] as EgressGuardModule.EgressGuardOptions;
}

function expectSelfHostedGlobalProbeHint(hint: string): void {
  // Names the variable, and the probe it has to be set on.
  expect(hint).toContain(`${OPT_IN_ENV_VAR}=true`);
  expect(hint).toContain("on the probe running this monitor");
  // Names the Helm value the reporter set and saw dropped.
  expect(hint).toContain("probes.<name>.allowPrivateNetworkMonitors");
  // Says what opening a global probe means, and the alternative.
  expect(hint).toContain("every project on this instance");
  expect(hint).toContain("private probe");
  // Never the API server's webhook settings, which this process cannot read.
  expect(hint).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
  expect(hint).not.toContain("Global probes cannot monitor");
}

beforeEach(() => {
  dnsLookupSpy = jest
    .spyOn(dns.promises, "lookup")
    .mockImplementation(fakeDnsLookup as never);
  socketConnectSpy = jest
    .spyOn(net.Socket.prototype, "connect")
    .mockImplementation(((): never => {
      throw new Error("HttpMonitorRequest.prepare must never open a socket.");
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  jest.resetModules();
});

describe("HttpMonitorRequest private network policy (issue #3879)", () => {
  describe("on a self-hosted global probe with PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true", () => {
    let probe: LoadedProbe;

    beforeAll(() => {
      probe = loadProbe(SELF_HOSTED_GLOBAL_PROBE, "true");
    }, 60_000);

    test("honors the opt-in instead of silently dropping it", () => {
      expect(probe.config.HasRegisterProbeKey).toBe(true);
      expect(probe.config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(true);
      expect(probe.config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY).toMatchObject({
        allowed: true,
        reason: PrivateNetworkMonitorPolicyReason.Allowed,
        configuredValue: "true",
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: false,
      });
    });

    test.each(PRIVATE_LITERAL_TARGETS)(
      "prepares %s through the real guard without resolving DNS or opening a socket",
      async (url: string, host: string) => {
        const guardSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
          probe.EgressGuard,
          "assertUrlAllowed",
        );

        const prepared: PreparedRequest = await expectPrepared(probe, url);

        expect(prepared.dispatchUrl).toBe(new globalThis.URL(url).href);
        expect(prepared.doNotFollowRedirects).toBe(true);
        expect(prepared.disableProxy).toBe(true);
        await expect(
          callLookup(lookupFromAgent(prepared.httpAgent), { all: true }),
        ).resolves.toMatchObject({
          error: null,
          address: [{ address: host, family: net.isIP(host) }],
        });
        expect(guardOptionsFromSpy(guardSpy).blockPrivateAddresses).toBe(false);
        expect(dnsLookupSpy).not.toHaveBeenCalled();
        expect(socketConnectSpy).not.toHaveBeenCalled();
      },
    );

    test("pins an HTTPS private target's TLS agent to the literal it validated", async () => {
      const prepared: PreparedRequest = await expectPrepared(
        probe,
        "https://10.23.45.67:8443/health",
      );

      expect(prepared.dispatchUrl).toBe("https://10.23.45.67:8443/health");
      await expect(
        callLookup(lookupFromAgent(prepared.httpsAgent), { all: false }),
      ).resolves.toMatchObject({
        error: null,
        address: PRIVATE_ADDRESS,
        family: 4,
      });
      expect(socketConnectSpy).not.toHaveBeenCalled();
    });

    /*
     * Website and API monitors always prepare with a timing collector, which
     * takes a different branch that builds instrumented agents.
     */
    test("prepares a private target on the timing-agent branch the Website and API monitors use", async () => {
      const collector: InstanceType<HttpTimingCollectorClass> =
        new probe.HttpTimingCollector();

      const prepared: PreparedRequest = await probe.HttpMonitorRequest.prepare(
        "http://192.168.1.10/metrics",
        { timingCollector: collector },
      );
      releaseAgents(prepared);

      await expect(
        callLookup(lookupFromAgent(prepared.httpAgent), { all: false }),
      ).resolves.toMatchObject({
        error: null,
        address: "192.168.1.10",
        family: 4,
      });
      await expect(
        callLookup(lookupFromAgent(prepared.httpsAgent), { all: false }),
      ).resolves.toMatchObject({
        error: null,
        address: "192.168.1.10",
        family: 4,
      });
      expect(socketConnectSpy).not.toHaveBeenCalled();
    });

    test("accepts a hostname whose DNS answer is private and pins the socket to that exact answer", async () => {
      const prepared: PreparedRequest = await expectPrepared(
        probe,
        "http://internal-api.corp.example/health",
      );

      expect(dnsLookupSpy).toHaveBeenCalledTimes(1);
      expect(dnsLookupSpy.mock.calls[0]![0]).toBe("internal-api.corp.example");
      // The hostname stays in the URL, so Host and TLS identity are intact.
      expect(prepared.dispatchUrl).toBe(
        "http://internal-api.corp.example/health",
      );
      await expect(
        callLookup(lookupFromAgent(prepared.httpAgent), { all: false }),
      ).resolves.toMatchObject({
        error: null,
        address: PRIVATE_ADDRESS,
        family: 4,
      });
      expect(socketConnectSpy).not.toHaveBeenCalled();
    });

    test("accepts a dual-stack private hostname and pins both families", async () => {
      const prepared: PreparedRequest = await expectPrepared(
        probe,
        "http://dual-stack.corp.example/",
      );

      await expect(
        callLookup(lookupFromAgent(prepared.httpAgent), { all: true }),
      ).resolves.toMatchObject({
        error: null,
        address: [
          { address: PRIVATE_ADDRESS, family: 4 },
          { address: "fd00::1", family: 6 },
        ],
      });
    });

    test("accepts a split-horizon hostname whose answer mixes public and private addresses", async () => {
      const prepared: PreparedRequest = await expectPrepared(
        probe,
        "http://split-horizon.corp.example/",
      );

      await expect(
        callLookup(lookupFromAgent(prepared.httpAgent), { all: true }),
      ).resolves.toMatchObject({
        error: null,
        address: [
          { address: PUBLIC_ADDRESS, family: 4 },
          { address: PRIVATE_ADDRESS, family: 4 },
        ],
      });
    });

    test("hands the real guard exactly the policy Config resolved", async () => {
      const guardSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        probe.EgressGuard,
        "assertUrlAllowed",
      );

      await expectPrepared(probe, "http://10.23.45.67/health");

      expect(guardSpy).toHaveBeenCalledWith("http://10.23.45.67/health", {
        blockPrivateAddresses: false,
        targetLabel: "Monitor target",
        privateNetworkHint: SELF_HOSTED_GLOBAL_PROBE_HINT,
        includeResolvedAddressInError: false,
        resolveTimeoutInMs: probe.monitorDnsResolveBudgetInMs,
      });
    });
  });

  describe("on a self-hosted global probe without the opt-in", () => {
    let probe: LoadedProbe;

    beforeAll(() => {
      probe = loadProbe(SELF_HOSTED_GLOBAL_PROBE, undefined);
    }, 60_000);

    test("keeps private targets off by default", () => {
      expect(probe.config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);
      expect(probe.config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY).toMatchObject({
        allowed: false,
        reason: PrivateNetworkMonitorPolicyReason.NotRequested,
        configuredValue: null,
        isAutoRegisteredGlobalProbe: true,
      });
      expect(probe.config.PROBE_PRIVATE_NETWORK_HINT).toBe(
        SELF_HOSTED_GLOBAL_PROBE_HINT,
      );
      expectSelfHostedGlobalProbeHint(probe.config.PROBE_PRIVATE_NETWORK_HINT);
    });

    test.each(PRIVATE_LITERAL_TARGETS)(
      "refuses %s and tells the operator how to allow it on this global probe",
      async (url: string, host: string, reason: string) => {
        const error: EgressGuardError = await expectRefused(probe, url);

        expect(error.reason).toBe(probe.EgressFailureReason.AddressBlocked);
        expect(error.message).toBe(
          `Monitor target host ${host} is not allowed: ${reason}.${SELF_HOSTED_GLOBAL_PROBE_HINT}`,
        );
        expect(error.message.endsWith(SELF_HOSTED_GLOBAL_PROBE_HINT)).toBe(
          true,
        );
        expectSelfHostedGlobalProbeHint(error.message);
        expect(socketConnectSpy).not.toHaveBeenCalled();
      },
    );

    /*
     * A hostname refusal must not become a probe for the tenant: the DNS
     * branch and the address-policy branch return one identical sentence, and
     * neither the private address nor the operator hint rides along.
     */
    test("refuses a hostname resolving to a private address with the sanitized message", async () => {
      const error: EgressGuardError = await expectRefused(
        probe,
        "http://internal-api.corp.example/health",
      );

      expect(error.reason).toBe(probe.EgressFailureReason.Unreachable);
      expect(error.message).toBe(
        "Monitor target host internal-api.corp.example could not be reached.",
      );
      expect(error.message).not.toContain(PRIVATE_ADDRESS);
      expect(error.message).not.toContain(OPT_IN_ENV_VAR);
    });

    test("refuses a split-horizon hostname because one private answer is enough", async () => {
      const error: EgressGuardError = await expectRefused(
        probe,
        "http://split-horizon.corp.example/",
      );

      expect(error.reason).toBe(probe.EgressFailureReason.Unreachable);
      expect(error.message).not.toContain(PRIVATE_ADDRESS);
      expect(error.message).not.toContain(PUBLIC_ADDRESS);
    });

    test.each([
      [`http://${PUBLIC_ADDRESS}/`],
      ["https://public-site.example/status"],
    ])("still prepares the public target %s", async (url: string) => {
      const prepared: PreparedRequest = await expectPrepared(probe, url);

      expect(prepared.dispatchUrl).toBe(url);
      expect(socketConnectSpy).not.toHaveBeenCalled();
    });

    test("hands the real guard blockPrivateAddresses true with the self-hosted global hint", async () => {
      const guardSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
        probe.EgressGuard,
        "assertUrlAllowed",
      );

      await expectRefused(probe, "http://10.23.45.67/health");

      expect(guardOptionsFromSpy(guardSpy)).toMatchObject({
        blockPrivateAddresses: true,
        privateNetworkHint: SELF_HOSTED_GLOBAL_PROBE_HINT,
        includeResolvedAddressInError: false,
      });
    });
  });

  describe("on a self-hosted global probe with BILLING_ENABLED=false spelled out", () => {
    test("reads billing off exactly like unset and honors the opt-in", async () => {
      const probe: LoadedProbe = loadProbe(
        SELF_HOSTED_GLOBAL_PROBE_WITH_BILLING_FALSE,
        "true",
      );

      expect(probe.config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(true);
      await expectPrepared(probe, "http://10.23.45.67/health");
    });
  });

  /*
   * A typo in a security switch fails closed on a global probe exactly as it
   * does on a private one, and the refusal still carries the global hint so
   * the operator can see what the value should have been.
   */
  describe('with a value other than exactly "true" on a self-hosted global probe', () => {
    test.each([
      "TRUE",
      "True",
      "1",
      "yes",
      "on",
      " true",
      "true ",
      "false",
      "",
    ])("keeps %p fail-closed at the guard", async (value: string) => {
      const probe: LoadedProbe = loadProbe(SELF_HOSTED_GLOBAL_PROBE, value);

      expect(probe.config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);

      const error: EgressGuardError = await expectRefused(
        probe,
        "http://10.23.45.67/health",
      );

      expect(error.reason).toBe(probe.EgressFailureReason.AddressBlocked);
      expect(error.message).toBe(
        `Monitor target host 10.23.45.67 is not allowed: private network address.${SELF_HOSTED_GLOBAL_PROBE_HINT}`,
      );
    });
  });

  describe.each([
    ["with PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true", "true"],
    ["without the opt-in", undefined],
  ])(
    "on a global probe of a BILLING_ENABLED instance %s",
    (_label: string, optInValue: string | undefined) => {
      let probe: LoadedProbe;

      beforeAll(() => {
        probe = loadProbe(HOSTED_GLOBAL_PROBE, optInValue);
      }, 60_000);

      test("does not let the probe's environment open private targets on the hosted product", () => {
        expect(probe.config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);
        expect(probe.config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.reason).toBe(
          optInValue === "true"
            ? PrivateNetworkMonitorPolicyReason.RefusedOnHostedGlobalProbe
            : PrivateNetworkMonitorPolicyReason.NotRequested,
        );
        expect(probe.config.PROBE_PRIVATE_NETWORK_HINT).toBe(
          HOSTED_GLOBAL_PROBE_HINT,
        );
      });

      /*
       * A tenant on the hosted product cannot set a probe variable, so the
       * refusal points at the one thing they can do: a private probe.
       */
      test.each(PRIVATE_LITERAL_TARGETS)(
        "refuses %s and points the tenant at a private probe",
        async (url: string, host: string, reason: string) => {
          const error: EgressGuardError = await expectRefused(probe, url);

          expect(error.reason).toBe(probe.EgressFailureReason.AddressBlocked);
          expect(error.message).toBe(
            `Monitor target host ${host} is not allowed: ${reason}.${HOSTED_GLOBAL_PROBE_HINT}`,
          );
          expect(error.message).toContain(
            "Global probes cannot monitor private network addresses",
          );
          expect(error.message).not.toContain(OPT_IN_ENV_VAR);
          expect(error.message).not.toContain("Helm");
        },
      );

      test("refuses a hostname resolving to a private address with the sanitized message", async () => {
        const error: EgressGuardError = await expectRefused(
          probe,
          "http://internal-api.corp.example/health",
        );

        expect(error.reason).toBe(probe.EgressFailureReason.Unreachable);
        expect(error.message).toBe(
          "Monitor target host internal-api.corp.example could not be reached.",
        );
      });

      test("hands the real guard blockPrivateAddresses true", async () => {
        const guardSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
          probe.EgressGuard,
          "assertUrlAllowed",
        );

        await expectPrepared(probe, `http://${PUBLIC_ADDRESS}/`);

        expect(guardOptionsFromSpy(guardSpy)).toMatchObject({
          blockPrivateAddresses: true,
          privateNetworkHint: HOSTED_GLOBAL_PROBE_HINT,
        });
      });
    },
  );

  describe.each([
    [PRIVATE_PROBE.label, PRIVATE_PROBE],
    [PRIVATE_PROBE_WITH_BILLING_ENV.label, PRIVATE_PROBE_WITH_BILLING_ENV],
  ])(
    "on %s with PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true",
    (_label: string, deployment: ProbeDeployment) => {
      let probe: LoadedProbe;

      beforeAll(() => {
        probe = loadProbe(deployment, "true");
      }, 60_000);

      test("keeps honoring the opt-in as it did before 13.0.0", () => {
        expect(probe.config.HasRegisterProbeKey).toBe(false);
        expect(probe.config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(true);
        expect(probe.config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.reason).toBe(
          PrivateNetworkMonitorPolicyReason.Allowed,
        );
      });

      test.each(PRIVATE_LITERAL_TARGETS)(
        "prepares %s through the real guard",
        async (url: string, host: string) => {
          const prepared: PreparedRequest = await expectPrepared(probe, url);

          await expect(
            callLookup(lookupFromAgent(prepared.httpAgent), { all: false }),
          ).resolves.toMatchObject({ error: null, address: host });
          expect(socketConnectSpy).not.toHaveBeenCalled();
        },
      );

      test("accepts a hostname whose DNS answer is private", async () => {
        await expectPrepared(probe, "http://internal-api.corp.example/health");
      });
    },
  );

  describe("on a private probe without the opt-in", () => {
    let probe: LoadedProbe;

    beforeAll(() => {
      probe = loadProbe(PRIVATE_PROBE, undefined);
    }, 60_000);

    test.each(PRIVATE_LITERAL_TARGETS)(
      "refuses %s with the unchanged private-probe hint",
      async (url: string, host: string, reason: string) => {
        const error: EgressGuardError = await expectRefused(probe, url);

        expect(error.reason).toBe(probe.EgressFailureReason.AddressBlocked);
        expect(error.message).toBe(
          `Monitor target host ${host} is not allowed: ${reason}.${PRIVATE_PROBE_HINT}`,
        );
        // Nothing about global probes or Helm on a probe that is neither.
        expect(error.message).not.toContain("global probe");
        expect(error.message).not.toContain("Helm");
      },
    );

    test("refuses a hostname resolving to a private address with the sanitized message", async () => {
      const error: EgressGuardError = await expectRefused(
        probe,
        "http://internal-api.corp.example/health",
      );

      expect(error.message).toBe(
        "Monitor target host internal-api.corp.example could not be reached.",
      );
    });
  });

  /*
   * The opt-in widens the PRIVATE tier and nothing else. Every deployment
   * that can hold it is checked, because the fix changed which deployments
   * honor it.
   */
  describe.each([
    [PRIVATE_PROBE.label, PRIVATE_PROBE],
    [SELF_HOSTED_GLOBAL_PROBE.label, SELF_HOSTED_GLOBAL_PROBE],
    [HOSTED_GLOBAL_PROBE.label, HOSTED_GLOBAL_PROBE],
  ])(
    "forbidden targets on %s with PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true",
    (_label: string, deployment: ProbeDeployment) => {
      let probe: LoadedProbe;

      beforeAll(() => {
        probe = loadProbe(deployment, "true");
      }, 60_000);

      test.each(FORBIDDEN_LITERAL_TARGETS)(
        "refuses %s without suggesting the opt-in would help",
        async (url: string, host: string, reason: string) => {
          const error: EgressGuardError = await expectRefused(probe, url);

          expect(error.reason).toBe(probe.EgressFailureReason.AddressBlocked);
          // No hint: no probe setting opens this tier.
          expect(error.message).toBe(
            `Monitor target host ${host} is not allowed: ${reason}.`,
          );
          expect(dnsLookupSpy).not.toHaveBeenCalled();
          expect(socketConnectSpy).not.toHaveBeenCalled();
        },
      );

      test.each(FORBIDDEN_HOSTNAME_TARGETS)(
        "refuses %s, whose DNS answer includes a forbidden address",
        async (url: string) => {
          const hostname: string = new globalThis.URL(url).hostname;
          const error: EgressGuardError = await expectRefused(probe, url);

          expect(error.reason).toBe(probe.EgressFailureReason.Unreachable);
          expect(error.message).toBe(
            `Monitor target host ${hostname} could not be reached.`,
          );
          expect(error.message).not.toContain("127.0.0.1");
          expect(error.message).not.toContain("169.254.169.254");
          expect(socketConnectSpy).not.toHaveBeenCalled();
        },
      );
    },
  );

  /*
   * The whole decision table, observed at the one place it matters: the
   * options HttpMonitorRequest hands the real guard, and what the guard then
   * does with a private target. blockPrivateAddresses must be false exactly
   * when the policy allowed private targets, and the hint must be the one
   * for this kind of probe.
   */
  describe("the policy each probe environment hands the real guard", () => {
    const deployments: Array<[ProbeDeployment, string]> = [
      [PRIVATE_PROBE, PRIVATE_PROBE_HINT],
      [PRIVATE_PROBE_WITH_BILLING_ENV, PRIVATE_PROBE_HINT],
      [SELF_HOSTED_GLOBAL_PROBE, SELF_HOSTED_GLOBAL_PROBE_HINT],
      [HOSTED_GLOBAL_PROBE, HOSTED_GLOBAL_PROBE_HINT],
    ];
    const optInValues: Array<string | undefined> = [
      undefined,
      "",
      "false",
      "true",
      "TRUE",
      "1",
    ];

    const rows: Array<[string, string, ProbeDeployment, string | undefined]> =
      [];
    for (const [deployment] of deployments) {
      for (const optInValue of optInValues) {
        rows.push([
          deployment.label,
          optInValue === undefined ? "unset" : JSON.stringify(optInValue),
          deployment,
          optInValue,
        ]);
      }
    }

    test.each(rows)(
      "%s with PROBE_ALLOW_PRIVATE_NETWORK_MONITORS %s",
      async (
        _label: string,
        _valueLabel: string,
        deployment: ProbeDeployment,
        optInValue: string | undefined,
      ) => {
        const isHostedGlobalProbe: boolean =
          deployment.registerProbeKey !== undefined &&
          deployment.billingEnabled === "true";
        const expectedAllowed: boolean =
          optInValue === "true" && !isHostedGlobalProbe;
        const expectedHint: string = deployments.find(
          (entry: [ProbeDeployment, string]) => {
            return entry[0] === deployment;
          },
        )![1];

        const probe: LoadedProbe = loadProbe(deployment, optInValue);
        const guardSpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
          probe.EgressGuard,
          "assertUrlAllowed",
        );

        expect(probe.config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(
          expectedAllowed,
        );

        if (expectedAllowed) {
          await expectPrepared(probe, "http://10.23.45.67/health");
        } else {
          const error: EgressGuardError = await expectRefused(
            probe,
            "http://10.23.45.67/health",
          );
          expect(error.message).toBe(
            `Monitor target host 10.23.45.67 is not allowed: private network address.${expectedHint}`,
          );
        }

        expect(guardOptionsFromSpy(guardSpy)).toEqual({
          blockPrivateAddresses: !expectedAllowed,
          targetLabel: "Monitor target",
          privateNetworkHint: expectedHint,
          includeResolvedAddressInError: false,
          resolveTimeoutInMs: probe.monitorDnsResolveBudgetInMs,
        });
        expect(socketConnectSpy).not.toHaveBeenCalled();
      },
    );
  });
});
