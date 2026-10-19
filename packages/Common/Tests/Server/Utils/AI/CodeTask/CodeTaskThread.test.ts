import AIAgentTaskPullRequestService from "../../../../../Server/Services/AIAgentTaskPullRequestService";
import AIRunService from "../../../../../Server/Services/AIRunService";
import UserService from "../../../../../Server/Services/UserService";
import CodeTaskThread from "../../../../../Server/Utils/AI/CodeTask/CodeTaskThread";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import User from "../../../../../Models/DatabaseModels/User";
import AIRunType from "../../../../../Types/AI/AIRunType";
import { CodeTaskPersonJSON } from "../../../../../Types/AI/CodeTask";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import Email from "../../../../../Types/Email";
import Name from "../../../../../Types/Name";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * A task is its first code-fix run; a reply is a run whose codeTaskId names
 * it. These read a task as the Code pages and the Runner need it: the task
 * behind any of its runs' ids (an old link to a reply still lands on the
 * task), its turns in order, and the one pull request a reply builds on.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "2b7c4e1a-9d3f-4a6b-8c5d-1e2f3a4b5c6d",
);
const REPOSITORY_ID: ObjectID = new ObjectID(
  "3c9d2f1e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const OTHER_REPOSITORY_ID: ObjectID = new ObjectID(
  "4d0e3a2f-6b7c-4d8e-9f0a-1b2c3d4e5f60",
);
const TASK_ID: ObjectID = new ObjectID("5e1f4b3a-7c8d-4e9f-8a0b-2c3d4e5f6a7b");
const REPLY_ID: ObjectID = new ObjectID("6f2a5c4b-8d9e-4f0a-9b1c-3d4e5f6a7b8c");

afterEach(() => {
  jest.restoreAllMocks();
});

function run(id: ObjectID, codeTaskId?: ObjectID): AIRun {
  const value: AIRun = new AIRun();
  value._id = id.toString();
  value.projectId = PROJECT_ID;
  value.runType = AIRunType.CodeFix;
  value.codeRepositoryId = REPOSITORY_ID;
  if (codeTaskId) {
    value.codeTaskId = codeTaskId;
  }
  return value;
}

function pullRequest(data: {
  number: number;
  state?: PullRequestState;
  head?: string;
  repositoryId?: ObjectID;
}): AIAgentTaskPullRequest {
  const value: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
  value.pullRequestNumber = data.number;
  if (data.state) {
    value.pullRequestState = data.state;
  }
  if (data.head !== "") {
    value.headRefName = data.head || `oneuptime-task-${data.number}`;
  }
  value.codeRepositoryId = data.repositoryId || REPOSITORY_ID;
  return value;
}

