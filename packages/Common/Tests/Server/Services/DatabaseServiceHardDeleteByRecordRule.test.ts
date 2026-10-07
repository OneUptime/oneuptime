import DatabaseService from "../../../Server/Services/DatabaseService";
import Query from "../../../Server/Types/Database/Query";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
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
 * A HARD DELETE BY A CALLER UNDER THE RECORD RULE finds its rows with the
 * query the rule narrows - the labels of the incident a note is read
 * through, the labels of the records a note names - and then deletes the
 * rows it found. Its DELETE names them by id, with the query's filters on
 * the table's own columns: a filter on a relation (the incident) is the
 * lookup's, which a DELETE statement cannot join.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const NOTE_ID: ObjectID = ObjectID.generate();
const LABEL_ID: ObjectID = ObjectID.generate();

const row: (
  permission: Permission,
  data?: { labelIds?: Array<ObjectID>; isBlock?: boolean },
) => UserPermission = (
  permission: Permission,
  data?: { labelIds?: Array<ObjectID>; isBlock?: boolean },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: Boolean(data?.isBlock),
    ...(data?.labelIds && !data.isBlock
      ? { scope: PermissionScope.Labels }
      : {}),
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
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions,
      },
    },
  };
};

describe("DatabaseService.hardDeleteBy under the record rule", () => {
  let service: DatabaseService<IncidentInternalNote>;
  let lookups: Array<Query<IncidentInternalNote>>;
  let deletes: Array<Record<string, unknown>>;

  beforeEach(() => {
    withLabelJoinTables();

    service = new DatabaseService<IncidentInternalNote>(IncidentInternalNote);
    lookups = [];
    deletes = [];

    const note: IncidentInternalNote = new IncidentInternalNote();
    note.id = NOTE_ID;
    note.projectId = PROJECT_ID;

    // The rows the narrowed lookup finds: this one note.
    jest.spyOn(service as never, "_findBy").mockImplementation((async (args: {
      query: Query<IncidentInternalNote>;
    }): Promise<Array<IncidentInternalNote>> => {
      lookups.push(args.query);
      return [note];
    }) as never);

    jest
      .spyOn(service as never, "readRowsShowingImages")
      .mockResolvedValue([note] as never);
    jest
      .spyOn(service as never, "readRowsDeletedWith")
      .mockResolvedValue([] as never);

    jest.spyOn(service, "getRepository").mockReturnValue({
      delete: async (
        criteria: Record<string, unknown>,
      ): Promise<{ affected: number }> => {
        deletes.push(criteria);
        return { affected: 1 };
      },
    } as never);

    jest
      .spyOn(PublishedImages, "afterDelete")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(StatusPageOverviewCache, "afterDelete")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("deletes the rows it found by id, with the query's own columns and no filter on a relation", async () => {
    const deleted: number = await service.hardDeleteBy({
      query: { incidentId: INCIDENT_ID } as Query<IncidentInternalNote>,
      limit: 10,
      skip: 0,
      props: member([
        row(Permission.ReadProjectIncident, { labelIds: [LABEL_ID] }),
        row(Permission.DeleteIncidentInternalNote),
      ]),
    });

    expect(deleted).toBe(1);

    // The lookup kept to the incidents the caller may read...
    expect(lookups).toHaveLength(1);
    expect(
      JSON.stringify((lookups[0] as Record<string, unknown>)["incident"]),
    ).toContain(LABEL_ID.toString());

    // ...and the DELETE names the note it found, in the caller's project.
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!["incident"]).toBeUndefined();
    expect(JSON.stringify(deletes[0]!["_id"])).toContain(NOTE_ID.toString());
    expect(String(deletes[0]!["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(deletes[0]!["incidentId"])).toBe(INCIDENT_ID.toString());
  });

  test("a block with labels narrows the lookup, and the DELETE still names the rows found", async () => {
    await service.hardDeleteBy({
      query: {},
      limit: 10,
      skip: 0,
      props: member([
        row(Permission.IncidentMember),
        row(Permission.DeleteIncidentInternalNote, {
          isBlock: true,
          labelIds: [LABEL_ID],
        }),
      ]),
    });

    // The block is on the key naming the incident, in the lookup...
    expect(
      JSON.stringify((lookups[0] as Record<string, unknown>)["incidentId"]),
    ).toContain(LABEL_ID.toString());

    // ...and the DELETE is pinned to the note found under it.
    expect(deletes).toHaveLength(1);
    expect(JSON.stringify(deletes[0]!["_id"])).toContain(NOTE_ID.toString());
  });
});
