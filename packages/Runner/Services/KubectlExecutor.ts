import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { MAX_OUTPUT_BYTES } from "../Config";
import KubernetesPosture from "../Utils/KubernetesPosture";
import { JSONObject } from "Common/Types/JSON";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import { KubectlCommandTier } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "Common/Utils/AiRemediation/KubectlPolicy";

export interface KubectlExecResult {
  success: boolean;
  output: string;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
}

/*
 * Runs ONE kubectl command OneUptime AI composed, as an argv — never through
 * a shell — with the cluster access this Runner was given.
 *
 * Defense in depth, on purpose. The server tiered the argv and refused what
 * it should before enqueueing, but this binary runs on the customer's side
 * of the trust boundary, so it re-runs the same pure policy on the argv it
 * received: a Denied command never spawns, an investigation-origin job may
 * only be Read tier, and a host installed read-only refuses every write —
 * whatever a compromised or misconfigured server sent.
 *
 * Credentials never touch the argv. In-cluster, kubectl reads the pod's own
 * ServiceAccount (the same in-cluster config the Kubernetes agent uses). For
 * an external Runner the server resolved a Kubernetes credential at claim
 * time; it is written to a private temporary kubeconfig for the life of the
 * command and removed afterwards.
 */

const KUBECTL_BINARY: string = "kubectl";

// The API-server-side bound; the process timeout is the outer bound.
const MIN_REQUEST_TIMEOUT_SECONDS: number = 5;

function truncate(s: string): string {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return s;
  }

  return (
    Buffer.from(s, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n... [output truncated]"
  );
}

function hasFlag(args: Array<string>, name: string): boolean {
  return args.some((arg: string) => {
    return arg === `--${name}` || arg.startsWith(`--${name}=`);
  });
}

export default class KubectlExecutor {
  public static async execute(data: {
    payload: JSONObject;
    credential?: JSONObject | undefined;
    timeoutInMs: number;
    origin?: string | undefined;
  }): Promise<KubectlExecResult> {
    const rawArgs: unknown = data.payload["args"];

    if (
      !Array.isArray(rawArgs) ||
      rawArgs.length === 0 ||
      rawArgs.some((arg: unknown) => {
        return typeof arg !== "string";
      })
    ) {
      return {
        success: false,
        output: "",
        errorMessage: "Kubectl job arrived without an argv to run.",
      };
    }

    const args: Array<string> = rawArgs as Array<string>;

    // ---- Policy, re-evaluated here on the argv itself. -----------------

    const policy: KubectlPolicyResult = KubectlPolicy.evaluateArgs(args);

    if (policy.tier === KubectlCommandTier.Denied) {
      return {
        success: false,
        output: "",
        errorMessage: `Refused by the Runner's kubectl policy: ${policy.reason}.`,
      };
    }

    if (
      data.origin === RunnerJobOrigin.AiInvestigation &&
      policy.tier !== KubectlCommandTier.Read
    ) {
      return {
        success: false,
        output: "",
        errorMessage: `Refused by the Runner: an investigation may only run read-only kubectl, and "${policy.displayCommand}" is ${policy.tier}.`,
      };
    }

    if (
      policy.tier !== KubectlCommandTier.Read &&
      !KubernetesPosture.allowsWrites()
    ) {
      return {
        success: false,
        output: "",
        errorMessage:
          "Refused by the Runner: this Runner was installed read-only (ONEUPTIME_KUBECTL_ALLOW_WRITES=false). Upgrade the Kubernetes agent with --set aiAccess.remediation.enabled=true to allow OneUptime AI to change this cluster.",
      };
    }

    // ---- Cluster access. ------------------------------------------------

    let kubeconfigDir: string | null = null;
    const finalArgs: Array<string> = [];

    const apiServerUrl: string = String(
      data.credential?.["apiServerUrl"] || "",
    );
    const token: string = String(data.credential?.["token"] || "");

    if (apiServerUrl && token) {
      try {
        kubeconfigDir = fs.mkdtempSync(
          path.join(os.tmpdir(), "oneuptime-kubectl-"),
        );
        const kubeconfigPath: string = path.join(kubeconfigDir, "config");
        fs.writeFileSync(
          kubeconfigPath,
          KubectlExecutor.buildKubeconfig({
            apiServerUrl,
            token,
            caCertificate: data.credential?.["caCertificate"]
              ? String(data.credential["caCertificate"])
              : undefined,
          }),
          { mode: 0o600 },
        );
        finalArgs.push("--kubeconfig", kubeconfigPath);
      } catch (err) {
        KubectlExecutor.cleanup(kubeconfigDir);
        return {
          success: false,
          output: "",
          errorMessage: `Could not prepare the Kubernetes credential: ${
            err instanceof Error ? err.message : String(err)
          }`,
        };
      }
    } else if (data.credential) {
      return {
        success: false,
        output: "",
        errorMessage:
          "The Kubernetes credential is missing an API server URL or token.",
      };
    } else if (!KubernetesPosture.isInCluster()) {
      return {
        success: false,
        output: "",
        errorMessage:
          "This kubectl command has no Kubernetes credential and this Runner is not running inside a cluster. Bind a Kubernetes credential to this Runner on the cluster's AI page, or install the in-cluster Runner with the Kubernetes agent chart.",
      };
    }

    /*
     * Bound every API call so a hung watch or a slow API server cannot hold
     * the job open past its lease. The outer process timeout still applies.
     */
    if (!hasFlag(args, "request-timeout")) {
      const seconds: number = Math.max(
        MIN_REQUEST_TIMEOUT_SECONDS,
        Math.floor(data.timeoutInMs / 1000),
      );
      finalArgs.push(`--request-timeout=${seconds}s`);
    }

    finalArgs.push(...args);

    try {
      return await KubectlExecutor.spawnKubectl({
        args: finalArgs,
        timeoutInMs: data.timeoutInMs,
        workingDir: kubeconfigDir || os.tmpdir(),
      });
    } finally {
      KubectlExecutor.cleanup(kubeconfigDir);
    }
  }

