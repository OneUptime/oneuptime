import OneUptimeDate from "Common/Types/Date";
import {
  KubernetesAgentPosture,
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiAgentSummary,
  KubernetesAiAutomaticInvestigationSettings,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  getKubernetesAiAccessTargetKind,
  isKubernetesAgentRunnerName,
  isKubernetesAgentRunnerPosture,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBERNETES_AGENT_HELM_NAMESPACE } from "./DocumentationMarkdown";

/*
 * What the cluster's AI agent page (Pages/Kubernetes/View/AI/Agent.tsx) and
 * the Overview's "AI agent" card read off the server's access status —
 * which of its few states the cluster is in, and the words for each.
 *
 * Every decision here is made from the status the server computed
 * (KubernetesClusterAiAccessService): the page never builds a second,
 * client-side idea of readiness next to the server's gaps.
 *
 * Import-clean on purpose (Common types, OneUptimeDate and
 * DocumentationMarkdown only), so the suites read it without a browser.
 */

// How often the page re-reads the status; the agent heartbeats every 30s.
export const AI_AGENT_STATUS_POLL_INTERVAL_MS: number = 30_000;

/*
 * How long a refused registration stays worth a warning. Another pod
 * presenting the same cluster name is either a second install (it keeps
 * trying, so the warning stays) or a pod replaced without a clean shutdown
 * (it stops once the old one goes quiet, and the warning ages out).
 */
export const REFUSED_REGISTRATION_WARNING_WINDOW_MS: number =
  24 * 60 * 60 * 1000;

// The page's heading, matching the AI Insights page's title and subtitle.
export const AI_AGENT_PAGE_TITLE: string = "AI agent";

export const AI_AGENT_PAGE_SUBTITLE: string =
  "Whether OneUptime AI can reach this cluster, and what it may do there.";

export const AI_AGENT_READY_TEXT: string =
  "Ready — AI will inspect this cluster with read-only kubectl when it investigates an incident or alert here.";

export const AI_AGENT_NOT_INSTALLED_TEXT: string =
  "Install the AI agent — it runs in your cluster, read-only, using your Kubernetes agent's key. This page updates within a minute.";

export const AI_AGENT_OTHER_RELEASE_TEXT: string =
  "Installed under another release or namespace? Use yours.";

export const AI_AGENT_UPGRADE_CHART_TEXT: string =
  "Upgrade the Kubernetes agent chart to switch to the new AI agent — your settings carry over.";

export const AI_AGENT_LEGACY_RUNNER_TEXT: string = `Works today. ${AI_AGENT_UPGRADE_CHART_TEXT}`;

/*
 * An offline previous Runner does not "work today", so its sentence keeps
 * only the way forward.
 */
export const AI_AGENT_LEGACY_RUNNER_OFFLINE_TEXT: string = `The previous in-cluster Runner is offline. ${AI_AGENT_UPGRADE_CHART_TEXT}`;

/*
 * The three ways the agent can be offline (see getAiAgentOfflineReason),
 * each ending where the logs command below it takes over.
 */
export const AI_AGENT_SIGNED_OFF_TEXT: string =
  "The AI agent signed off or was reset. It reconnects on its own within a few minutes. If it does not, check its pod:";

export const AI_AGENT_GONE_TEXT: string =
  "The AI agent disconnected and has not come back. Check its pod:";

export const AI_AGENT_SILENT_TEXT: string = `The AI agent has not checked in for over ${KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES} minutes. Check its pod:`;

export const AI_AGENT_FIXES_OFF_HINT: string =
  "Want AI to propose fixes? Choose Ask for approval.";

export const ASK_PROJECT_ADMIN_TEXT: string = "Ask a project owner or admin.";

/*
 * The status as the route returns it, or null when the body is not one.
 * Only the fields every render reads are checked; the rest are optional in
 * the contract and read defensively where they are used.
 */
