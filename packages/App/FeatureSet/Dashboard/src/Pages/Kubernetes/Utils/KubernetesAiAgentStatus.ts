import OneUptimeDate from "Common/Types/Date";
import {
  KubernetesAgentPosture,
  KubernetesAiAccessGap,
  KubernetesAiAccessGapCode,
  KubernetesAiAgentSummary,
  KubernetesAiAutomaticInvestigationSettings,
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBECTL_ALLOW_WRITES_ENV,
  KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
  getKubernetesAiAccessTargetKind,
  isKubernetesAgentRunnerName,
  isKubernetesAgentRunnerPosture,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { KUBERNETES_AGENT_HELM_NAMESPACE } from "./DocumentationMarkdown";
import { readAiSettingsSource } from "../../../Components/AiAccess/AiAccessModes";
import {
  AgentAiSettingsSource,
  isAgentAiSettingsSourceAgent,
} from "Common/Types/AI/AgentAiSettings";
import {
  TemplateValues,
  translatableTerm,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the cluster's AI agent page (Pages/Kubernetes/View/AI/Agent.tsx) and
 * the Overview's "AI agent" card read off the server's access status —
 * which of its few states the cluster is in, and the words for each.
 *
 * Every decision here is made from the status the server computed
 * (KubernetesClusterAiAccessService): the page never builds a second,
 * client-side idea of readiness next to the server's gaps.
 *
 * The words are the Dashboard's translation keys (src/Locales/README.md).
 * A constant is the English key, looked up where the page shows it; a
 * function answers in the reader's language, each sentence whole with its
 * values in {{placeholders}}, so the Overview's card reads it translated
 * too.
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

// The page's heading, matching the AI Insights and AI Logs pages' headings.
export const AI_AGENT_PAGE_TITLE: string = translationKey("AI agent");

export const AI_AGENT_PAGE_SUBTITLE: string = translationKey(
  "Whether OneUptime AI can reach this cluster, and what it may do there.",
);

export const AI_AGENT_READY_TEXT: string = translationKey(
  "Ready — AI will inspect this cluster with read-only kubectl when it investigates an incident or alert here.",
);

export const AI_AGENT_NOT_INSTALLED_TEXT: string = translationKey(
  "Install the AI agent — it runs in your cluster, read-only, using your Kubernetes agent's key. This page updates within a minute.",
);

export const AI_AGENT_OTHER_RELEASE_TEXT: string = translationKey(
  "Installed under another release or namespace? Use yours.",
);

/*
 * The previous in-cluster Runner: what it does today, then the way forward
 * — upgrading the chart, which carries the settings over. Each is one key
 * with both sentences in it, so a locale words them together.
 */
export const AI_AGENT_LEGACY_RUNNER_TEXT: string = translationKey(
  "Works today. Upgrade the Kubernetes agent chart to switch to the new AI agent — your settings carry over.",
);

// An offline previous Runner does not "work today": only the way forward.
export const AI_AGENT_LEGACY_RUNNER_OFFLINE_TEXT: string = translationKey(
  "The previous in-cluster Runner is offline. Upgrade the Kubernetes agent chart to switch to the new AI agent — your settings carry over.",
);

/*
 * The three ways the agent can be offline (see getAiAgentOfflineReason),
 * each ending where the logs command below it takes over.
 */
export const AI_AGENT_SIGNED_OFF_TEXT: string = translationKey(
  "The AI agent signed off or was reset. It reconnects on its own within a few minutes. If it does not, check its pod:",
);

export const AI_AGENT_GONE_TEXT: string = translationKey(
  "The AI agent disconnected and has not come back. Check its pod:",
);

// {{minutes}} is the server's alive window.
export const AI_AGENT_SILENT_TEXT: string = translationKey(
  "The AI agent has not checked in for over {{minutes}} minutes. Check its pod:",
);

export const ASK_PROJECT_ADMIN_TEXT: string = translationKey(
  "Ask a project owner or admin.",
);

// A Runner's name where the status has none.
const UNNAMED_RUNNER: string = translationKey("(unnamed)");

// Where the cluster's investigation and fixes are set, as its status says.
export function getKubernetesAiSettingsSource(
  status: KubernetesClusterAiAccessStatus,
): AgentAiSettingsSource {
  return readAiSettingsSource(status.aiSettingsSource);
}

/*
 * Does the cluster's Kubernetes AI agent set investigation and fixes (its
 * chart's aiAgent.investigation / aiAgent.fixes, or its defaults)? Then
 * the page shows them read-only, and changes them with a chart command.
 */
export function isKubernetesAiSettingsSetByAgent(
  status: KubernetesClusterAiAccessStatus,
): boolean {
  return isAgentAiSettingsSourceAgent(getKubernetesAiSettingsSource(status));
}

// The "Needs attention" step for investigation the agent keeps off.
export const KUBERNETES_AGENT_SET_INVESTIGATION_STEP_TEXT: string =
  translationKey("Turn on AI investigation on the Kubernetes agent chart.");

/*
 * The route a cluster's AI access status is read from, with { clusterId }:
 * the AI agent page, and the Overview's two cards that show it.
 */
export const KUBERNETES_AI_ACCESS_STATUS_ROUTE: string =
  "/kubernetes-cluster/ai-access/status";

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
        text: translateTemplate(
          "Connected through Runner {{name}} (advanced)",
          {
            name: status.runner?.name || translatableTerm(UNNAMED_RUNNER),
          },
        ),
        tone: "success",
      };
    case "offline":
    case "legacy_runner_offline":
    case "advanced_runner_offline":
    default:
      return { text: "Offline", tone: "danger" };
  }
}

