import ObjectID from "../../../../../Types/ObjectID";
import ColumnLength from "../../../../../Types/Database/ColumnLength";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import AIInsight from "../../../../../Models/DatabaseModels/AIInsight";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Project from "../../../../../Models/DatabaseModels/Project";
import AIInsightSeverity, {
  AIInsightSeverityHelper,
} from "../../../../../Types/AI/AIInsightSeverity";
import AlertService from "../../../../Services/AlertService";
import AlertSeverityService from "../../../../Services/AlertSeverityService";
import OnCallDutyPolicyService from "../../../../Services/OnCallDutyPolicyService";
import ProjectService from "../../../../Services/ProjectService";
import AIInsightService from "../../../../Services/AIInsightService";
import { DisableAutomaticAlertCreation } from "../../../../EnvironmentConfig";
import logger from "../../../Logger";
import CaptureSpan from "../../../Telemetry/CaptureSpan";

/*
 * AI Insights — the opt-in escalation bridge from insight to Alert.
 *
 * By default insights are a quiet inbox: they never page, never open
 * incidents or alerts, never notify. A project that opts into
 * enableAiInsightEscalation (default false) changes exactly ONE thing:
 * a genuinely NEW insight at or above the configured severity floor opens a
 * real Alert — which then rides the EXISTING alert machinery (on-call
 * fan-out, alert on-call rules, grouping, wake-on-alert AI investigation).
 * Escalation creates ALERTS only, never incidents, so nothing here can ever
 * become status-page visible.
 *
 * Only newly CREATED insight rows may escalate. Refreshed rows re-emit the
 * same live finding on every 15-minute tick — escalating those would page
 * every tick for as long as the signal persists. The escalatedToAlertId
 * stamp is the permanent dedupe: one insight, at most one alert, ever.
 *
 * Fire-safe by contract: escalation failure must never break the insight
 * scan. Every skip is logged with its reason; nothing here throws.
 */

/*
 * Volume guardrail: at most this many escalations per project per scan tick,
 * counted across ALL of the tick's new insights (the counter is threaded in
 * from the scanner). A detector storm may create up to 10 new insights per
 * tick — paging for every one of them at once helps nobody.
 */
export const MAX_ESCALATIONS_PER_PROJECT_PER_SCAN: number = 3;

/*
 * The severity floor when the project has not configured one (or configured
 * an unparseable value): High. Only the strongest detector findings ever
 * page by default — MetricDrift is always Low, so it can never pass this.
 */
export const DEFAULT_ESCALATION_MINIMUM_SEVERITY: AIInsightSeverity =
  AIInsightSeverity.High;

// Plain prefix — no template rendering anywhere in this path.
export const ESCALATED_ALERT_TITLE_PREFIX: string = "[AI] ";

// Mirrors the Alert.title column definition (LongText).
export const ESCALATED_ALERT_TITLE_MAX_LENGTH: number = ColumnLength.LongText;

/*
 * Cap on how much of the insight's detailMarkdown is copied into the alert
 * description. The description column is unbounded, but it flows into
 * notifications and feed items — the full evidence lives on the insight.
 */
export const ESCALATED_ALERT_DETAIL_MAX_LENGTH: number = 4000;

const DETAIL_TRUNCATION_SUFFIX: string =
  "\n\n… (truncated — see the AI Insight for the full detail)";

/*
 * The per-scan escalation counter, created by the scanner once per project
 * per tick and threaded through every escalation attempt of that tick.
 */
export interface EscalationScanCounter {
  escalations: number;
}

export interface InsightEscalationResult {
  escalated: boolean;
  alertId?: ObjectID | undefined;
  // Human-readable reason recorded in the debug log when skipping.
  reason: string;
}

