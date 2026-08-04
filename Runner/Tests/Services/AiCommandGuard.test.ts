/*
 * ---------------------------------------------------------------------------
 * Unit tests for the AI-command defense-in-depth guard in RunbookExecutor.
 *
 * The server already gates AI-composed command jobs on the dashboard
 * capability and validates the command at enqueue — but the Runner binary
 * runs on the customer's host, so runJob re-checks BOTH the local capability
 * (which the host can revoke via env) and the command denylist right before
 * execution, where no server compromise can skip them.
 *
 * runJob is not exported; every case drives Executor.executeAndReport (the
 * exported surface) with AgentClient module-mocked so the result the guard
 * produced is captured from submitJobResult. child_process.spawn is mocked so
 * the tests can assert the strongest property: for a refused job the bash
 * process is NEVER spawned, not merely that a failure was reported.
 * ---------------------------------------------------------------------------
 */

import type { EventEmitter as NodeEventEmitter } from "events";

jest.mock("../../Services/RunnerClient", () => {
  return {
    __esModule: true,
    default: {
      submitJobResult: jest.fn().mockResolvedValue(true),
      jobHeartbeat: jest.fn().mockResolvedValue(true),
    },
  };
});

jest.mock("../../Services/SSHExecutor", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock("../../Services/KubernetesExecutor", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/VM/VMAPI", () => {
  return {
    __esModule: true,
    default: { runCodeInSandbox: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
  };
});

/*
 * A self-contained child_process mock (jest hoists jest.mock above imports,
 * so everything must live inside the factory). spawn records its arguments
 * and returns an EventEmitter-backed fake child that emits a little stdout
 * and then "close" with a controllable exit code on the next tick, so the
 * executor's promise settles on its own.
 */
jest.mock("child_process", () => {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const { EventEmitter } = require("events");
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  interface SpawnCall {
    command: string;
    args: Array<string>;
    options: Record<string, unknown>;
  }

  const calls: Array<SpawnCall> = [];
  const control: { exitCode: number } = { exitCode: 0 };

  class MockChildProcess extends EventEmitter {
    public stdout: NodeEventEmitter = new EventEmitter();
    public stderr: NodeEventEmitter = new EventEmitter();
  }

  function spawnMock(
    command: string,
    args: Array<string>,
    options: Record<string, unknown>,
  ): MockChildProcess {
    calls.push({ command, args, options });
    const child: MockChildProcess = new MockChildProcess();
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from("mock stdout"));
      /*
       * The untyped require() base class surfaces emit through an index
       * signature; cast to the real EventEmitter type to call it.
       */
      (child as unknown as NodeEventEmitter).emit(
        "close",
        control.exitCode,
        null,
      );
    });
    return child;
  }
  spawnMock.__calls = calls;
  spawnMock.__control = control;
  spawnMock.__reset = (): void => {
    calls.length = 0;
    control.exitCode = 0;
  };

  return { spawn: spawnMock };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import Executor from "../../Services/RunbookExecutor";
import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import SSHExecutor from "../../Services/SSHExecutor";
import RunnerCapabilities, {
  RunnerCapabilitySet,
} from "../../Utils/RunnerCapabilities";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import { spawn } from "child_process";

interface SpawnCallLike {
  command: string;
  args: Array<string>;
  options: Record<string, unknown>;
}

const spawnMock: {
  __calls: Array<SpawnCallLike>;
  __control: { exitCode: number };
  __reset: () => void;
} = spawn as unknown as {
  __calls: Array<SpawnCallLike>;
  __control: { exitCode: number };
  __reset: () => void;
};

const submitJobResult: jest.Mock =
  AgentClient.submitJobResult as unknown as jest.Mock;
const sshExecute: jest.Mock = SSHExecutor.execute as unknown as jest.Mock;
const runCodeInSandbox: jest.Mock =
  VMUtil.runCodeInSandbox as unknown as jest.Mock;

function fakeJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "job-1",
    stepId: "step-1",
    stepType: "Bash",
    script: "systemctl restart nginx",
    timeoutInMs: 5_000,
    ...overrides,
  } as ClaimedJob;
}

