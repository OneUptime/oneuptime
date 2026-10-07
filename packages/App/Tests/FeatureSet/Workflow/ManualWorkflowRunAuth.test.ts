import ManualAPI from "../../../FeatureSet/Workflow/API/Manual";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import CommonAPI from "Common/Server/API/CommonAPI";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
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
  WORKFLOW_RUN_ONLY_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
  WORKFLOW_RUN_REFUSED_MESSAGE,
} from "Common/Types/Workflow/WorkflowRunPermissions";
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
 * Regression tests for GET/POST /workflow/manual/run/:workflowId.
 *
 * CVE-2026-35053 (GHSA-6c3w-7xg4-4cf7) reported these routes as having no
 * auth at all. The published patch added UserMiddleware.getUserMiddleware in
 * front of both — but that middleware is a *context loader*, not a gate: with
 * no cookie, no bearer token and no apikey header it tags the request
 * UserType.Public and calls next(). The handler never looked at userType, and
 * QueueWorkflow.addWorkflowToQueue is not passed the request at all, so it
 * could not check the caller either. The route stayed reachable
 * unauthenticated (GHSA-v8v9-p6ff-jwmm).
 *
 * Running a workflow executes its components as root — arbitrary JavaScript,
 * notification sends, resource create/delete — so the load-bearing assertion
 * in every deny case below is that QueueWorkflow.addWorkflowToQueue was NEVER
 * called. An error response on its own would not prove the work was stopped.
 *
 * The second half of the bug class is cross-tenant reach: the project the
 * caller is authorized for comes from a caller-supplied `tenantid` header, so
 * proving the caller is *some* logged-in user is not enough. The workflow's
 * own projectId has to come off the workflow row and match.
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
 * The queue itself is not under test — what matters is whether the handler
 * ever reaches it. Mocking the module also keeps the real workflow runner
 * (and its isolated-vm native binding) out of this suite.
 */
jest.mock("../../../FeatureSet/Workflow/Services/QueueWorkflow", () => {
  return {
    __esModule: true,
    default: {
      addWorkflowToQueue: jest.fn(),
    },
  };
});

const RUN_ROUTE: string = "/run/:workflowId";

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

