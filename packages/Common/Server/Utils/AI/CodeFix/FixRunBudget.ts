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
 * Per-project daily fix-run limit (Preventive-lane X guardrail, G11), opt-in.
 *
 * Every CodeFix AIRun counts against the daily limit for its lane: incident,
 * alert, or subjectless. Incident and alert runs use their independent
 * settings; recipes with neither subject have no setting and no limit.
 * Null/unset means no limit and 0 pauses that lane (see AIWorkloadLimits for
 * why every AI limit is off until a project sets it).
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

export interface FixRunBudgetDecision {
  allowed: boolean;
  // The configured limit: null means no limit, <= 0 means paused.
  limit: number | null;
  // True when the configured limit pauses fix tasks outright (0 or less).
  paused: boolean;
  /*
   * CodeFix runs created since UTC midnight (0 when the count is skipped
   * because the lane is paused or has no limit).
   */
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
   * directly. Null/undefined means no limit, like the token budget: AI fix
   * tasks are opened as often as the work calls for until a project sets a
   * ceiling. 0 (or negative) pauses fix tasks entirely.
   */
  public static evaluate(data: {
    configuredLimit: number | null | undefined;
    runsToday: number;
  }): FixRunBudgetDecision {
    if (data.configuredLimit === null || data.configuredLimit === undefined) {
      return {
        allowed: true,
        limit: null,
        paused: false,
        runsToday: data.runsToday,
      };
    }

    const limit: number = data.configuredLimit;

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

    // Subjectless fix tasks have no setting, so no limit and nothing to read.
    if (lane === "other") {
      return this.evaluate({ configuredLimit: null, runsToday: 0 });
    }

    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select:
        lane === "incident"
          ? { incidentAiDailyFixTaskLimit: true }
          : { alertAiDailyFixTaskLimit: true },
      props: { isRoot: true },
    });

    const configuredLimit: number | null =
      lane === "incident"
        ? project?.incidentAiDailyFixTaskLimit ?? null
        : project?.alertAiDailyFixTaskLimit ?? null;

    /*
     * Paused and unlimited both short-circuit the count query (mirrors the
     * token budget): neither decision depends on today's count.
     */
    const uncountedCheck: FixRunBudgetDecision = this.evaluate({
      configuredLimit,
      runsToday: 0,
    });

    if (uncountedCheck.paused || uncountedCheck.limit === null) {
      return uncountedCheck;
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
            : {
                triggeredByIncidentId: QueryHelper.isNull(),
                triggeredByAlertId: QueryHelper.notNull(),
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

    /*
     * getBudgetStatus never rejects a subjectless fix task (that lane has no
     * limit), so a decision for it has no setting to point at.
     */
    if (lane === "other") {
      return `The project's daily fix task limit for AI work outside incidents and alerts has been reached (${decision.runsToday} of ${decision.limit} fix tasks created today, UTC). New fix tasks can be created tomorrow.`;
    }

    const settingTitle: string =
      lane === "incident"
        ? "Daily Incident AI Fix Task Limit"
        : "Daily Alert AI Fix Task Limit";
    const settingsLocation: string =
      lane === "incident"
        ? "Incidents > AI > Settings"
        : "Alerts > AI > Settings";
    const laneLabel: string = `${lane} AI`;

    if (decision.paused) {
      return `${laneLabel} fix tasks are paused for this project — the "${settingTitle}" is set to 0. Raise or unset it under ${settingsLocation} to resume.`;
    }

    return `The project's ${laneLabel} fix task limit has been reached (${decision.runsToday} of ${decision.limit} fix tasks created today, UTC). New fix tasks can be created tomorrow — or raise the "${settingTitle}" under ${settingsLocation}, or clear it for no limit.`;
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
