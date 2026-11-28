import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import OwnedScopePermission, {
  TableOwnedThrough,
} from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import TablePermission from "../../../../../Server/Types/Database/Permissions/TablePermission";
import MonitorOwnerTeamService from "../../../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../../../Server/Services/MonitorOwnerUserService";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorOwnerUser from "../../../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "../../../../../Models/DatabaseModels/MonitorProbe";
import Runner from "../../../../../Models/DatabaseModels/Runner";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import { RecordOwners } from "../../../../../Types/LabelAccess/LabelAccess";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHO OWNS THE RECORDS A PAGE SHOWS, BY THE OWNED SCOPE'S OWN LOOKUPS
 * (#11436): getOwnersOf (the answer of POST /<record>/record-ownership),
 * the teams it may name (getTeamIdsOfOwnedRows), the tables whose rows a
 * kind's owners decide (getTablesOwnedThrough) - and the scope's own
 * reading of which rows grant only on owned records, now the shared rule's
 * (LabelAccess.getOwnedOnlyRows), held here to the reading it replaced.
 */

const PROJECT_ID: ObjectID = new ObjectID("11436000-0000-4000-8000-000000000001");
const MEMBER_ID: ObjectID = new ObjectID("11436000-0000-4000-8000-000000000002");
const TEAM_A: ObjectID = new ObjectID("11436000-0000-4000-8000-0000000000b1");
const TEAM_B: ObjectID = new ObjectID("11436000-0000-4000-8000-0000000000b2");
const LABEL_X: ObjectID = new ObjectID("11436000-0000-4000-8000-0000000000a1");

const MONITOR_A: string = "11436000-0000-4000-8000-0000000000c1";
const MONITOR_B: string = "11436000-0000-4000-8000-0000000000c2";
const MONITOR_C: string = "11436000-0000-4000-8000-0000000000c3";

function row(
  permission: Permission,
  data: { scope?: PermissionScope; labelIds?: Array<ObjectID>; teamId?: ObjectID },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: false,
    ...(data.scope ? { scope: data.scope } : {}),
    ...(data.teamId ? { teamId: data.teamId } : {}),
  };
}

