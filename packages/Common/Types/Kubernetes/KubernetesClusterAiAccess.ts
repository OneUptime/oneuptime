/*
 * OneUptime AI access to a Kubernetes cluster.
 *
 * AI reaches a cluster through one access target: the Kubernetes AI agent
 * the kubernetes-agent chart installs (its own identity, never a Runner), the
 * chart's previous in-cluster Runner, or an existing Runner plus a Kubernetes
 * credential. Two switches decide what AI may do there: whether it may run
 * read-only kubectl during investigations, and how it may remediate.
 * Everything here is shared by the server, the Runner binary, the Kubernetes
 * AI agent and the dashboard so they never disagree about what a mode or a
 * tier means.
 *
 * This file imports only ../AI/AgentAiSettings, which imports nothing, on
 * purpose: the Kubernetes AI agent (agents/KubernetesAIAgent) carries
 * byte-identical copies of both and must compile without the rest of
 * Common.
 */

import {
  AgentAiSettings,
  AgentAiSettingsSource,
  parseReportedAgentAiSettings,
} from "../AI/AgentAiSettings";

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
 *                  set image, drain, taint, scale to zero, deleting
 *                  workloads or jobs, anything touching several objects)
 *                  never runs without one: when the round could only find
 *                  riskier fixes it ends by proposing exactly those for
 *                  one-click approval; when it also ran safe fixes, a
 *                  riskier fix is proposed only if verification shows the
 *                  safe ones did not recover the signal (the follow-up
 *                  round, which asks). Shapes on the cluster's kubectl
 *                  allowlist run on their own.
 * BypassApproval:  AI does not ask. Every change the policy allows — safe
 *                  AND riskier — runs on its own, follow-up rounds included,
 *                  except for what always asks (below).
 *
 * In EVERY mode, Bypass approval included: destructive commands (Denied
 * tier) never run; a write in a protected namespace (kube-system,
 * kube-public, kube-node-lease), a node drain, a node taint and a patch of
 * a Node always need a human; the in-cluster Runner never changes its own
 * namespace or anything outside the namespaces its chart may write; and an
 * unattended run becomes a proposal when the hourly per-cluster circuit
 * breaker trips or another unattended round already holds the cluster.
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
 *             (never for protected namespaces, a drain, a taint or a patch
 *             of a Node).
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
  /*
   * Retired: the project's "Enable auto-remediation" and "Enable AI command
   * execution" switches, both folded into Enable AI (project_ai_disabled).
   * The server no longer produces either; they stay for compatibility.
   */
  | "project_auto_remediation_disabled"
  | "project_ai_command_execution_disabled"
  | "llm_provider_missing"
  | "last_access_check_failed"
  /*
   * Neither the cluster's Kubernetes AI agent nor any Runner can reach the
   * cluster: the agent never registered (the chart was not upgraded, or was
   * installed with aiAgent.enabled=false) and no Runner is bound. Blocks
   * both. Replaces no_runner_bound, which the server no longer produces.
   */
  | "ai_agent_not_connected"
  /*
   * The resolved access target is the cluster's Kubernetes AI agent and it
   * has not been seen within KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES.
   * Blocks both.
   */
  | "ai_agent_offline"
  /*
   * Billing is on, the project's LLM provider is OneUptime's own (which
   * costs AI credits), the balance is used up and auto-recharge is off, so
   * no AI run can start. Blocks both.
   */
  | "ai_balance_insufficient";

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
  /*
   * What the Kubernetes AI agent's configuration lets OneUptime AI do on
   * the cluster (the chart's aiAgent.investigation and aiAgent.fixes; see
   * Types/AI/AgentAiSettings). Present only when the configuration names
   * them: OneUptime then applies them to the cluster, and the AI agent
   * page shows them read-only. Never in a Runner's posture, and absent from
   * an agent configured before these settings existed.
   */
  aiSettings?: AgentAiSettings | undefined;
}

/*
 * What the Kubernetes AI agent reports about itself on registration and on
 * every heartbeat. The same shape as a Runner's posture — the agent is the
 * chart's in-cluster kubectl executor, just with its own identity — but
 * stored BARE on KubernetesAiAgent.posture rather than under
 * hostInfo.kubernetes, so it is parsed with parseKubernetesAgentPosture.
 */
export type KubernetesAgentPosture = KubernetesRunnerPosture;

