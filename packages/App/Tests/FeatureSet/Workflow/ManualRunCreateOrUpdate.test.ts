/*
 * ---------------------------------------------------------------------------
 * Run Workflow on an On Create or Update workflow: POST /workflow/manual/run
 * with `{ "data": { "_id": "INC-8", "what-happened": "updated" } }` runs it
 * as if incident 8 had just been updated (Utils/RunRecordValues).
 *
 * What Happened is read as the trigger reads it - "created" or "updated", in
 * any case - and anything else is refused here, before the run is queued,
 * with what it may be, rather than failing the run later. A workflow on any
 * other trigger is never held to it.
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
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import ComponentID from "Common/Types/Workflow/ComponentID";
import { WHAT_HAPPENED_ID } from "Common/Types/Workflow/CreateOrUpdateTrigger";
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

describe("Run Workflow on On Create or Update", () => {
  let projectId: ObjectID;
  let userId: ObjectID;
  let workflowId: ObjectID;
  let triggerId: string;
  let incidents: Array<Incident>;

  let queueSpy: jest.SpyInstance;
  let workflowReadSpy: jest.SpyInstance;

  beforeAll(() => {
    mockRoutes.length = 0;
    new ManualAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    workflowId = ObjectID.generate();
    triggerId = "incident-on-create-or-update";
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

    workflowReadSpy = jest
      .spyOn(WorkflowService, "findOneById")
      .mockImplementation(async () => {
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

    jest
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

  function incident(number: number): Incident {
    const record: Incident = new Incident();
    record._id = ObjectID.generate().toString();
    record.projectId = projectId;
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

  test("an ID and updated run as updated, started by the caller", async () => {
    const id: string = ObjectID.generate().toString();

    expect(await run({ _id: id, [WHAT_HAPPENED_ID]: "updated" })).toBe(
      undefined,
    );
    expect(queued()["returnValues"]).toEqual({
      _id: id,
      [WHAT_HAPPENED_ID]: "updated",
    });
    expect(String(queued()["startedByUserId"])).toBe(userId.toString());
  });

  test("What Happened is sent in the case the trigger reads it", async () => {
    const id: string = ObjectID.generate().toString();

    await run({ _id: id, [WHAT_HAPPENED_ID]: " Created " });

    expect(queued()["returnValues"]).toEqual({
      _id: id,
      [WHAT_HAPPENED_ID]: "created",
    });
  });

  test("an empty What Happened runs as created, as an empty choice does", async () => {
    const id: string = ObjectID.generate().toString();

    await run({ _id: id, [WHAT_HAPPENED_ID]: "" });

    expect(queued()["returnValues"]).toEqual({
      _id: id,
      [WHAT_HAPPENED_ID]: "created",
    });
  });

  test("none asked runs as it came: the trigger runs it as created", async () => {
    const id: string = ObjectID.generate().toString();

    await run({ _id: id });

    expect(queued()["returnValues"]).toEqual({ _id: id });

    // Nothing to look up or check: the workflow's trigger is not read for it.
    const triggerReads: Array<unknown> = workflowReadSpy.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return Boolean(
          (call[0] as { select?: Dictionary<unknown> }).select?.["triggerId"],
        );
      },
    );

    expect(triggerReads).toEqual([]);
  });

  test.each([
    ["another word", "deleted", "deleted"],
    ["a number", 7, "7"],
    ["a list", ["updated"], '["updated"]'],
  ] as Array<[string, unknown, string]>)(
    "%s is refused, saying what it may be, and nothing runs",
    async (_label: string, value: unknown, quoted: string) => {
      const thrown: unknown = await run({
        _id: ObjectID.generate().toString(),
        [WHAT_HAPPENED_ID]: value as JSONObject,
      });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toBe(
        `What Happened must be "created" or "updated", not "${quoted}".`,
      );
      expect(queueSpy).not.toHaveBeenCalled();
    },
  );

  test("INC-8 and updated: the incident's ID, as updated", async () => {
    const eight: Incident = incident(8);

    expect(
      await run({ _id: "INC-8", [WHAT_HAPPENED_ID]: "updated" }),
    ).toBeUndefined();
    expect(queued()["returnValues"]).toEqual({
      _id: eight._id,
      [WHAT_HAPPENED_ID]: "updated",
    });
  });

  test("a wrong answer is refused before any incident is looked up", async () => {
    incident(8);

    const thrown: unknown = await run({
      _id: "INC-8",
      [WHAT_HAPPENED_ID]: "removed",
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(IncidentService.findBy).not.toHaveBeenCalled();
    expect(queueSpy).not.toHaveBeenCalled();
  });

  test("a workflow on another trigger is never held to it: its values go on as they came", async () => {
    for (const other of ["incident-on-update", ComponentID.Webhook]) {
      triggerId = other;
      queueSpy.mockClear();

      const id: string = ObjectID.generate().toString();
      const values: JSONObject = { _id: id, [WHAT_HAPPENED_ID]: "anything" };

      expect([other, await run(values)]).toEqual([other, undefined]);
      expect(queued()["returnValues"]).toEqual(values);
    }
  });
});
