import PrivateNetworkMonitorPolicy, {
  PrivateNetworkMonitorPolicyReason,
  ResolvedPrivateNetworkMonitorPolicy,
} from "../Utils/PrivateNetworkMonitorPolicy";

/*
 * Regression suite for OneUptime issue #3879, from the environment's side.
 *
 * Config.ts reads PROBE_ALLOW_PRIVATE_NETWORK_MONITORS, REGISTER_PROBE_KEY and
 * BILLING_ENABLED once, at import time, and every HTTP-capable monitor reads
 * the result. From 13.0.0 it ignored the opt-in whenever REGISTER_PROBE_KEY
 * was set, which is every probe the Helm chart and Docker Compose bundle, so
 * probes.<name>.allowPrivateNetworkMonitors: true did nothing and monitors on
 * internal targets broke on upgrade.
 *
 * Utils/PrivateNetworkMonitorPolicy.test.ts covers the decision itself; this
 * file re-imports Config.ts under real environments to pin the wiring: the
 * right variables feed the decision, BILLING_ENABLED is read the way the rest
 * of OneUptime reads it, and the three exports never disagree.
 */

const ENV_ALLOW_PRIVATE: string = "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS";
const ENV_REGISTER_KEY: string = "REGISTER_PROBE_KEY";
const ENV_BILLING_ENABLED: string = "BILLING_ENABLED";

const REGISTER_KEY: string = "11111111-2222-3333-4444-555555555555";
const HELM_VALUE: string = "probes.<name>.allowPrivateNetworkMonitors";

// Byte-for-byte what 13.0.0 shipped; neither may change.
const PRIVATE_PROBE_HINT: string =
  " Set PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on the probe running this monitor to allow it.";
const HOSTED_GLOBAL_PROBE_HINT: string =
  " Global probes cannot monitor private network addresses. Deploy and select a private probe for this target.";

interface ProbeEnvironment {
  allowPrivate?: string | undefined;
  registerKey?: string | undefined;
  billingEnabled?: string | undefined;
}

interface PrivateNetworkConfig {
  PROBE_ALLOW_PRIVATE_NETWORK_MONITORS: boolean;
  PROBE_PRIVATE_NETWORK_HINT: string;
  PROBE_PRIVATE_NETWORK_MONITOR_POLICY: ResolvedPrivateNetworkMonitorPolicy;
  HasRegisterProbeKey: boolean;
}

