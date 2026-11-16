import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddRunnerCanRunCodeFixes1809180500000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809180500000-AddRunnerCanRunCodeFixes";
import Runner from "../../../../Models/DatabaseModels/Runner";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration behind a global Runner's code-fix switch (#6115):
 * Runner.canRunCodeFixes, which a master admin turns on the Admin
 * Dashboard's Global Runners page to keep a global Runner off OneUptime AI's
 * code fixes, enforced by the server.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. Nothing is backfilled: the column
 * starts true on every Runner, so every global Runner keeps taking code
 * fixes after the migration, as it has since 14.0.94 - and a NOT NULL
 * column with a constant default rewrites no row. Beyond the SQL, the
 * migration has to be registered, named consistently and ordered after
 * every migration already registered, or it silently never runs.
 */

const MIGRATION_TIMESTAMP: string = "1809180500000";
const MIGRATION_BASE_NAME: string = "AddRunnerCanRunCodeFixes";
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
    new AddRunnerCanRunCodeFixes1809180500000();

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

describe("AddRunnerCanRunCodeFixes1809180500000", () => {
  test("adds whether a global Runner takes AI code fixes, on for every Runner there is", async () => {
    expect(await statementsOf("up")).toEqual([
      `ALTER TABLE "Runner" ADD "canRunCodeFixes" boolean NOT NULL DEFAULT true`,
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
      `ALTER TABLE "Runner" DROP COLUMN "canRunCodeFixes"`,
    ]);
  });

  test("is registered, named for its class, and ordered after every migration before it", () => {
    const registered: Array<string> = (
      SchemaMigrations as Array<{ name: string }>
    ).map((migration: { name: string }): string => {
      return migration.name;
    });

    expect(registered).toContain(MIGRATION_CLASS_NAME);
    expect(new AddRunnerCanRunCodeFixes1809180500000().name).toBe(
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
      runner.getTableColumnMetadata("canRunCodeFixes");

    expect(column.type).toBe(TableColumnType.Boolean);
    expect(column.required).toBe(true);
    expect(column.defaultValue).toBe(true);
    expect(column.isDefaultValueColumn).toBe(true);
  });

  test("no one in a project may create or change it: OneUptime and a master admin set it", () => {
    const runner: Runner = new Runner();

    expect(runner.getColumnAccessControlFor("canRunCodeFixes")?.create).toEqual(
      [],
    );
    expect(runner.getColumnAccessControlFor("canRunCodeFixes")?.update).toEqual(
      [],
    );
  });
});
