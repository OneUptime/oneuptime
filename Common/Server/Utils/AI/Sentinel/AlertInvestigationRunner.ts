import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import AIRunType from "../../../../Types/AI/AIRunType";
import { Blue500 } from "../../../../Types/BrandColors";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import Project from "../../../../Models/DatabaseModels/Project";
import { AlertFeedEventType } from "../../../../Models/DatabaseModels/AlertFeed";
import AlertService from "../../../Services/AlertService";
import AlertSeverityService from "../../../Services/AlertSeverityService";
import ProjectService from "../../../Services/ProjectService";
import AIRunService from "../../../Services/AIRunService";
import AlertFeedService from "../../../Services/AlertFeedService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../AlertAIContextBuilder";
import SentinelInvestigationEngine from "./SentinelInvestigationEngine";
import SentinelInvestigationQueue from "./InvestigationQueue";
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
 * Gated by the same per-project opt-in as incidents, PLUS alert-specific cost
 * gates (alert volume can be far higher than incidents):
 *   - severity floor: only alerts at or above the project's configured minimum
 *     severity are investigated; when unset, the top two severity tiers
 *     (lowest two `order` values) are the default.
 *   - per-monitor dedupe window: a monitor that already triggered an
 *     investigation recently is not re-investigated — the first RCA stands.
 */

const DEDUPE_WINDOW_MINUTES: number = 30;

export interface AlertGateDecision {
  investigate: boolean;
  // Human-readable reason recorded in the debug log when skipping.
  reason: string;
  // Passed through to the AIRun as the dedupe key for future windows.
  monitorId?: ObjectID | undefined;
}

export default class SentinelAlertInvestigationRunner {
  /*
   * Entry point called (fire-and-forget) from AlertService.onCreateSuccess.
   * Cheap: gates + a Queued AIRun row; execution happens via the queue.
   * Never throws — all failures are logged.
   */
  @CaptureSpan()
  public static async investigateNewAlert(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const { alertId, projectId } = data;

    try {
      if (
        !(await SentinelInvestigationEngine.isEnabledForProject(
          projectId,
          "Alert",
        ))
      ) {
        return;
      }

      const gate: AlertGateDecision = await this.shouldInvestigateAlert({
        alertId,
        projectId,
      });

      if (!gate.investigate) {
        logger.debug(
          `Sentinel: skipping investigation for alert ${alertId.toString()} — ${gate.reason}.`,
        );
        return;
      }

      await SentinelInvestigationQueue.enqueue({
        projectId,
        subjectAlertId: alertId,
        subjectMonitorId: gate.monitorId,
      });
    } catch (error) {
      logger.error(
        `Sentinel: unexpected error enqueueing investigation for alert ${alertId.toString()}: ${error}`,
      );
    }
  }

  /*
   * Execute a claimed run: assemble alert context and hand it to the engine.
   * Called by SentinelInvestigationQueue after a successful claim. Never
   * throws — failures are handed to the queue's retry policy so a claimed
   * run is always finalized or requeued.
   */
  @CaptureSpan()
  public static async executeInvestigation(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    alertId: ObjectID;
    attemptCount: number;
  }): Promise<void> {
    const { aiRunId, projectId, alertId, attemptCount } = data;

    let contextSummary: string;
    try {
      const contextData: AlertContextData =
        await AlertAIContextBuilder.buildAlertContext({
          alertId,
        });

      contextSummary = this.buildAlertSummary(contextData);
    } catch (error) {
      /*
       * Context assembly failed — the run is claimed, so hand it to the
       * retry policy rather than leaving it Running until the sweeper.
       */
      await SentinelInvestigationQueue.failOrRequeue({
        aiRunId,
        attemptCount,
        errorMessage: `Failed to build alert context: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isPermanent: false,
      });
      return;
    }

    await SentinelInvestigationEngine.executeRun({
      aiRunId,
      projectId,
      attemptCount,
      request: {
        feature: "Sentinel Alert Investigation",
        contextSummary,
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
      },
    });
  }

  /*
   * The alert-specific cost gates, evaluated BEFORE the expensive context
   * build. Severity first (cheapest to reason about), then the per-monitor
   * dedupe window. The severity gate only filters KNOWN-low-severity noise:
   * an alert whose severity order cannot be determined passes it.
   */
  @CaptureSpan()
  public static async shouldInvestigateAlert(data: {
    alertId: ObjectID;
    projectId: ObjectID;
  }): Promise<AlertGateDecision> {
    const { alertId, projectId } = data;

    const alert: Alert | null = await AlertService.findOneById({
      id: alertId,
      select: {
        monitorId: true,
        alertSeverity: {
          order: true,
        },
      },
      props: { isRoot: true },
    });

    if (!alert) {
      return { investigate: false, reason: "alert not found" };
    }

    // Severity floor.
    const floorOrder: number | null =
      await this.getSeverityFloorOrder(projectId);
    const alertOrder: number | undefined = alert.alertSeverity?.order;

    if (
      floorOrder !== null &&
      alertOrder !== undefined &&
      alertOrder > floorOrder
    ) {
      return {
        investigate: false,
        reason: `severity order ${alertOrder} is below the investigation floor (order ${floorOrder})`,
        monitorId: alert.monitorId,
      };
    }

    // Per-monitor dedupe window. Alerts without a monitor have no dedupe key.
    if (alert.monitorId) {
      const windowStart: Date = OneUptimeDate.getSomeMinutesAgo(
        DEDUPE_WINDOW_MINUTES,
      );

      const recentRunCount: number = (
        await AIRunService.countBy({
          query: {
            projectId,
            monitorId: alert.monitorId,
            runType: AIRunType.Investigation,
            createdAt: QueryHelper.greaterThan(windowStart),
          },
          props: { isRoot: true },
        })
      ).toNumber();

      if (recentRunCount > 0) {
        return {
          investigate: false,
          reason: `monitor ${alert.monitorId.toString()} was already investigated within the last ${DEDUPE_WINDOW_MINUTES} minutes`,
          monitorId: alert.monitorId,
        };
      }
    }

    return {
      investigate: true,
      reason: "passed severity and dedupe gates",
      monitorId: alert.monitorId,
    };
  }

  /*
   * The severity `order` value that still qualifies for investigation (lower
   * order = higher severity; an alert qualifies when its order <= floor).
   * An explicitly configured minimum severity wins; when unset — or when the
   * configured severity has been deleted — the default is the project's top
   * two tiers. Returns null when no floor applies (no severities configured).
   */
  private static async getSeverityFloorOrder(
    projectId: ObjectID,
  ): Promise<number | null> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { alertInvestigationMinimumSeverityId: true },
      props: { isRoot: true },
    });

    if (project?.alertInvestigationMinimumSeverityId) {
      const floorSeverity: AlertSeverity | null =
        await AlertSeverityService.findOneById({
          id: project.alertInvestigationMinimumSeverityId,
          select: { order: true },
          props: { isRoot: true },
        });

      if (floorSeverity && floorSeverity.order !== undefined) {
        return floorSeverity.order;
      }
    }

    // Default: the top two severity tiers (the two lowest order values).
    const topTiers: Array<AlertSeverity> = await AlertSeverityService.findBy({
      query: { projectId },
      select: { order: true },
      sort: { order: SortOrder.Ascending },
      limit: 2,
      skip: 0,
      props: { isRoot: true },
    });

    if (topTiers.length === 0) {
      return null;
    }

    const lastTier: AlertSeverity = topTiers[topTiers.length - 1]!;
    return lastTier.order ?? null;
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
