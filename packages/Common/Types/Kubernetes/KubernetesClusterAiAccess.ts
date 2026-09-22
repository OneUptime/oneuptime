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
 * Automatic:       AI runs safe changes without a human — each on ONE named
 *                  object: rollout restart/undo/pause/resume of one workload,
 *                  scale one workload above zero, delete one named pod,
 *                  cordon/uncordon one node, label/annotate one pod or
 *                  workload with unreserved keys. A riskier change (patch,
 *                  set image, drain, scale to zero, deleting workloads or
 *                  jobs, anything touching several objects) never runs
 *                  without one: when the round could only find riskier fixes
 *                  it ends by proposing exactly those for one-click
 *                  approval; when it also ran safe fixes, a riskier fix is
 *                  proposed only if verification shows the safe ones did not
 *                  recover the signal (the follow-up round, which asks).
 *                  Shapes on the cluster's kubectl allowlist run on their
 *                  own.
 * BypassApproval:  AI does not ask. Every change the policy allows — safe
 *                  AND riskier — runs on its own, follow-up rounds included.
 *
 * In EVERY mode, Bypass approval included: destructive commands (Denied
 * tier) never run; a write in a protected namespace (kube-system,
 * kube-public, kube-node-lease) and a node drain always need a human; the
 * in-cluster Runner never changes its own namespace; and the hourly
 * per-cluster circuit breaker turns an unattended run into a proposal.
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
 * SafeWrite:  a reversible, controller-mediated change to exactly ONE named
 *             object of one built-in kind, with no selector and outside the
 *             protected namespaces. Automatic mode runs these without a
 *             human.
 * RiskyWrite: a change that can alter what is deployed or affect many pods
 *             at once. Needs a human unless the operator allowlisted the
 *             exact shape on the cluster or the cluster bypasses approvals
 *             (never for protected namespaces or a drain).
 * Denied:     never runs, even with human approval (exec/cp/port-forward,
 *             deleting namespaces/volumes/nodes/CRDs, RBAC grants, patches
 *             to pod identity or host access, credential flags, ...).
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
  /*
   * The bound Runner runs inside a cluster, but not THIS one (or it never
   * said which). Its ServiceAccount would run kubectl against whatever
   * cluster its pod lives in, so in-cluster access is refused for it.
   */
  | "runner_cluster_mismatch"
  | "credential_missing"
  /*
   * A Kubernetes credential is selected for this cluster, but the bound
   * Runner is a kubernetes-agent Runner (of another cluster). Such a Runner
   * is minted with the telemetry ingestion key, so it is never handed
   * credential material: a cross-cluster credential needs a Runner created
   * in the dashboard.
   */
  | "credential_on_agent_runner"
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
  /*
   * The namespaces the Runner lets AI-composed kubectl writes into
   * (KUBECTL_WRITE_NAMESPACES_ENV). An empty list means cluster-wide;
   * absent means the Runner predates the setting and did not say.
   */
  writeNamespaces?: Array<string> | undefined;
  /*
   * The namespace the Runner pod itself runs in (RUNNER_POD_NAMESPACE_ENV).
   * The Runner never writes into it.
   */
  podNamespace?: string | undefined;
  /*
   * Whether the Runner may run node operations — cordon, uncordon, drain,
   * taint, and label/annotate/patch on Node objects
   * (KUBECTL_ALLOW_NODE_OPERATIONS_ENV, from the chart's
   * aiAccess.remediation.nodeOperations). Absent means the Runner did not
   * say, which older Runners and Runners outside the chart never do.
   */
  allowNodeOperations?: boolean | undefined;
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
 * Is this Runner row one the kubernetes-agent chart registered (and an
 * ingestion key can therefore mint a key for)? Decided from the row NAME,
 * which only the server writes at registration — never from hostInfo
 * posture, which the Runner itself rewrites on every heartbeat. Such a row
 * runs kubectl with its own ServiceAccount only: it is never a Bash/SSH
 * host and is never handed a credential.
 */
