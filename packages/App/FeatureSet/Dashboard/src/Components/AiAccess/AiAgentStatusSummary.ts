import { AiAccessBadge } from "./AiAccessModes";
import {
  TemplateValues,
  translatableTerm,
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The "AI agent" card at the bottom of a resource's Overview: whether its
 * AI agent is connected, whether OneUptime AI may investigate there, and
 * how fixes run (Off, Ask for approval, Automatic or Bypass approval) — the
 * three things the AI agent page leads with, read from the same status
 * route, with a link to that page, where they are changed.
 *
 * This is what the card says. A Kubernetes cluster's comes from
 * Pages/Kubernetes/Utils/KubernetesAiAgentStatusSummary.ts, every other
 * resource's from Components/ResourceAiAgent/ResourceAiAgentStatusSummary.ts;
 * both build it from the status utils the AI agent pages use, so the card
 * never decides anything those pages do not. AiAgentStatusSummaryCard draws
 * it.
 *
 * Import-clean on purpose (the shared AI access words and the translation
 * helpers only), so the suites read it without a browser.
 */

export const AI_AGENT_STATUS_SUMMARY_TITLE: string = translationKey("AI agent");

export const AI_AGENT_CONNECTION_ROW_TITLE: string =
  translationKey("Connection");

export const AI_AGENT_STATUS_SUMMARY_OPEN_TEXT: string = translationKey(
  "Open the AI agent page",
);

export const AI_AGENT_STATUS_SUMMARY_ATTENTION_LABEL: string =
  translationKey("Needs attention");

/*
 * What the card says when the status cannot be read — refused, failed, or
 * a body this build cannot read. Never an error: the card is supplementary,
 * and the AI agent page it links to says why.
 */
export const AI_AGENT_STATUS_UNAVAILABLE_TEXT: string = translationKey(
  "The AI agent's status could not be loaded. Open the AI agent page to see it.",
);

// Where the agent stands, as the card's Connection badge says it.
export type AiAgentConnectionState = "connected" | "offline" | "not_installed";

export const AI_AGENT_CONNECTION_BADGES: Readonly<
  Record<AiAgentConnectionState, AiAccessBadge>
> = {
  connected: { text: translationKey("Connected"), tone: "on" },
  offline: { text: translationKey("Offline"), tone: "danger" },
  not_installed: { text: translationKey("Not installed"), tone: "off" },
};

export function getAiAgentConnectionBadge(
  state: AiAgentConnectionState,
): AiAccessBadge {
  return AI_AGENT_CONNECTION_BADGES[state];
}

/*
 * Where the agent's version goes among connectionDetails. The card puts the
 * caller's AgentVersion element there, or leaves the place out when it has
 * none (a version the agent never reported).
 */
export const AI_AGENT_VERSION_DETAIL: string = "{{agent version}}";

/*
 * The Connection row's details from an AI agent page's meta line — last
 * seen, the version's place, then the rest — in the page's order.
 */
export function getAiAgentConnectionDetails(meta: {
  lastSeen: string | null;
  showsAgentVersion: boolean;
  rest: Array<string>;
}): Array<string> {
  return [
    ...(meta.lastSeen ? [meta.lastSeen] : []),
    ...(meta.showsAgentVersion ? [AI_AGENT_VERSION_DETAIL] : []),
    ...meta.rest,
  ];
}

export interface AiAgentStatusSummary {
  connection: AiAccessBadge;
  // One plain sentence under the Connection badge.
  connectionSentence: string;
  /*
   * The AI agent page's meta line, part by part — when the agent was last
   * seen, its version, what it may change. Empty before an agent ever
   * registered. The version is AI_AGENT_VERSION_DETAIL, a place the card
   * fills with the agent's version drawn by the shared AgentVersion (an
   * outdated agent shows its sign and upgrade dialog there, as on the AI
   * agent page), never words.
   */
  connectionDetails: Array<string>;
  investigation: AiAccessBadge;
  investigationSentence: string;
  // The fixes mode, by the short name the AI agent page gives it.
  fixes: AiAccessBadge;
  fixesSentence: string;
  /*
   * What OneUptime AI cannot do there right now — the AI agent page's
   * "Needs attention" headline — or null when nothing needs attention.
   * Fixes being off is a choice, not a problem, so it is never this.
   */
  attention: string | null;
}

/*
 * The Connection row's sentence for an agent in each of its own states,
 * named the way the rest of the product names it ("Docker AI agent",
 * "Kubernetes AI agent").
 *
 * The name goes in as written on its own, not cased for the middle of a
 * sentence: a resource agent's name keeps its capitals in English ("The
 * Host AI agent is connected."). Each locale words these sentences for
 * every name they hold, translated or not: French without an article, for
 * "Agent IA Kubernetes" and "Docker AI agent" alike.
 */
export function getAiAgentConnectionSentence(data: {
  state: AiAgentConnectionState;
  agentName: string;
}): string {
  const values: TemplateValues = {
    agent: translatableTerm(data.agentName),
  };

  switch (data.state) {
    case "connected":
      return translateTemplate("The {{agent}} is connected.", values);
    case "offline":
      return translateTemplate("The {{agent}} is offline.", values);
    case "not_installed":
    default:
      return translateTemplate("The {{agent}} is not installed yet.", values);
  }
}

/*
 * A connected resource AI agent that could not reach its resource at its
 * last probe (the socket, the API address, its credentials): connected to
 * OneUptime, but no command can work until that is fixed.
 */
export function getAiAgentUnreachableSentence(data: {
  agentName: string;
  noun: string;
}): string {
  return translateTemplate(
    "The {{agent}} is connected, but it could not reach this {{noun}} at its last check.",
    {
      agent: translatableTerm(data.agentName),
      noun: translatableTerm(data.noun, { inSentence: true }),
    },
  );
}
