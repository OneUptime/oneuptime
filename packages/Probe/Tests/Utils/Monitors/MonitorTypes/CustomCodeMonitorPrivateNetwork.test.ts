import VMRunner from "Common/Server/Utils/VM/VMRunner";
import SSRFProtection, {
  ValidatedWebhookTarget,
} from "Common/Server/Utils/SSRFProtection";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";

/*
 * Custom JavaScript Code is the ONE monitor type a probe cannot point at an
 * internal address out of the box (issue #3424). Every other type — API,
 * Website, Ping, Port, SSL, DNS, SNMP, SQL, Synthetic — reaches whatever host
 * the monitor names, with no address check anywhere in Probe/. This one
 * executes through Common's VMRunner, whose axios bridge carries the SSRF
 * guard written for the WORKFLOW Custom JavaScript component, where the
 * request really does leave the API server.
 *
 * So the probe has to say, as it starts the sandbox, whether monitors on THIS
 * probe may reach private addresses. Two things have to hold and neither shows
 * up in the monitor's output:
 *
 *  - the flag comes from the PROBE's own environment, because whoever deploys
 *    a probe is the party who knows which network it sits in — a custom probe
 *    never reads the API server's configuration; and
 *  - it is off unless that operator turned it on, so upgrading an existing
 *    probe changes nothing.
 *
 * Issue #3879 added a third: the probes bundled with the Helm chart and
 * Docker Compose register themselves with REGISTER_PROBE_KEY, which makes them
 * GLOBAL probes, and from 13.0.0 a global probe silently ignored the opt-in.
 * They now honor it too, except on a BILLING_ENABLED instance (the hosted
 * product, where every sign-up shares the global probes). Because both of
 * those variables change the answer, every case here sets them explicitly:
 * a developer shell that exports REGISTER_PROBE_KEY or BILLING_ENABLED must
 * not change what this suite asserts.
 *
 * The guard itself is exercised in Common/Tests/Server/Utils/SSRFProtection*;
 * what is pinned here is the hand-off, and - at the end - what the real guard
 * does with exactly the options this monitor hands the sandbox.
 */

const ENV_VAR: string = "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS";

interface CustomCodeMonitorClass {
  execute(options: {
    script: string;
  }): Promise<CustomCodeMonitorResponse | null>;
}

interface SandboxCallOptions {
  allowPrivateNetworkRequests?: boolean;
  privateNetworkAccessIsAllowed?: boolean;
  privateNetworkHint?: string;
  timeout?: number;
}

interface ProbeDeployment {
  // REGISTER_PROBE_KEY: set means this probe registers itself as global.
  registerProbeKey: string | undefined;
  // BILLING_ENABLED: "true" is the hosted, open-signup product.
  billingEnabled: string | undefined;
}

const PRIVATE_PROBE: ProbeDeployment = {
  registerProbeKey: undefined,
  billingEnabled: undefined,
};

// What the Helm chart and Docker Compose deploy: global, billing off.
const SELF_HOSTED_GLOBAL_PROBE: ProbeDeployment = {
  registerProbeKey: "register-probe-key-from-the-helm-chart",
  billingEnabled: undefined,
};

const HOSTED_GLOBAL_PROBE: ProbeDeployment = {
  registerProbeKey: "register-probe-key-on-the-hosted-product",
  billingEnabled: "true",
};

const PRIVATE_PROBE_HINT: string =
  " Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it.";

const HOSTED_GLOBAL_PROBE_HINT: string =
  " Global probes cannot monitor private network addresses. Deploy and select a private probe for this target.";

const SANDBOX_RESULT: ReturnResult = {
  returnValue: { data: "ok" },
  logMessages: [],
} as unknown as ReturnResult;

function setEnvironmentValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

/*
 * Probe/Config.ts reads process.env at import time, so the module graph has to
 * be rebuilt for each policy rather than the env flipped underneath it.
 */
