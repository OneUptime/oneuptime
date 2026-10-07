import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PUT /scheduled-maintenance/:id with an event's Change Monitor Status to.
 *
 * The maintainer's decision: an event's status can be edited until the
 * event starts, by whoever may edit the event, and is read-only once it is
 * ongoing. The event's Affected Resources card saves the relation
 * (`changeMonitorStatusTo: { _id }`); the API documents, and Terraform
 * writes, the ID column. Before, the relation took no update at all - the
 * server refused it to everyone but master admins - while the ID column was
 * taken at any time, an ongoing or ended event's included.
 *
 * The server's own permission layer and the service's own hooks run here;
 * only the database is a stand-in: the event the write finds (with the
 * state it is in), the repository it writes to, and which records the
 * project has (stubProjectDirectory).
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceService, {
  MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE,
} from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../../Server/Services/ScheduledMaintenanceStateService";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-9e9e-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-9e9e-4aaa-8bbb-000000000002");
const EVENT_ID: string = "0193c0de-9e9e-4aaa-8bbb-0000000000e1";

// Monitor statuses of the event's own project.
const DEGRADED_STATUS_ID: string = "0193c0de-9e9e-4aaa-8bbb-0000000000b1";
const MAINTENANCE_STATUS_ID: string = "0193c0de-9e9e-4aaa-8bbb-0000000000b2";

// A monitor status of another project.
const FOREIGN_STATUS_ID: string = "0193c0de-9e9e-4aaa-8bbb-0000000000f1";

type StateKind = "scheduled" | "confirmed" | "ongoing" | "ended" | "completed";

const STATE_ORDER: Array<StateKind> = [
  "scheduled",
  "confirmed",
  "ongoing",
  "ended",
  "completed",
];

function state(kind: StateKind): ScheduledMaintenanceState {
  const scheduledMaintenanceState: ScheduledMaintenanceState =
    new ScheduledMaintenanceState();
  scheduledMaintenanceState._id = `0193c0de-9e9e-4aaa-8bbb-0000000000d${STATE_ORDER.indexOf(kind) + 1}`;
  scheduledMaintenanceState.order = STATE_ORDER.indexOf(kind) + 1;
  scheduledMaintenanceState.isScheduledState = kind === "scheduled";
  scheduledMaintenanceState.isOngoingState = kind === "ongoing";
  scheduledMaintenanceState.isEndedState = kind === "ended";
  scheduledMaintenanceState.isResolvedState = kind === "completed";
  return scheduledMaintenanceState;
}

/*
 * A signed-in person holding exactly `permissions` in the project. Fresh
 * per call: the permission layer adds Public and Current User to the props
 * it is handed.
 */
function personWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

type Role = [string, Array<Permission>];

const EDITORS: Array<Role> = [
  ["Project Owner", [Permission.ProjectOwner]],
  ["Project Admin", [Permission.ProjectAdmin]],
  ["Project Member", [Permission.ProjectMember]],
  ["Scheduled Maintenance Admin", [Permission.ScheduledMaintenanceAdmin]],
  ["Scheduled Maintenance Member", [Permission.ScheduledMaintenanceMember]],
  [
    "a role that may read and edit scheduled maintenance events",
    [
      Permission.ReadProjectScheduledMaintenance,
      Permission.EditProjectScheduledMaintenance,
    ],
  ],
];

const NOT_EDITORS: Array<Role> = [
  ["Viewer", [Permission.Viewer]],
  ["Scheduled Maintenance Viewer", [Permission.ScheduledMaintenanceViewer]],
  ["Read Scheduled Maintenance", [Permission.ReadProjectScheduledMaintenance]],
  [
    "Create Scheduled Maintenance",
    [
      Permission.ReadProjectScheduledMaintenance,
      Permission.CreateProjectScheduledMaintenance,
    ],
  ],
  [
    "Delete Scheduled Maintenance",
    [
      Permission.ReadProjectScheduledMaintenance,
      Permission.DeleteProjectScheduledMaintenance,
    ],
  ],
  [
    "a scheduled maintenance template editor",
    [
      Permission.ReadScheduledMaintenanceTemplate,
      Permission.EditScheduledMaintenanceTemplate,
    ],
  ],
];

// The members of the service these tests stub that its type keeps private.
interface StubbableService {
  _findBy: (...args: Array<unknown>) => Promise<unknown>;
  getRepository: () => unknown;
  onTriggerWorkflow: (...args: Array<unknown>) => Promise<unknown>;
  onTriggerRealtime: (...args: Array<unknown>) => Promise<unknown>;
}

