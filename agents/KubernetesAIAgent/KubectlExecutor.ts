import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import KubectlArgvGuard from "./KubectlArgvGuard";
import Logger from "./Logger";
import {
  InClusterApiServer,
  ServiceAccountPaths,
  getInClusterApiServer,
  isFile,
} from "./Posture";
import KubectlPolicy, {
  KubectlPolicyResult,
} from "./Common/Utils/AiRemediation/KubectlPolicy";
import KubectlWriteScope, {
  KubectlWriteScopeRefusal,
} from "./Common/Utils/AiRemediation/KubectlWriteScope";
import RunnerJobOrigin from "./Common/Types/Runbook/RunnerJobOrigin";
import {
  AI_AGENT_POD_NAMESPACE_ENV,
  KUBECTL_ALLOW_NODE_OPERATIONS_ENV,
  KUBECTL_ALLOW_WRITES_ENV,
  KubectlCommandTier,
  RUNNER_POD_NAMESPACE_ENV,
  isSameKubernetesClusterIdentifier,
  normalizeKubernetesClusterIdentifier,
} from "./Common/Types/Kubernetes/KubernetesClusterAiAccess";
import {
  AGENT_AI_FIXES_SETTING_VALUES,
  AI_FIXES_ENV,
} from "./Common/Types/AI/AgentAiSettings";

export interface KubectlExecResult {
  success: boolean;
  output: string;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
}

/*
 * Runs ONE kubectl command OneUptime AI composed, as an argv — never
 * through a shell — with this pod's own ServiceAccount. A port of the
 * Runner's KubectlExecutor (packages/Runner/Services/KubectlExecutor.ts)
 * restricted to that in-cluster path: the agent never holds a Kubernetes
 * credential, so a job that carries one is refused.
 *
 * Defence in depth, on purpose. The server tiered the argv and refused what
 * it should before enqueueing, but this binary runs on the customer's side
 * of the trust boundary, so before anything spawns it re-checks, whatever
 * the server said:
 *
 *   1. the argv is a non-empty array of strings;
 *   2. the agent's own KubectlArgvGuard (file-backed output formats,
 *      credential/cluster/file flags anywhere in the argv);
 *   3. the same pure KubectlPolicy the server ran: Denied never runs, and an
 *      investigation may only run Read-tier commands;
 *   4. a write needs ONEUPTIME_KUBECTL_ALLOW_WRITES=true (the chart's
 *      aiAgent.fixes, or aiAgent.remediation.enabled on a release that does
 *      not set it) and fixes that are not off (ONEUPTIME_AI_FIXES);
 *   5. KubectlWriteScope: where a write may land (the chart's namespace
 *      list, never the agent's own namespace) and whether it may change
 *      nodes (aiAgent.remediation.nodeOperations);
 *   6. the job names the cluster this agent was installed for;
 *   7. the pod really has an API server address and a mounted token and CA.
 *
 * kubectl then runs in a closed environment with an explicit kubeconfig
 * built from the pod's ServiceAccount (see buildInClusterKubeconfig for why
 * kubectl's implicit in-cluster fallback is never used).
 */

const DEFAULT_KUBECTL_BINARY: string = "kubectl";

/*
 * kubectl output kept for the server. `kubectl describe node` on a busy node
 * or a pod's logs easily pass 50 KB, and the server pages long output to the
 * model instead of cutting it, so everything kept here is readable.
 */
export const MAX_OUTPUT_BYTES: number = 1_000_000;

/*
 * --request-timeout bounds each API request; the process timeout bounds the
 * whole command. The first must end well before the second, or an API
 * server that never answers gets kubectl SIGKILLed a moment before it would
 * have said "Unable to connect to the server", and the operator sees a bare
 * kill with no output. So the request timeout leaves at least this much of
 * the budget for kubectl to print its error and exit ...
 */
const REQUEST_TIMEOUT_HEADROOM_MS: number = 3_000;
// ... and at least this share of it on short budgets ...
const REQUEST_TIMEOUT_HEADROOM_RATIO: number = 0.2;
// ... but never less than half the budget, and never under this floor.
const MIN_REQUEST_TIMEOUT_MS: number = 100;

