import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type * as ConfigModule from "../../../../Config";
import type * as ProcessRunnerModule from "../../../../Utils/Monitors/SyntheticRuntime/ProcessRunner";
import type * as SyntheticMonitorModule from "../../../../Utils/Monitors/MonitorTypes/SyntheticMonitor";
import type * as HttpMonitorRequestModule from "../../../../Utils/Monitors/HttpMonitorRequest";
import type * as EgressGuardModule from "Common/Server/Utils/DataSource/EgressGuard";
import MonitorEgressGuardOptions from "../../../../Utils/Monitors/MonitorEgressGuardOptions";
import {
  SyntheticMonitorWorkerConfig,
  isSyntheticMonitorWorkerConfig,
} from "../../../../Utils/Monitors/SyntheticRuntime/SyntheticMonitorWorkerTypes";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";

/*
 * GHSA-9rx7-vwfj-whp7: a synthetic check's browser and its script's axios
 * now go out through an egress proxy in the worker process, held to the
 * probe's egress policy. The worker cannot read the probe's environment, so
 * the supervisor hands it the policy - and it must be the one the probe's
 * API and Website monitors are held to, on every kind of probe:
 *
 *   - a global probe of a BILLING_ENABLED instance (OneUptime Cloud): public
 *     addresses only, whatever its operator set;
 *   - a self-hosted global probe (Helm chart, Docker Compose) and a custom
 *     probe: private addresses only where the operator turned
 *     PROBE_ALLOW_PRIVATE_NETWORK_MONITORS on.
 *
 * Each case boots the probe's module graph under that environment, as a
 * probe process does, and reads what SyntheticMonitor hands the worker.
 */

jest.setTimeout(60_000);

interface Deployment {
  label: string;
  registerProbeKey: string | undefined;
  billingEnabled: string | undefined;
  optIn: string | undefined;
  allowsPrivate: boolean;
}

const DEPLOYMENTS: Array<Deployment> = [
  {
    label: "a global probe of a BILLING_ENABLED instance, opted in",
    registerProbeKey: "register-probe-key",
    billingEnabled: "true",
    optIn: "true",
    allowsPrivate: false,
  },
  {
    label: "a global probe of a BILLING_ENABLED instance",
    registerProbeKey: "register-probe-key",
    billingEnabled: "true",
    optIn: undefined,
    allowsPrivate: false,
  },
  {
    label: "a self-hosted global probe without the opt-in",
    registerProbeKey: "register-probe-key",
    billingEnabled: undefined,
    optIn: undefined,
    allowsPrivate: false,
  },
  {
    label: "a self-hosted global probe with the opt-in",
    registerProbeKey: "register-probe-key",
    billingEnabled: undefined,
    optIn: "true",
    allowsPrivate: true,
  },
  {
    label: "a custom probe without the opt-in",
    registerProbeKey: undefined,
    billingEnabled: undefined,
    optIn: undefined,
    allowsPrivate: false,
  },
  {
    label: "a custom probe with the opt-in",
    registerProbeKey: undefined,
    billingEnabled: "true",
    optIn: "true",
    allowsPrivate: true,
  },
  {
    label: "a custom probe with an opt-in that is not exactly true",
    registerProbeKey: undefined,
    billingEnabled: undefined,
    optIn: "TRUE",
    allowsPrivate: false,
  },
];

const ENVIRONMENT_KEYS: Array<string> = [
  "ONEUPTIME_URL",
  "PROBE_INGEST_URL",
  "PROBE_KEY",
  "PROBE_ID",
  "REGISTER_PROBE_KEY",
  "BILLING_ENABLED",
  "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS",
];

interface LoadedProbe {
  config: typeof ConfigModule;
  workerConfig: SyntheticMonitorWorkerConfig;
  httpGuardOptions: unknown;
}

function setEnvironmentValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

/*
 * Boots the probe's modules under `deployment`, runs one synthetic check
 * and one HTTP monitor request, and returns what each asked of the egress
 * guard's policy.
 */
