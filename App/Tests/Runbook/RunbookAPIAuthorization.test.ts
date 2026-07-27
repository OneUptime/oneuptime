import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import NotFoundException from "Common/Types/Exception/NotFoundException";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Regression tests for the runbook API's authentication/authorization
 * posture. These endpoints start and steer `bash -c` execution on customer
 * hosts, and they used to authorize on nothing more than a caller-supplied
 * tenantid header (getUserMiddleware admits unauthenticated callers as
 * UserType.Public). The fixed handlers must:
 *
 *   1. Reject any caller without a real logged-in session BEFORE touching
 *      any runbook/execution state.
 *   2. Load the runbook/execution under the CALLER's permissions (never
 *      isRoot + header comparison), so a cross-tenant id and an id the
 *      caller cannot read are both denied.
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
       * The route constructor mounts a permission gate per endpoint; these
       * handler-level tests bypass Express middleware entirely, so the mock
       * only needs to return a middleware-shaped function. The gate's own
       * behavior is UserMiddleware's, tested with the middleware itself.
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

jest.mock("Common/Server/Services/RunbookService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/RunbookExecutionService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      create: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/RunbookAgentJobService", () => {
  return {
    __esModule: true,
    default: {
      cancelJobsForExecution: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ScheduledMaintenanceService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Runbook/Services/RunRunbook", () => {
  return {
    __esModule: true,
    default: {
      startExecution: jest.fn(),
    },
  };
});

// Import AFTER the jest.mock calls above (they are hoisted by jest).
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import Response from "Common/Server/Utils/Response";
import RunbookService from "Common/Server/Services/RunbookService";
import RunbookExecutionService from "Common/Server/Services/RunbookExecutionService";
import RunbookAgentJobService from "Common/Server/Services/RunbookAgentJobService";
import IncidentService from "Common/Server/Services/IncidentService";
import RunRunbook from "../../FeatureSet/Runbook/Services/RunRunbook";
import RunbookAPI from "../../FeatureSet/Runbook/API/Runbook";

const getPropsMock: jest.Mock =
  CommonAPI.getDatabaseCommonInteractionProps as unknown as jest.Mock;
const sendJsonMock: jest.Mock =
  Response.sendJsonObjectResponse as unknown as jest.Mock;
const runbookFindMock: jest.Mock =
  RunbookService.findOneById as unknown as jest.Mock;
const executionFindMock: jest.Mock =
  RunbookExecutionService.findOneById as unknown as jest.Mock;
const executionCreateMock: jest.Mock =
  RunbookExecutionService.create as unknown as jest.Mock;
const executionUpdateMock: jest.Mock =
  RunbookExecutionService.updateOneById as unknown as jest.Mock;
const cancelJobsMock: jest.Mock =
  RunbookAgentJobService.cancelJobsForExecution as unknown as jest.Mock;
const incidentFindMock: jest.Mock =
  IncidentService.findOneById as unknown as jest.Mock;
const startExecutionMock: jest.Mock =
  RunRunbook.startExecution as unknown as jest.Mock;

const userId: ObjectID = ObjectID.generate();
const tenantId: ObjectID = ObjectID.generate();

/*
 * Props as CommonAPI derives them from the request: an unauthenticated
 * (Public) caller has NO userId even when it supplies a tenantid header —
 * that header alone used to be the entire authorization check.
 */
const publicCallerProps: DatabaseCommonInteractionProps = {
  tenantId: tenantId,
};

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

function enabledRunbook(): Record<string, unknown> {
  return {
    _id: ObjectID.generate().toString(),
    projectId: tenantId,
    name: "Restart service",
    isEnabled: true,
    steps: [
      {
        id: "step-1",
        order: 1,
        type: RunbookStepType.Bash,
        title: "Restart",
        config: {},
      },
    ],
  };
}

function runningExecution(): Record<string, unknown> {
  return {
    _id: ObjectID.generate().toString(),
    projectId: tenantId,
    status: RunbookExecutionStatus.Running,
    stepExecutions: [
      {
        step: { id: "step-1", order: 1, type: RunbookStepType.Manual },
        status: RunbookStepExecutionStatus.WaitingForUser,
      },
    ],
  };
}

describe("RunbookAPI authorization", () => {
  let api: RunbookAPI;
  let next: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    api = new RunbookAPI();
    next = jest.fn() as unknown as jest.Mock;
  });

  describe("route permission gates", () => {
    test("all four endpoints mount execute-capable permission gates — read access alone must never run or steer executions", () => {
      /*
       * Running/steering executes bash on customer hosts, so the routes
       * demand the same permission sets as RunbookExecution's own table
       * ACLs (create for /run, update for step complete/skip and cancel).
       * Runbook's READ ACL (Viewer/RunbookViewer/ReadRunbook) must never
       * appear — reading a runbook is not a license to execute it.
       */
      const gateCalls: Array<Array<Permission>> = (
        UserMiddleware.requirePermission as jest.Mock
      ).mock.calls.map((call: unknown[]) => {
        return (call[0] as { permissions: Array<Permission> }).permissions;
      });

      // One gate per endpoint: run, step complete, step skip, cancel.
      expect(gateCalls).toHaveLength(4);

      // /run demands RunbookExecution's create-level set.
      expect(gateCalls[0]).toEqual(
        expect.arrayContaining([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.RunbookAdmin,
          Permission.RunbookMember,
          Permission.CreateRunbookExecution,
        ]),
      );

      // Steering demands RunbookExecution's update-level set.
      for (const steeringGate of gateCalls.slice(1)) {
        expect(steeringGate).toEqual(
          expect.arrayContaining([
            Permission.ProjectOwner,
            Permission.ProjectAdmin,
            Permission.RunbookAdmin,
            Permission.EditRunbookExecution,
          ]),
        );
      }

      for (const gate of gateCalls) {
        expect(gate).not.toContain(Permission.Viewer);
        expect(gate).not.toContain(Permission.RunbookViewer);
        expect(gate).not.toContain(Permission.ReadRunbook);
        expect(gate).not.toContain(Permission.ReadRunbookExecution);
      }
    });
  });

  describe("POST /run/:runbookId", () => {
    test("rejects an unauthenticated (Public) caller before reading any state", async () => {
      getPropsMock.mockResolvedValue(publicCallerProps as never);

      await api.runRunbook(
        makeRequest({ params: { runbookId: ObjectID.generate().toString() } }),
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(next).toHaveBeenCalledTimes(1);
      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotAuthorizedException);
      expect(runbookFindMock).not.toHaveBeenCalled();
      expect(executionCreateMock).not.toHaveBeenCalled();
      expect(startExecutionMock).not.toHaveBeenCalled();
    });

    test("requires a project scope even for a logged-in user", async () => {
      getPropsMock.mockResolvedValue({ userId: userId } as never);

      await api.runRunbook(
        makeRequest({ params: { runbookId: ObjectID.generate().toString() } }),
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(BadDataException);
      expect(runbookFindMock).not.toHaveBeenCalled();
    });

    test("loads the runbook under the CALLER's permissions, not isRoot", async () => {
      const props: DatabaseCommonInteractionProps = loggedInProps();
      getPropsMock.mockResolvedValue(props as never);
      runbookFindMock.mockResolvedValue(enabledRunbook() as never);
      executionCreateMock.mockResolvedValue({
        _id: "created-execution-id",
        status: RunbookExecutionStatus.Scheduled,
      } as never);
      startExecutionMock.mockResolvedValue(undefined as never);

      await api.runRunbook(
        makeRequest({ params: { runbookId: ObjectID.generate().toString() } }),
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(runbookFindMock).toHaveBeenCalledTimes(1);
      const findArgs: Record<string, unknown> = runbookFindMock.mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArgs["props"]).toBe(props);
      expect(
        (findArgs["props"] as DatabaseCommonInteractionProps).isRoot,
      ).toBeUndefined();
    });

    test("denies a foreign-tenant or unreadable runbook (scoped read returns null)", async () => {
      getPropsMock.mockResolvedValue(loggedInProps() as never);
      runbookFindMock.mockResolvedValue(null as never);

      await api.runRunbook(
        makeRequest({ params: { runbookId: ObjectID.generate().toString() } }),
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotFoundException);
      expect(executionCreateMock).not.toHaveBeenCalled();
      expect(startExecutionMock).not.toHaveBeenCalled();
    });

    test("runs the runbook and attributes the execution to the session user", async () => {
      getPropsMock.mockResolvedValue(loggedInProps() as never);
      runbookFindMock.mockResolvedValue(enabledRunbook() as never);
      executionCreateMock.mockResolvedValue({
        _id: "created-execution-id",
        status: RunbookExecutionStatus.Scheduled,
      } as never);
      startExecutionMock.mockResolvedValue(undefined as never);

      const req: ExpressRequest = makeRequest({
        params: { runbookId: ObjectID.generate().toString() },
      });

      await api.runRunbook(req, mockResponse, next as unknown as NextFunction);

      expect(next).not.toHaveBeenCalled();

      // The write is a controlled server-side transition (root)...
      const createArgs: Record<string, unknown> = executionCreateMock.mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(createArgs["props"]).toEqual({ isRoot: true });

      // ...attributed to the authenticated user, never an optional header.
      const createdData: Record<string, unknown> = createArgs["data"] as Record<
        string,
        unknown
      >;
      expect(createdData["triggeredByUserId"]?.toString()).toBe(
        userId.toString(),
      );

      expect(startExecutionMock).toHaveBeenCalledTimes(1);

      // Response shape is unchanged for the dashboard caller.
      expect(sendJsonMock).toHaveBeenCalledWith(req, mockResponse, {
        runbookExecutionId: "created-execution-id",
        status: RunbookExecutionStatus.Scheduled,
      });
    });

    test("rejects a linked incident the caller cannot read", async () => {
      const props: DatabaseCommonInteractionProps = loggedInProps();
      getPropsMock.mockResolvedValue(props as never);
      runbookFindMock.mockResolvedValue(enabledRunbook() as never);
      incidentFindMock.mockResolvedValue(null as never);

      await api.runRunbook(
        makeRequest({
          params: { runbookId: ObjectID.generate().toString() },
          body: { incidentId: ObjectID.generate().toString() },
        }),
        mockResponse,
        next as unknown as NextFunction,
      );

      // The incident lookup itself must run under the caller's permissions.
      const incidentArgs: Record<string, unknown> = incidentFindMock.mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(incidentArgs["props"]).toBe(props);

      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(BadDataException);
      expect(executionCreateMock).not.toHaveBeenCalled();
    });
  });

  describe("POST /execution/:executionId/step/:stepId/complete and /skip", () => {
    test("rejects an unauthenticated (Public) caller", async () => {
      getPropsMock.mockResolvedValue(publicCallerProps as never);

      await api.completeManualStep(
        makeRequest({
          params: {
            executionId: ObjectID.generate().toString(),
            stepId: "step-1",
          },
        }),
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotAuthorizedException);
      expect(executionFindMock).not.toHaveBeenCalled();
      expect(executionUpdateMock).not.toHaveBeenCalled();
    });

    test("denies an execution the caller cannot read (foreign tenant)", async () => {
      getPropsMock.mockResolvedValue(loggedInProps() as never);
      executionFindMock.mockResolvedValue(null as never);

      await api.skipStep(
        makeRequest({
          params: {
            executionId: ObjectID.generate().toString(),
            stepId: "step-1",
          },
        }),
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotFoundException);
      expect(executionUpdateMock).not.toHaveBeenCalled();
      expect(startExecutionMock).not.toHaveBeenCalled();
    });

    test("completes a step for an authorized caller and stamps the session user", async () => {
      const props: DatabaseCommonInteractionProps = loggedInProps();
      getPropsMock.mockResolvedValue(props as never);
      executionFindMock.mockResolvedValue(runningExecution() as never);
      executionUpdateMock.mockResolvedValue(undefined as never);
      startExecutionMock.mockResolvedValue(undefined as never);

      const req: ExpressRequest = makeRequest({
        params: {
          executionId: ObjectID.generate().toString(),
          stepId: "step-1",
        },
        body: { notes: "done manually" },
      });

      await api.completeManualStep(
        req,
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(next).not.toHaveBeenCalled();

      // The access-check read ran under the caller's permissions.
      const findArgs: Record<string, unknown> = executionFindMock.mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArgs["props"]).toBe(props);

      const updateArgs: Record<string, unknown> = executionUpdateMock.mock
        .calls[0]?.[0] as Record<string, unknown>;
      const updatedSteps: Array<Record<string, unknown>> = (
        updateArgs["data"] as Record<string, unknown>
      )["stepExecutions"] as Array<Record<string, unknown>>;
      expect(updatedSteps[0]?.["status"]).toBe(
        RunbookStepExecutionStatus.Completed,
      );
      expect(updatedSteps[0]?.["completedByUserId"]).toBe(userId.toString());

      expect(sendJsonMock).toHaveBeenCalledWith(req, mockResponse, {
        status: "ok",
      });
    });
  });

  describe("POST /execution/:executionId/cancel", () => {
    test("rejects an unauthenticated (Public) caller", async () => {
      getPropsMock.mockResolvedValue(publicCallerProps as never);

      await api.cancelExecution(
        makeRequest({
          params: { executionId: ObjectID.generate().toString() },
        }),
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotAuthorizedException);
      expect(executionFindMock).not.toHaveBeenCalled();
      expect(cancelJobsMock).not.toHaveBeenCalled();
    });

    test("denies an execution the caller cannot read (foreign tenant)", async () => {
      getPropsMock.mockResolvedValue(loggedInProps() as never);
      executionFindMock.mockResolvedValue(null as never);

      await api.cancelExecution(
        makeRequest({
          params: { executionId: ObjectID.generate().toString() },
        }),
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(next.mock.calls[0]?.[0]).toBeInstanceOf(NotFoundException);
      expect(executionUpdateMock).not.toHaveBeenCalled();
      expect(cancelJobsMock).not.toHaveBeenCalled();
    });

    test("cancels a running execution for an authorized caller", async () => {
      const props: DatabaseCommonInteractionProps = loggedInProps();
      getPropsMock.mockResolvedValue(props as never);
      executionFindMock.mockResolvedValue(runningExecution() as never);
      executionUpdateMock.mockResolvedValue(undefined as never);
      cancelJobsMock.mockResolvedValue(undefined as never);

      const req: ExpressRequest = makeRequest({
        params: { executionId: ObjectID.generate().toString() },
      });

      await api.cancelExecution(
        req,
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(next).not.toHaveBeenCalled();

      const findArgs: Record<string, unknown> = executionFindMock.mock
        .calls[0]?.[0] as Record<string, unknown>;
      expect(findArgs["props"]).toBe(props);

      expect(executionUpdateMock).toHaveBeenCalledTimes(1);
      expect(cancelJobsMock).toHaveBeenCalledTimes(1);
      expect(sendJsonMock).toHaveBeenCalledWith(req, mockResponse, {
        status: RunbookExecutionStatus.Cancelled,
      });
    });

    test("short-circuits on an already-terminal execution without writing", async () => {
      getPropsMock.mockResolvedValue(loggedInProps() as never);
      executionFindMock.mockResolvedValue({
        _id: ObjectID.generate().toString(),
        projectId: tenantId,
        status: RunbookExecutionStatus.Completed,
        stepExecutions: [],
      } as never);

      const req: ExpressRequest = makeRequest({
        params: { executionId: ObjectID.generate().toString() },
      });

      await api.cancelExecution(
        req,
        mockResponse,
        next as unknown as NextFunction,
      );

      expect(executionUpdateMock).not.toHaveBeenCalled();
      expect(cancelJobsMock).not.toHaveBeenCalled();
      expect(sendJsonMock).toHaveBeenCalledWith(req, mockResponse, {
        status: RunbookExecutionStatus.Completed,
      });
    });
  });
});