/*
 * 'Reached through Runner "ops" with credential "prod token".' for the
 * advanced states, and that the Runner is offline when it is. Each case is
 * one key, so a locale words its sentences together.
 */
function describeAdvancedBinding(
  status: KubernetesClusterAiAccessStatus,
  isRunnerOffline: boolean,
): string {
  const values: TemplateValues = {
    runner: status.runner?.name || translatableTerm(UNNAMED_RUNNER),
    credential: status.credentialName || "",
  };

  if (status.credentialName) {
    return translateTemplate(
      isRunnerOffline
        ? 'Reached through Runner "{{runner}}" with credential "{{credential}}". The Runner is offline.'
        : 'Reached through Runner "{{runner}}" with credential "{{credential}}".',
      values,
    );
  }

  return translateTemplate(
    isRunnerOffline
      ? 'Reached through Runner "{{runner}}". The Runner is offline.'
      : 'Reached through Runner "{{runner}}".',
    values,
  );
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
      return translateTemplate("The AI agent is running in this cluster.");
    case "offline":
      // Only the silent sentence has a {{minutes}}.
      return translateTemplate(
        OFFLINE_SENTENCES[getAiAgentOfflineReason(status, now)],
        { minutes: KUBERNETES_AI_AGENT_ALIVE_WINDOW_IN_MINUTES },
      );
    case "not_installed":
      return translateTemplate(AI_AGENT_NOT_INSTALLED_TEXT);
    case "legacy_runner":
      return translateTemplate(AI_AGENT_LEGACY_RUNNER_TEXT);
    case "legacy_runner_offline":
      return translateTemplate(AI_AGENT_LEGACY_RUNNER_OFFLINE_TEXT);
    case "advanced_runner":
      return describeAdvancedBinding(status, false);
    case "advanced_runner_offline":
    default:
      return describeAdvancedBinding(status, true);
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
    return translateTemplate("Read-only");
  }

  if (!posture.writeNamespaces) {
    return translateTemplate("Can change the cluster");
  }

  return posture.writeNamespaces.length === 0
    ? translateTemplate("Can change: whole cluster")
    : translateTemplate("Can change: {{namespaces}}", {
        namespaces: posture.writeNamespaces.join(", "),
      });
}

