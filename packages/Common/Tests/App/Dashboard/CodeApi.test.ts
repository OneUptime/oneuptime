import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import {
  CodeRepositoryBranchesJSON,
  CodeTaskContextType,
  CodeTaskListFilter,
  CodeTaskListKind,
  CodeTaskState,
  CodeTaskTurnProgressJSON,
  MAX_CODE_TASKS_PER_REQUEST,
} from "../../../Types/AI/CodeTask";
import { APP_API_URL } from "../../../UI/Config";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Code pages' one door to the server (Components/Code/CodeApi), with the
 * Dashboard's own response type in the loop: every answer goes through
 * HTTPResponse exactly as the browser's API client builds it from the
 * server's JSON.
 *
 * That is the point of the first test. HTTPResponse reads any body holding
 * count, skip and limit together as a list envelope and looks for its rows
 * under "data" - so /code-task/list, which answered { tasks, count, skip,
 * limit }, threw "array is not iterable" and no repository's tasks ever
 * loaded. The server answers totalCount now (CodeTaskAPI.listTasks); this
 * keeps the two in step.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "project" };
      },
    },
  };
});

import CodeApi, {
  CodeRepositoriesResponse,
  CodeRepositoryResponse,
  CodeTaskListResponse,
  CodeTaskResponse,
  getIdBatches,
  getTaskListScopeBody,
  parseLinkedTurn,
  parseTurnsNotShown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";

const TASK_ID: string = "4c1d2e3f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const REPOSITORY_ID: string = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

// What the API client hands back for a JSON body: an HTTPResponse built from it.
function answer(body: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse(200, body, {});
}

function lastCall(): { url: string; data: JSONObject; headers: JSONObject } {
  const call: Array<unknown> = postMock.mock.calls[
    postMock.mock.calls.length - 1
  ] as Array<unknown>;
  const options: {
    url: { toString: () => string };
    data: JSONObject;
    headers: JSONObject;
  } = call[0] as {
    url: { toString: () => string };
    data: JSONObject;
    headers: JSONObject;
  };

  return {
    url: options.url.toString(),
    data: options.data,
    headers: options.headers,
  };
}

function apiUrl(path: string): string {
  return `${APP_API_URL.toString()}/code-task${path}`;
}

beforeEach(() => {
  postMock.mockReset();
});

describe("a repository's tasks", () => {
  test("load through HTTPResponse: totalCount is not a list envelope", async () => {
    const body: JSONObject = {
      tasks: [
        {
          id: TASK_ID,
          title: "Retry charges",
          recipe: "CodeRequest",
          state: CodeTaskState.Done,
          isQueued: false,
          createdAt: "2026-10-19T10:00:00.000Z",
          lastActivityAt: "2026-10-19T10:05:00.000Z",
          origin: { type: "Request", label: "Ada Lovelace" },
          turnCount: 2,
        },
      ],
      totalCount: 41,
      skip: 0,
      limit: 20,
    };

    // The client really builds this from the body, so nothing is lost on the way.
    const response: HTTPResponse<JSONObject> = answer(body);
    expect(response.data["tasks"]).toHaveLength(1);
    postMock.mockResolvedValue(response as never);

    const list: CodeTaskListResponse = await CodeApi.listTasks({
      scope: { repositoryId: REPOSITORY_ID },
      skip: 0,
      limit: 20,
    });

    expect(list.count).toBe(41);
    expect(
      list.tasks.map((task: { id: string }) => {
        return task.id;
      }),
    ).toEqual([TASK_ID]);
    expect(lastCall().url).toBe(apiUrl("/list"));
    expect(lastCall().data).toEqual({
      repositoryId: REPOSITORY_ID,
      skip: 0,
      limit: 20,
    });
  });

  test("an answer with count, skip and limit side by side would lose its rows - which is why the server never sends one", () => {
    expect(() => {
      return answer({ tasks: [], count: 0, skip: 0, limit: 20 });
    }).toThrow("not iterable");
  });

  test("the tasks with no repository are asked for as such", async () => {
    postMock.mockResolvedValue(
      answer({ tasks: [], totalCount: 0, skip: 20, limit: 20 }) as never,
    );

    const list: CodeTaskListResponse = await CodeApi.listTasks({
      scope: { withoutRepository: true },
      skip: 20,
      limit: 20,
    });

    expect(list).toEqual({ tasks: [], count: 0, skip: 20, limit: 20 });
    expect(lastCall().data).toEqual({
      withoutRepository: true,
      skip: 20,
      limit: 20,
    });
  });

  test("Code's first page asks for every task the reader may read, in one list", async () => {
    postMock.mockResolvedValue(
      answer({ tasks: [], totalCount: 7, skip: 0, limit: 20 }) as never,
    );

    const list: CodeTaskListResponse = await CodeApi.listTasks({
      scope: { allRepositories: true },
      skip: 0,
      limit: 20,
    });

    expect(list.count).toBe(7);
    expect(lastCall().data).toEqual({
      allRepositories: true,
      skip: 0,
      limit: 20,
    });
  });

  /*
   * A repository's pull requests' production reviews are a list of their
   * own (POST /code-task/list with kind productionReviews): the tasks leave
   * them out. Asking for the tasks sends no kind at all, as before.
   */
  test("a repository's production reviews are asked for as such; its tasks send no kind", async () => {
    postMock.mockResolvedValue(
      answer({ tasks: [], totalCount: 3, skip: 0, limit: 20 }) as never,
    );

    const list: CodeTaskListResponse = await CodeApi.listTasks({
      scope: { repositoryId: REPOSITORY_ID },
      skip: 0,
      limit: 20,
      kind: CodeTaskListKind.ProductionReviews,
    });

    expect(list.count).toBe(3);
    expect(lastCall().url).toBe(apiUrl("/list"));
    expect(lastCall().data).toEqual({
      repositoryId: REPOSITORY_ID,
      kind: "productionReviews",
      skip: 0,
      limit: 20,
    });

    for (const kind of [undefined, CodeTaskListKind.Tasks]) {
      await CodeApi.listTasks({
        scope: { repositoryId: REPOSITORY_ID },
        skip: 0,
        limit: 20,
        kind,
      });

      expect(lastCall().data).toEqual({
        repositoryId: REPOSITORY_ID,
        skip: 0,
        limit: 20,
      });
    }
  });

  test("each scope is one body, with nothing of the others", () => {
    expect(getTaskListScopeBody({ repositoryId: REPOSITORY_ID })).toEqual({
      repositoryId: REPOSITORY_ID,
    });
    expect(getTaskListScopeBody({ withoutRepository: true })).toEqual({
      withoutRepository: true,
    });
    expect(getTaskListScopeBody({ allRepositories: true })).toEqual({
      allRepositories: true,
    });
  });
});

describe("a repository's branches", () => {
  test("read for the picker: the main branch first, as the server lists them", async () => {
    postMock.mockResolvedValue(
      answer({
        branches: ["main", "release/2026-10", "fix/timeout"],
        defaultBranch: "main",
        isComplete: true,
      }) as never,
    );

    const listing: CodeRepositoryBranchesJSON = await CodeApi.getBranches({
      repositoryId: REPOSITORY_ID,
    });

    expect(listing).toEqual({
      branches: ["main", "release/2026-10", "fix/timeout"],
      defaultBranch: "main",
      isComplete: true,
    });
    expect(lastCall().url).toBe(apiUrl(`/branches/${REPOSITORY_ID}`));
    // Nothing typed: nothing searched.
    expect(lastCall().data).toEqual({});
  });

  test("searched by what the person typed, when the list was not all of them", async () => {
    postMock.mockResolvedValue(
      answer({
        branches: ["feature/a", "feature/b"],
        defaultBranch: "main",
        isComplete: false,
      }) as never,
    );

    const listing: CodeRepositoryBranchesJSON = await CodeApi.getBranches({
      repositoryId: REPOSITORY_ID,
      search: "feature/",
    });

    expect(listing.isComplete).toBe(false);
    expect(lastCall().data).toEqual({ search: "feature/" });
  });

  test("anything that is not a branch name is dropped; a missing answer reads as none, and complete", async () => {
    postMock.mockResolvedValue(
      answer({
        branches: ["main", "", 7, null, "dev"] as unknown as Array<string>,
      }) as never,
    );

    const listing: CodeRepositoryBranchesJSON = await CodeApi.getBranches({
      repositoryId: REPOSITORY_ID,
    });

    expect(listing).toEqual({
      branches: ["main", "dev"],
      defaultBranch: "",
      isComplete: true,
    });

    postMock.mockResolvedValue(answer({}) as never);

    expect(await CodeApi.getBranches({ repositoryId: REPOSITORY_ID })).toEqual({
      branches: [],
      defaultBranch: "",
      isComplete: true,
    });
  });

  test("a refusal is thrown, for the picker to say it could not read them", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      {
        message:
          "OneUptime could not read this repository's branches from GitHub. Try again in a moment.",
      },
      {},
    );
    postMock.mockResolvedValue(refusal as never);

    await expect(
      CodeApi.getBranches({ repositoryId: REPOSITORY_ID }),
    ).rejects.toBe(refusal);
  });
});

