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
 * PUT /incident-templates/:id and PUT /scheduled-maintenance-template/:id
 * with a template's Change Monitor Status to - and an incident template's
 * Initial Incident State - for the people who may edit the template.
 *
 * The template's Affected Resources card (and its details card, for the
 * initial state) saves the relation: `changeMonitorStatusTo: { _id }`. The
 * relation's update list was empty while its ID column's listed the
 * template's editors, so the server refused that save to everyone but
 * master admins ("User is not allowed to update on changeMonitorStatusTo
 * column"), and the dashboard, which reads the same list, left the field
 * out of the Edit. The ID column - what the API documents and Terraform
 * writes - kept working, and still does.
 *
 * The server's own permission layer and the services' own hooks run here;
 * only the database is a stand-in: the template the write finds, the
 * repository it writes to, and which records the project has
 * (stubProjectDirectory).
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
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import ScheduledMaintenanceTemplateService from "../../../Server/Services/ScheduledMaintenanceTemplateService";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import ScheduledMaintenanceTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-7e57-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-7e57-4aaa-8bbb-000000000002");
const TEMPLATE_ID: string = "0193c0de-7e57-4aaa-8bbb-0000000000a1";

// Monitor statuses and incident states of the template's own project.
const DEGRADED_STATUS_ID: string = "0193c0de-7e57-4aaa-8bbb-0000000000b1";
const MAINTENANCE_STATUS_ID: string = "0193c0de-7e57-4aaa-8bbb-0000000000b2";
const INVESTIGATING_STATE_ID: string = "0193c0de-7e57-4aaa-8bbb-0000000000c1";

// A monitor status and an incident state of another project.
const FOREIGN_STATUS_ID: string = "0193c0de-7e57-4aaa-8bbb-0000000000f1";
const FOREIGN_STATE_ID: string = "0193c0de-7e57-4aaa-8bbb-0000000000f2";

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

interface TemplateKind {
  kind: string;
  modelType: { new (): BaseModel };
  service: DatabaseService<BaseModel>;
  editors: Array<Role>;
  notEditors: Array<Role>;
  otherProductEditor: Role;
}

const KINDS: Array<TemplateKind> = [
  {
    kind: "incident template",
    modelType: IncidentTemplate,
    service: IncidentTemplateService as unknown as DatabaseService<BaseModel>,
    editors: [
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Admin", [Permission.ProjectAdmin]],
      ["Project Member", [Permission.ProjectMember]],
      ["Incident Admin", [Permission.IncidentAdmin]],
      ["Incident Member", [Permission.IncidentMember]],
      [
        "a role that may read and edit incident templates",
        [Permission.ReadIncidentTemplate, Permission.EditIncidentTemplate],
      ],
    ],
    notEditors: [
      ["Viewer", [Permission.Viewer]],
      ["Incident Viewer", [Permission.IncidentViewer]],
      ["Read Incident Template", [Permission.ReadIncidentTemplate]],
      [
        "Create Incident Template",
        [Permission.ReadIncidentTemplate, Permission.CreateIncidentTemplate],
      ],
      [
        "Delete Incident Template",
        [Permission.ReadIncidentTemplate, Permission.DeleteIncidentTemplate],
      ],
    ],
    otherProductEditor: [
      "a scheduled maintenance template editor",
      [
        Permission.ReadScheduledMaintenanceTemplate,
        Permission.EditScheduledMaintenanceTemplate,
      ],
    ],
  },
  {
    kind: "scheduled maintenance template",
    modelType: ScheduledMaintenanceTemplate,
    service:
      ScheduledMaintenanceTemplateService as unknown as DatabaseService<BaseModel>,
    editors: [
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Admin", [Permission.ProjectAdmin]],
      ["Project Member", [Permission.ProjectMember]],
      ["Scheduled Maintenance Admin", [Permission.ScheduledMaintenanceAdmin]],
      ["Scheduled Maintenance Member", [Permission.ScheduledMaintenanceMember]],
      [
        "a role that may read and edit scheduled maintenance templates",
        [
          Permission.ReadScheduledMaintenanceTemplate,
          Permission.EditScheduledMaintenanceTemplate,
        ],
      ],
    ],
    notEditors: [
      ["Viewer", [Permission.Viewer]],
      ["Scheduled Maintenance Viewer", [Permission.ScheduledMaintenanceViewer]],
      [
        "Read Scheduled Maintenance Template",
        [Permission.ReadScheduledMaintenanceTemplate],
      ],
      [
        "Create Scheduled Maintenance Template",
        [
          Permission.ReadScheduledMaintenanceTemplate,
          Permission.CreateScheduledMaintenanceTemplate,
        ],
      ],
      [
        "Delete Scheduled Maintenance Template",
        [
          Permission.ReadScheduledMaintenanceTemplate,
          Permission.DeleteScheduledMaintenanceTemplate,
        ],
      ],
    ],
    otherProductEditor: [
      "an incident template editor",
      [Permission.ReadIncidentTemplate, Permission.EditIncidentTemplate],
    ],
  },
];

// The members of a service these tests stub that its type keeps private.
interface StubbableService {
  _findBy: (...args: Array<unknown>) => Promise<unknown>;
  getRepository: () => unknown;
  onTriggerWorkflow: (...args: Array<unknown>) => Promise<unknown>;
  onTriggerRealtime: (...args: Array<unknown>) => Promise<unknown>;
}

let repositoryUpdate: MockFunction;
let repositorySave: MockFunction;
let caller: DatabaseCommonInteractionProps;

/*
 * The database behind the service: every read finds the one template (in
 * the project, not recurring), and every write reaches the stub repository.
 */
function stubDatabase(kind: TemplateKind): void {
  const service: StubbableService = kind.service as unknown as StubbableService;

  jest.spyOn(service, "_findBy").mockImplementation((async (): Promise<
    Array<BaseModel>
  > => {
    const template: BaseModel = new kind.modelType();
    template._id = TEMPLATE_ID;
    template.setColumnValue("projectId", PROJECT_ID);
    return [template];
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

async function put(kind: TemplateKind, data: JSONObject): Promise<void> {
  const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = new BaseAPI<
    BaseModel,
    DatabaseService<BaseModel>
  >(kind.modelType, kind.service);

  const request: ExpressRequest = {
    params: { id: TEMPLATE_ID },
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

beforeEach(() => {
  caller = personWith([Permission.ProjectAdmin]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    }) as never);

  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      MonitorStatus: [DEGRADED_STATUS_ID, MAINTENANCE_STATUS_ID],
      IncidentState: [INVESTIGATING_STATE_ID],
    },
  });

  (Response.sendEmptySuccessResponse as unknown as MockFunction).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "PUT a $kind's Change Monitor Status to",
  (kind: TemplateKind) => {
    beforeEach(() => {
      stubDatabase(kind);
    });

    test.each(kind.editors)(
      "%s sets it by the relation, as the Affected Resources card sends it",
      async (_role: string, permissions: Array<Permission>) => {
        caller = personWith(permissions);

        await put(kind, { changeMonitorStatusTo: { _id: DEGRADED_STATUS_ID } });

        expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
        expect(Object.keys(written())).toEqual(["changeMonitorStatusTo"]);
        expect(idIn(written()["changeMonitorStatusTo"])).toBe(
          DEGRADED_STATUS_ID,
        );
      },
    );

    test.each(kind.editors)(
      "%s still sets it by the ID column, as the API documents and Terraform writes it",
      async (_role: string, permissions: Array<Permission>) => {
        caller = personWith(permissions);

        await put(kind, { changeMonitorStatusToId: MAINTENANCE_STATUS_ID });

        expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
        expect(idIn(written()["changeMonitorStatusToId"])).toBe(
          MAINTENANCE_STATUS_ID,
        );
      },
    );

    test("an editor clears it by the relation: the column is written empty", async () => {
      await put(kind, { changeMonitorStatusTo: null });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(written()).toEqual({ changeMonitorStatusTo: null });
    });

    test("an editor saves it with the rest of the Affected Resources card in one write", async () => {
      await put(kind, {
        monitors: [],
        changeMonitorStatusTo: { _id: DEGRADED_STATUS_ID },
        hosts: [],
      });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      // Lists are written with save(), the relation along with them.
      expect(repositorySave).toHaveBeenCalledTimes(1);

      const saved: Record<string, unknown> = repositorySave.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(idIn(saved["changeMonitorStatusTo"])).toBe(DEGRADED_STATUS_ID);
      expect(String(saved["_id"])).toBe(TEMPLATE_ID);
    });

    test.each(kind.notEditors)(
      "%s may not change it, by either name, and nothing is written",
      async (_role: string, permissions: Array<Permission>) => {
        caller = personWith(permissions);

        await expect(
          put(kind, { changeMonitorStatusTo: { _id: DEGRADED_STATUS_ID } }),
        ).rejects.toThrow();
        await expect(
          put(kind, { changeMonitorStatusToId: DEGRADED_STATUS_ID }),
        ).rejects.toThrow();

        expect(repositoryUpdate).not.toHaveBeenCalled();
        expect(repositorySave).not.toHaveBeenCalled();
        expect(Response.sendEmptySuccessResponse).not.toHaveBeenCalled();
      },
    );

    test("the other product's template editors may not change it", async () => {
      caller = personWith(kind.otherProductEditor[1]);

      await expect(
        put(kind, { changeMonitorStatusTo: { _id: DEGRADED_STATUS_ID } }),
      ).rejects.toThrow();

      expect(repositoryUpdate).not.toHaveBeenCalled();
    });

    test("a status of another project is refused by the relation, and nothing is written", async () => {
      await expect(
        put(kind, { changeMonitorStatusTo: { _id: FOREIGN_STATUS_ID } }),
      ).rejects.toThrow(
        `This ${kind.kind} references records that are not in this project: Monitor Status "${FOREIGN_STATUS_ID}".`,
      );

      expect(repositoryUpdate).not.toHaveBeenCalled();
    });

    test("a status of another project is refused by the ID column, and nothing is written", async () => {
      await expect(
        put(kind, { changeMonitorStatusToId: FOREIGN_STATUS_ID }),
      ).rejects.toThrow(`Monitor Status "${FOREIGN_STATUS_ID}"`);

      expect(repositoryUpdate).not.toHaveBeenCalled();
    });

    /*
     * A write may name the status by both names; each one is checked
     * against the template's project.
     */
    test("both names in one write: a status of another project behind one of the project's own is refused", async () => {
      await expect(
        put(kind, {
          changeMonitorStatusToId: DEGRADED_STATUS_ID,
          changeMonitorStatusTo: { _id: FOREIGN_STATUS_ID },
        }),
      ).rejects.toThrow(`Monitor Status "${FOREIGN_STATUS_ID}"`);

      await expect(
        put(kind, {
          changeMonitorStatusToId: FOREIGN_STATUS_ID,
          changeMonitorStatusTo: { _id: DEGRADED_STATUS_ID },
        }),
      ).rejects.toThrow(`Monitor Status "${FOREIGN_STATUS_ID}"`);

      expect(repositoryUpdate).not.toHaveBeenCalled();
    });

    test("both names in one write, both the project's own: saved", async () => {
      await put(kind, {
        changeMonitorStatusToId: DEGRADED_STATUS_ID,
        changeMonitorStatusTo: { _id: DEGRADED_STATUS_ID },
      });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(idIn(written()["changeMonitorStatusTo"])).toBe(DEGRADED_STATUS_ID);
    });
  },
);

describe("PUT an incident template's Initial Incident State", () => {
  const INCIDENT_TEMPLATE: TemplateKind = KINDS[0]!;

  beforeEach(() => {
    stubDatabase(INCIDENT_TEMPLATE);
  });

  test.each(INCIDENT_TEMPLATE.editors)(
    "%s sets it by the relation, as the template's details card sends it",
    async (_role: string, permissions: Array<Permission>) => {
      caller = personWith(permissions);

      await put(INCIDENT_TEMPLATE, {
        initialIncidentState: { _id: INVESTIGATING_STATE_ID },
      });

      expect(Response.sendEmptySuccessResponse).toHaveBeenCalledTimes(1);
      expect(idIn(written()["initialIncidentState"])).toBe(
        INVESTIGATING_STATE_ID,
      );
    },
  );

  test("an editor clears it - back to the usual starting state", async () => {
    await put(INCIDENT_TEMPLATE, { initialIncidentState: null });

    expect(written()).toEqual({ initialIncidentState: null });
  });

  test.each(INCIDENT_TEMPLATE.notEditors)(
    "%s may not change it, and nothing is written",
    async (_role: string, permissions: Array<Permission>) => {
      caller = personWith(permissions);

      await expect(
        put(INCIDENT_TEMPLATE, {
          initialIncidentState: { _id: INVESTIGATING_STATE_ID },
        }),
      ).rejects.toThrow();

      expect(repositoryUpdate).not.toHaveBeenCalled();
    },
  );

  test("a state of another project is refused by either name, alone or behind one of the project's own", async () => {
    for (const data of [
      { initialIncidentState: { _id: FOREIGN_STATE_ID } },
      { initialIncidentStateId: FOREIGN_STATE_ID },
      {
        initialIncidentStateId: INVESTIGATING_STATE_ID,
        initialIncidentState: { _id: FOREIGN_STATE_ID },
      },
    ]) {
      await expect(put(INCIDENT_TEMPLATE, data)).rejects.toThrow(
        `Incident State "${FOREIGN_STATE_ID}"`,
      );
    }

    expect(repositoryUpdate).not.toHaveBeenCalled();
  });
});
