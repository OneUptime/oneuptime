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

/*
 * A LIST'S SORT, THROUGH THE API (#8141).
 *
 * POST /incident/get-list with `sort: { incidentSeverity: "DESC" }` - a
 * relation given only a direction - or with `sort: { nope: "ASC" }` reached
 * TypeORM, which threw EntityPropertyNotFoundError: no code, so the API
 * answered 500 and logged a server fault. Each request here runs as it does
 * in production - BaseAPI's handler, the incident service's own hooks and
 * the server's permission layer - and stops where SQL would be sent: a fake
 * repository records the reads the database would have run.
 *
 *   - a sort the database cannot order the list by as written is refused as
 *     bad data (400), saying what to send, and nothing is read;
 *   - every sort it can is read exactly as it was sent, the primary key
 *     after it to break ties, as before;
 *   - a caller who may not read the list is told that first;
 *   - a refusal names the fields of the caller as they asked, never of the
 *     root a service's hook reads as for them.
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
import IncidentService from "../../../Server/Services/IncidentService";
import ProjectService from "../../../Server/Services/ProjectService";
import ColumnPermissions from "../../../Server/Types/Database/Permissions/ColumnPermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import BadDataException from "../../../Types/Exception/BadDataException";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-7e57-4aaa-8bbb-000000008141",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-7e57-4aaa-8bbb-000000008142");

// A signed-in person holding exactly `permissions` in the project.
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

interface FindOptions {
  where: Record<string, unknown>;
  order?: Record<string, unknown>;
}

interface FakeRepository {
  find: Mock<(options: FindOptions) => Promise<[]>>;
  count: Mock<() => Promise<number>>;
}

// The service's repository, recording every read instead of sending it.
function fakeRepository(service: DatabaseService<any>): FakeRepository {
  const repository: FakeRepository = {
    find: jest.fn(async (): Promise<[]> => {
      return [];
    }),
    count: jest.fn(async (): Promise<number> => {
      return 0;
    }),
  };

  getJestSpyOn(service, "getRepository").mockReturnValue(repository as never);

  return repository;
}

let caller: DatabaseCommonInteractionProps;

function request(body: JSONObject): ExpressRequest {
  return {
    params: {},
    query: {},
    body: body,
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

// The incidents list as an API client asks for it, sorted by `sort`.
function listBody(sort: JSONValue): JSONObject {
  return {
    query: JSONFunctions.serialize({ projectId: PROJECT_ID } as JSONObject),
    select: { _id: true, title: true },
    sort: sort,
    limit: 10,
    skip: 0,
  };
}

// What a list request was refused with, read through the API.
async function refusalOfList(sort: JSONValue): Promise<unknown> {
  try {
    await incidentApi().getList(request(listBody(sort)), response());
  } catch (error) {
    return error;
  }

  throw new Error(
    `Expected the list sorted by ${JSON.stringify(sort)} to be refused.`,
  );
}

beforeEach(() => {
  caller = personWith([Permission.ProjectMember]);

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

describe("POST /incident/get-list: a sort the database cannot order the list by is bad data, not a server fault", () => {
  test("a relation given only a direction: 400, saying which field to send, and nothing is read (#8141)", async () => {
    const repository: FakeRepository = fakeRepository(IncidentService);

    const refusal: unknown = await refusalOfList({ incidentSeverity: "DESC" });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as BadDataException).code).toBe(
      ExceptionCode.BadDataException,
    );
    expect((refusal as BadDataException).code).toBe(400);
    expect((refusal as BadDataException).message).toContain(
      'Incidents cannot be sorted by "incidentSeverity" with "DESC": it is a related record (Incident Severity)',
    );
    expect((refusal as BadDataException).message).toContain(
      'Send { "incidentSeverity": { "order": "ASC" } }',
    );
    expect(repository.find).not.toHaveBeenCalled();
  });

  test("a field incidents do not have: 400, naming the fields the caller may sort by (#8141)", async () => {
    const repository: FakeRepository = fakeRepository(IncidentService);

    const refusal: unknown = await refusalOfList({ nope: "ASC" });

    expect(refusal).toBeInstanceOf(BadDataException);

    const message: string = (refusal as BadDataException).message;

    expect(
      message.startsWith('Incidents have no field "nope" to sort by.'),
    ).toBe(true);
    expect(message).toContain("title");
    expect(message).toContain("declaredAt");
    expect(repository.find).not.toHaveBeenCalled();
  });

  test("a relation of many records: 400, explaining that a list of records cannot order a list (#8141)", async () => {
    const repository: FakeRepository = fakeRepository(IncidentService);

    const refusal: unknown = await refusalOfList({ labels: { name: "ASC" } });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect((refusal as BadDataException).message).toContain(
      "a list of records cannot order a list",
    );
    expect(repository.find).not.toHaveBeenCalled();
  });

  test.each([
    [
      "a direction TypeORM would have read as ascending",
      { title: "descending" },
    ],
    ["null, which TypeORM threw a TypeError on", { title: null }],
    [
      "a field through a relation that its record does not have",
      {
        incidentSeverity: { nope: "ASC" },
      },
    ],
    ["a sort that is not an object of fields", "DESC"],
  ] as Array<[string, JSONValue]>)(
    "%s: 400, and nothing is read",
    async (_name: string, sort: JSONValue) => {
      const repository: FakeRepository = fakeRepository(IncidentService);

      expect(await refusalOfList(sort)).toBeInstanceOf(BadDataException);
      expect(repository.find).not.toHaveBeenCalled();
    },
  );

  test("a caller who may not read incidents is told that, not what is wrong with the sort", async () => {
    caller = personWith([]);
    const repository: FakeRepository = fakeRepository(IncidentService);

    for (const sort of [{ incidentSeverity: "DESC" }, { nope: "ASC" }]) {
      const refusal: unknown = await refusalOfList(sort);

      expect(refusal).toBeInstanceOf(NotAuthorizedException);
      expect(refusal).not.toBeInstanceOf(BadDataException);
    }

    expect(repository.find).not.toHaveBeenCalled();
  });
});

describe("POST /incident/get-list: every sort the database can order the list by is read as it was sent", () => {
  test.each([
    ["a field, ascending", { title: "ASC" }],
    ["a field, descending", { declaredAt: "DESC" }],
    ["TypeORM's lower-case direction", { title: "asc" }],
    ["TypeORM's -1", { declaredAt: -1 }],
    [
      "descending with rows that have no value last",
      { declaredAt: { direction: "DESC", nulls: "LAST" } },
    ],
    [
      "through a relation, by a field of its record",
      {
        incidentSeverity: { order: "ASC" },
      },
    ],
    [
      "through a relation, descending with rows that have none last",
      { incidentSeverity: { order: { direction: "DESC", nulls: "LAST" } } },
    ],
    ["several fields", { incidentSeverity: { order: "ASC" }, title: "DESC" }],
  ] as Array<[string, JSONObject]>)(
    "%s",
    async (_name: string, sort: JSONObject) => {
      const repository: FakeRepository = fakeRepository(IncidentService);

      await incidentApi().getList(request(listBody(sort)), response());

      expect(repository.find).toHaveBeenCalledTimes(1);
      // As sent, then the primary key, which breaks ties (DatabaseService).
      expect(repository.find.mock.calls[0]![0].order).toEqual({
        ...sort,
        _id: SortOrder.Ascending,
      });
    },
  );

  test.each([
    ["none at all", undefined],
    ["an empty one", {}],
    ["one with no field in it", []],
  ] as Array<[string, JSONValue | undefined]>)(
    "no sort - %s: newest first, as before",
    async (_name: string, sort: JSONValue | undefined) => {
      const repository: FakeRepository = fakeRepository(IncidentService);

      await incidentApi().getList(
        request({ ...listBody(null), sort: sort as JSONValue }),
        response(),
      );

      expect(repository.find.mock.calls[0]![0].order).toEqual({
        createdAt: SortOrder.Descending,
        _id: SortOrder.Ascending,
      });
    },
  );

  test("a service reading on its own, as root, with a sort of its own", async () => {
    const repository: FakeRepository = fakeRepository(IncidentService);

    await IncidentService.findBy({
      query: { projectId: PROJECT_ID },
      select: { _id: true },
      sort: {
        currentIncidentState: { order: SortOrder.Ascending },
        createdAt: SortOrder.Descending,
      } as never,
      skip: 0,
      limit: 10,
      props: { isRoot: true },
    });

    expect(repository.find.mock.calls[0]![0].order).toEqual({
      currentIncidentState: { order: SortOrder.Ascending },
      createdAt: SortOrder.Descending,
      _id: SortOrder.Ascending,
    });
  });
});

describe("a refusal names the fields of the caller as they asked", () => {
  test("ProjectService reads as root for someone in no project - but their refusal names only the columns they may read", async () => {
    // Signed in, in no project.
    const nobody: () => DatabaseCommonInteractionProps =
      (): DatabaseCommonInteractionProps => {
        return { userId: USER_ID, userType: UserType.User };
      };

    const repository: FakeRepository = fakeRepository(ProjectService);

    let refusal: unknown = null;

    try {
      await ProjectService.findBy({
        query: {},
        select: { _id: true, name: true },
        sort: { nope: SortOrder.Ascending } as never,
        skip: 0,
        limit: 10,
        props: nobody(),
      });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(BadDataException);

    const named: Array<string> = (
      (refusal as BadDataException).message.match(
        /Sort by one of these fields: ([^.]*)\./,
      )![1] as string
    ).split(", ");

    const readable: Array<string> = [
      ...ColumnPermissions.getModelColumnsByPermissions(
        Project,
        ColumnPermissions.getColumnCheckRows(nobody()),
        DatabaseRequestType.Read,
      ).columns,
      ...ColumnPermissions.getExcludedColumnNames(),
    ];

    for (const column of named) {
      expect([column, readable.includes(column)]).toEqual([column, true]);
    }

    // Root would have been named every column; this caller is named fewer.
    const everyColumn: Array<string> = new Project()
      .getTableColumns()
      .columns.filter((column: string): boolean => {
        return !new Project().isEntityColumn(column);
      });

    expect(named.length).toBeLessThan(everyColumn.length);
    expect(repository.find).not.toHaveBeenCalled();
  });
});
