/*
 * ---------------------------------------------------------------------------
 * The Runner's half of the Kubectl step: which executor a claimed kubectl
 * job reaches, with which arguments, and which AI-origin jobs are refused
 * before any executor runs. Every case drives Executor.executeAndReport —
 * the exported surface — with the collaborators module-mocked, and bash
 * mocked so "a kubectl job never spawns a local shell" is asserted directly.
 * ---------------------------------------------------------------------------
 */

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
  return {
    __esModule: true,
    spawn: jest.fn(() => {
      throw new Error("bash must never be spawned for a kubectl job");
    }),
  };
});

import Executor from "../../Services/RunbookExecutor";
import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import KubectlExecutor from "../../Services/KubectlExecutor";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import { JSONObject } from "Common/Types/JSON";

const submitJobResult: jest.Mock = AgentClient.submitJobResult as jest.Mock;
const kubectlExecute: jest.Mock = KubectlExecutor.execute as jest.Mock;

function kubectlJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "job-1",
    origin: "AiInvestigation",
    stepId: "ai-investigation-kubectl-1",
    stepType: "Kubectl",
    script: "",
    timeoutInMs: 30000,
    payload: {
      args: ["get", "pods", "-n", "web"],
      displayCommand: "kubectl get pods -n web",
      tier: "Read",
    },
    ...overrides,
  };
}

function submittedResult(): JSONObject {
  return submitJobResult.mock.calls[0]![0] as JSONObject;
}

describe("RunbookExecutor kubectl routing", () => {
  beforeEach(() => {
    submitJobResult.mockClear();
    kubectlExecute.mockReset();
    kubectlExecute.mockResolvedValue({
      success: true,
      output: "NAME READY",
      exitCode: 0,
    });
    jest.spyOn(RunnerCapabilities, "resolve").mockReturnValue({
      canRunRunbooks: false,
      canRunCodeFixTasks: false,
      canRunAiCommands: true,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("routes a kubectl job to KubectlExecutor with its payload, credential and origin", async () => {
    const credential: JSONObject = {
      credentialType: "Kubernetes",
      apiServerUrl: "https://k8s",
      token: "t",
    };

    await Executor.executeAndReport(kubectlJob({ credential }));

    expect(kubectlExecute).toHaveBeenCalledTimes(1);
    expect(kubectlExecute.mock.calls[0]![0]).toEqual({
      payload: kubectlJob().payload,
      credential,
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });
    expect(submittedResult()).toMatchObject({
      jobId: "job-1",
      success: true,
      output: "NAME READY",
      exitCode: 0,
    });
  });

  test("passes an in-cluster job through without a credential", async () => {
    await Executor.executeAndReport(kubectlJob());

    expect(kubectlExecute).toHaveBeenCalledTimes(1);
    expect(kubectlExecute.mock.calls[0]![0]["credential"]).toBeUndefined();
  });

  test("refuses a kubectl job without instructions", async () => {
    await Executor.executeAndReport(kubectlJob({ payload: undefined }));

    expect(kubectlExecute).not.toHaveBeenCalled();
    expect(submittedResult()).toMatchObject({
      success: false,
      errorMessage: "Kubectl step arrived without its instructions.",
    });
  });

  test("refuses an investigation-origin job that is not kubectl before any executor runs", async () => {
    await Executor.executeAndReport(
      kubectlJob({
        stepType: "Bash",
        script: "kubectl get pods",
        payload: undefined,
      }),
    );

    expect(kubectlExecute).not.toHaveBeenCalled();
    expect(submittedResult()).toMatchObject({ success: false });
    expect(String(submittedResult()["errorMessage"])).toContain(
      "may only run read-only kubectl",
    );
  });

  test("refuses an AI-origin kubectl job when the host declines AI commands", async () => {
    (RunnerCapabilities.resolve as jest.Mock).mockReturnValue({
      canRunRunbooks: true,
      canRunCodeFixTasks: false,
      canRunAiCommands: false,
    });

    await Executor.executeAndReport(kubectlJob({ origin: "AiRemediation" }));

    expect(kubectlExecute).not.toHaveBeenCalled();
    expect(String(submittedResult()["errorMessage"])).toContain(
      "does not accept AI-composed commands",
    );
  });

  test("reports the executor's failure verbatim", async () => {
    kubectlExecute.mockResolvedValue({
      success: false,
      output: "",
      errorMessage: "Refused by the Runner's kubectl policy: x",
    });

    await Executor.executeAndReport(kubectlJob({ origin: "AiRemediation" }));

    expect(submittedResult()).toMatchObject({
      success: false,
      errorMessage: "Refused by the Runner's kubectl policy: x",
    });
  });
});
