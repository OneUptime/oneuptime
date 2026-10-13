/*
 * ---------------------------------------------------------------------------
 * POST /workflow/run-records/:workflowId - the records Run Workflow can run a
 * record trigger with, looked up by what a person typed: INC-8, 8, part of a
 * title, or an ID (Types/Workflow/RunRecord).
 *
 * The route reads real records, so it asks what Run Workflow asks: a
 * signed-in member of the workflow's own project, allowed to run it
 * (WorkflowRunAccess). The records are read with the caller's own
 * permissions, held to the workflow's project. The load-bearing assertion in
 * every deny case is that no record was read at all.
 *
 * Everything below the route is real - the trigger's model and service
 * (RunRecordTrigger), the search (RunRecordSearch) - except the database:
 * IncidentService.findBy answers as the query asks.
 * ---------------------------------------------------------------------------
 */

import RunRecordsAPI from "../../../FeatureSet/Workflow/API/RunRecords";
import CommonAPI from "Common/Server/API/CommonAPI";
import IncidentService from "Common/Server/Services/IncidentService";
import WorkflowService from "Common/Server/Services/WorkflowService";
import Incident from "Common/Models/DatabaseModels/Incident";
import WorkflowModel from "Common/Models/DatabaseModels/Workflow";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import FindBy from "Common/Server/Types/Database/FindBy";
import Response from "Common/Server/Utils/Response";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
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
import ComponentID from "Common/Types/Workflow/ComponentID";
import {
  RUN_RECORD_SEARCH_MAX_LENGTH,
  RunRecordMatch,
  RunRecordMessages,
  RunRecordOption,
  RunRecordSearchResponse,
} from "Common/Types/Workflow/RunRecord";
import { WORKFLOW_RUN_REFUSED_MESSAGE } from "Common/Types/Workflow/WorkflowRunPermissions";
import {
  isQueryCondition,
  meetsCondition,
} from "Common/Tests/Server/TestingUtils/QueryConditions";
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

const ROUTE: string = "/run-records/:workflowId";

const INCIDENT_TRIGGER_ID: string = "incident-on-create";

function matchRoute(): MockRoute {
  const route: MockRoute | undefined = mockRoutes.find(
    (candidate: MockRoute) => {
      return candidate.method === "POST" && candidate.uri === ROUTE;
    },
  );

  if (!route) {
    throw new Error(`Route POST ${ROUTE} was never registered`);
  }

  return route;
}

interface RouteCallResult {
  thrownToNext: unknown;
  body: RunRecordSearchResponse | undefined;
}

async function callRoute(data: {
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

  const next: jest.Mock = jest.fn();

  await matchRoute().handlerFunction(
    req,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    body: send.mock.calls[0]
      ? (send.mock.calls[0][2] as unknown as RunRecordSearchResponse)
      : undefined,
  };
}

function buildUserProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
  permissions: Array<Permission>;
}): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: data.permissions.map(
      (permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      },
    ),
  };

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userType: UserType.User,
    userTenantAccessPermission: {
      [data.projectId.toString()]: tenantPermission,
    },
  };
}