async function callRunRoute(data: {
  method: "GET" | "POST";
  workflowId?: string | undefined;
  body?: JSONObject | undefined;
}): Promise<RouteCallResult> {
  const params: Dictionary<string> = {};

  if (data.workflowId !== undefined) {
    params["workflowId"] = data.workflowId;
  }

  const req: ExpressRequest = {
    params: params,
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

  await matchRoute(data.method, RUN_ROUTE).handlerFunction(
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
  // Rows a team holds as blocks, with the labels they are limited to.
  blocks?: Array<{ permission: Permission; labelIds: Array<ObjectID> }>;
}): UserTenantAccessPermission {
  return {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: [
      ...data.permissions.map((permission: Permission) => {
        const userPermission: UserPermission = {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
        };

        return userPermission;
      }),
      ...(data.blocks || []).map(
        (block: { permission: Permission; labelIds: Array<ObjectID> }) => {
          const userPermission: UserPermission = {
            _type: "UserPermission",
            permission: block.permission,
            labelIds: block.labelIds,
            isBlockPermission: true,
          };

          return userPermission;
        },
      ),
    ],
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
  blocks?: Array<{ permission: Permission; labelIds: Array<ObjectID> }>;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[data.projectId.toString()] = buildTenantPermission({
    projectId: data.projectId,
    permissions: data.permissions,
    ...(data.blocks ? { blocks: data.blocks } : {}),
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
 * How a caller with no credentials at all is refused: 401 with the shared
 * wording. Such a request is usually a dashboard tab whose access-token
 * cookie expired with its JWT, and the browser client only refreshes the
 * session and replays on a 401 - a 400 or 422 here would leave a signed-in
 * user looking at an error instead of a Run that just works.
 */
function expectAuthenticationRequired(thrown: unknown): void {
  expect(thrown).toBeInstanceOf(NotAuthenticatedException);
  expect(thrown).not.toBeInstanceOf(NotAuthorizedException);
  expect(thrown).not.toBeInstanceOf(BadDataException);
  expect((thrown as NotAuthenticatedException).code).toBe(
    ExceptionCode.NotAuthenticatedException,
  );
  expect((thrown as NotAuthenticatedException).message).toBe(
    CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
  );
}

describe("GET/POST /workflow/manual/run/:workflowId requires an authorized member of the workflow's own project", () => {
  let callerProjectId: ObjectID;
  let otherProjectId: ObjectID;
  let callerUserId: ObjectID;
  let workflowId: ObjectID;

  let getPropsSpy: jest.SpyInstance;
  let findOneByIdSpy: jest.SpyInstance;
  let findOneUpdatableByIdSpy: jest.SpyInstance;
  let addWorkflowToQueueSpy: jest.SpyInstance;

  /*
   * What the caller's own reads of the workflow find, once its project has
   * matched: whether their edit grants reach it (the update scope), and
   * whether their Workflow Member grant does (a read with that grant alone).
   */
  let reach: { mayChange: boolean; memberReaches: boolean };

  beforeAll(() => {
    mockRoutes.length = 0;
    new ManualAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    callerProjectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    callerUserId = ObjectID.generate();
    workflowId = ObjectID.generate();

    reach = { mayChange: true, memberReaches: true };

    getPropsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    findOneByIdSpy = jest.spyOn(WorkflowService, "findOneById");
    findOneUpdatableByIdSpy = jest
      .spyOn(WorkflowService, "findOneUpdatableById")
      .mockImplementation(async () => {
        return reach.mayChange ? workflowRow(callerProjectId) : null;
      });
    addWorkflowToQueueSpy = jest
      .spyOn(QueueWorkflow, "addWorkflowToQueue")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function mockProps(props: DatabaseCommonInteractionProps): void {
    getPropsSpy.mockResolvedValue(props);
  }

  function workflowRow(projectId: ObjectID): WorkflowModel {
    const workflow: WorkflowModel = new WorkflowModel();
    workflow.id = workflowId;
    workflow.projectId = projectId;

    return workflow;
  }

  /*
   * The workflow, in `projectId` (or nowhere). Read as OneUptime it is
   * always there; the caller's own read finds it when their Workflow Member
   * grant reaches it.
   */
  function mockWorkflowInProject(projectId: ObjectID | null): void {
    findOneByIdSpy.mockImplementation(
      async (args: { props: DatabaseCommonInteractionProps }) => {
        if (!projectId) {
          return null;
        }

        if (args.props.isRoot) {
          return workflowRow(projectId);
        }

        return reach.memberReaches ? workflowRow(projectId) : null;
      },
    );
  }

  // The props of the caller's own read of the workflow, if there was one.
  function scopedReadProps(): DatabaseCommonInteractionProps | undefined {
    const call: Array<unknown> | undefined = findOneByIdSpy.mock.calls.find(
      (candidate: Array<unknown>) => {
        return !(candidate[0] as { props: DatabaseCommonInteractionProps })
          .props.isRoot;
      },
    );

    return call
      ? (call[0] as { props: DatabaseCommonInteractionProps }).props
      : undefined;
  }

  function editorProps(): DatabaseCommonInteractionProps {
    return buildUserProps({
      projectId: callerProjectId,
      userId: callerUserId,
      permissions: [Permission.EditWorkflow],
    });
  }

  describe("route wiring", () => {
    test("registers both GET and POST /run/:workflowId", () => {
      expect(() => {
        return matchRoute("GET", RUN_ROUTE);
      }).not.toThrow();
      expect(() => {
        return matchRoute("POST", RUN_ROUTE);
      }).not.toThrow();
    });

    /*
     * getUserMiddleware still runs — it is what populates userType, tenantId
     * and the tenant permissions the handler then checks. It just is not the
     * thing doing the rejecting.
     */
    test("keeps a context-loading middleware in front of both routes", () => {
      expect(typeof matchRoute("GET", RUN_ROUTE).middleware).toBe("function");
      expect(typeof matchRoute("POST", RUN_ROUTE).middleware).toBe("function");
    });
  });

  describe("unauthenticated callers (the reported CVE)", () => {
    /*
     * The advisory's proof of concept verbatim: a bare POST with no cookie,
     * no Authorization header and no apikey header. getUserMiddleware tags it
     * UserType.Public and calls next(), so it reaches the handler — the
     * handler has to be the thing that stops it.
     */
    /*
     * This used to surface as BadDataException ("Project ID is required",
     * the advisory's request carries no tenantid header). Credentials are
     * now checked before the tenant, so it is a 401: still refused, still
     * nothing queued, but the status a signed-in user's expired session is
     * refreshed on.
     */
    test("rejects the advisory's credential-less POST with 401 and never queues the workflow", async () => {
      mockProps({ userType: UserType.Public });

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
        body: { data: { anything: "attacker-controlled" } },
      });

      expectAuthenticationRequired(result.thrownToNext);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    test("rejects the same credential-less call on the GET route with 401", async () => {
      mockProps({ userType: UserType.Public });

      const result: RouteCallResult = await callRunRoute({
        method: "GET",
        workflowId: workflowId.toString(),
      });

      expectAuthenticationRequired(result.thrownToNext);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    test("never even reads the workflow for a credential-less caller", async () => {
      mockProps({ userType: UserType.Public });

      await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(findOneByIdSpy).not.toHaveBeenCalled();
    });

    /*
     * A public caller can freely put any project id in the `tenantid` header.
     * That sets tenantId on the request without granting any permission, so
     * the tenant check alone must not be mistaken for authentication.
     */
    test("rejects a public caller that supplies a tenant header it has no permission for, with 401", async () => {
      mockProps({
        userType: UserType.Public,
        tenantId: callerProjectId,
        userId: undefined,
        userTenantAccessPermission: undefined,
      });

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expectAuthenticationRequired(result.thrownToNext);
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    test("rejects the same public caller on the GET route with 401", async () => {
      mockProps({
        userType: UserType.Public,
        tenantId: callerProjectId,
        userId: undefined,
        userTenantAccessPermission: undefined,
      });

      const result: RouteCallResult = await callRunRoute({
        method: "GET",
        workflowId: workflowId.toString(),
      });

      expectAuthenticationRequired(result.thrownToNext);
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    /*
     * Even a tenant permission entry on the request does not make a caller
     * with no user, no API key and no master-admin session anything but
     * anonymous.
     */
    test("rejects a credential-less caller carrying a tenant permission entry with 401", async () => {
      mockProps({
        userType: UserType.Public,
        tenantId: callerProjectId,
        userId: undefined,
        userTenantAccessPermission: editorProps().userTenantAccessPermission,
      });
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expectAuthenticationRequired(result.thrownToNext);
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    /*
     * A project API key is a credential, so it is not anonymous and does not
     * get the 401 - its client has no session to refresh. It is still
     * refused, with 422: this route backs the dashboard's Run button and
     * requires a logged-in member; automation triggers a workflow through
     * its own secret-key webhook instead.
     */
    test("rejects a project API key with 422, not 401, and never queues the workflow", async () => {
      const permissionMap: Dictionary<UserTenantAccessPermission> = {};
      permissionMap[callerProjectId.toString()] = buildTenantPermission({
        projectId: callerProjectId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps({
        userType: UserType.API,
        tenantId: callerProjectId,
        userId: undefined,
        userTenantAccessPermission: permissionMap,
      });
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(result.thrownToNext).not.toBeInstanceOf(NotAuthenticatedException);
      expect((result.thrownToNext as NotAuthorizedException).code).toBe(
        ExceptionCode.NotAuthorizedException,
      );
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    test("rejects a caller with a tenant and a user id but no tenant permissions", async () => {
      mockProps({
        userType: UserType.User,
        tenantId: callerProjectId,
        userId: callerUserId,
        userTenantAccessPermission: undefined,
      });

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    /*
     * Permissions keyed by a *different* project than the one claimed must
     * not satisfy the check for the claimed project.
     */
    test("rejects a caller whose permissions are keyed by a different project", async () => {
      const permissionMap: Dictionary<UserTenantAccessPermission> = {};
      permissionMap[otherProjectId.toString()] = buildTenantPermission({
        projectId: otherProjectId,
        permissions: [Permission.ProjectOwner],
      });

      mockProps({
        userType: UserType.User,
        tenantId: callerProjectId,
        userId: callerUserId,
        userTenantAccessPermission: permissionMap,
      });

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });
  });

  describe("cross-tenant reach", () => {
    /*
     * The headline sibling risk: a real, fully-privileged member of project A
     * sending their own tenant header while pointing the path at project B's
     * workflow id.
     */
    test("rejects a project owner of one project targeting another project's workflow", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.ProjectOwner],
        }),
      );
      mockWorkflowInProject(otherProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    test("rejects the same cross-tenant attempt on the GET route", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.ProjectOwner],
        }),
      );
      mockWorkflowInProject(otherProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "GET",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    /*
     * Same rejection for a workflow that does not exist, so the route cannot
     * be used to probe which workflow ids are real in other projects.
     */
    test("rejects a workflow id that does not exist with the same error as a foreign one", async () => {
      mockProps(editorProps());
      mockWorkflowInProject(null);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    test("rejects a workflow that belongs to no project", async () => {
      mockProps(editorProps());

      const orphan: WorkflowModel = new WorkflowModel();
      orphan.id = workflowId;
      findOneByIdSpy.mockResolvedValue(orphan);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    /*
     * The owning project must come off the workflow row, not off the
     * caller-supplied header — pin the read that derives it.
     */
    test("derives the owning project from the workflow row itself", async () => {
      mockProps(editorProps());
      mockWorkflowInProject(callerProjectId);

      await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(findOneByIdSpy).toHaveBeenCalledTimes(1);

      const readArgs: {
        id: ObjectID;
        select: Dictionary<boolean>;
        props: Dictionary<boolean>;
      } = findOneByIdSpy.mock.calls[0]![0] as {
        id: ObjectID;
        select: Dictionary<boolean>;
        props: Dictionary<boolean>;
      };

      expect(readArgs.id.toString()).toBe(workflowId.toString());
      expect(readArgs.select).toEqual({ projectId: true });
      expect(readArgs.props["isRoot"]).toBe(true);
    });

    /*
     * The caller's own reads - the update check, which names a row's labels
     * when it refuses, and the Workflow Member read - only ever see a row of
     * their own project.
     */
    test("reads nothing as the caller for another project's workflow", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.EditWorkflow, Permission.WorkflowMember],
        }),
      );
      mockWorkflowInProject(otherProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(findOneUpdatableByIdSpy).not.toHaveBeenCalled();
      expect(scopedReadProps()).toBeUndefined();
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });
  });

  describe("permission level within the caller's own project", () => {
    /*
     * Running a workflow executes its components, so it takes a run
     * permission: one of the workflow's editors (the Workflow model's update
     * list), or a Workflow Member, whose role is to run workflows without
     * changing them. A run starts at the trigger and goes through every
     * condition, as the editors built it.
     */
    const allowedPermissions: Array<Permission> = [
      ...WORKFLOW_RUN_PERMISSIONS,
    ];

    test("the run list is the workflow's editors and the Workflow Member", () => {
      expect([...WORKFLOW_RUN_PERMISSIONS].sort()).toEqual(
        [
          ...new WorkflowModel().getUpdatePermissions(),
          ...WORKFLOW_RUN_ONLY_PERMISSIONS,
        ].sort(),
      );
      expect([...WORKFLOW_RUN_ONLY_PERMISSIONS]).toEqual([
        Permission.WorkflowMember,
      ]);
      expect(allowedPermissions).toContain(Permission.WorkflowAdmin);
      expect(allowedPermissions).toContain(Permission.WorkflowMember);
    });

    test.each(allowedPermissions)(
      "allows a caller holding %s",
      async (permission: Permission) => {
        mockProps(
          buildUserProps({
            projectId: callerProjectId,
            userId: callerUserId,
            permissions: [permission],
          }),
        );
        mockWorkflowInProject(callerProjectId);

        const result: RouteCallResult = await callRunRoute({
          method: "POST",
          workflowId: workflowId.toString(),
        });

        expect(result.nextCallCount).toBe(0);
        expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
      },
    );

    /*
     * Creating or deleting workflows is not running one, and reading one is
     * not either.
     */
    const deniedPermissions: Array<Permission> = [
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.ReadWorkflow,
      Permission.WorkflowViewer,
      Permission.CreateWorkflow,
      Permission.DeleteWorkflow,
    ];

    test("Delete Workflow is not on the list a manual run is gated on", () => {
      expect(allowedPermissions).not.toContain(Permission.DeleteWorkflow);
      expect(allowedPermissions).toContain(Permission.EditWorkflow);
    });

    test.each(deniedPermissions)(
      "rejects a project member holding only %s",
      async (permission: Permission) => {
        mockProps(
          buildUserProps({
            projectId: callerProjectId,
            userId: callerUserId,
            permissions: [permission],
          }),
        );
        mockWorkflowInProject(callerProjectId);

        const result: RouteCallResult = await callRunRoute({
          method: "POST",
          workflowId: workflowId.toString(),
        });

        expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
        expect((result.thrownToNext as NotAuthorizedException).message).toBe(
          WORKFLOW_RUN_REFUSED_MESSAGE,
        );
        expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      },
    );

    /*
     * Asked before anything is read, so a caller who may not run workflows
     * learns nothing about which workflow ids exist.
     */
    test.each(deniedPermissions)(
      "never reads the workflow for a caller holding only %s",
      async (permission: Permission) => {
        mockProps(
          buildUserProps({
            projectId: callerProjectId,
            userId: callerUserId,
            permissions: [permission],
          }),
        );
        mockWorkflowInProject(callerProjectId);

        await callRunRoute({
          method: "POST",
          workflowId: workflowId.toString(),
        });

        expect(findOneByIdSpy).not.toHaveBeenCalled();
      },
    );

    test("a Workflow Member runs a workflow they can open", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.WorkflowMember],
        }),
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
        body: { data: { ticket: "INC-1" } },
      });

      expect(result.nextCallCount).toBe(0);
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
      expect(
        (addWorkflowToQueueSpy.mock.calls[0]![0] as { returnValues: JSONObject })
          .returnValues,
      ).toEqual({ ticket: "INC-1" });
    });

    /*
     * A Workflow Member's reach is read with their Workflow Member grant
     * alone: limited to some labels, or to the workflows their team owns, it
     * runs only those - even when another grant (Viewer, here) lets them see
     * every workflow.
     */
    test("a Workflow Member's reach is read with that grant alone, not with what else they hold", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.Viewer, Permission.WorkflowMember],
          blocks: [
            {
              permission: Permission.WorkflowMember,
              labelIds: [ObjectID.generate()],
            },
          ],
        }),
      );
      mockWorkflowInProject(callerProjectId);

      await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      const props: DatabaseCommonInteractionProps | undefined =
        scopedReadProps();
      const rows: Array<UserPermission> =
        props?.userTenantAccessPermission?.[callerProjectId.toString()]
          ?.permissions || [];

      // The Workflow Member allow, and its block: never the Viewer row.
      expect(
        rows.map((row: UserPermission) => {
          return [row.permission, Boolean(row.isBlockPermission)];
        }),
      ).toEqual([
        [Permission.WorkflowMember, false],
        [Permission.WorkflowMember, true],
      ]);
      expect(props?.isRoot).toBeFalsy();
      expect(props?.tenantId?.toString()).toBe(callerProjectId.toString());
      expect(props?.userId?.toString()).toBe(callerUserId.toString());
      // Nothing the member holds lets them change it, so the update check is skipped.
      expect(findOneUpdatableByIdSpy).not.toHaveBeenCalled();
    });

    test("a Workflow Member whose grant does not reach the workflow is refused, though they can see it", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.Viewer, Permission.WorkflowMember],
        }),
      );
      mockWorkflowInProject(callerProjectId);
      reach.memberReaches = false;

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as NotAuthorizedException).message).toBe(
        WORKFLOW_RUN_REFUSED_MESSAGE,
      );
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    /*
     * An editor runs the workflows they may change: the update scope of
     * their edit grants, read with their own props.
     */
    test("an editor's reach is the update scope, read with their own props", async () => {
      const props: DatabaseCommonInteractionProps = editorProps();

      mockProps(props);
      mockWorkflowInProject(callerProjectId);

      await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(findOneUpdatableByIdSpy).toHaveBeenCalledTimes(1);

      const updateArgs: {
        id: ObjectID;
        props: DatabaseCommonInteractionProps;
      } = findOneUpdatableByIdSpy.mock.calls[0]![0] as {
        id: ObjectID;
        props: DatabaseCommonInteractionProps;
      };

      expect(updateArgs.id.toString()).toBe(workflowId.toString());
      expect(updateArgs.props).toBe(props);
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
    });

    test("an editor whose edit grant does not reach the workflow is refused", async () => {
      mockProps(editorProps());
      mockWorkflowInProject(callerProjectId);
      reach.mayChange = false;

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as NotAuthorizedException).message).toBe(
        WORKFLOW_RUN_REFUSED_MESSAGE,
      );
      // No Workflow Member grant to fall back on, so no second read.
      expect(scopedReadProps()).toBeUndefined();
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    // The update check refuses outright when a block names one of the workflow's labels.
    test("an editor blocked on one of the workflow's labels is refused", async () => {
      mockProps(editorProps());
      mockWorkflowInProject(callerProjectId);
      findOneUpdatableByIdSpy.mockRejectedValue(
        new NotAuthorizedException("blocked on the label Payments"),
      );

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as NotAuthorizedException).message).toBe(
        WORKFLOW_RUN_REFUSED_MESSAGE,
      );
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    test("an editor whose edit grant misses still runs it as a Workflow Member when that grant reaches", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.EditWorkflow, Permission.WorkflowMember],
        }),
      );
      mockWorkflowInProject(callerProjectId);
      reach.mayChange = false;

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.nextCallCount).toBe(0);
      expect(findOneUpdatableByIdSpy).toHaveBeenCalledTimes(1);
      expect(scopedReadProps()).toBeDefined();
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
    });

    // Anything but a refusal is not swallowed into one.
    test("a failing update check is not mistaken for a refusal", async () => {
      mockProps(editorProps());
      mockWorkflowInProject(callerProjectId);
      findOneUpdatableByIdSpy.mockRejectedValue(new Error("database down"));

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(Error);
      expect(result.thrownToNext).not.toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as Error).message).toBe("database down");
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    test("Edit All Operational Resources runs workflows, as it edits them", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.EditAllOperationalResources],
        }),
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.nextCallCount).toBe(0);
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
    });

    // Only an allow row grants: a team's block names a permission to take it away.
    test("a block row of Workflow Member is no grant", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [],
          blocks: [{ permission: Permission.WorkflowMember, labelIds: [] }],
        }),
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    test("a block with no labels on one team wins over the allow on another", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.WorkflowMember],
          blocks: [{ permission: Permission.WorkflowMember, labelIds: [] }],
        }),
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    /*
     * A block limited to labels is about records: the route asks for no
     * record at that step, so it is the caller's scoped read of the workflow
     * that leaves a labelled one out.
     */
    test("a block limited to labels does not refuse the run itself", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.WorkflowMember],
          blocks: [
            {
              permission: Permission.WorkflowMember,
              labelIds: [ObjectID.generate()],
            },
          ],
        }),
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.nextCallCount).toBe(0);
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
    });

    test("rejects a member of the right project holding no permissions at all", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [],
        }),
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    test("lets a master admin run a workflow in a project it is scoped to", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [],
          isMasterAdmin: true,
        }),
      );
      mockWorkflowInProject(callerProjectId);
      // No grant of theirs reaches it; a master admin needs none.
      reach.mayChange = false;
      reach.memberReaches = false;

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.nextCallCount).toBe(0);
      expect(findOneUpdatableByIdSpy).not.toHaveBeenCalled();
      expect(scopedReadProps()).toBeUndefined();
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
    });

    /*
     * The master-admin bypass applies to the permission level only. It does
     * not waive the check that the workflow belongs to the scoped project.
     */
    test("still rejects a master admin targeting a workflow outside the scoped project", async () => {
      mockProps(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [],
          isMasterAdmin: true,
        }),
      );
      mockWorkflowInProject(otherProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });
  });

  describe("authorized callers keep working", () => {
    test("queues the workflow with the caller's data for a member of its project", async () => {
      mockProps(editorProps());
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
        body: { data: { hello: "world" } },
      });

      expect(result.nextCallCount).toBe(0);
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);

      const queueArgs: {
        workflowId: ObjectID;
        returnValues: JSONObject;
      } = addWorkflowToQueueSpy.mock.calls[0]![0] as {
        workflowId: ObjectID;
        returnValues: JSONObject;
      };

      expect(queueArgs.workflowId.toString()).toBe(workflowId.toString());
      expect(queueArgs.returnValues).toEqual({ hello: "world" });
    });

    test("responds with the Scheduled status", async () => {
      mockProps(editorProps());
      mockWorkflowInProject(callerProjectId);

      await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
        body: { data: {} },
      });

      expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);

      const responseArgs: Array<unknown> = (
        Response.sendJsonObjectResponse as unknown as jest.Mock
      ).mock.calls[0] as Array<unknown>;

      expect(responseArgs[2]).toEqual({ status: "Scheduled" });
    });

    test("defaults returnValues to an empty object when the body carries no data", async () => {
      mockProps(editorProps());
      mockWorkflowInProject(callerProjectId);

      await callRunRoute({
        method: "GET",
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);

      const queueArgs: { returnValues: JSONObject } = addWorkflowToQueueSpy.mock
        .calls[0]![0] as { returnValues: JSONObject };

      expect(queueArgs.returnValues).toEqual({});
    });

    test("works over the GET route for an authorized caller too", async () => {
      mockProps(editorProps());
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunRoute({
        method: "GET",
        workflowId: workflowId.toString(),
      });

      expect(result.nextCallCount).toBe(0);
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("request shape", () => {
    test("rejects a request with no workflowId and never authorizes or queues", async () => {
      mockProps(editorProps());

      await callRunRoute({ method: "POST" });

      expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);

      const errorArgs: Array<unknown> = (
        Response.sendErrorResponse as unknown as jest.Mock
      ).mock.calls[0] as Array<unknown>;

      expect(errorArgs[2]).toBeInstanceOf(BadDataException);
      expect(getPropsSpy).not.toHaveBeenCalled();
      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
    });

    /*
     * Failures are handed to next() so the app's error middleware turns them
     * into the right status code, rather than being swallowed into a 200.
     */
    test("passes authorization failures to next() instead of responding success", async () => {
      mockProps({ userType: UserType.Public });

      const result: RouteCallResult = await callRunRoute({
        method: "POST",
        workflowId: workflowId.toString(),
      });

      expect(result.nextCallCount).toBe(1);
      // The error middleware turns this into a 401, which the client refreshes on.
      expectAuthenticationRequired(result.thrownToNext);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    });
  });
});
