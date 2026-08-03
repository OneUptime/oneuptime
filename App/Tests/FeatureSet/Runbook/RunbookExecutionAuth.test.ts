import RunbookAPI from "../../../FeatureSet/Runbook/API/Runbook";
import RunRunbook from "../../../FeatureSet/Runbook/Services/RunRunbook";
import CommonAPI from "Common/Server/API/CommonAPI";
import RunbookService from "Common/Server/Services/RunbookService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";
import { RUNBOOK_EXECUTE_PERMISSIONS } from "Common/Server/Utils/Runbook/RunbookExecutePermission";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { RunbookStep } from "Common/Types/Runbook/RunbookStep";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
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
 * Regression tests for the Runbook execution routes.
 *
 * Before the fix every route here had only UserMiddleware.getUserMiddleware in
 * front of it — a context *loader*, not a gate. A request with no cookie, no
 * bearer token and no apikey header is tagged UserType.Public and passed
 * through, and the project it acts on comes from a caller-supplied `tenantid`
 * header. So POST /runbook/run/:runbookId executed pre-authored Bash and
 * JavaScript on customer infrastructure with NO LOGIN AT ALL, and
 * complete/skip/cancel additionally skipped the tenant check entirely when no
 * tenantid header was sent.
 *
 * Starting (or resuming) an execution runs the project's own scripts on the
 * machines its Runner is installed on, so the load-bearing assertion in every
 * deny case below is that RunRunbook.startExecution was NEVER called (and no
 * execution row was created / mutated). An error response on its own would not
 * prove the work was stopped.
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
 * The execution engine is not under test — what matters is whether the handler
 * ever reaches it. Mocking the module also keeps BullMQ (pulled in through
 * QueueRunbook at import time) out of this suite entirely.
 */
jest.mock("../../../FeatureSet/Runbook/Services/RunRunbook", () => {
  return {
    __esModule: true,
    default: {
      startExecution: jest.fn(),
    },
  };
});

const startExecutionMock: jest.Mock =
  RunRunbook.startExecution as unknown as jest.Mock;

const RUN_ROUTE: string = "/run/:runbookId";
const COMPLETE_ROUTE: string = "/execution/:executionId/step/:stepId/complete";
const SKIP_ROUTE: string = "/execution/:executionId/step/:stepId/skip";
const CANCEL_ROUTE: string = "/execution/:executionId/cancel";

const ALL_ROUTES: Array<string> = [
  RUN_ROUTE,
  COMPLETE_ROUTE,
  SKIP_ROUTE,
  CANCEL_ROUTE,
];

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

function matchRoute(uri: string): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find((route: MockRoute) => {
    return route.method === "POST" && route.uri === uri;
  });

  if (!route) {
    throw new Error(`Route POST ${uri} was never registered`);
  }

  return route;
}

async function callRoute(data: {
  uri: string;
  params: Dictionary<string>;
  body?: JSONObject | undefined;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: data.params,
    query: {},
    body: data.body || {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await matchRoute(data.uri).handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

function buildTenantPermission(data: {
  projectId: ObjectID;
  permissions: Array<Permission>;
}): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: data.permissions.map((permission: Permission) => {
      const userPermission: UserPermission = {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
      };

      return userPermission;
    }),
  };
}

/*
 * Shaped like what CommonAPI.getDatabaseCommonInteractionProps returns for a
 * logged-in dashboard user whose request carried a `tenantid` header.
 */
function buildUserProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[data.projectId.toString()] = buildTenantPermission({
    projectId: data.projectId,
    permissions: data.permissions,
  });

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userType: data.isMasterAdmin ? UserType.MasterAdmin : UserType.User,
    userTenantAccessPermission: permissionMap,
    ...(data.isMasterAdmin ? { isMasterAdmin: true } : {}),
  };
}

