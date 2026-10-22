import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import { FindOperator } from "typeorm";

/*
 * THE POSTMORTEMS LIST, THROUGH THE API.
 *
 * Incidents > Postmortems lists every incident's postmortem across the
 * project - POST /incident/get-list filtered by the Postmortem Status,
 * Severity and Owner chips, and one POST /incident/count per status tile -
 * and offers the project's statuses from POST
 * /incident-postmortem-status/get-list. Each request here runs as it does in
 * production - BaseAPI's handler, the incident service's own hooks and the
 * server's permission layer - and stops where SQL would be sent: a fake
 * repository records the reads the database would have run.
 *
 *   - the list and the counts never leave the caller's project, whatever
 *     project the query names;
 *   - every chip reaches the database as the Dashboard writes it;
 *   - a member who does not own a private incident never sees its
 *     postmortem; an owner or an admin sees every one;
 *   - who may read the list, add a status of the project's own and move a
 *     postmortem are the incident's and the statuses' own permissions.
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
import IncidentPostmortemStatusService from "../../../Server/Services/IncidentPostmortemStatusService";
import IncidentService from "../../../Server/Services/IncidentService";
import ProjectService from "../../../Server/Services/ProjectService";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import Includes from "../../../Types/BaseDatabase/Includes";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import JSONFunctions from "../../../Types/JSONFunctions";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-7e57-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-7e57-4aaa-8bbb-000000000002",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-7e57-4aaa-8bbb-000000000003");

const NOT_STARTED_ID: string = "0193c0de-7e57-4aaa-8bbb-0000000000a1";
const DRAFT_ID: string = "0193c0de-7e57-4aaa-8bbb-0000000000a2";
const SEVERITY_ID: string = "0193c0de-7e57-4aaa-8bbb-0000000000b1";
const OWNED_INCIDENT_IDS: Array<string> = [
  "0193c0de-7e57-4aaa-8bbb-0000000000c1",
  "0193c0de-7e57-4aaa-8bbb-0000000000c2",
];
const INCIDENT_ID: string = "0193c0de-7e57-4aaa-8bbb-0000000000c1";

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

// What a statement would have been sent with, had a read reached one.
interface FakeRepository {
  find: Mock<
    (options: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
      relations?: Record<string, unknown>;
    }) => Promise<[]>
  >;
  count: Mock<(options: { where: Record<string, unknown> }) => Promise<number>>;
}

/*
 * The service's repository, recording every read instead of sending it,
 * and answering each with `rows`.
 */
function fakeRepository(
  service: DatabaseService<any>,
  rows: Array<BaseModel> = [],
): FakeRepository {
  const repository: FakeRepository = {
    find: jest.fn(async (): Promise<[]> => {
      return rows as unknown as [];
    }),
    count: jest.fn(async (): Promise<number> => {
      return 0;
    }),
  };

  getJestSpyOn(service, "getRepository").mockReturnValue(repository as never);

  return repository;
}

let caller: DatabaseCommonInteractionProps;

function asCaller(permissions: Array<Permission>): void {
  caller = personWith(permissions);
}

function request(data: { id?: string; body: JSONObject }): ExpressRequest {
  return {
    params: { id: data.id || INCIDENT_ID },
    query: {},
    body: data.body,
    headers: {},
  } as unknown as ExpressRequest;
}

function response(): ExpressResponse {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
}

function incidentApi(): BaseAPI<BaseModel, DatabaseService<BaseModel>> {
  return new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
    Incident,
    IncidentService as unknown as DatabaseService<BaseModel>,
  );
}

function statusApi(): BaseAPI<BaseModel, DatabaseService<BaseModel>> {
  return new BaseAPI<BaseModel, DatabaseService<BaseModel>>(
    IncidentPostmortemStatus,
    IncidentPostmortemStatusService as unknown as DatabaseService<BaseModel>,
  );
}

/*
 * The values a condition binds, lower-cased as Postgres renders a uuid:
 * the server writes every condition on an id as SQL with its values bound
 * as parameters (QueryUtil).
 */
