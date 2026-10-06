import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import {
  RESOURCE_AI_ACCESS_INSIGHTS_PATH,
  RESOURCE_AI_ACCESS_LOGS_PATH,
  RESOURCE_AI_ACCESS_RESET_AGENT_PATH,
  RESOURCE_AI_ACCESS_STATUS_PATH,
  RESOURCE_AI_ACCESS_TEST_PATH,
  ResourceAiAccessRequest,
} from "Common/Types/AI/ResourceAiAccessApi";
import AiResourceType, {
  AI_RESOURCE_TYPE_INFO,
} from "Common/Types/ResourceAiAgent/AiResourceType";
import {
  RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
  ResourceAiAccessGap,
  ResourceAiAccessGapCode,
  ResourceAiAccessStatus,
  ResourceAiAgentPosture,
  ResourceAiAgentSummary,
  ResourceAiRemediationMode,
  parseResourceAiRemediationMode,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import { ResourceAiAgentDescriptor } from "./ResourceAiAgentDescriptors";
import {
  AgentAiSettingsChoice,
  readAiSettingsSource,
} from "../AiAccess/AiAccessModes";
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
import { ADD_AI_CREDITS_STEP } from "../ProjectBalance/ProjectBalanceCopy";

/*
 * What a resource's AI agent page (ResourceAiAgentPage) and its AI Insights
 * and AI Logs pages read off the server's access status (POST
 * /resource-ai-access/status) — which of its three states the agent is in,
 * and the words for each. The resource twin of
 * Pages/Kubernetes/Utils/KubernetesAiAgentStatus.ts, without the Kubernetes
 * Runner states: a resource is reached through its resource AI agent or not
 * at all.
 *
 * Every decision here is made from the status the server computed
 * (ResourceAiAccessService): the page never builds a second, client-side
 * idea of readiness next to the server's gaps.
 *
 * Import-clean on purpose (Common types and the descriptors only), so the
 * suites read it without a browser.
 */

/*
 * The custom calls behind a resource's AI pages (served by
 * Common/Server/API/ResourceAiAccessAPI.ts under /api), by the paths the
 * server mounts them at. Each takes { resourceType, resourceId }
 * (getResourceAiAccessRequestBody); settings are ordinary CRUD on the
 * resource's own model.
 */
export const RESOURCE_AI_ACCESS_STATUS_ROUTE: string =
  RESOURCE_AI_ACCESS_STATUS_PATH;
export const RESOURCE_AI_ACCESS_TEST_ROUTE: string =
  RESOURCE_AI_ACCESS_TEST_PATH;
export const RESOURCE_AI_ACCESS_RESET_AGENT_ROUTE: string =
  RESOURCE_AI_ACCESS_RESET_AGENT_PATH;
export const RESOURCE_AI_ACCESS_LOGS_ROUTE: string =
  RESOURCE_AI_ACCESS_LOGS_PATH;
export const RESOURCE_AI_ACCESS_INSIGHTS_ROUTE: string =
  RESOURCE_AI_ACCESS_INSIGHTS_PATH;

export function getResourceAiAccessRequestBody(
  descriptor: ResourceAiAgentDescriptor,
  resourceId: string,
): JSONObject {
  const request: ResourceAiAccessRequest = {
    resourceType: descriptor.resourceType,
    resourceId,
  };

  return { ...request };
}

// How often the page re-reads the status; the agent heartbeats every 30s.
export const RESOURCE_AI_AGENT_STATUS_POLL_INTERVAL_MS: number = 30_000;

/*
 * How long a refused registration stays worth a warning. Another agent
 * presenting the same identity is either a second install (it keeps trying,
 * so the warning stays) or a container replaced without a clean shutdown
 * (it stops once the old one goes quiet, and the warning ages out).
 */
export const RESOURCE_AI_REFUSED_REGISTRATION_WARNING_WINDOW_MS: number =
  24 * 60 * 60 * 1000;

// The page's heading, matching the AI Insights and AI Logs pages' headings.
export const RESOURCE_AI_AGENT_PAGE_TITLE: string = translationKey("AI agent");

export const RESOURCE_AI_ASK_PROJECT_ADMIN_TEXT: string = translationKey(
  "Ask a project owner or admin.",
);

export function getResourceAiAgentPageSubtitle(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "Whether OneUptime AI can reach this {{noun}}, and what it may do there.",
    { noun: translatableTerm(descriptor.noun, { inSentence: true }) },
  );
}