function loadMonitorWith(
  envValue: string | undefined,
  deployment: ProbeDeployment = PRIVATE_PROBE,
): {
  monitor: CustomCodeMonitorClass;
  runSpy: jest.SpyInstance;
} {
  jest.resetModules();

  setEnvironmentValue(ENV_VAR, envValue);
  setEnvironmentValue("REGISTER_PROBE_KEY", deployment.registerProbeKey);
  setEnvironmentValue("BILLING_ENABLED", deployment.billingEnabled);

  const runner: typeof VMRunner = jest.requireActual<{
    default: typeof VMRunner;
  }>("Common/Server/Utils/VM/VMRunner").default;

  const runSpy: jest.SpyInstance = jest
    .spyOn(runner, "runCodeInSandbox")
    .mockResolvedValue(SANDBOX_RESULT as never);

  const monitor: CustomCodeMonitorClass = jest.requireActual<{
    default: CustomCodeMonitorClass;
  }>("../../../../Utils/Monitors/MonitorTypes/CustomCodeMonitor").default;

  return { monitor, runSpy };
}

async function sandboxOptionsFor(
  envValue: string | undefined,
  deployment: ProbeDeployment = PRIVATE_PROBE,
): Promise<SandboxCallOptions> {
  const { monitor, runSpy } = loadMonitorWith(envValue, deployment);

  await monitor.execute({ script: "return {data: 'ok'};" });

  expect(runSpy).toHaveBeenCalledTimes(1);

  const call: Array<{ options: SandboxCallOptions }> = runSpy.mock
    .calls[0] as Array<{ options: SandboxCallOptions }>;

  return call[0]!.options;
}

function expectPrivateNetworkPolicy(
  options: SandboxCallOptions,
  expected: boolean,
): void {
  expect(options.allowPrivateNetworkRequests).toBe(expected);
  expect(options.privateNetworkAccessIsAllowed).toBe(expected);
}

function expectSelfHostedGlobalProbeHint(hint: string | undefined): void {
  expect(hint).toContain(`${ENV_VAR}=true`);
  expect(hint).toContain("on the probe running this monitor");
  expect(hint).toContain("probes.<name>.allowPrivateNetworkMonitors");
  expect(hint).toContain("every project on this instance");
  expect(hint).toContain("private probe");
  expect(hint).not.toContain("ALLOW_PRIVATE_NETWORK_WEBHOOKS");
  expect(hint).not.toContain("Global probes cannot monitor");
}

/*
 * The exact call VMRunner's axios bridge makes with these options before it
 * dials anything. That mapping is pinned at the source level by
 * Common/Tests/Server/Utils/VM/VMRunnerPrivateNetworkWiring.test.ts (the real
 * sandbox needs the isolated-vm native module, which the probe suite mocks),
 * so running it here shows what a script's request would actually meet.
 */
async function validateAsTheSandboxBridgeWould(
  options: SandboxCallOptions,
  url: string,
): Promise<ValidatedWebhookTarget> {
  return await SSRFProtection.validateAndResolveWebhookTarget(url, {
    allowPrivateNetworkTargets: options.allowPrivateNetworkRequests === true,
    privateNetworkAccessIsAllowed: options.privateNetworkAccessIsAllowed,
    targetLabel: "Request URL",
    privateNetworkHint: options.privateNetworkHint,
  });
}