export function parseStatus(
  value: unknown,
): KubernetesClusterAiAccessStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const status: Partial<KubernetesClusterAiAccessStatus> =
    value as Partial<KubernetesClusterAiAccessStatus>;
  if (typeof status.clusterId !== "string" || !Array.isArray(status.gaps)) {
    return null;
  }
  return status as KubernetesClusterAiAccessStatus;
}

/*
 * The cluster's agent row as the status reports it. A status from a server
 * that predates the field reads as "no agent" — never as a third state.
 */
export function getAiAgentSummary(
  status: KubernetesClusterAiAccessStatus,
): KubernetesAiAgentSummary | null {
  return status.aiAgent ?? null;
}

/*
 * Which of its states the "Kubernetes AI agent" card shows, from the access
 * target the server resolved (status.runner) and the agent row:
 *
 * connected / offline:      AI reaches the cluster through its Kubernetes
 *                           AI agent.
 * not_installed:            nothing can reach the cluster and no agent ever
 *                           registered.
 * legacy_runner(_offline):  AI still reaches the cluster through the
 *                           chart's previous in-cluster Runner — every
 *                           14.0.x install between the server upgrade and
 *                           the chart upgrade.
 * advanced_runner(_offline): an operator bound a Runner outside the chart
 *                           (with a Kubernetes credential); it wins over the
 *                           agent.
 *
 * A legacy Runner is told from an advanced one the way the server tells
 * them apart: the kubernetes-agent name marker or an agent posture, or its
 * in-cluster access method.
 */
export type AiAgentCardState =
  | "connected"
  | "offline"
  | "not_installed"
  | "legacy_runner"
  | "legacy_runner_offline"
  | "advanced_runner"
  | "advanced_runner_offline";

export function getAiAgentCardState(
  status: KubernetesClusterAiAccessStatus,
): AiAgentCardState {
  const runner: KubernetesClusterAiAccessStatus["runner"] = status.runner;
  const agent: KubernetesAiAgentSummary | null = getAiAgentSummary(status);

  if (!runner) {
    /*
     * The server resolves to the agent whenever a row exists, so this is a
     * status without a target but with a row: still the agent's state.
     */
    if (agent) {
      return agent.isOnline ? "connected" : "offline";
    }
    return "not_installed";
  }

  if (getKubernetesAiAccessTargetKind(runner) === "ai_agent") {
    return runner.isOnline ? "connected" : "offline";
  }

  if (isLegacyRunnerTarget(status)) {
    return runner.isOnline ? "legacy_runner" : "legacy_runner_offline";
  }

  return runner.isOnline ? "advanced_runner" : "advanced_runner_offline";
}

// Is the resolved target the chart's previous in-cluster Runner?
export function isLegacyRunnerTarget(
  status: KubernetesClusterAiAccessStatus,
): boolean {
  const runner: KubernetesClusterAiAccessStatus["runner"] = status.runner;

  if (!runner || getKubernetesAiAccessTargetKind(runner) !== "runner") {
    return false;
  }

  return (
    status.accessMethod === "in_cluster" ||
    isKubernetesAgentRunnerName(runner.name) ||
    isKubernetesAgentRunnerPosture(runner.posture)
  );
}

/*
 * Is the resolved target a Runner an operator bound outside the chart? The
 * only state in which the page shows the Runner and credential at all.
 */
export function isAdvancedRunnerTarget(
  status: KubernetesClusterAiAccessStatus,
): boolean {
  const runner: KubernetesClusterAiAccessStatus["runner"] = status.runner;

  return (
    runner !== null &&
    getKubernetesAiAccessTargetKind(runner) === "runner" &&
    !isLegacyRunnerTarget(status)
  );
}

// Does kubectl run with an in-cluster ServiceAccount (agent or legacy Runner)?
export function isInClusterTarget(
  status: KubernetesClusterAiAccessStatus,
): boolean {
  if (!status.runner) {
    return false;
  }
  return (
    getKubernetesAiAccessTargetKind(status.runner) === "ai_agent" ||
    isLegacyRunnerTarget(status)
  );
}