function boundValues(condition: unknown): Array<string> {
  if (condition instanceof FindOperator) {
    const parameters: Record<string, unknown> =
      (
        condition as unknown as {
          objectLiteralParameters?: Record<string, unknown>;
        }
      ).objectLiteralParameters || {};

    return Object.values(parameters)
      .flatMap((value: unknown): Array<unknown> => {
        return Array.isArray(value) ? value : [value];
      })
      .map((value: unknown): string => {
        return String(value).toLowerCase();
      });
  }

  if (condition === undefined || condition === null) {
    return [];
  }

  return [String(condition).toLowerCase()];
}

// The project a read's condition is held to.
function projectOf(where: Record<string, unknown>): string {
  return boundValues(where["projectId"])[0] || "";
}

/*
 * The list the Postmortems page asks for: the chips' filters, the columns
 * it draws, newest first.
 */
function postmortemsListBody(query: Record<string, unknown>): JSONObject {
  return {
    query: JSONFunctions.serialize(query as JSONObject),
    select: JSONFunctions.serialize({
      _id: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      title: true,
      declaredAt: true,
      postmortemStatusId: true,
      postmortemStatus: {
        _id: true,
        name: true,
        color: true,
      },
      incidentSeverity: {
        name: true,
        color: true,
      },
    } as JSONObject),
    sort: JSONFunctions.serialize({ declaredAt: "DESC" } as JSONObject),
    limit: 10,
    skip: 0,
  };
}

