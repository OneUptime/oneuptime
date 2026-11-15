import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  PERMISSION_TABLES,
  RECOUNT_ROLES_HOLDING_THEM,
  REMOVED_PERMISSIONS,
  RemovePermissionsThatGrantNothing1809178600000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809178600000-RemovePermissionsThatGrantNothing";
import { RECOUNT_ROLES_HOLDING_THEM as SERVICE_TELEMETRY_LINK_RECOUNT } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809176500000-RemoveServiceTelemetryLinkPermissions";
import { REMOVED_PERMISSIONS as REMOVED_BEFORE } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809178100000-RemovePermissionsTeamsCannotBeGiven";
import { PERMISSION_ROW_MIGRATIONS } from "../../../../Server/Infrastructure/Postgres/PermissionRowMigrations";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import AnalyticsModels from "../../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import ApiKeyPermission from "../../../../Models/DatabaseModels/ApiKeyPermission";
import BillingInvoice from "../../../../Models/DatabaseModels/BillingInvoice";
import CustomRole from "../../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../../Models/DatabaseModels/CustomRolePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OnCallDutyPolicyScheduleLayer from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../../Types/Dictionary";
import Permission, { PermissionHelper } from "../../../../Types/Permission";

/*
 * The 28 permissions the pickers offered and nothing checks (#8275, #8276,
 * #8277) leave every team, API key and custom role that holds one, and a
 * custom role's permission count is counted again without them first - as
 * RemoveServiceTelemetryLinkPermissions1809176500000 did for the four it
 * retired.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read
 * as text, so up() and down() are told apart and the parameters are seen.
 * RemovePermissionsThatGrantNothingPostgres runs them on real rows.
 *
 * Below them, why nobody loses access - and nobody gains any: what each of
 * the 28 was offered for is done with another permission, which still does
 * it, or by nobody at all.
 */

const MIGRATION_TIMESTAMP: string = "1809178600000";
const MIGRATION_BASE_NAME: string = "RemovePermissionsThatGrantNothing";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

// A migration's 13-digit timestamp, read off its class name.
const TIMESTAMP_OF_NAME: RegExp = /(\d{13})$/;

const FEEDS: Array<string> = [
  "EditAlertEpisodeFeed",
  "EditAlertFeed",
  "EditCephClusterFeed",
  "EditCloudResourceFeed",
  "EditDatabaseServerFeed",
  "EditDockerHostFeed",
  "EditDockerSwarmClusterFeed",
  "EditHostFeed",
  "EditIncidentEpisodeFeed",
  "EditIncidentFeed",
  "EditKubernetesClusterFeed",
  "EditMonitorFeed",
  "EditOnCallDutyPolicyFeed",
  "EditOpenStackCloudFeed",
  "EditPodmanHostFeed",
  "EditProxmoxClusterFeed",
  "EditScheduledMaintenanceFeed",
  "EditServiceFeed",
  "EditServiceLevelObjectiveFeed",
  "EditStorageArrayFeed",
  "EditVMwareVCenterFeed",
];

const LAYER_USERS: Array<string> = [
  "CreateOnCallDutyPolicyScheduleLayerUser",
  "DeleteOnCallDutyPolicyScheduleLayerUser",
  "EditOnCallDutyPolicyScheduleLayerUser",
  "ReadOnCallDutyPolicyScheduleLayerUser",
];

