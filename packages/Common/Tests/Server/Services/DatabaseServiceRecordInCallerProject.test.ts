import DatabaseService from "../../../Server/Services/DatabaseService";
import MonitorService from "../../../Server/Services/MonitorService";
import Query from "../../../Server/Types/Database/Query";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { withLabelJoinTables } from "../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A CHECK OF ONE RECORD BY ID - an update's or a delete's team block list,
 * its grants limited to labels, a custom route's "may this caller edit it"
 * - reads the record as root with every one of its labels, and so reads it
 * in the project the caller acts in only (DatabaseService
 * .getCallerProjectRowQuery). Another project's record is answered like a
 * missing one: its labels are never weighed, nor named in a refusal.
 */

type CallerProjectRowQuery = (
  id: ObjectID,
  props: DatabaseCommonInteractionProps,
) => Query<Monitor> | null;

const PROJECT_ID: ObjectID = ObjectID.generate();
const SECOND_PROJECT_ID: ObjectID = ObjectID.generate();
const RECORD_ID: ObjectID = ObjectID.generate();
const LABEL_ID: ObjectID = ObjectID.generate();

const rowsOf: (permissions: Array<UserPermission>) => Record<
  string,
  {
    _type: "UserTenantAccessPermission";
    projectId: ObjectID;
    permissions: Array<UserPermission>;
  }
> = (permissions: Array<UserPermission>) => {
  return {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: permissions,
    },
  };
};

const member: (
  permissions: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID, SECOND_PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: rowsOf(permissions),
  };
};

const grant: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [],
    isBlockPermission: false,
  };
};

const labelledBlock: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: [LABEL_ID],
    isBlockPermission: true,
  };
};

const rowQueryOf: <TModel extends Monitor | Project | User>(
  service: DatabaseService<TModel>,
) => CallerProjectRowQuery = <TModel extends Monitor | Project | User>(
  service: DatabaseService<TModel>,
): CallerProjectRowQuery => {
  return (
    service as unknown as { getCallerProjectRowQuery: CallerProjectRowQuery }
  ).getCallerProjectRowQuery.bind(service);
};

describe("the query a check by id reads its record with", () => {
  const monitors: CallerProjectRowQuery = rowQueryOf(
    new DatabaseService(Monitor),
  );

  test("names the record in the project the caller acts in", () => {
    expect(monitors(RECORD_ID, member([]))).toEqual({
      _id: RECORD_ID.toString(),
      projectId: PROJECT_ID.toString(),
    });
  });

  test("names it in any of the caller's projects for a request across them", () => {
    const query: Query<Monitor> | null = monitors(RECORD_ID, {
      ...member([]),
      isMultiTenantRequest: true,
    });

    expect(query?._id).toBe(RECORD_ID.toString());
    expect(JSON.stringify(query?.projectId)).toContain(PROJECT_ID.toString());
    expect(JSON.stringify(query?.projectId)).toContain(
      SECOND_PROJECT_ID.toString(),
    );
  });

  test("names nothing for a caller who acts in no project", () => {
    expect(
      monitors(RECORD_ID, {
        userId: ObjectID.generate(),
        userType: UserType.User,
      }),
    ).toBeNull();
  });

  test.each([
    ["a root caller", { isRoot: true }],
    ["a master admin", { isMasterAdmin: true }],
  ] as Array<[string, DatabaseCommonInteractionProps]>)(
    "names the record wherever it is for %s",
    (_label: string, props: DatabaseCommonInteractionProps) => {
      expect(monitors(RECORD_ID, props)).toEqual({
        _id: RECORD_ID.toString(),
      });
    },
  );

  test("a project is one of the caller's projects, or nothing", () => {
    const projects: CallerProjectRowQuery = rowQueryOf(
      new DatabaseService(Project),
    );

    expect(projects(PROJECT_ID, member([]))).toEqual({
      _id: PROJECT_ID.toString(),
    });
    expect(projects(ObjectID.generate(), member([]))).toBeNull();
  });

  test("a table with no project column names the record by its id", () => {
    expect(
      rowQueryOf(new DatabaseService(User))(RECORD_ID, member([])),
    ).toEqual({ _id: RECORD_ID.toString() });
  });
});

describe("an update and a delete by id read the record in the caller's project", () => {
  let lookups: Array<{
    query: Record<string, unknown>;
    select: Record<string, unknown>;
  }>;

  beforeEach(() => {
    withLabelJoinTables();
    lookups = [];

    jest.spyOn(MonitorService, "findOneBy").mockImplementation((async (args: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<null> => {
      lookups.push(args);
      // Another project's record: nothing in the caller's project.
      return null;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    [
      "an update",
      (props: DatabaseCommonInteractionProps): Promise<unknown> => {
        return MonitorService.updateOneById({
          id: RECORD_ID,
          data: { name: "Changed" } as never,
          props: props,
        });
      },
      Permission.EditProjectMonitor,
    ],
    [
      "a delete",
      (props: DatabaseCommonInteractionProps): Promise<unknown> => {
        return MonitorService.deleteOneById({ id: RECORD_ID, props: props });
      },
      Permission.DeleteProjectMonitor,
    ],
  ] as Array<
    [
      string,
      (props: DatabaseCommonInteractionProps) => Promise<unknown>,
      Permission,
    ]
  >)(
    "%s under a block with labels is answered like a missing record",
    async (
      _label: string,
      write: (props: DatabaseCommonInteractionProps) => Promise<unknown>,
      blockedPermission: Permission,
    ) => {
      const error: unknown = await write(
        member([
          grant(Permission.ProjectMember),
          labelledBlock(blockedPermission),
        ]),
      ).catch((caught: unknown) => {
        return caught;
      });

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toBe("Monitor not found.");

      const labelsRead: { query: Record<string, unknown> } | undefined =
        lookups.find((lookup: { select: Record<string, unknown> }): boolean => {
          return Boolean(lookup.select["labels"]);
        });

      expect(labelsRead?.query["_id"]).toBe(RECORD_ID.toString());
      expect(labelsRead?.query["projectId"]).toBe(PROJECT_ID.toString());
    },
  );
});
