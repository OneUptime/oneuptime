import ObjectID from "../../../Types/ObjectID";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ScheduledMaintenanceInternalNote from "../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../Services/ScheduledMaintenanceStateTimelineService";
import ScheduledMaintenanceInternalNoteService from "../../Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenancePublicNoteService from "../../Services/ScheduledMaintenancePublicNoteService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OneUptimeDate from "../../../Types/Date";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LLMMessage } from "../LLM/LLMService";

export interface ScheduledMaintenanceContextData {
  scheduledMaintenance: ScheduledMaintenance;
  stateTimeline: Array<ScheduledMaintenanceStateTimeline>;
  internalNotes: Array<ScheduledMaintenanceInternalNote>;
  publicNotes: Array<ScheduledMaintenancePublicNote>;
}

export interface AIGenerationContext {
  contextText: string;
  systemPrompt: string;
  messages: Array<LLMMessage>;
}

export default class ScheduledMaintenanceAIContextBuilder {
  @CaptureSpan()
  public static async buildScheduledMaintenanceContext(data: {
    scheduledMaintenanceId: ObjectID;
  }): Promise<ScheduledMaintenanceContextData> {
    const scheduledMaintenance: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneById({
        id: data.scheduledMaintenanceId,
        select: {
          _id: true,
          title: true,
          description: true,
          createdAt: true,
          startsAt: true,
          endsAt: true,
          customFields: true,
          projectId: true,
          currentScheduledMaintenanceState: {
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
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenance) {
      throw new Error("Scheduled Maintenance not found");
    }

    // Fetch state timeline
    const stateTimeline: Array<ScheduledMaintenanceStateTimeline> =
      await ScheduledMaintenanceStateTimelineService.findBy({
        query: {
          scheduledMaintenanceId: data.scheduledMaintenanceId,
        },
        select: {
          _id: true,
          createdAt: true,
          startsAt: true,
          endsAt: true,
          scheduledMaintenanceState: {
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
    const internalNotes: Array<ScheduledMaintenanceInternalNote> =
      await ScheduledMaintenanceInternalNoteService.findBy({
        query: {
          scheduledMaintenanceId: data.scheduledMaintenanceId,
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
    const publicNotes: Array<ScheduledMaintenancePublicNote> =
      await ScheduledMaintenancePublicNoteService.findBy({
        query: {
          scheduledMaintenanceId: data.scheduledMaintenanceId,
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

    return {
      scheduledMaintenance,
      stateTimeline,
      internalNotes,
      publicNotes,
    };
  }

  @CaptureSpan()
  public static formatScheduledMaintenanceContextForNote(
    contextData: ScheduledMaintenanceContextData,
    noteType: "public" | "internal",
    template?: string,
  ): AIGenerationContext {
    const { scheduledMaintenance, stateTimeline, internalNotes, publicNotes } =
      contextData;

    let contextText: string = "";

    // Basic scheduled maintenance information
    contextText += "# Scheduled Maintenance Information\n\n";
    contextText += `**Title:** ${scheduledMaintenance.title || "N/A"}\n\n`;
    contextText += `**Description:** ${scheduledMaintenance.description || "N/A"}\n\n`;
    contextText += `**Current State:** ${scheduledMaintenance.currentScheduledMaintenanceState?.name || "N/A"}\n\n`;
    contextText += `**Scheduled Start:** ${scheduledMaintenance.startsAt ? OneUptimeDate.getDateAsFormattedString(scheduledMaintenance.startsAt) : "N/A"}\n\n`;
    contextText += `**Scheduled End:** ${scheduledMaintenance.endsAt ? OneUptimeDate.getDateAsFormattedString(scheduledMaintenance.endsAt) : "N/A"}\n\n`;
    contextText += `**Created At:** ${scheduledMaintenance.createdAt ? OneUptimeDate.getDateAsFormattedString(scheduledMaintenance.createdAt) : "N/A"}\n\n`;

    // Affected monitors
    if (
      scheduledMaintenance.monitors &&
      scheduledMaintenance.monitors.length > 0
    ) {
      contextText += "**Affected Monitors:** ";
      contextText += scheduledMaintenance.monitors
        .map((m: { name?: string }) => {
          return m.name;
        })
        .join(", ");
      contextText += "\n\n";
    }

    // Labels
    if (scheduledMaintenance.labels && scheduledMaintenance.labels.length > 0) {
      contextText += "**Labels:** ";
      contextText += scheduledMaintenance.labels
        .map((l: { name?: string }) => {
          return l.name;
        })
        .join(", ");
      contextText += "\n\n";
    }

    // State timeline
    if (stateTimeline.length > 0) {
      contextText += "# State Timeline\n\n";
      for (const timeline of stateTimeline) {
        const startTime: string = timeline.startsAt
          ? OneUptimeDate.getDateAsFormattedString(timeline.startsAt)
          : "N/A";
        const stateName: string =
          timeline.scheduledMaintenanceState?.name?.toString() || "Unknown";
        const createdBy: string =
          timeline.createdByUser?.name?.toString() ||
          timeline.createdByUser?.email?.toString() ||
          "System";

        contextText += `- **${startTime}**: State changed to **${stateName}** by ${createdBy}\n`;
      }
      contextText += "\n";
    }

    // Include internal notes for context (for both note types)
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

    // System prompt for note generation
    let systemPrompt: string;

    if (noteType === "public") {
      if (template) {
        systemPrompt = `You are an expert technical communicator. Your task is to fill in a public scheduled maintenance note template based on the provided maintenance event data.

CRITICAL INSTRUCTIONS:
- You MUST use ONLY the exact template structure provided below
- Fill in each section of the template with relevant information from the maintenance data
- Do NOT add any new sections, headers, or content that is not part of the template
- Do NOT add introductions, conclusions, or any text outside the template structure
- Write in a professional, clear, and customer-friendly manner
- Focus on what customers need to know: timing, impact, and what to expect
- Avoid technical jargon - keep it understandable for non-technical readers
- Be concise but informative

TEMPLATE TO FILL (use this exact structure):

${template}`;
      } else {
        systemPrompt = `You are an expert technical communicator. Your task is to generate a public scheduled maintenance note that will be visible to customers on the status page.

The note should:
1. Be written in a professional, customer-friendly tone
2. Clearly communicate the current status of the maintenance
3. Explain what work is being done and any impact on users
4. Provide timing information (when it started, expected completion, etc.)
5. Set appropriate expectations
6. Be concise but informative

DO NOT include:
- Internal technical details that customers don't need
- Confidential information
- Excessive jargon

Write in markdown format for better readability.`;
      }
    } else if (template) {
      // Internal note with template
      systemPrompt = `You are an expert Site Reliability Engineer (SRE). Your task is to fill in an internal scheduled maintenance note template based on the provided maintenance event data.

CRITICAL INSTRUCTIONS:
- You MUST use ONLY the exact template structure provided below
- Fill in each section of the template with relevant information from the maintenance data
- Do NOT add any new sections, headers, or content that is not part of the template
- Do NOT add introductions, conclusions, or any text outside the template structure
- Be technical and detailed - this is for the internal team
- Include relevant technical details, progress updates, and observations

TEMPLATE TO FILL (use this exact structure):

${template}`;
    } else {
      // Internal note without template
      systemPrompt = `You are an expert Site Reliability Engineer (SRE). Your task is to generate an internal scheduled maintenance note for the team.

The note should:
1. Provide technical details about the maintenance progress
2. Document observations, findings, or actions taken
3. Include any issues encountered or changes to the plan
4. Be detailed enough to help team members understand the current status
5. Use technical language appropriate for the engineering team

Write in markdown format for better readability. Be thorough and technical.`;
    }

    // Build user message
    const userMessage: string = template
      ? `Fill in the template above using ONLY the following scheduled maintenance data. Output only the filled template, nothing else:\n\n${contextText}`
      : `Based on the following scheduled maintenance data, please generate ${noteType === "public" ? "a customer-facing public" : "an internal technical"} maintenance note:\n\n${contextText}`;

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
}