export function getResourceAiAgentReadyText(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "Ready — AI will inspect this {{noun}} with {{commands}} when it investigates an incident or alert here.",
    {
      noun: translatableTerm(descriptor.noun, { inSentence: true }),
      commands: translatableTerm(descriptor.readOnlyCommandsPhrase),
    },
  );
}

export function getResourceAiAgentNotInstalledText(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "Install the {{agent}} — it runs next to this {{noun}}, read-only by default, with the key its telemetry agent already uses. This page updates within a minute.",
    {
      agent: translatableTerm(descriptor.agentName),
      noun: translatableTerm(descriptor.noun, { inSentence: true }),
    },
  );
}

/*
 * What installing the agent turns on, said with the install instructions:
 * AI investigations are on by default for every resource (its
 * isAiInvestigationEnabled column defaults to true), so the agent is the
 * only step — and fixes stay off until someone allows them.
 */
export function getResourceAiAgentInstallInvestigationText(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "AI investigations are on by default: once the {{agent}} connects, OneUptime AI runs {{commands}} on this {{noun}} whenever it investigates an incident or alert here. Fixes stay off until you allow them.",
    {
      agent: translatableTerm(descriptor.agentName),
      commands: translatableTerm(descriptor.readOnlyCommandsPhrase),
      noun: translatableTerm(descriptor.noun, { inSentence: true }),
    },
  );
}

/*
 * The three ways the agent can be offline (see
 * getResourceAiAgentOfflineReason), each ending where the logs command
 * below it takes over.
 */
export function getResourceAiAgentSignedOffText(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "The {{agent}} signed off or was reset. It reconnects on its own within a few minutes. If it does not, check its logs:",
    { agent: translatableTerm(descriptor.agentName) },
  );
}

export function getResourceAiAgentGoneText(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "The {{agent}} disconnected and has not come back. Check its logs:",
    { agent: translatableTerm(descriptor.agentName) },
  );
}

export function getResourceAiAgentSilentText(
  descriptor: ResourceAiAgentDescriptor,
): string {
  return translateTemplate(
    "The {{agent}} has not checked in for over {{minutes}} minutes. Check its logs:",
    {
      agent: translatableTerm(descriptor.agentName),
      minutes: RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES,
    },
  );
}

// Where the resource's investigation and fixes are set, as its status says.
export function getResourceAiSettingsSource(
  status: ResourceAiAccessStatus,
): AgentAiSettingsSource {
  return readAiSettingsSource(status.aiSettingsSource);
}

/*
 * Does the resource's AI agent set investigation and fixes (its .env's
 * ONEUPTIME_AI_INVESTIGATION / ONEUPTIME_AI_FIXES, or its defaults)? Then
 * the page shows them read-only, and changes them with the agent's .env.
 */
export function isResourceAiSettingsSetByAgent(
  status: ResourceAiAccessStatus,
): boolean {
  return isAgentAiSettingsSourceAgent(getResourceAiSettingsSource(status));
}

// What is in effect on the resource now, as a choice.
export function getResourceAiSettingsChoice(
  status: ResourceAiAccessStatus,
): AgentAiSettingsChoice {
  return {
    investigation: status.isAiInvestigationEnabled === true,
    fixes: parseResourceAiRemediationMode(status.aiRemediationMode),
  };
}

// The line above the rows, by where the settings are set.
export const RESOURCE_AI_SETTINGS_SET_BY_TEXT: Readonly<
  Record<AgentAiSettingsSource, string>
> = {
  agent_configuration: translationKey(
    "Set by the {{agent}}'s configuration: ONEUPTIME_AI_INVESTIGATION and ONEUPTIME_AI_FIXES where it runs. Change them there; this page follows.",
  ),
  agent_defaults: translationKey(
    "Set by the {{agent}}'s defaults: neither ONEUPTIME_AI_INVESTIGATION nor ONEUPTIME_AI_FIXES is set where it runs. Set them to choose; this page follows.",
  ),
  oneuptime: translationKey(
    "Chosen on this page. You can set them where the {{agent}} runs instead (ONEUPTIME_AI_INVESTIGATION and ONEUPTIME_AI_FIXES), so they follow the agent.",
  ),
};

