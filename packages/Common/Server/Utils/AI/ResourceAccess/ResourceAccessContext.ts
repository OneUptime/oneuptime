import {
  AI_RESOURCE_TYPE_INFO,
  AiResourceTypeInfo,
  isAiResourceType,
} from "../../../../Types/ResourceAiAgent/AiResourceType";
import {
  ResourceAiAccessGap,
  ResourceAiAccessStatus,
  ResourceAiRemediationMode,
} from "../../../../Types/ResourceAiAgent/ResourceAiAccess";
import {
  describeResourceNoun,
  getResourceAiAgentPage,
} from "../../../Services/ResourceAiAccessService";
import {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
} from "./ResourceAccessToolNames";

/*
 * The prompt-side view of infrastructure access — the resource-agnostic
 * sibling of ClusterAccessContext, for the Docker and Podman hosts, Docker
 * Swarm, Proxmox, VMware and Ceph clusters, database servers and hosts an
 * incident or alert is linked to.
 *
 * Two audiences read this: the model, which needs to know which resources
 * it may inspect and how; and, through the model's report, the on-call
 * human, who needs to hear "I could not inspect the host, here is why — and
 * here is what to install" in the report itself. Everything here is
 * deterministic text derived from ResourceAiAccessStatus — never model
 * output.
 */

// 'Docker host "web-1"', 'Host "web-2"' — how a resource is named in copy.
export function describeResource(status: ResourceAiAccessStatus): string {
  const info: AiResourceTypeInfo | null = isAiResourceType(status.resourceType)
    ? AI_RESOURCE_TYPE_INFO[status.resourceType]
    : null;

  return `${info ? info.displayName : "Resource"} "${status.resourceName}"`;
}

// "the Docker AI agent" — who runs commands on this resource.
export function describeResourceAgent(status: ResourceAiAccessStatus): string {
  return isAiResourceType(status.resourceType)
    ? `the ${AI_RESOURCE_TYPE_INFO[status.resourceType].agentDisplayName}`
    : "the resource's AI agent";
}

// The gaps that stop an investigation from running commands on it.
function getBlockingGaps(
  status: ResourceAiAccessStatus,
): Array<ResourceAiAccessGap> {
  return status.gaps.filter((gap: ResourceAiAccessGap): boolean => {
    return gap.blocksInvestigation;
  });
}

function findAgentMissingGap(
  status: ResourceAiAccessStatus,
): ResourceAiAccessGap | undefined {
  return status.gaps.find((gap: ResourceAiAccessGap): boolean => {
    return gap.code === "ai_agent_not_connected";
  });
}

export default class ResourceAccessContext {
  public static readonly REPORT_SECTION_HEADING: string =
    "Infrastructure access";

  /*
   * Appended to the investigation persona whenever the subject is linked to
   * at least one infrastructure resource, ready or not.
   */
  public static buildPersonaAddendum(
    statuses: Array<ResourceAiAccessStatus>,
  ): string {
    const ready: Array<ResourceAiAccessStatus> = statuses.filter(
      (status: ResourceAiAccessStatus): boolean => {
        return status.isInvestigationReady;
      },
    );

    const lines: Array<string> = [];

    if (ready.length > 0) {
      lines.push(
        `This signal is linked to infrastructure resource(s) OneUptime AI can inspect directly through their AI agents: ${ready
          .map((status: ResourceAiAccessStatus): string => {
            return describeResource(status);
          })
          .join(
            ", ",
          )}. Use ${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} for READ-ONLY inspection the way an on-call engineer would open a terminal on the box: list and inspect the failing containers or services and read their recent logs, check the resource's health, capacity and recent events. Each call runs ONE command (an argv — no shell, no pipes or redirects, no sudo) with the programs the tool lists for that resource. Prefer direct inspection over guessing from metrics when the two disagree. Every command that ran is cited like any other tool result; a command that could not run comes back as an error, is not evidence, and must never be described as inspected. A resource's agent can itself be down: if ${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} says an agent did not pick up a command, that resource is unreachable for the rest of this investigation — do not run commands on it again, continue with OneUptime telemetry, and say so in your report. Anything that changes a resource is refused, and credential-looking values (passwords, tokens, keys, connection strings) are redacted from every output before you see it — never ask for them and never treat a redaction marker as a finding.`,
      );
    }

    const notReady: Array<ResourceAiAccessStatus> = statuses.filter(
      (status: ResourceAiAccessStatus): boolean => {
        return !status.isInvestigationReady;
      },
    );

    if (notReady.length > 0) {
      lines.push(
        `This signal is linked to infrastructure resource(s) OneUptime AI CANNOT inspect directly: ${notReady
          .map((status: ResourceAiAccessStatus): string => {
            return `${describeResource(status)} (${ResourceAccessContext.describeWhyNotReady(
              status,
            )})`;
          })
          .join(
            ", ",
          )}. Investigate them with OneUptime's own telemetry (metrics, logs, events, traces) and say plainly in your report that you could not inspect them directly. Do NOT invent command output.`,
      );
    }

    lines.push(
      `Add a section **${ResourceAccessContext.REPORT_SECTION_HEADING}** before Suggested next steps: one or two sentences on what you inspected directly on each linked resource (or that you could not — no AI agent connected, the agent not responding, or AI investigation turned off for it — and that the human should check the resource's AI agent page (AI → AI agent), where the agent's install snippet is).`,
    );

    return lines.join("\n");
  }