export function isKubernetesAgentRunnerName(name: unknown): boolean {
  return (
    typeof name === "string" &&
    name.startsWith(`${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/`)
  );
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
    writeNamespaces: Array.isArray(raw["writeNamespaces"])
      ? (raw["writeNamespaces"] as Array<unknown>).filter(
          (namespace: unknown): namespace is string => {
            return typeof namespace === "string" && namespace.length > 0;
          },
        )
      : undefined,
    podNamespace:
      typeof raw["podNamespace"] === "string" && raw["podNamespace"].length > 0
        ? raw["podNamespace"]
        : undefined,
    allowNodeOperations:
      typeof raw["allowNodeOperations"] === "boolean"
        ? raw["allowNodeOperations"]
        : undefined,
  };
}

/*
 * Cluster identifiers come from three places that do not agree on casing:
 * the k8s.cluster.name resource attribute telemetry stamps on the cluster
 * row, the chart's clusterName value the Runner registers with, and whatever
 * an operator typed. The cluster row itself is looked up case-insensitively
 * (KubernetesClusterService.findOrCreateByClusterIdentifier), so every
 * "is this the same cluster?" decision must use the same rule — a Runner
 * that says "Prod-US" IS the Runner for the "prod-us" row.
 */
export function normalizeKubernetesClusterIdentifier(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/*
 * True only when BOTH identifiers are present and name the same cluster.
 * Two blanks are never "the same cluster": a Runner that did not say which
 * cluster it is in must never match a cluster row that has no identifier.
 */
export function isSameKubernetesClusterIdentifier(
  a: unknown,
  b: unknown,
): boolean {
  const left: string = normalizeKubernetesClusterIdentifier(a);
  const right: string = normalizeKubernetesClusterIdentifier(b);

  return left.length > 0 && right.length > 0 && left === right;
}

/*
 * The posture of the Runner the kubernetes-agent chart installs: it runs in
 * a pod AND it registered with the name of the cluster that pod is in. An
 * ordinary project Runner that merely happens to live in a pod has no
 * cluster identity and must never be treated as any cluster's agent.
 */
export function isKubernetesAgentRunnerPosture(
  posture: KubernetesRunnerPosture | undefined,
): boolean {
  return Boolean(
    posture?.inCluster === true &&
      normalizeKubernetesClusterIdentifier(posture.clusterIdentifier).length >
        0,
  );
}

/*
 * May this Runner run credential-less kubectl (its own ServiceAccount) for
 * the cluster named by `clusterIdentifier`? Only the in-cluster Runner OF
 * THAT CLUSTER. This is the single rule behind the cluster's readiness
 * status, the enqueue chokepoint and the claim path — a job for cluster A
 * must never be served to a pod living in cluster B, whatever the
 * dashboard was told.
 */
export function isInClusterPostureForCluster(
  posture: KubernetesRunnerPosture | undefined,
  clusterIdentifier: unknown,
): boolean {
  return (
    isKubernetesAgentRunnerPosture(posture) &&
    isSameKubernetesClusterIdentifier(
      posture?.clusterIdentifier,
      clusterIdentifier,
    )
  );
}

/*
 * What registration did about the cluster's Runner binding — returned to
 * the registering pod so it can log the right thing, and recorded on the
 * cluster feed.
 *
 * first_bind:                       the cluster had never been AI-configured
 *                                   and never had a Runner bound; the agent
 *                                   Runner was bound and the chart's defaults
 *                                   applied.
 * bound_keeping_operator_settings:  no Runner had ever been bound, but an
 *                                   operator had already chosen AI settings
 *                                   on the cluster's AI page (for example a
 *                                   remediation mode, before installing the
 *                                   chart); the agent Runner was bound and
 *                                   every switch left exactly as chosen.
 * already_bound:                    the cluster was already bound to this
 *                                   cluster's agent Runner; only the key (and
 *                                   posture) rotated.
 * bound_to_other_runner:            an operator bound the cluster to a
 *                                   different Runner in the dashboard; left
 *                                   alone.
 * left_unbound_by_operator:         a Runner was bound to this cluster
 *                                   before and no Runner is bound now — an
 *                                   operator cleared the binding, or the
 *                                   bound Runner row was deleted (the
 *                                   foreign key nulls it). Registration does
 *                                   not re-bind or flip any switch; the agent
 *                                   Runner row exists and heartbeats, and the
 *                                   operator selects it on the cluster's AI
 *                                   page when they want it back.
 */
export type KubernetesAgentRunnerBindingState =
  | "first_bind"
  | "bound_keeping_operator_settings"
  | "already_bound"
  | "bound_to_other_runner"
  | "left_unbound_by_operator";

// Caps shared by the investigation tool and the remediation toolkit.
export const MAX_KUBECTL_COMMANDS_PER_INVESTIGATION: number = 8;
export const DEFAULT_KUBECTL_TIMEOUT_MS: number = 30 * 1000;
export const MAX_KUBECTL_TIMEOUT_MS: number = 2 * 60 * 1000;
export const MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM: number = 8000;

/*
 * Namespaces OneUptime AI never changes without a human, in every mode —
 * Bypass approval and the cluster allowlist included. A write here can take
 * down cluster DNS, networking or the control plane's own bookkeeping, and
 * RBAC cannot express "every namespace except these", so the policy holds
 * the line: a write whose namespace is one of these is never auto-approved.
 */
export const PROTECTED_KUBERNETES_NAMESPACES: ReadonlyArray<string> = [
  "kube-system",
  "kube-public",
  "kube-node-lease",
];

export function isProtectedKubernetesNamespace(namespace: unknown): boolean {
  return (
    typeof namespace === "string" &&
    PROTECTED_KUBERNETES_NAMESPACES.includes(namespace.trim().toLowerCase())
  );
}

/*
 * Environment the kubernetes-agent chart sets on the in-cluster Runner. The
 * chart and the Runner must agree on these names, so they live here.
 *
 * ALLOW_WRITES:     "true" only when the chart granted write RBAC.
 * WRITE_NAMESPACES: comma-separated namespaces the chart bound write RBAC in
 *                   (aiAccess.remediation.namespaces). Empty or unset means
 *                   cluster-wide. The Runner refuses a write outside the
 *                   list before spawning kubectl.
 * POD_NAMESPACE:    the namespace the Runner pod itself runs in (downward
 *                   API). The Runner never changes its own namespace — a
 *                   fix there could scale the agent, or the Runner, away.
 * ALLOW_NODE_OPERATIONS: "true" when the chart granted node RBAC
 *                   (aiAccess.remediation.nodeOperations): cordon,
 *                   uncordon, drain, taint and label/annotate/patch on Node
 *                   objects. Same rule as ALLOW_WRITES: when set, only
 *                   "true" allows them; unset allows them on an ordinary
 *                   Runner (its credential's RBAC bounds them) and refuses
 *                   them on the kubernetes-agent Runner, whose chart always
 *                   sets it. The Runner reports the result in its posture
 *                   so the server never plans a node change it would refuse.
 */
export const KUBECTL_ALLOW_WRITES_ENV: string =
  "ONEUPTIME_KUBECTL_ALLOW_WRITES";
export const KUBECTL_WRITE_NAMESPACES_ENV: string =
  "ONEUPTIME_KUBECTL_WRITE_NAMESPACES";
export const RUNNER_POD_NAMESPACE_ENV: string =
  "ONEUPTIME_RUNNER_POD_NAMESPACE";
export const KUBECTL_ALLOW_NODE_OPERATIONS_ENV: string =
  "ONEUPTIME_KUBECTL_ALLOW_NODE_OPERATIONS";

/*
 * Why POST /runner-ingest/register-kubernetes-agent refused a registration
 * (HTTP 403). The server sends it as `reason` in the JSON error body so the
 * Runner can tell a wait that clears on its own from one that needs an
 * operator, instead of reading every 403 as the first kind.
 *
 * previous_instance_online:          the agent Runner row's current instance
 *                                    still heartbeats and this request did
 *                                    not present its key. Clears on its own;
 *                                    the body carries retryAfterSeconds (and
 *                                    the response a Retry-After header).
 * runner_holds_more_than_defaults:   the offline row holds credentials,
 *                                    secrets, extra capabilities or another
 *                                    cluster's binding, so only a request
 *                                    that proves continuity may re-key it.
 *                                    Needs an operator.
 * runner_belongs_to_another_cluster: the row this cluster's agent Runner
 *                                    name resolves to is another cluster's.
 *                                    Needs an operator.
 */
export type KubernetesAgentRegistrationRefusalReason =
  | "previous_instance_online"
  | "runner_holds_more_than_defaults"
  | "runner_belongs_to_another_cluster";

// Refusals that clear without anyone doing anything; retrying is right.
export function isTransientKubernetesAgentRegistrationRefusal(
  reason: unknown,
): boolean {
  return reason === "previous_instance_online";
}
