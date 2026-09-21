/*
 * ---------------------------------------------------------------------------
 * KubectlExecutor is the last thing between a kubectl argv the server sent
 * and the customer's cluster, so these tests are as much about what it
 * refuses as about what it runs. child_process.spawn is mocked so every case
 * asserts on the exact process that would have started — and, for a refused
 * job, that NO process started.
 * ---------------------------------------------------------------------------
 */

import fs from "fs";
import type { EventEmitter as NodeEventEmitter } from "events";

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
    options: Record<string, unknown>;
  }

  const calls: Array<SpawnCall> = [];
  let nextExitCode: number = 0;
  let nextStdout: string = "ok";
  let nextStderr: string = "";
  let nextError: (Error & { code?: string }) | null = null;
  let nextSignal: string | null = null;

  const spawn: jest.Mock = jest.fn(
    (
      command: string,
      args: Array<string>,
      options: Record<string, unknown>,
    ) => {
      calls.push({ command, args, options });
      const child: NodeEventEmitter & {
        stdout: NodeEventEmitter;
        stderr: NodeEventEmitter;
      } = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
      });
      process.nextTick(() => {
        if (nextError) {
          child.emit("error", nextError);
          return;
        }
        if (nextStdout) {
          child.stdout.emit("data", Buffer.from(nextStdout));
        }
        if (nextStderr) {
          child.stderr.emit("data", Buffer.from(nextStderr));
        }
        child.emit("close", nextSignal ? null : nextExitCode, nextSignal);
      });
      return child;
    },
  );

  return {
    __esModule: true,
    spawn,
    __calls: calls,
    __set: (data: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      error?: (Error & { code?: string }) | null;
      signal?: string | null;
    }): void => {
      nextExitCode = data.exitCode ?? 0;
      nextStdout = data.stdout ?? "ok";
      nextStderr = data.stderr ?? "";
      nextError = data.error ?? null;
      nextSignal = data.signal ?? null;
    },
  };
});

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const childProcessMock: {
  spawn: jest.Mock;
  __calls: Array<{
    command: string;
    args: Array<string>;
    options: Record<string, unknown>;
  }>;
  __set: (data: Record<string, unknown>) => void;
} = require("child_process");
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

import KubectlExecutor, {
  KubectlExecResult,
} from "../../Services/KubectlExecutor";
import KubernetesPosture from "../../Utils/KubernetesPosture";
import { JSONObject } from "Common/Types/JSON";

const READ_PAYLOAD: JSONObject = {
  args: ["get", "pods", "-n", "web"],
  displayCommand: "kubectl get pods -n web",
  tier: "Read",
};

const WRITE_PAYLOAD: JSONObject = {
  args: ["rollout", "restart", "deployment/web", "-n", "web"],
  displayCommand: "kubectl rollout restart deployment/web -n web",
  tier: "SafeWrite",
};

const CREDENTIAL: JSONObject = {
  credentialType: "Kubernetes",
  apiServerUrl: "https://k8s.example.com:6443",
  token: "sa-token-abc",
  caCertificate: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
};

function lastSpawn(): {
  command: string;
  args: Array<string>;
  options: Record<string, unknown>;
} {
  const call:
    | { command: string; args: Array<string>; options: Record<string, unknown> }
    | undefined = childProcessMock.__calls[childProcessMock.__calls.length - 1];
  if (!call) {
    throw new Error("kubectl was never spawned");
  }
  return call;
}

