import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  PERMISSION_TABLES,
  RECOUNT_ROLES_HOLDING_THEM,
  REMOVED_PERMISSIONS,
  RemovePermissionsTeamsCannotBeGiven1809178100000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809178100000-RemovePermissionsTeamsCannotBeGiven";
import { RECOUNT_ROLES_HOLDING_THEM as SERVICE_TELEMETRY_LINK_RECOUNT } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809176500000-RemoveServiceTelemetryLinkPermissions";
import APIKeyAccessPermission from "../../../../Server/Utils/APIKey/AccessPermission";
import UserPermissionUtil from "../../../../Server/Utils/UserPermission/UserPermission";
import WorkflowPrincipal from "../../../../Server/Utils/Workflow/WorkflowPrincipal";
import AccessTokenService from "../../../../Server/Services/AccessTokenService";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ApiKeyPermission from "../../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRole from "../../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../../Models/DatabaseModels/CustomRolePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  PermissionHelper,
  UserGlobalAccessPermission,
  UserPermission,
} from "../../../../Types/Permission";

/*
 * Every permission a team can't be given (#8281) leaves every team, API key
 * and custom role that holds one, and a custom role's permission count is
 * counted again without them first - as
 * RemoveServiceTelemetryLinkPermissions1809176500000 did for the four it
 * retired.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read
 * as text, so up() and down() are told apart and the parameters are seen.
 * RemovePermissionsTeamsCannotBeGivenPostgres runs them on real rows.
 *
 * Below them, why nobody loses access: what each removed permission lets a
 * team's member or a key do, they hold anyway, or may not hold at all.
 */

const MIGRATION_TIMESTAMP: string = "1809178100000";
const MIGRATION_BASE_NAME: string = "RemovePermissionsTeamsCannotBeGiven";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

// A migration's 13-digit timestamp, read off its class name.
const TIMESTAMP_OF_NAME: RegExp = /(\d{13})$/;

const THE_TEN: Array<string> = [
  "CurrentUser",
  "User",
  "Public",
  "AuthenticatedRequest",
  "UnAuthorizedSsoUser",
  "CustomerSupport",
  "CreateServiceTelemetryService",
  "DeleteServiceTelemetryService",
  "EditServiceTelemetryService",
  "ReadServiceTelemetryService",
];

interface Statement {
  sql: string;
  parameters?: Array<unknown> | undefined;
}