describe("POST /workflow/run-records/:workflowId", () => {
  let projectId: ObjectID;
  let otherProjectId: ObjectID;
  let userId: ObjectID;
  let workflowId: ObjectID;
  let triggerId: string | undefined;
  let workflowProjectId: ObjectID | null;
  let incidents: Array<Incident>;

  let getPropsSpy: jest.SpyInstance;
  let incidentFindBySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRoutes.length = 0;
    new RunRecordsAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    userId = ObjectID.generate();
    workflowId = ObjectID.generate();
    triggerId = INCIDENT_TRIGGER_ID;
    workflowProjectId = projectId;
    incidents = [];

    getPropsSpy = jest.spyOn(CommonAPI, "getDatabaseCommonInteractionProps");

    jest
      .spyOn(WorkflowService, "findOneById")
      .mockImplementation(async (): Promise<WorkflowModel | null> => {
        if (!workflowProjectId) {
          return null;
        }

        const workflow: WorkflowModel = new WorkflowModel();
        workflow.id = workflowId;
        workflow.projectId = workflowProjectId;

        if (triggerId) {
          workflow.triggerId = triggerId;
        }

        return workflow;
      });

    // An editor of the workflow may change it, so may run it.
    jest
      .spyOn(WorkflowService, "findOneUpdatableById")
      .mockImplementation(async (): Promise<WorkflowModel | null> => {
        const workflow: WorkflowModel = new WorkflowModel();
        workflow.id = workflowId;
        workflow.projectId = projectId;

        return workflow;
      });

    // The incidents table, answering as the query asks.
    incidentFindBySpy = jest
      .spyOn(IncidentService, "findBy")
      .mockImplementation(
        async (args: FindBy<Incident>): Promise<Array<Incident>> => {
          const query: Dictionary<unknown> =
            args.query as unknown as Dictionary<unknown>;
          const limit: number =
            typeof args.limit === "number" ? args.limit : args.limit.toNumber();

          return incidents
            .filter((incident: Incident): boolean => {
              return Object.entries(query).every(
                ([column, expected]: [string, unknown]): boolean => {
                  const actual: unknown = (
                    incident as unknown as Dictionary<unknown>
                  )[column];

                  // A condition on the title: every word typed, anywhere.
                  if (isQueryCondition(expected)) {
                    return meetsCondition(expected, String(actual));
                  }

                  return String(actual) === String(expected);
                },
              );
            })
            .slice(0, limit);
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function incident(data: {
    number: number;
    title: string;
    project?: ObjectID;
  }): Incident {
    const record: Incident = new Incident();
    record._id = ObjectID.generate().toString();
    record.projectId = data.project || projectId;
    record.incidentNumber = data.number;
    record.incidentNumberWithPrefix = `INC-${data.number}`;
    record.title = data.title;
    record.createdAt = new Date(Date.UTC(2026, 9, data.number));

    incidents.push(record);
    return record;
  }

  function signedIn(permissions: Array<Permission>): void {
    getPropsSpy.mockResolvedValue(
      buildUserProps({
        projectId: projectId,
        userId: userId,
        permissions: permissions,
      }),
    );
  }

  test("is registered behind a context-loading middleware", () => {
    expect(typeof matchRoute().middleware).toBe("function");
  });

  describe("who may look records up", () => {
    test("nobody signed in: 401, and no record is read", async () => {
      getPropsSpy.mockResolvedValue({ userType: UserType.Public });

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { search: "INC-8" },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthenticatedException);
      expect(incidentFindBySpy).not.toHaveBeenCalled();
      expect(result.body).toBeUndefined();
    });

    test("a member who may not run workflows: refused, and no record is read", async () => {
      signedIn([Permission.ReadProjectIncident]);

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { search: "INC-8" },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as Error).message).toBe(
        WORKFLOW_RUN_REFUSED_MESSAGE,
      );
      expect(incidentFindBySpy).not.toHaveBeenCalled();
    });

    test("a workflow of another project: refused, and no record is read", async () => {
      signedIn([Permission.EditWorkflow, Permission.ReadProjectIncident]);
      workflowProjectId = otherProjectId;

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { search: "INC-8" },
      });

      expect(result.thrownToNext).toBeDefined();
      expect(result.body).toBeUndefined();
      expect(incidentFindBySpy).not.toHaveBeenCalled();
    });

    test("a workflow that does not exist: refused, and no record is read", async () => {
      signedIn([Permission.EditWorkflow, Permission.ReadProjectIncident]);
      workflowProjectId = null;

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { search: "INC-8" },
      });

      expect(result.thrownToNext).toBeDefined();
      expect(incidentFindBySpy).not.toHaveBeenCalled();
    });

    test("a member who may run the workflow but not read incidents is told so in words", async () => {
      signedIn([Permission.EditWorkflow]);
      incidentFindBySpy.mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to select on - incidentNumber",
        ),
      );

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { search: "INC-8" },
      });

      expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
      expect((result.thrownToNext as Error).message).toBe(
        RunRecordMessages.cannotRead("Incidents"),
      );
      expect(result.body).toBeUndefined();
    });
  });

  describe("what it answers", () => {
    beforeEach(() => {
      signedIn([Permission.EditWorkflow, Permission.ReadProjectIncident]);
    });

    test("INC-8 finds incident 8, read as the caller in the workflow's project", async () => {
      incident({ number: 7, title: "Disk full" });
      const eight: Incident = incident({
        number: 8,
        title: "Database is down",
      });

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { search: "INC-8" },
      });

      expect(result.thrownToNext).toBeUndefined();
      expect(result.body?.records[0]).toEqual({
        id: eight._id,
        number: "INC-8",
        name: "Database is down",
        createdAt: eight.createdAt!.toISOString(),
        matchedBy: RunRecordMatch.Number,
      });

      for (const call of incidentFindBySpy.mock.calls) {
        const args: {
          query: Dictionary<unknown>;
          props: DatabaseCommonInteractionProps;
        } = call[0] as {
          query: Dictionary<unknown>;
          props: DatabaseCommonInteractionProps;
        };

        expect(String(args.query["projectId"])).toBe(projectId.toString());
        expect(args.props.isRoot).toBeUndefined();
        expect(String(args.props.userId)).toBe(userId.toString());
      }
    });

    test("another project's INC-8 is never found", async () => {
      incident({ number: 8, title: "Theirs", project: otherProjectId });

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { search: "INC-8" },
      });

      expect(result.body).toEqual({ records: [] });
    });

    test("nothing typed lists the newest incidents", async () => {
      incident({ number: 1, title: "First" });
      incident({ number: 2, title: "Second" });

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: {},
      });

      expect(
        result.body?.records.map(
          (record: RunRecordOption): string | undefined => {
            return record.number;
          },
        ),
      ).toEqual(["INC-1", "INC-2"]);
      expect(
        (incidentFindBySpy.mock.calls[0]![0] as { sort: Dictionary<unknown> })
          .sort,
      ).toEqual({ createdAt: "DESC" });
    });

    test("part of a title finds it by name", async () => {
      const down: Incident = incident({ number: 3, title: "Database is down" });
      incident({ number: 4, title: "API latency" });

      const result: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { search: "database" },
      });

      expect(result.body?.records).toEqual([
        expect.objectContaining({
          id: down._id,
          matchedBy: RunRecordMatch.Name,
        }),
      ]);
    });
  });

  describe("what it refuses", () => {
    beforeEach(() => {
      signedIn([Permission.EditWorkflow, Permission.ReadProjectIncident]);
    });

    test("a workflow whose trigger does not run on a record", async () => {
      for (const trigger of [
        ComponentID.Webhook,
        ComponentID.Manual,
        undefined,
      ]) {
        jest.clearAllMocks();
        triggerId = trigger;

        const result: RouteCallResult = await callRoute({
          workflowId: workflowId.toString(),
          body: { search: "INC-8" },
        });

        expect([trigger, (result.thrownToNext as Error)?.message]).toEqual([
          trigger,
          RunRecordMessages.notARecordTrigger,
        ]);
        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect(incidentFindBySpy).not.toHaveBeenCalled();
      }
    });

    test("a search that is not text, or too long", async () => {
      for (const search of [
        8,
        { $ne: "" },
        ["INC-8"],
        "x".repeat(RUN_RECORD_SEARCH_MAX_LENGTH + 1),
      ]) {
        jest.clearAllMocks();

        const result: RouteCallResult = await callRoute({
          workflowId: workflowId.toString(),
          body: { search: search } as JSONObject,
        });

        expect(result.thrownToNext).toBeInstanceOf(BadDataException);
        expect(incidentFindBySpy).not.toHaveBeenCalled();
      }

      // The longest search that is still read.
      jest.clearAllMocks();

      const longest: RouteCallResult = await callRoute({
        workflowId: workflowId.toString(),
        body: { search: "x".repeat(RUN_RECORD_SEARCH_MAX_LENGTH) },
      });

      expect(longest.thrownToNext).toBeUndefined();
    });

    test("a workflow ID that is not an ID", async () => {
      const result: RouteCallResult = await callRoute({
        workflowId: "not-an-id",
        body: { search: "INC-8" },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(incidentFindBySpy).not.toHaveBeenCalled();
    });
  });
});
