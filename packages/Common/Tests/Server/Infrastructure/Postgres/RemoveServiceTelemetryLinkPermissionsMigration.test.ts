import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  PERMISSION_TABLES,
  RECOUNT_ROLES_HOLDING_THEM,
  REMOVED_PERMISSIONS,
  RemoveServiceTelemetryLinkPermissions1809176500000,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809176500000-RemoveServiceTelemetryLinkPermissions";
import ApiKeyPermission from "../../../../Models/DatabaseModels/ApiKeyPermission";
import CustomRole from "../../../../Models/DatabaseModels/CustomRole";
import CustomRolePermission from "../../../../Models/DatabaseModels/CustomRolePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../../Types/Permission";

/*
 * The four Service Telemetry Link permissions, which nothing checks, leave
 * every team, API key and custom role that holds them, and a custom role's
 * permission count is counted again without them first.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read
 * as text, so up() and down() are told apart and the parameters are seen.
 * RemoveServiceTelemetryLinkPermissionsPostgres runs them on real rows.
 */

const MIGRATION_TIMESTAMP: string = "1809176500000";
const MIGRATION_BASE_NAME: string = "RemoveServiceTelemetryLinkPermissions";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

// A migration's 13-digit timestamp, read off its class name.
const TIMESTAMP_OF_NAME: RegExp = /(\d{13})$/;

const THE_FOUR: Array<string> = [
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
    new RemoveServiceTelemetryLinkPermissions1809176500000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("RemoveServiceTelemetryLinkPermissions1809176500000", () => {
  test("counts the roles' permissions again, then deletes the four from every table that grants them", async () => {
    expect(await statementsOf("up")).toEqual([
      { sql: RECOUNT_ROLES_HOLDING_THEM, parameters: [THE_FOUR] },
      {
        sql: `DELETE FROM "TeamPermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [THE_FOUR],
      },
      {
        sql: `DELETE FROM "ApiKeyPermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [THE_FOUR],
      },
      {
        sql: `DELETE FROM "CustomRolePermission" WHERE "permission" = ANY($1::text[])`,
        parameters: [THE_FOUR],
      },
    ]);
  });

  test("removes the four and nothing else: the permissions are passed as data, one condition each", async () => {
    expect(REMOVED_PERMISSIONS).toEqual(THE_FOUR);

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
      expect(statement.parameters).toEqual([THE_FOUR]);
    }

    // No statement names a permission in its text, so none can name another.
    for (const statement of await statementsOf("up")) {
      for (const permission of Object.values(Permission) as Array<string>) {
        expect(statement.sql.includes(`'${permission}'`)).toBe(false);
      }
    }
  });

  test("the recount is the role's own count, without the four, and only of the roles that hold one", () => {
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

    const rolePermission: CustomRolePermission = new CustomRolePermission();
    expect(rolePermission.getTableColumns().columns).toEqual(
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

  test("the four are still permissions, and no longer offered to anyone", () => {
    const values: Array<string> = Object.values(Permission) as Array<string>;
    const offered: Array<string> =
      PermissionHelper.getTenantPermissionProps().map(
        (props: PermissionProps): string => {
          return props.permission.toString();
        },
      );

    for (const permission of THE_FOUR) {
      expect({ permission, value: values.includes(permission) }).toEqual({
        permission,
        value: true,
      });
      expect({ permission, offered: offered.includes(permission) }).toEqual({
        permission,
        offered: false,
      });
    }
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
    expect(new RemoveServiceTelemetryLinkPermissions1809176500000().name).toBe(
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
  });
});
