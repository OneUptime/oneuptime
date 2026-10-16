/*
 * ---------------------------------------------------------------------------
 * The report that closes a code-fix task: Completed, NoFixFound or Error.
 *
 * It is one POST to update-task-status at the end of the run, and one lost
 * to a deploy or a dropped connection leaves the run Running until the
 * stale-run sweeper fails it. A Completed report also carries the pull
 * requests the run opened and the records it could not make, which are lost
 * with it. So it is retried, with backoff, on the failures a retry can fix
 * (no answer, a 5xx, a 408/425/429) and never on a refusal. The server
 * closes a run once (a Running -> terminal CAS) and records a reported pull
 * request once, so a retry of a report that landed changes nothing. How
 * API.post retries is pinned in Common's APIRetryPolicy tests; this file pins
 * which of the loop's posts ask for it, and what the loop does with the
 * answer.
 *
 * The claim and the InProgress heartbeat are sent once, as before.
 * ---------------------------------------------------------------------------
 */

import startTaskProcessingLoop, {
  PendingTask,
} from "../../Jobs/PollCodeFixWork";
import * as TaskHandlerIndex from "../../TaskHandlers/Index";
import {
  TaskHandler,
  TaskResult,
} from "../../TaskHandlers/TaskHandlerInterface";
import TaskHandlerRegistry from "../../TaskHandlers/TaskHandlerRegistry";
import AIAgentTaskLog from "../../Utils/CodeFixTaskLog";
import RunnerAPIRequest from "../../Utils/RunnerAPIRequest";
import RunnerCapabilities from "../../Utils/RunnerCapabilities";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import Sleep from "Common/Types/Sleep";
import logger from "Common/Server/Utils/Logger";

const postMock: jest.Mock = jest.fn();

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

// Both are constructed inside executeTask and would otherwise reach the network.
jest.mock("../../Utils/TaskLogger");
jest.mock("../../Utils/BackendAPI");

// The run's log lines. This file is about its status.
jest.mock("../../Utils/CodeFixTaskLog");

interface PostCall {
  url: URL;
  data: JSONObject;
  options?: JSONObject;
}

const TASK: PendingTask = {
  id: "6690e1f1e1f1e1f1e1f1e1f1",
  projectId: "6690e2f2e2f2e2f2e2f2e2f2",
  exceptionId: "exception-id",
  taskType: "FixException",
};

const PULL_REQUEST_URL: string = "https://github.com/acme/checkout/pull/77";

const COMPLETED: TaskResult = {
  success: true,
  message: "Opened pull request #77",
  pullRequestsCreated: 1,
  pullRequestUrls: [PULL_REQUEST_URL],
};

const NO_FIX_FOUND: TaskResult = {
  success: false,
  message: "No fixes could be applied to any repository",
  data: { noFixFound: true },
};

const FAILURE_MESSAGE: string =
  "The code agent could not complete: budget exhausted";

const RETRIED: JSONObject = {
  retries: 3,
  exponentialBackoff: true,
  retryOnlyOnRetryableErrors: true,
};

const ACCEPTED: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
  200,
  { message: "Task status updated successfully" },
  {},
);

// What a server that predates NoFixFound answers it with.
const INVALID_STATUS: HTTPErrorResponse = new HTTPErrorResponse(
  400,
  { message: "Invalid status. Must be one of: InProgress, Completed, Error" },
  {},
);

// API.post throws once the retries are spent on a request that got no answer.
const NO_ANSWER: Error = new Error(
  "Request failed to http://localhost/api/ai-agent-task/update-task-status. Connection refused",
);

const LOOP_STOPPED: string = "the test stopped the loop";

