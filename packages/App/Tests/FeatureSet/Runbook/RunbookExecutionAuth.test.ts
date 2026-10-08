import RunbookAPI from "../../../FeatureSet/Runbook/API/Runbook";
import RunRunbook from "../../../FeatureSet/Runbook/Services/RunRunbook";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseService from "Common/Server/Services/DatabaseService";
import IncidentService from "Common/Server/Services/IncidentService";
import RunbookService from "Common/Server/Services/RunbookService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunnerJobService from "Common/Server/Services/RunnerJobService";
import {
  RUNBOOK_ADVANCE_PERMISSIONS,
  RUNBOOK_EXECUTE_PERMISSIONS,
} from "Common/Server/Utils/Runbook/RunbookExecutePermission";
import { UnreadableReferenceException } from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "Common/Models/DatabaseModels/Incident";
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
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
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

/*
 * Shaped like what getDatabaseCommonInteractionProps returns for a project API
 * key. There is no userId — ProjectMiddleware resolves the project from the
 * KEY (overwriting any caller-supplied `tenantid` header) and attaches the
 * permissions granted to that key.
 */
function buildApiKeyProps(data: {
  projectId: ObjectID;
  permissions: Array<Permission>;
}): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[data.projectId.toString()] = buildTenantPermission({
    projectId: data.projectId,
    permissions: data.permissions,
  });

  return {
    tenantId: data.projectId,
    userId: undefined,
    userType: UserType.API,
    userTenantAccessPermission: permissionMap,
  };
}

/*
 * How a caller with no credentials at all is refused: 401, with the shared
 * wording. 401 is the status the browser client answers by refreshing an
 * expired session and replaying the request; a 422 would leave a signed-in
 * user staring at "not authorized".
 */
