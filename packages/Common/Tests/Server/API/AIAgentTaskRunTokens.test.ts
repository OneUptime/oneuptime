import AIAgentTaskAPI from "../../../Server/API/AIAgentTaskAPI";
import CodeFixAgentAuth, {
  CodeFixAgentIdentity,
  CodeFixAgentSource,
} from "../../../Server/Utils/AI/CodeFix/CodeFixAgentAuth";
import { credentialCheckProving } from "../TestingUtils/CodeFixAgentCredential";
import AIRunService from "../../../Server/Services/AIRunService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import CodeFixAutoRetry from "../../../Server/Utils/AI/CodeFix/CodeFixAutoRetry";
import CodeRepositoryMintedTokens from "../../../Server/Utils/CodeRepository/CodeHost/CodeRepositoryMintedTokens";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIAgentTaskStatus from "../../../Types/AI/AIAgentTaskStatus";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import RunnerCodeFixCapability, {
  RUNNER_CODE_FIX_CAPABILITIES_FIELD,
} from "../../../Types/Runner/RunnerCodeFixCapability";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * THE CODE-FIX TASK PROTOCOL AND THE TOKENS MADE FOR A RUN (#8912, #8916).
 *
 *   - The report that ends a run - Completed, NoFixFound, Error, or an Error
 *     that queues it again for another attempt - revokes every token
 *     OneUptime made for it (CodeRepositoryMintedTokens.revokeForRun), so
 *     none outlives the work it was made for. A progress report does not,
 *     and neither does a report for a run the worker does not hold.
 *   - The claim and the queue count read whether the worker pushes with a
 *     token made for its run (RunnerCodeFixCapability), which is what lets
 *     a global Runner take a GitLab repository's runs on OneUptime Cloud.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

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

describe("the code-fix task protocol and the tokens made for a run", () => {
  let projectId: ObjectID;
  let runId: ObjectID;
  let workerId: ObjectID;
  let identity: CodeFixAgentIdentity;
  let runHolder: ObjectID;
  let revokeSpy: jest.SpyInstance;
  let retrySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new AIAgentTaskAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    runId = ObjectID.generate();
    workerId = ObjectID.generate();
    runHolder = workerId;
    identity = {
      id: workerId,
      projectId: projectId,
      source: CodeFixAgentSource.Runner,
    };

    jest
      .spyOn(CodeFixAgentAuth, "checkCredential")
      .mockImplementation(async () => {
        return credentialCheckProving(identity);
      });

    jest
      .spyOn(AIRunService, "findOneById")
      .mockImplementation(async (): Promise<AIRun | null> => {
        const run: AIRun = new AIRun();
        run.id = runId;
        run.projectId = projectId;
        run.aiAgentId = runHolder;
        run.status = AIRunStatus.Running;
        return run;
      });

    jest.spyOn(AIRunService, "attemptStatusTransition").mockResolvedValue(1);
    jest.spyOn(AIRunService, "updateOneBy").mockResolvedValue(0 as never);
    jest
      .spyOn(AIRunEventService, "appendEventToRun")
      .mockResolvedValue(undefined as never);

    retrySpy = jest
      .spyOn(CodeFixAutoRetry, "tryAgainLater")
      .mockResolvedValue(false);
    revokeSpy = jest
      .spyOn(CodeRepositoryMintedTokens, "revokeForRun")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function post(route: string, body: JSONObject): Promise<void> {
    const req: ExpressRequest = {
      params: {},
      query: {},
      body: {
        aiAgentId: workerId.toString(),
        aiAgentKey: "runner-key",
        ...body,
      },
      headers: {},
    } as unknown as ExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    await mockRouter
      .match("POST", route)
      .handlerFunction(req, res, jest.fn() as unknown as NextFunction);
  }

  async function report(status: AIAgentTaskStatus): Promise<void> {
    await post("/ai-agent-task/update-task-status", {
      taskId: runId.toString(),
      status,
      ...(status === AIAgentTaskStatus.Error
        ? { statusMessage: "The clone failed." }
        : {}),
    });
  }

  describe("the report that ends a run revokes every token made for it", () => {
    test.each([
      AIAgentTaskStatus.Completed,
      AIAgentTaskStatus.NoFixFound,
      AIAgentTaskStatus.Error,
    ])("%s", async (status: AIAgentTaskStatus) => {
      await report(status);

      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(
        (revokeSpy.mock.calls[0]![0] as { runId: ObjectID }).runId.toString(),
      ).toBe(runId.toString());
    });

    test("an Error that queues the run again for another attempt: the next attempt is made a token of its own", async () => {
      retrySpy.mockResolvedValue(true);

      await report(AIAgentTaskStatus.Error);

      expect(revokeSpy).toHaveBeenCalledTimes(1);
      expect(AIRunService.attemptStatusTransition).not.toHaveBeenCalled();
    });

    test("revoked before the run is made terminal, so nothing that waits for its end sees a token still good", async () => {
      const order: Array<string> = [];

      revokeSpy.mockImplementation(async () => {
        order.push("revoke");
        return 1;
      });
      (
        AIRunService.attemptStatusTransition as unknown as jest.Mock
      ).mockImplementation(async () => {
        order.push("terminal");
        return 1;
      });

      await report(AIAgentTaskStatus.Completed);

      expect(order).toEqual(["revoke", "terminal"]);
    });
  });

  describe("and nothing else does", () => {
    test("a progress report", async () => {
      await report(AIAgentTaskStatus.InProgress);

      expect(revokeSpy).not.toHaveBeenCalled();
    });

    test("a report for a run another worker holds", async () => {
      runHolder = ObjectID.generate();

      await report(AIAgentTaskStatus.Completed);

      expect(revokeSpy).not.toHaveBeenCalled();
    });

    test("a report of a status the protocol does not have", async () => {
      await post("/ai-agent-task/update-task-status", {
        taskId: runId.toString(),
        status: "Revoked",
      });

      expect(revokeSpy).not.toHaveBeenCalled();
    });
  });

  describe("the claim and the queue count read whether the worker pushes with a token made for its run", () => {
    let claimSpy: jest.SpyInstance;
    let countSpy: jest.SpyInstance;

    beforeEach(() => {
      identity = { id: workerId, source: CodeFixAgentSource.Runner };
      claimSpy = jest
        .spyOn(AIRunService, "claimNextQueuedCodeFixRun")
        .mockResolvedValue(null);
      countSpy = jest
        .spyOn(AIRunService, "countClaimableCodeFixRuns")
        .mockResolvedValue(0);
    });

    test.each([
      [[RunnerCodeFixCapability.ServerOpensPullRequests], true],
      [[], false],
      [undefined, false],
      [["somethingNewer"], false],
    ])(
      "declaring %j: %s",
      async (capabilities: unknown, pushesWithRunTokens: boolean) => {
        const body: JSONObject =
          capabilities === undefined
            ? {}
            : {
                [RUNNER_CODE_FIX_CAPABILITIES_FIELD]: capabilities as never,
              };

        await post("/ai-agent-task/get-pending-task", body);
        await post("/ai-agent-task/get-pending-task-count", body);

        expect(
          (claimSpy.mock.calls[0]![0] as { pushesWithRunTokens: boolean })
            .pushesWithRunTokens,
        ).toBe(pushesWithRunTokens);
        expect(
          (countSpy.mock.calls[0]![0] as { pushesWithRunTokens: boolean })
            .pushesWithRunTokens,
        ).toBe(pushesWithRunTokens);
      },
    );
  });
});
