/*
 * ---------------------------------------------------------------------------
 * POST /workflow/step-samples/:workflowId - what each step of a workflow held
 * the last times it ran, for the builder's value picker.
 *
 * The answer is read off the runs' step traces, which hold real data: the
 * bodies and headers of the requests a webhook received, the responses APIs
 * gave. So the route asks for what reading the runs through /workflow-log
 * asks for - a logged-in member of the workflow's own project, allowed to
 * read its runs - and reads the rows with the caller's own permissions, never
 * as root. The load-bearing assertion in every deny case is that no run was
 * read at all.
 * ---------------------------------------------------------------------------
 */

import StepSamplesAPI from "../../../FeatureSet/Workflow/API/StepSamples";
import { WORKFLOW_LOG_REDACTED_VALUE } from "../../../FeatureSet/Workflow/Utils/SecretRedaction";
import CommonAPI from "Common/Server/API/CommonAPI";
import Response from "Common/Server/Utils/Response";
import WorkflowLogService from "Common/Server/Services/WorkflowLogService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
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
  STEP_SAMPLES_MAX_COMPONENT_IDS,
  STEP_SAMPLES_MAX_RUNS,
  STEP_SAMPLES_PAGE_SIZE,
  STEP_SAMPLE_REDACTED_VALUE,
  StepSample,
  StepSampleField,
  StepSamplesResponse,
} from "Common/Types/Workflow/StepSamples";
import {
  WorkflowStepStatus,
  WorkflowStepTraceEntry,
} from "Common/Types/Workflow/StepTrace";
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

const ROUTE: string = "/step-samples/:workflowId";

interface RouteCallResult {
  thrownToNext: unknown;
  /** What the route answered with, when it answered. */
  body: StepSamplesResponse | undefined;
}

type CallRouteFunction = (data: {
  workflowId?: string | undefined;
  body?: unknown;
}) => Promise<RouteCallResult>;

const callRoute: CallRouteFunction = async (data: {
  workflowId?: string | undefined;
  body?: unknown;
}): Promise<RouteCallResult> => {
  const route: MockRoute | undefined = mockRoutes.find(
    (candidate: MockRoute) => {
      return candidate.method === "POST" && candidate.uri === ROUTE;
    },
  );

  if (!route) {
    throw new Error(`Route POST ${ROUTE} was never registered`);
  }

  const params: Dictionary<string> = {};

  if (data.workflowId !== undefined) {
    params["workflowId"] = data.workflowId;
  }

  const req: ExpressRequest = {
    params: params,
    query: {},
    body: data.body === undefined ? { componentIds: ["webhook-1"] } : data.body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await route.handlerFunction(req, res, next as unknown as NextFunction);

  const sent: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    body: sent.mock.calls[0]
      ? (sent.mock.calls[0][2] as StepSamplesResponse)
      : undefined,
  };
};

type BuildPropsFunction = (data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  isMasterAdmin?: boolean | undefined;
}) => DatabaseCommonInteractionProps;

const buildUserProps: BuildPropsFunction = (data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
  isMasterAdmin?: boolean | undefined;
}): DatabaseCommonInteractionProps => {
  const permissionMap: Dictionary<UserTenantAccessPermission> = {};

  permissionMap[data.projectId.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    // Grants, as the permission snapshot gives them: not blocks.
    permissions: data.permissions.map((permission: Permission) => {
      const userPermission: UserPermission = {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };

      return userPermission;
    }),
  } as UserTenantAccessPermission;

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userType: data.isMasterAdmin ? UserType.MasterAdmin : UserType.User,
    userTenantAccessPermission: permissionMap,
    ...(data.isMasterAdmin ? { isMasterAdmin: true } : {}),
  } as DatabaseCommonInteractionProps;
};

type EntryFunction = (
  overrides: Partial<WorkflowStepTraceEntry>,
) => WorkflowStepTraceEntry;

const entry: EntryFunction = (
  overrides: Partial<WorkflowStepTraceEntry>,
): WorkflowStepTraceEntry => {
  return {
    componentId: "webhook-1",
    metadataId: "webhook",
    title: "Webhook",
    status: WorkflowStepStatus.Success,
    startedAt: "2026-10-01T12:00:00.000Z",
    completedAt: "2026-10-01T12:00:00.100Z",
    durationInMs: 100,
    argumentValues: {},
    returnValues: {},
    executedPort: "out",
    ...overrides,
  };
};

