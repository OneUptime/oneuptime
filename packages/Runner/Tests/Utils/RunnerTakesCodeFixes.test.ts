/*
 * ---------------------------------------------------------------------------
 * Whether this Runner takes AI code fixes - what it tells the server on
 * registration and every heartbeat (RunnerCapabilities.takesCodeFixes).
 *
 * The server grants the code-fix capability (every global Runner, a
 * project's Runner while a repository works on it) and the host may only
 * narrow it, with ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false. The server used
 * to count a Runner as there to take a repository's fixes whatever its host
 * said, so they sat queued. Now the Runner says what its host allows,
 * whatever the server grants - and never for the in-cluster Runner the
 * Kubernetes agent chart installs, which does not run the code-fix loop.
 *
 * Config.ts reads the environment at import time, so every scenario
 * re-requires the modules through jest.resetModules() after arranging
 * process.env (as RunnerCapabilities.test.ts does).
 * ---------------------------------------------------------------------------
 */

import type RunnerCapabilitiesType from "../../Utils/RunnerCapabilities";
import type GlobalRunnerModeType from "../../Utils/GlobalRunnerMode";

const ENV_VARS_UNDER_TEST: Array<string> = [
  "ONEUPTIME_RUNNER_ENABLE_CODE_FIXES",
  "ONEUPTIME_RUNNER_ID",
  "ONEUPTIME_RUNNER_KEY",
  "ONEUPTIME_KUBERNETES_CLUSTER_NAME",
  "ONEUPTIME_INGESTION_KEY",
];

const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_VARS_UNDER_TEST) {
    originalEnv[key] = process.env[key];
  }
  delete process.env["ONEUPTIME_RUNNER_ENABLE_CODE_FIXES"];
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

interface LoadedModules {
  capabilities: typeof RunnerCapabilitiesType;
  globalRunnerMode: typeof GlobalRunnerModeType;
}

function load(env: Record<string, string | undefined>): LoadedModules {
  jest.resetModules();

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  return {
    capabilities: (
      require("../../Utils/RunnerCapabilities") as {
        default: typeof RunnerCapabilitiesType;
      }
    ).default,
    globalRunnerMode: (
      require("../../Utils/GlobalRunnerMode") as {
        default: typeof GlobalRunnerModeType;
      }
    ).default,
  };
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
}

describe("a Runner says whether it takes AI code fixes", () => {
  test("with nothing set on its host: it takes them", () => {
    expect(load({}).capabilities.takesCodeFixes()).toBe(true);
  });

  test.each(["false", "FALSE", " false ", "0", "no", "off"])(
    "with ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=%p: it does not",
    (value: string) => {
      expect(
        load({
          ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: value,
        }).capabilities.takesCodeFixes(),
      ).toBe(false);
    },
  );

  test.each(["true", "1", "yes", ""])(
    "with ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=%p: it does - the switch can only turn them off",
    (value: string) => {
      expect(
        load({
          ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: value,
        }).capabilities.takesCodeFixes(),
      ).toBe(true);
    },
  );

  /*
   * What its host allows, not what the server grants now: a Runner no
   * repository picks yet still says it would take them, so it is counted
   * the moment one does.
   */
  test("whatever the server grants it, and whether or not it is global", () => {
    const loaded: LoadedModules = load({});

    for (const canRunCodeFixTasks of [true, false]) {
      for (const isGlobalRunner of [true, false]) {
        loaded.capabilities.setGrantedByServer({
          canRunRunbooks: true,
          canRunCodeFixTasks,
          canRunAiCommands: false,
        });
        loaded.globalRunnerMode.setFromServer(isGlobalRunner);

        expect(loaded.capabilities.takesCodeFixes()).toBe(true);
      }
    }

    const refusing: LoadedModules = load({
      ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "false",
    });

    refusing.capabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });
    refusing.globalRunnerMode.setFromServer(true);

    expect(refusing.capabilities.takesCodeFixes()).toBe(false);
    // And what it resolves to run agrees: no code-fix loop.
    expect(refusing.capabilities.resolve().canRunCodeFixTasks).toBe(false);
  });

  test("the in-cluster Runner the Kubernetes agent chart installs never takes them: it runs no code-fix loop", () => {
    const loaded: LoadedModules = load({
      ONEUPTIME_RUNNER_ID: undefined,
      ONEUPTIME_RUNNER_KEY: undefined,
      ONEUPTIME_KUBERNETES_CLUSTER_NAME: "prod-eu",
      ONEUPTIME_INGESTION_KEY: "an-ingestion-key-0123456789",
    });

    expect(loaded.capabilities.takesCodeFixes()).toBe(false);
  });
});

describe("what a Runner whose host refuses granted code fixes logs on start", () => {
  test("a global Runner: that it tells OneUptime so, what the repositories then say, and the way to take them", () => {
    const warning: string = load({}).capabilities.getCodeFixesTurnedOffWarning(
      true,
    );

    expect(warning).toContain("This is a global Runner");
    expect(warning).toContain("ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false");
    expect(warning).toContain("It tells OneUptime so");
    expect(warning).toContain(
      "say no global Runner online takes AI code fixes",
    );
    expect(warning).toContain("Remove the override");
  });

  test("a project's Runner: the same, and that another Runner can be picked", () => {
    const warning: string = load({}).capabilities.getCodeFixesTurnedOffWarning(
      false,
    );

    expect(warning).toContain("ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false");
    expect(warning).toContain("It tells OneUptime so");
    expect(warning).toContain("takes no AI code fixes");
    expect(warning).toContain(
      "pick another Runner in the repository's settings in Code",
    );
  });

  /*
   * The old line promised runs would "sit queued": the server now knows,
   * so Code refuses new tasks with why, and the queue sweeper fails waiting
   * ones after 30 minutes, saying so.
   */
  test("neither promises the runs will sit queued any more", () => {
    const loaded: LoadedModules = load({});

    for (const isGlobalRunner of [true, false]) {
      expect(
        loaded.capabilities.getCodeFixesTurnedOffWarning(isGlobalRunner),
      ).not.toContain("sit queued");
    }
  });
});
