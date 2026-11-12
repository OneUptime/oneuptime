import { AddProductFeedback1809123000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123000000-AddProductFeedback";
import { AddServerProducts1809123600000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809123600000-AddServerProducts";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import ColumnType from "../../../../Types/Database/ColumnType";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The migration behind switching products off for the whole server (issue
 * #6815): GlobalConfig.serverProducts, a nullable JSON column with no
 * default, so adding it rewrites no row and every server that upgrades keeps
 * every product on (null reads as "nothing saved"). Statements are recorded
 * against a fake QueryRunner; the schema drift check runs it on Postgres
 * against the models.
 */

const MIGRATION_TIMESTAMP: string = "1809123600000";
const MIGRATION_BASE_NAME: string = "AddServerProducts";
const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function record(direction: "up" | "down"): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: true,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface = new AddServerProducts1809123600000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down!(runner);
  }

  return steps;
}

describe("AddServerProducts1809123600000", () => {
  test("adds the one nullable jsonb column, rewriting no row", async () => {
    expect(await record("up")).toEqual([
      `ALTER TABLE "GlobalConfig" ADD "serverProducts" jsonb`,
    ]);
  });

  test("down drops it", async () => {
    expect(await record("down")).toEqual([
      `ALTER TABLE "GlobalConfig" DROP COLUMN "serverProducts"`,
    ]);
  });

  test("matches the model: a nullable JSON column with no default", () => {
    expect(Object.keys(getTableColumns(new GlobalConfig()))).toContain(
      "serverProducts",
    );

    const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.filter((args: ColumnMetadataArgs): boolean => {
        return args.target === GlobalConfig;
      })
      .find((args: ColumnMetadataArgs): boolean => {
        return args.propertyName === "serverProducts";
      });

    expect(column?.options.type).toBe(ColumnType.JSON);
    expect(column?.options.nullable).toBe(true);
    expect(column?.options.default).toBeUndefined();
  });

  test("is named for its file and class, and registered once, after every migration before it", () => {
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);
    expect(new AddServerProducts1809123600000().name).toBe(
      `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`,
    );

    const migrations: Array<unknown> = SchemaMigrations as Array<unknown>;
    const index: number = migrations.indexOf(AddServerProducts1809123600000);

    expect(index).toBeGreaterThan(-1);
    expect(
      migrations.filter((migration: unknown): boolean => {
        return migration === AddServerProducts1809123600000;
      }).length,
    ).toBe(1);
    expect(index).toBeGreaterThan(
      migrations.indexOf(AddProductFeedback1809123000000),
    );

    // Every migration registered before it has an earlier timestamp.
    for (const migration of migrations.slice(0, index)) {
      const name: string = (migration as { name: string }).name;
      const timestamp: string | undefined = name.match(/(\d{13})$/)?.[1];

      if (timestamp) {
        expect(Number(timestamp)).toBeLessThan(Number(MIGRATION_TIMESTAMP));
      }
    }
  });
});