let repositoryUpdate: MockFunction;
let repositorySave: MockFunction;
let caller: DatabaseCommonInteractionProps;

// The event the database holds: its state and its status.
let eventState: StateKind = "scheduled";
let eventStatusId: string | undefined = DEGRADED_STATUS_ID;

/*
 * The database behind the service: every read finds the one event, in the
 * project, in `eventState` with `eventStatusId`; every write reaches the
 * stub repository.
 */
function stubDatabase(): void {
  const service: StubbableService =
    ScheduledMaintenanceService as unknown as StubbableService;

  jest.spyOn(service, "_findBy").mockImplementation((async (): Promise<
    Array<BaseModel>
  > => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = EVENT_ID;
    event.projectId = PROJECT_ID;
    event.currentScheduledMaintenanceState = state(eventState);
    event.monitors = [];

    if (eventStatusId) {
      event.changeMonitorStatusToId = new ObjectID(eventStatusId);
    }

    return [event];
  }) as never);

  repositoryUpdate = getJestMockFunction();
  repositoryUpdate.mockResolvedValue({ affected: 1 } as never);
  repositorySave = getJestMockFunction();
  repositorySave.mockImplementation((async (item: unknown) => {
    return item;
  }) as never);

  jest.spyOn(service, "getRepository").mockReturnValue({
    update: repositoryUpdate,
    save: repositorySave,
  } as never);

  jest
    .spyOn(service, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(service, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
}

async function put(data: JSONObject): Promise<void> {
  const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = new BaseAPI<
    BaseModel,
    DatabaseService<BaseModel>
  >(
    ScheduledMaintenance,
    ScheduledMaintenanceService as unknown as DatabaseService<BaseModel>,
  );

  const request: ExpressRequest = {
    params: { id: EVENT_ID },
    body: { data: data },
    headers: {},
  } as unknown as ExpressRequest;

  const response: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await api.updateItem(request, response);
}

// The columns the one write set, without TypeORM's version bump.
function written(): Record<string, unknown> {
  expect(repositoryUpdate).toHaveBeenCalledTimes(1);

  const set: Record<string, unknown> = {
    ...(repositoryUpdate.mock.calls[0]![1] as Record<string, unknown>),
  };

  delete set["version"];

  return set;
}

// The id a written relation or ID column holds, however it was written.
function idIn(value: unknown): string | null | undefined {
  if (value === null || value === undefined) {
    return value as null | undefined;
  }

  if (
    typeof value === "object" &&
    "_id" in (value as Record<string, unknown>)
  ) {
    return String((value as { _id: unknown })._id);
  }

  return String(value);
}

function expectNothingWritten(): void {
  expect(repositoryUpdate).not.toHaveBeenCalled();
  expect(repositorySave).not.toHaveBeenCalled();
  expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
}

beforeEach(() => {
  caller = personWith([Permission.ProjectAdmin]);
  eventState = "scheduled";
  eventStatusId = DEGRADED_STATUS_ID;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    }) as never);

  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      MonitorStatus: [DEGRADED_STATUS_ID, MAINTENANCE_STATUS_ID],
    },
  });

  stubDatabase();

  // The project's states, for an event in a state of its own.
  jest
    .spyOn(ScheduledMaintenanceStateService, "getAllScheduledMaintenanceStates")
    .mockResolvedValue(
      STATE_ORDER.map((kind: StateKind): ScheduledMaintenanceState => {
        return state(kind);
      }) as never,
    );

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockImplementation((() => {
      return undefined;
    }) as never);

  // What the feed names a status by; the feed item itself is not written.
  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation((async (): Promise<MonitorStatus> => {
      const monitorStatus: MonitorStatus = new MonitorStatus();
      monitorStatus.name = "Under Maintenance";
      return monitorStatus;
    }) as never);
  jest
    .spyOn(
      ScheduledMaintenanceFeedService,
      "createScheduledMaintenanceFeedItem",
    )
    .mockResolvedValue(undefined as never);

  (Response.sendEmptySuccessResponse as unknown as MockFunction).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PUT a scheduled maintenance event's Change Monitor Status to, before it starts", () => {
  test.each(EDITORS)(
    "%s sets it by the relation, as the Affected Resources card sends it",
    async (_role: string, permissions: Array<Permission>) => {
      caller = personWith(permissions);

      await put({ changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID } });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(Object.keys(written())).toEqual(["changeMonitorStatusTo"]);
      expect(idIn(written()["changeMonitorStatusTo"])).toBe(
        MAINTENANCE_STATUS_ID,
      );
    },
  );

  test.each(EDITORS)(
    "%s sets it by the ID column, as the API documents and Terraform writes it",
    async (_role: string, permissions: Array<Permission>) => {
      caller = personWith(permissions);

      await put({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(idIn(written()["changeMonitorStatusToId"])).toBe(
        MAINTENANCE_STATUS_ID,
      );
    },
  );

  test("an editor clears it: the column is written empty", async () => {
    await put({ changeMonitorStatusTo: null });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    expect(written()).toEqual({ changeMonitorStatusTo: null });
  });

  test("an event in a state of the project's own before Ongoing still waits to start: saved", async () => {
    eventState = "confirmed";

    await put({ changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID } });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
  });

  test("an editor saves it with the rest of the Affected Resources card in one write", async () => {
    await put({
      monitors: [],
      changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID },
      hosts: [],
    });

    expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    // Lists are written with save(), the relation along with them.
    expect(repositorySave).toHaveBeenCalledTimes(1);

    const saved: Record<string, unknown> = repositorySave.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(idIn(saved["changeMonitorStatusTo"])).toBe(MAINTENANCE_STATUS_ID);
  });

  test.each(NOT_EDITORS)(
    "%s may not change it, by either name, and nothing is written",
    async (_role: string, permissions: Array<Permission>) => {
      caller = personWith(permissions);

      await expect(
        put({ changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID } }),
      ).rejects.toThrow();
      await expect(
        put({ changeMonitorStatusToId: MAINTENANCE_STATUS_ID }),
      ).rejects.toThrow();

      expectNothingWritten();
    },
  );

  test("a status of another project is refused by either name, and nothing is written", async () => {
    await expect(
      put({ changeMonitorStatusTo: { _id: FOREIGN_STATUS_ID } }),
    ).rejects.toThrow(`Monitor Status "${FOREIGN_STATUS_ID}"`);
    await expect(
      put({ changeMonitorStatusToId: FOREIGN_STATUS_ID }),
    ).rejects.toThrow(`Monitor Status "${FOREIGN_STATUS_ID}"`);

    expectNothingWritten();
  });

  test("both names naming two statuses are refused before anything is read", async () => {
    await expect(
      put({
        changeMonitorStatusToId: DEGRADED_STATUS_ID,
        changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID },
      }),
    ).rejects.toThrow(
      /changeMonitorStatusToId and changeMonitorStatusTo are names for the same field/,
    );

    expectNothingWritten();
  });
});