  // The "# Infrastructure access" block of the context summary.
  public static buildContextSection(
    statuses: Array<ResourceAiAccessStatus>,
  ): string {
    if (statuses.length === 0) {
      return "";
    }

    const lines: Array<string> = ["", "# Infrastructure access"];

    for (const status of statuses) {
      const info: AiResourceTypeInfo | null = isAiResourceType(
        status.resourceType,
      )
        ? AI_RESOURCE_TYPE_INFO[status.resourceType]
        : null;

      if (status.isInvestigationReady && info) {
        lines.push(
          `- ${describeResource(status)} (resourceId: ${status.resourceId}): READ access via ${RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME} through its ${info.agentDisplayName} (programs: ${info.programs.join(
            ", ",
          )}). Remediation: ${ResourceAccessContext.describeRemediationMode(
            status,
          )}.`,
        );
        continue;
      }

      const reasons: Array<string> = getBlockingGaps(status).map(
        (gap: ResourceAiAccessGap): string => {
          return gap.title;
        },
      );

      // No agent at all: say what to install, in the status's own words.
      const notConnected: ResourceAiAccessGap | undefined =
        findAgentMissingGap(status);

      lines.push(
        `- ${describeResource(status)} (resourceId: ${status.resourceId}): NO direct access — ${
          reasons.length > 0 ? reasons.join("; ") : "not configured"
        }.${notConnected ? ` ${notConnected.nextStep}` : ""} Investigate with OneUptime telemetry only.`,
      );
    }

    return lines.join("\n");
  }

  /*
   * The sentence the investigation panel shows humans when AI investigated
   * a resource with OneUptime data only. Deterministic so it reads the same
   * on every panel and never depends on the model remembering to say it.
   */
  public static describeMissingAccessForHumans(
    status: ResourceAiAccessStatus,
  ): string {
    const blocking: Array<ResourceAiAccessGap> = getBlockingGaps(status);

    if (blocking.length === 0 && status.isInvestigationReady) {
      return `OneUptime AI can run read-only commands on ${describeResource(
        status,
      )} through ${describeResourceAgent(status)}.`;
    }

    const first: ResourceAiAccessGap | undefined = blocking[0];

    if (!first) {
      return `OneUptime AI could not run commands on ${describeResource(
        status,
      )}.`;
    }

    return `OneUptime AI could not run commands on ${describeResource(
      status,
    )}: ${first.title.charAt(0).toLowerCase()}${first.title.slice(1)}. ${first.nextStep}`;
  }

  /*
   * Why a resource cannot be inspected, as a short clause for the persona:
   * the first blocking gap, and what to install when no agent is there.
   */
  private static describeWhyNotReady(status: ResourceAiAccessStatus): string {
    const first: ResourceAiAccessGap | undefined = getBlockingGaps(status)[0];

    if (!first) {
      return "not configured";
    }

    const title: string = `${first.title.charAt(0).toLowerCase()}${first.title.slice(1)}`;

    if (
      first.code === "ai_agent_not_connected" &&
      isAiResourceType(status.resourceType)
    ) {
      const info: AiResourceTypeInfo =
        AI_RESOURCE_TYPE_INFO[status.resourceType];

      return `${title} — the operator should install the ${info.agentDisplayName} (see ${getResourceAiAgentPage(
        status.resourceType,
      )})`;
    }

    return title;
  }

  /*
   * The resource's remediation mode in the words of the canonical
   * ResourceAiRemediationMode comment (Types/ResourceAiAgent/
   * ResourceAiAccess): what runs without a human, what is proposed
   * instead, and what always asks.
   */
  private static describeRemediationMode(
    status: ResourceAiAccessStatus,
  ): string {
    const noun: string = isAiResourceType(status.resourceType)
      ? describeResourceNoun(status.resourceType)
      : "resource";

    if (status.aiRemediationMode === ResourceAiRemediationMode.BypassApproval) {
      return status.isRemediationReady
        ? `Bypass approval (AI does not ask: every fix the ${noun}'s command policy allows, safe and riskier, runs without a human — except commands the policy says always need a human; destructive commands never run)`
        : "Bypass approval, but not ready";
    }

    if (status.aiRemediationMode === ResourceAiRemediationMode.Automatic) {
      return status.isRemediationReady
        ? `Automatic (safe fixes run without a human, and so do riskier ones whose shape the ${noun}'s command allowlist names; any other riskier fix is proposed for one-click approval, commands the policy says always need a human always ask, and destructive commands never run)`
        : "Automatic, but not ready";
    }

    if (
      status.aiRemediationMode === ResourceAiRemediationMode.RequireApproval
    ) {
      return status.isRemediationReady
        ? "a human approves any fix before it runs"
        : "requires approval, but not ready";
    }

    return "disabled — AI may only inspect";
  }
}

// Re-exported for the callers that read them with the context.
export {
  LIST_INFRASTRUCTURE_ACCESS_TOOL_NAME,
  RUN_INFRASTRUCTURE_COMMAND_TOOL_NAME,
};
