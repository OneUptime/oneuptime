import {
  CodeRepositoryBranchesJSON,
  CodeRepositoryTaskStatsJSON,
  CodeTaskBlocker,
  CodeTaskContextInput,
  CodeTaskLinkedTurnJSON,
  CodeTaskListCountsJSON,
  CodeTaskListFilter,
  CodeTaskListKind,
  CodeTaskRepositoryJSON,
  CodeTaskStepJSON,
  CodeTaskSummaryJSON,
  CodeTaskTurnJSON,
  CodeTaskTurnProgressJSON,
  CodeTaskTurnsNotShownJSON,
  MAX_CODE_TASKS_PER_REQUEST,
} from "Common/Types/AI/CodeTask";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The Code pages' one door to the server: /code-task (Common/Server/API/
 * CodeTaskAPI). React-free, so tests and the offline fixture can stand in
 * for it, and every page reads the same shapes (Types/AI/CodeTask).
 */

// Ids, without repeats, in the batches the server reads at once.
export function getIdBatches(ids: Array<string>): Array<Array<string>> {
  const unique: Array<string> = [...new Set(ids)];
  const batches: Array<Array<string>> = [];

  for (
    let start: number = 0;
    start < unique.length;
    start += MAX_CODE_TASKS_PER_REQUEST
  ) {
    batches.push(unique.slice(start, start + MAX_CODE_TASKS_PER_REQUEST));
  }

  return batches;
}

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
  // How many tasks each filter shows, when they were asked for.
  counts?: CodeTaskListCountsJSON | undefined;
}

// What a Retry of several tasks did: how many went, and why the rest did not.
export interface CodeTaskRetryManyResponse {
  retried: number;
  failed: Array<{ taskId: string; message: string }>;
}

export interface CodeTaskResponse {
  task: CodeTaskSummaryJSON;
  // Its first turn, then its newest, oldest first.
  turns: Array<CodeTaskTurnJSON>;
  repository: CodeTaskRepositoryJSON | null;
  canAsk: boolean;
  canSeeChanges: boolean;
  canReadLogContent: boolean;
  blocker: CodeTaskBlocker | null;
  /*
   * A task with more turns than its page shows (a conversation reads at
   * most 200): how many between its first turn and its newest are not
   * shown, and how long AI worked on them. None for a task shown whole.
   */
  turnsNotShown?: CodeTaskTurnsNotShownJSON | null | undefined;
  /*
   * The turn the read asked for (getTask's `turn`), when it is one of the
   * task's turns the page does not show: its place in the task, and the
   * turn. None for any other - a turn shown is in `turns`, and a run that
   * is not the task's is never sent.
   */
  linkedTurn?: CodeTaskLinkedTurnJSON | null | undefined;
}

/*
 * The turns a task's page is told it does not show: a whole count of one or
 * more, and how long AI worked on them (none or nonsense: nothing). Null
 * for anything else - a task shown whole.
 */
export const parseTurnsNotShown: (
  value: unknown,
) => CodeTaskTurnsNotShownJSON | null = (
  value: unknown,
): CodeTaskTurnsNotShownJSON | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const count: unknown = (value as JSONObject)["count"];

  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    return null;
  }

  const workMilliseconds: unknown = (value as JSONObject)["workMilliseconds"];

  return {
    count,
    workMilliseconds:
      typeof workMilliseconds === "number" &&
      Number.isFinite(workMilliseconds) &&
      workMilliseconds > 0
        ? workMilliseconds
        : 0,
  };
};

/*
 * The turn not shown a task's read asked for: a place after the first turn
 * (a whole number from 2), and a turn named by a run id. Null for anything
 * else.
 */