export type AiAgentStatusTone = "success" | "danger" | "neutral";

export interface AiAgentStatusPill {
  text: string;
  tone: AiAgentStatusTone;
}

export function getAiAgentStatusPill(
  status: KubernetesClusterAiAccessStatus,
): AiAgentStatusPill {
  switch (getAiAgentCardState(status)) {
    case "connected":
      return { text: "Connected", tone: "success" };
    case "not_installed":
      return { text: "Not installed", tone: "neutral" };
    case "legacy_runner":
      return {
        text: "Connected through the previous in-cluster Runner",
        tone: "success",
      };
    case "advanced_runner":
      return {
        text: `Connected through Runner ${status.runner?.name || "(unnamed)"} (advanced)`,
        tone: "success",
      };
    case "offline":
    case "legacy_runner_offline":
    case "advanced_runner_offline":
    default:
      return { text: "Offline", tone: "danger" };
  }
}

// "Runner "ops" with credential "prod token"" for the advanced states.
function describeAdvancedBinding(
  status: KubernetesClusterAiAccessStatus,
): string {
  const runnerName: string = status.runner?.name || "(unnamed)";

  return status.credentialName
    ? `Reached through Runner "${runnerName}" with credential "${status.credentialName}".`
    : `Reached through Runner "${runnerName}".`;
}

/*
 * Why an offline agent is offline. The server's rule
 * (KubernetesAiAgentService.isOnline) has two halves, and the page must not
 * blame the wrong one — right after a sign-off the meta line still reads
 * "last seen a few seconds ago":
 *
 * signed_off: it said goodbye or was reset (connectionStatus
 *             "disconnected") and was heard from within the alive window.
 *             A pod stopped by a helm upgrade signs off, and "Reset agent"
 *             marks the row so; either way the pod registers again within
 *             a few minutes. The expected gap, not yet a fault.
 * gone:       disconnected and not heard from since the alive window — the
 *             pod did not come back.
 * silent:     it never signed off but its heartbeats stopped (or it was
 *             never heard from): over the alive window without a word.
 *
 * Without the agent row (a server that predates it) nothing tells a
 * sign-off apart, so the heartbeat reading — the one that is true in every
 * case — is used.
 */
export type AiAgentOfflineReason = "signed_off" | "gone" | "silent";

export function getAiAgentOfflineReason(
  status: KubernetesClusterAiAccessStatus,
  now: Date = OneUptimeDate.getCurrentDate(),
): AiAgentOfflineReason {
  const agent: KubernetesAiAgentSummary | null = getAiAgentSummary(status);

  if (!agent || agent.connectionStatus !== "disconnected") {
    return "silent";
  }

  const lastAliveAt: Date | null = agent.lastAliveAt
    ? new Date(agent.lastAliveAt)
    : null;

  if (!lastAliveAt || Number.isNaN(lastAliveAt.getTime())) {
    return "gone";
  }

  return now.getTime() - lastAliveAt.getTime() <=
    KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60 * 1000
    ? "signed_off"
    : "gone";
}

const OFFLINE_SENTENCES: Record<AiAgentOfflineReason, string> = {
  signed_off: AI_AGENT_SIGNED_OFF_TEXT,
  gone: AI_AGENT_GONE_TEXT,
  silent: AI_AGENT_SILENT_TEXT,
};

// The one plain sentence under the pill.
export function getAiAgentStateSentence(
  status: KubernetesClusterAiAccessStatus,
  now: Date = OneUptimeDate.getCurrentDate(),
): string {
  switch (getAiAgentCardState(status)) {
    case "connected":
      return "The AI agent is running in this cluster.";
    case "offline":
      return OFFLINE_SENTENCES[getAiAgentOfflineReason(status, now)];
    case "not_installed":
      return AI_AGENT_NOT_INSTALLED_TEXT;
    case "legacy_runner":
      return AI_AGENT_LEGACY_RUNNER_TEXT;
    case "legacy_runner_offline":
      return AI_AGENT_LEGACY_RUNNER_OFFLINE_TEXT;
    case "advanced_runner":
      return describeAdvancedBinding(status);
    case "advanced_runner_offline":
    default:
      return `${describeAdvancedBinding(status)} The Runner is offline.`;
  }
}