// The "Needs attention" step for investigation the agent keeps off.
export const RESOURCE_AGENT_SET_INVESTIGATION_STEP_TEXT: string =
  translationKey("Turn on AI investigation where the {{agent}} runs.");

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * The status as the route returns it, or null when the body is not one.
 * Only the fields every render reads are checked and normalized: an unknown
 * mode reads as Off, a missing allowlist as empty, a missing agent as none.
 * Everything else is optional in the contract and read defensively where
 * it is used.
 */
export function parseResourceAiAccessStatus(
  value: unknown,
): ResourceAiAccessStatus | null {
  if (!isObject(value)) {
    return null;
  }

  if (
    typeof value["resourceId"] !== "string" ||
    !Array.isArray(value["gaps"])
  ) {
    return null;
  }

  const allowlist: unknown = value["aiCommandAllowlist"];
  const agent: unknown = value["agent"];

  return {
    ...(value as unknown as ResourceAiAccessStatus),
    isAiInvestigationEnabled: value["isAiInvestigationEnabled"] === true,
    aiRemediationMode: parseResourceAiRemediationMode(
      value["aiRemediationMode"],
    ),
    aiCommandAllowlist: Array.isArray(allowlist)
      ? allowlist.filter((pattern: unknown): pattern is string => {
          return typeof pattern === "string";
        })
      : [],
    agent: isObject(agent)
      ? (agent as unknown as ResourceAiAgentSummary)
      : null,
    gaps: (value["gaps"] as Array<unknown>).filter(
      (gap: unknown): gap is ResourceAiAccessGap => {
        return isObject(gap) && typeof gap["code"] === "string";
      },
    ),
    isInvestigationReady: value["isInvestigationReady"] === true,
    isRemediationReady: value["isRemediationReady"] === true,
  };
}

/*
 * Which of its states the agent card shows:
 *
 * connected:     the agent heartbeated within the alive window.
 * offline:       an agent registered once, but is not online now.
 * not_installed: no agent ever registered for this resource.
 */
export type ResourceAiAgentCardState =
  | "connected"
  | "offline"
  | "not_installed";

export function getResourceAiAgentCardState(
  status: ResourceAiAccessStatus,
): ResourceAiAgentCardState {
  if (!status.agent) {
    return "not_installed";
  }

  return status.agent.isOnline === true ? "connected" : "offline";
}

/*
 * An online agent that could not reach the resource at its last probe (the
 * socket, the API address, its credentials or keyring): it is connected to
 * OneUptime, but no command can work until that is fixed.
 */
export function isResourceUnreachable(status: ResourceAiAccessStatus): boolean {
  return (
    getResourceAiAgentCardState(status) === "connected" &&
    status.agent?.posture?.reachable === false
  );
}

export type ResourceAiAgentStatusTone = "success" | "danger" | "neutral";

export interface ResourceAiAgentStatusPill {
  text: string;
  tone: ResourceAiAgentStatusTone;
}

export function getResourceAiAgentStatusPill(
  status: ResourceAiAccessStatus,
): ResourceAiAgentStatusPill {
  switch (getResourceAiAgentCardState(status)) {
    case "connected":
      return { text: "Connected", tone: "success" };
    case "not_installed":
      return { text: "Not installed", tone: "neutral" };
    case "offline":
    default:
      return { text: "Offline", tone: "danger" };
  }
}

/*
 * Why an offline agent is offline. The server's rule
 * (ResourceAiAgentService.isOnline) has two halves, and the page must not
 * blame the wrong one — right after a sign-off the meta line still reads
 * "last seen a few seconds ago":
 *
 * signed_off: it said goodbye or was reset (connectionStatus
 *             "disconnected") and was heard from within the alive window.
 *             A restarted container signs off, and "Reset agent" marks the
 *             row so; either way the agent registers again within a few
 *             minutes. The expected gap, not yet a fault.
 * gone:       disconnected and not heard from since the alive window — the
 *             container did not come back.
 * silent:     it never signed off but its heartbeats stopped (or it was
 *             never heard from): over the alive window without a word.
 */
export type ResourceAiAgentOfflineReason = "signed_off" | "gone" | "silent";

