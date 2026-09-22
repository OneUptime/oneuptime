import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { KUBERNETES_AGENT_CLUSTER_NAME, MAX_OUTPUT_BYTES } from "../Config";
import KubernetesPosture from "../Utils/KubernetesPosture";
import KubectlArgvGuard from "../Utils/KubectlArgvGuard";
import { JSONObject } from "Common/Types/JSON";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import {
  KubectlCommandTier,
  isSameKubernetesClusterIdentifier,
  normalizeKubernetesClusterIdentifier,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "Common/Utils/AiRemediation/KubectlPolicy";
import GracefulShutdown, {
  ShutdownPriority,
} from "Common/Server/Utils/GracefulShutdown";
import logger from "Common/Server/Utils/Logger";

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
 * of the trust boundary, so it re-checks the argv it received twice, with
 * two independent checks: the Runner's own KubectlArgvGuard (file-backed
 * output formats, credential/cluster/file flags anywhere in the argv), then
 * the same pure KubectlPolicy the server ran. A Denied command never spawns,
 * an investigation-origin job may only be Read tier, and a host installed
 * read-only refuses every write — whatever a compromised or misconfigured
 * server sent.
 *
 * Credentials never touch the argv. The kubernetes-agent Runner, and only
 * it, may run a credential-less job with its pod's own ServiceAccount (the
 * same in-cluster config the Kubernetes agent uses) — and only for a job
 * the server stamped with the name of the cluster this Runner registered
 * as: the pod cannot tell which cluster it is in, so the name it was
 * installed with is the one fact it can check a job against. For any other
 * Runner the server resolved a Kubernetes credential at claim time; it is
 * written to a private temporary kubeconfig for the life of the command,
 * removed afterwards, swept at start-up and on shutdown.
 */

const KUBECTL_BINARY: string = "kubectl";

// The API-server-side bound; the process timeout is the outer bound.
const MIN_REQUEST_TIMEOUT_SECONDS: number = 5;

/*
 * Every temporary kubeconfig lives under one predictable, private directory
 * so a Runner that died mid-command (OOM kill, node drain, SIGKILL during a
 * deploy — none of which run a finally block) can find and remove what its
 * previous life left behind, instead of leaving bearer tokens on disk for
 * the life of the volume.
 */
const KUBECONFIG_PARENT_DIR_NAME: string = "oneuptime-kubectl";
const KUBECONFIG_DIR_PREFIX: string = "job-";
const PRIVATE_DIR_MODE: number = 0o700;

function truncate(s: string): string {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return s;
  }

  return (
    Buffer.from(s, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n... [output truncated]"
  );
}

/*
 * The server stamps the target cluster's identifier on every kubectl job
 * payload (RunnerJobService.enqueueAiKubectlCommand writes it as
 * `clusterIdentifier`). Tolerate the spellings a server one release apart
 * might use; an absent value is "" and never matches anything.
 */
const PAYLOAD_CLUSTER_IDENTIFIER_KEYS: Array<string> = [
  "clusterIdentifier",
  "kubernetesClusterIdentifier",
  "clusterName",
];