beforeEach(() => {
  asCaller([Permission.ProjectMember]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    }) as never);

  stubProjectDirectory({ projectId: PROJECT_ID });

  jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
    plan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /incident/get-list: the Postmortems list", () => {
  test("the postmortems still owed, of one severity and owner: every chip reaches the database, held to the caller's project", async () => {
    const repository: FakeRepository = fakeRepository(IncidentService);

    await incidentApi().getList(
      request({
        body: postmortemsListBody({
          projectId: PROJECT_ID,
          // The Postmortem Status chip: Not Started and Draft.
          postmortemStatus: new Includes([NOT_STARTED_ID, DRAFT_ID]),
          // The Severity chip.
          incidentSeverity: new Includes([SEVERITY_ID]),
          // The Owner chip: the incidents the team owns, as read from its owner rows.
          _id: new Includes(OWNED_INCIDENT_IDS),
        }),
      }),
      response(),
    );

    expect(repository.find).toHaveBeenCalledTimes(1);

    const options: {
      where: Record<string, unknown>;
      select?: Record<string, unknown>;
      relations?: Record<string, unknown>;
    } = repository.find.mock.calls[0]![0];

    expect(projectOf(options.where)).toBe(PROJECT_ID.toString());
    // A chip names the relation; the database reads its id column.
    expect(boundValues(options.where["postmortemStatusId"]).sort()).toEqual(
      [NOT_STARTED_ID, DRAFT_ID].sort(),
    );
    expect(boundValues(options.where["incidentSeverityId"])).toEqual([
      SEVERITY_ID,
    ]);
    expect(boundValues(options.where["_id"]).sort()).toEqual(
      [...OWNED_INCIDENT_IDS].sort(),
    );

    // The row's status pill reads the status's name and colour.
    expect(options.relations).toEqual(
      expect.objectContaining({ postmortemStatus: true }),
    );
    expect(options.select?.["postmortemStatus"]).toEqual(
      expect.objectContaining({ name: true, color: true }),
    );
  });

  test("a query that names another project still reads only the caller's", async () => {
    const repository: FakeRepository = fakeRepository(IncidentService);

    const attempt: Promise<void> = incidentApi().getList(
      request({
        body: postmortemsListBody({
          projectId: OTHER_PROJECT_ID,
          postmortemStatus: new Includes([DRAFT_ID]),
        }),
      }),
      response(),
    );

    await attempt.catch(() => {
      // A refusal reads nothing either; checked below.
    });

    for (const call of repository.find.mock.calls) {
      expect(projectOf(call[0].where)).toBe(PROJECT_ID.toString());
    }
  });

  test("a member sees a private incident's postmortem only when they own it; an admin sees every one", async () => {
    let repository: FakeRepository = fakeRepository(IncidentService);

    await incidentApi().getList(
      request({
        body: postmortemsListBody({
          projectId: PROJECT_ID,
          postmortemStatus: new Includes([DRAFT_ID]),
        }),
      }),
      response(),
    );

    // The incidents' own privacy rule: owners and their teams only.
    const memberWhere: Record<string, unknown> =
      repository.find.mock.calls[0]![0].where;

    expect(memberWhere["isPrivate"]).toBeInstanceOf(FindOperator);

    jest.restoreAllMocks();
    asCaller([Permission.ProjectAdmin]);
    jest
      .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
      .mockImplementation((async (): Promise<DatabaseCommonInteractionProps> => {
        return caller;
      }) as never);
    stubProjectDirectory({ projectId: PROJECT_ID });
    repository = fakeRepository(IncidentService);

    await incidentApi().getList(
      request({
        body: postmortemsListBody({
          projectId: PROJECT_ID,
          postmortemStatus: new Includes([DRAFT_ID]),
        }),
      }),
      response(),
    );

    expect(repository.find.mock.calls[0]![0].where["isPrivate"]).toBeUndefined();
  });

  test.each([
    ["a project viewer", [Permission.Viewer]],
    ["an incident viewer", [Permission.IncidentViewer]],
    ["a member", [Permission.ProjectMember]],
  ] as Array<[string, Array<Permission>]>)(
    "%s reads the list, statuses and severities included",
    async (_name: string, permissions: Array<Permission>) => {
      asCaller(permissions);
      const repository: FakeRepository = fakeRepository(IncidentService);

      await incidentApi().getList(
        request({
          body: postmortemsListBody({
            projectId: PROJECT_ID,
            postmortemStatus: new Includes([NOT_STARTED_ID]),
          }),
        }),
        response(),
      );

      expect(repository.find).toHaveBeenCalledTimes(1);
      expect(projectOf(repository.find.mock.calls[0]![0].where)).toBe(
        PROJECT_ID.toString(),
      );
    },
  );

  test("someone who may read postmortem statuses but not incidents is refused, and nothing is read", async () => {
    asCaller([Permission.ReadIncidentPostmortemStatus]);
    const repository: FakeRepository = fakeRepository(IncidentService);

    await expect(
      incidentApi().getList(
        request({
          body: postmortemsListBody({
            projectId: PROJECT_ID,
            postmortemStatus: new Includes([NOT_STARTED_ID]),
          }),
        }),
        response(),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(repository.find).not.toHaveBeenCalled();
    expect(repository.count).not.toHaveBeenCalled();
  });

  test("a status filter that is not an id is a 400 naming the column, before anything is read", async () => {
    const repository: FakeRepository = fakeRepository(IncidentService);

    const attempt: Promise<void> = incidentApi().getList(
      request({
        body: {
          query: {
            projectId: PROJECT_ID.toString(),
            postmortemStatusId: "[object Object]",
          },
        },
      }),
      response(),
    );

    await expect(attempt).rejects.toBeInstanceOf(BadDataException);
    await expect(attempt).rejects.toThrow(
      'Invalid ID for "postmortemStatusId" in the query',
    );
    expect(repository.find).not.toHaveBeenCalled();
  });
});

describe("POST /incident/count: a status tile", () => {
  test("counts the project's incidents in one status", async () => {
    asCaller([Permission.Viewer]);
    const repository: FakeRepository = fakeRepository(IncidentService);

    await incidentApi().count(
      request({
        body: {
          query: JSONFunctions.serialize({
            projectId: PROJECT_ID,
            postmortemStatusId: new ObjectID(DRAFT_ID),
          } as JSONObject),
        },
      }),
      response(),
    );

    expect(repository.count).toHaveBeenCalledTimes(1);

    const where: Record<string, unknown> =
      repository.count.mock.calls[0]![0].where;

    expect(projectOf(where)).toBe(PROJECT_ID.toString());
    expect(boundValues(where["postmortemStatusId"])).toEqual([DRAFT_ID]);
  });

  test("never counts another project's incidents", async () => {
    asCaller([Permission.Viewer]);
    const repository: FakeRepository = fakeRepository(IncidentService);

    await incidentApi()
      .count(
        request({
          body: {
            query: JSONFunctions.serialize({
              projectId: OTHER_PROJECT_ID,
              postmortemStatusId: new ObjectID(DRAFT_ID),
            } as JSONObject),
          },
        }),
        response(),
      )
      .catch(() => {
        // A refusal counts nothing either; checked below.
      });

    for (const call of repository.count.mock.calls) {
      expect(projectOf(call[0].where)).toBe(PROJECT_ID.toString());
    }
  });
});

