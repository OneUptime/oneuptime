/*
 * ---------------------------------------------------------------------------
 * The kubernetes-agent Runner runs kubectl and nothing else.
 *
 * The bug this pins: the agent Runner accepted AI-composed Bash and SSH jobs
 * like any other Runner. Inside the agent pod, `bash -c` reaches the same
 * kubectl and the mounted ServiceAccount token with none of the kubectl
 * safeguards (tiers, never-delete kinds, --all denial, the read-only
 * install switch, the investigation read-only rule) in the way — so
 * `kubectl delete pods --all -n web` as a Bash command ran where the same
 * command as a Kubectl step would have been Denied.
 *
 * Every case drives Executor.executeAndReport with the collaborators
 * module-mocked; bash is a recording mock so the strongest property can be
 * asserted: in agent mode NO process is ever spawned for a non-kubectl job,
 * and the refusal happens before the capability or policy is consulted.
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

  interface SpawnCall {
    command: string;
    args: Array<string>;
  }

  const calls: Array<SpawnCall> = [];

  class MockChildProcess extends EventEmitter {
    public stdout: NodeEventEmitter = new EventEmitter();
    public stderr: NodeEventEmitter = new EventEmitter();
  }

  function spawnMock(command: string, args: Array<string>): MockChildProcess {
    calls.push({ command, args });
    const child: MockChildProcess = new MockChildProcess();
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from("mock stdout"));
      (child as unknown as NodeEventEmitter).emit("close", 0, null);
    });
    return child;
  }
  spawnMock.__calls = calls;

  return { spawn: spawnMock };
});

import Executor from "../../Services/RunbookExecutor";
import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import SSHExecutor from "../../Services/SSHExecutor";
import KubernetesExecutor from "../../Services/KubernetesExecutor";
import KubectlExecutor from "../../Services/KubectlExecutor";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import VMUtil from "Common/Server/Utils/VM/VMAPI";
import { JSONObject } from "Common/Types/JSON";
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
    stepType: "Bash",
    script: "kubectl get pods",
    timeoutInMs: 5_000,
    ...overrides,
  } as ClaimedJob;
}

function submittedResult(): Record<string, unknown> {
  expect(submitJobResult).toHaveBeenCalledTimes(1);
  return submitJobResult.mock.calls[0]![0] as Record<string, unknown>;
}

let resolveCapabilities: jest.SpyInstance;

beforeEach(() => {
  spawnCalls.length = 0;
  submitJobResult.mockClear();
  submitJobResult.mockResolvedValue(true);
  sshExecute.mockReset();
  kubernetesExecute.mockReset();
  kubectlExecute.mockReset();
  kubectlExecute.mockResolvedValue({
    success: true,
    output: "ok",
    exitCode: 0,
  });
  runCodeInSandbox.mockReset();
  jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(true);
  resolveCapabilities = jest
    .spyOn(RunnerCapabilities, "resolve")
    .mockReturnValue({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: true,
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("in kubernetes-agent mode, every non-kubectl job is refused", () => {
  /*
   * The scenario from the review: an AI remediation Bash command that the
   * Bash denylist does not catch, aimed at the agent pod. Refused before the
   * capability or the command policy is looked at, and bash never starts.
   */
  test("an AI remediation Bash command never spawns bash inside the agent pod", async () => {
    await Executor.executeAndReport(
      job({
        origin: "AiRemediation",
        script: "kubectl delete pods --all -n web",
      }),
    );

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(false);
    expect(result["errorMessage"]).toContain("only runs policy-tiered kubectl");
    expect(result["errorMessage"]).toContain("never Bash steps");
    expect(spawnCalls).toHaveLength(0);
    expect(resolveCapabilities).not.toHaveBeenCalled();
  });

  test("reading the ServiceAccount token through bash is refused too", async () => {
    await Executor.executeAndReport(
      job({
        origin: "AiRemediation",
        script: "cat /var/run/secrets/kubernetes.io/serviceaccount/token",
      }),
    );

    expect(submittedResult()["success"]).toBe(false);
    expect(spawnCalls).toHaveLength(0);
  });

  test("an AI remediation SSH command never reaches SSHExecutor", async () => {
    await Executor.executeAndReport(
      job({
        origin: "AiRemediation",
        stepType: "SSH",
        script: "",
        payload: { command: "kubectl get secrets -A" },
        credential: { hostname: "h", username: "u", privateKey: "k" },
      }),
    );

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(false);
    expect(result["errorMessage"]).toContain("never SSH steps");
    expect(sshExecute).not.toHaveBeenCalled();
  });

  test.each([
    ["a runbook Bash step", { origin: "Runbook", stepType: "Bash" }],
    [
      "a runbook JavaScript step",
      { origin: "Runbook", stepType: "JavaScript", script: "return 1;" },
    ],
    [
      "a runbook Kubernetes step",
      {
        origin: "Runbook",
        stepType: "Kubernetes",
        script: "",
        payload: { action: "restart" },
        credential: { kubeconfig: "x" },
      },
    ],
    ["a legacy job with no origin", { stepType: "Bash" }],
    [
      "an investigation Bash job",
      { origin: "AiInvestigation", stepType: "Bash" },
    ],
  ])(
    "%s is refused regardless of origin",
    async (_label: string, overrides: Record<string, unknown>) => {
      await Executor.executeAndReport(job(overrides as Partial<ClaimedJob>));

      const result: Record<string, unknown> = submittedResult();
      expect(result["success"]).toBe(false);
      expect(result["errorMessage"]).toContain(
        "Kubernetes agent's in-cluster Runner",
      );
      expect(result["errorMessage"]).toContain(String(overrides["stepType"]));
      expect(spawnCalls).toHaveLength(0);
      expect(sshExecute).not.toHaveBeenCalled();
      expect(kubernetesExecute).not.toHaveBeenCalled();
      expect(runCodeInSandbox).not.toHaveBeenCalled();
      expect(kubectlExecute).not.toHaveBeenCalled();
    },
  );

  test("the refusal tells the operator where Bash and SSH commands do run", async () => {
    await Executor.executeAndReport(job({ origin: "AiRemediation" }));

    expect(submittedResult()["errorMessage"]).toContain(
      "Runner installed on a host",
    );
  });
});

