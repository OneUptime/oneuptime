import {
  buildTaskOutcomeReport,
  executeTask,
  PendingTask,
  TaskOutcome,
} from "../../Jobs/PollCodeFixWork";
import * as TaskHandlerIndex from "../../TaskHandlers/Index";
import {
  BaseTaskHandler,
  TaskContext,
  TaskHandler,
  TaskResult,
} from "../../TaskHandlers/TaskHandlerInterface";
import TaskHandlerRegistry from "../../TaskHandlers/TaskHandlerRegistry";
import BackendAPI, { UnrecordedPullRequest } from "../../Utils/BackendAPI";
import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import { JSONObject } from "Common/Types/JSON";

/*
 * executeTask turns a handler's TaskResult into the status the run is
 * reported with. Three outcomes, and the distinction between the last two is
 * the whole point: a task that could not finish throws (the caller reports
 * Error), while a task that finished with nothing to propose returns
 * NoFixFound rather than being lumped in with the failures.
 */

// Both are constructed inside executeTask and would otherwise reach the network.
jest.mock("../../Utils/TaskLogger");
jest.mock("../../Utils/BackendAPI");

const task: PendingTask = {
  id: "6690e1f1e1f1e1f1e1f1e1f1",
  projectId: "6690e2f2e2f2e2f2e2f2e2f2",
  exceptionId: "exception-id",
  taskType: "FixException",
};

const PULL_REQUEST_URL: string = "https://github.com/acme/checkout/pull/77";

// A pull request the task opened, with everything its record carries.
const OPENED_PULL_REQUEST: UnrecordedPullRequest = {
  codeRepositoryId: "6650f0b1a1b2c3d4e5f60718",
  pullRequestUrl: PULL_REQUEST_URL,
  pullRequestNumber: 77,
  pullRequestId: 3456789012,
  title: "fix: retry the checkout call (#42)",
  description: "Closes #42",
  headRefName: "oneuptime/issue-42",
  baseRefName: "main",
  runnerVerificationStatus: "Passed",
  runnerVerificationSummary: "npm test passed",
};