/*
 * stderr carries kubectl's reason for failing, and it comes after whatever
 * stdout already printed. It gets its own budget (its tail — the error is at
 * the end) and stdout gets the rest, so a large partial table can never push
 * the reason out of the output.
 */
export const STDERR_MAX_BYTES: number = 8_000;

// The longest stderr excerpt carried on a failure's errorMessage.
const ERROR_REASON_MAX_CHARS: number = 500;

/*
 * Every command's private directory lives under one predictable parent so
 * an agent that died mid-command (OOM kill, node drain, SIGKILL — none of
 * which run a finally block) can find and remove what its previous life
 * left behind.
 */
export const JOB_DIR_PARENT_NAME: string = "oneuptime-kubectl";
const JOB_DIR_PREFIX: string = "job-";
const PRIVATE_DIR_MODE: number = 0o700;

/*
 * Inside each command's private directory: `config` (the kubeconfig),
 * `home` (kubectl's HOME and working directory — empty, so no
 * ~/.kube/config or ~/.kube/kuberc is ever found) and `cache` (its
 * discovery cache).
 */
const JOB_KUBECONFIG_FILE_NAME: string = "config";
const JOB_HOME_DIR_NAME: string = "home";
const JOB_CACHE_DIR_NAME: string = "cache";

const STDOUT_HEADER: string = "[stdout]\n";
const STDERR_HEADER: string = "[stderr]\n";

const REFUSED: string = "Refused by the Kubernetes AI agent";

/*
 * U+0000, which kubectl can print (a ConfigMap value, a log line, a binary
 * annotation) and a Postgres text column cannot hold. Replaced before the
 * output is formatted, with the character the server uses, so a reader sees
 * that something was there.
 */
// eslint-disable-next-line no-control-regex
const NUL_CHARACTER_PATTERN: RegExp = /\u0000/g;
export const KUBECTL_NUL_REPLACEMENT: string = "�";

export function replaceNulCharacters(text: string): string {
  return text.replace(NUL_CHARACTER_PATTERN, KUBECTL_NUL_REPLACEMENT);
}

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
 * maxOutputBytes plus the truncation markers. stderr is budgeted first (its
 * last STDERR_MAX_BYTES — kubectl's error is at the end) and is never cut to
 * make room for stdout; stdout gets whatever is left and says so when it was
 * cut. `stdoutTruncated`/`stderrTruncated` report that the capture itself
 * already dropped bytes.
 */
export function formatKubectlOutput(data: {
  stdout: string;
  stderr: string;
  stdoutTruncated?: boolean | undefined;
  stderrTruncated?: boolean | undefined;
  maxOutputBytes?: number | undefined;
}): string {
  const maxOutputBytes: number = data.maxOutputBytes ?? MAX_OUTPUT_BYTES;
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
      maxOutputBytes -
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
 * kubectl's reason for a failure: the last non-empty stderr line ("Error
 * from server (Forbidden): ..."), capped. Carried on the errorMessage so it
 * survives any later cap on the output.
 */
export function lastStderrLine(stderr: string): string {
  const lines: Array<string> = stderr
    .split(/\r?\n/)
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    });

  const last: string = lines[lines.length - 1] || "";

  return last.length > ERROR_REASON_MAX_CHARS
    ? `${last.slice(0, ERROR_REASON_MAX_CHARS)}...`
    : last;
}

/*
 * The --request-timeout for a command with this process budget: well inside
 * it, so kubectl can report an unreachable or slow API server itself before
 * the process is killed. 30s gives 24s; 120s gives 96s; a 1s budget gives
 * 500ms.
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
 * The server stamps the target cluster's identifier on every kubectl job
 * payload as `clusterIdentifier`. Tolerate the spellings a server one
 * release apart might use; an absent value is "" and never matches.
 */
const PAYLOAD_CLUSTER_IDENTIFIER_KEYS: Array<string> = [
  "clusterIdentifier",
  "kubernetesClusterIdentifier",
  "clusterName",
];