// "node operations on/off" for a target that may write; null otherwise.
export function describeAiAgentNodeOperations(
  posture: KubernetesAgentPosture | undefined,
): string | null {
  if (!posture || posture.allowWrites !== true) {
    return null;
  }

  if (posture.allowNodeOperations === true) {
    return translateTemplate("node operations on");
  }

  if (posture.allowNodeOperations === false) {
    return translateTemplate("node operations off");
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
 * The card's meta line: when the target was last seen, then — when the
 * target is the cluster's own agent — the agent's version, which the page
 * draws with AgentVersion (so an outdated agent gets its sign and upgrade
 * dialog, like every other agent version), then kubectl's version and what
 * it may change. A Runner reached with a credential reports no write scope
 * — its credential's RBAC decides — so none is shown for it.
 */
export interface AiAgentMeta {
  lastSeen: string | null;
  // The agent's version goes here, drawn by the page.
  showsAgentVersion: boolean;
  rest: Array<string>;
}

export function getAiAgentMeta(
  status: KubernetesClusterAiAccessStatus,
): AiAgentMeta {
  const state: AiAgentCardState = getAiAgentCardState(status);

  if (state === "not_installed") {
    return { lastSeen: null, showsAgentVersion: false, rest: [] };
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

  const lastSeen: string | null = lastAliveAt
    ? translateTemplate("last seen {{time}}", {
        time: OneUptimeDate.fromNow(OneUptimeDate.fromString(lastAliveAt)),
      })
    : null;

  // A tool and its version: nothing in it to translate.
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

  return {
    lastSeen,
    showsAgentVersion: isAgentTarget && agent !== null,
    rest: parts,
  };
}

// The meta line's words, in order, without the agent's version.
export function getAiAgentMetaParts(
  status: KubernetesClusterAiAccessStatus,
): Array<string> {
  const meta: AiAgentMeta = getAiAgentMeta(status);

  return [...(meta.lastSeen ? [meta.lastSeen] : []), ...meta.rest];
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

  return translateTemplate(
    "Another agent tried to register for this cluster at {{time}} while this one was online. If the chart is installed twice with the same cluster name, remove one or give it its own clusterName.",
    { time: OneUptimeDate.getDateAsFormattedString(refusedAt) },
  );
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
 * The one action a "Needs attention" step offers, or null when its next
 * step is a command already on the page (install, logs, write access).
 */
export type AiAgentGapAction =
  | "turn_on_investigation"
  // The agent keeps investigation off: show the chart command that turns it on.
  | "set_investigation_in_agent"
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
      return isKubernetesAiSettingsSetByAgent(status)
        ? "set_investigation_in_agent"
        : "turn_on_investigation";
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
 * "Needs attention" is one item, not a row per gap: a headline saying what
 * OneUptime AI cannot do on this cluster, then the steps that fix it — the
 * same item the other resources' AI agent pages show.
 *
 * The headline reads what each gap blocks. Fixes only count while they are
 * on: a missing agent blocks both investigation and fixes for the server,
 * but "can't run fixes" says nothing to someone who turned fixes off.
 */
export function getAiAgentAttentionTitle(
  status: KubernetesClusterAiAccessStatus,
): string {
  const gaps: Array<KubernetesAiAccessGap> = getAttentionGaps(status);
  const blocksInvestigation: boolean = gaps.some(
    (gap: KubernetesAiAccessGap): boolean => {
      return gap.blocks === "investigation" || gap.blocks === "both";
    },
  );
  const blocksFixes: boolean = gaps.some(
    (gap: KubernetesAiAccessGap): boolean => {
      return gap.blocks === "remediation" || gap.blocks === "both";
    },
  );
  // A mode this build does not know reads as off, like the settings card.
  const areFixesOn: boolean =
    Object.values(KubernetesAiRemediationMode).includes(
      status.remediationMode,
    ) && status.remediationMode !== KubernetesAiRemediationMode.Disabled;

  if (blocksInvestigation && blocksFixes && areFixesOn) {
    return translateTemplate(
      "OneUptime AI can't investigate this cluster or run fixes on it",
    );
  }

  if (blocksInvestigation) {
    return translateTemplate("OneUptime AI can't investigate this cluster");
  }

  if (blocksFixes) {
    return translateTemplate("OneUptime AI can't run fixes on this cluster");
  }

  return translateTemplate(
    "OneUptime AI can't do all of its job on this cluster",
  );
}

// The cluster's agent, as a step names it: "Install the {{agent}} …".
function getAgentValues(): TemplateValues {
  return { agent: translatableTerm(KUBERNETES_AI_AGENT_DISPLAY_NAME) };
}

// The server's own words, for a gap this page has none for.
function getServerStepText(gap: KubernetesAiAccessGap): string {
  return gap.nextStep || gap.title;
}

/*
 * A Runner gap, for the Runner the cluster is reached through. The previous
 * in-cluster Runner is not fixed but replaced: the chart upgrade the card
 * shows moves the cluster to its AI agent. A Runner an operator bound is
 * fixed on the Runner, or swapped for a credential or the AI agent in the
 * Change modal.
 */
function getRunnerStepText(
  gap: KubernetesAiAccessGap,
  status: KubernetesClusterAiAccessStatus,
): string {
  if (isLegacyRunnerTarget(status)) {
    return translateTemplate(
      "Upgrade the Kubernetes agent chart with the command above. The {{agent}} replaces the previous in-cluster Runner.",
      getAgentValues(),
    );
  }

  if (!isAdvancedRunnerTarget(status)) {
    return getServerStepText(gap);
  }

  switch (gap.code) {
    case "runner_offline":
      return translateTemplate(
        "Start the Runner and make sure it can reach your OneUptime URL.",
      );
    case "runner_ai_commands_disabled":
      return translateTemplate(
        'Turn on "Runs AI Remediation Commands" on the Runner.',
      );
    case "credential_on_agent_runner":
      return translateTemplate(
        "With Change below, choose a Runner created in the dashboard, or clear the Runner to use the {{agent}}.",
        getAgentValues(),
      );
    default:
      // credential_missing, and a Runner that did not say which cluster.
      return translateTemplate(
        "With Change below, choose a Kubernetes credential the Runner may use, or clear the Runner to use the {{agent}}.",
        getAgentValues(),
      );
  }
}

/*
 * One gap as a step, in this page's words. The server's next steps are
 * written for every surface that shows a gap (incident pages, the
 * investigation panel), so they send the reader to "the cluster's AI agent
 * page (AI → Agent)" — this page — and repeat the helm command the agent
 * card already shows. Here a step points at what is on the page instead. A
 * gap this build does not know keeps the server's next step.
 */
export function getAiAgentAttentionStepText(
  gap: KubernetesAiAccessGap,
  status: KubernetesClusterAiAccessStatus,
  now: Date = OneUptimeDate.getCurrentDate(),
): string {
  switch (gap.code) {
    case "ai_agent_not_connected":
    case "no_runner_bound":
      return translateTemplate(
        "Install the {{agent}} with the command above.",
        getAgentValues(),
      );
    case "ai_agent_offline":
      // Right after a sign-off or reset the card says it reconnects itself.
      return translateTemplate(
        getAiAgentOfflineReason(status, now) === "signed_off"
          ? "Wait a few minutes for the {{agent}} to reconnect. If it does not, its logs say why (the command is above)."
          : "Bring the {{agent}} back online. Its logs say why it is offline (the command is above).",
        getAgentValues(),
      );
    case "runner_missing":
      return translateTemplate(
        "Reload this page. The Runner this cluster was bound to was just deleted.",
      );
    case "runner_cluster_mismatch":
      return getKubernetesAiAccessTargetKind(status.runner) === "ai_agent"
        ? translateTemplate(
            "Reset the {{agent}}. It reconnects on its own within a few minutes.",
            getAgentValues(),
          )
        : getRunnerStepText(gap, status);
    case "runner_offline":
    case "runner_ai_commands_disabled":
    case "credential_missing":
    case "credential_on_agent_runner":
      return getRunnerStepText(gap, status);
    case "investigation_disabled":
      return translateTemplate(
        isKubernetesAiSettingsSetByAgent(status)
          ? KUBERNETES_AGENT_SET_INVESTIGATION_STEP_TEXT
          : "Turn on AI investigation with kubectl.",
      );
    case "remediation_write_access_missing":
      // The commands are below for the agent and the previous Runner alike.
      if (shouldShowWriteAccessCommands(status)) {
        return translateTemplate(
          isLegacyRunnerTarget(status)
            ? "Upgrade to the {{agent}} with write access, using the commands below."
            : "Give the {{agent}} write access with the commands below.",
          getAgentValues(),
        );
      }
      return isAdvancedRunnerTarget(status)
        ? translateTemplate(
            "Set {{variable}}=true on the Runner's host and restart it.",
            { variable: KUBECTL_ALLOW_WRITES_ENV },
          )
        : getServerStepText(gap);
    /*
     * project_auto_remediation_disabled and
     * project_ai_command_execution_disabled are retired: Enable AI covers
     * both, so an older server that still sends them mid-rollout gets the
     * same step.
     */
    case "project_ai_disabled":
    case "project_auto_remediation_disabled":
    case "project_ai_command_execution_disabled":
      return translateTemplate("Turn on AI for this project.");
    case "llm_provider_missing":
      return translateTemplate(
        "Add an AI provider for this project, or use OneUptime AI credits.",
      );
    case "ai_balance_insufficient":
      return translateTemplate(
        "Add AI credits to this project, or turn on auto-recharge.",
      );
    case "last_access_check_failed":
      // Nothing to test before anything can reach the cluster.
      return status.runner
        ? translateTemplate("Test the connection again.")
        : getServerStepText(gap);
    default:
      return getServerStepText(gap);
  }
}

export interface AiAgentAttentionStep {
  gap: KubernetesAiAccessGap;
  text: string;
  action: AiAgentGapAction | null;
}

export interface AiAgentAttention {
  title: string;
  steps: Array<AiAgentAttentionStep>;
}

/*
 * The "Needs attention" item, or null when there is nothing to show: one
 * step per gap, in the server's order.
 */
export function getAiAgentAttention(
  status: KubernetesClusterAiAccessStatus,
  now: Date = OneUptimeDate.getCurrentDate(),
): AiAgentAttention | null {
  const gaps: Array<KubernetesAiAccessGap> = getAttentionGaps(status);

  if (gaps.length === 0) {
    return null;
  }

  return {
    title: getAiAgentAttentionTitle(status),
    steps: gaps.map((gap: KubernetesAiAccessGap): AiAgentAttentionStep => {
      return {
        gap,
        text: getAiAgentAttentionStepText(gap, status, now),
        action: getAiAgentGapAction(gap, status),
      };
    }),
  };
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

/*
 * The project's opt-ins in one line, above the footer's "Turn on": one
 * whole sentence, each opt-in's state translated along with it.
 */
export const AUTOMATIC_INVESTIGATION_LINE: string = translationKey(
  "Automatic investigation for new incidents in this project: {{incidents}} · alerts: {{alerts}}",
);

const OPT_IN_ON: string = translationKey("On");

const OPT_IN_OFF: string = translationKey("Off");

export function getAutomaticInvestigationLine(
  settings: KubernetesAiAutomaticInvestigationSettings,
): string {
  return translateTemplate(AUTOMATIC_INVESTIGATION_LINE, {
    incidents: translatableTerm(settings.incidents ? OPT_IN_ON : OPT_IN_OFF),
    alerts: translatableTerm(settings.alerts ? OPT_IN_ON : OPT_IN_OFF),
  });
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

/*
 * What the confirm dialog says before turning them on: one whole sentence
 * for each set of opt-ins it turns on, so a locale words each one its own
 * way and puts the project's name where its grammar wants it.
 */
export const AUTOMATIC_INVESTIGATION_CONFIRMATIONS: {
  incidentsAndAlerts: string;
  incidents: string;
  alerts: string;
} = {
  incidentsAndAlerts: translationKey(
    "This applies to every new incident and alert in {{project}}, not just this cluster. Limits live under Incidents → AI → Settings.",
  ),
  incidents: translationKey(
    "This applies to every new incident in {{project}}, not just this cluster. Limits live under Incidents → AI → Settings.",
  ),
  alerts: translationKey(
    "This applies to every new alert in {{project}}, not just this cluster. Limits live under Incidents → AI → Settings.",
  ),
};

// The project in the confirmation when the page does not know its name.
const UNNAMED_PROJECT: string = translationKey("this project");

export function getAutomaticInvestigationConfirmation(data: {
  settings: KubernetesAiAutomaticInvestigationSettings;
  projectName?: string | undefined;
}): string {
  const template: string =
    !data.settings.incidents && !data.settings.alerts
      ? AUTOMATIC_INVESTIGATION_CONFIRMATIONS.incidentsAndAlerts
      : !data.settings.incidents
        ? AUTOMATIC_INVESTIGATION_CONFIRMATIONS.incidents
        : AUTOMATIC_INVESTIGATION_CONFIRMATIONS.alerts;

  return translateTemplate(template, {
    project: data.projectName || translatableTerm(UNNAMED_PROJECT),
  });
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
