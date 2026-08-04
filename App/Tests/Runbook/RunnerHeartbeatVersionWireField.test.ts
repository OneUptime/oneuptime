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
 * POST /heartbeat must keep reading the version out of `agentVersion`.
 *
 * The dashboard label for this value was changed from "Agent Version" to
 * "Runner Version". The obvious follow-up — renaming the field to match the
 * label — is the one change that must never happen without a deprecation
 * window, because it breaks with NO error anywhere:
 *
 *   Runners are containers the customer pulls and upgrades on their own
 *   schedule. An un-redeployed Runner keeps POSTing {"agentVersion": "..."}.
 *   The handler below only builds an update when the body carries a non-empty
 *   string, and spreads it conditionally — so a renamed key produces
 *   `undefined`, the spread contributes nothing, and RunnerService.heartbeat is
 *   still called (lastAlive and connectionStatus still move). The Runner shows
 *   as Connected in the dashboard with a version frozen at whatever it last
 *   reported, forever. HTTP 200. No exception. No log line. No CI signal.
 *
 * TypeScript will not catch it either: RunnerService.heartbeat writes through
 * `update["agentVersion"]` on an object passed as `never`.
 *
 * So these tests drive the real handler and assert on the exact key. The
 * `runnerVersion` case is the regression test for the rename itself: if
 * somebody adds dual-read support later it should be additive, and the
 * assertion here documents that today the new name is simply not accepted.
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

/*
 * Secrets pulls in VMUtil -> isolated-vm, a native binding this suite does not
 * install. The heartbeat path never reaches it.
 */
jest.mock("../../FeatureSet/Runbook/Utils/Secrets", () => {
  return {
    __esModule: true,
    default: {
      loadForAgent: jest.fn(),
      populateInScript: jest.fn(),
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

describe("POST /heartbeat reads the Runner version from `agentVersion`", () => {
  let agentId: ObjectID;
  let heartbeatSpy: jest.SpyInstance;

  /*
   * req.runner as the auth middleware would have set it. The middleware is not
   * under test, so the property is populated directly.
   */
  function buildAgent(): Runner {
    return {
      id: agentId,
      projectId: ObjectID.generate(),
      name: "test-runner",
    } as unknown as Runner;
  }

  async function postHeartbeat(body: JSONObject): Promise<void> {
    const req: RunnerExpressRequest = {
      params: {} as Dictionary<string>,
      query: {},
      body: body,
      headers: {},
      runner: buildAgent(),
    } as unknown as RunnerExpressRequest;

    const res: ExpressResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as ExpressResponse;

    await matchRoute("POST", HEARTBEAT_ROUTE).handlerFunction(
      req,
      res,
      jest.fn() as unknown as NextFunction,
    );
  }

  function lastHeartbeatArgs(): HeartbeatArgs {
    expect(heartbeatSpy).toHaveBeenCalled();

    const calls: Array<Array<unknown>> = heartbeatSpy.mock.calls as Array<
      Array<unknown>
    >;

    return calls[calls.length - 1]![0] as HeartbeatArgs;
  }

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    agentId = ObjectID.generate();

    heartbeatSpy = jest
      .spyOn(RunnerService, "heartbeat")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("persists the version a Runner posts under `agentVersion`", async () => {
    await postHeartbeat({ agentVersion: "7.4.1" });

    const args: HeartbeatArgs = lastHeartbeatArgs();

    expect(args.agentVersion).toBeInstanceOf(Version);
    expect(args.agentVersion!.toString()).toBe("7.4.1");
    expect(args.agentId.toString()).toBe(agentId.toString());
  });

  /*
   * The rename regression test. If a future edit renames the wire field, this
   * flips green->red here instead of going unnoticed in production.
   */
  test("does NOT read the version from `runnerVersion`", async () => {
    await postHeartbeat({ runnerVersion: "7.4.1" });

    expect(lastHeartbeatArgs().agentVersion).toBeUndefined();
  });

  /*
   * The silent-failure shape itself, pinned: an unrecognised key still yields a
   * successful heartbeat. This is WHY the field cannot be renamed casually —
   * the failure produces no signal at all.
   */
  test("still records the heartbeat when the version key is unrecognised", async () => {
    await postHeartbeat({ runnerVersion: "7.4.1" });

    expect(heartbeatSpy).toHaveBeenCalledTimes(1);
    expect(lastHeartbeatArgs().agentId.toString()).toBe(agentId.toString());
  });

  test("omits the version entirely when the body carries none", async () => {
    await postHeartbeat({});

    const args: HeartbeatArgs = lastHeartbeatArgs();

    expect(heartbeatSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(args)).not.toContain("agentVersion");
  });

  /*
   * An empty or non-string value must not overwrite a good stored version with
   * a bogus one — the guard is `typeof === "string" && length > 0`.
   */
  test.each([
    ["an empty string", ""],
    ["a number", 741],
    ["null", null],
  ])("ignores %s as the version", async (_label: string, value: unknown) => {
    await postHeartbeat({ agentVersion: value } as JSONObject);

    expect(heartbeatSpy).toHaveBeenCalledTimes(1);
    expect(Object.keys(lastHeartbeatArgs())).not.toContain("agentVersion");
  });

  test("passes hostInfo through alongside the version, unchanged", async () => {
    await postHeartbeat({
      agentVersion: "7.4.1",
      hostInfo: { hostname: "runner-1", platform: "linux" },
    });

    const args: HeartbeatArgs = lastHeartbeatArgs();

    expect(args.agentVersion!.toString()).toBe("7.4.1");
    expect(args.hostInfo).toEqual({ hostname: "runner-1", platform: "linux" });
  });
});
