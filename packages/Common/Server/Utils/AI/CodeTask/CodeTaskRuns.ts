import Semaphore, { SemaphoreMutex } from "../../../Infrastructure/Semaphore";
import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import FixRunBudget from "../CodeFix/FixRunBudget";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import AIRunStatus, {
  AIRunStatusHelper,
} from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import { getCodeTaskRequest } from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType, {
  CodeFixTaskTypeHelper,
} from "../../../../Types/AI/CodeFixTaskType";
import {
  CODE_TASK_LIMITS,
  CodeTaskContextItem,
  CodeTaskRequest,
  CodeTaskState,
  CodeTaskStateUtil,
  CodeTaskTitle,
} from "../../../../Types/AI/CodeTask";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * STARTS, CONTINUES AND STOPS CODE TASKS.
 *
 * Every turn is a Queued code-fix run of the CodeRequest recipe, written as
 * root (runs are server-written only), for a Runner to claim like any other
 * code fix. The caller has already been allowed to ask (CodeTaskAccess) and
 * AI has been found able to work (CodeTaskGate); this records the work.
 *
 * A task takes one turn at a time. A reply, or a retry, while a turn is still
 * queued or running is refused: two turns on the same branch at once would
 * push over each other. The check and the write are held together by a lock
 * on the task, so two replies sent at the same moment make one turn.
 */

export const CODE_TASK_BUSY_MESSAGE: string =
  "AI is still working on this task. Wait for it to finish, or stop it, before you reply.";

/*
 * A pull request's production review is OneUptime's, reviewed again when
 * the pull request changes or someone asks: it takes no reply.
 */
export const CODE_TASK_PRODUCTION_REVIEW_REPLY_MESSAGE: string =
  "A production review is not a conversation: it is updated when its pull request changes, or when you press Review again. To change code, ask AI in the repository.";

const REPLY_LOCK_NAMESPACE: string = "CodeTaskRuns.turn";

/*
 * A task has one turn at a time; this only bounds a stop that finds more
 * (written before turns were locked, or while Valkey was down).
 */
const MAX_ACTIVE_TURNS_TO_STOP: number = 20;

export default class CodeTaskRuns {
  // A request or a reply, as typed: not empty, and not over the limit.
  public static readMessage(raw: unknown): string {
    if (typeof raw !== "string" || raw.trim().length === 0) {
      throw new BadDataException("Write what you want AI to do.");
    }

    const message: string = raw.trim();

    if (message.length > CODE_TASK_LIMITS.maxMessageLength) {
      throw new BadDataException(
        `A request can be at most ${CODE_TASK_LIMITS.maxMessageLength} characters long. Add long text as a note instead.`,
      );
    }

    return message;
  }

  /*
   * A new task in the repository: its first turn. `baseBranch` is the
   * branch the person picked for it to start from, when it is not the
   * repository's main branch (the caller checked it is on GitHub); it is
   * kept on this turn's request, where every later turn reads it.
   */
  @CaptureSpan()
  public static async start(data: {
    projectId: ObjectID;
    userId: ObjectID;
    repository: CodeRepository;
    message: string;
    context: Array<CodeTaskContextItem>;
    baseBranch?: string | null | undefined;
  }): Promise<AIRun> {
    const message: string = CodeTaskRuns.readMessage(data.message);

    // Subjectless AI work: no daily fix-task limit applies (FixRunBudget).
    await FixRunBudget.assertWithinBudget(data.projectId, {});

    const request: CodeTaskRequest = { message, context: data.context };

    if (data.baseBranch) {
      request.baseBranch = data.baseBranch;
    }

    const run: AIRun = CodeTaskRuns.newTurn({
      projectId: data.projectId,
      userId: data.userId,
      codeRepositoryId: data.repository.id!,
      request,
    });

    run.title = CodeTaskTitle.fromMessage(message);

    return await AIRunService.create({
      data: run,
      props: { isRoot: true },
    });
  }

