import {
  buildPendingTaskRequest,
  buildTaskOutcomeReport,
  executeTask,
  PendingTask,
  TaskOutcome,
} from "../../Jobs/PollCodeFixWork";
import * as TaskHandlerIndex from "../../TaskHandlers/Index";
import CodeRequestTaskHandler from "../../TaskHandlers/CodeRequestTaskHandler";
import FixExceptionTaskHandler from "../../TaskHandlers/FixExceptionTaskHandler";
import {
  TaskHandler,
  TaskResult,
} from "../../TaskHandlers/TaskHandlerInterface";
import TaskHandlerRegistry from "../../TaskHandlers/TaskHandlerRegistry";
import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import {
  CodeTaskFileStatus,
  CodeTaskOutcomeReport,
} from "Common/Types/AI/CodeTask";
import { JSONObject } from "Common/Types/JSON";

/*
 * The Runner's half of Code's protocol:
 *
 *  - asking for work, it names the recipes it has handlers for, so the
 *    server hands it a request from Code only when it can carry one out;
 *  - finishing a request, it reports what the turn ended with (the reply,
 *    the files, the diff, a question) with its Completed status.
 */

jest.mock("../../Utils/TaskLogger");
jest.mock("../../Utils/BackendAPI");

const task: PendingTask = {
  id: "6690e1f1e1f1e1f1e1f1e1f1",
  projectId: "6690e2f2e2f2e2f2e2f2e2f2",
  taskType: CodeFixTaskType.CodeRequest,
};

const OUTCOME: CodeTaskOutcomeReport = {
  summary: "Added a retry.",
  needsInput: false,
  filesChanged: [
    {
      path: "src/users.ts",
      status: CodeTaskFileStatus.Modified,
      additions: 3,
      deletions: 1,
    },
  ],
  branchName: "oneuptime-task-42-5e1f4b3a",
  pullRequestNumber: 7,
  pullRequestUrl: "https://github.com/acme/users-api/pull/7",
  openedPullRequest: true,
};

function stubHandlerReturning(result: TaskResult): void {
  const handler: TaskHandler = {
    taskType: CodeFixTaskType.CodeRequest,
    name: "Stub Handler",
    execute: jest.fn().mockResolvedValue(result),
    canHandle: (): boolean => {
      return true;
    },
  };

  jest.spyOn(TaskHandlerIndex, "getTaskHandlerRegistry").mockReturnValue({
    getHandler: (): TaskHandler => {
      return handler;
    },
  } as unknown as TaskHandlerRegistry);
}

afterEach(() => {
  jest.restoreAllMocks();
  TaskHandlerRegistry.resetInstance();
});

describe("asking for work", () => {
  test("names the recipes this Runner has handlers for - a request from Code among them", () => {
    const registry: TaskHandlerRegistry = TaskHandlerRegistry.getInstance();
    registry.register(new FixExceptionTaskHandler());
    registry.register(new CodeRequestTaskHandler());

    jest
      .spyOn(TaskHandlerIndex, "getTaskHandlerRegistry")
      .mockReturnValue(registry);

    const request: JSONObject = buildPendingTaskRequest();

    expect(request).toEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      supportedTaskTypes: [
        CodeFixTaskType.FixException,
        CodeFixTaskType.CodeRequest,
      ],
    });
  });

  test("a Runner without the request handler does not claim to have it", () => {
    const registry: TaskHandlerRegistry = TaskHandlerRegistry.getInstance();
    registry.register(new FixExceptionTaskHandler());

    jest
      .spyOn(TaskHandlerIndex, "getTaskHandlerRegistry")
      .mockReturnValue(registry);

    expect(buildPendingTaskRequest()["supportedTaskTypes"]).toEqual([
      CodeFixTaskType.FixException,
    ]);
  });
});

describe("finishing a request", () => {
  test("what the turn ended with goes with its Completed status", async () => {
    stubHandlerReturning({
      success: true,
      message: "Opened pull request #7",
      pullRequestsCreated: 1,
      pullRequestUrls: [OUTCOME.pullRequestUrl!],
      outcome: OUTCOME,
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome).toStrictEqual({
      status: AIAgentTaskStatus.Completed,
      outcome: OUTCOME,
      pullRequestUrls: [OUTCOME.pullRequestUrl],
    });

    expect(buildTaskOutcomeReport({ taskId: task.id, outcome })).toStrictEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      taskId: task.id,
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OUTCOME.pullRequestUrl],
      outcome: OUTCOME as unknown as JSONObject,
    });
  });

  test("an answer that changed nothing is still Completed, never NoFixFound", async () => {
    stubHandlerReturning({
      success: true,
      message: "Replied without changing any files.",
      pullRequestsCreated: 0,
      outcome: {
        summary: "It is in src/users.ts.",
        needsInput: false,
        filesChanged: [],
      },
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome.status).toBe(AIAgentTaskStatus.Completed);
    expect(outcome.outcome?.summary).toBe("It is in src/users.ts.");
  });

  test("a task with no outcome reports exactly what it always did", () => {
    expect(
      buildTaskOutcomeReport({
        taskId: task.id,
        outcome: { status: AIAgentTaskStatus.Completed },
      }),
    ).toStrictEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      taskId: task.id,
      status: AIAgentTaskStatus.Completed,
    });
  });
});