describe("KubectlExecutor", () => {
  beforeEach(() => {
    childProcessMock.__calls.length = 0;
    childProcessMock.spawn.mockClear();
    childProcessMock.__set({});
    jest.spyOn(KubernetesPosture, "isInCluster").mockReturnValue(true);
    jest.spyOn(KubernetesPosture, "allowsWrites").mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("runs the argv as the kubectl binary — never through a shell — with a request timeout", async () => {
    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: READ_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("ok");

    const call: {
      command: string;
      args: Array<string>;
      options: Record<string, unknown>;
    } = lastSpawn();
    expect(call.command).toBe("kubectl");
    expect(call.args).toEqual([
      "--request-timeout=30s",
      "get",
      "pods",
      "-n",
      "web",
    ]);
    expect(call.options["shell"]).toBeUndefined();
    expect(call.options["stdio"]).toEqual(["ignore", "pipe", "pipe"]);
    expect(call.options["timeout"]).toBe(30000);
    expect(call.options["killSignal"]).toBe("SIGKILL");

    // Minimal environment: no host kubeconfig, no cloud profiles.
    const env: Record<string, string> = call.options["env"] as Record<
      string,
      string
    >;
    expect(env["HOME"]).toBeDefined();
    expect(env["KUBECONFIG"]).toBeUndefined();
    expect(env["AWS_PROFILE"]).toBeUndefined();
  });

  test("keeps shell metacharacters as literal argument bytes", async () => {
    await KubectlExecutor.execute({
      payload: {
        args: ["get", "pods", "-l", "app in (web, api); rm -rf /"],
      },
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });

    expect(lastSpawn().args).toContain("app in (web, api); rm -rf /");
  });

  test("refuses a Denied argv before spawning anything", async () => {
    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: { args: ["delete", "namespace", "web"] },
      timeoutInMs: 30000,
      origin: "AiRemediation",
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain(
      "Refused by the Runner's kubectl policy",
    );
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  test("refuses a write for an investigation-origin job even though the server sent it", async () => {
    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: WRITE_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("may only run read-only kubectl");
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  test("refuses every write on a host installed read-only", async () => {
    (KubernetesPosture.allowsWrites as jest.Mock).mockReturnValue(false);

    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: WRITE_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiRemediation",
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("installed read-only");
    expect(result.errorMessage).toContain("aiAccess.remediation.enabled=true");
    expect(childProcessMock.spawn).not.toHaveBeenCalled();

    // Reads still work on a read-only host.
    const read: KubectlExecResult = await KubectlExecutor.execute({
      payload: READ_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiRemediation",
    });
    expect(read.success).toBe(true);
  });

  test("runs a write for a remediation job when the host allows it", async () => {
    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: WRITE_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiRemediation",
    });

    expect(result.success).toBe(true);
    expect(lastSpawn().args).toEqual([
      "--request-timeout=30s",
      "rollout",
      "restart",
      "deployment/web",
      "-n",
      "web",
    ]);
  });

  test("refuses to run without a credential outside a cluster", async () => {
    (KubernetesPosture.isInCluster as jest.Mock).mockReturnValue(false);

    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: READ_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("not running inside a cluster");
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  test("writes a private temporary kubeconfig from the credential and removes it afterwards", async () => {
    (KubernetesPosture.isInCluster as jest.Mock).mockReturnValue(false);

    let kubeconfigPath: string = "";
    let kubeconfigMode: number = 0;
    let kubeconfigContent: string = "";

    const originalSpawn: jest.Mock = childProcessMock.spawn;
    originalSpawn.mockImplementationOnce(
      (
        command: string,
        args: Array<string>,
        options: Record<string, unknown>,
      ) => {
        // Inspect the kubeconfig while the process "runs".
        const index: number = args.indexOf("--kubeconfig");
        kubeconfigPath = args[index + 1] || "";
        kubeconfigMode = fs.statSync(kubeconfigPath).mode & 0o777;
        kubeconfigContent = fs.readFileSync(kubeconfigPath, "utf8");
        childProcessMock.__calls.push({ command, args, options });
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const { EventEmitter } = require("events");
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const child: NodeEventEmitter & {
          stdout: NodeEventEmitter;
          stderr: NodeEventEmitter;
        } = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
        });
        process.nextTick(() => {
          child.emit("close", 0, null);
        });
        return child;
      },
    );

    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: READ_PAYLOAD,
      credential: CREDENTIAL,
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });

    expect(result.success).toBe(true);
    expect(kubeconfigPath).toContain("oneuptime-kubectl-");
    expect(kubeconfigMode).toBe(0o600);
    expect(kubeconfigContent).toContain(
      'server: "https://k8s.example.com:6443"',
    );
    expect(kubeconfigContent).toContain('token: "sa-token-abc"');
    expect(kubeconfigContent).toContain("certificate-authority-data:");
    expect(kubeconfigContent).not.toContain("insecure-skip-tls-verify");
    // The token never appears on the argv.
    expect(lastSpawn().args.join(" ")).not.toContain("sa-token-abc");
    // Cleaned up.
    expect(fs.existsSync(kubeconfigPath)).toBe(false);
  });

  test("refuses a credential with no API server or token", async () => {
    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: READ_PAYLOAD,
      credential: { credentialType: "Kubernetes", apiServerUrl: "" },
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("missing an API server URL or token");
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  test("reports a non-zero exit with stderr, a timeout kill, and a missing binary", async () => {
    childProcessMock.__set({ exitCode: 1, stdout: "", stderr: "Forbidden" });
    const failed: KubectlExecResult = await KubectlExecutor.execute({
      payload: READ_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });
    expect(failed.success).toBe(false);
    expect(failed.exitCode).toBe(1);
    expect(failed.output).toContain("[stderr]\nForbidden");

    childProcessMock.__set({ signal: "SIGKILL", stdout: "" });
    const killed: KubectlExecResult = await KubectlExecutor.execute({
      payload: READ_PAYLOAD,
      timeoutInMs: 1500,
      origin: "AiInvestigation",
    });
    expect(killed.success).toBe(false);
    expect(killed.errorMessage).toContain("timeout 1500ms");

    const enoent: Error & { code?: string } = new Error("spawn kubectl ENOENT");
    enoent.code = "ENOENT";
    childProcessMock.__set({ error: enoent });
    const missing: KubectlExecResult = await KubectlExecutor.execute({
      payload: READ_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });
    expect(missing.success).toBe(false);
    expect(missing.errorMessage).toContain("kubectl is not installed");
  });

  test("rejects a payload with no argv", async () => {
    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: { displayCommand: "kubectl get pods" },
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("without an argv");
    expect(childProcessMock.spawn).not.toHaveBeenCalled();
  });

  test("respects a request timeout the argv already carries", async () => {
    await KubectlExecutor.execute({
      payload: { args: ["get", "pods", "--request-timeout=5s"] },
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });

    expect(
      lastSpawn().args.filter((arg: string) => {
        return arg.startsWith("--request-timeout");
      }),
    ).toEqual(["--request-timeout=5s"]);
  });
});