describe.each([
  ["ongoing", "ongoing"],
  ["ended", "ended"],
  ["completed", "completed"],
] as Array<[string, StateKind]>)(
  "PUT the Change Monitor Status to of an event that is %s",
  (_name: string, kind: StateKind) => {
    beforeEach(() => {
      eventState = kind;
    });

    test.each([
      [
        "the relation",
        { changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID } },
      ],
      ["the ID column", { changeMonitorStatusToId: MAINTENANCE_STATUS_ID }],
      ["a clear", { changeMonitorStatusTo: null }],
    ] as Array<[string, JSONObject]>)(
      "a change by %s is refused with one plain message, and nothing is written",
      async (_change: string, data: JSONObject) => {
        await expect(put(data)).rejects.toThrow(
          MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE,
        );

        expectNothingWritten();
      },
    );

    test.each(EDITORS)(
      "%s is refused too: who may edit the event does not change when",
      async (_role: string, permissions: Array<Permission>) => {
        caller = personWith(permissions);

        await expect(
          put({ changeMonitorStatusTo: { _id: MAINTENANCE_STATUS_ID } }),
        ).rejects.toThrow(MONITOR_STATUS_LOCKED_AFTER_START_MESSAGE);
      },
    );

    test("sending back the status it holds is no change: the write goes through", async () => {
      await put({ changeMonitorStatusTo: { _id: DEGRADED_STATUS_ID } });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    });

    test("the rest of the event can still be edited", async () => {
      await put({ title: "Database upgrade, part two" });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(written()).toEqual({ title: "Database upgrade, part two" });
    });

    test("a form that sends the whole card back, status unchanged, is saved", async () => {
      await put({
        monitors: [],
        changeMonitorStatusTo: { _id: DEGRADED_STATUS_ID },
        hosts: [],
      });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
    });
  },
);