/*
 * Which kind of access target AI reaches a cluster through.
 *
 * ai_agent: the cluster's Kubernetes AI agent (a KubernetesAiAgent row, never
 *           a Runner). It authenticates to the API server with its own
 *           ServiceAccount, so its accessMethod is "in_cluster".
 * runner:   a Runner row — the chart's previous in-cluster Runner
 *           (accessMethod "in_cluster") or a Runner holding a Kubernetes
 *           credential (accessMethod "credential").
 *
 * accessMethod says how kubectl authenticates; this says which identity runs
 * it. Tell the AI agent and the legacy in-cluster Runner apart ONLY by this.
 */
export type KubernetesAiAccessTargetKind = "ai_agent" | "runner";

/*
 * The access target AI reaches a cluster through. Named "runner" for
 * compatibility: plans and jobs store the target id as runnerId whatever its
 * kind. When the target is the Kubernetes AI agent, id is the
 * KubernetesAiAgent row id, name is KUBERNETES_AI_AGENT_DISPLAY_NAME, kind is
 * "ai_agent" and canRunAiCommands is always true.
 */
export interface KubernetesAiAccessRunnerSummary {
  id: string;
  name: string;
  // Absent means "runner" (every summary built before the AI agent existed).
  kind?: KubernetesAiAccessTargetKind | undefined;
  isOnline: boolean;
  lastAliveAt?: string | undefined;
  canRunAiCommands: boolean;
  posture?: KubernetesRunnerPosture | undefined;
}

/*
 * The kind of an access target summary, defaulting an absent kind to
 * "runner" the way the field is documented.
 */
export function getKubernetesAiAccessTargetKind(
  runner:
    | { kind?: KubernetesAiAccessTargetKind | undefined }
    | null
    | undefined,
): KubernetesAiAccessTargetKind | null {
  if (!runner) {
    return null;
  }

  return runner.kind === "ai_agent" ? "ai_agent" : "runner";
}

/*
 * What the Kubernetes AI agent last told the server about its connection:
 * "connected" from registration and every heartbeat, "disconnected" when it
 * signs off (or an admin resets it). Online additionally needs a heartbeat
 * within KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES.
 */
export type KubernetesAiAgentConnectionStatus = "connected" | "disconnected";

/*
 * The cluster's Kubernetes AI agent as the dashboard shows it, whether or not
 * it is the target AI currently uses (an advanced Runner binding wins over
 * it). Never carries the agent key or its hash.
 */
export interface KubernetesAiAgentSummary {
  id: string;
  isOnline: boolean;
  connectionStatus: KubernetesAiAgentConnectionStatus;
  lastAliveAt?: string | undefined;
  lastRegisteredAt?: string | undefined;
  agentVersion?: string | undefined;
  posture?: KubernetesAgentPosture | undefined;
  /*
   * The last time another agent pod tried to register for this cluster
   * while this one was online, and why it was refused.
   */
  lastRefusedRegistrationAt?: string | undefined;
  lastRefusedRegistrationReason?: string | undefined;
}

/*
 * The project's automatic-investigation opt-ins, shown as a non-blocking
 * line on the cluster's AI agent page. They are project-wide, not per
 * cluster, and never produce a gap.
 */
export interface KubernetesAiAutomaticInvestigationSettings {
  incidents: boolean;
  alerts: boolean;
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
  // The resolved access target (see KubernetesAiAccessRunnerSummary.kind).
  runner: KubernetesAiAccessRunnerSummary | null;
  /*
   * "in_cluster" when the target uses its own ServiceAccount (the
   * Kubernetes AI agent or the chart's previous in-cluster Runner),
   * "credential" when it is a Runner using a Kubernetes credential.
   */
  accessMethod: "in_cluster" | "credential" | "none";
  /*
   * The cluster's Kubernetes AI agent row, whether or not it is the active
   * target; null when no agent ever registered for the cluster.
   */
  aiAgent: KubernetesAiAgentSummary | null;
  /*
   * The project's automatic-investigation opt-ins. Not gaps: the AI agent
   * page shows them as a footer line, because investigating automatically
   * is a project-wide choice, not something this cluster is missing.
   */
  automaticInvestigation: KubernetesAiAutomaticInvestigationSettings;
  // Set with accessMethod "credential": the RunbookCredential the jobs name.
  credentialId?: string | undefined;
  credentialName?: string | undefined;
  /*
   * Operator-authored kubectl patterns that Automatic mode may run without
   * approval even though they are RiskyWrite. Normalized; empty when unset.
   */
  kubectlAllowlist: Array<string>;
  isInvestigationEnabled: boolean;
  /*
   * Where isInvestigationEnabled and remediationMode are set (see
   * AgentAiSettingsSource): "agent" when the cluster's Kubernetes AI agent
   * reports them from its configuration (aiAgent.investigation,
   * aiAgent.fixes) and OneUptime applies them; "oneuptime" otherwise.
   * Absent from a server older than the setting, which reads as
   * "oneuptime".
   */
  aiSettingsSource?: AgentAiSettingsSource | undefined;
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
 * ingestion key can therefore mint a key for)? Decided from the row NAME —
 * never from hostInfo posture, which the Runner itself rewrites on every
 * heartbeat. The name is server-owned: registration writes it, and
 * RunnerService refuses any non-root create under the prefix and any
 * non-root rename into or out of it, case-insensitively — so the check here
 * is case-insensitive too. Such a row runs kubectl with its own
 * ServiceAccount only: it is never a Bash/SSH host and is never handed a
 * credential.
 */
