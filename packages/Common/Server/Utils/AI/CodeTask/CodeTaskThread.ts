import AIAgentTaskPullRequestService from "../../../Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../Services/AIRunService";
import UserService from "../../../Services/UserService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import Select from "../../../Types/Database/Select";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIAgentTaskPullRequest from "../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import User from "../../../../Models/DatabaseModels/User";
import AIRunType from "../../../../Types/AI/AIRunType";
import { CodeTaskPersonJSON } from "../../../../Types/AI/CodeTask";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import PullRequestState from "../../../../Types/CodeRepository/PullRequestState";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";

/*
 * READS A CODE TASK: ITS TURNS, THEIR PULL REQUESTS AND WHO ASKED.
 *
 * A task is its first code-fix run, and each reply is a later run whose
 * codeTaskId names that first run (see Types/AI/CodeTask). Everything here
 * reads as root, pinned to the project and to code-fix runs: the Code API
 * has already decided the caller may read the task (CodeTaskAccess), and a
 * task id of another project, or of a chat run, reads as no task at all.
 */

// What a turn needs to be shown, in a list or a conversation.
export const CODE_TASK_TURN_SELECT: Select<AIRun> = {
  _id: true,
  projectId: true,
  codeFixTaskType: true,
  codeRepositoryId: true,
  codeTaskId: true,
  taskNumber: true,
  title: true,
  status: true,
  needsUserInput: true,
  userId: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  errorMessage: true,
  triggeredByTelemetryExceptionId: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
  triggeredByAiInsightId: true,
};

// A task has at most this many turns read for its conversation.
export const MAX_TURNS_PER_TASK: number = 200;

export default class CodeTaskThread {
  // The task (its first run) - null when it is not a code task of the project.
  @CaptureSpan()
  public static async findTask(data: {
    projectId: ObjectID;
    taskId: ObjectID;
    select?: Select<AIRun> | undefined;
  }): Promise<AIRun | null> {
    const run: AIRun | null = await AIRunService.findOneBy({
      query: {
        _id: data.taskId.toString(),
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
      },
      select: data.select || CODE_TASK_TURN_SELECT,
      props: { isRoot: true },
    });

    if (!run) {
      return null;
    }

    if (!run.codeTaskId) {
      return run;
    }

    /*
     * A reply's own id leads to its task's first run, so an old link to one
     * (the Tasks page listed every run) still lands on the task. One step
     * only: a first run has no codeTaskId of its own.
     */
    return await AIRunService.findOneBy({
      query: {
        _id: run.codeTaskId.toString(),
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeTaskId: QueryHelper.isNull(),
      },
      select: data.select || CODE_TASK_TURN_SELECT,
      props: { isRoot: true },
    });
  }

