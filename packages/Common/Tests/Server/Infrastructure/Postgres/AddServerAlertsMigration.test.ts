import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddServerAlerts1809183400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809183400000-AddServerAlerts";
import GlobalConfig from "../../../../Models/DatabaseModels/GlobalConfig";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind telling master admins when the server's email or its
 * global probes stop working (#6879): where it goes (the number to text,
 * whether to push) and what was last told, on GlobalConfig.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. Additive and nullable (Docs/migrations/README.md): three
 * columns on the one-row GlobalConfig, no default, no index, no key,
 * nothing backfilled. A server of the release before ignores them; one of
 * this release reads null as nobody chose yet. The migration has to be
 * registered, named for its class and ordered after every migration
 * before it, or it never runs; the schema drift check holds its statements
 * to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809183400000";
const MIGRATION_BASE_NAME: string = "AddServerAlerts";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string = "AddServerEmailLog1809183300000";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface = new AddServerAlerts1809183400000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddServerAlerts1809183400000", () => {
  test("adds the number, the switch and the state to GlobalConfig, all nullable", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "GlobalConfig" ADD "serverAlertPhoneNumber" character varying(30)`,
      `ALTER TABLE "GlobalConfig" ADD "isServerAlertPushOn" boolean`,
      `ALTER TABLE "GlobalConfig" ADD "serverAlertState" jsonb`,
    ]);
  });

  test("builds no index, adds no key or default, backfills nothing and touches no other table", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
      expect(statement).toMatch(/^ALTER TABLE "GlobalConfig" ADD /);
    }
  });

  test("down drops the columns up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "GlobalConfig" DROP COLUMN "serverAlertState"`,
      `ALTER TABLE "GlobalConfig" DROP COLUMN "isServerAlertPushOn"`,
      `ALTER TABLE "GlobalConfig" DROP COLUMN "serverAlertPhoneNumber"`,
    ]);
  });

  test("the model declares the columns it adds, none required", () => {
    const model: GlobalConfig = new GlobalConfig();

    expect(model.getTableColumnMetadata("serverAlertPhoneNumber").type).toBe(
      TableColumnType.Phone,
    );
    expect(model.getTableColumnMetadata("isServerAlertPushOn").type).toBe(
      TableColumnType.Boolean,
    );
    expect(model.getTableColumnMetadata("serverAlertState").type).toBe(
      TableColumnType.JSON,
    );

    for (const column of [
      "serverAlertPhoneNumber",
      "isServerAlertPushOn",
      "serverAlertState",
    ]) {
      expect(model.getTableColumns().columns).toContain(column);
      expect(model.getTableColumnMetadata(column).required).toBeFalsy();
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
    expect(new AddServerAlerts1809183400000().name).toBe(MIGRATION_CLASS_NAME);

    const timestamps: Array<number> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .map((file: string): number => {
        return Number(file.split("-")[0]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(
        ...timestamps.filter((value: number): boolean => {
          return value <= 1809183300000;
        }),
      ),
    );
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(PREVIOUS_MIGRATION),
    );
    expect(names.indexOf(PREVIOUS_MIGRATION)).toBeGreaterThan(-1);
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
