import ObjectID from "../../../Types/ObjectID";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentService from "../../Services/IncidentService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import IncidentInternalNoteService from "../../Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../Services/IncidentPublicNoteService";
import WorkspaceChannelMessageUtil, {
  WorkspaceChannelMessage,
} from "../Workspace/WorkspaceChannelMessageUtil";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OneUptimeDate from "../../../Types/Date";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LLMMessage } from "../LLM/LLMService";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";

export interface IncidentContextData {
  incident: Incident;
  stateTimeline: Array<IncidentStateTimeline>;
  internalNotes: Array<IncidentInternalNote>;
  publicNotes: Array<IncidentPublicNote>;
  workspaceMessages: Array<WorkspaceChannelMessage>;
}

export interface AIGenerationContext {
  contextText: string;
  systemPrompt: string;
  messages: Array<LLMMessage>;
}

export default class IncidentAIContextBuilder {
  @CaptureSpan()
  public static async buildIncidentContext(data: {
    incidentId: ObjectID;
    includeWorkspaceMessages?: boolean;
    workspaceMessageLimit?: number;
  }): Promise<IncidentContextData> {
    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        _id: true,
        title: true,
        description: true,
        createdAt: true,
        postmortemNote: true,
        remediationNotes: true,
        rootCause: true,
        customFields: true,
        projectId: true,
        incidentSeverity: {
          name: true,
          color: true,
        },
        currentIncidentState: {
          name: true,
          color: true,
        },
        monitors: {
          name: true,
        },
        labels: {
          name: true,
          color: true,
        },
        postUpdatesToWorkspaceChannels: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new Error("Incident not found");
    }

