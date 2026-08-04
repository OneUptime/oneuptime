/*
 * ---------------------------------------------------------------------------
 * Regression tests for RunnerCapabilities.resolve() — canRunAiCommands.
 *
 * AI-composed remediation commands are the third capability, and its posture
 * is strictly deny-by-default: the dashboard's grant is the only thing that
 * can turn it ON, the ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS env var can only
 * ever turn it OFF, a cluster-scoped Runner can never have it (no project
 * row to opt in with), and an older server that never reported capabilities
 * cannot have granted it — so the legacy fallback keeps it off too.
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
  "ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS",
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

const AI_COMMANDS_GRANTED: RunnerCapabilitySet = {
  canRunRunbooks: true,
  canRunCodeFixTasks: false,
  canRunAiCommands: true,
};

const AI_COMMANDS_NOT_GRANTED: RunnerCapabilitySet = {
  canRunRunbooks: true,
  canRunCodeFixTasks: false,
  canRunAiCommands: false,
};

describe("project-scoped Runner: the dashboard grants AI commands, env can only narrow", () => {
  test("server grants AI commands + no env var: capability is on", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities(
      {},
    );

    RunnerCapabilities.setGrantedByServer(AI_COMMANDS_GRANTED);

    expect(RunnerCapabilities.resolve().canRunAiCommands).toBe(true);
  });

  test("server grants + ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS=false: host refusal wins", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS: "false",
    });

    RunnerCapabilities.setGrantedByServer(AI_COMMANDS_GRANTED);

    // Only the AI-commands capability is narrowed; the rest of the grant survives.
    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });
  });

  test("server grants + env var explicitly true: still on (redundant assent is harmless)", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS: "true",
    });

    RunnerCapabilities.setGrantedByServer(AI_COMMANDS_GRANTED);

    expect(RunnerCapabilities.resolve().canRunAiCommands).toBe(true);
  });

  test("no grant + ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS=true: env can never grant the capability", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS: "true",
    });

    RunnerCapabilities.setGrantedByServer(AI_COMMANDS_NOT_GRANTED);

    expect(RunnerCapabilities.resolve().canRunAiCommands).toBe(false);
  });
});

describe("cluster-scoped Runner: AI commands are always off", () => {
  /*
   * ONEUPTIME_SECRET set before Config is required makes
   * Common/Server/EnvironmentConfig.HasClusterKey — and with it
   * Config.IS_CLUSTER_SCOPED — true at import time.
   */
  test("off even when a (buggy or malicious) grant and the env var both say yes", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_SECRET: "test-cluster-secret",
      ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS: "true",
    });

    RunnerCapabilities.setGrantedByServer(AI_COMMANDS_GRANTED);

    expect(RunnerCapabilities.resolve().canRunAiCommands).toBe(false);
  });
});

describe("older server that never reported capabilities", () => {
  /*
   * setGrantedByServer never called — an old server cannot have granted AI
   * commands, so the fallback must keep them off even when the host's env
   * says true.
   */
  test("legacy fallback keeps AI commands off, even with the env var set to true", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_RUNNER_ENABLE_AI_COMMANDS: "true",
    });

    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });
  });
});
