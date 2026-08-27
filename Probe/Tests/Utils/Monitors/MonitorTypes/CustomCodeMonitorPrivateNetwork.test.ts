import VMRunner from "Common/Server/Utils/VM/VMRunner";
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
 * The guard itself is exercised in Common/Tests/Server/Utils/SSRFProtection*;
 * what is pinned here is the hand-off.
 */

const ENV_VAR: string = "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS";

interface CustomCodeMonitorClass {
  execute(options: {
    script: string;
  }): Promise<CustomCodeMonitorResponse | null>;
}

interface SandboxCallOptions {
  allowPrivateNetworkRequests?: boolean;
  privateNetworkHint?: string;
  timeout?: number;
}

const SANDBOX_RESULT: ReturnResult = {
  returnValue: { data: "ok" },
  logMessages: [],
} as unknown as ReturnResult;

/*
 * Probe/Config.ts reads process.env at import time, so the module graph has to
 * be rebuilt for each policy rather than the env flipped underneath it.
 */
function loadMonitorWith(envValue: string | undefined): {
  monitor: CustomCodeMonitorClass;
  runSpy: jest.SpyInstance;
} {
  jest.resetModules();

  if (envValue === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = envValue;
  }

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
): Promise<SandboxCallOptions> {
  const { monitor, runSpy } = loadMonitorWith(envValue);

  await monitor.execute({ script: "return {data: 'ok'};" });

  expect(runSpy).toHaveBeenCalledTimes(1);

  const call: Array<{ options: SandboxCallOptions }> = runSpy.mock
    .calls[0] as Array<{ options: SandboxCallOptions }>;

  return call[0]!.options;
}

describe("CustomCodeMonitor private network policy", () => {
  const originalOneUptimeUrl: string | undefined = process.env["ONEUPTIME_URL"];
  const originalProbeKey: string | undefined = process.env["PROBE_KEY"];
  const originalEnvValue: string | undefined = process.env[ENV_VAR];

  beforeAll(() => {
    process.env["ONEUPTIME_URL"] = "http://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    jest.resetModules();

    const restore: (key: string, value: string | undefined) => void = (
      key: string,
      value: string | undefined,
    ): void => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    restore("ONEUPTIME_URL", originalOneUptimeUrl);
    restore("PROBE_KEY", originalProbeKey);
    restore(ENV_VAR, originalEnvValue);
  });

  test("is off when the probe operator set nothing", async () => {
    const options: SandboxCallOptions = await sandboxOptionsFor(undefined);

    expect(options.allowPrivateNetworkRequests).toBe(false);
  });

  test("is on when the probe operator set it", async () => {
    const options: SandboxCallOptions = await sandboxOptionsFor("true");

    expect(options.allowPrivateNetworkRequests).toBe(true);
  });

  /*
   * A typo in a security switch must fail closed. Each of these reads as "on"
   * to someone writing a .env file, which is exactly why they are named.
   */
  test.each(["false", "TRUE", "True", "1", "yes", "on", ""])(
    "stays off for the value %p",
    async (value: string) => {
      const options: SandboxCallOptions = await sandboxOptionsFor(value);

      expect(options.allowPrivateNetworkRequests).toBe(false);
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

  test("still passes the script timeout through", async () => {
    const options: SandboxCallOptions = await sandboxOptionsFor("true");

    expect(typeof options.timeout).toBe("number");
    expect(options.timeout).toBeGreaterThan(0);
  });
});
