import { mockRouter } from "./Helpers";
import RunnerAPI from "../../../Server/API/RunnerAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import RunnerService, {
  GLOBAL_RUNNER_PUBLIC_SELECT,
} from "../../../Server/Services/RunnerService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Runner from "../../../Models/DatabaseModels/Runner";
import { JSONObject } from "../../../Types/JSON";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 * THE GLOBAL RUNNERS ARE LISTED TO SIGNED-IN CALLERS, BY A FIXED SET OF
 * THEIR COLUMNS.
 *
 * Global Runners - the ones OneUptime runs for every project - belong to no
 * project, so the Runners page and the step editor's Runner picker read them
 * through a route of their own, as OneUptime, as the global probes are read:
 * for anyone signed in, the global rows only, by the columns of
 * GLOBAL_RUNNER_PUBLIC_SELECT - never a key, a host or a version, whatever
 * the request asks for.
 */

const GLOBAL_RUNNERS_ROUTE: string = "/runner/global-runners";

interface FindCall {
  query: JSONObject;
  select: JSONObject;
  props: JSONObject;
}

describe("the global Runners list", () => {
  let findBy: jest.SpyInstance;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    new RunnerAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    const runner: Runner = new Runner();
    runner.name = "global-runner-eu";

    findBy = jest
      .spyOn(RunnerService, "findBy")
      .mockResolvedValue([runner] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("asks who the caller is, and that they are signed in, before it answers", () => {
    expect(mockRouter.match("post", GLOBAL_RUNNERS_ROUTE).middlewares).toEqual([
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
    ]);
  });

  test("reads only global Runners, as OneUptime, by the public columns, whatever the caller asks for", async () => {
    const next: NextFunction = jest.fn() as unknown as NextFunction;

    await mockRouter.match("post", GLOBAL_RUNNERS_ROUTE).handlerFunction(
      {
        // A caller asking for more than the list serves.
        body: {
          query: { isGlobalRunner: false, projectId: "x" },
          select: { name: true, key: true, hostInfo: true },
        },
        query: {},
        headers: {},
      } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(findBy).toHaveBeenCalledTimes(1);

    const call: FindCall = findBy.mock.calls[0]![0] as FindCall;

    expect(call.query).toEqual({ isGlobalRunner: true });
    expect(call.select).toBe(GLOBAL_RUNNER_PUBLIC_SELECT);
    expect(Object.keys(call.select)).not.toContain("key");
    expect(Object.keys(call.select)).not.toContain("hostInfo");
    expect(Object.keys(call.select)).not.toContain("agentVersion");
    expect(call.props).toEqual({ isRoot: true });
  });

  test("answers with the rows and how many there are", async () => {
    await mockRouter
      .match("post", GLOBAL_RUNNERS_ROUTE)
      .handlerFunction(
        { body: {}, query: {}, headers: {} } as unknown as ExpressRequest,
        {} as ExpressResponse,
        jest.fn() as unknown as NextFunction,
      );

    const call: Array<unknown> = (
      Response.sendEntityArrayResponse as unknown as jest.Mock
    ).mock.calls[0] as Array<unknown>;

    expect((call[2] as Array<Runner>).length).toBe(1);
    expect((call[3] as PositiveNumber).toNumber()).toBe(1);
    expect(call[4]).toBe(Runner);
  });

  test("a read that fails is handed on, not swallowed", async () => {
    findBy.mockRejectedValue(new Error("down") as never);
    const next: jest.Mock = jest.fn();

    await mockRouter
      .match("post", GLOBAL_RUNNERS_ROUTE)
      .handlerFunction(
        { body: {}, query: {}, headers: {} } as unknown as ExpressRequest,
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

    expect(next).toHaveBeenCalledTimes(1);
    expect(Response.sendEntityArrayResponse).not.toHaveBeenCalled();
  });

  test("the Runner table's own CRUD routes are still served", () => {
    expect(() => {
      mockRouter.match("post", "/runner/get-list");
    }).not.toThrow();
    expect(() => {
      mockRouter.match("post", "/runner");
    }).not.toThrow();
  });
});