const THE_28: Array<string> = [
  ...FEEDS,
  ...LAYER_USERS,
  "CreateInvoices",
  "DeleteInvoices",
  "AddLabelsToProjectResources",
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
    new RemovePermissionsThatGrantNothing1809178600000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("RemovePermissionsThatGrantNothing1809178600000", () => {
  test("counts the roles' permissions again, then deletes the 28 from every table that grants them", async () => {
    expect(await statementsOf("up")).toEqual([
      { sql: RECOUNT_ROLES_HOLDING_THEM, parameters: [THE_28] },
      {
        sql: `DELETE FROM "TeamPermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [THE_28],
      },
      {
        sql: `DELETE FROM "ApiKeyPermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [THE_28],
      },
      {
        sql: `DELETE FROM "CustomRolePermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [THE_28],
      },
    ]);
  });

  test("removes the 28 and nothing else: the permissions are passed as data, one condition each", async () => {
    expect(REMOVED_PERMISSIONS).toEqual(THE_28);

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
      expect(statement.parameters).toEqual([THE_28]);
    }

    // No statement names a permission in its text, so none can name another.
    for (const statement of await statementsOf("up")) {
      for (const permission of Object.values(Permission) as Array<string>) {
        expect(statement.sql.includes(`'${permission}'`)).toBe(false);
      }
    }
  });

  test("the 28 are permissions, each once, none of them offered to a team, a key or a role, and none removed before", () => {
    const values: Array<string> = Object.values(Permission) as Array<string>;

    expect(new Set<string>(REMOVED_PERMISSIONS).size).toBe(
      REMOVED_PERMISSIONS.length,
    );
    expect(REMOVED_PERMISSIONS).toHaveLength(28);

    for (const permission of REMOVED_PERMISSIONS) {
      expect({ permission, value: values.includes(permission) }).toEqual({
        permission,
        value: true,
      });
      expect({
        permission,
        offered: PermissionHelper.isAssignableToTenant(permission),
      }).toEqual({ permission, offered: false });
      expect({
        permission,
        removedBefore: REMOVED_BEFORE.includes(permission),
      }).toEqual({ permission, removedBefore: false });
    }
  });

  test("the recount is the role's own count, without the 28, and only of the roles that hold one", () => {
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

  test("down puts nothing back: the rows granted nothing", async () => {
    expect(await statementsOf("down")).toEqual([]);
  });

  test("is registered, named for its class, and ordered after every migration before it", () => {
    const registered: Array<string> = (
      SchemaMigrations as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(registered).toContain(MIGRATION_CLASS_NAME);
    expect(new RemovePermissionsThatGrantNothing1809178600000().name).toBe(
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

    // After the two that removed permissions before it.
    expect(at).toBeGreaterThan(
      registered.indexOf("RemovePermissionsTeamsCannotBeGiven1809178100000"),
    );
  });

  test("is listed among the migrations that change permission rows, so members' cached sets are built again", () => {
    expect(PERMISSION_ROW_MIGRATIONS).toContain(MIGRATION_CLASS_NAME);
  });
});

/*
 * NOBODY LOSES ACCESS, AND NOBODY GAINS ANY. A row of one of the 28 let
 * its team's members, or its key, do nothing: no model's table or column
 * list names it. What each was offered for is done with another permission
 * - which keeps doing it - or by nobody:
 *
 *   - a feed's entries are edited by nobody: every feed model's update
 *     list is empty;
 *   - a layer's people are added, read, moved and taken out with the
 *     layer's own permissions, as they have been since layers were made;
 *   - an invoice is created and deleted by nobody: they come from the
 *     payment provider;
 *   - a label is put on a resource by those who may change the resource.
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
function listsNaming(permission: string): Array<string> {
  const found: Array<string> = [];

  for (const model of MODELS) {
    const lists: Dictionary<Array<Permission>> = {
      create: model.createRecordPermissions || [],
      read: model.readRecordPermissions || [],
      update: model.updateRecordPermissions || [],
      delete: model.deleteRecordPermissions || [],
    };

    for (const operation of Object.keys(lists)) {
      if (lists[operation]!.includes(permission as Permission)) {
        found.push(`${model.tableName}: ${operation}`);
      }
    }

    for (const column of model.getTableColumns().columns) {
      const accessControl: ColumnAccessControl | null =
        model.getColumnAccessControlFor(column);

      for (const operation of ["create", "read", "update"] as const) {
        if (
          (accessControl?.[operation] || []).includes(permission as Permission)
        ) {
          found.push(`${model.tableName}.${column}: ${operation}`);
        }
      }
    }
  }

  for (const model of ANALYTICS_MODELS) {
    const columns: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    if (
      [
        ...model.getCreatePermissions(),
        ...model.getReadPermissions(),
        ...model.getUpdatePermissions(),
        ...model.getDeletePermissions(),
        ...Object.values(columns).flatMap(
          (accessControl: ColumnAccessControl): Array<Permission> => {
            return [
              ...(accessControl.create || []),
              ...(accessControl.read || []),
              ...(accessControl.update || []),
            ];
          },
        ),
      ].includes(permission as Permission)
    ) {
      found.push(`${model.tableName} (analytics)`);
    }
  }

  return found;
}

// The feed model each Edit ... Feed permission was named for: the one its Create sibling creates.
function feedModelOf(permission: string): BaseModel {
  const create: string = permission.replace(/^Edit/, "Create");
  const models: Array<BaseModel> = MODELS.filter((model: BaseModel) => {
    return (model.createRecordPermissions || []).includes(create as Permission);
  });

  expect({ permission, models: models.length }).toEqual({
    permission,
    models: 1,
  });

  return models[0]!;
}

describe("nobody loses access when the 28 go", () => {
  test.each(
    THE_28.map((permission: string) => {
      return [permission];
    }),
  )("%s reaches nothing", (permission: string) => {
    expect(listsNaming(permission)).toEqual([]);
  });

  test.each(
    FEEDS.map((permission: string) => {
      return [permission];
    }),
  )(
    "the feed %s was named for is edited by nobody: its update list and every column's are empty",
    (permission: string) => {
      const model: BaseModel = feedModelOf(permission);

      expect(model.tableName).toMatch(/Feed$/);
      expect({
        table: model.tableName,
        update: model.updateRecordPermissions || [],
      }).toEqual({ table: model.tableName, update: [] });

      for (const column of model.getTableColumns().columns) {
        // A column's update list lets nobody in when the table's does not.
        const update: Array<Permission> =
          model.getColumnAccessControlFor(column)?.update || [];

        expect({
          column: `${model.tableName}.${column}`,
          updatedThroughTheTable: update.filter((p: Permission) => {
            return (model.updateRecordPermissions || []).includes(p);
          }),
        }).toEqual({
          column: `${model.tableName}.${column}`,
          updatedThroughTheTable: [],
        });
      }
    },
  );

  test.each([
    ["added", "create", Permission.CreateOnCallDutyPolicyScheduleLayer],
    ["read", "read", Permission.ReadOnCallDutyPolicyScheduleLayer],
    ["moved", "update", Permission.EditOnCallDutyPolicyScheduleLayer],
    ["taken out", "delete", Permission.DeleteOnCallDutyPolicyScheduleLayer],
  ])(
    "a layer's people are %s (%s) with %s, as the layer is",
    (_done: string, operation: string, permission: Permission) => {
      const layerUser: BaseModel = new OnCallDutyPolicyScheduleLayerUser();
      const layer: BaseModel = new OnCallDutyPolicyScheduleLayer();
      const lists: Dictionary<(model: BaseModel) => Array<Permission>> = {
        create: (model: BaseModel) => {
          return model.createRecordPermissions || [];
        },
        read: (model: BaseModel) => {
          return model.readRecordPermissions || [];
        },
        update: (model: BaseModel) => {
          return model.updateRecordPermissions || [];
        },
        delete: (model: BaseModel) => {
          return model.deleteRecordPermissions || [];
        },
      };

      expect(lists[operation]!(layerUser)).toContain(permission);
      // The very permissions the layer itself takes, so nothing about who may changed.
      expect(lists[operation]!(layerUser)).toEqual(lists[operation]!(layer));
    },
  );

  test("the layer permissions are still offered, and say they cover a layer's people", () => {
    for (const permission of [
      Permission.CreateOnCallDutyPolicyScheduleLayer,
      Permission.ReadOnCallDutyPolicyScheduleLayer,
      Permission.EditOnCallDutyPolicyScheduleLayer,
      Permission.DeleteOnCallDutyPolicyScheduleLayer,
    ]) {
      expect({
        permission,
        offered: PermissionHelper.isAssignableToTenant(permission),
      }).toEqual({ permission, offered: true });
      expect(PermissionHelper.getDescription(permission)).toMatch(
        /people|who is in/,
      );
    }
  });

  test("an invoice is created and deleted by nobody; Read Invoices still reads one", () => {
    const invoice: BaseModel = new BillingInvoice();

    expect(invoice.createRecordPermissions).toEqual([]);
    expect(invoice.deleteRecordPermissions).toEqual([]);
    expect(invoice.readRecordPermissions).toContain(Permission.ReadInvoices);
    expect(PermissionHelper.isAssignableToTenant(Permission.ReadInvoices)).toBe(
      true,
    );
    // Edit Invoices pays an open one (ProjectBilling), and stays offered.
    expect(PermissionHelper.isAssignableToTenant(Permission.EditInvoices)).toBe(
      true,
    );
  });

  test("a label is put on a resource only by those who may change the resource", () => {
    const labelled: Array<BaseModel> = MODELS.filter((model: BaseModel) => {
      return model.getTableColumns().columns.includes("labels");
    });

    expect(labelled.length).toBeGreaterThan(30);

    for (const model of labelled) {
      const column: Array<Permission> =
        model.getColumnAccessControlFor("labels")?.update || [];
      const table: Array<Permission> = model.updateRecordPermissions || [];

      expect({
        table: model.tableName,
        labelsColumnNamesIt: column.includes(
          Permission.AddLabelsToProjectResources,
        ),
      }).toEqual({ table: model.tableName, labelsColumnNamesIt: false });

      // An update needs the table's permission first: these are who may label.
      const mayLabel: Array<Permission> = column.filter((p: Permission) => {
        return table.includes(p);
      });

      expect({
        table: model.tableName,
        labelledByWhoMayChangeIt: mayLabel.length > 0 || column.length === 0,
      }).toEqual({ table: model.tableName, labelledByWhoMayChangeIt: true });
    }
  });

  test("the sweep reads every model", () => {
    expect(MODELS.length).toBeGreaterThan(500);
    expect(ANALYTICS_MODELS.length).toBeGreaterThan(5);
  });
});
