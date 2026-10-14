/*
 * ---------------------------------------------------------------------------
 * Run Workflow with the record a person names: POST /workflow/manual/run with
 * `{ "data": { "_id": "INC-8" } }` runs an On Create Incident workflow as if
 * incident 8 had just been created (Utils/RunRecordValues).
 *
 * The panel sends the picked record's ID, but someone who types INC-8 and
 * presses Run before picking sends INC-8, and the route looks it up the way
 * the panel's list does: in the workflow's project, with the caller's own
 * permissions, by its exact number or ID. What reaches the queue is the
 * record's ID - the one thing the trigger reads - and still the caller as
 * the run's starter.
 * ---------------------------------------------------------------------------
 */

import ManualAPI from "../../../FeatureSet/Workflow/API/Manual";
import QueueWorkflow from "../../../FeatureSet/Workflow/Services/QueueWorkflow";
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
import ComponentID from "Common/Types/Workflow/ComponentID";
import { RunRecordMessages } from "Common/Types/Workflow/RunRecord";
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
  handlerFunction: RouterFunction;
};

const mockRoutes: Array<MockRoute> = [];

const register: (
  method: string,
) => (
  uri: string,
  _middleware: RouterFunction,
  handler: RouterFunction,
) => void = (method: string) => {
  return (
    uri: string,
    _middleware: RouterFunction,
    handler: RouterFunction,
  ): void => {
    mockRoutes.push({
      method: method,
      uri: uri,
      handlerFunction: handler,
    });
  };
};

