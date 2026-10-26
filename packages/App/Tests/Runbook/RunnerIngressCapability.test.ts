import RunnerService from "Common/Server/Services/RunnerService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import CodeRepositoryRunnerChoice from "Common/Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import Runner from "Common/Models/DatabaseModels/Runner";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
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
 * Regression tests for the Runner capability toggles on the agent ingress.
 *
 * Runner.canRunRunbooks used to be decorative: the dashboard let an
 * operator flip it, but no server code ever read it, so revoking a
 * capability did nothing. Two things now make it real:
 *
 *   1. POST /claim-next-job rejects an agent whose row says
 *      canRunRunbooks === false — BEFORE RunnerJobService.claimNextJob
 *      runs, so a revoked Runner can never lease work.
 *   2. POST /heartbeat answers with the granted capabilities so the Runner
 *      adopts the dashboard's decision on its next boot.
 *
 * canRunRunbooks defaults ON (undefined column = pre-migration row = the
 * reason people install a Runner). AI code fixes are not a switch: the
 * heartbeat tells a Runner canRunCodeFixTasks exactly while a code
 * repository of its project picks it (its Runner setting in Code) - off for
 * every other Runner, since it clones repositories and opens pull requests.
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
const CLAIM_ROUTE: string = "/claim-next-job";

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
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

/*
 * The ingress handlers read req.runner, which the auth middleware
 * (RunnerAuthorization.isAuthorizedAgent) sets from the row it loaded.
 * The middleware is not under test here, so the request is constructed with
 * the property already populated — exactly what the handler receives.
 */
