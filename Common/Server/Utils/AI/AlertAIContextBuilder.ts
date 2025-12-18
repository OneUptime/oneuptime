import ObjectID from "../../../Types/ObjectID";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import AlertInternalNote from "../../../Models/DatabaseModels/AlertInternalNote";
import AlertService from "../../Services/AlertService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import AlertInternalNoteService from "../../Services/AlertInternalNoteService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OneUptimeDate from "../../../Types/Date";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LLMMessage } from "../LLM/LLMService";

export interface AlertContextData {
  alert: Alert;
  stateTimeline: Array<AlertStateTimeline>;
  internalNotes: Array<AlertInternalNote>;
}

export interface AIGenerationContext {
  contextText: string;
  systemPrompt: string;
  messages: Array<LLMMessage>;
}

export default class AlertAIContextBuilder {
  @CaptureSpan()
  public static async buildAlertContext(data: {
    alertId: ObjectID;
  }): Promise<AlertContextData> {
    const alert: Alert | null = await AlertService.findOneById({
      id: data.alertId,
      select: {
        _id: true,
        title: true,
        description: true,
        createdAt: true,
        customFields: true,
        projectId: true,
        alertSeverity: {
          name: true,
          color: true,
        },
        currentAlertState: {
          name: true,
          color: true,
        },
        monitor: {
          name: true,
        },
        labels: {
          name: true,
          color: true,
        },
        rootCause: true,
        remediationNotes: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!alert) {
      throw new Error("Alert not found");
    }

    // Fetch state timeline
    const stateTimeline: Array<AlertStateTimeline> =
      await AlertStateTimelineService.findBy({
        query: {
          alertId: data.alertId,
        },
        select: {
          _id: true,
          createdAt: true,
          startsAt: true,
          endsAt: true,
          rootCause: true,
          alertState: {
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
    const internalNotes: Array<AlertInternalNote> =
      await AlertInternalNoteService.findBy({
        query: {
          alertId: data.alertId,
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

    return {
      alert,
      stateTimeline,
      internalNotes,
    };
  }

  @CaptureSpan()
  public static formatAlertContextForNote(
    contextData: AlertContextData,
    template?: string,
  ): AIGenerationContext {
    const { alert, stateTimeline, internalNotes } = contextData;

    let contextText: string = "";

    // Basic alert information
    contextText += "# Alert Information\n\n";
    contextText += `**Title:** ${alert.title || "N/A"}\n\n`;
    contextText += `**Description:** ${alert.description || "N/A"}\n\n`;
    contextText += `**Severity:** ${alert.alertSeverity?.name || "N/A"}\n\n`;
    contextText += `**Current State:** ${alert.currentAlertState?.name || "N/A"}\n\n`;
    contextText += `**Created At:** ${alert.createdAt ? OneUptimeDate.getDateAsFormattedString(alert.createdAt) : "N/A"}\n\n`;

    // Affected monitor
    if (alert.monitor) {
      contextText += `**Monitor:** ${alert.monitor.name || "N/A"}\n\n`;
    }

    // Labels
    if (alert.labels && alert.labels.length > 0) {
      contextText += "**Labels:** ";
      contextText += alert.labels
        .map((l: { name?: string }) => {
          return l.name;
        })
        .join(", ");
      contextText += "\n\n";
    }

    // Root cause if available
    if (alert.rootCause) {
      contextText += `**Root Cause:** ${alert.rootCause}\n\n`;
    }

    // Remediation notes if available
    if (alert.remediationNotes) {
      contextText += `**Remediation Notes:** ${alert.remediationNotes}\n\n`;
    }

    // State timeline
    if (stateTimeline.length > 0) {
      contextText += "# State Timeline\n\n";
      for (const timeline of stateTimeline) {
        const startTime: string = timeline.startsAt
          ? OneUptimeDate.getDateAsFormattedString(timeline.startsAt)
          : "N/A";
        const stateName: string =
          timeline.alertState?.name?.toString() || "Unknown";
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

    // System prompt for note generation (alerts only have internal notes)
    let systemPrompt: string;

    if (template) {
      systemPrompt = `You are an expert Site Reliability Engineer (SRE). Your task is to fill in an internal alert note template based on the provided alert data.

CRITICAL INSTRUCTIONS:
- You MUST use ONLY the exact template structure provided below
- Fill in each section of the template with relevant information from the alert data
- Do NOT add any new sections, headers, or content that is not part of the template
- Do NOT add introductions, conclusions, or any text outside the template structure
- Be technical and detailed - this is for the internal team
- Include relevant technical details, observations, and analysis

TEMPLATE TO FILL (use this exact structure):

${template}`;
    } else {
      systemPrompt = `You are an expert Site Reliability Engineer (SRE). Your task is to generate an internal alert note for the team.

The note should:
1. Provide technical details about the alert and its current status
2. Document observations, findings, or actions taken
3. Include relevant metrics or error messages if mentioned in the context
4. Be detailed enough to help team members understand the situation
5. Use technical language appropriate for the engineering team

Write in markdown format for better readability. Be thorough and technical.`;
    }

    // Build user message
    const userMessage: string = template
      ? `Fill in the template above using ONLY the following alert data. Output only the filled template, nothing else:\n\n${contextText}`
      : `Based on the following alert data, please generate an internal technical alert note:\n\n${contextText}`;

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