  /*
   * A task OneUptime starts on its own: a request nobody typed, written by
   * OneUptime from a problem it found in the project's telemetry - slow code
   * in a service's profiles (Types/AI/TelemetryAi) - and stamped with the
   * insight that holds that problem, so Code says what started the task and
   * its pull request says why it was opened. It is an ordinary Code task from
   * then on: a conversation anyone who may ask in the repository can reply
   * in, retry or stop, worked by the Runner the repository picks. The rules
   * that let OneUptime start it pick its LLM provider, when they do.
   */
  @CaptureSpan()
  public static async startForOneUptime(data: {
    projectId: ObjectID;
    repository: CodeRepository;
    message: string;
    context: Array<CodeTaskContextItem>;
    triggeredByAiInsightId: ObjectID;
    llmProviderId?: ObjectID | undefined;
  }): Promise<AIRun> {
    const message: string = CodeTaskRuns.readMessage(data.message);

    // Subjectless AI work: no daily fix-task limit applies (FixRunBudget).
    await FixRunBudget.assertWithinBudget(data.projectId, {});

    const run: AIRun = CodeTaskRuns.newTurn({
      projectId: data.projectId,
      codeRepositoryId: data.repository.id!,
      request: { message, context: data.context },
    });

    run.title = CodeTaskTitle.fromMessage(message);
    run.triggeredByAiInsightId = data.triggeredByAiInsightId;

    if (data.llmProviderId) {
      run.llmProviderId = data.llmProviderId;
    }

    return await AIRunService.create({
      data: run,
      props: { isRoot: true },
    });
  }

  // A reply in the task's conversation: its next turn.
  @CaptureSpan()
  public static async reply(data: {
    projectId: ObjectID;
    userId: ObjectID;
    task: AIRun;
    message: string;
    context: Array<CodeTaskContextItem>;
  }): Promise<AIRun> {
    const message: string = CodeTaskRuns.readMessage(data.message);

    return await CodeTaskRuns.addTurn({
      projectId: data.projectId,
      userId: data.userId,
      task: data.task,
      request: { message, context: data.context },
    });
  }

  /*
   * Ask again what the latest turn asked, when it failed or was stopped: a
   * new turn with the same request, so the conversation keeps the failed
   * one. Only a request from Code can be asked again this way.
   */
  @CaptureSpan()
  public static async retry(data: {
    projectId: ObjectID;
    userId: ObjectID;
    task: AIRun;
  }): Promise<AIRun> {
    const latest: AIRun = await CodeTaskRuns.getLatestTurn({
      projectId: data.projectId,
      task: data.task,
      withTaskContext: true,
    });

    const state: CodeTaskState = CodeTaskStateUtil.fromRun(latest);

    if (state !== CodeTaskState.Failed && state !== CodeTaskState.Stopped) {
      throw new BadDataException(
        "Only a turn that failed or was stopped can be tried again.",
      );
    }

    const request: CodeTaskRequest | null = CodeFixTaskTypeHelper.isCodeRequest(
      latest.codeFixTaskType,
    )
      ? getCodeTaskRequest(latest.taskContext)
      : null;

    if (!request) {
      throw new BadDataException(
        "This turn was not asked for in Code, so it cannot be asked again. Reply with what you want AI to do instead.",
      );
    }

    /*
     * The same words and context. The branch the task starts from stays on
     * its first turn, where every turn reads it.
     */
    return await CodeTaskRuns.addTurn({
      projectId: data.projectId,
      userId: data.userId,
      task: data.task,
      request: { message: request.message, context: request.context },
    });
  }

  /*
   * Stop the task's turn that is queued or running. A queued one simply
   * never starts. A running one is marked stopped at once; its Runner finds
   * out at its next model call (which only a running turn may make) and
   * ends without pushing anything more - what it already pushed stays on
   * the branch. Returns how many turns were stopped.
   */
  @CaptureSpan()
  public static async stop(data: {
    projectId: ObjectID;
    task: AIRun;
    stoppedByName: string;
  }): Promise<number> {
    const [activeTask, activeReplies]: [AIRun | null, Array<AIRun>] =
      await Promise.all([
        AIRunService.findOneBy({
          query: {
            _id: data.task.id!.toString(),
            projectId: data.projectId,
            runType: AIRunType.CodeFix,
            status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
          },
          select: { _id: true, status: true },
          props: { isRoot: true },
        }),
        AIRunService.findBy({
          query: {
            projectId: data.projectId,
            runType: AIRunType.CodeFix,
            codeTaskId: data.task.id!,
            status: QueryHelper.notIn(AIRunStatusHelper.terminalStatuses()),
          },
          select: { _id: true, status: true },
          limit: MAX_ACTIVE_TURNS_TO_STOP,
          skip: 0,
          props: { isRoot: true },
        }),
      ]);

    const activeTurns: Array<AIRun> = [
      ...(activeTask ? [activeTask] : []),
      ...activeReplies,
    ];

    let stopped: number = 0;

    for (const turn of activeTurns) {
      if (!turn.id || !turn.status) {
        continue;
      }

      stopped += await AIRunService.attemptStatusTransition({
        aiRunId: turn.id,
        fromStatus: turn.status,
        set: {
          status: AIRunStatus.Cancelled,
          completedAt: OneUptimeDate.getCurrentDate(),
          errorMessage: data.stoppedByName
            ? `Stopped by ${data.stoppedByName}.`
            : "Stopped.",
        },
      });
    }

    return stopped;
  }

