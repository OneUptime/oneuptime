/*
 * ---------------------------------------------------------------------------
 * The Runner's half of the SSH step (issue #3209).
 *
 * The bug that broke SSH lived on the server — RunnerJob.script was a required
 * column, so a job whose script is empty by design could never be created. But
 * the shape that made it empty is the Runner's contract too: an SSH job is an
 * empty script plus a payload plus a credential resolved at claim time, and
 * the Runner routes on stepType, NOT on whether a script is present. If that
 * routing ever fell back to "no script, nothing to do", SSH steps would report
 * success without touching the host — a worse failure than the one reported,
 * because it is silent.
 *
 * So these tests pin the routing seam: which executor a claimed job reaches,
 * with which arguments, and what happens when a piece is missing. runJob is
 * not exported, so every case drives Executor.executeAndReport — the real
 * exported surface — with the collaborators module-mocked. bash is mocked too,
 * so "an SSH job never spawns a local shell" is assertable directly rather
 * than inferred from a result.
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

jest.mock("child_process", () => {
  /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
  const { EventEmitter } = require("events");
  /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

  const calls: Array<Record<string, unknown>> = [];

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
      (child as unknown as NodeEventEmitter).emit("close", 0, null);
    });
    return child;
  }
  spawnMock.__calls = calls;
  spawnMock.__reset = (): void => {
    calls.length = 0;
  };

  return { spawn: spawnMock };
});

// Imported after the jest.mock calls above, which jest hoists.
import Executor from "../../Services/RunbookExecutor";
import AgentClient, { ClaimedJob } from "../../Services/RunnerClient";
import SSHExecutor from "../../Services/SSHExecutor";
import KubernetesExecutor from "../../Services/KubernetesExecutor";
import { JSONObject } from "Common/Types/JSON";
import { spawn } from "child_process";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const spawnMock: {
  __calls: Array<Record<string, unknown>>;
  __reset: () => void;
} = spawn as unknown as {
  __calls: Array<Record<string, unknown>>;
  __reset: () => void;
};

const submitJobResult: jest.Mock =
  AgentClient.submitJobResult as unknown as jest.Mock;
const sshExecute: jest.Mock = SSHExecutor.execute as unknown as jest.Mock;
const kubernetesExecute: jest.Mock =
  KubernetesExecutor.execute as unknown as jest.Mock;

const SSH_PAYLOAD: JSONObject = {
  credentialId: "55555555-5555-4555-8555-555555555555",
  command: "systemctl restart nginx",
};

/*
 * What the claim endpoint hands back for an SSH job: hostname, user and key
 * material resolved server-side, scoped to this Runner. Never read from the
 * job row.
 */
const SSH_CREDENTIAL: JSONObject = {
  credentialType: "SSH",
  hostname: "db-primary.internal",
  port: 22,
  username: "deploy",
  privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nnot-a-real-key\n",
};

/*
 * The exact wire shape of a claimed SSH job — an empty script, because the
 * instruction is in the payload. This is the shape #3209 made impossible to
 * create; the Runner has to handle it as the normal case, not an edge one.
 */
function sshJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    jobId: "job-ssh-1",
    stepId: "step-1",
    origin: "Runbook",
    stepType: "SSH",
    script: "",
    payload: SSH_PAYLOAD,
    credential: SSH_CREDENTIAL,
    timeoutInMs: 30_000,
    ...overrides,
  } as ClaimedJob;
}

