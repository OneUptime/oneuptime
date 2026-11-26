import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddSecurityUserErasureRequestProgress1809187741160 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187741160-AddSecurityUserErasureRequestProgress";
import SecurityUserErasureRequest from "../../../../Models/DatabaseModels/SecurityUserErasureRequest";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind an erasure request keeping where its worker got to
 * (#11160): SecurityUserErasureRequest.progress, so a project too large to
 * read in one run is read over several.
 *
 * The statements are executed against a fake QueryRunner, so up() and down()
 * are told apart. The column is nullable with no default, so Postgres adds
 * it without rewriting the table; nothing is backfilled and nothing scans
 * it. The migration has to be registered, named for its class and ordered
 * after every migration before it, or it never runs; the schema drift check
 * holds its statement to the model.
 */

const MIGRATION_TIMESTAMP: string = "1809187741160";
const MIGRATION_BASE_NAME: string = "AddSecurityUserErasureRequestProgress";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

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
    new AddSecurityUserErasureRequestProgress1809187741160();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddSecurityUserErasureRequestProgress1809187741160", () => {
  test("adds progress to the erasure requests, nullable, with no default", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "SecurityUserErasureRequest" ADD "progress" jsonb`,
    ]);
  });

  test("builds no index, adds no key, backfills nothing", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(
        /CREATE (UNIQUE )?INDEX|FOREIGN KEY|DEFAULT|NOT NULL|UPDATE /i,
      );
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "SecurityUserErasureRequest" DROP COLUMN "progress"`,
    ]);
  });

  test("the model declares the column it adds, as JSON, not required", () => {
    const model: SecurityUserErasureRequest = new SecurityUserErasureRequest();

    expect(model.getTableColumns().columns).toContain("progress");
    expect(model.getTableColumnMetadata("progress").type).toBe(
      TableColumnType.JSON,
    );
    expect(model.getTableColumnMetadata("progress").required).toBe(false);
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
    expect(new AddSecurityUserErasureRequestProgress1809187741160().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    // After the one that added the names it keeps beside it (#11044).
    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf("AddSecurityUserErasureRequestNamesToErase1809187691044"),
    );
    expect(
      fs.existsSync(
        path.join(
          MIGRATION_DIRECTORY,
          `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`,
        ),
      ),
    ).toBe(true);

    // Numbered after every migration registered before it.
    const registeredBefore: Array<number> = names
      .slice(0, names.indexOf(MIGRATION_CLASS_NAME))
      .map((name: string): number => {
        return Number((name.match(/(\d{13})$/) || [])[1]);
      })
      .filter((value: number): boolean => {
        return Number.isFinite(value) && value > 0;
      });

    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(
      Math.max(...registeredBefore),
    );
  });
});
