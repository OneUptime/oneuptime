/*
 * ---------------------------------------------------------------------------
 * A global Runner runs a runbook's own JavaScript steps and nothing else.
 *
 * A global Runner is one the OneUptime server runs for every project: it
 * takes steps from every project that uses global Runners, so it runs only
 * what can be kept apart project by project on one host. The server serves
 * it nothing else (RunnerJobService.claimNextGlobalJob); this is the second
 * check, on the host that would run it, whatever the server sent:
 *
 *   - a Bash, SSH, Kubernetes or kubectl job is refused before anything
 *     starts: no process is ever spawned, no connection opened;
 *   - an AI-composed command is refused, whatever its type;
 *   - a job carrying a credential is refused;
 *   - a JavaScript step runs in a sandbox of its own whose egress is the
 *     strict one, said authoritatively, and whose refusals never say what
 *     DNS answered - one project's script must not map the network the
 *     global Runner sits in.
 *
 * Driven through Executor.executeAndReport with the collaborators
 * module-mocked; bash is a recording mock so "never spawned" is asserted.
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

jest.mock("../../Services/KubectlExecutor", () => {
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

jest.mock("child_process", () => {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const { EventEmitter } = require("events");
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  const calls: Array<{ command: string; args: Array<string> }> = [];

  class MockChildProcess extends EventEmitter {
    public stdout: NodeEventEmitter = new EventEmitter();
    public stderr: NodeEventEmitter = new EventEmitter();
  }

  function spawnMock(command: string, args: Array<string>): MockChildProcess {
    calls.push({ command, args });
    const child: MockChildProcess = new MockChildProcess();
    setImmediate(() => {
      (child as unknown as NodeEventEmitter).emit("close", 0, null);
    });
    return child;
  }
  spawnMock.__calls = calls;

  return { spawn: spawnMock };
});

import Executor, {
  getJavaScriptSandboxPolicy,
  GLOBAL_RUNNER_JAVASCRIPT_PRIVATE_NETWORK_HINT,
  OWN_RUNNER_JAVASCRIPT_PRIVATE_NETWORK_HINT,
} from "../../Services/RunbookExecutor";
import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import SSHExecutor from "../../Services/SSHExecutor";
import KubernetesExecutor from "../../Services/KubernetesExecutor";
import KubectlExecutor from "../../Services/KubectlExecutor";
import GlobalRunnerMode from "../../Utils/GlobalRunnerMode";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import { spawn } from "child_process";

const spawnCalls: Array<{ command: string; args: Array<string> }> = (
  spawn as unknown as {
    __calls: Array<{ command: string; args: Array<string> }>;
  }
).__calls;

const submitJobResult: jest.Mock = AgentClient.submitJobResult as jest.Mock;
const sshExecute: jest.Mock = SSHExecutor.execute as jest.Mock;
const kubernetesExecute: jest.Mock = KubernetesExecutor.execute as jest.Mock;
const kubectlExecute: jest.Mock = KubectlExecutor.execute as jest.Mock;
const runCodeInSandbox: jest.Mock = VMUtil.runCodeInSandbox as jest.Mock;

function job(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "job-1",
    stepId: "step-1",
    origin: "Runbook",
    stepType: "JavaScript",
    script: "return 'ok';",
    timeoutInMs: 5_000,
    ...overrides,
  } as ClaimedJob;
}

function submittedResult(): Record<string, unknown> {
  expect(submitJobResult).toHaveBeenCalledTimes(1);
  return submitJobResult.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  spawnCalls.length = 0;
  submitJobResult.mockClear();
  submitJobResult.mockResolvedValue(true);
  sshExecute.mockReset();
  kubernetesExecute.mockReset();
  kubectlExecute.mockReset();
  runCodeInSandbox.mockReset();
  runCodeInSandbox.mockResolvedValue({
    returnValue: "ok",
    logMessages: [],
  });
  GlobalRunnerMode.setFromServer(true);
  jest.spyOn(RunnerCapabilities, "resolve").mockReturnValue({
    canRunRunbooks: true,
    canRunCodeFixTasks: false,
    canRunAiCommands: true,
  });
});

afterEach(() => {
  GlobalRunnerMode.reset();
  jest.restoreAllMocks();
});

describe("on a global Runner", () => {
  test.each([
    [
      "a runbook Bash step",
      { stepType: "Bash", script: "cat /proc/1/environ" },
    ],
    [
      "a runbook SSH step",
      {
        stepType: "SSH",
        script: "",
        payload: { command: "id" },
        credential: { hostname: "h", username: "u", privateKey: "k" },
      },
    ],
    [
      "a runbook Kubernetes step",
      {
        stepType: "Kubernetes",
        script: "",
        payload: { action: "RestartWorkload" },
        credential: { apiServerUrl: "https://k", token: "t" },
      },
    ],
    [
      "a kubectl command",
      { stepType: "Kubectl", script: "", payload: { argv: ["get", "pods"] } },
    ],
  ])(
    "%s is refused, and nothing is started",
    async (_label: string, overrides: Record<string, unknown>) => {
      await Executor.executeAndReport(job(overrides as Partial<ClaimedJob>));

      const result: Record<string, unknown> = submittedResult();

      expect(result["success"]).toBe(false);
      expect(result["errorMessage"]).toContain("This is a global Runner");
      expect(result["errorMessage"]).toContain(
        `never ${String(overrides["stepType"])} steps`,
      );
      expect(spawnCalls).toHaveLength(0);
      expect(sshExecute).not.toHaveBeenCalled();
      expect(kubernetesExecute).not.toHaveBeenCalled();
      expect(kubectlExecute).not.toHaveBeenCalled();
      expect(runCodeInSandbox).not.toHaveBeenCalled();
    },
  );

  test.each(["AiRemediation", "AiInvestigation"])(
    "a %s command is refused, even as JavaScript",
    async (origin: string) => {
      await Executor.executeAndReport(job({ origin }));

      const result: Record<string, unknown> = submittedResult();

      expect(result["success"]).toBe(false);
      expect(result["errorMessage"]).toContain(
        "never commands composed by OneUptime AI",
      );
      expect(runCodeInSandbox).not.toHaveBeenCalled();
    },
  );

  test("a job carrying a credential is refused", async () => {
    await Executor.executeAndReport(
      job({ credential: { password: "someone's" } }),
    );

    const result: Record<string, unknown> = submittedResult();

    expect(result["success"]).toBe(false);
    expect(result["errorMessage"]).toContain("never handed a credential");
    expect(runCodeInSandbox).not.toHaveBeenCalled();
  });

  test("a JavaScript step runs in the sandbox, on the strict egress policy, said authoritatively", async () => {
    await Executor.executeAndReport(
      job({ inputs: { host: "web-1" }, trigger: "Webhook" }),
    );

    expect(runCodeInSandbox).toHaveBeenCalledTimes(1);

    const call: {
      code: string;
      options: Record<string, unknown>;
    } = runCodeInSandbox.mock.calls[0]![0] as {
      code: string;
      options: Record<string, unknown>;
    };

    expect(call.code).toBe("return 'ok';");
    expect(call.options["timeout"]).toBe(5_000);
    expect(call.options["allowPrivateNetworkRequests"]).toBe(false);
    expect(call.options["privateNetworkAccessIsAllowed"]).toBe(false);
    expect(call.options["includeResolutionDetailInError"]).toBe(false);
    expect(String(call.options["privateNetworkHint"])).toContain(
      "Global Runners reach the internet only",
    );
    // The run's inputs, as data, as on any Runner.
    expect(call.options["args"]).toBeDefined();

    expect(submittedResult()["success"]).toBe(true);
    expect(spawnCalls).toHaveLength(0);
  });
});

describe("negative control: a project's own Runner", () => {
  beforeEach(() => {
    GlobalRunnerMode.setFromServer(false);
  });

  test("runs a Bash step as before", async () => {
    await Executor.executeAndReport(
      job({ stepType: "Bash", script: "uptime" }),
    );

    expect(spawnCalls).toHaveLength(1);
    expect(submittedResult()["success"]).toBe(true);
  });

  test("runs a JavaScript step with the sandbox's own default policy, nothing widened for it", async () => {
    await Executor.executeAndReport(job());

    const options: Record<string, unknown> = (
      runCodeInSandbox.mock.calls[0]![0] as {
        options: Record<string, unknown>;
      }
    ).options;

    expect(options).not.toHaveProperty("allowPrivateNetworkRequests");
    expect(options).not.toHaveProperty("privateNetworkAccessIsAllowed");
    expect(options).not.toHaveProperty("includeResolutionDetailInError");
  });
});

describe("getJavaScriptSandboxPolicy", () => {
  test("on a project's own Runner, asks for nothing more than the sandbox's strict default, and says to use a Bash step", () => {
    GlobalRunnerMode.setFromServer(false);

    expect(getJavaScriptSandboxPolicy()).toEqual({
      privateNetworkHint:
        " A JavaScript step reaches public addresses only. Use a Bash step to call an address on this Runner's network.",
    });
  });

  test("on a global Runner, refuses private networks and keeps DNS answers out", () => {
    GlobalRunnerMode.setFromServer(true);

    expect(getJavaScriptSandboxPolicy()).toEqual({
      allowPrivateNetworkRequests: false,
      privateNetworkAccessIsAllowed: false,
      privateNetworkHint:
        " Global Runners reach the internet only, and so do JavaScript steps on your own Runners. Use a Bash step on one of your own Runners to call an address on your network.",
      includeResolutionDetailInError: false,
    });
  });

  /*
   * Issue #6589: a refusal must not send anyone to change something that
   * changes nothing. No Runner reads the API server's webhook settings, and
   * picking another Runner does not widen a JavaScript step's sandbox.
   */
  test.each([
    ["a project's own Runner", false],
    ["a global Runner", true],
  ])(
    "on %s, names no setting and never suggests another Runner for the JavaScript step",
    (_name: string, isGlobal: boolean) => {
      GlobalRunnerMode.setFromServer(isGlobal);

      const hint: string = String(
        getJavaScriptSandboxPolicy().privateNetworkHint,
      );

      expect(hint.startsWith(" ")).toBe(true);
      expect(hint).toContain("Bash step");
      expect(hint).not.toMatch(/ALLOW_PRIVATE_NETWORK|ALLOWLIST|PROBE_/);
      expect(hint).not.toContain("Pick one of your own Runners for a step");
    },
  );

  test("the exported hints are the ones each Runner hands the sandbox", () => {
    GlobalRunnerMode.setFromServer(false);
    expect(getJavaScriptSandboxPolicy().privateNetworkHint).toBe(
      OWN_RUNNER_JAVASCRIPT_PRIVATE_NETWORK_HINT,
    );

    GlobalRunnerMode.setFromServer(true);
    expect(getJavaScriptSandboxPolicy().privateNetworkHint).toBe(
      GLOBAL_RUNNER_JAVASCRIPT_PRIVATE_NETWORK_HINT,
    );
  });
});