type LogFunction = (
  createdAt: string,
  steps: Array<WorkflowStepTraceEntry>,
) => WorkflowLog;

const logRow: LogFunction = (
  createdAt: string,
  steps: Array<WorkflowStepTraceEntry>,
): WorkflowLog => {
  const log: WorkflowLog = new WorkflowLog();
  log._id = ObjectID.generate().toString();
  log.createdAt = new Date(createdAt);
  log.stepTrace = { steps: steps } as unknown as JSONObject;
  return log;
};

const WEBHOOK_RUN: WorkflowLog = logRow("2026-10-01T12:00:00.000Z", [
  entry({
    returnValues: {
      "request-body": {
        incident: { title: "Database is down" },
        note: WORKFLOW_LOG_REDACTED_VALUE,
      },
      "request-headers": {
        authorization: "Bearer live-token-123",
        "content-type": "application/json",
      },
      "request-params": {},
    },
  }),
  entry({
    componentId: "api-post-1",
    metadataId: "api-post",
    title: "API Post",
    returnValues: { "response-status": 201 },
  }),
]);

describe("POST /workflow/step-samples/:workflowId", () => {
  let callerProjectId: ObjectID;
  let otherProjectId: ObjectID;
  let callerUserId: ObjectID;
  let workflowId: ObjectID;

  let getPropsSpy: jest.SpyInstance;
  let findWorkflowSpy: jest.SpyInstance;
  let findLogsSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRoutes.length = 0;
    new StepSamplesAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    callerProjectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    callerUserId = ObjectID.generate();
    workflowId = ObjectID.generate();

    getPropsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");
    findWorkflowSpy = jest.spyOn(WorkflowService, "findOneById");
    findLogsSpy = jest
      .spyOn(WorkflowLogService, "findBy")
      .mockResolvedValue([WEBHOOK_RUN] as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type MockWorkflowFunction = (projectId: ObjectID | null) => void;

  const mockWorkflowInProject: MockWorkflowFunction = (
    projectId: ObjectID | null,
  ): void => {
    if (!projectId) {
      findWorkflowSpy.mockResolvedValue(null as never);
      return;
    }

    const workflow: WorkflowModel = new WorkflowModel();
    workflow.id = workflowId;
    workflow.projectId = projectId;

    findWorkflowSpy.mockResolvedValue(workflow as never);
  };

  type AsMemberFunction = (permissions: Array<Permission>) => void;

  const asMember: AsMemberFunction = (permissions: Array<Permission>): void => {
    getPropsSpy.mockResolvedValue(
      buildUserProps({
        projectId: callerProjectId,
        userId: callerUserId,
        permissions: permissions,
      }) as never,
    );
  };

  describe("answers a member who may read the workflow's runs", () => {
    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.Viewer,
      Permission.WorkflowAdmin,
      Permission.WorkflowMember,
      Permission.WorkflowViewer,
      Permission.ReadWorkflowLog,
    ])("with %s", async (permission: Permission) => {
      asMember([permission]);
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.body?.samples.length).toBe(1);
    });

    test("with the fields of the request the webhook received", async () => {
      asMember([Permission.ProjectOwner]);
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      const webhook: StepSample = result.body!.samples[0]!;
      const paths: Array<string> = webhook.returnValues[
        "request-body"
      ]!.fields.map((field: StepSampleField) => {
        return field.path;
      });

      expect(webhook.componentId).toBe("webhook-1");
      expect(paths).toEqual(["incident", "incident.title", "note"]);
      expect(
        webhook.returnValues["request-body"]!.fields.find(
          (field: StepSampleField) => {
            return field.path === "incident.title";
          },
        )?.preview,
      ).toBe("Database is down");
    });

    test("never with a credential, or with what the run redacted", async () => {
      asMember([Permission.ProjectOwner]);
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });
      const serialized: string = JSON.stringify(result.body);

      expect(serialized).not.toContain("live-token-123");
      expect(serialized).not.toContain(WORKFLOW_LOG_REDACTED_VALUE);

      const headers: Array<StepSampleField> =
        result.body!.samples[0]!.returnValues["request-headers"]!.fields;

      expect(
        headers.find((field: StepSampleField) => {
          return field.path === "authorization";
        }),
      ).toEqual({ path: "authorization", kind: "Text", isHidden: true });
    });

    test("only for the steps it was asked about", async () => {
      asMember([Permission.ProjectOwner]);
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { componentIds: ["api-post-1"] },
      });

      expect(
        result.body!.samples.map((sample: StepSample) => {
          return sample.componentId;
        }),
      ).toEqual(["api-post-1"]);
    });

    test("for a master admin too", async () => {
      getPropsSpy.mockResolvedValue(
        buildUserProps({
          projectId: callerProjectId,
          userId: callerUserId,
          permissions: [],
          isMasterAdmin: true,
        }) as never,
      );
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(findLogsSpy).toHaveBeenCalled();
    });
  });

  describe("reads as the caller, a page at a time", () => {
    test("the workflow and its runs are read with the caller's own permissions, never as root", async () => {
      asMember([Permission.ProjectOwner]);
      mockWorkflowInProject(callerProjectId);

      await callRoute({ workflowId: workflowId.toString() });

      const props: DatabaseCommonInteractionProps = (await getPropsSpy.mock
        .results[0]!.value) as DatabaseCommonInteractionProps;
      const workflowRead: { props: DatabaseCommonInteractionProps } =
        findWorkflowSpy.mock.calls[0]![0] as {
          props: DatabaseCommonInteractionProps;
        };
      const logsRead: {
        query: JSONObject;
        select: JSONObject;
        sort: JSONObject;
        skip: number;
        limit: number;
        props: DatabaseCommonInteractionProps;
      } = findLogsSpy.mock.calls[0]![0] as {
        query: JSONObject;
        select: JSONObject;
        sort: JSONObject;
        skip: number;
        limit: number;
        props: DatabaseCommonInteractionProps;
      };

      expect(workflowRead.props).toBe(props);
      expect(workflowRead.props.isRoot).toBeFalsy();
      expect(logsRead.props).toBe(props);
      expect(logsRead.props.isRoot).toBeFalsy();
      expect((logsRead.query["workflowId"] as ObjectID).toString()).toBe(
        workflowId.toString(),
      );
      expect((logsRead.query["projectId"] as ObjectID).toString()).toBe(
        callerProjectId.toString(),
      );
      expect(logsRead.select).toEqual({
        _id: true,
        createdAt: true,
        stepTrace: true,
      });
      expect(logsRead.sort).toEqual({ createdAt: SortOrder.Descending });
      expect(logsRead.skip).toBe(0);
      expect(logsRead.limit).toBe(STEP_SAMPLES_PAGE_SIZE);
    });

    test("stops once every step asked about has a sample", async () => {
      asMember([Permission.ProjectOwner]);
      mockWorkflowInProject(callerProjectId);

      const fullPage: Array<WorkflowLog> = [];

      for (let index: number = 0; index < STEP_SAMPLES_PAGE_SIZE; index++) {
        fullPage.push(WEBHOOK_RUN);
      }

      findLogsSpy.mockResolvedValue(fullPage as never);

      await callRoute({ workflowId: workflowId.toString() });

      expect(findLogsSpy).toHaveBeenCalledTimes(1);
    });

    test(`reads older pages for a step the newest runs did not reach, up to ${STEP_SAMPLES_MAX_RUNS} runs`, async () => {
      asMember([Permission.ProjectOwner]);
      mockWorkflowInProject(callerProjectId);

      const fullPage: Array<WorkflowLog> = [];

      for (let index: number = 0; index < STEP_SAMPLES_PAGE_SIZE; index++) {
        fullPage.push(WEBHOOK_RUN);
      }

      findLogsSpy.mockResolvedValue(fullPage as never);

      await callRoute({
        workflowId: workflowId.toString(),
        body: { componentIds: ["webhook-1", "if-else-1"] },
      });

      expect(findLogsSpy).toHaveBeenCalledTimes(
        STEP_SAMPLES_MAX_RUNS / STEP_SAMPLES_PAGE_SIZE,
      );
      expect(
        findLogsSpy.mock.calls.map((call: Array<unknown>) => {
          return (call[0] as { skip: number }).skip;
        }),
      ).toEqual([0, 10, 20]);
    });

    test("stops at the last run there is", async () => {
      asMember([Permission.ProjectOwner]);
      mockWorkflowInProject(callerProjectId);

      await callRoute({
        workflowId: workflowId.toString(),
        body: { componentIds: ["webhook-1", "never-ran-1"] },
      });

      expect(findLogsSpy).toHaveBeenCalledTimes(1);
    });

    test("asked about no step in particular, reads the newest page only", async () => {
      asMember([Permission.ProjectOwner]);
      mockWorkflowInProject(callerProjectId);

      const fullPage: Array<WorkflowLog> = [];

      for (let index: number = 0; index < STEP_SAMPLES_PAGE_SIZE; index++) {
        fullPage.push(WEBHOOK_RUN);
      }

      findLogsSpy.mockResolvedValue(fullPage as never);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: {},
      });

      expect(findLogsSpy).toHaveBeenCalledTimes(1);
      expect(
        result.body!.samples.map((sample: StepSample) => {
          return sample.componentId;
        }),
      ).toEqual(["api-post-1", "webhook-1"]);
    });

    test("a workflow that has never run has no samples", async () => {
      asMember([Permission.ProjectOwner]);
      mockWorkflowInProject(callerProjectId);
      findLogsSpy.mockResolvedValue([] as never);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.body).toEqual({ samples: [] });
    });
  });

  describe("refuses, and reads no run, when", () => {
    test("the workflow id is missing", async () => {
      await callRoute({ workflowId: undefined });

      expect(Response.sendErrorResponse).toHaveBeenCalled();
      expect(getPropsSpy).not.toHaveBeenCalled();
      expect(findLogsSpy).not.toHaveBeenCalled();
    });

    test("the workflow id is not an id", async () => {
      const result: RouteCallResult = await callRoute({
        workflowId: "not-an-id",
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(getPropsSpy).not.toHaveBeenCalled();
      expect(findLogsSpy).not.toHaveBeenCalled();
    });

    test.each([
      ["not a list", "webhook-1"],
      ["a list holding something else", [{ id: "webhook-1" }]],
      ["a list holding an empty id", [""]],
      ["a list holding a very long id", ["x".repeat(201)]],
      [
        "too long a list",
        Array.from(
          { length: STEP_SAMPLES_MAX_COMPONENT_IDS + 1 },
          (_value: unknown, index: number) => {
            return `step-${index}`;
          },
        ),
      ],
    ])("the step ids are %s", async (_name: string, componentIds: unknown) => {
      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { componentIds: componentIds },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(getPropsSpy).not.toHaveBeenCalled();
      expect(findLogsSpy).not.toHaveBeenCalled();
    });

    test("the caller is not logged in - 401", async () => {
      getPropsSpy.mockResolvedValue({
        userType: UserType.Public,
        tenantId: callerProjectId,
      } as never);
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
      expect(findWorkflowSpy).not.toHaveBeenCalled();
      expect(findLogsSpy).not.toHaveBeenCalled();
    });

    test("the caller is a project API key: the picker is for members", async () => {
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

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(findLogsSpy).not.toHaveBeenCalled();
    });

    test("the caller may not read the workflow's runs", async () => {
      asMember([Permission.ReadProjectIncident]);
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as Error).message).toBe(
        "You do not have permission to read this workflow's runs.",
      );
      expect(findLogsSpy).not.toHaveBeenCalled();
    });

    test("the caller holds no permission on the project", async () => {
      asMember([]);
      mockWorkflowInProject(callerProjectId);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(findLogsSpy).not.toHaveBeenCalled();
    });

    test("the workflow belongs to another project", async () => {
      asMember([Permission.ProjectOwner]);
      mockWorkflowInProject(otherProjectId);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect(findLogsSpy).not.toHaveBeenCalled();
    });

    /*
     * The same refusal as a foreign workflow, deliberately: a different one
     * would tell which workflow ids exist in other projects.
     */
    test("the workflow does not exist - indistinguishable from a foreign one", async () => {
      asMember([Permission.ProjectOwner]);

      mockWorkflowInProject(null);
      const missing: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      jest.clearAllMocks();
      mockWorkflowInProject(otherProjectId);
      const foreign: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
      });

      expect(missing.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((missing.thrownToNext as Error).message).toBe(
        (foreign.thrownToNext as Error).message,
      );
      expect(findLogsSpy).not.toHaveBeenCalled();
    });
  });
});

describe("the samples' redaction marker", () => {
  /*
   * The picker hides a value the runner redacted by recognising the runner's
   * marker. If the two ever differ, a redacted value would be shown as the
   * text "[REDACTED]" - harmless, but no longer hidden - so they are held
   * together here.
   */
  test("is the runner's", () => {
    expect(STEP_SAMPLE_REDACTED_VALUE).toBe(WORKFLOW_LOG_REDACTED_VALUE);
  });
});