  // The task's latest turn: its newest reply, or the task itself.
  @CaptureSpan()
  public static async getLatestTurn(data: {
    projectId: ObjectID;
    task: AIRun;
    withTaskContext?: boolean | undefined;
  }): Promise<AIRun> {
    const latestReply: AIRun | null = await AIRunService.findOneBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeTaskId: data.task.id!,
      },
      select: {
        _id: true,
        status: true,
        needsUserInput: true,
        codeFixTaskType: true,
        ...(data.withTaskContext ? { taskContext: true } : {}),
      },
      sort: { createdAt: SortOrder.Descending },
      props: { isRoot: true },
    });

    if (latestReply) {
      return latestReply;
    }

    if (data.withTaskContext && data.task.taskContext === undefined) {
      const task: AIRun | null = await AIRunService.findOneById({
        id: data.task.id!,
        select: {
          _id: true,
          status: true,
          needsUserInput: true,
          codeFixTaskType: true,
          taskContext: true,
        },
        props: { isRoot: true },
      });

      return task || data.task;
    }

    return data.task;
  }

  private static async addTurn(data: {
    projectId: ObjectID;
    userId: ObjectID;
    task: AIRun;
    request: CodeTaskRequest;
  }): Promise<AIRun> {
    if (!data.task.codeRepositoryId) {
      throw new BadDataException(
        "This task is not linked to a repository, so AI cannot continue it. Start a new task from a repository in Code.",
      );
    }

    if (CodeFixTaskTypeHelper.isProductionReview(data.task.codeFixTaskType)) {
      throw new BadDataException(CODE_TASK_PRODUCTION_REVIEW_REPLY_MESSAGE);
    }

    const mutex: SemaphoreMutex | null = await CodeTaskRuns.lockTask(
      data.task.id!,
    );

    try {
      const latest: AIRun = await CodeTaskRuns.getLatestTurn({
        projectId: data.projectId,
        task: data.task,
      });

      if (!CodeTaskStateUtil.acceptsReply(CodeTaskStateUtil.fromRun(latest))) {
        throw new BadDataException(CODE_TASK_BUSY_MESSAGE);
      }

      await FixRunBudget.assertWithinBudget(data.projectId, {});

      const run: AIRun = CodeTaskRuns.newTurn({
        projectId: data.projectId,
        userId: data.userId,
        codeRepositoryId: data.task.codeRepositoryId,
        request: data.request,
      });

      run.codeTaskId = data.task.id!;

      return await AIRunService.create({
        data: run,
        props: { isRoot: true },
      });
    } finally {
      await CodeTaskRuns.unlockTask(mutex);
    }
  }

  // A turn asked by a person, or by OneUptime itself (no userId).
  private static newTurn(data: {
    projectId: ObjectID;
    userId?: ObjectID | undefined;
    codeRepositoryId: ObjectID;
    request: CodeTaskRequest;
  }): AIRun {
    const run: AIRun = new AIRun();
    run.projectId = data.projectId;
    run.runType = AIRunType.CodeFix;
    run.codeFixTaskType = CodeFixTaskType.CodeRequest;
    run.status = AIRunStatus.Queued;

    if (data.userId) {
      run.userId = data.userId;
    }

    run.codeRepositoryId = data.codeRepositoryId;
    run.taskContext = { request: data.request };
    return run;
  }

  /*
   * Null when the lock cannot be had (Valkey unreachable): the turn is then
   * checked and written without it, as one was before turns were locked.
   */
  private static async lockTask(
    taskId: ObjectID,
  ): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: taskId.toString(),
        namespace: REPLY_LOCK_NAMESPACE,
        lockTimeout: 15000,
      });
    } catch (error) {
      logger.error(
        `Could not lock code task ${taskId.toString()} for a new turn; going ahead without the lock: ${error}`,
      );
      return null;
    }
  }

  private static async unlockTask(mutex: SemaphoreMutex | null): Promise<void> {
    if (!mutex) {
      return;
    }

    try {
      await Semaphore.release(mutex);
    } catch (error) {
      logger.error(error);
    }
  }
}