  // Every turn of the task, oldest first: its first run, then the replies.
  @CaptureSpan()
  public static async getTurns(data: {
    projectId: ObjectID;
    task: AIRun;
    select?: Select<AIRun> | undefined;
  }): Promise<Array<AIRun>> {
    const replies: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeTaskId: data.task.id!,
      },
      select: data.select || CODE_TASK_TURN_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      limit: MAX_TURNS_PER_TASK - 1,
      skip: 0,
      props: { isRoot: true },
    });

    return [data.task, ...replies];
  }

  /*
   * The replies of many tasks at once, by task id, oldest first - what a
   * list needs to tell each task's latest state.
   */
  @CaptureSpan()
  public static async getRepliesByTask(data: {
    projectId: ObjectID;
    taskIds: Array<ObjectID>;
  }): Promise<Map<string, Array<AIRun>>> {
    const repliesByTask: Map<string, Array<AIRun>> = new Map<
      string,
      Array<AIRun>
    >();

    if (data.taskIds.length === 0) {
      return repliesByTask;
    }

    const replies: Array<AIRun> = await AIRunService.findBy({
      query: {
        projectId: data.projectId,
        runType: AIRunType.CodeFix,
        codeTaskId: QueryHelper.any(data.taskIds),
      },
      select: {
        _id: true,
        codeTaskId: true,
        status: true,
        needsUserInput: true,
        userId: true,
        createdAt: true,
        completedAt: true,
      },
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    for (const reply of replies) {
      const taskId: string = reply.codeTaskId!.toString();
      const list: Array<AIRun> = repliesByTask.get(taskId) || [];
      list.push(reply);
      repliesByTask.set(taskId, list);
    }

    return repliesByTask;
  }

  // The pull requests the runs opened, newest first.
  @CaptureSpan()
  public static async getPullRequests(data: {
    projectId: ObjectID;
    runIds: Array<ObjectID>;
  }): Promise<Array<AIAgentTaskPullRequest>> {
    if (data.runIds.length === 0) {
      return [];
    }

    return await AIAgentTaskPullRequestService.findBy({
      query: {
        projectId: data.projectId,
        aiRunId: QueryHelper.any(data.runIds),
      },
      select: {
        _id: true,
        aiRunId: true,
        codeRepositoryId: true,
        title: true,
        description: true,
        pullRequestUrl: true,
        pullRequestNumber: true,
        pullRequestState: true,
        headRefName: true,
        baseRefName: true,
        createdAt: true,
      },
      sort: { createdAt: SortOrder.Descending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * The pull request a reply builds on: the newest one the task's runs
   * opened that is still open, in the task's repository. A task whose pull
   * request was merged or closed starts its next change on a new branch.
   */
  public static getWorkingPullRequest(data: {
    pullRequests: Array<AIAgentTaskPullRequest>;
    codeRepositoryId: ObjectID | undefined;
  }): AIAgentTaskPullRequest | null {
    if (!data.codeRepositoryId) {
      return null;
    }

    return (
      data.pullRequests.find((pullRequest: AIAgentTaskPullRequest): boolean => {
        return (
          (pullRequest.pullRequestState || PullRequestState.Open) ===
            PullRequestState.Open &&
          Boolean(pullRequest.headRefName) &&
          pullRequest.codeRepositoryId?.toString() ===
            data.codeRepositoryId!.toString()
        );
      }) || null
    );
  }

  // The task's runs' ids, and its working pull request, in two reads.
  @CaptureSpan()
  public static async findWorkingPullRequest(data: {
    projectId: ObjectID;
    task: AIRun;
  }): Promise<AIAgentTaskPullRequest | null> {
    const turns: Array<AIRun> = await CodeTaskThread.getTurns({
      projectId: data.projectId,
      task: data.task,
      select: { _id: true, codeTaskId: true, createdAt: true },
    });

    const pullRequests: Array<AIAgentTaskPullRequest> =
      await CodeTaskThread.getPullRequests({
        projectId: data.projectId,
        runIds: turns.map((turn: AIRun): ObjectID => {
          return turn.id!;
        }),
      });

    return CodeTaskThread.getWorkingPullRequest({
      pullRequests,
      codeRepositoryId: data.task.codeRepositoryId,
    });
  }

  // The people who asked, by id: their name, or their email without one.
  @CaptureSpan()
  public static async getPeople(
    userIds: Array<ObjectID>,
  ): Promise<Map<string, CodeTaskPersonJSON>> {
    const people: Map<string, CodeTaskPersonJSON> = new Map<
      string,
      CodeTaskPersonJSON
    >();

    const uniqueIds: Array<string> = Array.from(
      new Set(
        userIds.map((userId: ObjectID): string => {
          return userId.toString();
        }),
      ),
    );

    if (uniqueIds.length === 0) {
      return people;
    }

    const users: Array<User> = await UserService.findBy({
      query: { _id: QueryHelper.any(uniqueIds) },
      select: { _id: true, name: true, email: true },
      limit: uniqueIds.length,
      skip: 0,
      props: { isRoot: true },
    });

    for (const user of users) {
      if (!user.id) {
        continue;
      }

      people.set(user.id.toString(), {
        id: user.id.toString(),
        name: user.name?.toString() || user.email?.toString() || "",
      });
    }

    return people;
  }
}