async function statementsOf(
  direction: "up" | "down",
): Promise<Array<Statement>> {
  const statements: Array<Statement> = [];
  const runner: QueryRunner = {
    query: async (sql: string, parameters?: Array<unknown>): Promise<void> => {
      statements.push(parameters ? { sql, parameters } : { sql });
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new RemovePermissionsTeamsCannotBeGiven1809178100000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("RemovePermissionsTeamsCannotBeGiven1809178100000", () => {
  test("counts the roles' permissions again, then deletes the ten from every table that grants them", async () => {
    expect(await statementsOf("up")).toEqual([
      { sql: RECOUNT_ROLES_HOLDING_THEM, parameters: [THE_TEN] },
      {
        sql: `DELETE FROM "TeamPermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [THE_TEN],
      },
      {
        sql: `DELETE FROM "ApiKeyPermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [THE_TEN],
      },
      {
        sql: `DELETE FROM "CustomRolePermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [THE_TEN],
      },
    ]);
  });

  test("removes the ten and nothing else: the permissions are passed as data, one condition each", async () => {
    expect(REMOVED_PERMISSIONS).toEqual(THE_TEN);

    const deletes: Array<Statement> = (await statementsOf("up")).filter(
      (statement: Statement): boolean => {
        return statement.sql.startsWith("DELETE");
      },
    );

    expect(deletes).toHaveLength(PERMISSION_TABLES.length);

    for (const statement of deletes) {
      expect(statement.sql).toMatch(
        /^DELETE FROM "\w+" WHERE "permission" = ANY\(\$1::text\[\]\)$/,
      );
      expect(statement.parameters).toEqual([THE_TEN]);
    }

    // No statement names a permission in its text, so none can name another.
    for (const statement of await statementsOf("up")) {
      for (const permission of Object.values(Permission) as Array<string>) {
        expect(statement.sql.includes(`'${permission}'`)).toBe(false);
      }
    }
  });

  test("the ten are permissions, each once, and none of them is offered to a team, a key or a role", () => {
    const values: Array<string> = Object.values(Permission) as Array<string>;

    expect(new Set<string>(REMOVED_PERMISSIONS).size).toBe(
      REMOVED_PERMISSIONS.length,
    );

    for (const permission of REMOVED_PERMISSIONS) {
      expect({ permission, value: values.includes(permission) }).toEqual({
        permission,
        value: true,
      });
      expect({
        permission,
        offered: PermissionHelper.isAssignableToTenant(permission),
      }).toEqual({ permission, offered: false });
    }
  });

  test("the recount is the role's own count, without the ten, and only of the roles that hold one", () => {
    // Counted as CustomRolePermissionService.recountPermissions counts it.
    expect(RECOUNT_ROLES_HOLDING_THEM).toMatch(/^UPDATE "CustomRole"\s+SET/);
    expect(RECOUNT_ROLES_HOLDING_THEM).toContain(
      `"CustomRolePermission"."customRoleId" = "CustomRole"."_id"`,
    );
    expect(RECOUNT_ROLES_HOLDING_THEM).toContain(
      `"CustomRolePermission"."projectId" = "CustomRole"."projectId"`,
    );
    expect(RECOUNT_ROLES_HOLDING_THEM).toContain(
      `"CustomRolePermission"."deletedAt" IS NULL`,
    );
    expect(RECOUNT_ROLES_HOLDING_THEM).toContain(
      `NOT ("CustomRolePermission"."permission" = ANY($1::text[]))`,
    );
    // Only the roles holding one: no other role's count is written.
    expect(RECOUNT_ROLES_HOLDING_THEM).toMatch(
      /WHERE "_id" IN \(\s*SELECT "customRoleId"\s+FROM "CustomRolePermission"\s+WHERE "permission" = ANY\(\$1::text\[\]\)\s*\)$/,
    );
    // The statement the Service Telemetry Link migration ran, written out again.
    expect(RECOUNT_ROLES_HOLDING_THEM).toBe(SERVICE_TELEMETRY_LINK_RECOUNT);
  });

  test("the recount runs before the deletes, while the rows that say which roles to count are there", async () => {
    const statements: Array<Statement> = await statementsOf("up");

    expect(statements[0]!.sql).toBe(RECOUNT_ROLES_HOLDING_THEM);
    expect(
      statements.slice(1).every((statement: Statement): boolean => {
        return statement.sql.startsWith("DELETE");
      }),
    ).toBe(true);
  });

  test("names the tables and columns the models keep them in", () => {
    const tables: Array<{ new (): BaseModel }> = [
      TeamPermission,
      ApiKeyPermission,
      CustomRolePermission,
    ];

    expect(
      tables.map((modelType: { new (): BaseModel }): string => {
        return new modelType().tableName || "";
      }),
    ).toEqual(PERMISSION_TABLES);

    for (const modelType of tables) {
      expect(new modelType().getTableColumns().columns).toContain("permission");
    }

    expect(new CustomRolePermission().getTableColumns().columns).toEqual(
      expect.arrayContaining([
        "customRoleId",
        "projectId",
        "permission",
        "deletedAt",
      ]),
    );

    const role: CustomRole = new CustomRole();
    expect(role.tableName).toBe("CustomRole");
    expect(role.getTableColumns().columns).toEqual(
      expect.arrayContaining(["_id", "projectId", "permissionCount"]),
    );
  });

  test("down puts nothing back: no team, key or role may hold them", async () => {
    expect(await statementsOf("down")).toEqual([]);
  });

  test("is registered, named for its class, and ordered after every migration before it", () => {
    const registered: Array<string> = (
      SchemaMigrations as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(registered).toContain(MIGRATION_CLASS_NAME);
    expect(new RemovePermissionsTeamsCannotBeGiven1809178100000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);

    const timestamps: Array<number> = registered.map((name: string): number => {
      const match: RegExpMatchArray | null = name.match(TIMESTAMP_OF_NAME);
      return match ? parseInt(match[1]!, 10) : 0;
    });
    const at: number = registered.indexOf(MIGRATION_CLASS_NAME);

    for (const earlier of timestamps.slice(0, at)) {
      expect(earlier).toBeLessThan(parseInt(MIGRATION_TIMESTAMP, 10));
    }

    // After the Service Telemetry Link one: the four go again if given since.
    expect(at).toBeGreaterThan(
      registered.indexOf("RemoveServiceTelemetryLinkPermissions1809176500000"),
    );
  });
});

/*
 * NOBODY LOSES ACCESS. A row of one of the ten gave its team's members, or
 * its key, only what OneUptime gives them anyway, or what nobody in a
 * project may hold:
 *
 *   - Public, User and Logged in User (CurrentUser) are in every signed-in
 *     person's and every key's global permissions; UnAuthorizedSsoUser and
 *     CurrentUser in every member's and every key's permissions in a
 *     project; AuthenticatedRequest in every key's and every workflow's,
 *     and every list that names it lets Logged in User in too;
 *   - Customer Support reaches only a person's own isDisabled and isBlocked
 *     (User), which only OneUptime may change;
 *   - the four Service Telemetry Link permissions reach nothing.
 */
type ModelType = { new (): BaseModel };

const MODELS: Array<BaseModel> = (AllModelTypes as Array<ModelType>).map(
  (modelType: ModelType): BaseModel => {
    return new modelType();
  },
);

const ANALYTICS_MODELS: Array<AnalyticsBaseModel> = (
  AnalyticsModels as Array<{ new (): AnalyticsBaseModel }>
).map((modelType: { new (): AnalyticsBaseModel }): AnalyticsBaseModel => {
  return new modelType();
});

// Every list of every model that names `permission`, as "Table.column: operation".
function listsNaming(
  permission: Permission,
): Array<{ where: string; list: Array<Permission> }> {
  const found: Array<{ where: string; list: Array<Permission> }> = [];

  for (const model of MODELS) {
    const lists: Dictionary<Array<Permission>> = {
      create: model.createRecordPermissions || [],
      read: model.readRecordPermissions || [],
      update: model.updateRecordPermissions || [],
      delete: model.deleteRecordPermissions || [],
    };

    for (const operation of Object.keys(lists)) {
      if (lists[operation]!.includes(permission)) {
        found.push({
          where: `${model.tableName}: ${operation}`,
          list: lists[operation]!,
        });
      }
    }

    for (const column of model.getTableColumns().columns) {
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      for (const operation of ["create", "read", "update"] as const) {
        const list: Array<Permission> = accessControl?.[operation] || [];

        if (list.includes(permission)) {
          found.push({
            where: `${model.tableName}.${column}: ${operation}`,
            list,
          });
        }
      }
    }
  }

  for (const model of ANALYTICS_MODELS) {
    const tableLists: Dictionary<Array<Permission>> = {
      create: model.getCreatePermissions(),
      read: model.getReadPermissions(),
      update: model.getUpdatePermissions(),
      delete: model.getDeletePermissions(),
    };

    for (const operation of Object.keys(tableLists)) {
      if (tableLists[operation]!.includes(permission)) {
        found.push({
          where: `${model.tableName}: ${operation}`,
          list: tableLists[operation]!,
        });
      }
    }

    const columns: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const column of Object.keys(columns)) {
      for (const operation of ["create", "read", "update"] as const) {
        const list: Array<Permission> = columns[column]?.[operation] || [];

        if (list.includes(permission)) {
          found.push({
            where: `${model.tableName}.${column}: ${operation}`,
            list,
          });
        }
      }
    }
  }

  return found;
}

function permissionsOf(rows: Array<UserPermission>): Array<Permission> {
  return rows.map((row: UserPermission): Permission => {
    return row.permission;
  });
}

const PROJECT_ID: ObjectID = new ObjectID(
  "81000000-0000-4000-8000-000000000001",
);

describe("nobody loses access when the ten go", () => {
  test("every signed-in person holds Public, User and Logged in User wherever they are", () => {
    const global: UserGlobalAccessPermission = (
      AccessTokenService as unknown as {
        buildUserGlobalAccessPermission: (
          projectIds: Array<ObjectID>,
        ) => UserGlobalAccessPermission;
      }
    ).buildUserGlobalAccessPermission([PROJECT_ID]);

    expect(global.globalPermissions).toEqual(
      expect.arrayContaining([
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
      ]),
    );

    // Even with no global permissions read yet, a signed-in person's checks hold the two.
    expect(
      permissionsOf(
        DatabaseCommonInteractionPropsUtil.getUserPermissions(
          { userId: ObjectID.generate(), tenantId: PROJECT_ID },
          PermissionType.Allow,
        ),
      ),
    ).toEqual(
      expect.arrayContaining([Permission.Public, Permission.CurrentUser]),
    );
  });

  test("every member, and every key, holds Logged in User and UnAuthorizedSsoUser in their project", () => {
    expect(
      permissionsOf(
        UserPermissionUtil.getDefaultUserTenantAccessPermission(PROJECT_ID)
          .permissions,
      ),
    ).toEqual(
      expect.arrayContaining([
        Permission.CurrentUser,
        Permission.UnAuthorizedSsoUser,
      ]),
    );
  });

  test("every API key holds Public, User, Logged in User and AuthenticatedRequest wherever it acts", async () => {
    const global: UserGlobalAccessPermission =
      await APIKeyAccessPermission.getDefaultApiGlobalPermission(PROJECT_ID);

    expect(global.globalPermissions).toEqual(
      expect.arrayContaining([
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
        Permission.AuthenticatedRequest,
      ]),
    );
  });

  test("a workflow holds them too", () => {
    expect(
      WorkflowPrincipal.getGlobalAccessPermission(PROJECT_ID).globalPermissions,
    ).toEqual(
      expect.arrayContaining([
        Permission.Public,
        Permission.User,
        Permission.CurrentUser,
        Permission.AuthenticatedRequest,
      ]),
    );
    expect(
      permissionsOf(
        WorkflowPrincipal.getTenantAccessPermission(PROJECT_ID).permissions,
      ),
    ).toEqual(
      expect.arrayContaining([
        Permission.CurrentUser,
        Permission.UnAuthorizedSsoUser,
      ]),
    );
  });

  test("every list that names AuthenticatedRequest lets Logged in User in too, so no person needs it", () => {
    const lists: Array<{ where: string; list: Array<Permission> }> =
      listsNaming(Permission.AuthenticatedRequest);

    expect(lists.length).toBeGreaterThan(0);

    for (const entry of lists) {
      expect({
        where: entry.where,
        lets: entry.list.includes(Permission.CurrentUser),
      }).toEqual({ where: entry.where, lets: true });
    }
  });

  test("Customer Support reaches only a person's isDisabled and isBlocked, which only OneUptime changes", () => {
    expect(
      listsNaming(Permission.CustomerSupport)
        .map((entry: { where: string }): string => {
          return entry.where;
        })
        .sort(),
    ).toEqual(
      [
        "User.isBlocked: read",
        "User.isBlocked: update",
        "User.isDisabled: read",
        "User.isDisabled: update",
      ].sort(),
    );
  });

  test.each([
    [Permission.CreateServiceTelemetryService],
    [Permission.DeleteServiceTelemetryService],
    [Permission.EditServiceTelemetryService],
    [Permission.ReadServiceTelemetryService],
  ])("%s reaches nothing", (permission: Permission) => {
    expect(listsNaming(permission)).toEqual([]);
  });

  test("the sweep reads every model", () => {
    expect(MODELS.length).toBeGreaterThan(500);
    expect(ANALYTICS_MODELS.length).toBeGreaterThan(5);
  });
});
