import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Regression tests for the manual workflow trigger's auth posture. The old
 * endpoint mounted only getUserMiddleware (which admits unauthenticated
 * callers as UserType.Public), performed NO tenant or permission check, and
 * accepted GET — anyone who knew a workflowId could execute that workflow's
 * JavaScript and HTTP components on the OneUptime worker. The fixed handler
 * must require a logged-in session, load the workflow under the CALLER's
 * permissions, and only mount POST (the dashboard builder is the sole
 * caller and always POSTs).
 */

jest.mock("Common/Server/Utils/Express", () => {
  const routerStub: Record<string, unknown> = {
    post: jest.fn(),
    get: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      getRouter: jest.fn(() => {
        return routerStub;
      }),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      /*
       * The route constructor mounts a permission gate on the run endpoint;
       * these handler-level tests bypass Express middleware entirely, so
       * the mock only needs to return a middleware-shaped function.
       */
      requirePermission: jest.fn(() => {
        return jest.fn();
      }),
    },
  };
});

jest.mock("Common/Server/API/CommonAPI", () => {
  return {
    __esModule: true,
    default: {
      getDatabaseCommonInteractionProps: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/WorkflowService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

jest.mock("../../../FeatureSet/Workflow/Services/QueueWorkflow", () => {
  return {
    __esModule: true,
    default: {
      addWorkflowToQueue: jest.fn(),
    },
  };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import Express from "Common/Server/Utils/Express";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import WorkflowService from "Common/Server/Services/WorkflowService";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
import ManualAPI from "../../../FeatureSet/Workflow/API/Manual";

const getPropsMock: jest.Mock =
  CommonAPI.getDatabaseCommonInteractionProps as unknown as jest.Mock;
const sendJsonMock: jest.Mock =
  Response.sendJsonObjectResponse as unknown as jest.Mock;
const workflowFindMock: jest.Mock =
  WorkflowService.findOneById as unknown as jest.Mock;
const addToQueueMock: jest.Mock =
  QueueWorkflow.addWorkflowToQueue as unknown as jest.Mock;

type RouterStub = { post: jest.Mock; get: jest.Mock };

function getRouterStub(): RouterStub {
  return (Express.getRouter as unknown as jest.Mock)() as RouterStub;
}

const userId: ObjectID = ObjectID.generate();
const tenantId: ObjectID = ObjectID.generate();

function loggedInProps(): DatabaseCommonInteractionProps {
  return { userId: userId, tenantId: tenantId };
}

function makeRequest(data: {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}): ExpressRequest {
  return {
    params: data.params || {},
    body: data.body || {},
  } as unknown as ExpressRequest;
}

const mockResponse: ExpressResponse = {} as ExpressResponse;

describe("ManualAPI (workflow manual trigger) authorization", () => {
  let api: ManualAPI;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    api = new ManualAPI();
    next = jest.fn() as unknown as jest.Mock;
  });

  test("mounts POST /run/:workflowId only — the GET trigger is gone", () => {
    const routerStub: RouterStub = getRouterStub();

    expect(routerStub.get).not.toHaveBeenCalled();
    expect(routerStub.post).toHaveBeenCalledTimes(1);
    expect(routerStub.post.mock.calls[0]?.[0]).toBe("/run/:workflowId");
  });

  test("mounts an execute-capable permission gate — read access alone must not run workflows", () => {
    /*
     * Manually running a workflow executes its JavaScript/HTTP components
     * with stored project credentials, so the route must demand one of the
     * permissions that could author workflows — never mere read access
     * (Workflow's read ACL includes Viewer/WorkflowViewer/ReadWorkflow,
     * none of which may appear here).
     */
    expect(UserMiddleware.requirePermission).toHaveBeenCalledWith({
      permissions: expect.arrayContaining([
        Permission.ProjectOwner,
        Permission.ProjectAdmin,
        Permission.ProjectMember,
        Permission.WorkflowAdmin,
        Permission.WorkflowMember,
        Permission.CreateWorkflow,
        Permission.EditWorkflow,
      ]),
    });

    const granted: Array<Permission> = (
      UserMiddleware.requirePermission as jest.Mock
    ).mock.calls[0]?.[0]?.permissions;
    expect(granted).not.toContain(Permission.Viewer);
    expect(granted).not.toContain(Permission.WorkflowViewer);
    expect(granted).not.toContain(Permission.ReadWorkflow);
  });

  test("rejects an unauthenticated (Public) caller before touching the workflow", async () => {
    // A Public caller has no userId — even with a tenantid header supplied.
    getPropsMock.mockResolvedValue({ tenantId: tenantId } as never);

    await api.manuallyRunWorkflow(
      makeRequest({ params: { workflowId: ObjectID.generate().toString() } }),
      mockResponse,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotAuthorizedException);
    expect(workflowFindMock).not.toHaveBeenCalled();
    expect(addToQueueMock).not.toHaveBeenCalled();
  });

  test("requires a project scope even for a logged-in user", async () => {
    getPropsMock.mockResolvedValue({ userId: userId } as never);

    await api.manuallyRunWorkflow(
      makeRequest({ params: { workflowId: ObjectID.generate().toString() } }),
      mockResponse,
      next as unknown as NextFunction,
    );

    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(BadDataException);
    expect(addToQueueMock).not.toHaveBeenCalled();
  });

  test("denies a foreign-tenant or unreadable workflow (scoped read returns null)", async () => {
    const props: DatabaseCommonInteractionProps = loggedInProps();
    getPropsMock.mockResolvedValue(props as never);
    workflowFindMock.mockResolvedValue(null as never);

    await api.manuallyRunWorkflow(
      makeRequest({ params: { workflowId: ObjectID.generate().toString() } }),
      mockResponse,
      next as unknown as NextFunction,
    );

    // The lookup itself must run under the caller's permissions, not isRoot.
    const findArgs: Record<string, unknown> = workflowFindMock.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(findArgs["props"]).toBe(props);

    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotFoundException);
    expect(addToQueueMock).not.toHaveBeenCalled();
  });

  test("queues the workflow for an authorized caller and preserves the response shape", async () => {
    getPropsMock.mockResolvedValue(loggedInProps() as never);
    workflowFindMock.mockResolvedValue({
      _id: ObjectID.generate().toString(),
    } as never);
    addToQueueMock.mockResolvedValue(undefined as never);

    const workflowId: string = ObjectID.generate().toString();
    const req: ExpressRequest = makeRequest({
      params: { workflowId: workflowId },
      body: { data: { key: "value" } },
    });

    await api.manuallyRunWorkflow(
      req,
      mockResponse,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();

    const queueArgs: Record<string, unknown> = addToQueueMock.mock
      .calls[0]?.[0] as Record<string, unknown>;
    expect(queueArgs["workflowId"]?.toString()).toBe(workflowId);
    expect(queueArgs["returnValues"]).toEqual({ key: "value" });

    expect(sendJsonMock).toHaveBeenCalledWith(req, mockResponse, {
      status: "Scheduled",
    });
  });
});
