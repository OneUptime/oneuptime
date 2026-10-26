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
 * module-level state (the server grant, and GlobalRunnerMode what the server
 * said the Runner is), so every scenario re-requires the modules through
 * jest.resetModules() after arranging process.env.
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

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  return (
    require("../../Utils/RunnerCapabilities") as {
      default: typeof RunnerCapabilitiesType;
    }
  ).default;
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
}

const BOTH_GRANTED: RunnerCapabilitySet = {
  canRunRunbooks: true,
  canRunCodeFixTasks: true,
  canRunAiCommands: false,
};

const NEITHER_GRANTED: RunnerCapabilitySet = {
  canRunRunbooks: false,
  canRunCodeFixTasks: false,
  canRunAiCommands: false,
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
      canRunAiCommands: false,
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
      canRunAiCommands: false,
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
      canRunAiCommands: false,
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
        canRunAiCommands: false,
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
        canRunAiCommands: false,
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
        canRunAiCommands: false,
      });
    });
  });
});

describe("a global Runner: the server grants code fixes, and AI commands never", () => {
  /*
   * Only the server says a Runner is global (GlobalRunnerMode), on the same
   * copy of the modules the capabilities were loaded with.
   */
  function markGlobal(): void {
    /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
    (
      require("../../Utils/GlobalRunnerMode") as {
        default: { setFromServer: (isGlobalRunner: boolean) => void };
      }
    ).default.setFromServer(true);
    /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  }

  test("takes the code fixes the server grants it, and never AI commands, even when granted", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities(
      {},
    );
    markGlobal();

    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: true,
    });

    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });
  });

  test.each(["false", "0", "no", "off", "FALSE", " false "])(
    "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=%p on its host refuses the code fixes the server granted",
    (value: string) => {
      const RunnerCapabilities: typeof RunnerCapabilitiesType =
        loadCapabilities({ ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: value });
      markGlobal();

      RunnerCapabilities.setGrantedByServer(BOTH_GRANTED);

      expect(RunnerCapabilities.resolve().canRunCodeFixTasks).toBe(false);
      expect(RunnerCapabilities.wasGrantedCodeFixesByServer()).toBe(true);
    },
  );

  test("takes no code fixes a server did not grant, whatever its host says", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "true",
    });
    markGlobal();

    RunnerCapabilities.setGrantedByServer(NEITHER_GRANTED);

    expect(RunnerCapabilities.resolve()).toEqual(NEITHER_GRANTED);
  });
});

describe("a cluster key in the Runner's environment", () => {
  /*
   * Earlier releases made a Runner given ONEUPTIME_SECRET the shared Runner,
   * whose env vars were its whole answer. There is no shared Runner any
   * more: such a Runner resolves what the server granted, like any other.
   */
  test("changes nothing: the server's grant decides, env vars only narrow", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_SECRET: "test-cluster-secret",
      ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "true",
    });

    RunnerCapabilities.setGrantedByServer(BOTH_GRANTED);
    expect(RunnerCapabilities.resolve()).toEqual(BOTH_GRANTED);

    RunnerCapabilities.setGrantedByServer(NEITHER_GRANTED);
    expect(RunnerCapabilities.resolve()).toEqual(NEITHER_GRANTED);
  });
});
