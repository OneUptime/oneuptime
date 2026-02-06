import ObjectID from "../../../Types/ObjectID";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentEpisodeInternalNote from "../../../Models/DatabaseModels/IncidentEpisodeInternalNote";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../Services/IncidentEpisodeStateTimelineService";
import IncidentEpisodeInternalNoteService from "../../Services/IncidentEpisodeInternalNoteService";
import IncidentEpisodeMemberService from "../../Services/IncidentEpisodeMemberService";
import WorkspaceUtil, { WorkspaceChannelMessage } from "../Workspace/Workspace";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OneUptimeDate from "../../../Types/Date";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LLMMessage } from "../LLM/LLMService";
import NotificationRuleWorkspaceChannel from "../../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { AIGenerationContext } from "./IncidentAIContextBuilder";
import Incident from "../../../Models/DatabaseModels/Incident";

export interface IncidentEpisodeContextData {
  episode: IncidentEpisode;
  stateTimeline: Array<IncidentEpisodeStateTimeline>;
  internalNotes: Array<IncidentEpisodeInternalNote>;
  memberIncidents: Array<IncidentEpisodeMember>;
  workspaceMessages: Array<WorkspaceChannelMessage>;
}

export default class IncidentEpisodeAIContextBuilder {
  @CaptureSpan()
  public static async buildEpisodeContext(data: {
    episodeId: ObjectID;
    includeWorkspaceMessages?: boolean;
    workspaceMessageLimit?: number;
  }): Promise<IncidentEpisodeContextData> {
    const episode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneById({
        id: data.episodeId,
        select: {
          _id: true,
          title: true,
          description: true,
          createdAt: true,
          postmortemNote: true,
          remediationNotes: true,
          rootCause: true,
          projectId: true,
          episodeNumber: true,
          episodeNumberWithPrefix: true,
          incidentSeverity: {
            name: true,
            color: true,
          },
          currentIncidentState: {
            name: true,
            color: true,
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

    if (!episode) {
      throw new Error("Incident Episode not found");
    }

    // Fetch state timeline
    const stateTimeline: Array<IncidentEpisodeStateTimeline> =
      await IncidentEpisodeStateTimelineService.findBy({
        query: {
          incidentEpisodeId: data.episodeId,
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
    const internalNotes: Array<IncidentEpisodeInternalNote> =
      await IncidentEpisodeInternalNoteService.findBy({
        query: {
          incidentEpisodeId: data.episodeId,
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

    // Fetch member incidents
    const memberIncidents: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findBy({
        query: {
          incidentEpisodeId: data.episodeId,
        },
        select: {
          _id: true,
          createdAt: true,
          incident: {
            _id: true,
            title: true,
            description: true,
            incidentNumber: true,
            incidentNumberWithPrefix: true,
            createdAt: true,
            rootCause: true,
            remediationNotes: true,
            incidentSeverity: {
              name: true,
            },
            currentIncidentState: {
              name: true,
            },
            monitors: {
              name: true,
            },
          },
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: 50,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    // Fetch workspace messages if requested and channels exist
    let workspaceMessages: Array<WorkspaceChannelMessage> = [];

    const workspaceChannels:
      | Array<NotificationRuleWorkspaceChannel>
      | undefined = episode.postUpdatesToWorkspaceChannels as
      | Array<NotificationRuleWorkspaceChannel>
      | undefined;

    if (
      data.includeWorkspaceMessages &&
      workspaceChannels &&
      workspaceChannels.length > 0 &&
      episode.projectId
    ) {
      try {
        const fetchParams: {
          projectId: ObjectID;
          workspaceChannels: Array<NotificationRuleWorkspaceChannel>;
          limit?: number;
          oldestTimestamp?: Date;
        } = {
          projectId: episode.projectId,
          workspaceChannels: workspaceChannels,
          limit: data.workspaceMessageLimit || 500,
        };

        if (episode.createdAt) {
          fetchParams.oldestTimestamp = episode.createdAt;
        }

        workspaceMessages =
          await this.getWorkspaceMessagesForEpisode(fetchParams);
      } catch (error) {
        logger.error(`Error fetching workspace messages: ${error}`);
        // Continue without workspace messages
      }
    }

    return {
      episode,
      stateTimeline,
      internalNotes,
      memberIncidents,
      workspaceMessages,
    };
  }

  @CaptureSpan()
  public static formatEpisodeContextForPostmortem(
    contextData: IncidentEpisodeContextData,
    template?: string,
  ): AIGenerationContext {
    const {
      episode,
      stateTimeline,
      internalNotes,
      memberIncidents,
      workspaceMessages,
    } = contextData;

    let contextText: string = "";

    // Basic episode information
    contextText += "# Incident Episode Information\n\n";
    contextText += `**Episode Number:** ${episode.episodeNumberWithPrefix || '#' + (episode.episodeNumber || "N/A")}\n\n`;
    contextText += `**Title:** ${episode.title || "N/A"}\n\n`;
    contextText += `**Description:** ${episode.description || "N/A"}\n\n`;
    contextText += `**Severity:** ${episode.incidentSeverity?.name || "N/A"}\n\n`;
    contextText += `**Current State:** ${episode.currentIncidentState?.name || "N/A"}\n\n`;
    contextText += `**Created At:** ${episode.createdAt ? OneUptimeDate.getDateAsFormattedString(episode.createdAt) : "N/A"}\n\n`;

    // Labels
    if (episode.labels && episode.labels.length > 0) {
      contextText += "**Labels:** ";
      contextText += episode.labels
        .map((l: { name?: string }) => {
          return l.name;
        })
        .join(", ");
      contextText += "\n\n";
    }

    // Root cause if available
    if (episode.rootCause) {
      contextText += `**Root Cause:** ${episode.rootCause}\n\n`;
    }

    // Remediation notes if available
    if (episode.remediationNotes) {
      contextText += `**Remediation Notes:** ${episode.remediationNotes}\n\n`;
    }

    // Member incidents
    if (memberIncidents.length > 0) {
      contextText += "# Member Incidents\n\n";
      contextText += `This episode contains ${memberIncidents.length} incident(s):\n\n`;

      for (const member of memberIncidents) {
        const incident: Incident | undefined = member.incident;
        if (!incident) {
          continue;
        }

        contextText += `## Incident ${incident.incidentNumberWithPrefix || '#' + (incident.incidentNumber || "N/A")}: ${incident.title || "Untitled"}\n\n`;
        contextText += `- **Severity:** ${incident.incidentSeverity?.name || "N/A"}\n`;
        contextText += `- **State:** ${incident.currentIncidentState?.name || "N/A"}\n`;
        contextText += `- **Created:** ${incident.createdAt ? OneUptimeDate.getDateAsFormattedString(incident.createdAt) : "N/A"}\n`;

        if (incident.description) {
          contextText += `- **Description:** ${incident.description}\n`;
        }

        if (incident.monitors && incident.monitors.length > 0) {
          contextText += `- **Affected Monitors:** ${incident.monitors
            .map((m: { name?: string }) => {
              return m.name;
            })
            .join(", ")}\n`;
        }

        if (incident.rootCause) {
          contextText += `- **Root Cause:** ${incident.rootCause}\n`;
        }

        if (incident.remediationNotes) {
          contextText += `- **Remediation:** ${incident.remediationNotes}\n`;
        }

        contextText += "\n";
      }
    }

    // State timeline
    if (stateTimeline.length > 0) {
      contextText += "# Episode State Timeline\n\n";
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

    // Workspace messages (Slack/Teams)
    if (workspaceMessages.length > 0) {
      contextText += "# Discussion from Episode Channel\n\n";
      contextText += WorkspaceUtil.formatMessagesAsContext(workspaceMessages, {
        includeTimestamp: true,
        includeUsername: true,
        maxLength: 30000,
      });
      contextText += "\n\n";
    }

    // System prompt for postmortem generation
    let systemPrompt: string;

    if (template) {
      // When a template is provided, strictly fill only the template
      systemPrompt = `You are an expert Site Reliability Engineer (SRE) and incident response specialist. Your task is to fill in an incident episode postmortem template based on the provided episode data.

An incident episode is a grouping of related incidents that occurred together or share a common cause.

CRITICAL INSTRUCTIONS:
- You MUST use ONLY the exact template structure provided below
- Fill in each section of the template with relevant information from the episode data
- Do NOT add any new sections, headers, or content that is not part of the template
- Do NOT add introductions, conclusions, or any text outside the template structure
- If a section in the template has no relevant data, write "No data available" or leave the placeholder text
- Be blameless - focus on systemic improvements rather than individual blame
- Write in a professional, clear, and concise manner
- Consider all member incidents when analyzing root cause and impact

TEMPLATE TO FILL (use this exact structure):

${template}`;
    } else {
      // When no template is provided, use standard format
      systemPrompt = `You are an expert Site Reliability Engineer (SRE) and incident response specialist. Your task is to generate a comprehensive, well-structured postmortem for an incident episode based on the provided data.

An incident episode is a grouping of related incidents that occurred together or share a common cause.

The postmortem should:
1. Be written in a blameless manner, focusing on systemic improvements rather than individual blame
2. Include a clear executive summary that covers all member incidents
3. Provide a detailed timeline of events across all incidents
4. Identify the common root cause(s) and contributing factors
5. Outline the cumulative impact on users and systems
6. List actionable items to prevent recurrence of similar episodes
7. Include lessons learned from the entire episode

Use a standard incident postmortem format with sections for: Executive Summary, Timeline, Root Cause Analysis, Impact, Action Items, and Lessons Learned.

Write in a professional, clear, and concise manner. Use markdown formatting for better readability.`;
    }

    // Build user message based on whether template is provided
    const userMessage: string = template
      ? `Fill in the template above using ONLY the following incident episode data. Output only the filled template, nothing else:\n\n${contextText}`
      : `Based on the following incident episode data, please generate a comprehensive postmortem:\n\n${contextText}`;

    // Build messages array
    const messages: Array<LLMMessage> = [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: userMessage,
      },
    ];

    return {
      contextText,
      systemPrompt,
      messages,
    };
  }

  @CaptureSpan()
  private static async getWorkspaceMessagesForEpisode(data: {
    projectId: ObjectID;
    workspaceChannels: Array<NotificationRuleWorkspaceChannel>;
    limit?: number;
    oldestTimestamp?: Date;
  }): Promise<Array<WorkspaceChannelMessage>> {
    const allMessages: Array<WorkspaceChannelMessage> = [];

    for (const channel of data.workspaceChannels) {
      try {
        // Get auth token for this workspace type
        const projectAuth: WorkspaceProjectAuthToken | null =
          await WorkspaceProjectAuthTokenService.getProjectAuth({
            projectId: data.projectId,
            workspaceType: channel.workspaceType,
          });

        if (!projectAuth || !projectAuth.authToken) {
          logger.debug(
            `No auth token found for workspace type: ${channel.workspaceType}`,
          );
          continue;
        }

        const messagesParams: {
          channelId: string;
          authToken: string;
          projectId: ObjectID;
          workspaceType: WorkspaceType;
          teamId?: string;
          limit?: number;
          oldestTimestamp?: Date;
        } = {
          channelId: channel.id,
          authToken: projectAuth.authToken,
          projectId: data.projectId,
          workspaceType: channel.workspaceType,
        };

        if (channel.teamId) {
          messagesParams.teamId = channel.teamId;
        }

        if (data.limit !== undefined) {
          messagesParams.limit = data.limit;
        }

        if (data.oldestTimestamp) {
          messagesParams.oldestTimestamp = data.oldestTimestamp;
        }

        const messages: Array<WorkspaceChannelMessage> =
          await WorkspaceUtil.getChannelMessages(messagesParams);

        allMessages.push(...messages);
      } catch (error) {
        logger.error(
          `Error fetching messages from channel ${channel.id}: ${error}`,
        );
        // Continue with other channels even if one fails
      }
    }

    // Sort all messages by timestamp
    allMessages.sort(
      (a: WorkspaceChannelMessage, b: WorkspaceChannelMessage) => {
        return a.timestamp.getTime() - b.timestamp.getTime();
      },
    );

    return allMessages;
  }
}
