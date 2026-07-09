import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { Blue500 } from "../../../../Types/BrandColors";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import AlertFeedService from "../../../Services/AlertFeedService";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../AlertAIContextBuilder";
import SentinelInvestigationEngine from "./SentinelInvestigationEngine";
import { ObservabilityAssistantResult } from "../Chat/ObservabilityAssistant";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Sentinel — alert investigation.
 *
 * Alerts are the earlier, "left of boom" signal. When a new alert is declared,
 * Sentinel investigates it (read-only) and posts a cited root-cause analysis to
 * the alert timeline + Slack/Teams. Symmetric to incident investigation and
 * built on the same shared SentinelInvestigationEngine.
 *
 * Gated by the same per-project opt-in as incidents. Alert volume can be higher
 * than incidents, so severity / rate gating is a deliberate follow-up.
 */
export default class SentinelAlertInvestigationRunner {
  /*
   * Entry point called (fire-and-forget) from AlertService.onCreateSuccess.
   * Never throws — all failures are logged and recorded on the AIRun.
   */
  @CaptureSpan()
  public static async investigateNewAlert(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const { alertId, projectId } = data;

    try {
      if (!(await SentinelInvestigationEngine.isEnabledForProject(projectId))) {
        return;
      }

      const contextData: AlertContextData =
        await AlertAIContextBuilder.buildAlertContext({
          alertId,
        });

      await SentinelInvestigationEngine.investigate({
        projectId,
        feature: "Sentinel Alert Investigation",
        subjectAlertId: alertId,
        contextSummary: this.buildAlertSummary(contextData),
        postAnalysis: async (postData: {
          analysisMarkdown: string;
          isConfident: boolean;
          result: ObservabilityAssistantResult;
        }): Promise<void> => {
          await AlertFeedService.createAlertFeedItem({
            alertId,
            projectId,
            alertFeedEventType: AlertFeedEventType.RootCause,
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
        `Sentinel: unexpected error investigating alert ${alertId.toString()}: ${error}`,
      );
    }
  }

  // Build a compact alert record to seed the investigation.
  private static buildAlertSummary(contextData: AlertContextData): string {
    const { alert, internalNotes } = contextData;

    const lines: Array<string> = [];
    lines.push("# Alert");
    lines.push(`Title: ${alert.title || "N/A"}`);

    if (alert.description) {
      lines.push(`Description: ${alert.description}`);
    }

    lines.push(`Severity: ${alert.alertSeverity?.name || "N/A"}`);
    lines.push(`Current state: ${alert.currentAlertState?.name || "N/A"}`);
    lines.push(
      `Declared at: ${
        alert.createdAt
          ? OneUptimeDate.getDateAsFormattedString(alert.createdAt)
          : "N/A"
      }`,
    );

    if (alert.monitor?.name) {
      lines.push(`Affected monitor: ${alert.monitor.name}`);
    }

    if (alert.labels && alert.labels.length > 0) {
      lines.push(
        `Labels: ${alert.labels
          .map((l: { name?: string }) => {
            return l.name;
          })
          .filter(Boolean)
          .join(", ")}`,
      );
    }

    if (alert.rootCause) {
      lines.push(`Root cause (as recorded so far): ${alert.rootCause}`);
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
