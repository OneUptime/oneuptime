import {
  CodeRepositoryBranchesJSON,
  CodeRepositoryTaskStatsJSON,
  CodeTaskBlocker,
  CodeTaskContextInput,
  CodeTaskListKind,
  CodeTaskRepositoryJSON,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
} from "Common/Types/AI/CodeTask";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Code pages' one door to the server: /code-task (Common/Server/API/
 * CodeTaskAPI). React-free, so tests and the offline fixture can stand in
 * for it, and every page reads the same shapes (Types/AI/CodeTask).
 */

export interface CodeRepositoryListItem extends CodeTaskRepositoryJSON {
  stats: CodeRepositoryTaskStatsJSON;
}

export interface CodeRepositoriesResponse {
  repositories: Array<CodeRepositoryListItem>;
  tasksWithoutRepositoryCount: number;
}

export interface CodeRepositoryResponse {
  repository: CodeTaskRepositoryJSON;
  stats: CodeRepositoryTaskStatsJSON;
  canAsk: boolean;
  blocker: CodeTaskBlocker | null;
}

export interface CodeTaskListResponse {
  tasks: Array<CodeTaskSummaryJSON>;
  count: number;
  skip: number;
  limit: number;
}

export interface CodeTaskResponse {
  task: CodeTaskSummaryJSON;
  turns: Array<CodeTaskTurnJSON>;
  repository: CodeTaskRepositoryJSON | null;
  canAsk: boolean;
  canSeeChanges: boolean;
  canReadLogContent: boolean;
  blocker: CodeTaskBlocker | null;
}

export const CODE_TASK_API_PATH: string = "/code-task";

/*
 * Which tasks a list reads: one repository's, the ones with no repository,
 * or every task the reader may read (Code's first page).
 */
export type CodeTaskListScope =
  | { repositoryId: string }
  | { withoutRepository: true }
  | { allRepositories: true };

// The body /code-task/list reads for a scope.
export const getTaskListScopeBody: (scope: CodeTaskListScope) => JSONObject = (
  scope: CodeTaskListScope,
): JSONObject => {
  if ("repositoryId" in scope) {
    return { repositoryId: scope.repositoryId };
  }

  if ("allRepositories" in scope) {
    return { allRepositories: true };
  }

  return { withoutRepository: true };
};

export default class CodeApi {
  public static async getRepositories(): Promise<CodeRepositoriesResponse> {
    const data: JSONObject = await CodeApi.post("/repositories", {});

    return {
      repositories: ((data[
        "repositories"
      ] as unknown as Array<CodeRepositoryListItem>) ||
        []) as Array<CodeRepositoryListItem>,
      tasksWithoutRepositoryCount:
        (data["tasksWithoutRepositoryCount"] as number) || 0,
    };
  }

  public static async getRepository(
    repositoryId: string,
  ): Promise<CodeRepositoryResponse> {
    const data: JSONObject = await CodeApi.post(
      `/repository/${repositoryId}`,
      {},
    );

    return {
      repository: data["repository"] as unknown as CodeTaskRepositoryJSON,
      stats: data["stats"] as unknown as CodeRepositoryTaskStatsJSON,
      canAsk: data["canAsk"] === true,
      blocker: (data["blocker"] as unknown as CodeTaskBlocker | null) || null,
    };
  }

  /*
   * A repository's tasks, the tasks with none, or every task the reader may
   * read - newest first. With `kind` ProductionReviews, the production
   * reviews of a repository's pull requests instead: the tasks leave them
   * out.
   */
  public static async listTasks(data: {
    scope: CodeTaskListScope;
    skip: number;
    limit: number;
    kind?: CodeTaskListKind | undefined;
  }): Promise<CodeTaskListResponse> {
    const response: JSONObject = await CodeApi.post("/list", {
      ...getTaskListScopeBody(data.scope),
      ...(data.kind && data.kind !== CodeTaskListKind.Tasks
        ? { kind: data.kind }
        : {}),
      skip: data.skip,
      limit: data.limit,
    });

    return {
      tasks: (response["tasks"] as unknown as Array<CodeTaskSummaryJSON>) || [],
      // The server says "totalCount" (see CodeTaskAPI.listTasks).
      count: (response["totalCount"] as number) || 0,
      skip: (response["skip"] as number) || 0,
      limit: (response["limit"] as number) || data.limit,
    };
  }

