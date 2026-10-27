import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import BasePermission from "../../../../../Server/Types/Database/Permissions/BasePermission";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import Query from "../../../../../Server/Types/Database/Query";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../../../Types/Dictionary";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { meetsCondition } from "../../../TestingUtils/QueryConditions";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * A COLUMN ONLY EDITORS READ IS READ ONLY WHERE ITS EDITOR'S GRANT REACHES.
 *
 * A monitor's secret keys are read by those who may change the monitor
 * alone: whoever holds one forges the monitor's heartbeats. The column was
 * checked against the whole table, though, so a grant to change monitors
 * that reaches fewer of them than the read does let its holder read the
 * keys of every monitor they read:
 *
 *   - a Viewer over the whole project beside a Monitor Admin scoped to
 *     Owned - "everyone sees everything, each team manages its own", the
 *     docs' own example - read every team's monitors' keys. The keys are now
 *     read only on the monitors the member or the team of their Monitor
 *     Admin owns (OwnedScopePermission.getColumnsKeptToOwners), and left out
 *     of every other monitor read;
 *   - a read limited to one label beside a change limited to another read
 *     the second label's monitors whole, by selecting a key: a column's
 *     labels were added to the read's. Each is a condition of its own now
 *     (AccessControlPermission.getAccessControlIdListsForQuery).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "ff000000-0000-4000-8000-000000000001",
);
const MEMBER_ID: ObjectID = new ObjectID(
  "ff000000-0000-4000-8000-000000000002",
);
const EDITORS: ObjectID = new ObjectID("ff000000-0000-4000-8000-000000000003");
const OTHERS: ObjectID = new ObjectID("ff000000-0000-4000-8000-000000000004");

const LABEL_READ: ObjectID = new ObjectID(
  "ff000000-0000-4000-8000-000000000005",
);
const LABEL_CHANGE: ObjectID = new ObjectID(
  "ff000000-0000-4000-8000-000000000006",
);

const EDITORS_MONITOR: string = "ff000000-0000-4000-8000-0000000000a1";
const OTHERS_MONITOR: string = "ff000000-0000-4000-8000-0000000000a2";

const SECRET_COLUMNS: Array<string> = [
  "serverMonitorSecretKey",
  "incomingRequestSecretKey",
];

function row(
  permission: Permission,
  data: {
    scope: PermissionScope;
    teamId?: ObjectID;
    labelIds?: Array<ObjectID>;
  },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: false,
    scope: data.scope,
    ...(data.teamId ? { teamId: data.teamId } : {}),
  };
}

function memberWith(rows: Array<UserPermission>): DatabaseCommonInteractionProps {
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
  } as DatabaseCommonInteractionProps;
}

// Everyone reads every monitor; the editors change the ones they own.
const VIEWER_AND_OWNED_ADMIN: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All, teamId: OTHERS }),
  row(Permission.MonitorAdmin, {
    scope: PermissionScope.Owned,
    teamId: EDITORS,
  }),
];

let lookups: Array<Array<string>> = [];