export function getResourceAiAgentOfflineReason(
  status: ResourceAiAccessStatus,
  now: Date = OneUptimeDate.getCurrentDate(),
): ResourceAiAgentOfflineReason {
  const agent: ResourceAiAgentSummary | null = status.agent;

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
    RESOURCE_AI_AGENT_ALIVE_WINDOW_IN_MINUTES * 60 * 1000
    ? "signed_off"
    : "gone";
}

// The one plain sentence under the pill.
export function getResourceAiAgentStateSentence(
  status: ResourceAiAccessStatus,
  descriptor: ResourceAiAgentDescriptor,
  now: Date = OneUptimeDate.getCurrentDate(),
): string {
  switch (getResourceAiAgentCardState(status)) {
    case "connected": {
      if (isResourceUnreachable(status)) {
        const reachError: string | null | undefined =
          status.agent?.posture?.reachError;

        return `The ${descriptor.agentName} is running, but it could not reach this ${descriptor.noun} at its last check${
          reachError ? `: ${reachError}` : "."
        } Check its logs:`;
      }

      return `The ${descriptor.agentName} is running next to this ${descriptor.noun}.`;
    }
    case "not_installed":
      return getResourceAiAgentNotInstalledText(descriptor);
    case "offline":
    default:
      switch (getResourceAiAgentOfflineReason(status, now)) {
        case "signed_off":
          return getResourceAiAgentSignedOffText(descriptor);
        case "gone":
          return getResourceAiAgentGoneText(descriptor);
        case "silent":
        default:
          return getResourceAiAgentSilentText(descriptor);
      }
  }
}

/*
 * Which command the card shows under its sentence: the install
 * instructions where installing the agent is the step, the logs command
 * where the agent is the place to look (offline, or online but unable to
 * reach the resource), and none otherwise.
 */
export type ResourceAiAgentCardCommand = "install" | "logs" | null;

export function getResourceAiAgentCardCommand(
  status: ResourceAiAccessStatus,
): ResourceAiAgentCardCommand {
  switch (getResourceAiAgentCardState(status)) {
    case "not_installed":
      return "install";
    case "offline":
      return "logs";
    case "connected":
    default:
      return isResourceUnreachable(status) ? "logs" : null;
  }
}

/*
 * What the agent may change, from the posture it reports: "Read-only",
 * "Can change: web, api" (ONEUPTIME_AI_WRITE_TARGETS) or "Can change any
 * target" (writes on, no target list). Null without a posture.
 */
export function describeResourceAiAgentWriteAccess(
  posture: ResourceAiAgentPosture | null | undefined,
): string | null {
  if (!posture) {
    return null;
  }

  if (posture.allowWrites !== true) {
    return translateTemplate("Read-only");
  }

  const targets: Array<string> = Array.isArray(posture.writeTargets)
    ? posture.writeTargets.filter((target: unknown): target is string => {
        return typeof target === "string" && target.trim().length > 0;
      })
    : [];

  return targets.length === 0
    ? translateTemplate("Can change any target")
    : translateTemplate("Can change: {{targets}}", {
        targets: targets.join(", "),
      });
}

/*
 * The resource's own version as the agent reported it: "Docker 27.3.1",
 * "Proxmox VE 8.2.4". A database's is labelled with its engine when the
 * agent reported one; a host's is shown as it is.
 */
export function formatResourceToolVersion(
  descriptor: ResourceAiAgentDescriptor,
  posture: ResourceAiAgentPosture | null | undefined,
): string | null {
  const version: string | null =
    typeof posture?.toolVersion === "string" && posture.toolVersion.trim()
      ? posture.toolVersion.trim()
      : null;

  if (!version) {
    return null;
  }

  let label: string | null = descriptor.toolVersionLabel;

  if (!label && descriptor.resourceType === AiResourceType.DatabaseServer) {
    const system: unknown = posture?.details?.["databaseSystem"];
    label = typeof system === "string" && system.trim() ? system.trim() : null;
  }

  if (!label || version.toLowerCase().startsWith(label.toLowerCase())) {
    return version;
  }

  return `${label} ${version}`;
}

/*
 * The card's meta line: when the agent was last seen, then the agent's
 * version — which the page draws with AgentVersion, so an outdated agent
 * gets its sign and upgrade dialog like every other agent version — then
 * the resource's version and what it may change. Nothing before an agent
 * ever registered.
 */
