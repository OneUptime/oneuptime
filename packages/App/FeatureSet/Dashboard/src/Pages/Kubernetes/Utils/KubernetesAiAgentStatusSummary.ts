import OneUptimeDate from "Common/Types/Date";
import {
  KubernetesAiRemediationMode,
  KubernetesClusterAiAccessStatus,
  KUBERNETES_AI_AGENT_DISPLAY_NAME,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import {
  AiAgentAttention,
  AiAgentCardState,
  AiAgentOverviewState,
  getAiAgentAttention,
  getAiAgentCardState,
  getAiAgentMeta,
  getAiAgentOverviewState,
  getAiAgentStateSentence,
} from "./KubernetesAiAgentStatus";
import {
  INVESTIGATION_ON_SENTENCE,
  REMEDIATION_MODE_SHORT_NAMES,
  REMEDIATION_MODE_SUMMARIES,
  readRemediationMode,
} from "./KubernetesAiAccessSettings";
import {
  getAiFixesBadge,
  getAiInvestigationBadge,
  getAiInvestigationOffSentence,
} from "../../../Components/AiAccess/AiAccessModes";
import {
  AiAgentConnectionState,
  AiAgentStatusSummary,
  getAiAgentConnectionBadge,
  getAiAgentConnectionDetails,
  getAiAgentConnectionSentence,
} from "../../../Components/AiAccess/AiAgentStatusSummary";
import {
  translatableTerm,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The cluster Overview's "AI agent" card at the bottom of the page, from
 * the status the cluster's AI agent page reads
 * (POST /kubernetes-cluster/ai-access/status): whether the Kubernetes AI
 * agent is connected, whether AI may investigate with kubectl, and how
 * fixes run. Every decision is one KubernetesAiAgentStatus.ts makes for the
 * AI agent page and the Overview's summary row already — a cluster still
 * reached through the chart's previous in-cluster Runner, or through a
 * Runner an operator bound, reads as connected while that target is online
 * — so the card, the row and the page never disagree.
 *
 * Import-clean on purpose (Common types and the AI agent page's utils), so
 * the suites read it without a browser.
 */

// How sentences name the place: "this cluster".
export const KUBERNETES_AI_AGENT_NOUN: string = translationKey("cluster");

// The card's description: the AI agent page's subtitle, for a cluster.
export function getKubernetesAiAgentStatusSummaryDescription(): string {
  return translateTemplate(
    "Whether OneUptime AI can reach this {{noun}}, and what it may do there.",
    { noun: translatableTerm(KUBERNETES_AI_AGENT_NOUN, { inSentence: true }) },
  );
}

/*
 * Connected, Offline or Not installed, exactly as the Overview's summary
 * row says it (getAiAgentOverviewState).
 */
const CONNECTION_STATES: Readonly<
  Record<AiAgentOverviewState["text"], AiAgentConnectionState>
> = {
  Connected: "connected",
  Offline: "offline",
  "Not installed": "not_installed",
};

export function getKubernetesAiAgentConnectionState(
  status: KubernetesClusterAiAccessStatus,
): AiAgentConnectionState {
  return CONNECTION_STATES[getAiAgentOverviewState(status).text];
}

/*
 * The Connection row's sentence: the agent's own state in a few words, or,
 * for a cluster reached through a Runner, the AI agent page's own sentence
 * for it (which Runner, and the chart upgrade that replaces the previous
 * one).
 */
function getConnectionSentence(
  status: KubernetesClusterAiAccessStatus,
  now: Date,
): string {
  const state: AiAgentCardState = getAiAgentCardState(status);

  switch (state) {
    case "connected":
    case "offline":
    case "not_installed":
      return getAiAgentConnectionSentence({
        state: getKubernetesAiAgentConnectionState(status),
        agentName: KUBERNETES_AI_AGENT_DISPLAY_NAME,
      });
    default:
      return getAiAgentStateSentence(status, now);
  }
}

export function getKubernetesAiAgentStatusSummary(
  status: KubernetesClusterAiAccessStatus,
  now: Date = OneUptimeDate.getCurrentDate(),
): AiAgentStatusSummary {
  const mode: KubernetesAiRemediationMode = readRemediationMode(
    status.remediationMode,
  );
  const isInvestigationEnabled: boolean =
    status.isInvestigationEnabled === true;
  const attention: AiAgentAttention | null = getAiAgentAttention(status, now);

  return {
    connection: getAiAgentConnectionBadge(
      getKubernetesAiAgentConnectionState(status),
    ),
    connectionSentence: getConnectionSentence(status, now),
    connectionDetails: getAiAgentConnectionDetails(getAiAgentMeta(status)),
    investigation: getAiInvestigationBadge(isInvestigationEnabled),
    investigationSentence: isInvestigationEnabled
      ? INVESTIGATION_ON_SENTENCE
      : getAiInvestigationOffSentence(KUBERNETES_AI_AGENT_NOUN),
    fixes: getAiFixesBadge({
      mode,
      shortNames: REMEDIATION_MODE_SHORT_NAMES,
    }),
    fixesSentence: REMEDIATION_MODE_SUMMARIES[mode],
    attention: attention ? attention.title : null,
  };
}