    // Fetch state timeline
    const stateTimeline: Array<IncidentStateTimeline> =
      await IncidentStateTimelineService.findBy({
        query: {
          incidentId: data.incidentId,
        },
        select: {
          _id: true,
          createdAt: true,
          startsAt: true,
          endsAt: true,
          rootCause: true,
          incidentState: {
            name: true,
            color: true,
          },
          createdByUser: {
            name: true,
            email: true,
          },
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        limit: 100,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    // Fetch internal notes
    const internalNotes: Array<IncidentInternalNote> =
      await IncidentInternalNoteService.findBy({
        query: {
          incidentId: data.incidentId,
        },
        select: {
          _id: true,
          note: true,
          createdAt: true,
          createdByUser: {
            name: true,
            email: true,
          },
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: 100,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    // Fetch public notes
    const publicNotes: Array<IncidentPublicNote> =
      await IncidentPublicNoteService.findBy({
        query: {
          incidentId: data.incidentId,
        },
        select: {
          _id: true,
          note: true,
          createdAt: true,
          postedAt: true,
          createdByUser: {
            name: true,
            email: true,
          },
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: 100,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    // Fetch workspace messages if requested and channels exist
    let workspaceMessages: Array<WorkspaceChannelMessage> = [];

    const workspaceChannels:
      | Array<NotificationRuleWorkspaceChannel>
      | undefined =
      incident.postUpdatesToWorkspaceChannels as
        | Array<NotificationRuleWorkspaceChannel>
        | undefined;

    if (
      data.includeWorkspaceMessages &&
      workspaceChannels &&
      workspaceChannels.length > 0 &&
      incident.projectId
    ) {
      try {
        const channelMessagesParams: {
          projectId: ObjectID;
          workspaceChannels: Array<NotificationRuleWorkspaceChannel>;
          limit?: number;
          oldestTimestamp?: Date;
        } = {
          projectId: incident.projectId,
          workspaceChannels: workspaceChannels,
          limit: data.workspaceMessageLimit || 500,
        };

        if (incident.createdAt) {
          channelMessagesParams.oldestTimestamp = incident.createdAt;
        }

        workspaceMessages =
          await WorkspaceChannelMessageUtil.getChannelMessagesForIncident(
            channelMessagesParams,
          );
      } catch (error) {
        logger.error(`Error fetching workspace messages: ${error}`);
        // Continue without workspace messages
      }
    }

    return {
      incident,
      stateTimeline,
      internalNotes,
      publicNotes,
      workspaceMessages,
    };
  }

  @CaptureSpan()
  public static formatIncidentContextForPostmortem(
    contextData: IncidentContextData,
    template?: string,
  ): AIGenerationContext {
    const { incident, stateTimeline, internalNotes, publicNotes, workspaceMessages } =
      contextData;

    let contextText: string = "";

    // Basic incident information
    contextText += "# Incident Information\n\n";
    contextText += `**Title:** ${incident.title || "N/A"}\n\n`;
    contextText += `**Description:** ${incident.description || "N/A"}\n\n`;
    contextText += `**Severity:** ${incident.incidentSeverity?.name || "N/A"}\n\n`;
    contextText += `**Current State:** ${incident.currentIncidentState?.name || "N/A"}\n\n`;
    contextText += `**Created At:** ${incident.createdAt ? OneUptimeDate.getDateAsFormattedString(incident.createdAt) : "N/A"}\n\n`;

    // Affected monitors
    if (incident.monitors && incident.monitors.length > 0) {
      contextText += "**Affected Monitors:** ";
      contextText += incident.monitors
        .map((m: { name?: string }) => {
          return m.name;
        })
        .join(", ");
      contextText += "\n\n";
    }

    // Labels
    if (incident.labels && incident.labels.length > 0) {
      contextText += "**Labels:** ";
      contextText += incident.labels
        .map((l: { name?: string }) => {
          return l.name;
        })
        .join(", ");
      contextText += "\n\n";
    }

    // Root cause if available
    if (incident.rootCause) {
      contextText += `**Root Cause:** ${incident.rootCause}\n\n`;
    }

    // Remediation notes if available
    if (incident.remediationNotes) {
      contextText += `**Remediation Notes:** ${incident.remediationNotes}\n\n`;
    }

    // State timeline
    if (stateTimeline.length > 0) {
      contextText += "# State Timeline\n\n";
      for (const timeline of stateTimeline) {
        const startTime: string = timeline.startsAt
          ? OneUptimeDate.getDateAsFormattedString(timeline.startsAt)
          : "N/A";
        const stateName: string =
          timeline.incidentState?.name?.toString() || "Unknown";
        const createdBy: string =
          timeline.createdByUser?.name?.toString() ||
          timeline.createdByUser?.email?.toString() ||
          "System";

        contextText += `- **${startTime}**: State changed to **${stateName}** by ${createdBy}\n`;
        if (timeline.rootCause) {
          contextText += `  - Root cause noted: ${timeline.rootCause}\n`;
        }
      }
      contextText += "\n";
    }

    // Internal notes
    if (internalNotes.length > 0) {
      contextText += "# Internal Notes (Private)\n\n";
      for (const note of internalNotes) {
        const noteTime: string = note.createdAt
          ? OneUptimeDate.getDateAsFormattedString(note.createdAt)
          : "N/A";
        const createdBy: string =
          note.createdByUser?.name?.toString() ||
          note.createdByUser?.email?.toString() ||
          "Unknown";

        contextText += `**[${noteTime}] ${createdBy}:**\n`;
        contextText += `${note.note || "N/A"}\n\n`;
      }
    }

    // Public notes
    if (publicNotes.length > 0) {
      contextText += "# Public Notes\n\n";
      for (const note of publicNotes) {
        const noteTime: string = note.postedAt
          ? OneUptimeDate.getDateAsFormattedString(note.postedAt)
          : note.createdAt
            ? OneUptimeDate.getDateAsFormattedString(note.createdAt)
            : "N/A";
        const createdBy: string =
          note.createdByUser?.name?.toString() ||
          note.createdByUser?.email?.toString() ||
          "Unknown";

        contextText += `**[${noteTime}] ${createdBy}:**\n`;
        contextText += `${note.note || "N/A"}\n\n`;
      }
    }

    // Workspace messages (Slack/Teams)
    if (workspaceMessages.length > 0) {
      contextText += "# Discussion from Incident Channel\n\n";
      contextText += WorkspaceChannelMessageUtil.formatMessagesAsContext(
        workspaceMessages,
        {
          includeTimestamp: true,
          includeUsername: true,
          maxLength: 30000,
        },
      );
      contextText += "\n\n";
    }

    // System prompt for postmortem generation
    const systemPrompt: string = `You are an expert Site Reliability Engineer (SRE) and incident response specialist. Your task is to generate a comprehensive, well-structured incident postmortem based on the provided incident data.

The postmortem should:
1. Be written in a blameless manner, focusing on systemic improvements rather than individual blame
2. Include a clear executive summary
3. Provide a detailed timeline of events
4. Identify the root cause(s) and contributing factors
5. Outline the impact on users and systems
6. List actionable items to prevent recurrence
7. Include lessons learned

${template ? `Use the following template structure:\n\n${template}` : "Use a standard incident postmortem format with sections for: Executive Summary, Timeline, Root Cause Analysis, Impact, Action Items, and Lessons Learned."}

Write in a professional, clear, and concise manner. Use markdown formatting for better readability.`;

    // Build messages array
    const messages: Array<LLMMessage> = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: `Based on the following incident data, please generate a comprehensive incident postmortem:\n\n${contextText}`,
      },
    ];

    return {
      contextText,
      systemPrompt,
      messages,
    };
  }

  @CaptureSpan()
  public static buildGenericAIContext(data: {
    systemPrompt: string;
    userPrompt: string;
    context?: string;
  }): AIGenerationContext {
    let userContent: string = data.userPrompt;

    if (data.context) {
      userContent = `${data.userPrompt}\n\nContext:\n${data.context}`;
    }

    const messages: Array<LLMMessage> = [
      {
        role: "system",
        content: data.systemPrompt,
      },
      {
        role: "user",
        content: userContent,
      },
    ];

    return {
      contextText: data.context || "",
      systemPrompt: data.systemPrompt,
      messages,
    };
  }
}
