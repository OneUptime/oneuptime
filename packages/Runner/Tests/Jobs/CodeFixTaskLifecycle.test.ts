/*
 * ---------------------------------------------------------------------------
 * Lifecycle invariants of the code-fix claim loop.
 *
 * This loop runs for the entire life of the container, one run at a time, so
 * anything it forgets to release accumulates without bound. Two such leaks
 * are pinned here, both of which are invisible in a short-lived test run and
 * only show up on a Runner that has been up for days:
 *
 *   - A TaskLogger starts a repeating flush timer in its CONSTRUCTOR, and one
 *     logger is created per task. Only dispose() stops that timer; the loop
 *     used to call flush(). So every task the Runner ever processed left a
 *     live interval behind, each waking every five seconds forever and
 *     POSTing to the server on behalf of a run that finished hours ago.
 *   - The repository access token is registered with the redactor for the
 *     duration of a run. It has to be forgotten afterwards: this Runner goes
 *     on to serve other repositories.
 *
 * ...and the hot spin. get-pending-task CLAIMS a run server-side before
 * handing it over, so a failure to mark it InProgress abandons a claimed run.
 * Doing that without backing off means the next pass claims and abandons the
 * next queued run just as fast — which burns through every queued run in the
 * project in seconds and strands all of them for the stale-run sweeper. This
 * is precisely the failure mode of a server-side problem, which is when the
 * loop must be at its most patient.
 * ---------------------------------------------------------------------------
 */

import {
  executeTask,
  PendingTask,
  TaskOutcome,
} from "../../Jobs/PollCodeFixWork";
import SecretRedactor from "../../Utils/SecretRedactor";
import TaskLogger from "../../Utils/TaskLogger";
import {
  getTaskHandlerRegistry,
  TaskContext,
  TaskResult,
} from "../../TaskHandlers/Index";
import { BaseTaskHandler } from "../../TaskHandlers/TaskHandlerInterface";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";

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

// TaskLogger posts to the server on every flush; keep the loop hermetic.
jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn().mockResolvedValue({
        isSuccess: () => {
          return true;
        },
        data: {},
      }),
    },
  };
});

// A handler whose outcome each test scripts.
class ScriptedHandler extends BaseTaskHandler {
  public readonly taskType: string = "FixException";
  public readonly name: string = "Scripted Handler";

  public constructor(
    private readonly behaviour: (context: TaskContext) => Promise<TaskResult>,
  ) {
    super();
  }

  public async execute(context: TaskContext): Promise<TaskResult> {
    return this.behaviour(context);
  }
}

function registerHandler(
  behaviour: (context: TaskContext) => Promise<TaskResult>,
): void {
  getTaskHandlerRegistry().register(new ScriptedHandler(behaviour));
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, milliseconds);
  });
}

const task: PendingTask = {
  id: "11111111-2222-4333-8444-555555555555",
  projectId: "99999999-8888-4777-8666-555555555555",
  taskType: "FixException",
};

describe("executeTask lifecycle", () => {
  /*
   * The leak, observed the only way it can be from outside: count the
   * intervals the process is holding either side of a task.
   */
  test("disposes the task logger, leaving no repeating timer behind", async () => {
    const disposeSpy: jest.SpyInstance = jest.spyOn(
      TaskLogger.prototype,
      "dispose",
    );

    registerHandler(async () => {
      return { success: true, message: "Created 1 pull request(s)" };
    });

    try {
      await executeTask(task);

      expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
      disposeSpy.mockRestore();
    }
  });

  test("disposes the task logger even when the handler throws", async () => {
    const disposeSpy: jest.SpyInstance = jest.spyOn(
      TaskLogger.prototype,
      "dispose",
    );

    registerHandler(async () => {
      throw new Error("the code agent could not complete");
    });

    try {
      await expect(executeTask(task)).rejects.toThrow(
        "the code agent could not complete",
      );

      expect(disposeSpy).toHaveBeenCalledTimes(1);
    } finally {
      disposeSpy.mockRestore();
    }
  });

  /*
   * The other half of the contract, on TaskLogger itself: dispose() must
   * actually stop the repeating timer. flush() alone does not — which is the
   * whole reason the loop leaked one live interval per task, each waking
   * every five seconds for the remaining life of the container and POSTing
   * on behalf of a run that finished hours ago.
   */
  test("dispose stops TaskLogger's repeating flush timer for good", async () => {
    /*
     * Real timers on a short interval, not jest's fake ones: this jest
     * version cannot install fake timers on the Node the Runner ships with,
     * and a leaked interval is a real-clock problem anyway.
     */
    const logger: TaskLogger = new TaskLogger({
      taskId: task.id,
      flushIntervalMs: 40,
    });

    const flushSpy: jest.SpyInstance = jest.spyOn(logger, "flush");

    try {
      await sleep(150);
      expect(flushSpy.mock.calls.length).toBeGreaterThanOrEqual(1);

      await logger.dispose();
      const callsAfterDispose: number = flushSpy.mock.calls.length;

      // Several more interval periods of real time: nothing may fire again.
      await sleep(200);

      expect(flushSpy.mock.calls.length).toBe(callsAfterDispose);
    } finally {
      flushSpy.mockRestore();
      await logger.dispose();
    }
  });

  test("forgets the run's repository token when the task ends", async () => {
    const token: string = "ghs_token_scoped_to_one_run_1234567890";

    registerHandler(async () => {
      // Stand in for RepositoryManager registering the token mid-run.
      SecretRedactor.register(token, "repository-token");
      expect(SecretRedactor.isRegistered(token)).toBe(true);
      return { success: true, message: "done" };
    });

    await executeTask(task);

    expect(SecretRedactor.isRegistered(token)).toBe(false);
  });

  test("forgets the token even when the task fails", async () => {
    const token: string = "ghs_token_scoped_to_one_run_0987654321";

    registerHandler(async () => {
      SecretRedactor.register(token, "repository-token");
      throw new Error("clone failed");
    });

    await expect(executeTask(task)).rejects.toThrow("clone failed");

    expect(SecretRedactor.isRegistered(token)).toBe(false);
  });
});

describe("executeTask outcome mapping", () => {
  test("a completed task reports Completed", async () => {
    registerHandler(async () => {
      return { success: true, message: "Created 1 pull request(s)" };
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome.status).toBe(AIAgentTaskStatus.Completed);
  });

  test("a no-fix result reports NoFixFound with its reason", async () => {
    registerHandler(async () => {
      return {
        success: false,
        message: "No fixes could be applied to any repository",
        data: { noFixFound: true },
      };
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome.status).toBe(AIAgentTaskStatus.NoFixFound);
    expect(outcome.statusMessage).toContain("No fixes could be applied");
  });

  /*
   * The other half of the taxonomy pinned in
   * TaskHandlers/CodeAgentOutcomeTaxonomy.test.ts: isError must reach the
   * caller as a throw, so the loop reports Error rather than a green run.
   */
  test("an isError result throws so the loop reports Error", async () => {
    registerHandler(async () => {
      return {
        success: false,
        message: "The code agent could not complete: budget exhausted",
        data: { isError: true },
      };
    });

    await expect(executeTask(task)).rejects.toThrow("budget exhausted");
  });

  test("an unknown task type is a clear failure, not a silent skip", async () => {
    await expect(
      executeTask({ ...task, taskType: "NoSuchRecipe" }),
    ).rejects.toThrow("No handler registered for task type: NoSuchRecipe");
  });
});
