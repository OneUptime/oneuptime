import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { CodeTaskContextType, CodeTaskState } from "../../../Types/AI/CodeTask";
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
  getTaskListScopeBody,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import { CodeRepositoryBranchesJSON } from "../../../Types/AI/CodeTask";

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

    expect(
      await CodeApi.getBranches({ repositoryId: REPOSITORY_ID }),
    ).toEqual({ branches: [], defaultBranch: "", isComplete: true });
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
    expect(lastCall().url).toBe(apiUrl(`/get/${TASK_ID}`));
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
