import { mockRouter } from "./Helpers";
import AIAgentAPI from "../../../Server/API/AIAgentAPI";
import ProbeAPI from "../../../Server/API/ProbeAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIAgentService from "../../../Server/Services/AIAgentService";
import ProbeService from "../../../Server/Services/ProbeService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIAgent from "../../../Models/DatabaseModels/AIAgent";
import Probe from "../../../Models/DatabaseModels/Probe";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserType from "../../../Types/UserType";
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
 * THE SHARED GLOBAL PROBES AND AI AGENTS ARE LISTED TO SIGNED-IN CALLERS,
 * BY A FIXED SET OF THEIR COLUMNS.
 *
 * Global probes and AI agents belong to no project, so the pages that offer
 * them (a monitor's probe picker, Settings → Probes) read them through
 * routes of their own, as OneUptime. Those routes now ask who the caller is
 * and that they are signed in before they answer, the way the global LLM
 * providers' route does, and read the global rows only, never a key or a
 * version.
 */

const GLOBAL_PROBES_ROUTE: string = "/probe/global-probes";
const GLOBAL_AI_AGENTS_ROUTE: string = "/ai-agent/global-ai-agents";

interface FindCall {
  query: JSONObject;
  select: JSONObject;
  props: JSONObject;
}

describe("the global probe and AI agent lists", () => {
  let probeFindBy: jest.SpyInstance;
  let aiAgentFindBy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new ProbeAPI();
    new AIAgentAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    probeFindBy = jest
      .spyOn(ProbeService, "findBy")
      .mockResolvedValue([new Probe()] as never);
    jest
      .spyOn(ProbeService, "countBy")
      .mockResolvedValue(new PositiveNumber(1) as never);
    aiAgentFindBy = jest
      .spyOn(AIAgentService, "findBy")
      .mockResolvedValue([new AIAgent()] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([GLOBAL_PROBES_ROUTE, GLOBAL_AI_AGENTS_ROUTE])(
    "%s asks who the caller is, and that they are signed in, before it answers",
    (route: string) => {
      expect(mockRouter.match("post", route).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    },
  );

  test("a caller who is not signed in is asked to sign in, and nothing is read", async () => {
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await UserMiddleware.requireUserAuthentication(
      { userType: UserType.Public, headers: {} } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(
      (Response.sendErrorResponse as unknown as jest.Mock).mock.calls[0]![2],
    ).toBeInstanceOf(NotAuthenticatedException);
    expect(probeFindBy).not.toHaveBeenCalled();
    expect(aiAgentFindBy).not.toHaveBeenCalled();
  });

  test.each([UserType.User, UserType.API])(
    "a caller signed in as %s is let through to the list",
    async (userType: UserType) => {
      const next: NextFunction = jest.fn() as unknown as NextFunction;

      await UserMiddleware.requireUserAuthentication(
        { userType: userType, headers: {} } as unknown as ExpressRequest,
        {} as ExpressResponse,
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
    },
  );

  test("the probe list reads only global probes, never a key or a version", async () => {
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter.match("post", GLOBAL_PROBES_ROUTE).handlerFunction(
      {
        // A caller asking for more than the list serves.
        body: {
          select: {
            name: true,
            key: true,
            probeVersion: true,
            projectId: true,
          },
        },
        query: {},
        headers: {},
      } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(probeFindBy).toHaveBeenCalledTimes(1);

    const call: FindCall = probeFindBy.mock.calls[0]![0] as FindCall;

    expect(call.query).toEqual({ isGlobalProbe: true });
    expect(call.select).toEqual({ name: true });
    expect(call.props).toEqual({ isRoot: true });
  });

  test("the AI agent list reads only global agents, by name, description and status", async () => {
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter
      .match("post", GLOBAL_AI_AGENTS_ROUTE)
      .handlerFunction(
        { body: {}, query: {}, headers: {} } as unknown as ExpressRequest,
        {} as ExpressResponse,
        next,
      );

    expect(next).not.toHaveBeenCalled();
    expect(aiAgentFindBy).toHaveBeenCalledTimes(1);

    const call: FindCall = aiAgentFindBy.mock.calls[0]![0] as FindCall;

    expect(call.query).toEqual({ isGlobalAIAgent: true });
    expect(call.select).toEqual({
      name: true,
      description: true,
      lastAlive: true,
      iconFileId: true,
      connectionStatus: true,
    });
    expect(Object.keys(call.select)).not.toContain("key");
    expect(Object.keys(call.select)).not.toContain("aiAgentVersion");
    expect(call.props).toEqual({ isRoot: true });
  });
});
