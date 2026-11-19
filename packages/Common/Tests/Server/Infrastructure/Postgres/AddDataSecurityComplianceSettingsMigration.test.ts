import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDataSecurityComplianceSettings1809184730000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809184730000-AddDataSecurityComplianceSettings";
import DataSecurityComplianceSetting from "../../../../Models/DatabaseModels/DataSecurityComplianceSetting";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind what a resource turned off of a compliance framework
 * (#9555): one new table, "DataSecurityComplianceSetting", with a row per
 * framework or requirement a Kubernetes cluster, a container host, a
 * database, a cloud resource or a service turned off for its own data
 * stores.
 *
 * The statements run against a fake QueryRunner, so up() and down() are
 * told apart. The table is new and empty, so its indexes and keys are built
 * in the same migration (SchemaMigrationsOnlineDdl leaves a table created
 * in the same migration alone), and no table that exists is touched. The
 * migration has to be registered, named for its class and ordered after
 * every migration before it, or it never runs; the schema drift check holds
 * its statements to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809184730000";
const MIGRATION_BASE_NAME: string = "AddDataSecurityComplianceSettings";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
// The last migration registered before it.
const PREVIOUS_MIGRATION: string =
  "AddSecurityCaseTaskResponseStepKey1809184720000";
const TABLE: string = "DataSecurityComplianceSetting";

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
  const migration: MigrationInterface =
    new AddDataSecurityComplianceSettings1809184730000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddDataSecurityComplianceSettings1809184730000", () => {
  test("creates the one table, with the columns the model declares", async () => {
    const [create] = await statementsOf("up");

    expect(create).toMatch(new RegExp(`^CREATE TABLE "${TABLE}" `));

    for (const column of [
      `"projectId" uuid NOT NULL`,
      `"resourceType" character varying(100) NOT NULL`,
      `"resourceId" uuid NOT NULL`,
      `"framework" character varying(100) NOT NULL`,
      `"requirement" character varying(100),`,
      `"isEnabled" boolean NOT NULL DEFAULT false`,
      `"note" character varying(500),`,
      `"createdByUserId" uuid,`,
      `"deletedByUserId" uuid,`,
    ]) {
      expect(create).toContain(column);
    }
  });

  test("indexes the project, and a resource's settings, read together on its page", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(statements).toContain(
      `CREATE INDEX "IDX_68013570ecc001a84b85011663" ON "${TABLE}" ("projectId") `,
    );
    expect(statements).toContain(
      `CREATE INDEX "IDX_822874655fd91a535404f23063" ON "${TABLE}" ("projectId", "resourceType", "resourceId") `,
    );
  });

  test("a setting goes with its project, and outlives the people who made it", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(statements).toContain(
      `ALTER TABLE "${TABLE}" ADD CONSTRAINT "FK_68013570ecc001a84b850116633" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    for (const column of ["createdByUserId", "deletedByUserId"]) {
      expect(
        statements.some((statement: string): boolean => {
          return (
            statement.includes(`FOREIGN KEY ("${column}") REFERENCES "User"`) &&
            statement.includes("ON DELETE SET NULL")
          );
        }),
      ).toBe(true);
    }
  });

  test("touches no table but its own", async () => {
    for (const statement of await statementsOf("up")) {
      expect(
        statement.startsWith(`CREATE TABLE "${TABLE}" `) ||
          statement.startsWith(`ALTER TABLE "${TABLE}" ADD CONSTRAINT `) ||
          (statement.startsWith("CREATE INDEX ") &&
            statement.includes(` ON "${TABLE}" (`)),
      ).toBe(true);
      expect(statement).not.toMatch(/^UPDATE |^INSERT |^DELETE /);
    }
  });

  test("down undoes up, in the reverse order", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "${TABLE}" DROP CONSTRAINT "FK_ad80fa8e64544f907487abab43f"`,
      `ALTER TABLE "${TABLE}" DROP CONSTRAINT "FK_859e4b0e32211d22dcaca67346e"`,
      `ALTER TABLE "${TABLE}" DROP CONSTRAINT "FK_68013570ecc001a84b850116633"`,
      `DROP INDEX "public"."IDX_822874655fd91a535404f23063"`,
      `DROP INDEX "public"."IDX_68013570ecc001a84b85011663"`,
      `DROP TABLE "${TABLE}"`,
    ]);
  });

  test("the model is the table: its columns, and the ones a setting cannot be made without", () => {
    const model: DataSecurityComplianceSetting =
      new DataSecurityComplianceSetting();

    expect(model.tableName).toBe(TABLE);
    expect(model.getTableColumnMetadata("resourceType").type).toBe(
      TableColumnType.ShortText,
    );
    expect(model.getTableColumnMetadata("resourceId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(model.getTableColumnMetadata("framework").type).toBe(
      TableColumnType.ShortText,
    );
    expect(model.getTableColumnMetadata("isEnabled").type).toBe(
      TableColumnType.Boolean,
    );

    for (const column of [
      "projectId",
      "resourceType",
      "resourceId",
      "framework",
      "isEnabled",
    ]) {
      expect(model.getTableColumnMetadata(column).required).toBe(true);
    }

    for (const column of ["requirement", "note"]) {
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
    expect(new AddDataSecurityComplianceSettings1809184730000().name).toBe(
      MIGRATION_CLASS_NAME,
    );

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
          return value <= 1809184720000;
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