function memberWith(
  rows: Array<UserPermission>,
  overrides?: Partial<DatabaseCommonInteractionProps>,
): DatabaseCommonInteractionProps {
  return {
    userId: MEMBER_ID,
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
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
    ...(overrides || {}),
  } as DatabaseCommonInteractionProps;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getOwnersOf: who owns each record asked about", () => {
  test("by the kind's owner tables, kept to the records and the project, the caller's own and the grants' teams'", async () => {
    const userFind: jest.SpiedFunction<typeof MonitorOwnerUserService.findBy> =
      jest.spyOn(MonitorOwnerUserService, "findBy").mockResolvedValue([
        { monitorId: new ObjectID(MONITOR_A) } as never,
      ]);
    const teamFind: jest.SpiedFunction<typeof MonitorOwnerTeamService.findBy> =
      jest.spyOn(MonitorOwnerTeamService, "findBy").mockResolvedValue([
        { monitorId: new ObjectID(MONITOR_B), teamId: TEAM_A } as never,
        { monitorId: new ObjectID(MONITOR_B), teamId: TEAM_B } as never,
        { monitorId: new ObjectID(MONITOR_B), teamId: TEAM_A } as never,
      ]);

    const owners: Map<string, RecordOwners> = await OwnedScopePermission.getOwnersOf(
      {
        modelType: Monitor,
        props: memberWith([]),
        teamIds: [TEAM_A, TEAM_B],
        resourceIds: [MONITOR_A, MONITOR_B.toUpperCase(), MONITOR_C, "nope"],
      },
    );

    expect(Object.fromEntries(owners)).toEqual({
      [MONITOR_A]: { isOwnedByCaller: true, teamIds: [] },
      [MONITOR_B]: {
        isOwnedByCaller: false,
        teamIds: [TEAM_A.toString(), TEAM_B.toString()],
      },
      [MONITOR_C]: { isOwnedByCaller: false, teamIds: [] },
    });

    // One read of each owner table, kept to the records asked about.
    expect(userFind).toHaveBeenCalledTimes(1);
    const userQuery: Record<string, unknown> = (
      userFind.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(userQuery["userId"]).toEqual(MEMBER_ID);
    expect(userQuery["projectId"]).toEqual(PROJECT_ID);
    expect(JSON.stringify(userQuery["monitorId"])).toContain(MONITOR_A);
    expect(JSON.stringify(userQuery["monitorId"])).not.toContain("nope");

    expect(teamFind).toHaveBeenCalledTimes(1);
    const teamCall: { query: Record<string, unknown>; select: unknown } =
      teamFind.mock.calls[0]![0] as never;
    expect(JSON.stringify(teamCall.query["teamId"])).toContain(TEAM_A.toString());
    expect(teamCall.select).toEqual({ monitorId: true, teamId: true });
  });

  test("no team to weigh: the teams' table is not read; no person: neither is the people's", async () => {
    const userFind: jest.SpiedFunction<typeof MonitorOwnerUserService.findBy> =
      jest.spyOn(MonitorOwnerUserService, "findBy").mockResolvedValue([]);
    const teamFind: jest.SpiedFunction<typeof MonitorOwnerTeamService.findBy> =
      jest.spyOn(MonitorOwnerTeamService, "findBy").mockResolvedValue([]);

    await OwnedScopePermission.getOwnersOf({
      modelType: Monitor,
      props: memberWith([], { userId: undefined }),
      teamIds: [],
      resourceIds: [MONITOR_A],
    });

    expect(userFind).not.toHaveBeenCalled();
    expect(teamFind).not.toHaveBeenCalled();
  });

  test("a kind with no owner tables, or no record asked about, reads nothing and answers nothing", async () => {
    const userFind: jest.SpiedFunction<typeof MonitorOwnerUserService.findBy> =
      jest.spyOn(MonitorOwnerUserService, "findBy").mockResolvedValue([]);

    expect(
      (
        await OwnedScopePermission.getOwnersOf({
          modelType: Label,
          props: memberWith([]),
          teamIds: [TEAM_A],
          resourceIds: [MONITOR_A],
        })
      ).size,
    ).toBe(0);
    expect(
      (
        await OwnedScopePermission.getOwnersOf({
          modelType: Monitor,
          props: memberWith([]),
          teamIds: [TEAM_A],
          resourceIds: [],
        })
      ).size,
    ).toBe(0);
    expect(userFind).not.toHaveBeenCalled();
  });

  test("the scope's own narrowing reads every owned record, as before: not kept to any", async () => {
    const userFind: jest.SpiedFunction<typeof MonitorOwnerUserService.findBy> =
      jest.spyOn(MonitorOwnerUserService, "findBy").mockResolvedValue([
        { monitorId: new ObjectID(MONITOR_A) } as never,
      ]);
    jest.spyOn(MonitorOwnerTeamService, "findBy").mockResolvedValue([]);

    const ids: Array<ObjectID> = await OwnedScopePermission.getOwnedIds(
      Monitor,
      memberWith([]),
      [TEAM_A],
    );

    expect(
      ids.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([MONITOR_A]);
    expect(
      (userFind.mock.calls[0]![0] as { query: Record<string, unknown> }).query[
        "monitorId"
      ],
    ).toBeUndefined();
  });
});

describe("getTeamIdsOfOwnedRows: the teams whose records the caller's Owned grants reach", () => {
  test("the teams of their rows scoped to Owned, each once - never their other teams", () => {
    expect(
      OwnedScopePermission.getTeamIdsOfOwnedRows(
        memberWith([
          row(Permission.Viewer, { scope: PermissionScope.All, teamId: TEAM_B }),
          row(Permission.MonitorAdmin, { scope: PermissionScope.Owned, teamId: TEAM_A }),
          row(Permission.MonitorMember, { scope: PermissionScope.Owned, teamId: TEAM_A }),
          row(Permission.ProjectMember, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL_X],
            teamId: TEAM_B,
          }),
        ]),
      ).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([TEAM_A.toString()]);
  });

  test("a role a scope does not apply to is no Owned grant; root and a master admin have none", () => {
    expect(
      OwnedScopePermission.getTeamIdsOfOwnedRows(
        memberWith([
          row(Permission.ProjectAdmin, { scope: PermissionScope.Owned, teamId: TEAM_A }),
        ]),
      ),
    ).toEqual([]);
    expect(OwnedScopePermission.getTeamIdsOfOwnedRows({ isRoot: true })).toEqual([]);
    expect(
      OwnedScopePermission.getTeamIdsOfOwnedRows({ isMasterAdmin: true } as never),
    ).toEqual([]);
  });
});