export default class InsightEscalation {
  /*
   * Escalate one NEWLY created insight to an Alert, if every gate passes.
   * Gates, in order (each one quiet-skips):
   *   1. the instance-wide DISABLE_AUTOMATIC_ALERT_CREATION kill switch
   *      (the same brake MonitorAlert honors);
   *   2. Project.enableAi === false — the master AI switch kills every path;
   *   3. Project.enableAiInsightEscalation !== true — strict opt-in,
   *      defaults false;
   *   4. insight severity below the floor (configured minimum, unset ⇒ High);
   *   5. insight.escalatedToAlertId already set — one alert per insight, ever;
   *   6. the per-scan escalation cap.
   * NEVER throws — an escalation failure must not cost the project its scan.
   */
  @CaptureSpan()
  public static async escalateNewInsight(data: {
    insight: AIInsight;
    counter: EscalationScanCounter;
  }): Promise<InsightEscalationResult> {
    const { insight, counter } = data;

    try {
      // Gate 1: the instance-wide kill switch (mirrors MonitorAlert).
      if (DisableAutomaticAlertCreation) {
        return this.skip(
          insight,
          "automatic alert creation is disabled by environment configuration",
        );
      }

      if (!insight.id || !insight.projectId) {
        return this.skip(insight, "insight is missing id or projectId");
      }

      const project: Project | null = await ProjectService.findOneById({
        id: insight.projectId,
        select: {
          enableAi: true,
          enableAiInsightEscalation: true,
          aiInsightEscalationMinimumSeverity: true,
          aiInsightEscalationAlertSeverityId: true,
          aiInsightEscalationOnCallDutyPolicyId: true,
        },
        props: { isRoot: true },
      });

      if (!project) {
        return this.skip(insight, "project not found");
      }

      // Gate 2: the master AI switch (=== false — the column defaults true).
      if (project.enableAi === false) {
        return this.skip(insight, "AI is disabled for the project");
      }

      // Gate 3: strict opt-in — the column defaults to false.
      if (project.enableAiInsightEscalation !== true) {
        return this.skip(
          insight,
          "project has not opted in to insight escalation",
        );
      }

      /*
       * Gate 4: the severity floor. Explicit rank comparison — never string
       * comparison. An unset (or unparseable) configured floor means High,
       * and an insight without a severity cannot prove it qualifies, so it
       * stays quiet (fail-safe in the no-page direction).
       */
      const floor: AIInsightSeverity =
        AIInsightSeverityHelper.fromString(
          project.aiInsightEscalationMinimumSeverity,
        ) || DEFAULT_ESCALATION_MINIMUM_SEVERITY;

      if (
        !insight.severity ||
        !AIInsightSeverityHelper.isAtLeast(insight.severity, floor)
      ) {
        return this.skip(
          insight,
          `severity ${insight.severity || "unknown"} is below the escalation floor (${floor})`,
        );
      }

      // Gate 5: one alert per insight, ever — the permanent dedupe.
      if (insight.escalatedToAlertId) {
        return this.skip(
          insight,
          `already escalated to alert ${insight.escalatedToAlertId.toString()}`,
        );
      }

      // Gate 6: the per-scan cap, threaded in from the scanner.
      if (counter.escalations >= MAX_ESCALATIONS_PER_PROJECT_PER_SCAN) {
        logger.info(
          `AI Insights: per-scan escalation cap (${MAX_ESCALATIONS_PER_PROJECT_PER_SCAN}) reached for project ${insight.projectId.toString()} — insight ${insight.id.toString()} will not escalate this tick.`,
        );
        return {
          escalated: false,
          reason: "per-scan escalation cap reached",
        };
      }

      /*
       * Severity for the alert: the configured escalation severity, falling
       * back to the project's lowest-order (most critical) severity — the
       * MonitorAlert fallback. A project with no alert severities at all
       * cannot have alerts, so log + skip; never throw (MonitorAlert throws
       * here — a scan collaborator must not).
       */
      let alertSeverityId: ObjectID | undefined =
        project.aiInsightEscalationAlertSeverityId;

      if (!alertSeverityId) {
        const severity: AlertSeverity | null =
          await AlertSeverityService.findOneBy({
            query: {
              projectId: insight.projectId,
            },
            sort: {
              order: SortOrder.Ascending,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        alertSeverityId = severity?.id || undefined;
      }

      if (!alertSeverityId) {
        logger.warn(
          `AI Insights: project ${insight.projectId.toString()} has no alert severity configured — skipping escalation for insight ${insight.id.toString()}.`,
        );
        return {
          escalated: false,
          reason: "project has no alert severity",
        };
      }

      /*
       * On-call policy id-stub, the MonitorAlert pattern — but verified
       * first: the configured policy must exist AND belong to this project.
       * A missing or foreign policy is logged and the alert is created
       * WITHOUT it (alert on-call rules can still match and page).
       */
      let onCallDutyPolicies: Array<OnCallDutyPolicy> = [];

      if (project.aiInsightEscalationOnCallDutyPolicyId) {
        const policy: OnCallDutyPolicy | null =
          await OnCallDutyPolicyService.findOneBy({
            query: {
              _id: project.aiInsightEscalationOnCallDutyPolicyId.toString(),
              projectId: insight.projectId,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (policy && policy.id) {
          const policyStub: OnCallDutyPolicy = new OnCallDutyPolicy();
          policyStub._id = policy.id.toString();
          onCallDutyPolicies = [policyStub];
        } else {
          logger.warn(
            `AI Insights: configured escalation on-call policy ${project.aiInsightEscalationOnCallDutyPolicyId.toString()} was not found in project ${insight.projectId.toString()} — creating the alert without it.`,
          );
        }
      }

      /*
       * The alert. Plain strings — no template rendering — clamped to the
       * column lengths (DatabaseService throws on overflow; insight titles
       * embed raw telemetry strings). System-created: props isRoot and no
       * user attribution anywhere.
       */
      const alert: Alert = new Alert();
      alert.projectId = insight.projectId;
      alert.title = this.clampToLength(
        `${ESCALATED_ALERT_TITLE_PREFIX}${insight.title || insight.insightType || "AI Insight"}`,
        ESCALATED_ALERT_TITLE_MAX_LENGTH,
      );
      alert.description = this.buildDescription(insight);
      alert.alertSeverityId = alertSeverityId;
      alert.isCreatedAutomatically = true;
      alert.onCallDutyPolicies = onCallDutyPolicies;

      const createdAlert: Alert = await AlertService.create({
        data: alert,
        props: {
          isRoot: true,
        },
      });

      // The alert exists — it counts against the cap from this moment.
      counter.escalations++;

      /*
       * Stamp the permanent dedupe link. Own try/catch: the alert already
       * exists and pages regardless — a failed link write must not report
       * the escalation as failed (and re-escalation cannot happen anyway:
       * this path only ever runs for rows created THIS tick).
       */
      try {
        await AIInsightService.updateOneById({
          id: insight.id,
          data: {
            escalatedToAlertId: createdAlert.id!,
          },
          props: { isRoot: true },
        });
      } catch (error) {
        logger.error(
          `AI Insights: alert ${createdAlert.id?.toString()} was created for insight ${insight.id.toString()} but stamping escalatedToAlertId failed: ${error}`,
        );
      }

      logger.info(
        `AI Insights: escalated insight ${insight.id.toString()} (project ${insight.projectId.toString()}) to alert ${createdAlert.id?.toString()}.`,
      );

      return {
        escalated: true,
        alertId: createdAlert.id || undefined,
        reason: "escalated",
      };
    } catch (error) {
      logger.error(
        `AI Insights: escalation failed for insight ${insight.id?.toString()} (treating as not escalated): ${error}`,
      );
      return {
        escalated: false,
        reason: "escalation failed with an unexpected error",
      };
    }
  }

  /*
   * Provenance line first — a paged human must immediately know this alert
   * came from an AI Insight and where the full evidence lives — then the
   * insight's own detail, truncated to the cap.
   */
  private static buildDescription(insight: AIInsight): string {
    const provenance: string = `Escalated automatically from AI Insight ${insight.insightType || "Unknown"} — review the insight for full evidence.`;

    if (!insight.detailMarkdown) {
      return provenance;
    }

    let detail: string = insight.detailMarkdown;

    if (detail.length > ESCALATED_ALERT_DETAIL_MAX_LENGTH) {
      detail =
        detail.slice(0, ESCALATED_ALERT_DETAIL_MAX_LENGTH) +
        DETAIL_TRUNCATION_SUFFIX;
    }

    return `${provenance}\n\n${detail}`;
  }

  private static skip(
    insight: AIInsight,
    reason: string,
  ): InsightEscalationResult {
    logger.debug(
      `AI Insights: not escalating insight ${insight.id?.toString()} — ${reason}.`,
    );
    return { escalated: false, reason };
  }

  /*
   * Hard code-unit slice to the column's declared length — the same measure
   * DatabaseService validates against (the InsightStore clamp).
   */
  private static clampToLength(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }
    return value.slice(0, maxLength);
  }
}
