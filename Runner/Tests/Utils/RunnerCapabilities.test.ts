/*
 * ---------------------------------------------------------------------------
 * Regression tests for RunnerCapabilities.resolve().
 *
 * The dashboard is now the control plane for what a project-scoped Runner may
 * do; the ONEUPTIME_RUNNER_ENABLE_* env vars are a local override that can
 * only ever turn a capability OFF. The bug this replaces: the env vars were
 * the only input, so "code fixes enabled" in the dashboard did nothing unless
 * the container env also said so — and worse, a host could grant itself
 * capabilities the dashboard withheld.
 *
 * Config.ts reads the env at import time and RunnerCapabilities holds
 * module-level state (the server grant), so every scenario re-requires both
 * modules through jest.resetModules() after arranging process.env.
 * ---------------------------------------------------------------------------
 */

import type RunnerCapabilitiesType from "../../Utils/RunnerCapabilities";
import type { RunnerCapabilitySet } from "../../Utils/RunnerCapabilities";

const ENV_VARS_UNDER_TEST: Array<string> = [
  "ONEUPTIME_RUNNER_ENABLE_RUNBOOKS",
  "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES",
  "ONEUPTIME_SECRET",
];

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_VARS_UNDER_TEST) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_VARS_UNDER_TEST) {
    if (originalEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalEnv[key];
    }
  }
  jest.resetModules();
});

/*
 * Re-require RunnerCapabilities (and, through it, Config) with the current
 * process.env. jest.resetModules() drops the whole registry, so both the
 * env-derived Config constants and RunnerCapabilities' module-level grant
 * state start fresh — no scenario can leak into the next.
 */
function loadCapabilities(
  env: Record<string, string>,
): typeof RunnerCapabilitiesType {
  jest.resetModules();

  for (const [key, value] of Object.entries(env)) {
    process.env[key] = value;
  }

  /* eslint-disable @typescript-eslint/no-require-imports */
  return (
    require("../../Utils/RunnerCapabilities") as {
      default: typeof RunnerCapabilitiesType;
    }
  ).default;
  /* eslint-enable @typescript-eslint/no-require-imports */
}

const BOTH_GRANTED: RunnerCapabilitySet = {
  canRunRunbooks: true,
  canRunCodeFixTasks: true,
};

const NEITHER_GRANTED: RunnerCapabilitySet = {
  canRunRunbooks: false,
  canRunCodeFixTasks: false,
};

describe("project-scoped Runner: the dashboard grants, env vars only narrow", () => {
  /*
   * The case that was broken before: dashboard says code fixes ON, container
   * env unset. The env var says nothing (tri-state, unset = null), so the
   * server's grant must win and the capability must be ON.
   */
  test("server grants both + no env vars: both capabilities on", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities(
      {},
    );

    RunnerCapabilities.setGrantedByServer(BOTH_GRANTED);

    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
    });
  });

  test("server grants both + ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false: local override narrows code fixes only", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "false",
    });

    RunnerCapabilities.setGrantedByServer(BOTH_GRANTED);

    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
    });
  });

  /*
   * A host cannot grant itself what the dashboard withheld. Setting both env
   * vars to "true" on a Runner the project granted nothing must yield
   * nothing — explicitly assert BOTH stay off.
   */
  test("server grants neither + both env vars true: both capabilities stay off", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_RUNNER_ENABLE_RUNBOOKS: "true",
      ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "true",
    });

    RunnerCapabilities.setGrantedByServer(NEITHER_GRANTED);

    const resolved: RunnerCapabilitySet = RunnerCapabilities.resolve();

    expect(resolved.canRunRunbooks).toBe(false);
    expect(resolved.canRunCodeFixTasks).toBe(false);
  });

  test("env override can revoke runbooks the server granted", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_RUNNER_ENABLE_RUNBOOKS: "false",
    });

    RunnerCapabilities.setGrantedByServer(BOTH_GRANTED);

    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: false,
      canRunCodeFixTasks: true,
    });
  });

  describe("older server that never reported capabilities", () => {
    /*
     * setGrantedByServer never called — the historical env-var behavior must
     * survive so upgrading the Runner before the server never silently stops
     * it working: runbooks on, code fixes follow the env override.
     */
    test("falls back to runbooks on and code fixes off with no env vars", () => {
      const RunnerCapabilities: typeof RunnerCapabilitiesType =
        loadCapabilities({});

      expect(RunnerCapabilities.resolve()).toEqual({
        canRunRunbooks: true,
        canRunCodeFixTasks: false,
      });
    });

    test("code fixes follow ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=true in the fallback", () => {
      const RunnerCapabilities: typeof RunnerCapabilitiesType =
        loadCapabilities({
          ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "true",
        });

      expect(RunnerCapabilities.resolve()).toEqual({
        canRunRunbooks: true,
        canRunCodeFixTasks: true,
      });
    });

    test("runbooks can still be switched off locally in the fallback", () => {
      const RunnerCapabilities: typeof RunnerCapabilitiesType =
        loadCapabilities({
          ONEUPTIME_RUNNER_ENABLE_RUNBOOKS: "false",
        });

      expect(RunnerCapabilities.resolve()).toEqual({
        canRunRunbooks: false,
        canRunCodeFixTasks: false,
      });
    });
  });
});

describe("cluster-scoped Runner: no dashboard row, env vars are the whole answer", () => {
  /*
   * ONEUPTIME_SECRET set before Config is required makes
   * Common/Server/EnvironmentConfig.HasClusterKey — and with it
   * Config.IS_CLUSTER_SCOPED — true at import time.
   */
  test("canRunRunbooks is always false, even when a grant and env var say otherwise", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_SECRET: "test-cluster-secret",
      ONEUPTIME_RUNNER_ENABLE_RUNBOOKS: "true",
    });

    // Even a (buggy or malicious) server grant must not enable runbooks.
    RunnerCapabilities.setGrantedByServer(BOTH_GRANTED);

    expect(RunnerCapabilities.resolve().canRunRunbooks).toBe(false);
  });

  test("canRunCodeFixTasks follows ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=true", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_SECRET: "test-cluster-secret",
      ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "true",
    });

    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: false,
      canRunCodeFixTasks: true,
    });
  });

  /*
   * Code fixes are the only work a cluster Runner can do, and the Helm chart
   * sets no capability env vars — defaulting this off left the in-cluster
   * Runner of a default self-hosted install with no capability at all.
   */
  test("canRunCodeFixTasks is ON when the env var is unset — the default Helm install", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_SECRET: "test-cluster-secret",
    });

    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: false,
      canRunCodeFixTasks: true,
    });
  });

  test.each(["false", "0", "no", "off", "FALSE", " false "])(
    "canRunCodeFixTasks is off when the env var says %p",
    (value: string) => {
      const RunnerCapabilities: typeof RunnerCapabilitiesType =
        loadCapabilities({
          ONEUPTIME_SECRET: "test-cluster-secret",
          ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: value,
        });

      expect(RunnerCapabilities.resolve().canRunCodeFixTasks).toBe(false);
    },
  );

  test("canRunCodeFixTasks stays off when the env var says false", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_SECRET: "test-cluster-secret",
      ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "false",
    });

    expect(RunnerCapabilities.resolve().canRunCodeFixTasks).toBe(false);
  });
});
