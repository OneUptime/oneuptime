import {
  CodeRepositoryTaskStatsJSON,
  CodeTaskBlocker,
  CodeTaskContextInput,
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

  // A repository's tasks, or (repositoryId null) the tasks with none.
  public static async listTasks(data: {
    repositoryId: string | null;
    skip: number;
    limit: number;
  }): Promise<CodeTaskListResponse> {
    const response: JSONObject = await CodeApi.post("/list", {
      ...(data.repositoryId
        ? { repositoryId: data.repositoryId }
        : { withoutRepository: true }),
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

  // Ask AI something in a repository. Answers with the new task's id.
  public static async createTask(data: {
    repositoryId: string;
    message: string;
    context: Array<CodeTaskContextInput>;
  }): Promise<string> {
    const response: JSONObject = await CodeApi.post("/create", {
      repositoryId: data.repositoryId,
      message: data.message,
      context: data.context as unknown as Array<JSONObject>,
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