describe("Runbook execution routes require an authorized member of the runbook's own project", () => {
  let callerProjectId: ObjectID;
  let otherProjectId: ObjectID;
  let callerUserId: ObjectID;
  let runbookId: ObjectID;
  let executionId: ObjectID;

  let getPropsSpy: jest.SpyInstance;
  let runbookFindSpy: jest.SpyInstance;
  let executionFindSpy: jest.SpyInstance;
  let executionCreateSpy: jest.SpyInstance;
  let executionUpdateSpy: jest.SpyInstance;
  let cancelJobsSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunbookAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    callerProjectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    callerUserId = ObjectID.generate();
    runbookId = ObjectID.generate();
    executionId = ObjectID.generate();

    startExecutionMock.mockResolvedValue(undefined);

    getPropsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");

    /*
     * Default every service read/write to a harmless stub so no code path can
     * fall through to a real database. Individual tests override as needed.
     */
    runbookFindSpy = jest
      .spyOn(RunbookService, "findOneById")
      .mockResolvedValue(null);
    executionFindSpy = jest
      .spyOn(RunbookExecutionService, "findOneById")
      .mockResolvedValue(null);
    executionCreateSpy = jest
      .spyOn(RunbookExecutionService, "create")
      .mockImplementation((async (args: {
        data: RunbookExecution;
      }): Promise<RunbookExecution> => {
        (args.data as unknown as { _id: string })._id = executionId.toString();
        return args.data;
      }) as unknown as typeof RunbookExecutionService.create);
    executionUpdateSpy = jest
      .spyOn(RunbookExecutionService, "updateOneById")
      .mockResolvedValue(undefined as never);
    cancelJobsSpy = jest
      .spyOn(RunbookAgentJobService, "cancelJobsForExecution")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockProps(props: DatabaseCommonInteractionProps): void {
    getPropsSpy.mockResolvedValue(props);
  }

  function makeSteps(): Array<RunbookStep> {
    return [
      {
        id: "step-1",
        order: 1,
        type: RunbookStepType.Manual,
        title: "Check the dashboards",
        config: {},
      },
      {
        id: "step-2",
        order: 2,
        type: RunbookStepType.Bash,
        title: "Restart the web tier",
        config: { script: "systemctl restart web", agentId: "agent-1" },
      },
    ] as Array<RunbookStep>;
  }

  function mockRunbookInProject(projectId: ObjectID): void {
    runbookFindSpy.mockResolvedValue({
      _id: runbookId.toString(),
      projectId: projectId,
      name: "Restart web tier",
      isEnabled: true,
      steps: makeSteps(),
    } as unknown as Runbook);
  }

  function mockExecutionInProject(data: {
    projectId: ObjectID;
    status?: RunbookExecutionStatus | undefined;
    stepStatus?: RunbookStepExecutionStatus | undefined;
  }): void {
    const stepExecutions: Array<RunbookStepExecutionState> = makeSteps().map(
      (step: RunbookStep): RunbookStepExecutionState => {
        return {
          step,
          status: data.stepStatus || RunbookStepExecutionStatus.WaitingForUser,
        };
      },
    );

    executionFindSpy.mockResolvedValue({
      _id: executionId.toString(),
      projectId: data.projectId,
      status: data.status || RunbookExecutionStatus.Running,
      stepExecutions,
    } as unknown as RunbookExecution);
  }

  function memberProps(permissions: Array<Permission>): void {
    mockProps(
      buildUserProps({
        projectId: callerProjectId,
        userId: callerUserId,
        permissions,
      }),
    );
  }

  function runParams(): Dictionary<string> {
    return { runbookId: runbookId.toString() };
  }

  function stepParams(): Dictionary<string> {
    return { executionId: executionId.toString(), stepId: "step-1" };
  }

  function cancelParams(): Dictionary<string> {
    return { executionId: executionId.toString() };
  }

  function paramsForRoute(uri: string): Dictionary<string> {
    if (uri === RUN_ROUTE) {
      return runParams();
    }
    if (uri === CANCEL_ROUTE) {
      return cancelParams();
    }
    return stepParams();
  }

  function expectNothingExecutedOrMutated(): void {
    expect(startExecutionMock).not.toHaveBeenCalled();
    expect(executionCreateSpy).not.toHaveBeenCalled();
    expect(executionUpdateSpy).not.toHaveBeenCalled();
    expect(cancelJobsSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  }

  describe("route wiring", () => {
    test("registers all four POST routes with a context-loading middleware in front", () => {
      for (const uri of ALL_ROUTES) {
        const route: MockRoute = matchRoute(uri);
        expect(typeof route.middleware).toBe("function");
        expect(typeof route.handlerFunction).toBe("function");
      }
    });
  });

  describe("REGRESSION — unauthenticated callers (the vulnerability)", () => {
    /*
     * The original attack verbatim: no cookie, no bearer token, no apikey —
     * getUserMiddleware tags the request UserType.Public and calls next() —
     * plus a caller-supplied `tenantid` header naming the victim project.
     * Before the fix this started the runbook's Bash/JavaScript steps on the
     * victim's infrastructure. It must be rejected in the handler with
     * nothing enqueued.
     */
    test("VULN REGRESSION: a credential-less POST /run/:runbookId with a victim tenant header is rejected and nothing is enqueued", async () => {
      mockProps({
        userType: UserType.Public,
        tenantId: callerProjectId,
        userId: undefined,
        userTenantAccessPermission: undefined,
      });

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      // Never even reads the runbook, let alone runs it.
      expect(runbookFindSpy).not.toHaveBeenCalled();
      expectNothingExecutedOrMutated();
    });

    test("VULN REGRESSION: a credential-less POST with no tenant header at all is rejected too", async () => {
      mockProps({ userType: UserType.Public });

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(runbookFindSpy).not.toHaveBeenCalled();
      expectNothingExecutedOrMutated();
    });

    test.each(ALL_ROUTES)(
      "VULN REGRESSION: rejects a credential-less caller on POST %s and touches nothing",
      async (uri: string) => {
        mockProps({
          userType: UserType.Public,
          tenantId: callerProjectId,
          userId: undefined,
          userTenantAccessPermission: undefined,
        });

        const result: RouteCallResult = await callRoute({
          uri,
          params: paramsForRoute(uri),
        });

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect(runbookFindSpy).not.toHaveBeenCalled();
        expect(executionFindSpy).not.toHaveBeenCalled();
        expectNothingExecutedOrMutated();
      },
    );

    /*
     * The second half of the original bug: complete/skip/cancel skipped the
     * tenant check entirely when no tenantid header was sent. Now the missing
     * header is itself a rejection, before any row is read.
     */
    test.each([COMPLETE_ROUTE, SKIP_ROUTE, CANCEL_ROUTE])(
      "rejects POST %s when no tenant header is sent, instead of skipping the tenant check",
      async (uri: string) => {
        mockProps({
          userType: UserType.User,
          userId: callerUserId,
          tenantId: undefined,
          userTenantAccessPermission: undefined,
        });

        const result: RouteCallResult = await callRoute({
          uri,
          params: paramsForRoute(uri),
        });

        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect(executionFindSpy).not.toHaveBeenCalled();
        expectNothingExecutedOrMutated();
      },
    );

    test("rejects a logged-in user with no permissions in the claimed tenant", async () => {
      mockProps({
        userType: UserType.User,
        tenantId: callerProjectId,
        userId: callerUserId,
        userTenantAccessPermission: undefined,
      });

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expectNothingExecutedOrMutated();
    });
  });

  describe("permission level within the caller's own project", () => {
    test.each(ALL_ROUTES)(
      "rejects an authenticated project member holding only Viewer on POST %s",
      async (uri: string) => {
        memberProps([Permission.Viewer]);
        mockRunbookInProject(callerProjectId);
        mockExecutionInProject({ projectId: callerProjectId });

        const result: RouteCallResult = await callRoute({
          uri,
          params: paramsForRoute(uri),
        });

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expectNothingExecutedOrMutated();
      },
    );

    test("rejects a member of the right project holding no permissions at all", async () => {
      memberProps([]);
      mockRunbookInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expectNothingExecutedOrMutated();
    });

    /*
     * Pin the shared allow-list itself: every route gates on this one
     * constant, so a change here changes who can run scripts on customer
     * infrastructure.
     */
    test("RUNBOOK_EXECUTE_PERMISSIONS is exactly the six intended permissions", () => {
      expect([...RUNBOOK_EXECUTE_PERMISSIONS].sort()).toEqual(
        [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateRunbookExecution,
          Permission.RunbookAdmin,
          Permission.RunbookMember,
        ].sort(),
      );
    });

    test.each(RUNBOOK_EXECUTE_PERMISSIONS)(
      "allows a project member holding %s to start a run",
      async (permission: Permission) => {
        memberProps([permission]);
        mockRunbookInProject(callerProjectId);

        const result: RouteCallResult = await callRoute({
          uri: RUN_ROUTE,
          params: runParams(),
        });

        expect(result.nextCallCount).toBe(0);
        expect(executionCreateSpy).toHaveBeenCalledTimes(1);
        expect(startExecutionMock).toHaveBeenCalledTimes(1);
        expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

        const startArgs: { runbookExecutionId: ObjectID } = startExecutionMock
          .mock.calls[0]![0] as { runbookExecutionId: ObjectID };
        expect(startArgs.runbookExecutionId.toString()).toBe(
          executionId.toString(),
        );
      },
    );

    /*
     * Running a runbook executes scripts on the project's own infrastructure,
     * so instance-level master admin is deliberately NOT a substitute for a
     * project runbook permission — this is the same gate auto-remediation's
     * approve endpoint has always applied, and the two now share it. A master
     * admin who is also a project owner passes on the ProjectOwner permission
     * like anyone else.
     */
    test("does not let instance master-admin stand in for a project runbook permission", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [],
          isMasterAdmin: true,
        }),
      );
      mockRunbookInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(startExecutionMock).not.toHaveBeenCalled();
    });
  });

  describe("cross-tenant reach", () => {
    /*
     * A real, fully-privileged member of project A pointing the path at
     * project B's runbook id while sending their own tenant header.
     */
    test("rejects a project owner of one project starting another project's runbook", async () => {
      memberProps([Permission.ProjectOwner]);
      mockRunbookInProject(otherProjectId);

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expectNothingExecutedOrMutated();
    });

    test("rejects a member of project A cancelling project B's execution", async () => {
      memberProps([Permission.ProjectOwner]);
      mockExecutionInProject({ projectId: otherProjectId });

      const result: RouteCallResult = await callRoute({
        uri: CANCEL_ROUTE,
        params: cancelParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(executionUpdateSpy).not.toHaveBeenCalled();
      expect(cancelJobsSpy).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test.each([COMPLETE_ROUTE, SKIP_ROUTE])(
      "rejects a member of project A advancing project B's execution via POST %s",
      async (uri: string) => {
        memberProps([Permission.ProjectOwner]);
        mockExecutionInProject({ projectId: otherProjectId });

        const result: RouteCallResult = await callRoute({
          uri,
          params: stepParams(),
        });

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect(executionUpdateSpy).not.toHaveBeenCalled();
        expect(startExecutionMock).not.toHaveBeenCalled();
      },
    );
  });

  describe("session identity is recorded, not the request body's claim", () => {
    test("the created execution records triggeredByUserId from the authenticated session", async () => {
      const attackerClaimedUserId: ObjectID = ObjectID.generate();

      memberProps([Permission.ProjectMember]);
      mockRunbookInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
        body: {
          triggeredByUserId: attackerClaimedUserId.toString(),
        },
      });

      expect(result.nextCallCount).toBe(0);
      expect(executionCreateSpy).toHaveBeenCalledTimes(1);

      const createdData: RunbookExecution = (
        executionCreateSpy.mock.calls[0]![0] as { data: RunbookExecution }
      ).data;

      expect(createdData.triggeredByUserId?.toString()).toBe(
        callerUserId.toString(),
      );
      expect(createdData.triggeredByUserId?.toString()).not.toBe(
        attackerClaimedUserId.toString(),
      );
      // And the execution is pinned to the project the runbook belongs to.
      expect(createdData.projectId?.toString()).toBe(
        callerProjectId.toString(),
      );
    });

    test("completing a manual step records the completer from the session", async () => {
      memberProps([Permission.ProjectMember]);
      mockExecutionInProject({
        projectId: callerProjectId,
        status: RunbookExecutionStatus.Running,
        stepStatus: RunbookStepExecutionStatus.WaitingForUser,
      });

      const result: RouteCallResult = await callRoute({
        uri: COMPLETE_ROUTE,
        params: stepParams(),
        body: { notes: "done by hand" },
      });

      expect(result.nextCallCount).toBe(0);
      expect(executionUpdateSpy).toHaveBeenCalledTimes(1);

      const updatedSteps: Array<RunbookStepExecutionState> = (
        executionUpdateSpy.mock.calls[0]![0] as {
          data: { stepExecutions: Array<RunbookStepExecutionState> };
        }
      ).data.stepExecutions;

      const completed: RunbookStepExecutionState | undefined =
        updatedSteps.find((s: RunbookStepExecutionState) => {
          return s.step.id === "step-1";
        });

      expect(completed?.status).toBe(RunbookStepExecutionStatus.Completed);
      expect(completed?.completedByUserId).toBe(callerUserId.toString());
      // Completing the gated step resumes the execution.
      expect(startExecutionMock).toHaveBeenCalledTimes(1);
    });

    test("an authorized member can cancel their own project's execution", async () => {
      memberProps([Permission.ProjectMember]);
      mockExecutionInProject({
        projectId: callerProjectId,
        status: RunbookExecutionStatus.Running,
      });

      const result: RouteCallResult = await callRoute({
        uri: CANCEL_ROUTE,
        params: cancelParams(),
      });

      expect(result.nextCallCount).toBe(0);
      expect(executionUpdateSpy).toHaveBeenCalledTimes(1);
      expect(cancelJobsSpy).toHaveBeenCalledTimes(1);

      const updateData: { status: RunbookExecutionStatus } = (
        executionUpdateSpy.mock.calls[0]![0] as {
          data: { status: RunbookExecutionStatus };
        }
      ).data;

      expect(updateData.status).toBe(RunbookExecutionStatus.Cancelled);
    });
  });
});
