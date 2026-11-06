import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner, getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddScheduledMaintenanceCloudResources1808994417000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1808994417000-AddScheduledMaintenanceCloudResources";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * The migration behind a scheduled maintenance event that holds cloud
 * resources (ScheduledMaintenance.cloudResources): one new join table, as
 * the event's database servers have - its two ids, the pair its primary
 * key, each indexed, each row deleted with its event or its resource. Only
 * a new table is created, so no existing table is scanned, locked or
 * rewritten, and every index and key is on that new table
 * (SchemaMigrationsOnlineDdl leaves those to the transaction).
 *
 * Run against a fake QueryRunner, so the statements are what is pinned;
 * the schema drift check holds them to the model, and the migration was
 * generated with npm run generate-postgres-migration and run on a real
 * Postgres 15, where a second generate found nothing left to change.
 */

const MIGRATION_TIMESTAMP: string = "1808994417000";
const MIGRATION_BASE_NAME: string = "AddScheduledMaintenanceCloudResources";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const JOIN_TABLE: string = "ScheduledMaintenanceCloudResource";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql.trim());
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddScheduledMaintenanceCloudResources1808994417000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddScheduledMaintenanceCloudResources1808994417000", () => {
  test("creates the join table, its two indexes and its two keys", async () => {
    expect(await statementsOf("up")).toEqual([
      `CREATE TABLE "${JOIN_TABLE}" ("scheduledMaintenanceId" uuid NOT NULL, "cloudResourceId" uuid NOT NULL, CONSTRAINT "PK_f770af1d18b4c98063b2e39ceb6" PRIMARY KEY ("scheduledMaintenanceId", "cloudResourceId"))`,
      `CREATE INDEX "IDX_2fc3f1beac13af6b1f9ea8454d" ON "${JOIN_TABLE}" ("scheduledMaintenanceId")`,
      `CREATE INDEX "IDX_6ea7ab4f15b9cdc6e06b05f0fa" ON "${JOIN_TABLE}" ("cloudResourceId")`,
      `ALTER TABLE "${JOIN_TABLE}" ADD CONSTRAINT "FK_2fc3f1beac13af6b1f9ea8454dc" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
      `ALTER TABLE "${JOIN_TABLE}" ADD CONSTRAINT "FK_6ea7ab4f15b9cdc6e06b05f0fa1" FOREIGN KEY ("cloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    ]);
  });

  test("touches no table but its own", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).toContain(`"${JOIN_TABLE}"`);
      expect(statement).not.toMatch(/^(ALTER TABLE|UPDATE|DELETE)\s+"(ScheduledMaintenance|CloudResource)"\s/);
    }
  });

  test("down takes away exactly what up added, in reverse", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "${JOIN_TABLE}" DROP CONSTRAINT "FK_6ea7ab4f15b9cdc6e06b05f0fa1"`,
      `ALTER TABLE "${JOIN_TABLE}" DROP CONSTRAINT "FK_2fc3f1beac13af6b1f9ea8454dc"`,
      `DROP INDEX "public"."IDX_6ea7ab4f15b9cdc6e06b05f0fa"`,
      `DROP INDEX "public"."IDX_2fc3f1beac13af6b1f9ea8454d"`,
      `DROP TABLE "${JOIN_TABLE}"`,
    ]);
  });

  test("the model declares the relation the table is for", () => {
    const relation: RelationMetadataArgs | undefined =
      getMetadataArgsStorage().relations.find(
        (candidate: RelationMetadataArgs): boolean => {
          return (
            candidate.target === ScheduledMaintenance &&
            candidate.propertyName === "cloudResources"
          );
        },
      );

    expect(relation?.relationType).toBe("many-to-many");
    expect(
      typeof relation?.type === "function"
        ? (relation.type as () => unknown)()
        : undefined,
    ).toBe(CloudResource);

    const joinTable: JoinTableMetadataArgs | undefined =
      getMetadataArgsStorage().joinTables.find(
        (candidate: JoinTableMetadataArgs): boolean => {
          return (
            candidate.target === ScheduledMaintenance &&
            candidate.propertyName === "cloudResources"
          );
        },
      );

    expect(joinTable?.name).toBe(JOIN_TABLE);
    expect(joinTable?.joinColumns?.[0]?.name).toBe("scheduledMaintenanceId");
    expect(joinTable?.inverseJoinColumns?.[0]?.name).toBe("cloudResourceId");
  });

  test("the column is an optional list of cloud resources, as the event's other resources are", () => {
    const model: ScheduledMaintenance = new ScheduledMaintenance();

    expect(model.getTableColumnMetadata("cloudResources").type).toBe(
      TableColumnType.EntityArray,
    );
    expect(model.getTableColumnMetadata("cloudResources").modelType).toBe(
      CloudResource,
    );
    expect(
      Boolean(model.getTableColumnMetadata("cloudResources").required),
    ).toBe(false);
  });

  test("whoever may set, read or change an event's databases may do the same with its cloud resources", () => {
    const access: Record<
      string,
      { create?: Array<Permission>; read?: Array<Permission>; update?: Array<Permission> }
    > = new ScheduledMaintenance().getColumnAccessControlForAllColumns() as never;

    for (const operation of ["create", "read", "update"] as const) {
      expect([...(access["cloudResources"]?.[operation] || [])].sort()).toEqual(
        [...(access["databaseServers"]?.[operation] || [])].sort(),
      );
    }
  });

  test("is registered once, under its own name, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);
    expect(new AddScheduledMaintenanceCloudResources1808994417000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

    const earlier: Array<string> = names.filter((name: string): boolean => {
      const timestamp: number = Number(name.match(/(\d{13})$/)?.[1] || 0);
      return timestamp > 0 && timestamp < Number(MIGRATION_TIMESTAMP);
    });

    for (const name of earlier) {
      expect({
        name,
        before: names.indexOf(name) < names.indexOf(MIGRATION_CLASS_NAME),
      }).toEqual({ name, before: true });
    }

    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
  });
});