export function isKubernetesAgentRunnerName(name: unknown): boolean {
  return (
    typeof name === "string" &&
    name
      .trim()
      .toLowerCase()
      .startsWith(`${KUBERNETES_AGENT_RUNNER_NAME_PREFIX}/`)
  );
}

/*
 * The in-cluster executor (the Kubernetes AI agent, or a Runner) is the only
 * component that ever holds cluster credentials, so the server learns its
 * write posture from the executor itself. One installed with read-only RBAC
 * reports allowWrites=false and the server then never enqueues a write for
 * it.
 *
 * parseKubernetesAgentPosture reads a BARE posture object: the body the
 * Kubernetes AI agent sends and the KubernetesAiAgent.posture column.
 * parseKubernetesRunnerPosture reads a Runner's hostInfo, where the same
 * object sits under hostInfo.kubernetes. Both validate every field the same
 * way: anything of the wrong type is dropped, never trusted.
 */
export function parseKubernetesAgentPosture(
  raw: unknown,
): KubernetesAgentPosture | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  return parsePostureFields(raw as Record<string, unknown>);
}

export function parseKubernetesRunnerPosture(
  hostInfo: unknown,
): KubernetesRunnerPosture | undefined {
  if (!hostInfo || typeof hostInfo !== "object") {
    return undefined;
  }

  const posture: KubernetesRunnerPosture | undefined =
    parseKubernetesAgentPosture(
      (hostInfo as Record<string, unknown>)["kubernetes"],
    );

  /*
   * Only the Kubernetes AI agent's configuration sets what AI may do on a
   * cluster; a Runner never does, whatever its host info says.
   */
  if (posture) {
    delete posture.aiSettings;
  }

  return posture;
}