describe("CodeTaskThread.findTask", () => {
  test("a task's own id reads the task, pinned to the project and to code-fix runs, as root", async () => {
    const find: jest.SpiedFunction<typeof AIRunService.findOneBy> = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(run(TASK_ID));

    const task: AIRun | null = await CodeTaskThread.findTask({
      projectId: PROJECT_ID,
      taskId: TASK_ID,
    });

    expect(task?.id?.toString()).toBe(TASK_ID.toString());
    expect(find).toHaveBeenCalledTimes(1);

    const call: { query: Record<string, unknown>; props: unknown } = find.mock
      .calls[0]![0] as never;

    expect(call.query["_id"]).toBe(TASK_ID.toString());
    expect((call.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(call.query["runType"]).toBe(AIRunType.CodeFix);
    expect(call.props).toEqual({ isRoot: true });
  });

  test("a reply's id leads to its task, one step and no further", async () => {
    const find: jest.SpiedFunction<typeof AIRunService.findOneBy> = jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValueOnce(run(REPLY_ID, TASK_ID))
      .mockResolvedValueOnce(run(TASK_ID));

    const task: AIRun | null = await CodeTaskThread.findTask({
      projectId: PROJECT_ID,
      taskId: REPLY_ID,
    });

    expect(task?.id?.toString()).toBe(TASK_ID.toString());
    expect(find).toHaveBeenCalledTimes(2);

    const second: { query: Record<string, unknown> } = find.mock
      .calls[1]![0] as never;

    expect(second.query["_id"]).toBe(TASK_ID.toString());
    expect((second.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    // The task it leads to must be a first run itself.
    expect(second.query["codeTaskId"]).toBeDefined();
  });

  test("an id of another project, or of no code task, is no task", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);

    expect(
      await CodeTaskThread.findTask({ projectId: PROJECT_ID, taskId: TASK_ID }),
    ).toBeNull();
  });
});

describe("CodeTaskThread.getTurns", () => {
  test("is the task, then its replies oldest first, in the project", async () => {
    const replies: Array<AIRun> = [run(REPLY_ID, TASK_ID)];
    const find: jest.SpiedFunction<typeof AIRunService.findBy> = jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue(replies);

    const task: AIRun = run(TASK_ID);
    const turns: Array<AIRun> = await CodeTaskThread.getTurns({
      projectId: PROJECT_ID,
      task,
    });

    expect(turns).toEqual([task, replies[0]]);

    const call: { query: Record<string, unknown>; sort: unknown } = find.mock
      .calls[0]![0] as never;

    expect((call.query["codeTaskId"] as ObjectID).toString()).toBe(
      TASK_ID.toString(),
    );
    expect((call.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(call.sort).toEqual({ createdAt: "ASC" });
  });
});

describe("CodeTaskThread.getWorkingPullRequest", () => {
  test("a reply builds on the newest open pull request of the task, in its repository", () => {
    const newestOpen: AIAgentTaskPullRequest = pullRequest({
      number: 12,
      state: PullRequestState.Open,
    });

    expect(
      CodeTaskThread.getWorkingPullRequest({
        pullRequests: [
          newestOpen,
          pullRequest({ number: 9, state: PullRequestState.Open }),
        ],
        codeRepositoryId: REPOSITORY_ID,
      }),
    ).toBe(newestOpen);
  });

  test("a merged or closed pull request is not built on: the next change starts a new branch", () => {
    expect(
      CodeTaskThread.getWorkingPullRequest({
        pullRequests: [
          pullRequest({ number: 12, state: PullRequestState.Merged }),
          pullRequest({ number: 9, state: PullRequestState.Closed }),
        ],
        codeRepositoryId: REPOSITORY_ID,
      }),
    ).toBeNull();
  });

  test("an older pull request still open is built on when the newest was merged", () => {
    const stillOpen: AIAgentTaskPullRequest = pullRequest({
      number: 9,
      state: PullRequestState.Open,
    });

    expect(
      CodeTaskThread.getWorkingPullRequest({
        pullRequests: [
          pullRequest({ number: 12, state: PullRequestState.Merged }),
          stillOpen,
        ],
        codeRepositoryId: REPOSITORY_ID,
      }),
    ).toBe(stillOpen);
  });

  test("a record with no state yet reads as open", () => {
    const recorded: AIAgentTaskPullRequest = pullRequest({ number: 4 });

    expect(
      CodeTaskThread.getWorkingPullRequest({
        pullRequests: [recorded],
        codeRepositoryId: REPOSITORY_ID,
      }),
    ).toBe(recorded);
  });

  test("never one of another repository, one without a branch, or for a task with no repository", () => {
    expect(
      CodeTaskThread.getWorkingPullRequest({
        pullRequests: [
          pullRequest({ number: 12, repositoryId: OTHER_REPOSITORY_ID }),
          pullRequest({ number: 11, head: "" }),
        ],
        codeRepositoryId: REPOSITORY_ID,
      }),
    ).toBeNull();

    expect(
      CodeTaskThread.getWorkingPullRequest({
        pullRequests: [pullRequest({ number: 12 })],
        codeRepositoryId: undefined,
      }),
    ).toBeNull();
  });
});

describe("CodeTaskThread.findWorkingPullRequest", () => {
  test("reads the pull requests of every turn of the task", async () => {
    jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([run(REPLY_ID, TASK_ID)]);
    const findPullRequests: jest.SpiedFunction<
      typeof AIAgentTaskPullRequestService.findBy
    > = jest
      .spyOn(AIAgentTaskPullRequestService, "findBy")
      .mockResolvedValue([pullRequest({ number: 3 })]);

    const found: AIAgentTaskPullRequest | null =
      await CodeTaskThread.findWorkingPullRequest({
        projectId: PROJECT_ID,
        task: run(TASK_ID),
      });

    expect(found?.pullRequestNumber).toBe(3);

    const call: { query: Record<string, unknown> } = findPullRequests.mock
      .calls[0]![0] as never;
    // QueryHelper.any is a Raw operator: its ids are its one parameter.
    const runIds: unknown = Object.values(
      (
        call.query["aiRunId"] as {
          objectLiteralParameters: Record<string, unknown>;
        }
      ).objectLiteralParameters,
    )[0];

    expect(runIds).toEqual([TASK_ID.toString(), REPLY_ID.toString()]);
  });
});

describe("CodeTaskThread.getPeople", () => {
  test("names each person once, by name or by email without one", async () => {
    const named: User = new User();
    named._id = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
    named.name = new Name("Jane Doe");

    const unnamed: User = new User();
    unnamed._id = "8b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
    unnamed.email = new Email("sam@example.com");

    const find: jest.SpiedFunction<typeof UserService.findBy> = jest
      .spyOn(UserService, "findBy")
      .mockResolvedValue([named, unnamed]);

    const people: Map<string, CodeTaskPersonJSON> =
      await CodeTaskThread.getPeople([
        new ObjectID(named._id),
        new ObjectID(unnamed._id),
        new ObjectID(named._id),
      ]);

    expect(people.get(named._id)).toEqual({ id: named._id, name: "Jane Doe" });
    expect(people.get(unnamed._id)).toEqual({
      id: unnamed._id,
      name: "sam@example.com",
    });
    expect((find.mock.calls[0]![0] as { limit: number }).limit).toBe(2);
  });

  test("asks nothing for nobody", async () => {
    const find: jest.SpiedFunction<typeof UserService.findBy> = jest.spyOn(
      UserService,
      "findBy",
    );

    expect((await CodeTaskThread.getPeople([])).size).toBe(0);
    expect(find).not.toHaveBeenCalled();
  });
});