const mockRouter: Dictionary<jest.Mock> = {
  get: jest.fn().mockImplementation(register("GET")),
  post: jest.fn().mockImplementation(register("POST")),
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

describe("Run Workflow with a record's number", () => {
  let projectId: ObjectID;
  let otherProjectId: ObjectID;
  let userId: ObjectID;
  let workflowId: ObjectID;
  let triggerId: string;
  let incidents: Array<Incident>;

  let queueSpy: jest.SpyInstance;
  let incidentFindBySpy: jest.SpyInstance;

  beforeAll(() => {
    mockRoutes.length = 0;
    new ManualAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    otherProjectId = ObjectID.generate();
    userId = ObjectID.generate();
    workflowId = ObjectID.generate();
    triggerId = "incident-on-create";
    incidents = [];

    const permission: UserTenantAccessPermission = {
      _type: "UserTenantAccessPermission",
      projectId: projectId,
      permissions: [
        Permission.EditWorkflow,
        Permission.ReadProjectIncident,
      ].map((each: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: each,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    };

    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockResolvedValue({
        tenantId: projectId,
        userId: userId,
        userType: UserType.User,
        userTenantAccessPermission: {
          [projectId.toString()]: permission,
        },
      } as DatabaseCommonInteractionProps);

    const workflowRow: () => WorkflowModel = (): WorkflowModel => {
      const workflow: WorkflowModel = new WorkflowModel();
      workflow.id = workflowId;
      workflow.projectId = projectId;
      workflow.triggerId = triggerId;

      return workflow;
    };

    jest.spyOn(WorkflowService, "findOneById").mockImplementation(async () => {
      return workflowRow();
    });
    jest
      .spyOn(WorkflowService, "findOneUpdatableById")
      .mockImplementation(async () => {
        return workflowRow();
      });

    queueSpy = jest
      .spyOn(QueueWorkflow, "addWorkflowToQueue")
      .mockResolvedValue(undefined);

    incidentFindBySpy = jest
      .spyOn(IncidentService, "findBy")
      .mockImplementation(
        async (args: {
          query: Dictionary<unknown>;
        }): Promise<Array<Incident>> => {
          return incidents.filter((incident: Incident): boolean => {
            return Object.entries(args.query).every(
              ([column, expected]: [string, unknown]): boolean => {
                return (
                  String(
                    (incident as unknown as Dictionary<unknown>)[column],
                  ) === String(expected)
                );
              },
            );
          });
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function incident(number: number, project?: ObjectID): Incident {
    const record: Incident = new Incident();
    record._id = ObjectID.generate().toString();
    record.projectId = project || projectId;
    record.incidentNumber = number;
    record.incidentNumberWithPrefix = `INC-${number}`;
    record.title = `Incident ${number}`;
    record.createdAt = new Date();

    incidents.push(record);
    return record;
  }

  async function run(data: JSONObject): Promise<unknown> {
    const route: MockRoute = mockRoutes.find((candidate: MockRoute) => {
      return candidate.method === "POST";
    }) as MockRoute;

    const next: jest.Mock = jest.fn();

    await route.handlerFunction(
      {
        params: { workflowId: workflowId.toString() },
        query: {},
        body: { data: data },
        headers: {},
      } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

    return next.mock.calls[0] ? next.mock.calls[0][0] : undefined;
  }

  function queued(): Dictionary<unknown> {
    expect(queueSpy).toHaveBeenCalledTimes(1);

    return queueSpy.mock.calls[0]![0] as Dictionary<unknown>;
  }

  test("INC-8 runs with incident 8's ID, started by the caller", async () => {
    incident(7);
    const eight: Incident = incident(8);

    const thrown: unknown = await run({
      _id: "INC-8",
      select: { title: true },
    });

    expect(thrown).toBeUndefined();
    expect(queued()["returnValues"]).toEqual({
      _id: eight._id,
      select: { title: true },
    });
    expect(String(queued()["startedByUserId"])).toBe(userId.toString());
  });

  test("8 and #8 run with it too", async () => {
    const eight: Incident = incident(8);

    for (const typed of ["8", "#8", " inc-8 "]) {
      queueSpy.mockClear();

      expect(await run({ _id: typed })).toBeUndefined();
      expect([typed, queued()["returnValues"]]).toEqual([
        typed,
        { _id: eight._id },
      ]);
    }
  });

  test("the number is looked up as the caller, in the workflow's project", async () => {
    incident(8);

    await run({ _id: "INC-8" });

    expect(incidentFindBySpy).toHaveBeenCalled();

    for (const call of incidentFindBySpy.mock.calls) {
      const args: {
        query: Dictionary<unknown>;
        props: DatabaseCommonInteractionProps;
      } = call[0] as {
        query: Dictionary<unknown>;
        props: DatabaseCommonInteractionProps;
      };

      expect(String(args.query["projectId"])).toBe(projectId.toString());
      expect(args.query["incidentNumber"]).toBe(8);
      expect(args.props.isRoot).toBeUndefined();
      expect(String(args.props.userId)).toBe(userId.toString());
    }
  });

  test("a number no incident has is refused, and nothing runs", async () => {
    incident(8);

    const thrown: unknown = await run({ _id: "INC-80" });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Error).message).toBe(
      RunRecordMessages.noRecordWithNumber({
        singularName: "Incident",
        text: "INC-80",
      }),
    );
    expect(queueSpy).not.toHaveBeenCalled();
  });

  test("another project's incident 8 is never run with", async () => {
    incident(8, otherProjectId);

    const thrown: unknown = await run({ _id: "INC-8" });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(queueSpy).not.toHaveBeenCalled();
  });

  test("part of a title is not enough: the person is told to pick one", async () => {
    const thrown: unknown = await run({ _id: "database outage" });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Error).message).toBe(
      RunRecordMessages.pickFromList("Incident"),
    );
    expect(queueSpy).not.toHaveBeenCalled();
    // Nothing was looked up by name to run with.
    expect(incidentFindBySpy).not.toHaveBeenCalled();
  });

  test("an ID runs as it always did, without a lookup", async () => {
    const id: string = ObjectID.generate().toString();

    expect(await run({ _id: id })).toBeUndefined();
    expect(queued()["returnValues"]).toEqual({ _id: id });
    expect(incidentFindBySpy).not.toHaveBeenCalled();
  });

  test("nothing named runs as it always did", async () => {
    expect(await run({})).toBeUndefined();
    expect(queued()["returnValues"]).toEqual({});
    expect(incidentFindBySpy).not.toHaveBeenCalled();
  });

  test("a trigger that does not run on a record keeps its values as they came", async () => {
    triggerId = ComponentID.Webhook;

    const values: JSONObject = {
      _id: "INC-8",
      "request-body": { incident: "INC-8" },
    };

    expect(await run(values)).toBeUndefined();
    expect(queued()["returnValues"]).toEqual(values);
    expect(incidentFindBySpy).not.toHaveBeenCalled();
  });

  test("a caller who may not read incidents is told so, and nothing runs", async () => {
    incidentFindBySpy.mockRejectedValue(
      new NotAuthorizedException(
        "You do not have permissions to select on - incidentNumber",
      ),
    );

    const thrown: unknown = await run({ _id: "INC-8" });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Error).message).toBe(
      RunRecordMessages.cannotRead("Incidents"),
    );
    expect(queueSpy).not.toHaveBeenCalled();
  });
});