async function bootProbe(deployment: Deployment): Promise<LoadedProbe> {
  const saved: Map<string, string | undefined> = new Map<
    string,
    string | undefined
  >();
  for (const key of ENVIRONMENT_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }

  try {
    process.env["ONEUPTIME_URL"] = "https://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
    setEnvironmentValue("REGISTER_PROBE_KEY", deployment.registerProbeKey);
    setEnvironmentValue("BILLING_ENABLED", deployment.billingEnabled);
    setEnvironmentValue(
      "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS",
      deployment.optIn,
    );

    jest.resetModules();

    const config: typeof ConfigModule = jest.requireActual(
      "../../../../Config",
    ) as typeof ConfigModule;
    const processRunner: typeof ProcessRunnerModule = jest.requireActual(
      "../../../../Utils/Monitors/SyntheticRuntime/ProcessRunner",
    ) as typeof ProcessRunnerModule;
    const run: ReturnType<typeof jest.spyOn> = jest
      .spyOn(processRunner.default.prototype, "run")
      .mockResolvedValue({
        result: {
          returnValue: { data: true },
          logMessages: [],
          capturedMetrics: [],
          screenshots: {},
        },
        stdout: "",
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
      } as never);
    const syntheticMonitor: typeof SyntheticMonitorModule.default = (
      jest.requireActual(
        "../../../../Utils/Monitors/MonitorTypes/SyntheticMonitor",
      ) as typeof SyntheticMonitorModule
    ).default;
    jest
      .spyOn(syntheticMonitor, "getChromeExecutablePath")
      .mockResolvedValue("/playwright/chromium");

    await syntheticMonitor.execute({
      script: "return { data: true };",
      browserTypes: [BrowserType.Chromium],
      screenSizeTypes: [ScreenSizeType.Desktop],
    });

    const egressGuard: typeof EgressGuardModule.default = (
      jest.requireActual(
        "Common/Server/Utils/DataSource/EgressGuard",
      ) as typeof EgressGuardModule
    ).default;
    const guard: ReturnType<typeof jest.spyOn> = jest
      .spyOn(egressGuard, "assertUrlAllowed")
      .mockResolvedValue({
        url: new URL("https://api.example.com/"),
        addresses: [{ address: "93.184.215.14", family: 4 }],
      } as never);
    const httpMonitorRequest: typeof HttpMonitorRequestModule.default = (
      jest.requireActual(
        "../../../../Utils/Monitors/HttpMonitorRequest",
      ) as typeof HttpMonitorRequestModule
    ).default;
    await httpMonitorRequest.prepare("https://api.example.com/");

    return {
      config,
      workerConfig: run.mock.calls[0]![0]!
        .payload as SyntheticMonitorWorkerConfig,
      httpGuardOptions: guard.mock.calls[0]![1],
    };
  } finally {
    for (const [key, value] of saved) {
      setEnvironmentValue(key, value);
    }
  }
}

describe("the egress policy a probe hands its synthetic checks", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  test.each(DEPLOYMENTS)(
    "on $label, is the probe's own, the one its HTTP monitors are held to",
    async (deployment: Deployment) => {
      const probe: LoadedProbe = await bootProbe(deployment);

      expect(probe.workerConfig.egressPolicy).toEqual({
        allowPrivateNetworkAddresses: deployment.allowsPrivate,
        privateNetworkHint: probe.config.PROBE_PRIVATE_NETWORK_HINT,
      });
      expect(probe.config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(
        deployment.allowsPrivate,
      );
      // The worker accepts what it is handed.
      expect(isSyntheticMonitorWorkerConfig(probe.workerConfig)).toBe(true);
      // One policy: the synthetic check asks the guard what an API monitor asks.
      expect(
        MonitorEgressGuardOptions.forPolicy(probe.workerConfig.egressPolicy!),
      ).toEqual(probe.httpGuardOptions);
    },
  );

  test("on a global probe of a BILLING_ENABLED instance, points a refused private target at a private probe", async () => {
    const probe: LoadedProbe = await bootProbe(DEPLOYMENTS[0]!);

    expect(probe.workerConfig.egressPolicy?.privateNetworkHint).toBe(
      " Global probes cannot monitor private network addresses. Deploy and select a private probe for this target.",
    );
  });
});
