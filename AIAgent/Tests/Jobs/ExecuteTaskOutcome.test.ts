import {
  executeTask,
  PendingTask,
  TaskOutcome,
} from "../../Jobs/ProcessScheduledTasks";
import * as TaskHandlerIndex from "../../TaskHandlers/Index";
import {
  TaskHandler,
  TaskResult,
} from "../../TaskHandlers/TaskHandlerInterface";
import TaskHandlerRegistry from "../../TaskHandlers/TaskHandlerRegistry";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";

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