/*
 * Which command the card shows under its sentence: the one install/upgrade
 * command where installing the agent is the step, the logs command where
 * its pod is the place to look, and none otherwise.
 */
export type AiAgentCardCommand = "install" | "logs" | null;

export function getAiAgentCardCommand(
  status: KubernetesClusterAiAccessStatus,
): AiAgentCardCommand {
  switch (getAiAgentCardState(status)) {
    case "not_installed":
    case "legacy_runner":
    case "legacy_runner_offline":
      return "install";
    case "offline":
      return "logs";
    default:
      return null;
  }
}

/*
 * The namespace the agent's pod runs in, as the agent last reported it;
 * the install instructions' namespace when it never said.
 */
export function getAiAgentPodNamespace(
  status: KubernetesClusterAiAccessStatus,
): string {
  const agent: KubernetesAiAgentSummary | null = getAiAgentSummary(status);

  return (
    agent?.posture?.podNamespace ||
    (getKubernetesAiAccessTargetKind(status.runner) === "ai_agent"
      ? status.runner?.posture?.podNamespace
      : undefined) ||
    KUBERNETES_AGENT_HELM_NAMESPACE
  );
}

/*
 * What an in-cluster target may change, from the posture it reports:
 * "Read-only", "Can change: web, api" or "Can change: whole cluster"
 * (writeNamespaces empty means cluster-wide; absent means an older Runner
 * that never said where). Null without a posture.
 */
export function describeAiAgentWriteAccess(
  posture: KubernetesAgentPosture | undefined,
): string | null {
  if (!posture) {
    return null;
  }

  if (posture.allowWrites !== true) {
    return "Read-only";
  }

  if (!posture.writeNamespaces) {
    return "Can change the cluster";
  }

  return posture.writeNamespaces.length === 0
    ? "Can change: whole cluster"
    : `Can change: ${posture.writeNamespaces.join(", ")}`;
}

// "node operations on/off" for a target that may write; null otherwise.
export function describeAiAgentNodeOperations(
  posture: KubernetesAgentPosture | undefined,
): string | null {
  if (!posture || posture.allowWrites !== true) {
    return null;
  }

  if (posture.allowNodeOperations === true) {
    return "node operations on";
  }

  if (posture.allowNodeOperations === false) {
    return "node operations off";
  }

  return null;
}

const VERSION_PREFIX_REGEX: RegExp = /^v/i;

// "v1.31.0" and "1.31.0" both read as "v1.31.0".
function withVersionPrefix(version: string): string {
  const trimmed: string = version.trim();
  return VERSION_PREFIX_REGEX.test(trimmed) ? trimmed : `v${trimmed}`;
}

/*
 * The card's meta line, part by part (joined with " · "): when the target
 * was last seen, the agent's version, kubectl's version, and what it may
 * change. A Runner reached with a credential reports no write scope — its
 * credential's RBAC decides — so none is shown for it.
 */
