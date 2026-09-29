import type RunnerCapabilitiesType from "../../Utils/RunnerCapabilities";
import type { RunnerCapabilitySet } from "../../Utils/RunnerCapabilities";

/*
 * ---------------------------------------------------------------------------
 * The dashboard is the control plane for what a Runner may do, and the
 * heartbeat is the channel that carries it.
 *
 * The bug this covers: capabilities were resolved once at boot while the
 * server counted the Runner as online immediately, so granting "Runs AI Code
 * Fixes" queued runs that nothing claimed until somebody restarted the
 * container — with no error anywhere, the runs simply sat there.
 *
 * The fix is deliberately not a lifecycle: no loop is started or stopped.
 * Both loops run and read the resolved capability on every tick, so adopting
 * a change is one assignment on the heartbeat path. These tests pin that
 * contract — that a grant becomes visible, that a revoke becomes visible, and
 * that a local override still wins over both.
 * ---------------------------------------------------------------------------
 */

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

function loadCapabilities(
  env: Record<string, string> = {},
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

describe("a capability granted while the Runner is running", () => {
  /*
   * The exact scenario from the audit: the Runner booted with code fixes off,
   * an operator turns them on, and the next heartbeat must make the code-fix
   * loop start claiming — no restart.
   */
  test("becomes effective as soon as the heartbeat reports it", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType =
      loadCapabilities();

    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });

    expect(RunnerCapabilities.resolve().canRunCodeFixTasks).toBe(false);

    // The operator flips the toggle; the next heartbeat carries it.
    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });

    expect(RunnerCapabilities.resolve().canRunCodeFixTasks).toBe(true);
  });

  test("a revoked capability stops being effective just as fast", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType =
      loadCapabilities();

    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });
    expect(RunnerCapabilities.resolve().canRunRunbooks).toBe(true);

    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: false,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });

    expect(RunnerCapabilities.resolve().canRunRunbooks).toBe(false);
  });

  /*
   * The local override is a refusal, not a preference — a later grant from
   * the dashboard must not talk the host into work its operator disabled.
   */
  test("a local override still wins over a later grant", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_RUNNER_ENABLE_CODE_FIXES: "false",
    });

    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });

    expect(RunnerCapabilities.resolve().canRunCodeFixTasks).toBe(false);
  });

  test("repeated identical heartbeats do not flap the resolved set", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType =
      loadCapabilities();

    const granted: RunnerCapabilitySet = {
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    };

    RunnerCapabilities.setGrantedByServer(granted);
    const first: RunnerCapabilitySet = RunnerCapabilities.resolve();

    RunnerCapabilities.setGrantedByServer(granted);
    RunnerCapabilities.setGrantedByServer(granted);

    expect(RunnerCapabilities.resolve()).toEqual(first);
  });

  /*
   * An older server sends no capabilities, so the heartbeat path never calls
   * setGrantedByServer. The Runner must keep working on its boot-time answer
   * rather than falling back to "nothing granted".
   */
  test("a server that reports no capabilities leaves the boot-time answer alone", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType =
      loadCapabilities();

    // No setGrantedByServer call at all — the older-server case.
    expect(RunnerCapabilities.resolve()).toEqual({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });
  });

  /*
   * Cluster scope has no dashboard row and therefore no capability channel;
   * a grant arriving from anywhere must never turn runbooks on there, because
   * runbook steps target a Runner a human picked in a project.
   */
  test("cluster scope ignores a runbook grant entirely", () => {
    const RunnerCapabilities: typeof RunnerCapabilitiesType = loadCapabilities({
      ONEUPTIME_SECRET: "test-cluster-secret",
    });

    RunnerCapabilities.setGrantedByServer({
      canRunRunbooks: true,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });

    expect(RunnerCapabilities.resolve().canRunRunbooks).toBe(false);
  });
});