// Register a handler whose execute() returns exactly the result under test.
function stubHandlerReturning(result: TaskResult): void {
  const handler: TaskHandler = {
    taskType: "FixException",
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

describe("executeTask outcome mapping", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a successful task reports Completed", async () => {
    stubHandlerReturning({
      success: true,
      message: "Created 1 pull request(s)",
      pullRequestsCreated: 1,
      data: { pullRequests: ["https://github.com/acme/checkout/pull/1"] },
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome.status).toBe(AIAgentTaskStatus.Completed);
    expect(outcome.statusMessage).toBeUndefined();
  });

  test("a successful task carries the pull requests it opened", async () => {
    stubHandlerReturning({
      success: true,
      message: "Opened pull request #77 for issue #42",
      pullRequestsCreated: 1,
      pullRequestUrls: [PULL_REQUEST_URL],
      data: { pullRequests: [PULL_REQUEST_URL] },
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome).toStrictEqual({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [PULL_REQUEST_URL],
    });
  });

  test("a successful task that opened no pull request carries none", async () => {
    stubHandlerReturning({
      success: true,
      message: "Answered the question in the thread",
      pullRequestUrls: [],
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome).toStrictEqual({ status: AIAgentTaskStatus.Completed });
  });

  test("a no-fix result reports NoFixFound and carries the reason", async () => {
    stubHandlerReturning({
      success: false,
      message: "No fixes could be applied to any repository",
      pullRequestsCreated: 0,
      data: { noFixFound: true },
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome.status).toBe(AIAgentTaskStatus.NoFixFound);
    expect(outcome.statusMessage).toBe(
      "No fixes could be applied to any repository",
    );
  });

  test("an error result throws, so the caller reports Error", async () => {
    stubHandlerReturning({
      success: false,
      message: "Could not resolve a repository for this exception",
      data: { isError: true },
    });

    await expect(executeTask(task)).rejects.toThrow(
      "Could not resolve a repository for this exception",
    );
  });

  /*
   * A failure and a no-fix result are both success: false. Only isError may
   * throw — were the guard to widen to !result.success, every fruitless run
   * would be an Error again, which is the bug this distinction exists to fix.
   */
  test("a no-fix result does not throw despite success being false", async () => {
    stubHandlerReturning({
      success: false,
      message: "No fixes could be applied to any repository",
      data: { noFixFound: true },
    });

    await expect(executeTask(task)).resolves.toEqual(
      expect.objectContaining({ status: AIAgentTaskStatus.NoFixFound }),
    );
  });

  test("an unregistered task type throws", async () => {
    jest.spyOn(TaskHandlerIndex, "getTaskHandlerRegistry").mockReturnValue({
      getHandler: (): undefined => {
        return undefined;
      },
    } as unknown as TaskHandlerRegistry);

    await expect(executeTask(task)).rejects.toThrow(
      "No handler registered for task type: FixException",
    );
  });
});

/*
 * The status report that closes a finished task. A Completed task's pull
 * requests go with it, and every field is sent only when it has a value, so
 * a server that predates pullRequestUrls sees the report it always did.
 */
describe("buildTaskOutcomeReport", () => {
  test("a Completed report carries the pull requests the task opened", () => {
    const report: JSONObject = buildTaskOutcomeReport({
      taskId: task.id,
      outcome: {
        status: AIAgentTaskStatus.Completed,
        pullRequestUrls: [PULL_REQUEST_URL],
      },
    });

    expect(report).toStrictEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      taskId: task.id,
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [PULL_REQUEST_URL],
    });
  });

  test("a Completed task that opened nothing reports exactly what it always did", () => {
    const withoutField: JSONObject = buildTaskOutcomeReport({
      taskId: task.id,
      outcome: { status: AIAgentTaskStatus.Completed },
    });

    const withEmptyField: JSONObject = buildTaskOutcomeReport({
      taskId: task.id,
      outcome: {
        status: AIAgentTaskStatus.Completed,
        pullRequestUrls: [],
        unrecordedPullRequests: [],
      },
    });

    const reportBeforeTheField: JSONObject = {
      ...RunnerAPIRequest.getDefaultRequestBody(),
      taskId: task.id,
      status: AIAgentTaskStatus.Completed,
    };

    expect(withoutField).toStrictEqual(reportBeforeTheField);
    expect(withEmptyField).toStrictEqual(reportBeforeTheField);
  });

  test("a Completed report carries the pull requests the task could not record", () => {
    const report: JSONObject = buildTaskOutcomeReport({
      taskId: task.id,
      outcome: {
        status: AIAgentTaskStatus.Completed,
        pullRequestUrls: [PULL_REQUEST_URL],
        unrecordedPullRequests: [OPENED_PULL_REQUEST],
      },
    });

    expect(report).toStrictEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      taskId: task.id,
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [PULL_REQUEST_URL],
      unrecordedPullRequests: [OPENED_PULL_REQUEST],
    });
  });

  test("a NoFixFound report carries its reason and no pull requests", () => {
    const report: JSONObject = buildTaskOutcomeReport({
      taskId: task.id,
      outcome: {
        status: AIAgentTaskStatus.NoFixFound,
        statusMessage: "No fixes could be applied to any repository",
      },
    });

    expect(report).toStrictEqual({
      ...RunnerAPIRequest.getDefaultRequestBody(),
      taskId: task.id,
      status: AIAgentTaskStatus.NoFixFound,
      statusMessage: "No fixes could be applied to any repository",
    });
  });
});

/*
 * The case the fields exist for. GitHub has opened the pull request, but
 * recording it on the server failed — on test.oneuptime.com, because the
 * column could not hold GitHub's id. The task still succeeds (see
 * BaseTaskHandler.recordOpenedPullRequest), so the pull request has to reach
 * the server with the Completed status: its link, or the thread that asked
 * for it is told no pull request was recorded, and the record the task could
 * not make, or the open-PR cap never counts it and the PR state sync never
 * tracks it.
 */