describe("getTablesOwnedThrough: the tables a kind's owners decide", () => {
  const tableOf: (
    tables: Array<TableOwnedThrough>,
    tableName: string,
  ) => TableOwnedThrough | undefined = (
    tables: Array<TableOwnedThrough>,
    tableName: string,
  ): TableOwnedThrough | undefined => {
    return tables.find((table: TableOwnedThrough): boolean => {
      return table.tableName === tableName;
    });
  };

  test("a monitor: its own reads, changes and deletes, its owner tables' writes, its parts' every operation", () => {
    const tables: Array<TableOwnedThrough> =
      OwnedScopePermission.getTablesOwnedThrough(Monitor);

    expect(tables[0]).toEqual({
      tableName: "Monitor",
      key: "_id",
      operations: [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ],
    });
    expect(tableOf(tables, "MonitorOwnerUser")).toEqual({
      tableName: "MonitorOwnerUser",
      key: "monitorId",
      operations: [
        DatabaseRequestType.Create,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ],
    });
    expect(tableOf(tables, "MonitorProbe")?.operations).toEqual([
      DatabaseRequestType.Create,
      DatabaseRequestType.Read,
      DatabaseRequestType.Update,
      DatabaseRequestType.Delete,
    ]);
    // A label is no part of any monitor.
    expect(tableOf(tables, "Label")).toBeUndefined();
  });

  test("a runner, whose reads the scope leaves alone: its changes and deletes only", () => {
    expect(OwnedScopePermission.getTablesOwnedThrough(Runner)[0]).toEqual({
      tableName: "Runner",
      key: "_id",
      operations: [DatabaseRequestType.Update, DatabaseRequestType.Delete],
    });
  });

  test("worked out once per kind", () => {
    expect(OwnedScopePermission.getTablesOwnedThrough(Monitor)).toBe(
      OwnedScopePermission.getTablesOwnedThrough(Monitor),
    );
  });

  test("an incident's owners decide its parts: its owner tables among them", () => {
    const tables: Array<TableOwnedThrough> =
      OwnedScopePermission.getTablesOwnedThrough(Incident);

    expect(tableOf(tables, "IncidentOwnerTeam")?.key).toBe("incidentId");
    expect(tableOf(tables, "IncidentInternalNote")?.key).toBe("incidentId");
  });
});

describe("the rows that grant only on owned records, by the shared rule - as the scope read them before", () => {
  // The reading the shared rule took over (OwnedScopePermission before #11436).
  const before: (
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ) => Array<UserPermission> | null = (
    modelType: { new (): BaseModel },
    props: DatabaseCommonInteractionProps,
    type: DatabaseRequestType,
  ): Array<UserPermission> | null => {
    if (
      type === DatabaseRequestType.Create ||
      !OwnedScopePermission.narrowsRecords(modelType, type)
    ) {
      return null;
    }

    const granting: Array<Permission> = TablePermission.getGrantingPermissions(
      modelType as never,
      type,
      props,
    );
    const applicable: Array<UserPermission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        props,
        PermissionType.Allow,
      ).filter((each: UserPermission): boolean => {
        return granting.includes(each.permission);
      });

    if (applicable.length === 0) {
      return null;
    }

    return applicable.some((each: UserPermission): boolean => {
      return (
        !PermissionHelper.isScopeApplicable(each.permission) ||
        each.scope !== PermissionScope.Owned
      );
    })
      ? null
      : applicable;
  };

  const ROW_SETS: Array<[string, Array<UserPermission>]> = [
    ["Monitor Admin of what A owns", [row(Permission.MonitorAdmin, { scope: PermissionScope.Owned, teamId: TEAM_A })]],
    [
      "beside a Viewer over the project",
      [
        row(Permission.Viewer, { scope: PermissionScope.All, teamId: TEAM_B }),
        row(Permission.MonitorAdmin, { scope: PermissionScope.Owned, teamId: TEAM_A }),
      ],
    ],
    [
      "beside a Project Member on a label",
      [
        row(Permission.ProjectMember, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_X],
          teamId: TEAM_B,
        }),
        row(Permission.MonitorAdmin, { scope: PermissionScope.Owned, teamId: TEAM_A }),
      ],
    ],
    [
      "two teams' Owned grants",
      [
        row(Permission.MonitorAdmin, { scope: PermissionScope.Owned, teamId: TEAM_A }),
        row(Permission.MonitorMember, { scope: PermissionScope.Owned, teamId: TEAM_B }),
      ],
    ],
    ["Project Admin stored as Owned", [row(Permission.ProjectAdmin, { scope: PermissionScope.Owned, teamId: TEAM_A })]],
    ["the wildcard scoped to Owned", [row(Permission.EditAllOperationalResources, { scope: PermissionScope.Owned, teamId: TEAM_A })]],
    ["a row with no scope", [row(Permission.MonitorAdmin, { teamId: TEAM_A })]],
    ["nothing at all", []],
  ];

  for (const [name, rows] of ROW_SETS) {
    for (const modelType of [Monitor, Runner, MonitorOwnerUser, MonitorProbe, Label]) {
      for (const type of [
        DatabaseRequestType.Read,
        DatabaseRequestType.Update,
        DatabaseRequestType.Delete,
      ]) {
        test(`${name}: ${new modelType().tableName} ${type}`, () => {
          const props: DatabaseCommonInteractionProps = memberWith(rows);
          const expected: Array<UserPermission> | null = before(
            modelType,
            props,
            type,
          );

          expect(
            OwnedScopePermission.isLimitedToOwnedRecords(modelType, props, type),
          ).toBe(expected !== null);
          expect(
            OwnedScopePermission.getOwningTeamIds(modelType, props, type).map(
              (id: ObjectID): string => {
                return id.toString();
              },
            ),
          ).toEqual(
            OwnedScopePermission.getTeamIdsOfRows(expected || []).map(
              (id: ObjectID): string => {
                return id.toString();
              },
            ),
          );
        });
      }
    }
  }
});
