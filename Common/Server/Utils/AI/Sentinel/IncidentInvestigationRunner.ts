import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { Blue500 } from "../../../../Types/BrandColors";
import { IncidentFeedEventType } from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentFeedService from "../../../Services/IncidentFeedService";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../IncidentAIContextBuilder";
import SentinelInvestigationEngine from "./SentinelInvestigationEngine";
import SentinelMemory from "./SentinelMemory";
import { ObservabilityAssistantResult } from "../Chat/ObservabilityAssistant";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Sentinel — incident investigation.
 *
 * When a new incident is declared, wakes Sentinel to investigate it (read-only)
 * and post a cited root-cause analysis into the incident timeline + Slack/Teams
 * — before the on-call engineer has finished reading the page. The heavy lifting
 * (run lifecycle, the agent loop, confidence gating) lives in the shared
 * SentinelInvestigationEngine; this file only assembles incident context and
 * posts the result to the incident's feed.
 *
 * Built on the fire-and-forget async pattern already used throughout
 * IncidentService.onCreateSuccess. See Internal/Roadmap/AISentinelExecution.md.
 */
export default class SentinelIncidentInvestigationRunner {
  /*
   * Entry point called (fire-and-forget) from IncidentService.onCreateSuccess.
   * Never throws — all failures are logged and recorded on the AIRun.
   */
  @CaptureSpan()
  public static async investigateNewIncident(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const { incidentId, projectId } = data;

    try {
      if (
        !(await SentinelInvestigationEngine.isEnabledForProject(
          projectId,
          "Incident",
        ))
      ) {
        return;
      }

      const contextData: IncidentContextData =
        await IncidentAIContextBuilder.buildIncidentContext({
          incidentId,
          includeWorkspaceMessages: false,
        });

      /*
       * Recurrence memory: pull in past resolved incidents that share this
       * incident's monitors/labels so Sentinel can recognise "I've seen this
       * before" and reference the prior fix.
       */
      const priorCasesContext: string =
        await SentinelMemory.getPriorSimilarIncidentsContext({
          projectId,
          currentIncidentId: incidentId,
          monitorNames: (contextData.incident.monitors || [])
            .map((m: { name?: string }) => {
              return m.name || "";
            })
            .filter(Boolean),
          labelNames: (contextData.incident.labels || [])
            .map((l: { name?: string }) => {
              return l.name || "";
            })
            .filter(Boolean),
        });

      await SentinelInvestigationEngine.investigate({
        projectId,
        feature: "Sentinel Incident Investigation",
        subjectIncidentId: incidentId,
        contextSummary:
          this.buildIncidentSummary(contextData) + priorCasesContext,
        postAnalysis: async (postData: {
          analysisMarkdown: string;
          isConfident: boolean;
          result: ObservabilityAssistantResult;
        }): Promise<void> => {
          await IncidentFeedService.createIncidentFeedItem({
            incidentId,
            projectId,
            incidentFeedEventType: IncidentFeedEventType.RootCause,
            displayColor: Blue500,
            feedInfoInMarkdown: postData.analysisMarkdown,
            /*
             * Quiet mode: an inconclusive investigation posts to the timeline
             * but does NOT loudly ping the workspace / on-call.
             */
            workspaceNotification: {
              sendWorkspaceNotification: postData.isConfident,
            },
          });
        },
      });
    } catch (error) {
      logger.error(
        `Sentinel: unexpected error investigating incident ${incidentId.toString()}: ${error}`,
      );
    }
  }

  // Build a compact incident record to seed the investigation.
  private static buildIncidentSummary(
    contextData: IncidentContextData,
  ): string {
    const { incident, internalNotes } = contextData;

    const lines: Array<string> = [];
    lines.push("# Incident");
    lines.push(`Title: ${incident.title || "N/A"}`);

    if (incident.description) {
      lines.push(`Description: ${incident.description}`);
    }

    lines.push(`Severity: ${incident.incidentSeverity?.name || "N/A"}`);
    lines.push(
      `Current state: ${incident.currentIncidentState?.name || "N/A"}`,
    );
    lines.push(
      `Declared at: ${
        incident.createdAt
          ? OneUptimeDate.getDateAsFormattedString(incident.createdAt)
          : "N/A"
      }`,
    );

    if (incident.monitors && incident.monitors.length > 0) {
      lines.push(
        `Affected monitors: ${incident.monitors
          .map((m: { name?: string }) => {
            return m.name;
          })
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    if (incident.labels && incident.labels.length > 0) {
      lines.push(
        `Labels: ${incident.labels
          .map((l: { name?: string }) => {
            return l.name;
          })
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    if (incident.rootCause) {
      lines.push(`Root cause (as recorded so far): ${incident.rootCause}`);
    }

    const recentNotes: Array<string> = (internalNotes || [])
      .slice(-5)
      .map((note: { note?: string }) => {
        return note.note ? `- ${note.note}` : "";
      })
      .filter(Boolean);

    if (recentNotes.length > 0) {
      lines.push("");
      lines.push("Recent internal notes:");
      lines.push(...recentNotes);
    }

    return lines.join("\n");
  }
}
