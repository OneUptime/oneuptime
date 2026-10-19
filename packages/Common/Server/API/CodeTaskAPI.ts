import UserMiddleware from "../Middleware/UserAuthorization";
import CommonAPI from "./CommonAPI";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import AIRunService from "../Services/AIRunService";
import QueryHelper from "../Types/Database/QueryHelper";
import CallerPermission from "../Utils/Permission/CallerPermission";
import CodeTaskAccess, {
  CODE_TASK_NOT_FOUND_MESSAGE,
} from "../Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../Utils/AI/CodeTask/CodeTaskContextBuilder";
import CodeTaskGate from "../Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskPresenter from "../Utils/AI/CodeTask/CodeTaskPresenter";
import CodeTaskRuns from "../Utils/AI/CodeTask/CodeTaskRuns";
import CodeTaskStats from "../Utils/AI/CodeTask/CodeTaskStats";
import CodeTaskThread, {
  CODE_TASK_TURN_SELECT,
} from "../Utils/AI/CodeTask/CodeTaskThread";
import AIRun from "../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import AIRunType from "../../Types/AI/AIRunType";
import {
  CodeRepositoryTaskStatsJSON,
  CodeTaskBlocker,
  CodeTaskContextInput,
  CodeTaskContextInputUtil,
  CodeTaskContextItem,
  CodeTaskRepositoryJSON,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
} from "../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import PositiveNumber from "../../Types/PositiveNumber";

/*
 * CODE: the project's repositories, their tasks, and asking OneUptime AI to
 * work in them - the API behind the Dashboard's Code pages.
 *
 *   POST /code-task/repositories          the repositories, at a glance
 *   POST /code-task/repository/:id        one repository, and whether AI can
 *                                         work in it for the caller
 *   POST /code-task/list                  a repository's tasks, newest first
 *                                         (or the tasks with no repository)
 *   POST /code-task/get/:taskId           a task's conversation
 *   POST /code-task/create                ask AI something in a repository
 *   POST /code-task/reply/:taskId         reply in a task: its next turn
 *   POST /code-task/retry/:taskId         ask a failed turn again
 *   POST /code-task/stop/:taskId          stop the turn in progress
 *
 * Every route acts as a signed-in person (a project API key is refused) in
 * the project of the request. Who may read and who may ask is the
 * repository's to decide (CodeTaskAccess); whether AI may work at all -
 * the plan, the project's AI switch, credits, limits, a Runner - is
 * CodeTaskGate's, asked again by every route that starts work.
 */

export const CODE_TASK_STOP_REFUSED_MESSAGE: string =
  "Stopping AI takes permission to edit this task's repository - ask a project admin for it.";

const DEFAULT_PAGE_SIZE: number = 20;
const MAX_PAGE_SIZE: number = 50;