describe("a pull request that opened but could not be recorded", () => {
  // Opens each pull request it is given, and records it as a handler does.
  class OpensPullRequests extends BaseTaskHandler {
    public readonly taskType: string = "GitHubIssueFix";
    public readonly name: string = "Opens Pull Requests";

    public constructor(
      private readonly pullRequests: Array<UnrecordedPullRequest>,
    ) {
      super();
    }

    public async execute(context: TaskContext): Promise<TaskResult> {
      for (const pullRequest of this.pullRequests) {
        await this.recordOpenedPullRequest(context, {
          taskId: context.taskId.toString(),
          ...pullRequest,
        });
      }

      return {
        success: true,
        message: `Opened ${this.pullRequests.length} pull request(s)`,
        pullRequestsCreated: this.pullRequests.length,
        pullRequestUrls: this.pullRequests.map(
          (pullRequest: UnrecordedPullRequest) => {
            return pullRequest.pullRequestUrl;
          },
        ),
      };
    }
  }

  const SECOND_PULL_REQUEST: UnrecordedPullRequest = {
    ...OPENED_PULL_REQUEST,
    codeRepositoryId: "6650f0b1a1b2c3d4e5f60719",
    pullRequestUrl: "https://github.com/acme/payments/pull/12",
    pullRequestNumber: 12,
    pullRequestId: 3456789013,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function runHandlerOpening(
    pullRequests: Array<UnrecordedPullRequest>,
  ): Promise<JSONObject> {
    jest.spyOn(TaskHandlerIndex, "getTaskHandlerRegistry").mockReturnValue({
      getHandler: (): TaskHandler => {
        return new OpensPullRequests(pullRequests);
      },
    } as unknown as TaskHandlerRegistry);

    const outcome: TaskOutcome = await executeTask({
      ...task,
      taskType: "GitHubIssueFix",
    });

    return buildTaskOutcomeReport({ taskId: task.id, outcome: outcome });
  }

  test("still reaches the server with the Completed status", async () => {
    const recordSpy: jest.SpyInstance = jest
      .spyOn(BackendAPI.prototype, "recordPullRequest")
      .mockRejectedValue(
        new Error('value "3456789012" is out of range for type integer'),
      );

    const report: JSONObject = await runHandlerOpening([OPENED_PULL_REQUEST]);

    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(report["status"]).toBe(AIAgentTaskStatus.Completed);
    expect(report["pullRequestUrls"]).toEqual([PULL_REQUEST_URL]);
  });

  test("carries the record the task could not make, without the task", async () => {
    jest
      .spyOn(BackendAPI.prototype, "recordPullRequest")
      .mockRejectedValue(new Error("Failed to record pull request"));

    const report: JSONObject = await runHandlerOpening([OPENED_PULL_REQUEST]);

    expect(report["unrecordedPullRequests"]).toStrictEqual([
      OPENED_PULL_REQUEST,
    ]);
  });

  test("a pull request that was recorded goes with the report only as a link", async () => {
    jest
      .spyOn(BackendAPI.prototype, "recordPullRequest")
      .mockResolvedValue({ success: true, pullRequestId: "row-id" });

    const report: JSONObject = await runHandlerOpening([OPENED_PULL_REQUEST]);

    expect(report["pullRequestUrls"]).toEqual([PULL_REQUEST_URL]);
    expect(report).not.toHaveProperty("unrecordedPullRequests");
  });

  test("of two pull requests, only the one that could not be recorded is carried", async () => {
    jest
      .spyOn(BackendAPI.prototype, "recordPullRequest")
      .mockResolvedValueOnce({ success: true, pullRequestId: "row-id" })
      .mockRejectedValueOnce(new Error("Failed to record pull request"));

    const report: JSONObject = await runHandlerOpening([
      OPENED_PULL_REQUEST,
      SECOND_PULL_REQUEST,
    ]);

    expect(report["pullRequestUrls"]).toEqual([
      PULL_REQUEST_URL,
      SECOND_PULL_REQUEST.pullRequestUrl,
    ]);
    expect(report["unrecordedPullRequests"]).toStrictEqual([
      SECOND_PULL_REQUEST,
    ]);
  });

  // Each task starts with nothing left over from the one before it.
  test("a task does not carry another task's unrecorded pull requests", async () => {
    jest
      .spyOn(BackendAPI.prototype, "recordPullRequest")
      .mockRejectedValueOnce(new Error("Failed to record pull request"))
      .mockResolvedValueOnce({ success: true, pullRequestId: "row-id" });

    await runHandlerOpening([OPENED_PULL_REQUEST]);

    const secondReport: JSONObject = await runHandlerOpening([
      SECOND_PULL_REQUEST,
    ]);

    expect(secondReport).not.toHaveProperty("unrecordedPullRequests");
  });
});
