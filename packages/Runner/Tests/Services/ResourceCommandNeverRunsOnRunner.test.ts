/*
 * ---------------------------------------------------------------------------
 * Regression tests: a ResourceCommand job never runs on a Runner.
 *
 * ResourceCommand is the step type of a command for an infrastructure
 * resource's own AI agent (a ResourceAiAgent row). The server never targets
 * a Runner with one (RunnerJobService.enqueue and enqueueAiCommand refuse
 * it, and a Runner cannot ask for it on a claim), and this binary has no
 * executor for it. So if one ever arrived — from any origin — it must be
 * refused before anything is spawned, sent over SSH or run in the sandbox.
 *
 * Same harness as AiCommandGuard.test.ts: executeAndReport is driven with
 * AgentClient module-mocked so the reported result is captured, and
 * child_process.spawn is mocked so "never spawned" is asserted directly.
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

const RESOURCE_COMMAND: string = "ResourceCommand";

describe("ResourceCommand jobs are refused by the Runner", () => {
  test.each([
    ["Runbook", "Unsupported step type: ResourceCommand"],
    [undefined, "Unsupported step type: ResourceCommand"],
    ["AiRemediation", "AI-composed jobs may not use step type ResourceCommand"],
    [
      "AiInvestigation",
      "AI investigation jobs may only run read-only kubectl, not ResourceCommand",
    ],
  ])(
    "origin %p: refused with %p, and nothing runs",
    async (origin: string | undefined, expected: string) => {
      mockCapabilities(true);

      await Executor.executeAndReport(
        fakeJob({
          ...(origin ? { origin } : {}),
          stepType: RESOURCE_COMMAND as ClaimedJob["stepType"],
          script: "docker restart web",
          payload: {
            resourceType: "DockerHost",
            program: "docker",
            args: ["restart", "web"],
            displayCommand: "docker restart web",
            tier: "SafeWrite",
          },
        }),
      );

      const result: Record<string, unknown> = submittedResult();
      expect(result["success"]).toBe(false);
      expect(String(result["errorMessage"])).toContain(expected);
      expect(spawnMock.__calls).toHaveLength(0);
      expect(sshExecute).not.toHaveBeenCalled();
      expect(runCodeInSandbox).not.toHaveBeenCalled();
    },
  );

  test("is refused even when the job carries a credential", async () => {
    mockCapabilities(true);

    await Executor.executeAndReport(
      fakeJob({
        origin: "AiRemediation",
        stepType: RESOURCE_COMMAND as ClaimedJob["stepType"],
        script: "",
        payload: { program: "docker", args: ["ps"] },
        credential: { hostname: "h", username: "u", privateKey: "k" },
      }),
    );

    expect(submittedResult()["success"]).toBe(false);
    expect(spawnMock.__calls).toHaveLength(0);
    expect(sshExecute).not.toHaveBeenCalled();
  });
});
