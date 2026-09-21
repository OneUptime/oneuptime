/*
 * OneUptime AI access to a Kubernetes cluster.
 *
 * A cluster's AI page binds one Runner (in-cluster, installed by the
 * kubernetes-agent chart, or an existing Runner plus a Kubernetes
 * credential) and two switches: whether AI may run read-only kubectl during
 * investigations, and how AI may remediate. Everything here is shared by the
 * server, the Runner binary and the dashboard so the three never disagree
 * about what a mode or a tier means.
 */

/*
 * How OneUptime AI may change a cluster once it has diagnosed a signal.
 *
 * Disabled:        AI never proposes or runs a change on this cluster.
 * RequireApproval: AI composes a kubectl plan and a human approves it with
 *                  one click before anything runs. Any follow-up plan asks
 *                  again.
 * Automatic:       AI runs safe changes (rollout restart/undo, scale, delete
 *                  a named pod, cordon/uncordon, label/annotate) without a
 *                  human. Riskier changes (patch, set image, drain, deleting
 *                  workloads) still ask for approval unless the cluster's
 *                  allowlist names them; destructive commands never run.
 * BypassApproval:  AI never asks. Every change the policy allows — safe AND
 *                  riskier — runs on its own, follow-up rounds included.
 *                  Destructive commands (Denied tier) still never run, and
 *                  the hourly per-cluster circuit breaker still applies.
 */
export enum KubernetesAiRemediationMode {
  Disabled = "Disabled",
  RequireApproval = "RequireApproval",
  Automatic = "Automatic",
  BypassApproval = "BypassApproval",
}

// The modes in which OneUptime AI executes changes without a human.
export const UNATTENDED_REMEDIATION_MODES: Array<KubernetesAiRemediationMode> =
  [
    KubernetesAiRemediationMode.Automatic,
    KubernetesAiRemediationMode.BypassApproval,
  ];

export function isUnattendedRemediationMode(
  mode: KubernetesAiRemediationMode | undefined,
): boolean {
  return mode !== undefined && UNATTENDED_REMEDIATION_MODES.includes(mode);
}

/*
 * The tier the kubectl command policy assigns to one command. Tiers are the
 * whole safety model: what a run may execute is a function of (tier, mode),
 * never of prose in a prompt.
 *
 * Read:       inspects the cluster and changes nothing (get, describe, logs,
 *             events, top, rollout status, ...). Investigations may run these.
 * SafeWrite:  a reversible, controller-mediated change with a well-understood
 *             blast radius. Automatic mode runs these without a human.
 * RiskyWrite: a change that can alter what is deployed or affect many pods
 *             at once. Always needs a human unless the operator allowlisted
 *             the exact shape on the cluster.
 * Denied:     never runs, even with human approval (exec/cp/port-forward,
 *             deleting namespaces/volumes/nodes/CRDs, credential flags, ...).
 */
export enum KubectlCommandTier {
  Read = "Read",
  SafeWrite = "SafeWrite",
  RiskyWrite = "RiskyWrite",
  Denied = "Denied",
}

/*
 * Why AI cannot (fully) use a cluster right now. Each code renders as one
 * row of the "what is missing" checklist on the cluster's AI page and on the
 * investigation panel, with a next step a human can act on.
 */
export type KubernetesAiAccessGapCode =
  | "no_runner_bound"
  | "runner_missing"
  | "runner_offline"
  | "runner_ai_commands_disabled"
  | "credential_missing"
  | "investigation_disabled"
  | "remediation_disabled"
  | "remediation_write_access_missing"
  | "project_ai_disabled"
  | "project_auto_remediation_disabled"
  | "project_ai_command_execution_disabled"
  | "llm_provider_missing"
  | "last_access_check_failed";

export interface KubernetesAiAccessGap {
  code: KubernetesAiAccessGapCode;
  title: string;
  description: string;
  nextStep: string;
  /*
   * Which capability the gap blocks. A gap that only blocks remediation
   * must not read as "AI cannot investigate" on the investigation panel.
   */
  blocks: "investigation" | "remediation" | "both";
}