describe("every Code route", () => {
  test("the repositories, with the count of tasks that have none", async () => {
    postMock.mockResolvedValue(
      answer({
        repositories: [
          {
            id: REPOSITORY_ID,
            name: "checkout-api",
            isConnected: true,
            stats: {
              working: 1,
              waitingForYou: 0,
              openPullRequests: 2,
              taskCount: 5,
            },
          },
        ],
        tasksWithoutRepositoryCount: 3,
      }) as never,
    );

    const response: CodeRepositoriesResponse = await CodeApi.getRepositories();

    expect(response.repositories[0]?.stats.openPullRequests).toBe(2);
    expect(response.tasksWithoutRepositoryCount).toBe(3);
    expect(lastCall().url).toBe(apiUrl("/repositories"));
    // The project rides in the tenant header, as every Dashboard call's does.
    expect(lastCall().headers).toEqual({ tenantid: "project" });
  });

  test("a repository: whether the reader can ask, and what stops AI", async () => {
    postMock.mockResolvedValue(
      answer({
        repository: {
          id: REPOSITORY_ID,
          name: "checkout-api",
          isConnected: false,
        },
        stats: {
          working: 0,
          waitingForYou: 0,
          openPullRequests: 0,
          taskCount: 0,
        },
        canAsk: true,
        blocker: {
          type: "RepositoryNotConnected",
          message: "Connect GitHub again from Code.",
        },
      }) as never,
    );

    const response: CodeRepositoryResponse =
      await CodeApi.getRepository(REPOSITORY_ID);

    expect(response.canAsk).toBe(true);
    expect(response.blocker?.type).toBe("RepositoryNotConnected");
    expect(lastCall().url).toBe(apiUrl(`/repository/${REPOSITORY_ID}`));
  });

  test("anything but canAsk: true reads as no", async () => {
    postMock.mockResolvedValue(
      answer({
        repository: { id: REPOSITORY_ID, name: "x", isConnected: true },
        stats: {},
        canAsk: "yes",
      }) as never,
    );

    expect((await CodeApi.getRepository(REPOSITORY_ID)).canAsk).toBe(false);
  });

  test("a task's conversation, with what the reader may do in it", async () => {
    postMock.mockResolvedValue(
      answer({
        task: { id: TASK_ID, title: "Retry charges" },
        turns: [{ runId: TASK_ID, steps: [], pullRequests: [] }],
        repository: null,
        canAsk: false,
        canSeeChanges: false,
        canReadLogContent: true,
        blocker: null,
      }) as never,
    );

    const response: CodeTaskResponse = await CodeApi.getTask(TASK_ID);

    expect(response.turns).toHaveLength(1);
    expect(response.repository).toBeNull();
    expect(response.canReadLogContent).toBe(true);
    // A task shown whole: nothing is left out.
    expect(response.turnsNotShown).toBeNull();
    expect(response.linkedTurn).toBeNull();
    expect(lastCall().url).toBe(apiUrl(`/get/${TASK_ID}`));
    // No turn named: nothing more is asked.
    expect(lastCall().data).toEqual({});
  });

  /*
   * A link to a turn (the Log page's ?turn=): the task is asked for it by
   * name, and a turn its page does not show comes back with its place
   * (issue #7130).
   */
  test("a task read for a turn a link names asks for it, and reads back the turn not shown with its place", async () => {
    const LINKED_RUN_ID: string = "4c1d2e3f-5a6b-4c7d-8e9f-0a1b2c3d4e60";

    postMock.mockResolvedValue(
      answer({
        task: { id: TASK_ID, title: "Retry charges" },
        turns: [{ runId: TASK_ID, steps: [], pullRequests: [] }],
        turnsNotShown: { count: 5, workMilliseconds: 300000 },
        linkedTurn: {
          number: 4,
          turn: { runId: LINKED_RUN_ID, steps: [], pullRequests: [] },
        },
        repository: null,
        canAsk: true,
        canSeeChanges: true,
        canReadLogContent: false,
        blocker: null,
      }) as never,
    );

    const response: CodeTaskResponse = await CodeApi.getTask(TASK_ID, {
      turn: LINKED_RUN_ID,
    });

    expect(lastCall().url).toBe(apiUrl(`/get/${TASK_ID}`));
    expect(lastCall().data).toEqual({ turn: LINKED_RUN_ID });
    expect(response.linkedTurn).toEqual({
      number: 4,
      turn: { runId: LINKED_RUN_ID, steps: [], pullRequests: [] },
    });

    // An empty turn names none.
    await CodeApi.getTask(TASK_ID, { turn: "" });
    expect(lastCall().data).toEqual({});
  });

  test("a linked turn reads as none unless it has a place after the first and a turn named by a run id", () => {
    const turn: JSONObject = {
      runId: "4c1d2e3f-5a6b-4c7d-8e9f-0a1b2c3d4e60",
      steps: [],
      pullRequests: [],
    };

    for (const value of [
      undefined,
      null,
      4,
      "turn",
      [{ number: 4, turn }],
      {},
      { number: 4 },
      { number: 1, turn },
      { number: 0, turn },
      { number: -3, turn },
      { number: 2.5, turn },
      { number: "4", turn },
      { number: Number.NaN, turn },
      { number: 4, turn: null },
      { number: 4, turn: [turn] },
      { number: 4, turn: { ...turn, runId: "turn-4" } },
      { number: 4, turn: { ...turn, runId: 4 } },
    ]) {
      expect(parseLinkedTurn(value)).toBeNull();
    }

    expect(parseLinkedTurn({ number: 2, turn })).toEqual({ number: 2, turn });
    expect(parseLinkedTurn({ number: 10205, turn })).toEqual({
      number: 10205,
      turn,
    });
  });

  test("a long task's conversation says how many turns it does not show, and how long AI worked on them", async () => {
    postMock.mockResolvedValue(
      answer({
        task: { id: TASK_ID, title: "Retry charges" },
        turns: [{ runId: TASK_ID, steps: [], pullRequests: [] }],
        turnsNotShown: { count: 5, workMilliseconds: 300000 },
        repository: null,
        canAsk: true,
        canSeeChanges: true,
        canReadLogContent: false,
        blocker: null,
      }) as never,
    );

    const response: CodeTaskResponse = await CodeApi.getTask(TASK_ID);

    expect(response.turnsNotShown).toEqual({
      count: 5,
      workMilliseconds: 300000,
    });
  });

  test("turns not shown read as none unless they are a whole count of one or more; a work time that is not one reads as none", () => {
    expect(parseTurnsNotShown(undefined)).toBeNull();
    expect(parseTurnsNotShown(null)).toBeNull();
    expect(parseTurnsNotShown(5)).toBeNull();
    expect(parseTurnsNotShown([{ count: 5 }])).toBeNull();
    expect(parseTurnsNotShown({})).toBeNull();
    expect(parseTurnsNotShown({ count: 0, workMilliseconds: 10 })).toBeNull();
    expect(parseTurnsNotShown({ count: -2 })).toBeNull();
    expect(parseTurnsNotShown({ count: 2.5 })).toBeNull();
    expect(parseTurnsNotShown({ count: "5" })).toBeNull();
    expect(parseTurnsNotShown({ count: 1 })).toEqual({
      count: 1,
      workMilliseconds: 0,
    });
    expect(parseTurnsNotShown({ count: 3, workMilliseconds: "60000" })).toEqual(
      { count: 3, workMilliseconds: 0 },
    );
    expect(
      parseTurnsNotShown({ count: 3, workMilliseconds: Number.NaN }),
    ).toEqual({ count: 3, workMilliseconds: 0 });
    expect(parseTurnsNotShown({ count: 3, workMilliseconds: -5 })).toEqual({
      count: 3,
      workMilliseconds: 0,
    });
    expect(parseTurnsNotShown({ count: 205, workMilliseconds: 61000 })).toEqual(
      { count: 205, workMilliseconds: 61000 },
    );
  });

  test("a working turn's progress: the turn and the last step the page has are sent, the steps and the state read back", async () => {
    postMock.mockResolvedValue(
      answer({
        runId: TASK_ID,
        status: "Running",
        state: CodeTaskState.Working,
        isQueued: false,
        startedAt: "2026-11-03T10:00:10.000Z",
        steps: [
          { sequence: 5, kind: "Ran", subject: "npm test", isError: false },
        ],
        hasMore: false,
      }) as never,
    );

    const progress: CodeTaskTurnProgressJSON = await CodeApi.getTurnProgress({
      taskId: TASK_ID,
      runId: TASK_ID,
      afterSequence: 4,
    });

    expect(lastCall().url).toBe(apiUrl(`/progress/${TASK_ID}`));
    expect(lastCall().data).toEqual({ runId: TASK_ID, afterSequence: 4 });
    expect(progress).toEqual({
      runId: TASK_ID,
      status: "Running",
      state: CodeTaskState.Working,
      isQueued: false,
      startedAt: "2026-11-03T10:00:10.000Z",
      steps: [
        { sequence: 5, kind: "Ran", subject: "npm test", isError: false },
      ],
      hasMore: false,
    });
  });

  test("a progress answer missing its parts reads as no steps, not queued, nothing more - and keeps the turn asked about", async () => {
    postMock.mockResolvedValue(
      answer({ state: CodeTaskState.Working, steps: "none" }) as never,
    );

    const progress: CodeTaskTurnProgressJSON = await CodeApi.getTurnProgress({
      taskId: TASK_ID,
      runId: REPOSITORY_ID,
      afterSequence: -1,
    });

    expect(progress.runId).toBe(REPOSITORY_ID);
    expect(progress.steps).toEqual([]);
    expect(progress.isQueued).toBe(false);
    expect(progress.hasMore).toBe(false);
    expect(progress).not.toHaveProperty("startedAt");
  });

  test("asking sends the words and the context as written, and answers the new task's id", async () => {
    postMock.mockResolvedValue(answer({ taskId: TASK_ID }) as never);

    const taskId: string = await CodeApi.createTask({
      repositoryId: REPOSITORY_ID,
      message: "Add retries",
      context: [
        { type: CodeTaskContextType.File, path: "src/payments" },
        { type: CodeTaskContextType.Note, text: "p95 is 1.2 s" },
      ],
    });

    expect(taskId).toBe(TASK_ID);
    expect(lastCall().url).toBe(apiUrl("/create"));
    expect(lastCall().data).toEqual({
      repositoryId: REPOSITORY_ID,
      message: "Add retries",
      context: [
        { type: "File", path: "src/payments" },
        { type: "Note", text: "p95 is 1.2 s" },
      ],
    });
  });

  test("asking from a branch the person picked sends it; none picked sends no branch at all", async () => {
    postMock.mockResolvedValue(answer({ taskId: TASK_ID }) as never);

    await CodeApi.createTask({
      repositoryId: REPOSITORY_ID,
      message: "Add retries",
      context: [],
      branch: "release/2026-10",
    });

    expect(lastCall().data).toEqual({
      repositoryId: REPOSITORY_ID,
      message: "Add retries",
      context: [],
      branch: "release/2026-10",
    });

    await CodeApi.createTask({
      repositoryId: REPOSITORY_ID,
      message: "Add retries",
      context: [],
      branch: undefined,
    });

    expect(lastCall().data).not.toHaveProperty("branch");
  });

  test("reply, retry and stop name the task in the address", async () => {
    postMock.mockResolvedValue(answer({}) as never);

    await CodeApi.reply({ taskId: TASK_ID, message: "Thanks", context: [] });
    expect(lastCall().url).toBe(apiUrl(`/reply/${TASK_ID}`));
    expect(lastCall().data).toEqual({ message: "Thanks", context: [] });

    await CodeApi.retry(TASK_ID);
    expect(lastCall().url).toBe(apiUrl(`/retry/${TASK_ID}`));

    await CodeApi.stop(TASK_ID);
    expect(lastCall().url).toBe(apiUrl(`/stop/${TASK_ID}`));
  });

  test("Review again names the review's task in the address, and sends nothing else", async () => {
    postMock.mockResolvedValue(answer({ taskId: TASK_ID }) as never);

    await CodeApi.reviewAgain(TASK_ID);

    expect(lastCall().url).toBe(apiUrl(`/review-again/${TASK_ID}`));
    expect(lastCall().data).toEqual({});
  });

  test("a refused Review again is thrown, for the page to say why", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      {
        message:
          "Reviewing a pull request again takes permission to edit its repository - ask a project admin for it.",
      },
      {},
    );
    postMock.mockResolvedValue(refusal as never);

    await expect(CodeApi.reviewAgain(TASK_ID)).rejects.toBe(refusal);
  });

  test("a refusal is thrown as the server's answer, for the page to say", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "AI is still working on this task." },
      {},
    );
    postMock.mockResolvedValue(refusal as never);

    await expect(
      CodeApi.reply({ taskId: TASK_ID, message: "More", context: [] }),
    ).rejects.toBe(refusal);
  });
});

