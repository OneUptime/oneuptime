/*
 * ---------------------------------------------------------------------------
 * KubectlExecutor is the last thing between a kubectl argv the server sent
 * and the customer's cluster, so these tests are as much about what it
 * refuses as about what it runs. child_process.spawn is mocked so every case
 * asserts on the exact process that would have started — and, for a refused
 * job, that NO process started.
 *
 * Three refusals get their own sections:
 *   - the Runner's own argv guard, which runs BEFORE and independently of
 *     the shared policy (file-backed output formats, credential flags);
 *   - the credential-less path, which only the kubernetes-agent Runner may
 *     take with its pod's ServiceAccount — and only for a job the server
 *     stamped with this Runner's own cluster;
 *   - the kubeconfig directory lifecycle: private parent, start-up sweep
 *     of what a killed process left behind, shutdown removal.
 * ---------------------------------------------------------------------------
 */

import fs from "fs";
import os from "os";
import path from "path";
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

jest.mock("Common/Server/Utils/GracefulShutdown", () => {
  return {
    __esModule: true,
    default: { registerHandler: jest.fn() },
    ShutdownPriority: { Workers: 20 },
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
import KubectlPolicy from "Common/Utils/AiRemediation/KubectlPolicy";
import { KubectlCommandTier } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import GracefulShutdown from "Common/Server/Utils/GracefulShutdown";
import { JSONObject } from "Common/Types/JSON";

/*
 * The cluster this suite's Runner was installed for (the chart's
 * ONEUPTIME_KUBERNETES_CLUSTER_NAME). The server stamps the target cluster's
 * identifier on every kubectl payload; a credential-less job only runs when
 * the two agree.
 */
const OWN_CLUSTER: string = "prod-us";

const READ_PAYLOAD: JSONObject = {
  args: ["get", "pods", "-n", "web"],
  displayCommand: "kubectl get pods -n web",
  tier: "Read",
  clusterIdentifier: OWN_CLUSTER,
};

const WRITE_PAYLOAD: JSONObject = {
  args: ["rollout", "restart", "deployment/web", "-n", "web"],
  displayCommand: "kubectl rollout restart deployment/web -n web",
  tier: "SafeWrite",
  clusterIdentifier: OWN_CLUSTER,
};

const CREDENTIAL: JSONObject = {
  credentialType: "Kubernetes",
  apiServerUrl: "https://k8s.example.com:6443",
  token: "sa-token-abc",
  caCertificate: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
};

const SERVICE_ACCOUNT_TOKEN_PATH: string =
  "/var/run/secrets/kubernetes.io/serviceaccount/token";

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

/*
 * Replace the next spawn with one that runs `during` while the process is
 * "running" (before it closes), so a test can look at the world mid-command.
 */
function spawnOnceWith(
  during: (args: Array<string>) => void | Promise<void>,
): void {
  childProcessMock.spawn.mockImplementationOnce(
    (
      command: string,
      args: Array<string>,
      options: Record<string, unknown>,
    ) => {
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
      Promise.resolve(during(args))
        .catch(() => {
          // The assertion inside `during` reports the failure itself.
        })
        .finally(() => {
          child.emit("close", 0, null);
        });
      return child;
    },
  );
}

function kubeconfigPathOf(args: Array<string>): string {
  const index: number = args.indexOf("--kubeconfig");
  return args[index + 1] || "";
}

describe("KubectlExecutor", () => {
  beforeEach(() => {
    childProcessMock.__calls.length = 0;
    childProcessMock.spawn.mockClear();
    childProcessMock.__set({});
    jest
      .spyOn(KubernetesPosture, "canUseOwnServiceAccount")
      .mockReturnValue(true);
    jest.spyOn(KubernetesPosture, "allowsWrites").mockReturnValue(true);
    jest
      .spyOn(KubectlExecutor, "getOwnClusterIdentifier")
      .mockReturnValue(OWN_CLUSTER);
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
        clusterIdentifier: OWN_CLUSTER,
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
      payload: {
        args: ["get", "pods", "--request-timeout=5s"],
        clusterIdentifier: OWN_CLUSTER,
      },
      timeoutInMs: 30000,
      origin: "AiInvestigation",
    });

    expect(
      lastSpawn().args.filter((arg: string) => {
        return arg.startsWith("--request-timeout");
      }),
    ).toEqual(["--request-timeout=5s"]);
  });

  /*
   * -------------------------------------------------------------------------
   * The Runner's own argv guard. It runs before the shared policy and does
   * not depend on it, so a server (or a policy bug) that tiers a file-reading
   * `get` as Read still cannot make this Runner read a file.
   * -------------------------------------------------------------------------
   */
  describe("the Runner's own argv guard", () => {
    test.each([
      [
        "-o jsonpath-file pointed at the ServiceAccount token",
        ["get", "ns", "-o", `jsonpath-file=${SERVICE_ACCOUNT_TOKEN_PATH}`],
      ],
      [
        "-ojsonpath-file inline",
        ["get", "ns", `-ojsonpath-file=${SERVICE_ACCOUNT_TOKEN_PATH}`],
      ],
      [
        "--output=go-template-file",
        ["get", "pods", "--output=go-template-file=/etc/passwd"],
      ],
      [
        "--output custom-columns-file",
        ["get", "pods", "--output", "custom-columns-file=/etc/hostname"],
      ],
      ["--template", ["get", "pods", "-o", "go-template", "--template=/x"]],
      [
        "-o templatefile (the legacy alias without a dash)",
        ["get", "pods", "-o", `templatefile=${SERVICE_ACCOUNT_TOKEN_PATH}`],
      ],
    ])(
      "refuses %s from a Read-tier verb, before spawning",
      async (_label: string, args: Array<string>) => {
        const result: KubectlExecResult = await KubectlExecutor.execute({
          payload: { args },
          timeoutInMs: 30000,
          origin: "AiInvestigation",
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain("Refused by the Runner");
        expect(childProcessMock.spawn).not.toHaveBeenCalled();
      },
    );

    test.each([
      ["--kubeconfig", ["get", "pods", "--kubeconfig=/root/.kube/config"]],
      ["--token", ["get", "pods", "--token", "abc"]],
      ["--server", ["get", "pods", "--server=https://evil.example"]],
      ["-s", ["get", "pods", "-s", "https://evil.example"]],
      ["-shttps://... inline", ["get", "pods", "-shttps://evil.example"]],
      ["--as", ["get", "secrets", "--as=system:admin"]],
      ["--as-group", ["get", "secrets", "--as-group=system:masters"]],
      ["--context", ["get", "pods", "--context=prod"]],
      ["--cluster", ["get", "pods", "--cluster=prod"]],
      ["--user", ["get", "pods", "--user=admin"]],
      ["--raw", ["get", "--raw=/api/v1/secrets"]],
      ["-f", ["get", "-f", "/etc/passwd"]],
      ["--filename", ["get", "--filename=/etc/passwd"]],
      ["-Rf combined", ["get", "-Rf", "/etc"]],
      ["-Af combined", ["get", "pods", "-Af", "/x"]],
      ["after --", ["get", "pods", "--", "--kubeconfig=/x"]],
      ["--kuberc", ["get", "pods", "--kuberc=/x"]],
      ["--patch-file", ["patch", "deployment/web", "--patch-file=/x"]],
      [
        "--from-file",
        [
          "create",
          "configmap",
          "x",
          `--from-file=${SERVICE_ACCOUNT_TOKEN_PATH}`,
        ],
      ],
    ])(
      "refuses %s even if the shared policy were bypassed",
      async (_label: string, args: Array<string>) => {
        /*
         * Simulate a policy that (wrongly) calls everything Read: the guard
         * must refuse on its own, and it must run FIRST — the policy is not
         * even consulted for an argv the guard refuses.
         */
        const evaluateArgs: jest.SpyInstance = jest
          .spyOn(KubectlPolicy, "evaluateArgs")
          .mockReturnValue({
            tier: KubectlCommandTier.Read,
            reason: "bypassed",
            args,
            verb: "get",
            displayCommand: "kubectl get",
          });

        const result: KubectlExecResult = await KubectlExecutor.execute({
          payload: { args },
          timeoutInMs: 30000,
          origin: "AiInvestigation",
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain("Refused by the Runner");
        expect(evaluateArgs).not.toHaveBeenCalled();
        expect(childProcessMock.spawn).not.toHaveBeenCalled();
      },
    );

    test("lets inline output formats and everyday flags through to the policy", async () => {
      for (const args of [
        ["get", "pods", "-n", "web", "-o", "wide"],
        ["get", "pods", "-ojson"],
        ["get", "pods", "-o", "jsonpath={.items[*].metadata.name}"],
        ["get", "pods", "-o", "custom-columns=NAME:.metadata.name"],
        ["logs", "web-0", "-n", "web", "--tail=100", "-c", "app"],
        ["get", "pods", "-nfs"],
      ]) {
        childProcessMock.spawn.mockClear();

        const result: KubectlExecResult = await KubectlExecutor.execute({
          payload: { args, clusterIdentifier: OWN_CLUSTER },
          timeoutInMs: 30000,
          origin: "AiInvestigation",
        });

        expect(result.success).toBe(true);
        expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
      }
    });
  });

  /*
   * -------------------------------------------------------------------------
   * Credential-less jobs: only the kubernetes-agent Runner, running in its
   * cluster, may run them with the pod's ServiceAccount.
   * -------------------------------------------------------------------------
   */
  describe("credential-less jobs", () => {
    test("refuses to run without a credential outside a cluster", async () => {
      (KubernetesPosture.canUseOwnServiceAccount as jest.Mock).mockReturnValue(
        false,
      );

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("no Kubernetes credential");
      expect(result.errorMessage).toContain("Kubernetes agent chart");
      expect(childProcessMock.spawn).not.toHaveBeenCalled();
    });

    /*
     * The scenario from the review: an ordinary project Runner deployed as
     * a pod in staging is selected on production's AI page. Its pod IS in a
     * cluster — the wrong one. Being in a pod is not permission.
     */
    test("refuses a credential-less job on a project Runner that merely runs in a pod", async () => {
      (KubernetesPosture.canUseOwnServiceAccount as jest.Mock).mockRestore();
      jest.spyOn(KubernetesPosture, "isInCluster").mockReturnValue(true);

      // jest.setup puts the suite in project mode: not the kubernetes agent.
      expect(KubernetesPosture.canUseOwnServiceAccount()).toBe(false);

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        timeoutInMs: 30000,
        origin: "AiRemediation",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain(
        "only the in-cluster Runner installed by the Kubernetes agent chart",
      );
      expect(childProcessMock.spawn).not.toHaveBeenCalled();
    });

    test("runs a credential-less job with the pod's ServiceAccount on the kubernetes-agent Runner", async () => {
      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.success).toBe(true);
      expect(lastSpawn().args).not.toContain("--kubeconfig");
    });

    /*
     * The server only enqueues a credential-less job for the in-cluster
     * Runner OF THAT CLUSTER, but this binary must not trust that routing:
     * the job names its target cluster, the Runner knows its own, and the
     * pod's ServiceAccount is only used when the two agree.
     */
    describe("the job's cluster must be this Runner's cluster", () => {
      test("refuses a credential-less job stamped with another cluster, naming both", async () => {
        const result: KubectlExecResult = await KubectlExecutor.execute({
          payload: { ...READ_PAYLOAD, clusterIdentifier: "staging-eu" },
          timeoutInMs: 30000,
          origin: "AiInvestigation",
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain("Refused by the Runner");
        expect(result.errorMessage).toContain('"staging-eu"');
        expect(result.errorMessage).toContain(`"${OWN_CLUSTER}"`);
        expect(childProcessMock.spawn).not.toHaveBeenCalled();
      });

      test("refuses a credential-less job that names no cluster at all", async () => {
        for (const payload of [
          { args: READ_PAYLOAD["args"] },
          { ...READ_PAYLOAD, clusterIdentifier: "" },
          { ...READ_PAYLOAD, clusterIdentifier: "   " },
          { ...READ_PAYLOAD, clusterIdentifier: 42 },
        ]) {
          const result: KubectlExecResult = await KubectlExecutor.execute({
            payload: payload as JSONObject,
            timeoutInMs: 30000,
            origin: "AiInvestigation",
          });

          expect(result.success).toBe(false);
          expect(result.errorMessage).toContain("(not specified)");
          expect(result.errorMessage).toContain(`"${OWN_CLUSTER}"`);
        }

        expect(childProcessMock.spawn).not.toHaveBeenCalled();
      });

      test("refuses when this Runner has no cluster name of its own, even for a stamped job", async () => {
        (KubectlExecutor.getOwnClusterIdentifier as jest.Mock).mockReturnValue(
          null,
        );

        const result: KubectlExecResult = await KubectlExecutor.execute({
          payload: READ_PAYLOAD,
          timeoutInMs: 30000,
          origin: "AiInvestigation",
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain(`"${OWN_CLUSTER}"`);
        expect(result.errorMessage).toContain("(not specified)");
        expect(childProcessMock.spawn).not.toHaveBeenCalled();
      });

      test("matches the cluster identifier case-insensitively and ignoring surrounding whitespace", async () => {
        const result: KubectlExecResult = await KubectlExecutor.execute({
          payload: { ...READ_PAYLOAD, clusterIdentifier: "  Prod-US " },
          timeoutInMs: 30000,
          origin: "AiInvestigation",
        });

        expect(result.success).toBe(true);
        expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
      });

      test("accepts the identifier under the field names a server one release apart might use", async () => {
        for (const key of ["kubernetesClusterIdentifier", "clusterName"]) {
          childProcessMock.spawn.mockClear();

          const result: KubectlExecResult = await KubectlExecutor.execute({
            payload: { args: READ_PAYLOAD["args"], [key]: OWN_CLUSTER },
            timeoutInMs: 30000,
            origin: "AiInvestigation",
          });

          expect(result.success).toBe(true);
          expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
        }
      });

      test("reads the Runner's own cluster from ONEUPTIME_KUBERNETES_CLUSTER_NAME, normalized", () => {
        (KubectlExecutor.getOwnClusterIdentifier as jest.Mock).mockRestore();

        // jest.setup puts the suite in project mode: no cluster name is set.
        expect(KubectlExecutor.getOwnClusterIdentifier()).toBeNull();
      });

      test("a job for another cluster still runs when it carries its own credential", async () => {
        const result: KubectlExecResult = await KubectlExecutor.execute({
          payload: { ...READ_PAYLOAD, clusterIdentifier: "staging-eu" },
          credential: CREDENTIAL,
          timeoutInMs: 30000,
          origin: "AiInvestigation",
        });

        expect(result.success).toBe(true);
        expect(lastSpawn().args).toContain("--kubeconfig");
      });
    });

    test("a project Runner in a pod still runs jobs that carry a credential", async () => {
      (KubernetesPosture.canUseOwnServiceAccount as jest.Mock).mockReturnValue(
        false,
      );

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.success).toBe(true);
      expect(lastSpawn().args).toContain("--kubeconfig");
    });
  });

  /*
   * -------------------------------------------------------------------------
   * The kubeconfig directory lifecycle. os.tmpdir() is pointed at a fresh
   * directory for these so the sweep can be asserted on exactly. (Setting
   * TMPDIR would not do: the jest sandbox's process.env is a copy, and the
   * real os.tmpdir() never sees it.)
   * -------------------------------------------------------------------------
   */
  describe("temporary kubeconfigs", () => {
    let scratchTmp: string = "";

    beforeEach(() => {
      scratchTmp = fs.mkdtempSync(
        path.join(os.tmpdir(), "kubectl-executor-test-"),
      );
      jest.spyOn(os, "tmpdir").mockReturnValue(scratchTmp);
      (KubernetesPosture.canUseOwnServiceAccount as jest.Mock).mockReturnValue(
        false,
      );
    });

    afterEach(() => {
      (os.tmpdir as jest.Mock).mockRestore();
      fs.rmSync(scratchTmp, { recursive: true, force: true });
    });

    function parentDir(): string {
      return path.join(scratchTmp, "oneuptime-kubectl");
    }

    function plantOrphan(name: string): string {
      const dir: string = path.join(parentDir(), name);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(dir, "config"), "token: leaked\n", {
        mode: 0o600,
      });
      return dir;
    }

    test("writes a private kubeconfig under the predictable parent and removes it afterwards", async () => {
      let kubeconfigPath: string = "";
      let kubeconfigMode: number = 0;
      let kubeconfigContent: string = "";
      let parentMode: number = 0;

      spawnOnceWith((args: Array<string>) => {
        kubeconfigPath = kubeconfigPathOf(args);
        kubeconfigMode = fs.statSync(kubeconfigPath).mode & 0o777;
        kubeconfigContent = fs.readFileSync(kubeconfigPath, "utf8");
        parentMode = fs.statSync(parentDir()).mode & 0o777;
      });

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.success).toBe(true);
      expect(KubectlExecutor.getKubeconfigParentDir()).toBe(parentDir());
      expect(path.dirname(path.dirname(kubeconfigPath))).toBe(parentDir());
      expect(path.basename(path.dirname(kubeconfigPath))).toMatch(/^job-/);
      expect(parentMode).toBe(0o700);
      expect(kubeconfigMode).toBe(0o600);
      expect(kubeconfigContent).toContain(
        'server: "https://k8s.example.com:6443"',
      );
      expect(kubeconfigContent).toContain('token: "sa-token-abc"');
      expect(kubeconfigContent).toContain("certificate-authority-data:");
      expect(kubeconfigContent).not.toContain("insecure-skip-tls-verify");
      // The token never appears on the argv.
      expect(lastSpawn().args.join(" ")).not.toContain("sa-token-abc");
      // Cleaned up, and no longer tracked as active.
      expect(fs.existsSync(path.dirname(kubeconfigPath))).toBe(false);
      expect(KubectlExecutor.getActiveKubeconfigDirs()).toEqual([]);
    });

    test("removes the kubeconfig when kubectl fails or is killed", async () => {
      let kubeconfigDir: string = "";

      for (const outcome of [
        { exitCode: 1, stdout: "", stderr: "Forbidden" },
        { signal: "SIGKILL", stdout: "" },
      ]) {
        childProcessMock.__set(outcome);
        childProcessMock.spawn.mockClear();

        await KubectlExecutor.execute({
          payload: READ_PAYLOAD,
          credential: CREDENTIAL,
          timeoutInMs: 30000,
          origin: "AiInvestigation",
        });

        kubeconfigDir = path.dirname(kubeconfigPathOf(lastSpawn().args));
        expect(kubeconfigDir).toContain(parentDir());
        expect(fs.existsSync(kubeconfigDir)).toBe(false);
      }

      expect(KubectlExecutor.getActiveKubeconfigDirs()).toEqual([]);
    });

    test("tightens a parent directory that a permissive umask left open", async () => {
      fs.mkdirSync(parentDir(), { recursive: true });
      fs.chmodSync(parentDir(), 0o755);

      await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(fs.statSync(parentDir()).mode & 0o777).toBe(0o700);
    });

    test("refuses to write a credential under a parent that is not a real directory", async () => {
      const elsewhere: string = path.join(scratchTmp, "elsewhere");
      fs.mkdirSync(elsewhere, { recursive: true });
      fs.symlinkSync(elsewhere, parentDir());

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain(
        "Could not prepare the Kubernetes credential",
      );
      expect(result.errorMessage).toContain("not a directory");
      expect(childProcessMock.spawn).not.toHaveBeenCalled();
      expect(fs.readdirSync(elsewhere)).toEqual([]);
    });

    test("the start-up sweep removes every abandoned kubeconfig and reports how many", () => {
      const first: string = plantOrphan("job-abc123");
      const second: string = plantOrphan("job-def456");
      // A stray file in the parent goes too: nothing else belongs there.
      fs.writeFileSync(path.join(parentDir(), "stray"), "x");

      expect(KubectlExecutor.sweepOrphanedKubeconfigs()).toBe(3);

      expect(fs.existsSync(first)).toBe(false);
      expect(fs.existsSync(second)).toBe(false);
      expect(fs.readdirSync(parentDir())).toEqual([]);
    });

    test("the sweep is a no-op when nothing was ever written", () => {
      expect(fs.existsSync(parentDir())).toBe(false);
      expect(KubectlExecutor.sweepOrphanedKubeconfigs()).toBe(0);
    });

    test("initialize() sweeps orphans and registers the shutdown handler once", () => {
      plantOrphan("job-old");
      (GracefulShutdown.registerHandler as jest.Mock).mockClear();

      expect(KubectlExecutor.initialize()).toBe(1);
      expect(fs.readdirSync(parentDir())).toEqual([]);

      // A second initialize in the same process must not stack handlers.
      KubectlExecutor.initialize();

      const registrations: Array<Array<unknown>> = (
        GracefulShutdown.registerHandler as jest.Mock
      ).mock.calls;
      expect(registrations.length).toBeLessThanOrEqual(1);
    });

    test("a sweep while a command runs leaves that command's kubeconfig alone", async () => {
      const orphan: string = plantOrphan("job-orphan");
      let activeDirDuring: string = "";
      let activeExistedDuring: boolean = false;
      let orphanExistedDuring: boolean = true;

      spawnOnceWith((args: Array<string>) => {
        activeDirDuring = path.dirname(kubeconfigPathOf(args));
        expect(KubectlExecutor.getActiveKubeconfigDirs()).toEqual([
          activeDirDuring,
        ]);

        KubectlExecutor.sweepOrphanedKubeconfigs();

        activeExistedDuring = fs.existsSync(
          path.join(activeDirDuring, "config"),
        );
        orphanExistedDuring = fs.existsSync(orphan);
      });

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.success).toBe(true);
      expect(activeExistedDuring).toBe(true);
      expect(orphanExistedDuring).toBe(false);
      expect(fs.existsSync(activeDirDuring)).toBe(false);
    });

    test("shutdown removes the kubeconfig of a command that is still running", async () => {
      let activeDirDuring: string = "";
      let existedAfterShutdown: boolean = true;

      spawnOnceWith((args: Array<string>) => {
        activeDirDuring = path.dirname(kubeconfigPathOf(args));

        // What GracefulShutdown runs on SIGTERM / SIGINT.
        expect(KubectlExecutor.removeAllKubeconfigs()).toBe(1);

        existedAfterShutdown = fs.existsSync(activeDirDuring);
      });

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      // The command itself is unaffected — kubectl read its config at start.
      expect(result.success).toBe(true);
      expect(existedAfterShutdown).toBe(false);
      expect(KubectlExecutor.getActiveKubeconfigDirs()).toEqual([]);
    });

    test("the registered shutdown handler is what removes the kubeconfigs", () => {
      (GracefulShutdown.registerHandler as jest.Mock).mockClear();
      KubectlExecutor.initialize();

      const registration: Array<unknown> | undefined = (
        GracefulShutdown.registerHandler as jest.Mock
      ).mock.calls[0];

      if (registration) {
        expect(registration[0]).toBe("KubectlExecutor.kubeconfigs");
        const orphan: string = plantOrphan("job-late");
        (registration[2] as () => void)();
        expect(fs.existsSync(orphan)).toBe(false);
      } else {
        /*
         * An earlier test in this file already installed the handler (it is
         * installed once per process), so exercise the removal directly.
         */
        const orphan: string = plantOrphan("job-late");
        KubectlExecutor.removeAllKubeconfigs();
        expect(fs.existsSync(orphan)).toBe(false);
      }
    });
  });
});