describe("probe HTTP monitor private-network policy", () => {
  const originalOneUptimeUrl: string | undefined = process.env["ONEUPTIME_URL"];
  const originalProbeKey: string | undefined = process.env["PROBE_KEY"];
  const originalAllowPrivate: string | undefined =
    process.env[ENV_ALLOW_PRIVATE];
  const originalRegisterKey: string | undefined = process.env[ENV_REGISTER_KEY];
  const originalBillingEnabled: string | undefined =
    process.env[ENV_BILLING_ENABLED];

  beforeAll(() => {
    process.env["ONEUPTIME_URL"] = "https://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
  });

  afterAll(() => {
    restoreEnvironment("ONEUPTIME_URL", originalOneUptimeUrl);
    restoreEnvironment("PROBE_KEY", originalProbeKey);
    restoreEnvironment(ENV_ALLOW_PRIVATE, originalAllowPrivate);
    restoreEnvironment(ENV_REGISTER_KEY, originalRegisterKey);
    restoreEnvironment(ENV_BILLING_ENABLED, originalBillingEnabled);
  });

  describe("a private probe (no REGISTER_PROBE_KEY)", () => {
    test("keeps private network monitoring off by default and points at its own environment variable", () => {
      const config: PrivateNetworkConfig = loadConfig({});

      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);
      expect(config.PROBE_PRIVATE_NETWORK_HINT).toBe(PRIVATE_PROBE_HINT);
      expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.reason).toBe(
        PrivateNetworkMonitorPolicyReason.NotRequested,
      );
      expect(
        config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.configuredValue,
      ).toBeNull();
    });

    test("allows an explicitly opted-in private probe to monitor private targets", () => {
      const config: PrivateNetworkConfig = loadConfig({ allowPrivate: "true" });

      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(true);
      expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.reason).toBe(
        PrivateNetworkMonitorPolicyReason.Allowed,
      );
      expect(config.PROBE_PRIVATE_NETWORK_HINT).toBe(PRIVATE_PROBE_HINT);
    });

    test("honors the opt-in even with BILLING_ENABLED=true: billing only restricts the shared global probes", () => {
      const config: PrivateNetworkConfig = loadConfig({
        allowPrivate: "true",
        billingEnabled: "true",
      });

      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(true);
      expect(config.PROBE_PRIVATE_NETWORK_HINT).toBe(PRIVATE_PROBE_HINT);
      expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.isBillingEnabled).toBe(
        true,
      );
      expect(
        config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.isAutoRegisteredGlobalProbe,
      ).toBe(false);
    });

    test("treats an empty REGISTER_PROBE_KEY as a private probe, the way Compose renders an unset variable", () => {
      const config: PrivateNetworkConfig = loadConfig({
        allowPrivate: "true",
        registerKey: "",
      });

      expect(config.HasRegisterProbeKey).toBe(false);
      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(true);
      expect(
        config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.isAutoRegisteredGlobalProbe,
      ).toBe(false);
      expect(config.PROBE_PRIVATE_NETWORK_HINT).toBe(PRIVATE_PROBE_HINT);
    });

    test("an empty REGISTER_PROBE_KEY is not mistaken for a hosted global probe when BILLING_ENABLED=true", () => {
      const config: PrivateNetworkConfig = loadConfig({
        allowPrivate: "true",
        registerKey: "",
        billingEnabled: "true",
      });

      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(true);
      expect(config.PROBE_PRIVATE_NETWORK_HINT).toBe(PRIVATE_PROBE_HINT);
    });
  });

  describe("an auto-registered global probe (REGISTER_PROBE_KEY set)", () => {
    test("ISSUE #3879: honors PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true on a self-hosted instance (BILLING_ENABLED unset)", () => {
      const config: PrivateNetworkConfig = loadConfig({
        allowPrivate: "true",
        registerKey: REGISTER_KEY,
      });

      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(true);
      expect(config.HasRegisterProbeKey).toBe(true);
      expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY).toMatchObject({
        allowed: true,
        reason: PrivateNetworkMonitorPolicyReason.Allowed,
        configuredValue: "true",
        isAutoRegisteredGlobalProbe: true,
        isBillingEnabled: false,
      });
    });

    test("ISSUE #3879: honors the opt-in with BILLING_ENABLED=false, as the Helm chart renders it on a self-hosted install", () => {
      const config: PrivateNetworkConfig = loadConfig({
        allowPrivate: "true",
        registerKey: REGISTER_KEY,
        billingEnabled: "false",
      });

      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(true);
      expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.isBillingEnabled).toBe(
        false,
      );
    });

    test("stays off by default and tells the operator which setting opens it, and for whom", () => {
      const config: PrivateNetworkConfig = loadConfig({
        registerKey: REGISTER_KEY,
      });
      const hint: string = config.PROBE_PRIVATE_NETWORK_HINT;

      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);
      expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.reason).toBe(
        PrivateNetworkMonitorPolicyReason.NotRequested,
      );
      expect(hint).toContain(`${ENV_ALLOW_PRIVATE}=true`);
      expect(hint).toContain("on the probe running this monitor");
      expect(hint).toContain(HELM_VALUE);
      expect(hint).toContain("every project");
      expect(hint).toContain("private probe");
      expect(hint).not.toMatch(/cannot/i);
      expect(hint).not.toBe(PRIVATE_PROBE_HINT);
    });

    test("stays off with the false that the Helm chart and Docker Compose render by default", () => {
      const config: PrivateNetworkConfig = loadConfig({
        allowPrivate: "false",
        registerKey: REGISTER_KEY,
        billingEnabled: "false",
      });

      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);
      expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.reason).toBe(
        PrivateNetworkMonitorPolicyReason.NotRequested,
      );
    });

    test("refuses the opt-in on a billing-enabled (hosted) instance, with the unchanged hosted hint", () => {
      const config: PrivateNetworkConfig = loadConfig({
        allowPrivate: "true",
        registerKey: REGISTER_KEY,
        billingEnabled: "true",
      });

      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);
      expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.reason).toBe(
        PrivateNetworkMonitorPolicyReason.RefusedOnHostedGlobalProbe,
      );
      expect(config.PROBE_PRIVATE_NETWORK_HINT).toBe(HOSTED_GLOBAL_PROBE_HINT);
    });

    test("keeps the hosted hint on a billing-enabled instance when nobody opted in", () => {
      const config: PrivateNetworkConfig = loadConfig({
        registerKey: REGISTER_KEY,
        billingEnabled: "true",
      });

      expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);
      expect(config.PROBE_PRIVATE_NETWORK_HINT).toBe(HOSTED_GLOBAL_PROBE_HINT);
    });
  });

  describe("values other than exactly true", () => {
    const probeKinds: Array<[string, ProbeEnvironment]> = [
      ["a private probe", {}],
      [
        "a self-hosted global probe",
        { registerKey: REGISTER_KEY, billingEnabled: "false" },
      ],
      [
        "a hosted global probe",
        { registerKey: REGISTER_KEY, billingEnabled: "true" },
      ],
    ];

    const nonCanonicalValues: Array<string> = [
      "TRUE",
      "True",
      "1",
      "yes",
      "on",
      " true",
      "true ",
      "true\n",
      "False",
      "FALSE",
      "0",
    ];

    const cases: Array<[string, string, ProbeEnvironment]> = [];
    for (const value of nonCanonicalValues) {
      for (const [kindName, environment] of probeKinds) {
        cases.push([
          JSON.stringify(value),
          kindName,
          { ...environment, allowPrivate: value },
        ]);
      }
    }

    test.each(cases)(
      "fail closed: %s on %s leaves private network monitoring off",
      (_value: string, _kind: string, environment: ProbeEnvironment) => {
        const config: PrivateNetworkConfig = loadConfig(environment);

        expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);
        expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.reason).toBe(
          PrivateNetworkMonitorPolicyReason.UnrecognizedValue,
        );
        expect(
          config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.configuredValue,
        ).toBe(environment.allowPrivate);
      },
    );

    test.each(probeKinds)(
      "an empty value on %s is the quiet default, not an unrecognized one",
      (_kind: string, environment: ProbeEnvironment) => {
        const config: PrivateNetworkConfig = loadConfig({
          ...environment,
          allowPrivate: "",
        });

        expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(false);
        expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.reason).toBe(
          PrivateNetworkMonitorPolicyReason.NotRequested,
        );
        expect(
          config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.configuredValue,
        ).toBe("");
      },
    );
  });

  describe("the exports agree with each other", () => {
    const environments: Array<[string, ProbeEnvironment]> = [
      ["private probe, default", {}],
      ["private probe, opted in", { allowPrivate: "true" }],
      [
        "private probe, opted in, BILLING_ENABLED=true",
        { allowPrivate: "true", billingEnabled: "true" },
      ],
      ["private probe, unrecognized value", { allowPrivate: "yes" }],
      ["self-hosted global probe, default", { registerKey: REGISTER_KEY }],
      [
        "self-hosted global probe, opted in",
        { allowPrivate: "true", registerKey: REGISTER_KEY },
      ],
      [
        "self-hosted global probe, unrecognized value",
        { allowPrivate: "TRUE", registerKey: REGISTER_KEY },
      ],
      [
        "hosted global probe, default",
        { registerKey: REGISTER_KEY, billingEnabled: "true" },
      ],
      [
        "hosted global probe, opted in",
        {
          allowPrivate: "true",
          registerKey: REGISTER_KEY,
          billingEnabled: "true",
        },
      ],
    ];

    test.each(environments)(
      "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS and PROBE_PRIVATE_NETWORK_HINT are read off PROBE_PRIVATE_NETWORK_MONITOR_POLICY (%s)",
      (_name: string, environment: ProbeEnvironment) => {
        const config: PrivateNetworkConfig = loadConfig(environment);

        expect(config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS).toBe(
          config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.allowed,
        );
        expect(config.PROBE_PRIVATE_NETWORK_HINT).toBe(
          config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.refusalHint,
        );
      },
    );

    test.each(environments)(
      "the policy is exactly what the resolver decides for this environment (%s)",
      (_name: string, environment: ProbeEnvironment) => {
        const config: PrivateNetworkConfig = loadConfig(environment);

        expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY).toEqual(
          PrivateNetworkMonitorPolicy.resolve({
            configuredValue: environment.allowPrivate,
            isAutoRegisteredGlobalProbe: Boolean(environment.registerKey),
            isBillingEnabled: environment.billingEnabled === "true",
          }),
        );
      },
    );

    test("the policy export exposes the reason and the raw configured value", () => {
      const config: PrivateNetworkConfig = loadConfig({
        allowPrivate: " true",
        registerKey: REGISTER_KEY,
      });

      expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.reason).toBe(
        PrivateNetworkMonitorPolicyReason.UnrecognizedValue,
      );
      expect(config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY.configuredValue).toBe(
        " true",
      );
    });

    test.each([
      ["set", REGISTER_KEY, true],
      ["unset", undefined, false],
      ["empty", "", false],
    ])(
      "HasRegisterProbeKey is still re-exported for discovery's global-probe rules (REGISTER_PROBE_KEY %s)",
      (_name: string, registerKey: string | undefined, expected: boolean) => {
        const config: PrivateNetworkConfig = loadConfig({
          registerKey: registerKey,
        });

        expect(config.HasRegisterProbeKey).toBe(expected);
        expect(
          config.PROBE_PRIVATE_NETWORK_MONITOR_POLICY
            .isAutoRegisteredGlobalProbe,
        ).toBe(expected);
      },
    );
  });

  /*
   * Sets exactly the three variables the policy reads (unset when absent), so
   * every case starts from a known environment whatever ran before it, then
   * imports a fresh Config.ts, which reads them at import time.
   */
  function loadConfig(environment: ProbeEnvironment): PrivateNetworkConfig {
    restoreEnvironment(ENV_ALLOW_PRIVATE, environment.allowPrivate);
    restoreEnvironment(ENV_REGISTER_KEY, environment.registerKey);
    restoreEnvironment(ENV_BILLING_ENABLED, environment.billingEnabled);

    const loaded: Array<PrivateNetworkConfig> = [];
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      loaded.push(require("../Config") as PrivateNetworkConfig);
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    });

    const config: PrivateNetworkConfig | undefined = loaded[0];
    if (!config) {
      throw new Error("Config.ts did not load");
    }

    return config;
  }

  function restoreEnvironment(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  }
});