describe("in kubernetes-agent mode, kubectl jobs still run", () => {
  test.each(["AiInvestigation", "AiRemediation"])(
    "a %s kubectl job is routed to KubectlExecutor",
    async (origin: string) => {
      const payload: JSONObject = {
        args: ["get", "pods", "-n", "web"],
        displayCommand: "kubectl get pods -n web",
        tier: "Read",
      };

      await Executor.executeAndReport(
        job({ origin, stepType: "Kubectl", script: "", payload }),
      );

      expect(kubectlExecute).toHaveBeenCalledTimes(1);
      expect(kubectlExecute.mock.calls[0]![0]).toMatchObject({
        payload,
        origin,
      });
      expect(submittedResult()).toMatchObject({ success: true, output: "ok" });
      expect(spawnCalls).toHaveLength(0);
    },
  );

  test("the kubectl job still goes through the AI-command capability check", async () => {
    resolveCapabilities.mockReturnValue({
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });

    await Executor.executeAndReport(
      job({
        origin: "AiRemediation",
        stepType: "Kubectl",
        script: "",
        payload: { args: ["get", "pods"] },
      }),
    );

    expect(kubectlExecute).not.toHaveBeenCalled();
    expect(submittedResult()["errorMessage"]).toContain(
      "does not accept AI-composed commands",
    );
  });
});

describe("outside kubernetes-agent mode nothing changes", () => {
  beforeEach(() => {
    (KubernetesAgentMode.isActive as jest.Mock).mockReturnValue(false);
  });

  test("a policy-clean AI remediation Bash command still runs on a host Runner", async () => {
    await Executor.executeAndReport(
      job({ origin: "AiRemediation", script: "systemctl restart nginx" }),
    );

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      command: "bash",
      args: ["-c", "systemctl restart nginx"],
    });
    expect(submittedResult()["success"]).toBe(true);
  });

  test("a runbook Bash step still runs", async () => {
    await Executor.executeAndReport(job({ script: "echo hello" }));

    expect(spawnCalls).toHaveLength(1);
    expect(submittedResult()["success"]).toBe(true);
  });
});
