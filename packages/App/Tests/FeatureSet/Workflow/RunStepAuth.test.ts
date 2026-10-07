/*
 * ---------------------------------------------------------------------------
 * POST /workflow/run-step/:workflowId — "run just this step" from the builder.
 *
 * This route runs component code inside a project: chat and email sends,
 * arbitrary outbound HTTP, per-model create/update/delete, sandboxed
 * JavaScript. It is the same blast radius as the manual run, so it carries the
 * same four gates, and the load-bearing assertion in every deny case below is
 * that QueueWorkflow.addWorkflowToQueue was NEVER called. An error response on
 * its own would not prove the work was stopped.
 *
 * Who may: the workflow's editors (WORKFLOW_EDIT_PERMISSIONS, the Workflow
 * model's update list), on a workflow they may change - the update scope of
 * their grants. A Workflow Member runs whole workflows (the manual run) but
 * not one step on its own, which skips every condition before it.
 *
 * The route deliberately enqueues rather than executing inline. Everything the
 * queue enforces — the workflow being enabled, a paid subscription, the plan's
 * run limit, a WorkflowLog for the audit trail, and running on a worker rather
 * than in the API process — is inherited only because the handler goes through
 * addWorkflowToQueue. A test here pins that it does.
 * ---------------------------------------------------------------------------
 */

import RunStepAPI from "../../../FeatureSet/Workflow/API/RunStep";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import CommonAPI from "Common/Server/API/CommonAPI";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
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
  WORKFLOW_EDIT_PERMISSIONS,
  WORKFLOW_RUN_PERMISSIONS,
  WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
} from "Common/Types/Workflow/WorkflowRunPermissions";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

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
      uri: uri,
      middleware: middleware,
      handlerFunction: handlerFunction,
    });
  };
};