beforeEach(() => {
  lookups = [];
  withLabelJoinTables();

  jest
    .spyOn(OwnedScopePermission as never, "getAllowedResourceIds")
    .mockImplementation((async (
      _modelType: { new (): BaseModel },
      _props: DatabaseCommonInteractionProps,
      teamIds: ReadonlyArray<ObjectID>,
    ): Promise<Array<ObjectID>> => {
      const teams: Array<string> = teamIds.map((teamId: ObjectID): string => {
        return teamId.toString();
      });

      lookups.push([...teams].sort());

      return teams.includes(EDITORS.toString())
        ? [new ObjectID(EDITORS_MONITOR)]
        : [];
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a monitor's secret keys, beside a Viewer over the whole project", () => {
  test("are kept to the monitors of the team that may change them", () => {
    expect(
      OwnedScopePermission.getColumnsKeptToOwnersWithTeams(
        Monitor,
        memberWith(VIEWER_AND_OWNED_ADMIN),
      )
        .filter((kept: { column: string }): boolean => {
          return SECRET_COLUMNS.includes(kept.column);
        })
        .map((kept: { column: string; teamIds: Array<ObjectID> }) => {
          return [
            kept.column,
            kept.teamIds.map((teamId: ObjectID): string => {
              return teamId.toString();
            }),
          ];
        })
        .sort(),
    ).toEqual(
      SECRET_COLUMNS.map((column: string) => {
        return [column, [EDITORS.toString()]];
      }).sort(),
    );
  });

  test("are left out of every monitor read but the team's own", async () => {
    const monitors: Array<Monitor> = [EDITORS_MONITOR, OTHERS_MONITOR].map(
      (id: string): Monitor => {
        const monitor: Monitor = new Monitor();
        monitor._id = id;
        monitor.serverMonitorSecretKey = new ObjectID(
          "ff000000-0000-4000-8000-0000000000b1",
        );
        return monitor;
      },
    );

    await OwnedScopePermission.withholdColumnsKeptToOwners({
      modelType: Monitor,
      rows: monitors,
      select: { _id: true, serverMonitorSecretKey: true },
      props: memberWith(VIEWER_AND_OWNED_ADMIN),
    });

    expect(
      monitors.map((monitor: Monitor): [string, boolean] => {
        return [monitor._id!.toString(), Boolean(monitor.serverMonitorSecretKey)];
      }),
    ).toEqual([
      [EDITORS_MONITOR, true],
      [OTHERS_MONITOR, false],
    ]);

    // One lookup, of the editors' monitors alone.
    expect(lookups).toEqual([[EDITORS.toString()]]);
  });

  test("a filter on a key reaches only the team's own monitors", async () => {
    const query: Dictionary<unknown> = (await BasePermission.addRecordScopeToQuery(
      Monitor,
      { serverMonitorSecretKey: "a guess" } as Query<Monitor>,
      null,
      memberWith(VIEWER_AND_OWNED_ADMIN),
      DatabaseRequestType.Read,
    )) as Dictionary<unknown>;

    expect(meetsCondition(query["_id"], EDITORS_MONITOR)).toBe(true);
    expect(meetsCondition(query["_id"], OTHERS_MONITOR)).toBe(false);
  });

  test("a read of monitors that names no key is left as it was", async () => {
    const query: Dictionary<unknown> = (await BasePermission.addRecordScopeToQuery(
      Monitor,
      {},
      null,
      memberWith(VIEWER_AND_OWNED_ADMIN),
      DatabaseRequestType.Read,
    )) as Dictionary<unknown>;

    expect(query["_id"]).toBeUndefined();
    expect(lookups).toEqual([]);
  });

  test("nothing is kept apart from a Monitor Admin over the whole project", () => {
    expect(
      OwnedScopePermission.getColumnsKeptToOwners(
        Monitor,
        memberWith([
          row(Permission.MonitorAdmin, { scope: PermissionScope.All }),
        ]),
      ),
    ).toEqual([]);
  });

  test("nothing is kept apart where the read keeps to the team's monitors already", () => {
    expect(
      OwnedScopePermission.getColumnsKeptToOwners(
        Monitor,
        memberWith([
          row(Permission.MonitorAdmin, {
            scope: PermissionScope.Owned,
            teamId: EDITORS,
          }),
        ]),
      ),
    ).toEqual([]);
  });
});

describe("a column's labels narrow a read, never widen it", () => {
  // The label ids of an `_id` or `labels` condition, as the query holds them.
  function labelsOf(query: Dictionary<unknown>): Array<string> {
    const labels: Array<string> = (
      (query["labels"] as Array<ObjectID> | undefined) || []
    ).map((labelId: ObjectID): string => {
      return labelId.toString();
    });

    const idCondition: unknown = query["_id"];
    const bound: Array<string> =
      idCondition instanceof FindOperator
        ? Object.values(
            (
              idCondition as unknown as {
                objectLiteralParameters?: Record<string, unknown>;
              }
            ).objectLiteralParameters || {},
          )
            .flat()
            .map(String)
        : [];

    return [...labels, ...bound].sort();
  }

  test("a read limited to one label and a change limited to another read neither label's monitors alone", async () => {
    const query: Dictionary<unknown> = (await BasePermission.addRecordScopeToQuery(
      Monitor,
      {},
      { _id: true, serverMonitorSecretKey: true },
      memberWith([
        row(Permission.ReadProjectMonitor, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_READ],
        }),
        row(Permission.EditProjectMonitor, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_CHANGE],
        }),
      ]),
      DatabaseRequestType.Read,
    )) as Dictionary<unknown>;

    // Two conditions, one per list: a monitor carries one label of each.
    expect(
      ((query["labels"] as Array<ObjectID>) || []).map(
        (labelId: ObjectID): string => {
          return labelId.toString();
        },
      ),
    ).toEqual([LABEL_READ.toString()]);
    expect(labelsOf(query)).toEqual(
      [LABEL_READ.toString(), LABEL_CHANGE.toString()].sort(),
    );
  });

  test("a read that selects no key keeps to the read's labels alone", async () => {
    const query: Dictionary<unknown> = (await BasePermission.addRecordScopeToQuery(
      Monitor,
      {},
      { _id: true, name: true },
      memberWith([
        row(Permission.ReadProjectMonitor, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_READ],
        }),
        row(Permission.EditProjectMonitor, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL_CHANGE],
        }),
      ]),
      DatabaseRequestType.Read,
    )) as Dictionary<unknown>;

    expect(labelsOf(query)).toEqual([LABEL_READ.toString()]);
  });
});