describe("a task list's filters, an insight's fix tasks, and trying many again", () => {
  test("a filter, a search and the counts are asked for only when they say something", async () => {
    postMock.mockResolvedValue(
      answer({
        tasks: [],
        totalCount: 2,
        skip: 0,
        limit: 20,
        counts: {
          all: 9,
          inProgress: 2,
          waitingForYou: 1,
          pullRequestOpen: 3,
          failed: 2,
          done: 1,
        },
      }) as never,
    );

    const list: CodeTaskListResponse = await CodeApi.listTasks({
      scope: { repositoryId: REPOSITORY_ID },
      skip: 0,
      limit: 20,
      filter: CodeTaskListFilter.Failed,
      search: "gateway",
      withCounts: true,
    });

    expect(lastCall().data).toEqual({
      repositoryId: REPOSITORY_ID,
      filter: "failed",
      search: "gateway",
      withCounts: true,
      skip: 0,
      limit: 20,
    });
    expect(list.count).toBe(2);
    expect(list.counts).toEqual({
      all: 9,
      inProgress: 2,
      waitingForYou: 1,
      pullRequestOpen: 3,
      failed: 2,
      done: 1,
    });

    // Every task, no search, no counts: nothing more than before.
    await CodeApi.listTasks({
      scope: { repositoryId: REPOSITORY_ID },
      skip: 0,
      limit: 20,
      filter: CodeTaskListFilter.All,
      search: "",
      withCounts: false,
    });

    expect(lastCall().data).toEqual({
      repositoryId: REPOSITORY_ID,
      skip: 0,
      limit: 20,
    });
  });

  test("an answer without counts has none", async () => {
    postMock.mockResolvedValue(
      answer({ tasks: [], totalCount: 0, skip: 0, limit: 20 }) as never,
    );

    const list: CodeTaskListResponse = await CodeApi.listTasks({
      scope: { repositoryId: REPOSITORY_ID },
      skip: 0,
      limit: 20,
    });

    expect(list).not.toHaveProperty("counts");
  });

  test("an insight's fix tasks are read together - nothing asked for none, and a long list in batches the server reads", async () => {
    expect(await CodeApi.getTaskSummaries([])).toEqual([]);
    expect(postMock).not.toHaveBeenCalled();

    const ids: Array<string> = Array.from(
      { length: MAX_CODE_TASKS_PER_REQUEST + 3 },
      (_: unknown, index: number): string => {
        return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
      },
    );

    postMock.mockImplementation(((options: { data: JSONObject }) => {
      return Promise.resolve(
        answer({
          tasks: (options.data["taskIds"] as Array<string>).map(
            (id: string) => {
              return { id };
            },
          ),
        }),
      );
    }) as never);

    // A repeated id is asked for once.
    const tasks: Array<{ id: string }> = await CodeApi.getTaskSummaries([
      ...ids,
      ids[0]!,
    ]);

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(lastCall().url).toBe(apiUrl("/summaries"));
    expect(
      tasks.map((task: { id: string }) => {
        return task.id;
      }),
    ).toEqual(ids);
    expect(
      getIdBatches(ids).map((batch: Array<string>) => {
        return batch.length;
      }),
    ).toEqual([MAX_CODE_TASKS_PER_REQUEST, 3]);
  });

  test("a summaries answer without tasks reads as none", async () => {
    postMock.mockResolvedValue(answer({}) as never);

    expect(await CodeApi.getTaskSummaries([TASK_ID])).toEqual([]);
    expect(lastCall().data).toEqual({ taskIds: [TASK_ID] });
  });

  test("trying many again adds up what each request did, and why some could not be", async () => {
    postMock.mockResolvedValue(
      answer({
        retried: 1,
        failed: [{ taskId: REPOSITORY_ID, message: "AI is still working." }],
      }) as never,
    );

    expect(await CodeApi.retryMany([TASK_ID, REPOSITORY_ID])).toEqual({
      retried: 1,
      failed: [{ taskId: REPOSITORY_ID, message: "AI is still working." }],
    });
    expect(lastCall().url).toBe(apiUrl("/retry-many"));
    expect(lastCall().data).toEqual({ taskIds: [TASK_ID, REPOSITORY_ID] });

    postMock.mockResolvedValue(answer({ retried: "x" }) as never);
    expect(await CodeApi.retryMany([TASK_ID])).toEqual({
      retried: 0,
      failed: [],
    });
  });

  test("a working turn AI tries again by itself says which attempt and when; a broken retry is dropped", async () => {
    const retry: JSONObject = {
      attempt: 2,
      maxAttempts: 3,
      nextAttemptAt: "2026-11-09T10:04:00.000Z",
      kind: "ProviderUnavailable",
    };

    postMock.mockResolvedValue(
      answer({
        runId: TASK_ID,
        status: "Queued",
        state: CodeTaskState.Working,
        isQueued: true,
        steps: [],
        retry,
      }) as never,
    );

    const progress: CodeTaskTurnProgressJSON = await CodeApi.getTurnProgress({
      taskId: TASK_ID,
      runId: TASK_ID,
      afterSequence: -1,
    });

    expect(progress.retry).toEqual(retry);

    postMock.mockResolvedValue(
      answer({
        state: CodeTaskState.Working,
        steps: [],
        retry: "soon",
      }) as never,
    );

    expect(
      await CodeApi.getTurnProgress({
        taskId: TASK_ID,
        runId: TASK_ID,
        afterSequence: -1,
      }),
    ).not.toHaveProperty("retry");
  });
});
