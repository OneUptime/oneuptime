import DatabaseRequestType from "../../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import OwnedScopePermission, {
  ColumnKeptToOwners,
} from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import AllModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import Runner from "../../../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { fastestRun, FastestRun } from "../../../../Helpers/FastestRun";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * THE COLUMNS KEPT TO THEIR OWNERS READ WHO MAY READ EACH COLUMN ONCE.
 *
 * getColumnsKeptToOwnersWithTeams runs three or four times on every read
 * and write a person makes of a kind with owners (the record rule, the sort
 * check, withholding the columns, the relation filters). It asked
 * getColumnAccessControlFor for every column, and that builds the model's
 * whole column-permission dictionary again each time - for a monitor, some
 * seventy columns times seventy entries: 2.5% of the App's CPU under
 * Dashboard load.
 * It now reads the dictionary once for the whole loop.
 *
 * Held here: for every model with owners and every shape of grant a member
 * or an API key holds - Owned, project-wide or label-limited, of each
 * permission a column reads, alone and together, with and without teams -
 * the answer is the one master's loop gave (copied below, verbatim but for
 * its name); the dictionary is built once per call, and no column is asked
 * for on its own; and it is many times faster for a monitor.
 */

// master's getColumnsKeptToOwnersWithTeams, verbatim but for its name.
function masterColumnsKeptToOwnersWithTeams(
  modelType: { new (): BaseModel },
  props: DatabaseCommonInteractionProps,
): Array<ColumnKeptToOwners> {
  if (
    props.isRoot ||
    props.isMasterAdmin ||
    !OwnedScopePermission.hasOwners(modelType)
  ) {
    return [];
  }

  const model: BaseModel = new modelType();
  const changePermissions: Array<Permission> = model.getUpdatePermissions();

  const readTeamIds: Array<ObjectID> | null =
    OwnedScopePermission.isLimitedToOwnedRecords(
      modelType,
      props,
      DatabaseRequestType.Read,
    )
      ? OwnedScopePermission.getOwningTeamIds(
          modelType,
          props,
          DatabaseRequestType.Read,
        )
      : null;

  const userPermissions: Array<UserPermission> =
    DatabaseCommonInteractionPropsUtil.getUserPermissions(
      props,
      PermissionType.Allow,
    );

  const kept: Array<ColumnKeptToOwners> = [];

  for (const column of model.getTableColumns().columns) {
    const readPermissions: Array<Permission> =
      model.getColumnAccessControlFor(column)?.read || [];

    if (
      readPermissions.length === 0 ||
      !readPermissions.every((permission: Permission): boolean => {
        return changePermissions.includes(permission);
      })
    ) {
      continue;
    }

    const grantingRows: Array<UserPermission> = userPermissions.filter(
      (row: UserPermission): boolean => {
        return readPermissions.includes(row.permission);
      },
    );

    if (
      grantingRows.length === 0 ||
      !grantingRows.every((row: UserPermission): boolean => {
        return (
          PermissionHelper.isScopeApplicable(row.permission) &&
          row.scope === PermissionScope.Owned
        );
      })
    ) {
      continue;
    }

    const teamIds: Array<ObjectID> =
      OwnedScopePermission.getTeamIdsOfRows(grantingRows);

    if (
      readTeamIds &&
      OwnedScopePermission.isTeamListWithin(readTeamIds, teamIds)
    ) {
      continue;
    }

    kept.push({ column: column, teamIds: teamIds });
  }

  return kept;
}

type ModelType = { new (): BaseModel; name: string };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const PROJECT_ID: ObjectID = new ObjectID(
  "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f",
);
const USER_ID: ObjectID = new ObjectID("8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a");
const TEAM_ID: ObjectID = new ObjectID("9e0f1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b");
const OTHER_TEAM_ID: ObjectID = new ObjectID(
  "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e",
);
const LABEL_ID: ObjectID = new ObjectID("0f1a2b3c-4d5e-4f6a-9b7c-8d9e0f1a2b3c");

function row(
  permission: Permission,
  scope: PermissionScope,
  data?: { labelIds?: Array<ObjectID>; teamId?: ObjectID },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: false,
    scope: scope,
    ...(data?.teamId ? { teamId: data.teamId } : {}),
  } as UserPermission;
}

