import ObjectID from "../../../../Types/ObjectID";
import AIRunType from "../../../../Types/AI/AIRunType";
import BadDataException from "../../../../Types/Exception/BadDataException";
import OneUptimeDate from "../../../../Types/Date";
import Project from "../../../../Models/DatabaseModels/Project";
import ProjectService from "../../../Services/ProjectService";
import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * Per-project daily fix-run budget (Preventive-lane X guardrail, G11).
 *
 * Every CodeFix AIRun counts against the daily cap for its lane: incident,
 * alert, or subjectless. Incident and alert runs use their independent
 * settings; recipes with neither subject retain `Project.aiDailyFixTaskLimit`
 * as a fallback. Null/unset means the default below and 0 pauses that lane.
 *
 * Enforced centrally at BOTH creation paths:
 *   - TelemetryExceptionService.createCodeFixRunForException (the
 *     exception-page recipes: FixException, WriteRegressionTest)
 *   - SubjectCodeFixRun.enqueueSubjectCodeFixRun (every subject/perf
 *     recipe: ImproveInstrumentation, FixFromIncident, FixPerformance)
 *
 * User-triggered paths surface the rejection as a clear BadDataException;
 * the automatic instrumentation trigger pre-checks the budget and treats
 * over-budget as a logged skip (it must never throw into an investigation).
 */

// Fix runs allowed per project per UTC day when no explicit limit is set.
export const DEFAULT_DAILY_FIX_RUN_LIMIT: number = 25;

export interface FixRunBudgetDecision {
  allowed: boolean;
  // The effective limit after defaulting (<= 0 means paused).
  limit: number;
  // True when the configured limit pauses fix tasks outright (0 or less).
  paused: boolean;
  // CodeFix runs created since UTC midnight (0 when paused short-circuits).
  runsToday: number;
}

export interface FixRunBudgetSubject {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
}

type FixRunBudgetLane = "incident" | "alert" | "other";

export default class FixRunBudget {
  /*
   * The pure budget decision, separated from IO so it can be tested
   * directly. Null/undefined means "use the default cap" — unlike the
   * token budget, an unset fix-task limit is NOT unlimited: fix runs fan
   * out into pull requests on customer repositories, so they always ship
   * with a ceiling. 0 (or negative) pauses fix tasks entirely.
   */
  public static evaluate(data: {
    configuredLimit: number | null | undefined;
    runsToday: number;
  }): FixRunBudgetDecision {
    const limit: number =
      data.configuredLimit === null || data.configuredLimit === undefined
        ? DEFAULT_DAILY_FIX_RUN_LIMIT
        : data.configuredLimit;

    if (limit <= 0) {
      return {
        allowed: false,
        limit,
        paused: true,
        runsToday: data.runsToday,
      };
    }

    return {
      allowed: data.runsToday < limit,
      limit,
      paused: false,
      runsToday: data.runsToday,
    };
  }

  /*
   * Read the project's limit and count the CodeFix AIRuns created since
   * UTC midnight — ALL of them, regardless of status or recipe: a run that
   * errored still spent agent/LLM effort and still counts against the day.
   */
  @CaptureSpan()
  public static async getBudgetStatus(
    projectId: ObjectID,
    subject?: FixRunBudgetSubject | undefined,
  ): Promise<FixRunBudgetDecision> {
    const lane: FixRunBudgetLane = this.getLane(subject);

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select:
        lane === "incident"
          ? { incidentAiDailyFixTaskLimit: true }
          : lane === "alert"
            ? { alertAiDailyFixTaskLimit: true }
            : { aiDailyFixTaskLimit: true },
      props: { isRoot: true },
    });

    const configuredLimit: number | null =
      lane === "incident"
        ? project?.incidentAiDailyFixTaskLimit ?? null
        : lane === "alert"
          ? project?.alertAiDailyFixTaskLimit ?? null
          : project?.aiDailyFixTaskLimit ?? null;

    // Paused short-circuits the count query (mirrors the token budget).
    const pausedCheck: FixRunBudgetDecision = this.evaluate({
      configuredLimit,
      runsToday: 0,
    });

    if (pausedCheck.paused) {
      return pausedCheck;
    }

    const runsToday: number = (
      await AIRunService.countBy({
        query: {
          projectId,
          runType: AIRunType.CodeFix,
          ...(lane === "incident"
            ? {
                triggeredByIncidentId: QueryHelper.notNull(),
                triggeredByAlertId: QueryHelper.isNull(),
              }
            : lane === "alert"
              ? {
                  triggeredByIncidentId: QueryHelper.isNull(),
                  triggeredByAlertId: QueryHelper.notNull(),
                }
              : {
                  triggeredByIncidentId: QueryHelper.isNull(),
                  triggeredByAlertId: QueryHelper.isNull(),
                }),
          createdAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.getStartOfDay(OneUptimeDate.getCurrentDate(), "UTC"),
          ),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    return this.evaluate({ configuredLimit, runsToday });
  }

  private static getLane(
    subject?: FixRunBudgetSubject | undefined,
  ): FixRunBudgetLane {
    if (subject?.incidentId && subject.alertId) {
      throw new BadDataException(
        "A fix task cannot belong to both an incident and an alert.",
      );
    }

    if (subject?.incidentId) {
      return "incident";
    }

    if (subject?.alertId) {
      return "alert";
    }

    return "other";
  }

  // Human-readable rejection naming the cap and the setting that controls it.
  public static describeRejection(
    decision: FixRunBudgetDecision,
    subject?: FixRunBudgetSubject | undefined,
  ): string {
    const lane: FixRunBudgetLane = this.getLane(subject);
    const settingTitle: string =
      lane === "incident"
        ? "Daily Incident AI Fix Task Limit"
        : lane === "alert"
          ? "Daily Alert AI Fix Task Limit"
          : "Daily Other AI Fix Task Limit";
    const settingsLocation: string =
      lane === "incident"
        ? "Incidents > Settings > AI"
        : lane === "alert"
          ? "Alerts > AI > Investigation"
          : "Project Settings > AI > AI Guardrails";
    const laneLabel: string = lane === "other" ? "other AI" : `${lane} AI`;

    if (decision.paused) {
      return `${laneLabel} fix tasks are paused for this project — the "${settingTitle}" is set to 0. Raise or unset it under ${settingsLocation} to resume.`;
    }

    return `The project's ${laneLabel} fix task limit has been reached (${decision.runsToday} of ${decision.limit} fix tasks created today, UTC). New fix tasks can be created tomorrow — or raise the "${settingTitle}" under ${settingsLocation} (unset means the default of ${DEFAULT_DAILY_FIX_RUN_LIMIT}/day).`;
  }

  /*
   * Throw a clear BadDataException when the project is over its daily
   * fix-run budget — the enforcement call both creation paths make before
   * a CodeFix AIRun row is written.
   */
  @CaptureSpan()
  public static async assertWithinBudget(
    projectId: ObjectID,
    subject?: FixRunBudgetSubject | undefined,
  ): Promise<void> {
    const decision: FixRunBudgetDecision = await this.getBudgetStatus(
      projectId,
      subject,
    );

    if (decision.allowed) {
      return;
    }

    throw new BadDataException(this.describeRejection(decision, subject));
  }
}