export function getPayloadClusterIdentifier(
  payload: Record<string, unknown>,
): string {
  for (const key of PAYLOAD_CLUSTER_IDENTIFIER_KEYS) {
    const value: unknown = payload[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

/*
 * https://host:port for the in-cluster API server, bracketing an IPv6 host
 * the way Go's net.JoinHostPort (and so client-go's own in-cluster config)
 * does: KUBERNETES_SERVICE_HOST is a bare IPv6 address on IPv6 clusters.
 */
export function formatInClusterServerUrl(
  apiServer: InClusterApiServer,
): string {
  const host: string =
    apiServer.host.includes(":") && !apiServer.host.startsWith("[")
      ? `[${apiServer.host}]`
      : apiServer.host;

  return `https://${host}:${apiServer.port}`;
}

function hasFlag(args: Array<string>, name: string): boolean {
  return args.some((arg: string): boolean => {
    // kubectl reads "_" as "-" in a long flag name.
    const normalized: string = arg.replace(/_/g, "-");
    return normalized === `--${name}` || normalized.startsWith(`--${name}=`);
  });
}

/*
 * KubectlWriteScope words its refusals for the Runner it was written for
 * ("this Runner only lets OneUptime AI change ...", the chart's aiAccess.*
 * values, the Runner's pod-namespace variable). The file is a byte-identical
 * copy of the server's and must not be edited here, so its sentences are
 * re-worded for the agent instead.
 */
export function rewordScopeRefusalForAgent(reason: string): string {
  return reason
    .replace(/\bThis Runner\b/g, "This agent")
    .replace(/\bthis Runner\b/g, "this agent")
    .replace(/\baiAccess\.remediation\./g, "aiAgent.remediation.")
    .split(RUNNER_POD_NAMESPACE_ENV)
    .join(AI_AGENT_POD_NAMESPACE_ENV);
}

export interface KubectlExecutorSettings {
  // The chart's clusterName: the only cluster this agent runs commands for.
  clusterName: string;
  allowWrites: boolean;
  // The write switch exactly as set (null when unset), for messages.
  allowWritesSetting: string | null;
  /*
   * Writes are off because fixes are off in the agent's configuration
   * (ONEUPTIME_AI_FIXES), not because it was installed read-only — for the
   * refusal's message. Absent reads as false.
   */
  writesOffByFixes?: boolean | undefined;
  allowNodeOperations: boolean;
  allowNodeOperationsSetting: string | null;
  // Lowercased; empty means cluster-wide.
  writeNamespaces: Array<string>;
  // The pod's own namespace (configured, else the mount's), or null.
  podNamespace: string | null;
  /*
   * The environment the agent runs in: KUBERNETES_SERVICE_HOST/PORT for the
   * API server, PATH to find kubectl. Nothing else of it reaches kubectl.
   */
  env: NodeJS.ProcessEnv;
  serviceAccount: ServiceAccountPaths;
  kubectlBinary?: string | undefined;
  // The parent of the private job directories; os.tmpdir() by default.
  tmpDir?: string | undefined;
  maxOutputBytes?: number | undefined;
}

export interface KubectlCommandRequest {
  payload: Record<string, unknown>;
  timeoutInMs: number;
  origin: string;
}

// A command checked and ready to spawn, or refused before anything ran.
export type PreparedKubectlCommand =
  | { refusal: string }
  | {
      refusal: null;
      displayCommand: string;
      tier: KubectlCommandTier;
      run: () => Promise<KubectlExecResult>;
    };

export default class KubectlExecutor {
  // Job directories of commands running right now.
  private readonly activeJobDirs: Set<string> = new Set<string>();

  public constructor(private readonly settings: KubectlExecutorSettings) {}

  public getSettings(): KubectlExecutorSettings {
    return this.settings;
  }

  /*
   * Every check that decides whether the command may run, before anything
   * spawns. A refusal carries no exit code and no output, which is how the
   * server reads "did not run".
   */
  public prepare(request: KubectlCommandRequest): PreparedKubectlCommand {
    const rawArgs: unknown = request.payload["args"];

    if (
      !Array.isArray(rawArgs) ||
      rawArgs.length === 0 ||
      rawArgs.some((arg: unknown): boolean => {
        return typeof arg !== "string";
      })
    ) {
      return {
        refusal: `${REFUSED}: the job arrived without a kubectl command to run.`,
      };
    }

    const args: Array<string> = rawArgs as Array<string>;

    // ---- The agent's own guard, before and independent of the policy. ----

    const guardRefusal: string | null = KubectlArgvGuard.getRefusalReason(args);

    if (guardRefusal) {
      return { refusal: `${REFUSED}: ${guardRefusal}.` };
    }

    // ---- Policy, re-evaluated here on the argv itself. ----

    const policy: KubectlPolicyResult = KubectlPolicy.evaluateArgs(args);

    if (policy.tier === KubectlCommandTier.Denied) {
      return { refusal: `${REFUSED}: ${policy.reason}.` };
    }

    if (
      request.origin === RunnerJobOrigin.AiInvestigation &&
      policy.tier !== KubectlCommandTier.Read
    ) {
      return {
        refusal: `${REFUSED}: an investigation may only run read-only kubectl, and "${policy.displayCommand}" is ${policy.tier}.`,
      };
    }

    if (policy.tier !== KubectlCommandTier.Read && !this.settings.allowWrites) {
      return { refusal: this.describeWritesRefused(policy.displayCommand) };
    }

    /*
     * ---- Where a write may land, and whether it may change nodes. ----
     *
     * The same write-scope rule the server applies with the posture this
     * agent reports. usesCredential is false: the kubeconfig names the
     * pod's own namespace, so a command without -n lands there — exactly
     * what KubectlWriteScope assumes for the in-cluster path.
     */
    const scopeRefusal: KubectlWriteScopeRefusal | null =
      KubectlWriteScope.getRefusal({
        command: policy,
        writeNamespaces: this.settings.writeNamespaces,
        podNamespace: this.settings.podNamespace,
        allowNodeOperations: this.settings.allowNodeOperations,
        usesCredential: false,
      });

    if (scopeRefusal) {
      return {
        refusal:
          scopeRefusal.code === "node_operations"
            ? this.describeNodeOperationsRefused({
                displayCommand: policy.displayCommand,
                uncertainty: scopeRefusal.uncertainty,
              })
            : `${REFUSED}: ${rewordScopeRefusalForAgent(scopeRefusal.reason)}`,
      };
    }

    /*
     * ---- The cluster. ----
     *
     * The server only routes a job to the agent of the cluster it targets,
     * but this binary is the last thing before the pod's ServiceAccount and
     * does not trust that routing: the pod cannot tell which cluster it is
     * in, so the name it was installed with is the one fact it can check a
     * job against. Anything but an exact (case-insensitive) match —
     * including a blank on either side — is refused.
     */
    const jobCluster: string = getPayloadClusterIdentifier(request.payload);
    const ownCluster: string = normalizeKubernetesClusterIdentifier(
      this.settings.clusterName,
    );

    if (!isSameKubernetesClusterIdentifier(jobCluster, ownCluster)) {
      return {
        refusal: `${REFUSED}: this command is for cluster "${
          jobCluster || "(not specified)"
        }", but this agent serves cluster "${
          ownCluster || "(not specified)"
        }". Check clusterName on the Kubernetes agent chart installed in that cluster.`,
      };
    }

    const apiServer: InClusterApiServer | null = getInClusterApiServer(
      this.settings.env,
    );
    const inClusterRefusal: string | null =
      this.getInClusterAccessRefusal(apiServer);

    if (inClusterRefusal || !apiServer) {
      return { refusal: inClusterRefusal || REFUSED };
    }

    return {
      refusal: null,
      displayCommand: policy.displayCommand,
      tier: policy.tier,
      run: (): Promise<KubectlExecResult> => {
        return this.run({
          args,
          apiServer,
          timeoutInMs: request.timeoutInMs,
        });
      },
    };
  }

  // prepare() then run, reporting a refusal as a failed result.
  public async execute(
    request: KubectlCommandRequest,
  ): Promise<KubectlExecResult> {
    const prepared: PreparedKubectlCommand = this.prepare(request);

    if (prepared.refusal !== null) {
      return { success: false, output: "", errorMessage: prepared.refusal };
    }

    return prepared.run();
  }

  /*
   * Why this pod cannot run kubectl with its own ServiceAccount, or null
   * when it can: kubectl needs the in-cluster API server address and the
   * mounted token and CA. Said before kubectl runs, so the operator sees
   * the actual cause (automountServiceAccountToken turned off, say) rather
   * than a connection error.
   */
  public getInClusterAccessRefusal(
    apiServer: InClusterApiServer | null,
  ): string | null {
    if (!apiServer) {
      return `${REFUSED}: KUBERNETES_SERVICE_HOST / KUBERNETES_SERVICE_PORT are not set, so it cannot find the cluster's API server. The agent must run as a pod inside the cluster it serves.`;
    }

    for (const file of [
      this.settings.serviceAccount.token,
      this.settings.serviceAccount.ca,
    ]) {
      if (!isFile(file)) {
        return `${REFUSED}: ${file} is not mounted in this pod, so kubectl cannot use the pod's ServiceAccount. Make sure automountServiceAccountToken is not false on the pod or its ServiceAccount.`;
      }
    }

    return null;
  }

  /*
   * The pod's own ServiceAccount as an explicit kubeconfig, never left to
   * kubectl's implicit in-cluster fallback: client-go only falls back to
   * the in-cluster config when the merged client config equals its built-in
   * default, so ANY flag that changes the client config — the
   * --request-timeout this executor adds, or one an AI-composed command
   * carries — made kubectl skip the pod's ServiceAccount and dial
   * http://localhost:8080 ("The connection to the server localhost:8080 was
   * refused").
   *
   * The token and CA are referenced by path, never copied: the kubelet
   * rotates the projected token in place and kubectl re-reads tokenFile, so
   * no bearer token is ever written to disk. The context namespace is the
   * pod's own, so a command without -n lands where KubectlWriteScope
   * assumes it does.
   */
  public static buildInClusterKubeconfig(data: {
    apiServer: InClusterApiServer;
    namespace: string | null;
    serviceAccount: ServiceAccountPaths;
  }): string {
    return [
      "apiVersion: v1",
      "kind: Config",
      "clusters:",
      "- name: in-cluster",
      "  cluster:",
      `    server: ${JSON.stringify(formatInClusterServerUrl(data.apiServer))}`,
      `    certificate-authority: ${JSON.stringify(data.serviceAccount.ca)}`,
      "users:",
      "- name: in-cluster",
      "  user:",
      `    tokenFile: ${JSON.stringify(data.serviceAccount.token)}`,
      "contexts:",
      "- name: in-cluster",
      "  context:",
      "    cluster: in-cluster",
      "    user: in-cluster",
      data.namespace ? `    namespace: ${JSON.stringify(data.namespace)}` : "",
      "current-context: in-cluster",
    ]
      .filter((line: string): boolean => {
        return line !== "";
      })
      .join("\n")
      .concat("\n");
  }

  /*
   * The environment kubectl runs with: a closed allowlist built from nothing
   * but what the command needs, whatever the agent's own environment holds.
   *
   *   - PATH, to find kubectl.
   *   - HOME: the command's private, empty directory, so kubectl never
   *     finds ~/.kube/config or ~/.kube/kuberc; KUBECACHEDIR beside it.
   *   - KUBERC=off and KUBECTL_KUBERC=false: kubectl 1.33+ reads a kuberc
   *     preferences file (aliases, default flags) — it must never rewrite an
   *     argv the policy already approved.
   *   - KUBECONFIG = the command's private kubeconfig (also on the argv as
   *     --kubeconfig).
   *
   * No KUBERNETES_SERVICE_* (kubectl must never fall back to an implicit
   * config of its own choosing) and no proxy variables (the API server is
   * the pod's own service address; a proxy set for reaching OneUptime would
   * only get in its way).
   */
  public static buildSpawnEnv(data: {
    path: string | undefined;
    homeDir: string;
    cacheDir: string;
    kubeconfigPath: string;
  }): NodeJS.ProcessEnv {
    return {
      PATH: data.path || "/usr/local/bin:/usr/bin:/bin",
      HOME: data.homeDir,
      KUBECACHEDIR: data.cacheDir,
      KUBERC: "off",
      KUBECTL_KUBERC: "false",
      KUBECONFIG: data.kubeconfigPath,
    };
  }

  // ---- Job directory lifecycle. ----

  public getJobDirParent(): string {
    return path.join(this.settings.tmpDir || os.tmpdir(), JOB_DIR_PARENT_NAME);
  }

  // Test seam: which job directories are in flight right now.
  public getActiveJobDirs(): Array<string> {
    return Array.from(this.activeJobDirs);
  }

  /*
   * Remove every job directory no command running in this process owns. At
   * start-up nothing is active, so this is "everything a previous life left
   * behind". Best effort: a directory that cannot be removed is logged.
   */
  public sweepOrphanedJobDirs(): number {
    const parent: string = this.getJobDirParent();
    let removed: number = 0;

    let entries: Array<string>;
    try {
      entries = fs.readdirSync(parent);
    } catch {
      return 0;
    }

    for (const entry of entries) {
      const dir: string = path.join(parent, entry);

      if (this.activeJobDirs.has(dir)) {
        continue;
      }

      try {
        fs.rmSync(dir, { recursive: true, force: true });
        removed++;
      } catch (err: unknown) {
        Logger.warn("could not remove an abandoned kubectl job directory", {
          dir,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return removed;
  }

  /*
   * Shutdown: remove the directories of commands still running as well as
   * any orphans. kubectl reads its kubeconfig once at start, so taking it
   * away from a command that is already running does not break it.
   */
  public removeAllJobDirs(): number {
    let removed: number = 0;

    for (const dir of Array.from(this.activeJobDirs)) {
      this.cleanup(dir);
      removed++;
    }

    return removed + this.sweepOrphanedJobDirs();
  }

  private describeWritesRefused(displayCommand: string): string {
    if (this.settings.writesOffByFixes) {
      return `${REFUSED}: "${displayCommand}" changes the cluster, and AI fixes are off in this agent's configuration (${AI_FIXES_ENV}=${AGENT_AI_FIXES_SETTING_VALUES.Disabled}). To let OneUptime AI apply fixes, upgrade the Kubernetes agent chart with --set aiAgent.fixes=${AGENT_AI_FIXES_SETTING_VALUES.RequireApproval} (or ${AGENT_AI_FIXES_SETTING_VALUES.Automatic}, or ${AGENT_AI_FIXES_SETTING_VALUES.BypassApproval}).`;
    }

    const setting: string | null = this.settings.allowWritesSetting;
    const current: string =
      setting === null || setting.trim() === ""
        ? `${KUBECTL_ALLOW_WRITES_ENV} is not set`
        : `${KUBECTL_ALLOW_WRITES_ENV}="${setting}"`;

    return `${REFUSED}: "${displayCommand}" changes the cluster, and this agent was installed read-only (${current}). To let OneUptime AI apply fixes, upgrade the Kubernetes agent chart with --set aiAgent.fixes=${AGENT_AI_FIXES_SETTING_VALUES.RequireApproval}.`;
  }

  private describeNodeOperationsRefused(data: {
    displayCommand: string;
    uncertainty: string | null;
  }): string {
    const setting: string | null = this.settings.allowNodeOperationsSetting;
    const current: string =
      setting === null || setting.trim() === ""
        ? `${KUBECTL_ALLOW_NODE_OPERATIONS_ENV} is not set`
        : `${KUBECTL_ALLOW_NODE_OPERATIONS_ENV}="${setting}"`;

    const what: string =
      data.uncertainty === null
        ? `"${data.displayCommand}" is a node operation (cordon, uncordon, drain, taint, or a change to a Node object)`
        : `this agent cannot tell for certain whether "${data.displayCommand}" changes a node (${data.uncertainty})`;

    return `${REFUSED}: ${what}, and node operations are off for this agent (${current}). To allow them, upgrade the Kubernetes agent chart with --set aiAgent.remediation.nodeOperations=true; other fixes are unaffected.`;
  }

  private async run(data: {
    args: Array<string>;
    apiServer: InClusterApiServer;
    timeoutInMs: number;
  }): Promise<KubectlExecResult> {
    let jobDir: string | null = null;
    let kubeconfigPath: string;

    /*
     * Every command gets its own private directory — its kubeconfig, an
     * empty HOME and a discovery cache — so nothing another command or a
     * previous life of this process left on disk can shape what kubectl
     * does.
     */
    try {
      jobDir = this.createJobDir();
      kubeconfigPath = path.join(jobDir, JOB_KUBECONFIG_FILE_NAME);

      fs.writeFileSync(
        kubeconfigPath,
        KubectlExecutor.buildInClusterKubeconfig({
          apiServer: data.apiServer,
          namespace: this.settings.podNamespace,
          serviceAccount: this.settings.serviceAccount,
        }),
        { mode: 0o600 },
      );
    } catch (err: unknown) {
      this.cleanup(jobDir);
      return {
        success: false,
        output: "",
        errorMessage: `Could not prepare the kubeconfig for kubectl: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }

    const finalArgs: Array<string> = ["--kubeconfig", kubeconfigPath];

    /*
     * Bound every API call so a hung watch or a slow API server cannot hold
     * the job open past its lease — and end it well before the process
     * timeout, so kubectl can say what went wrong before it is killed. A
     * --request-timeout the command already carries is kept as it is.
     */
    if (!hasFlag(data.args, "request-timeout")) {
      finalArgs.push(
        `--request-timeout=${formatRequestTimeout(
          getRequestTimeoutMs(data.timeoutInMs),
        )}`,
      );
    }

    finalArgs.push(...data.args);

    try {
      return await this.spawnKubectl({
        args: finalArgs,
        timeoutInMs: data.timeoutInMs,
        homeDir: path.join(jobDir, JOB_HOME_DIR_NAME),
        cacheDir: path.join(jobDir, JOB_CACHE_DIR_NAME),
        kubeconfigPath,
      });
    } finally {
      this.cleanup(jobDir);
    }
  }

  /*
   * A fresh private directory for one command, under a parent this process
   * owns and nobody else can read. The parent is checked on every use: a
   * pre-existing directory owned by another user would let that user
   * rename or replace entries under it, so it is refused outright.
   */
  private createJobDir(): string {
    const parent: string = this.getJobDirParent();

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
        `${parent} is owned by another user (uid ${stat.uid}); refusing to write a kubeconfig under it.`,
      );
    }

    // mkdir's mode is subject to the umask; make the directory private regardless.
    if ((stat.mode & 0o077) !== 0) {
      fs.chmodSync(parent, PRIVATE_DIR_MODE);
    }

    const dir: string = fs.mkdtempSync(path.join(parent, JOB_DIR_PREFIX));
    this.activeJobDirs.add(dir);

    try {
      fs.chmodSync(dir, PRIVATE_DIR_MODE);
      fs.mkdirSync(path.join(dir, JOB_HOME_DIR_NAME), {
        mode: PRIVATE_DIR_MODE,
      });
    } catch (err: unknown) {
      this.cleanup(dir);
      throw err;
    }

    return dir;
  }

  private spawnKubectl(data: {
    args: Array<string>;
    timeoutInMs: number;
    homeDir: string;
    cacheDir: string;
    kubeconfigPath: string;
  }): Promise<KubectlExecResult> {
    const maxOutputBytes: number =
      this.settings.maxOutputBytes ?? MAX_OUTPUT_BYTES;

    return new Promise<KubectlExecResult>(
      (resolve: (value: KubectlExecResult) => void): void => {
        const stdoutChunks: Array<Buffer> = [];
        let stdoutBytes: number = 0;
        let stdoutTruncated: boolean = false;
        // Only the tail of stderr is kept: kubectl's error is at the end.
        let stderrTail: Buffer = Buffer.alloc(0);
        let stderrTruncated: boolean = false;
        let settled: boolean = false;

        let child: ReturnType<typeof spawn>;

        try {
          child = spawn(
            this.settings.kubectlBinary || DEFAULT_KUBECTL_BINARY,
            data.args,
            {
              timeout: data.timeoutInMs,
              killSignal: "SIGKILL",
              // No stdin: kubectl must never wait for input.
              stdio: ["ignore", "pipe", "pipe"],
              env: KubectlExecutor.buildSpawnEnv({
                path: this.settings.env["PATH"],
                homeDir: data.homeDir,
                cacheDir: data.cacheDir,
                kubeconfigPath: data.kubeconfigPath,
              }),
              cwd: data.homeDir,
            },
          );
        } catch (err: unknown) {
          resolve({
            success: false,
            output: "",
            errorMessage: err instanceof Error ? err.message : String(err),
          });
          return;
        }

        child.stdout?.on("data", (chunk: Buffer): void => {
          if (stdoutBytes < maxOutputBytes) {
            stdoutChunks.push(chunk);
            stdoutBytes += chunk.length;
          } else {
            stdoutTruncated = true;
          }
        });

        child.stderr?.on("data", (chunk: Buffer): void => {
          stderrTail = Buffer.concat([stderrTail, chunk]);

          if (stderrTail.length > STDERR_MAX_BYTES * 2) {
            stderrTail = stderrTail.subarray(
              stderrTail.length - STDERR_MAX_BYTES,
            );
            stderrTruncated = true;
          }
        });

        child.on("error", (err: Error & { code?: string }): void => {
          if (settled) {
            return;
          }
          settled = true;
          resolve({
            success: false,
            output: "",
            errorMessage:
              err.code === "ENOENT"
                ? "kubectl is not installed in this container. Use the oneuptime/kubernetes-ai-agent image, which includes kubectl."
                : err.message,
          });
        });

        child.on(
          "close",
          (code: number | null, signal: NodeJS.Signals | null): void => {
            if (settled) {
              return;
            }
            settled = true;

            const stdout: string = replaceNulCharacters(
              Buffer.concat(stdoutChunks).toString("utf8"),
            );
            const stderr: string = replaceNulCharacters(
              stderrTail.toString("utf8"),
            );
            const output: string = formatKubectlOutput({
              stdout,
              stderr,
              stdoutTruncated,
              stderrTruncated,
              maxOutputBytes,
            });

            if (signal === "SIGKILL") {
              resolve({
                success: false,
                output,
                errorMessage: KubectlExecutor.describeKill({
                  timeoutInMs: data.timeoutInMs,
                  producedOutput: stdout.trim() !== "" || stderr.trim() !== "",
                }),
              });
              return;
            }

            if (code === 0) {
              resolve({ success: true, output, exitCode: 0 });
              return;
            }

            const reason: string = lastStderrLine(stderr);

            resolve({
              success: false,
              output,
              ...(code === null ? {} : { exitCode: code }),
              errorMessage: `Exit code ${code ?? "?"}${reason ? `: ${reason}` : ""}`,
            });
          },
        );
      },
    );
  }

  /*
   * A kill on timeout. With output, the output says what kubectl was doing.
   * With none at all, kubectl never heard back from the API server even
   * though every request was bounded well inside this budget — which in a
   * pod is nearly always a network policy between the agent and the API
   * server, not a slow cluster.
   */
  public static describeKill(data: {
    timeoutInMs: number;
    producedOutput: boolean;
  }): string {
    const killed: string = `Killed (timeout ${data.timeoutInMs}ms)`;

    if (data.producedOutput) {
      return killed;
    }

    return `${killed}: kubectl produced no output at all, so the in-cluster Kubernetes API server is probably unreachable from this agent. Check network policies that apply to the agent's pod.`;
  }

  private cleanup(dir: string | null): void {
    if (!dir) {
      return;
    }

    this.activeJobDirs.delete(dir);

    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Best effort — the start-up sweep gets a second chance at it.
    }
  }
}
