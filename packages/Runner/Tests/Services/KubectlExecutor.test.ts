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
  formatKubectlOutput,
  formatRequestTimeout,
  getRequestTimeoutMs,
} from "../../Services/KubectlExecutor";
import { MAX_OUTPUT_BYTES } from "../../Config";
import KubernetesPosture from "../../Utils/KubernetesPosture";
import KubernetesAgentMode from "../../Utils/KubernetesAgentMode";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "Common/Utils/AiRemediation/KubectlPolicy";
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
    jest.spyOn(KubernetesPosture, "allowsNodeOperations").mockReturnValue(true);
    // No namespace scope unless a test sets one.
    jest.spyOn(KubernetesPosture, "getWriteNamespaces").mockReturnValue([]);
    jest.spyOn(KubernetesPosture, "getPodNamespace").mockReturnValue(null);
    jest
      .spyOn(KubectlExecutor, "getOwnClusterIdentifier")
      .mockReturnValue(OWN_CLUSTER);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The request timeout used to EQUAL the process timeout (30s for a 30s
   * job), so an API server that never answered got kubectl SIGKILLed just
   * before it would have printed "Unable to connect to the server". It now
   * leaves kubectl room to report: 24s of a 30s budget.
   */
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
      "--request-timeout=24s",
      "get",
      "pods",
      "-n",
      "web",
    ]);
    expect(call.options["shell"]).toBeUndefined();
    expect(call.options["stdio"]).toEqual(["ignore", "pipe", "pipe"]);
    expect(call.options["timeout"]).toBe(30000);
    expect(call.options["killSignal"]).toBe("SIGKILL");

    // Minimal environment: no host kubeconfig, no cloud profiles, no kuberc.
    const env: Record<string, string> = call.options["env"] as Record<
      string,
      string
    >;
    expect(env["HOME"]).toBeDefined();
    expect(env["KUBECONFIG"]).toBeUndefined();
    expect(env["AWS_PROFILE"]).toBeUndefined();
    expect(env["KUBERC"]).toBe("off");
    expect(env["KUBECTL_KUBERC"]).toBe("false");
    // kubectl runs in its private HOME, not wherever the Runner happens to be.
    expect(call.options["cwd"]).toBe(env["HOME"]);
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

  test("refuses every write on the Kubernetes agent's Runner installed read-only, pointing at the chart", async () => {
    (KubernetesPosture.allowsWrites as jest.Mock).mockReturnValue(false);
    jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(true);
    jest
      .spyOn(KubernetesPosture, "getAllowWritesSetting")
      .mockReturnValue("false");

    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: WRITE_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiRemediation",
    });

    expect(result.success).toBe(false);
    expect(result.errorMessage).toContain("installed read-only");
    expect(result.errorMessage).toContain("aiAccess.remediation.enabled=true");
    expect(result.errorMessage).toContain(
      'ONEUPTIME_KUBECTL_ALLOW_WRITES="false"',
    );
    expect(childProcessMock.spawn).not.toHaveBeenCalled();

    // Reads still work on a read-only host.
    const read: KubectlExecResult = await KubectlExecutor.execute({
      payload: READ_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiRemediation",
    });
    expect(read.success).toBe(true);
  });

  /*
   * An external Runner has nothing to do with the chart: its operator sets
   * the variable on the host. The refusal used to send them to `helm
   * upgrade` regardless.
   */
  test.each([
    [null, "is not set"],
    ["readonly", 'ONEUPTIME_KUBECTL_ALLOW_WRITES="readonly"'],
  ])(
    "refuses every write on another Runner host (setting %p), documenting the variable instead of the chart",
    async (setting: string | null, shown: string) => {
      (KubernetesPosture.allowsWrites as jest.Mock).mockReturnValue(false);
      jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(false);
      jest
        .spyOn(KubernetesPosture, "getAllowWritesSetting")
        .mockReturnValue(setting);

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: WRITE_PAYLOAD,
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiRemediation",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain(shown);
      expect(result.errorMessage).toContain(
        "ONEUPTIME_KUBECTL_ALLOW_WRITES=true",
      );
      expect(result.errorMessage).not.toContain("aiAccess");
      expect(result.errorMessage).not.toContain("helm");
      expect(result.errorMessage).not.toContain("Upgrade the Kubernetes agent");
      expect(childProcessMock.spawn).not.toHaveBeenCalled();
    },
  );

  test("runs a write for a remediation job when the host allows it", async () => {
    const result: KubectlExecResult = await KubectlExecutor.execute({
      payload: WRITE_PAYLOAD,
      timeoutInMs: 30000,
      origin: "AiRemediation",
    });

    expect(result.success).toBe(true);
    expect(lastSpawn().args).toEqual([
      "--request-timeout=24s",
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
      ["--as-user-extra", ["get", "pods", "--as-user-extra=reason=x"]],
      ["--patch-file", ["patch", "deployment/web", "--patch-file=/x"]],
      /*
       * kubectl reads "_" as "-": with the policy bypassed, the guard alone
       * must stop the token-copy argv spelled with underscores.
       */
      [
        "--from_file (underscore spelling)",
        [
          "create",
          "configmap",
          "x",
          `--from_file=${SERVICE_ACCOUNT_TOKEN_PATH}`,
        ],
      ],
      [
        "--insecure_skip_tls_verify (underscore spelling)",
        ["get", "pods", "--insecure_skip_tls_verify"],
      ],
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
   * Commands the shared policy allows must not be refused by the guard on
   * the Runner — least of all a patch a human already approved.
   * -------------------------------------------------------------------------
   */
  describe("commands the policy allows reach kubectl", () => {
    test.each([
      [
        `kubectl patch deployment web -n web -p'{"spec":{"replicas":3}}'`,
        "AiRemediation",
      ],
      [
        `kubectl patch deployment web -n web -p'{"spec":{"paused":false}}'`,
        "AiRemediation",
      ],
      ["kubectl explain pods --recursive", "AiInvestigation"],
      ["kubectl get pods --all_namespaces", "AiInvestigation"],
    ])("`%s`", async (command: string, origin: string) => {
      const policy: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect(policy.tier).not.toBe(KubectlCommandTier.Denied);

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: { args: policy.args, clusterIdentifier: OWN_CLUSTER },
        timeoutInMs: 30000,
        origin,
      });

      expect(result.errorMessage ?? "").not.toContain("the -s flag");
      expect(result.success).toBe(true);
      expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * -------------------------------------------------------------------------
   * The environment kubectl runs with is a closed allowlist. The host's
   * environment is polluted on purpose here: every variable that could
   * point kubectl at another kubeconfig, a kuberc preferences file, a
   * plugin, a cloud profile or a credential is set, and none may reach it.
   * -------------------------------------------------------------------------
   */
  describe("the environment kubectl runs with", () => {
    const POLLUTED: Record<string, string> = {
      KUBECONFIG: "/root/.kube/config",
      KUBERC: "/tmp/evil-kuberc",
      KUBECTL_KUBERC: "true",
      KUBECTL_ENABLE_CMD_SHADOW: "true",
      KUBECTL_EXTERNAL_DIFF: "sh -c 'curl evil'",
      KUBECTL_COMMAND_HEADERS: "true",
      HOME: "/root",
      KUBECACHEDIR: "/root/.kube/cache",
      AWS_PROFILE: "prod-admin",
      AWS_SECRET_ACCESS_KEY: "aws-secret-value",
      GOOGLE_APPLICATION_CREDENTIALS: "/root/gcp.json",
      AZURE_CLIENT_SECRET: "azure-secret-value",
      SSL_CERT_FILE: "/root/evil-ca.pem",
      NODE_EXTRA_CA_CERTS: "/etc/extra-ca.pem",
      ONEUPTIME_INGESTION_KEY: "ingestion-key-value",
      KUBERNETES_SERVICE_HOST: "10.0.0.1",
      KUBERNETES_SERVICE_PORT: "443",
      KUBERNETES_SERVICE_PORT_HTTPS: "443",
      HTTPS_PROXY: "http://proxy.corp:3128",
      https_proxy: "http://proxy.corp:3128",
      HTTP_PROXY: "http://proxy.corp:3128",
      http_proxy: "http://proxy.corp:3128",
      NO_PROXY: ".corp,10.0.0.0/8",
      no_proxy: ".corp,10.0.0.0/8",
    };

    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
      for (const [key, value] of Object.entries(POLLUTED)) {
        saved[key] = process.env[key];
        process.env[key] = value;
      }
    });

    afterEach(() => {
      for (const key of Object.keys(POLLUTED)) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key];
        }
      }
    });

    function spawnedEnv(): Record<string, string> {
      return lastSpawn().options["env"] as Record<string, string>;
    }

    test("in-cluster: PATH, a private HOME and cache, kuberc off and the service address — nothing else", async () => {
      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });
      expect(result.success).toBe(true);

      const env: Record<string, string> = spawnedEnv();

      expect(Object.keys(env).sort()).toEqual(
        [
          "PATH",
          "HOME",
          "KUBECACHEDIR",
          "KUBERC",
          "KUBECTL_KUBERC",
          "KUBERNETES_SERVICE_HOST",
          "KUBERNETES_SERVICE_PORT",
          "KUBERNETES_SERVICE_PORT_HTTPS",
        ].sort(),
      );
      expect(env["KUBERC"]).toBe("off");
      expect(env["KUBECTL_KUBERC"]).toBe("false");
      expect(env["HOME"]).not.toBe("/root");
      expect(env["HOME"]).toContain(KubectlExecutor.getKubeconfigParentDir());
      expect(env["KUBECACHEDIR"]).not.toBe("/root/.kube/cache");
      expect(env["KUBERNETES_SERVICE_HOST"]).toBe("10.0.0.1");
      // No proxy in-cluster: the API server is the pod's own service.
      expect(env["HTTPS_PROXY"]).toBeUndefined();
      expect(env["https_proxy"]).toBeUndefined();
      expect(env["NO_PROXY"]).toBeUndefined();
      expect(JSON.stringify(env)).not.toContain("secret-value");
      expect(JSON.stringify(env)).not.toContain("ingestion-key-value");
    });

    test("with a credential: the temporary kubeconfig and the host's proxy settings — and no in-cluster fallback", async () => {
      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });
      expect(result.success).toBe(true);

      const env: Record<string, string> = spawnedEnv();

      expect(Object.keys(env).sort()).toEqual(
        [
          "PATH",
          "HOME",
          "KUBECACHEDIR",
          "KUBERC",
          "KUBECTL_KUBERC",
          "KUBECONFIG",
          "HTTPS_PROXY",
          "https_proxy",
          "HTTP_PROXY",
          "http_proxy",
          "NO_PROXY",
          "no_proxy",
        ].sort(),
      );
      // The only kubeconfig kubectl can see is the temporary one on the argv.
      expect(env["KUBECONFIG"]).toBe(kubeconfigPathOf(lastSpawn().args));
      expect(env["KUBECONFIG"]).not.toBe("/root/.kube/config");
      expect(env["HTTPS_PROXY"]).toBe("http://proxy.corp:3128");
      expect(env["NO_PROXY"]).toBe(".corp,10.0.0.0/8");
      expect(env["KUBERNETES_SERVICE_HOST"]).toBeUndefined();
      expect(env["HOME"]).not.toBe("/root");
    });

    test("proxy variables the host does not set are not invented", async () => {
      for (const name of [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "NO_PROXY",
        "no_proxy",
      ]) {
        delete process.env[name];
      }

      await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      const env: Record<string, string> = spawnedEnv();
      expect(Object.prototype.hasOwnProperty.call(env, "HTTPS_PROXY")).toBe(
        false,
      );
      expect(Object.prototype.hasOwnProperty.call(env, "NO_PROXY")).toBe(false);
    });

    /*
     * HOME is where kubectl looks for ~/.kube/config and ~/.kube/kuberc, so
     * it must be a directory nobody else controls — the in-cluster path used
     * to use the pod's shared /tmp.
     */
    test.each([
      ["in-cluster", undefined],
      ["with a credential", CREDENTIAL],
    ])(
      "%s, HOME is a private, empty directory for this command alone",
      async (_label: string, credential: JSONObject | undefined) => {
        let homeDuring: string = "";
        let homeEntries: Array<string> = ["not read"];
        let homeMode: number = 0;

        spawnOnceWith(() => {
          homeDuring = String(
            (lastSpawn().options["env"] as Record<string, string>)["HOME"],
          );
          homeEntries = fs.readdirSync(homeDuring);
          homeMode = fs.statSync(homeDuring).mode & 0o777;
        });

        const result: KubectlExecResult = await KubectlExecutor.execute({
          payload: READ_PAYLOAD,
          ...(credential ? { credential } : {}),
          timeoutInMs: 30000,
          origin: "AiInvestigation",
        });

        expect(result.success).toBe(true);
        expect(path.basename(path.dirname(homeDuring))).toMatch(/^job-/);
        expect(homeEntries).toEqual([]);
        expect(homeMode).toBe(0o700);
        // Removed with the command.
        expect(fs.existsSync(homeDuring)).toBe(false);
        expect(KubectlExecutor.getActiveKubeconfigDirs()).toEqual([]);
      },
    );
  });

  /*
   * -------------------------------------------------------------------------
   * Timeouts: kubectl must get to say why before it is killed.
   * -------------------------------------------------------------------------
   */
  describe("request timeout and kills", () => {
    test.each([
      [1000, "500ms"],
      [1500, "750ms"],
      [5000, "2s"],
      [10000, "7s"],
      [30000, "24s"],
      [120000, "96s"],
    ])(
      "a %sms job gets --request-timeout=%s",
      async (timeoutInMs: number, expected: string) => {
        await KubectlExecutor.execute({
          payload: READ_PAYLOAD,
          timeoutInMs,
          origin: "AiInvestigation",
        });

        expect(lastSpawn().args[0]).toBe(`--request-timeout=${expected}`);
        expect(lastSpawn().options["timeout"]).toBe(timeoutInMs);
      },
    );

    test("the request timeout is always well inside the process timeout", () => {
      for (
        let timeoutInMs: number = 1000;
        timeoutInMs <= 120_000;
        timeoutInMs += 500
      ) {
        const requestMs: number = getRequestTimeoutMs(timeoutInMs);
        const rendered: string = formatRequestTimeout(requestMs);
        const renderedMs: number = rendered.endsWith("ms")
          ? parseInt(rendered, 10)
          : parseInt(rendered, 10) * 1000;

        expect(renderedMs).toBeLessThan(timeoutInMs);
        expect(renderedMs).toBeGreaterThanOrEqual(
          Math.min(timeoutInMs / 2, timeoutInMs - 1000) - 1000,
        );
        expect(renderedMs).toBeGreaterThan(0);
      }
    });

    test("a kill with no output at all says the API server is probably unreachable, naming it", async () => {
      childProcessMock.__set({ signal: "SIGKILL", stdout: "", stderr: "" });

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        credential: {
          ...CREDENTIAL,
          apiServerUrl: "https://admin:hunter2@k8s.example.com:6443/prefix?x=1",
        },
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("timeout 30000ms");
      expect(result.errorMessage).toContain("unreachable");
      expect(result.errorMessage).toContain("https://k8s.example.com:6443");
      // Only scheme, host and port: never userinfo, a path or a query.
      expect(result.errorMessage).not.toContain("hunter2");
      expect(result.errorMessage).not.toContain("/prefix");
    });

    test("in-cluster, the same kill names the in-cluster API server", async () => {
      childProcessMock.__set({ signal: "SIGKILL", stdout: "", stderr: "" });

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.errorMessage).toContain("unreachable");
      expect(result.errorMessage).toContain("in-cluster");
    });

    test("a kill after some output keeps the plain message and the output", async () => {
      childProcessMock.__set({
        signal: "SIGKILL",
        stdout: "partial table",
        stderr: "",
      });

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.errorMessage).toBe("Killed (timeout 30000ms)");
      expect(result.output).toContain("partial table");
    });
  });

  /*
   * -------------------------------------------------------------------------
   * Output capping keeps kubectl's reason. stdout used to be joined first
   * and the whole text cut at MAX_OUTPUT_BYTES, so a large partial table
   * pushed "Error from server (Forbidden)" out of the output entirely.
   * -------------------------------------------------------------------------
   */
  describe("output capping", () => {
    const FORBIDDEN: string =
      'Error from server (Forbidden): deployments.apps is forbidden: User "system:serviceaccount:x:y" cannot list resource "deployments"';
    // Room for the section headers and the truncation markers.
    const MARKER_ALLOWANCE: number = 200;

    test("a huge stdout is cut and stderr survives intact", async () => {
      childProcessMock.__set({
        exitCode: 1,
        stdout: "x".repeat(120_000),
        stderr: `${FORBIDDEN}\n`,
      });

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain(`[stderr]\n${FORBIDDEN}`);
      expect(result.output).toContain("[output truncated: stdout cut at");
      expect(result.output).toContain("stderr follows");
      expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(
        MAX_OUTPUT_BYTES + MARKER_ALLOWANCE,
      );
      // The reason is on the errorMessage too, so it survives any later cap.
      expect(result.errorMessage).toBe(`Exit code 1: ${FORBIDDEN}`);
    });

    test("a huge stdout with no stderr uses the whole budget and says nothing about stderr", async () => {
      childProcessMock.__set({
        exitCode: 0,
        stdout: "y".repeat(60_000),
        stderr: "",
      });

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.success).toBe(true);
      expect(result.errorMessage).toBeUndefined();
      expect(result.output).not.toContain("[stderr]");
      expect(result.output).not.toContain("stderr follows");
      expect(result.output).toContain("[output truncated: stdout cut at");
      expect(Buffer.byteLength(result.output, "utf8")).toBeGreaterThan(
        MAX_OUTPUT_BYTES - MARKER_ALLOWANCE,
      );
      expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(
        MAX_OUTPUT_BYTES + MARKER_ALLOWANCE,
      );
    });

    test("a huge stderr keeps its tail, where the error is", async () => {
      childProcessMock.__set({
        exitCode: 1,
        stdout: "",
        stderr: `${"w".repeat(20_000)}\n${FORBIDDEN}\n`,
      });

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect(result.output).toContain("[earlier stderr truncated]");
      expect(result.output.endsWith(`${FORBIDDEN}\n`)).toBe(true);
      expect(Buffer.byteLength(result.output, "utf8")).toBeLessThanOrEqual(
        8_000 + MARKER_ALLOWANCE,
      );
      expect(result.errorMessage).toContain("Forbidden");
    });

    test("small outputs keep the familiar layout", () => {
      expect(formatKubectlOutput({ stdout: "a\n", stderr: "b\n" })).toBe(
        "[stdout]\na\n\n[stderr]\nb\n",
      );
      expect(formatKubectlOutput({ stdout: "", stderr: "Forbidden" })).toBe(
        "[stderr]\nForbidden",
      );
      expect(formatKubectlOutput({ stdout: "ok", stderr: "" })).toBe(
        "[stdout]\nok",
      );
      expect(formatKubectlOutput({ stdout: "", stderr: "" })).toBe("");
    });

    test("a long error line is capped on the errorMessage", async () => {
      childProcessMock.__set({
        exitCode: 1,
        stdout: "",
        stderr: `Error: ${"z".repeat(2_000)}`,
      });

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: READ_PAYLOAD,
        timeoutInMs: 30000,
        origin: "AiInvestigation",
      });

      expect((result.errorMessage || "").length).toBeLessThan(600);
      expect(result.errorMessage).toMatch(/^Exit code 1: Error: z+\.\.\.$/);
    });
  });

  /*
   * -------------------------------------------------------------------------
   * The namespace scope on writes — the Runner's own bound, independent of
   * RBAC. patch/update on a workload template is running any image as any
   * ServiceAccount of that namespace, so a write outside the namespaces the
   * chart bound (or into the Runner's own) never spawns. Out-of-scope
   * namespaces here are ordinary ones ("payments"), so the verdict cannot
   * come from the policy's own handling of kube-system.
   * -------------------------------------------------------------------------
   */
  describe("the namespace scope on writes", () => {
    const POD_NAMESPACE: string = "oneuptime-agent";

    beforeEach(() => {
      (KubernetesPosture.getWriteNamespaces as jest.Mock).mockReturnValue([
        "web",
      ]);
      (KubernetesPosture.getPodNamespace as jest.Mock).mockReturnValue(
        POD_NAMESPACE,
      );
    });

    function writePayload(args: Array<string>): JSONObject {
      return { args, clusterIdentifier: OWN_CLUSTER };
    }

    test.each([
      [
        "a scale in another namespace",
        [
          "scale",
          "deployment",
          "payments-api",
          "-n",
          "payments",
          "--replicas=0",
        ],
        "outside the namespaces",
      ],
      [
        "set image with -nX",
        ["set", "image", "deployment/x", "-npayments", "c=attacker/img:1"],
        "outside the namespaces",
      ],
      [
        "patch with --namespace=X",
        ["patch", "pod", "p", "--namespace=payments", "-p", '{"spec":{}}'],
        "outside the namespaces",
      ],
      [
        "a write with no -n (the pod's own namespace in-cluster)",
        ["rollout", "restart", "deployment/oneuptime-agent-kubernetes-agent"],
        "the namespace this Runner itself runs in",
      ],
      [
        "scaling the agent away in its own namespace",
        [
          "scale",
          "deployment",
          "oneuptime-agent-kubernetes-agent",
          "-n",
          POD_NAMESPACE,
          "--replicas=0",
        ],
        "the namespace this Runner itself runs in",
      ],
      [
        "an ambiguous namespace",
        ["rollout", "restart", "deployment/web", "--selector", "-n", "web"],
        "cannot tell for certain",
      ],
    ])(
      "refuses %s before spawning",
      async (_label: string, args: Array<string>, expected: string) => {
        const result: KubectlExecResult = await KubectlExecutor.execute({
          payload: writePayload(args),
          timeoutInMs: 30000,
          origin: "AiRemediation",
        });

        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain("Refused by the Runner");
        expect(result.errorMessage).toContain(expected);
        expect(childProcessMock.spawn).not.toHaveBeenCalled();
      },
    );

    test.each([
      [
        "a write in scope",
        ["rollout", "restart", "deployment/web", "-n", "web"],
      ],
      ["a read anywhere", ["get", "pods", "-n", "payments"]],
      [
        "a read in the Runner's own namespace",
        ["get", "pods", "-n", POD_NAMESPACE],
      ],
      ["a node operation", ["cordon", "node-1"]],
    ])("spawns %s", async (_label: string, args: Array<string>) => {
      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: writePayload(args),
        timeoutInMs: 30000,
        origin: "AiRemediation",
      });

      expect(result.success).toBe(true);
      expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
    });

    test('with a credential, a write with no -n lands in "default" and is refused when that is not listed', async () => {
      (KubernetesPosture.getPodNamespace as jest.Mock).mockReturnValue(null);

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: { args: ["rollout", "restart", "deployment/web"] },
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiRemediation",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain('"default"');
      expect(childProcessMock.spawn).not.toHaveBeenCalled();
    });

    /*
     * Negative control: the same out-of-scope write runs when no scope is
     * configured, so the refusals above come from the scope and nothing else.
     */
    test("without a scope, the same out-of-scope write spawns", async () => {
      (KubernetesPosture.getWriteNamespaces as jest.Mock).mockReturnValue([]);
      (KubernetesPosture.getPodNamespace as jest.Mock).mockReturnValue(null);

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: writePayload([
          "scale",
          "deployment",
          "payments-api",
          "-n",
          "payments",
          "--replicas=0",
        ]),
        timeoutInMs: 30000,
        origin: "AiRemediation",
      });

      expect(result.success).toBe(true);
      expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * -------------------------------------------------------------------------
   * Writes to objects that live outside every namespace, end to end. The
   * scope used to judge them by -n like any other write: a human-approved
   * `label node node-3 disktype=ssd` — which the chart's node role grants —
   * never ran on the in-cluster Runner ("names no namespace, so kubectl
   * would run it in the Runner's own"), while `patch pv ... -n prod` got
   * past a Runner scoped to prod on the strength of a -n kubectl ignores.
   * -------------------------------------------------------------------------
   */
  describe("writes to cluster-scoped objects", () => {
    const POD_NAMESPACE: string = "oneuptime-agent";

    async function run(
      command: string,
      credential?: JSONObject,
    ): Promise<KubectlExecResult> {
      const policy: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect(policy.tier).not.toBe(KubectlCommandTier.Denied);

      return KubectlExecutor.execute({
        payload: { args: policy.args, clusterIdentifier: OWN_CLUSTER },
        credential,
        timeoutInMs: 30000,
        origin: "AiRemediation",
      });
    }

    describe.each([
      ["cluster-wide (the default install)", []],
      ["scoped to web", ["web"]],
    ])(
      "on the in-cluster Runner, %s",
      (_label: string, writeNamespaces: Array<string>) => {
        beforeEach(() => {
          (KubernetesPosture.getWriteNamespaces as jest.Mock).mockReturnValue(
            writeNamespaces,
          );
          (KubernetesPosture.getPodNamespace as jest.Mock).mockReturnValue(
            POD_NAMESPACE,
          );
        });

        test.each([
          "kubectl label node node-3 disktype=ssd",
          "kubectl annotate node node-3 note=x",
          `kubectl patch node node-3 -p '{"spec":{"unschedulable":true}}'`,
          "kubectl cordon node-3",
        ])("an approved `%s` reaches kubectl", async (command: string) => {
          const result: KubectlExecResult = await run(command);

          expect(result.errorMessage).toBeUndefined();
          expect(result.success).toBe(true);
          expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
        });

        // Negative controls: namespaced writes with no -n stay refused.
        test.each([
          "kubectl label pod web-1 app=web",
          "kubectl rollout restart deployment/web",
          `kubectl label namespace ${POD_NAMESPACE} team=a -n web`,
        ])("`%s` is still refused before spawning", async (command: string) => {
          const result: KubectlExecResult = await run(command);

          expect(result.success).toBe(false);
          expect(result.errorMessage).toContain("this Runner itself runs in");
          expect(childProcessMock.spawn).not.toHaveBeenCalled();
        });
      },
    );

    describe("on a credential Runner scoped to prod", () => {
      beforeEach(() => {
        (KubernetesPosture.getWriteNamespaces as jest.Mock).mockReturnValue([
          "prod",
        ]);
        (KubernetesPosture.getPodNamespace as jest.Mock).mockReturnValue(null);
      });

      test.each([
        `kubectl patch pv pv-1 -p '{"spec":{"persistentVolumeReclaimPolicy":"Retain"}}' -n prod`,
        `kubectl patch storageclass standard -p '{"allowVolumeExpansion":true}' -n prod`,
        "kubectl annotate ingressclass nginx note=x -n prod",
      ])(
        "`%s` is refused before spawning, whatever -n says",
        async (command: string) => {
          const result: KubectlExecResult = await run(command, CREDENTIAL);

          expect(result.success).toBe(false);
          expect(result.errorMessage).toContain("cluster-scoped");
          expect(result.errorMessage).not.toContain("-n <namespace>");
          expect(childProcessMock.spawn).not.toHaveBeenCalled();
        },
      );

      test("`label namespace staging ... -n prod` is refused: the Namespace object is staging", async () => {
        const result: KubectlExecResult = await run(
          "kubectl label namespace staging istio-injection=disabled -n prod",
          CREDENTIAL,
        );

        expect(result.success).toBe(false);
        expect(result.errorMessage).toContain('Namespace object "staging"');
        expect(childProcessMock.spawn).not.toHaveBeenCalled();
      });

      // Negative controls: a namespaced write in prod, and prod's own Namespace object.
      test.each([
        `kubectl patch deployment web -n prod -p '{"spec":{"paused":false}}'`,
        "kubectl label namespace prod team=a",
      ])("`%s` spawns", async (command: string) => {
        const result: KubectlExecResult = await run(command, CREDENTIAL);

        expect(result.errorMessage).toBeUndefined();
        expect(result.success).toBe(true);
        expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
      });
    });
  });

  /*
   * -------------------------------------------------------------------------
   * The node switch (ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS).
   * aiAccess.remediation.nodeOperations=false removed the chart's node RBAC
   * but nothing on the Runner knew: an Automatic cluster kept running
   * `kubectl cordon` (SafeWrite) into Forbidden. Nodes are cluster-scoped,
   * so the namespace scope cannot bound them; the node switch does, before
   * kubectl starts.
   * -------------------------------------------------------------------------
   */
  describe("the node switch", () => {
    const NODE_OPERATIONS: Array<string> = [
      "kubectl cordon node-3",
      "kubectl uncordon node-3",
      "kubectl drain node-3 --ignore-daemonsets",
      "kubectl taint nodes node-3 dedicated=ai:NoSchedule",
      "kubectl label node node-3 disktype=ssd",
      "kubectl annotate nodes/node-3 note=x",
      `kubectl patch node node-3 -p '{"spec":{"unschedulable":true}}'`,
      "kubectl label node/node-3 pod/web-1 x=y -n web",
    ];

    async function run(command: string): Promise<KubectlExecResult> {
      const policy: KubectlPolicyResult =
        KubectlPolicy.evaluateCommand(command);
      expect(policy.tier).not.toBe(KubectlCommandTier.Denied);

      return KubectlExecutor.execute({
        payload: { args: policy.args, clusterIdentifier: OWN_CLUSTER },
        timeoutInMs: 30000,
        origin: "AiRemediation",
      });
    }

    describe("off on the Kubernetes agent's Runner", () => {
      beforeEach(() => {
        (KubernetesPosture.allowsNodeOperations as jest.Mock).mockReturnValue(
          false,
        );
        jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(true);
        jest
          .spyOn(KubernetesPosture, "getAllowNodeOperationsSetting")
          .mockReturnValue("false");
      });

      test.each(NODE_OPERATIONS)(
        "`%s` is refused before spawning, pointing at the chart",
        async (command: string) => {
          const result: KubectlExecResult = await run(command);

          expect(result.success).toBe(false);
          expect(result.errorMessage).toContain("node operation");
          expect(result.errorMessage).toContain(
            "aiAccess.remediation.nodeOperations=true",
          );
          expect(result.errorMessage).toContain(
            'ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS="false"',
          );
          expect(childProcessMock.spawn).not.toHaveBeenCalled();
        },
      );

      // Negative controls: everything else still runs.
      test.each([
        "kubectl rollout restart deployment/web -n web",
        "kubectl set image deployment/web web=img:2 -n web",
        "kubectl label pod web-1 app=web -n web",
        "kubectl get nodes",
        "kubectl describe node node-3",
      ])("`%s` still spawns", async (command: string) => {
        const result: KubectlExecResult = await run(command);

        expect(result.errorMessage).toBeUndefined();
        expect(result.success).toBe(true);
        expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
      });
    });

    test("off on another Runner host, the refusal names the variable, not the chart", async () => {
      (KubernetesPosture.allowsNodeOperations as jest.Mock).mockReturnValue(
        false,
      );
      jest.spyOn(KubernetesAgentMode, "isActive").mockReturnValue(false);
      jest
        .spyOn(KubernetesPosture, "getAllowNodeOperationsSetting")
        .mockReturnValue(null);

      const result: KubectlExecResult = await KubectlExecutor.execute({
        payload: { args: ["cordon", "node-3"] },
        credential: CREDENTIAL,
        timeoutInMs: 30000,
        origin: "AiRemediation",
      });

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("is not set");
      expect(result.errorMessage).toContain(
        "ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS=true",
      );
      expect(result.errorMessage).not.toContain("aiAccess");
      expect(childProcessMock.spawn).not.toHaveBeenCalled();
    });

    // Negative control: the same node operations run with the switch on.
    test.each(NODE_OPERATIONS)(
      "`%s` spawns with the switch on",
      async (command: string) => {
        const result: KubectlExecResult = await run(command);

        expect(result.errorMessage).toBeUndefined();
        expect(result.success).toBe(true);
        expect(childProcessMock.spawn).toHaveBeenCalledTimes(1);
      },
    );

    // Writes off refuses first: the node switch is only asked about writes.
    test("a Runner that refuses writes says so, not that nodes are off", async () => {
      (KubernetesPosture.allowsWrites as jest.Mock).mockReturnValue(false);
      (KubernetesPosture.allowsNodeOperations as jest.Mock).mockReturnValue(
        false,
      );

      const result: KubectlExecResult = await run("kubectl cordon node-3");

      expect(result.success).toBe(false);
      expect(result.errorMessage).toContain("kubectl writes");
      expect(result.errorMessage).not.toContain("node operation");
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