export const parseLinkedTurn: (
  value: unknown,
) => CodeTaskLinkedTurnJSON | null = (
  value: unknown,
): CodeTaskLinkedTurnJSON | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const number: unknown = (value as JSONObject)["number"];
  const turn: unknown = (value as JSONObject)["turn"];

  if (typeof number !== "number" || !Number.isInteger(number) || number < 2) {
    return null;
  }

  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    return null;
  }

  const runId: unknown = (turn as JSONObject)["runId"];

  if (typeof runId !== "string" || !ObjectID.isValidUUID(runId)) {
    return null;
  }

  return { number, turn: turn as unknown as CodeTaskTurnJSON };
};

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
    // Only the tasks of one filter (in progress, failed, ...).
    filter?: CodeTaskListFilter | undefined;
    // Only the tasks whose title has it, or whose number it is.
    search?: string | undefined;
    // Also how many tasks each filter shows, for the list's tabs.
    withCounts?: boolean | undefined;
  }): Promise<CodeTaskListResponse> {
    const response: JSONObject = await CodeApi.post("/list", {
      ...getTaskListScopeBody(data.scope),
      ...(data.kind && data.kind !== CodeTaskListKind.Tasks
        ? { kind: data.kind }
        : {}),
      ...(data.filter && data.filter !== CodeTaskListFilter.All
        ? { filter: data.filter }
        : {}),
      ...(data.search ? { search: data.search } : {}),
      ...(data.withCounts ? { withCounts: true } : {}),
      skip: data.skip,
      limit: data.limit,
    });

    const counts: unknown = response["counts"];

    return {
      tasks: (response["tasks"] as unknown as Array<CodeTaskSummaryJSON>) || [],
      // The server says "totalCount" (see CodeTaskAPI.listTasks).
      count: (response["totalCount"] as number) || 0,
      skip: (response["skip"] as number) || 0,
      limit: (response["limit"] as number) || data.limit,
      ...(counts && typeof counts === "object"
        ? { counts: counts as CodeTaskListCountsJSON }
        : {}),
    };
  }

  /*
   * Several tasks at a glance, by id: an insight's fix task. Only those the
   * reader may read come back. The server reads so many ids a request
   * (MAX_CODE_TASKS_PER_REQUEST), so a longer list goes in several.
   */
  public static async getTaskSummaries(
    taskIds: Array<string>,
  ): Promise<Array<CodeTaskSummaryJSON>> {
    const answers: Array<JSONObject> = await Promise.all(
      getIdBatches(taskIds).map((batch: Array<string>) => {
        return CodeApi.post("/summaries", { taskIds: batch });
      }),
    );

    return answers.flatMap(
      (response: JSONObject): Array<CodeTaskSummaryJSON> => {
        return Array.isArray(response["tasks"])
          ? (response["tasks"] as unknown as Array<CodeTaskSummaryJSON>)
          : [];
      },
    );
  }

  /*
   * Ask the failed or stopped turns of several tasks again at once, so many
   * a request, one request after another.
   */
  public static async retryMany(
    taskIds: Array<string>,
  ): Promise<CodeTaskRetryManyResponse> {
    const result: CodeTaskRetryManyResponse = { retried: 0, failed: [] };

    for (const batch of getIdBatches(taskIds)) {
      const response: JSONObject = await CodeApi.post("/retry-many", {
        taskIds: batch,
      });

      result.retried += Number(response["retried"]) || 0;

      if (Array.isArray(response["failed"])) {
        result.failed.push(
          ...(response["failed"] as unknown as Array<{
            taskId: string;
            message: string;
          }>),
        );
      }
    }

    return result;
  }

  /*
   * A task's conversation. `turn` names a turn a link points at (the Log
   * page's address): when the conversation does not show it, it comes
   * back as linkedTurn - if it is one of the task's.
   */
  public static async getTask(
    taskId: string,
    options: { turn?: string | undefined } = {},
  ): Promise<CodeTaskResponse> {
    const data: JSONObject = await CodeApi.post(
      `/get/${taskId}`,
      options.turn ? { turn: options.turn } : {},
    );

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
      turnsNotShown: parseTurnsNotShown(data["turnsNotShown"]),
      linkedTurn: parseLinkedTurn(data["linkedTurn"]),
    };
  }

  /*
   * How a turn AI is working on stands now, and the steps it took after
   * the last one the page shows (afterSequence; -1 for none): what a
   * task's conversation reads as each step happens (CodeTaskLive).
   */
  public static async getTurnProgress(data: {
    taskId: string;
    runId: string;
    afterSequence: number;
  }): Promise<CodeTaskTurnProgressJSON> {
    const response: JSONObject = await CodeApi.post(
      `/progress/${data.taskId}`,
      { runId: data.runId, afterSequence: data.afterSequence },
    );

    return {
      runId: (response["runId"] as string) || data.runId,
      status: (response["status"] as string) || "",
      state: response["state"] as CodeTaskTurnProgressJSON["state"],
      isQueued: response["isQueued"] === true,
      ...(typeof response["startedAt"] === "string"
        ? { startedAt: response["startedAt"] }
        : {}),
      steps: Array.isArray(response["steps"])
        ? (response["steps"] as unknown as Array<CodeTaskStepJSON>)
        : [],
      hasMore: response["hasMore"] === true,
      ...(response["retry"] && typeof response["retry"] === "object"
        ? {
            retry: response[
              "retry"
            ] as unknown as CodeTaskTurnProgressJSON["retry"],
          }
        : {}),
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
