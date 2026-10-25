import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import { AIRunStatusHelper } from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { getTelemetryAiFixTaskTypes } from "../../../../Types/AI/TelemetryAi";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT EVERY TELEMETRY LANE'S PULL REQUEST SHARES (Types/AI/TelemetryAi):
 * each lane's fix starter (ProfileInsightFix, TraceInsightFix,
 * ExceptionInsightFix) starts a Code task in the repository that holds the
 * code, stamped with the insight it came from - a request in Code, or, for
 * an exception, the exception's own AI task (the lane's fixTaskTypes) - and
 * these are the parts they check alike:
 *
 *   - the day's share: OneUptime opens at most
 *     TELEMETRY_AI_MAX_AUTOMATIC_FIXES_PER_DAY pull requests on its own in a
 *     project each day (UTC), every lane together - a team reviews a few
 *     pull requests a day, not a queue of them;
 *   - one task per problem: a Code task about the insight already on its way
 *     (one OneUptime started on an earlier look, or a person from the
 *     insight) is the insight's fix, not a reason for a second.
 *
 * What a lane's fix result says, for the routing's log line and its tests.
 */
export interface TelemetryAiFixResult {
  // The task started - or, already on its way, the one that is the fix.
  taskId?: ObjectID | undefined;
  // Why none was started, in the words a debug log line ends with.
  skip?: string | undefined;
  // Code's own words for a skip Code's gate decided.
  detail?: string | undefined;
}

export default class TelemetryAiFix {
  /*
   * The tasks OneUptime started on its own in the project since UTC
   * midnight, every lane together: Code tasks of the lanes' recipes
   * (getTelemetryAiFixTaskTypes) no person asked, each stamped with the
   * insight it came from (a task's first turn only - its replies are the
   * same task). An exception's own AI task AI Insights opened from a
   * finding, while the Exceptions switch is off, is one of them too: it is
   * a pull request OneUptime opened on its own for a telemetry problem.
   */
  @CaptureSpan()
  public static async countStartedToday(projectId: ObjectID): Promise<number> {
    return (
      await AIRunService.countBy({
        query: {
          projectId,
          runType: AIRunType.CodeFix,
          codeFixTaskType: QueryHelper.any(getTelemetryAiFixTaskTypes()),
          userId: QueryHelper.isNull(),
          codeTaskId: QueryHelper.isNull(),
          triggeredByAiInsightId: QueryHelper.notNull(),
          createdAt: QueryHelper.greaterThanEqualTo(
            OneUptimeDate.getStartOfDay(OneUptimeDate.getCurrentDate(), "UTC"),
          ),
        },
        props: { isRoot: true },
      })
    ).toNumber();
  }

  /*
   * The Code task about this insight that is still on its way - one
   * OneUptime started, or one a person asked for from the insight - or
   * null. Its first turn's id is the task's.
   */
  @CaptureSpan()
  public static async findActiveTaskIdForInsight(data: {
    projectId: ObjectID;
    insightId: ObjectID;
  }): Promise<string | null> {
    const run: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeFixTaskType: QueryHelper.any(getTelemetryAiFixTaskTypes()),
        triggeredByAiInsightId: data.insightId,
        status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
      },
      select: { _id: true, codeTaskId: true },
      props: { isRoot: true },
    });

    if (!run) {
      return null;
    }

    return (run.codeTaskId || run.id)?.toString() || null;
  }
}
