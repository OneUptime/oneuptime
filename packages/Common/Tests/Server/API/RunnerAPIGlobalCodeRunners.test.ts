import { mockRouter } from "./Helpers";
import RunnerAPI, {
  GLOBAL_CODE_RUNNERS_PATH,
  getGlobalCodeRunnerLiveStatus,
} from "../../../Server/API/RunnerAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIAgentService from "../../../Server/Services/AIAgentService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIAgent, {
  AIAgentConnectionStatus,
} from "../../../Models/DatabaseModels/AIAgent";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * THE GLOBAL RUNNERS FOR CODE, AS A REPOSITORY'S RUNNER PICKER DRAWS THEM.
 *
 * A code repository that picks no Runner works on a global Runner for code:
 * a global AI agent (the installation's bundled Runner, OneUptime Cloud's
 * fleet), which belongs to no project. The picker in a repository's
 * settings draws that choice with how it is doing, so it reads them through
 * this route, as OneUptime, for anyone signed in - and is answered how each
 * one is doing, never a name, a key or a host, whatever the request asks.
 */

const ROUTE: string = `/runner${GLOBAL_CODE_RUNNERS_PATH}`;

function agent(data: {
  connectionStatus?: AIAgentConnectionStatus | undefined;
  lastAlive?: Date | undefined;
}): AIAgent {
  const row: AIAgent = new AIAgent();
  row.name = "oneuptime-cloud-runner-eu";
  row.key = "global-agent-key";
  if (data.connectionStatus) {
    row.connectionStatus = data.connectionStatus;
  }
  if (data.lastAlive) {
    row.lastAlive = data.lastAlive;
  }
  return row;
}

describe("how a global Runner for code is doing", () => {
  test("alive now: connected", () => {
    expect(
      getGlobalCodeRunnerLiveStatus(
        agent({ lastAlive: OneUptimeDate.getCurrentDate() }),
      ),
    ).toBe(RunnerLiveStatus.Connected);
    expect(
      getGlobalCodeRunnerLiveStatus(
        agent({ connectionStatus: AIAgentConnectionStatus.Connected }),
      ),
    ).toBe(RunnerLiveStatus.Connected);
  });

  test("seen before, not now: disconnected; never seen: never connected", () => {
    expect(
      getGlobalCodeRunnerLiveStatus(
        agent({ lastAlive: OneUptimeDate.getSomeMinutesAgo(30) }),
      ),
    ).toBe(RunnerLiveStatus.Disconnected);
    expect(getGlobalCodeRunnerLiveStatus(agent({}))).toBe(
      RunnerLiveStatus.NeverConnected,
    );
  });
});

describe("POST /runner/global-code-runners", () => {
  let findGlobal: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new RunnerAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    findGlobal = jest
      .spyOn(AIAgentService, "findGlobalCodeRunners")
      .mockResolvedValue([
        agent({ lastAlive: OneUptimeDate.getCurrentDate() }),
        agent({}),
      ]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("asks who the caller is, and that they are signed in, before it answers", () => {
    expect(mockRouter.match("post", ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test("answers how each one is doing, and nothing else, whatever the caller asks for", async () => {
    const next: jest.Mock = jest.fn();

    await mockRouter.match("post", ROUTE).handlerFunction(
      {
        body: {
          query: { projectId: "x" },
          select: { name: true, key: true },
        },
        query: {},
        headers: {},
      } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(findGlobal).toHaveBeenCalledTimes(1);
    // The request's own query and select are never handed on.
    expect(findGlobal).toHaveBeenCalledWith();

    const answer: JSONObject = (
      Response.sendJsonObjectResponse as unknown as jest.Mock
    ).mock.calls[0]![2] as JSONObject;

    expect(answer).toEqual({
      globalRunners: [
        { liveStatus: RunnerLiveStatus.Connected },
        { liveStatus: RunnerLiveStatus.NeverConnected },
      ],
    });
    expect(JSON.stringify(answer)).not.toContain("global-agent-key");
    expect(JSON.stringify(answer)).not.toContain("oneuptime-cloud-runner-eu");
  });

  test("none: an empty list", async () => {
    findGlobal.mockResolvedValue([]);

    await mockRouter
      .match("post", ROUTE)
      .handlerFunction(
        { body: {}, query: {}, headers: {} } as unknown as ExpressRequest,
        {} as ExpressResponse,
        jest.fn() as unknown as NextFunction,
      );

    expect(
      (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
        .calls[0]![2],
    ).toEqual({ globalRunners: [] });
  });

  test("a read that fails is handed on, not swallowed", async () => {
    findGlobal.mockRejectedValue(new Error("down") as never);
    const next: jest.Mock = jest.fn();

    await mockRouter
      .match("post", ROUTE)
      .handlerFunction(
        { body: {}, query: {}, headers: {} } as unknown as ExpressRequest,
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

    expect(next).toHaveBeenCalledTimes(1);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});