function mockCapabilities(canRunAiCommands: boolean): jest.SpyInstance {
  const capabilities: RunnerCapabilitySet = {
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    canRunAiCommands: canRunAiCommands,
  };
  return jest
    .spyOn(RunnerCapabilities, "resolve")
    .mockReturnValue(capabilities);
}

// The single submitted result payload for the run under test.
function submittedResult(): Record<string, unknown> {
  expect(submitJobResult).toHaveBeenCalledTimes(1);
  return submitJobResult.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  spawnMock.__reset();
  submitJobResult.mockClear();
  submitJobResult.mockResolvedValue(true);
  sshExecute.mockClear();
  runCodeInSandbox.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AiRemediation jobs: local capability check", () => {
  test("canRunAiCommands=false refuses the job and never spawns bash", async () => {
    mockCapabilities(false);

    await Executor.executeAndReport(
      fakeJob({ origin: "AiRemediation", script: "systemctl restart nginx" }),
    );

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(false);
    expect(result["errorMessage"]).toContain(
      "does not accept AI-composed commands",
    );
    expect(spawnMock.__calls).toHaveLength(0);
  });
});

describe("AiRemediation jobs: command policy re-check on the Runner", () => {
  test("a denylisted Bash script is refused even with the capability on, and never spawns", async () => {
    mockCapabilities(true);

    await Executor.executeAndReport(
      fakeJob({ origin: "AiRemediation", script: "rm -rf /" }),
    );

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(false);
    expect(result["errorMessage"]).toContain(
      "Refused by the Runner's command policy",
    );
    expect(spawnMock.__calls).toHaveLength(0);
  });

  test("a denylisted SSH payload command is refused before SSHExecutor is reached", async () => {
    mockCapabilities(true);

    await Executor.executeAndReport(
      fakeJob({
        origin: "AiRemediation",
        stepType: "SSH",
        script: "",
        payload: { command: "rm -rf /var/lib/postgresql" },
        credential: { hostname: "h", username: "u", privateKey: "k" },
      }),
    );

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(false);
    expect(result["errorMessage"]).toContain(
      "Refused by the Runner's command policy",
    );
    expect(sshExecute).not.toHaveBeenCalled();
    expect(spawnMock.__calls).toHaveLength(0);
  });
});

describe("AiRemediation jobs: step type restriction", () => {
  test("JavaScript steps are refused — AI commands may only be Bash or SSH", async () => {
    mockCapabilities(true);

    await Executor.executeAndReport(
      fakeJob({
        origin: "AiRemediation",
        stepType: "JavaScript",
        script: "return 1;",
      }),
    );

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(false);
    expect(result["errorMessage"]).toContain(
      "may not use step type JavaScript",
    );
    expect(runCodeInSandbox).not.toHaveBeenCalled();
    expect(spawnMock.__calls).toHaveLength(0);
  });
});

describe("AiRemediation jobs: a clean allowable command executes", () => {
  test("capability on + policy-clean Bash command spawns bash and reports success", async () => {
    mockCapabilities(true);

    await Executor.executeAndReport(
      fakeJob({ origin: "AiRemediation", script: "systemctl restart nginx" }),
    );

    expect(spawnMock.__calls).toHaveLength(1);
    expect(spawnMock.__calls[0]).toMatchObject({
      command: "bash",
      args: ["-c", "systemctl restart nginx"],
    });

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(true);
    expect(result["exitCode"]).toBe(0);
  });
});

describe("legacy Runbook jobs are untouched by the AI guard", () => {
  test("a job without an origin field runs without any capability or policy check", async () => {
    // The guard must not consult capabilities at all for non-AI jobs.
    const resolve: jest.SpyInstance = mockCapabilities(false);

    /*
     * A script the AI policy would refuse — a runbook author is allowed to
     * write it, so a legacy job (older server, no origin field) must still
     * spawn.
     */
    await Executor.executeAndReport(
      fakeJob({ script: "rm -rf /tmp/scratch && echo done" }),
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(spawnMock.__calls).toHaveLength(1);
    expect(spawnMock.__calls[0]).toMatchObject({
      command: "bash",
      args: ["-c", "rm -rf /tmp/scratch && echo done"],
    });

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(true);
  });
});
