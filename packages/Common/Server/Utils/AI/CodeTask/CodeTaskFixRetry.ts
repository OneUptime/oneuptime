import AIRunService from "../../../Services/AIRunService";
import TelemetryExceptionService from "../../../Services/TelemetryExceptionService";
import Select from "../../../Types/Database/Select";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeFixAutoRetry from "../CodeFix/CodeFixAutoRetry";
import CodeFixOnItsWay, { CodeFixProblem } from "../CodeFix/CodeFixOnItsWay";
import FixRunBudget from "../CodeFix/FixRunBudget";
import InvestigationSubjectLock from "../SRE/InvestigationSubjectLock";
import SubjectCodeFixRun from "../SRE/SubjectCodeFixRun";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import CarriedRecords from "../../../../Types/AI/CarriedRecords";
import CodeFixTaskContext from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType, {
  CodeFixContextKind,
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import {
  CODE_TASK_TRY_AGAIN_EXCEPTION_ARCHIVED_MESSAGE,
  CODE_TASK_TRY_AGAIN_EXCEPTION_GONE_MESSAGE,
  CODE_TASK_TRY_AGAIN_EXCEPTION_RESOLVED_MESSAGE,
  CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE,
  CODE_TASK_TRY_AGAIN_INVESTIGATION_MOVED_MESSAGE,
  CODE_TASK_TRY_AGAIN_MAY_HAVE_WRITTEN_MESSAGE,
  CODE_TASK_TRY_AGAIN_NOT_IN_CODE_MESSAGE,
} from "../../../../Types/AI/CodeTaskTryAgain";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * TRY AGAIN ON A FIX ONEUPTIME STARTED (#6509).
 *
 * A request someone typed in Code is asked again in its own words
 * (CodeTaskRuns.retry). A fix OneUptime started - Fix with AI on an
 * exception, a trace or a service's logs or traces, an AI insight's fix, an
 * investigation's fix pull request, the instrumentation an inconclusive
 * investigation asked for - has no words of its own: it is asked again
 * with the context it started with, as a new turn of the same task. The
 * conversation keeps the turn that failed, and the new one carries what
 * the first carried - its recipe, the exception, incident, alert or
 * insight it is about, its trace's or service's evidence, the LLM provider
 * its rules picked and the records it carries - so it is read by the
 * readers the first turn is read by, and the Runner reads for them
 * (CodeAgentTelemetryScope, AIRunOutputReadFilter).
 *
 * Under the rule the automatic attempts keep (CodeFixAutoRetry): a fix is
 * asked again only when nothing says it may already have written - no pull
 * request recorded by the turn or anywhere in its task, and no line in its
 * trail a Runner logs just before it pushes or opens one. A new turn works
 * on a branch of its own, so a fix that may have pushed or opened a pull
 * request would open a second one beside the first: it is refused, and the
 * person can reply in the task instead, which builds on the pull request.
 *
 * Everything that holds a new fix holds this one: the daily fix-task
 * limits of its incident or alert (FixRunBudget, which counts it as the
 * day's), one fix at a time of the same exception, incident, alert, trace
 * or service, an exception still open, an investigation's fix only from
 * the latest investigation (under the lock that creation takes,
 * InvestigationSubjectLock) - and, where its Runner asks for a token to
 * push, the repository's cap on open fix pull requests. Code's gate (the
 * plan, permission to ask in the repository, the AI switch, credits, a
 * Runner) is asked by the route first.
 *
 * Never a second retry mechanism: the turn is queued as any new turn is,
 * and the automatic attempts (CodeFixAutoRetry) hold it as they hold the
 * first.
 */

// What a fix's turn is read with to be asked again: everything it carries.
export const CODE_TASK_FIX_TURN_SELECT: Select<AIRun> = {
  _id: true,
  projectId: true,
  runType: true,
  status: true,
  needsUserInput: true,
  codeFixTaskType: true,
  codeRepositoryId: true,
  codeTaskId: true,
  userId: true,
  triggeredByTelemetryExceptionId: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
  triggeredByAiInsightId: true,
  triggeredBySecurityCaseId: true,
  taskContext: true,
  llmProviderId: true,
  carriedIncidentIds: true,
  carriedAlertIds: true,
};

export default class CodeTaskFixRetry {
  /*
   * Why a fix's failed or stopped turn is not asked again, for a person
   * who could otherwise ask it: it may already have written
   * (CodeFixAutoRetry.mayHaveWritten, with its task's pull requests
   * counted) - or null. What a task's page says in place of Try again.
   * `turn` is read with its id and its task's (codeTaskId).
   */
  @CaptureSpan()
  public static async getRefusal(turn: AIRun): Promise<string | null> {
    if (!CodeFixTaskTypeHelper.isFixAskedAgain(turn.codeFixTaskType)) {
      return null;
    }

    return (await CodeTaskFixRetry.mayHaveWritten(turn))
      ? CODE_TASK_TRY_AGAIN_MAY_HAVE_WRITTEN_MESSAGE
      : null;
  }

  /*
   * Ask the fix's turn `turnId` again: a new turn of `task`, queued, that
   * carries what the turn carried. Called with the task held
   * (CodeTaskRuns.addTurn), so it takes one turn at a time; refused, with
   * why, when it cannot be asked again.
   */
  @CaptureSpan()
  public static async createTurn(data: {
    projectId: ObjectID;
    userId: ObjectID;
    task: AIRun;
    turnId: ObjectID;
  }): Promise<AIRun> {
    const turn: AIRun | null = await AIRunService.findOneBy({
      query: {
        _id: data.turnId.toString(),
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
      },
      select: CODE_TASK_FIX_TURN_SELECT,
      props: { isRoot: true },
    });

    if (!turn || !CodeFixTaskTypeHelper.isFixAskedAgain(turn.codeFixTaskType)) {
      throw new BadDataException(CODE_TASK_TRY_AGAIN_NOT_IN_CODE_MESSAGE);
    }

    if (await CodeTaskFixRetry.mayHaveWritten(turn)) {
      throw new BadDataException(CODE_TASK_TRY_AGAIN_MAY_HAVE_WRITTEN_MESSAGE);
    }

    const taskType: CodeFixTaskType = CodeFixTaskTypeHelper.fromDatabaseValue(
      turn.codeFixTaskType,
    );

    if (
      CodeFixTaskTypeHelper.getContextKind(taskType) ===
        CodeFixContextKind.TelemetryException &&
      turn.triggeredByTelemetryExceptionId
    ) {
      await CodeTaskFixRetry.assertExceptionMayBeFixed({
        projectId: data.projectId,
        exceptionId: turn.triggeredByTelemetryExceptionId,
      });
    }

    const create: () => Promise<AIRun> = async (): Promise<AIRun> => {
      await CodeTaskFixRetry.assertNoOtherFixOnItsWay({
        projectId: data.projectId,
        taskType,
        turn,
      });

      // The day's fix tasks of its incident or alert: this one is one of them.
      await FixRunBudget.assertWithinBudget(data.projectId, {
        incidentId: turn.triggeredByIncidentId || undefined,
        alertId: turn.triggeredByIncidentId
          ? undefined
          : turn.triggeredByAlertId || undefined,
      });

      if (taskType === CodeFixTaskType.FixFromIncident) {
        await CodeTaskFixRetry.assertLatestInvestigation({
          projectId: data.projectId,
          turn,
        });
      }

      return await AIRunService.create({
        data: CodeTaskFixRetry.newTurn({
          projectId: data.projectId,
          userId: data.userId,
          task: data.task,
          turn,
          taskType,
        }),
        props: { isRoot: true },
      });
    };

    /*
     * An investigation's fix is decided against the latest investigation,
     * which a new one could replace between the read and the write: the
     * lock its creation and every investigation's take (fails closed).
     */
    if (
      taskType === CodeFixTaskType.FixFromIncident &&
      Boolean(turn.triggeredByIncidentId) !== Boolean(turn.triggeredByAlertId)
    ) {
      return await InvestigationSubjectLock.runExclusive(
        {
          projectId: data.projectId,
          incidentId: turn.triggeredByIncidentId || undefined,
          alertId: turn.triggeredByIncidentId
            ? undefined
            : turn.triggeredByAlertId || undefined,
        },
        create,
      );
    }

    return await create();
  }

  /*
   * The new turn: the fix's recipe and everything it carries, asked by the
   * person, as a turn of the task. Its context is a copy: the turns never
   * share one object.
   */
  public static newTurn(data: {
    projectId: ObjectID;
    userId: ObjectID;
    task: AIRun;
    turn: AIRun;
    taskType: CodeFixTaskType;
  }): AIRun {
    const run: AIRun = new AIRun();
    run.projectId = data.projectId;
    run.runType = AIRunType.CodeFix;
    run.codeFixTaskType = data.taskType;
    run.status = AIRunStatus.Queued;
    run.codeTaskId = data.task.id!;
    run.userId = data.userId;

    const codeRepositoryId: ObjectID | undefined =
      data.turn.codeRepositoryId || data.task.codeRepositoryId;

    if (codeRepositoryId) {
      run.codeRepositoryId = codeRepositoryId;
    }

    if (data.turn.triggeredByTelemetryExceptionId) {
      run.triggeredByTelemetryExceptionId =
        data.turn.triggeredByTelemetryExceptionId;
    }

    if (data.turn.triggeredByIncidentId) {
      run.triggeredByIncidentId = data.turn.triggeredByIncidentId;
    } else if (data.turn.triggeredByAlertId) {
      run.triggeredByAlertId = data.turn.triggeredByAlertId;
    }

    if (data.turn.triggeredByAiInsightId) {
      run.triggeredByAiInsightId = data.turn.triggeredByAiInsightId;
    }

    // A fix asked from a security case stays the case's: its pull request is too (#10347).
    if (data.turn.triggeredBySecurityCaseId) {
      run.triggeredBySecurityCaseId = data.turn.triggeredBySecurityCaseId;
    }

    if (data.turn.llmProviderId) {
      run.llmProviderId = data.turn.llmProviderId;
    }

    if (data.turn.taskContext) {
      run.taskContext = JSON.parse(
        JSON.stringify(data.turn.taskContext),
      ) as CodeFixTaskContext;
    }

    // The records it carries, as the turn carried them (#9186).
    CarriedRecords.writeTo(run, CarriedRecords.ofRow(data.turn));

    return run;
  }

  /*
   * Whether the fix's turn may already have written: what the automatic
   * attempts ask (CodeFixAutoRetry.mayHaveWritten), with every pull request
   * of its task counted - a new turn opens one of its own, so any pull
   * request the task has would be a second.
   */
  private static async mayHaveWritten(turn: AIRun): Promise<boolean> {
    // As for a Runner gone: the task's pull requests, of any of its turns.
    return await CodeFixAutoRetry.mayHaveWritten({
      run: turn,
      isRunnerGone: true,
    });
  }

  // The exception a fix is for is still there, and still open.
  private static async assertExceptionMayBeFixed(data: {
    projectId: ObjectID;
    exceptionId: ObjectID;
  }): Promise<void> {
    const exception: TelemetryException | null =
      await TelemetryExceptionService.findOneBy({
        query: {
          _id: data.exceptionId.toString(),
          projectId: data.projectId,
        },
        select: { _id: true, isResolved: true, isArchived: true },
        props: { isRoot: true },
      });

    if (!exception) {
      throw new BadDataException(CODE_TASK_TRY_AGAIN_EXCEPTION_GONE_MESSAGE);
    }

    if (exception.isResolved) {
      throw new BadDataException(
        CODE_TASK_TRY_AGAIN_EXCEPTION_RESOLVED_MESSAGE,
      );
    }

    if (exception.isArchived) {
      throw new BadDataException(
        CODE_TASK_TRY_AGAIN_EXCEPTION_ARCHIVED_MESSAGE,
      );
    }
  }

  /*
   * One fix at a time of the same problem, as its creation holds it: of
   * the exception (per recipe), the incident or alert, the insight, the
   * trace, or the service. The task's own turns are all done: a task takes
   * one turn at a time, and its latest failed or was stopped.
   */
  private static async assertNoOtherFixOnItsWay(data: {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    turn: AIRun;
  }): Promise<void> {
    const onItsWay: AIRun | null =
      await CodeTaskFixRetry.findOtherFixOnItsWay(data);

    if (onItsWay) {
      throw new BadDataException(CODE_TASK_TRY_AGAIN_FIX_ON_ITS_WAY_MESSAGE);
    }
  }

  /*
   * Another fix of what the turn is a fix of, on its way: a turn queued or
   * running of a task of the same problem - its first turn, a fix asked
   * again, or a reply someone sent in Code - by the rule every fix holds to
   * (CodeFixOnItsWay). The turn carries the problem as its task's first
   * turn did; `taskType` is its recipe, a null one read as an exception fix.
   */
  public static async findOtherFixOnItsWay(data: {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    turn: AIRun;
  }): Promise<AIRun | null> {
    const problems: Array<CodeFixProblem> = CodeFixOnItsWay.problemsOf({
      projectId: data.projectId,
      runType: AIRunType.CodeFix,
      codeFixTaskType: data.taskType,
      triggeredByTelemetryExceptionId:
        data.turn.triggeredByTelemetryExceptionId,
      triggeredByIncidentId: data.turn.triggeredByIncidentId,
      triggeredByAlertId: data.turn.triggeredByAlertId,
      triggeredByAiInsightId: data.turn.triggeredByAiInsightId,
      taskContext: data.turn.taskContext,
    });

    for (const problem of problems) {
      const onItsWay: AIRun | null = await CodeFixOnItsWay.findTurn(problem);

      if (onItsWay) {
        return onItsWay;
      }
    }

    return null;
  }

  /*
   * An investigation's fix is worked out from the latest investigation of
   * its incident or alert, and only while that recommends a change in the
   * code (SubjectCodeFixRun): one asked from an investigation that is no
   * longer the latest is started again from the latest instead.
   */
  private static async assertLatestInvestigation(data: {
    projectId: ObjectID;
    turn: AIRun;
  }): Promise<void> {
    try {
      await SubjectCodeFixRun.assertLatestRecommendedInvestigationSource({
        projectId: data.projectId,
        taskType: CodeFixTaskType.FixFromIncident,
        incidentId: data.turn.triggeredByIncidentId || undefined,
        alertId: data.turn.triggeredByIncidentId
          ? undefined
          : data.turn.triggeredByAlertId || undefined,
        taskContext: data.turn.taskContext,
      });
    } catch (error) {
      if (error instanceof BadDataException) {
        throw new BadDataException(
          CODE_TASK_TRY_AGAIN_INVESTIGATION_MOVED_MESSAGE,
        );
      }

      throw error;
    }
  }
}
