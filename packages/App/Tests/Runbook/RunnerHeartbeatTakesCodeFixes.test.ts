import RunnerService from "Common/Server/Services/RunnerService";
import Runner from "Common/Models/DatabaseModels/Runner";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Version from "Common/Types/Version";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * POST /heartbeat stores whether the Runner takes AI code fixes.
 *
 * A Runner says it on registration and on every heartbeat (`takesCodeFixes`,
 * packages/Runner RunnerCapabilities.takesCodeFixes): false while
 * ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false refuses them on its host. The
 * server counts a Runner as there to take a repository's fixes only by it
 * (Common/Types/Runner/RunnerCodeFixes), so the key is pinned here as the
 * Runner sends it - a rename on either end would fail silently, as
 * `agentVersion`'s would (RunnerHeartbeatVersionWireField).
 *
 * Anything but a boolean is the Runner saying nothing - a release from
 * before the report - and is stored as nothing, never as what an earlier
 * release said: the release it reports then decides
 * (RunnerCodeFixes, a Runner that said nothing).
 * ---------------------------------------------------------------------------
 */

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

type MockRoute = {
  method: string;
  uri: string;
  middleware: RouterFunction;
  handlerFunction: RouterFunction;
};

type MockRouter = {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

const mockRoutes: Array<MockRoute> = [];

type RegisterRouteFunction = (
  method: string,
) => (
  uri: string,
  middleware: RouterFunction,
  handlerFunction: RouterFunction,
) => void;

const registerRoute: RegisterRouteFunction = (method: string) => {
  return (
    uri: string,
    middleware: RouterFunction,
    handlerFunction: RouterFunction,
  ): void => {
    mockRoutes.push({
      method: method.toUpperCase(),
      uri,
      middleware,
      handlerFunction,
    });
  };
};

const mockRouter: MockRouter = {
  get: jest.fn().mockImplementation(registerRoute("get")),
  post: jest.fn().mockImplementation(registerRoute("post")),
  put: jest.fn().mockImplementation(registerRoute("put")),
  delete: jest.fn().mockImplementation(registerRoute("delete")),
};

jest.mock("Common/Server/Utils/Express", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Utils/Express",
  ) as Record<string, unknown>;

  return {
    ...actual,
    __esModule: true,
    default: {
      ...((actual["default"] as Record<string, unknown>) || {}),
      getRouter: (): MockRouter => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
    },
  };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import RunnerIngressAPI from "../../FeatureSet/Runbook/API/RunnerIngress";
import { RunnerExpressRequest } from "../../FeatureSet/Runbook/Types/Request";

const HEARTBEAT_ROUTE: string = "/heartbeat";

type HeartbeatArgs = {
  agentId: ObjectID;
  agentVersion?: Version | undefined;
  hostInfo?: JSONObject | undefined;
  takesCodeFixes?: boolean | null | undefined;
};

function matchRoute(method: string, uri: string): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find((route: MockRoute) => {
    return route.method === method.toUpperCase() && route.uri === uri;
  });

  if (!route) {
    throw new Error(`Route ${method} ${uri} was never registered`);
  }

  return route;
}

describe("POST /heartbeat stores whether the Runner takes AI code fixes", () => {
  let heartbeatSpy: jest.SpyInstance;

  function buildRunner(isGlobalRunner: boolean): Runner {
    return {
      id: ObjectID.generate(),
      ...(isGlobalRunner ? {} : { projectId: ObjectID.generate() }),
      name: isGlobalRunner ? "Global Runner" : "office-runner",
      isGlobalRunner,
    } as unknown as Runner;
  }

  async function postHeartbeat(
    body: JSONObject,
    isGlobalRunner: boolean = false,
  ): Promise<HeartbeatArgs> {
    const req: RunnerExpressRequest = {
      params: {} as Dictionary<string>,
      query: {},
      body: body,
      headers: {},
      runner: buildRunner(isGlobalRunner),
    } as unknown as RunnerExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    const next: jest.Mock = jest.fn();

    await matchRoute("POST", HEARTBEAT_ROUTE).handlerFunction(
      req,
      res,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(heartbeatSpy).toHaveBeenCalledTimes(1);

    return heartbeatSpy.mock.calls[0]![0] as HeartbeatArgs;
  }

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    heartbeatSpy = jest
      .spyOn(RunnerService, "heartbeat")
      .mockResolvedValue(undefined);

    // A project's Runner asks whether a repository picks it.
    jest
      .spyOn(RunnerIngressAPI, "isPickedByACodeRepository")
      .mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([true, false])(
    "a Runner that says %s is stored as saying it, under the key it sends",
    async (takesCodeFixes: boolean) => {
      const args: HeartbeatArgs = await postHeartbeat({
        agentVersion: "14.0.102",
        takesCodeFixes,
      });

      expect(args.takesCodeFixes).toBe(takesCodeFixes);
      expect(args.agentVersion!.toString()).toBe("14.0.102");
    },
  );

  test("a global Runner's word is stored the same way", async () => {
    expect(
      (await postHeartbeat({ takesCodeFixes: false }, true)).takesCodeFixes,
    ).toBe(false);
  });

  /*
   * An older Runner sends no key. Stored as nothing - the column is cleared,
   * not left at what the Runner said before it was put back on an older
   * release.
   */
  test("a Runner that sends nothing is stored as saying nothing", async () => {
    const args: HeartbeatArgs = await postHeartbeat({
      agentVersion: "14.0.93",
    });

    expect(Object.keys(args)).toContain("takesCodeFixes");
    expect(args.takesCodeFixes).toBeNull();
  });

  test.each([
    ["a string", "false"],
    ["a number", 0],
    ["null", null],
    ["an object", { codeFixes: false }],
  ])(
    "%s is no answer, and is stored as nothing",
    async (_label: string, value: unknown) => {
      const args: HeartbeatArgs = await postHeartbeat({
        takesCodeFixes: value,
      } as JSONObject);

      expect(args.takesCodeFixes).toBeNull();
    },
  );

  test("the key is takesCodeFixes, never a near miss", async () => {
    for (const key of ["takesCodeFix", "codeFixes", "canRunCodeFixTasks"]) {
      jest.clearAllMocks();

      expect(
        (await postHeartbeat({ [key]: false } as JSONObject)).takesCodeFixes,
      ).toBeNull();
    }
  });

  /*
   * What the Runner says never changes what it is granted: the heartbeat's
   * answer is the server's to give, and the Runner narrows it on its side.
   */
  test("what it says changes nothing in what it is granted", () => {
    const globalRunner: Runner = buildRunner(true);

    expect(
      (
        RunnerIngressAPI.getHeartbeatAnswer(globalRunner)[
          "capabilities"
        ] as JSONObject
      )["canRunCodeFixTasks"],
    ).toBe(true);
  });
});