describe("CustomCodeMonitor private network policy", () => {
  const originalOneUptimeUrl: string | undefined = process.env["ONEUPTIME_URL"];
  const originalProbeKey: string | undefined = process.env["PROBE_KEY"];
  const originalEnvValue: string | undefined = process.env[ENV_VAR];
  const originalRegisterProbeKey: string | undefined =
    process.env["REGISTER_PROBE_KEY"];
  const originalBillingEnabled: string | undefined =
    process.env["BILLING_ENABLED"];

  beforeAll(() => {
    process.env["ONEUPTIME_URL"] = "http://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.resetModules();

    setEnvironmentValue("ONEUPTIME_URL", originalOneUptimeUrl);
    setEnvironmentValue("PROBE_KEY", originalProbeKey);
    setEnvironmentValue(ENV_VAR, originalEnvValue);
    setEnvironmentValue("REGISTER_PROBE_KEY", originalRegisterProbeKey);
    setEnvironmentValue("BILLING_ENABLED", originalBillingEnabled);
  });

  test("is off when the probe operator set nothing", async () => {
    const options: SandboxCallOptions = await sandboxOptionsFor(undefined);

    expectPrivateNetworkPolicy(options, false);
  });

  test("is on when the probe operator set it", async () => {
    const options: SandboxCallOptions = await sandboxOptionsFor("true");

    expectPrivateNetworkPolicy(options, true);
  });

  /*
   * A typo in a security switch must fail closed. Each of these reads as "on"
   * to someone writing a .env file, which is exactly why they are named.
   */
  test.each(["false", "TRUE", "True", "1", "yes", "on", ""])(
    "stays off for the value %p",
    async (value: string) => {
      const options: SandboxCallOptions = await sandboxOptionsFor(value);

      expectPrivateNetworkPolicy(options, false);
    },
  );

  /*
   * The guard's default refusal names the API server's webhook settings, which
   * this process does not read and whoever runs this probe usually cannot
   * edit. Pointing an operator at the wrong machine is how the original bug
   * got filed.
   */
  test("overrides the refusal hint to name the probe's own setting", async () => {
    const options: SandboxCallOptions = await sandboxOptionsFor(undefined);

    expect(options.privateNetworkHint).toContain(ENV_VAR);
    expect(options.privateNetworkHint).toContain("on the probe");
    expect(options.privateNetworkHint).not.toContain(
      "ALLOW_PRIVATE_NETWORK_WEBHOOKS",
    );
  });

  test("gives a private probe the unchanged private-probe hint, with nothing about global probes", async () => {
    const options: SandboxCallOptions = await sandboxOptionsFor(undefined);

    expect(options.privateNetworkHint).toBe(PRIVATE_PROBE_HINT);
    expect(options.privateNetworkHint).not.toContain("Helm");
    expect(options.privateNetworkHint).not.toContain("global probe");
  });

  test("still passes the script timeout through", async () => {
    const options: SandboxCallOptions = await sandboxOptionsFor("true");

    expect(typeof options.timeout).toBe("number");
    expect(options.timeout).toBeGreaterThan(0);
  });

  /*
   * BILLING_ENABLED only restricts GLOBAL probes. A customer's own probe
   * whose environment happens to carry it is still the customer's to open.
   */
  test("stays on for a private probe whose environment also sets BILLING_ENABLED=true", async () => {
    const options: SandboxCallOptions = await sandboxOptionsFor("true", {
      registerProbeKey: undefined,
      billingEnabled: "true",
    });

    expectPrivateNetworkPolicy(options, true);
    expect(options.privateNetworkHint).toBe(PRIVATE_PROBE_HINT);
  });

  describe("on a global probe (REGISTER_PROBE_KEY set)", () => {
    /*
     * ISSUE #3879 regression. The bundled probe is global, its operator is
     * the instance's operator, and the opt-in they set in the Helm values
     * used to be dropped here without a word.
     */
    test("is on when the operator of a self-hosted global probe set it", async () => {
      const options: SandboxCallOptions = await sandboxOptionsFor(
        "true",
        SELF_HOSTED_GLOBAL_PROBE,
      );

      expectPrivateNetworkPolicy(options, true);
    });

    test("is on with BILLING_ENABLED=false spelled out", async () => {
      const options: SandboxCallOptions = await sandboxOptionsFor("true", {
        registerProbeKey: "register-probe-key-from-docker-compose",
        billingEnabled: "false",
      });

      expectPrivateNetworkPolicy(options, true);
    });

    test("is off by default and says how to turn it on for a global probe", async () => {
      const options: SandboxCallOptions = await sandboxOptionsFor(
        undefined,
        SELF_HOSTED_GLOBAL_PROBE,
      );

      expectPrivateNetworkPolicy(options, false);
      expectSelfHostedGlobalProbeHint(options.privateNetworkHint);
    });

    test.each(["false", "TRUE", "True", "1", "yes", "on", "", " true"])(
      "stays off for the value %p",
      async (value: string) => {
        const options: SandboxCallOptions = await sandboxOptionsFor(
          value,
          SELF_HOSTED_GLOBAL_PROBE,
        );

        expectPrivateNetworkPolicy(options, false);
        expectSelfHostedGlobalProbeHint(options.privateNetworkHint);
      },
    );

    /*
     * The hosted product: every sign-up shares these probes, so a stray
     * opt-in there would open the network the probe runs in to all of them.
     */
    test("stays off on a BILLING_ENABLED instance even when the opt-in is set", async () => {
      const options: SandboxCallOptions = await sandboxOptionsFor(
        "true",
        HOSTED_GLOBAL_PROBE,
      );

      expectPrivateNetworkPolicy(options, false);
      expect(options.privateNetworkHint).toBe(HOSTED_GLOBAL_PROBE_HINT);
    });

    test("tells a hosted-product tenant to use a private probe, not to set a probe variable", async () => {
      const options: SandboxCallOptions = await sandboxOptionsFor(
        undefined,
        HOSTED_GLOBAL_PROBE,
      );

      expectPrivateNetworkPolicy(options, false);
      expect(options.privateNetworkHint).toBe(HOSTED_GLOBAL_PROBE_HINT);
      expect(options.privateNetworkHint).not.toContain(ENV_VAR);
    });
  });

  describe("what the real sandbox guard does with the options this monitor passes", () => {
    test.each([
      "http://10.23.45.67/health",
      "http://172.16.0.5:8080/metrics",
      "http://192.168.1.10/",
      "http://100.64.0.1/",
    ])(
      "lets a script on a self-hosted global probe with the opt-in reach %s",
      async (url: string) => {
        const options: SandboxCallOptions = await sandboxOptionsFor(
          "true",
          SELF_HOSTED_GLOBAL_PROBE,
        );

        const target: ValidatedWebhookTarget =
          await validateAsTheSandboxBridgeWould(options, url);

        expect(target.url.href).toBe(new globalThis.URL(url).href);
        expect(target.addresses).toEqual([
          { address: new globalThis.URL(url).hostname, family: 4 },
        ]);
      },
    );

    test.each([
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://0.0.0.0/",
      "http://[::1]/",
    ])(
      "still refuses %s to a script on a self-hosted global probe with the opt-in",
      async (url: string) => {
        const options: SandboxCallOptions = await sandboxOptionsFor(
          "true",
          SELF_HOSTED_GLOBAL_PROBE,
        );

        await expect(
          validateAsTheSandboxBridgeWould(options, url),
        ).rejects.toThrow(
          "Request URL points to a private, loopback, or link-local address and is not allowed.",
        );
      },
    );

    test("refuses a private target on a self-hosted global probe without the opt-in, naming the probe's setting", async () => {
      const options: SandboxCallOptions = await sandboxOptionsFor(
        undefined,
        SELF_HOSTED_GLOBAL_PROBE,
      );

      await expect(
        validateAsTheSandboxBridgeWould(options, "http://10.23.45.67/health"),
      ).rejects.toThrow(
        `Request URL points to a private network address and is not allowed.${options.privateNetworkHint}`,
      );
      expectSelfHostedGlobalProbeHint(options.privateNetworkHint);
    });

    test("refuses a private target on a BILLING_ENABLED global probe with the opt-in, pointing at a private probe", async () => {
      const options: SandboxCallOptions = await sandboxOptionsFor(
        "true",
        HOSTED_GLOBAL_PROBE,
      );

      await expect(
        validateAsTheSandboxBridgeWould(options, "http://10.23.45.67/health"),
      ).rejects.toThrow(
        `Request URL points to a private network address and is not allowed.${HOSTED_GLOBAL_PROBE_HINT}`,
      );
    });

    test("refuses a private target on a private probe without the opt-in with the private-probe hint", async () => {
      const options: SandboxCallOptions = await sandboxOptionsFor(undefined);

      await expect(
        validateAsTheSandboxBridgeWould(options, "http://10.23.45.67/health"),
      ).rejects.toThrow(
        `Request URL points to a private network address and is not allowed.${PRIVATE_PROBE_HINT}`,
      );
    });

    test("lets a script on a private probe with the opt-in reach a private target, as before", async () => {
      const options: SandboxCallOptions = await sandboxOptionsFor("true");

      await expect(
        validateAsTheSandboxBridgeWould(options, "http://10.23.45.67/health"),
      ).resolves.toMatchObject({
        addresses: [{ address: "10.23.45.67", family: 4 }],
      });
    });
  });
});
