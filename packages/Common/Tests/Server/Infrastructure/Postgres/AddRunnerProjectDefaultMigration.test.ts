import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddRunnerProjectDefault1805650000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805650000000-AddRunnerProjectDefault";
import Runner from "../../../../Models/DatabaseModels/Runner";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind the project's default Runner: Runner.isProjectDefault,
 * the one Runner of a project that runs the runbook steps that pick no
 * Runner of their own.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Nothing is backfilled: the column
 * starts false on every Runner, so no project has a default Runner after the
 * migration and every step runs where it ran before - and a NOT NULL column
 * with a constant default rewrites no row. Beyond the SQL, the migration has
 * to be registered, named consistently and ordered after every migration
 * already registered, or it silently never runs. (The statement was
 * generated with npm run generate-postgres-migration, and the schema drift
 * check finds nothing left to generate once it has run.)
 */

const MIGRATION_TIMESTAMP: string = "1805650000000";
const MIGRATION_BASE_NAME: string = "AddRunnerProjectDefault";
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

// A migration's 13-digit timestamp, read off its class name.
const TIMESTAMP_OF_NAME: RegExp = /(\d{13})$/;

async function statementsOf(direction: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;
  const migration: MigrationInterface =
    new AddRunnerProjectDefault1805650000000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddRunnerProjectDefault1805650000000", () => {
  test("adds whether a Runner is its project's default, false for every Runner there is", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "Runner" ADD "isProjectDefault" boolean NOT NULL DEFAULT false`,
    ]);
  });

  test("builds no index and adds no key: nothing holds the Runner table's writers for a scan", async () => {
    for (const statement of await statementsOf("up")) {
      expect(statement).not.toMatch(/CREATE (UNIQUE )?INDEX|FOREIGN KEY/i);
      // A constant default: no row is rewritten, none is backfilled.
      expect(statement).not.toMatch(/UPDATE|INSERT/i);
    }
  });

  test("down drops the column up added, and nothing else", async () => {
    expect(await statementsOf("down")).toEqual([
      `ALTER TABLE "Runner" DROP COLUMN "isProjectDefault"`,
    ]);
  });

  test("is registered, named for its class, and ordered after every migration before it", () => {
    const registered: Array<string> = (
      SchemaMigrations as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(registered).toContain(MIGRATION_CLASS_NAME);
    expect(new AddRunnerProjectDefault1805650000000().name).toBe(
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

  test("matches the model it was generated from", () => {
    const runner: Runner = new Runner();
    const column: ReturnType<typeof runner.getTableColumnMetadata> =
      runner.getTableColumnMetadata("isProjectDefault");

    expect(column.type).toBe(TableColumnType.Boolean);
    expect(column.required).toBe(true);
    expect(column.defaultValue).toBe(false);
    expect(column.isDefaultValueColumn).toBe(true);
  });
});