function getPayloadClusterIdentifier(payload: JSONObject): string {
  for (const key of PAYLOAD_CLUSTER_IDENTIFIER_KEYS) {
    const value: unknown = payload[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

function hasFlag(args: Array<string>, name: string): boolean {
  return args.some((arg: string) => {
    return arg === `--${name}` || arg.startsWith(`--${name}=`);
  });
}

export default class KubectlExecutor {
  // Kubeconfig directories of commands running right now.
  private static activeKubeconfigDirs: Set<string> = new Set<string>();

  private static shutdownHookInstalled: boolean = false;

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

    // ---- The Runner's own guard, before and independent of the policy. --

    const guardRefusal: string | null = KubectlArgvGuard.getRefusalReason(args);

    if (guardRefusal) {
      return {
        success: false,
        output: "",
        errorMessage: `Refused by the Runner: ${guardRefusal}.`,
      };
    }

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
        kubeconfigDir = KubectlExecutor.createKubeconfigDir();
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
    } else if (!KubernetesPosture.canUseOwnServiceAccount()) {
      /*
       * No credential means "use the pod's own ServiceAccount" — which only
       * the kubernetes-agent Runner may do, because only it knows which
       * cluster it is in. An ordinary Runner that happens to run in a pod
       * would otherwise execute this command against whatever cluster that
       * pod lives in, for a job the server believes targets another.
       */
      return {
        success: false,
        output: "",
        errorMessage:
          "This kubectl command has no Kubernetes credential, and only the in-cluster Runner installed by the Kubernetes agent chart may run kubectl with its pod's own ServiceAccount — this Runner is not that Runner (or is not running inside a cluster). Bind a Kubernetes credential to this Runner on the cluster's AI page, or install the Kubernetes agent with --set aiAccess.enabled=true and select its Runner there.",
      };
    } else {
      /*
       * Defence in depth on the credential-less path: the server only
       * enqueues such a job for the in-cluster Runner OF THAT CLUSTER, but
       * this binary is the last thing before the pod's ServiceAccount and
       * must not trust that routing. The job names the cluster it targets;
       * this Runner knows the cluster it was installed for. Anything but
       * an exact (case-insensitive) match — including a blank on either
       * side — is refused rather than run against whatever cluster this
       * pod happens to live in.
       */
      const jobClusterIdentifier: string = getPayloadClusterIdentifier(
        data.payload,
      );
      const ownClusterIdentifier: string = (
        KubectlExecutor.getOwnClusterIdentifier() || ""
      ).trim();

      if (
        !isSameKubernetesClusterIdentifier(
          jobClusterIdentifier,
          ownClusterIdentifier,
        )
      ) {
        return {
          success: false,
          output: "",
          errorMessage: `Refused by the Runner: this kubectl command targets cluster "${
            jobClusterIdentifier || "(not specified)"
          }" but this Runner is the Kubernetes agent of cluster "${
            ownClusterIdentifier || "(not specified)"
          }" and only runs credential-less kubectl for its own cluster. Check that the cluster's AI page points at the Runner the Kubernetes agent installed in that cluster (its ONEUPTIME_KUBERNETES_CLUSTER_NAME must match the cluster's identifier).`,
        };
      }
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

  // ---- Kubeconfig directory lifecycle. ----------------------------------

  /*
   * Resolved on every call rather than at module load so a host that sets
   * TMPDIR after this module is imported (tests, but also process managers
   * that inject it) is honoured.
   */
  public static getKubeconfigParentDir(): string {
    return path.join(os.tmpdir(), KUBECONFIG_PARENT_DIR_NAME);
  }

  /*
   * Called once at Runner start-up, in every mode: sweeps what a previous
   * life of this process left behind, makes the parent directory private,
   * and arranges for in-flight kubeconfigs to be removed on SIGTERM/SIGINT
   * (GracefulShutdown owns the signal handlers and exits after every
   * handler has run). Returns how many abandoned directories were removed.
   */
  public static initialize(): number {
    const swept: number = KubectlExecutor.sweepOrphanedKubeconfigs();

    if (!KubectlExecutor.shutdownHookInstalled) {
      KubectlExecutor.shutdownHookInstalled = true;
      GracefulShutdown.registerHandler(
        "KubectlExecutor.kubeconfigs",
        ShutdownPriority.Workers,
        (): void => {
          KubectlExecutor.removeAllKubeconfigs();
        },
      );
    }

    return swept;
  }

  /*
   * Remove every kubeconfig directory that no command running in this
   * process owns. At start-up nothing is active, so this is "everything a
   * previous life left behind"; it is safe to call at any time later too.
   * Best effort: a directory that cannot be removed is logged, not fatal.
   */
  public static sweepOrphanedKubeconfigs(): number {
    const parent: string = KubectlExecutor.getKubeconfigParentDir();
    let removed: number = 0;

    let entries: Array<string>;
    try {
      entries = fs.readdirSync(parent);
    } catch {
      // No directory yet — nothing to sweep.
      return 0;
    }

    for (const entry of entries) {
      const dir: string = path.join(parent, entry);

      if (KubectlExecutor.activeKubeconfigDirs.has(dir)) {
        continue;
      }

      try {
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
      } catch (err) {
        logger.warn(
          `Could not remove abandoned kubectl credential directory ${dir}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    return removed;
  }

  /*
   * Shutdown: remove the kubeconfigs of commands still running as well as
   * any orphans. kubectl reads its kubeconfig once at start, so taking the
   * file away from a command that is already running does not break it —
   * and the alternative, a SIGKILL after the grace period, would leave the
   * token on disk.
   */
  public static removeAllKubeconfigs(): number {
    let removed: number = 0;

    for (const dir of Array.from(KubectlExecutor.activeKubeconfigDirs)) {
      KubectlExecutor.cleanup(dir);
      removed++;
    }

    return removed + KubectlExecutor.sweepOrphanedKubeconfigs();
  }

  /*
   * The cluster this Runner was installed for — the chart's clusterName,
   * passed as ONEUPTIME_KUBERNETES_CLUSTER_NAME — or null for a Runner that
   * is not the Kubernetes agent's. Normalized like every other cluster
   * identifier comparison. A method rather than the constant so tests can
   * give this Runner a cluster without rebuilding Config from the
   * environment.
   */
  public static getOwnClusterIdentifier(): string | null {
    const normalized: string = normalizeKubernetesClusterIdentifier(
      KUBERNETES_AGENT_CLUSTER_NAME,
    );

    return normalized.length > 0 ? normalized : null;
  }

  // Test seam: which kubeconfig directories are in flight right now.
  public static getActiveKubeconfigDirs(): Array<string> {
    return Array.from(KubectlExecutor.activeKubeconfigDirs);
  }

  /*
   * A fresh private directory for one command's kubeconfig, under a parent
   * that this process owns and nobody else can read. The parent is checked
   * on every use rather than trusted once: a pre-existing directory owned
   * by another user (a shared /tmp on a bare-metal host) would let that
   * user rename or replace entries under it, so it is refused outright.
   */
  private static createKubeconfigDir(): string {
    const parent: string = KubectlExecutor.getKubeconfigParentDir();

    fs.mkdirSync(parent, { recursive: true, mode: PRIVATE_DIR_MODE });

    const stat: fs.Stats = fs.lstatSync(parent);

    if (!stat.isDirectory()) {
      throw new Error(
        `${parent} exists but is not a directory (a symlink or file is in its place).`,
      );
    }

    const uid: number | undefined = process.getuid?.();
    if (uid !== undefined && stat.uid !== uid) {
      throw new Error(
        `${parent} is owned by another user (uid ${stat.uid}); refusing to write a cluster credential under it.`,
      );
    }

    // mkdir's mode is subject to the umask; make the directory private regardless.
    if ((stat.mode & 0o077) !== 0) {
      fs.chmodSync(parent, PRIVATE_DIR_MODE);
    }

    const dir: string = fs.mkdtempSync(
      path.join(parent, KUBECONFIG_DIR_PREFIX),
    );
    fs.chmodSync(dir, PRIVATE_DIR_MODE);

    KubectlExecutor.activeKubeconfigDirs.add(dir);

    return dir;
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

    KubectlExecutor.activeKubeconfigDirs.delete(dir);

    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort — the start-up sweep gets a second chance at it.
    }
  }
}