const mockRouter: {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
} = {
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
      getRouter: (): unknown => {
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
 * The queue is not under test — whether the handler ever reaches it is.
 * Mocking the module also keeps the real runner (and its isolated-vm native
 * binding) out of this suite.
 */
jest.mock("../../../FeatureSet/Workflow/Services/QueueWorkflow", () => {
  return {
    __esModule: true,
    default: {
      addWorkflowToQueue: jest.fn(),
    },
  };
});

const RUN_STEP_ROUTE: string = "/run-step/:workflowId";

type RouteCallResult = {
  thrownToNext: unknown;
  nextCallCount: number;
};

type MatchRouteFunction = (method: string, uri: string) => MockRoute;

const matchRoute: MatchRouteFunction = (
  method: string,
  uri: string,
): MockRoute => {
  const route: MockRoute | undefined = mockRoutes.find(
    (candidate: MockRoute) => {
      return candidate.method === method.toUpperCase() && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`Route ${method} ${uri} was never registered`);
  }

  return route;
};

type CallRouteFunction = (data: {
  workflowId?: string | undefined;
  body?: JSONObject | undefined;
}) => Promise<RouteCallResult>;

const callRunStepRoute: CallRouteFunction = async (data: {
  workflowId?: string | undefined;
  body?: JSONObject | undefined;
}): Promise<RouteCallResult> => {
  const params: Dictionary<string> = {};

  if (data.workflowId !== undefined) {
    params["workflowId"] = data.workflowId;
  }

  const req: ExpressRequest = {
    params: params,
    query: {},
    body: data.body === undefined ? { componentId: "log-1" } : data.body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await matchRoute("POST", RUN_STEP_ROUTE).handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
};

type BuildPropsFunction = (data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  // Permissions a team holds as blocks with no labels.
  blocked?: Array<Permission> | undefined;
  isMasterAdmin?: boolean | undefined;
}) => DatabaseCommonInteractionProps;

const buildUserProps: BuildPropsFunction = (data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  blocked?: Array<Permission> | undefined;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps => {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[data.projectId.toString()] = {
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
      ...(data.blocked || []).map((permission: Permission) => {
        const userPermission: UserPermission = {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: true,
        };

        return userPermission;
      }),
    ],
  } as UserTenantAccessPermission;

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userType: data.isMasterAdmin ? UserType.MasterAdmin : UserType.User,
    userTenantAccessPermission: permissionMap,
    ...(data.isMasterAdmin ? { isMasterAdmin: true } : {}),
  } as DatabaseCommonInteractionProps;
};

describe("POST /workflow/run-step/:workflowId", () => {
  let callerProjectId: ObjectID;
  let otherProjectId: ObjectID;
  let callerUserId: ObjectID;
  let workflowId: ObjectID;

  let getPropsSpy: jest.SpyInstance;
  let findOneByIdSpy: jest.SpyInstance;
  let findOneUpdatableByIdSpy: jest.SpyInstance;
  let addWorkflowToQueueSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunStepAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    callerProjectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    callerUserId = ObjectID.generate();
    workflowId = ObjectID.generate();

    getPropsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    findOneByIdSpy = jest.spyOn(WorkflowService, "findOneById");
    // The caller may change the workflow unless a test says otherwise.
    findOneUpdatableByIdSpy = jest
      .spyOn(WorkflowService, "findOneUpdatableById")
      .mockImplementation(async () => {
        const workflow: WorkflowModel = new WorkflowModel();
        workflow.id = workflowId;

        return workflow as never;
      });
    addWorkflowToQueueSpy = jest
      .spyOn(QueueWorkflow, "addWorkflowToQueue")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type MockWorkflowFunction = (projectId: ObjectID | null) => void;

  const mockWorkflowInProject: MockWorkflowFunction = (
    projectId: ObjectID | null,
  ): void => {
    if (!projectId) {
      findOneByIdSpy.mockResolvedValue(null as never);
      return;
    }

    const workflow: WorkflowModel = new WorkflowModel();
    workflow.id = workflowId;
    workflow.projectId = projectId;

    findOneByIdSpy.mockResolvedValue(workflow as never);
  };

  describe("allows an authorized member of the workflow's own project", () => {
    test("enqueues the step and reports it scheduled", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.ProjectOwner],
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
        body: { componentId: "api-post-1" },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
    });

    /*
     * The route must go through the queue rather than executing the component
     * itself: the enabled check, the billing checks, the plan run-limit, the
     * WorkflowLog audit row and the worker topology all live behind this call.
     */
    test("asks the queue to run only the requested component", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.ProjectOwner],
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);

      await callRunStepRoute({
        workflowId: workflowId.toString(),
        body: { componentId: "api-post-1" },
      });

      const enqueued: JSONObject = addWorkflowToQueueSpy.mock
        .calls[0]?.[0] as JSONObject;

      expect(enqueued["runOnlyComponentId"]).toBe("api-post-1");
      expect((enqueued["workflowId"] as ObjectID).toString()).toBe(
        workflowId.toString(),
      );
    });

    test("lets a master admin through, without asking what their grants reach", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [],
          isMasterAdmin: true,
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);
      findOneUpdatableByIdSpy.mockResolvedValue(null as never);

      await callRunStepRoute({ workflowId: workflowId.toString() });

      expect(findOneUpdatableByIdSpy).not.toHaveBeenCalled();
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
    });

    test("the step list is exactly the Workflow model's update list, in its order", () => {
      expect([...WORKFLOW_EDIT_PERMISSIONS]).toEqual(
        new WorkflowModel().getUpdatePermissions(),
      );
    });

    test.each([...WORKFLOW_EDIT_PERMISSIONS])(
      "lets a caller holding %s run a step of a workflow they may change",
      async (permission: Permission) => {
        getPropsSpy.mockResolvedValue(
          buildUserProps({
            projectId: callerProjectId,
            userId: callerUserId,
            permissions: [permission],
          }) as never,
        );
        mockWorkflowInProject(callerProjectId);

        const result: RouteCallResult = await callRunStepRoute({
          workflowId: workflowId.toString(),
        });

        expect(result.thrownToNext).toBeUndefined();
        expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
      },
    );

    // The wildcard that edits every operational resource runs a step too.
    test("lets Edit All Operational Resources run a step", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.EditAllOperationalResources],
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(addWorkflowToQueueSpy).toHaveBeenCalledTimes(1);
    });

    /*
     * Whether the caller may change THIS workflow is the update scope of
     * their grants - labels, owned scope, blocks - asked with their own
     * props, once its project has matched.
     */
    test("asks whether the caller may change this workflow, with their own props", async () => {
      const props: DatabaseCommonInteractionProps = buildUserProps({
        projectId: callerProjectId,
        userId: callerUserId,
        permissions: [Permission.WorkflowAdmin],
      });

      getPropsSpy.mockResolvedValue(props as never);
      mockWorkflowInProject(callerProjectId);

      await callRunStepRoute({ workflowId: workflowId.toString() });

      expect(findOneUpdatableByIdSpy).toHaveBeenCalledTimes(1);

      const args: { id: ObjectID; props: DatabaseCommonInteractionProps } =
        findOneUpdatableByIdSpy.mock.calls[0]![0] as {
          id: ObjectID;
          props: DatabaseCommonInteractionProps;
        };

      expect(args.id.toString()).toBe(workflowId.toString());
      expect(args.props).toBe(props);

      // The project comes off the row, read as OneUptime, before that.
      const projectRead: {
        select: Dictionary<boolean>;
        props: Dictionary<boolean>;
      } = findOneByIdSpy.mock.calls[0]![0] as {
        select: Dictionary<boolean>;
        props: Dictionary<boolean>;
      };

      expect(projectRead.select).toEqual({ projectId: true });
      expect(projectRead.props["isRoot"]).toBe(true);
    });
  });

  describe("refuses, and runs nothing, when", () => {
    test("the workflow id is missing", async () => {
      await callRunStepRoute({ workflowId: undefined });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      // Rejected before auth machinery is even consulted.
      expect(getPropsSpy).not.toHaveBeenCalled();
    });

    test("no component id was given", async () => {
      await callRunStepRoute({
        workflowId: workflowId.toString(),
        body: {},
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(getPropsSpy).not.toHaveBeenCalled();
    });

    test("the component id is not a string", async () => {
      await callRunStepRoute({
        workflowId: workflowId.toString(),
        body: { componentId: { evil: true } } as unknown as JSONObject,
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(getPropsSpy).not.toHaveBeenCalled();
    });

    /*
     * Was BadDataException: with no tenantid header either, the missing
     * project used to be reported first. Credentials are checked first now,
     * so a caller with none - usually a builder tab whose session expired -
     * gets 401, the status the browser client refreshes the session on.
     */
    test("the caller is not logged in - 401, not the missing-project 400", async () => {
      getPropsSpy.mockResolvedValue({
        userType: UserType.Public,
      } as never);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
      expect(result.thrownToNext).not.toBeInstanceOf(BadDataException);
      expect((result.thrownToNext as NotAuthenticatedException).code).toBe(
        ExceptionCode.NotAuthenticatedException,
      );
      expect((result.thrownToNext as NotAuthenticatedException).message).toBe(
        CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
      );
    });

    test("the caller is not logged in but names a project in the tenant header - still 401", async () => {
      getPropsSpy.mockResolvedValue({
        userType: UserType.Public,
        tenantId: callerProjectId,
      } as never);
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
      expect(result.thrownToNext).not.toBeInstanceOf(NotAuthorizedException);
    });

    /*
     * An API key is a credential, so it is refused as not-a-member (422)
     * rather than as anonymous (401): running a step backs the builder's
     * button and needs a logged-in member.
     */
    test("the caller is a project API key - 422, not 401", async () => {
      const props: DatabaseCommonInteractionProps = buildUserProps({
        projectId: callerProjectId,
        userId: callerUserId,
        permissions: [Permission.ProjectOwner],
      });

      getPropsSpy.mockResolvedValue({
        ...props,
        userId: undefined,
        userType: UserType.API,
      } as never);
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(result.thrownToNext).not.toBeInstanceOf(NotAuthenticatedException);
      expect((result.thrownToNext as NotAuthorizedException).code).toBe(
        ExceptionCode.NotAuthorizedException,
      );
    });

    /*
     * A Workflow Member may run the whole workflow, from its trigger, but
     * not one step on its own: that skips every condition before it, so it
     * is a builder's test.
     */
    test("the caller is a Workflow Member, who runs whole workflows only", async () => {
      expect(WORKFLOW_RUN_PERMISSIONS).toContain(Permission.WorkflowMember);
      expect(WORKFLOW_EDIT_PERMISSIONS).not.toContain(
        Permission.WorkflowMember,
      );

      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.WorkflowMember],
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as NotAuthorizedException).message).toBe(
        WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
      );
      // Refused before anything is read.
      expect(findOneByIdSpy).not.toHaveBeenCalled();
      expect(findOneUpdatableByIdSpy).not.toHaveBeenCalled();
    });

    test("the caller's edit grants do not reach this workflow", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.EditWorkflow],
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);
      findOneUpdatableByIdSpy.mockResolvedValue(null as never);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as NotAuthorizedException).message).toBe(
        WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
      );
    });

    test("the caller is blocked on one of the workflow's labels", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.EditWorkflow],
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);
      findOneUpdatableByIdSpy.mockRejectedValue(
        new NotAuthorizedException("blocked on the label Payments") as never,
      );

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect((result.thrownToNext as NotAuthorizedException).message).toBe(
        WORKFLOW_STEP_RUN_REFUSED_MESSAGE,
      );
    });

    // Only an allow row grants, and a block with no labels takes it away.
    test("the caller's edit grant is blocked with no labels on another team", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.EditWorkflow],
          blocked: [Permission.EditWorkflow],
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(findOneByIdSpy).not.toHaveBeenCalled();
    });

    test("the caller holds no permission on the claimed project", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [],
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    });

    /*
     * Read-level membership is not enough: running a step writes.
     */
    test("the caller can only read the project", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.Viewer],
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    });

    /*
     * Deleting workflows is not editing one, and running a step needs what
     * editing the workflow needs.
     */
    test("the caller may only delete workflows", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.DeleteWorkflow],
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    });

    /*
     * The claimed tenant comes from a caller-supplied header, so being a
     * legitimate member of SOME project cannot be enough.
     */
    test("the workflow belongs to a different project", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.ProjectOwner],
        }) as never,
      );
      mockWorkflowInProject(otherProjectId);

      const result: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      /*
       * The update check names a row's labels when it refuses, so it is
       * never asked about another project's workflow.
       */
      expect(findOneUpdatableByIdSpy).not.toHaveBeenCalled();
    });

    /*
     * Rejected the same way a foreign workflow is, deliberately: a different
     * error here would let the route be used to discover which workflow ids
     * exist in other projects.
     */
    test("the workflow does not exist — indistinguishable from a foreign one", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [Permission.ProjectOwner],
        }) as never,
      );

      mockWorkflowInProject(null);
      const missing: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      mockWorkflowInProject(otherProjectId);
      const foreign: RouteCallResult = await callRunStepRoute({
        workflowId: workflowId.toString(),
      });

      expect(addWorkflowToQueueSpy).not.toHaveBeenCalled();
      expect(missing.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((missing.thrownToNext as Error).message).toBe(
        (foreign.thrownToNext as Error).message,
      );
    });
  });

  test("the route is registered behind the user middleware", () => {
    const route: MockRoute = matchRoute("POST", RUN_STEP_ROUTE);

    expect(route.middleware).toBeDefined();
  });
});
