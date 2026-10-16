import AIAgentTaskAPI from "../../../Server/API/AIAgentTaskAPI";
import CodeFixAgentAuth, {
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import Response from "../../../Server/Utils/Response";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIAgentTaskStatus from "../../../Types/AI/AIAgentTaskStatus";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import CodeFixTaskContext, {
  GitHubTaskContext,
} from "../../../Types/AI/CodeFixTaskContext";
import GitHubCommandType from "../../../Types/CodeRepository/GitHubCommand";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * POST /ai-agent-task/update-task-status, for the report that closes a run.
 *
 * Recording a pull request can fail after GitHub has opened it, and the run
 * still finishes Completed. A Runner then reports the pull requests it opened
 * with that status, and they are kept on the run's GitHub context so the
 * thread the run came from can link them (GitHubRunReply). Two things matter
 * here:
 *
 *   - They are written by the SAME update that makes the run Completed. The
 *     outcome sweeper answers the thread as soon as the run is terminal, so a
 *     second write could land after the reply had already said no pull
 *     request was recorded.
 *   - A Runner that sends none — every Runner before this one — gets exactly
 *     the update it always got.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    redirect: jest.fn(),
  };
});

const UPDATE_STATUS_ROUTE: string = "/ai-agent-task/update-task-status";

const OPENED_URL: string = "https://github.com/acme/checkout/pull/77";

// What the CAS was asked to write, as AIAgentTaskAPI passes it.
interface TransitionCall {
  aiRunId: ObjectID;
  fromStatus: AIRunStatus;
  set: {
    status: AIRunStatus;
    errorMessage?: string;
    taskContext?: CodeFixTaskContext;
  };
}

interface FindRunCall {
  id: ObjectID;
  select: Record<string, boolean>;
}