function expectAuthenticationRequired(thrown: unknown): void {
  expect(thrown).toBeInstanceOf(NotAuthenticatedException);
  expect(thrown).not.toBeInstanceOf(NotAuthorizedException);
  expect((thrown as NotAuthenticatedException).code).toBe(
    ExceptionCode.NotAuthenticatedException,
  );
  expect((thrown as NotAuthenticatedException).message).toBe(
    CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
  );
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
  let executionCompareAndSetSpy: jest.SpyInstance;
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
    // How complete and skip write: a compare-and-set on the paused state.
    executionCompareAndSetSpy = jest
      .spyOn(RunbookExecutionService, "compareAndSetColumnsByIdWithoutHooks")
      .mockResolvedValue(true);
    cancelJobsSpy = jest
      .spyOn(RunnerJobService, "cancelJobsForExecution")
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

  /*
   * By default, paused the way the execution loop leaves a run: step-1 (the
   * Manual step) waiting for a person, the steps after it still Pending, and
   * the execution parked in WaitingForManualStep.
   */
  function mockExecutionInProject(data: {
    projectId: ObjectID;
    status?: RunbookExecutionStatus | undefined;
    stepStatus?: RunbookStepExecutionStatus | undefined;
  }): void {
    const stepExecutions: Array<RunbookStepExecutionState> = makeSteps().map(
      (step: RunbookStep, index: number): RunbookStepExecutionState => {
        return {
          step,
          status:
            index === 0
              ? data.stepStatus || RunbookStepExecutionStatus.WaitingForUser
              : RunbookStepExecutionStatus.Pending,
        };
      },
    );

    executionFindSpy.mockResolvedValue({
      _id: executionId.toString(),
      projectId: data.projectId,
      status: data.status || RunbookExecutionStatus.WaitingForManualStep,
      stepExecutions,
      version: 3,
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
    expect(executionCompareAndSetSpy).not.toHaveBeenCalled();
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
    /*
     * The rejection is 401 (NotAuthenticatedException), not the 422 it used
     * to be. A credential-less request is usually a dashboard tab whose
     * access-token cookie expired with its JWT, and the browser client only
     * refreshes the session and replays on a 401. What matters for the
     * vulnerability is unchanged: rejected, nothing read, nothing enqueued.
     */
    test("VULN REGRESSION: a credential-less POST /run/:runbookId with a victim tenant header is rejected with 401 and nothing is enqueued", async () => {
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

      expectAuthenticationRequired(result.thrownToNext);
      // Never even reads the runbook, let alone runs it.
      expect(runbookFindSpy).not.toHaveBeenCalled();
      expectNothingExecutedOrMutated();
    });

    /*
     * Was BadDataException (missing tenant). Credentials are now checked
     * before the tenant, so an expired session that also lost its header is
     * still told to authenticate rather than "Project ID is required".
     */
    test("VULN REGRESSION: a credential-less POST with no tenant header at all is rejected too, with 401 rather than the missing-tenant 400", async () => {
      mockProps({ userType: UserType.Public });

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expectAuthenticationRequired(result.thrownToNext);
      expect(result.thrownToNext).not.toBeInstanceOf(BadDataException);
      expect(runbookFindSpy).not.toHaveBeenCalled();
      expectNothingExecutedOrMutated();
    });

    test.each(ALL_ROUTES)(
      "VULN REGRESSION: rejects a credential-less caller on POST %s with 401 and touches nothing",
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

        expectAuthenticationRequired(result.thrownToNext);
        expect(runbookFindSpy).not.toHaveBeenCalled();
        expect(executionFindSpy).not.toHaveBeenCalled();
        expectNothingExecutedOrMutated();
      },
    );

    test.each(ALL_ROUTES)(
      "rejects a credential-less caller with no tenant header on POST %s with 401 and touches nothing",
      async (uri: string) => {
        mockProps({ userType: UserType.Public });

        const result: RouteCallResult = await callRoute({
          uri,
          params: paramsForRoute(uri),
        });

        expectAuthenticationRequired(result.thrownToNext);
        expect(runbookFindSpy).not.toHaveBeenCalled();
        expect(executionFindSpy).not.toHaveBeenCalled();
        expectNothingExecutedOrMutated();
      },
    );

    /*
     * A credential-less caller cannot borrow authority from a stray tenant
     * permission entry on the request: without a user, an API key or a
     * master-admin session it is anonymous, whatever else the props say.
     */
    test("a credential-less caller carrying a tenant permission entry is still anonymous", async () => {
      mockProps({
        userType: UserType.Public,
        tenantId: callerProjectId,
        userId: undefined,
        userTenantAccessPermission: buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.ProjectOwner],
        }).userTenantAccessPermission,
      });
      mockRunbookInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expectAuthenticationRequired(result.thrownToNext);
      expect(runbookFindSpy).not.toHaveBeenCalled();
      expectNothingExecutedOrMutated();
    });

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
      // Authenticated, just not allowed: 422, never the 401 a session gets.
      expect(result.thrownToNext).not.toBeInstanceOf(NotAuthenticatedException);
      expect((result.thrownToNext as NotAuthorizedException).code).toBe(
        ExceptionCode.NotAuthorizedException,
      );
      expectNothingExecutedOrMutated();
    });

    /*
     * An API key is a credential. Pointed at a project it has no grants in,
     * it is refused as unauthorized (422), not as anonymous (401): its
     * client has no session to refresh.
     */
    test("rejects a project API key with no grants in the tenant with 422, not 401", async () => {
      mockProps({
        userType: UserType.API,
        tenantId: callerProjectId,
        userId: undefined,
        userTenantAccessPermission: undefined,
      });

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(result.thrownToNext).not.toBeInstanceOf(NotAuthenticatedException);
      expect(runbookFindSpy).not.toHaveBeenCalled();
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
     * Pin the shared allow-lists themselves: every route gates on these
     * constants, so a change here changes who can run scripts on customer
     * infrastructure. Starting mirrors RunbookExecution's create ACL;
     * advancing an existing execution additionally honours its update ACL,
     * which is where EditRunbookExecution lives.
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

    test("RUNBOOK_ADVANCE_PERMISSIONS adds EditRunbookExecution and nothing else", () => {
      expect([...RUNBOOK_ADVANCE_PERMISSIONS].sort()).toEqual(
        [
          ...RUNBOOK_EXECUTE_PERMISSIONS,
          Permission.EditRunbookExecution,
        ].sort(),
      );
    });

    /*
     * EditRunbookExecution is documented (runbooks/agents.md,
     * runbooks/configuration.md) as the permission that lets someone tick an
     * execution off, and it is RunbookExecution's update ACL. It must not
     * open a NEW execution, though — that is the create ACL's job.
     */
    test.each([COMPLETE_ROUTE, SKIP_ROUTE, CANCEL_ROUTE])(
      "EditRunbookExecution alone can advance an existing execution via %s",
      async (uri: string) => {
        memberProps([Permission.EditRunbookExecution]);
        mockExecutionInProject({ projectId: callerProjectId });

        const result: RouteCallResult = await callRoute({
          uri,
          params: uri === CANCEL_ROUTE ? cancelParams() : stepParams(),
        });

        expect(result.thrownToNext).toBeUndefined();
      },
    );

    test("EditRunbookExecution alone cannot START a run", async () => {
      memberProps([Permission.EditRunbookExecution]);
      mockRunbookInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(startExecutionMock).not.toHaveBeenCalled();
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

  /*
   * Project API keys are a first-class way to drive OneUptime — triggering a
   * runbook from CI or another automation is a supported use, so the gate
   * admits a key and then holds it to the SAME permission list a human is
   * held to. The key carries no userId, which is exactly why requiring one
   * locked automation out.
   */
  describe("project API keys", () => {
    function apiKeyProps(permissions: Array<Permission>): void {
      mockProps(
        buildApiKeyProps({
          projectId: callerProjectId,
          permissions,
        }),
      );
    }

    test.each(RUNBOOK_EXECUTE_PERMISSIONS)(
      "an API key holding %s can start a run",
      async (permission: Permission) => {
        apiKeyProps([permission]);
        mockRunbookInProject(callerProjectId);

        const result: RouteCallResult = await callRoute({
          uri: RUN_ROUTE,
          params: runParams(),
        });

        expect(result.thrownToNext).toBeUndefined();
        expect(startExecutionMock).toHaveBeenCalledTimes(1);
      },
    );

    test("an API key without a runbook-execute permission is rejected", async () => {
      apiKeyProps([Permission.Viewer]);
      mockRunbookInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(startExecutionMock).not.toHaveBeenCalled();
    });

    test("an API key can advance an execution it is permitted to", async () => {
      apiKeyProps([Permission.EditRunbookExecution]);
      mockExecutionInProject({ projectId: callerProjectId });

      const result: RouteCallResult = await callRoute({
        uri: COMPLETE_ROUTE,
        params: stepParams(),
      });

      expect(result.thrownToNext).toBeUndefined();
    });

    /*
     * The anonymous-caller 401 must not catch keys: a key carries no userId,
     * but it is a credential, so every route still lets it through to the
     * permission check.
     */
    test.each([COMPLETE_ROUTE, SKIP_ROUTE, CANCEL_ROUTE])(
      "an API key is not treated as anonymous on POST %s",
      async (uri: string) => {
        apiKeyProps([Permission.EditRunbookExecution]);
        mockExecutionInProject({ projectId: callerProjectId });

        const result: RouteCallResult = await callRoute({
          uri,
          params: paramsForRoute(uri),
        });

        expect(result.thrownToNext).toBeUndefined();
        expect(executionFindSpy).toHaveBeenCalled();
        expect(
          uri === CANCEL_ROUTE ? executionUpdateSpy : executionCompareAndSetSpy,
        ).toHaveBeenCalled();
      },
    );

    /*
     * No user is behind the request, so the execution records no triggering
     * user rather than inventing one — the column is nullable for exactly
     * this case.
     */
    test("a run started by an API key records no triggeredByUserId", async () => {
      apiKeyProps([Permission.CreateRunbookExecution]);
      mockRunbookInProject(callerProjectId);

      await callRoute({ uri: RUN_ROUTE, params: runParams() });

      const created: RunbookExecution = executionCreateSpy.mock.calls[0]![0]
        .data as RunbookExecution;

      expect(created.triggeredByUserId).toBeUndefined();
      expect(created.projectId?.toString()).toBe(callerProjectId.toString());
    });

    /*
     * The key's own project is the one ProjectMiddleware put on the request,
     * so a runbook belonging to someone else is still out of reach.
     */
    test("an API key cannot start another project's runbook", async () => {
      apiKeyProps([Permission.ProjectAdmin]);
      mockRunbookInProject(otherProjectId);

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(startExecutionMock).not.toHaveBeenCalled();
    });

    /*
     * A key whose permission row for one of the six is a BLOCK is a denial,
     * not a grant — the same inversion guarded for human callers.
     */
    test("a blocked permission on an API key is not read as a grant", async () => {
      const permissionMap: Dictionary<UserTenantAccessPermission> = {};

      permissionMap[callerProjectId.toString()] = {
        _type: "UserTenantAccessPermission",
        projectId: callerProjectId,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.CreateRunbookExecution,
            labelIds: [],
            isBlockPermission: true,
          },
        ],
      } as UserTenantAccessPermission;

      mockProps({
        tenantId: callerProjectId,
        userId: undefined,
        userType: UserType.API,
        userTenantAccessPermission: permissionMap,
      });
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
        expect(executionCompareAndSetSpy).not.toHaveBeenCalled();
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
        status: RunbookExecutionStatus.WaitingForManualStep,
        stepStatus: RunbookStepExecutionStatus.WaitingForUser,
      });

      const result: RouteCallResult = await callRoute({
        uri: COMPLETE_ROUTE,
        params: stepParams(),
        body: { notes: "done by hand" },
      });

      expect(result.nextCallCount).toBe(0);
      expect(executionCompareAndSetSpy).toHaveBeenCalledTimes(1);
      expect(executionUpdateSpy).not.toHaveBeenCalled();

      const updatedSteps: Array<RunbookStepExecutionState> = (
        executionCompareAndSetSpy.mock.calls[0]![0] as {
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

  /*
   * A Runbook Member runs the runbooks ITS grant reaches - its labels and
   * owned scope - read with that grant alone
   * (Common/Server/Utils/Runbook/RunbookRunAccess). Before, the runbook was
   * read as OneUptime only, and a Runbook Member limited to some labels ran
   * every runbook in the project. The fake read below finds the runbook as
   * OneUptime always, and with the caller's rows only when one of the run
   * roles is there with no labels.
   */
  describe("which runbooks a run role reaches", () => {
    const LABEL_ID: ObjectID = ObjectID.generate();

    function memberWithRows(rows: Array<UserPermission>): void {
      mockProps({
        tenantId: callerProjectId,
        userId: callerUserId,
        userType: UserType.User,
        userTenantAccessPermission: {
          [callerProjectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: callerProjectId,
            permissions: rows,
          },
        },
      });
    }

    function runbookReadReachesUnlabelledRoles(): void {
      runbookFindSpy.mockImplementation((async (data: {
        props: DatabaseCommonInteractionProps;
      }): Promise<Runbook | null> => {
        const runbook: Runbook = {
          _id: runbookId.toString(),
          projectId: callerProjectId,
          name: "Restart web tier",
          isEnabled: true,
          steps: makeSteps(),
        } as unknown as Runbook;

        if (data.props.isRoot) {
          return runbook;
        }

        const rows: Array<UserPermission> =
          data.props.userTenantAccessPermission?.[callerProjectId.toString()]
            ?.permissions || [];

        return rows.some((candidate: UserPermission): boolean => {
          return (
            !candidate.isBlockPermission &&
            candidate.labelIds.length === 0 &&
            [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.RunbookAdmin,
              Permission.RunbookMember,
            ].includes(candidate.permission)
          );
        })
          ? runbook
          : null;
      }) as unknown as typeof RunbookService.findOneById);
    }

    // A run of the runbook, paused on its first (Manual) step.
    function executionOfTheRunbook(status?: RunbookExecutionStatus): void {
      executionFindSpy.mockImplementation(
        (async (): Promise<RunbookExecution> => {
          const stepExecutions: Array<RunbookStepExecutionState> =
            makeSteps().map(
              (step: RunbookStep, index: number): RunbookStepExecutionState => {
                return {
                  step,
                  status:
                    index === 0
                      ? RunbookStepExecutionStatus.WaitingForUser
                      : RunbookStepExecutionStatus.Pending,
                };
              },
            );

          return {
            _id: executionId.toString(),
            projectId: callerProjectId,
            runbookId: runbookId,
            status: status || RunbookExecutionStatus.WaitingForManualStep,
            stepExecutions,
            version: 3,
          } as unknown as RunbookExecution;
        }) as unknown as typeof RunbookExecutionService.findOneById,
      );
    }

    function role(
      permission: Permission,
      labels: Array<ObjectID> = [],
    ): UserPermission {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: labels,
        isBlockPermission: false,
      };
    }

    test("a Runbook Member whose grant reaches the runbook starts it", async () => {
      memberWithRows([role(Permission.RunbookMember)]);
      runbookReadReachesUnlabelledRoles();

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(executionCreateSpy).toHaveBeenCalledTimes(1);
      expect(startExecutionMock).toHaveBeenCalledTimes(1);
    });

    test("a Runbook Member limited to a label the runbook does not carry is refused, however widely a Viewer grant shows it - and nothing runs", async () => {
      memberWithRows([
        role(Permission.RunbookMember, [LABEL_ID]),
        role(Permission.Viewer),
        role(Permission.RunbookViewer),
      ]);
      runbookReadReachesUnlabelledRoles();

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as Error).message).toBe(
        "You do not have permission to start runbook executions in this project.",
      );
      expectNothingExecutedOrMutated();
    });

    test.each([COMPLETE_ROUTE, SKIP_ROUTE, CANCEL_ROUTE])(
      "the same Runbook Member may not move a run of that runbook along via %s",
      async (uri: string) => {
        memberWithRows([
          role(Permission.RunbookMember, [LABEL_ID]),
          role(Permission.Viewer),
        ]);
        runbookReadReachesUnlabelledRoles();
        executionOfTheRunbook(
          uri === CANCEL_ROUTE ? RunbookExecutionStatus.Running : undefined,
        );

        const result: RouteCallResult = await callRoute({
          uri,
          params: uri === CANCEL_ROUTE ? cancelParams() : stepParams(),
        });

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect((result.thrownToNext as Error).message).toBe(
          "You do not have permission to change runbook executions in this project.",
        );
        expectNothingExecutedOrMutated();
      },
    );

    test.each([COMPLETE_ROUTE, SKIP_ROUTE, CANCEL_ROUTE])(
      "a Runbook Member whose grant reaches the runbook moves its run along via %s",
      async (uri: string) => {
        memberWithRows([role(Permission.RunbookMember)]);
        runbookReadReachesUnlabelledRoles();
        executionOfTheRunbook(
          uri === CANCEL_ROUTE ? RunbookExecutionStatus.Running : undefined,
        );

        const result: RouteCallResult = await callRoute({
          uri,
          params: uri === CANCEL_ROUTE ? cancelParams() : stepParams(),
        });

        expect(result.thrownToNext).toBeUndefined();
      },
    );

    test("Edit Runbook Execution still moves any run of the project along: it is about runs", async () => {
      memberWithRows([role(Permission.EditRunbookExecution)]);
      runbookReadReachesUnlabelledRoles();
      executionOfTheRunbook();

      const result: RouteCallResult = await callRoute({
        uri: COMPLETE_ROUTE,
        params: stepParams(),
      });

      expect(result.thrownToNext).toBeUndefined();
    });

    test("a Runbook Viewer runs nothing", async () => {
      memberWithRows([role(Permission.RunbookViewer)]);
      runbookReadReachesUnlabelledRoles();

      const result: RouteCallResult = await callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expectNothingExecutedOrMutated();
    });
  });

  /*
   * The run is written as OneUptime once its caller is known, so the record
   * it is linked to is held to the caller's read here: an incident whose
   * labels, owners or people keep it from them is answered like one that
   * does not exist, and nothing runs.
   */
  describe("the incident a run is linked to", () => {
    const PRODUCTION: ObjectID = ObjectID.generate();
    let incidentId: ObjectID;
    let readableIncidents: Array<string>;
    let incidentReads: Array<Array<string>>;

    function runnerReadingIncidents(labels: Array<ObjectID>): void {
      mockProps({
        tenantId: callerProjectId,
        userId: callerUserId,
        userType: UserType.User,
        userTenantAccessPermission: {
          [callerProjectId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: callerProjectId,
            permissions: [
              {
                _type: "UserPermission",
                permission: Permission.RunbookMember,
                labelIds: [],
                isBlockPermission: false,
              },
              {
                _type: "UserPermission",
                permission: Permission.ReadProjectIncident,
                labelIds: labels,
                isBlockPermission: false,
              },
            ],
          },
        },
      });
    }

    function linkedRun(): Promise<RouteCallResult> {
      return callRoute({
        uri: RUN_ROUTE,
        params: runParams(),
        body: { incidentId: incidentId.toString() },
      });
    }

    beforeEach(() => {
      incidentId = ObjectID.generate();
      readableIncidents = [];
      incidentReads = [];

      mockRunbookInProject(callerProjectId);

      // The incident is the project's.
      jest
        .spyOn(IncidentService, "findOneById")
        .mockResolvedValue({ projectId: callerProjectId } as unknown as Incident);

      // The incidents the caller's own read finds.
      jest
        .spyOn(DatabaseService as never, "findReadableParentIds")
        .mockImplementation((async (lookup: {
          parentModelType: { new (): BaseModel };
          ids: Array<string>;
        }): Promise<Array<string>> => {
          if (new lookup.parentModelType().tableName !== "Incident") {
            return lookup.ids;
          }

          incidentReads.push(lookup.ids);

          return lookup.ids.filter((id: string): boolean => {
            return readableIncidents.includes(id.toLowerCase());
          });
        }) as never);
    });

    test("a runner whose read of incidents reaches the incident links the run to it", async () => {
      runnerReadingIncidents([PRODUCTION]);
      readableIncidents = [incidentId.toString().toLowerCase()];

      const result: RouteCallResult = await linkedRun();

      expect(result.thrownToNext).toBeUndefined();
      expect(incidentReads).toEqual([[incidentId.toString()]]);
      expect(executionCreateSpy).toHaveBeenCalledTimes(1);
      expect(
        (
          executionCreateSpy.mock.calls[0]![0] as { data: RunbookExecution }
        ).data.incidentId?.toString(),
      ).toBe(incidentId.toString());
      expect(startExecutionMock).toHaveBeenCalledTimes(1);
    });

    test("a runner whose read of incidents leaves it out is answered as if it did not exist, and nothing runs", async () => {
      runnerReadingIncidents([PRODUCTION]);

      const result: RouteCallResult = await linkedRun();

      expect(result.thrownToNext).toBeInstanceOf(UnreadableReferenceException);
      expect((result.thrownToNext as Error).message).toBe(
        `This runbook execution references records that are not in this project: Incident "${incidentId.toString()}". Please pick values from this project and try again.`,
      );
      expect(incidentReads).toEqual([[incidentId.toString()]]);
      expectNothingExecutedOrMutated();
    });

    test("a runner who reads every incident is still asked as themselves: an incident private to others is not theirs to link", async () => {
      runnerReadingIncidents([]);

      // Private to its own people: the runner's read does not find it.
      const refused: RouteCallResult = await linkedRun();

      expect(refused.thrownToNext).toBeInstanceOf(UnreadableReferenceException);
      expect(incidentReads).toEqual([[incidentId.toString()]]);
      expectNothingExecutedOrMutated();

      // One their read finds is linked.
      readableIncidents = [incidentId.toString().toLowerCase()];

      const linked: RouteCallResult = await linkedRun();

      expect(linked.thrownToNext).toBeUndefined();
      expect(startExecutionMock).toHaveBeenCalledTimes(1);
    });
  });
});