  /*
   * A minimal kubeconfig for a bearer-token ServiceAccount. The CA, when
   * supplied, verifies the API server; without it kubectl falls back to the
   * host's trust store rather than skipping verification — an operator who
   * omits the CA gets a TLS error, not a silently unauthenticated cluster.
   */
  public static buildKubeconfig(data: {
    apiServerUrl: string;
    token: string;
    caCertificate?: string | undefined;
  }): string {
    const caLine: string = data.caCertificate
      ? `    certificate-authority-data: ${Buffer.from(
          data.caCertificate,
          "utf8",
        ).toString("base64")}\n`
      : "";

    return [
      "apiVersion: v1",
      "kind: Config",
      "clusters:",
      "- name: oneuptime",
      "  cluster:",
      `    server: ${JSON.stringify(data.apiServerUrl)}`,
      caLine.trimEnd(),
      "users:",
      "- name: oneuptime",
      "  user:",
      `    token: ${JSON.stringify(data.token)}`,
      "contexts:",
      "- name: oneuptime",
      "  context:",
      "    cluster: oneuptime",
      "    user: oneuptime",
      "current-context: oneuptime",
      "",
    ]
      .filter((line: string) => {
        return line !== "";
      })
      .join("\n")
      .concat("\n");
  }

  private static spawnKubectl(data: {
    args: Array<string>;
    timeoutInMs: number;
    workingDir: string;
  }): Promise<KubectlExecResult> {
    return new Promise<KubectlExecResult>(
      (resolve: (value: KubectlExecResult) => void) => {
        let stdout: string = "";
        let stderr: string = "";
        let stdoutBytes: number = 0;
        let stderrBytes: number = 0;
        let settled: boolean = false;

        /*
         * A deliberately small environment: kubectl reads KUBECONFIG and a
         * handful of KUBERNETES_* variables from it, and nothing else on
         * this host (cloud CLI profiles, proxies with credentials) should
         * leak into a command the model composed. HOME points at a scratch
         * directory so kubectl never finds ~/.kube/config.
         */
        const env: NodeJS.ProcessEnv = {
          PATH: process.env["PATH"] || "/usr/local/bin:/usr/bin:/bin",
          HOME: data.workingDir,
          KUBECACHEDIR: path.join(data.workingDir, "cache"),
          ...(process.env["KUBERNETES_SERVICE_HOST"]
            ? {
                KUBERNETES_SERVICE_HOST: process.env["KUBERNETES_SERVICE_HOST"],
              }
            : {}),
          ...(process.env["KUBERNETES_SERVICE_PORT"]
            ? {
                KUBERNETES_SERVICE_PORT: process.env["KUBERNETES_SERVICE_PORT"],
              }
            : {}),
          ...(process.env["KUBERNETES_SERVICE_PORT_HTTPS"]
            ? {
                KUBERNETES_SERVICE_PORT_HTTPS:
                  process.env["KUBERNETES_SERVICE_PORT_HTTPS"],
              }
            : {}),
          ...(process.env["NODE_EXTRA_CA_CERTS"]
            ? { NODE_EXTRA_CA_CERTS: process.env["NODE_EXTRA_CA_CERTS"] }
            : {}),
        };

        let child: ReturnType<typeof spawn>;

        try {
          child = spawn(KUBECTL_BINARY, data.args, {
            timeout: data.timeoutInMs,
            killSignal: "SIGKILL",
            // No stdin: kubectl must never wait for input.
            stdio: ["ignore", "pipe", "pipe"],
            env,
            cwd: data.workingDir,
          });
        } catch (err) {
          resolve({
            success: false,
            output: "",
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          return;
        }

        child.stdout?.on("data", (chunk: Buffer) => {
          if (stdoutBytes < MAX_OUTPUT_BYTES) {
            stdoutBytes += chunk.length;
            stdout += chunk.toString("utf8");
          }
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          if (stderrBytes < MAX_OUTPUT_BYTES) {
            stderrBytes += chunk.length;
            stderr += chunk.toString("utf8");
          }
        });

        child.on("error", (err: Error & { code?: string }) => {
          if (settled) {
            return;
          }
          settled = true;
          resolve({
            success: false,
            output: "",
            errorMessage:
              err.code === "ENOENT"
                ? "kubectl is not installed on this Runner. Use the oneuptime/runner image (which bundles kubectl) or install kubectl on the host."
                : err.message,
          });
        });

        child.on("close", (code: number | null, signal: string | null) => {
          if (settled) {
            return;
          }
          settled = true;

          const combined: string = [
            stdout && `[stdout]\n${stdout}`,
            stderr && `[stderr]\n${stderr}`,
          ]
            .filter(Boolean)
            .join("\n");

          if (signal === "SIGKILL") {
            resolve({
              success: false,
              output: truncate(combined),
              errorMessage: `Killed (timeout ${data.timeoutInMs}ms)`,
            });
            return;
          }

          if (code === 0) {
            resolve({ success: true, output: truncate(combined), exitCode: 0 });
            return;
          }

          resolve({
            success: false,
            output: truncate(combined),
            exitCode: code ?? undefined,
            errorMessage: `Exit code ${code ?? "?"}`,
          });
        });
      },
    );
  }

  private static cleanup(dir: string | null): void {
    if (!dir) {
      return;
    }
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort — the directory is private to this process anyway.
    }
  }
}