describe("POST /ai-agent-task/update-task-status", () => {
  let projectId: ObjectID;
  let runId: ObjectID;
  let storedContext: CodeFixTaskContext | undefined;

  let findRunSpy: jest.SpyInstance;
  let transitionSpy: jest.SpyInstance;
  let appendEventSpy: jest.SpyInstance;
  let updateOneByIdSpy: jest.SpyInstance;
  let updateOneBySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentTaskAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    runId = ObjectID.generate();
    storedContext = { github: githubContext() };

    jest.spyOn(CodeFixAgentAuth, "resolveAgentIdentity").mockResolvedValue({
      id: ObjectID.generate(),
      projectId: projectId,
      source: CodeFixAgentSource.Runner,
    });

    // The run as the database holds it, answering only what was selected.
    findRunSpy = jest
      .spyOn(AIRunService, "findOneById")
      .mockImplementation(async (findBy: unknown): Promise<AIRun | null> => {
        const select: Record<string, boolean> = (findBy as FindRunCall).select;

        const run: AIRun = new AIRun();
        run.id = runId;
        run.projectId = projectId;
        run.status = AIRunStatus.Running;

        if (select["taskContext"] && storedContext) {
          run.taskContext = storedContext;
        }

        return run;
      });

    transitionSpy = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1);

    appendEventSpy = jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined as never);

    updateOneByIdSpy = jest
      .spyOn(AIRunService, "updateOneById")
      .mockResolvedValue(undefined as never);

    updateOneBySpy = jest
      .spyOn(AIRunService, "updateOneBy")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function githubContext(
    overrides: Partial<GitHubTaskContext> = {},
  ): GitHubTaskContext {
    return {
      codeRepositoryId: "6650f0b1a1b2c3d4e5f60718",
      installationId: "12345678",
      organizationName: "acme",
      repositoryName: "checkout",
      commandType: GitHubCommandType.Implement,
      instruction: "implement this",
      issueNumber: 42,
      triggerCommentId: 991,
      acknowledgementCommentId: 555,
      ...overrides,
    };
  }

  async function report(body: JSONObject): Promise<void> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: {
        aiAgentId: ObjectID.generate().toString(),
        aiAgentKey: "runner-key",
        taskId: runId.toString(),
        ...body,
      },
      headers: {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    const next: jest.Mock = jest.fn();

    await mockRouter
      .match("POST", UPDATE_STATUS_ROUTE)
      .handlerFunction(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
  }

  function transition(): TransitionCall {
    expect(transitionSpy).toHaveBeenCalledTimes(1);

    return transitionSpy.mock.calls[0]![0] as TransitionCall;
  }

  function selectedColumns(): Record<string, boolean> {
    expect(findRunSpy).toHaveBeenCalledTimes(1);

    return (findRunSpy.mock.calls[0]![0] as FindRunCall).select;
  }

  function succeeded(): boolean {
    const sendJson: jest.Mock =
      Response.sendJsonObjectResponse as unknown as jest.Mock;
    const sendError: jest.Mock =
      Response.sendErrorResponse as unknown as jest.Mock;

    return (
      sendJson.mock.calls.length === 1 && sendError.mock.calls.length === 0
    );
  }

  test("a Completed report keeps the pull requests on the run's GitHub context", async () => {
    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OPENED_URL],
    });

    expect(succeeded()).toBe(true);
    expect(transition().fromStatus).toBe(AIRunStatus.Running);
    expect(transition().set.status).toBe(AIRunStatus.Completed);
    expect(transition().set.taskContext).toEqual({
      github: { ...githubContext(), openedPullRequestUrls: [OPENED_URL] },
    });
  });

  /*
   * One UPDATE, conditional on the run still Running: the run is never
   * terminal without its pull requests, and a run another actor finalized
   * first is not written at all.
   */
  test("writes them with the status, never in a write of their own", async () => {
    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OPENED_URL],
    });

    expect(transition().set.taskContext).toBeDefined();
    expect(updateOneByIdSpy).not.toHaveBeenCalled();
    expect(updateOneBySpy).not.toHaveBeenCalled();
  });

  // TypeORM replaces a jsonb column, so the rest of the context goes back in.
  test("keeps every other key of the run's context", async () => {
    storedContext = {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      github: githubContext(),
    };

    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OPENED_URL],
    });

    expect(transition().set.taskContext?.traceId).toBe(
      "4bf92f3577b34da6a3ce929d0e0e4736",
    );
    expect(transition().set.taskContext?.github?.acknowledgementCommentId).toBe(
      555,
    );
  });

  test("a Runner that sends no pull requests gets the update it always got", async () => {
    await report({ status: AIAgentTaskStatus.Completed });

    expect(succeeded()).toBe(true);
    expect(selectedColumns()).toEqual({
      _id: true,
      projectId: true,
      status: true,
    });
    expect(transition().set.status).toBe(AIRunStatus.Completed);
    expect(transition().set).not.toHaveProperty("taskContext");
  });

  test("an empty list is the same as none", async () => {
    await report({ status: AIAgentTaskStatus.Completed, pullRequestUrls: [] });

    expect(selectedColumns()).not.toHaveProperty("taskContext");
    expect(transition().set).not.toHaveProperty("taskContext");
  });

  test("a run that did not come from GitHub keeps its context", async () => {
    storedContext = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736" };

    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OPENED_URL],
    });

    expect(succeeded()).toBe(true);
    expect(transition().set.status).toBe(AIRunStatus.Completed);
    expect(transition().set).not.toHaveProperty("taskContext");
  });

  test("another repository's pull request is not kept", async () => {
    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: ["https://github.com/acme/billing/pull/5"],
    });

    expect(transition().set.status).toBe(AIRunStatus.Completed);
    expect(transition().set).not.toHaveProperty("taskContext");
  });

  test("a value that is not a list is ignored, and the run still completes", async () => {
    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: OPENED_URL,
    });

    expect(succeeded()).toBe(true);
    expect(transition().set.status).toBe(AIRunStatus.Completed);
    expect(transition().set).not.toHaveProperty("taskContext");
  });

  // Only a run that finished Completed opened anything worth linking.
  test.each([AIAgentTaskStatus.NoFixFound, AIAgentTaskStatus.Error])(
    "a report of %s does not keep pull requests",
    async (status: AIAgentTaskStatus) => {
      await report({
        status: status,
        statusMessage: "No change was worth proposing",
        pullRequestUrls: [OPENED_URL],
      });

      expect(selectedColumns()).not.toHaveProperty("taskContext");
      expect(transition().set).not.toHaveProperty("taskContext");
      expect(transition().set.errorMessage).toBe(
        "No change was worth proposing",
      );
    },
  );

  test("a run another actor already finalized gets no RunCompleted event", async () => {
    transitionSpy.mockResolvedValue(0);

    await report({
      status: AIAgentTaskStatus.Completed,
      pullRequestUrls: [OPENED_URL],
    });

    expect(succeeded()).toBe(true);
    expect(appendEventSpy).not.toHaveBeenCalled();
  });
});