export interface ResourceAiAgentMeta {
  lastSeen: string | null;
  // The agent's version goes here, drawn by the page.
  showsAgentVersion: boolean;
  rest: Array<string>;
}

export function getResourceAiAgentMeta(
  status: ResourceAiAccessStatus,
  descriptor: ResourceAiAgentDescriptor,
): ResourceAiAgentMeta {
  const agent: ResourceAiAgentSummary | null = status.agent;

  if (!agent) {
    return { lastSeen: null, showsAgentVersion: false, rest: [] };
  }

  const parts: Array<string> = [];

  const lastSeen: string | null = agent.lastAliveAt
    ? translateTemplate("last seen {{time}}", {
        time: OneUptimeDate.fromNow(
          OneUptimeDate.fromString(agent.lastAliveAt),
        ),
      })
    : null;

  const toolVersion: string | null = formatResourceToolVersion(
    descriptor,
    agent.posture,
  );

  if (toolVersion) {
    parts.push(toolVersion);
  }

  const writeAccess: string | null = describeResourceAiAgentWriteAccess(
    agent.posture,
  );

  if (writeAccess) {
    parts.push(writeAccess);
  }

  return { lastSeen, showsAgentVersion: true, rest: parts };
}

// The meta line's words, in order, without the agent's version.
export function getResourceAiAgentMetaParts(
  status: ResourceAiAccessStatus,
  descriptor: ResourceAiAgentDescriptor,
): Array<string> {
  const meta: ResourceAiAgentMeta = getResourceAiAgentMeta(status, descriptor);

  return [...(meta.lastSeen ? [meta.lastSeen] : []), ...meta.rest];
}

/*
 * The warning for a registration the server refused while this agent was
 * online: another agent presenting this resource's identity (a second
 * install, or a container replaced without a clean shutdown). Null when
 * there is nothing recent to say.
 */
export function getResourceAiRefusedRegistrationWarning(
  agent: ResourceAiAgentSummary | null,
  descriptor: ResourceAiAgentDescriptor,
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
    RESOURCE_AI_REFUSED_REGISTRATION_WARNING_WINDOW_MS
  ) {
    return null;
  }

  const identityVariables: string =
    AI_RESOURCE_TYPE_INFO[descriptor.resourceType].identityEnvVars.join(" / ");

  return translateTemplate(
    "Another agent tried to register for this {{noun}} at {{time}} while this one was online. If two agents use the same {{variables}}, remove one or give each {{noun}} its own.",
    {
      noun: translatableTerm(descriptor.noun, { inSentence: true }),
      time: OneUptimeDate.getDateAsFormattedString(refusedAt),
      variables: identityVariables,
    },
  );
}

/*
 * The gaps the "Needs attention" card lists. Fixes being off is a choice,
 * not a problem: the "What AI may do" card shows it with its own hint, so
 * remediation_disabled is left out here (it is still a gap for the server
 * and the investigation panel).
 */
export const RESOURCE_AI_CHOICE_GAP_CODES: ReadonlyArray<ResourceAiAccessGapCode> =
  ["remediation_disabled"];

export function getResourceAiAttentionGaps(
  status: ResourceAiAccessStatus,
): Array<ResourceAiAccessGap> {
  return status.gaps.filter((gap: ResourceAiAccessGap): boolean => {
    return !RESOURCE_AI_CHOICE_GAP_CODES.includes(gap.code);
  });
}

/*
 * The one action a "Needs attention" step offers, or null when its next
 * step is a command already on the page (install, logs, write access).
 */
export type ResourceAiAgentGapAction =
  | "turn_on_investigation"
  // The agent keeps investigation off: show the .env lines that turn it on.
  | "set_investigation_in_agent"
  | "open_ai_features"
  | "open_llm_providers"
  | "open_ai_credits"
  | "test_connection";