export function getAiAgentMetaParts(
  status: KubernetesClusterAiAccessStatus,
): Array<string> {
  const state: AiAgentCardState = getAiAgentCardState(status);

  if (state === "not_installed") {
    return [];
  }

  const agent: KubernetesAiAgentSummary | null = getAiAgentSummary(status);
  const isAgentTarget: boolean =
    status.runner === null ||
    getKubernetesAiAccessTargetKind(status.runner) === "ai_agent";
  const posture: KubernetesAgentPosture | undefined = isAgentTarget
    ? status.runner?.posture || agent?.posture
    : status.runner?.posture;
  const lastAliveAt: string | undefined = isAgentTarget
    ? status.runner?.lastAliveAt || agent?.lastAliveAt
    : status.runner?.lastAliveAt;

  const parts: Array<string> = [];

  if (lastAliveAt) {
    parts.push(
      `last seen ${OneUptimeDate.fromNow(OneUptimeDate.fromString(lastAliveAt))}`,
    );
  }

  if (isAgentTarget && agent?.agentVersion) {
    parts.push(`agent ${withVersionPrefix(agent.agentVersion)}`);
  }

  if (posture?.kubectlVersion) {
    parts.push(`kubectl ${withVersionPrefix(posture.kubectlVersion)}`);
  }

  if (isInClusterTarget(status) || (status.runner === null && agent)) {
    const writeAccess: string | null = describeAiAgentWriteAccess(posture);
    const nodeOperations: string | null =
      describeAiAgentNodeOperations(posture);

    if (writeAccess) {
      parts.push(writeAccess);
    }
    if (nodeOperations) {
      parts.push(nodeOperations);
    }
  }

  return parts;
}

/*
 * The warning for a registration the server refused while this agent was
 * online: another pod presenting this cluster's name (a second install, or
 * a pod replaced without a clean shutdown). A refusal because the previous
 * in-cluster Runner was still online is the normal seconds-long overlap of
 * a helm upgrade and is not worth a warning. Null when there is nothing
 * recent to say.
 */
export function getRefusedRegistrationWarning(
  agent: KubernetesAiAgentSummary | null,
  now: Date = OneUptimeDate.getCurrentDate(),
): string | null {
  if (!agent?.lastRefusedRegistrationAt) {
    return null;
  }

  if (
    agent.lastRefusedRegistrationReason &&
    agent.lastRefusedRegistrationReason !== "previous_instance_online"
  ) {
    return null;
  }

  const refusedAt: Date = new Date(agent.lastRefusedRegistrationAt);

  if (Number.isNaN(refusedAt.getTime())) {
    return null;
  }

  if (
    now.getTime() - refusedAt.getTime() >
    REFUSED_REGISTRATION_WARNING_WINDOW_MS
  ) {
    return null;
  }

  return `Another agent tried to register for this cluster at ${OneUptimeDate.getDateAsFormattedString(
    refusedAt,
  )} while this one was online. If the chart is installed twice with the same cluster name, remove one or give it its own clusterName.`;
}

/*
 * The gaps the "Needs attention" card lists. Fixes being off is a choice,
 * not a problem: the "What AI may do" card shows it with its own hint, so
 * remediation_disabled is left out here (it is still a gap for the server
 * and the investigation panel).
 */
export const CHOICE_GAP_CODES: ReadonlyArray<KubernetesAiAccessGapCode> = [
  "remediation_disabled",
];

export function getAttentionGaps(
  status: KubernetesClusterAiAccessStatus,
): Array<KubernetesAiAccessGap> {
  return status.gaps.filter((gap: KubernetesAiAccessGap): boolean => {
    return !CHOICE_GAP_CODES.includes(gap.code);
  });
}

/*
 * The one action a "Needs attention" row offers, or null when its next
 * step is a command already on the page (install, logs, write access).
 */
export type AiAgentGapAction =
  | "turn_on_investigation"
  | "open_ai_features"
  | "open_llm_providers"
  | "open_ai_credits"
  | "view_runner"
  | "test_connection";

export function getAiAgentGapAction(
  gap: KubernetesAiAccessGap,
  status: KubernetesClusterAiAccessStatus,
): AiAgentGapAction | null {
  switch (gap.code) {
    case "investigation_disabled":
      return "turn_on_investigation";
    /*
     * project_auto_remediation_disabled and
     * project_ai_command_execution_disabled are retired (Enable AI covers
     * both); an older server may still send them mid-rollout.
     */
    case "project_ai_disabled":
    case "project_auto_remediation_disabled":
    case "project_ai_command_execution_disabled":
      return "open_ai_features";
    case "llm_provider_missing":
      return "open_llm_providers";
    case "ai_balance_insufficient":
      return "open_ai_credits";
    case "last_access_check_failed":
      return status.runner ? "test_connection" : null;
    case "runner_offline":
    case "runner_ai_commands_disabled":
    case "runner_cluster_mismatch":
    case "credential_missing":
    case "credential_on_agent_runner":
      // The previous in-cluster Runner is replaced by upgrading the chart.
      return isAdvancedRunnerTarget(status) ? "view_runner" : null;
    default:
      return null;
  }
}

