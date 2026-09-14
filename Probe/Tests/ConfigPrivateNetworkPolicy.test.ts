const ENV_ALLOW_PRIVATE: string = "PROBE_ALLOW_PRIVATE_NETWORK_MONITORS";
const ENV_REGISTER_KEY: string = "REGISTER_PROBE_KEY";

interface PrivateNetworkPolicy {
  allowed: boolean;
  hint: string;
}

describe("probe HTTP monitor private-network policy", () => {
  const originalOneUptimeUrl: string | undefined = process.env["ONEUPTIME_URL"];
  const originalProbeKey: string | undefined = process.env["PROBE_KEY"];
  const originalAllowPrivate: string | undefined =
    process.env[ENV_ALLOW_PRIVATE];
  const originalRegisterKey: string | undefined = process.env[ENV_REGISTER_KEY];

  beforeAll(() => {
    process.env["ONEUPTIME_URL"] = "https://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
  });

  afterAll(() => {
    restoreEnvironment("ONEUPTIME_URL", originalOneUptimeUrl);
    restoreEnvironment("PROBE_KEY", originalProbeKey);
    restoreEnvironment(ENV_ALLOW_PRIVATE, originalAllowPrivate);
    restoreEnvironment(ENV_REGISTER_KEY, originalRegisterKey);
  });

  test("keeps a private probe public-only by default", () => {
    const policy: PrivateNetworkPolicy = loadPolicy(undefined, undefined);

    expect(policy.allowed).toBe(false);
    expect(policy.hint).toContain(ENV_ALLOW_PRIVATE);
    expect(policy.hint).toContain("on the probe");
  });

  test("allows an explicitly opted-in private probe to monitor private targets", () => {
    expect(loadPolicy("true", undefined).allowed).toBe(true);
  });

  test("never lets an auto-registered global probe relax public-only egress", () => {
    const policy: PrivateNetworkPolicy = loadPolicy(
      "true",
      "11111111-2222-3333-4444-555555555555",
    );

    expect(policy.allowed).toBe(false);
    expect(policy.hint).toContain("Global probes cannot monitor private");
    expect(policy.hint).toContain("private probe");
  });

  test.each(["TRUE", "1", "yes", "on", "false", ""])(
    "fails closed for the non-canonical opt-in value %p",
    (value: string) => {
      expect(loadPolicy(value, undefined).allowed).toBe(false);
    },
  );

  function loadPolicy(
    allowPrivate: string | undefined,
    registerKey: string | undefined,
  ): PrivateNetworkPolicy {
    restoreEnvironment(ENV_ALLOW_PRIVATE, allowPrivate);
    restoreEnvironment(ENV_REGISTER_KEY, registerKey);

    let policy: PrivateNetworkPolicy = { allowed: false, hint: "" };
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const config: {
        PROBE_ALLOW_PRIVATE_NETWORK_MONITORS: boolean;
        PROBE_PRIVATE_NETWORK_HINT: string;
      } = require("../Config") as {
        PROBE_ALLOW_PRIVATE_NETWORK_MONITORS: boolean;
        PROBE_PRIVATE_NETWORK_HINT: string;
      };
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

      policy = {
        allowed: config.PROBE_ALLOW_PRIVATE_NETWORK_MONITORS,
        hint: config.PROBE_PRIVATE_NETWORK_HINT,
      };
    });

    return policy;
  }

  function restoreEnvironment(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key];
      return;
    }
    process.env[key] = value;
  }
});