export function getResourceAiAgentGapAction(
  gap: ResourceAiAccessGap,
  status: ResourceAiAccessStatus,
): ResourceAiAgentGapAction | null {
  switch (gap.code) {
    case "investigation_disabled":
      return isResourceAiSettingsSetByAgent(status)
        ? "set_investigation_in_agent"
        : "turn_on_investigation";
    /*
     * auto_remediation_disabled_for_project is retired (Enable AI covers
     * it); an older server may still send it mid-rollout.
     */
    case "ai_disabled_for_project":
    case "auto_remediation_disabled_for_project":
      return "open_ai_features";
    case "llm_provider_missing":
      return "open_llm_providers";
    case "ai_balance_insufficient":
      return "open_ai_credits";
    case "ai_agent_unreachable_resource":
      // Once the socket, address or credentials are fixed, prove it.
      return status.agent ? "test_connection" : null;
    default:
      return null;
  }
}

/*
 * "Needs attention" is one item, not a row per gap: a headline saying what
 * OneUptime AI cannot do on this resource, then the steps that fix it.
 *
 * The headline reads the gaps' own flags. Fixes only count while they are
 * on: an agent that is not connected blocks both investigation and fixes
 * for the server, but "can't run fixes" says nothing to someone who turned
 * fixes off.
 */
export function getResourceAiAttentionTitle(
  status: ResourceAiAccessStatus,
  descriptor: ResourceAiAgentDescriptor,
): string {
  const gaps: Array<ResourceAiAccessGap> = getResourceAiAttentionGaps(status);
  const blocksInvestigation: boolean = gaps.some(
    (gap: ResourceAiAccessGap): boolean => {
      return gap.blocksInvestigation === true;
    },
  );
  const blocksFixes: boolean = gaps.some(
    (gap: ResourceAiAccessGap): boolean => {
      return gap.blocksRemediation === true;
    },
  );
  const areFixesOn: boolean =
    parseResourceAiRemediationMode(status.aiRemediationMode) !==
    ResourceAiRemediationMode.Disabled;
  const values: TemplateValues = {
    noun: translatableTerm(descriptor.noun, { inSentence: true }),
  };

  if (blocksInvestigation && blocksFixes && areFixesOn) {
    return translateTemplate(
      "OneUptime AI can't investigate this {{noun}} or run fixes on it",
      values,
    );
  }

  if (blocksInvestigation) {
    return translateTemplate(
      "OneUptime AI can't investigate this {{noun}}",
      values,
    );
  }

  if (blocksFixes) {
    return translateTemplate(
      "OneUptime AI can't run fixes on this {{noun}}",
      values,
    );
  }

  return translateTemplate(
    "OneUptime AI can't do all of its job on this {{noun}}",
    values,
  );
}

/*
 * One gap as a step, in this page's words. The server's next steps are
 * written for every surface that shows a gap, so they send the reader to
 * "the AI agent page (AI → AI agent)" — this page — and repeat the install
 * snippet the agent card already shows. Here a step points at what is on
 * the page instead. A gap this build does not know keeps the server's
 * next step.
 */
export function getResourceAiAttentionStepText(
  gap: ResourceAiAccessGap,
  status: ResourceAiAccessStatus,
  descriptor: ResourceAiAgentDescriptor,
): string {
  const agentName: string = descriptor.agentName;
  const noun: string = descriptor.noun;

  switch (gap.code) {
    case "ai_agent_not_connected":
      return `Install the ${agentName} with the instructions above.`;
    case "ai_agent_offline":
      return `Bring the ${agentName} back online. Its logs say why it is offline (the command is above).`;
    case "ai_agent_unreachable_resource":
      // The server has two cases: it could not reach it, or has not said.
      return status.agent?.posture?.reachable === false
        ? `Let the ${agentName} reach this ${noun} (its error and the logs command are above), then test the connection.`
        : `Wait a minute for the ${agentName} to report that it can reach this ${noun}, then test the connection.`;
    case "investigation_disabled":
      return isResourceAiSettingsSetByAgent(status)
        ? translateTemplate(RESOURCE_AGENT_SET_INVESTIGATION_STEP_TEXT, {
            agent: translatableTerm(agentName),
          })
        : "Turn on AI investigation.";
    case "remediation_write_access_missing":
      return `Give the ${agentName} write access with the steps below.`;
    /*
     * auto_remediation_disabled_for_project is retired: Enable AI covers
     * it, so an older server that still sends it mid-rollout gets the same
     * step.
     */
    case "ai_disabled_for_project":
    case "auto_remediation_disabled_for_project":
      return "Turn on AI for this project.";
    case "llm_provider_missing":
      return "Add an AI provider for this project, or use OneUptime AI credits.";
    /*
     * Not "or turn on auto-recharge": AI credits are recharged after a call
     * they paid for, so a balance that is used up stays used up until
     * someone adds credits. Who can is the step's action
     * (ProjectBalance/ProjectBalanceAccess).
     */
    case "ai_balance_insufficient":
      return translateTemplate(ADD_AI_CREDITS_STEP);
    default:
      return gap.nextStep || gap.title;
  }
}