// Serve the task through a handler that ends the way the test needs.
function stubHandler(result: TaskResult | Error): void {
  const handler: TaskHandler = {
    taskType: "FixException",
    name: "Stub Handler",
    execute:
      result instanceof Error
        ? jest.fn().mockRejectedValue(result)
        : jest.fn().mockResolvedValue(result),
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

/*
 * Run the loop for one task. The first claim hands it over and the second
 * finds no work, so the loop sleeps, which ends it. Each status report gets
 * the answer the test gives for its status (an Error is a report that got
 * no answer); the rest are accepted.
 */
async function runOneTask(data: {
  result: TaskResult | Error;
  answers?: Partial<
    Record<AIAgentTaskStatus, HTTPResponse<JSONObject> | Error>
  >;
}): Promise<void> {
  stubHandler(data.result);

  let claims: number = 0;

  postMock.mockImplementation(async (request: PostCall) => {
    if (
      request.url.toString().endsWith("/api/ai-agent-task/get-pending-task")
    ) {
      claims++;

      return new HTTPResponse<JSONObject>(
        200,
        { task: claims === 1 ? (TASK as unknown as JSONObject) : null },
        {},
      );
    }

    const answer: HTTPResponse<JSONObject> | Error =
      data.answers?.[request.data["status"] as AIAgentTaskStatus] || ACCEPTED;

    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  });

  await expect(startTaskProcessingLoop()).rejects.toThrow(LOOP_STOPPED);
}

function postCalls(): Array<PostCall> {
  return postMock.mock.calls.map((call: Array<unknown>) => {
    return call[0] as PostCall;
  });
}

function statusReports(): Array<PostCall> {
  return postCalls().filter((call: PostCall) => {
    return call.url
      .toString()
      .endsWith("/api/ai-agent-task/update-task-status");
  });
}

function reportedStatuses(): Array<unknown> {
  return statusReports().map((call: PostCall) => {
    return call.data["status"];
  });
}

function reportOf(status: AIAgentTaskStatus): PostCall {
  const reports: Array<PostCall> = statusReports().filter((call: PostCall) => {
    return call.data["status"] === status;
  });

  expect(reports).toHaveLength(1);

  return reports[0]!;
}

describe("the report that closes a code-fix task", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    postMock.mockReset();

    jest.spyOn(RunnerCapabilities, "resolve").mockReturnValue({
      canRunRunbooks: false,
      canRunCodeFixTasks: true,
      canRunAiCommands: false,
    });

    jest.spyOn(Sleep, "sleep").mockRejectedValue(new Error(LOOP_STOPPED));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a Completed report is retried with backoff, on failures a retry can fix", async () => {
    await runOneTask({ result: COMPLETED });

    expect(reportOf(AIAgentTaskStatus.Completed)).toEqual({
      url: expect.anything(),
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: TASK.id,
        status: AIAgentTaskStatus.Completed,
        pullRequestUrls: [PULL_REQUEST_URL],
      },
      options: RETRIED,
    });
  });

  test("a NoFixFound report is retried the same way", async () => {
    await runOneTask({ result: NO_FIX_FOUND });

    expect(reportOf(AIAgentTaskStatus.NoFixFound)).toEqual({
      url: expect.anything(),
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: TASK.id,
        status: AIAgentTaskStatus.NoFixFound,
        statusMessage: NO_FIX_FOUND.message,
      },
      options: RETRIED,
    });
  });

  test("an Error report is retried the same way", async () => {
    await runOneTask({ result: new Error(FAILURE_MESSAGE) });

    expect(reportOf(AIAgentTaskStatus.Error)).toEqual({
      url: expect.anything(),
      data: {
        ...RunnerAPIRequest.getDefaultRequestBody(),
        taskId: TASK.id,
        status: AIAgentTaskStatus.Error,
        statusMessage: FAILURE_MESSAGE,
      },
      options: RETRIED,
    });
  });

  test("the claim and the InProgress heartbeat are not retried", async () => {
    await runOneTask({ result: COMPLETED });

    const claims: Array<PostCall> = postCalls().filter((call: PostCall) => {
      return call.url
        .toString()
        .endsWith("/api/ai-agent-task/get-pending-task");
    });

    expect(claims).toHaveLength(2);

    for (const claim of claims) {
      expect(claim.options).toBeUndefined();
    }

    expect(reportOf(AIAgentTaskStatus.InProgress).options).toBeUndefined();
  });

  test("a finished task reports its status once, after the heartbeat", async () => {
    await runOneTask({ result: COMPLETED });

    expect(reportedStatuses()).toEqual([
      AIAgentTaskStatus.InProgress,
      AIAgentTaskStatus.Completed,
    ]);
    expect(AIAgentTaskLog.sendTaskCompletedLog).toHaveBeenCalledWith(TASK.id);
  });

  /*
   * API.post throws when no answer came back, retries included. That throw
   * used to reach the catch that reports Error — so a task that had opened
   * its pull request was reported as failed if that Error report got
   * through, and with the reports retried it is far more likely to.
   */
  describe("a report that got no answer", () => {
    test("leaves a Completed task's run for the sweeper rather than reporting Error", async () => {
      await runOneTask({
        result: COMPLETED,
        answers: { [AIAgentTaskStatus.Completed]: NO_ANSWER },
      });

      expect(reportedStatuses()).toEqual([
        AIAgentTaskStatus.InProgress,
        AIAgentTaskStatus.Completed,
      ]);
      expect(logger.error).toHaveBeenCalledWith(NO_ANSWER, expect.anything());
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to mark task ${TASK.id} as Completed`,
        expect.anything(),
      );
      expect(AIAgentTaskLog.sendTaskCompletedLog).not.toHaveBeenCalled();
      expect(AIAgentTaskLog.sendTaskErrorLog).not.toHaveBeenCalled();
    });

    test("does not turn a NoFixFound into Completed", async () => {
      await runOneTask({
        result: NO_FIX_FOUND,
        answers: { [AIAgentTaskStatus.NoFixFound]: NO_ANSWER },
      });

      expect(reportedStatuses()).toEqual([
        AIAgentTaskStatus.InProgress,
        AIAgentTaskStatus.NoFixFound,
      ]);
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to mark task ${TASK.id} as NoFixFound`,
        expect.anything(),
      );
      expect(AIAgentTaskLog.sendTaskNoFixFoundLog).not.toHaveBeenCalled();
    });

    test("on an Error report is logged, and the run's error log still goes", async () => {
      await runOneTask({
        result: new Error(FAILURE_MESSAGE),
        answers: { [AIAgentTaskStatus.Error]: NO_ANSWER },
      });

      expect(reportedStatuses()).toEqual([
        AIAgentTaskStatus.InProgress,
        AIAgentTaskStatus.Error,
      ]);
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to mark task ${TASK.id} as Error: ${FAILURE_MESSAGE}`,
        expect.anything(),
      );
      expect(AIAgentTaskLog.sendTaskErrorLog).toHaveBeenCalledWith(
        TASK.id,
        FAILURE_MESSAGE,
      );
    });
  });

  /*
   * A server that predates NoFixFound refuses it with a 400, which
   * retryOnlyOnRetryableErrors does not retry, and the loop reports
   * Completed instead.
   */
  describe("a NoFixFound the server does not take", () => {
    test("refused as an invalid status, falls back to Completed, also retried", async () => {
      await runOneTask({
        result: NO_FIX_FOUND,
        answers: { [AIAgentTaskStatus.NoFixFound]: INVALID_STATUS },
      });

      expect(reportedStatuses()).toEqual([
        AIAgentTaskStatus.InProgress,
        AIAgentTaskStatus.NoFixFound,
        AIAgentTaskStatus.Completed,
      ]);
      expect(reportOf(AIAgentTaskStatus.Completed)).toEqual({
        url: expect.anything(),
        data: {
          ...RunnerAPIRequest.getDefaultRequestBody(),
          taskId: TASK.id,
          status: AIAgentTaskStatus.Completed,
        },
        options: RETRIED,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        `Server rejected NoFixFound for task ${TASK.id}; reporting Completed instead`,
        expect.anything(),
      );
      expect(AIAgentTaskLog.sendTaskNoFixFoundLog).toHaveBeenCalledWith(
        TASK.id,
        NO_FIX_FOUND.message,
      );
    });

    test("refused again as Completed, is logged as not marked", async () => {
      await runOneTask({
        result: NO_FIX_FOUND,
        answers: {
          [AIAgentTaskStatus.NoFixFound]: INVALID_STATUS,
          [AIAgentTaskStatus.Completed]: new HTTPErrorResponse(
            400,
            { message: "Task not found" },
            {},
          ),
        },
      });

      expect(logger.error).toHaveBeenCalledWith(
        `Failed to mark task ${TASK.id} as NoFixFound`,
        expect.anything(),
      );
      expect(AIAgentTaskLog.sendTaskNoFixFoundLog).not.toHaveBeenCalled();
    });

    /*
     * A server error that outlasted the retries says nothing about whether
     * the server knows NoFixFound. A Completed sent after it could get
     * through once the server was back, and hide why no fix was found.
     */
    test("failed by a server error, does not fall back", async () => {
      await runOneTask({
        result: NO_FIX_FOUND,
        answers: {
          [AIAgentTaskStatus.NoFixFound]: new HTTPErrorResponse(
            503,
            { message: "Service Unavailable" },
            {},
          ),
        },
      });

      expect(reportedStatuses()).toEqual([
        AIAgentTaskStatus.InProgress,
        AIAgentTaskStatus.NoFixFound,
      ]);
      expect(logger.error).toHaveBeenCalledWith(
        `Failed to mark task ${TASK.id} as NoFixFound`,
        expect.anything(),
      );
    });
  });
});