export default class CodeTaskAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();
    this.initRoutes();
  }

  public getRouter(): ExpressRouter {
    return this.router;
  }

  private initRoutes(): void {
    this.route("/code-task/repositories", this.listRepositories);
    this.route("/code-task/repository/:repositoryId", this.getRepository);
    this.route("/code-task/list", this.listTasks);
    this.route("/code-task/get/:taskId", this.getTask);
    this.route("/code-task/create", this.createTask);
    this.route("/code-task/reply/:taskId", this.replyToTask);
    this.route("/code-task/retry/:taskId", this.retryTask);
    this.route("/code-task/stop/:taskId", this.stopTask);
  }

  private route(
    path: string,
    handler: (
      req: ExpressRequest,
      props: DatabaseCommonInteractionProps,
      projectId: ObjectID,
    ) => Promise<JSONObject>,
  ): void {
    this.router.post(
      path,
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          const result: JSONObject = await handler.call(
            this,
            req,
            props,
            projectId,
          );

          Response.sendJsonObjectResponse(req, res, result);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  // Code's first page: every repository the caller may read, at a glance.
  private async listRepositories(
    _req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const repositories: Array<CodeRepository> =
      await CodeTaskAccess.listReadableRepositories({ props, projectId });

    const repositoryIds: Array<ObjectID> = repositories.map(
      (repository: CodeRepository): ObjectID => {
        return repository.id!;
      },
    );

    const mayReadTasksWithoutRepository: boolean =
      CodeTaskAccess.mayReadTasksWithoutRepository(props);

    const [stats, reachable, tasksWithoutRepository]: [
      Map<string, CodeRepositoryTaskStatsJSON>,
      Set<string>,
      number,
    ] = await Promise.all([
      CodeTaskStats.getRepositoryStats({ projectId, repositoryIds }),
      CodeTaskGate.getReachableRepositoryIds({ projectId, repositoryIds }),
      mayReadTasksWithoutRepository
        ? CodeTaskStats.countTasksWithoutRepository(projectId)
        : Promise.resolve(0),
    ]);

    return {
      repositories: repositories.map(
        (repository: CodeRepository): JSONObject => {
          return {
            ...CodeTaskAPI.toRepositoryJSON(
              repository,
              reachable.has(repository.id!.toString()),
            ),
            stats: (stats.get(repository.id!.toString()) ||
              CodeTaskStats.empty()) as unknown as JSONObject,
          } as unknown as JSONObject;
        },
      ),
      tasksWithoutRepositoryCount: tasksWithoutRepository,
    };
  }

  /*
   * One repository: what it is, its tasks at a glance, and whether the
   * caller can ask AI to work in it now - or the one thing to fix first.
   */
  private async getRepository(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const repositoryId: ObjectID = CodeTaskAPI.readId(
      req.params["repositoryId"],
      "repository",
    );

    const repository: CodeRepository =
      await CodeTaskAccess.getReadableRepository({
        props,
        projectId,
        repositoryId,
      });

    const canAsk: boolean = await CodeTaskAccess.canAskInRepository({
      props,
      projectId,
      repositoryId,
    });

    const [blocker, stats, reachable]: [
      CodeTaskBlocker | null,
      Map<string, CodeRepositoryTaskStatsJSON>,
      Set<string>,
    ] = await Promise.all([
      CodeTaskGate.getBlocker({ props, projectId, repository, canAsk }),
      CodeTaskStats.getRepositoryStats({
        projectId,
        repositoryIds: [repositoryId],
      }),
      CodeTaskGate.getReachableRepositoryIds({
        projectId,
        repositoryIds: [repositoryId],
      }),
    ]);

    return {
      repository: CodeTaskAPI.toRepositoryJSON(
        repository,
        reachable.has(repositoryId.toString()),
      ) as unknown as JSONObject,
      stats: (stats.get(repositoryId.toString()) ||
        CodeTaskStats.empty()) as unknown as JSONObject,
      canAsk: canAsk,
      blocker: blocker as unknown as JSONObject,
    };
  }

  /*
   * A repository's tasks, newest first; or, with `withoutRepository`, the
   * tasks that have none.
   */
  private async listTasks(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const body: JSONObject = (req.body as JSONObject) || {};
    const withoutRepository: boolean = body["withoutRepository"] === true;

    let repositoryId: ObjectID | null = null;

    if (withoutRepository) {
      if (!CodeTaskAccess.mayReadTasksWithoutRepository(props)) {
        throw new NotFoundException(CODE_TASK_NOT_FOUND_MESSAGE);
      }
    } else {
      repositoryId = CodeTaskAPI.readId(body["repositoryId"], "repository");

      await CodeTaskAccess.getReadableRepository({
        props,
        projectId,
        repositoryId,
      });
    }

    const limit: number = CodeTaskAPI.readNumber(body["limit"], {
      defaultValue: DEFAULT_PAGE_SIZE,
      min: 1,
      max: MAX_PAGE_SIZE,
    });
    const skip: number = CodeTaskAPI.readNumber(body["skip"], {
      defaultValue: 0,
      min: 0,
      max: 100000,
    });

    const query: JSONObject = {
      projectId: projectId,
      runType: AIRunType.CodeFix,
      codeTaskId: QueryHelper.isNull(),
      codeRepositoryId: repositoryId ? repositoryId : QueryHelper.isNull(),
    } as unknown as JSONObject;

    const [tasks, count]: [Array<AIRun>, PositiveNumber] = await Promise.all([
      AIRunService.findBy({
        query: query as never,
        select: CODE_TASK_TURN_SELECT,
        sort: { createdAt: SortOrder.Descending },
        limit,
        skip,
        props: { isRoot: true },
      }),
      AIRunService.countBy({
        query: query as never,
        props: { isRoot: true },
      }),
    ]);

    const summaries: Array<CodeTaskSummaryJSON> =
      await CodeTaskPresenter.summarize({ projectId, tasks });

    return {
      tasks: summaries as unknown as Array<JSONObject>,
      count: count.toNumber(),
      skip,
      limit,
    };
  }

  // A task's conversation, and what the caller may do in it.
  private async getTask(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const { task, repository } = await this.getReadableTask(
      req,
      props,
      projectId,
    );

    const canAsk: boolean = repository
      ? await CodeTaskAccess.canAskInRepository({
          props,
          projectId,
          repositoryId: repository.id!,
        })
      : false;

    const [conversation, blocker, reachable]: [
      { task: CodeTaskSummaryJSON; turns: Array<CodeTaskTurnJSON> },
      CodeTaskBlocker | null,
      Set<string>,
    ] = await Promise.all([
      /*
       * The diff is the repository's code: shown to the people who may ask
       * AI to change it, and read-only members see which files changed.
       */
      CodeTaskPresenter.getConversation({
        projectId,
        task,
        canSeeChanges: canAsk,
      }),
      repository
        ? CodeTaskGate.getBlocker({ props, projectId, repository, canAsk })
        : Promise.resolve(null),
      repository
        ? CodeTaskGate.getReachableRepositoryIds({
            projectId,
            repositoryIds: [repository.id!],
          })
        : Promise.resolve(new Set<string>()),
    ]);

    return {
      task: conversation.task as unknown as JSONObject,
      turns: conversation.turns as unknown as Array<JSONObject>,
      repository: repository
        ? (CodeTaskAPI.toRepositoryJSON(
            repository,
            reachable.has(repository.id!.toString()),
          ) as unknown as JSONObject)
        : null,
      canAsk: canAsk,
      canSeeChanges: canAsk,
      // The verbatim log holds source code: project owners and admins.
      canReadLogContent: CallerPermission.holdsAnyOf(props, [
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
      ]),
      blocker: blocker as unknown as JSONObject,
    };
  }

  // Ask AI something in a repository: a new task.
  private async createTask(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const body: JSONObject = (req.body as JSONObject) || {};
    const repositoryId: ObjectID = CodeTaskAPI.readId(
      body["repositoryId"],
      "repository",
    );

    const repository: CodeRepository =
      await CodeTaskAccess.getReadableRepository({
        props,
        projectId,
        repositoryId,
      });

    await CodeTaskGate.assertCanStart({
      props,
      projectId,
      repository,
      canAsk: await CodeTaskAccess.canAskInRepository({
        props,
        projectId,
        repositoryId,
      }),
    });

    const message: string = CodeTaskRuns.readMessage(body["message"]);
    const context: Array<CodeTaskContextItem> = await CodeTaskAPI.readContext(
      body["context"],
      props,
      projectId,
    );

    const run: AIRun = await CodeTaskRuns.start({
      projectId,
      userId: props.userId!,
      repository,
      message,
      context,
    });

    return { taskId: run.id!.toString() };
  }

  // Reply in a task: the AI continues it, on the same branch.
  private async replyToTask(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const body: JSONObject = (req.body as JSONObject) || {};
    const task: AIRun = await this.getTaskTheCallerMayContinue(
      req,
      props,
      projectId,
    );

    const message: string = CodeTaskRuns.readMessage(body["message"]);
    const context: Array<CodeTaskContextItem> = await CodeTaskAPI.readContext(
      body["context"],
      props,
      projectId,
    );

    const run: AIRun = await CodeTaskRuns.reply({
      projectId,
      userId: props.userId!,
      task,
      message,
      context,
    });

    return { taskId: task.id!.toString(), runId: run.id!.toString() };
  }

  private async retryTask(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const task: AIRun = await this.getTaskTheCallerMayContinue(
      req,
      props,
      projectId,
    );

    const run: AIRun = await CodeTaskRuns.retry({
      projectId,
      userId: props.userId!,
      task,
    });

    return { taskId: task.id!.toString(), runId: run.id!.toString() };
  }

  /*
   * Stop the turn in progress. Whoever may ask AI in the repository may stop
   * it; nothing else of AI is needed to stop work.
   */
  private async stopTask(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const { task, repository } = await this.getReadableTask(
      req,
      props,
      projectId,
    );

    if (
      !repository ||
      !(await CodeTaskAccess.canAskInRepository({
        props,
        projectId,
        repositoryId: repository.id!,
      }))
    ) {
      throw new NotAuthorizedException(CODE_TASK_STOP_REFUSED_MESSAGE);
    }

    const people: Map<string, { name: string }> =
      await CodeTaskThread.getPeople([props.userId!]);

    const stopped: number = await CodeTaskRuns.stop({
      projectId,
      task,
      stoppedByName: people.get(props.userId!.toString())?.name || "",
    });

    return { stopped };
  }

  // The task, when the caller may read it, and its repository.
  private async getReadableTask(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<{ task: AIRun; repository: CodeRepository | null }> {
    const taskId: ObjectID = CodeTaskAPI.readId(req.params["taskId"], "task");

    const task: AIRun | null = await CodeTaskThread.findTask({
      projectId,
      taskId,
    });

    if (!task) {
      throw new NotFoundException(CODE_TASK_NOT_FOUND_MESSAGE);
    }

    if (!task.codeRepositoryId) {
      if (!CodeTaskAccess.mayReadTasksWithoutRepository(props)) {
        throw new NotFoundException(CODE_TASK_NOT_FOUND_MESSAGE);
      }

      return { task, repository: null };
    }

    const repository: CodeRepository | null =
      await CodeTaskAccess.findReadableRepository({
        props,
        projectId,
        repositoryId: task.codeRepositoryId,
      });

    if (!repository) {
      throw new NotFoundException(CODE_TASK_NOT_FOUND_MESSAGE);
    }

    return { task, repository };
  }

  /*
   * The task, when the caller may continue it: read it, ask in its
   * repository, and AI can work there now.
   */
  private async getTaskTheCallerMayContinue(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<AIRun> {
    const { task, repository } = await this.getReadableTask(
      req,
      props,
      projectId,
    );

    if (!repository) {
      throw new BadDataException(
        "This task is not linked to a repository, so AI cannot continue it. Start a new task from a repository in Code.",
      );
    }

    await CodeTaskGate.assertCanStart({
      props,
      projectId,
      repository,
      canAsk: await CodeTaskAccess.canAskInRepository({
        props,
        projectId,
        repositoryId: repository.id!,
      }),
    });

    return task;
  }

  private static async readContext(
    raw: unknown,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<Array<CodeTaskContextItem>> {
    const inputs: Array<CodeTaskContextInput> =
      CodeTaskContextInputUtil.readList(raw);

    return await CodeTaskContextBuilder.build({ inputs, projectId, props });
  }

  public static toRepositoryJSON(
    repository: CodeRepository,
    isConnected: boolean,
  ): CodeTaskRepositoryJSON {
    const json: CodeTaskRepositoryJSON = {
      id: repository.id!.toString(),
      name: repository.name || "",
      isConnected,
    };

    if (repository.description) {
      json.description = repository.description;
    }

    if (repository.organizationName) {
      json.organizationName = repository.organizationName;
    }

    if (repository.repositoryName) {
      json.repositoryName = repository.repositoryName;
    }

    if (repository.mainBranchName) {
      json.mainBranchName = repository.mainBranchName;
    }

    if (repository.repositoryUrl) {
      json.repositoryUrl = repository.repositoryUrl.toString();
    }

    return json;
  }

  private static readId(raw: unknown, what: string): ObjectID {
    if (typeof raw !== "string" || !ObjectID.isValidUUID(raw)) {
      throw new BadDataException(`A valid ${what} ID is required.`);
    }

    return new ObjectID(raw);
  }

  private static readNumber(
    raw: unknown,
    options: { defaultValue: number; min: number; max: number },
  ): number {
    const value: number =
      typeof raw === "number" && Number.isFinite(raw)
        ? Math.floor(raw)
        : options.defaultValue;

    return Math.min(options.max, Math.max(options.min, value));
  }
}