function parsePostureFields(
  raw: Record<string, unknown>,
): KubernetesAgentPosture {
  // Reported but unreadable fails closed (parseReportedAgentAiSettings).
  const aiSettings: AgentAiSettings | undefined = parseReportedAgentAiSettings(
    raw["aiSettings"],
  );

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
    // Only when reported: an older agent's posture has no such key.
    ...(aiSettings ? { aiSettings } : {}),
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
 * left_unbound_by_operator:         no Runner is bound now, but one was
 *                                   before or AI already ran kubectl on the
 *                                   cluster — an operator cleared the
 *                                   binding, the bound Runner row was deleted
 *                                   (the foreign key nulls it), or the
 *                                   commands came through the cluster's
 *                                   Kubernetes AI agent. Registration does not
 *                                   re-bind or flip any switch; the Runner
 *                                   row exists and heartbeats, and binding it
 *                                   again (through the API) needs the admin
 *                                   permissions. The Kubernetes AI agent is
 *                                   the way back.
 */
export type KubernetesAgentRunnerBindingState =
  | "first_bind"
  | "bound_keeping_operator_settings"
  | "already_bound"
  | "bound_to_other_runner"
  | "left_unbound_by_operator";

/*
 * Caps shared by the investigation tool and the remediation toolkit.
 *
 * The command count is a runaway guard, not a ration: an investigation runs
 * as many kubectl commands as it needs. The output cap is what a caller that
 * does not page gets; the investigation and conversation toolkits read the
 * whole output and page it (ToolOutputPager), so nothing is cut there.
 */
export const MAX_KUBECTL_COMMANDS_PER_INVESTIGATION: number = 200;
export const DEFAULT_KUBECTL_TIMEOUT_MS: number = 30 * 1000;
export const MAX_KUBECTL_TIMEOUT_MS: number = 2 * 60 * 1000;
export const MAX_KUBECTL_OUTPUT_CHARS_FOR_LLM: number = 40_000;

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
 * The Kubernetes AI agent (image KUBERNETES_AI_AGENT_IMAGE_REPOSITORY) is
 * the chart's in-cluster kubectl executor from this release on. It reads
 * KUBECTL_ALLOW_WRITES_ENV, KUBECTL_WRITE_NAMESPACES_ENV and
 * KUBECTL_ALLOW_NODE_OPERATIONS_ENV with exactly the meanings above (the
 * chart fills them from aiAgent.remediation.*), plus its own pod namespace
 * from AI_AGENT_POD_NAMESPACE_ENV (downward API) — the namespace it never
 * writes into, reported as posture.podNamespace.
 */
export const AI_AGENT_POD_NAMESPACE_ENV: string =
  "ONEUPTIME_AI_AGENT_POD_NAMESPACE";

// The chart labels the agent's Deployment and pod `component: ai-agent`.
export const KUBERNETES_AI_AGENT_COMPONENT: string = "ai-agent";

export const KUBERNETES_AI_AGENT_IMAGE_REPOSITORY: string =
  "oneuptime/kubernetes-ai-agent";

// How the agent is named wherever a Runner name would otherwise appear.
export const KUBERNETES_AI_AGENT_DISPLAY_NAME: string = "Kubernetes AI agent";

/*
 * The agent heartbeats every 30 seconds; it counts as online while its last
 * heartbeat is at most this old (the same window a Runner gets).
 */
export const KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES: number = 5;

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
 * superseded_by_ai_agent:            this cluster's Kubernetes AI agent is
 *                                    online, and it replaces the in-cluster
 *                                    Runner. Refused only WHILE the agent is
 *                                    online, so it clears on its own when the
 *                                    agent stops (a helm rollback); the body
 *                                    carries retryAfterSeconds.
 */
export type KubernetesAgentRegistrationRefusalReason =
  | "previous_instance_online"
  | "runner_holds_more_than_defaults"
  | "runner_belongs_to_another_cluster"
  | "superseded_by_ai_agent";

// The legacy Runner refusals that clear on their own.
export const TRANSIENT_KUBERNETES_AGENT_REGISTRATION_REFUSALS: ReadonlyArray<KubernetesAgentRegistrationRefusalReason> =
  ["previous_instance_online", "superseded_by_ai_agent"];

// Refusals that clear without anyone doing anything; retrying is right.
export function isTransientKubernetesAgentRegistrationRefusal(
  reason: unknown,
): boolean {
  return (
    typeof reason === "string" &&
    (
      TRANSIENT_KUBERNETES_AGENT_REGISTRATION_REFUSALS as ReadonlyArray<string>
    ).includes(reason)
  );
}

/*
 * Why POST /kubernetes-ai-agent-ingest/register refused the Kubernetes AI
 * agent (HTTP 403, `reason` in the JSON body; transient ones also carry
 * retryAfterSeconds and a Retry-After header).
 *
 * previous_instance_online: this cluster's agent row is online and the
 *                           request did not present its current key (a
 *                           second install with the same clusterName, or a
 *                           pod replaced without a clean shutdown). Clears
 *                           on its own once the old instance goes quiet.
 * legacy_runner_online:     this cluster's previous in-cluster Runner is
 *                           still online — for a few seconds during a helm
 *                           upgrade, while the old pod terminates. Clears on
 *                           its own.
 * cluster_name_invalid:     the clusterName is empty or too long. Needs an
 *                           operator (fix the chart's clusterName).
 * agent_cap_reached:        the project hit the agent row cap or the hourly
 *                           new-agent brake. Needs an operator (or time).
 */
export type KubernetesAiAgentRegistrationRefusalReason =
  | "previous_instance_online"
  | "legacy_runner_online"
  | "cluster_name_invalid"
  | "agent_cap_reached";

export const TRANSIENT_KUBERNETES_AI_AGENT_REGISTRATION_REFUSALS: ReadonlyArray<KubernetesAiAgentRegistrationRefusalReason> =
  ["previous_instance_online", "legacy_runner_online"];

// Agent refusals that clear without anyone doing anything; retrying is right.
export function isTransientKubernetesAiAgentRegistrationRefusal(
  reason: unknown,
): boolean {
  return (
    typeof reason === "string" &&
    (
      TRANSIENT_KUBERNETES_AI_AGENT_REGISTRATION_REFUSALS as ReadonlyArray<string>
    ).includes(reason)
  );
}