function submittedResult(): Record<string, unknown> {
  expect(submitJobResult).toHaveBeenCalledTimes(1);
  return submitJobResult.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  spawnMock.__reset();
  submitJobResult.mockClear();
  submitJobResult.mockResolvedValue(true);
  sshExecute.mockClear();
  sshExecute.mockResolvedValue({
    success: true,
    output: "nginx restarted",
    exitCode: 0,
  });
  kubernetesExecute.mockClear();
  kubernetesExecute.mockResolvedValue({ success: true, output: "restarted" });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a claimed SSH job reaches SSHExecutor", () => {
  test("an empty script is routed on stepType, not treated as nothing to do", async () => {
    await Executor.executeAndReport(sshJob());

    expect(sshExecute).toHaveBeenCalledTimes(1);
    // The step acts on a remote host: no local shell is involved at any point.
    expect(spawnMock.__calls).toHaveLength(0);
  });

  test("the payload and the claim-time credential are forwarded verbatim", async () => {
    await Executor.executeAndReport(sshJob());

    const args: Record<string, unknown> = sshExecute.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(args["payload"]).toEqual(SSH_PAYLOAD);
    expect(args["credential"]).toEqual(SSH_CREDENTIAL);
    expect(args["timeoutInMs"]).toBe(30_000);
  });

  test("a successful run is reported back with its output", async () => {
    await Executor.executeAndReport(sshJob());

    const result: Record<string, unknown> = submittedResult();

    expect(result["jobId"]).toBe("job-ssh-1");
    expect(result["success"]).toBe(true);
    expect(result["output"]).toBe("nginx restarted");
    expect(result["exitCode"]).toBe(0);
  });

  test("a failed run reports the executor's error rather than swallowing it", async () => {
    sshExecute.mockResolvedValue({
      success: false,
      output: "Permission denied (publickey).",
      exitCode: 255,
      errorMessage: "All configured authentication methods failed",
    });

    await Executor.executeAndReport(sshJob());

    const result: Record<string, unknown> = submittedResult();

    expect(result["success"]).toBe(false);
    expect(result["errorMessage"]).toBe(
      "All configured authentication methods failed",
    );
    expect(result["output"]).toBe("Permission denied (publickey).");
    expect(result["exitCode"]).toBe(255);
  });

  test("a throwing executor still lands a failed result instead of stranding the job", async () => {
    /*
     * The job holds a lease. An unreported crash leaves the step waiting for
     * the lease to lapse and then reporting a timeout, which reads as "the
     * Runner went away" rather than "the SSH library threw".
     */
    sshExecute.mockRejectedValue(new Error("ssh2 exploded"));

    await Executor.executeAndReport(sshJob());

    const result: Record<string, unknown> = submittedResult();

    expect(result["success"]).toBe(false);
    expect(result["errorMessage"]).toContain("ssh2 exploded");
  });
});

describe("an SSH job that arrives incomplete is refused, not attempted", () => {
  test("no credential — the server declined to hand one over", async () => {
    /*
     * A refusal, not a retry: the claim path fails the job itself when a
     * credential is unavailable, so a job that reaches here without one is a
     * server-side decision the Runner must not work around.
     */
    await Executor.executeAndReport(
      sshJob({ credential: undefined as unknown as JSONObject }),
    );

    expect(sshExecute).not.toHaveBeenCalled();

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(false);
    expect(String(result["errorMessage"])).toContain("credential");
  });

  test("no payload — the instruction never arrived", async () => {
    await Executor.executeAndReport(
      sshJob({ payload: undefined as unknown as JSONObject }),
    );

    expect(sshExecute).not.toHaveBeenCalled();

    const result: Record<string, unknown> = submittedResult();
    expect(result["success"]).toBe(false);
    expect(String(result["errorMessage"])).toContain("instructions");
  });

  test("neither payload nor credential names the instructions first", async () => {
    await Executor.executeAndReport(
      sshJob({
        payload: undefined as unknown as JSONObject,
        credential: undefined as unknown as JSONObject,
      }),
    );

    expect(sshExecute).not.toHaveBeenCalled();
    expect(String(submittedResult()["errorMessage"])).toContain("instructions");
  });
});

describe("the other lanes still route where they belong", () => {
  test("a Kubernetes job — same empty-script shape — reaches KubernetesExecutor", async () => {
    await Executor.executeAndReport(
      sshJob({
        jobId: "job-k8s-1",
        stepType: "Kubernetes",
        payload: {
          credentialId: SSH_PAYLOAD["credentialId"] as string,
          action: "RestartWorkload",
          workloadKind: "Deployment",
          namespace: "production",
          workloadName: "api",
        },
        credential: { credentialType: "Kubernetes", token: "not-a-real-token" },
      }),
    );

    expect(kubernetesExecute).toHaveBeenCalledTimes(1);
    expect(sshExecute).not.toHaveBeenCalled();
    expect(spawnMock.__calls).toHaveLength(0);
  });

  test("a Bash job runs locally and never reaches the SSH executor", async () => {
    await Executor.executeAndReport(
      sshJob({
        jobId: "job-bash-1",
        stepType: "Bash",
        script: "uptime",
        payload: undefined as unknown as JSONObject,
        credential: undefined as unknown as JSONObject,
      }),
    );

    expect(sshExecute).not.toHaveBeenCalled();
    expect(spawnMock.__calls).toHaveLength(1);
    expect(spawnMock.__calls[0]!["command"]).toBe("bash");
  });

  test("an unknown step type is refused rather than guessed at", async () => {
    await Executor.executeAndReport(
      sshJob({ stepType: "Telnet" as ClaimedJob["stepType"] }),
    );

    expect(sshExecute).not.toHaveBeenCalled();
    expect(kubernetesExecute).not.toHaveBeenCalled();
    expect(spawnMock.__calls).toHaveLength(0);
    expect(String(submittedResult()["errorMessage"])).toContain(
      "Unsupported step type",
    );
  });
});