describe("POST /incident-postmortem-status/get-list: the statuses the chips and pills offer", () => {
  test.each([
    ["a project viewer", [Permission.Viewer]],
    ["an incident viewer", [Permission.IncidentViewer]],
    ["a member", [Permission.ProjectMember]],
    ["someone with Read Postmortem Status", [Permission.ReadIncidentPostmortemStatus]],
  ] as Array<[string, Array<Permission>]>)(
    "%s reads the project's statuses, top first",
    async (_name: string, permissions: Array<Permission>) => {
      asCaller(permissions);
      const repository: FakeRepository = fakeRepository(
        IncidentPostmortemStatusService,
      );

      await statusApi().getList(
        request({
          body: {
            query: JSONFunctions.serialize({
              projectId: PROJECT_ID,
            } as JSONObject),
            select: JSONFunctions.serialize({
              _id: true,
              name: true,
              color: true,
              order: true,
              description: true,
              isNotStartedStatus: true,
              isDraftStatus: true,
              isCompletedStatus: true,
              isArchived: true,
            } as JSONObject),
            sort: JSONFunctions.serialize({ order: "ASC" } as JSONObject),
            limit: 50,
            skip: 0,
          },
        }),
        response(),
      );

      expect(repository.find).toHaveBeenCalledTimes(1);
      expect(projectOf(repository.find.mock.calls[0]![0].where)).toBe(
        PROJECT_ID.toString(),
      );
    },
  );

  test("someone with no incident or status permission is refused", async () => {
    asCaller([Permission.ReadProjectIncident]);
    const repository: FakeRepository = fakeRepository(
      IncidentPostmortemStatusService,
    );

    await expect(
      statusApi().getList(
        request({
          body: {
            query: JSONFunctions.serialize({
              projectId: PROJECT_ID,
            } as JSONObject),
            select: JSONFunctions.serialize({
              _id: true,
              name: true,
            } as JSONObject),
          },
        }),
        response(),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(repository.find).not.toHaveBeenCalled();
  });
});

describe("writes", () => {
  // A status of the project's own, as the settings page adds it.
  const newStatus: JSONObject = {
    data: {
      projectId: PROJECT_ID.toString(),
      name: "In Review",
      color: { _type: "Color", value: "#6366f1" },
      description: "Someone is reviewing the write-up.",
    },
  };

  test.each([
    ["a member", [Permission.ProjectMember]],
    ["an incident member", [Permission.IncidentMember]],
    ["a viewer", [Permission.Viewer]],
  ] as Array<[string, Array<Permission>]>)(
    "%s can't add a status of the project's own",
    async (_name: string, permissions: Array<Permission>) => {
      asCaller(permissions);
      const create: Mock<() => Promise<never>> = jest.fn(
        async (): Promise<never> => {
          throw new Error("reached the hooks");
        },
      );

      getJestSpyOn(IncidentPostmortemStatusService, "_onBeforeCreate").mockImplementation(
        create as never,
      );

      await expect(
        statusApi().createItem(request({ body: newStatus }), response()),
      ).rejects.toBeInstanceOf(NotAuthorizedException);

      expect(create).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["an owner", [Permission.ProjectOwner]],
    ["an admin", [Permission.ProjectAdmin]],
    ["an incident admin", [Permission.IncidentAdmin]],
    ["someone with Create Postmortem Status", [Permission.CreateIncidentPostmortemStatus]],
  ] as Array<[string, Array<Permission>]>)(
    "%s adds one: the request reaches the statuses' own hooks",
    async (_name: string, permissions: Array<Permission>) => {
      asCaller(permissions);

      class AtTheHooks extends Error {}

      const create: Mock<() => Promise<never>> = jest.fn(
        async (): Promise<never> => {
          throw new AtTheHooks();
        },
      );

      getJestSpyOn(IncidentPostmortemStatusService, "_onBeforeCreate").mockImplementation(
        create as never,
      );

      await expect(
        statusApi().createItem(request({ body: newStatus }), response()),
      ).rejects.toBeInstanceOf(AtTheHooks);

      expect(create).toHaveBeenCalledTimes(1);
    },
  );

  test("a viewer can't move a postmortem: the incident's status is the editors'", async () => {
    asCaller([Permission.Viewer, Permission.IncidentViewer]);
    const repository: FakeRepository = fakeRepository(IncidentService);
    const update: Mock<() => Promise<never>> = jest.fn(
      async (): Promise<never> => {
        throw new Error("reached the hooks");
      },
    );

    getJestSpyOn(IncidentService, "onBeforeUpdate").mockImplementation(
      update as never,
    );

    await expect(
      incidentApi().updateItem(
        request({
          id: INCIDENT_ID,
          body: { data: { postmortemStatusId: DRAFT_ID } },
        }),
        response(),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(update).not.toHaveBeenCalled();
    expect(repository.find).not.toHaveBeenCalled();
  });

  test.each([
    ["a member", [Permission.ProjectMember]],
    ["an incident member", [Permission.IncidentMember]],
    [
      "someone with Edit Incident and Read Incident",
      [Permission.EditProjectIncident, Permission.ReadProjectIncident],
    ],
  ] as Array<[string, Array<Permission>]>)(
    "%s moves one: the update reaches the incident service's hooks with the status picked, the incident read in the project",
    async (_name: string, permissions: Array<Permission>) => {
      asCaller(permissions);

      // The database holds the incident and the status it is moved to.
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID;
      incident.projectId = PROJECT_ID;

      const draft: IncidentPostmortemStatus = new IncidentPostmortemStatus();
      draft._id = DRAFT_ID;
      draft.projectId = PROJECT_ID;

      const repository: FakeRepository = fakeRepository(IncidentService, [
        incident,
      ]);
      fakeRepository(IncidentPostmortemStatusService, [draft]);

      class AtTheHooks extends Error {}

      const written: Array<Record<string, unknown>> = [];
      const update: Mock<(updateBy: { data: unknown }) => Promise<never>> =
        jest.fn(async (updateBy: { data: unknown }): Promise<never> => {
          written.push({ ...(updateBy.data as Record<string, unknown>) });
          throw new AtTheHooks();
        });

      getJestSpyOn(IncidentService, "onBeforeUpdate").mockImplementation(
        update as never,
      );

      await expect(
        incidentApi().updateItem(
          request({
            id: INCIDENT_ID,
            body: { data: { postmortemStatusId: DRAFT_ID } },
          }),
          response(),
        ),
      ).rejects.toBeInstanceOf(AtTheHooks);

      expect(update).toHaveBeenCalledTimes(1);
      expect(String(written[0]!["postmortemStatusId"]).toLowerCase()).toBe(
        DRAFT_ID,
      );

      // The incidents the update may write were read in the project only.
      expect(repository.find).toHaveBeenCalled();

      for (const call of repository.find.mock.calls) {
        expect(projectOf(call[0].where)).toBe(PROJECT_ID.toString());
      }
    },
  );

  test("Edit Incident alone moves nothing: a move needs the incident read too", async () => {
    asCaller([Permission.EditProjectIncident]);
    const repository: FakeRepository = fakeRepository(IncidentService);

    await expect(
      incidentApi().updateItem(
        request({
          id: INCIDENT_ID,
          body: { data: { postmortemStatusId: DRAFT_ID } },
        }),
        response(),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);

    expect(repository.find).not.toHaveBeenCalled();
  });
});