async function callRoute(data: {
  uri: string;
  agent?: Runner | undefined;
  body?: JSONObject | undefined;
}): Promise<RouteCallResult> {
  const req: RunnerExpressRequest = {
    params: {} as Dictionary<string>,
    query: {},
    body: data.body || {},
    headers: {},
    runner: data.agent,
  } as unknown as RunnerExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await matchRoute("POST", data.uri).handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

function lastJsonResponse(): JSONObject {
  const calls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as unknown as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  expect(calls.length).toBeGreaterThan(0);

  return calls[calls.length - 1]![2] as JSONObject;
}

describe("Runner capability enforcement on the agent ingress", () => {
  let agentId: ObjectID;
  let projectId: ObjectID;

  let heartbeatSpy: jest.SpyInstance;
  let claimNextJobSpy: jest.SpyInstance;
  let pickedSpy: jest.SpyInstance;

  /*
   * Fake row as the auth middleware would hand it over. Capability columns
   * are only present when explicitly given, so `undefined` here is exactly
   * the pre-migration / unselected-column case.
   */
  function buildAgent(data: {
    canRunRunbooks?: boolean | undefined;
    name?: string | undefined;
  }): Runner {
    return {
      id: agentId,
      projectId: projectId,
      name: data.name || "test-runner",
      ...(data.canRunRunbooks !== undefined
        ? { canRunRunbooks: data.canRunRunbooks }
        : {}),
    } as unknown as Runner;
  }

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunnerIngressAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    agentId = ObjectID.generate();
    projectId = ObjectID.generate();

    heartbeatSpy = jest
      .spyOn(RunnerService, "heartbeat")
      .mockResolvedValue(undefined);
    claimNextJobSpy = jest
      .spyOn(RunnerJobService, "claimNextJob")
      .mockResolvedValue(null);
    // No code repository picks the Runner unless a test says one does.
    pickedSpy = jest
      .spyOn(CodeRepositoryRunnerChoice, "doesRunnerWorkInARepository")
      .mockResolvedValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("POST /claim-next-job gates on canRunRunbooks", () => {
    /*
     * The load-bearing assertion: claimNextJob was NEVER called. The revoked
     * Runner is answered "no work for you" rather than an error, because it
     * polls every few seconds and a rejection would be an error-level log
     * flood on both sides — but it must still never receive a lease.
     */
    test("hands an agent with canRunRunbooks === false no job, and never claims one", async () => {
      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: false }),
      });

      expect(result.nextCallCount).toBe(0);
      expect(claimNextJobSpy).not.toHaveBeenCalled();
      expect(lastJsonResponse()).toEqual({ job: null });
    });

    test("lets an agent with canRunRunbooks === true claim", async () => {
      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: true }),
      });

      expect(result.nextCallCount).toBe(0);
      expect(claimNextJobSpy).toHaveBeenCalledTimes(1);
      expect(lastJsonResponse()).toEqual({ job: null });
    });

    /*
     * A pre-migration row (or an unselected column) yields undefined. That
     * must still be allowed — only an explicit dashboard revoke gates.
     */
    test("lets an agent with canRunRunbooks undefined claim (pre-migration default)", async () => {
      const result: RouteCallResult = await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({}),
      });

      expect(result.nextCallCount).toBe(0);
      expect(claimNextJobSpy).toHaveBeenCalledTimes(1);
    });

    test("claims with the authenticated agent's own id and project", async () => {
      await callRoute({
        uri: CLAIM_ROUTE,
        agent: buildAgent({ canRunRunbooks: true }),
      });

      const claimArgs: { agentId: ObjectID; projectId: ObjectID } =
        claimNextJobSpy.mock.calls[0]![0] as {
          agentId: ObjectID;
          projectId: ObjectID;
        };

      expect(claimArgs.agentId.toString()).toBe(agentId.toString());
      expect(claimArgs.projectId.toString()).toBe(projectId.toString());
    });
  });

  describe("POST /heartbeat reports granted capabilities", () => {
    /*
     * The column undefined and no repository picking the Runner: runbooks
     * ON (that is why the Runner was installed), code fixes OFF (it clones
     * repositories and opens pull requests, only for one that picks it).
     */
    test("defaults to canRunRunbooks true and canRunCodeFixTasks false while no repository picks it", async () => {
      const result: RouteCallResult = await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: buildAgent({}),
      });

      expect(result.nextCallCount).toBe(0);
      expect(lastJsonResponse()).toEqual({
        status: "ok",
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: false,
          canRunAiCommands: false,
        },
      });
    });

    test("reports canRunCodeFixTasks on while a code repository of its project picks it", async () => {
      pickedSpy.mockResolvedValue(true);

      await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: buildAgent({ canRunRunbooks: true }),
      });

      expect(lastJsonResponse()).toEqual({
        status: "ok",
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: true,
          canRunAiCommands: false,
        },
      });

      // Asked for this Runner, in its own project.
      const asked: { id: ObjectID; projectId: ObjectID } = pickedSpy.mock
        .calls[0]![0] as { id: ObjectID; projectId: ObjectID };

      expect(asked.id.toString()).toBe(agentId.toString());
      expect(asked.projectId.toString()).toBe(projectId.toString());
    });

    /*
     * A runbook-revoked Runner keeps heartbeating (claiming is the only
     * gate, so a revoke mid-run can still land its result) — and the
     * heartbeat is exactly how the revoke reaches the Runner. The code
     * work a repository gives it is separate.
     */
    test("reports canRunRunbooks false for a revoked agent while the heartbeat itself still succeeds", async () => {
      pickedSpy.mockResolvedValue(true);

      const result: RouteCallResult = await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: buildAgent({ canRunRunbooks: false }),
      });

      expect(result.nextCallCount).toBe(0);
      expect(heartbeatSpy).toHaveBeenCalledTimes(1);
      expect(lastJsonResponse()).toEqual({
        status: "ok",
        capabilities: {
          canRunRunbooks: false,
          canRunCodeFixTasks: true,
          canRunAiCommands: false,
        },
      });
    });

    /*
     * An in-cluster Runner the Kubernetes agent chart installed never takes
     * code work: the repositories are not even asked about it, and a pick
     * that somehow names it gives it nothing.
     */
    test("never tells a Kubernetes agent Runner to take code work, and does not ask", async () => {
      pickedSpy.mockResolvedValue(true);

      await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: buildAgent({ name: "kubernetes-agent/prod-east" }),
      });

      expect(pickedSpy).not.toHaveBeenCalled();
      expect(
        (lastJsonResponse()["capabilities"] as JSONObject)[
          "canRunCodeFixTasks"
        ],
      ).toBe(false);
      expect(
        RunnerIngressAPI.getHeartbeatAnswer(
          buildAgent({ name: "kubernetes-agent/prod-east" }),
          { isPickedByACodeRepository: true },
        ),
      ).toEqual({
        status: "ok",
        capabilities: {
          canRunRunbooks: true,
          canRunCodeFixTasks: false,
          canRunAiCommands: false,
        },
      });
    });

    test("a repository read that fails is the heartbeat's error, not a silent grant", async () => {
      pickedSpy.mockRejectedValue(new Error("database down"));

      const result: RouteCallResult = await callRoute({
        uri: HEARTBEAT_ROUTE,
        agent: buildAgent({}),
      });

      expect(result.nextCallCount).toBe(1);
      expect((result.thrownToNext as Error).message).toBe("database down");
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  describe("RunnerService.findByIdAndKey loads the capability columns", () => {
    /*
     * The auth middleware sets req.runner from this read. If the
     * select ever drops the capability columns, the route sees undefined —
     * which the claim gate treats as allowed — and a dashboard revoke
     * silently stops working. Pin the select.
     */
    test("selects canRunRunbooks, and what tells an agent row apart", async () => {
      const findOneBySpy: jest.SpyInstance = jest
        .spyOn(RunnerService, "findOneBy")
        .mockResolvedValue(null);

      await RunnerService.findByIdAndKey({
        agentId: agentId,
        agentKey: "some-agent-key",
      });

      expect(findOneBySpy).toHaveBeenCalledTimes(1);

      const findArgs: { select: Dictionary<boolean> } = findOneBySpy.mock
        .calls[0]![0] as { select: Dictionary<boolean> };

      expect(findArgs.select["canRunRunbooks"]).toBe(true);
      // What the heartbeat's code-fix answer reads besides the repositories.
      expect(findArgs.select["projectId"]).toBe(true);
      expect(findArgs.select["name"]).toBe(true);
      expect(findArgs.select["hostInfo"]).toBe(true);
      expect(findArgs.select["isGlobalRunner"]).toBe(true);
      // The switch is gone: a repository picks its Runner.
      expect(findArgs.select["canRunCodeFixTasks"]).toBeUndefined();
    });
  });
});
