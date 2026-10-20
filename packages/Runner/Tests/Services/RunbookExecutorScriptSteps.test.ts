/*
 * ---------------------------------------------------------------------------
 * The Runner's half of the steps that take a script.
 *
 * A kubectl step is a script now: it arrives as stepType Kubernetes with
 * payload.script and, when the step names one, its kubeconfig as the
 * credential ({ credentialType: "Kubeconfig", kubeconfig }). An SSH step's
 * script arrives in payload.script, beside the key or password the server
 * filled in. A step written before scripts still arrives as it always did.
 * So these pin:
 *
 *   - which executor a claimed job reaches, with what: a kubectl script
 *     goes to KubectlScriptExecutor with its kubeconfig (none: the Runner's
 *     own access) and the run's inputs in its environment; a Kubernetes
 *     step written before scripts still goes to KubernetesExecutor; an SSH
 *     script goes to SSHExecutor, payload and credential as sent;
 *   - a kubectl script handed a credential that is not a kubeconfig is
 *     refused, never run with the Runner's own access - a cluster the step
 *     never named;
 *   - an AI-composed SSH job that carries a script is refused: the command
 *     policy reads commands, never scripts;
 *   - every secret the server filled in (job.secretValues) is hidden in the
 *     output and the error before the result leaves the Runner.
 *
 * Collaborators are module-mocked; every case drives
 * Executor.executeAndReport, the real exported surface.
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

jest.mock("../../Services/KubectlScriptExecutor", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn() },
  };
});

jest.mock("../../Utils/RunnerCapabilities", () => {
  return {
    __esModule: true,
    default: {
      resolve: jest.fn().mockReturnValue({
        canRunRunbooks: true,
        canRunCodeFixTasks: false,
        canRunAiCommands: true,
      }),
    },
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

// Imported after the jest.mock calls above, which jest hoists.
import Executor, {
  getKubeconfigFromCredential,
  redactJobResult,
} from "../../Services/RunbookExecutor";
import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import SSHExecutor from "../../Services/SSHExecutor";
import KubernetesExecutor from "../../Services/KubernetesExecutor";
import KubectlScriptExecutor from "../../Services/KubectlScriptExecutor";
import { JSONObject } from "Common/Types/JSON";
import { REDACTED_SECRET_TEXT } from "Common/Types/Runbook/SecretOutputRedaction";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const submitJobResult: jest.Mock =
  AgentClient.submitJobResult as unknown as jest.Mock;
const sshExecute: jest.Mock = SSHExecutor.execute as unknown as jest.Mock;
const kubernetesExecute: jest.Mock =
  KubernetesExecutor.execute as unknown as jest.Mock;
const kubectlScriptExecute: jest.Mock =
  KubectlScriptExecutor.execute as unknown as jest.Mock;

const KUBECONFIG: string =
  "apiVersion: v1\nkind: Config\nusers:\n- name: ci\n  user:\n    token: kube-token-0123456789abcdef0123456789abcdef\n";

function kubectlJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "job-kubectl-1",
    runbookExecutionId: "run-1",
    stepId: "step-1",
    origin: "Runbook",
    stepType: "Kubernetes",
    script: "",
    payload: {
      script:
        "kubectl rollout restart deployment/checkout-api --namespace checkout",
    },
    credential: { credentialType: "Kubeconfig", kubeconfig: KUBECONFIG },
    timeoutInMs: 30_000,
    ...overrides,
  } as ClaimedJob;
}

function sshScriptJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "job-ssh-1",
    runbookExecutionId: "run-1",
    stepId: "step-2",
    origin: "Runbook",
    stepType: "SSH",
    script: "",
    payload: {
      host: "10.0.4.21",
      username: "deploy",
      port: 22,
      script: "sudo systemctl restart nginx\nsystemctl status nginx",
      command: "sudo systemctl restart nginx\nsystemctl status nginx",
    },
    credential: {
      credentialType: "SSH",
      hostname: "10.0.4.21",
      port: 22,
      username: "deploy",
      password: "hunter2-hunter2",
    },
    timeoutInMs: 30_000,
    ...overrides,
  } as ClaimedJob;
}

function submittedResult(): Record<string, unknown> {
  expect(submitJobResult).toHaveBeenCalledTimes(1);
  return submitJobResult.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  submitJobResult.mockClear();
  submitJobResult.mockResolvedValue(true);
  sshExecute.mockReset();
  sshExecute.mockResolvedValue({ success: true, output: "ok", exitCode: 0 });
  kubernetesExecute.mockReset();
  kubernetesExecute.mockResolvedValue({ success: true, output: "restarted" });
  kubectlScriptExecute.mockReset();
  kubectlScriptExecute.mockResolvedValue({
    success: true,
    output: "[stdout]\ndeployment.apps/checkout-api restarted\n",
    exitCode: 0,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a kubectl step that takes a script", () => {
  test("runs its script with the kubeconfig the server sent", async () => {
    await Executor.executeAndReport(kubectlJob());

    expect(kubernetesExecute).not.toHaveBeenCalled();
    expect(kubectlScriptExecute).toHaveBeenCalledTimes(1);

    const args: Record<string, unknown> = kubectlScriptExecute.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(args["script"]).toBe(
      "kubectl rollout restart deployment/checkout-api --namespace checkout",
    );
    expect(args["kubeconfig"]).toBe(KUBECONFIG);
    expect(args["timeoutInMs"]).toBe(30_000);

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(true);
    expect(result["output"]).toBe(
      "[stdout]\ndeployment.apps/checkout-api restarted\n",
    );
  });

  test("with no kubeconfig, it uses the Runner's own access", async () => {
    await Executor.executeAndReport(kubectlJob({ credential: undefined }));

    const args: Record<string, unknown> = kubectlScriptExecute.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(args["kubeconfig"]).toBe("");
  });

  test("the run's inputs are in its environment, as a Bash step's are", async () => {
    await Executor.executeAndReport(
      kubectlJob({ inputs: { service: "checkout-api" }, trigger: "Webhook" }),
    );

    const environment: NodeJS.ProcessEnv = (
      kubectlScriptExecute.mock.calls[0]![0] as {
        environment: NodeJS.ProcessEnv;
      }
    ).environment;

    expect(environment["ONEUPTIME_INPUT_SERVICE"]).toBe("checkout-api");
  });

  test.each([
    ["an SSH credential", { credentialType: "SSH", hostname: "h" }],
    [
      "a Kubernetes credential of the old kind",
      {
        credentialType: "Kubernetes",
        apiServerUrl: "https://prod.example.com:6443",
        token: "t",
      },
    ],
    [
      "a kubeconfig that is empty",
      { credentialType: "Kubeconfig", kubeconfig: "" },
    ],
  ])(
    "handed %s, it is refused, never run with the Runner's own access",
    async (_label: string, credential: JSONObject) => {
      await Executor.executeAndReport(kubectlJob({ credential }));

      expect(kubectlScriptExecute).not.toHaveBeenCalled();
      expect(kubernetesExecute).not.toHaveBeenCalled();

      const result: Record<string, unknown> = submittedResult();
      expect(result["success"]).toBe(false);
      expect(result["errorMessage"]).toBe(
        "This kubectl step was handed a credential that is not a kubeconfig, so it was not run.",
      );
    },
  );

  test("a Kubernetes step written before scripts still goes to KubernetesExecutor", async () => {
    const payload: JSONObject = {
      credentialId: "55555555-5555-4555-8555-555555555555",
      action: "restart-workload",
      workloadKind: "Deployment",
      namespace: "checkout",
      workloadName: "checkout-api",
    };
    const credential: JSONObject = {
      credentialType: "Kubernetes",
      apiServerUrl: "https://prod.example.com:6443",
      token: "t",
    };

    await Executor.executeAndReport(kubectlJob({ payload, credential }));

    expect(kubectlScriptExecute).not.toHaveBeenCalled();
    expect(kubernetesExecute).toHaveBeenCalledTimes(1);
    expect(
      (kubernetesExecute.mock.calls[0]![0] as { payload: JSONObject }).payload,
    ).toEqual(payload);
  });
});

describe("an SSH step that takes a script", () => {
  test("reaches SSHExecutor with the payload and the credential as sent", async () => {
    const job: ClaimedJob = sshScriptJob();

    await Executor.executeAndReport(job);

    expect(sshExecute).toHaveBeenCalledTimes(1);

    const args: Record<string, unknown> = sshExecute.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(args["payload"]).toEqual(job.payload);
    expect(args["credential"]).toEqual(job.credential);
  });

  test("an AI-composed SSH job that carries a script is refused: the policy reads commands", async () => {
    await Executor.executeAndReport(
      sshScriptJob({ origin: "AiRemediation", runbookExecutionId: undefined }),
    );

    expect(sshExecute).not.toHaveBeenCalled();
    expect(submittedResult()["errorMessage"]).toBe(
      "AI-composed SSH jobs carry a command, never a script.",
    );
  });
});

describe("the secrets a step was handed never leave the Runner in its result", () => {
  test("hidden in the output and the error of a failed SSH step", async () => {
    sshExecute.mockResolvedValue({
      success: false,
      output: "sudo: password for deploy: hunter2-hunter2\nsorry, try again",
      exitCode: 1,
      errorMessage: "auth with hunter2-hunter2 failed",
    });

    await Executor.executeAndReport(
      sshScriptJob({ secretValues: ["hunter2-hunter2"] }),
    );

    const result: Record<string, unknown> = submittedResult();
    expect(result["output"]).toBe(
      `sudo: password for deploy: ${REDACTED_SECRET_TEXT}\nsorry, try again`,
    );
    expect(result["errorMessage"]).toBe(
      `auth with ${REDACTED_SECRET_TEXT} failed`,
    );
    expect(JSON.stringify(result)).not.toContain("hunter2-hunter2");
  });

  test("hidden in what a kubectl script printed of its kubeconfig", async () => {
    kubectlScriptExecute.mockResolvedValue({
      success: true,
      output: `[stdout]\n${KUBECONFIG}`,
      exitCode: 0,
    });

    await Executor.executeAndReport(kubectlJob({ secretValues: [KUBECONFIG] }));

    const output: string = submittedResult()["output"] as string;
    // The value is hidden as it is written, its last line break aside.
    expect(output).toBe(`[stdout]\n${REDACTED_SECRET_TEXT}\n`);
    expect(output).not.toContain("kube-token-0123456789abcdef");
  });

  test("a step handed no secret reports its output as it is", async () => {
    sshExecute.mockResolvedValue({
      success: true,
      output: "hunter2-hunter2 is just text here",
      exitCode: 0,
    });

    await Executor.executeAndReport(sshScriptJob());

    expect(submittedResult()["output"]).toBe(
      "hunter2-hunter2 is just text here",
    );
  });
});

describe("redactJobResult", () => {
  test("leaves a result alone when the job carries no secrets, or no list", () => {
    const result: { success: boolean; output: string } = {
      success: true,
      output: "same",
    };

    expect(redactJobResult(result, {})).toBe(result);
    expect(redactJobResult(result, { secretValues: [] })).toBe(result);
  });

  test("reads only the strings a server sent in the list", () => {
    expect(
      redactJobResult(
        { success: true, output: "token abcd1234" },
        { secretValues: ["abcd1234", 42, null] as unknown as Array<string> },
      ).output,
    ).toBe(`token ${REDACTED_SECRET_TEXT}`);
  });
});

describe("getKubeconfigFromCredential", () => {
  test("reads a kubeconfig credential's kubeconfig, and nothing else", () => {
    expect(
      getKubeconfigFromCredential({
        credentialType: "Kubeconfig",
        kubeconfig: KUBECONFIG,
      }),
    ).toBe(KUBECONFIG);
    expect(
      getKubeconfigFromCredential({
        credentialType: "Kubernetes",
        kubeconfig: KUBECONFIG,
      }),
    ).toBe("");
    expect(getKubeconfigFromCredential(undefined)).toBe("");
    expect(getKubeconfigFromCredential("text")).toBe("");
    expect(
      getKubeconfigFromCredential({
        credentialType: "Kubeconfig",
        kubeconfig: 7,
      }),
    ).toBe("");
  });
});