  public static async getTask(taskId: string): Promise<CodeTaskResponse> {
    const data: JSONObject = await CodeApi.post(`/get/${taskId}`, {});

    return {
      task: data["task"] as unknown as CodeTaskSummaryJSON,
      turns: (data["turns"] as unknown as Array<CodeTaskTurnJSON>) || [],
      repository:
        (data["repository"] as unknown as CodeTaskRepositoryJSON | null) ||
        null,
      canAsk: data["canAsk"] === true,
      canSeeChanges: data["canSeeChanges"] === true,
      canReadLogContent: data["canReadLogContent"] === true,
      blocker: (data["blocker"] as unknown as CodeTaskBlocker | null) || null,
    };
  }

  /*
   * A repository's branches for the branch picker: its main branch first,
   * then what GitHub lists - or, with a search, the branches whose names
   * start with it.
   */
  public static async getBranches(data: {
    repositoryId: string;
    search?: string | undefined;
  }): Promise<CodeRepositoryBranchesJSON> {
    const response: JSONObject = await CodeApi.post(
      `/branches/${data.repositoryId}`,
      data.search ? { search: data.search } : {},
    );

    return {
      branches: Array.isArray(response["branches"])
        ? (response["branches"] as Array<unknown>).filter(
            (name: unknown): name is string => {
              return typeof name === "string" && name.length > 0;
            },
          )
        : [],
      defaultBranch:
        typeof response["defaultBranch"] === "string"
          ? response["defaultBranch"]
          : "",
      isComplete: response["isComplete"] !== false,
    };
  }

  /*
   * Ask AI something in a repository, from the branch picked (none: its
   * main branch). Answers with the new task's id.
   */
  public static async createTask(data: {
    repositoryId: string;
    message: string;
    context: Array<CodeTaskContextInput>;
    branch?: string | undefined;
  }): Promise<string> {
    const response: JSONObject = await CodeApi.post("/create", {
      repositoryId: data.repositoryId,
      message: data.message,
      context: data.context as unknown as Array<JSONObject>,
      ...(data.branch ? { branch: data.branch } : {}),
    });

    return response["taskId"] as string;
  }

  public static async reply(data: {
    taskId: string;
    message: string;
    context: Array<CodeTaskContextInput>;
  }): Promise<void> {
    await CodeApi.post(`/reply/${data.taskId}`, {
      message: data.message,
      context: data.context as unknown as Array<JSONObject>,
    });
  }

  public static async retry(taskId: string): Promise<void> {
    await CodeApi.post(`/retry/${taskId}`, {});
  }

  public static async stop(taskId: string): Promise<void> {
    await CodeApi.post(`/stop/${taskId}`, {});
  }

  // Review a pull request against production again, now.
  public static async reviewAgain(taskId: string): Promise<void> {
    await CodeApi.post(`/review-again/${taskId}`, {});
  }

  /*
   * Review one of a repository's pull requests against production, now,
   * by its number: any of them, one from a fork or anyone else too.
   * Answers with the review's task.
   */
  public static async reviewPullRequest(data: {
    repositoryId: string;
    number: number;
  }): Promise<string> {
    const response: JSONObject = await CodeApi.post(
      `/review-pull-request/${data.repositoryId}`,
      { number: data.number },
    );

    return response["taskId"] as string;
  }

  private static async post(
    path: string,
    data: JSONObject,
  ): Promise<JSONObject> {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          `${CODE_TASK_API_PATH}${path}`,
        ),
        data: data,
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return (response.data as JSONObject) || {};
  }
}
