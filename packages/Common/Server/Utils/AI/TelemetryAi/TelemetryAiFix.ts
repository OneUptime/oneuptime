import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeFixOnItsWay from "../CodeFix/CodeFixOnItsWay";
import CodeTaskThread from "../CodeTask/CodeTaskThread";
import AIRunType from "../../../../Types/AI/AIRunType";
import { getTelemetryAiFixTaskTypes } from "../../../../Types/AI/TelemetryAi";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import SuggestionOffer from "../../../../Utils/Suggestions/SuggestionOffer";
import {
  HIDDEN_TELEMETRY_AI_FIX_SUGGESTION,
  NO_TELEMETRY_AI_FIX_SUGGESTION,
  TelemetryAiFixSuggestion,
} from "../../../../Utils/Suggestions/TelemetryAiFixSuggestion";

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
   * null. On its way is the rule every fix holds to (CodeFixOnItsWay): a
   * turn of it queued or running, its first turn, the fix asked again or a
   * reply someone sent in Code, which carries no insight of its own. Its
   * first turn's id is the task's.
   */
  @CaptureSpan()
  public static async findActiveTaskIdForInsight(data: {
    projectId: ObjectID;
    insightId: ObjectID;
  }): Promise<string | null> {
    return await CodeFixOnItsWay.findTaskId(CodeFixOnItsWay.ofInsight(data));
  }

  /*
   * What a finding's Fix with AI says of the Code task already on its way
   * (findActiveTaskIdForInsight), read as the task's own page reads it for
   * `reader`: a task a reply carried a private incident or alert into,
   * which they do not see, is there - so no second fix is offered - and
   * nothing of it, not even the link to it
   * (HIDDEN_TELEMETRY_AI_FIX_SUGGESTION).
   */
  @CaptureSpan()
  public static async getInProgressSuggestion(data: {
    projectId: ObjectID;
    taskId: string;
    reader: DatabaseCommonInteractionProps;
  }): Promise<TelemetryAiFixSuggestion> {
    const hidden: Set<string> = await CodeTaskThread.findTasksHiddenFrom({
      projectId: data.projectId,
      taskIds: [data.taskId],
      reader: data.reader,
    });

    if (hidden.size > 0) {
      return HIDDEN_TELEMETRY_AI_FIX_SUGGESTION;
    }

    return {
      ...NO_TELEMETRY_AI_FIX_SUGGESTION,
      offer: SuggestionOffer.InProgress,
      taskId: data.taskId,
    };
  }
}