/*
 * Show the write-access commands inline? Only when fixes are on and the
 * in-cluster target (the agent, or the previous Runner the same commands
 * replace) reports read-only RBAC. A Runner reached with a credential is
 * bounded by that credential's RBAC, not by the chart.
 */
export function shouldShowWriteAccessCommands(
  status: KubernetesClusterAiAccessStatus,
): boolean {
  if (status.remediationMode === KubernetesAiRemediationMode.Disabled) {
    return false;
  }

  if (!isInClusterTarget(status)) {
    return false;
  }

  return status.runner?.posture?.allowWrites !== true;
}

// The project's automatic-investigation opt-ins; null from an older server.
export function getAutomaticInvestigation(
  status: KubernetesClusterAiAccessStatus,
): KubernetesAiAutomaticInvestigationSettings | null {
  const settings: KubernetesAiAutomaticInvestigationSettings | undefined =
    status.automaticInvestigation;

  if (
    !settings ||
    typeof settings.incidents !== "boolean" ||
    typeof settings.alerts !== "boolean"
  ) {
    return null;
  }

  return settings;
}

export function getAutomaticInvestigationLine(
  settings: KubernetesAiAutomaticInvestigationSettings,
): string {
  return `Automatic investigation for new incidents in this project: ${
    settings.incidents ? "On" : "Off"
  } · alerts: ${settings.alerts ? "On" : "Off"}`;
}

// The flags a one-click "Turn on" writes: only the ones that are off.
export function getAutomaticInvestigationTurnOnChanges(
  settings: KubernetesAiAutomaticInvestigationSettings,
): {
  enableAutomaticIncidentInvestigation?: boolean;
  enableAutomaticAlertInvestigation?: boolean;
} {
  return {
    ...(settings.incidents
      ? {}
      : { enableAutomaticIncidentInvestigation: true }),
    ...(settings.alerts ? {} : { enableAutomaticAlertInvestigation: true }),
  };
}

// What the confirm dialog says before turning them on.
export function getAutomaticInvestigationConfirmation(data: {
  settings: KubernetesAiAutomaticInvestigationSettings;
  projectName: string;
}): string {
  const what: string =
    !data.settings.incidents && !data.settings.alerts
      ? "every new incident and alert"
      : !data.settings.incidents
        ? "every new incident"
        : "every new alert";

  return `This applies to ${what} in ${data.projectName}, not just this cluster. Limits live under Incidents → Settings → AI.`;
}

/*
 * "Switch to the AI agent" undoes an advanced Runner binding. Offered only
 * while the agent is online — switching to an agent that is not there
 * would leave the cluster with no access.
 */
export function canSwitchToAiAgent(
  status: KubernetesClusterAiAccessStatus,
): boolean {
  return (
    isAdvancedRunnerTarget(status) &&
    getAiAgentSummary(status)?.isOnline === true
  );
}

// The Overview's "AI agent" card.
export interface AiAgentOverviewState {
  text: "Connected" | "Offline" | "Not installed";
  tone: AiAgentStatusTone;
}

export function getAiAgentOverviewState(
  status: KubernetesClusterAiAccessStatus,
): AiAgentOverviewState {
  switch (getAiAgentCardState(status)) {
    case "connected":
    case "legacy_runner":
    case "advanced_runner":
      return { text: "Connected", tone: "success" };
    case "not_installed":
      return { text: "Not installed", tone: "neutral" };
    default:
      return { text: "Offline", tone: "danger" };
  }
}
