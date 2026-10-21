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
  CODE_TASK_ASK_REFUSED_MESSAGE,
  CODE_TASK_NOT_FOUND_MESSAGE,
} from "../Utils/AI/CodeTask/CodeTaskAccess";
import CodeTaskContextBuilder from "../Utils/AI/CodeTask/CodeTaskContextBuilder";
import CodeTaskGate, {
  CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE,
} from "../Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskPresenter from "../Utils/AI/CodeTask/CodeTaskPresenter";
import CodeTaskRuns from "../Utils/AI/CodeTask/CodeTaskRuns";
import CodeTaskStats from "../Utils/AI/CodeTask/CodeTaskStats";
import SourceLocator, {
  MAX_FRAMES_LOCATED,
  SourceFrame,
  SourceLink,
} from "../Utils/CodeRepository/SourceLocator";
import CodeTaskThread, {
  CODE_TASK_TURN_SELECT,
} from "../Utils/AI/CodeTask/CodeTaskThread";
import GitHubUtil, {
  GitHubBranchInfo,
} from "../Utils/CodeRepository/GitHub/GitHub";
import logger from "../Utils/Logger";
import AIRun from "../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../Models/DatabaseModels/CodeRepository";
import AIRunType from "../../Types/AI/AIRunType";
import {
  CODE_TASK_LIMITS,
  CodeRepositoryBranchesJSON,
  CodeRepositoryTaskStatsJSON,
  CodeTaskBlocker,
  CodeTaskBranchName,
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
 *                                         (or the tasks with no repository,
 *                                         or every task the caller may read)
 *   POST /code-task/branches/:id          a repository's branches, for the
 *                                         branch a task starts from
 *   POST /code-task/get/:taskId           a task's conversation
 *   POST /code-task/create                ask AI something in a repository
 *   POST /code-task/reply/:taskId         reply in a task: its next turn
 *   POST /code-task/retry/:taskId         ask a failed turn again
 *   POST /code-task/stop/:taskId          stop the turn in progress
 *   POST /code-task/source-links          where running code's files live in
 *                                         the repositories, with links
 *
 * Every route acts as a signed-in person (a project API key is refused) in
 * the project of the request. Who may read and who may ask is the
 * repository's to decide (CodeTaskAccess); whether AI may work at all -
 * the plan, the project's AI switch, credits, limits, a Runner - is
 * CodeTaskGate's, asked again by every route that starts work.
 */

export const CODE_TASK_STOP_REFUSED_MESSAGE: string =
  "Stopping AI takes permission to edit this task's repository - ask a project admin for it.";

export const CODE_TASK_BRANCHES_UNREADABLE_MESSAGE: string =
  "OneUptime could not read this repository's branches from GitHub. Try again in a moment.";

export const CODE_TASK_BRANCH_NOT_FOUND_MESSAGE: string =
  "That branch is not in the repository on GitHub any more. Pick another branch.";

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
    this.route("/code-task/branches/:repositoryId", this.listBranches);
    this.route("/code-task/get/:taskId", this.getTask);
    this.route("/code-task/create", this.createTask);
    this.route("/code-task/reply/:taskId", this.replyToTask);
    this.route("/code-task/retry/:taskId", this.retryTask);
    this.route("/code-task/stop/:taskId", this.stopTask);
    this.route("/code-task/source-links", this.getSourceLinks);
  }

  /*
   * Where the files of running code live in the project's repositories:
   * for each frame (a file and a line, as a profile or a stack trace names
   * it), the repository and path that hold it, and a link to the line -
   * only in repositories the caller may read and the GitHub App can reach
   * (SourceLocator). Frames no repository holds for certain get no link.
   * Body: { frames: [{ fileName, lineNumber }] }.
   */
  private async getSourceLinks(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
    projectId: ObjectID,
  ): Promise<JSONObject> {
    const body: JSONObject = (req.body as JSONObject) || {};
    const rawFrames: unknown = body["frames"];

    if (!Array.isArray(rawFrames)) {
      throw new BadDataException("frames must be a list.");
    }

    const frames: Array<SourceFrame> = [];

    for (const raw of rawFrames.slice(0, MAX_FRAMES_LOCATED)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        continue;
      }

      const frame: JSONObject = raw as JSONObject;
      const fileName: unknown = frame["fileName"];

      if (
        typeof fileName !== "string" ||
        fileName.length === 0 ||
        fileName.length > 1000
      ) {
        continue;
      }

      const lineNumber: number = Number(frame["lineNumber"]);

      frames.push({
        fileName,
        lineNumber:
          Number.isFinite(lineNumber) && lineNumber > 0
            ? Math.floor(lineNumber)
            : 0,
      });
    }

    const links: Array<SourceLink> =
      frames.length > 0
        ? await SourceLocator.locate({ projectId, props, frames })
        : [];

    return {
      links: links as unknown as Array<JSONObject>,
    };
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
    const allRepositories: boolean = body["allRepositories"] === true;

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

    let codeRepositoryQuery: unknown = QueryHelper.isNull();

    if (allRepositories) {
      /*
       * Code's first page: every task in a repository the caller may read -
       * labels and all, as each repository's own list - and, for those who
       * may read AI runs, the tasks that have no repository.
       */
      const repositoryIds: Array<ObjectID> = (
        await CodeTaskAccess.listReadableRepositories({ props, projectId })
      ).map((repository: CodeRepository): ObjectID => {
        return repository.id!;
      });

      if (CodeTaskAccess.mayReadTasksWithoutRepository(props)) {
        codeRepositoryQuery = QueryHelper.inOrNull(repositoryIds);
      } else if (repositoryIds.length > 0) {
        codeRepositoryQuery = QueryHelper.any(repositoryIds);
      } else {
        return { tasks: [], totalCount: 0, skip, limit };
      }
    } else if (withoutRepository) {
      if (!CodeTaskAccess.mayReadTasksWithoutRepository(props)) {
        throw new NotFoundException(CODE_TASK_NOT_FOUND_MESSAGE);
      }
    } else {
      const repositoryId: ObjectID = CodeTaskAPI.readId(
        body["repositoryId"],
        "repository",
      );

      await CodeTaskAccess.getReadableRepository({
        props,
        projectId,
        repositoryId,
      });

      codeRepositoryQuery = repositoryId;
    }

    const query: JSONObject = {
      projectId: projectId,
      runType: AIRunType.CodeFix,
      codeTaskId: QueryHelper.isNull(),
      codeRepositoryId: codeRepositoryQuery,
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
      await CodeTaskPresenter.summarize({ projectId, tasks, props });

    /*
     * "totalCount", not "count": a body holding count, skip and limit
     * together reads as a list envelope to the Dashboard's HTTPResponse,
     * which then looks for the rows under "data" and finds none.
     */
    return {
      tasks: summaries as unknown as Array<JSONObject>,
      totalCount: count.toNumber(),
      skip,
      limit,
    };
  }

  /*
   * A repository's branches, for the person picking the branch a task
   * starts from: its main branch first, then the branches GitHub lists -
   * or, with `search`, those whose names start with it. Only for those who
   * may ask AI in the repository, and only where the GitHub App reaches it.
   * Body: { search?: string }.
   */
  private async listBranches(
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

    if (
      !(await CodeTaskAccess.canAskInRepository({
        props,
        projectId,
        repositoryId,
      }))
    ) {
      throw new NotAuthorizedException(CODE_TASK_ASK_REFUSED_MESSAGE);
    }

    const search: string = CodeTaskAPI.readBranchSearch(
      ((req.body as JSONObject) || {})["search"],
    );

    const installationId: string | null =
      await CodeTaskGate.getReachableInstallationId({
        projectId,
        repositoryId,
      });

    if (!installationId) {
      throw new BadDataException(CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE);
    }

    let listed: { names: Array<string>; isComplete: boolean };

    try {
      listed = await GitHubUtil.listBranchNames({
        installationId,
        organizationName: repository.organizationName || "",
        repositoryName: repository.repositoryName || "",
        search,
        limit: CODE_TASK_LIMITS.maxListedBranches,
      });
    } catch (error) {
      logger.error(error);
      throw new BadDataException(CODE_TASK_BRANCHES_UNREADABLE_MESSAGE);
    }

    const defaultBranch: string = repository.mainBranchName || "";

    /*
     * The main branch first - where a task starts unless the person picks
     * another - when it is one of the branches asked for. A search that the
     * main branch's name starts with lists it too.
     */
    const branches: Array<string> = listed.names.filter(
      (name: string): boolean => {
        return name !== defaultBranch && CodeTaskBranchName.isValid(name);
      },
    );

    if (defaultBranch && (!search || defaultBranch.startsWith(search))) {
      branches.unshift(defaultBranch);
    }

    const answer: CodeRepositoryBranchesJSON = {
      branches,
      defaultBranch,
      isComplete: listed.isComplete,
    };

    return answer as unknown as JSONObject;
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
        props,
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
    const pickedBranch: string | null = CodeTaskBranchName.read(body["branch"]);
    const context: Array<CodeTaskContextItem> = await CodeTaskAPI.readContext(
      body["context"],
      props,
      projectId,
    );

    /*
     * The branch the task starts from, when the person picked one other
     * than the repository's main branch (where a task starts anyway): it
     * must be on GitHub now, or the Runner would start from another.
     */
    const baseBranch: string | null =
      pickedBranch && pickedBranch !== repository.mainBranchName
        ? pickedBranch
        : null;

    if (baseBranch) {
      await CodeTaskAPI.assertBranchExists({
        projectId,
        repository,
        branchName: baseBranch,
      });
    }

    const run: AIRun = await CodeTaskRuns.start({
      projectId,
      userId: props.userId!,
      repository,
      message,
      context,
      baseBranch,
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

  /*
   * What a person typed to find a branch: the start of a branch's name, as
   * git takes one - empty for none. Anything a branch's name cannot start
   * with finds nothing, so it is refused before GitHub is asked.
   */
  private static readBranchSearch(raw: unknown): string {
    if (raw === undefined || raw === null) {
      return "";
    }

    if (typeof raw !== "string") {
      throw new BadDataException("A branch search must be text.");
    }

    const search: string = raw.trim();

    if (!search) {
      return "";
    }

    /*
     * A prefix may end where a whole name could not ("feature/", "v1."),
     * so the name it would start is checked instead.
     */
    if (
      search.length > CODE_TASK_LIMITS.maxBranchNameLength ||
      !CodeTaskBranchName.isValid(`${search}x`)
    ) {
      throw new BadDataException(
        "A branch search can only hold what a branch's name can.",
      );
    }

    return search;
  }

  // The branch is on GitHub now, in the repository AI reaches.
  private static async assertBranchExists(data: {
    projectId: ObjectID;
    repository: CodeRepository;
    branchName: string;
  }): Promise<void> {
    const installationId: string | null =
      await CodeTaskGate.getReachableInstallationId({
        projectId: data.projectId,
        repositoryId: data.repository.id!,
      });

    if (!installationId) {
      throw new BadDataException(CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE);
    }

    let branch: GitHubBranchInfo | null = null;

    try {
      branch = await GitHubUtil.getBranch({
        installationId,
        organizationName: data.repository.organizationName || "",
        repositoryName: data.repository.repositoryName || "",
        branchName: data.branchName,
      });
    } catch (error) {
      logger.error(error);
      throw new BadDataException(CODE_TASK_BRANCHES_UNREADABLE_MESSAGE);
    }

    if (!branch) {
      throw new BadDataException(CODE_TASK_BRANCH_NOT_FOUND_MESSAGE);
    }
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