export interface ResourceAiAttentionStep {
  gap: ResourceAiAccessGap;
  text: string;
  action: ResourceAiAgentGapAction | null;
}

export interface ResourceAiAttention {
  title: string;
  steps: Array<ResourceAiAttentionStep>;
}

/*
 * The "Needs attention" item, or null when there is nothing to show: one
 * step per gap, in the server's order.
 */
export function getResourceAiAttention(
  status: ResourceAiAccessStatus,
  descriptor: ResourceAiAgentDescriptor,
): ResourceAiAttention | null {
  const gaps: Array<ResourceAiAccessGap> = getResourceAiAttentionGaps(status);

  if (gaps.length === 0) {
    return null;
  }

  return {
    title: getResourceAiAttentionTitle(status, descriptor),
    steps: gaps.map((gap: ResourceAiAccessGap): ResourceAiAttentionStep => {
      return {
        gap,
        text: getResourceAiAttentionStepText(gap, status, descriptor),
        action: getResourceAiAgentGapAction(gap, status),
      };
    }),
  };
}

/*
 * Show the write-access instructions? Only when fixes are on and the
 * agent reports that it runs read-only — never on a default install, and
 * never before an agent is installed (the install instructions come first).
 */
export function shouldShowResourceWriteAccessCommands(
  status: ResourceAiAccessStatus,
): boolean {
  if (
    parseResourceAiRemediationMode(status.aiRemediationMode) ===
    ResourceAiRemediationMode.Disabled
  ) {
    return false;
  }

  if (!status.agent) {
    return false;
  }

  return status.agent.posture?.allowWrites !== true;
}

/*
 * Why the AI Insights and AI Logs pages point at the AI agent page, or null
 * when they have no reason to: AI cannot run commands on the resource right
 * now (the status's own verdict, gaps included).
 */
export function getResourceAiAgentPageHint(
  status: ResourceAiAccessStatus | null,
  descriptor: ResourceAiAgentDescriptor,
): string | null {
  if (!status) {
    return null;
  }

  if (!status.isInvestigationReady) {
    return translateTemplate(
      "OneUptime AI can't run commands on this {{noun}} right now.",
      { noun: translatableTerm(descriptor.noun, { inSentence: true }) },
    );
  }

  return null;
}

// What POST /resource-ai-access/test answers, as the page reads it.
export interface ResourceAccessTestResult {
  ok: boolean;
  message: string;
  results: Array<{
    command: string;
    succeeded: boolean;
    exitCode: number | null;
    output: string;
    errorMessage: string | null;
  }>;
}

/*
 * The test's answer, read defensively: a missing message is empty, a
 * missing or malformed result list is empty, and a row's missing exit code
 * or error is null (the command never ran, or said nothing).
 */
export function parseResourceAccessTestResult(
  value: unknown,
): ResourceAccessTestResult {
  const data: Record<string, unknown> = isObject(value) ? value : {};
  const rows: Array<unknown> = Array.isArray(data["results"])
    ? (data["results"] as Array<unknown>)
    : [];

  return {
    ok: data["ok"] === true,
    message: typeof data["message"] === "string" ? data["message"] : "",
    results: rows.map(
      (row: unknown): ResourceAccessTestResult["results"][number] => {
        const item: Record<string, unknown> = isObject(row) ? row : {};

        return {
          command: typeof item["command"] === "string" ? item["command"] : "",
          succeeded: item["succeeded"] === true,
          exitCode:
            typeof item["exitCode"] === "number" &&
            Number.isFinite(item["exitCode"])
              ? item["exitCode"]
              : null,
          output: typeof item["output"] === "string" ? item["output"] : "",
          errorMessage:
            typeof item["errorMessage"] === "string"
              ? item["errorMessage"]
              : null,
        };
      },
    ),
  };
}