function memberWith(
  rows: Array<UserPermission>,
  teamIds: Array<ObjectID> = [TEAM_ID],
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTeamIds: teamIds,
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

function apiKeyWith(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = memberWith(rows);

  delete props.userId;
  delete props.userType;
  delete props.userTeamIds;

  return props;
}

// Every permission a column of the model reads or changes, and its own.
function permissionsOf(modelType: ModelType): Array<Permission> {
  const model: BaseModel = new modelType();
  const permissions: Set<Permission> = new Set(model.getUpdatePermissions());

  for (const accessControl of Object.values(
    model.getColumnAccessControlForAllColumns(),
  )) {
    for (const permission of accessControl?.read || []) {
      permissions.add(permission);
    }
  }

  return Array.from(permissions);
}

// The grant shapes asked for each model.
function grantShapes(
  modelType: ModelType,
): Array<{ name: string; props: DatabaseCommonInteractionProps }> {
  const permissions: Array<Permission> = permissionsOf(modelType);
  const shapes: Array<{ name: string; props: DatabaseCommonInteractionProps }> =
    [
      { name: "root", props: { isRoot: true } },
      { name: "master admin", props: { isMasterAdmin: true } },
      { name: "no grants", props: memberWith([]) },
    ];

  for (const permission of permissions) {
    shapes.push(
      {
        name: `${permission} Owned`,
        props: memberWith([row(permission, PermissionScope.Owned)]),
      },
      {
        name: `${permission} Owned for a team`,
        props: memberWith([
          row(permission, PermissionScope.Owned, { teamId: TEAM_ID }),
        ]),
      },
      {
        name: `${permission} project-wide`,
        props: memberWith([row(permission, PermissionScope.All)]),
      },
      {
        name: `${permission} on a label`,
        props: memberWith([
          row(permission, PermissionScope.Labels, { labelIds: [LABEL_ID] }),
        ]),
      },
      {
        name: `${permission} Owned by an API key`,
        props: apiKeyWith([row(permission, PermissionScope.Owned)]),
      },
    );
  }

  shapes.push(
    {
      name: "every permission Owned",
      props: memberWith(
        permissions.map((permission: Permission): UserPermission => {
          return row(permission, PermissionScope.Owned);
        }),
      ),
    },
    {
      name: "every permission Owned, on two teams",
      props: memberWith(
        permissions.map(
          (permission: Permission, index: number): UserPermission => {
            return row(permission, PermissionScope.Owned, {
              teamId: index % 2 === 0 ? TEAM_ID : OTHER_TEAM_ID,
            });
          },
        ),
        [TEAM_ID, OTHER_TEAM_ID],
      ),
    },
    {
      name: "every permission Owned beside one project-wide",
      props: memberWith([
        ...permissions.map((permission: Permission): UserPermission => {
          return row(permission, PermissionScope.Owned);
        }),
        row(permissions[0]!, PermissionScope.All),
      ]),
    },
  );

  return shapes;
}

describe("OwnedScopePermission.getColumnsKeptToOwnersWithTeams", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("answers every model with owners, for every grant shape, as master's loop did", () => {
    const withOwners: Array<ModelType> = MODEL_TYPES.filter(
      (modelType: ModelType): boolean => {
        return OwnedScopePermission.hasOwners(modelType);
      },
    );

    // The kinds the Owned scope narrows: operational resources and more.
    expect(withOwners.length).toBeGreaterThan(20);

    let asked: number = 0;
    let keptSomewhere: number = 0;
    const differing: Array<string> = [];

    for (const modelType of withOwners) {
      for (const shape of grantShapes(modelType)) {
        const expected: Array<ColumnKeptToOwners> =
          masterColumnsKeptToOwnersWithTeams(modelType, shape.props);
        const actual: Array<ColumnKeptToOwners> =
          OwnedScopePermission.getColumnsKeptToOwnersWithTeams(
            modelType,
            shape.props,
          );

        asked++;

        if (expected.length > 0) {
          keptSomewhere++;
        }

        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          differing.push(`${modelType.name}: ${shape.name}`);
        }
      }
    }

    expect(differing).toEqual([]);
    expect(asked).toBeGreaterThan(500);
    // Columns are kept to owners for some of these (a Runner's key, ...).
    expect(keptSomewhere).toBeGreaterThan(0);
    /*
     * About 4 seconds alone and 22 beside fifteen other suites here: three
     * minutes leaves a slow runner's busy shard room under it.
     */
  }, 180000);

  test("a Runner's key is still kept to its owners on an Owned grant", () => {
    expect(new Runner().getColumnAccessControlFor("key")?.read).toContain(
      Permission.RunbookAdmin,
    );

    const kept: Array<ColumnKeptToOwners> =
      OwnedScopePermission.getColumnsKeptToOwnersWithTeams(
        Runner,
        memberWith([row(Permission.RunbookAdmin, PermissionScope.Owned)]),
      );

    expect(
      kept.map((entry: ColumnKeptToOwners): string => {
        return entry.column;
      }),
    ).toContain("key");
  });

  test("builds the column-permission dictionary once a call, and asks no column on its own", () => {
    const props: DatabaseCommonInteractionProps = memberWith(
      permissionsOf(Monitor as unknown as ModelType).map(
        (permission: Permission): UserPermission => {
          return row(permission, PermissionScope.Owned);
        },
      ),
    );

    const allColumns: ReturnType<typeof jest.spyOn> = jest.spyOn(
      BaseModel.prototype,
      "getColumnAccessControlForAllColumns",
    );
    const oneColumn: ReturnType<typeof jest.spyOn> = jest.spyOn(
      BaseModel.prototype,
      "getColumnAccessControlFor",
    );

    OwnedScopePermission.getColumnsKeptToOwnersWithTeams(Monitor, props);

    // Monitor has dozens of columns; master asked for each.
    expect(new Monitor().getTableColumns().columns.length).toBeGreaterThan(50);
    expect(allColumns).toHaveBeenCalledTimes(1);
    expect(oneColumn).not.toHaveBeenCalled();
  });

  test("is many times faster for a monitor than master's loop", () => {
    const props: DatabaseCommonInteractionProps = memberWith(
      permissionsOf(Monitor as unknown as ModelType).map(
        (permission: Permission): UserPermission => {
          return row(permission, PermissionScope.Owned);
        },
      ),
    );
    const calls: number = 30;

    const before: FastestRun<number> = fastestRun({
      run: (): number => {
        let kept: number = 0;

        for (let index: number = 0; index < calls; index++) {
          kept += masterColumnsKeptToOwnersWithTeams(Monitor, props).length;
        }

        return kept;
      },
      limitInMs: 0,
    });

    const after: FastestRun<number> = fastestRun({
      run: (): number => {
        let kept: number = 0;

        for (let index: number = 0; index < calls; index++) {
          kept += OwnedScopePermission.getColumnsKeptToOwnersWithTeams(
            Monitor,
            props,
          ).length;
        }

        return kept;
      },
      limitInMs: 0,
    });

    expect(after.result).toBe(before.result);
    // Measured about 40 times faster; five leaves room for a busy runner.
    expect(after.inMs * 5).toBeLessThan(before.inMs);
  });
});
