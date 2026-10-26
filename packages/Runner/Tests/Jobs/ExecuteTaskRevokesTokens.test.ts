import {
  executeTask,
  PendingTask,
  TaskOutcome,
} from "../../Jobs/PollCodeFixWork";
import * as TaskHandlerIndex from "../../TaskHandlers/Index";
import {
  TaskContext,
  TaskHandler,
  TaskResult,
} from "../../TaskHandlers/TaskHandlerInterface";
import TaskHandlerRegistry from "../../TaskHandlers/TaskHandlerRegistry";
import RepositoryTokenRevocation from "../../Utils/RepositoryTokenRevocation";
import SecretRedactor from "../../Utils/SecretRedactor";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";

/*
 * ---------------------------------------------------------------------------
 * A run's GitHub tokens are revoked when the run ends, however it ends.
 *
 * executeTask runs the task's handler, which is handed a token for each
 * GitHub repository it works in (BackendAPI.getRepositoryToken remembers
 * each). Whether the handler opens a pull request, finds nothing to fix,
 * fails or throws, every token it was handed is revoked before executeTask
 * hands back the outcome - so none outlives the run by the rest of its hour,
 * on a global Runner or any other.
 * ---------------------------------------------------------------------------
 */

// Constructed inside executeTask, and would otherwise reach the network.
jest.mock("../../Utils/TaskLogger");
jest.mock("../../Utils/BackendAPI");

const task: PendingTask = {
  id: "6690e1f1e1f1e1f1e1f1e1f1",
  projectId: "6690e2f2e2f2e2f2e2f2e2f2",
  exceptionId: "exception-id",
  taskType: "FixException",
};

let revokedTokens: Array<string>;

// A handler that is handed these tokens while it works, then does `finish`.
function stubHandler(data: {
  tokens: Array<string>;
  finish: () => Promise<TaskResult>;
}): void {
  const handler: TaskHandler = {
    taskType: "FixException",
    name: "Stub Handler",
    execute: jest.fn(async (_context: TaskContext): Promise<TaskResult> => {
      for (const token of data.tokens) {
        RepositoryTokenRevocation.remember(token);
      }

      // Nothing is revoked while the run is still working.
      expect(revokedTokens).toEqual([]);

      return await data.finish();
    }),
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

beforeEach(() => {
  revokedTokens = [];
  RepositoryTokenRevocation.reset();
  RepositoryTokenRevocation.setRevokeTokenFunction(async (token: string) => {
    revokedTokens.push(token);
    return new HTTPResponse<JSONObject>(204, {}, {});
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  RepositoryTokenRevocation.reset();
});

describe("executeTask revokes the run's GitHub tokens", () => {
  test("after a run that opened a pull request, before the outcome is handed back", async () => {
    stubHandler({
      tokens: ["ghs_users_api", "ghs_billing_api"],
      finish: async (): Promise<TaskResult> => {
        return {
          success: true,
          message: "Created 2 pull request(s)",
          pullRequestsCreated: 2,
        };
      },
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome.status).toBe(AIAgentTaskStatus.Completed);
    expect(revokedTokens).toEqual(["ghs_users_api", "ghs_billing_api"]);
    expect(RepositoryTokenRevocation.getRememberedCount()).toBe(0);
  });

  test("after a run that found nothing to fix", async () => {
    stubHandler({
      tokens: ["ghs_users_api"],
      finish: async (): Promise<TaskResult> => {
        return {
          success: false,
          message: "Nothing to change",
          data: { noFixFound: true },
        };
      },
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome.status).toBe(AIAgentTaskStatus.NoFixFound);
    expect(revokedTokens).toEqual(["ghs_users_api"]);
  });

  test("after a run that failed (reported as Error)", async () => {
    stubHandler({
      tokens: ["ghs_users_api"],
      finish: async (): Promise<TaskResult> => {
        return {
          success: false,
          message: "Clone failed",
          data: { isError: true },
        };
      },
    });

    await expect(executeTask(task)).rejects.toThrow("Clone failed");
    expect(revokedTokens).toEqual(["ghs_users_api"]);
  });

  test("after a handler that threw", async () => {
    stubHandler({
      tokens: ["ghs_users_api"],
      finish: async (): Promise<TaskResult> => {
        throw new Error("Unexpected failure in the agent loop");
      },
    });

    await expect(executeTask(task)).rejects.toThrow(
      "Unexpected failure in the agent loop",
    );
    expect(revokedTokens).toEqual(["ghs_users_api"]);
  });

  test("a run handed no GitHub token revokes nothing", async () => {
    stubHandler({
      tokens: [],
      finish: async (): Promise<TaskResult> => {
        return { success: true, message: "Answered" };
      },
    });

    await executeTask(task);

    expect(revokedTokens).toEqual([]);
  });

  test("tokens are revoked before the redactor forgets them", async () => {
    const order: Array<string> = [];

    RepositoryTokenRevocation.setRevokeTokenFunction(async () => {
      order.push("revoked");
      return new HTTPResponse<JSONObject>(204, {}, {});
    });

    jest
      .spyOn(SecretRedactor, "clearRegistered")
      .mockImplementation((): void => {
        order.push("redactor cleared");
      });

    stubHandler({
      tokens: ["ghs_users_api"],
      finish: async (): Promise<TaskResult> => {
        return { success: true, message: "Created 1 pull request(s)" };
      },
    });

    await executeTask(task);

    expect(order).toEqual(["revoked", "redactor cleared"]);
  });

  test("a revocation GitHub refuses never changes how the run is reported", async () => {
    RepositoryTokenRevocation.setRevokeTokenFunction(async () => {
      throw new Error("GitHub is down");
    });

    stubHandler({
      tokens: ["ghs_users_api"],
      finish: async (): Promise<TaskResult> => {
        return {
          success: true,
          message: "Created 1 pull request(s)",
          pullRequestsCreated: 1,
        };
      },
    });

    const outcome: TaskOutcome = await executeTask(task);

    expect(outcome.status).toBe(AIAgentTaskStatus.Completed);
  });
});