/*
 * What the Runner reported about itself the last time it registered or
 * heartbeated. Stored on Runner.hostInfo.kubernetes so the dashboard can say
 * "this Runner is the in-cluster agent for X, kubectl 1.31, writes allowed"
 * without another table.
 */
export interface KubernetesRunnerPosture {
  clusterIdentifier?: string | undefined;
  inCluster?: boolean | undefined;
  allowWrites?: boolean | undefined;
  kubectlVersion?: string | undefined;
  agentChartVersion?: string | undefined;
}

export interface KubernetesAiAccessRunnerSummary {
  id: string;
  name: string;
  isOnline: boolean;
  lastAliveAt?: string | undefined;
  canRunAiCommands: boolean;
  posture?: KubernetesRunnerPosture | undefined;
}

/*
 * The complete answer to "can OneUptime AI reach this cluster, and how?".
 * Computed from current configuration every time it is asked for — it is
 * a readiness check, not a recorded decision.
 */
export interface KubernetesClusterAiAccessStatus {
  clusterId: string;
  clusterName: string;
  clusterIdentifier?: string | undefined;
  runner: KubernetesAiAccessRunnerSummary | null;
  // "in_cluster" when the bound Runner uses its own ServiceAccount.
  accessMethod: "in_cluster" | "credential" | "none";
  // Set with accessMethod "credential": the RunbookCredential the jobs name.
  credentialId?: string | undefined;
  credentialName?: string | undefined;
  /*
   * Operator-authored kubectl patterns that Automatic mode may run without
   * approval even though they are RiskyWrite. Normalized; empty when unset.
   */
  kubectlAllowlist: Array<string>;
  isInvestigationEnabled: boolean;
  // True only when every gap that blocks investigation is absent.
  isInvestigationReady: boolean;
  remediationMode: KubernetesAiRemediationMode;
  // True only when remediation is enabled AND every remediation gap is absent.
  isRemediationReady: boolean;
  gaps: Array<KubernetesAiAccessGap>;
  lastVerifiedAt?: string | undefined;
  lastError?: string | undefined;
  evaluatedAt: string;
}

// Runner rows the kubernetes-agent chart registers are named from this prefix.
export const KUBERNETES_AGENT_RUNNER_NAME_PREFIX: string = "kubernetes-agent";

export function getKubernetesAgentRunnerName(
  clusterIdentifier: string,
): string {
  return `${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/${clusterIdentifier}`;
}

/*
 * The Runner is the only component that ever holds cluster credentials, so
 * the server learns the Runner's write posture from the Runner itself. A
 * Runner installed with read-only RBAC reports allowWrites=false and the
 * server then never enqueues a write for it.
 */
export function parseKubernetesRunnerPosture(
  hostInfo: unknown,
): KubernetesRunnerPosture | undefined {
  if (!hostInfo || typeof hostInfo !== "object") {
    return undefined;
  }

  const kubernetes: unknown = (hostInfo as Record<string, unknown>)[
    "kubernetes"
  ];

  if (!kubernetes || typeof kubernetes !== "object") {
    return undefined;
  }

  const raw: Record<string, unknown> = kubernetes as Record<string, unknown>;

  return {
    clusterIdentifier:
      typeof raw["clusterIdentifier"] === "string"
        ? raw["clusterIdentifier"]
        : undefined,
    inCluster: raw["inCluster"] === true,
    allowWrites: raw["allowWrites"] === true,
    kubectlVersion:
      typeof raw["kubectlVersion"] === "string"
        ? raw["kubectlVersion"]
        : undefined,
    agentChartVersion:
      typeof raw["agentChartVersion"] === "string"
        ? raw["agentChartVersion"]
        : undefined,
  };
}

// Caps shared by the investigation tool and the remediation toolkit.
export const MAX_KUBECTL_COMMANDS_PER_INVESTIGATION: number = 8;
export const DEFAULT_KUBECTL_TIMEOUT_MS: number = 30 * 1000;
export const MAX_KUBECTL_TIMEOUT_MS: number = 2 * 60 * 1000;
export const MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM: number = 8000;
