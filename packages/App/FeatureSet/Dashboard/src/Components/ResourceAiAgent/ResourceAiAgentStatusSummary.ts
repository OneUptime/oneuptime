import { ResourceAiAgentDescriptor } from "./ResourceAiAgentDescriptors";
import {
  ResourceAiAgentCardState,
  ResourceAiAttention,
  getResourceAiAgentCardState,
  getResourceAiAgentMetaParts,
  getResourceAiAttention,
  isResourceUnreachable,
} from "./ResourceAiAgentStatus";
import {
  RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
  RESOURCE_REMEDIATION_MODE_SUMMARIES,
  getResourceInvestigationOnSentence,
  readResourceRemediationMode,
} from "./ResourceAiAccessSettingsUtil";
import {
  getAiFixesBadge,
  getAiInvestigationBadge,
  getAiInvestigationOffSentence,
} from "../AiAccess/AiAccessModes";
import {
  AiAgentStatusSummary,
  getAiAgentConnectionBadge,
  getAiAgentConnectionSentence,
  getAiAgentUnreachableSentence,
} from "../AiAccess/AiAgentStatusSummary";
import {
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "Common/Types/ResourceAiAgent/ResourceAiAccess";

/*
 * The Overview's "AI agent" card for a resource a resource AI agent serves
 * (Docker, Podman and Docker Swarm hosts, Proxmox and Ceph clusters, VMware
 * vCenters, database servers and hosts), from the status its AI agent page
 * reads (POST /resource-ai-access/status). Every decision is one the page
 * makes already — the agent's state, its meta line, the investigation
 * switch, the fixes mode and the "Needs attention" headline — read through
 * the same utils, so the card and the page never disagree.
 *
 * Import-clean on purpose (Common types, the descriptors and the AI agent
 * page's utils), so the suites read it without a browser.
 */
export function getResourceAiAgentStatusSummary(
  status: ResourceAiAccessStatus,
  descriptor: ResourceAiAgentDescriptor,
): AiAgentStatusSummary {
  const state: ResourceAiAgentCardState = getResourceAiAgentCardState(status);
  const mode: ResourceAiRemediationMode = readResourceRemediationMode(
    status.aiRemediationMode,
  );
  const attention: ResourceAiAttention | null = getResourceAiAttention(
    status,
    descriptor,
  );

  return {
    connection: getAiAgentConnectionBadge(state),
    connectionSentence: isResourceUnreachable(status)
      ? getAiAgentUnreachableSentence({
          agentName: descriptor.agentName,
          noun: descriptor.noun,
        })
      : getAiAgentConnectionSentence({
          state,
          agentName: descriptor.agentName,
        }),
    connectionDetails: getResourceAiAgentMetaParts(status, descriptor),
    investigation: getAiInvestigationBadge(
      status.isAiInvestigationEnabled === true,
    ),
    investigationSentence:
      status.isAiInvestigationEnabled === true
        ? getResourceInvestigationOnSentence(descriptor)
        : getAiInvestigationOffSentence(descriptor.noun),
    fixes: getAiFixesBadge({
      mode,
      shortNames: RESOURCE_REMEDIATION_MODE_SHORT_NAMES,
    }),
    fixesSentence: RESOURCE_REMEDIATION_MODE_SUMMARIES[mode],
    attention: attention ? attention.title : null,
  };
}
