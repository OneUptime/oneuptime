import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { MigrationInterface, QueryRunner } from "typeorm";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { TurnOnGitHubCommandsByDefault1805760000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805760000000-TurnOnGitHubCommandsByDefault";
import { TurnOnUnsetGitHubCommands1805770000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1805770000000-TurnOnUnsetGitHubCommands";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * "Respond to GitHub Commands" (CodeRepository.isGitHubCommandsEnabled) is
 * on by default. Two migrations, in order:
 *
 *   - TurnOnGitHubCommandsByDefault: the column's default becomes true, so
 *     a repository the GitHub App imports starts on. Generated with npm run
 *     generate-postgres-migration; a column default rewrites no row.
 *   - TurnOnUnsetGitHubCommands: a repository that never had the switch set
 *     held null, which the server always read as on - and the Dashboard drew
 *     as off. Those nulls become true; a repository someone turned off
 *     (false) keeps its choice.
 *
 * The statements are EXECUTED against a fake QueryRunner, so up() and
 * down() are told apart. Both were also run on a real Postgres 15 with every
 * migration before them: a null became true, a false stayed false, a new row
 * started true, and the schema drift check found nothing left to generate.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

// A migration's 13-digit timestamp, read off its class name.
const TIMESTAMP_OF_NAME: RegExp = /(\d{13})$/;

async function statementsOf(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: async (sql: string): Promise<void> => {
      statements.push(sql);
    },
  } as unknown as QueryRunner;

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return statements;
}

function registeredNames(): Array<string> {
  return (SchemaMigrations as Array<{ name: string }>).map(
    (migration: { name: string }): string => {
      return migration.name;
    },
  );
}

describe("TurnOnGitHubCommandsByDefault1805760000000", () => {
  test("makes the column's default true, and nothing else", async () => {
    expect(
      await statementsOf(new TurnOnGitHubCommandsByDefault1805760000000(), "up"),
    ).toEqual([
      `ALTER TABLE "CodeRepository" ALTER COLUMN "isGitHubCommandsEnabled" SET DEFAULT true`,
    ]);
  });

  test("down drops the default it set", async () => {
    expect(
      await statementsOf(
        new TurnOnGitHubCommandsByDefault1805760000000(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "CodeRepository" ALTER COLUMN "isGitHubCommandsEnabled" DROP DEFAULT`,
    ]);
  });

  test("matches the model it was generated from: on by default, still optional", () => {
    const repository: CodeRepository = new CodeRepository();
    const column: ReturnType<typeof repository.getTableColumnMetadata> =
      repository.getTableColumnMetadata("isGitHubCommandsEnabled");

    expect(column.type).toBe(TableColumnType.Boolean);
    expect(column.isDefaultValueColumn).toBe(true);
    expect(column.defaultValue).toBe(true);
    // Optional: leaving it out of a create takes the default.
    expect(column.required).toBeFalsy();
    expect(column.description).toContain("On by default.");
  });
});

describe("TurnOnUnsetGitHubCommands1805770000000", () => {
  test("writes only the nulls as true: a repository someone turned off keeps its choice", async () => {
    const statements: Array<string> = await statementsOf(
      new TurnOnUnsetGitHubCommands1805770000000(),
      "up",
    );

    expect(statements).toEqual([
      `UPDATE "CodeRepository" SET "isGitHubCommandsEnabled" = true WHERE "isGitHubCommandsEnabled" IS NULL`,
    ]);
    // Never a write to the rows that hold false.
    expect(statements[0]).not.toMatch(/= false|IS NOT NULL|NOT /);
  });

  test("down does nothing: true is what those nulls already meant", async () => {
    expect(
      await statementsOf(new TurnOnUnsetGitHubCommands1805770000000(), "down"),
    ).toEqual([]);
  });
});

describe("both migrations", () => {
  const MIGRATIONS: Array<{ timestamp: string; base: string }> = [
    { timestamp: "1805760000000", base: "TurnOnGitHubCommandsByDefault" },
    { timestamp: "1805770000000", base: "TurnOnUnsetGitHubCommands" },
  ];

  test("are registered, named for their classes, and ordered after every migration before them", () => {
    const registered: Array<string> = registeredNames();

    for (const migration of MIGRATIONS) {
      const className: string = `${migration.base}${migration.timestamp}`;

      expect(registered).toContain(className);
      expect(
        fs.existsSync(
          path.join(
            MIGRATION_DIRECTORY,
            `${migration.timestamp}-${migration.base}.ts`,
          ),
        ),
      ).toBe(true);

      const at: number = registered.indexOf(className);

      for (const earlier of registered.slice(0, at)) {
        const match: RegExpMatchArray | null = earlier.match(TIMESTAMP_OF_NAME);
        expect(match ? parseInt(match[1]!, 10) : 0).toBeLessThan(
          parseInt(migration.timestamp, 10),
        );
      }
    }

    expect(new TurnOnGitHubCommandsByDefault1805760000000().name).toBe(
      "TurnOnGitHubCommandsByDefault1805760000000",
    );
    expect(new TurnOnUnsetGitHubCommands1805770000000().name).toBe(
      "TurnOnUnsetGitHubCommands1805770000000",
    );
  });

  test("the default is set before the nulls are written, so no repository imported in between holds a null", () => {
    const registered: Array<string> = registeredNames();

    expect(
      registered.indexOf("TurnOnGitHubCommandsByDefault1805760000000"),
    ).toBeLessThan(registered.indexOf("TurnOnUnsetGitHubCommands1805770000000"));
  });
});
