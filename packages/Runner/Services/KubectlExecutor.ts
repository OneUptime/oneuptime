import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { KUBERNETES_AGENT_CLUSTER_NAME, MAX_OUTPUT_BYTES } from "../Config";
import KubernetesPosture from "../Utils/KubernetesPosture";
import KubernetesAgentMode from "../Utils/KubernetesAgentMode";
import KubectlArgvGuard from "../Utils/KubectlArgvGuard";
import KubectlWriteScope, {
  KubectlWriteTargets,
} from "../Utils/KubectlWriteScope";
import { JSONObject } from "Common/Types/JSON";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import {
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KUBECTL_ALLOW_WRITES_ENV,
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
 * an investigation-origin job may only be Read tier, a host that does not
 * allow writes refuses every write, a host that does not allow node
 * operations refuses every write to a node, and a write outside the
 * namespaces this Runner may change (or into its own pod's namespace) is
 * refused — whatever a compromised or misconfigured server sent.
 *
 * kubectl runs in a closed environment: PATH, a private empty HOME, a
 * private discovery cache, kuberc preferences switched off (kubectl 1.33+
 * would otherwise let a preferences file add default flags to an argv the
 * policy already approved), and either the temporary kubeconfig (plus the
 * host's proxy settings) or the in-cluster service address — nothing else
 * this host holds, whatever it is.
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

/*
 * --request-timeout bounds each API request; the process timeout bounds the
 * whole command. The first must end well before the second, or an API
 * server that never answers gets kubectl SIGKILLed a moment before it
 * would have said "Unable to connect to the server", and the operator sees
 * a bare kill with no output. So the request timeout leaves at least this
 * much of the budget for kubectl to print its error and exit ...
 */
const REQUEST_TIMEOUT_HEADROOM_MS: number = 3_000;
// ... and at least this share of it on short budgets ...
const REQUEST_TIMEOUT_HEADROOM_RATIO: number = 0.2;
// ... but never less than half the budget, and never under this floor.
const MIN_REQUEST_TIMEOUT_MS: number = 100;

/*
 * stderr carries kubectl's reason for failing, and it comes after whatever
 * stdout already printed. It gets its own budget (its tail — the error is
 * at the end) and stdout gets the rest, so a large partial table can never
 * push the reason out of the output.
 */
const STDERR_MAX_BYTES: number = 8_000;

// The longest stderr excerpt carried on a failure's errorMessage.
const ERROR_REASON_MAX_CHARS: number = 500;

/*
 * Proxy settings kubectl honours (Go's ProxyFromEnvironment), forwarded from
 * the Runner host to a command that reaches its API server through a
 * credential — the Runner's own traffic already uses them. Never on the
 * in-cluster path, whose API server is the pod's own service address.
 */
const PROXY_ENV_NAMES: Array<string> = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "NO_PROXY",
  "no_proxy",
];

// What kubectl needs to find the API server with the pod's ServiceAccount.
const IN_CLUSTER_ENV_NAMES: Array<string> = [
  "KUBERNETES_SERVICE_HOST",
  "KUBERNETES_SERVICE_PORT",
  "KUBERNETES_SERVICE_PORT_HTTPS",
];

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

/*
 * Inside each command's private directory: `config` (the kubeconfig, when
 * the job carries a credential), `home` (kubectl's HOME and working
 * directory — empty, so no ~/.kube/config or ~/.kube/kuberc is ever found)
 * and `cache` (its discovery cache).
 */
const JOB_HOME_DIR_NAME: string = "home";
const JOB_CACHE_DIR_NAME: string = "cache";

const STDOUT_HEADER: string = "[stdout]\n";
const STDERR_HEADER: string = "[stderr]\n";

function headBytes(s: string, maxBytes: number): string {
  return Buffer.from(s, "utf8")
    .subarray(0, Math.max(0, maxBytes))
    .toString("utf8");
}

function tailBytes(s: string, maxBytes: number): string {
  const buffer: Buffer = Buffer.from(s, "utf8");
  return buffer
    .subarray(Math.max(0, buffer.length - Math.max(0, maxBytes)))
    .toString("utf8");
}

/*
 * The output shipped back to the server: `[stdout]` then `[stderr]`, within
 * MAX_OUTPUT_BYTES plus the truncation markers. stderr is budgeted first
 * (its last STDERR_MAX_BYTES — kubectl's error is at the end) and is never
 * cut to make room for stdout; stdout gets whatever is left and says so
 * when it was cut. `stdoutTruncated`/`stderrTruncated` report that the
 * capture itself already dropped bytes.
 */
export function formatKubectlOutput(data: {
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean | undefined;
  stderrTruncated?: boolean | undefined;
}): string {
  let stderr: string = data.stderr;
  let stderrCut: boolean = data.stderrTruncated === true;

  if (Buffer.byteLength(stderr, "utf8") > STDERR_MAX_BYTES) {
    stderr = tailBytes(stderr, STDERR_MAX_BYTES);
    stderrCut = true;
  }

  const stderrSection: string = stderr
    ? `${STDERR_HEADER}${stderrCut ? "... [earlier stderr truncated]\n" : ""}${stderr}`
    : "";

  let stdoutSection: string = "";

  if (data.stdout) {
    const budget: number =
      MAX_OUTPUT_BYTES -
      Buffer.byteLength(stderrSection, "utf8") -
      (stderrSection ? 1 : 0) -
      STDOUT_HEADER.length;

    let stdout: string = data.stdout;
    let stdoutCut: boolean = data.stdoutTruncated === true;

    if (Buffer.byteLength(stdout, "utf8") > budget) {
      stdout = headBytes(stdout, budget);
      stdoutCut = true;
    }

    stdoutSection = `${STDOUT_HEADER}${stdout}${
      stdoutCut
        ? `\n... [output truncated: stdout cut at ${Buffer.byteLength(stdout, "utf8")} bytes${stderrSection ? "; stderr follows" : ""}]`
        : ""
    }`;
  }

  return [stdoutSection, stderrSection].filter(Boolean).join("\n");
}

/*
 * kubectl's reason for a failure: the last non-empty stderr line
 * ("Error from server (Forbidden): ..."), capped. Carried on the
 * errorMessage so it survives any later cap on the output.
 */
function lastStderrLine(stderr: string): string {
  const lines: Array<string> = stderr
    .split(/\r?\n/)
    .map((line: string) => {
      return line.trim();
    })
    .filter((line: string) => {
      return line.length > 0;
    });

  const last: string = lines[lines.length - 1] || "";

  return last.length > ERROR_REASON_MAX_CHARS
    ? `${last.slice(0, ERROR_REASON_MAX_CHARS)}...`
    : last;
}

/*
 * The --request-timeout for a command with this process budget: well
 * inside it, so kubectl can report an unreachable or slow API server itself
 * before the process is killed. 30s gives 24s; 120s gives 96s; a 1s budget
 * gives 500ms.
 */
export function getRequestTimeoutMs(timeoutInMs: number): number {
  const budget: number = Math.max(0, Math.floor(timeoutInMs));
  const withHeadroom: number = Math.min(
    budget - REQUEST_TIMEOUT_HEADROOM_MS,
    Math.floor(budget * (1 - REQUEST_TIMEOUT_HEADROOM_RATIO)),
  );

  return Math.max(withHeadroom, Math.floor(budget / 2), MIN_REQUEST_TIMEOUT_MS);
}

// kubectl takes a Go duration: whole seconds when that loses little, else ms.
export function formatRequestTimeout(ms: number): string {
  return ms >= 2_000 ? `${Math.floor(ms / 1000)}s` : `${Math.floor(ms)}ms`;
}

/*
 * The API server a credential points at, for messages: scheme, host and
 * port only — never a path, a query or userinfo.
 */
function describeApiServer(apiServerUrl: string): string {
  try {
    const parsed: URL = new URL(apiServerUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "the API server named in the Kubernetes credential";
  }
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
    // kubectl reads "_" as "-" in a long flag name.
    const normalized: string = arg.replace(/_/g, "-");
    return normalized === `--${name}` || normalized.startsWith(`--${name}=`);
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
        errorMessage: KubectlExecutor.describeWritesRefused(),
      };
    }

    /*
     * Node operations have their own switch: nodes are cluster-scoped, so
     * the namespace scope below cannot bound them, and the chart's node
     * role is optional. A write whose objects cannot be read for certain
     * could be one, so it is refused too.
     */
    if (
      policy.tier !== KubectlCommandTier.Read &&
      !KubernetesPosture.allowsNodeOperations()
    ) {
      const targets: KubectlWriteTargets =
        KubectlWriteScope.resolveTargets(args);

      if (targets.touchesNodes || targets.uncertainty !== null) {
        return {
          success: false,
          output: "",
          errorMessage: KubectlExecutor.describeNodeOperationsRefused({
            displayCommand: policy.displayCommand,
            uncertainty: targets.uncertainty,
          }),
        };
      }
    }

    const apiServerUrl: string = String(
      data.credential?.["apiServerUrl"] || "",
    );
    const token: string = String(data.credential?.["token"] || "");
    const usesCredential: boolean = Boolean(apiServerUrl && token);

    // ---- Where a write may land. ----------------------------------------

    const scopeRefusal: string | null = KubectlWriteScope.getRefusalReason({
      args,
      tier: policy.tier,
      verb: policy.verb,
      displayCommand: policy.displayCommand,
      writeNamespaces: KubernetesPosture.getWriteNamespaces(),
      podNamespace: KubernetesPosture.getPodNamespace(),
      /*
       * What a missing -n means: the pod's own namespace in-cluster, and
       * "default" for the kubeconfig built below, which names none.
       */
      defaultNamespace: usesCredential
        ? "default"
        : KubernetesPosture.getPodNamespace(),
    });

    if (scopeRefusal) {
      return {
        success: false,
        output: "",
        errorMessage: `Refused by the Runner: ${scopeRefusal}`,
      };
    }

    // ---- Cluster access. ------------------------------------------------

    if (!usesCredential && data.credential) {
      return {
        success: false,
        output: "",
        errorMessage:
          "The Kubernetes credential is missing an API server URL or token.",
      };
    }

    if (!usesCredential && !KubernetesPosture.canUseOwnServiceAccount()) {
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
    }

    if (!usesCredential) {
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
     * Every command gets its own private directory — the credential's
     * kubeconfig when there is one, an empty HOME and a discovery cache —
     * so nothing another command, another process or a previous life of
     * this one left on disk can shape what kubectl does.
     */
    let jobDir: string | null = null;
    let kubeconfigPath: string | null = null;

    try {
      jobDir = KubectlExecutor.createKubeconfigDir();

      if (usesCredential) {
        kubeconfigPath = path.join(jobDir, "config");
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
      }
    } catch (err) {
      KubectlExecutor.cleanup(jobDir);
      return {
        success: false,
        output: "",
        errorMessage: `${
          usesCredential
            ? "Could not prepare the Kubernetes credential"
            : "Could not prepare a private working directory for kubectl"
        }: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const finalArgs: Array<string> = kubeconfigPath
      ? ["--kubeconfig", kubeconfigPath]
      : [];

    /*
     * Bound every API call so a hung watch or a slow API server cannot hold
     * the job open past its lease — and end it well before the process
     * timeout, so kubectl can say what went wrong before it is killed.
     */
    if (!hasFlag(args, "request-timeout")) {
      finalArgs.push(
        `--request-timeout=${formatRequestTimeout(
          getRequestTimeoutMs(data.timeoutInMs),
        )}`,
      );
    }

    finalArgs.push(...args);

    try {
      return await KubectlExecutor.spawnKubectl({
        args: finalArgs,
        timeoutInMs: data.timeoutInMs,
        homeDir: path.join(jobDir, JOB_HOME_DIR_NAME),
        cacheDir: path.join(jobDir, JOB_CACHE_DIR_NAME),
        kubeconfigPath,
        apiServerDescription: usesCredential
          ? describeApiServer(apiServerUrl)
          : null,
      });
    } finally {
      KubectlExecutor.cleanup(jobDir);
    }
  }

  /*
   * Why a write is refused on a host that does not allow writes — pointing
   * at the fix that applies to THIS Runner: the chart flag for the
   * Kubernetes agent's Runner, the environment variable for any other.
   */
  private static describeWritesRefused(): string {
    const setting: string | null = KubernetesPosture.getAllowWritesSetting();
    const current: string =
      setting === null || setting.trim() === ""
        ? `${KUBECTL_ALLOW_WRITES_ENV} is not set`
        : `${KUBECTL_ALLOW_WRITES_ENV}="${setting}"`;

    if (KubernetesAgentMode.isActive()) {
      return `Refused by the Runner: this Runner was installed read-only (${current}; only "true" allows writes). Upgrade the Kubernetes agent with --set aiAccess.remediation.enabled=true to allow OneUptime AI to change this cluster.`;
    }

    return `Refused by the Runner: this Runner host does not allow AI-composed kubectl writes (${current}; when it is set, only "true" allows them). Set ${KUBECTL_ALLOW_WRITES_ENV}=true in this Runner's environment (or remove it) and restart it to let OneUptime AI change clusters through it; the Kubernetes credential's RBAC still bounds what it can do.`;
  }

  /*
   * Why a node operation is refused on a host whose node switch is off —
   * pointing, like describeWritesRefused, at the fix for THIS Runner.
   */
  private static describeNodeOperationsRefused(data: {
    displayCommand: string;
    uncertainty: string | null;
  }): string {
    const setting: string | null =
      KubernetesPosture.getAllowNodeOperationsSetting();
    const current: string =
      setting === null || setting.trim() === ""
        ? `${KUBECTL_ALLOW_NODE_OPERATIONS_ENV} is not set`
        : `${KUBECTL_ALLOW_NODE_OPERATIONS_ENV}="${setting}"`;

    const what: string =
      data.uncertainty === null
        ? `"${data.displayCommand}" is a node operation (cordon, uncordon, drain, taint, or a change to a Node object)`
        : `this Runner cannot tell for certain whether "${data.displayCommand}" changes a node (${data.uncertainty})`;

    if (KubernetesAgentMode.isActive()) {
      return `Refused by the Runner: ${what}, and this Runner was installed without node operations (${current}; only "true" allows them). Upgrade the Kubernetes agent with --set aiAccess.remediation.nodeOperations=true to let OneUptime AI change nodes; other fixes are unaffected.`;
    }

    return `Refused by the Runner: ${what}, and this Runner host does not allow AI-composed node operations (${current}; when it is set, only "true" allows them). Set ${KUBECTL_ALLOW_NODE_OPERATIONS_ENV}=true in this Runner's environment (or remove it) and restart it to let OneUptime AI change nodes through it; the Kubernetes credential's RBAC still bounds what it can do.`;
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
    KubectlExecutor.activeKubeconfigDirs.add(dir);

    try {
      fs.chmodSync(dir, PRIVATE_DIR_MODE);

      // kubectl's HOME: private and empty.
      fs.mkdirSync(path.join(dir, JOB_HOME_DIR_NAME), {
        mode: PRIVATE_DIR_MODE,
      });
    } catch (err) {
      KubectlExecutor.cleanup(dir);
      throw err;
    }

    return dir;
  }

  /*
   * The environment kubectl runs with: a closed allowlist built from
   * nothing but what this command needs, whatever this host's environment
   * holds (cloud CLI profiles, KUBECONFIG, KUBECTL_* feature switches,
   * credentials in variables). Public for tests.
   *
   *   - PATH, to find kubectl.
   *   - HOME: the command's private, empty directory, so kubectl never
   *     finds ~/.kube/config or ~/.kube/kuberc; KUBECACHEDIR beside it.
   *   - KUBERC=off and KUBECTL_KUBERC=false: kubectl 1.33+ reads a kuberc
   *     preferences file (aliases, default flags) — it must never rewrite
   *     an argv the policy already approved.
   *   - With a credential: KUBECONFIG = the temporary kubeconfig (also on
   *     the argv as --kubeconfig), and this host's proxy settings, which is
   *     how the Runner's own traffic reaches the outside too. No in-cluster
   *     service address, so kubectl can never fall back to the pod's own
   *     ServiceAccount.
   *   - Without one (the kubernetes-agent Runner in its pod): the in-cluster
   *     service address, and no proxy — the API server is the pod's own
   *     service, and a host proxy would only get in its way.
   */
  public static buildSpawnEnv(data: {
    homeDir: string;
    cacheDir: string;
    kubeconfigPath: string | null;
  }): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env["PATH"] || "/usr/local/bin:/usr/bin:/bin",
      HOME: data.homeDir,
      KUBECACHEDIR: data.cacheDir,
      KUBERC: "off",
      KUBECTL_KUBERC: "false",
    };

    const passThrough: Array<string> = data.kubeconfigPath
      ? PROXY_ENV_NAMES
      : IN_CLUSTER_ENV_NAMES;

    for (const name of passThrough) {
      const value: string | undefined = process.env[name];

      if (value) {
        env[name] = value;
      }
    }

    if (data.kubeconfigPath) {
      env["KUBECONFIG"] = data.kubeconfigPath;
    }

    return env;
  }

  private static spawnKubectl(data: {
    args: Array<string>;
    timeoutInMs: number;
    homeDir: string;
    cacheDir: string;
    kubeconfigPath: string | null;
    // "https://host:port" of the credential's API server; null in-cluster.
    apiServerDescription: string | null;
  }): Promise<KubectlExecResult> {
    return new Promise<KubectlExecResult>(
      (resolve: (value: KubectlExecResult) => void) => {
        const stdoutChunks: Array<Buffer> = [];
        let stdoutBytes: number = 0;
        let stdoutTruncated: boolean = false;
        // Only the tail of stderr is kept: kubectl's error is at the end.
        let stderrTail: Buffer = Buffer.alloc(0);
        let stderrTruncated: boolean = false;
        let settled: boolean = false;

        let child: ReturnType<typeof spawn>;

        try {
          child = spawn(KUBECTL_BINARY, data.args, {
            timeout: data.timeoutInMs,
            killSignal: "SIGKILL",
            // No stdin: kubectl must never wait for input.
            stdio: ["ignore", "pipe", "pipe"],
            env: KubectlExecutor.buildSpawnEnv({
              homeDir: data.homeDir,
              cacheDir: data.cacheDir,
              kubeconfigPath: data.kubeconfigPath,
            }),
            cwd: data.homeDir,
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
            stdoutChunks.push(chunk);
            stdoutBytes += chunk.length;
          } else {
            stdoutTruncated = true;
          }
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          stderrTail = Buffer.concat([stderrTail, chunk]);

          if (stderrTail.length > STDERR_MAX_BYTES * 2) {
            stderrTail = stderrTail.subarray(
              stderrTail.length - STDERR_MAX_BYTES,
            );
            stderrTruncated = true;
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

          const stdout: string = Buffer.concat(stdoutChunks).toString("utf8");
          const stderr: string = stderrTail.toString("utf8");
          const output: string = formatKubectlOutput({
            stdout,
            stderr,
            stdoutTruncated,
            stderrTruncated,
          });
          const reason: string = lastStderrLine(stderr);

          if (signal === "SIGKILL") {
            resolve({
              success: false,
              output,
              errorMessage: KubectlExecutor.describeKill({
                timeoutInMs: data.timeoutInMs,
                producedOutput: stdout.trim() !== "" || stderr.trim() !== "",
                apiServerDescription: data.apiServerDescription,
              }),
            });
            return;
          }

          if (code === 0) {
            resolve({ success: true, output, exitCode: 0 });
            return;
          }

          resolve({
            success: false,
            output,
            exitCode: code ?? undefined,
            errorMessage: `Exit code ${code ?? "?"}${reason ? `: ${reason}` : ""}`,
          });
        });
      },
    );
  }

  /*
   * A kill on timeout. With output, the output says what kubectl was doing.
   * With none at all, kubectl never heard back from the API server even
   * though every request was bounded well inside this budget — which on a
   * Runner is nearly always a network path that does not exist (a private
   * endpoint, a firewall, an egress policy, a missing proxy), not a slow
   * cluster. Say so, and name where it was trying to go.
   */
  private static describeKill(data: {
    timeoutInMs: number;
    producedOutput: boolean;
    apiServerDescription: string | null;
  }): string {
    const killed: string = `Killed (timeout ${data.timeoutInMs}ms)`;

    if (data.producedOutput) {
      return killed;
    }

    const target: string = data.apiServerDescription
      ? `the Kubernetes API server at ${data.apiServerDescription}`
      : "the in-cluster Kubernetes API server";

    return `${killed}: kubectl produced no output at all, so ${target} is probably unreachable from this Runner. Check the API server address, the network path from the Runner (firewall, egress policy, proxy settings) and the CA certificate.`;
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
